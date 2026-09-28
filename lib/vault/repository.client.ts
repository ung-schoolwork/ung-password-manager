import {
  VAULT_ENVELOPE_VERSION,
  type VaultEnvelopeV1,
} from "@/lib/vault/types"

export const VAULT_STORAGE_KEY = "ung-password-manager:vault:v1"

export interface VaultRepository {
  load(): Promise<VaultEnvelopeV1 | null>
  save(envelope: VaultEnvelopeV1): Promise<void>
  clear(): Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function parseVaultEnvelope(value: unknown): VaultEnvelopeV1 {
  if (
    !isRecord(value) ||
    value.version !== VAULT_ENVELOPE_VERSION ||
    !isRecord(value.kdf) ||
    value.kdf.name !== "PBKDF2" ||
    value.kdf.hash !== "SHA-256" ||
    !Number.isSafeInteger(value.kdf.iterations) ||
    (value.kdf.iterations as number) <= 0 ||
    typeof value.kdf.salt !== "string" ||
    !isRecord(value.cipher) ||
    value.cipher.name !== "AES-GCM" ||
    typeof value.cipher.iv !== "string" ||
    typeof value.ciphertext !== "string"
  ) {
    throw new Error("Saved vault format is invalid or unsupported.")
  }

  return value as unknown as VaultEnvelopeV1
}

export class LocalStorageVaultRepository implements VaultRepository {
  constructor(
    private readonly storage: Storage,
    private readonly storageKey = VAULT_STORAGE_KEY
  ) {}

  async load(): Promise<VaultEnvelopeV1 | null> {
    const serialized = this.storage.getItem(this.storageKey)
    if (serialized === null) return null

    return parseVaultEnvelope(JSON.parse(serialized))
  }

  async save(envelope: VaultEnvelopeV1): Promise<void> {
    this.storage.setItem(this.storageKey, JSON.stringify(envelope))
  }

  async clear(): Promise<void> {
    this.storage.removeItem(this.storageKey)
  }
}
