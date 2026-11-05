import {
  ACCOUNT_PASSWORD_MAX_LENGTH,
  ACCOUNT_PASSWORD_MIN_LENGTH,
} from "@/lib/auth/shared"

// Keep user-facing account errors here so copy can be reviewed and changed in one place.
export const ACCOUNT_ERROR_MESSAGES = {
  fields: {
    emailRequired: "Enter your email address.",
    emailInvalid: "Enter a valid email address.",
    passwordRequired: "Enter your password.",
    passwordTooShort: `Password must be at least ${ACCOUNT_PASSWORD_MIN_LENGTH} characters.`,
    passwordTooLong: `Password must be no more than ${ACCOUNT_PASSWORD_MAX_LENGTH} characters.`,
    confirmationRequired: "Confirm your password.",
    confirmationMismatch: "The passwords do not match.",
  },
  request: {
    loginInvalid:
      "Some sign-in details are invalid. Check the fields and try again.",
    registerInvalid:
      "Some account details are invalid. Check the fields and try again.",
    // Sign-in failures must never say whether an account exists for an email.
    loginCredentials:
      "Email or password is incorrect. Check your details and try again.",
    registerCredentials:
      "Could not create your account. Check your details and try again.",
    registerConflict:
      "Could not create an account with these details. If you already have an account, sign in; otherwise try again.",
    registerSignInFailed:
      "Your account was created, but you couldn’t be signed in. Sign in to continue.",
    blocked: "This request was blocked. Refresh the page and try again.",
    tooManyAttempts: (wait: string) =>
      `Too many attempts. Wait ${wait} before trying again.`,
    tooManyAttemptsFallback:
      "Too many attempts. Wait a few minutes before trying again.",
    serverUnavailable:
      "The server is unavailable right now. Try again in a few moments.",
    connectionUnavailable:
      "Unable to reach the server. Check your connection and try again.",
    loginFallback: "Could not sign in. Try again.",
    registerFallback: "Could not create your account. Try again.",
    accountUnavailable: "Your account could not be reached. Try again.",
  },
  session: {
    signOutFailed: "Sign-out could not be completed. Try signing out again.",
    signInInterrupted: "Sign-in was interrupted. Try again.",
  },
  unlock: {
    wrongPassword:
      "That password didn’t open your vault. Enter the password you use to sign in.",
    fallback: "Your vault could not be opened. Try again.",
  },
} as const
