import { AccountRequestError } from "@/lib/auth/client"
import { ACCOUNT_ERROR_MESSAGES as messages } from "@/lib/auth/messages"
import {
  ACCOUNT_CREATED_SIGN_IN_FAILED,
  ACCOUNT_PASSWORD_MAX_LENGTH,
  ACCOUNT_PASSWORD_MIN_LENGTH,
  AUTH_SOURCE_UNAVAILABLE,
  isValidAccountEmail,
  normalizeAccountEmail,
} from "@/lib/auth/shared"
import { VaultUnlockError } from "@/lib/vault/crypto.client"

export type AccountFormMode = "login" | "register"

export interface AccountFieldErrors {
  email?: string
  password?: string
  confirmation?: string
}

// Uses the same account rules as the server, so fields it would reject are flagged before sending.
export function validateAccountFields(
  mode: AccountFormMode,
  email: string,
  password: string,
  confirmation: string
): AccountFieldErrors {
  const errors: AccountFieldErrors = {}
  const normalizedEmail = normalizeAccountEmail(email)

  if (!normalizedEmail) {
    errors.email = messages.fields.emailRequired
  } else if (!isValidAccountEmail(normalizedEmail)) {
    errors.email = messages.fields.emailInvalid
  }

  if (!password) {
    errors.password = messages.fields.passwordRequired
  } else if (password.length < ACCOUNT_PASSWORD_MIN_LENGTH) {
    errors.password = messages.fields.passwordTooShort
  } else if (password.length > ACCOUNT_PASSWORD_MAX_LENGTH) {
    errors.password = messages.fields.passwordTooLong
  }

  if (mode === "register") {
    if (!confirmation) {
      errors.confirmation = messages.fields.confirmationRequired
    } else if (confirmation !== password) {
      errors.confirmation = messages.fields.confirmationMismatch
    }
  }

  return errors
}

export function accountFailureMessage(
  caught: unknown,
  mode: AccountFormMode
): string {
  // Choose copy from the status and retry time; API response text is never shown.
  if (caught instanceof AccountRequestError) {
    switch (caught.status) {
      case 400:
        return mode === "login"
          ? messages.request.loginInvalid
          : messages.request.registerInvalid
      case 401:
        return mode === "login"
          ? messages.request.loginCredentials
          : messages.request.registerCredentials
      case 403:
        return messages.request.blocked
      case 409:
        return mode === "register"
          ? messages.request.registerConflict
          : messages.request.loginFallback
      case 429: {
        const retryAfter = parseRetryAfter(caught.retryAfter)
        return retryAfter
          ? messages.request.tooManyAttempts(retryAfter)
          : messages.request.tooManyAttemptsFallback
      }
      case 503:
        if (caught.message === AUTH_SOURCE_UNAVAILABLE)
          return mode === "register"
            ? messages.request.registerUnavailable
            : messages.request.loginUnavailable
        return mode === "register" &&
          caught.message === ACCOUNT_CREATED_SIGN_IN_FAILED
          ? messages.request.registerSignInFailed
          : messages.request.serverUnavailable
      default:
        if (caught.status >= 500) return messages.request.serverUnavailable
    }
  }

  // fetch rejects with a TypeError when the server cannot be reached.
  if (caught instanceof TypeError) {
    return messages.request.connectionUnavailable
  }

  return mode === "register"
    ? messages.request.registerFallback
    : messages.request.loginFallback
}

/** The message for a failed attempt to open the vault with a password. */
export function vaultUnlockFailureMessage(caught: unknown): string {
  if (caught instanceof VaultUnlockError) return messages.unlock.wrongPassword
  // Other failures are this app's own messages, such as an ended session.
  return caught instanceof Error ? caught.message : messages.unlock.fallback
}

function parseRetryAfter(value: string | null): string | null {
  if (!value || !/^\d+$/.test(value.trim())) return null
  const seconds = Number(value)
  if (!Number.isSafeInteger(seconds) || seconds < 1) return null
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
}
