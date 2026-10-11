import { expect, test, type Page } from "@playwright/test"
import { encryptVault, decryptVault } from "../../lib/vault/crypto.client"
import {
  accountPassword,
  createVault,
  registerAccount,
  vaultPassword,
} from "./account-helpers"

const origin = "http://127.0.0.1:3100"

async function unlock(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible()
  await page.getByLabel("Vault password", { exact: true }).fill(vaultPassword)
  await page.getByRole("button", { name: "Unlock vault", exact: true }).click()
}

async function fillCredential(page: Page, name: string) {
  await page.getByLabel("Account label").fill(name)
  await page.getByLabel("Website or app").fill("private.example.test")
  await page.getByLabel("Username", { exact: true }).fill(`${name}-user`)
  await page
    .getByLabel("Password", { exact: true })
    .fill("private-credential-password-123")
}

function existingData() {
  const timestamp = "2026-01-01T00:00:00.000Z"
  return {
    version: 1 as const,
    credentials: [
      {
        id: crypto.randomUUID(),
        accountName: "Existing account",
        siteOrApp: "existing.example.test",
        username: "existing-user",
        password: "existing-credential-password",
        createdAt: timestamp,
        updatedAt: timestamp,
        passwordUpdatedAt: timestamp,
      },
    ],
  }
}

test("a local vault is migrated only after explicit consent and its password", async ({
  page,
  browser,
}, testInfo) => {
  const account = await registerAccount(page)
  const data = existingData()
  const envelope = await encryptVault(vaultPassword, data)
  const key = `ung-password-manager:vault:v1:account:${account.id}`
  await page.addInitScript(
    ({ key, envelope }) => {
      localStorage.setItem(key, JSON.stringify(envelope))
    },
    { key, envelope }
  )
  await page.goto("/vault")
  await expect(
    page.getByRole("heading", { name: "Create your vault" })
  ).toBeVisible()
  expect(await (await page.request.get("/api/vault")).json()).toEqual({
    envelope: null,
    revision: null,
  })
  await expect(
    page.getByRole("button", { name: "Use an existing vault", exact: true })
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Use an existing vault", exact: true })
    .click()
  await page.screenshot({
    path: testInfo.outputPath("migration.png"),
    fullPage: true,
  })
  await page
    .getByLabel("Vault password", { exact: true })
    .fill("incorrect-vault-password")
  await page
    .getByRole("button", { name: "Use this vault", exact: true })
    .click()
  await expect(page.locator("form").getByRole("alert")).toContainText(
    "incorrect"
  )
  expect(await (await page.request.get("/api/vault")).json()).toEqual({
    envelope: null,
    revision: null,
  })
  await page.getByLabel("Vault password", { exact: true }).fill(vaultPassword)
  let write: unknown
  page.on("request", (request) => {
    if (request.url().endsWith("/api/vault") && request.method() === "PUT")
      write = request.postDataJSON()
  })
  await page
    .getByRole("button", { name: "Use this vault", exact: true })
    .click()
  await expect(page.getByText("existing-user", { exact: true })).toBeVisible()
  expect(Object.keys(write as object).sort()).toEqual([
    "envelope",
    "expectedRevision",
  ])
  expect(JSON.stringify(write)).not.toContain(vaultPassword)
  expect(JSON.stringify(write)).not.toContain(data.credentials[0].password)
  const remote = await (await page.request.get("/api/vault")).json()
  expect(await decryptVault(vaultPassword, remote.envelope)).toEqual(data)
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    JSON.stringify(envelope)
  )
  const freshContext = await browser.newContext()
  try {
    const freshPage = await freshContext.newPage()
    await freshPage.goto("/sign-in")
    await freshPage.getByLabel("Email", { exact: true }).fill(account.email)
    await freshPage
      .getByLabel("Account password", { exact: true })
      .fill(accountPassword)
    await freshPage
      .getByRole("button", { name: "Sign in", exact: true })
      .click()
    await unlock(freshPage)
    await expect(
      freshPage.getByText("existing-user", { exact: true })
    ).toBeVisible()
  } finally {
    await freshContext.close()
  }
})

test("an earlier vault can be selected explicitly and a failed migration preserves both local copies", async ({
  page,
}) => {
  const account = await registerAccount(page)
  const accountData = existingData()
  accountData.credentials[0].username = "account-local-user"
  const accountEnvelope = await encryptVault(vaultPassword, accountData)
  const legacyData = existingData()
  legacyData.credentials[0].username = "earlier-user"
  const legacyEnvelope = await encryptVault(vaultPassword, legacyData)
  const accountKey = `ung-password-manager:vault:v1:account:${account.id}`
  const legacyKey = "ung-password-manager:vault:v1"
  await page.addInitScript(
    ({ accountKey, legacyKey, accountEnvelope, legacyEnvelope }) => {
      localStorage.setItem(accountKey, JSON.stringify(accountEnvelope))
      localStorage.setItem(legacyKey, JSON.stringify(legacyEnvelope))
    },
    { accountKey, legacyKey, accountEnvelope, legacyEnvelope }
  )
  await page.goto("/vault")
  await page
    .getByRole("button", { name: "Use an existing vault", exact: true })
    .click()
  await page
    .getByLabel("Existing vault", { exact: true })
    .selectOption("legacy")
  await page.getByLabel("Vault password", { exact: true }).fill(vaultPassword)
  await page.route("**/api/vault", (route) =>
    route.request().method() === "PUT"
      ? route.abort("failed")
      : route.continue()
  )
  await page
    .getByRole("button", { name: "Use this vault", exact: true })
    .click()
  await expect(page.locator("form").getByRole("alert")).toContainText(
    "could not be saved"
  )
  expect(await (await page.request.get("/api/vault")).json()).toEqual({
    envelope: null,
    revision: null,
  })
  expect(
    await page.evaluate((key) => localStorage.getItem(key), accountKey)
  ).toBe(JSON.stringify(accountEnvelope))
  expect(
    await page.evaluate((key) => localStorage.getItem(key), legacyKey)
  ).toBe(JSON.stringify(legacyEnvelope))
  await page.unroute("**/api/vault")
  await page
    .getByRole("button", { name: "Use this vault", exact: true })
    .click()
  await expect(page.getByText("earlier-user", { exact: true })).toBeVisible()
  const remote = await (await page.request.get("/api/vault")).json()
  expect(await decryptVault(vaultPassword, remote.envelope)).toEqual(legacyData)
  expect(
    await page.evaluate((key) => localStorage.getItem(key), accountKey)
  ).toBe(JSON.stringify(accountEnvelope))
  expect(
    await page.evaluate((key) => localStorage.getItem(key), legacyKey)
  ).toBe(JSON.stringify(legacyEnvelope))
})

test("migration cannot overwrite a vault created after the setup screen opened", async ({
  page,
}) => {
  await registerAccount(page)
  const local = await encryptVault(vaultPassword, existingData())
  const key = "ung-password-manager:vault:v1"
  await page.addInitScript(
    ({ key, local }) => localStorage.setItem(key, JSON.stringify(local)),
    { key, local }
  )
  await page.goto("/vault")
  await page
    .getByRole("button", { name: "Use an existing vault", exact: true })
    .click()
  const remote = await encryptVault(vaultPassword, {
    version: 1,
    credentials: [],
  })
  const created = await page.request.put("/api/vault", {
    headers: { Origin: origin },
    data: { envelope: remote, expectedRevision: null },
  })
  expect(created.status()).toBe(200)
  const { revision } = await created.json()
  await page.getByLabel("Vault password", { exact: true }).fill(vaultPassword)
  await page
    .getByRole("button", { name: "Use this vault", exact: true })
    .click()
  await expect(page.locator("form").getByRole("alert")).toContainText(
    "already exists"
  )
  expect(await (await page.request.get("/api/vault")).json()).toEqual({
    envelope: remote,
    revision,
  })
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    JSON.stringify(local)
  )
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Use an existing vault", exact: true })
  ).toHaveCount(0)
})

test("failed credential saves are visible and retain the draft without changing the saved vault", async ({
  page,
}) => {
  await registerAccount(page)
  await page.goto("/vault")
  await createVault(page)
  const before = await (await page.request.get("/api/vault")).json()
  await fillCredential(page, "Retry account")
  await page.route("**/api/vault", (route) =>
    route.request().method() === "PUT"
      ? route.abort("failed")
      : route.continue()
  )
  await page
    .getByRole("button", { name: "Save credential", exact: true })
    .click()
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "could not be saved"
  )
  await expect(page.getByLabel("Account label")).toHaveValue("Retry account")
  expect(await (await page.request.get("/api/vault")).json()).toEqual(before)
  await page.unroute("**/api/vault")
  await page
    .getByRole("button", { name: "Save credential", exact: true })
    .click()
  await expect(page.getByText("Retry account", { exact: true })).toBeVisible()
  const saved = await (await page.request.get("/api/vault")).json()
  const data = await decryptVault(vaultPassword, saved.envelope)
  expect(data.credentials.map((credential) => credential.accountName)).toEqual([
    "Retry account",
  ])
})

test("a stale unlocked tab reports a save conflict and cannot erase the newer credential", async ({
  page,
  context,
}) => {
  await registerAccount(page)
  await page.goto("/vault")
  await createVault(page)
  const other = await context.newPage()
  await other.goto("/vault")
  await unlock(other)
  await expect(
    other.getByRole("dialog", { name: "Add a credential" })
  ).toBeVisible()
  await fillCredential(page, "Newer account")
  await fillCredential(other, "Stale account")
  await page
    .getByRole("button", { name: "Save credential", exact: true })
    .click()
  await expect(page.getByText("Newer account", { exact: true })).toBeVisible()
  const latest = await (await page.request.get("/api/vault")).json()
  await other
    .getByRole("button", { name: "Save credential", exact: true })
    .click()
  await expect(other.getByRole("dialog").getByRole("alert")).toContainText(
    "Your vault changed"
  )
  await expect(other.getByLabel("Account label")).toHaveValue("Stale account")
  expect(await (await page.request.get("/api/vault")).json()).toEqual(latest)
  expect(
    (await decryptVault(vaultPassword, latest.envelope)).credentials.map(
      (credential) => credential.accountName
    )
  ).toEqual(["Newer account"])
  await other.reload()
  await unlock(other)
  await expect(other.getByText("Newer account", { exact: true })).toBeVisible()
  await expect(other.getByText("Stale account", { exact: true })).toHaveCount(0)
})
