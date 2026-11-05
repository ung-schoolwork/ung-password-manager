import { afterEach, describe, expect, it } from "bun:test"

import { respondToShare, ShareRequestError } from "../../../lib/sharing/client"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("respondToShare", () => {
  it("treats an already-removed share as a successful response", async () => {
    globalThis.fetch = Object.assign(
      async () => new Response(null, { status: 404 }),
      { preconnect: originalFetch.preconnect }
    )

    await expect(respondToShare("share-id")).resolves.toBeUndefined()
  })

  it("still reports failures other than an already-removed share", async () => {
    globalThis.fetch = Object.assign(
      async () =>
        Response.json({ error: "Service unavailable" }, { status: 503 }),
      { preconnect: originalFetch.preconnect }
    )

    await expect(respondToShare("share-id")).rejects.toBeInstanceOf(
      ShareRequestError
    )
  })
})
