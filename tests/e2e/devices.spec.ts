import type { Browser, BrowserContext, Page } from "@playwright/test"
import {
  accountPassword,
  approvalCode,
  approve,
  createVault,
  registerAccount,
  vaultPassword,
} from "./account-helpers"
import { expect, setTestClientIp, test } from "./fixtures"

const origin = "http://127.0.0.1:3100"

async function firstDevice(page: Page) {
  const account = await registerAccount(page)
  await page.goto("/vault")
  await createVault(page)
  await page.keyboard.press("Escape")
  return account
}

async function secondDevice(browser: Browser, email: string) {
  const context = await browser.newContext()
  await setTestClientIp(context)
  const page = await context.newPage()
  await page.goto("/sign-in")
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page
    .getByLabel("Account password", { exact: true })
    .fill(accountPassword)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  return { context, page }
}

async function unlock(page: Page) {
  await page.getByLabel("Vault password", { exact: true }).fill(vaultPassword)
  await page.getByRole("button", { name: "Unlock vault", exact: true }).click()
  // An empty vault opens the add dialog; close it to reach the vault itself.
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible()
}

async function checkNow(page: Page) {
  // Returning to the tab asks for the latest vault right away.
  await page.bringToFront()
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange"))
  )
}

async function close(context: BrowserContext) {
  await context.close()
}

test("a new device cannot read the vault until an approved device enters its code", async ({
  page,
  browser,
}) => {
  const account = await firstDevice(page)
  const second = await secondDevice(browser, account.email)
  const code = await approvalCode(second.page)

  const blocked = await second.context.request.get("/api/vault")
  expect(blocked.status()).toBe(403)
  const revision = await second.context.request.get("/api/vault/revision")
  expect(revision.status()).toBe(403)
  const blockedWrite = await second.context.request.put("/api/vault", {
    headers: { Origin: origin },
    data: {},
  })
  expect(blockedWrite.status()).toBe(403)

  await approve(page, code)
  await expect(
    page.getByRole("status").filter({ hasText: "can now open" })
  ).toBeVisible()
  await expect(
    second.page.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible({ timeout: 15_000 })
  const allowed = await second.context.request.get("/api/vault")
  expect(allowed.status()).toBe(200)
  await close(second.context)
})

test("codes are eight digits, belong to one account and cannot be guessed freely", async ({
  page,
  browser,
}) => {
  const account = await firstDevice(page)
  const second = await secondDevice(browser, account.email)
  await approvalCode(second.page)

  const short = await page.request.post("/api/devices/approve", {
    headers: { Origin: origin },
    data: { code: "1234567" },
  })
  expect(short.status()).toBe(400)
  const letters = await page.request.post("/api/devices/approve", {
    headers: { Origin: origin },
    data: { code: "abcd1234" },
  })
  expect(letters.status()).toBe(400)
  const forged = await page.request.post("/api/devices/approve", {
    headers: { Origin: "http://attacker.test" },
    data: { code: "12345678" },
  })
  expect(forged.status()).toBe(403)

  // A device that is not approved cannot approve itself or anyone else.
  const self = await second.context.request.post("/api/devices/approve", {
    headers: { Origin: origin },
    data: { code: "12345678" },
  })
  expect(self.status()).toBe(403)

  // Another account's approved device cannot use this account's code.
  const stranger = await browser.newContext()
  await setTestClientIp(stranger)
  const strangerPage = await stranger.newPage()
  await registerAccount(strangerPage)
  const code = await approvalCode(second.page)
  const crossed = await stranger.request.post("/api/devices/approve", {
    headers: { Origin: origin },
    data: { code },
  })
  expect(crossed.status()).toBe(404)
  await close(stranger)
  await close(second.context)
})

test("a change on one approved device appears on another", async ({
  page,
  browser,
}) => {
  const account = await firstDevice(page)
  const second = await secondDevice(browser, account.email)
  await approve(page, await approvalCode(second.page))
  await expect(
    second.page.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible({ timeout: 15_000 })
  await unlock(second.page)

  // Close the account menu that is still open from approving the device.
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Add credential" }).first().click()
  await page.getByLabel("Account label").fill("Synced account")
  await page.getByLabel("Website or app").fill("sync.example.test")
  await page.getByLabel("Username", { exact: true }).fill("sync-user")
  await page
    .getByLabel("Password", { exact: true })
    .fill("synced-credential-password-123")
  await page.getByRole("button", { name: "Save credential" }).click()
  await expect(page.getByText("Synced account")).toBeVisible()

  await expect(async () => {
    await checkNow(second.page)
    await expect(second.page.getByText("Synced account")).toBeVisible({
      timeout: 1_000,
    })
  }).toPass({ timeout: 20_000 })
  await close(second.context)
})

test("saving an edit after another device changed the credential reports a conflict", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000)

  const account = await firstDevice(page)
  const second = await secondDevice(browser, account.email)
  await approve(page, await approvalCode(second.page))
  await expect(
    second.page.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible({ timeout: 15_000 })
  await unlock(second.page)

  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Add credential" }).first().click()
  await page.getByLabel("Account label").fill("Shared login")
  await page.getByLabel("Website or app").fill("shared.example.test")
  await page.getByLabel("Username", { exact: true }).fill("shared-user")
  await page
    .getByLabel("Password", { exact: true })
    .fill("original-shared-password-123")
  await page.getByRole("button", { name: "Save credential" }).click()
  await expect(page.getByText("Shared login")).toBeVisible()
  await expect(async () => {
    await checkNow(second.page)
    await expect(second.page.getByText("Shared login")).toBeVisible({
      timeout: 1_000,
    })
  }).toPass({ timeout: 20_000 })

  // The second device starts editing from the original version.
  await second.page.getByRole("button", { name: "Edit Shared login" }).click()
  const staleDialog = second.page.getByRole("dialog", {
    name: "Edit credential",
  })
  await expect(staleDialog).toBeVisible()

  // Meanwhile the first device changes the password and saves.
  await page.getByRole("button", { name: "Edit Shared login" }).click()
  const dialog = page.getByRole("dialog", { name: "Edit credential" })
  await dialog
    .getByLabel("Password", { exact: true })
    .fill("changed-on-first-device-456")
  await dialog.getByRole("button", { name: "Save changes" }).click()
  await expect(dialog).toHaveCount(0)

  await staleDialog
    .getByLabel("Notes (optional)")
    .fill("Edited on the second device")
  await staleDialog.getByRole("button", { name: "Save changes" }).click()
  const notice = staleDialog
    .getByRole("alert")
    .filter({ hasText: "changed on another device" })
  await expect(notice).toBeVisible()
  await expect(notice).toContainText(
    "The form now includes the other device's change to the password."
  )
  // The other device's password is filled in and this device's notes are kept.
  await expect(staleDialog.getByLabel("Password", { exact: true })).toHaveValue(
    "changed-on-first-device-456"
  )
  await expect(staleDialog.getByLabel("Notes (optional)")).toHaveValue(
    "Edited on the second device"
  )
  await staleDialog.getByRole("button", { name: "Save changes" }).click()
  await expect(staleDialog).toHaveCount(0)

  // The first device receives the second device's notes with its own password.
  await expect(async () => {
    await checkNow(page)
    await page.getByRole("button", { name: "Edit Shared login" }).click()
    const latest = page.getByRole("dialog", { name: "Edit credential" })
    try {
      await expect(latest.getByLabel("Notes (optional)")).toHaveValue(
        "Edited on the second device",
        { timeout: 1_000 }
      )
      await expect(latest.getByLabel("Password", { exact: true })).toHaveValue(
        "changed-on-first-device-456"
      )
    } finally {
      await latest.getByRole("button", { name: "Cancel" }).click()
    }
  }).toPass({ timeout: 20_000 })
  await close(second.context)
})

test("a removed device loses access and goes back to waiting for approval", async ({
  page,
  browser,
}) => {
  const account = await firstDevice(page)
  const second = await secondDevice(browser, account.email)
  await approve(page, await approvalCode(second.page))
  await expect(
    second.page.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible({ timeout: 15_000 })
  await unlock(second.page)

  // The account menu is still open from approving the device above.
  const own = page.getByRole("listitem").filter({ hasText: "This device" })
  await expect(own).toBeVisible()
  expect(await own.getByRole("button").count()).toBe(0)
  // Removing asks for confirmation, and cancelling keeps the device.
  await page.getByRole("button", { name: /^Remove / }).click()
  const confirm = page.getByRole("group", { name: /^Confirm removing / })
  await expect(confirm).toBeVisible()
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(confirm).toHaveCount(0)
  expect((await second.context.request.get("/api/vault")).status()).toBe(200)

  await page.getByRole("button", { name: /^Remove / }).click()
  await confirm
    .getByRole("button", { name: "Remove device", exact: true })
    .click()
  await expect(
    page.getByRole("status").filter({ hasText: "Device removed" })
  ).toBeVisible()
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0)

  const revoked = await second.context.request.get("/api/vault")
  expect(revoked.status()).toBe(403)
  await expect(async () => {
    await checkNow(second.page)
    await expect(
      second.page.getByRole("heading", { name: "Approve this device" })
    ).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
  await close(second.context)
})
