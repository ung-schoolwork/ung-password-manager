import type { Credential } from "@/lib/vault/types"

export interface PasswordWarning {
  type: "Weak" | "Short" | "Reused" | "Overdue"
  explanation: string
}

export interface CredentialHealthReport extends Credential {
  warnings: PasswordWarning[]
}

const MIN_LENGTH = 12
const RECOMMENDED_LENGTH = 16
const DAYS_OVERDUE = 90

const COMMON_PASSWORDS = [
  "password", "123456", "12345678", "qwerty", "letmein",
  "abc123", "iloveyou", "admin", "welcome", "monkey",
  "111111", "football", "dragon", "sunshine", "princess"
]

export function analyzeCredentialsHealth(
  credentials: Credential[]
): CredentialHealthReport[] {
  const passwordMap = new Map<string, string[]>()

  for (const cred of credentials) {
    const list = passwordMap.get(cred.password) || []
    list.push(cred.accountName || cred.siteOrApp)
    passwordMap.set(cred.password, list)
  }

  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - DAYS_OVERDUE)

  return credentials
    .map((cred) => {
      const warnings: PasswordWarning[] = []
      const pwd = cred.password

      if (pwd.length < MIN_LENGTH || COMMON_PASSWORDS.includes(pwd.toLowerCase())) {
        warnings.push({
          type: "Weak",
          explanation: `Password is below ${MIN_LENGTH} characters or matches a common predictable pattern.`
        })
      } else if (pwd.length < RECOMMENDED_LENGTH) {
        warnings.push({
          type: "Short",
          explanation: `Password is under the recommended ${RECOMMENDED_LENGTH}+ characters.`
        })
      }

      const sharedWith = passwordMap.get(pwd) || []
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
