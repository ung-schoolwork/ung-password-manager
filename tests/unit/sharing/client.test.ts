import { describe, expect, it } from "bun:test"

import {
  hasActiveShares,
  type OutgoingShare,
} from "../../../lib/sharing/client"

const now = new Date("2026-11-18T12:00:00.000Z")

function outgoing(overrides: Partial<OutgoingShare>): OutgoingShare {
  return {
    id: "share-1",
    accountName: "Team router",
    siteOrApp: "router.example.test",
    status: "active",
    removedBy: null,
    createdAt: "2026-11-01T12:00:00.000Z",
    expiresAt: null,
    endedAt: null,
    toEmail: "teammate@example.test",
    credentialId: "credential-1",
    ...overrides,
  }
}

describe("hasActiveShares", () => {
  it("finds an active share of the credential", () => {
    expect(hasActiveShares([outgoing({})], "credential-1", now)).toBe(true)
    expect(
      hasActiveShares(
        [outgoing({ expiresAt: "2026-11-19T12:00:00.000Z" })],
        "credential-1",
        now
      )
    ).toBe(true)
  })

  it("ignores ended shares and shares of other credentials", () => {
    expect(
      hasActiveShares(
        [
          outgoing({ status: "removed", removedBy: "owner" }),
          outgoing({ status: "expired" }),
          // Listed as active, but its end date passed since the list loaded.
          outgoing({ expiresAt: "2026-11-18T11:59:00.000Z" }),
          outgoing({ credentialId: "credential-2" }),
          outgoing({ credentialId: null }),
        ],
        "credential-1",
        now
      )
    ).toBe(false)
    expect(hasActiveShares([], "credential-1", now)).toBe(false)
  })
})
