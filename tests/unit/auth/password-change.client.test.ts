import { afterEach, describe, expect, it } from "bun:test"

import {
  changeAccountPassword,
  PASSWORD_CHANGE_MESSAGES,
  PasswordChangeError,
  prepareAccountPasswordChange,
  validatePasswordChange,
} from "../../../lib/auth/password-change.client"
import {
  createWrappedVaultKey,
  decryptVault,
  deriveAccountKeys,
  encryptVault,
  unwrapVaultKey,
  VaultUnlockError,
} from "../../../lib/vault/crypto.client"
import {
  VAULT_DATA_VERSION,
  type VaultDataV1,
  type VaultEnvelope,
  type WrappedVaultKey,
} from "../../../lib/vault/types"

const email = "student@example.edu"
const current = "current password 123"
const next = "a brand new password 456"
const data: VaultDataV1 = {
  version: VAULT_DATA_VERSION,
  credentials: [
    {
      id: "credential-1",
      accountName: "Library",
      siteOrApp: "library.example.edu",
      username: "student",
      password: "NotARealPassword!42",
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
      passwordUpdatedAt: "2026-11-01T00:00:00.000Z",
    },
  ],
}

async function account(withVault = true) {
  const { wrappingKey } = await deriveAccountKeys(email, current)
  const wrappedVaultKey = await createWrappedVaultKey(wrappingKey)
  const vaultKey = await unwrapVaultKey(wrappingKey, wrappedVaultKey)
  const envelope = withVault ? await encryptVault(vaultKey, data) : null
  return { wrappedVaultKey, envelope }
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise
  } catch (caught) {
    return caught as PasswordChangeError
  }
  throw new Error("Expected a rejection")
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function server(
  stored: { wrappedVaultKey: WrappedVaultKey; envelope: VaultEnvelope | null },
  change: { status: number; body: object; headers?: Record<string, string> }
) {
  const sent: { url: string; body: Record<string, unknown> | null }[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    sent.push({
      url,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    })
    if (url === "/api/vault")
      return Response.json({
        ...stored,
        revision: stored.envelope ? crypto.randomUUID() : null,
      })
    if (url === "/api/auth/password")
      return Response.json(change.body, {
        status: change.status,
        headers: change.headers,
      })
    return Response.json({ ok: true })
  }) as typeof fetch
  return sent
}

describe("password change form rules", () => {
  it("uses registration's password rules and requires a matching confirmation", () => {
    expect(validatePasswordChange("", "", "")).toEqual({
      current: PASSWORD_CHANGE_MESSAGES.currentRequired,
      next: PASSWORD_CHANGE_MESSAGES.newRequired,
      confirmation: PASSWORD_CHANGE_MESSAGES.confirmationRequired,
    })
    expect(validatePasswordChange(current, "short", "short")).toEqual({
      next: "Use at least 12 characters for your password.",
    })
    expect(
      validatePasswordChange(current, "p".repeat(129), "p".repeat(129))
    ).toEqual({ next: "Use no more than 128 characters for your password." })
    expect(validatePasswordChange(current, next, `${next}!`)).toEqual({
      confirmation: PASSWORD_CHANGE_MESSAGES.confirmationMismatch,
    })
    expect(validatePasswordChange(current, current, current)).toEqual({
      next: PASSWORD_CHANGE_MESSAGES.unchanged,
    })
    expect(validatePasswordChange(current, next, next)).toEqual({})
  })
})

describe("re-wrapping the vault key in the browser", () => {
  it("re-wraps the same vault key so only the new password opens the saved vault", async () => {
    const stored = await account()
    const change = await prepareAccountPasswordChange(
      email,
      current,
      next,
      async () => stored
    )
    const oldKeys = await deriveAccountKeys(email, current)
    const newKeys = await deriveAccountKeys(email, next)
    // The server receives exactly what sign-in and registration send.
    expect(Object.keys(change).sort()).toEqual([
      "authKey",
      "currentAuthKey",
      "wrappedVaultKey",
    ])
    expect(change.currentAuthKey).toBe(oldKeys.authKey)
    expect(change.authKey).toBe(newKeys.authKey)
    expect(change.wrappedVaultKey).not.toEqual(stored.wrappedVaultKey)

    const vaultKey = await unwrapVaultKey(
      newKeys.wrappingKey,
      change.wrappedVaultKey
    )
    expect(await decryptVault(vaultKey, stored.envelope!)).toEqual(data)
    await expect(
      unwrapVaultKey(oldKeys.wrappingKey, change.wrappedVaultKey)
    ).rejects.toBeInstanceOf(VaultUnlockError)
  })

  it("works for an account that has not saved anything yet", async () => {
    const stored = await account(false)
    const change = await prepareAccountPasswordChange(
      email,
      current,
      next,
      async () => stored
    )
    const { wrappingKey } = await deriveAccountKeys(email, next)
    await expect(
      unwrapVaultKey(wrappingKey, change.wrappedVaultKey)
    ).resolves.toBeDefined()
  })

  it("rejects a wrong current password before anything is sent", async () => {
    const stored = await account()
    const caught = await rejection(
      prepareAccountPasswordChange(
        email,
        "not the right password",
        next,
        async () => stored
      )
    )
    expect(caught).toBeInstanceOf(PasswordChangeError)
    expect(caught.message).toBe(PASSWORD_CHANGE_MESSAGES.wrongPassword)
    expect(caught.field).toBe("current")
  })

  it("refuses to send a key that does not open the saved vault", async () => {
    const stored = await account()
    // A vault encrypted with some other key: the re-wrap must not be trusted.
    const other = await account()
    const caught = await rejection(
      prepareAccountPasswordChange(email, current, next, async () => ({
        wrappedVaultKey: stored.wrappedVaultKey,
        envelope: other.envelope,
      }))
    )
    expect(caught.message).toBe(PASSWORD_CHANGE_MESSAGES.vaultMismatch)
  })
})

describe("changing the password through the server", () => {
  it("sends only auth keys and the re-wrapped vault key, never a password", async () => {
    const stored = await account()
    const session = {
      user: { id: "user-1", email },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }
    const sent = server(stored, { status: 200, body: session })
    expect(await changeAccountPassword(email, current, next)).toEqual(session)
    const request = sent.find((entry) => entry.url === "/api/auth/password")!
    const serialized = JSON.stringify(request.body)
    expect(serialized).not.toContain(current)
    expect(serialized).not.toContain(next)
    expect(Object.keys(request.body!).sort()).toEqual([
      "authKey",
      "currentAuthKey",
      "wrappedVaultKey",
    ])
  })

  it("shows clear messages for server failures", async () => {
    const stored = await account()
    const cases: [number, object, string, Record<string, string>?][] = [
      [
        401,
        { error: "Invalid credentials" },
        PASSWORD_CHANGE_MESSAGES.wrongPassword,
      ],
      [
        401,
        { error: "Not authenticated" },
        PASSWORD_CHANGE_MESSAGES.sessionEnded,
      ],
      [
        403,
        { error: "Device not approved" },
        PASSWORD_CHANGE_MESSAGES.deviceNotApproved,
      ],
      [409, { error: "Account changed" }, PASSWORD_CHANGE_MESSAGES.conflict],
      [
        503,
        { error: "Password changed but sign-in failed. Please sign in." },
        PASSWORD_CHANGE_MESSAGES.changedSignedOut,
      ],
      [
        503,
        { error: "Service unavailable" },
        "The server is unavailable right now. Try again in a few moments.",
      ],
      [
        503,
        { error: "Sign-in is temporarily unavailable." },
        "The server is unavailable right now. Try again in a few moments.",
      ],
      [
        429,
        { error: "Too many attempts" },
        "Too many attempts. Wait 2 minutes before trying again.",
        { "Retry-After": "120" },
      ],
    ]
    for (const [status, body, message, headers] of cases) {
      server(stored, { status, body, headers })
      const caught = await rejection(
        changeAccountPassword(email, current, next)
      )
      expect(caught.message).toBe(message)
    }
  }, 30_000)

  it("does not contact the password route when this device is not approved", async () => {
    const sent: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      sent.push(String(input))
      return Response.json({ error: "Device not approved" }, { status: 403 })
    }) as typeof fetch
    const caught = await rejection(changeAccountPassword(email, current, next))
    expect(caught.message).toBe(PASSWORD_CHANGE_MESSAGES.deviceNotApproved)
    expect(sent).toEqual(["/api/vault"])
  })
})
