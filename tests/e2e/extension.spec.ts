import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
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
let profileDir: string

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
  profileDir = mkdtempSync(path.join(tmpdir(), "ung-extension-profile-"))
  context = await chromium.launchPersistentContext(profileDir, {
    channel: "chromium",
    baseURL: appOrigin,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      // Lets openToolbarPopup reach the real popup, which Playwright does not
      // list among the context's pages.
      "--remote-debugging-port=0",
    ],
  })
  await setTestClientIp(context)
})

test.afterEach(async () => {
  // Hooks also run for the skipped mobile project, which launched nothing.
  await context?.close()
  if (profileDir) rmSync(profileDir, { recursive: true, force: true })
})

test.afterAll(() => {
  rmSync(extensionDir, { recursive: true, force: true })
})

function credential(
  accountName: string,
  username: string,
  siteOrApp = `${username}.example.test`
): Credential {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    accountName,
    siteOrApp,
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

/**
 * Opens the extension's real toolbar popup on the active tab, as clicking the
 * toolbar button does. The popup reads that tab's address; without the click's
 * activeTab grant it can only read pages on the app's origin.
 */
async function openToolbarPopup(tab: Page) {
  await tab.bringToFront()
  const worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  await worker.evaluate(() => chrome.action.openPopup())
  const port = readFileSync(
    path.join(profileDir, "DevToolsActivePort"),
    "utf8"
  ).split("\n")[0]
  const devtools = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  let popup: Page | undefined
  await expect(async () => {
    popup = devtools
      .contexts()
      .flatMap((browserContext) => browserContext.pages())
      .find((page) => page.url() === popupUrl)
    expect(popup).toBeDefined()
  }).toPass({ timeout: 5_000 })
  return { popup: popup!, disconnect: () => devtools.close() }
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

function vaultRegion(popup: Page) {
  return popup.getByRole("region", { name: "Your vault", exact: true })
}

/** Searches the open vault and returns the list of results. */
async function searchVault(popup: Page, query: string) {
  await vaultRegion(popup)
    .getByRole("searchbox", { name: "Search your vault" })
    .fill(query)
  return popup.getByRole("list", { name: "Search results" })
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
  await expect(vaultRegion(popup)).toBeHidden()
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
  await expect(vaultRegion(popup)).toBeVisible({ timeout: 15_000 })
  const results = await searchVault(popup, "student")
  await expect(results.getByRole("listitem")).toHaveText([
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
  await expect(vaultRegion(popup)).toBeHidden()
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
  await expect(vaultRegion(popup)).toBeHidden()
  await unlockPopup(popup)
  await expect(await searchVault(popup, "library")).toContainText(
    "student-library"
  )

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
  await expect(await searchVault(popup, "library")).toContainText(
    "student-library"
  )
  await appTab.goto("/vault")
  await unlockVault(appTab)
  await expect(appTab.getByText("student-library").first()).toBeVisible()

  // Signing out in the popup signs out the app: returning to its tab closes
  // the vault there too.
  await popup
    .getByRole("region", { name: "Your vault", exact: true })
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

test("the toolbar popup lists the logins for the current website and searches the rest", async () => {
  // Signed in to the app in this Chrome profile, as its first device.
  const appTab = await context.newPage()
  const account = await registerAccount(appTab)
  await saveVault(context.request, account.email, [
    credential("Grades", "student-grades", "http://127.0.0.1:3100/vault"),
    credential("Dashboard", "student-dashboard", "127.0.0.1"),
    credential("Library", "student-library", "library.example.test"),
    credential("Dev server", "student-dev", "localhost"),
  ])
  await appTab.goto("/sign-in")

  const onSite = await openToolbarPopup(appTab)
  await unlockPopup(onSite.popup)
  await expect(
    onSite.popup.getByRole("heading", { name: "Saved for 127.0.0.1" })
  ).toBeVisible()
  const forSite = onSite.popup.getByRole("list", {
    name: "Logins for this website",
  })
  await expect(forSite.getByRole("listitem")).toHaveText([
    /Dashboard\s*student-dashboard/,
    /Grades\s*student-grades/,
  ])

  // Search finds the other logins by account name, website, or username.
  let results = await searchVault(onSite.popup, "library.example")
  await expect(results.getByRole("listitem")).toHaveText([
    /Library\s*student-library/,
  ])
  await expect(forSite).toBeHidden()
  results = await searchVault(onSite.popup, "DEV SERVER")
  await expect(results.getByRole("listitem")).toHaveText([/Dev server/])
  results = await searchVault(onSite.popup, "student-dev")
  await expect(results.getByRole("listitem")).toHaveText([/Dev server/])
  await searchVault(onSite.popup, "no such login")
  await expect(
    onSite.popup.getByText("No logins match your search.")
  ).toBeVisible()
  await searchVault(onSite.popup, "")
  await expect(forSite.getByRole("listitem")).toHaveCount(2)

  // Locking hides every login and the search.
  await vaultRegion(onSite.popup).getByRole("button", { name: "Lock" }).click()
  await expect(
    onSite.popup.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible()
  await expect(onSite.popup.getByText("student-")).toHaveCount(0)
  await onSite.popup.close()
  await onSite.disconnect()

  // A browser page has no website: nothing is suggested, but search works.
  const settingsTab = await context.newPage()
  await settingsTab.goto("chrome://version")
  const offSite = await openToolbarPopup(settingsTab)
  await unlockPopup(offSite.popup)
  await expect(
    vaultRegion(offSite.popup).getByText("Search to find a saved login.")
  ).toBeVisible()
  await expect(
    offSite.popup.getByRole("list", { name: "Logins for this website" })
  ).toBeHidden()
  results = await searchVault(offSite.popup, "grades")
  await expect(results.getByRole("listitem")).toHaveText([/Grades/])
  await offSite.popup.close()
  await offSite.disconnect()
})

// Sign-in pages for the fill tests. They are served on the app's origin, the
// only site the extension may reach without a real toolbar click (see
// openToolbarPopup). Each page records the input and change events it sees.
const RECORD_EVENTS = `<script>
  window.events = []
  for (const type of ["input", "change"])
    document.addEventListener(type, (event) => events.push(type + ":" + event.target.name), true)
</script>`

const SIGN_IN_PAGE = `<!doctype html>
<title>Sign in</title>
<form>
  <label>Email <input name="email" type="email" autocomplete="username" /></label>
  <!-- Traps a careless filler would pick: closer to the password, or first. -->
  <input name="trap-username" autocomplete="username" style="display:none" />
  <input name="trap-password" type="password" autocomplete="current-password" style="position:absolute;left:-9999px" />
  <label>Password <input name="password" type="password" autocomplete="current-password" /></label>
  <button>Sign in</button>
</form>
<iframe title="Embedded sign-in" srcdoc="<input name='email' type='email' autocomplete='username'><input name='password' type='password'>"></iframe>
${RECORD_EVENTS}`

const TWO_STEP_PAGE = `<!doctype html>
<title>Sign in</title>
<form id="first">
  <label>Email <input name="email" type="email" autocomplete="username" /></label>
  <button id="next" type="button">Next</button>
</form>
<form id="second" hidden>
  <label>Password <input name="password" type="password" autocomplete="current-password" /></label>
  <button>Sign in</button>
</form>
<script>
  next.onclick = () => { first.hidden = true; second.hidden = false }
</script>
${RECORD_EVENTS}`

async function signInPage(html: string) {
  const path = `/e2e-sign-in-${crypto.randomUUID()}`
  await context.route(`${appOrigin}${path}`, (route) =>
    route.fulfill({ contentType: "text/html", body: html })
  )
  const page = await context.newPage()
  await page.goto(path)
  return page
}

async function fillAccount() {
  const appTab = await context.newPage()
  const account = await registerAccount(appTab)
  await saveVault(context.request, account.email, [
    credential("Grades", "student-grades", "127.0.0.1"),
    credential("Library", "student-library", "library.example.test"),
  ])
  await appTab.close()
  return account
}

function fillStatus(popup: Page) {
  return vaultRegion(popup).getByRole("status")
}

test("choosing a login fills the visible sign-in fields on the page, and nothing else", async () => {
  await fillAccount()
  const page = await signInPage(SIGN_IN_PAGE)
  const { popup, disconnect } = await openToolbarPopup(page)
  await unlockPopup(popup)
  const grades = popup.getByRole("button", {
    name: "Fill Grades, student-grades",
  })
  await expect(grades).toBeVisible()

  // Unlocking alone fills nothing.
  await expect(page.getByLabel("Email")).toHaveValue("")
  await expect(page.getByLabel("Password")).toHaveValue("")

  // A login for another site is refused.
  const results = await searchVault(popup, "library")
  await results.getByRole("button", { name: /^Fill Library/ }).click()
  await expect(fillStatus(popup)).toHaveText(
    "This login is for library.example.test, not 127.0.0.1, so it wasn't filled."
  )
  await expect(page.getByLabel("Email")).toHaveValue("")
  await expect(page.getByLabel("Password")).toHaveValue("")

  await searchVault(popup, "")
  await grades.click()
  await expect(fillStatus(popup)).toHaveText(
    "Filled your username and password."
  )
  await expect(page.getByLabel("Email")).toHaveValue("student-grades")
  await expect(page.getByLabel("Password")).toHaveValue(
    "student-grades-password-123"
  )
  // Pages see the change as if it was typed.
  expect(
    await page.evaluate(() => (window as never as { events: string[] }).events)
  ).toEqual([
    "input:email",
    "change:email",
    "input:password",
    "change:password",
  ])
  // Hidden and off-screen fields, and the embedded frame, stay empty.
  for (const name of ["trap-username", "trap-password"])
    await expect(page.locator(`input[name="${name}"]`)).toHaveValue("")
  const frame = page.frameLocator('iframe[title="Embedded sign-in"]')
  await expect(frame.locator('input[name="email"]')).toHaveValue("")
  await expect(frame.locator('input[name="password"]')).toHaveValue("")
  // The popup never shows the password.
  await expect(popup.getByText("student-grades-password-123")).toHaveCount(0)

  await popup.close()
  await disconnect()
})

test("a two-step sign-in is filled one step at a time", async () => {
  await fillAccount()
  const page = await signInPage(TWO_STEP_PAGE)

  const first = await openToolbarPopup(page)
  await unlockPopup(first.popup)
  await first.popup
    .getByRole("button", { name: "Fill Grades, student-grades" })
    .click()
  await expect(fillStatus(first.popup)).toHaveText(
    "Filled your username. When the page asks for your password, open the extension and choose this login again."
  )
  await expect(page.getByLabel("Email")).toHaveValue("student-grades")
  await expect(page.locator('input[name="password"]')).toHaveValue("")
  // Closing the popup forgets the vault; the next step asks again.
  await first.popup.close()
  await first.disconnect()

  await page.getByRole("button", { name: "Next" }).click()
  await expect(page.getByLabel("Password")).toBeVisible()

  const second = await openToolbarPopup(page)
  await expect(
    second.popup.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible()
  await unlockPopup(second.popup)
  await second.popup
    .getByRole("button", { name: "Fill Grades, student-grades" })
    .click()
  await expect(fillStatus(second.popup)).toHaveText("Filled your password.")
  await expect(page.getByLabel("Password")).toHaveValue(
    "student-grades-password-123"
  )
  // The hidden email field from the first step was not filled again.
  expect(
    await page.evaluate(() => (window as never as { events: string[] }).events)
  ).toEqual([
    "input:email",
    "change:email",
    "input:password",
    "change:password",
  ])
  await second.popup.close()
  await second.disconnect()
})
