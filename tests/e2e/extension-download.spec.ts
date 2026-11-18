import { EXTENSION_PUBLIC_KEY } from "../../extension/identity"
import { readZip } from "../support/read-zip"
import { openNewVault, registerAccount } from "./account-helpers"
import { expect, test } from "./fixtures"

test("signed-out visitors can download the extension built for this site", async ({
  page,
}) => {
  await page.goto("/sign-in")
  await page.getByRole("link", { name: "Get the Chrome extension" }).click()

  await expect(page).toHaveURL(/\/extension$/)
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Your vault, right where you sign in",
    })
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Install the extension" })
  ).toBeVisible()
  for (const feature of [
    "Fill saved logins",
    "Save new logins",
    "Your vault stays encrypted",
  ])
    await expect(page.getByRole("heading", { name: feature })).toBeVisible()
  await expect(page.getByText("chrome://extensions")).toBeVisible()
  await expect(
    page.getByRole("link", { name: "Sign in", exact: true })
  ).toBeVisible()
  // The page stays put instead of sending the visitor to sign-in.
  await page.waitForLoadState("networkidle")
  await expect(page).toHaveURL(/\/extension$/)

  const download = page.getByRole("link", { name: "Download for Chrome" })
  const href = await download.getAttribute("href")
  expect(href).toBe("/downloads/ung-password-manager-extension.zip")

  const response = await page.request.get(href!)
  expect(response.status()).toBe(200)
  expect(response.headers()["content-type"]).toContain("application/zip")
  const body = await response.body()
  expect(body.length).toBeGreaterThan(1000)

  const files = readZip(body)
  const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8"))
  expect(manifest.key).toBe(EXTENSION_PUBLIC_KEY)
  expect(manifest.host_permissions).toEqual(["http://127.0.0.1:3100/*"])
})

test("the account menu opens the extension page without locking the vault", async ({
  page,
}) => {
  await registerAccount(page)
  await page.goto("/vault")
  await openNewVault(page)
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "Signed-in account" }).click()
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Chrome extension" })
    .click()
  await expect(page).toHaveURL(/\/extension$/)
  await expect(
    page.getByRole("link", { name: "Download for Chrome" })
  ).toBeVisible()
  // Shown inside the app, so its navigation leads straight back.
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Vault", exact: true })
    .click()
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Unlock your vault" })
  ).toHaveCount(0)
})
