import { decryptVault, encryptVault } from "@/lib/vault/crypto.client"
import type { VaultRepository } from "@/lib/vault/repository.client"
import { VaultConflictError } from "@/lib/vault/remote"
import {
  VAULT_DATA_VERSION,
  type Credential,
  type CredentialDraft,
  type VaultDataV1,
  type VaultEnvelopeV1,
} from "@/lib/vault/types"
import {
  validateCredentialDraft,
  validateMasterPassphrase,
} from "@/lib/vault/validation"

export class VaultLockedError extends Error {
  constructor() {
    super("Unlock the vault before changing credentials.")
    this.name = "VaultLockedError"
  }
}

export class VaultAlreadyExistsError extends Error {
  constructor() {
    super("A vault already exists. Refresh the page to open it.")
    this.name = "VaultAlreadyExistsError"
  }
}

export class VaultNotFoundError extends Error {
  constructor() {
    super("No saved vault was found.")
    this.name = "VaultNotFoundError"
  }
}

/**
 * The credential changed or was deleted after the edit began. `latest` is the
 * saved version to review, or null when it was deleted.
 */
export class CredentialConflictError extends Error {
  constructor(readonly latest: Credential | null) {
    super(
      latest
        ? "This credential was changed on another device while you were editing."
        : "This credential was deleted on another device while you were editing."
    )
    this.name = "CredentialConflictError"
  }
}

export class VaultBusyError extends Error {
  constructor() {
    super(
      "Your vault is changing on another device. Wait a moment, then save again."
    )
    this.name = "VaultBusyError"
  }
}

// Saves attempted against newer vaults before giving up.
const UPDATE_ATTEMPTS = 3

interface VaultServiceDependencies {
  now: () => Date
  createId: () => string
}

const defaultDependencies: VaultServiceDependencies = {
  now: () => new Date(),
  createId: () => crypto.randomUUID(),
}

export class VaultService {
  private data: VaultDataV1 | null = null
  private passphrase: string | null = null
  private generation = 0
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly repository: VaultRepository,
    private readonly dependencies: VaultServiceDependencies = defaultDependencies
  ) {}

  async hasVault(): Promise<boolean> {
    return (await this.repository.load()) !== null
  }

  isUnlocked(): boolean {
    return this.data !== null && this.passphrase !== null
  }

  async createVault(passphrase: string): Promise<void> {
    const generation = ++this.generation
    validateMasterPassphrase(passphrase)

    if (await this.hasVault()) throw new VaultAlreadyExistsError()

    const data: VaultDataV1 = {
      version: VAULT_DATA_VERSION,
      credentials: [],
    }
    const envelope = await encryptVault(passphrase, data)
    this.assertCurrent(generation)
    await this.repository.save(envelope)
    this.assertCurrent(generation)

    this.data = data
    this.passphrase = passphrase
  }

  async migrateVault(
    passphrase: string,
    envelope: VaultEnvelopeV1
  ): Promise<void> {
    const generation = ++this.generation
    if (await this.hasVault()) throw new VaultAlreadyExistsError()
    this.assertCurrent(generation)
    const data = await decryptVault(passphrase, envelope)
    this.assertCurrent(generation)
    await this.repository.save(envelope)
    this.assertCurrent(generation)
    this.data = data
    this.passphrase = passphrase
  }
  async unlockVault(passphrase: string): Promise<void> {
    const generation = ++this.generation
    const envelope = await this.repository.load()
    if (!envelope) throw new VaultNotFoundError()

    const data = await decryptVault(passphrase, envelope)
    this.assertCurrent(generation)
    this.data = data
    this.passphrase = passphrase
  }

  /** Revision of the vault this service last loaded or saved, if versioned. */
  knownRevision(): string | null {
    return this.repository.currentRevision?.() ?? null
  }

  /**
   * Replaces the unlocked data with the saved vault when another device changed
   * it. Runs after any save in progress so a save is never built on stale data.
   */
  async refresh(): Promise<boolean> {
    const generation = this.generation
    const { passphrase } = this.requireUnlocked()
    return this.exclusive(async () => {
      this.assertCurrent(generation)
      const envelope = await this.repository.load()
      this.assertCurrent(generation)
      if (!envelope) throw new VaultNotFoundError()
      const data = await decryptVault(passphrase, envelope)
      this.assertCurrent(generation)
      this.data = data
      return true
    })
  }

  lockVault(): void {
    this.generation += 1
    this.data = null
    this.passphrase = null
  }

  listCredentials(): Credential[] {
    const { data } = this.requireUnlocked()
    return data.credentials.map((credential) => ({ ...credential }))
  }

  async saveCredential(draft: CredentialDraft): Promise<Credential> {
    const { data } = this.requireUnlocked()
    const normalized = validateCredentialDraft(draft)
    const timestamp = this.dependencies.now().toISOString()
    const credential: Credential = {
      ...normalized,
      id: this.dependencies.createId(),
      createdAt: timestamp,
      updatedAt: timestamp,
      passwordUpdatedAt: timestamp,
    }

    await this.persist({
      ...data,
      credentials: [credential, ...data.credentials],
    })

    return { ...credential }
  }

  /**
   * Applies an edit. Pass `expectedUpdatedAt`, the `updatedAt` of the copy the
   * edit started from, so a newer change saved meanwhile is reported instead
   * of overwritten.
   */
  async updateCredential(
    id: string,
    patch: Partial<CredentialDraft>,
    expectedUpdatedAt?: string
  ): Promise<Credential> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.applyUpdate(id, patch, expectedUpdatedAt)
      } catch (error) {
        if (
          expectedUpdatedAt === undefined ||
          !(error instanceof VaultConflictError)
        )
          throw error
        if (attempt === UPDATE_ATTEMPTS) throw new VaultBusyError()
        // Another device saved first. Load its vault, then save again only if
        // this credential is still the version the edit started from.
        await this.refresh()
      }
    }
  }

  private async applyUpdate(
    id: string,
    patch: Partial<CredentialDraft>,
    expectedUpdatedAt: string | undefined
  ): Promise<Credential> {
    const { data } = this.requireUnlocked()
    const existing = data.credentials.find((credential) => credential.id === id)
    if (
      expectedUpdatedAt !== undefined &&
      existing?.updatedAt !== expectedUpdatedAt
    )
      throw new CredentialConflictError(existing ? { ...existing } : null)
    if (!existing) throw new Error("Credential not found.")

    const normalized = validateCredentialDraft({ ...existing, ...patch })
    const timestamp = this.dependencies.now().toISOString()
    const updated: Credential = {
      ...existing,
      ...normalized,
      updatedAt: timestamp,
      passwordUpdatedAt:
        normalized.password === existing.password
          ? existing.passwordUpdatedAt
          : timestamp,
    }

    await this.persist({
      ...data,
      credentials: data.credentials.map((credential) =>
        credential.id === id ? updated : credential
      ),
    })

    return { ...updated }
  }

  async removeCredential(id: string): Promise<void> {
    const { data } = this.requireUnlocked()

    if (!data.credentials.some((credential) => credential.id === id)) {
      throw new Error("Credential not found.")
    }

    await this.persist({
      ...data,
      credentials: data.credentials.filter(
        (credential) => credential.id !== id
      ),
    })
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.generation) throw new VaultLockedError()
  }
  private requireUnlocked(): { data: VaultDataV1; passphrase: string } {
    if (!this.data || !this.passphrase) throw new VaultLockedError()
    return { data: this.data, passphrase: this.passphrase }
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work)
    this.queue = result.catch(() => undefined)
    return result
  }

  private async persist(data: VaultDataV1): Promise<void> {
    const generation = this.generation
    const baseline = this.data
    const { passphrase } = this.requireUnlocked()
    await this.exclusive(async () => {
      const envelope = await encryptVault(passphrase, data)
      this.assertCurrent(generation)
      if (this.data !== baseline) throw new VaultConflictError()
      await this.repository.save(envelope)
      this.assertCurrent(generation)
      this.data = data
    })
  }
}
