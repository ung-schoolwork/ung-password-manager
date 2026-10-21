import { describe, expect, it } from "bun:test"

import { mergeEdit, toDraft } from "../../../lib/vault/edit-merge"
import type { Credential, CredentialDraft } from "../../../lib/vault/types"

const base: CredentialDraft = {
  accountName: "Student portal",
  siteOrApp: "portal.example.edu",
  username: "chance",
  password: "original-password-123",
  notes: "",
  riskLevel: "low",
}

describe("mergeEdit", () => {
  it("keeps this edit and takes fields only the other device changed", () => {
    const mine = { ...base, notes: "edited here" }
    const theirs = { ...base, password: "changed-elsewhere-456" }

    expect(mergeEdit(base, mine, theirs)).toEqual({
      draft: {
        ...base,
        notes: "edited here",
        password: "changed-elsewhere-456",
      },
      updated: ["password"],
      bothChanged: [],
    })
  })

  it("keeps this edit's value where both devices changed a field", () => {
    const mine = { ...base, password: "mine-789", username: "chance2" }
    const theirs = {
      ...base,
      password: "theirs-456",
      riskLevel: "high" as const,
    }

    expect(mergeEdit(base, mine, theirs)).toEqual({
      draft: { ...mine, riskLevel: "high" },
      updated: ["riskLevel"],
      bothChanged: ["password"],
    })
  })

  it("does not report a field both devices changed to the same value", () => {
    const mine = { ...base, password: "same-new-password" }
    const theirs = { ...base, password: "same-new-password" }

    expect(mergeEdit(base, mine, theirs)).toEqual({
      draft: mine,
      updated: [],
      bothChanged: [],
    })
  })
})

describe("toDraft", () => {
  it("fills in optional fields so unchanged values compare equal", () => {
    const credential: Credential = {
      accountName: "Library",
      siteOrApp: "library.example.edu",
      username: "reader",
      password: "library-password-123",
      id: "credential-1",
      createdAt: "2026-09-20T00:00:00.000Z",
      updatedAt: "2026-09-21T00:00:00.000Z",
      passwordUpdatedAt: "2026-09-21T00:00:00.000Z",
    }

    expect(toDraft(credential)).toEqual({
      accountName: "Library",
      siteOrApp: "library.example.edu",
      username: "reader",
      password: "library-password-123",
      notes: "",
      riskLevel: "low",
    })
  })
})
