import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import {
  accountPassword,
  openNewVault,
  registerAccount,
  signIn,
  unlockVault,
} from "./account-helpers"

/** Records what the sign-in and registration forms send to the server. */
function recordAccountRequests(page: Page) {
  const bodies: string[] = []
  page.on("request", (request) => {
    if (/\/api\/auth\/(login|register)$/.test(request.url()))
      bodies.push(request.postData() ?? "")
  })
  return bodies
}

async function saveCredential(page: Page, name: string, username: string) {
  await page.getByLabel("Account label").fill(name)
  await page.getByLabel("Website or app").fill("private.example.test")
  await page.getByLabel("Username", { exact: true }).fill(username)
  await page
    .getByLabel("Password", { exact: true })
    .fill("private-password-789")
  await page.getByRole("button", { name: "Save credential" }).click()
  await expect(page.getByText(name, { exact: true })).toBeVisible()
}

test("one password registers, signs in, and opens the vault; sign-out clears private screens", async ({
  page,
}) => {
  const sent = recordAccountRequests(page)
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
  await page.getByLabel("Password", { exact: true }).fill(accountPassword)
  await page.getByLabel("Confirm password").fill("different-password-123")
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click()
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "The passwords do not match."
  )
  await page.getByLabel("Confirm password").fill(accountPassword)
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click()
  // Registration creates the vault and opens it: no second password prompt.
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Unlock your vault" })
  ).toHaveCount(0)
  await saveCredential(page, "Private account", "private-user")
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

  await page.getByLabel("Email", { exact: true }).fill(email)
  await page
    .getByLabel("Password", { exact: true })
    .fill("wrong-account-password")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "Invalid credentials"
  )
  await signIn(page, email)
  // Signing in opens the vault directly.
  await expect(page.getByText("private-user", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Unlock your vault" })
  ).toHaveCount(0)

  // The server only ever saw a derived key, never the password.
  expect(sent).toHaveLength(3)
  for (const body of sent) {
    const parsed = JSON.parse(body)
    expect(parsed.authKey).toMatch(/^[0-9a-f]{64}$/)
    expect(parsed).not.toHaveProperty("password")
    expect(body).not.toContain(accountPassword)
    expect(body).not.toContain("wrong-account-password")
  }
  expect(JSON.parse(sent[0]).wrappedVaultKey).toBeTruthy()
  expect(JSON.parse(sent[2]).authKey).toBe(JSON.parse(sent[0]).authKey)
  expect(JSON.parse(sent[1]).authKey).not.toBe(JSON.parse(sent[0]).authKey)
  const stored = await (await page.request.get("/api/vault")).text()
  expect(stored).not.toContain(accountPassword)
  expect(stored).not.toContain("private-user")

  // A reload forgets the key; the same password unlocks the vault again.
  await page.reload()
  await expect(page.getByText("private-user", { exact: true })).toHaveCount(0)
  await expect(
    page.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible()
  await page
    .getByLabel("Password", { exact: true })
    .fill("wrong-account-password")
  await page.getByRole("button", { name: "Unlock vault" }).click()
  await expect(page.locator("form").getByRole("alert")).toBeVisible()
  await unlockVault(page)
  await expect(page.getByText("private-user", { exact: true })).toBeVisible()
})

test("isolates accounts and ignores a pre-account local vault", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "ung-password-manager:vault:v1",
      "legacy-kept-untouched"
    )
  )
  await registerAccount(page)
  await page.goto("/vault")
  await openNewVault(page)
  await saveCredential(page, "First account", "first-user")
  const firstVault = await (await page.request.get("/api/vault")).json()
  expect(firstVault.envelope).toBeTruthy()
  await page.getByRole("button", { name: "Sign out", exact: true }).click()
  await expect
    .poll(async () => (await page.request.get("/api/auth/session")).status())
    .toBe(401)
  await registerAccount(page)
  await page.reload()
  await openNewVault(page)
  await expect(page.getByText("first-user", { exact: true })).toHaveCount(0)
  expect(
    await page.evaluate(() =>
      localStorage.getItem("ung-password-manager:vault:v1")
    )
  ).toBe("legacy-kept-untouched")
  const otherVault = await page.request.get("/api/vault")
  expect(otherVault.status()).toBe(200)
  const other = await otherVault.json()
  expect(other).toEqual({
    wrappedVaultKey: expect.any(Object),
    envelope: null,
    revision: null,
  })
  expect(other.wrappedVaultKey).not.toEqual(firstVault.wrappedVaultKey)
})

test("sign-out in another tab removes unlocked credentials and forms", async ({
  page,
  context,
}) => {
  await registerAccount(page)
  await page.goto("/vault")
  await openNewVault(page)
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
  await openNewVault(page)
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
  await openNewVault(page)
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
  await openNewVault(page)
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
  await openNewVault(page)
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

for (const delayedNotifications of [false, true]) {
  test(`a delayed login cannot undo cross-tab sign-out${delayedNotifications ? " without Web Locks or timely notifications" : ""}`, async ({
    page,
    context,
  }) => {
    const account = await registerAccount(page)
    await page.request.post("/api/auth/logout", {
      headers: { Origin: "http://127.0.0.1:3100" },
      data: {},
    })
    const pendingTab = await context.newPage()
    if (delayedNotifications) {
      await pendingTab.addInitScript(() => {
        Object.defineProperty(navigator, "locks", { value: undefined })
        Object.defineProperty(window, "BroadcastChannel", { value: undefined })
        // Model a tab whose queued cross-tab notifications have not been delivered.
        window.addEventListener("storage", (event) =>
          event.stopImmediatePropagation()
        )
      })
    }
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
      page.getByRole("heading", { name: "Unlock your vault" })
    ).toBeVisible()
    await page.getByRole("button", { name: "Sign out", exact: true }).click()
    await expect(
      page.getByRole("heading", { name: "Sign in", exact: true })
    ).toBeVisible()
    if (delayedNotifications) {
      await expect
        .poll(() =>
          page.evaluate(() =>
            localStorage.getItem("ung-password-manager:pending-sign-out")
          )
        )
        .toBeNull()
      expect((await page.request.get("/api/auth/session")).status()).toBe(401)
    }
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
}

test("an account change queues a fresh check behind an older pending check", async ({
  page,
  context,
}) => {
  await registerAccount(page)
  await page.goto("/vault")
  await expect(
    page.getByRole("heading", { name: "Unlock your vault" })
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
    other.getByRole("heading", { name: "Unlock your vault" })
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
    page.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible()
})
