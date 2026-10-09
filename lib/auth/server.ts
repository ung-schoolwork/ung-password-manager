import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto"
import { isIP } from "node:net"
import mongoose, { Schema } from "mongoose"
import { NextResponse } from "next/server"

export const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000
export const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-ung_session" : "ung_session"
const LIMIT_WINDOW_MS = 15 * 60 * 1000
const LIMITS = { global: 1000, source: 120, account: 10 } as const
const HASH_PREFIX = "scrypt-v1$" // N=32768, r=8, p=3, 64 bytes; changing parameters requires a new version.
const HASH_OPTIONS = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }
const MAX_ACTIVE_HASHES = 2
let activeHashes = 0

const userSchema = new Schema({
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  salt: { type: String, required: true },
})
const sessionSchema = new Schema({
  tokenDigest: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
})
const attemptSchema = new Schema({
  key: { type: String, required: true, unique: true },
  count: { type: Number, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
})
export const User =
  mongoose.models.AuthUser || mongoose.model("AuthUser", userSchema)
export const Session =
  mongoose.models.AuthSession || mongoose.model("AuthSession", sessionSchema)
export const Attempt =
  mongoose.models.AuthAttempt || mongoose.model("AuthAttempt", attemptSchema)

let connection: Promise<typeof mongoose> | undefined
export function connectAuth() {
  if (mongoose.connection.readyState === 0) connection = undefined
  if (!connection) {
    const uri = process.env.MONGODB_URI
    if (!uri) throw new Error("MONGODB_URI is required")
    connection = (async () => {
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      })
      // init() does not create indexes when autoIndex is disabled in deployment.
      await Promise.all([
        User.createIndexes(),
        Session.createIndexes(),
        Attempt.createIndexes(),
      ])
      return mongoose
    })().catch(async (error) => {
      connection = undefined
      await mongoose.disconnect().catch(() => undefined)
      throw error
    })
  }
  return connection
}

export function json(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}
export function failure() {
  return json({ error: "Service unavailable" }, 503)
}
export function originAllowed(request: Request) {
  const origin = process.env.APP_ORIGIN
  if (!origin) return false
  try {
    return (
      new URL(origin).origin === origin &&
      (process.env.NODE_ENV !== "production" ||
        origin.startsWith("https://")) &&
      request.headers.get("origin") === origin
    )
  } catch {
    return false
  }
}
export function digest(token: string) {
  return createHash("sha256").update(token).digest("hex")
}
export function readToken(request: Request) {
  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1)
  return raw && /^[a-f0-9]{64}$/.test(raw) ? raw : null
}
export function setSessionCookie(
  response: NextResponse,
  token: string,
  expires: Date
) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires,
  })
}
export async function credentials(request: Request) {
  if (
    !/^application\/json(?:\s*;|\s*$)/i.test(
      request.headers.get("content-type") || ""
    )
  )
    return null
  const declared = request.headers.get("content-length")
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 4096)) {
    await request.body?.cancel().catch(() => undefined)
    return null
  }
  if (!request.body) return null
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 4096) {
        void reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    if (!body || typeof body !== "object" || Array.isArray(body)) return null
    const { email, password } = body as Record<string, unknown>
    if (typeof email !== "string" || typeof password !== "string") return null
    const normalized = email.trim().toLowerCase()
    if (
      normalized.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ||
      password.length < 12 ||
      password.length > 128
    )
      return null
    return { email: normalized, password }
  } finally {
    reader.releaseLock()
  }
}

export class HashBusyError extends Error {}
export async function hashPassword(password: string, salt: string) {
  if (activeHashes >= MAX_ACTIVE_HASHES) throw new HashBusyError()
  activeHashes++
  try {
    const hash = await new Promise<Buffer>((resolve, reject) =>
      scrypt(password, salt, 64, HASH_OPTIONS, (error, result) =>
        error ? reject(error) : resolve(result)
      )
    )
    return HASH_PREFIX + hash.toString("hex")
  } finally {
    activeHashes--
  }
}
const dummySalt = "00000000000000000000000000000000"
export async function validPassword(
  password: string,
  hash?: string,
  salt?: string
) {
  const actual = Buffer.from(
    (await hashPassword(password, salt || dummySalt)).slice(HASH_PREFIX.length),
    "hex"
  )
  const expected = Buffer.from(
    hash?.startsWith(HASH_PREFIX) &&
      /^[0-9a-f]{128}$/.test(hash.slice(HASH_PREFIX.length))
      ? hash.slice(HASH_PREFIX.length)
      : "0".repeat(128),
    "hex"
  )
  return timingSafeEqual(actual, expected) && !!hash?.startsWith(HASH_PREFIX)
}

export function sourceAddress(request: Request) {
  const header = process.env.AUTH_TRUSTED_IP_HEADER
  if (header) {
    const source = request.headers.get(header)?.trim()
    return source && isIP(source) ? source : null
  }
  return process.env.NODE_ENV === "production" ? null : "127.0.0.1"
}
async function increment(key: string, now: Date) {
  const expiresAt = new Date(now.getTime() + LIMIT_WINDOW_MS)
  const filter = { key: digest(key) }
  const current = await Attempt.findOneAndUpdate(
    { ...filter, expiresAt: { $gt: now } },
    { $inc: { count: 1 } },
    { returnDocument: "after" }
  )
  if (current) return current
  const renewed = await Attempt.findOneAndUpdate(
    { ...filter, expiresAt: { $lte: now } },
    { $set: { count: 1, expiresAt } },
    { returnDocument: "after" }
  )
  if (renewed) return renewed
  try {
    return await Attempt.create({ ...filter, count: 1, expiresAt })
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error
    // Concurrent first requests race at the unique index; retry the atomic update.
    const retry = await Attempt.findOneAndUpdate(
      { ...filter, expiresAt: { $gt: now } },
      { $inc: { count: 1 } },
      { returnDocument: "after" }
    )
    if (retry) return retry
    const replacement = await Attempt.findOneAndUpdate(
      { ...filter, expiresAt: { $lte: now } },
      { $set: { count: 1, expiresAt } },
      { returnDocument: "after" }
    )
    if (replacement) return replacement
    throw error
  }
}
export async function limited(request: Request, email: string) {
  const source = sourceAddress(request)
  if (!source) return { invalidSource: true as const }
  const now = new Date()
  // Register and login share budgets. A source cannot lock an account out from another source.
  for (const [key, cap] of [
    ["global", LIMITS.global],
    [`source:${source}`, LIMITS.source],
    [`account:${source}:${email}`, LIMITS.account],
  ] as const) {
    const result = await increment(key, now)
    if (result.count > cap)
      return {
        retryAfter: Math.max(
          1,
          Math.ceil((result.expiresAt.getTime() - now.getTime()) / 1000)
        ),
      }
  }
  return null
}
export function throttled(seconds: number) {
  const response = json({ error: "Too many attempts" }, 429)
  response.headers.set("Retry-After", String(seconds))
  return response
}
export async function issueSession(
  user: { _id: unknown; email: string },
  status = 200
) {
  const token = randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS)
  await Session.create({
    tokenDigest: digest(token),
    userId: user._id,
    expiresAt,
  })
  const response = json(
    {
      user: { id: String(user._id), email: user.email },
      expiresAt: expiresAt.toISOString(),
    },
    status
  )
  setSessionCookie(response, token, expiresAt)
  return response
}

// Future owner-scoped server routes must check this verified identity, not a client-supplied ID.
export async function authenticatedUser(
  request: Request
): Promise<{ id: string; email: string } | null> {
  const token = readToken(request)
  if (!token) return null
  await connectAuth()
  const session = await Session.findOne({
    tokenDigest: digest(token),
    expiresAt: { $gt: new Date() },
  })
  if (!session) return null
  const user = await User.findById(session.userId)
  return user ? { id: String(user._id), email: user.email } : null
}
