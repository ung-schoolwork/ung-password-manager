import { expect, type Page } from "@playwright/test"
import { setTestClientIp } from "./fixtures"

export const accountPassword = "account-password-only-123"
export const vaultPassword = "vault-password-only-456"

export async function registerAccount(page: Page) {
  const clientIp = await setTestClientIp(page.context())
  const email = `browser-${crypto.randomUUID()}@example.test`
  const response = await page.request.post("/api/auth/register", {
    headers: {
      Origin: "http://127.0.0.1:3100",
      "x-e2e-client-ip": clientIp,
    },
    data: { email, password: accountPassword },
  })
  expect(response.status()).toBe(201)
  const session = (await response.json()) as {
    user: { id: string; email: string }
  }
  return session.user
}

export async function createVault(page: Page) {
  await page.getByLabel("Vault password", { exact: true }).fill(vaultPassword)
  await page.getByLabel("Confirm vault password").fill(vaultPassword)
  await page.getByRole("button", { name: "Create encrypted vault" }).click()
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toBeVisible()
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
