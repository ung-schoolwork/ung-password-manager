// Account rules shared by the browser and the server. Framework-free so other
// clients (such as the browser extension) can apply the same rules.

export const ACCOUNT_PASSWORD_MIN_LENGTH = 12
export const ACCOUNT_PASSWORD_MAX_LENGTH = 128
export const ACCOUNT_EMAIL_MAX_LENGTH = 254

/** Sent with a 503 when registration created the account but not a session. */
export const ACCOUNT_CREATED_SIGN_IN_FAILED =
  "Account created but sign-in failed. Please sign in."

/**
 * The canonical form of an account email. The vault key is derived from it,
 * so every client must normalize exactly the same way.
 */
export function normalizeAccountEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isValidAccountEmail(normalized: string): boolean {
  return (
    normalized.length <= ACCOUNT_EMAIL_MAX_LENGTH &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  )
}

export function accountPasswordProblem(password: string): string | null {
  if (password.length < ACCOUNT_PASSWORD_MIN_LENGTH)
    return `Use at least ${ACCOUNT_PASSWORD_MIN_LENGTH} characters for your password.`
  if (password.length > ACCOUNT_PASSWORD_MAX_LENGTH)
    return `Use no more than ${ACCOUNT_PASSWORD_MAX_LENGTH} characters for your password.`
  return null
}
