import type { Page } from "@playwright/test"

import { expect, test } from "./fixtures"
import { registerAccount } from "./account-helpers"
import { CLIPBOARD_CLEAR_MS } from "./clipboard-clear-timing"

const vaultPassword = "correct horse battery staple"
const credentialPassword = "OriginalDemo!123456"

// Shared with playwright.config.ts through clipboard-clear-timing.ts, so the
// delay the app runs with and the deadline the tests wait for cannot drift.
const SAFETY_MARGIN_MS = 1000

// The second copy in the stale-timer test lands just past this share of the
// delay, leaving the first deadline and the second one on either side of the
// assertion.
const SECOND_COPY_FRACTION = 0.65
const FIRST_DEADLINE_MARGIN_MS = 400

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

function readClipboard(page: Page) {
  return page.evaluate(() => navigator.clipboard.readText())
}

async function copyPassword(page: Page) {
  const savedCredential = page
    .getByRole("list", { name: "Saved credentials" })
    .getByRole("listitem")

  await savedCredential.getByRole("button", { name: "Copy password" }).click()
  await expect(savedCredential.getByRole("status")).toHaveText(
    "Password copied."
  )
  expect(await readClipboard(page)).toBe(credentialPassword)
}

async function waitUntil(page: Page, timestamp: number) {
  const remaining = timestamp - Date.now()
  if (remaining > 0) await page.waitForTimeout(remaining)
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

  await expect
    .poll(() => readClipboard(page), {
      timeout: CLIPBOARD_CLEAR_MS + SAFETY_MARGIN_MS * 2,
    })
    .toBe("")
})

test("clears the clipboard after the timer when the user signs out", async ({
  page,
}) => {
  await createVaultWithCredential(page)
  await copyPassword(page)

  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()

  await expect
    .poll(() => readClipboard(page), {
      timeout: CLIPBOARD_CLEAR_MS + SAFETY_MARGIN_MS * 2,
    })
    .toBe("")
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

  await expect
    .poll(() => readClipboard(page), {
      timeout: CLIPBOARD_CLEAR_MS + SAFETY_MARGIN_MS * 2,
    })
    .toBe("")
})

test("clears the clipboard after the timer when the user leaves the vault page", async ({
  page,
}) => {
  await createVaultWithCredential(page)
  await copyPassword(page)

  await page.getByRole("link", { name: "Generator" }).click()
  await expect(page).toHaveURL(/\/generate$/)

  await expect
    .poll(() => readClipboard(page), {
      timeout: CLIPBOARD_CLEAR_MS + SAFETY_MARGIN_MS * 2,
    })
    .toBe("")
})

test("clears the clipboard on the second deadline when the same password is copied again", async ({
  page,
}) => {
  await createVaultWithCredential(page)
  await copyPassword(page)
  const firstCopiedAt = Date.now()

  // Leave the copy buttons the way the ticket's Edit flow does, then copy the
  // same password from the freshly mounted instance.
  await page.getByRole("button", { name: "Edit University email" }).click()
  await expect(
    page.getByRole("dialog", { name: "Edit credential" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Cancel" }).click()
  await expect(
    page.getByRole("dialog", { name: "Edit credential" })
  ).toBeHidden()

  await waitUntil(
    page,
    firstCopiedAt + CLIPBOARD_CLEAR_MS * SECOND_COPY_FRACTION
  )
  await copyPassword(page)

  // Past the first timer's deadline, before the second one is due.
  await waitUntil(
    page,
    firstCopiedAt + CLIPBOARD_CLEAR_MS + FIRST_DEADLINE_MARGIN_MS
  )
  expect(await readClipboard(page)).toBe(credentialPassword)

  await expect
    .poll(() => readClipboard(page), {
      timeout: CLIPBOARD_CLEAR_MS + SAFETY_MARGIN_MS,
    })
    .toBe("")
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

  await page.waitForTimeout(CLIPBOARD_CLEAR_MS + SAFETY_MARGIN_MS)
  expect(await readClipboard(page)).toBe("something-else-entirely")
})
