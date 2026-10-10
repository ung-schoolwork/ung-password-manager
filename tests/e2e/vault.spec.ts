import { mkdir } from "node:fs/promises"

import { expect, test } from "@playwright/test"
import { registerAccount } from "./account-helpers"

const vaultPassword = "correct horse battery staple"

test.beforeEach(async ({ page }) => {
  await registerAccount(page)
})

test("creates, validates, saves, encrypts, reloads, and unlocks a vault", async ({
  page,
  isMobile,
}, testInfo) => {
  await page.goto("/")

  await expect(
    page.getByRole("heading", { name: "Create your vault" })
  ).toBeVisible()

  await page.getByLabel("Vault password", { exact: true }).fill(vaultPassword)
  await page.getByLabel("Confirm vault password").fill(vaultPassword)
  await page.getByRole("button", { name: "Create encrypted vault" }).click()

  await expect(page).toHaveURL(/\/vault$/)
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toBeVisible()

  await page.getByRole("button", { name: "Save credential" }).click()
  await expect(page.getByText("Enter an account label.")).toBeVisible()
  await expect(page.getByText("Enter a website or app.")).toBeVisible()
  await expect(page.getByText("Enter a username.")).toBeVisible()
  await expect(page.getByText("Enter a password.")).toBeVisible()

  await page.getByLabel("Account label").fill("University email")
  await page.getByLabel("Website or app").fill("mail.example.edu")
  await page.getByLabel("Username").fill("student@example.edu")
  const preview = page.getByLabel("Generated password preview")
  const initialPreview = await preview.textContent()

  await page.getByLabel("Length").fill("24")
  await expect(preview).not.toHaveText(initialPreview ?? "")
  await expect(preview).toHaveText(/^.{24}$/)

  const symbols = page.getByRole("checkbox", { name: "Symbols" })
  await symbols.uncheck()
  await expect(preview).toHaveText(/^[A-Za-z0-9]{24}$/)
  await symbols.check()

  await page
    .getByLabel("Notes (optional)")
    .fill("Recovery codes are in the shared drive.")
  await page.getByRole("button", { name: "Use this password" }).click()

  const generatedPassword = await page
    .getByLabel("Password", { exact: true })
    .inputValue()
  expect(generatedPassword).toHaveLength(24)
  expect(generatedPassword).toMatch(/[a-z]/)
  expect(generatedPassword).toMatch(/[A-Z]/)
  expect(generatedPassword).toMatch(/[0-9]/)

  await page.getByRole("button", { name: "Save credential" }).click()

  await expect(
    page.getByText("University email", { exact: true })
  ).toBeVisible()
  await expect(page.getByText("student@example.edu")).toBeVisible()
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toBeHidden()
  await expect(
    page.getByRole("link", { name: "Vault", exact: true })
  ).toHaveAttribute("aria-current", "page")
  await expect(page.getByText("1 saved credential.")).toBeVisible()
  await expect(
    page.getByText("Recovery codes are in the shared drive.")
  ).toBeVisible({ visible: !isMobile })

  const identity = await (await page.request.get("/api/auth/session")).json()
  const persistedVault = await page.evaluate(
    (id) => localStorage.getItem(`ung-password-manager:vault:v1:account:${id}`),
    identity.user.id
  )
  expect(persistedVault).toBeTruthy()
  expect(persistedVault).not.toContain("University email")
  expect(persistedVault).not.toContain("mail.example.edu")
  expect(persistedVault).not.toContain("student@example.edu")
  expect(persistedVault).not.toContain(generatedPassword)

  await mkdir("artifacts/visual", { recursive: true })
  await page.screenshot({
    path: `artifacts/visual/vault-${testInfo.project.name}.png`,
    fullPage: true,
  })

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  const savedCredential = page
    .getByRole("list", { name: "Saved credentials" })
    .getByRole("listitem")

  await savedCredential.getByRole("button", { name: "Copy username" }).click()
  await expect(savedCredential.getByRole("status")).toHaveText(
    "Username copied."
  )
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "student@example.edu"
  )

  await savedCredential.getByRole("button", { name: "Copy password" }).click()
  await expect(savedCredential.getByRole("status")).toHaveText(
    "Password copied."
  )
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    generatedPassword
  )

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("Clipboard denied")) },
    })
  })
  await savedCredential.getByRole("button", { name: "Copy username" }).click()
  await expect(savedCredential.getByRole("status")).toHaveText(
    "Could not copy. Check your browser's clipboard permission."
  )

  await page.reload()
  await expect(
    page.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible()
  await page.getByLabel("Vault password").fill(vaultPassword)
  await page.getByRole("button", { name: "Unlock vault" }).click()

  await expect(
    page.getByText("University email", { exact: true })
  ).toBeVisible()
})

test("edits a saved credential, cancels safely, and keeps changes after unlocking", async ({
  page,
}) => {
  await page.goto("/")
  await page.getByLabel("Vault password", { exact: true }).fill(vaultPassword)
  await page.getByLabel("Confirm vault password").fill(vaultPassword)
  await page.getByRole("button", { name: "Create encrypted vault" }).click()

  await page.getByLabel("Account label").fill("University email")
  await page.getByLabel("Website or app").fill("mail.example.edu")
  await page.getByLabel("Username").fill("student@example.edu")
  await page.getByLabel("Password", { exact: true }).fill("OriginalDemo!123456")
  await page
    .getByLabel("Notes (optional)")
    .fill("Original recovery details.")
  await page.getByRole("button", { name: "Save credential" }).click()

  await page.getByRole("button", { name: "Edit University email" }).click()
  await expect(
    page.getByRole("dialog", { name: "Edit credential" })
  ).toBeVisible()
  await expect(page.getByLabel("Account label")).toHaveValue("University email")
  await expect(page.getByLabel("Website or app")).toHaveValue(
    "mail.example.edu"
  )
  await expect(page.getByLabel("Username")).toHaveValue("student@example.edu")
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    "OriginalDemo!123456"
  )
  await expect(page.getByLabel("Notes (optional)")).toHaveValue(
    "Original recovery details."
  )

  await page.getByLabel("Account label").fill("Changed but canceled")
  await page.getByLabel("Risk level").selectOption("high")
  await page.getByRole("button", { name: "Cancel" }).click()
  await expect(
    page.getByRole("dialog", { name: "Edit credential" })
  ).toBeHidden()
  await expect(page.getByText("University email", { exact: true })).toBeVisible()
  await expect(
    page.getByText("Changed but canceled", { exact: true })
  ).toBeHidden()

  await page.getByRole("button", { name: "Edit University email" }).click()
  await expect(page.getByLabel("Account label")).toHaveValue("University email")
  await expect(page.getByLabel("Risk level")).toHaveValue("low")
  await page.getByLabel("Account label").fill("Updated university account")
  await page.getByLabel("Website or app").fill("accounts.example.edu")
  await page.getByLabel("Username").fill("updated-student@example.edu")
  await page.getByLabel("Password", { exact: true }).fill("UpdatedDemo!654321")
  await page.getByLabel("Notes (optional)").fill("Updated recovery details.")
  await page.getByLabel("Risk level").selectOption("high")
  await page.getByRole("button", { name: "Save changes" }).click()

  await expect(
    page.getByText("Updated university account", { exact: true })
  ).toBeVisible()
  await expect(page.getByText("accounts.example.edu")).toBeVisible()
  await expect(page.getByText("updated-student@example.edu")).toBeVisible()
  await expect(page.getByText("Updated recovery details.")).toBeVisible()

  await page.reload()
  await expect(
    page.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible()
  await page.getByLabel("Vault password").fill(vaultPassword)
  await page.getByRole("button", { name: "Unlock vault" }).click()
  await expect(
    page.getByText("Updated university account", { exact: true })
  ).toBeVisible()

  await page
    .getByRole("button", { name: "Edit Updated university account" })
    .click()
  await expect(page.getByLabel("Account label")).toHaveValue(
    "Updated university account"
  )
  await expect(page.getByLabel("Website or app")).toHaveValue(
    "accounts.example.edu"
  )
  await expect(page.getByLabel("Username")).toHaveValue(
    "updated-student@example.edu"
  )
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    "UpdatedDemo!654321"
  )
  await expect(page.getByLabel("Notes (optional)")).toHaveValue(
    "Updated recovery details."
  )
  await expect(page.getByLabel("Risk level")).toHaveValue("high")
})

test("previews generated passwords live on the generator page", async ({
  page,
}) => {
  await page.goto("/")

  await page.getByLabel("Vault password", { exact: true }).fill(vaultPassword)
  await page.getByLabel("Confirm vault password").fill(vaultPassword)
  await page.getByRole("button", { name: "Create encrypted vault" }).click()

  await page.getByRole("button", { name: "Close" }).click()
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toBeHidden()

  await page.getByRole("link", { name: "Generator", exact: true }).click()
  await expect(page).toHaveURL(/\/generate$/)

  const preview = page.getByLabel("Generated password preview")
  await expect(preview).toHaveText(/^.{20}$/)

  await page.getByLabel("Length").fill("40")
  await expect(preview).toHaveText(/^.{40}$/)

  const uppercase = page.getByRole("checkbox", { name: "Uppercase" })
  const digits = page.getByRole("checkbox", { name: "Numbers" })
  const symbols = page.getByRole("checkbox", { name: "Symbols" })
  await uppercase.uncheck()
  await digits.uncheck()
  await symbols.uncheck()
  await expect(preview).toHaveText(/^[a-z]{40}$/)

  const lowercase = page.getByRole("checkbox", { name: "Lowercase" })
  await lowercase.uncheck()
  await expect(
    page.getByText("Select at least one character type.")
  ).toBeVisible()
})
