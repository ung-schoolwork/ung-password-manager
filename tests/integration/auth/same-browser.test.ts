import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import mongoose from "mongoose"
import { POST as register } from "../../../app/api/auth/register/route"
import { POST as login } from "../../../app/api/auth/login/route"
import { POST as logout } from "../../../app/api/auth/logout/route"
import {
  GET as listDevices,
  POST as registerDevice,
} from "../../../app/api/devices/route"
import {
  Attempt,
  connectAuth,
  digest,
  Session,
  User,
} from "../../../lib/auth/server"
import { approvePendingDevice, removeDevice } from "../../../lib/devices/server"

const origin = "http://127.0.0.1:3100"
const prefix = `same-browser-${randomUUID()}`
const password = "correct-password-123"
const sources: string[] = []
const originalHeader = process.env.AUTH_TRUSTED_IP_HEADER
const accountKeys: string[] = []
// Sign-ins this file adds to the shared global limit, undone afterwards so
// repeated runs do not exhaust it.
let globalAttempts = 0

// One browser's cookie jar, shared by every account that signs in on it.
class Browser {
  private cookies = new Map<string, string>()
  readonly ip = `198.21.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`
  constructor() {
    sources.push(this.ip)
  }
  get header() {
    return [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ")
  }
  /** The device tokens this browser holds, one per account. */
  deviceTokens() {
    return (this.cookies.get("ung_device") ?? "").split(".").filter(Boolean)
  }
  setDeviceCookie(value: string) {
    this.cookies.set("ung_device", value)
  }
  private counted(email: string) {
    globalAttempts += 1
    accountKeys.push(digest(`account:${this.ip}:${email}`))
  }
  store(response: Response) {
    for (const value of response.headers.getSetCookie()) {
      const [pair] = value.split(";")
      const index = pair.indexOf("=")
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1))
    }
    return response
  }
  request(path: string, method = "POST", body?: unknown) {
    return new Request(`${origin}${path}`, {
      method,
      headers: {
        origin,
        "x-test-client-ip": this.ip,
        ...(body ? { "content-type": "application/json" } : {}),
        ...(this.cookies.size ? { cookie: this.header } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  }
  async register(email: string) {
    this.counted(email)
    const response = this.store(
      await register(this.request("/api/auth", "POST", { email, password }))
    )
    assert.equal(response.status, 201)
  }
  async signIn(email: string) {
    const response = this.store(await this.login(email))
    assert.equal(response.status, 200)
  }
  login(email: string) {
    this.counted(email)
    return login(this.request("/api/auth", "POST", { email, password }))
  }
  async signOut() {
    assert.equal((await logout(this.request("/api/auth/logout"))).status, 200)
  }
  async state() {
    const response = this.store(
      await registerDevice(this.request("/api/devices"))
    )
    assert.equal(response.status, 200)
    return (await response.json()) as {
      approved: boolean
      deviceId: string
      code?: string
    }
  }
  async canListDevices() {
    return (await listDevices(this.request("/api/devices", "GET"))).status
  }
}

function accountEmail(name: string) {
  return `${prefix}-${name}@example.test`
}
async function ownerId(email: string) {
  return String((await User.findOne({ email }).lean())!._id)
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

describe("two accounts on the same browser", () => {
  it("keeps the first account's only approved device after another account signs in", async () => {
    const a = accountEmail("a")
    const b = accountEmail("b")
    const browser = new Browser()

    await browser.register(a)
    const first = await browser.state()
    assert.equal(first.approved, true)
    const [token] = browser.deviceTokens()
    await browser.signOut()

    await browser.register(b)
    assert.ok(
      browser.deviceTokens().includes(token),
      "the browser keeps the first account's token"
    )
    assert.equal(browser.deviceTokens().length, 2)
    const second = await browser.state()
    assert.equal(second.approved, true, "B's first device is trusted")
    assert.notEqual(second.deviceId, first.deviceId)
    await browser.signOut()

    await browser.signIn(a)
    const again = await browser.state()
    assert.equal(again.approved, true)
    assert.equal(again.deviceId, first.deviceId)
    assert.equal(await browser.canListDevices(), 200)

    await browser.signOut()
    await browser.signIn(b)
    assert.equal((await browser.state()).deviceId, second.deviceId)
    assert.equal(await browser.canListDevices(), 200)
  })

  it("leaves another account's approval alone while this account waits for approval", async () => {
    const a = accountEmail("pending-a")
    const b = accountEmail("pending-b")
    const shared = new Browser()
    const bOwn = new Browser()

    await bOwn.register(b)
    await bOwn.state()
    await bOwn.signOut()
    await shared.register(a)
    const aDevice = await shared.state()
    await shared.signOut()

    // B already has an approved device elsewhere, so this browser waits for B.
    await shared.signIn(b)
    const pending = await shared.state()
    assert.equal(pending.approved, false)
    assert.equal(await shared.canListDevices(), 403)
    await shared.signOut()

    await shared.signIn(a)
    assert.equal((await shared.state()).approved, true)
    await shared.signOut()

    // Approving B, then removing B's approval, never touches A's.
    await shared.signIn(b)
    const code = (await shared.state()).code!
    assert.ok(await approvePendingDevice(await ownerId(b), code))
    assert.equal((await shared.state()).approved, true)
    await shared.signOut()
    // B's other device removes B's approval on the shared browser.
    assert.equal(
      await removeDevice(await ownerId(b), pending.deviceId),
      true
    )

    await shared.signIn(a)
    const afterAll = await shared.state()
    assert.equal(afterAll.approved, true)
    assert.equal(afterAll.deviceId, aDevice.deviceId)
  })

  it("never trusts a token the browser was given by someone else", async () => {
    const attacker = new Browser()
    await attacker.register(accountEmail("attacker"))
    const [attackerToken] = attacker.deviceTokens()
    await attacker.signOut()

    // Someone plants a made-up token, or their own account's token, before
    // the victim signs up on this browser.
    for (const [name, planted] of [
      ["made-up", "ab".repeat(32)],
      ["borrowed", attackerToken],
    ]) {
      const victim = accountEmail(`victim-${name}`)
      const browser = new Browser()
      browser.setDeviceCookie(planted)
      await browser.register(victim)
      assert.equal((await browser.state()).approved, true, name)
      assert.notEqual(browser.deviceTokens()[0], planted, name)

      // The planted token does not let another browser open the victim's vault.
      const elsewhere = new Browser()
      elsewhere.setDeviceCookie(planted)
      await elsewhere.signIn(victim)
      assert.equal((await elsewhere.state()).approved, false, name)
      assert.equal(await elsewhere.canListDevices(), 403, name)
    }
  })

  it("handles two sign-ins from the same browser at once", async () => {
    const a = accountEmail("race-a")
    const b = accountEmail("race-b")
    const elsewhere = new Browser()
    await elsewhere.register(b)
    const browser = new Browser()
    await browser.register(a)
    await browser.signOut()

    const responses = await Promise.all([browser.login(b), browser.login(b)])
    assert.deepEqual(
      responses.map((response) => response.status),
      [200, 200]
    )
    browser.store(responses[1])
    assert.equal((await browser.state()).approved, false)
    await browser.signOut()
    await browser.signIn(a)
    assert.equal((await browser.state()).approved, true)
  })

  it("forgets only the account added longest ago once the browser is full", async () => {
    const browser = new Browser()
    const emails = Array.from({ length: 9 }, (_, n) =>
      accountEmail(`many-${n}`)
    )
    for (const email of emails) {
      await browser.register(email)
      await browser.signOut()
    }
    assert.equal(browser.deviceTokens().length, 8)
    await browser.signIn(emails[1])
    assert.equal((await browser.state()).approved, true)
    await browser.signOut()
    // The first account's token was dropped, so it must approve this browser again.
    await browser.signIn(emails[0])
    assert.equal((await browser.state()).approved, false)
  })
})
