import { randomBytes, randomInt } from "node:crypto"
import mongoose, { Schema } from "mongoose"
import type { NextResponse } from "next/server"
import { connectAuth, digest } from "@/lib/auth/server"
import {
  DEVICE_CODE_LENGTH,
  deviceNameFromUserAgent,
  type DeviceState,
  type DeviceSummary,
  normalizeDeviceId,
} from "@/lib/devices/shared"

export const DEVICE_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-ung_device" : "ung_device"
const DEVICE_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000
const CODE_LIFETIME_MS = 10 * 60 * 1000
const LAST_SEEN_GRANULARITY_MS = 60 * 1000
// How many accounts one browser remembers. Adding one more drops the token of
// the account that was added to this browser longest ago.
const MAX_DEVICE_TOKENS = 8

interface StoredDevice {
  ownerId: string
  tokenDigest: string
  name: string
  approved: boolean
  code?: string
  // Only pending devices carry this field, so approved devices never expire.
  pendingExpiresAt?: Date
  approvedAt?: Date
  lastSeenAt: Date
}

const schema = new Schema<StoredDevice>({
  ownerId: { type: String, required: true, index: true },
  tokenDigest: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  approved: { type: Boolean, required: true },
  code: { type: String },
  pendingExpiresAt: { type: Date, index: { expires: 0 } },
  approvedAt: { type: Date },
  lastSeenAt: { type: Date, required: true },
})
const Device =
  (mongoose.models.AccountDevice as mongoose.Model<StoredDevice> | undefined) ||
  mongoose.model<StoredDevice>("AccountDevice", schema)

// Records that an account has trusted its first device. Only the request that
// creates this record may approve a browser without a code, so an account whose
// approved devices are all gone never trusts the next browser automatically.
interface StoredFirstApproval {
  _id: string
  approvedAt: Date
}
const firstApprovalSchema = new Schema<StoredFirstApproval>({
  _id: { type: String, required: true },
  approvedAt: { type: Date, required: true },
})
const FirstApproval =
  (mongoose.models.AccountFirstDeviceApproval as
    mongoose.Model<StoredFirstApproval> | undefined) ||
  mongoose.model<StoredFirstApproval>(
    "AccountFirstDeviceApproval",
    firstApprovalSchema
  )

// One short-lived lock per account serializes removals, so two devices cannot
// remove each other at the same moment and lock the account out.
interface StoredRemovalLock {
  _id: string
  holder: string
  expiresAt: Date
}
const lockSchema = new Schema<StoredRemovalLock>({
  _id: { type: String, required: true },
  holder: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
})
const RemovalLock =
  (mongoose.models.AccountDeviceRemovalLock as
    mongoose.Model<StoredRemovalLock> | undefined) ||
  mongoose.model<StoredRemovalLock>("AccountDeviceRemovalLock", lockSchema)
const LOCK_LIFETIME_MS = 10 * 1000

let indexesReady: Promise<void> | undefined
async function connectDevices() {
  if (mongoose.connection.readyState === 0) indexesReady = undefined
  await connectAuth()
  indexesReady ??= Promise.all([
    Device.createIndexes(),
    RemovalLock.createIndexes(),
  ])
    .then(() => undefined)
    .catch((error) => {
      indexesReady = undefined
      throw error
    })
  await indexesReady
}

// The device cookie holds one server-issued token per account that has signed
// in on this browser, so each account keeps its own approval. A token is only
// ever looked up together with its account, so a token planted in the cookie
// or issued to another account never approves this one.
function readDeviceTokens(request: Request): string[] {
  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${DEVICE_COOKIE}=`))
    ?.slice(DEVICE_COOKIE.length + 1)
  const tokens = (raw ?? "")
    .split(".")
    .filter((token) => /^[a-f0-9]{64}$/.test(token))
  return [...new Set(tokens)].slice(0, MAX_DEVICE_TOKENS)
}

export function setDeviceCookie(response: NextResponse, value: string) {
  response.cookies.set(DEVICE_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: new Date(Date.now() + DEVICE_LIFETIME_MS),
  })
}

function newCode() {
  return String(randomInt(0, 10 ** DEVICE_CODE_LENGTH)).padStart(
    DEVICE_CODE_LENGTH,
    "0"
  )
}

// A short numeric code is only unambiguous among one account's pending devices.
async function freshCode(ownerId: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode()
    const taken = await Device.exists({
      ownerId,
      approved: false,
      code,
      pendingExpiresAt: { $gt: new Date() },
    })
    if (!taken) return code
  }
  throw new Error("Could not allocate a device code")
}

function stateOf(device: {
  _id: unknown
  approved: boolean
  code?: string | null
  pendingExpiresAt?: Date | null
}): DeviceState {
  const deviceId = String(device._id)
  if (device.approved) return { approved: true, deviceId }
  return {
    approved: false,
    deviceId,
    code: device.code ?? "",
    expiresAt: (device.pendingExpiresAt ?? new Date()).toISOString(),
  }
}

// Registers the requesting browser for this account. The first device is
// trusted automatically; every later device waits for an approved one.
export async function ensureDevice(
  request: Request,
  ownerId: string
): Promise<{ state: DeviceState; deviceCookie: string | null }> {
  await connectDevices()
  const now = new Date()
  const tokens = readDeviceTokens(request)
  const existing = tokens.length
    ? await Device.findOne({
        tokenDigest: { $in: tokens.map(digest) },
        ownerId,
      })
    : null

  if (existing) {
    if (
      !existing.approved &&
      (!existing.pendingExpiresAt || existing.pendingExpiresAt <= now)
    ) {
      existing.code = await freshCode(ownerId)
      existing.pendingExpiresAt = new Date(now.getTime() + CODE_LIFETIME_MS)
      await existing.save()
    }
    return { state: stateOf(existing), deviceCookie: null }
  }

  const newToken = randomBytes(32).toString("hex")
  const deviceCookie = await nextDeviceCookie(newToken, tokens)
  const name = deviceNameFromUserAgent(request.headers.get("user-agent"))
  const hasApproved = await Device.exists({ ownerId, approved: true })
  // Claim even when a device is already approved, so accounts created before
  // this record existed also stop trusting new browsers automatically.
  const claimed = await claimFirstApproval(ownerId, now)
  if (claimed && !hasApproved) {
    const device = await Device.create({
      ownerId,
      tokenDigest: digest(newToken),
      name,
      approved: true,
      approvedAt: now,
      lastSeenAt: now,
    })
    return { state: stateOf(device), deviceCookie }
  }
  const device = await Device.create({
    ownerId,
    tokenDigest: digest(newToken),
    name,
    approved: false,
    code: await freshCode(ownerId),
    pendingExpiresAt: new Date(now.getTime() + CODE_LIFETIME_MS),
    lastSeenAt: now,
  })
  return { state: stateOf(device), deviceCookie }
}

// Puts the new token first and keeps the other accounts' tokens that still
// belong to a device, dropping removed ones so they do not take up room.
async function nextDeviceCookie(newToken: string, tokens: string[]) {
  const kept = tokens.length
    ? new Set(
        await Device.distinct("tokenDigest", {
          tokenDigest: { $in: tokens.map(digest) },
        })
      )
    : new Set<string>()
  return [newToken, ...tokens.filter((token) => kept.has(digest(token)))]
    .slice(0, MAX_DEVICE_TOKENS)
    .join(".")
}

async function claimFirstApproval(ownerId: string, now: Date) {
  try {
    const result = await FirstApproval.updateOne(
      { _id: ownerId },
      { $setOnInsert: { approvedAt: now } },
      { upsert: true }
    )
    return result.upsertedCount === 1
  } catch (error) {
    // A concurrent first sign-in created the record first.
    if ((error as { code?: number }).code === 11000) return false
    throw error
  }
}

export async function currentApprovedDevice(request: Request, ownerId: string) {
  const tokens = readDeviceTokens(request)
  if (!tokens.length) return null
  await connectDevices()
  const now = new Date()
  const device = await Device.findOne({
    tokenDigest: { $in: tokens.map(digest) },
    ownerId,
    approved: true,
  }).lean()
  if (!device) return null
  if (now.getTime() - device.lastSeenAt.getTime() > LAST_SEEN_GRANULARITY_MS)
    await Device.updateOne({ _id: device._id }, { $set: { lastSeenAt: now } })
  return { id: String(device._id) }
}

export async function listDevices(
  ownerId: string,
  currentId: string
): Promise<DeviceSummary[]> {
  await connectDevices()
  const devices = await Device.find({ ownerId, approved: true })
    .sort({ approvedAt: 1 })
    .lean()
  return devices.map((device) => ({
    id: String(device._id),
    name: device.name,
    current: String(device._id) === currentId,
    approvedAt: (device.approvedAt ?? device.lastSeenAt).toISOString(),
    lastSeenAt: device.lastSeenAt.toISOString(),
  }))
}

export async function approvePendingDevice(ownerId: string, code: string) {
  await connectDevices()
  const device = await Device.findOneAndUpdate(
    { ownerId, approved: false, code, pendingExpiresAt: { $gt: new Date() } },
    {
      $set: { approved: true, approvedAt: new Date() },
      $unset: { code: "", pendingExpiresAt: "" },
    },
    { returnDocument: "after" }
  ).lean()
  return device ? { id: String(device._id), name: device.name } : null
}

export type RemoveDeviceResult =
  "removed" | "not-found" | "current" | "not-approved" | "busy"

// Returns a holder token, or null while another removal holds the lock.
async function acquireRemovalLock(ownerId: string) {
  const holder = randomBytes(16).toString("hex")
  for (let attempt = 0; attempt < 5; attempt++) {
    const now = new Date()
    try {
      // Creates the lock, or takes over one whose holder ran out of time.
      const lock = await RemovalLock.findOneAndUpdate(
        { _id: ownerId, expiresAt: { $lte: now } },
        {
          $set: {
            holder,
            expiresAt: new Date(now.getTime() + LOCK_LIFETIME_MS),
          },
        },
        { upsert: true, returnDocument: "after" }
      ).lean()
      if (lock?.holder === holder) return holder
    } catch (error) {
      // A live lock exists, so the upsert collided with it.
      if ((error as { code?: number }).code !== 11000) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return null
}

// Removes one of the account's devices on behalf of an approved device. The
// requesting device can never remove itself, so an approved device always remains.
export async function removeDevice(
  ownerId: string,
  currentId: string,
  id: string
): Promise<RemoveDeviceResult> {
  const target = normalizeDeviceId(id)
  const current = normalizeDeviceId(currentId)
  if (!target || !current) return "not-found"
  if (target === current) return "current"
  await connectDevices()
  const holder = await acquireRemovalLock(ownerId)
  if (!holder) return "busy"
  try {
    const stillApproved = await Device.exists({
      _id: current,
      ownerId,
      approved: true,
    })
    if (!stillApproved) return "not-approved"
    const result = await Device.deleteOne({ _id: target, ownerId })
    return result.deletedCount === 1 ? "removed" : "not-found"
  } finally {
    // Releases only this request's lock; a lock left behind expires on its own.
    await RemovalLock.deleteOne({ _id: ownerId, holder }).catch(() => undefined)
  }
}

export async function readSmallJson(request: Request): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;|\s*$)/i.test(
      request.headers.get("content-type") || ""
    ) ||
    !request.body
  )
    return null
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 1024) {
        void reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}
