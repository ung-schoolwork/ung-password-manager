import { describe, expect, it } from "bun:test"

import {
  encryptVault,
  VaultUnlockError,
} from "../../../lib/vault/crypto.client"
import type { VaultRepository } from "../../../lib/vault/repository.client"
import { VaultConflictError } from "../../../lib/vault/remote"
import {
  CredentialConflictError,
  VaultAlreadyExistsError,
  VaultBusyError,
  VaultService,
} from "../../../lib/vault/service.client"
import {
  VAULT_DATA_VERSION,
  type Credential,
  type CredentialDraft,
  type VaultEnvelopeV1,
} from "../../../lib/vault/types"
import { CredentialValidationError } from "../../../lib/vault/validation"

class MemoryVaultRepository implements VaultRepository {
  envelope: VaultEnvelopeV1 | null = null
  saveCalls = 0
  failNextSave = false

  async load() {
    return this.envelope ? structuredClone(this.envelope) : null
  }

  async save(envelope: VaultEnvelopeV1) {
    this.saveCalls += 1
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
const migratedCredential: Credential = {
  ...validDraft,
  id: "credential-imported",
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-21T00:00:00.000Z",
  passwordUpdatedAt: "2026-09-21T00:00:00.000Z",
}

async function createEnvelope(
  credentials: Credential[] = [migratedCredential]
): Promise<VaultEnvelopeV1> {
  return encryptVault(passphrase, { version: VAULT_DATA_VERSION, credentials })
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

  it("migrates an encrypted vault and preserves its credentials", async () => {
    const repository = new MemoryVaultRepository()
    const service = createService(repository)
    const envelope = await createEnvelope()

    await service.migrateVault(passphrase, envelope)

    expect(service.listCredentials()).toEqual([migratedCredential])
    expect(repository.envelope).toEqual(envelope)

    const reloadedService = createService(repository)
    await reloadedService.unlockVault(passphrase)
    expect(reloadedService.listCredentials()).toEqual([migratedCredential])
  })

  it("does not save or unlock when a migrated vault has the wrong passphrase", async () => {
    const repository = new MemoryVaultRepository()
    const service = createService(repository)
    const envelope = await createEnvelope()

    await expect(
      service.migrateVault("incorrect passphrase", envelope)
    ).rejects.toBeInstanceOf(VaultUnlockError)

    expect(repository.saveCalls).toBe(0)
    expect(repository.envelope).toBeNull()
    expect(service.isUnlocked()).toBe(false)
  })

  it("leaves an existing destination unchanged during migration", async () => {
    const repository = new MemoryVaultRepository()
    const existingEnvelope = await createEnvelope([])
    repository.envelope = structuredClone(existingEnvelope)
    const service = createService(repository)
    const incomingEnvelope = await createEnvelope()

    await expect(
      service.migrateVault(passphrase, incomingEnvelope)
    ).rejects.toBeInstanceOf(VaultAlreadyExistsError)

    expect(repository.saveCalls).toBe(0)
    expect(repository.envelope).toEqual(existingEnvelope)
    expect(service.isUnlocked()).toBe(false)
  })

  it("remains locked when saving a migrated vault fails", async () => {
    const repository = new MemoryVaultRepository()
    repository.failNextSave = true
    const service = createService(repository)
    const envelope = await createEnvelope()

    await expect(service.migrateVault(passphrase, envelope)).rejects.toThrow(
      "Storage unavailable"
    )

    expect(repository.saveCalls).toBe(1)
    expect(repository.envelope).toBeNull()
    expect(service.isUnlocked()).toBe(false)
    expect(() => service.listCredentials()).toThrow("Unlock the vault")
  })

  it("does not restore decrypted state when locked during migration", async () => {
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
    const envelope = await createEnvelope()
    const migrating = service.migrateVault(passphrase, envelope)

    await saving
    service.lockVault()
    release()
    await expect(migrating).rejects.toThrow("Unlock the vault")

    expect(service.isUnlocked()).toBe(false)
    expect(() => service.listCredentials()).toThrow("Unlock the vault")
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
  it("picks up credentials another device saved to the same vault", async () => {
    const repository = new MemoryVaultRepository()
    const service = createService(repository)
    await service.createVault(passphrase)
    expect(service.listCredentials()).toEqual([])

    // Another approved device saves a credential to the shared vault.
    repository.envelope = await createEnvelope([migratedCredential])
    await service.refresh()

    expect(service.listCredentials()).toEqual([migratedCredential])
  })

  it("keeps the vault unlocked when a refresh cannot reach the saved vault", async () => {
    const repository = new MemoryVaultRepository()
    const service = createService(repository)
    await service.createVault(passphrase)
    await service.saveCredential(validDraft)
    repository.load = async () => {
      throw new Error("offline")
    }

    await expect(service.refresh()).rejects.toThrow("offline")
    expect(service.isUnlocked()).toBe(true)
    expect(service.listCredentials()).toHaveLength(1)
  })

  it("retries adding a credential when a refresh replaces its snapshot", async () => {
    const repository = new MemoryVaultRepository()
    const service = createService(repository)
    await service.createVault(passphrase)
    repository.envelope = await createEnvelope([migratedCredential])

    const refreshing = service.refresh()
    const saving = service.saveCredential(validDraft)
    await refreshing

    await expect(saving).resolves.toEqual(
      expect.objectContaining({ id: "credential-1", ...validDraft })
    )
    expect(service.listCredentials()).toEqual([
      expect.objectContaining({ id: "credential-1", ...validDraft }),
      migratedCredential,
    ])
    expect(repository.saveCalls).toBe(2)
  })

  it("does not rebase a credential add after the server rejects a stale write", async () => {
    const repository = new MemoryVaultRepository()
    const service = createService(repository)
    await service.createVault(passphrase)
    repository.save = async () => {
      throw new VaultConflictError()
    }

    await expect(service.saveCredential(validDraft)).rejects.toThrow(
      "Your vault changed"
    )
    expect(service.listCredentials()).toEqual([])
  })

  describe("editing while another device saves", () => {
    const otherCredential: Credential = {
      ...validDraft,
      id: "credential-other",
      accountName: "Library",
      createdAt: "2026-09-20T00:00:00.000Z",
      updatedAt: "2026-09-21T00:00:00.000Z",
      passwordUpdatedAt: "2026-09-21T00:00:00.000Z",
    }
    const newerOnOtherDevice: Credential = {
      ...migratedCredential,
      password: "ChangedElsewhere!2026",
      updatedAt: "2026-09-21T12:00:00.000Z",
      passwordUpdatedAt: "2026-09-21T12:00:00.000Z",
    }
    const staleEdit = { ...validDraft, notes: "edited on this device" }

    async function openVault(credentials: Credential[]) {
      const repository = new MemoryVaultRepository()
      repository.envelope = await createEnvelope(credentials)
      const service = createService(repository)
      await service.unlockVault(passphrase)
      return { repository, service }
    }
    // The server rejects this device's next save because another device saved
    // first, as the remote repository does for an outdated revision.
    function rejectNextSaveWith(
      repository: MemoryVaultRepository,
      envelope: VaultEnvelopeV1
    ) {
      const save = repository.save.bind(repository)
      repository.save = async () => {
        repository.save = save
        repository.saveCalls += 1
        repository.envelope = envelope
        throw new VaultConflictError()
      }
    }

    it("reports a newer change that arrived by sync instead of overwriting it", async () => {
      const { repository, service } = await openVault([migratedCredential])
      const basedOn = migratedCredential.updatedAt

      repository.envelope = await createEnvelope([newerOnOtherDevice])
      await service.refresh()
      const saves = repository.saveCalls

      const error = await service
        .updateCredential(migratedCredential.id, staleEdit, basedOn)
        .catch((caught) => caught)
      expect(error).toBeInstanceOf(CredentialConflictError)
      expect((error as CredentialConflictError).latest).toEqual(
        newerOnOtherDevice
      )
      expect(repository.saveCalls).toBe(saves)
      expect(service.listCredentials()).toEqual([newerOnOtherDevice])
    })

    it("reports a newer change that the server reports before sync picks it up", async () => {
      const { repository, service } = await openVault([migratedCredential])
      rejectNextSaveWith(repository, await createEnvelope([newerOnOtherDevice]))

      const error = await service
        .updateCredential(
          migratedCredential.id,
          staleEdit,
          migratedCredential.updatedAt
        )
        .catch((caught) => caught)
      expect(error).toBeInstanceOf(CredentialConflictError)
      expect((error as CredentialConflictError).latest).toEqual(
        newerOnOtherDevice
      )
      expect(service.listCredentials()).toEqual([newerOnOtherDevice])
      const reopened = createService(repository)
      await reopened.unlockVault(passphrase)
      expect(reopened.listCredentials()).toEqual([newerOnOtherDevice])
    })

    it("still saves when another device changed a different credential", async () => {
      const { repository, service } = await openVault([migratedCredential])
      rejectNextSaveWith(
        repository,
        await createEnvelope([otherCredential, migratedCredential])
      )

      const updated = await service.updateCredential(
        migratedCredential.id,
        staleEdit,
        migratedCredential.updatedAt
      )
      expect(updated.notes).toBe("edited on this device")
      const reopened = createService(repository)
      await reopened.unlockVault(passphrase)
      expect(reopened.listCredentials()).toEqual([otherCredential, updated])
    })

    it("reports a credential deleted on another device", async () => {
      const { repository, service } = await openVault([migratedCredential])
      repository.envelope = await createEnvelope([])
      await service.refresh()

      const error = await service
        .updateCredential(
          migratedCredential.id,
          staleEdit,
          migratedCredential.updatedAt
        )
        .catch((caught) => caught)
      expect(error).toBeInstanceOf(CredentialConflictError)
      expect((error as CredentialConflictError).latest).toBeNull()
    })

    it("replaces the newer version once the edit is based on it", async () => {
      const { repository, service } = await openVault([migratedCredential])
      repository.envelope = await createEnvelope([newerOnOtherDevice])
      await service.refresh()

      const updated = await service.updateCredential(
        migratedCredential.id,
        staleEdit,
        newerOnOtherDevice.updatedAt
      )
      expect(updated.password).toBe(validDraft.password)
      expect(service.listCredentials()).toEqual([updated])
    })

    it("retries while other devices keep saving, then asks to try again", async () => {
      const { repository, service } = await openVault([migratedCredential])
      const unrelated = await createEnvelope([
        otherCredential,
        migratedCredential,
      ])
      const save = repository.save.bind(repository)
      let rejections = 3
      repository.save = async (envelope) => {
        if (rejections-- > 0) {
          repository.saveCalls += 1
          repository.envelope = unrelated
          throw new VaultConflictError()
        }
        await save(envelope)
      }

      await expect(
        service.updateCredential(
          migratedCredential.id,
          staleEdit,
          migratedCredential.updatedAt
        )
      ).rejects.toBeInstanceOf(VaultBusyError)
      expect(repository.saveCalls).toBe(3)

      // With the other devices finished, the same edit saves.
      const updated = await service.updateCredential(
        migratedCredential.id,
        staleEdit,
        migratedCredential.updatedAt
      )
      expect(updated.notes).toBe("edited on this device")
    })
  })
})
