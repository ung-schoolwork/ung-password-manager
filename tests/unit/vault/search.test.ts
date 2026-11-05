import { describe, expect, it } from "bun:test"

import {
  indexCredentialSearch,
  searchCredentials,
} from "../../../lib/vault/search"
import type { Credential } from "../../../lib/vault/types"

function credential(id: string, patch: Partial<Credential> = {}): Credential {
  const timestamp = new Date(0).toISOString()
  return {
    id,
    accountName: `Account ${id}`,
    siteOrApp: `site-${id}.example`,
    username: `user-${id}@example.com`,
    password: "search-test-password",
    createdAt: timestamp,
    updatedAt: timestamp,
    passwordUpdatedAt: timestamp,
    ...patch,
  }
}

describe("searchCredentials", () => {
  it("matches account names, sites, and usernames without case sensitivity", () => {
    const entries = indexCredentialSearch([
      credential("account", { accountName: "Work Mail" }),
      credential("site", { siteOrApp: "Portal.Example.edu" }),
      credential("username", { username: "Alice@example.edu" }),
    ])

    expect(searchCredentials(entries, "WORK")).toEqual([entries[0].credential])
    expect(searchCredentials(entries, "PORTAL.EXAMPLE")).toEqual([
      entries[1].credential,
    ])
    expect(searchCredentials(entries, "ALICE@")).toEqual([
      entries[2].credential,
    ])
  })

  it("returns no results for a non-matching query and all entries for a blank query", () => {
    const credentials = [credential("one"), credential("two")]
    const entries = indexCredentialSearch(credentials)

    expect(searchCredentials(entries, "not-in-the-vault")).toEqual([])
    expect(searchCredentials(entries, "  ")).toEqual(credentials)
  })

  it("searches 500 indexed credentials within the responsiveness budget", () => {
    const credentials = Array.from({ length: 500 }, (_, index) =>
      credential(String(index).padStart(3, "0"))
    )
    const entries = indexCredentialSearch(credentials)

    const startedAt = performance.now()
    const results = searchCredentials(entries, "SITE-499")
    const elapsed = performance.now() - startedAt

    expect(results.map(({ id }) => id)).toEqual(["499"])
    expect(elapsed).toBeLessThan(250)
  })
})
