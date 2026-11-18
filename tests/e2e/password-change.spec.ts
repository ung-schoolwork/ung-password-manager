import type { Page } from "@playwright/test"
import {
  accountPassword,
  approvalCode,
  approve,
  registerAccount,
  signIn,
  unlockVault,
} from "./account-helpers"
import { expect, setTestClientIp, test } from "./fixtures"

const newPassword = "a-new-account-password-456"

async function openSettings(page: Page) {
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Settings", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true })
  ).toBeVisible()
}

async function fillChange(
  page: Page,
  current: string,
  next: string,
  confirmation = next
) {
  await page.getByLabel("Current password", { exact: true }).fill(current)
  await page.getByLabel("New password", { exact: true }).fill(next)
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill(confirmation)
  await page.getByRole("button", { name: "Change password" }).click()
}

test("changes the password, keeps the vault readable and signs out other devices", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000)
  const account = await registerAccount(page)
  await page.goto("/vault")
  await unlockVault(page)
  await page.getByLabel("Account label").fill("Library")
  await page.getByLabel("Website or app").fill("library.example.edu")
  await page.getByLabel("Username").fill("student")
  await page.getByLabel("Password", { exact: true }).fill("LibraryDemo!123456")
  await page.getByRole("button", { name: "Save credential" }).click()
  await expect(page.getByText("library.example.edu")).toBeVisible()

  // A second approved device, signed in with the old password.
  const otherContext = await browser.newContext()
  await setTestClientIp(otherContext)
  const other = await otherContext.newPage()
  await other.goto("/sign-in")
  await signIn(other, account.email)
  await approve(page, await approvalCode(other))
  expect((await otherContext.request.get("/api/auth/session")).status()).toBe(
    200
  )

  await openSettings(page)
  await fillChange(page, accountPassword, newPassword, `${newPassword}!`)
  await expect(page.getByText("The new passwords do not match.")).toBeVisible()
  await fillChange(page, "not-my-password-123", newPassword)
  await expect(
    page.getByText("Your current password is incorrect.")
  ).toBeVisible()

  await fillChange(page, accountPassword, newPassword)
  await expect(
    page.getByRole("status").filter({ hasText: "Your password was changed." })
  ).toBeVisible({ timeout: 20_000 })
  await expect(page.getByLabel("Current password")).toHaveValue("")

  // This browser stays signed in; the other device is signed out.
  expect((await page.request.get("/api/auth/session")).status()).toBe(200)
  expect((await otherContext.request.get("/api/auth/session")).status()).toBe(
    401
  )

  // Only the new password opens the same vault.
  await page.goto("/vault")
  await expect(
    page.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible()
  await page.getByLabel("Password", { exact: true }).fill(accountPassword)
  await page.getByRole("button", { name: "Unlock vault" }).click()
  await expect(
    page.getByText("That password didn’t open your vault.", { exact: false })
  ).toBeVisible()
  await page.getByLabel("Password", { exact: true }).fill(newPassword)
  await page.getByRole("button", { name: "Unlock vault" }).click()
  await expect(page.getByText("library.example.edu")).toBeVisible()

  // The other device stays approved and signs in with the new password.
  await other.goto("/sign-in")
  await other.getByLabel("Email", { exact: true }).fill(account.email)
  await other.getByLabel("Password", { exact: true }).fill(newPassword)
  await other.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(other.getByText("library.example.edu")).toBeVisible({
    timeout: 20_000,
  })
  await otherContext.close()
})
