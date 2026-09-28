import { decryptVault, encryptVault } from "@/lib/vault/crypto.client"
import type { VaultRepository } from "@/lib/vault/repository.client"
import {
  VAULT_DATA_VERSION,
  type Credential,
  type CredentialDraft,
  type VaultDataV1,
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
    super("A vault already exists in this browser.")
    this.name = "VaultAlreadyExistsError"
  }
}

export class VaultNotFoundError extends Error {
  constructor() {
    super("No saved vault was found in this browser.")
    this.name = "VaultNotFoundError"
  }
}

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
    validateMasterPassphrase(passphrase)

    if (await this.hasVault()) throw new VaultAlreadyExistsError()

    const data: VaultDataV1 = {
      version: VAULT_DATA_VERSION,
      credentials: [],
    }
    const envelope = await encryptVault(passphrase, data)
    await this.repository.save(envelope)

    this.data = data
    this.passphrase = passphrase
  }

  async unlockVault(passphrase: string): Promise<void> {
    const envelope = await this.repository.load()
    if (!envelope) throw new VaultNotFoundError()

    const data = await decryptVault(passphrase, envelope)
    this.data = data
    this.passphrase = passphrase
  }

  lockVault(): void {
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

  async updateCredential(
    id: string,
    patch: Partial<CredentialDraft>
  ): Promise<Credential> {
    const { data } = this.requireUnlocked()
    const existing = data.credentials.find((credential) => credential.id === id)
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
      credentials: data.credentials.filter((credential) => credential.id !== id),
    })
  }

  private requireUnlocked(): { data: VaultDataV1; passphrase: string } {
    if (!this.data || !this.passphrase) throw new VaultLockedError()
    return { data: this.data, passphrase: this.passphrase }
  }

  private async persist(data: VaultDataV1): Promise<void> {
    const { passphrase } = this.requireUnlocked()
    const envelope = await encryptVault(passphrase, data)
    await this.repository.save(envelope)
    this.data = data
  }
}
