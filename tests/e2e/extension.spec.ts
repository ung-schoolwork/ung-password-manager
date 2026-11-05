import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  chromium,
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test"

import { EXTENSION_ID } from "../../extension/identity"
import { encryptVault } from "../../lib/vault/crypto.client"
import type { Credential } from "../../lib/vault/types"
import {
  accountPassword,
  accountProof,
  approve,
  registerAccount,
  unlockVault,
  vaultKeyFor,
} from "./account-helpers"
import { setTestClientIp } from "./fixtures"

const appOrigin = "http://127.0.0.1:3100"
const popupUrl = `chrome-extension://${EXTENSION_ID}/popup.html`

// Extensions load only in desktop Chromium, so one project covers this file.
test.skip(({ isMobile }) => isMobile, "Chrome extensions are desktop-only")

let extensionDir: string
// The Chrome profile with the extension installed. The app opened in it shares
// the extension's session and device approval.
let context: BrowserContext

test.beforeAll(() => {
  extensionDir = mkdtempSync(path.join(tmpdir(), "ung-extension-"))
  const build = spawnSync(
    "bun",
    ["extension/build.ts", "--outdir", extensionDir],
    {
      env: { ...process.env, EXTENSION_APP_ORIGIN: appOrigin },
      encoding: "utf8",
    }
  )
  expect(build.status, build.stderr).toBe(0)
})

test.beforeEach(async () => {
  // The bundled Chromium (not the headless shell) is required for extensions.
  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    baseURL: appOrigin,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  })
  await setTestClientIp(context)
})

test.afterEach(async () => {
  await context?.close()
})

test.afterAll(() => {
  rmSync(extensionDir, { recursive: true, force: true })
})

function credential(accountName: string, username: string): Credential {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    accountName,
    siteOrApp: `${username}.example.test`,
    username,
    password: `${username}-password-123`,
    createdAt: now,
    updatedAt: now,
    passwordUpdatedAt: now,
  }
}

/** Saves a vault from an approved device, encrypted as the app does. */
async function saveVault(
  request: APIRequestContext,
  email: string,
  credentials: Credential[]
) {
  const snapshot = await (await request.get(`${appOrigin}/api/vault`)).json()
  const envelope = await encryptVault(await vaultKeyFor(email, snapshot), {
    version: 1,
    credentials,
  })
  const saved = await request.put(`${appOrigin}/api/vault`, {
    headers: { Origin: appOrigin },
    data: { envelope, expectedRevision: snapshot.revision },
  })
  expect(saved.status()).toBe(200)
}

async function openPopup() {
  const popup = await context.newPage()
  await popup.goto(popupUrl)
  return popup
}

async function signInFromPopup(popup: Page, email: string) {
  const form = popup.getByRole("region", { name: "Sign in" })
  await form.getByLabel("Email").fill(email)
  await form.getByLabel("Password").fill(accountPassword)
  await form.getByRole("button", { name: "Sign in", exact: true }).click()
}

async function unlockPopup(popup: Page, password = accountPassword) {
  const form = popup.getByRole("region", { name: "Unlock your vault" })
  await form.getByLabel("Password").fill(password)
  await form.getByRole("button", { name: "Unlock vault" }).click()
}

function savedLogins(popup: Page) {
  return popup.getByRole("list", { name: "Saved logins" })
}

async function popupApprovalCode(popup: Page) {
  await expect(
    popup.getByRole("heading", { name: "Approve this device" })
  ).toBeVisible()
  const code = (
    await popup.getByLabel("Device approval code").innerText()
  ).replace(/\s/g, "")
  expect(code).toMatch(/^\d{8}$/)
  return code
}

test("the popup signs in, waits for approval, opens the vault, and loses it when the browser is removed", async ({
  browser,
}) => {
  test.setTimeout(90_000)
  // The account's first device, in another browser profile.
  const laptop = await browser.newContext()
  await setTestClientIp(laptop)
  const laptopPage = await laptop.newPage()
  const account = await registerAccount(laptopPage)
  await saveVault(laptop.request, account.email, [
    credential("Course portal", "student-portal"),
    credential("Bank", "student-bank"),
  ])

  // This Chrome profile is signed out, so the popup asks for the account.
  const popup = await openPopup()
  await signInFromPopup(popup, account.email)

  // Signed in, but not an approved device: it shows the code and gets no vault.
  const code = await popupApprovalCode(popup)
  await expect(savedLogins(popup)).toBeHidden()
  expect((await context.request.get("/api/vault")).status()).toBe(403)

  // Signing in from the popup signed in the app in this profile as well.
  const appTab = await context.newPage()
  await appTab.goto("/vault")
  await expect(
    appTab.getByRole("heading", { name: "Approve this device" })
  ).toBeVisible()
  await appTab.close()

  // The laptop approves the code in Settings; the popup opens the vault with
  // the password from sign-in, without asking again.
  await laptopPage.goto("/vault")
  await unlockVault(laptopPage)
  await approve(laptopPage, code)
  await expect(savedLogins(popup)).toBeVisible({ timeout: 15_000 })
  await expect(savedLogins(popup).getByRole("listitem")).toHaveText([
    /Bank\s*student-bank/,
    /Course portal\s*student-portal/,
  ])
  await expect(
    popup.getByRole("heading", { name: "Unlock your vault" })
  ).toBeHidden()

  // Removing this browser on the laptop hides the vault in the popup at once
  // and it shows a new approval code.
  await laptopPage.getByRole("button", { name: /^Remove / }).click()
  await laptopPage.getByRole("button", { name: "Remove device" }).click()
  await expect(
    popup.getByRole("heading", { name: "Approve this device" })
  ).toBeVisible({ timeout: 15_000 })
  await expect(savedLogins(popup)).toBeHidden()
  await expect(popup.getByText("student-portal")).toHaveCount(0)
  expect((await context.request.get("/api/vault")).status()).toBe(403)

  await laptop.close()
})

test("the popup unlocks the app's sign-in with the password, and signing out in either signs out both", async () => {
  test.setTimeout(90_000)
  // Signed in to the app in this Chrome profile, as its first device.
  const appTab = await context.newPage()
  const account = await registerAccount(appTab)
  await saveVault(context.request, account.email, [
    credential("Library", "student-library"),
  ])

  const popup = await openPopup()
  await expect(
    popup.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible()
  await expect(popup.getByText(`Signed in as ${account.email}`)).toBeVisible()
  await unlockPopup(popup, "not-the-account-password")
  await expect(popup.getByRole("alert")).toHaveText(
    "The password is incorrect or the saved vault is damaged."
  )
  await expect(savedLogins(popup)).toBeHidden()
  await unlockPopup(popup)
  await expect(savedLogins(popup)).toContainText("student-library")

  // Signing out in the app signs out the extension and hides the vault.
  await appTab.goto("/vault")
  await unlockVault(appTab)
  await expect(appTab.getByText("student-library").first()).toBeVisible()
  await appTab.getByRole("button", { name: "Sign out" }).click()
  await expect(appTab).toHaveURL(/\/sign-in$/)
  await expect(popup.getByRole("heading", { name: "Sign in" })).toBeVisible({
    timeout: 15_000,
  })
  await expect(popup.getByRole("alert")).toHaveText("You were signed out.")
  await expect(popup.getByText("student-library")).toHaveCount(0)

  // Signing in from the popup on an approved device opens the vault directly
  // and signs the app in again.
  await signInFromPopup(popup, account.email)
  await expect(savedLogins(popup)).toContainText("student-library")
  await appTab.goto("/vault")
  await unlockVault(appTab)
  await expect(appTab.getByText("student-library").first()).toBeVisible()

  // Signing out in the popup signs out the app: returning to its tab closes
  // the vault there too.
  await popup
    .getByRole("region", { name: "Your vault" })
    .getByRole("button", { name: "Sign out" })
    .click()
  await expect(popup.getByRole("heading", { name: "Sign in" })).toBeVisible()
  await expect(popup.getByText("student-library")).toHaveCount(0)
  await appTab.bringToFront()
  await appTab.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect(appTab).toHaveURL(/\/sign-in$/)
  await expect(appTab.getByText("student-library")).toHaveCount(0)
  expect((await context.request.get("/api/vault")).status()).toBe(401)
})

test("the server accepts the app and this extension, and rejects other origins", async () => {
  const worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  expect(worker.url()).toBe(`chrome-extension://${EXTENSION_ID}/background.js`)

  const popup = await openPopup()
  await expect(popup.getByRole("heading", { name: "Sign in" })).toBeVisible()

  // Register through the app; the extension shares this browser's cookies.
  const email = `extension-${crypto.randomUUID()}@example.test`
  const proof = await accountProof(email)
  const registered = await context.request.post("/api/auth/register", {
    headers: { Origin: appOrigin },
    data: proof,
  })
  expect(registered.status()).toBe(201)

  await popup.reload()
  await expect(popup.getByText(`Signed in as ${email}`)).toBeVisible()

  // Neither an unlisted extension nor a web page on another origin may sign
  // in or out.
  for (const origin of [
    "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
    "http://attacker.test",
  ]) {
    const forgedSignOut = await context.request.post("/api/auth/logout", {
      headers: { Origin: origin },
    })
    expect(forgedSignOut.status()).toBe(403)
    const forgedSignIn = await context.request.post("/api/auth/login", {
      headers: { Origin: origin },
      data: { email, authKey: proof.authKey },
    })
    expect(forgedSignIn.status()).toBe(403)
  }

  // A state-changing request from the extension passes the origin check and
  // carries the SameSite=Strict session cookie.
  const signOut = await popup.evaluate(async (origin) => {
    const response = await fetch(`${origin}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    })
    return response.status
  }, appOrigin)
  expect(signOut).toBe(200)

  await popup.reload()
  await expect(popup.getByRole("heading", { name: "Sign in" })).toBeVisible()
})
