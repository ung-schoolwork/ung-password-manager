import type { Page } from "@playwright/test"

import { accountPassword, unlockVault } from "./account-helpers"
import { expect, test } from "./fixtures"

const MINUTE = 60_000

// Registers through the form so the vault opens straight away, then closes
// the add dialog an empty vault shows.
async function registerAndOpen(page: Page) {
  await page.clock.install()
  await page.goto("/register")
  await page
    .getByLabel("Email", { exact: true })
    .fill(`auto-lock-${crypto.randomUUID()}@example.test`)
  await page.getByLabel("Password", { exact: true }).fill(accountPassword)
  await page.getByLabel("Confirm password").fill(accountPassword)
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click()
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "Lock vault" })).toBeVisible()
}

function warning(page: Page) {
  return page.getByRole("alertdialog", { name: "Your vault is about to lock" })
}

function unlockHeading(page: Page) {
  return page.getByRole("heading", { name: "Unlock your vault" })
}

test("warns before locking after 15 idle minutes and can stay unlocked", async ({
  page,
}) => {
  await registerAndOpen(page)

  await page.clock.fastForward(13 * MINUTE)
  await expect(warning(page)).toHaveCount(0)

  await page.clock.fastForward(MINUTE + 1_000)
  await expect(warning(page)).toBeVisible()
  await expect(
    warning(page).getByRole("button", { name: "Stay unlocked" })
  ).toBeFocused()
  await warning(page).getByRole("button", { name: "Stay unlocked" }).click()
  await expect(warning(page)).toHaveCount(0)

  await page.clock.fastForward(14 * MINUTE + 1_000)
  await expect(warning(page)).toBeVisible()
  await page.clock.fastForward(MINUTE)
  await expect(unlockHeading(page)).toBeVisible()
  await expect(warning(page)).toHaveCount(0)
})

test("activity in one tab keeps the others open, and locking one tab locks all", async ({
  page,
  context,
}) => {
  await registerAndOpen(page)
  const other = await context.newPage()
  await other.goto("/vault")
  await unlockVault(other)
  await expect(
    other.getByRole("dialog", { name: "Add a credential" })
  ).toBeVisible()
  await other.keyboard.press("Escape")

  await page.clock.fastForward(10 * MINUTE)
  await other.keyboard.press("Shift")
  await page.clock.fastForward(10 * MINUTE)
  await expect(warning(page)).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Lock vault" })).toBeVisible()

  await other.getByRole("button", { name: "Lock vault" }).click()
  await expect(unlockHeading(other)).toBeVisible()
  await expect(unlockHeading(page)).toBeVisible()
})

test("the timeout can be changed in Settings and is remembered", async ({
  page,
}) => {
  await registerAndOpen(page)
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Settings", exact: true })
    .click()

  const choice = page.getByLabel("Lock after no activity for")
  await expect(choice).toHaveValue("15")
  await choice.selectOption({ label: "5 minutes" })
  await expect(
    page.getByRole("status").filter({ hasText: "locks after" })
  ).toHaveText("Your vault now locks after 5 minutes without activity.")

  await page.clock.fastForward(4 * MINUTE + 1_000)
  await expect(warning(page)).toBeVisible()
  await page.clock.fastForward(MINUTE)
  await expect(unlockHeading(page)).toHaveCount(0)
  // Settings stays open while the vault is locked.
  await expect(page.getByRole("button", { name: "Lock vault" })).toHaveCount(0)

  await page.reload()
  await expect(page.getByLabel("Lock after no activity for")).toHaveValue("5")
})
