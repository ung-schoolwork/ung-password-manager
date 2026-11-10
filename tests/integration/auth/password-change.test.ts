import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import mongoose from "mongoose"
import { POST as register } from "../../../app/api/auth/register/route"
import { POST as login } from "../../../app/api/auth/login/route"
import { GET as session } from "../../../app/api/auth/session/route"
import { POST as changePassword } from "../../../app/api/auth/password/route"
import { GET as vault } from "../../../app/api/vault/route"
import {
  Attempt,
  authenticatedUser,
  connectAuth,
  digest,
  issueSession,
  Session,
  User,
} from "../../../lib/auth/server"
import { accountBody, authKeyFor, wrappedVaultKey } from "./account-body"

const origin = "http://127.0.0.1:3100"
const prefix = `password-${randomUUID()}`
const password = "correct-password-123"
const newPassword = "brand-new-password-456"
const sources: string[] = []
const accountKeys: string[] = []
let globalAttempts = 0
const originalHeader = process.env.AUTH_TRUSTED_IP_HEADER

function freshSource() {
  const ip = `198.21.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`
  sources.push(ip)
  return ip
}
function track(email: string, ip: string) {
  globalAttempts += 1
  accountKeys.push(digest(`account:${ip}:${email}`))
}
function authRequest(
  email: string,
  secret: string,
  ip = freshSource(),
  cookie?: string
) {
  track(email, ip)
  return new Request(`${origin}/api/auth`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "x-test-client-ip": ip,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(accountBody(email, secret)),
  })
}
function cookiesOf(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
}
function sessionPart(cookies: string) {
  return cookies
    .split("; ")
    .filter((part) => part.startsWith("ung_session="))
    .join("; ")
}
function devicePart(cookies: string) {
  return cookies
    .split("; ")
    .filter((part) => part.startsWith("ung_device="))
    .join("; ")
}
/** A browser's cookies after a response replaced some of them. */
function merge(cookies: string, response: Response) {
  const updates = cookiesOf(response)
  const names = new Set(updates.split("; ").map((part) => part.split("=")[0]))
  return [
    ...cookies
      .split("; ")
      .filter((part) => part && !names.has(part.split("=")[0])),
    ...(updates ? updates.split("; ") : []),
  ].join("; ")
}
function change(
  email: string,
  cookies: string,
  body: object,
  {
    ip = freshSource(),
    requestOrigin = origin as string | null,
  }: { ip?: string; requestOrigin?: string | null } = {}
) {
  track(email, ip)
  return changePassword(
    new Request(`${origin}/api/auth/password`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookies,
        "x-test-client-ip": ip,
        ...(requestOrigin ? { origin: requestOrigin } : {}),
      },
      body: JSON.stringify(body),
    })
  )
}
function changeBody(from = password, to = newPassword) {
  return {
    currentAuthKey: authKeyFor(from),
    authKey: authKeyFor(to),
    wrappedVaultKey: wrappedVaultKey(),
  }
}
async function sessionStatus(cookies: string) {
  return (
    await session(
      new Request(`${origin}/api/auth/session`, {
        headers: { cookie: cookies },
      })
    )
  ).status
}
async function newAccount(name: string) {
  const email = `${prefix}-${name}@example.test`
  const created = await register(authRequest(email, password))
  assert.equal(created.status, 201)
  return { email, cookies: cookiesOf(created) }
}
async function stored(email: string) {
  return (await User.findOne({ email }).lean()) as unknown as {
    _id: mongoose.Types.ObjectId
    email: string
    authKeyHash: string
    salt: string
    wrappedVaultKey: unknown
    credentialsVersion?: number
  }
}

before(async () => {
  // Any database on the disposable test server; CI uses ung_auth_test.
  if (
    !process.env.MONGODB_URI?.startsWith("mongodb://127.0.0.1:27018/") ||
    process.env.APP_ORIGIN !== origin
  )
    throw new Error(
      "Set isolated MONGODB_URI and APP_ORIGIN before running password change integration tests"
    )
  process.env.AUTH_TRUSTED_IP_HEADER = "x-test-client-ip"
  await connectAuth()
})
after(async () => {
  const users = await User.find({ email: { $regex: `^${prefix}` } }).select(
    "_id"
  )
  const ids = users.map((user) => String(user._id))
  await Session.deleteMany({ userId: { $in: users.map((user) => user._id) } })
  await mongoose.connection
    .collection("accountdevices")
    .deleteMany({ ownerId: { $in: ids } })
  await mongoose.connection
    .collection("accountfirstdeviceapprovals")
    .deleteMany({ _id: { $in: ids } } as never)
  await User.deleteMany({ email: { $regex: `^${prefix}` } })
  await Attempt.deleteMany({
    key: {
      $in: [...sources.map((ip) => digest(`source:${ip}`)), ...accountKeys],
    },
  })
  await Attempt.updateOne(
    { key: digest("global"), count: { $gte: globalAttempts } },
    { $inc: { count: -globalAttempts } }
  )
  await mongoose.disconnect()
  if (originalHeader === undefined) delete process.env.AUTH_TRUSTED_IP_HEADER
  else process.env.AUTH_TRUSTED_IP_HEADER = originalHeader
})

describe("changing the account password", () => {
  it("replaces the verifier and wrapped key together, keeps this browser signed in and signs out every other session", async () => {
    const { email, cookies } = await newAccount("change")
    // Another session on the same approved browser, and one on an unapproved browser.
    const sameBrowser = cookiesOf(
      await login(
        authRequest(email, password, freshSource(), devicePart(cookies))
      )
    )
    const otherBrowser = cookiesOf(await login(authRequest(email, password)))
    const before = await stored(email)
    for (const other of [sameBrowser, otherBrowser])
      assert.equal(await sessionStatus(other), 200)

    const body = changeBody()
    const response = await change(email, cookies, body)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "no-store")
    const result = (await response.json()) as {
      user: { email: string }
      expiresAt: string
    }
    assert.equal(result.user.email, email)
    const current = merge(cookies, response)
    assert.notEqual(sessionPart(current), sessionPart(cookies))

    const after = await stored(email)
    assert.notEqual(after.authKeyHash, before.authKeyHash)
    assert.notEqual(after.salt, before.salt)
    assert.match(after.authKeyHash, /^scrypt-v1\$[a-f0-9]{128}$/)
    assert.ok(!after.authKeyHash.includes(body.authKey))
    // Stored exactly as the browser re-wrapped it.
    assert.deepEqual(after.wrappedVaultKey, body.wrappedVaultKey)
    assert.equal(after.credentialsVersion, 1)

    // This browser keeps working with its new session; every other one is out.
    assert.equal(await sessionStatus(current), 200)
    const opened = await vault(
      new Request(`${origin}/api/vault`, { headers: { cookie: current } })
    )
    assert.equal(opened.status, 200)
    assert.deepEqual(
      ((await opened.json()) as { wrappedVaultKey: unknown }).wrappedVaultKey,
      body.wrappedVaultKey
    )
    for (const old of [cookies, sameBrowser, otherBrowser]) {
      assert.equal(await sessionStatus(old), 401)
      assert.equal(
        await authenticatedUser(
          new Request(`${origin}/api/vault`, { headers: { cookie: old } })
        ),
        null
      )
    }
    assert.equal(await Session.countDocuments({ userId: after._id }), 1)

    // Only the new password signs in now.
    assert.equal((await login(authRequest(email, password))).status, 401)
    const again = await login(authRequest(email, newPassword))
    assert.equal(again.status, 200)
    assert.equal(await sessionStatus(cookiesOf(again)), 200)
  })

  it("rejects a sign-in that checked the old password before the change finished", async () => {
    const { email, cookies } = await newAccount("overlap")
    // What login holds after reading the account and before issuing its session.
    const readBeforeChange = await User.findOne({ email })
    assert.equal((await change(email, cookies, changeBody())).status, 200)
    const late = await issueSession(readBeforeChange)
    assert.equal(await sessionStatus(cookiesOf(late)), 401)
  })

  it("changes nothing for a wrong current password, an invalid body, another origin or an unapproved device", async () => {
    const { email, cookies } = await newAccount("rejected")
    const before = await stored(email)

    const wrong = await change(email, cookies, changeBody("wrong-password-123"))
    assert.equal(wrong.status, 401)
    assert.deepEqual(await wrong.json(), { error: "Invalid credentials" })

    for (const body of [
      {},
      { ...changeBody(), extra: true },
      { ...changeBody(), authKey: "not-hex" },
      { ...changeBody(), wrappedVaultKey: { version: 1 } },
      // The same auth key would mean the same password.
      changeBody(password, password),
    ])
      assert.equal((await change(email, cookies, body)).status, 400)

    assert.equal(
      (await change(email, cookies, changeBody(), { requestOrigin: null }))
        .status,
      403
    )
    assert.equal(
      (
        await change(email, cookies, changeBody(), {
          requestOrigin: "https://attacker.test",
        })
      ).status,
      403
    )
    assert.equal(
      (await change(email, devicePart(cookies), changeBody())).status,
      401
    )

    // Signed in with the right password, but on a browser not yet approved.
    const unapproved = cookiesOf(await login(authRequest(email, password)))
    const blocked = await change(email, unapproved, changeBody())
    assert.equal(blocked.status, 403)
    assert.deepEqual(await blocked.json(), { error: "Device not approved" })

    assert.deepEqual(await stored(email), before)
    assert.equal(await sessionStatus(cookies), 200)
    assert.equal(await sessionStatus(unapproved), 200)
  })

  it("lets only one of two simultaneous changes apply, so the verifier and wrapped key always match", async () => {
    const { email, cookies } = await newAccount("race")
    const first = changeBody(password, "first-new-password-1")
    const second = changeBody(password, "second-new-password-2")
    const responses = await Promise.all([
      change(email, cookies, first),
      change(email, cookies, second),
    ])
    const statuses = responses.map((response) => response.status).sort()
    assert.equal(statuses[0], 200)
    assert.ok([401, 409].includes(statuses[1]), `got ${statuses[1]}`)
    const winner = responses[0].status === 200 ? first : second
    const winnerPassword =
      winner === first ? "first-new-password-1" : "second-new-password-2"
    const after = await stored(email)
    assert.deepEqual(after.wrappedVaultKey, winner.wrappedVaultKey)
    assert.equal(after.credentialsVersion, 1)
    assert.equal((await login(authRequest(email, winnerPassword))).status, 200)
  })

  it("shares the sign-in rate limit", async () => {
    const { email, cookies } = await newAccount("limited")
    const ip = freshSource()
    for (let attempt = 0; attempt < 10; attempt++)
      assert.equal(
        (await change(email, cookies, changeBody("wrong-password-123"), { ip }))
          .status,
        401
      )
    const throttled = await change(email, cookies, changeBody(), { ip })
    assert.equal(throttled.status, 429)
    assert.ok(Number(throttled.headers.get("retry-after")) > 0)
    // The correct password is refused too until the window passes.
    assert.equal((await stored(email)).credentialsVersion ?? 0, 0)
    // Sign-in from that source for the account shares the same budget.
    assert.equal((await login(authRequest(email, password, ip))).status, 429)
  })

  it("signs this browser out cleanly when its new session cannot be created", async () => {
    const { email, cookies } = await newAccount("partial")
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
    const body = changeBody()
    await db.command({
      collMod: Session.collection.name,
      validator: { tokenDigest: { $exists: false } },
      validationLevel: "strict",
      validationAction: "error",
    })
    let response: Response
    try {
      response = await change(email, cookies, body)
    } finally {
      await db.command({
        collMod: Session.collection.name,
        validator: collection.options?.validator || {},
        validationLevel: collection.options?.validationLevel || "strict",
        validationAction: collection.options?.validationAction || "error",
      })
    }
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {
      error: "Password changed but sign-in failed. Please sign in.",
    })
    // The change is complete, so the new password opens the account and vault.
    assert.deepEqual(
      (await stored(email)).wrappedVaultKey,
      body.wrappedVaultKey
    )
    assert.equal(await sessionStatus(cookies), 401)
    assert.equal((await login(authRequest(email, newPassword))).status, 200)
  })
})
