import { expect, test } from "./fixtures"
import { registerAccount, unlockVault } from "./account-helpers"

// A narrow phone: the vault's header buttons used to run off the right edge
// once the vault had a credential.
test.use({ viewport: { width: 360, height: 740 } })

test("keeps the vault header buttons on screen on a narrow phone", async ({
  page,
}) => {
  await registerAccount(page)
  await page.goto("/")
  await unlockVault(page)

  const addDialog = page.getByRole("dialog", { name: "Add a credential" })
  await addDialog.getByLabel("Account label").fill("University email")
  await addDialog.getByLabel("Website or app").fill("mail.example.edu")
  await addDialog.getByLabel("Username").fill("student@example.edu")
  await addDialog
    .getByLabel("Password", { exact: true })
    .fill("MobileDemo!123456")
  await addDialog.getByRole("button", { name: "Save credential" }).click()
  await expect(addDialog).toBeHidden()

  for (const name of ["Import credentials", "Add credential"]) {
    const box = await page.getByRole("button", { name }).boundingBox()
    expect(box, name).not.toBeNull()
    expect(box!.x, name).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width, name).toBeLessThanOrEqual(360)
  }

  // The account label gets its own line instead of sharing it with the site.
  const label = page.getByText("University email", { exact: true })
  await expect(label).toBeVisible()
  expect(
    await label.evaluate(
      (element) => element.scrollWidth <= element.clientWidth
    )
  ).toBe(true)
})
