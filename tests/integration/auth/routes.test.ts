import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import mongoose from "mongoose"
import { GET as session } from "../../../app/api/auth/session/route"
import { POST as register } from "../../../app/api/auth/register/route"
import { POST as login } from "../../../app/api/auth/login/route"
import { POST as logout } from "../../../app/api/auth/logout/route"
import {
  authenticatedUser,
  connectAuth,
  digest,
  Session,
  User,
  Attempt,
  SESSION_LIFETIME_MS,
  limited,
  hashPassword,
  HashBusyError,
} from "../../../lib/auth/server"

const origin = "http://127.0.0.1:3100"
const prefix = `auth-${randomUUID()}`
const email = `${prefix}@example.test`
const password = "correct-password-123"
const source = `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`
const otherSource = `198.19.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`
const originalHeader = process.env.AUTH_TRUSTED_IP_HEADER
function post(
  email: string,
  password: string,
  ip: string | null = source,
  requestOrigin: string | null = origin
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    host: "attacker.test",
  }
  if (requestOrigin) headers.origin = requestOrigin
  if (ip) headers["x-test-client-ip"] = ip
  return new Request(`${origin}/api/auth`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password }),
  })
}
function cookie(response: Response) {
  return response.headers.get("set-cookie")!.split(";")[0]
}
function get(cookieValue?: string) {
  return new Request(`${origin}/api/auth/session`, {
    headers: cookieValue ? { cookie: cookieValue } : {},
  })
}
function key(type: "source" | "account", ip: string, name = email) {
  return digest(type === "source" ? `source:${ip}` : `account:${ip}:${name}`)
}

before(async () => {
  if (
    process.env.MONGODB_URI !== "mongodb://127.0.0.1:27018/ung_auth_test" ||
    process.env.APP_ORIGIN !== origin
  )
    throw new Error(
      "Set isolated MONGODB_URI and APP_ORIGIN before running auth integration tests"
    )
  process.env.AUTH_TRUSTED_IP_HEADER = "x-test-client-ip"
  await connectAuth()
})
after(async () => {
  const users = await User.find({ email: { $regex: `^${prefix}` } }).select(
    "_id"
  )
  await Session.deleteMany({ userId: { $in: users.map((user) => user._id) } })
  await User.deleteMany({ email: { $regex: `^${prefix}` } })
  // Leave the shared global counter intact: the browser suite may run simultaneously.
  await Attempt.deleteMany({
    key: {
      $in: [source, otherSource].flatMap((ip) => [
        key("source", ip),
        ...[
          email,
          `${prefix}-missing@example.test`,
          `${prefix}-limit@example.test`,
          `${prefix}-duplicate@example.test`,
          `${prefix}-partial@example.test`,
          ...Array.from(
            { length: 121 },
            (_, n) => `${prefix}-rotate-${n}@example.test`
          ),
        ].map((name) => key("account", ip, name)),
      ]),
    },
  })
  await mongoose.disconnect()
  if (originalHeader === undefined) delete process.env.AUTH_TRUSTED_IP_HEADER
  else process.env.AUTH_TRUSTED_IP_HEADER = originalHeader
})

describe("real MongoDB auth routes", () => {
  it("registers, verifies, logs in, isolates and revokes sessions without storing raw secrets", async () => {
    const created = await register(post(` ${email.toUpperCase()} `, password))
    assert.equal(created.status, 201)
    const body = await created.json()
    assert.deepEqual(Object.keys(body).sort(), ["expiresAt", "user"])
    assert.deepEqual(Object.keys(body.user).sort(), ["email", "id"])
    assert.equal(body.user.email, email)
    assert.ok(
      Date.parse(body.expiresAt) - Date.now() > SESSION_LIFETIME_MS - 10000
    )
    assert.equal(created.headers.get("cache-control"), "no-store")
    const flags = created.headers.get("set-cookie")!
    for (const flag of ["httponly", "samesite=strict", "path=/"])
      assert.ok(flags.toLowerCase().includes(flag))
    const first = cookie(created)
    const stored = (await User.findOne({ email }).lean()) as {
      passwordHash: string
      salt: string
    }
    assert.notEqual(stored.passwordHash, password)
    assert.match(stored.passwordHash, /^scrypt-v1\$[a-f0-9]{128}$/)
    assert.equal(stored.salt.length, 32)
    const token = first.split("=")[1]
    assert.ok(await Session.findOne({ tokenDigest: digest(token) }))
    assert.equal(await Session.findOne({ tokenDigest: token }), null)
    assert.equal((await session(get(first))).status, 200)
    assert.equal((await authenticatedUser(get(first)))?.email, email)
    assert.equal((await session(get())).status, 401)
    assert.equal((await login(post(email, "wrong-password-123"))).status, 401)
    assert.equal(
      (await login(post(`${prefix}-missing@example.test`, password))).status,
      401
    )
    const second = await login(post(email, password))
    assert.equal(second.status, 200)
    assert.notEqual(cookie(second), first)
    const signedOut = await logout(
      new Request(origin, {
        method: "POST",
        headers: { origin, cookie: first },
      })
    )
    assert.equal(signedOut.status, 200)
    assert.ok(
      signedOut.headers.get("set-cookie")?.includes("Expires=Thu, 01 Jan 1970")
    )
    assert.equal((await session(get(first))).status, 401)
    assert.equal(await authenticatedUser(get(first)), null)
    assert.equal((await session(get(cookie(second)))).status, 200)
    await Session.updateOne(
      { tokenDigest: digest(cookie(second).split("=")[1]) },
      { $set: { expiresAt: new Date(0) } }
    )
    assert.equal((await session(get(cookie(second)))).status, 401)
    assert.equal(await authenticatedUser(get(cookie(second))), null)
    assert.equal((await register(post(email, password))).status, 409)
  })

  it("bounds concurrent scrypt work", async () => {
    const first = hashPassword(password, "first-salt")
    const second = hashPassword(password, "second-salt")
    await assert.rejects(hashPassword(password, "third-salt"), HashBusyError)
    await Promise.all([first, second])
  })
  it("creates required unique and TTL indexes before accepting requests", async () => {
    for (const [model, field] of [
      [User, "email"],
      [Session, "tokenDigest"],
      [Attempt, "key"],
    ] as const) {
      const indexes = await model.collection.listIndexes().toArray()
      assert.ok(
        indexes.some((index) => index.key[field] === 1 && index.unique === true)
      )
    }
    for (const model of [Session, Attempt]) {
      const indexes = await model.collection.listIndexes().toArray()
      assert.ok(
        indexes.some(
          (index) => index.key.expiresAt === 1 && index.expireAfterSeconds === 0
        )
      )
    }
  })
  it("stops reading and cancels oversized streams, rejects unreadable bodies and forged origins", async () => {
    let pulled = 0
    let canceled = false
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled++
          controller.enqueue(new Uint8Array(4097))
        },
        cancel() {
          canceled = true
        },
      },
      { highWaterMark: 0 }
    )
    const oversized = new Request(origin, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit)
    assert.equal((await register(oversized)).status, 400)
    assert.equal(pulled, 1)
    assert.equal(canceled, true)
    const unreadable = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("private stream failure"))
      },
    })
    const broken = await login(
      new Request(origin, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: unreadable,
        duplex: "half",
      } as RequestInit)
    )
    assert.equal(broken.status, 503)
    assert.ok(!(await broken.text()).includes("private stream failure"))
    assert.equal(
      (await register(post(email, password, source, null))).status,
      403
    )
    assert.equal(
      (await register(post(email, password, source, "http://attacker.test")))
        .status,
      403
    )
    assert.equal(
      (await login(post(email, password, source, "http://attacker.test")))
        .status,
      403
    )
    assert.equal(
      (
        await logout(
          new Request(origin, {
            method: "POST",
            headers: { origin: "http://attacker.test" },
          })
        )
      ).status,
      403
    )
    assert.equal((await login(post(email, password, null))).status, 403)
    assert.equal(
      (await login(post(email, password, "1.2.3.4, 5.6.7.8"))).status,
      403
    )
    assert.equal((await login(post(email, password, "not-an-ip"))).status, 403)
    assert.equal(
      (await register(post(`${prefix}-bad@example.test`, "short"))).status,
      400
    )
  })

  it("enforces shared source-account caps without globally locking a target", async () => {
    const limitedEmail = `${prefix}-limit@example.test`
    for (let n = 0; n < 10; n++)
      assert.equal((await login(post(limitedEmail, password))).status, 401)
    const blocked = await register(post(limitedEmail, password))
    assert.equal(blocked.status, 429)
    assert.ok(Number(blocked.headers.get("retry-after")) > 0)
    assert.equal(
      (await Attempt.findOne({ key: key("account", source, limitedEmail) }))
        ?.count,
      11
    )
    assert.equal(
      (await login(post(limitedEmail, password, otherSource))).status,
      401
    )
    // Rotating identifiers cannot evade the source budget; requests share global budget too.
    for (let n = 0; n < 120; n++) {
      const rotated = `${prefix}-rotate-${n}@example.test`
      await limited(post(rotated, password, otherSource), rotated)
    }
    const rotating = `${prefix}-rotate-120@example.test`
    const rotated = await login(post(rotating, password, otherSource))
    assert.equal(rotated.status, 429)
    assert.ok(Number(rotated.headers.get("retry-after")) > 0)
  })

  it("allows exactly one concurrent registration and persists atomic attempt counters", async () => {
    const duplicate = `${prefix}-duplicate@example.test`
    const results = await Promise.all([
      register(post(duplicate, password)),
      register(post(duplicate, password)),
    ])
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409])
    assert.equal(await User.countDocuments({ email: duplicate }), 1)
    const name = `${prefix}-partial@example.test`
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => limited(post(name, password), name))
    )
    assert.ok(attempts.every((result) => result === null))
    assert.equal(
      (await Attempt.findOne({ key: key("account", source, name) }))?.count,
      8
    )
  })

  it("sanitizes real Mongo session insertion failure and removes only the failed new account", async () => {
    // Temporarily disallow inserts for this collection. Restore the original validator even on failure.
    // Run without concurrent browser writes: collMod is collection-wide for this brief interval.
    const db = mongoose.connection.db!
    const collection = (await db.listCollections().toArray()).find(
      (item) => item.name === Session.collection.name
    ) as
      | {
          options?: {
            validator?: object
            validationLevel?: string
            validationAction?: string
          }
        }
      | undefined
    assert.ok(collection)
    const previous = collection.options?.validator
    const previousLevel = collection.options?.validationLevel
    const previousAction = collection.options?.validationAction
    await db.command({
      collMod: Session.collection.name,
      validator: { tokenDigest: { $exists: false } },
      validationLevel: "strict",
      validationAction: "error",
    })
    try {
      const partial = `${prefix}-partial@example.test`
      const response = await register(post(partial, password))
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), { error: "Service unavailable" })
      assert.equal(await User.countDocuments({ email: partial }), 0)
      const failedLogin = await login(post(email, password))
      assert.equal(failedLogin.status, 503)
      assert.deepEqual(await failedLogin.json(), {
        error: "Service unavailable",
      })
    } finally {
      await db.command({
        collMod: Session.collection.name,
        validator: previous || {},
        validationLevel: previousLevel || "strict",
        validationAction: previousAction || "error",
      })
    }
  })

  it("sets production __Host- cookie flags without changing this test process", () => {
    const script = `import { json, setSessionCookie, SESSION_COOKIE, originAllowed, sourceAddress } from './lib/auth/server.ts'; const response = json({ok:true}); setSessionCookie(response, 'a'.repeat(64), new Date(Date.now()+10000)); console.log(SESSION_COOKIE + '\\n' + response.headers.get('set-cookie')); console.log('http-origin=' + originAllowed(new Request('http://127.0.0.1:3100', {headers:{origin:'http://127.0.0.1:3100'}}))); process.env.APP_ORIGIN='https://app.example.test'; console.log('https-origin=' + originAllowed(new Request('https://app.example.test', {headers:{origin:'https://app.example.test'}}))); delete process.env.AUTH_TRUSTED_IP_HEADER; console.log('missing-source=' + sourceAddress(new Request('https://app.example.test')))`
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        cwd: process.cwd(),
        env: { ...process.env, NODE_ENV: "production" },
        encoding: "utf8",
        timeout: 15000,
      }
    )
    assert.equal(child.status, 0, child.stderr)
    assert.match(child.stdout, /^__Host-ung_session\n/)
    for (const flag of ["secure", "httponly", "samesite=strict", "path=/"])
      assert.ok(child.stdout.toLowerCase().includes(flag))
    assert.ok(!child.stdout.toLowerCase().includes("domain="))
    assert.ok(child.stdout.includes("http-origin=false"))
    assert.ok(child.stdout.includes("https-origin=true"))
    assert.ok(child.stdout.includes("missing-source=null"))
  })
})
