import type { Credential } from "@/lib/vault/types"

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

const COMMON_PASSWORDS = [
  "password", "123456", "12345678", "qwerty", "letmein",
  "abc123", "iloveyou", "admin", "welcome", "monkey",
  "111111", "football", "dragon", "sunshine", "princess"
]

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password.toLowerCase())
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export async function analyzeCredentialsHealth(
  credentials: Credential[]
): Promise<CredentialHealthReport[]> {
  const credentialsWithHashes = await Promise.all(
    credentials.map(async (cred) => ({
      ...cred,
      passwordHash: await hashPassword(cred.password),
    }))
  )

  const hashGroups = new Map<string, string[]>()
  for (const cred of credentialsWithHashes) {
    const list = hashGroups.get(cred.passwordHash) || []
    list.push(cred.accountName || cred.siteOrApp)
    hashGroups.set(cred.passwordHash, list)
  }

  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - DAYS_OVERDUE)

  return credentialsWithHashes
    .map((cred) => {
      const warnings: PasswordWarning[] = []
      const pwd = cred.password
      const lowerPwd = pwd.toLowerCase()

      if (pwd.length < MIN_LENGTH) {
        warnings.push({
          type: "Weak",
          explanation: `Below the ${MIN_LENGTH}-character absolute minimum required by NIST SP 800-63B.`
        })
      } else if (pwd.length < RECOMMENDED_LENGTH) {
        warnings.push({
          type: "Short",
          explanation: `Under the ${RECOMMENDED_LENGTH}+ characters NIST SP 800-63B-4 recommends for standalone passwords.`
        })
      }

      if (COMMON_PASSWORDS.includes(lowerPwd)) {
        warnings.push({
          type: "Weak",
          explanation: "Matches a commonly used or previously breached dictionary password."
        })
      }

      const isSimplePattern =
        pwd.length < RECOMMENDED_LENGTH &&
        (/^[a-z]+[0-9]+$/i.test(pwd) || /^[0-9]+[a-z]+$/i.test(pwd))

      if (isSimplePattern) {
        warnings.push({
          type: "Weak",
          explanation: "Follows an easily guessed predictable word-and-number combination."
        })
      }

      const sharedWith = hashGroups.get(cred.passwordHash) || []
      const otherAccounts = sharedWith.filter(
        (name) => name !== (cred.accountName || cred.siteOrApp)
      )

      if (otherAccounts.length > 0) {
        warnings.push({
          type: "Reused",
          explanation: `Same password also used for: ${otherAccounts.join(", ")}. If one account is breached, all are exposed.`
        })
      }

      const lastUpdated = new Date(cred.passwordUpdatedAt || cred.updatedAt || cred.createdAt)
      if (lastUpdated < ninetyDaysAgo) {
        warnings.push({
          type: "Overdue",
          explanation: "Password hasn't been updated in over 90 days and is due for rotation."
        })
      }

      return {
        ...cred,
        warnings,
      }
    })
    .sort((a, b) => b.warnings.length - a.warnings.length)
}
