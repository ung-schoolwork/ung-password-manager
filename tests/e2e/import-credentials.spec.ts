import { expect, test } from "./fixtures"
import { registerAccount } from "./account-helpers"

const vaultPassword = "correct horse battery staple"

const csvFile = {
  name: "credentials.csv",
  mimeType: "text/csv",
  buffer: Buffer.from(
    "name,url,username,password,note\n" +
      "Alpha Mail,alpha.example.edu,alpha@example.edu,AlphaPass!123,Alpha notes\n" +
      "Beta Mail,beta.example.edu,beta@example.edu,BetaPass!456,Beta notes\n"
  ),
}

test.beforeEach(async ({ page }) => {
  await registerAccount(page)
})

test("reopening the import dialog after closing it mid-import shows a fresh file picker, and the import finishes without duplicating rows", async ({
  page,
}) => {
  await page.goto("/")
  await page.getByLabel("Vault password", { exact: true }).fill(vaultPassword)
  await page.getByLabel("Confirm vault password").fill(vaultPassword)
  await page.getByRole("button", { name: "Create encrypted vault" }).click()

  // An empty vault opens the Add Credential dialog automatically; dismiss it.
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toBeHidden()

  // Gate the save request so we have a reliable window to close the import
  // dialog while an import is still running, instead of racing real timing.
  let releaseSaves: () => void = () => {}
  const saveGate = new Promise<void>((resolve) => {
    releaseSaves = resolve
  })
  await page.route("**/api/vault", async (route) => {
    if (route.request().method() === "PUT") await saveGate
    await route.continue()
  })

  await page.getByRole("button", { name: "Import credentials" }).click()
  const importDialog = page.getByRole("dialog", { name: "Import credentials" })
  await expect(importDialog).toBeVisible()

  await importDialog.locator('input[type="file"]').setInputFiles(csvFile)
  await expect(
    page.getByRole("dialog", { name: "Review before importing" })
  ).toBeVisible()
  await expect(page.getByText("2 of 2 rows are ready to import.")).toBeVisible()

  await page.getByRole("button", { name: "Import 2 credentials" }).click()
  await expect(
    page.getByRole("dialog", { name: "Importing…" })
  ).toBeVisible()

  // Close while the (gated, still-pending) import is running.
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Importing…" })).toBeHidden()

  // Let the saves that were already in flight finish in the background.
  releaseSaves()
  await expect(page.getByText("2 saved credentials.")).toBeVisible()
  await expect(page.getByText("Alpha Mail", { exact: true })).toHaveCount(1)
  await expect(page.getByText("Beta Mail", { exact: true })).toHaveCount(1)

  // Reopening shows a fresh file picker, not a blank dialog.
  await page.getByRole("button", { name: "Import credentials" }).click()
  await expect(
    page.getByRole("dialog", { name: "Import credentials" })
  ).toBeVisible()
  await expect(page.getByText("Click to choose a CSV file")).toBeVisible()

  await page.getByRole("button", { name: "Cancel" }).click()
})
