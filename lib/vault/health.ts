// ---------------------------------------------------------------------------
// health.ts: pure password-audit logic
//
// Takes the raw list of credentials and returns each one annotated with a
// `warnings` array, sorted by importance. No React, no network calls, no
// storage writes, no logging: passwords go in, warnings come out.
// ---------------------------------------------------------------------------

import type { Credential } from "@/lib/vault/types"

// One warning: a short category label (the UI prints it in bold) plus a
// human-readable explanation.
export interface PasswordWarning {
  type: "Weak" | "Short" | "Reused" | "Overdue"
  explanation: string
}

// A report is a full Credential plus its warnings. This is why the component
// can read `acc.accountName` and `acc.warnings` from the same object.
export interface CredentialHealthReport extends Credential {
  warnings: PasswordWarning[]
}

// --- Tunable thresholds -----------------------------------------------------
const MIN_LENGTH = 8 // under this -> "Weak"
const RECOMMENDED_LENGTH = 15 // 8-14 chars -> "Short"
const DAYS_OVERDUE = 90 // unchanged for this long -> "Overdue"
const MIN_SHAPE_LENGTH = 8 // stripped body must be this long to judge its shape

// Maps risk labels to numbers so they can be compared when sorting.
const RISK_PRIORITY: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
}

// Small on-device denylist, not a comprehensive breached-password corpus.
// Exact case-insensitive matches avoid sending saved passwords to a service.
const COMMON_PASSWORDS = [
  "password",
  "password1",
  "password1!",
  "123456",
  "12345678",
  "qwerty",
  "letmein",
  "abc123",
  "iloveyou",
  "admin",
  "welcome",
  "monkey",
  "111111",
  "football",
  "dragon",
  "sunshine",
  "princess",
]

// Outer punctuation is not part of a password's shape, so a single "!" must not
// hide a repeated or sequential body. Only strip when enough characters remain
// to judge, so short passwords are still checked exactly as typed.
function shapeCandidate(password: string): string {
  const stripped = password
    .replace(/^[^a-z0-9]+/i, "")
    .replace(/[^a-z0-9]+$/i, "")

  return stripped.length >= MIN_SHAPE_LENGTH ? stripped : password
}

function isRepeatedCharacter(password: string): boolean {
  const characters = [...password]
  return (
    characters.length > 0 &&
    characters.every((character) => character === characters[0])
  )
}

function isSimpleSequence(password: string): boolean {
  const normalized = password.toLowerCase()
  const alphabet = /^\d+$/.test(normalized)
    ? "0123456789"
    : /^[a-z]+$/.test(normalized)
      ? "abcdefghijklmnopqrstuvwxyz"
      : null

  if (!alphabet || normalized.length < 3) return false

  const indexes = [...normalized].map((character) =>
    alphabet.indexOf(character)
  )
  const followsStep = (step: 1 | -1) =>
    indexes.every(
      (index, position) =>
        position === 0 ||
        index ===
          (indexes[position - 1] + step + alphabet.length) % alphabet.length
    )

  return followsStep(1) || followsStep(-1)
}

// Flags a short chunk repeated to fill the whole password, such as
// "abcabcabc" or "AaAaAa". Only periods that repeat at least twice count.
function isRepeatedPattern(password: string): boolean {
  const characters = [...password.toLowerCase()]

  for (let size = 1; size <= Math.floor(characters.length / 2); size++) {
    if (characters.length % size !== 0) continue
    const repeatsEntirely = characters.every(
      (character, position) => character === characters[position % size]
    )
    if (repeatsEntirely) return true
  }

  return false
}

export function analyzeCredentialsHealth(
  credentials: Credential[]
): CredentialHealthReport[] {
  // --- Pre-pass: group credentials by password ------------------------------
  // Map<password string, credentials using that password>.
  // Building this once makes reuse detection O(n) overall instead of
  // comparing every credential to every other (O(n^2)).
  // NOTE: keys are the RAW plaintext passwords (not hashes). Fine in memory,
  // but don't log or serialize this Map.
  const passwordGroups = new Map<string, Credential[]>()
  for (const credential of credentials) {
    // Fetch the existing group, or start a new empty one.
    const group = passwordGroups.get(credential.password) ?? []
    group.push(credential)
    passwordGroups.set(credential.password, group)
  }

  // --- The "overdue" cutoff -------------------------------------------------
  // Computed once outside the loop so every credential is compared against
  // the same moment. setDate() handles month/year rollover automatically.
  // NOTE: uses the current time, so results can change between calls even if
  // `credentials` hasn't (relevant because the component memoizes this).
  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - DAYS_OVERDUE)

  return (
    credentials
      .map((cred) => {
        const warnings: PasswordWarning[] = []
        const pwd = cred.password
        const lowerPwd = pwd.toLowerCase() // used for the blocklist check

        // --- Check 1: length --------------------------------------------------
        // `else if` makes these mutually exclusive: a 5-char password gets
        // "Weak" only, never both "Weak" and "Short".
        if (pwd.length < MIN_LENGTH) {
          warnings.push({
            type: "Weak",
            explanation: `This password has fewer than ${MIN_LENGTH} characters and may be easy to guess.`,
          })
        } else if (pwd.length < RECOMMENDED_LENGTH) {
          warnings.push({
            type: "Short",
            explanation: `This password has fewer than ${RECOMMENDED_LENGTH} characters. Longer passwords are harder to guess.`,
          })
        }

        // --- Check 2: common password ----------------------------------------
        // A separate `if`, so "password" triggers this AND the length warning.
        // NOTE: this is why one root cause can produce several "Weak" boxes.
        if (COMMON_PASSWORDS.includes(lowerPwd)) {
          warnings.push({
            type: "Weak",
            explanation: "This matches a commonly used password.",
          })
        }

        // --- Check 3: repeated or sequential shape ----------------------------
        // Judges the body without outer punctuation, so "1234567890123456!"
        // cannot slip past the sequence check.
        const shape = shapeCandidate(pwd)

        if (isRepeatedCharacter(shape)) {
          warnings.push({
            type: "Weak",
            explanation:
              "This password repeats the same character and is easy to guess.",
          })
        } else if (isSimpleSequence(shape)) {
          warnings.push({
            type: "Weak",
            explanation:
              "This password follows a simple character sequence and is easy to guess.",
          })
        } else if (isRepeatedPattern(shape)) {
          warnings.push({
            type: "Weak",
            explanation:
              "This password repeats the same short pattern and is easy to guess.",
          })
        }

        // --- Check 4: simple word+number pattern ------------------------------
        // Flags letters-then-digits ("dragon99") or digits-then-letters
        // ("123abc"). Regex breakdown:
        //   ^ ... $   must match the whole string
        //   [a-z]+    one or more letters (the `i` flag ignores case)
        //   [0-9]+    one or more digits
        // The length guard means a long passphrase like
        // "correcthorsebatterystaple1" is not penalized.
        const isSimplePattern =
          pwd.length < RECOMMENDED_LENGTH &&
          (/^[a-z]+[0-9]+$/i.test(pwd) || /^[0-9]+[a-z]+$/i.test(pwd))

        if (isSimplePattern) {
          warnings.push({
            type: "Weak",
            explanation:
              "Follows an easily guessed predictable word-and-number combination.",
          })
        }

        // --- Check 5: reuse ---------------------------------------------------
        // Look up everyone sharing this password, then remove this credential
        // itself. If anyone is left, the password is reused.
        const otherAccounts = (passwordGroups.get(pwd) ?? []).filter(
          (other) => other.id !== cred.id
        )

        if (otherAccounts.length > 0) {
          warnings.push({
            type: "Reused",
            // Lists only names/sites, never the password itself.
            explanation: `This password is also saved for: ${otherAccounts
              .map((other) => `${other.accountName} (${other.siteOrApp})`)
              .join(", ")}. Reusing a password puts multiple accounts at risk.`,
          })
        }

        // --- Check 6: age -----------------------------------------------------
        // Fallback chain: when the password last changed, else when the record
        // was last edited, else when it was created. Date objects compare with
        // `<` because they coerce to timestamps.
        // NOTE: if all three fields are missing/malformed, this is an Invalid
        // Date, and `Invalid Date < ninetyDaysAgo` is false, so the check
        // silently passes.
        const lastUpdated = new Date(
          cred.passwordUpdatedAt || cred.updatedAt || cred.createdAt
        )
        if (lastUpdated < ninetyDaysAgo) {
          warnings.push({
            type: "Overdue",
            explanation: `This password has not changed in over ${DAYS_OVERDUE} days. Review whether it needs updating.`,
          })
        }

        // --- Result -----------------------------------------------------------
        // Spread the original credential (no mutation), normalize a missing
        // risk level to "low", and attach the warnings.
        return {
          ...cred,
          riskLevel: cred.riskLevel || "low",
          warnings,
        }
      })
      // --- Sorting (descending, hence b - a) ------------------------------------
      // 1. Higher risk first (high -> medium -> low).
      // 2. Tiebreaker: more warnings first.
      // So a high-risk account with 1 warning outranks a low-risk one with 4.
      .sort((a, b) => {
        // NOTE: the `|| 1` fallbacks are redundant, since riskLevel was already
        // defaulted to "low" above. Harmless noise.
        const riskDiff =
          (RISK_PRIORITY[b.riskLevel || "low"] || 1) -
          (RISK_PRIORITY[a.riskLevel || "low"] || 1)
        if (riskDiff !== 0) return riskDiff
        return b.warnings.length - a.warnings.length
      })
  )
}
