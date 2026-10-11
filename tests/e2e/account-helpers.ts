import { expect, type Page } from "@playwright/test"

export const accountPassword = "account-password-only-123"
export const vaultPassword = "vault-password-only-456"

export async function registerAccount(page: Page) {
  const email = `browser-${crypto.randomUUID()}@example.test`
  const response = await page.request.post("/api/auth/register", {
    headers: { Origin: "http://127.0.0.1:3100" },
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
