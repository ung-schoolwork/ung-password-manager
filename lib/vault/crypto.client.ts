// Account and vault cryptography. Uses only the Web Crypto API so any client
// (this web app, the browser extension, tests) derives exactly the same keys.
//
//   email + password --PBKDF2--> account secret --HKDF--> auth key     (sent to the server)
//                                                \-HKDF--> wrapping key (never leaves the client)
//   wrapping key --AES-GCM--> wraps the random vault key
//   vault key    --AES-GCM--> encrypts the vault data
//
// The auth key and wrapping key are independent HKDF outputs, so the auth key
// the server sees cannot be used to recover the wrapping key or the vault key.

import { normalizeAccountEmail } from "@/lib/auth/shared"
import {
  VAULT_ENVELOPE_VERSION,
  WRAPPED_VAULT_KEY_VERSION,
  type VaultDataV1,
  type VaultEnvelope,
  type WrappedVaultKey,
} from "@/lib/vault/types"
import { parseVaultData } from "@/lib/vault/validation"

export const PBKDF2_ITERATIONS = 600_000
const ACCOUNT_SALT_PREFIX = "ung-password-manager:account:v1:"
const AUTH_KEY_INFO = "ung-password-manager:auth-key:v1"
const WRAPPING_KEY_INFO = "ung-password-manager:vault-wrapping-key:v1"
const IV_BYTES = 12

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class VaultUnlockError extends Error {
  constructor() {
    super("The password is incorrect or the saved vault is damaged.")
    this.name = "VaultUnlockError"
  }
}

export interface AccountKeys {
  /** Proves the password to the server. Hex, 64 characters. */
  authKey: string
  /** Unwraps the vault key. Non-extractable; keep it on the client. */
  wrappingKey: CryptoKey
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""

  for (const byte of bytes) binary += String.fromCharCode(byte)

  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  )
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function hkdf(info: string) {
  return {
    name: "HKDF",
    hash: "SHA-256",
    salt: new ArrayBuffer(0),
    info: toArrayBuffer(encoder.encode(info)),
  }
}

/** Derives the account's auth key and vault wrapping key from its sign-in details. */
export async function deriveAccountKeys(
  email: string,
  password: string
): Promise<AccountKeys> {
  const material = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(encoder.encode(password)),
    "PBKDF2",
    false,
    ["deriveBits"]
  )
  const accountSecret = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(
        encoder.encode(ACCOUNT_SALT_PREFIX + normalizeAccountEmail(email))
      ),
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    256
  )
  const secret = await crypto.subtle.importKey(
    "raw",
    accountSecret,
    "HKDF",
    false,
    ["deriveBits", "deriveKey"]
  )
  const authKey = await crypto.subtle.deriveBits(
    hkdf(AUTH_KEY_INFO),
    secret,
    256
  )
  const wrappingKey = await crypto.subtle.deriveKey(
    hkdf(WRAPPING_KEY_INFO),
    secret,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"]
  )

  return { authKey: bytesToHex(new Uint8Array(authKey)), wrappingKey }
}

async function wrapVaultKey(
  vaultKey: CryptoKey,
  wrappingKey: CryptoKey
): Promise<WrappedVaultKey> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const wrapped = await crypto.subtle.wrapKey("raw", vaultKey, wrappingKey, {
    name: "AES-GCM",
    iv: toArrayBuffer(iv),
  })

  return {
    version: WRAPPED_VAULT_KEY_VERSION,
    cipher: { name: "AES-GCM", iv: bytesToBase64(iv) },
    wrappedKey: bytesToBase64(new Uint8Array(wrapped)),
  }
}

/** Creates a new random vault key, wrapped for storage with the account. */
export async function createWrappedVaultKey(
  wrappingKey: CryptoKey
): Promise<WrappedVaultKey> {
  const vaultKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  )
  return wrapVaultKey(vaultKey, wrappingKey)
}

/** Recovers the vault key. Throws VaultUnlockError for a wrong password. */
export async function unwrapVaultKey(
  wrappingKey: CryptoKey,
  wrapped: WrappedVaultKey,
  extractable = false
): Promise<CryptoKey> {
  try {
    return await crypto.subtle.unwrapKey(
      "raw",
      toArrayBuffer(base64ToBytes(wrapped.wrappedKey)),
      wrappingKey,
      { name: "AES-GCM", iv: toArrayBuffer(base64ToBytes(wrapped.cipher.iv)) },
      { name: "AES-GCM", length: 256 },
      extractable,
      ["encrypt", "decrypt"]
    )
  } catch {
    throw new VaultUnlockError()
  }
}

/**
 * Re-wraps the same vault key under a new wrapping key, as a password change
 * needs to. The vault data does not have to be re-encrypted.
 */
export async function rewrapVaultKey(
  wrapped: WrappedVaultKey,
  currentWrappingKey: CryptoKey,
  nextWrappingKey: CryptoKey
): Promise<WrappedVaultKey> {
  const vaultKey = await unwrapVaultKey(currentWrappingKey, wrapped, true)
  return wrapVaultKey(vaultKey, nextWrappingKey)
}

export async function encryptVault(
  vaultKey: CryptoKey,
  data: VaultDataV1
): Promise<VaultEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const plaintext = encoder.encode(JSON.stringify(data))
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    vaultKey,
    toArrayBuffer(plaintext)
  )

  return {
    version: VAULT_ENVELOPE_VERSION,
    cipher: {
      name: "AES-GCM",
      iv: bytesToBase64(iv),
    },
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  }
}

export async function decryptVault(
  vaultKey: CryptoKey,
  envelope: VaultEnvelope
): Promise<VaultDataV1> {
  try {
    const iv = base64ToBytes(envelope.cipher.iv)
    const ciphertext = base64ToBytes(envelope.ciphertext)
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      vaultKey,
      toArrayBuffer(ciphertext)
    )

    return parseVaultData(JSON.parse(decoder.decode(plaintext)))
  } catch {
    throw new VaultUnlockError()
  }
}
