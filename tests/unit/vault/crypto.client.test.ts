import { describe, expect, it } from "bun:test"

import {
  VaultUnlockError,
  decryptVault,
  encryptVault,
} from "../../../lib/vault/crypto.client"
import {
  VAULT_DATA_VERSION,
  type VaultDataV1,
} from "../../../lib/vault/types"

const passphrase = "correct horse battery staple"
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

describe("vault encryption", () => {
  it("round-trips a vault through authenticated encryption", async () => {
    const envelope = await encryptVault(passphrase, vaultData)

    await expect(decryptVault(passphrase, envelope)).resolves.toEqual(vaultData)
  })

  it("does not expose credential plaintext in the serialized envelope", async () => {
    const envelope = await encryptVault(passphrase, vaultData)
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

  it("uses fresh encryption material for every save", async () => {
    const first = await encryptVault(passphrase, vaultData)
    const second = await encryptVault(passphrase, vaultData)

    expect(first.kdf.salt).not.toBe(second.kdf.salt)
    expect(first.cipher.iv).not.toBe(second.cipher.iv)
    expect(first.ciphertext).not.toBe(second.ciphertext)
  })

  it("rejects an incorrect vault password", async () => {
    const envelope = await encryptVault(passphrase, vaultData)

    await expect(
      decryptVault("this is the wrong passphrase", envelope)
    ).rejects.toBeInstanceOf(VaultUnlockError)
  })

  it("rejects modified ciphertext", async () => {
    const envelope = await encryptVault(passphrase, vaultData)
    const firstCharacter = envelope.ciphertext[0] === "A" ? "B" : "A"
    const modified = {
      ...envelope,
      ciphertext: firstCharacter + envelope.ciphertext.slice(1),
    }

    await expect(decryptVault(passphrase, modified)).rejects.toBeInstanceOf(
      VaultUnlockError
    )
  })
})
