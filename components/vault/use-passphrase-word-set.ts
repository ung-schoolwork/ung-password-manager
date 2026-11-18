"use client"

import { useEffect, useState } from "react"

import { loadPassphraseWords } from "@/lib/password-generator"

let wordSet: ReadonlySet<string> | null = null

// The EFF word list as a set, for recognising passphrases in health checks.
// Null until the list has loaded; health checks treat passphrases like any
// other password until then.
export function usePassphraseWordSet(): ReadonlySet<string> | null {
  const [words, setWords] = useState(wordSet)

  useEffect(() => {
    if (words) return
    let cancelled = false

    loadPassphraseWords().then(
      (list) => {
        wordSet ??= new Set(list)
        if (!cancelled) setWords(wordSet)
      },
      () => {
        // Without the list, health checks fall back to the general rules.
      }
    )

    return () => {
      cancelled = true
    }
  }, [words])

  return words
}
