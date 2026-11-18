import { describe, expect, it } from "bun:test"

import { EFF_LARGE_WORDLIST } from "../../lib/eff-large-wordlist"
import {
  DEFAULT_PASSPHRASE_OPTIONS,
  PASSPHRASE_BITS_PER_WORD,
  generatePassphrase,
  loadPassphraseWords,
  type PassphraseOptions,
} from "../../lib/password-generator"

function deterministicRandomIndex() {
  let value = 0
  return (upperExclusive: number) => value++ % upperExclusive
}

const WORDS = ["alpha", "bravo", "charlie", "delta", "echo"]

describe("EFF large word list", () => {
  it("has exactly 7776 unique lowercase words", () => {
    expect(EFF_LARGE_WORDLIST).toHaveLength(7776)
    expect(new Set(EFF_LARGE_WORDLIST).size).toBe(7776)
    expect(EFF_LARGE_WORDLIST[0]).toBe("abacus")
    expect(EFF_LARGE_WORDLIST.at(-1)).toBe("zoom")
    expect(EFF_LARGE_WORDLIST.every((word) => /^[a-z-]+$/.test(word))).toBe(
      true
    )
  })

  it("loads the same list on demand", async () => {
    expect(await loadPassphraseWords()).toBe(EFF_LARGE_WORDLIST)
  })

  it("gives about 12.9 bits per word", () => {
    expect(PASSPHRASE_BITS_PER_WORD).toBeCloseTo(12.925, 3)
  })
})

describe("generatePassphrase", () => {
  it("defaults to five lowercase words joined by hyphens", () => {
    const passphrase = generatePassphrase(
      DEFAULT_PASSPHRASE_OPTIONS,
      WORDS,
      deterministicRandomIndex()
    )

    expect(passphrase).toBe("alpha-bravo-charlie-delta-echo")
  })

  it("uses the chosen word count and separator", () => {
    const passphrase = generatePassphrase(
      { ...DEFAULT_PASSPHRASE_OPTIONS, wordCount: 7, separator: " " },
      EFF_LARGE_WORDLIST
    )
    const parts = passphrase.split(" ")

    expect(parts).toHaveLength(7)
    expect(parts.every((word) => EFF_LARGE_WORDLIST.includes(word))).toBe(true)
  })

  it("joins words with no separator when None is chosen", () => {
    const passphrase = generatePassphrase(
      { ...DEFAULT_PASSPHRASE_OPTIONS, wordCount: 4, separator: "" },
      WORDS,
      deterministicRandomIndex()
    )

    expect(passphrase).toBe("alphabravocharliedelta")
  })

  it("capitalizes each word and adds one digit after a word", () => {
    const passphrase = generatePassphrase(
      {
        wordCount: 4,
        separator: ".",
        capitalize: true,
        includeNumber: true,
      },
      WORDS,
      deterministicRandomIndex()
    )

    // Indexes 0-3 pick words, 4 % 4 = 0 picks the first word, 5 % 10 the digit.
    expect(passphrase).toBe("Alpha5.Bravo.Charlie.Delta")
  })

  it("rejects word counts outside 4 to 10", () => {
    for (const wordCount of [3, 11, 4.5, Number.NaN]) {
      expect(() =>
        generatePassphrase({ ...DEFAULT_PASSPHRASE_OPTIONS, wordCount }, WORDS)
      ).toThrow("Word count must be between 4 and 10.")
    }
  })

  it("rejects an unsupported separator", () => {
    expect(() =>
      generatePassphrase(
        {
          ...DEFAULT_PASSPHRASE_OPTIONS,
          separator: "/",
        } as unknown as PassphraseOptions,
        WORDS
      )
    ).toThrow("Choose a supported separator.")
  })

  it("draws from the whole list with the secure generator", () => {
    const seen = new Set<string>()
    for (let round = 0; round < 200; round++) {
      for (const word of generatePassphrase(
        { ...DEFAULT_PASSPHRASE_OPTIONS, wordCount: 10 },
        EFF_LARGE_WORDLIST
      ).split("-")) {
        seen.add(word)
      }
    }

    // 2,000 draws from 7,776 words should give well over 1,500 distinct ones.
    expect(seen.size).toBeGreaterThan(1500)
  })
})
