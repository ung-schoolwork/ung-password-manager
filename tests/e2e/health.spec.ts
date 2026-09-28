import { mkdir } from "node:fs/promises"

import { expect, test } from "@playwright/test"

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
  await page.getByRole("textbox", { name: "Username" }).fill("student@example.edu")
  await page.getByLabel("Password", { exact: true }).fill("password")
  await page.getByRole("button", { name: "Save credential" }).click()

  await page.getByRole("link", { name: "Health" }).click()
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
  await page.getByRole("textbox", { name: "Username" }).fill("backup@example.edu")
  await page.getByLabel("Password", { exact: true }).fill("password")
  await page.getByRole("button", { name: "Save credential" }).click()

  await page.getByRole("link", { name: "Health" }).click()
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
