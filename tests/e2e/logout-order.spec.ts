import { expect, test } from "@playwright/test"
import { accountPassword, registerAccount } from "./account-helpers"

test("a late logout response does not erase a newer cross-tab login", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "locks", { value: undefined })
    Object.defineProperty(window, "BroadcastChannel", { value: undefined })
    // Model tabs whose cross-tab notifications have not arrived yet.
    window.addEventListener("storage", (event) =>
      event.stopImmediatePropagation()
    )
  })
  const account = await registerAccount(page)
  await page.goto("/vault")
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true })
  ).toBeVisible()
  const signingIn = await context.newPage()
  await signingIn.goto("/vault")
  await expect(
    signingIn.getByRole("button", { name: "Sign out", exact: true })
  ).toBeVisible()

  let release!: () => void
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/api/auth/logout", async (route) => {
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    started()
    await gate
    await route.fulfill({ response })
  })
  await page.getByRole("button", { name: "Sign out", exact: true }).click()
  await ready
  try {
    await signingIn.goto("/sign-in")
    await expect(
      signingIn.getByRole("heading", { name: "Sign in", exact: true })
    ).toBeVisible()
    await signingIn.getByLabel("Email", { exact: true }).fill(account.email)
    await signingIn
      .getByLabel("Account password", { exact: true })
      .fill(accountPassword)
    await signingIn
      .getByRole("button", { name: "Sign in", exact: true })
      .click()
    await expect(
      signingIn.getByRole("button", { name: "Sign out", exact: true })
    ).toBeVisible()
    expect((await signingIn.request.get("/api/auth/session")).status()).toBe(
      200
    )
    const finished = page.waitForResponse("**/api/auth/logout")
    release()
    await finished
    expect((await signingIn.request.get("/api/auth/session")).status()).toBe(
      200
    )
    await signingIn.reload()
    await expect(
      signingIn.getByRole("button", { name: "Sign out", exact: true })
    ).toBeVisible()
  } finally {
    release()
  }
})
