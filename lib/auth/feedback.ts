import { AccountRequestError } from "@/lib/auth/client"
import { ACCOUNT_ERROR_MESSAGES as messages } from "@/lib/auth/messages"

export type AccountFormMode = "login" | "register"

export interface AccountFieldErrors {
  email?: string
  password?: string
  confirmation?: string
}

// Keep client checks aligned with the credential limits enforced by the API.
export function validateAccountFields(
  mode: AccountFormMode,
  email: string,
  password: string,
  confirmation: string
): AccountFieldErrors {
  const errors: AccountFieldErrors = {}
  const normalizedEmail = email.trim().toLowerCase()

  if (!normalizedEmail) {
    errors.email = messages.fields.emailRequired
  } else if (
    normalizedEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
  ) {
    errors.email = messages.fields.emailInvalid
  }

  if (!password) {
    errors.password = messages.fields.passwordRequired
  } else if (password.length < 12) {
    errors.password = messages.fields.passwordTooShort
  } else if (password.length > 128) {
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
  // Use status and retry metadata only; API response text is not trusted as UI copy.
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
        return messages.request.serverUnavailable
      default:
        if (caught.status >= 500) return messages.request.serverUnavailable
    }
  }

  if (caught instanceof TypeError) {
    return messages.request.connectionUnavailable
  }

  return mode === "register"
    ? messages.request.registerFallback
    : messages.request.loginFallback
}

function parseRetryAfter(value: string | null): string | null {
  if (!value || !/^\d+$/.test(value.trim())) return null
  const seconds = Number(value)
  if (!Number.isSafeInteger(seconds) || seconds < 1) return null
  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`
}
