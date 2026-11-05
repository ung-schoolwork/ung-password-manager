import { describe, expect, it } from "bun:test"
import { hkdfSync, pbkdf2Sync } from "node:crypto"

import {
  PBKDF2_ITERATIONS,
  VaultUnlockError,
  createWrappedVaultKey,
  decryptVault,
  deriveAccountKeys,
  encryptVault,
  rewrapVaultKey,
  unwrapVaultKey,
} from "../../../lib/vault/crypto.client"
import { parseWrappedVaultKey } from "../../../lib/vault/remote"
import { VAULT_DATA_VERSION, type VaultDataV1 } from "../../../lib/vault/types"

const email = "student@example.edu"
const password = "correct horse battery staple"
const vaultData: VaultDataV1 = {
  version: VAULT_DATA_VERSION,
  credentials: [
    {
      id: "credential-1",
      accountName: "University email",
      siteOrApp: "mail.example.edu",
      username: "student@example.edu",
      password: "NotARealPassword!42",
      notes: "Demo content only",
      createdAt: "2026-09-22T00:00:00.000Z",
      updatedAt: "2026-09-22T00:00:00.000Z",
      passwordUpdatedAt: "2026-09-22T00:00:00.000Z",
    },
  ],
}

async function openedVaultKey(accountPassword = password) {
  const { wrappingKey } = await deriveAccountKeys(email, accountPassword)
  const wrapped = await createWrappedVaultKey(wrappingKey)
  return {
    wrapped,
    wrappingKey,
    vaultKey: await unwrapVaultKey(wrappingKey, wrapped),
  }
}

describe("account key derivation", () => {
  it("matches the documented PBKDF2 and HKDF derivation", async () => {
    const { authKey } = await deriveAccountKeys(email, password)
    const secret = pbkdf2Sync(
      password,
      `ung-password-manager:account:v1:${email}`,
      PBKDF2_ITERATIONS,
      32,
      "sha256"
    )
    const expected = Buffer.from(
      hkdfSync(
        "sha256",
        secret,
        Buffer.alloc(0),
        "ung-password-manager:auth-key:v1",
        32
      )
    ).toString("hex")

    expect(authKey).toBe(expected)
    // A fixed vector, so other clients can check they derive the same key.
    expect(authKey).toBe(
      "e16cff4973e448ce4a67d40dc43aeb6ba0ef7320617e5c80dc9362a877c67f33"
    )
  })

  it("normalizes the email the same way the server does", async () => {
    const plain = await deriveAccountKeys(email, password)
    const spaced = await deriveAccountKeys(" Student@Example.EDU ", password)

    expect(spaced.authKey).toBe(plain.authKey)
  })

  it("binds the auth key to both the email and the password", async () => {
    const { authKey } = await deriveAccountKeys(email, password)

    expect(authKey).toMatch(/^[0-9a-f]{64}$/)
    expect(authKey).not.toContain(password)
    expect(
      (await deriveAccountKeys("other@example.edu", password)).authKey
    ).not.toBe(authKey)
    expect((await deriveAccountKeys(email, `${password}!`)).authKey).not.toBe(
      authKey
    )
  })

  it("keeps the wrapping key inside the browser", async () => {
    const { wrappingKey } = await deriveAccountKeys(email, password)

    expect(wrappingKey.extractable).toBe(false)
    await expect(crypto.subtle.exportKey("raw", wrappingKey)).rejects.toThrow()
  })
})

describe("vault key wrapping", () => {
  it("creates a wrapped vault key the server accepts and the password opens", async () => {
    const { wrapped, vaultKey } = await openedVaultKey()

    expect(parseWrappedVaultKey(wrapped)).toEqual(wrapped)
    expect(vaultKey.extractable).toBe(false)
    const envelope = await encryptVault(vaultKey, vaultData)
    await expect(decryptVault(vaultKey, envelope)).resolves.toEqual(vaultData)
  })

  it("rejects the wrong password", async () => {
    const { wrapped } = await openedVaultKey()
    const wrong = await deriveAccountKeys(email, "this is the wrong password")

    await expect(
      unwrapVaultKey(wrong.wrappingKey, wrapped)
    ).rejects.toBeInstanceOf(VaultUnlockError)
  })

  it("re-wraps the same vault key for a new password without re-encrypting the vault", async () => {
    const { wrapped, wrappingKey, vaultKey } = await openedVaultKey()
    const envelope = await encryptVault(vaultKey, vaultData)
    const next = await deriveAccountKeys(email, "a brand new password 123")

    const rewrapped = await rewrapVaultKey(
      wrapped,
      wrappingKey,
      next.wrappingKey
    )

    const reopened = await unwrapVaultKey(next.wrappingKey, rewrapped)
    await expect(decryptVault(reopened, envelope)).resolves.toEqual(vaultData)
    await expect(unwrapVaultKey(wrappingKey, rewrapped)).rejects.toBeInstanceOf(
      VaultUnlockError
    )
  })
})

describe("vault encryption", () => {
  it("does not expose credential plaintext in the serialized envelope", async () => {
    const { vaultKey } = await openedVaultKey()
    const envelope = await encryptVault(vaultKey, vaultData)
    const serialized = JSON.stringify(envelope)

    for (const secret of [
      "University email",
      "mail.example.edu",
      "student@example.edu",
      "NotARealPassword!42",
      "Demo content only",
    ]) {
      expect(serialized).not.toContain(secret)
    }
  })

  it("uses a fresh IV for every save", async () => {
    const { vaultKey } = await openedVaultKey()
    const first = await encryptVault(vaultKey, vaultData)
    const second = await encryptVault(vaultKey, vaultData)

    expect(first.cipher.iv).not.toBe(second.cipher.iv)
    expect(first.ciphertext).not.toBe(second.ciphertext)
  })

  it("rejects another account's vault key", async () => {
    const { vaultKey } = await openedVaultKey()
    const other = await openedVaultKey()
    const envelope = await encryptVault(vaultKey, vaultData)

    await expect(decryptVault(other.vaultKey, envelope)).rejects.toBeInstanceOf(
      VaultUnlockError
    )
  })

  it("rejects modified ciphertext", async () => {
    const { vaultKey } = await openedVaultKey()
    const envelope = await encryptVault(vaultKey, vaultData)
    const firstCharacter = envelope.ciphertext[0] === "A" ? "B" : "A"
    const modified = {
      ...envelope,
      ciphertext: firstCharacter + envelope.ciphertext.slice(1),
    }

    await expect(decryptVault(vaultKey, modified)).rejects.toBeInstanceOf(
      VaultUnlockError
    )
  })
})
