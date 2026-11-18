import { describe, expect, it } from "bun:test"

import { readJsonObject } from "../../../lib/http/json-body"

const url = "https://app.example.test/api"

function jsonRequest(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  })
}

// A body sent in pieces with no Content-Length, as a client can choose to.
function streamedRequest(parts: string[]) {
  const encoder = new TextEncoder()
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = parts.shift()
      if (next === undefined) controller.close()
      else controller.enqueue(encoder.encode(next))
    },
    cancel() {
      cancelled = true
    },
  })
  const request = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit)
  return { request, wasCancelled: () => cancelled }
}

describe("readJsonObject", () => {
  it("returns a JSON object within the limit", async () => {
    const request = jsonRequest(JSON.stringify({ code: "ABCD" }))
    expect(await readJsonObject(request, 1024)).toEqual({ code: "ABCD" })
  })

  it("accepts a charset parameter on the content type", async () => {
    const request = jsonRequest("{}", {
      "content-type": "application/json; charset=utf-8",
    })
    expect(await readJsonObject(request, 1024)).toEqual({})
  })

  it("refuses other content types", async () => {
    for (const type of ["text/plain", "application/jsonp", ""]) {
      const request = jsonRequest("{}", { "content-type": type })
      expect(await readJsonObject(request, 1024)).toBeNull()
    }
  })

  it("refuses malformed JSON instead of throwing", async () => {
    expect(await readJsonObject(jsonRequest("{not json"), 1024)).toBeNull()
  })

  it("refuses JSON that is not a plain object", async () => {
    for (const body of ["null", "[]", "[1,2]", '"text"', "42"]) {
      expect(await readJsonObject(jsonRequest(body), 1024)).toBeNull()
    }
  })

  it("refuses a request with no body", async () => {
    const request = new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
    })
    expect(await readJsonObject(request, 1024)).toBeNull()
  })

  it("refuses a declared Content-Length over the limit or not a number", async () => {
    const body = JSON.stringify({ a: 1 })
    for (const length of ["2048", "-1", "12abc"]) {
      const request = jsonRequest(body, { "content-length": length })
      expect(await readJsonObject(request, 1024)).toBeNull()
    }
  })

  it("stops reading once a streamed body passes the limit", async () => {
    const { request, wasCancelled } = streamedRequest([
      '{"a":"',
      "x".repeat(600),
      "x".repeat(600),
      '"}',
    ])
    expect(await readJsonObject(request, 1024)).toBeNull()
    expect(wasCancelled()).toBe(true)
  })

  it("reads a streamed body that stays within the limit", async () => {
    const { request } = streamedRequest(['{"a":', '"b"}'])
    expect(await readJsonObject(request, 1024)).toEqual({ a: "b" })
  })
})
