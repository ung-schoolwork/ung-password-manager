import type { Browser, Page } from "@playwright/test"
import { createVault, registerAccount, unlockVault } from "./account-helpers"
import { expect, setTestClientIp, test } from "./fixtures"

const origin = "http://127.0.0.1:3100"

async function accountWithVault(page: Page) {
  const account = await registerAccount(page)
  await page.goto("/vault")
  await createVault(page)
  await page.keyboard.press("Escape")
  return account
}

async function secondAccountWithVault(browser: Browser) {
  const context = await browser.newContext()
  await setTestClientIp(context)
  const page = await context.newPage()
  const account = await accountWithVault(page)
  return { context, page, account }
}

async function addCredential(page: Page, label: string) {
  await page.getByRole("button", { name: "Add credential" }).first().click()
  await page.getByLabel("Account label").fill(label)
  await page.getByLabel("Website or app").fill("share.example.test")
  await page.getByLabel("Username", { exact: true }).fill("share-user")
  await page
    .getByLabel("Password", { exact: true })
    .fill("shared-credential-password-123")
  await page.getByRole("button", { name: "Save credential" }).click()
  await expect(page.getByText(label)).toBeVisible()
}

async function shareWith(page: Page, label: string, recipientEmail: string) {
  await page.getByRole("button", { name: `Share ${label}` }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText(`Share ${label}`)
  await dialog.getByLabel("Recipient's email").fill(recipientEmail)
  await dialog.getByRole("button", { name: "Share", exact: true }).click()
  await expect(dialog.getByRole("heading", { name: "Credential shared" })).toBeVisible()
  await dialog.getByRole("button", { name: "Done" }).click()
  await expect(dialog).toHaveCount(0)
}

test("sharing a credential delivers it to the recipient, who can accept it into their own vault", async ({
  page,
  browser,
}) => {
  await accountWithVault(page)
  const recipient = await secondAccountWithVault(browser)

  await addCredential(page, "Shared account")
  await shareWith(page, "Shared account", recipient.account.email)

  await recipient.page.goto("/vault")
  await unlockVault(recipient.page)
  await expect(
    recipient.page.getByRole("dialog", { name: "Add a credential" })
  ).toBeVisible()
  await recipient.page.keyboard.press("Escape")
  await expect(
    recipient.page.getByRole("heading", { name: "Shared with you" })
  ).toBeVisible({ timeout: 15_000 })
  await expect(recipient.page.getByText("Shared account")).toBeVisible()

  await recipient.page.getByRole("button", { name: "Accept" }).click()
  await expect(
    recipient.page.getByRole("heading", { name: "Shared with you" })
  ).toHaveCount(0)
  await expect(
    recipient.page
      .getByRole("list", { name: "Saved credentials" })
      .getByText("Shared account")
  ).toBeVisible()

  await recipient.context.close()
})

test("declining a shared credential removes it without adding it to the recipient's vault", async ({
  page,
  browser,
}) => {
  await accountWithVault(page)
  const recipient = await secondAccountWithVault(browser)

  await addCredential(page, "Declined account")
  await shareWith(page, "Declined account", recipient.account.email)

  await recipient.page.goto("/vault")
  await unlockVault(recipient.page)
  await expect(
    recipient.page.getByRole("dialog", { name: "Add a credential" })
  ).toBeVisible()
  await recipient.page.keyboard.press("Escape")
  await expect(
    recipient.page.getByRole("heading", { name: "Shared with you" })
  ).toBeVisible({ timeout: 15_000 })

  await recipient.page.getByRole("button", { name: "Decline" }).click()
  await expect(
    recipient.page.getByRole("heading", { name: "Shared with you" })
  ).toHaveCount(0)
  await expect(recipient.page.getByText("Declined account")).toHaveCount(0)

  await recipient.context.close()
})

test("the API rejects sharing a credential with yourself or with an unknown account", async ({
  page,
}) => {
  await accountWithVault(page)
  const account = await registerAccount(page)

  const credential = {
    accountName: "API share test",
    siteOrApp: "api.example.test",
    username: "api-user",
    password: "api-password-123",
  }

  const self = await page.request.post("/api/shares", {
    headers: { Origin: origin },
    data: { recipientEmail: account.email, credential },
  })
  expect(self.status()).toBe(400)

  const missing = await page.request.post("/api/shares", {
    headers: { Origin: origin },
    data: {
      recipientEmail: `nobody-${crypto.randomUUID()}@example.test`,
      credential,
    },
  })
  expect(missing.status()).toBe(404)
})

test("an unauthenticated request cannot list, create, or respond to shares", async ({
  browser,
}) => {
  const context = await browser.newContext()
  await setTestClientIp(context)

  const list = await context.request.get("/api/shares")
  expect(list.status()).toBe(401)

  const create = await context.request.post("/api/shares", {
    headers: { Origin: origin },
    data: {
      recipientEmail: "nobody@example.test",
      credential: {
        accountName: "x",
        siteOrApp: "x.test",
        username: "x",
        password: "x",
      },
    },
  })
  expect(create.status()).toBe(401)

  const respond = await context.request.delete("/api/shares/anything", {
    headers: { Origin: origin },
  })
  expect(respond.status()).toBe(401)

  await context.close()
})