import { describe, expect, it } from "bun:test"
import path from "node:path"

import { parseAppOrigin } from "../../../extension/app-origin"
import {
  EXTENSION_ID,
  EXTENSION_ORIGIN,
  EXTENSION_PUBLIC_KEY,
  extensionIdFromKey,
} from "../../../extension/identity"
import { fetchSession } from "../../../extension/src/api"
import {
  decryptVault,
  encryptVault,
  VaultUnlockError,
  type VaultDataV1,
} from "../../../extension/src/vault"

const root = path.resolve(import.meta.dir, "../../..")

describe("extension identity", () => {
  it("pins the documented extension ID with the manifest key", () => {
    // Computed independently: base64 -d key | sha256sum | first 32 hex as a-p.
    expect(EXTENSION_ID).toBe("ibfocpogcdoolfmhcmnkiojgfpbkfbgj")
    expect(EXTENSION_ORIGIN).toBe(`chrome-extension://${EXTENSION_ID}`)
    expect(extensionIdFromKey(EXTENSION_PUBLIC_KEY)).toMatch(/^[a-p]{32}$/)
  })
})

describe("extension app origin", () => {
  it("accepts exact HTTPS origins and local HTTP servers", () => {
    expect(parseAppOrigin("https://app.example.test")).toBe(
      "https://app.example.test"
    )
    expect(parseAppOrigin("http://localhost:3000")).toBe(
      "http://localhost:3000"
    )
    expect(parseAppOrigin("http://127.0.0.1:3100")).toBe(
      "http://127.0.0.1:3100"
    )
  })

  it("rejects paths, trailing slashes, and remote plain HTTP", () => {
    for (const value of [
      "https://app.example.test/",
      "https://app.example.test/api",
      "http://app.example.test",
      "app.example.test",
    ])
      expect(() => parseAppOrigin(value)).toThrow()
  })
})

describe("extension session check", () => {
  const respond = (status: number, body: unknown = {}) =>
    (async () => Response.json(body, { status })) as unknown as typeof fetch

  it("reports the signed-in account, a signed-out browser, or an outage", async () => {
    let requested: [string, RequestInit | undefined] | undefined
    const signedIn = (async (url: string, init?: RequestInit) => {
      requested = [url, init]
      return Response.json({ user: { id: "1", email: "a@example.test" } })
    }) as unknown as typeof fetch

    expect(await fetchSession("https://app.example.test", signedIn)).toEqual({
      state: "signed-in",
      email: "a@example.test",
    })
    expect(requested?.[0]).toBe("https://app.example.test/api/auth/session")
    expect(requested?.[1]?.credentials).toBe("include")
    expect(await fetchSession("https://x.test", respond(401))).toEqual({
      state: "signed-out",
    })
    expect(await fetchSession("https://x.test", respond(503))).toEqual({
      state: "unavailable",
    })
    expect(await fetchSession("https://x.test", respond(200, {}))).toEqual({
      state: "unavailable",
    })
    const offline = (async () => {
      throw new TypeError("Failed to fetch")
    }) as unknown as typeof fetch
    expect(await fetchSession("https://x.test", offline)).toEqual({
      state: "unavailable",
    })
  })
})

describe("shared vault encryption in the extension", () => {
  const data: VaultDataV1 = { version: 1, credentials: [] }

  it("round-trips a vault through the web app's encryption module", async () => {
    const envelope = await encryptVault("extension passphrase", data)
    expect(await decryptVault("extension passphrase", envelope)).toEqual(data)
    await expect(
      decryptVault("wrong passphrase", envelope)
    ).rejects.toBeInstanceOf(VaultUnlockError)
  })

  it("bundles the shared module for the browser without Node built-ins", async () => {
    const result = await Bun.build({
      entrypoints: [path.join(root, "extension/src/vault.ts")],
      target: "browser",
      format: "esm",
    })
    expect(result.success).toBe(true)
    const code = await result.outputs[0].text()
    expect(code).toContain("AES-GCM")
    expect(code).not.toMatch(/from\s*["']node:/)
  })
})
