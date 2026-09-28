import { describe, expect, it } from "bun:test"

import { analyzeCredentialsHealth } from "../../../lib/vault/health"
import type { Credential } from "../../../lib/vault/types"

function credential(id: string, patch: Partial<Credential> = {}): Credential {
  const now = new Date().toISOString()

  return {
    id,
    accountName: "Example account",
    siteOrApp: `site-${id}.example`,
    username: "user@example.com",
    password: "UniquePassword!12345",
    createdAt: now,
    updatedAt: now,
    passwordUpdatedAt: now,
    ...patch,
  }
}

describe("analyzeCredentialsHealth", () => {
  it("warns about reuse even when saved accounts have the same label", async () => {
    const reports = await analyzeCredentialsHealth([
      credential("first"),
      credential("second"),
    ])

    for (const report of reports) {
      const warning = report.warnings.find((item) => item.type === "Reused")
      expect(warning).toBeDefined()
      expect(warning?.explanation).toContain(
        report.id === "first" ? "site-second.example" : "site-first.example"
      )
    }
  })

  it("does not claim two passwords are reused if their casing differs", async () => {
    const reports = await analyzeCredentialsHealth([
      credential("first", { password: "CaseSensitivePassword!42" }),
      credential("second", {
        accountName: "Second account",
        password: "casesensitivepassword!42",
      }),
    ])

    expect(
      reports.every((report) =>
        report.warnings.every((warning) => warning.type !== "Reused")
      )
    ).toBe(true)
  })

  it("explains short and commonly used passwords", async () => {
    const [report] = await analyzeCredentialsHealth([
      credential("weak", { password: "password" }),
    ])

    expect(report.warnings.some((warning) => warning.type === "Short")).toBe(
      true
    )
    expect(
      report.warnings.some(
        (warning) =>
          warning.type === "Weak" &&
          warning.explanation.includes("commonly used")
      )
    ).toBe(true)
  })

  it("uses password change time rather than credential edit time for older passwords", async () => {
    const oldPasswordDate = new Date(
      Date.now() - 100 * 24 * 60 * 60 * 1000
    ).toISOString()
    const [report] = await analyzeCredentialsHealth([
      credential("older", { passwordUpdatedAt: oldPasswordDate }),
    ])

    expect(report.warnings.some((warning) => warning.type === "Overdue")).toBe(
      true
    )
  })

  it("returns no warnings for a recent unique password", async () => {
    const [report] = await analyzeCredentialsHealth([credential("only")])
    expect(report.warnings).toEqual([])
  })
})
