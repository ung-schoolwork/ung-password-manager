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
  private generation = 0

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

  async unlockVault(passphrase: string): Promise<void> {
    const generation = ++this.generation
    const envelope = await this.repository.load()
    if (!envelope) throw new VaultNotFoundError()

    const data = await decryptVault(passphrase, envelope)
    this.assertCurrent(generation)
    this.data = data
    this.passphrase = passphrase
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

  async updateCredential(
    id: string,
    patch: Partial<CredentialDraft>
  ): Promise<Credential> {
    const { data } = this.requireUnlocked()
    const existing = data.credentials.find((credential) => credential.id === id)
    
    if (!existing) {
      throw new Error("Credential not found.")
    }

    // Merge explicitly to prevent partial/undefined overrides causing validation side-effects
    const mergedDraft: CredentialDraft = {
      accountName: patch.accountName ?? existing.accountName,
      siteOrApp: patch.siteOrApp ?? existing.siteOrApp,
      username: patch.username ?? existing.username,
      password: patch.password ?? existing.password,
      notes: patch.notes ?? existing.notes,
      riskLevel: patch.riskLevel ?? existing.riskLevel,
    }

    const normalized = validateCredentialDraft(mergedDraft)
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

  private async persist(data: VaultDataV1): Promise<void> {
    const generation = this.generation
    const { passphrase } = this.requireUnlocked()
    const envelope = await encryptVault(passphrase, data)
    this.assertCurrent(generation)
    await this.repository.save(envelope)
    this.assertCurrent(generation)
    this.data = data
  }
}