import { expect, type Page } from "@playwright/test"
import {
  createWrappedVaultKey,
  decryptVault,
  deriveAccountKeys,
  unwrapVaultKey,
} from "../../lib/vault/crypto.client"
import type { WrappedVaultKey } from "../../lib/vault/types"
import { setTestClientIp } from "./fixtures"

export const accountPassword = "account-password-only-123"

/**
 * What the registration form sends for an email and `accountPassword`: keys
 * derived from them, never the password. Sign-in sends the same minus
 * `wrappedVaultKey`.
 */
export async function accountProof(email: string) {
  const { authKey, wrappingKey } = await deriveAccountKeys(
    email,
    accountPassword
  )
  return {
    email,
    authKey,
    wrappedVaultKey: await createWrappedVaultKey(wrappingKey),
  }
}

/** Registers through the API exactly as the registration form does. */
export async function registerAccount(page: Page) {
  const clientIp = await setTestClientIp(page.context())
  const email = `browser-${crypto.randomUUID()}@example.test`
  const response = await page.request.post("/api/auth/register", {
    headers: {
      Origin: "http://127.0.0.1:3100",
      "x-e2e-client-ip": clientIp,
    },
    data: await accountProof(email),
  })
  expect(response.status()).toBe(201)
  const session = (await response.json()) as {
    user: { id: string; email: string }
  }
  return session.user
}

export async function signIn(page: Page, email: string) {
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page.getByLabel("Password", { exact: true }).fill(accountPassword)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
}

/** Enters the account password on the "Unlock your vault" screen. */
export async function unlockVault(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible()
  await page.getByLabel("Password", { exact: true }).fill(accountPassword)
  await page.getByRole("button", { name: "Unlock vault" }).click()
}

/** Unlocks a new account's empty vault, which opens the add-credential dialog. */
export async function openNewVault(page: Page) {
  await unlockVault(page)
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toBeVisible()
}

/** The vault key an account's password opens, from a `/api/vault` response. */
export async function vaultKeyFor(
  email: string,
  snapshot: { wrappedVaultKey: WrappedVaultKey }
) {
  const { wrappingKey } = await deriveAccountKeys(email, accountPassword)
  return unwrapVaultKey(wrappingKey, snapshot.wrappedVaultKey)
}

/** Decrypts a `/api/vault` response with the account password. */
export async function decryptSnapshot(
  email: string,
  snapshot: Parameters<typeof vaultKeyFor>[1] & {
    envelope: Parameters<typeof decryptVault>[1]
  }
) {
  return decryptVault(await vaultKeyFor(email, snapshot), snapshot.envelope)
}

/** Reads the code a signed-in but unapproved device shows while it waits. */
export async function approvalCode(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Approve this device" })
  ).toBeVisible()
  const text = await page.getByLabel("Device approval code").innerText()
  const code = text.replace(/\s/g, "")
  expect(code).toMatch(/^\d{8}$/)
  return code
}

/** Approves a waiting device's code from an already approved device. */
export async function approve(page: Page, code: string) {
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Settings", exact: true })
    .click()
  await page.getByLabel("Add a device").fill(code)
  await page.getByRole("button", { name: "Approve device" }).click()
}
