import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import mongoose from "mongoose"
import { POST as register } from "../../../app/api/auth/register/route"
import { POST as login } from "../../../app/api/auth/login/route"
import {
  GET as listDevices,
  POST as registerDevice,
} from "../../../app/api/devices/route"
import { DELETE as remove } from "../../../app/api/devices/[id]/route"
import {
  Attempt,
  connectAuth,
  digest,
  Session,
  User,
} from "../../../lib/auth/server"
import { approvePendingDevice } from "../../../lib/devices/server"

const origin = "http://127.0.0.1:3100"
const prefix = `devices-${randomUUID()}`
const password = "correct-password-123"
const sources: string[] = []
const accountKeys: string[] = []
// Sign-ins this file adds to the shared global limit, undone afterwards so
// repeated runs do not exhaust it.
let globalAttempts = 0
const originalHeader = process.env.AUTH_TRUSTED_IP_HEADER

function freshSource() {
  const ip = `198.20.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`
  sources.push(ip)
  return ip
}
function authRequest(email: string, ip: string) {
  globalAttempts += 1
  accountKeys.push(digest(`account:${ip}:${email}`))
  return new Request(`${origin}/api/auth`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "x-test-client-ip": ip,
    },
    body: JSON.stringify({ email, password }),
  })
}
// A browser's cookie header: the session and device cookies from a response.
function cookiesOf(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
}
function withoutDevice(cookies: string) {
  return cookies
    .split("; ")
    .filter((part) => !part.includes("ung_device="))
    .join("; ")
}
function withoutSession(cookies: string) {
  return cookies
    .split("; ")
    .filter((part) => part.includes("ung_device="))
    .join("; ")
}
async function signIn(email: string) {
  const response = await login(authRequest(email, freshSource()))
  assert.equal(response.status, 200)
  return cookiesOf(response)
}
async function newAccount(name: string) {
  const email = `${prefix}-${name}@example.test`
  const created = await register(authRequest(email, freshSource()))
  assert.equal(created.status, 201)
  return { email, cookies: cookiesOf(created) }
}
function del(
  id: string,
  cookies: string,
  requestOrigin: string | null = origin
) {
  return remove(
    new Request(`${origin}/api/devices/${id}`, {
      method: "DELETE",
      headers: {
        cookie: cookies,
        ...(requestOrigin ? { origin: requestOrigin } : {}),
      },
    }),
    { params: Promise.resolve({ id }) }
  )
}
async function listed(cookies: string) {
  const response = await listDevices(
    new Request(`${origin}/api/devices`, { headers: { cookie: cookies } })
  )
  assert.equal(response.status, 200)
  return ((await response.json()) as { devices: { id: string }[] }).devices
}
async function deviceState(cookies: string) {
  const response = await registerDevice(
    new Request(`${origin}/api/devices`, {
      method: "POST",
      headers: { cookie: cookies, origin },
    })
  )
  assert.equal(response.status, 200)
  return (await response.json()) as {
    approved: boolean
    deviceId: string
    code?: string
  }
}
async function ownerId(email: string) {
  const owner = await User.findOne({ email }).lean()
  return String(owner!._id)
}
async function approvedCount(email: string) {
  return mongoose.connection
    .collection("accountdevices")
    .countDocuments({ ownerId: await ownerId(email), approved: true })
}
async function lockOf(email: string) {
  return mongoose.connection
    .collection<{ _id: string; holder: string; expiresAt: Date }>(
      "accountdeviceremovallocks"
    )
    .findOne({ _id: await ownerId(email) })
}
async function setLock(email: string, holder: string, expiresAt: Date) {
  await mongoose.connection
    .collection<{ _id: string; holder: string; expiresAt: Date }>(
      "accountdeviceremovallocks"
    )
    .insertOne({ _id: await ownerId(email), holder, expiresAt })
}
// Signs in a second browser, then approves it as an approved device would.
async function approvedSecondDevice(email: string) {
  const cookies = await signIn(email)
  const state = await deviceState(cookies)
  assert.equal(state.approved, false)
  assert.ok(await approvePendingDevice(await ownerId(email), state.code!))
  return { cookies, id: state.deviceId }
}

before(async () => {
  if (
    process.env.MONGODB_URI !== "mongodb://127.0.0.1:27018/ung_auth_test" ||
    process.env.APP_ORIGIN !== origin
  )
    throw new Error(
      "Set isolated MONGODB_URI and APP_ORIGIN before running device integration tests"
    )
  process.env.AUTH_TRUSTED_IP_HEADER = "x-test-client-ip"
  await connectAuth()
})
after(async () => {
  const users = await User.find({ email: { $regex: `^${prefix}` } }).select(
    "_id"
  )
  const ids = users.map((user) => String(user._id))
  await Session.deleteMany({ userId: { $in: ids } })
  await mongoose.connection
    .collection("accountdevices")
    .deleteMany({ ownerId: { $in: ids } })
  for (const name of [
    "accountdeviceremovallocks",
    "accountfirstdeviceapprovals",
  ])
    await mongoose.connection
      .collection(name)
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

describe("removing a device", () => {
  it("rejects the current device however its ID is cased or spaced", async () => {
    const { email, cookies } = await newAccount("current")
    const state = await deviceState(cookies)
    assert.equal(state.approved, true)
    const id = state.deviceId
    // Next.js decodes route params, so padding arrives as plain spaces.
    for (const attempt of [
      id,
      id.toUpperCase(),
      `${id.slice(0, 12).toUpperCase()}${id.slice(12)}`,
      ` ${id.toUpperCase()} `,
    ]) {
      const response = await del(attempt, cookies)
      assert.equal(response.status, 400, attempt)
      assert.deepEqual(
        await response.json(),
        { error: "Use another device to remove this one" },
        attempt
      )
    }
    // Still the only approved device, so the next browser must wait for approval.
    assert.equal((await listed(cookies)).length, 1)
    assert.equal((await deviceState(await signIn(email))).approved, false)
  })

  it("rejects malformed IDs without touching any device", async () => {
    const { cookies } = await newAccount("malformed")
    for (const id of [
      "not-an-id",
      "123",
      "abcdefghijkl", // twelve characters is a valid object ID to Mongoose
      "z".repeat(24),
      "a".repeat(25),
      "%00",
    ]) {
      assert.equal((await del(id, cookies)).status, 400, id)
    }
    assert.equal((await listed(cookies)).length, 1)
  })

  it("removes another approved device in any casing, and only once", async () => {
    const { email, cookies } = await newAccount("other")
    const second = await approvedSecondDevice(email)
    assert.equal((await listed(cookies)).length, 2)

    const removed = await del(second.id.toUpperCase(), cookies)
    assert.equal(removed.status, 200)
    assert.deepEqual(await removed.json(), { ok: true })
    assert.equal((await listed(cookies)).length, 1)

    assert.equal((await del(second.id, cookies)).status, 404)
    // The removed browser no longer counts as approved for the account.
    assert.equal(await approvedCount(email), 1)
  })

  it("cannot remove another account's device", async () => {
    const mine = await newAccount("mine")
    const theirs = await newAccount("theirs")
    const theirId = (await deviceState(theirs.cookies)).deviceId
    assert.equal((await del(theirId, mine.cookies)).status, 404)
    assert.equal((await listed(theirs.cookies)).length, 1)
    assert.equal((await listed(mine.cookies)).length, 1)
  })

  it("rejects pending devices, signed-out requests and foreign origins", async () => {
    const { email, cookies } = await newAccount("access")
    const id = (await deviceState(cookies)).deviceId
    const pending = await signIn(email)
    assert.equal((await del(id, pending)).status, 403)
    assert.equal((await del(id, withoutSession(cookies))).status, 401)
    assert.equal((await del(id, withoutDevice(cookies))).status, 403)
    assert.equal((await del(id, cookies, "http://attacker.test")).status, 403)
    assert.equal(await approvedCount(email), 1)
  })

  it("never lets two devices remove each other and leave none approved", async () => {
    const { email, cookies } = await newAccount("race")
    const second = await approvedSecondDevice(email)
    const firstId = (await deviceState(cookies)).deviceId

    await Promise.all([del(second.id, cookies), del(firstId, second.cookies)])
    assert.equal(await approvedCount(email), 1)
    // The next browser still has to be approved by the remaining device.
    assert.equal((await deviceState(await signIn(email))).approved, false)
  })

  it("refuses removal on behalf of a device that is no longer approved", async () => {
    const { email, cookies } = await newAccount("stale")
    const second = await approvedSecondDevice(email)
    const firstId = (await deviceState(cookies)).deviceId

    assert.equal((await del(second.id, cookies)).status, 200)
    // A removed device can no longer act on behalf of the account.
    assert.equal((await del(firstId, second.cookies)).status, 403)
    // The remaining approved device cannot remove itself.
    assert.equal((await del(firstId, cookies)).status, 400)
    assert.equal(await approvedCount(email), 1)
  })

  it("never trusts the next browser automatically once all devices are gone", async () => {
    const { email } = await newAccount("emptied")
    // However the approved devices disappear, the account stays protected.
    await mongoose.connection
      .collection("accountdevices")
      .deleteMany({ ownerId: await ownerId(email) })
    assert.equal(await approvedCount(email), 0)
    assert.equal((await deviceState(await signIn(email))).approved, false)
    assert.equal(await approvedCount(email), 0)
  })

  it("protects accounts whose first device was approved before this record existed", async () => {
    const { email } = await newAccount("legacy")
    const owner = await ownerId(email)
    await mongoose.connection
      .collection("accountfirstdeviceapprovals")
      .deleteOne({ _id: owner } as never)
    // A new browser signs in while the first device is still approved.
    assert.equal((await deviceState(await signIn(email))).approved, false)
    // Even after the first device is gone, the next browser must wait.
    await mongoose.connection
      .collection("accountdevices")
      .deleteMany({ ownerId: owner })
    assert.equal((await deviceState(await signIn(email))).approved, false)
  })

  it("takes over an expired lock and waits for a live one", async () => {
    const { email, cookies } = await newAccount("locks")
    const second = await approvedSecondDevice(email)
    await approvedSecondDevice(email)

    await setLock(email, "live-holder", new Date(Date.now() + 60_000))
    assert.equal((await del(second.id, cookies)).status, 409)
    assert.equal(await approvedCount(email), 3)
    // The busy request leaves the other holder's lock in place.
    assert.equal((await lockOf(email))?.holder, "live-holder")

    await mongoose.connection
      .collection("accountdeviceremovallocks")
      .deleteOne({ _id: await ownerId(email) } as never)
    await setLock(email, "crashed-holder", new Date(Date.now() - 1_000))
    assert.equal((await del(second.id, cookies)).status, 200)
    assert.equal(await approvedCount(email), 2)
    assert.equal(await lockOf(email), null)
  })
})
