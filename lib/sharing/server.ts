import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto"
import mongoose, { Schema } from "mongoose"
import { connectAuth, User } from "@/lib/auth/server"
import type { CredentialDraft } from "@/lib/vault/types"

const CIPHER_ALGORITHM = "aes-256-gcm"
const IV_BYTES = 12

// Known trade-off (SCRUM-21): credential sharing is NOT end-to-end encrypted
// like the rest of the vault. The browser sends the credential to the server
// in plaintext over HTTPS, and the server encrypts it at rest with a single
// shared symmetric key (SHARE_ENCRYPTION_KEY) before storing it. Anyone with
// that key, or server-side code execution, can decrypt any pending share.
// This was accepted for this sprint to ship credential sharing on schedule.
// A true end-to-end design would need per-account asymmetric keypairs so the
// browser can encrypt directly to the recipient's public key; that is
// tracked as follow-up work, not part of this story.

export class RecipientNotFoundError extends Error {
  constructor() {
    super("No account was found with that email.")
    this.name = "RecipientNotFoundError"
  }
}

export class SelfShareError extends Error {
  constructor() {
    super("You cannot share a credential with yourself.")
    this.name = "SelfShareError"
  }
}

export class ShareNotFoundError extends Error {
  constructor() {
    super("That shared credential is no longer available.")
    this.name = "ShareNotFoundError"
  }
}

function shareKey(): Buffer {
  const value = process.env.SHARE_ENCRYPTION_KEY
  if (!value) throw new Error("SHARE_ENCRYPTION_KEY is required")
  const key = Buffer.from(value, "base64")
  if (key.byteLength !== 32)
    throw new Error("SHARE_ENCRYPTION_KEY must be 32 bytes, base64-encoded")
  return key
}

function encryptCredential(credential: CredentialDraft): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(CIPHER_ALGORITHM, shareKey(), iv)
  const plaintext = Buffer.from(JSON.stringify(credential), "utf8")
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64")
}

function decryptCredential(payload: string): CredentialDraft {
  const raw = Buffer.from(payload, "base64")
  const iv = raw.subarray(0, IV_BYTES)
  const authTag = raw.subarray(IV_BYTES, IV_BYTES + 16)
  const ciphertext = raw.subarray(IV_BYTES + 16)
  const decipher = createDecipheriv(CIPHER_ALGORITHM, shareKey(), iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])
  return JSON.parse(plaintext.toString("utf8")) as CredentialDraft
}

interface StoredShare {
  fromUserId: string
  fromEmail: string
  toUserId: string
  payload: string
  createdAt: Date
}

const schema = new Schema<StoredShare>({
  fromUserId: { type: String, required: true },
  fromEmail: { type: String, required: true },
  toUserId: { type: String, required: true, index: true },
  payload: { type: String, required: true },
  createdAt: { type: Date, required: true, default: () => new Date() },
})
const Share =
  (mongoose.models.CredentialShare as
    | mongoose.Model<StoredShare>
    | undefined) || mongoose.model<StoredShare>("CredentialShare", schema)

let indexesReady: Promise<void> | undefined
async function connectShares() {
  if (mongoose.connection.readyState === 0) indexesReady = undefined
  await connectAuth()
  indexesReady ??= Share.createIndexes().catch((error) => {
    indexesReady = undefined
    throw error
  })
  await indexesReady
}

export async function createShare(options: {
  fromUserId: string
  fromEmail: string
  toEmail: string
  credential: CredentialDraft
}): Promise<{ id: string }> {
  await connectShares()
  const normalizedToEmail = options.toEmail.trim().toLowerCase()
  if (normalizedToEmail === options.fromEmail.trim().toLowerCase())
    throw new SelfShareError()

  const recipient = await User.findOne({ email: normalizedToEmail })
  if (!recipient) throw new RecipientNotFoundError()

  const share = await Share.create({
    fromUserId: options.fromUserId,
    fromEmail: options.fromEmail,
    toUserId: String(recipient._id),
    payload: encryptCredential(options.credential),
  })

  return { id: String(share._id) }
}

export interface IncomingShare {
  id: string
  fromEmail: string
  credential: CredentialDraft
  createdAt: string
}

export async function listPendingShares(
  userId: string
): Promise<IncomingShare[]> {
  await connectShares()
  const shares = await Share.find({ toUserId: userId })
    .sort({ createdAt: -1 })
    .lean()

  return shares.map((share) => ({
    id: String(share._id),
    fromEmail: share.fromEmail,
    credential: decryptCredential(share.payload),
    createdAt: share.createdAt.toISOString(),
  }))
}

export async function removeShare(
  shareId: string,
  userId: string
): Promise<void> {
  await connectShares()
  let result
  try {
    result = await Share.findOneAndDelete({ _id: shareId, toUserId: userId })
  } catch {
    throw new ShareNotFoundError()
  }
  if (!result) throw new ShareNotFoundError()
}