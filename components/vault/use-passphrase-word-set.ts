"use client"

import { useEffect, useState } from "react"

import { loadPassphraseWords } from "@/lib/password-generator"

let wordSet: ReadonlySet<string> | null = null

type PassphraseWordSetState =
  | { status: "loading"; words: null }
  | { status: "ready"; words: ReadonlySet<string> }
  | { status: "error"; words: null }

// The EFF word list as a set, for recognising passphrases in health checks.
export function usePassphraseWordSet(): PassphraseWordSetState {
  const [state, setState] = useState<PassphraseWordSetState>(() =>
    wordSet
      ? { status: "ready", words: wordSet }
      : { status: "loading", words: null }
  )

  useEffect(() => {
    if (state.status !== "loading") return
    let cancelled = false

    loadPassphraseWords().then(
      (list) => {
        wordSet ??= new Set(list)
        if (!cancelled) setState({ status: "ready", words: wordSet })
      },
      () => {
        if (!cancelled) setState({ status: "error", words: null })
      }
    )

    return () => {
      cancelled = true
    }
  }, [state.status])

  return state
}
