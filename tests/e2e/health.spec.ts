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
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toHaveCount(0)

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
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toHaveCount(0)

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

test("tags only the highlighted saved account and keeps its current risk level", async ({
  page,
}) => {
  test.setTimeout(60_000)

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
    await page
      .getByRole("textbox", { name: "Username" })
      .fill("student@example.edu")
    await page
      .getByLabel("Password", { exact: true })
      .fill("private-password-123")
    await page.getByRole("button", { name: "Save credential" }).click()
    await expect(
      page.getByRole("dialog", { name: "Add a credential" })
    ).toHaveCount(0)
  }

  // Two saved accounts share a label, so only the site tells them apart.
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
  const riskLevel = page.getByLabel("Risk level")
  const saveRisk = page.getByRole("button", { name: "Save risk level" })
  const reportFor = (site: string) =>
    reports.getByRole("listitem").filter({ hasText: site })
  // A finished save clears the account field, so waiting for that keeps the
  // next step from running while the previous save is still in flight.
  async function saveRiskLevel() {
    await saveRisk.click()
    await expect(accountInput).toHaveValue("")
    await expect(saveRisk).toBeEnabled()
  }

  // Typing opens the list over the card with the top match highlighted.
  await accountInput.fill("University email")
  await expect(suggestions.getByRole("option")).toHaveCount(2)
  await expect(suggestions.getByText("mail.example.edu")).toBeVisible()
  await expect(suggestions.getByText("backup.example.edu")).toBeVisible()
  await expect(suggestions.getByRole("option").first()).toHaveAttribute(
    "aria-selected",
    "true"
  )
  await expect(accountInput).toHaveAttribute(
    "aria-activedescendant",
    "quick-account-option-0"
  )
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

  // Arrow keys move the highlight, and Enter tags the highlighted account.
  await accountInput.press("ArrowDown")
  const highlighted = suggestions.getByRole("option").nth(1)
  await expect(highlighted).toHaveAttribute("aria-selected", "true")
  const highlightedSite = (
    await highlighted.locator("span").nth(1).innerText()
  ).trim()
  const otherSite =
    highlightedSite === "mail.example.edu"
      ? "backup.example.edu"
      : "mail.example.edu"
  await accountInput.press("Enter")
  await expect(suggestions).toHaveCount(0)
  // The form starts from the tag the account already has (none = low).
  await expect(riskLevel).toHaveValue("low")
  await riskLevel.selectOption("high")
  await saveRiskLevel()
  await expect(
    reportFor(highlightedSite).getByText("high", { exact: true })
  ).toBeVisible()
  await expect(
    reportFor(otherSite).getByText("low", { exact: true })
  ).toBeVisible()
  // Tagging reuses the saved account instead of adding a credential.
  await expect(reports.getByRole("listitem")).toHaveCount(2)

  // A tagged account opens with its own tag, and saving keeps it unchanged.
  await accountInput.fill(highlightedSite)
  await suggestions.getByRole("option").first().click()
  await expect(riskLevel).toHaveValue("high")
  await saveRiskLevel()
  await expect(
    reportFor(highlightedSite).getByText("high", { exact: true })
  ).toBeVisible()
  await expect(reports.getByRole("listitem")).toHaveCount(2)

  // A single match is highlighted while typing, so Enter tags it.
  await accountInput.fill(otherSite)
  await expect(suggestions.getByRole("option")).toHaveCount(1)
  await accountInput.press("Enter")
  await expect(riskLevel).toHaveValue("low")
  await riskLevel.selectOption("medium")
  await saveRiskLevel()
  await expect(
    reportFor(otherSite).getByText("medium", { exact: true })
  ).toBeVisible()
  await expect(
    reportFor(highlightedSite).getByText("high", { exact: true })
  ).toBeVisible()

  // An unknown name tags nobody and still adds no credential.
  await accountInput.fill("not a saved account")
  await saveRisk.click()
  await expect(
    page.getByText("Select a saved account from the suggestions.")
  ).toBeVisible()
  await expect(reports.getByRole("listitem")).toHaveCount(2)
})

test("keeps a newer account selection when an earlier save finishes late", async ({
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

  async function saveCredential(label: string, site: string) {
    await page.getByLabel("Account label").fill(label)
    await page.getByLabel("Website or app").fill(site)
    await page
      .getByRole("textbox", { name: "Username" })
      .fill("student@example.edu")
    await page
      .getByLabel("Password", { exact: true })
      .fill("private-password-123")
    await page.getByRole("button", { name: "Save credential" }).click()
    await expect(
      page.getByRole("dialog", { name: "Add a credential" })
    ).toHaveCount(0)
  }

  await saveCredential("Mail account", "mail.example.edu")
  await page.getByRole("button", { name: "Add credential" }).click()
  await saveCredential("Backup account", "backup.example.edu")
  await page.getByRole("link", { name: "Health", exact: true }).click()

  const accountInput = page.getByRole("combobox", { name: "Account name" })
  const reports = page.getByRole("list", { name: "Password health reports" })
  const riskLevel = page.getByLabel("Risk level")
  const saveRisk = page.getByRole("button", { name: "Save risk level" })
  const reportFor = (label: string) =>
    reports.getByRole("listitem").filter({ hasText: label })

  // Hold the first save open so the next account is chosen while it runs.
  let releaseSave = () => {}
  const saveHeld = new Promise<void>((resolve) => {
    releaseSave = resolve
  })
  let holdNextWrite = true
  await page.route("**/api/vault", async (route) => {
    if (holdNextWrite && route.request().method() === "PUT") {
      holdNextWrite = false
      await saveHeld
    }
    await route.continue()
  })

  await accountInput.fill("Mail account")
  await accountInput.press("Enter")
  await expect(riskLevel).toHaveValue("low")
  await riskLevel.selectOption("high")
  await saveRisk.click()
  await expect(saveRisk).toBeDisabled()

  // Pick another account before the first save has been answered.
  await accountInput.fill("Backup account")
  await accountInput.press("Enter")
  await expect(riskLevel).toHaveValue("low")

  releaseSave()

  // The finished save must leave the newly chosen account in place.
  await expect(saveRisk).toBeEnabled()
  await expect(accountInput).toHaveValue("Backup account")
  await expect(riskLevel).toHaveValue("low")

  // Saving the second account changes that account and nothing else.
  await saveRisk.click()
  await expect(accountInput).toHaveValue("")
  await expect(
    reportFor("mail.example.edu").getByText("high", { exact: true })
  ).toBeVisible()
  await expect(
    reportFor("backup.example.edu").getByText("low", { exact: true })
  ).toBeVisible()
  await expect(reports.getByRole("listitem")).toHaveCount(2)
})

test("asks for a saved account before a risk level can be assigned", async ({
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
  // An empty vault opens the add dialog; close it to reach the Health page.
  await page.keyboard.press("Escape")
  await page.getByRole("link", { name: "Health", exact: true }).click()

  await expect(
    page.getByText(
      "Add a credential in the Vault before assigning a risk level."
    )
  ).toBeVisible()
  await expect(
    page.getByRole("combobox", { name: "Account name" })
  ).toBeDisabled()
  await expect(
    page.getByRole("button", { name: "Save risk level" })
  ).toBeDisabled()
})
