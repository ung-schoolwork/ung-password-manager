import { expect, test } from "@playwright/test"

const vaultPassword = "correct horse battery staple"

test("edits a saved credential with prefilled details, supports cancel, and persists changes", async ({
  page,
}) => {
  await page.goto("/")

  // 1. Wait for vault gate to finish loading
  await expect(
    page.getByRole("heading", { name: "Create your vault" })
  ).toBeVisible()

  await page.getByLabel("Vault password", { exact: true }).fill(vaultPassword)
  await page.getByLabel("Confirm vault password").fill(vaultPassword)
  await page.getByRole("button", { name: "Create encrypted vault" }).click()

  // 2. Wait for redirect and initial Add Credential dialog
  await expect(page).toHaveURL(/\/vault$/)
  const addDialog = page.getByRole("dialog", { name: "Add a credential" })
  await expect(addDialog).toBeVisible()

  // 3. Fill and save initial credential
  await addDialog.getByLabel("Account label").fill("University email")
  await addDialog.getByLabel("Website or app").fill("mail.example.edu")
  await addDialog.getByLabel("Username").fill("student@example.edu")
  await addDialog.getByLabel("Password", { exact: true }).fill("InitialSecret123!")
  await addDialog.getByLabel("Risk level").selectOption("medium")
  await addDialog.getByLabel("Notes (optional)").fill("Old notes")
  await addDialog.getByRole("button", { name: "Save credential" }).click()

  await expect(addDialog).toBeHidden()
  await expect(page.getByText("University email", { exact: true })).toBeVisible()

  // 4. Open saved credential with current details
  const credentialItem = page
    .getByRole("list", { name: "Saved credentials" })
    .getByRole("listitem")
  await credentialItem.getByRole("button", { name: "Edit" }).click()

  const editDialog = page.getByRole("dialog", { name: "Edit credential" })
  await expect(editDialog).toBeVisible()
  await expect(editDialog.getByLabel("Account label")).toHaveValue("University email")
  await expect(editDialog.getByLabel("Website or app")).toHaveValue("mail.example.edu")
  await expect(editDialog.getByLabel("Username")).toHaveValue("student@example.edu")
  await expect(editDialog.getByLabel("Password", { exact: true })).toHaveValue("InitialSecret123!")
  await expect(editDialog.getByLabel("Risk level")).toHaveValue("medium")
  await expect(editDialog.getByLabel("Notes (optional)")).toHaveValue("Old notes")

  // 5. Test Cancel without modifying
  await editDialog.getByLabel("Account label").fill("Should not be saved")
  await editDialog.getByRole("button", { name: "Cancel" }).click()
  await expect(editDialog).toBeHidden()
  await expect(page.getByText("University email", { exact: true })).toBeVisible()
  await expect(page.getByText("Should not be saved")).toHaveCount(0)

  // 6. Edit all details and save changes
  await credentialItem.getByRole("button", { name: "Edit" }).click()
  await expect(editDialog).toBeVisible()

  await editDialog.getByLabel("Account label").fill("Updated Student Portal")
  await editDialog.getByLabel("Website or app").fill("portal.example.edu")
  await editDialog.getByLabel("Username").fill("student-updated@example.edu")
  await editDialog.getByLabel("Password", { exact: true }).fill("NewSecretPassword456!")
  await editDialog.getByLabel("Risk level").selectOption("high")
  await editDialog.getByLabel("Notes (optional)").fill("Updated recovery codes")
  await editDialog.getByRole("button", { name: "Save changes" }).click()

  await expect(editDialog).toBeHidden()
  await expect(page.getByText("Updated Student Portal", { exact: true })).toBeVisible()
  await expect(page.getByText("portal.example.edu")).toBeVisible()
  await expect(page.getByText("student-updated@example.edu")).toBeVisible()

  // 7. Changes remain after reload and unlock
  await page.reload()
  await expect(page.getByRole("heading", { name: "Unlock your vault" })).toBeVisible()
  await page.getByLabel("Vault password").fill(vaultPassword)
  await page.getByRole("button", { name: "Unlock vault" }).click()

  await expect(page.getByText("Updated Student Portal", { exact: true })).toBeVisible()
  await expect(page.getByText("portal.example.edu")).toBeVisible()
  await expect(page.getByText("student-updated@example.edu")).toBeVisible()
})