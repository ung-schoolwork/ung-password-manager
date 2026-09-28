import {
  VAULT_ENVELOPE_VERSION,
  type VaultDataV1,
  type VaultEnvelopeV1,
} from "@/lib/vault/types"
import { parseVaultData } from "@/lib/vault/validation"

export const PBKDF2_ITERATIONS = 600_000
const SALT_BYTES = 16
const IV_BYTES = 12

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class VaultUnlockError extends Error {
  constructor() {
    super("The vault password is incorrect or the saved vault is damaged.")
    this.name = "VaultUnlockError"
  }
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


function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  )

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}

export async function encryptVault(
  passphrase: string,
  data: VaultDataV1
): Promise<VaultEnvelopeV1> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS)
  const plaintext = encoder.encode(JSON.stringify(data))
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(plaintext)
  )

  return {
    version: VAULT_ENVELOPE_VERSION,
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
    },
    cipher: {
      name: "AES-GCM",
      iv: bytesToBase64(iv),
    },
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  }
}

export async function decryptVault(
  passphrase: string,
  envelope: VaultEnvelopeV1
): Promise<VaultDataV1> {
  try {
    const salt = base64ToBytes(envelope.kdf.salt)
    const iv = base64ToBytes(envelope.cipher.iv)
    const ciphertext = base64ToBytes(envelope.ciphertext)
    const key = await deriveKey(passphrase, salt, envelope.kdf.iterations)
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(ciphertext)
    )

    return parseVaultData(JSON.parse(decoder.decode(plaintext)))
  } catch {
    throw new VaultUnlockError()
  }
}
