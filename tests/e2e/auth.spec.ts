import { expect, test } from "@playwright/test"
import {
  accountPassword,
  createVault,
  registerAccount,
  vaultPassword,
} from "./account-helpers"

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page
    .getByLabel("Account password", { exact: true })
    .fill(accountPassword)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
}

test("registers and signs in separately from unlocking; sign-out clears private screens", async ({
  page,
}) => {
  const email = `registration-${crypto.randomUUID()}@example.test`
  await page.goto("/vault")
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true })
  ).toBeVisible()
  await page.getByRole("link", { name: "Create an account" }).click()
  await expect(
    page.getByRole("heading", { name: "Create your account", exact: true })
  ).toBeVisible()
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page
    .getByLabel("Account password", { exact: true })
    .fill(accountPassword)
  await page
    .getByLabel("Confirm account password")
    .fill("different-password-123")
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click()
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "The account passwords do not match."
  )
  await page.getByLabel("Confirm account password").fill(accountPassword)
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "Create your vault" })
  ).toBeVisible()
  await createVault(page)
  await page.getByLabel("Account label").fill("Private account")
  await page.getByLabel("Website or app").fill("private.example.test")
  await page.getByLabel("Username", { exact: true }).fill("private-user")
  await page
    .getByLabel("Password", { exact: true })
    .fill("private-password-789")
  await page.getByRole("button", { name: "Save credential" }).click()
  await expect(page.getByText("Private account", { exact: true })).toBeVisible()
  const beforeSignOut = await page.request.get("/api/auth/session")
  expect(beforeSignOut.status()).toBe(200)
  await page.getByRole("button", { name: "Sign out", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true })
  ).toBeVisible()
  await expect(page.getByText("private-user", { exact: true })).toHaveCount(0)
  await expect
    .poll(async () => (await page.request.get("/api/auth/session")).status())
    .toBe(401)
  await page.goBack()
  await expect(page.getByText("private-user", { exact: true })).toHaveCount(0)
  await signIn(page, email)
  await expect(
    page.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible()
  await page.getByLabel("Vault password", { exact: true }).fill(accountPassword)
  await page.getByRole("button", { name: "Unlock vault" }).click()
  await expect(page.locator("form").getByRole("alert")).toBeVisible()
  await page.getByLabel("Vault password", { exact: true }).fill(vaultPassword)
  await page.getByRole("button", { name: "Unlock vault" }).click()
  await expect(page.getByText("private-user", { exact: true })).toBeVisible()
})

test("isolates accounts without adopting the pre-account local vault", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "ung-password-manager:vault:v1",
      "legacy-kept-untouched"
    )
  )
  const first = await registerAccount(page)
  await page.goto("/vault")
  await createVault(page)
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await page.getByRole("button", { name: "Sign out", exact: true }).click()
  await expect
    .poll(async () => (await page.request.get("/api/auth/session")).status())
    .toBe(401)
  await registerAccount(page)
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "Create your vault" })
  ).toBeVisible()
  expect(
    await page.evaluate(() =>
      localStorage.getItem("ung-password-manager:vault:v1")
    )
  ).toBe("legacy-kept-untouched")
  expect(
    await page.evaluate(
      (id) =>
        localStorage.getItem(`ung-password-manager:vault:v1:account:${id}`),
      first.id
    )
  ).toBeTruthy()
})

test("sign-out in another tab removes unlocked credentials and forms", async ({
  page,
  context,
}) => {
  await registerAccount(page)
  await page.goto("/vault")
  await createVault(page)
  await page
    .getByLabel("Username", { exact: true })
    .fill("unsaved-private-user")
  const other = await context.newPage()
  await other.goto("/vault")
  await expect(
    other.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible()
  await other.getByRole("button", { name: "Sign out", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toHaveCount(0)
  await expect(page.locator('input[value="unsaved-private-user"]')).toHaveCount(
    0
  )
})

test("a failed sign-out still clears decrypted state and can be retried", async ({
  page,
}) => {
  await registerAccount(page)
  await page.goto("/vault")
  await createVault(page)
  await page.getByLabel("Username", { exact: true }).fill("unsaved-secret")
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await page.route("**/api/auth/logout", (route) => route.abort("failed"))
  await page.getByRole("button", { name: "Sign out", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true })
  ).toBeVisible()
  await expect(
    page.getByText("Sign-out could not be completed. Try signing out again.")
  ).toBeVisible()
  // A delayed notification from an earlier successful sign-in must not
  // erase the newer pending sign-out. Observe actual delivery, not a delay.
  const received = page.evaluate(
    () =>
      new Promise<string | null>((resolve) => {
        const channel = new BroadcastChannel("ung-password-manager:account")
        channel.onmessage = (event) => {
          if (event.data !== "account-changed") return
          channel.close()
          resolve(localStorage.getItem("ung-password-manager:pending-sign-out"))
        }
      })
  )
  const other = await page.context().newPage()
  await other.goto("/sign-in")
  await other.evaluate(() => {
    const channel = new BroadcastChannel("ung-password-manager:account")
    channel.postMessage("account-changed")
    channel.close()
  })
  expect(await received).toBe("true")
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true })
  ).toBeVisible()
  await expect(
    page.getByText("Sign-out could not be completed. Try signing out again.")
  ).toBeVisible()
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toHaveCount(0)
  await page.unroute("**/api/auth/logout")
  await page.getByRole("button", { name: "Retry sign-out" }).click()
  await expect
    .poll(async () => (await page.request.get("/api/auth/session")).status())
    .toBe(401)
})

test("a revoked session locks the vault when the app regains focus", async ({
  page,
}) => {
  await registerAccount(page)
  await page.goto("/vault")
  await createVault(page)
  const response = await page.request.post("/api/auth/logout", {
    headers: { Origin: "http://127.0.0.1:3100" },
    data: {},
  })
  expect(response.status()).toBe(200)
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toHaveCount(0)
})

test("session expiry clears the unlocked vault without user interaction", async ({
  page,
}) => {
  await page.clock.install()
  await registerAccount(page)
  await page.goto("/vault")
  await createVault(page)
  await page.getByLabel("Username", { exact: true }).fill("expiring-secret")
  await page.clock.fastForward(8 * 60 * 60 * 1000 + 1000)
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toHaveCount(0)
})

test("a late valid session response cannot reopen the vault after sign-out", async ({
  page,
}) => {
  await registerAccount(page)
  await page.goto("/vault")
  await createVault(page)
  await page.getByRole("button", { name: "Close", exact: true }).click()
  let release!: () => void
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/api/auth/session", async (route) => {
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    started()
    await gate
    await route.fulfill({ response })
  })
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await ready
  await page.getByRole("button", { name: "Sign out", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true })
  ).toBeVisible()
  const delayedResponse = page.waitForResponse("**/api/auth/session")
  release()
  await delayedResponse
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true })
  ).toHaveCount(0)
})

test("a delayed login cannot set a usable cookie after another tab signs out", async ({
  page,
  context,
}) => {
  const account = await registerAccount(page)
  await page.request.post("/api/auth/logout", {
    headers: { Origin: "http://127.0.0.1:3100" },
    data: {},
  })
  const pendingTab = await context.newPage()
  await pendingTab.goto("/sign-in")
  await expect(
    pendingTab.getByRole("heading", { name: "Sign in", exact: true })
  ).toBeVisible()
  let release!: () => void
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await pendingTab.route("**/api/auth/login", async (route) => {
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    started()
    await gate
    await route.fulfill({ response })
  })
  await signIn(pendingTab, account.email)
  await ready
  await registerAccount(page)
  await page.goto("/vault")
  await expect(
    page.getByRole("heading", { name: "Create your vault" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Sign out", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true })
  ).toBeVisible()
  const response = pendingTab.waitForResponse("**/api/auth/login")
  release()
  await response
  await expect
    .poll(async () => (await page.request.get("/api/auth/session")).status())
    .toBe(401)
  await pendingTab.reload()
  await expect(
    pendingTab.getByRole("heading", { name: "Sign in", exact: true })
  ).toBeVisible()
})

test("an account change queues a fresh check behind an older pending check", async ({
  page,
  context,
}) => {
  await registerAccount(page)
  await page.goto("/vault")
  await expect(
    page.getByRole("heading", { name: "Create your vault" })
  ).toBeVisible()
  let release!: () => void
  let started!: () => void
  let firstRequest = true
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/api/auth/session", async (route) => {
    if (!firstRequest) {
      await route.continue()
      return
    }
    firstRequest = false
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    started()
    await gate
    await route.fulfill({ response })
  })
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await ready
  const other = await context.newPage()
  const nextAccount = await registerAccount(other)
  await other.goto("/vault")
  await expect(
    other.getByRole("heading", { name: "Create your vault" })
  ).toBeVisible()
  await other.evaluate(() => {
    const channel = new BroadcastChannel("ung-password-manager:account")
    channel.postMessage("account-changed")
    channel.close()
  })
  await expect(page.getByRole("status")).toHaveText("Loading your account…")
  release()
  await expect(page.getByLabel("Signed-in account")).toHaveText(
    nextAccount.email
  )
  await expect(
    page.getByRole("heading", { name: "Create your vault" })
  ).toBeVisible()
})
