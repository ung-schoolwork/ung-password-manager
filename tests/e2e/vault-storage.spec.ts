import { expect, test } from "./fixtures"
import type { Page } from "@playwright/test"
import {
  decryptSnapshot,
  openNewVault,
  registerAccount,
  unlockVault,
} from "./account-helpers"

async function unlock(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible()
  await unlockVault(page)
}

async function fillCredential(page: Page, name: string) {
  await page.getByLabel("Account label").fill(name)
  await page.getByLabel("Website or app").fill("private.example.test")
  await page.getByLabel("Username", { exact: true }).fill(`${name}-user`)
  await page
    .getByLabel("Password", { exact: true })
    .fill("private-credential-password-123")
}

test("failed credential saves are visible and retain the draft without changing the saved vault", async ({
  page,
}) => {
  const account = await registerAccount(page)
  await page.goto("/vault")
  await openNewVault(page)
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
  const data = await decryptSnapshot(account.email, saved)
  expect(data.credentials.map((credential) => credential.accountName)).toEqual([
    "Retry account",
  ])
})

test("a stale unlocked tab reports a save conflict and cannot erase the newer credential", async ({
  page,
  context,
}) => {
  const account = await registerAccount(page)
  await page.goto("/vault")
  await openNewVault(page)
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
    (await decryptSnapshot(account.email, latest)).credentials.map(
      (credential) => credential.accountName
    )
  ).toEqual(["Newer account"])
  await other.reload()
  await unlock(other)
  await expect(other.getByText("Newer account", { exact: true })).toBeVisible()
  await expect(other.getByText("Stale account", { exact: true })).toHaveCount(0)
})
