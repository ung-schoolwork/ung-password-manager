import { describe, expect, it } from "bun:test"

import {
  fetchDevice,
  fetchRevision,
  fetchVault,
  handleRequest,
  isExtensionRequest,
  saveVault,
  signIn,
  signOut,
} from "../../../extension/src/api"

const origin = "https://app.example.test"
const revision = "3f2b8c1e-7a4d-4e5f-9a1b-2c3d4e5f6a7b"
const wrappedVaultKey = {
  version: 1,
  cipher: { name: "AES-GCM", iv: btoa("i".repeat(12)) },
  wrappedKey: btoa("k".repeat(48)),
}
const envelope = {
  version: 2,
  cipher: { name: "AES-GCM", iv: btoa("v".repeat(12)) },
  ciphertext: btoa("c".repeat(32)),
}

type Seen = { url: string; init?: RequestInit }

function server(status: number, body: unknown = {}, seen: Seen[] = []) {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, init })
    return Response.json(body, { status })
  }) as unknown as typeof fetch
}

describe("extension requests", () => {
  it("accepts only known request types and a well-formed auth key", () => {
    for (const type of ["session", "sign-out", "device", "vault", "revision"])
      expect(isExtensionRequest({ type })).toBe(true)
    expect(
      isExtensionRequest({
        type: "sign-in",
        email: "a@example.test",
        authKey: "a".repeat(64),
      })
    ).toBe(true)
    for (const value of [
      null,
      "session",
      { type: "logout" },
      { type: "sign-in", email: "a@example.test" },
      { type: "sign-in", email: "a@example.test", authKey: "password" },
      { type: "sign-in", email: 1, authKey: "a".repeat(64) },
    ])
      expect(isExtensionRequest(value)).toBe(false)
  })
})

describe("extension sign-in and sign-out", () => {
  it("sends only the email and auth key, with the browser's cookies", async () => {
    const seen: Seen[] = []
    const result = await signIn(
      origin,
      { email: "a@example.test", authKey: "b".repeat(64) },
      server(200, { user: { id: "u1", email: "a@example.test" } }, seen)
    )
    expect(result).toEqual({
      state: "signed-in",
      userId: "u1",
      email: "a@example.test",
    })
    expect(seen[0].url).toBe(`${origin}/api/auth/login`)
    expect(seen[0].init?.method).toBe("POST")
    expect(seen[0].init?.credentials).toBe("include")
    expect(JSON.parse(String(seen[0].init?.body))).toEqual({
      email: "a@example.test",
      authKey: "b".repeat(64),
    })
  })

  it("maps failed sign-ins to what the popup shows", async () => {
    const proof = { email: "a@example.test", authKey: "b".repeat(64) }
    expect(await signIn(origin, proof, server(401))).toEqual({
      state: "rejected",
    })
    expect(await signIn(origin, proof, server(400))).toEqual({
      state: "rejected",
    })
    expect(await signIn(origin, proof, server(429))).toEqual({
      state: "throttled",
    })
    expect(await signIn(origin, proof, server(403))).toEqual({
      state: "unavailable",
    })
    expect(await signIn(origin, proof, server(200, {}))).toEqual({
      state: "unavailable",
    })
  })

  it("signs out through the app's logout route", async () => {
    const seen: Seen[] = []
    expect(await signOut(origin, server(200, { ok: true }, seen))).toEqual({
      state: "signed-out",
    })
    expect(seen[0].url).toBe(`${origin}/api/auth/logout`)
    expect(seen[0].init?.method).toBe("POST")
    expect(await signOut(origin, server(503))).toEqual({ state: "unavailable" })
  })
})

describe("extension device and vault access", () => {
  it("registers this browser as the app's device and reports its state", async () => {
    const seen: Seen[] = []
    expect(
      await fetchDevice(
        origin,
        server(200, { approved: true, deviceId: "d" }, seen)
      )
    ).toEqual({ state: "approved" })
    expect(seen[0].url).toBe(`${origin}/api/devices`)
    expect(seen[0].init?.method).toBe("POST")
    expect(
      await fetchDevice(
        origin,
        server(200, {
          approved: false,
          deviceId: "d",
          code: "12345678",
          expiresAt: "2026-11-05T10:00:00.000Z",
        })
      )
    ).toEqual({
      state: "pending",
      code: "12345678",
      expiresAt: "2026-11-05T10:00:00.000Z",
    })
    expect(await fetchDevice(origin, server(401))).toEqual({
      state: "signed-out",
    })
    expect(
      await fetchDevice(origin, server(200, { approved: false, code: "x" }))
    ).toEqual({ state: "unavailable" })
  })

  it("returns the encrypted vault only when it is well formed", async () => {
    expect(
      await fetchVault(
        origin,
        server(200, { wrappedVaultKey, envelope, revision })
      )
    ).toEqual({
      state: "ok",
      snapshot: { wrappedVaultKey, envelope, revision },
    } as never)
    expect(
      await fetchVault(
        origin,
        server(200, { wrappedVaultKey, envelope: null, revision: null })
      )
    ).toEqual({
      state: "ok",
      snapshot: { wrappedVaultKey, envelope: null, revision: null },
    } as never)
    expect(
      await fetchVault(
        origin,
        server(200, { wrappedVaultKey, envelope, revision: null })
      )
    ).toEqual({ state: "unavailable" })
    expect(
      await fetchVault(origin, server(200, { envelope, revision }))
    ).toEqual({ state: "unavailable" })
  })

  it("treats 401 as signed out and 403 as a device that may not open the vault", async () => {
    for (const read of [fetchVault, fetchRevision]) {
      expect(await read(origin, server(401))).toEqual({ state: "signed-out" })
      expect(await read(origin, server(403))).toEqual({
        state: "not-approved",
      })
      expect(await read(origin, server(503))).toEqual({
        state: "unavailable",
      })
    }
    expect(await fetchRevision(origin, server(200, { revision }))).toEqual({
      state: "ok",
      revision,
    })
    expect(
      await fetchRevision(origin, server(200, { revision: null }))
    ).toEqual({ state: "ok", revision: null })
    expect(
      await fetchRevision(origin, server(200, { revision: "nope" }))
    ).toEqual({ state: "unavailable" })
  })

  it("routes each popup request to its endpoint", async () => {
    const paths: Record<string, string> = {
      session: "/api/auth/session",
      "sign-out": "/api/auth/logout",
      device: "/api/devices",
      vault: "/api/vault",
      revision: "/api/vault/revision",
    }
    for (const [type, path] of Object.entries(paths)) {
      const seen: Seen[] = []
      await handleRequest(
        origin,
        { type } as Parameters<typeof handleRequest>[1],
        server(503, {}, seen)
      )
      expect(seen.map((request) => request.url)).toEqual([`${origin}${path}`])
    }
  })
})

describe("extension vault saves", () => {
  it("accepts only a well-formed encrypted vault to save", () => {
    expect(
      isExtensionRequest({
        type: "save-vault",
        envelope,
        expectedRevision: revision,
      })
    ).toBe(true)
    expect(
      isExtensionRequest({
        type: "save-vault",
        envelope,
        expectedRevision: null,
      })
    ).toBe(true)
    for (const value of [
      { type: "save-vault", envelope },
      { type: "save-vault", envelope, expectedRevision: "1" },
      {
        type: "save-vault",
        envelope: { ...envelope, ciphertext: "not base64!" },
        expectedRevision: revision,
      },
      {
        type: "save-vault",
        envelope: { credentials: [{ password: "plain" }] },
        expectedRevision: revision,
      },
    ])
      expect(isExtensionRequest(value)).toBe(false)
  })

  it("puts only the envelope and revision, and reports conflicts", async () => {
    const seen: Seen[] = []
    const next = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d"
    expect(
      await saveVault(
        origin,
        { envelope: envelope as never, expectedRevision: revision },
        server(200, { revision: next }, seen)
      )
    ).toEqual({ state: "saved", revision: next })
    expect(seen[0].url).toBe(`${origin}/api/vault`)
    expect(seen[0].init?.method).toBe("PUT")
    expect(seen[0].init?.credentials).toBe("include")
    expect(JSON.parse(String(seen[0].init?.body))).toEqual({
      envelope,
      expectedRevision: revision,
    })

    const write = { envelope: envelope as never, expectedRevision: revision }
    expect(await saveVault(origin, write, server(409))).toEqual({
      state: "conflict",
    })
    expect(await saveVault(origin, write, server(401))).toEqual({
      state: "signed-out",
    })
    expect(await saveVault(origin, write, server(403))).toEqual({
      state: "not-approved",
    })
    expect(await saveVault(origin, write, server(503))).toEqual({
      state: "unavailable",
    })
    expect(await saveVault(origin, write, server(200, {}))).toEqual({
      state: "unavailable",
    })
  })
})
