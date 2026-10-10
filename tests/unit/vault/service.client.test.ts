import { describe, expect, it } from "bun:test"

import type { VaultRepository } from "../../../lib/vault/repository.client"
import { VaultService } from "../../../lib/vault/service.client"
import type { CredentialDraft, VaultEnvelopeV1 } from "../../../lib/vault/types"
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
    expect(JSON.stringify(repository.envelope)).not.toContain(
      validDraft.password
    )
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

  it("persists edited details and changes passwordUpdatedAt only for a new password", async () => {
    const repository = new MemoryVaultRepository()
    const service = createService(repository, [
      "2026-09-22T00:00:00.000Z",
      "2026-09-23T00:00:00.000Z",
      "2026-09-24T00:00:00.000Z",
    ])
    await service.createVault(passphrase)
    const saved = await service.saveCredential(validDraft)

    const edited = await service.updateCredential(saved.id, {
      accountName: "Renamed portal",
      siteOrApp: "portal.new.example.edu",
      username: "new-student",
      notes: "Use the new recovery process.",
      riskLevel: "high",
    })
    expect(edited.passwordUpdatedAt).toBe(saved.passwordUpdatedAt)

    const changedPassword = await service.updateCredential(saved.id, {
      password: "AnotherDemoOnly!654321",
    })
    expect(changedPassword.passwordUpdatedAt).toBe("2026-09-24T00:00:00.000Z")

    service.lockVault()
    const reloadedService = createService(repository)
    await reloadedService.unlockVault(passphrase)
    expect(reloadedService.listCredentials()).toEqual([
      expect.objectContaining({
        ...edited,
        password: "AnotherDemoOnly!654321",
        updatedAt: "2026-09-24T00:00:00.000Z",
        passwordUpdatedAt: "2026-09-24T00:00:00.000Z",
      }),
    ])
  })
  it("does not restore decrypted state when locked during vault creation", async () => {
    const repository = new MemoryVaultRepository()
    let release!: () => void
    let started!: () => void
    const saving = new Promise<void>((resolve) => {
      started = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const originalSave = repository.save.bind(repository)
    repository.save = async (envelope) => {
      started()
      await gate
      await originalSave(envelope)
    }
    const service = createService(repository)
    const creating = service.createVault(passphrase)
    await saving
    service.lockVault()
    release()
    await expect(creating).rejects.toThrow("Unlock the vault")
    expect(service.isUnlocked()).toBe(false)
    expect(() => service.listCredentials()).toThrow("Unlock the vault")
  })

  it("does not restore decrypted state when locked during an unlock", async () => {
    const repository = new MemoryVaultRepository()
    const service = createService(repository)
    await service.createVault(passphrase)
    service.lockVault()
    let release!: () => void
    let started!: () => void
    const loading = new Promise<void>((resolve) => {
      started = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const originalLoad = repository.load.bind(repository)
    repository.load = async () => {
      started()
      await gate
      return originalLoad()
    }
    const unlocking = service.unlockVault(passphrase)
    await loading
    service.lockVault()
    release()
    await expect(unlocking).rejects.toThrow("Unlock the vault")
    expect(service.isUnlocked()).toBe(false)
  })

  it("does not restore decrypted state when locked during a save", async () => {
    const repository = new MemoryVaultRepository()
    const service = createService(repository)
    await service.createVault(passphrase)
    let release!: () => void
    let started!: () => void
    const saving = new Promise<void>((resolve) => {
      started = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const originalSave = repository.save.bind(repository)
    repository.save = async (envelope) => {
      started()
      await gate
      await originalSave(envelope)
    }
    const pending = service.saveCredential(validDraft)
    await saving
    service.lockVault()
    release()
    await expect(pending).rejects.toThrow("Unlock the vault")
    expect(service.isUnlocked()).toBe(false)
    expect(() => service.listCredentials()).toThrow("Unlock the vault")
  })
})
