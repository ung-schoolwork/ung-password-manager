import type { Page } from "@playwright/test"

import { expect, test } from "./fixtures"
import { registerAccount } from "./account-helpers"

const vaultPassword = "correct horse battery staple"
const credentialPassword = "OriginalDemo!123456"

// Matches NEXT_PUBLIC_CLIPBOARD_CLEAR_MS set in playwright.config.ts's
// webServer.env so this test doesn't have to wait out the real 15s delay.
const CLEAR_MS = 1500
const SAFETY_MARGIN_MS = 1000

test.beforeEach(async ({ page }) => {
  await registerAccount(page)
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
})

async function createVaultWithCredential(page: Page) {
  await page.goto("/")
  await page.getByLabel("Vault password", { exact: true }).fill(vaultPassword)
  await page.getByLabel("Confirm vault password").fill(vaultPassword)
  await page.getByRole("button", { name: "Create encrypted vault" }).click()

  await page.getByLabel("Account label").fill("University email")
  await page.getByLabel("Website or app").fill("mail.example.edu")
  await page.getByLabel("Username").fill("student@example.edu")
  await page.getByLabel("Password", { exact: true }).fill(credentialPassword)
  await page.getByRole("button", { name: "Save credential" }).click()
  await expect(
    page.getByText("University email", { exact: true })
  ).toBeVisible()
}

async function copyPassword(page: Page) {
  const savedCredential = page
    .getByRole("list", { name: "Saved credentials" })
    .getByRole("listitem")

  await savedCredential.getByRole("button", { name: "Copy password" }).click()
  await expect(savedCredential.getByRole("status")).toHaveText(
    "Password copied."
  )
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    credentialPassword
  )
}

test("clears the clipboard after the timer when the user locks the vault", async ({
  page,
}) => {
  await createVaultWithCredential(page)
  await copyPassword(page)

  await page.getByRole("button", { name: "Lock vault" }).click()
  await expect(
    page.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible()

  await page.waitForTimeout(CLEAR_MS + SAFETY_MARGIN_MS)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("")
})

test("clears the clipboard after the timer when the user signs out", async ({
  page,
}) => {
  await createVaultWithCredential(page)
  await copyPassword(page)

  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(
    page.getByRole("heading", { name: "Sign in" })
  ).toBeVisible()

  await page.waitForTimeout(CLEAR_MS + SAFETY_MARGIN_MS)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("")
})

test("clears the clipboard after the timer when the user opens Edit", async ({
  page,
}) => {
  await createVaultWithCredential(page)
  await copyPassword(page)

  await page.getByRole("button", { name: "Edit University email" }).click()
  await expect(
    page.getByRole("dialog", { name: "Edit credential" })
  ).toBeVisible()

  await page.waitForTimeout(CLEAR_MS + SAFETY_MARGIN_MS)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("")
})

test("clears the clipboard after the timer when the user leaves the vault page", async ({
  page,
}) => {
  await createVaultWithCredential(page)
  await copyPassword(page)

  await page.getByRole("link", { name: "Generator" }).click()
  await expect(page).toHaveURL(/\/generate$/)

  await page.waitForTimeout(CLEAR_MS + SAFETY_MARGIN_MS)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("")
})

test("leaves the clipboard alone if it no longer holds the copied value", async ({
  page,
}) => {
  await createVaultWithCredential(page)
  await copyPassword(page)

  // Simulate the user copying something else before our timer fires.
  await page.evaluate(() =>
    navigator.clipboard.writeText("something-else-entirely")
  )

  await page.getByRole("button", { name: "Lock vault" }).click()
  await expect(
    page.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible()

  await page.waitForTimeout(CLEAR_MS + SAFETY_MARGIN_MS)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "something-else-entirely"
  )
})
