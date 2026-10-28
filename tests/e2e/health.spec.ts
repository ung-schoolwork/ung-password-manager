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
  await page
    .getByRole("textbox", { name: "Username" })
    .fill("student@example.edu")
  await page
    .getByLabel("Password", { exact: true })
    .fill("private-password-123")
  await page.getByRole("button", { name: "Save credential" }).click()

  await page
    .getByRole("link", {
      name: "Password health for University email: Healthy; no warnings",
    })
    .click()

  await expect(page).toHaveURL(/\/health$/)
  await expect(
    page.getByText("Vault Password Health", { exact: true })
  ).toBeVisible()
})

test("labels each credential shield with its health status", async ({
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
  await page
    .getByRole("textbox", { name: "Username" })
    .fill("student@example.edu")
  await page.getByLabel("Password", { exact: true }).fill("xY7#qLm2vRt9pKw4Zn8")
  await page.getByRole("button", { name: "Save credential" }).click()

  await page.getByRole("button", { name: "Add credential" }).click()
  await page.getByLabel("Account label").fill("Backup email")
  await page.getByLabel("Website or app").fill("backup.example.edu")
  await page
    .getByRole("textbox", { name: "Username" })
    .fill("backup@example.edu")
  await page.getByLabel("Password", { exact: true }).fill("password")
  await page.getByRole("button", { name: "Save credential" }).click()

  const healthyRow = page
    .locator("li")
    .filter({ hasText: "University email" })
    .first()
  const unhealthyRow = page
    .locator("li")
    .filter({ hasText: "Backup email" })
    .first()

  // AC1: the shield carries an accessible name stating the status.
  await expect(
    healthyRow.getByRole("img", { name: "Healthy; no warnings" })
  ).toBeVisible()
  await expect(
    unhealthyRow.getByRole("img", { name: "Needs attention" })
  ).toBeVisible()

  // AC2: the status is also printed as text, not signalled by colour alone.
  await expect(healthyRow.getByText("Healthy", { exact: true })).toBeVisible()
  await expect(
    unhealthyRow.getByText("Needs attention", { exact: true })
  ).toBeVisible()

  // The different silhouettes keep the two states distinct without colour.
  await expect(healthyRow.locator("svg.lucide-shield-check")).toBeVisible()
  await expect(unhealthyRow.locator("svg.lucide-triangle-alert")).toBeVisible()
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
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toHaveCount(0)

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
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toHaveCount(0)

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
