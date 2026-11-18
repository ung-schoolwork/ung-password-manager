import { beforeEach, describe, expect, it } from "bun:test"

import {
  parseAddress,
  reportSourceProblem,
  resetSourceReports,
  resolveSourceAddress,
} from "../../../lib/auth/source-address"

const production = (header?: string) => ({
  NODE_ENV: "production",
  AUTH_TRUSTED_IP_HEADER: header,
})
const resolve = (headers: Record<string, string>, header?: string) =>
  resolveSourceAddress(new Headers(headers), production(header))

describe("client IP header resolution", () => {
  it("fails closed in production when no header is configured", () => {
    expect(resolve({ "x-real-ip": "203.0.113.7" })).toEqual({
      address: null,
      problem: "header-not-configured",
    })
    expect(resolve({ "x-real-ip": "203.0.113.7" }, "  ")).toEqual({
      address: null,
      problem: "header-not-configured",
    })
    expect(resolve({}, "bad header name")).toEqual({
      address: null,
      problem: "header-not-configured",
    })
  })

  it("uses a shared loopback source in development without a header", () => {
    expect(
      resolveSourceAddress(new Headers(), { NODE_ENV: "development" })
    ).toEqual({ address: "127.0.0.1" })
  })

  it("still requires the configured header in development", () => {
    expect(
      resolveSourceAddress(new Headers(), {
        NODE_ENV: "development",
        AUTH_TRUSTED_IP_HEADER: "x-real-ip",
      })
    ).toEqual({ address: null, problem: "header-missing" })
  })

  it("reports a missing or empty header", () => {
    expect(resolve({}, "x-real-ip")).toEqual({
      address: null,
      problem: "header-missing",
    })
    expect(resolve({ "x-real-ip": "  " }, "x-real-ip")).toEqual({
      address: null,
      problem: "header-missing",
    })
  })

  it("reads single-value headers such as CF-Connecting-IP and X-Real-IP", () => {
    expect(
      resolve({ "cf-connecting-ip": "203.0.113.7" }, "CF-Connecting-IP")
    ).toEqual({ address: "203.0.113.7" })
    expect(resolve({ "x-real-ip": " 198.51.100.4 " }, "x-real-ip")).toEqual({
      address: "198.51.100.4",
    })
    expect(
      resolve({ "cf-connecting-ip": "2001:DB8:0:0::1" }, "cf-connecting-ip")
    ).toEqual({ address: "2001:db8::1" })
  })

  it("rejects a list in a single-value header instead of guessing", () => {
    expect(
      resolve({ "x-real-ip": "203.0.113.7, 198.51.100.4" }, "x-real-ip")
    ).toEqual({ address: null, problem: "header-invalid" })
  })

  it("takes the rightmost X-Forwarded-For entry, which the proxy appended", () => {
    // The leftmost entry is whatever the client sent and can be forged.
    expect(
      resolve(
        { "x-forwarded-for": "1.2.3.4, 10.0.0.1, 203.0.113.7" },
        "X-Forwarded-For"
      )
    ).toEqual({ address: "203.0.113.7" })
    expect(
      resolve({ "x-forwarded-for": "203.0.113.7" }, "x-forwarded-for")
    ).toEqual({ address: "203.0.113.7" })
    expect(
      resolve({ "x-forwarded-for": "203.0.113.7, " }, "x-forwarded-for")
    ).toEqual({ address: null, problem: "header-invalid" })
    expect(
      resolve({ "x-forwarded-for": "203.0.113.7, unknown" }, "x-forwarded-for")
    ).toEqual({ address: null, problem: "header-invalid" })
  })

  it("rejects values that are not IP addresses", () => {
    for (const value of [
      "not-an-ip",
      "for=203.0.113.7",
      "203.0.113.256",
      "01.2.3.4",
      "example.test",
      "fe80::1%eth0",
    ])
      expect(resolve({ "x-real-ip": value }, "x-real-ip")).toEqual({
        address: null,
        problem: "header-invalid",
      })
    // Oversized chains are refused before parsing.
    const chain = `${"10.0.0.1, ".repeat(120)}203.0.113.7`
    expect(resolve({ "x-forwarded-for": chain }, "x-forwarded-for")).toEqual({
      address: null,
      problem: "header-invalid",
    })
  })
})

describe("IP address parsing", () => {
  it("strips ports and IPv6 brackets", () => {
    expect(parseAddress("203.0.113.7:51234")).toBe("203.0.113.7")
    expect(parseAddress("[2001:db8::1]:443")).toBe("2001:db8::1")
    expect(parseAddress("[2001:db8::1]")).toBe("2001:db8::1")
    expect(parseAddress("2001:db8::1")).toBe("2001:db8::1")
  })

  it("maps one client to one rate-limit key", () => {
    expect(parseAddress("::ffff:203.0.113.7")).toBe("203.0.113.7")
    expect(parseAddress("2001:0DB8:0000::0001")).toBe("2001:db8::1")
  })

  it("rejects malformed values", () => {
    for (const value of ["", "[]", "[1.2.3.4", "1.2.3.4:", "1.2.3.4:999999"])
      expect(parseAddress(value)).toBeNull()
  })
})

describe("misconfiguration logging", () => {
  beforeEach(() => resetSourceReports())

  it("logs each problem once per interval without header values", () => {
    const lines: string[] = []
    const log = (line: string) => lines.push(line)
    const start = Date.now()
    reportSourceProblem("header-missing", "X-Real-IP", log, start)
    reportSourceProblem("header-missing", "X-Real-IP", log, start + 1000)
    reportSourceProblem("header-not-configured", undefined, log, start + 1000)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('"x-real-ip"')
    expect(lines[0]).toContain("AUTH_TRUSTED_IP_HEADER")
    expect(lines[1]).toContain("AUTH_TRUSTED_IP_HEADER is not set")

    reportSourceProblem("header-missing", "X-Real-IP", log, start + 16 * 60_000)
    expect(lines).toHaveLength(3)
  })
})
