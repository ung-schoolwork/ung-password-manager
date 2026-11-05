import { expect, test } from "./fixtures"
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
  await expect(page.locator("#account-password-confirmation-error")).toHaveText(
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

test("validates sign-in fields before sending the request", async ({
  page,
}) => {
  let loginRequests = 0
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unauthorized" }),
    })
  )
  await page.route("**/api/auth/login", (route) => {
    if (route.request().method() === "POST") loginRequests++
    return route.continue()
  })

  await page.goto("/sign-in")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  expect(loginRequests).toBe(0)

  const email = page.getByLabel("Email", { exact: true })
  const password = page.getByLabel("Account password", { exact: true })
  await expect(email).toHaveAttribute("aria-invalid", "true")
  await expect(email).toHaveAttribute("aria-describedby", "account-email-error")
  await expect(page.locator("#account-email-error")).toHaveText(
    "Enter your email address."
  )
  await expect(password).toHaveAttribute("aria-invalid", "true")
  await expect(password).toHaveAttribute(
    "aria-describedby",
    "account-password-error"
  )
  await expect(page.locator("#account-password-error")).toHaveText(
    "Enter your account password."
  )

  await email.fill("invalid-email")
  await password.fill("short")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  expect(loginRequests).toBe(0)
  await expect(page.locator("#account-email-error")).toHaveText(
    "Enter a valid email address."
  )
  await expect(page.locator("#account-password-error")).toHaveText(
    "Password must be at least 12 characters."
  )
})

test("validates registration fields accessibly before sending the request", async ({
  page,
}) => {
  let registrationRequests = 0
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unauthorized" }),
    })
  )
  await page.route("**/api/auth/register", (route) => {
    if (route.request().method() === "POST") registrationRequests++
    return route.continue()
  })

  await page.goto("/register")
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click()
  expect(registrationRequests).toBe(0)

  const email = page.getByLabel("Email", { exact: true })
  const password = page.getByLabel("Account password", { exact: true })
  const confirmation = page.getByLabel("Confirm account password")
  await expect(email).toHaveAttribute("aria-invalid", "true")
  await expect(email).toHaveAttribute("aria-describedby", "account-email-error")
  await expect(page.locator("#account-email-error")).toHaveText(
    "Enter your email address."
  )
  await expect(password).toHaveAttribute("aria-invalid", "true")
  await expect(password).toHaveAttribute(
    "aria-describedby",
    "account-password-help account-password-error"
  )
  await expect(page.locator("#account-password-error")).toHaveText(
    "Enter your account password."
  )
  await expect(confirmation).toHaveAttribute("aria-invalid", "true")
  await expect(confirmation).toHaveAttribute(
    "aria-describedby",
    "account-password-confirmation-error"
  )
  await expect(page.locator("#account-password-confirmation-error")).toHaveText(
    "Confirm your account password."
  )

  await email.fill("not-an-email")
  await password.fill("short")
  await confirmation.fill("different-short")
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click()
  expect(registrationRequests).toBe(0)
  await expect(page.locator("#account-email-error")).toHaveText(
    "Enter a valid email address."
  )
  await expect(page.locator("#account-password-error")).toHaveText(
    "Password must be at least 12 characters."
  )
  await expect(page.locator("#account-password-confirmation-error")).toHaveText(
    "The account passwords do not match."
  )
})

test("shows actionable, non-verbatim sign-in failure messages", async ({
  page,
}) => {
  let outcome:
    { status: number; body: string; retryAfter?: string } | "network" = {
    status: 401,
    body: "Invalid credentials",
  }
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unauthorized" }),
    })
  )
  await page.route("**/api/auth/login", (route) => {
    if (outcome === "network") return route.abort("failed")
    return route.fulfill({
      status: outcome.status,
      headers: outcome.retryAfter
        ? { "Retry-After": outcome.retryAfter }
        : undefined,
      contentType: "application/json",
      body: JSON.stringify({ error: outcome.body }),
    })
  })

  await page.goto("/sign-in")
  const email = page.getByLabel("Email", { exact: true })
  const password = page.getByLabel("Account password", { exact: true })
  const submit = page.getByRole("button", { name: "Sign in", exact: true })
  const alert = page.locator("form").getByRole("alert")
  const submitAttempt = async () => {
    await email.fill("user@example.test")
    await password.fill("valid-password-123")
    await submit.click()
  }

  await submitAttempt()
  await expect(alert).toHaveText(
    "Email or password is incorrect. Check your details and try again."
  )
  outcome = { status: 401, body: "Invalid credentials" }
  await submitAttempt()
  await expect(alert).toHaveText(
    "Email or password is incorrect. Check your details and try again."
  )

  outcome = { status: 403, body: "Forbidden" }
  await submitAttempt()
  await expect(alert).toHaveText(
    "This request was blocked. Refresh the page and try again."
  )
  outcome = { status: 429, body: "Too many attempts", retryAfter: "45" }
  await submitAttempt()
  await expect(alert).toHaveText(
    "Too many attempts. Wait 45 seconds before trying again."
  )
  outcome = { status: 503, body: "Service unavailable" }
  await submitAttempt()
  await expect(alert).toHaveText(
    "The server is unavailable right now. Try again in a few moments."
  )
  outcome = "network"
  await submitAttempt()
  await expect(alert).toHaveText(
    "Unable to reach the server. Check your connection and try again."
  )
})

test("shows actionable registration failures without exposing server text", async ({
  page,
}) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unauthorized" }),
    })
  )
  await page.route("**/api/auth/register", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unable to register account" }),
    })
  )

  await page.goto("/register")
  await page.getByLabel("Email", { exact: true }).fill("existing@example.test")
  await page
    .getByLabel("Account password", { exact: true })
    .fill("valid-password-123")
  await page.getByLabel("Confirm account password").fill("valid-password-123")
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click()
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "Could not create an account with these details. If you already have an account, sign in; otherwise try again."
  )
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
  const firstVault = await page.request.get("/api/vault")
  expect(firstVault.status()).toBe(200)
  expect((await firstVault.json()).envelope).toBeTruthy()
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
  const otherVault = await page.request.get("/api/vault")
  expect(otherVault.status()).toBe(200)
  expect(await otherVault.json()).toEqual({ envelope: null, revision: null })
  expect(
    await page.evaluate(
      (id) =>
        localStorage.getItem(`ung-password-manager:vault:v1:account:${id}`),
      first.id
    )
  ).toBeNull()
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
      page.getByRole("heading", { name: "Create your vault" })
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
