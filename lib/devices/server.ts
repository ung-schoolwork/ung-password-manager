import { randomBytes, randomInt } from "node:crypto"
import mongoose, { Schema } from "mongoose"
import type { NextResponse } from "next/server"
import { connectAuth, digest } from "@/lib/auth/server"
import {
  DEVICE_CODE_LENGTH,
  deviceNameFromUserAgent,
  type DeviceState,
  type DeviceSummary,
} from "@/lib/devices/shared"

export const DEVICE_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-ung_device" : "ung_device"
const DEVICE_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000
const CODE_LIFETIME_MS = 10 * 60 * 1000
const LAST_SEEN_GRANULARITY_MS = 60 * 1000

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

let indexesReady: Promise<void> | undefined
async function connectDevices() {
  if (mongoose.connection.readyState === 0) indexesReady = undefined
  await connectAuth()
  indexesReady ??= Device.createIndexes()
    .then(() => undefined)
    .catch((error) => {
      indexesReady = undefined
      throw error
    })
  await indexesReady
}

function readDeviceToken(request: Request) {
  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${DEVICE_COOKIE}=`))
    ?.slice(DEVICE_COOKIE.length + 1)
  return raw && /^[a-f0-9]{64}$/.test(raw) ? raw : null
}

export function setDeviceCookie(response: NextResponse, token: string) {
  response.cookies.set(DEVICE_COOKIE, token, {
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
): Promise<{ state: DeviceState; newToken: string | null }> {
  await connectDevices()
  const now = new Date()
  const token = readDeviceToken(request)
  const existing = token
    ? await Device.findOne({ tokenDigest: digest(token), ownerId })
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
    return { state: stateOf(existing), newToken: null }
  }

  const newToken = randomBytes(32).toString("hex")
  const name = deviceNameFromUserAgent(request.headers.get("user-agent"))
  const hasApproved = await Device.exists({ ownerId, approved: true })
  if (!hasApproved) {
    const device = await Device.create({
      ownerId,
      tokenDigest: digest(newToken),
      name,
      approved: true,
      approvedAt: now,
      lastSeenAt: now,
    })
    return { state: stateOf(device), newToken }
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
  return { state: stateOf(device), newToken }
}

export async function currentApprovedDevice(request: Request, ownerId: string) {
  const token = readDeviceToken(request)
  if (!token) return null
  await connectDevices()
  const now = new Date()
  const device = await Device.findOne({
    tokenDigest: digest(token),
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

export async function removeDevice(ownerId: string, id: string) {
  await connectDevices()
  if (!mongoose.isValidObjectId(id)) return false
  const result = await Device.deleteOne({ _id: id, ownerId })
  return result.deletedCount === 1
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
