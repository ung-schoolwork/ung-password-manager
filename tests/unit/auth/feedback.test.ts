import { describe, expect, it } from "bun:test"
import { AccountRequestError } from "../../../lib/auth/client"
import {
  accountFailureMessage,
  validateAccountFields,
  vaultUnlockFailureMessage,
} from "../../../lib/auth/feedback"
import {
  ACCOUNT_CREATED_SIGN_IN_FAILED,
  AUTH_SOURCE_UNAVAILABLE,
} from "../../../lib/auth/shared"
import { VaultUnlockError } from "../../../lib/vault/crypto.client"

describe("account form feedback", () => {
  it("validates required and malformed credentials before submission", () => {
    expect(validateAccountFields("login", "", "", "")).toEqual({
      email: "Enter your email address.",
      password: "Enter your password.",
    })
    expect(validateAccountFields("login", "not-an-email", "short", "")).toEqual(
      {
        email: "Enter a valid email address.",
        password: "Password must be at least 12 characters.",
      }
    )
  })

  it("rejects email and password values outside server limits", () => {
    expect(
      validateAccountFields(
        "login",
        `${"a".repeat(250)}@example.test`,
        "valid-password-123",
        ""
      )
    ).toEqual({ email: "Enter a valid email address." })
    expect(
      validateAccountFields("login", "user@example.test", "p".repeat(129), "")
    ).toEqual({
      password: "Password must be no more than 128 characters.",
    })
  })

  it("validates registration confirmation without duplicating its message", () => {
    expect(
      validateAccountFields(
        "register",
        "user@example.test",
        "valid-password-123",
        ""
      )
    ).toEqual({ confirmation: "Confirm your password." })
    expect(
      validateAccountFields(
        "register",
        "user@example.test",
        "valid-password-123",
        "different-password-123"
      )
    ).toEqual({ confirmation: "The passwords do not match." })
  })

  it("uses the same private sign-in message for credential failures", () => {
    const expected =
      "Email or password is incorrect. Check your details and try again."
    expect(
      accountFailureMessage(
        new AccountRequestError("Invalid credentials", 401),
        "login"
      )
    ).toBe(expected)
    expect(
      accountFailureMessage(
        new AccountRequestError("Unknown account", 401),
        "login"
      )
    ).toBe(expected)
  })

  it("maps blocked, throttled, unavailable, and network failures to guidance", () => {
    expect(
      accountFailureMessage(new AccountRequestError("Forbidden", 403), "login")
    ).toBe("This request was blocked. Refresh the page and try again.")
    expect(
      accountFailureMessage(
        new AccountRequestError("Too many attempts", 429, "45"),
        "login"
      )
    ).toBe("Too many attempts. Wait 45 seconds before trying again.")
    expect(
      accountFailureMessage(
        new AccountRequestError("Service unavailable", 503),
        "login"
      )
    ).toBe("The server is unavailable right now. Try again in a few moments.")
    expect(
      accountFailureMessage(new TypeError("Failed to fetch"), "login")
    ).toBe("Unable to reach the server. Check your connection and try again.")
  })

  it("uses form-specific messages for invalid requests and server failures", () => {
    expect(
      accountFailureMessage(
        new AccountRequestError("Invalid credentials", 400),
        "login"
      )
    ).toBe("Some sign-in details are invalid. Check the fields and try again.")
    expect(
      accountFailureMessage(
        new AccountRequestError("Invalid credentials", 400),
        "register"
      )
    ).toBe("Some account details are invalid. Check the fields and try again.")
    expect(
      accountFailureMessage(
        new AccountRequestError("Unable to register", 401),
        "register"
      )
    ).toBe("Could not create your account. Check your details and try again.")
    expect(
      accountFailureMessage(new AccountRequestError("Conflict", 409), "login")
    ).toBe("Could not sign in. Try again.")
    expect(
      accountFailureMessage(
        new AccountRequestError("Internal error", 500),
        "register"
      )
    ).toBe("The server is unavailable right now. Try again in a few moments.")
  })

  it("uses a safe retry fallback and registration-specific defaults", () => {
    expect(
      accountFailureMessage(
        new AccountRequestError("Too many attempts", 429, "1"),
        "login"
      )
    ).toBe("Too many attempts. Wait 1 second before trying again.")
    expect(
      accountFailureMessage(
        new AccountRequestError("Too many attempts", 429, "invalid"),
        "register"
      )
    ).toBe("Too many attempts. Wait a few minutes before trying again.")
    expect(
      accountFailureMessage(
        new AccountRequestError("Unable to register account", 409),
        "register"
      )
    ).toBe(
      "Could not create an account with these details. If you already have an account, sign in; otherwise try again."
    )
    expect(accountFailureMessage(new Error("Forbidden"), "register")).toBe(
      "Could not create your account. Try again."
    )
  })

  it("rounds long waits up to whole minutes", () => {
    expect(
      accountFailureMessage(
        new AccountRequestError("Too many attempts", 429, "900"),
        "login"
      )
    ).toBe("Too many attempts. Wait 15 minutes before trying again.")
    expect(
      accountFailureMessage(
        new AccountRequestError("Too many attempts", 429, "61"),
        "register"
      )
    ).toBe("Too many attempts. Wait 2 minutes before trying again.")
  })

  it("tells the user to sign in when registration created the account", () => {
    expect(
      accountFailureMessage(
        new AccountRequestError(ACCOUNT_CREATED_SIGN_IN_FAILED, 503),
        "register"
      )
    ).toBe(
      "Your account was created, but you couldn’t be signed in. Sign in to continue."
    )
    expect(
      accountFailureMessage(
        new AccountRequestError(ACCOUNT_CREATED_SIGN_IN_FAILED, 503),
        "login"
      )
    ).toBe("The server is unavailable right now. Try again in a few moments.")
  })
})

describe("unavailable sign-in feedback", () => {
  it("says sign-in or registration is temporarily unavailable", () => {
    expect(
      accountFailureMessage(
        new AccountRequestError(AUTH_SOURCE_UNAVAILABLE, 503),
        "login"
      )
    ).toBe("Sign-in is temporarily unavailable. Try again later.")
    expect(
      accountFailureMessage(
        new AccountRequestError(AUTH_SOURCE_UNAVAILABLE, 503),
        "register"
      )
    ).toBe("Creating an account is temporarily unavailable. Try again later.")
  })
})

describe("vault unlock feedback", () => {
  it("explains a wrong password without mentioning how the vault is stored", () => {
    expect(vaultUnlockFailureMessage(new VaultUnlockError())).toBe(
      "That password didn’t open your vault. Enter the password you use to sign in."
    )
  })

  it("keeps the app's own messages for other failures", () => {
    expect(
      vaultUnlockFailureMessage(
        new Error("Your account session has ended. Sign in again.")
      )
    ).toBe("Your account session has ended. Sign in again.")
    expect(vaultUnlockFailureMessage("unexpected")).toBe(
      "Your vault could not be opened. Try again."
    )
  })
})
