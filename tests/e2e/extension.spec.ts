import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { chromium, expect, test, type BrowserContext } from "@playwright/test"

import { EXTENSION_ID } from "../../extension/identity"
import { accountProof } from "./account-helpers"
import { setTestClientIp } from "./fixtures"

const appOrigin = "http://127.0.0.1:3100"
const popupUrl = `chrome-extension://${EXTENSION_ID}/popup.html`

// Extensions load only in desktop Chromium, so one project covers this file.
test.skip(({ isMobile }) => isMobile, "Chrome extensions are desktop-only")

let extensionDir: string
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
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  })
})

test.afterEach(async () => {
  await context?.close()
})

test.afterAll(() => {
  rmSync(extensionDir, { recursive: true, force: true })
})

test("the popup reaches the app with the browser's session and an allowed origin", async () => {
  const worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  expect(worker.url()).toBe(`chrome-extension://${EXTENSION_ID}/background.js`)

  const popup = await context.newPage()
  await popup.goto(popupUrl)
  await expect(popup.getByRole("status")).toHaveText("You're not signed in.")
  await expect(popup.getByRole("button", { name: "Sign in" })).toBeVisible()

  // Sign in through the app; the extension shares this browser's cookies.
  const clientIp = await setTestClientIp(context)
  const email = `extension-${crypto.randomUUID()}@example.test`
  const proof = await accountProof(email)
  const registered = await context.request.post(
    `${appOrigin}/api/auth/register`,
    {
      headers: { Origin: appOrigin, "x-e2e-client-ip": clientIp },
      data: proof,
    }
  )
  expect(registered.status()).toBe(201)

  await popup.reload()
  await expect(popup.getByRole("status")).toHaveText(`Signed in as ${email}`)

  // An extension the server does not list is still rejected.
  const forged = await context.request.post(`${appOrigin}/api/auth/logout`, {
    headers: { Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" },
  })
  expect(forged.status()).toBe(403)

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
  await expect(popup.getByRole("status")).toHaveText("You're not signed in.")

  // A session cookie set in response to the extension is kept by the browser.
  // Sign-in sends the key derived from the password, as the app does.
  const signIn = await popup.evaluate(
    async ({ origin, email, authKey, clientIp }) => {
      const response = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-e2e-client-ip": clientIp,
        },
        body: JSON.stringify({ email, authKey }),
      })
      return response.status
    },
    { origin: appOrigin, email, authKey: proof.authKey, clientIp }
  )
  expect(signIn).toBe(200)

  await popup.reload()
  await expect(popup.getByRole("status")).toHaveText(`Signed in as ${email}`)
})
