import {
  accountRequest,
  AccountRequestError,
  markSignOutPending,
  signOutGeneration,
  signOutIsPending,
  withAccountMutation,
  type AccountSession,
} from "@/lib/auth/client"
import { accountFailureMessage } from "@/lib/auth/feedback"
import { ACCOUNT_ERROR_MESSAGES } from "@/lib/auth/messages"
import {
  PASSWORD_CHANGE_WRONG_PASSWORD,
  PASSWORD_CHANGED_SIGNED_OUT,
} from "@/lib/auth/password-change"
import {
  accountPasswordProblem,
  AUTH_SOURCE_UNAVAILABLE,
} from "@/lib/auth/shared"
import { DeviceNotApprovedError } from "@/lib/devices/shared"
import {
  decryptVault,
  deriveAccountKeys,
  rewrapVaultKey,
  unwrapVaultKey,
  VaultUnlockError,
} from "@/lib/vault/crypto.client"
import { RemoteVaultRepository } from "@/lib/vault/remote.client"
import type { WrappedVaultKey } from "@/lib/vault/types"

export const PASSWORD_CHANGE_MESSAGES = {
  currentRequired: "Enter your current password.",
  newRequired: "Enter a new password.",
  confirmationRequired: "Enter your new password again.",
  confirmationMismatch: "The new passwords do not match.",
  unchanged: "Choose a new password that is different from your current one.",
  wrongPassword: "Your current password is incorrect.",
  deviceNotApproved:
    "Approve this device from a device you already use before changing your password.",
  sessionEnded: "Your session has ended. Sign in again.",
  conflict:
    "Your account changed while your password was being saved. Reload the page and try again.",
  invalid:
    "Your new password could not be saved. Check the fields and try again.",
  vaultMismatch:
    "Your password could not be changed because your vault could not be opened with it. Try again.",
  changedSignedOut:
    "Your password was changed. Sign in with your new password.",
  fallback: "Your password could not be changed. Try again.",
} as const

export interface PasswordChangeFieldErrors {
  current?: string
  next?: string
  confirmation?: string
}

/** Checks the form with the same password rules as registration. */
export function validatePasswordChange(
  current: string,
  next: string,
  confirmation: string
): PasswordChangeFieldErrors {
  const errors: PasswordChangeFieldErrors = {}
  if (!current) errors.current = PASSWORD_CHANGE_MESSAGES.currentRequired
  if (!next) errors.next = PASSWORD_CHANGE_MESSAGES.newRequired
  else {
    const problem = accountPasswordProblem(next)
    if (problem) errors.next = problem
    else if (next === current) errors.next = PASSWORD_CHANGE_MESSAGES.unchanged
  }
  if (!confirmation)
    errors.confirmation = PASSWORD_CHANGE_MESSAGES.confirmationRequired
  else if (confirmation !== next)
    errors.confirmation = PASSWORD_CHANGE_MESSAGES.confirmationMismatch
  return errors
}

/** A failed change. `field` names the form field the message belongs to. */
export class PasswordChangeError extends Error {
  constructor(
    message: string,
    readonly field?: "current"
  ) {
    super(message)
    this.name = "PasswordChangeError"
  }
}

async function sameKey(a: CryptoKey, b: CryptoKey) {
  const [left, right] = await Promise.all([
    crypto.subtle.exportKey("raw", a),
    crypto.subtle.exportKey("raw", b),
  ])
  if (left.byteLength !== right.byteLength) return false
  const x = new Uint8Array(left)
  const y = new Uint8Array(right)
  let difference = 0
  for (let index = 0; index < x.length; index++)
    difference |= x[index] ^ y[index]
  return difference === 0
}

/**
 * Re-wraps the vault key for the new password, entirely in the browser.
 *
 * The current password must open the vault key, and the re-wrapped key must
 * open again with the new password to the same key (and decrypt the saved vault)
 * before anything is sent, so a bad re-wrap can never replace a working one.
 */
export async function prepareAccountPasswordChange(
  email: string,
  currentPassword: string,
  newPassword: string,
  load: () => Promise<{
    wrappedVaultKey: WrappedVaultKey
    envelope: Parameters<typeof decryptVault>[1] | null
  }> = () => new RemoteVaultRepository().load()
) {
  const [current, next, stored] = await Promise.all([
    deriveAccountKeys(email, currentPassword),
    deriveAccountKeys(email, newPassword),
    load().catch((caught) => {
      // The vault client's own errors are written for the user.
      if (
        caught instanceof DeviceNotApprovedError ||
        !(caught instanceof Error)
      )
        throw caught
      throw new PasswordChangeError(caught.message)
    }),
  ])
  let vaultKey: CryptoKey
  try {
    vaultKey = await unwrapVaultKey(
      current.wrappingKey,
      stored.wrappedVaultKey,
      true
    )
  } catch (caught) {
    if (caught instanceof VaultUnlockError)
      throw new PasswordChangeError(
        PASSWORD_CHANGE_MESSAGES.wrongPassword,
        "current"
      )
    throw caught
  }
  const wrappedVaultKey = await rewrapVaultKey(
    stored.wrappedVaultKey,
    current.wrappingKey,
    next.wrappingKey
  )
  try {
    const reopened = await unwrapVaultKey(
      next.wrappingKey,
      wrappedVaultKey,
      true
    )
    if (!(await sameKey(vaultKey, reopened))) throw new VaultUnlockError()
    if (stored.envelope) await decryptVault(reopened, stored.envelope)
  } catch {
    throw new PasswordChangeError(PASSWORD_CHANGE_MESSAGES.vaultMismatch)
  }
  return {
    currentAuthKey: current.authKey,
    authKey: next.authKey,
    wrappedVaultKey,
  }
}

function failureMessage(caught: unknown): PasswordChangeError {
  if (caught instanceof PasswordChangeError) return caught
  if (caught instanceof DeviceNotApprovedError)
    return new PasswordChangeError(PASSWORD_CHANGE_MESSAGES.deviceNotApproved)
  if (caught instanceof AccountRequestError) {
    switch (caught.status) {
      case 400:
        return new PasswordChangeError(PASSWORD_CHANGE_MESSAGES.invalid)
      case 401:
        return caught.message === PASSWORD_CHANGE_WRONG_PASSWORD
          ? new PasswordChangeError(
              PASSWORD_CHANGE_MESSAGES.wrongPassword,
              "current"
            )
          : new PasswordChangeError(PASSWORD_CHANGE_MESSAGES.sessionEnded)
      case 403:
        return new PasswordChangeError(
          caught.message === "Device not approved"
            ? PASSWORD_CHANGE_MESSAGES.deviceNotApproved
            : ACCOUNT_ERROR_MESSAGES.request.blocked
        )
      case 409:
        return new PasswordChangeError(PASSWORD_CHANGE_MESSAGES.conflict)
      case 503:
        if (caught.message === PASSWORD_CHANGED_SIGNED_OUT)
          return new PasswordChangeError(
            PASSWORD_CHANGE_MESSAGES.changedSignedOut
          )
        // The sign-in wording would be wrong here; the password is unchanged.
        if (caught.message === AUTH_SOURCE_UNAVAILABLE)
          return new PasswordChangeError(
            ACCOUNT_ERROR_MESSAGES.request.serverUnavailable
          )
    }
  }
  if (caught instanceof AccountRequestError || caught instanceof TypeError)
    // Rate limits, unavailable server and lost connection read as at sign-in.
    return new PasswordChangeError(accountFailureMessage(caught, "login"))
  return new PasswordChangeError(PASSWORD_CHANGE_MESSAGES.fallback)
}

async function sendPasswordChange(body: object): Promise<AccountSession> {
  const response = await fetch("/api/auth/password", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok)
    throw new AccountRequestError(
      typeof data?.error === "string" ? data.error : "",
      response.status,
      response.headers.get("Retry-After")
    )
  return data as AccountSession
}

/**
 * Changes the account password. The server receives the auth keys for the
 * current and new passwords and the vault key re-wrapped in this browser,
 * never a password or the vault key. On success this browser holds a new
 * session and every other session is signed out.
 */
export async function changeAccountPassword(
  email: string,
  currentPassword: string,
  newPassword: string
): Promise<AccountSession> {
  try {
    const problem = accountPasswordProblem(newPassword)
    if (problem) throw new PasswordChangeError(problem)
    const change = await prepareAccountPasswordChange(
      email,
      currentPassword,
      newPassword
    )
    const signOutAtStart = signOutGeneration()
    return await withAccountMutation(async () => {
      if (signOutIsPending() || signOutAtStart !== signOutGeneration())
        throw new PasswordChangeError(PASSWORD_CHANGE_MESSAGES.sessionEnded)
      const session = await sendPasswordChange(change)
      if (signOutIsPending() || signOutAtStart !== signOutGeneration()) {
        // The response installed a new session cookie after this browser
        // signed out; revoke it rather than leave it signed in.
        markSignOutPending(true)
        try {
          await accountRequest("logout", {})
          markSignOutPending(false)
        } catch {
          /* The pending flag retries revocation at the next sign-in. */
        }
        throw new PasswordChangeError(PASSWORD_CHANGE_MESSAGES.changedSignedOut)
      }
      return session
    })
  } catch (caught) {
    throw failureMessage(caught)
  }
}
