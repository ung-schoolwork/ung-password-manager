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
    .getByRole("button", {
      name: "Password health for University email: Healthy; no warnings",
    })
    .click()
  await page.getByRole("link", { name: /View full health report/ }).click()

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
  const reports = page.getByRole("list", { name: "Password health reports" })
  await expect(
    page.getByText("Vault Password Health", { exact: true })
  ).toBeVisible()
  await expect(
    page.getByText("This matches a commonly used password.")
  ).toBeVisible()
  await expect(
    reports.getByRole("img", { name: "Needs attention" })
  ).toHaveCount(1)
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
  await expect(reports.getByRole("listitem")).toHaveCount(2)
  await expect(
    reports.getByRole("img", { name: "Needs attention" })
  ).toHaveCount(2)
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

test("tags only a selected saved credential from keyboard or mouse suggestions", async ({
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
  await page.getByLabel("Account label").fill("University email")
  await page.getByLabel("Website or app").fill("mail.example.edu")
  await page.getByRole("textbox", { name: "Username" }).fill("student@example.edu")
  await page.getByLabel("Password", { exact: true }).fill("private-password-123")
  await page.getByRole("button", { name: "Save credential" }).click()
  await page.getByRole("link", { name: "Health", exact: true }).click()

  const accountInput = page.getByRole("combobox", { name: "Account name" })
  const suggestions = page.getByRole("listbox", {
    name: "Matching saved accounts",
  })
  const reports = page.getByRole("list", { name: "Password health reports" })

  await accountInput.fill("mail.example")
  await expect(suggestions.getByRole("option")).toHaveCount(1)
  await expect(suggestions.getByText("University email")).toBeVisible()
  await expect(suggestions.getByText("mail.example.edu")).toBeVisible()
  await suggestions.getByRole("option").click()
  await page.getByLabel("Risk level").selectOption("high")
  await page.getByRole("button", { name: "Save risk level" }).click()
  await expect(
    reports.getByRole("listitem").getByText("high", { exact: true })
  ).toBeVisible()

  await accountInput.fill("University")
  await accountInput.press("ArrowDown")
  await accountInput.press("Enter")
  await page.getByLabel("Risk level").selectOption("low")
  await page.getByRole("button", { name: "Save risk level" }).click()
  await expect(
    reports.getByRole("listitem").getByText("low", { exact: true })
  ).toBeVisible()

  await accountInput.fill("not a saved account")
  await page.getByRole("button", { name: "Save risk level" }).click()
  await expect(
    page.getByText("Select a saved account from the suggestions.")
  ).toBeVisible()
  await expect(reports.getByRole("listitem")).toHaveCount(1)
})
