import { openNewVault, registerAccount, unlockVault } from "./account-helpers"
import { expect, test } from "./fixtures"

test("an unknown address says so and links back to the vault", async ({
  page,
}) => {
  await registerAccount(page)
  await page.goto("/vault")
  await openNewVault(page)
  await page.keyboard.press("Escape")

  const response = await page.goto("/no-such-page")
  expect(response?.status()).toBe(404)
  // A full page load locks the vault, so unlock it to see the page itself.
  await unlockVault(page)
  await expect(
    page.getByRole("heading", { name: "Page not found" })
  ).toBeVisible()
  await page.getByRole("link", { name: "Go to your vault" }).click()
  await expect(page).toHaveURL(/\/vault$/)
})
