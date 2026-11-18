import { describe, expect, it } from "bun:test"

import { EFF_LARGE_WORDLIST } from "../../../lib/eff-large-wordlist"
import {
  analyzeCredentialsHealth,
  passphraseWordCount,
} from "../../../lib/vault/health"
import {
  DEFAULT_PASSWORD_OPTIONS,
  generatePassphrase,
  generatePassword,
} from "../../../lib/password-generator"
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
  it("sorts credentials by high, medium, then low risk", async () => {
    const reports = await analyzeCredentialsHealth([
      credential("low", { riskLevel: "low" }),
      credential("high", { riskLevel: "high" }),
      credential("medium", { riskLevel: "medium" }),
    ])

    expect(reports.map((report) => report.id)).toEqual([
      "high",
      "medium",
      "low",
    ])
  })

  it("ranks the risk level above the warning count", async () => {
    const reports = await analyzeCredentialsHealth([
      credential("low", { riskLevel: "low", password: "password" }),
      credential("high", {
        riskLevel: "high",
        password: "A unique high-risk passphrase",
      }),
    ])

    expect(reports.map((report) => report.id)).toEqual(["high", "low"])
  })

  it("treats credentials without a risk tag as low risk", async () => {
    const reports = await analyzeCredentialsHealth([
      credential("untagged"),
      credential("tagged-low", { riskLevel: "low" }),
    ])

    expect(reports.map((report) => report.id)).toEqual([
      "untagged",
      "tagged-low",
    ])
    expect(reports[0].riskLevel).toBe("low")
  })

  it("uses warning count as a tiebreaker and preserves order for exact ties", async () => {
    const reports = await analyzeCredentialsHealth([
      credential("first-tie", { riskLevel: "medium" }),
      credential("more-warnings", {
        riskLevel: "medium",
        password: "password",
      }),
      credential("second-tie", { riskLevel: "medium" }),
    ])

    expect(reports.map((report) => report.id)).toEqual([
      "more-warnings",
      "first-tie",
      "second-tie",
    ])
  })

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

  it("flags a common composition-rule password through the blocklist", async () => {
    const [report] = await analyzeCredentialsHealth([
      credential("blocklisted", { password: "Password1!" }),
    ])

    expect(
      report.warnings.some(
        (warning) =>
          warning.type === "Weak" &&
          warning.explanation.includes("commonly used")
      )
    ).toBe(true)
  })

  it("flags repeated characters, sequences and repeated patterns", async () => {
    for (const [password, explanation] of [
      ["aaaaaaaaaaaaaaaa", "repeats the same character"],
      ["1234567890123456", "simple character sequence"],
      ["zyxwvutsrqponmlk", "simple character sequence"],
      ["abcabcabcabcabc", "repeats the same short pattern"],
      ["passwordpassword", "repeats the same short pattern"],
      ["letmeinletmein", "repeats the same short pattern"],
      ["jackjackjack", "repeats the same short pattern"],
      ["AaAaAaAaAaAaAaAa", "repeats the same short pattern"],
      ["aaaaaaaaaaaaaaa!", "repeats the same character"],
      ["1234567890123456!", "simple character sequence"],
      ["aaa", "repeats the same character"],
    ]) {
      const [report] = await analyzeCredentialsHealth([
        credential("weak", { password }),
      ])

      expect(
        report.warnings.some(
          (warning) =>
            warning.type === "Weak" && warning.explanation.includes(explanation)
        )
      ).toBe(true)
    }
  })

  it("flags word-and-number combinations like dragon99", async () => {
    const [report] = await analyzeCredentialsHealth([
      credential("word-number", { password: "dragon99" }),
    ])

    expect(
      report.warnings.some(
        (warning) =>
          warning.type === "Weak" &&
          warning.explanation.includes("word-and-number")
      )
    ).toBe(true)
  })

  it("does not flag generated passwords or passphrases", async () => {
    let index = 0
    const generatedPassword = generatePassword(
      DEFAULT_PASSWORD_OPTIONS,
      (upperExclusive) => (index++ * 7 + 3) % upperExclusive
    )
    const passphrase = "correct horse battery staple"
    const reports = await analyzeCredentialsHealth([
      credential("generated", { password: generatedPassword }),
      credential("passphrase", {
        accountName: "Passphrase account",
        password: passphrase,
      }),
      credential("strong", { password: "Tr0ub4dor&3xK9!wQ" }),
    ])

    for (const report of reports) {
      expect(
        report.warnings.some(
          (warning) => warning.type === "Weak" || warning.type === "Short"
        )
      ).toBe(false)
    }
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

describe("passphrases", () => {
  const words = new Set(EFF_LARGE_WORDLIST)

  it("counts list words for each separator, capitalisation and number", () => {
    expect(passphraseWordCount("abacus-zoom-yo-yo-t-shirt", words)).toBe(4)
    expect(passphraseWordCount("Abacus Zoom Cabbage7 Dwelling", words)).toBe(4)
    expect(passphraseWordCount("abacuszoomcabbagedwelling", words)).toBe(4)
    expect(passphraseWordCount("abacus-zoom.cabbage-dwelling", words)).toBe(0)
    expect(passphraseWordCount("abacus-zoom-cabbage-x", words)).toBe(0)
    expect(passphraseWordCount("abacus1-zoom2-cabbage-dwelling", words)).toBe(0)
  })

  it("does not flag generated passphrases as weak or short", () => {
    const words4 = [...words]
    for (const separator of ["-", " ", ".", "_", ",", ""] as const) {
      for (let round = 0; round < 25; round++) {
        const password = generatePassphrase(
          { wordCount: 4, separator, capitalize: true, includeNumber: true },
          words4
        )
        const [report] = analyzeCredentialsHealth(
          [credential(`pp-${separator}-${round}`, { password })],
          words
        )

        expect(
          report.warnings.filter(
            (warning) => warning.type === "Weak" || warning.type === "Short"
          )
        ).toEqual([])
      }
    }
  })

  it("lets a short four-word passphrase through only with the word list", () => {
    const password = "OakIvyElmFox"
    expect(passphraseWordCount(password, words)).toBe(4)

    const [without] = analyzeCredentialsHealth([credential("a", { password })])
    const [withList] = analyzeCredentialsHealth(
      [credential("a", { password })],
      words
    )

    expect(without.warnings.map((warning) => warning.type)).toContain("Short")
    expect(withList.warnings).toEqual([])
  })

  it("still flags other weak passwords and repeated passphrases", () => {
    const reports = analyzeCredentialsHealth(
      [
        credential("short", { password: "zoom" }),
        credential("common", { password: "password1" }),
        credential("words3", { password: "oak-ivy-elm" }),
        credential("repeat", { password: "zoomzoomzoomzoom" }),
        credential("pattern", { password: "dragon99" }),
      ],
      words
    )
    const types = (id: string) =>
      reports
        .find((report) => report.id === id)!
        .warnings.map((warning) => warning.type)

    expect(types("short")).toContain("Weak")
    expect(types("common")).toContain("Weak")
    expect(types("words3")).toContain("Short")
    expect(types("repeat")).toContain("Weak")
    expect(types("pattern")).toContain("Weak")
  })

  it("still reports a reused passphrase", () => {
    const password = "abacus-zoom-cabbage-dwelling-lunar"
    const reports = analyzeCredentialsHealth(
      [credential("one", { password }), credential("two", { password })],
      words
    )

    expect(reports[0].warnings.map((warning) => warning.type)).toEqual([
      "Reused",
    ])
  })
})
