import { describe, expect, it } from "bun:test"

import {
  MAX_SHARE_DURATION_MS,
  parseLocalDateTime,
  parseShareExpiry,
  presetExpiry,
  ShareExpiryError,
  shareStatus,
  toLocalDateTimeValue,
} from "../../../lib/sharing/status"

const now = new Date("2026-11-10T12:00:00.000Z")
const later = (ms: number) => new Date(now.getTime() + ms)

describe("shareStatus", () => {
  it("treats records without an end date or removal as active", () => {
    expect(shareStatus({}, now)).toBe("active")
    expect(shareStatus({ expiresAt: null, revokedAt: null }, now)).toBe(
      "active"
    )
  })

  it("is active until the end date and expired from it on", () => {
    expect(shareStatus({ expiresAt: later(1) }, now)).toBe("active")
    expect(shareStatus({ expiresAt: now }, now)).toBe("expired")
    expect(shareStatus({ expiresAt: later(-1) }, now)).toBe("expired")
  })

  it("reports a removed share as removed, even after its end date", () => {
    expect(shareStatus({ revokedAt: now }, now)).toBe("removed")
    expect(shareStatus({ revokedAt: now, expiresAt: later(-1) }, now)).toBe(
      "removed"
    )
  })
})

describe("parseShareExpiry", () => {
  it("accepts no end date", () => {
    expect(parseShareExpiry(null, now)).toBeNull()
    expect(parseShareExpiry(undefined, now)).toBeNull()
  })

  it("accepts an ISO date between one minute and one year away", () => {
    const date = later(60 * 60 * 1000)
    expect(parseShareExpiry(date.toISOString(), now)?.getTime()).toBe(
      date.getTime()
    )
    expect(
      parseShareExpiry(later(MAX_SHARE_DURATION_MS).toISOString(), now)
    ).not.toBeNull()
  })

  it("rejects past, too-soon, too-far and malformed dates", () => {
    for (const value of [
      later(-1000).toISOString(),
      later(30 * 1000).toISOString(),
      later(MAX_SHARE_DURATION_MS + 1000).toISOString(),
      "next week",
      "",
      42,
      {},
      "x".repeat(100),
    ])
      expect(() => parseShareExpiry(value, now)).toThrow(ShareExpiryError)
  })
})

describe("presetExpiry", () => {
  it("adds the preset's length to now", () => {
    expect(presetExpiry("none", now)).toBeNull()
    expect(presetExpiry("1h", now)?.getTime()).toBe(later(3_600_000).getTime())
    expect(presetExpiry("7d", now)?.getTime()).toBe(
      later(7 * 86_400_000).getTime()
    )
  })
})

describe("local date-time input values", () => {
  it("round-trips a local date and time", () => {
    const date = new Date(2026, 10, 20, 9, 5)
    expect(toLocalDateTimeValue(date)).toBe("2026-11-20T09:05")
    expect(parseLocalDateTime("2026-11-20T09:05")?.getTime()).toBe(
      date.getTime()
    )
  })

  it("rejects empty, malformed and impossible dates", () => {
    expect(parseLocalDateTime("")).toBeNull()
    expect(parseLocalDateTime("2026-11-20")).toBeNull()
    expect(parseLocalDateTime("2026-02-31T10:00")).toBeNull()
  })
})
