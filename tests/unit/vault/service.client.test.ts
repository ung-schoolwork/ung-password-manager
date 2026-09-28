import { describe, expect, it } from "bun:test"

import type { VaultRepository } from "../../../lib/vault/repository.client"
import { VaultService } from "../../../lib/vault/service.client"
import type {
  CredentialDraft,
  VaultEnvelopeV1,
} from "../../../lib/vault/types"
import { CredentialValidationError } from "../../../lib/vault/validation"

class MemoryVaultRepository implements VaultRepository {
  envelope: VaultEnvelopeV1 | null = null
  failNextSave = false

  async load() {
    return this.envelope ? structuredClone(this.envelope) : null
  }

  async save(envelope: VaultEnvelopeV1) {
    if (this.failNextSave) {
      this.failNextSave = false
      throw new Error("Storage unavailable")
    }

    this.envelope = structuredClone(envelope)
  }

  async clear() {
    this.envelope = null
  }
}

const passphrase = "a long vault password"
const validDraft: CredentialDraft = {
  accountName: "Student portal",
  siteOrApp: "portal.example.edu",
  username: "chance",
  password: "DemoOnly!123456",
}

function createService(repository: VaultRepository, times?: string[]) {
  let timeIndex = 0
  return new VaultService(repository, {
    now: () => new Date(times?.[timeIndex++] ?? "2026-09-22T00:00:00.000Z"),
    createId: () => "credential-1",
  })
}

describe("VaultService", () => {
  it("returns field-specific validation errors for missing required values", async () => {
    const repository = new MemoryVaultRepository()
    const service = createService(repository)
    await service.createVault(passphrase)

    try {
      await service.saveCredential({
        accountName: " ",
        siteOrApp: "",
        username: " ",
        password: "",
      })
      throw new Error("Expected validation to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(CredentialValidationError)
      expect((error as CredentialValidationError).fields).toEqual({
        accountName: "Enter an account label.",
        siteOrApp: "Enter a website or app.",
        username: "Enter a username.",
        password: "Enter a password.",
      })
    }
  })

  it("saves, locks, reloads, and unlocks an encrypted credential", async () => {
    const repository = new MemoryVaultRepository()
    const service = createService(repository)
    await service.createVault(passphrase)
    await service.saveCredential(validDraft)
    service.lockVault()

    const reloadedService = createService(repository)
    await reloadedService.unlockVault(passphrase)

    expect(reloadedService.listCredentials()).toEqual([
      expect.objectContaining({
        id: "credential-1",
        ...validDraft,
      }),
    ])
    expect(JSON.stringify(repository.envelope)).not.toContain(validDraft.password)
  })

  it("does not mutate committed state when persistence fails", async () => {
    const repository = new MemoryVaultRepository()
    const service = createService(repository)
    await service.createVault(passphrase)
    repository.failNextSave = true

    await expect(service.saveCredential(validDraft)).rejects.toThrow(
      "Storage unavailable"
    )
    expect(service.listCredentials()).toEqual([])
  })

  it("changes passwordUpdatedAt only when the password changes", async () => {
    const repository = new MemoryVaultRepository()
    const service = createService(repository, [
      "2026-09-22T00:00:00.000Z",
      "2026-09-23T00:00:00.000Z",
      "2026-09-24T00:00:00.000Z",
    ])
    await service.createVault(passphrase)
    const saved = await service.saveCredential(validDraft)

    const renamed = await service.updateCredential(saved.id, {
      accountName: "Renamed portal",
    })
    expect(renamed.passwordUpdatedAt).toBe(saved.passwordUpdatedAt)

    const changedPassword = await service.updateCredential(saved.id, {
      password: "AnotherDemoOnly!654321",
    })
    expect(changedPassword.passwordUpdatedAt).toBe(
      "2026-09-24T00:00:00.000Z"
    )
  })
})
