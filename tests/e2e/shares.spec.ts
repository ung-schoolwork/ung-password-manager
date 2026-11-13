import type { Browser, Page } from "@playwright/test"
import {
  accountPassword,
  approvalCode,
  openNewVault,
  registerAccount,
  unlockVault,
} from "./account-helpers"
import { expect, setTestClientIp, test } from "./fixtures"

const origin = "http://127.0.0.1:3100"

async function accountWithVault(page: Page) {
  const account = await registerAccount(page)
  await page.goto("/vault")
  await openNewVault(page)
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

async function shareWith(
  page: Page,
  label: string,
  recipientEmail: string,
  accessEnds?: string
) {
  await page.getByRole("button", { name: `Share ${label}` }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText(`Share ${label}`)
  await dialog.getByLabel("Recipient's email").fill(recipientEmail)
  if (accessEnds)
    await dialog.getByLabel("Access ends").selectOption({ label: accessEnds })
  await dialog.getByRole("button", { name: "Share", exact: true }).click()
  await expect(
    dialog.getByRole("heading", { name: "Credential shared" })
  ).toBeVisible()
  await dialog.getByRole("button", { name: "Done" }).click()
  await expect(dialog).toHaveCount(0)
}

async function openSharedWithYou(page: Page) {
  await page.goto("/vault")
  await unlockVault(page)
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(
    page.getByRole("heading", { name: "Shared with you" })
  ).toBeVisible({ timeout: 15_000 })
}

test("sharing a credential lets the recipient open it from their vault", async ({
  page,
  browser,
}) => {
  await accountWithVault(page)
  const recipient = await secondAccountWithVault(browser)

  await addCredential(page, "Shared account")
  await shareWith(page, "Shared account", recipient.account.email)

  const sharedByYou = page.getByRole("list", { name: "Shared by you" })
  await expect(sharedByYou).toContainText("Shared account")
  await expect(sharedByYou).toContainText("Active")
  await expect(sharedByYou).toContainText("No end date")

  await openSharedWithYou(recipient.page)
  const shared = recipient.page.getByRole("list", { name: "Shared with you" })
  await expect(shared).toContainText("Shared account")
  await expect(shared).toContainText("Active")
  await expect(shared).not.toContainText("share-user")

  await recipient.page
    .getByRole("button", { name: "Open Shared account" })
    .click()
  await expect(shared).toContainText("share-user")
  await expect(
    shared.getByRole("button", { name: "Copy password" })
  ).toBeVisible()
  await expect(shared).not.toContainText("shared-credential-password-123")

  await recipient.context.close()
})

test("an end date is shown to both people while access is active", async ({
  page,
  browser,
}) => {
  await accountWithVault(page)
  const recipient = await secondAccountWithVault(browser)

  await addCredential(page, "Dated account")
  await shareWith(
    page,
    "Dated account",
    recipient.account.email,
    "After 7 days"
  )

  await expect(page.getByRole("list", { name: "Shared by you" })).toContainText(
    "Access ends"
  )

  await openSharedWithYou(recipient.page)
  await expect(
    recipient.page.getByRole("list", { name: "Shared with you" })
  ).toContainText("Access ends")

  await recipient.context.close()
})

test("removing access stops the recipient from opening the credential", async ({
  page,
  browser,
}) => {
  await accountWithVault(page)
  const recipient = await secondAccountWithVault(browser)

  await addCredential(page, "Revoked account")
  await shareWith(page, "Revoked account", recipient.account.email)
  await openSharedWithYou(recipient.page)

  const sharedByYou = page.getByRole("list", { name: "Shared by you" })
  await sharedByYou
    .getByRole("button", {
      name: `Remove access to Revoked account for ${recipient.account.email}`,
    })
    .click()
  await page
    .getByRole("group", {
      name: `Confirm removing access for ${recipient.account.email}`,
    })
    .getByRole("button", { name: "Remove access" })
    .click()
  await expect(sharedByYou).toContainText("Removed")
  await expect(sharedByYou).toContainText("You removed access")

  // The recipient's page still lists it as active until it refreshes; the
  // server refuses to open it all the same.
  await recipient.page
    .getByRole("button", { name: "Open Revoked account" })
    .click()
  const shared = recipient.page.getByRole("list", { name: "Shared with you" })
  await expect(shared).toContainText(
    "Your access to this shared credential was removed."
  )
  await expect(shared).not.toContainText("share-user")

  const { incoming } = (await (
    await recipient.page.request.get("/api/shares")
  ).json()) as { incoming: { id: string; status: string }[] }
  expect(incoming[0].status).toBe("removed")
  const read = await recipient.page.request.get(`/api/shares/${incoming[0].id}`)
  expect(read.status()).toBe(410)
  expect(await read.text()).not.toContain("shared-credential-password-123")

  await recipient.page
    .getByRole("button", { name: /^Clear Revoked account/ })
    .click()
  await expect(
    recipient.page.getByRole("heading", { name: "Shared with you" })
  ).toHaveCount(0)

  await recipient.context.close()
})

test("a recipient can remove a shared credential, and the owner sees it was removed", async ({
  page,
  browser,
}) => {
  await accountWithVault(page)
  const recipient = await secondAccountWithVault(browser)

  await addCredential(page, "Declined account")
  await shareWith(page, "Declined account", recipient.account.email)
  await openSharedWithYou(recipient.page)

  await recipient.page
    .getByRole("button", { name: /^Remove Declined account/ })
    .click()
  await expect(
    recipient.page.getByRole("heading", { name: "Shared with you" })
  ).toHaveCount(0)
  await expect(recipient.page.getByText("Declined account")).toHaveCount(0)

  await page.reload()
  await unlockVault(page)
  const sharedByYou = page.getByRole("list", { name: "Shared by you" })
  await expect(sharedByYou).toContainText("Removed", { timeout: 15_000 })
  await expect(sharedByYou).toContainText("They removed it")

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

test("a signed-in device that has not been approved cannot list, create, open, or respond to shares", async ({
  page,
  browser,
}) => {
  await accountWithVault(page)
  const recipient = await secondAccountWithVault(browser)
  await addCredential(page, "Unapproved device share")
  await shareWith(page, "Unapproved device share", recipient.account.email)

  // The recipient signs in on a new browser that no approved device has let in.
  const context = await browser.newContext()
  await setTestClientIp(context)
  const unapproved = await context.newPage()
  await unapproved.goto("/sign-in")
  await unapproved
    .getByLabel("Email", { exact: true })
    .fill(recipient.account.email)
  await unapproved.getByLabel("Password", { exact: true }).fill(accountPassword)
  await unapproved.getByRole("button", { name: "Sign in", exact: true }).click()
  await approvalCode(unapproved)

  const list = await context.request.get("/api/shares")
  expect(list.status()).toBe(403)
  expect(await list.text()).not.toContain("shared-credential-password-123")

  const create = await context.request.post("/api/shares", {
    headers: { Origin: origin },
    data: {
      recipientEmail: `nobody-${crypto.randomUUID()}@example.test`,
      credential: {
        accountName: "x",
        siteOrApp: "x.test",
        username: "x",
        password: "x",
      },
    },
  })
  expect(create.status()).toBe(403)

  const pending = await recipient.page.request.get("/api/shares")
  expect(pending.status()).toBe(200)
  const { incoming: shares } = (await pending.json()) as {
    incoming: { id: string }[]
  }
  expect(shares).toHaveLength(1)

  const read = await context.request.get(`/api/shares/${shares[0].id}`)
  expect(read.status()).toBe(403)
  expect(await read.text()).not.toContain("shared-credential-password-123")

  const respond = await context.request.delete(`/api/shares/${shares[0].id}`, {
    headers: { Origin: origin },
  })
  expect(respond.status()).toBe(403)

  // The share is still waiting for the recipient's approved device.
  const after = await recipient.page.request.get("/api/shares")
  expect(
    ((await after.json()) as { incoming: { status: string }[] }).incoming
  ).toMatchObject([{ status: "active" }])

  await context.close()
  await recipient.context.close()
})

test("an unauthenticated request cannot list, create, open, or respond to shares", async ({
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

  const read = await context.request.get("/api/shares/anything")
  expect(read.status()).toBe(401)

  const respond = await context.request.delete("/api/shares/anything", {
    headers: { Origin: origin },
  })
  expect(respond.status()).toBe(401)

  await context.close()
})
