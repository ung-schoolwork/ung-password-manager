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
  await expect(page.getByRole("list", { name: "Shared with you" })).toBeVisible(
    { timeout: 15_000 }
  )
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
    recipient.page.getByText("Nothing has been shared with you yet.")
  ).toBeVisible()

  await recipient.context.close()
})

test("deleting a shared credential ends its shares", async ({
  page,
  browser,
}) => {
  await accountWithVault(page)
  const recipient = await secondAccountWithVault(browser)

  await addCredential(page, "Deleted account")
  await shareWith(page, "Deleted account", recipient.account.email)
  await openSharedWithYou(recipient.page)

  await page.getByRole("button", { name: "Edit Deleted account" }).click()
  const dialog = page.getByRole("dialog", { name: "Edit credential" })
  await dialog.getByRole("button", { name: "Delete credential" }).click()
  await expect(
    dialog.getByText(
      "Delete Deleted account? This can’t be undone. People you shared this with will lose access."
    )
  ).toBeVisible()
  await dialog.getByRole("button", { name: "Delete", exact: true }).click()
  await expect(dialog).toBeHidden()

  const sharedByYou = page.getByRole("list", { name: "Shared by you" })
  await expect(sharedByYou).toContainText("Removed")
  await expect(sharedByYou).toContainText("You removed access")

  await recipient.page
    .getByRole("button", { name: "Open Deleted account" })
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

  await recipient.context.close()
})

test("deleting a credential that was never shared does not mention sharing", async ({
  page,
}) => {
  await accountWithVault(page)
  await addCredential(page, "Private account")

  await page.getByRole("button", { name: "Edit Private account" }).click()
  const dialog = page.getByRole("dialog", { name: "Edit credential" })
  // Wait for the share check to answer before looking for the sentence.
  const checked = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/shares" &&
      response.request().method() === "GET"
  )
  await dialog.getByRole("button", { name: "Delete credential" }).click()
  await checked
  const question = dialog.getByText(
    "Delete Private account? This can’t be undone."
  )
  await expect(question).toBeVisible()
  await expect(question).not.toContainText("lose access")
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
    recipient.page.getByText("Nothing has been shared with you yet.")
  ).toBeVisible()
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

test("empty lists say that nothing has been shared yet", async ({ page }) => {
  await accountWithVault(page)

  await expect(
    page.getByRole("heading", { name: "Shared with you" })
  ).toBeVisible({ timeout: 15_000 })
  await expect(
    page.getByText("Nothing has been shared with you yet.")
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Shared by you" })
  ).toBeVisible()
  await expect(
    page.getByText("You haven't shared any credentials yet.")
  ).toBeVisible()
})

test.describe("on a narrow phone", () => {
  const phone = { width: 360, height: 740 }
  test.use({ viewport: phone })

  test("the end date of a share is fully visible", async ({
    page,
    browser,
  }) => {
    await accountWithVault(page)
    const context = await browser.newContext({ viewport: phone })
    await setTestClientIp(context)
    const recipientPage = await context.newPage()
    const recipient = await accountWithVault(recipientPage)

    await addCredential(page, "Phone account")
    await shareWith(page, "Phone account", recipient.email, "After 7 days")

    await openSharedWithYou(recipientPage)
    const endDate = recipientPage
      .getByRole("list", { name: "Shared with you" })
      .getByText(/Access ends/)
    await expect(endDate).toBeVisible()

    // Nothing is cut off: the text fits its box, and the box fits the screen.
    expect(
      await endDate.evaluate(
        (element) => element.scrollWidth <= element.clientWidth
      )
    ).toBe(true)
    const box = await endDate.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x + box!.width).toBeLessThanOrEqual(phone.width)

    await context.close()
  })
})

test("the empty message waits until the shares have loaded", async ({
  page,
}) => {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/api/shares", async (route) => {
    if (route.request().method() !== "GET") return route.continue()
    await gate
    return route.continue()
  })

  await accountWithVault(page)
  await expect(
    page.getByRole("button", { name: "Add credential" }).first()
  ).toBeVisible()
  await expect(
    page.getByText("Nothing has been shared with you yet.")
  ).toHaveCount(0)

  release()
  await expect(
    page.getByText("Nothing has been shared with you yet.")
  ).toBeVisible({ timeout: 15_000 })
})
