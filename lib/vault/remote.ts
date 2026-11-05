import type { VaultEnvelope, WrappedVaultKey } from "@/lib/vault/types"

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

// A 256-bit AES key wrapped with AES-GCM: 32 key bytes plus a 16-byte tag.
const WRAPPED_KEY_BYTES = 48

/**
 * What an approved device receives: the wrapped vault key, and the encrypted
 * vault with its revision once anything has been saved.
 */
export type AccountVaultSnapshot = {
  wrappedVaultKey: WrappedVaultKey
} & (
  | { envelope: VaultEnvelope; revision: string }
  | { envelope: null; revision: null }
)

export interface VaultWrite {
  envelope: VaultEnvelope
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

export function parseWrappedVaultKey(value: unknown): WrappedVaultKey | null {
  if (
    !hasKeys(value, ["version", "cipher", "wrappedKey"]) ||
    value.version !== 1 ||
    !hasKeys(value.cipher, ["name", "iv"]) ||
    value.cipher.name !== "AES-GCM" ||
    base64Size(value.cipher.iv) !== 12 ||
    base64Size(value.wrappedKey) !== WRAPPED_KEY_BYTES
  )
    return null
  return value as unknown as WrappedVaultKey
}

export function parseVaultWrite(value: unknown): VaultWrite | null {
  if (!hasKeys(value, ["envelope", "expectedRevision"])) return null
  const { envelope, expectedRevision } = value
  if (expectedRevision !== null && !isVaultRevision(expectedRevision))
    return null
  if (
    !hasKeys(envelope, ["version", "cipher", "ciphertext"]) ||
    envelope.version !== 2 ||
    !hasKeys(envelope.cipher, ["name", "iv"]) ||
    envelope.cipher.name !== "AES-GCM" ||
    base64Size(envelope.cipher.iv) !== 12
  )
    return null
  const ciphertextSize = base64Size(envelope.ciphertext)
  if (ciphertextSize === null || ciphertextSize < 16) return null

  return {
    envelope: envelope as unknown as VaultEnvelope,
    expectedRevision: expectedRevision as string | null,
  }
}
