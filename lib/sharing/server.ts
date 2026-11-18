import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto"
import mongoose, { Schema } from "mongoose"
import { connectAuth, User } from "@/lib/auth/server"
import {
  shareStatus,
  type ShareRemovedBy,
  type ShareStatus,
} from "@/lib/sharing/status"
import type { CredentialDraft } from "@/lib/vault/types"

const CIPHER_ALGORITHM = "aes-256-gcm"
const IV_BYTES = 12

// Known trade-off (SCRUM-21): credential sharing is NOT end-to-end encrypted
// like the rest of the vault. The browser sends the credential to the server
// in plaintext over HTTPS, and the server encrypts it at rest with a single
// shared symmetric key (SHARE_ENCRYPTION_KEY) before storing it. Anyone with
// that key, or server-side code execution, can decrypt any active share.
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

/** The share exists for this recipient but its access has ended. */
export class ShareEndedError extends Error {
  constructor(readonly status: Exclude<ShareStatus, "active">) {
    super(
      status === "expired"
        ? "Your access to this shared credential has ended."
        : "Your access to this shared credential was removed."
    )
    this.name = "ShareEndedError"
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

function encryptJson(value: unknown): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(CIPHER_ALGORITHM, shareKey(), iv)
  const plaintext = Buffer.from(JSON.stringify(value), "utf8")
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64")
}

function decryptJson<T>(payload: string): T {
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
  return JSON.parse(plaintext.toString("utf8")) as T
}

/** What both people may see about a share after its access ends. */
interface ShareSummary {
  accountName: string
  siteOrApp: string
}

// `payload` holds the encrypted credential and is removed as soon as access
// ends. `summary` holds only the account label and site, encrypted the same
// way, so both people can still tell which share ended. Records saved before
// shares could end have no `summary`, `toEmail`, `expiresAt` or `revokedAt`;
// they read as active with no end date.
interface StoredShare {
  fromUserId: string
  fromEmail: string
  // The vault id of the owner's credential this share copies, so deleting
  // the credential can end the share (see endCredentialShares). Null on
  // shares made before this link existed.
  credentialId?: string | null
  toUserId: string
  toEmail?: string
  payload?: string
  summary?: string
  createdAt: Date
  expiresAt?: Date | null
  revokedAt?: Date | null
  revokedBy?: ShareRemovedBy | null
  // Each side can clear an ended share from its own list.
  ownerDismissedAt?: Date | null
  recipientDismissedAt?: Date | null
}

const schema = new Schema<StoredShare>({
  fromUserId: { type: String, required: true, index: true },
  fromEmail: { type: String, required: true },
  credentialId: { type: String, default: null },
  toUserId: { type: String, required: true, index: true },
  toEmail: { type: String },
  payload: { type: String },
  summary: { type: String },
  createdAt: { type: Date, required: true, default: () => new Date() },
  expiresAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
  revokedBy: {
    type: String,
    enum: ["owner", "recipient", null],
    default: null,
  },
  ownerDismissedAt: { type: Date, default: null },
  recipientDismissedAt: { type: Date, default: null },
})
schema.index({ fromUserId: 1, credentialId: 1 })
const Share =
  (mongoose.models.CredentialShare as
    mongoose.Model<StoredShare> | undefined) ||
  mongoose.model<StoredShare>("CredentialShare", schema)

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

/** Matches shares whose credential can still be read at `now`. */
function activeFilter(now: Date) {
  return {
    revokedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    payload: { $exists: true },
  }
}

/** Removes the credential from every share whose end date has passed. */
async function wipeExpired(now: Date, scope: Record<string, unknown>) {
  await Share.updateMany(
    {
      ...scope,
      expiresAt: { $ne: null, $lte: now },
      payload: { $exists: true },
    },
    { $unset: { payload: 1 } }
  )
}

function summaryOf(share: StoredShare): ShareSummary {
  if (share.summary) return decryptJson<ShareSummary>(share.summary)
  if (share.payload) {
    const credential = decryptJson<CredentialDraft>(share.payload)
    return {
      accountName: credential.accountName,
      siteOrApp: credential.siteOrApp,
    }
  }
  return { accountName: "Shared credential", siteOrApp: "" }
}

// Vault ids are random UUIDs. Anything else is refused before it reaches a
// query.
const CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/

export function isCredentialId(value: unknown): value is string {
  return typeof value === "string" && CREDENTIAL_ID_PATTERN.test(value)
}

function idFilter(shareId: string) {
  if (!mongoose.isValidObjectId(shareId)) throw new ShareNotFoundError()
  return { _id: shareId }
}

export async function createShare(options: {
  fromUserId: string
  fromEmail: string
  toEmail: string
  credential: CredentialDraft
  /** The vault id of the credential being shared. */
  credentialId?: string | null
  expiresAt?: Date | null
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
    credentialId: options.credentialId ?? null,
    toUserId: String(recipient._id),
    toEmail: recipient.email,
    payload: encryptJson(options.credential),
    summary: encryptJson({
      accountName: options.credential.accountName,
      siteOrApp: options.credential.siteOrApp,
    } satisfies ShareSummary),
    expiresAt: options.expiresAt ?? null,
  })

  return { id: String(share._id) }
}

interface ShareDetails {
  id: string
  accountName: string
  siteOrApp: string
  status: ShareStatus
  removedBy: ShareRemovedBy | null
  createdAt: string
  expiresAt: string | null
  endedAt: string | null
}

/** A share sent to this account. It never carries the credential itself. */
export interface IncomingShare extends ShareDetails {
  fromEmail: string
}

/** A share this account sent. */
export interface OutgoingShare extends ShareDetails {
  toEmail: string
  /** The vault id of the shared credential, or null for older shares. */
  credentialId: string | null
}

function details(share: StoredShare & { _id: unknown }, now: Date) {
  const status = shareStatus(share, now)
  const summary = summaryOf(share)
  return {
    id: String(share._id),
    accountName: summary.accountName,
    siteOrApp: summary.siteOrApp,
    status,
    removedBy: status === "removed" ? (share.revokedBy ?? "owner") : null,
    createdAt: share.createdAt.toISOString(),
    expiresAt: share.expiresAt ? share.expiresAt.toISOString() : null,
    endedAt:
      status === "removed" && share.revokedAt
        ? share.revokedAt.toISOString()
        : status === "expired" && share.expiresAt
          ? share.expiresAt.toISOString()
          : null,
  } satisfies ShareDetails
}

export async function listIncomingShares(
  userId: string,
  now: Date = new Date()
): Promise<IncomingShare[]> {
  await connectShares()
  await wipeExpired(now, { toUserId: userId })
  const shares = await Share.find({
    toUserId: userId,
    recipientDismissedAt: null,
  })
    .sort({ createdAt: -1 })
    .lean()
  return shares.map((share) => ({
    ...details(share, now),
    fromEmail: share.fromEmail,
  }))
}

export async function listOutgoingShares(
  userId: string,
  now: Date = new Date()
): Promise<OutgoingShare[]> {
  await connectShares()
  await wipeExpired(now, { fromUserId: userId })
  const shares = await Share.find({
    fromUserId: userId,
    ownerDismissedAt: null,
  })
    .sort({ createdAt: -1 })
    .lean()
  const missing = shares
    .filter((share) => !share.toEmail)
    .map((share) => share.toUserId)
  const emails = new Map<string, string>()
  if (missing.length > 0) {
    const users = await User.find({ _id: { $in: missing } })
      .select("email")
      .lean()
    for (const user of users) emails.set(String(user._id), user.email)
  }
  return shares.map((share) => ({
    ...details(share, now),
    toEmail: share.toEmail ?? emails.get(share.toUserId) ?? "a deleted account",
    credentialId: share.credentialId ?? null,
  }))
}

/**
 * Returns the shared credential to its recipient, but only while the share is
 * active. This is the one place the credential leaves the server, so the
 * status is checked in the same query that reads it.
 */
export async function readIncomingShare(
  shareId: string,
  userId: string,
  now: Date = new Date()
): Promise<{ credential: CredentialDraft; expiresAt: string | null }> {
  await connectShares()
  const mine = { ...idFilter(shareId), toUserId: userId }
  const share = await Share.findOne({
    ...mine,
    recipientDismissedAt: null,
    ...activeFilter(now),
  }).lean()
  if (share?.payload)
    return {
      credential: decryptJson<CredentialDraft>(share.payload),
      expiresAt: share.expiresAt ? share.expiresAt.toISOString() : null,
    }

  const ended = await Share.findOne({
    ...mine,
    recipientDismissedAt: null,
  }).lean()
  if (!ended) throw new ShareNotFoundError()
  if (ended.payload && ended.expiresAt && ended.expiresAt <= now)
    await wipeExpired(now, { _id: ended._id })
  const status = shareStatus(ended, now)
  throw new ShareEndedError(status === "active" ? "removed" : status)
}

/**
 * Ends or clears a share for whoever asks.
 *
 * - The owner of an active share revokes it: the credential is deleted and
 *   the share stays listed for both people as removed.
 * - The recipient of an active share declines it the same way, and it leaves
 *   their list.
 * - Either person can clear a share that has already ended from their own
 *   list. Once both have, the record is deleted.
 */
export async function removeShare(
  shareId: string,
  userId: string,
  now: Date = new Date()
): Promise<{ role: "owner" | "recipient"; status: ShareStatus }> {
  await connectShares()
  const filter = idFilter(shareId)
  const share = await Share.findOne({
    ...filter,
    $or: [
      { fromUserId: userId, ownerDismissedAt: null },
      { toUserId: userId, recipientDismissedAt: null },
    ],
  }).lean()
  if (!share) throw new ShareNotFoundError()
  const role = share.fromUserId === userId ? "owner" : "recipient"
  const dismissedField =
    role === "owner" ? "ownerDismissedAt" : "recipientDismissedAt"

  // Keep the label readable after the credential is gone, including for
  // records saved before the label was stored on its own.
  const summary = share.summary ?? encryptJson(summaryOf(share))

  const revoked = await Share.findOneAndUpdate(
    { ...filter, ...activeFilter(now) },
    {
      $set: {
        revokedAt: now,
        revokedBy: role,
        summary,
        ...(role === "recipient" ? { recipientDismissedAt: now } : {}),
      },
      $unset: { payload: 1 },
    },
    { returnDocument: "after" }
  ).lean()
  if (revoked) return { role, status: "removed" }

  // Already ended: clear it from this person's list.
  const cleared = await Share.findOneAndUpdate(
    { ...filter, [dismissedField]: null },
    { $set: { [dismissedField]: now, summary }, $unset: { payload: 1 } },
    { returnDocument: "after" }
  ).lean()
  if (!cleared) throw new ShareNotFoundError()
  if (cleared.ownerDismissedAt && cleared.recipientDismissedAt)
    await Share.deleteOne({ _id: cleared._id })
  return { role, status: shareStatus(cleared, now) }
}

/**
 * Ends every share of a credential its owner is deleting, the same way
 * "Remove access" does: the stored copy is wiped and the share stays listed
 * as removed for both people.
 *
 * Why: a share is a separate copy of the credential. Without this, deleting
 * the credential would leave that copy readable by everyone it was shared
 * with, and the owner would no longer see it in their vault to remove it.
 *
 * The browser calls this before it deletes the credential from the vault.
 * If this fails, the delete is stopped and nothing changes; if the vault
 * update fails afterwards, the shares have still ended. Either way no copy
 * outlives the credential.
 *
 * Shares saved before they recorded their credential id cannot be matched
 * here: the vault is encrypted in the browser, so the server cannot tell
 * which credential they came from. They stay listed under "Shared by you",
 * where the owner can still remove access.
 */
export async function endCredentialShares(
  ownerId: string,
  credentialId: string,
  now: Date = new Date()
): Promise<{ ended: number }> {
  await connectShares()
  const scope = { fromUserId: ownerId, credentialId }
  // One update per step, so a share is either fully ended or untouched.
  const revoked = await Share.updateMany(
    { ...scope, ...activeFilter(now) },
    {
      $set: { revokedAt: now, revokedBy: "owner" },
      $unset: { payload: 1 },
    }
  )
  // Shares that already expired but still hold a copy lose it too.
  await wipeExpired(now, scope)
  return { ended: revoked.modifiedCount }
}

/** Test and maintenance access to the stored records. */
export const CredentialShare = Share
