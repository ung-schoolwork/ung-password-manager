import { mkdir } from "node:fs/promises"

import { expect, test } from "./fixtures"
import { registerAccount } from "./account-helpers"

test.beforeEach(async ({ page }) => {
  await registerAccount(page)
})

test("opens Health from a credential shield", async ({ page }) => {
  await page.goto("/")
  await page
    .getByLabel("Vault password", { exact: true })
    .fill("correct horse battery staple")
  await page
    .getByLabel("Confirm vault password")
    .fill("correct horse battery staple")
  await page.getByRole("button", { name: "Create encrypted vault" }).click()
  await page.getByLabel("Account label").fill("University email")
  await page.getByLabel("Website or app").fill("mail.example.edu")
  await page.getByRole("textbox", { name: "Username" }).fill("student@example.edu")
  await page.getByLabel("Password", { exact: true }).fill("private-password-123")
  await page.getByRole("button", { name: "Save credential" }).click()

  await page
    .getByRole("link", { name: "Password health for University email" })
    .click()

  await expect(page).toHaveURL(/\/health$/)
  await expect(
    page.getByText("Vault Password Health", { exact: true })
  ).toBeVisible()
})

test("shows saved password warnings and their reasons", async ({
  page,
}, testInfo) => {
  await page.goto("/")
  await page
    .getByLabel("Vault password", { exact: true })
    .fill("correct horse battery staple")
  await page
    .getByLabel("Confirm vault password")
    .fill("correct horse battery staple")
  await page.getByRole("button", { name: "Create encrypted vault" }).click()

  await page.getByLabel("Account label").fill("University email")
  await page.getByLabel("Website or app").fill("mail.example.edu")
  await page
    .getByRole("textbox", { name: "Username" })
    .fill("student@example.edu")
  await page.getByLabel("Password", { exact: true }).fill("password")
  await page.getByRole("button", { name: "Save credential" }).click()

  await page.getByRole("link", { name: "Health", exact: true }).click()
  await expect(
    page.getByText("Vault Password Health", { exact: true })
  ).toBeVisible()
  await expect(
    page.getByText("This matches a commonly used password.")
  ).toBeVisible()
  await expect(page.getByText("No issues found by these checks.")).toHaveCount(
    0
  )

  await page.getByRole("link", { name: "Vault" }).click()
  await page.getByRole("button", { name: "Add credential" }).click()
  await page.getByLabel("Account label").fill("Backup email")
  await page.getByLabel("Website or app").fill("backup.example.edu")
  await page
    .getByRole("textbox", { name: "Username" })
    .fill("backup@example.edu")
  await page.getByLabel("Password", { exact: true }).fill("password")
  await page.getByRole("button", { name: "Save credential" }).click()

  await page.getByRole("link", { name: "Health", exact: true }).click()
  const reports = page.getByRole("list", { name: "Password health reports" })
  await expect(reports.getByRole("listitem")).toHaveCount(2)
  await expect(reports.getByText("Reused:")).toHaveCount(2)
  await expect(
    reports.getByText(/this password is also saved for/i)
  ).toHaveCount(2)

  await mkdir("artifacts/visual", { recursive: true })
  await page.screenshot({
    path: `artifacts/visual/health-${testInfo.project.name}.png`,
    fullPage: true,
  })
})

test("tags only the selected saved account from keyboard or mouse suggestions", async ({
  page,
}) => {
  await page.goto("/")
  await page
    .getByLabel("Vault password", { exact: true })
    .fill("correct horse battery staple")
  await page
    .getByLabel("Confirm vault password")
    .fill("correct horse battery staple")
  await page.getByRole("button", { name: "Create encrypted vault" }).click()

  async function saveCredential(site: string) {
    await page.getByLabel("Account label").fill("University email")
    await page.getByLabel("Website or app").fill(site)
    await page.getByRole("textbox", { name: "Username" }).fill("student@example.edu")
    await page.getByLabel("Password", { exact: true }).fill("private-password-123")
    await page.getByRole("button", { name: "Save credential" }).click()
    await expect(
      page.getByRole("dialog", { name: "Add a credential" })
    ).toHaveCount(0)
  }

  await saveCredential("mail.example.edu")
  await page.getByRole("button", { name: "Add credential" }).click()
  await saveCredential("backup.example.edu")
  await page.getByRole("link", { name: "Health", exact: true }).click()

  const accountInput = page.getByRole("combobox", { name: "Account name" })
  const suggestions = page.getByRole("listbox", {
    name: "Matching saved accounts",
  })
  const tagCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Tag Existing Account" })
  const reports = page.getByRole("list", { name: "Password health reports" })

  await accountInput.fill("University email")
  await expect(suggestions.getByRole("option")).toHaveCount(2)
  await expect(suggestions.getByText("mail.example.edu")).toBeVisible()
  await expect(suggestions.getByText("backup.example.edu")).toBeVisible()
  await expect(tagCard).toHaveCSS("overflow", "visible")
  const [inputBounds, suggestionBounds] = await Promise.all([
    accountInput.boundingBox(),
    suggestions.boundingBox(),
  ])
  expect(inputBounds).not.toBeNull()
  expect(suggestionBounds).not.toBeNull()
  expect(suggestionBounds!.y).toBeGreaterThanOrEqual(
    inputBounds!.y + inputBounds!.height - 1
  )
  await suggestions
    .getByRole("option")
    .filter({ hasText: "backup.example.edu" })
    .click()
  await page.getByLabel("Risk level").selectOption("high")
  await page.getByRole("button", { name: "Save risk level" }).click()

  const backupReport = reports
    .getByRole("listitem")
    .filter({ hasText: "backup.example.edu" })
  const mailReport = reports
    .getByRole("listitem")
    .filter({ hasText: "mail.example.edu" })
  await expect(reports.getByRole("listitem")).toHaveCount(2)
  await expect(backupReport.getByText("high", { exact: true })).toBeVisible()
  await expect(mailReport.getByText("low", { exact: true })).toBeVisible()

  await accountInput.fill("mail.example.edu")
  await accountInput.press("Enter")
  await page.getByLabel("Risk level").selectOption("medium")
  await page.getByRole("button", { name: "Save risk level" }).click()
  await expect(mailReport.getByText("medium", { exact: true })).toBeVisible()
  await expect(backupReport.getByText("high", { exact: true })).toBeVisible()

  await accountInput.fill("not a saved account")
  await page.getByRole("button", { name: "Save risk level" }).click()
  await expect(
    page.getByText("Select a saved account from the suggestions.")
  ).toBeVisible()
  await expect(reports.getByRole("listitem")).toHaveCount(2)
})
