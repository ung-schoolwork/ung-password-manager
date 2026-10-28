import type { Browser, Page } from "@playwright/test"
import {
  accountPassword,
  approvalCode,
  createVault,
  registerAccount,
} from "./account-helpers"
import { expect, setTestClientIp, test } from "./fixtures"

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

test("opens from the main navigation and the account menu", async ({
  page,
}) => {
  const account = await firstDevice(page)

  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Settings", exact: true })
    .click()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("main").getByText(account.email, { exact: true })
  ).toBeVisible()

  const deviceList = page.getByRole("list", { name: "Approved devices" })
  const own = deviceList
    .getByRole("listitem")
    .filter({ hasText: "This device" })
  await expect(own).toBeVisible()
  expect(await own.getByRole("button").count()).toBe(0)
  await expect(page.getByLabel("Add a device")).toBeVisible()

  // The account menu keeps a link to Settings.
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Vault", exact: true })
    .click()
  // An empty vault opens the add dialog; close it to reach the account menu.
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toHaveCount(0)
  await page.getByRole("button", { name: "Signed-in account" }).click()
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Settings", exact: true })
    .click()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true })
  ).toBeVisible()
})

test("settings stays available while the vault is locked", async ({ page }) => {
  await firstDevice(page)

  await page.getByRole("button", { name: "Lock vault" }).click()
  await expect(
    page.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible()

  await page.getByRole("button", { name: "Signed-in account" }).click()
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Settings", exact: true })
    .click()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true })
  ).toBeVisible()
  await expect(
    page
      .getByRole("list", { name: "Approved devices" })
      .getByRole("listitem")
      .filter({ hasText: "This device" })
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Lock vault" })).toHaveCount(0)
})

test("approves and removes another device", async ({ page, browser }) => {
  const account = await firstDevice(page)
  const second = await secondDevice(browser, account.email)
  const code = await approvalCode(second.page)

  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Settings", exact: true })
    .click()
  await page.getByLabel("Add a device").fill(code)
  await page.getByRole("button", { name: "Approve device" }).click()
  await expect(
    page.getByRole("status").filter({ hasText: "can now open" })
  ).toBeVisible()
  await expect(
    second.page.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible({ timeout: 15_000 })
  expect((await second.context.request.get("/api/vault")).status()).toBe(200)

  const deviceList = page.getByRole("list", { name: "Approved devices" })
  const own = deviceList
    .getByRole("listitem")
    .filter({ hasText: "This device" })
  expect(await own.getByRole("button").count()).toBe(0)
  const other = deviceList
    .getByRole("listitem")
    .filter({ hasNotText: "This device" })
  await expect(other).toHaveCount(1)

  // Cancelling a removal keeps the device approved.
  await other.getByRole("button", { name: /^Remove / }).click()
  const confirm = page.getByRole("group", { name: /^Confirm removing / })
  await expect(confirm).toBeVisible()
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(confirm).toHaveCount(0)
  expect((await second.context.request.get("/api/vault")).status()).toBe(200)

  await other.getByRole("button", { name: /^Remove / }).click()
  await confirm
    .getByRole("button", { name: "Remove device", exact: true })
    .click()
  await expect(
    page.getByRole("status").filter({ hasText: "Device removed" })
  ).toBeVisible()
  await expect(
    deviceList.getByRole("listitem").filter({ hasNotText: "This device" })
  ).toHaveCount(0)
  expect((await second.context.request.get("/api/vault")).status()).toBe(403)
  await second.context.close()
})
