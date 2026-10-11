import { request as httpRequest } from "node:http"
import { expect, test } from "@playwright/test"
import { encryptVault, decryptVault } from "../../lib/vault/crypto.client"
import { registerAccount, vaultPassword } from "./account-helpers"

const origin = "http://127.0.0.1:3100"

test("encrypted vault storage requires an authenticated account", async ({
  request,
}) => {
  const response = await request.get("/api/vault")
  expect(response.status()).toBe(401)
  expect(response.headers()["cache-control"]).toBe("no-store")
  const write = await request.put("/api/vault", {
    headers: { Origin: origin },
    data: {},
  })
  expect(write.status()).toBe(401)
})

test("an account can save and retrieve its encrypted vault", async ({
  page,
}) => {
  await registerAccount(page)
  const missing = await page.request.get("/api/vault")
  expect(missing.status()).toBe(200)
  expect(await missing.json()).toEqual({ envelope: null, revision: null })

  const timestamp = "2026-01-01T00:00:00.000Z"
  const data = {
    version: 1 as const,
    credentials: [
      {
        id: crypto.randomUUID(),
        accountName: "Private account",
        siteOrApp: "private.example.test",
        username: "private-user",
        password: "private-credential-password",
        createdAt: timestamp,
        updatedAt: timestamp,
        passwordUpdatedAt: timestamp,
      },
    ],
  }
  const envelope = await encryptVault(vaultPassword, data)
  const response = await page.request.put("/api/vault", {
    headers: { Origin: origin },
    data: { envelope, expectedRevision: null },
  })
  expect(response.status()).toBe(200)
  const saved = await response.json()
  expect(saved.revision).toEqual(expect.any(String))
  const retrieved = await page.request.get("/api/vault")
  expect(retrieved.status()).toBe(200)
  expect(await retrieved.json()).toEqual({ envelope, revision: saved.revision })
  expect(JSON.stringify(await retrieved.json())).not.toContain(
    data.credentials[0].password
  )
  expect(JSON.stringify(await retrieved.json())).not.toContain(vaultPassword)
  expect(
    await decryptVault(vaultPassword, (await retrieved.json()).envelope)
  ).toEqual(data)
})

test("vault reads and writes cannot target another account", async ({
  page,
  browser,
}) => {
  const owner = await registerAccount(page)
  const envelope = await encryptVault(vaultPassword, {
    version: 1,
    credentials: [],
  })
  const created = await page.request.put("/api/vault", {
    headers: { Origin: origin },
    data: { envelope, expectedRevision: null },
  })
  expect(created.status()).toBe(200)
  const { revision } = await created.json()

  const otherContext = await browser.newContext()
  try {
    const other = await otherContext.newPage()
    await registerAccount(other)
    const response = await other.request.get(`/api/vault?ownerId=${owner.id}`)
    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual({ envelope: null, revision: null })
    const attempt = await other.request.put("/api/vault", {
      headers: { Origin: origin },
      data: { envelope, expectedRevision: revision },
    })
    expect(attempt.status()).toBe(409)
    const forgedOwner = await other.request.put("/api/vault", {
      headers: { Origin: origin },
      data: { envelope, expectedRevision: null, ownerId: owner.id },
    })
    expect(forgedOwner.status()).toBe(400)
    const unchanged = await page.request.get("/api/vault")
    expect(await unchanged.json()).toEqual({ envelope, revision })
  } finally {
    await otherContext.close()
  }
})

test("only one concurrent create or revision-checked save can succeed", async ({
  page,
}) => {
  await registerAccount(page)
  const envelope = await encryptVault(vaultPassword, {
    version: 1,
    credentials: [],
  })
  const create = () =>
    page.request.put("/api/vault", {
      headers: { Origin: origin },
      data: { envelope, expectedRevision: null },
    })
  const created = await Promise.all([create(), create()])
  expect(created.map((response) => response.status()).sort()).toEqual([
    200, 409,
  ])
  const { revision } = await created
    .find((response) => response.status() === 200)!
    .json()
  const first = await encryptVault(vaultPassword, {
    version: 1,
    credentials: [],
  })
  const second = await encryptVault(vaultPassword, {
    version: 1,
    credentials: [],
  })
  const results = await Promise.all(
    [first, second].map((envelope) =>
      page.request.put("/api/vault", {
        headers: { Origin: origin },
        data: { envelope, expectedRevision: revision },
      })
    )
  )
  expect(results.map((response) => response.status()).sort()).toEqual([
    200, 409,
  ])
  const winner = results.findIndex((response) => response.status() === 200)
  const saved = await results[winner].json()
  expect(saved.revision).not.toBe(revision)
  const latest = await page.request.get("/api/vault")
  expect(await latest.json()).toEqual({
    envelope: [first, second][winner],
    revision: saved.revision,
  })
  const stale = await page.request.put("/api/vault", {
    headers: { Origin: origin },
    data: { envelope, expectedRevision: revision },
  })
  expect(stale.status()).toBe(409)
  const unchanged = await page.request.get("/api/vault")
  expect(await unchanged.json()).toEqual(await latest.json())
})

test("vault writes reject forged origins, plaintext fields, malformed and oversized payloads", async ({
  page,
}) => {
  await registerAccount(page)
  const envelope = await encryptVault(vaultPassword, {
    version: 1,
    credentials: [],
  })
  const valid = { envelope, expectedRevision: null }
  const forbidden = await page.request.put("/api/vault", {
    headers: { Origin: "https://other.example.test" },
    data: valid,
  })
  expect(forbidden.status()).toBe(403)
  const invalid = [
    { ...valid, password: "readable-vault-password" },
    { ...valid, envelope: { ...envelope, credentials: [] } },
    { ...valid, envelope: { ...envelope, version: 2 } },
    {
      ...valid,
      envelope: {
        ...envelope,
        kdf: { ...envelope.kdf, iterations: 2_000_000 },
      },
    },
    {
      ...valid,
      envelope: { ...envelope, cipher: { ...envelope.cipher, iv: "bad" } },
    },
    { ...valid, envelope: { ...envelope, ciphertext: "not-base64" } },
    { ...valid, expectedRevision: { $ne: null } },
  ]
  for (const data of invalid) {
    const response = await page.request.put("/api/vault", {
      headers: { Origin: origin },
      data,
    })
    expect(response.status()).toBe(400)
  }
  const malformed = await page.request.put("/api/vault", {
    headers: { Origin: origin, "Content-Type": "application/json" },
    data: "{",
  })
  expect(malformed.status()).toBe(400)
  const oversized = await page.request.put("/api/vault", {
    headers: { Origin: origin },
    data: {
      ...valid,
      envelope: { ...envelope, ciphertext: "A".repeat(1024 * 1024) },
    },
  })
  expect(oversized.status()).toBe(400)
  expect(await (await page.request.get("/api/vault")).json()).toEqual({
    envelope: null,
    revision: null,
  })
})

test("the size limit also applies to chunked bodies with no declared length", async ({
  page,
}) => {
  await registerAccount(page)
  const envelope = await encryptVault(vaultPassword, {
    version: 1,
    credentials: [],
  })
  const cookies = await page.context().cookies()
  const cookie = cookies.map(({ name, value }) => `${name}=${value}`).join("; ")
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(
      `${origin}/api/vault`,
      {
        method: "PUT",
        headers: {
          Origin: origin,
          Cookie: cookie,
          "Content-Type": "application/json",
          "Transfer-Encoding": "chunked",
        },
      },
      (response) => {
        response.resume()
        response.once("end", () => resolve(response.statusCode))
        response.once("error", reject)
      }
    )
    request.once("error", reject)
    request.setTimeout(10_000, () =>
      request.destroy(new Error("Vault request timed out"))
    )
    request.end(
      " ".repeat(1024 * 1024 + 1) +
        JSON.stringify({ envelope, expectedRevision: null })
    )
  })
  expect(status).toBe(400)
  expect(await (await page.request.get("/api/vault")).json()).toEqual({
    envelope: null,
    revision: null,
  })
})

test("revoked sessions cannot read or write a saved vault", async ({
  page,
}) => {
  await registerAccount(page)
  const envelope = await encryptVault(vaultPassword, {
    version: 1,
    credentials: [],
  })
  const created = await page.request.put("/api/vault", {
    headers: { Origin: origin },
    data: { envelope, expectedRevision: null },
  })
  expect(created.status()).toBe(200)
  const { revision } = await created.json()
  const logout = await page.request.post("/api/auth/logout", {
    headers: { Origin: origin },
    data: {},
  })
  expect(logout.status()).toBe(200)
  expect((await page.request.get("/api/vault")).status()).toBe(401)
  const rejected = await page.request.put("/api/vault", {
    headers: { Origin: origin },
    data: { envelope, expectedRevision: revision },
  })
  expect(rejected.status()).toBe(401)
})
