import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import mongoose from "mongoose"
import { POST as register } from "../../../app/api/auth/register/route"
import { POST as registerDevice } from "../../../app/api/devices/route"
import {
  GET as listSharesRoute,
  POST as createShareRoute,
} from "../../../app/api/shares/route"
import {
  DELETE as removeShareRoute,
  GET as readShareRoute,
} from "../../../app/api/shares/[id]/route"
import {
  Attempt,
  connectAuth,
  digest,
  Session,
  User,
} from "../../../lib/auth/server"
import { CredentialShare } from "../../../lib/sharing/server"
import { accountBody } from "../auth/account-body"

const origin = "http://127.0.0.1:3100"
const prefix = `shares-${randomUUID()}`
const secret = `shared-secret-${randomUUID()}`
const sources: string[] = []
const accountKeys: string[] = []
const originalHeader = process.env.AUTH_TRUSTED_IP_HEADER
const originalShareKey = process.env.SHARE_ENCRYPTION_KEY

const credential = {
  accountName: "Team router",
  siteOrApp: "router.example.test",
  username: "admin",
  password: secret,
  notes: "Shared for setup",
}

type Account = { email: string; cookies: string; id: string }

function cookiesOf(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
}

async function newAccount(name: string): Promise<Account> {
  const email = `${prefix}-${name}@example.test`
  const ip = `198.21.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`
  sources.push(ip)
  accountKeys.push(digest(`account:${ip}:${email}`))
  const created = await register(
    new Request(`${origin}/api/auth/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "x-test-client-ip": ip,
      },
      body: JSON.stringify(accountBody(email, "correct-password-123")),
    })
  )
  assert.equal(created.status, 201)
  const cookies = cookiesOf(created)
  const device = await registerDevice(
    new Request(`${origin}/api/devices`, {
      method: "POST",
      headers: { cookie: cookies, origin },
    })
  )
  assert.equal(((await device.json()) as { approved: boolean }).approved, true)
  const user = await User.findOne({ email }).lean()
  return { email, cookies, id: String(user!._id) }
}

async function share(
  from: Account,
  to: Account,
  expiresAt: string | null = null
) {
  const response = await createShareRoute(
    new Request(`${origin}/api/shares`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: from.cookies,
        origin,
      },
      body: JSON.stringify({ recipientEmail: to.email, credential, expiresAt }),
    })
  )
  return response
}

async function sharedId(from: Account, to: Account, expiresAt?: string) {
  const response = await share(from, to, expiresAt)
  assert.equal(response.status, 201)
  return ((await response.json()) as { id: string }).id
}

function read(id: string, account: Account | null) {
  return readShareRoute(
    new Request(`${origin}/api/shares/${id}`, {
      headers: account ? { cookie: account.cookies } : {},
    }),
    { params: Promise.resolve({ id }) }
  )
}

function remove(id: string, account: Account) {
  return removeShareRoute(
    new Request(`${origin}/api/shares/${id}`, {
      method: "DELETE",
      headers: { cookie: account.cookies, origin },
    }),
    { params: Promise.resolve({ id }) }
  )
}

type Listed = {
  id: string
  status: string
  accountName: string
  removedBy: string | null
}
async function lists(account: Account) {
  const response = await listSharesRoute(
    new Request(`${origin}/api/shares`, {
      headers: { cookie: account.cookies },
    })
  )
  assert.equal(response.status, 200)
  const text = await response.text()
  // Lists never carry a credential, active or not.
  assert.ok(!text.includes(secret), "list leaked the shared password")
  return JSON.parse(text) as { incoming: Listed[]; outgoing: Listed[] }
}

async function stored(id: string) {
  return CredentialShare.findById(id).lean()
}

async function expireNow(id: string) {
  await CredentialShare.updateOne(
    { _id: id },
    { $set: { expiresAt: new Date(Date.now() - 1000) } }
  )
}

before(async () => {
  const uri = process.env.MONGODB_URI ?? ""
  if (!uri.startsWith("mongodb://127.0.0.1:27018/") || !/_test$/.test(uri))
    throw new Error(
      "Set an isolated MONGODB_URI on 127.0.0.1:27018 ending in _test before running sharing integration tests"
    )
  if (process.env.APP_ORIGIN !== origin)
    throw new Error(`Set APP_ORIGIN=${origin}`)
  process.env.AUTH_TRUSTED_IP_HEADER = "x-test-client-ip"
  process.env.SHARE_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64")
  await connectAuth()
})

after(async () => {
  const users = await User.find({ email: { $regex: `^${prefix}` } }).select(
    "_id"
  )
  const ids = users.map((user) => String(user._id))
  await CredentialShare.deleteMany({
    $or: [{ fromUserId: { $in: ids } }, { toUserId: { $in: ids } }],
  })
  await Session.deleteMany({ userId: { $in: ids } })
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
  await mongoose.disconnect()
  if (originalHeader === undefined) delete process.env.AUTH_TRUSTED_IP_HEADER
  else process.env.AUTH_TRUSTED_IP_HEADER = originalHeader
  if (originalShareKey === undefined) delete process.env.SHARE_ENCRYPTION_KEY
  else process.env.SHARE_ENCRYPTION_KEY = originalShareKey
})

describe("shared credential lifetime", () => {
  it("lets the recipient read an active share, and no one else", async () => {
    const owner = await newAccount("active-owner")
    const recipient = await newAccount("active-recipient")
    const stranger = await newAccount("active-stranger")
    const id = await sharedId(
      owner,
      recipient,
      new Date(Date.now() + 60 * 60 * 1000).toISOString()
    )

    const response = await read(id, recipient)
    assert.equal(response.status, 200)
    const body = (await response.json()) as {
      credential: typeof credential
      expiresAt: string | null
    }
    assert.equal(body.credential.password, secret)
    assert.ok(body.expiresAt)

    assert.equal((await read(id, owner)).status, 404)
    assert.equal((await read(id, stranger)).status, 404)
    assert.equal((await read(id, null)).status, 401)
    assert.equal((await read("not-an-id", recipient)).status, 404)

    const incoming = (await lists(recipient)).incoming
    assert.deepEqual(
      incoming.map(({ id, status, accountName }) => ({
        id,
        status,
        accountName,
      })),
      [{ id, status: "active", accountName: credential.accountName }]
    )
    assert.equal((await lists(owner)).outgoing[0].status, "active")
  })

  it("refuses to return an expired share and deletes its credential", async () => {
    const owner = await newAccount("expired-owner")
    const recipient = await newAccount("expired-recipient")
    const id = await sharedId(
      owner,
      recipient,
      new Date(Date.now() + 60 * 60 * 1000).toISOString()
    )
    await expireNow(id)

    const response = await read(id, recipient)
    assert.equal(response.status, 410)
    const text = await response.text()
    assert.ok(!text.includes(secret))
    assert.equal((JSON.parse(text) as { status: string }).status, "expired")
    assert.equal((await stored(id))?.payload, undefined)

    assert.equal((await lists(recipient)).incoming[0].status, "expired")
    const outgoing = (await lists(owner)).outgoing[0]
    assert.equal(outgoing.status, "expired")
    assert.equal(outgoing.accountName, credential.accountName)
  })

  it("wipes expired credentials when either list is read", async () => {
    const owner = await newAccount("sweep-owner")
    const recipient = await newAccount("sweep-recipient")
    const id = await sharedId(
      owner,
      recipient,
      new Date(Date.now() + 60 * 60 * 1000).toISOString()
    )
    await expireNow(id)
    await lists(owner)
    assert.equal((await stored(id))?.payload, undefined)
  })

  it("revoking deletes the credential but keeps the share listed as removed", async () => {
    const owner = await newAccount("revoke-owner")
    const recipient = await newAccount("revoke-recipient")
    const id = await sharedId(owner, recipient)
    assert.equal((await read(id, recipient)).status, 200)

    const revoked = await remove(id, owner)
    assert.equal(revoked.status, 200)
    assert.deepEqual(await revoked.json(), {
      ok: true,
      role: "owner",
      status: "removed",
    })

    const response = await read(id, recipient)
    assert.equal(response.status, 410)
    const text = await response.text()
    assert.ok(!text.includes(secret))
    assert.equal((JSON.parse(text) as { status: string }).status, "removed")

    const record = await stored(id)
    assert.equal(record?.payload, undefined)
    assert.ok(record?.revokedAt)
    assert.equal(record?.revokedBy, "owner")

    const outgoing = (await lists(owner)).outgoing[0]
    assert.equal(outgoing.status, "removed")
    assert.equal(outgoing.removedBy, "owner")
    assert.equal(outgoing.accountName, credential.accountName)
    assert.equal((await lists(recipient)).incoming[0].status, "removed")

    // Revoking does not come back to life when the share is touched again.
    assert.equal((await read(id, recipient)).status, 410)
  })

  it("a revoked share cannot be read even if its end date is later", async () => {
    const owner = await newAccount("revoke-dated-owner")
    const recipient = await newAccount("revoke-dated-recipient")
    const id = await sharedId(
      owner,
      recipient,
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    )
    assert.equal((await remove(id, owner)).status, 200)
    assert.equal((await read(id, recipient)).status, 410)
  })

  it("a recipient who declines loses access and the owner sees it removed", async () => {
    const owner = await newAccount("decline-owner")
    const recipient = await newAccount("decline-recipient")
    const id = await sharedId(owner, recipient)

    assert.equal((await remove(id, recipient)).status, 200)
    assert.equal((await read(id, recipient)).status, 404)
    assert.deepEqual((await lists(recipient)).incoming, [])
    const outgoing = (await lists(owner)).outgoing[0]
    assert.equal(outgoing.status, "removed")
    assert.equal(outgoing.removedBy, "recipient")
    assert.equal((await stored(id))?.payload, undefined)
  })

  it("each side clears an ended share, and the record goes once both have", async () => {
    const owner = await newAccount("clear-owner")
    const recipient = await newAccount("clear-recipient")
    const id = await sharedId(owner, recipient)
    assert.equal((await remove(id, owner)).status, 200)

    assert.equal((await remove(id, owner)).status, 200)
    assert.deepEqual((await lists(owner)).outgoing, [])
    assert.equal((await lists(recipient)).incoming.length, 1)
    assert.equal((await remove(id, owner)).status, 404)

    assert.equal((await remove(id, recipient)).status, 200)
    assert.deepEqual((await lists(recipient)).incoming, [])
    assert.equal(await stored(id), null)
  })

  it("someone else cannot revoke a share", async () => {
    const owner = await newAccount("other-owner")
    const recipient = await newAccount("other-recipient")
    const stranger = await newAccount("other-stranger")
    const id = await sharedId(owner, recipient)
    assert.equal((await remove(id, stranger)).status, 404)
    assert.equal((await read(id, recipient)).status, 200)
  })

  it("treats a share saved before end dates existed as active with no end date", async () => {
    const owner = await newAccount("legacy-owner")
    const recipient = await newAccount("legacy-recipient")
    const id = await sharedId(owner, recipient)
    // Strip the record back to the fields older versions stored.
    await CredentialShare.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(id) },
      {
        $unset: {
          toEmail: 1,
          summary: 1,
          expiresAt: 1,
          revokedAt: 1,
          revokedBy: 1,
          ownerDismissedAt: 1,
          recipientDismissedAt: 1,
        },
      }
    )

    const response = await read(id, recipient)
    assert.equal(response.status, 200)
    assert.equal(
      ((await response.json()) as { expiresAt: string | null }).expiresAt,
      null
    )
    const outgoing = (await lists(owner)).outgoing[0] as Listed & {
      toEmail: string
      expiresAt: string | null
    }
    assert.equal(outgoing.status, "active")
    assert.equal(outgoing.toEmail, recipient.email)
    assert.equal(outgoing.expiresAt, null)

    assert.equal((await remove(id, owner)).status, 200)
    assert.equal((await read(id, recipient)).status, 410)
    assert.equal(
      (await lists(owner)).outgoing[0].accountName,
      credential.accountName
    )
  })

  it("rejects end dates in the past, too far ahead, or malformed", async () => {
    const owner = await newAccount("bad-date-owner")
    const recipient = await newAccount("bad-date-recipient")
    for (const expiresAt of [
      new Date(Date.now() - 60_000).toISOString(),
      new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString(),
      "soon",
    ])
      assert.equal((await share(owner, recipient, expiresAt)).status, 400)
    assert.deepEqual((await lists(recipient)).incoming, [])
  })
})
