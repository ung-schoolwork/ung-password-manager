import type { VaultEnvelopeV1 } from "@/lib/vault/types"

export const MAX_VAULT_REQUEST_BYTES = 1024 * 1024

export class VaultConflictError extends Error {
  constructor() {
    super(
      "Your vault changed. Refresh the page and unlock it before saving again."
    )
    this.name = "VaultConflictError"
  }
}

export function isVaultRevision(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value
    )
  )
}

export type AccountVaultSnapshot =
  | { envelope: VaultEnvelopeV1; revision: string }
  | { envelope: null; revision: null }

export interface VaultWrite {
  envelope: VaultEnvelopeV1
  expectedRevision: string | null
}

function hasKeys(
  value: unknown,
  keys: string[]
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  )
}

function base64Size(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    value.length > MAX_VAULT_REQUEST_BYTES ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    return null
  try {
    const bytes = atob(value)
    return btoa(bytes) === value ? bytes.length : null
  } catch {
    return null
  }
}

export function parseVaultWrite(value: unknown): VaultWrite | null {
  if (!hasKeys(value, ["envelope", "expectedRevision"])) return null
  const { envelope, expectedRevision } = value
  if (expectedRevision !== null && !isVaultRevision(expectedRevision))
    return null
  if (!hasKeys(envelope, ["version", "kdf", "cipher", "ciphertext"]))
    return null
  if (
    envelope.version !== 1 ||
    !hasKeys(envelope.kdf, ["name", "hash", "iterations", "salt"]) ||
    envelope.kdf.name !== "PBKDF2" ||
    envelope.kdf.hash !== "SHA-256" ||
    !Number.isSafeInteger(envelope.kdf.iterations) ||
    (envelope.kdf.iterations as number) < 100_000 ||
    (envelope.kdf.iterations as number) > 1_000_000 ||
    base64Size(envelope.kdf.salt) !== 16 ||
    !hasKeys(envelope.cipher, ["name", "iv"]) ||
    envelope.cipher.name !== "AES-GCM" ||
    base64Size(envelope.cipher.iv) !== 12
  )
    return null
  const ciphertextSize = base64Size(envelope.ciphertext)
  if (ciphertextSize === null || ciphertextSize < 16) return null

  return {
    envelope: envelope as unknown as VaultEnvelopeV1,
    expectedRevision: expectedRevision as string | null,
  }
}
