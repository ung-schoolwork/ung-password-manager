import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { expect, test } from "./fixtures"
import { registerAccount, unlockVault } from "./account-helpers"

const xlsxFile = {
  name: "credentials.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: readFileSync(
    fileURLToPath(new URL("../fixtures/credentials.xlsx", import.meta.url))
  ),
}

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
  await unlockVault(page)

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
  await expect(page.getByRole("dialog", { name: "Importing…" })).toBeVisible()

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
  await expect(
    page.getByText("Click to choose a CSV or Excel file")
  ).toBeVisible()

  await page.getByRole("button", { name: "Cancel" }).click()
})

test("importing an .xlsx file shows a review first, then lists each row as imported or not", async ({
  page,
}) => {
  await page.goto("/")
  await unlockVault(page)
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toBeVisible()
  await page.keyboard.press("Escape")

  // Any request carrying the file's contents would mean it left the browser.
  const uploads: string[] = []
  page.on("request", (request) => {
    const body = request.postDataBuffer()
    if (body?.includes("Campus Portal") || body?.includes("[Content_Types]"))
      uploads.push(request.url())
  })

  await page.getByRole("button", { name: "Import credentials" }).click()
  const importDialog = page.getByRole("dialog", { name: "Import credentials" })
  await importDialog.locator('input[type="file"]').setInputFiles(xlsxFile)

  const review = page.getByRole("dialog", { name: "Review before importing" })
  await expect(review).toBeVisible()
  await expect(
    review.getByText(
      "2 of 3 rows are ready to import. 1 need attention and will be skipped."
    )
  ).toBeVisible()
  const ready = review.getByRole("region", { name: "Ready to import" })
  await expect(ready.getByText("Campus Portal")).toBeVisible()
  await expect(ready.getByText("Tom & Jerry's <Shop>")).toBeVisible()
  const problems = review.getByRole("region", { name: "Rows with problems" })
  await expect(problems.getByText("Row 6")).toBeVisible()
  await expect(problems.getByText("Missing website or app.")).toBeVisible()

  await review.getByRole("button", { name: "Import 2 credentials" }).click()

  const done = page.getByRole("dialog", { name: "Import complete" })
  await expect(done).toBeVisible()
  await expect(
    done.getByText("2 credentials added to your vault. 1 row not imported.")
  ).toBeVisible()
  const results = done.getByRole("list", { name: "Import results" })
  await expect(results.getByRole("listitem")).toHaveCount(3)
  await expect(results.getByRole("listitem").nth(0)).toContainText(
    "Campus Portal · portal.example.edu"
  )
  await expect(results.getByRole("listitem").nth(0)).toContainText(
    "Row 2 · Imported"
  )
  await expect(results.getByRole("listitem").nth(2)).toContainText(
    "Row 6 · Not imported"
  )
  await expect(results.getByRole("listitem").nth(2)).toContainText(
    "Missing website or app."
  )

  await done.getByRole("button", { name: "Done" }).click()
  await expect(page.getByText("2 saved credentials.")).toBeVisible()
  expect(uploads).toEqual([])
})
