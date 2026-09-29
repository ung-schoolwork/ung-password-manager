﻿import type { Credential } from "@/lib/vault/types"

export interface PasswordWarning {
  type: "Weak" | "Short" | "Reused" | "Overdue"
  explanation: string
}

export interface CredentialHealthReport extends Credential {
  warnings: PasswordWarning[]
}

const MIN_LENGTH = 8
const RECOMMENDED_LENGTH = 15
const DAYS_OVERDUE = 90

const RISK_PRIORITY: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
}

const COMMON_PASSWORDS = [
  "password",
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

export function analyzeCredentialsHealth(
  credentials: Credential[]
): CredentialHealthReport[] {
  const passwordGroups = new Map<string, Credential[]>()
  for (const credential of credentials) {
    const group = passwordGroups.get(credential.password) ?? []
    group.push(credential)
    passwordGroups.set(credential.password, group)
  }

  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - DAYS_OVERDUE)

  return credentials
    .map((cred) => {
      const warnings: PasswordWarning[] = []
      const pwd = cred.password
      const lowerPwd = pwd.toLowerCase()

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

      if (COMMON_PASSWORDS.includes(lowerPwd)) {
        warnings.push({
          type: "Weak",
          explanation: "This matches a commonly used password.",
        })
      }

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

      const otherAccounts = (passwordGroups.get(pwd) ?? []).filter(
        (other) => other.id !== cred.id
      )

      if (otherAccounts.length > 0) {
        warnings.push({
          type: "Reused",
          explanation: `This password is also saved for: ${otherAccounts
            .map((other) => `${other.accountName} (${other.siteOrApp})`)
            .join(", ")}. Reusing a password puts multiple accounts at risk.`,
        })
      }

      const lastUpdated = new Date(
        cred.passwordUpdatedAt || cred.updatedAt || cred.createdAt
      )
      if (lastUpdated < ninetyDaysAgo) {
        warnings.push({
          type: "Overdue",
          explanation: `This password has not changed in over ${DAYS_OVERDUE} days. Review whether it needs updating.`,
        })
      }

      return {
        ...cred,
        riskLevel: cred.riskLevel || "low",
        warnings,
      }
    })
    .sort((a, b) => {
      const riskDiff =
        (RISK_PRIORITY[b.riskLevel || "low"] || 1) -
        (RISK_PRIORITY[a.riskLevel || "low"] || 1)
      if (riskDiff !== 0) return riskDiff
      return b.warnings.length - a.warnings.length
    })
}
