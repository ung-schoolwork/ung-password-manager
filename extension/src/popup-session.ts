// Signing in, unlocking, device approval, and keeping the open vault current.

import type { VaultSnapshot } from "./api"
import { MESSAGES, type PopupState } from "./popup-state"
import {
  decryptVault,
  deriveAccountKeys,
  unwrapVaultKey,
  VaultUnlockError,
} from "./vault"

/** Checks the browser's session and shows what this profile may do. */
export async function start(s: PopupState): Promise<void> {
  const generation = s.reset()
  s.show({ name: "loading" })
  const session = await s.send({ type: "session" })
  if (generation !== s.generation) return
  if (session.state === "signed-out") return s.showSignIn(null)
  if (session.state !== "signed-in") return s.showUnavailable()
  s.account = { userId: session.userId, email: session.email }
  await checkDevice(s, generation)
}

/** Signs this Chrome profile in, which signs the app in as well. */
export async function signIn(
  s: PopupState,
  email: string,
  password: string
): Promise<void> {
  if (s.view.name !== "sign-in" || s.view.busy) return
  const generation = s.reset()
  s.show({ name: "sign-in", error: null, busy: true })
  let keys: Awaited<ReturnType<typeof deriveAccountKeys>>
  try {
    keys = await s.deriveKeys(email, password)
  } catch {
    return s.showSignIn(MESSAGES.rejected)
  }
  if (generation !== s.generation) return
  const result = await s.send({
    type: "sign-in",
    email,
    authKey: keys.authKey,
  })
  if (generation !== s.generation) return
  if (result.state === "rejected") return s.showSignIn(MESSAGES.rejected)
  if (result.state === "throttled") return s.showSignIn(MESSAGES.throttled)
  if (result.state === "blocked") return s.showBlocked()
  if (result.state !== "signed-in") return s.showSignIn(MESSAGES.unavailable)
  s.account = { userId: result.userId, email: result.email }
  s.wrappingKey = keys.wrappingKey
  await checkDevice(s, generation)
}

/** Opens the vault of the account this browser is already signed in to. */
export async function unlock(s: PopupState, password: string): Promise<void> {
  if (s.view.name !== "unlock" || s.view.busy || !s.account) return
  const generation = s.generation
  const email = s.account.email
  s.show({ name: "unlock", email, error: null, busy: true })
  let wrappingKey: CryptoKey
  try {
    ;({ wrappingKey } = await s.deriveKeys(email, password))
  } catch {
    if (generation === s.generation)
      s.showUnlock("Your vault could not be opened. Try again.")
    return
  }
  if (generation !== s.generation) return
  s.wrappingKey = wrappingKey
  await openVault(s, generation)
}

/** Signs out the browser (the app and the extension) and locks the vault. */
export async function signOut(s: PopupState): Promise<void> {
  // Forget every secret first, even if the request below fails.
  const generation = s.reset()
  s.show({ name: "loading" })
  const result = await s.send({ type: "sign-out" })
  if (generation !== s.generation) return
  if (result.state === "signed-out") return s.showSignIn(null)
  if (result.state === "blocked") return s.showBlocked()
  // The session may still be valid: show where the browser stands now.
  await start(s)
  if (s.view.name === "unlock") s.showUnlock(MESSAGES.signOutFailed)
}

/** Locks the vault but keeps the browser signed in. */
export function lock(s: PopupState): void {
  const account = s.account
  s.reset()
  if (!account) return s.showSignIn(null)
  s.account = account
  s.showUnlock(null)
}

export async function checkDevice(
  s: PopupState,
  generation: number
): Promise<void> {
  const device = await s.send({ type: "device" })
  if (generation !== s.generation || !s.account) return
  if (device.state === "signed-out") return s.showSignIn(MESSAGES.signedOut)
  if (device.state === "blocked") return s.showBlocked()
  if (device.state === "unavailable") return s.showUnavailable()
  if (device.state === "pending") {
    s.show({
      name: "approval",
      email: s.account.email,
      code: device.code,
    })
    s.schedule(generation, s.approvalPollMs, () => checkDevice(s, generation))
    return
  }
  if (s.wrappingKey) return openVault(s, generation)
  s.showUnlock(null)
}

async function openVault(s: PopupState, generation: number): Promise<void> {
  const result = await s.send({ type: "vault" })
  if (generation !== s.generation) return
  if (result.state === "signed-out") return s.showSignIn(MESSAGES.signedOut)
  if (result.state === "not-approved") {
    // No vault data was sent. Keep the sign-in key until approval.
    s.forgetVault()
    return checkDevice(s, generation)
  }
  if (result.state === "blocked") return s.showBlocked()
  if (result.state !== "ok") return s.showUnavailable()
  try {
    await decrypt(s, generation, result.snapshot)
  } catch (error) {
    if (generation !== s.generation) return
    s.wrappingKey = null
    s.forgetVault()
    s.showUnlock(
      error instanceof VaultUnlockError
        ? error.message
        : "Your vault could not be opened. Try again."
    )
  }
}

async function decrypt(
  s: PopupState,
  generation: number,
  snapshot: VaultSnapshot
) {
  let vaultKey = s.vaultKey
  if (!vaultKey) {
    if (!s.wrappingKey) throw new VaultUnlockError()
    vaultKey = await unwrapVaultKey(s.wrappingKey, snapshot.wrappedVaultKey)
  }
  const data = snapshot.envelope
    ? await decryptVault(vaultKey, snapshot.envelope)
    : { credentials: [] }
  if (generation !== s.generation || !s.account) return
  // The vault key replaces the password-derived key from here on.
  s.wrappingKey = null
  s.vaultKey = vaultKey
  s.revision = snapshot.revision
  s.envelope = snapshot.envelope
  s.setEntries(data.credentials)
  // A login being saved stays on screen; the list behind it is up to date.
  if (s.view.name !== "save") s.showVault()
  s.schedule(generation, s.vaultPollMs, () => watch(s, generation))
}

// While the vault is shown, confirm the browser is still signed in to the
// same account and still an approved device, and pick up changes.
async function watch(s: PopupState, generation: number): Promise<void> {
  const session = await s.send({ type: "session" })
  if (generation !== s.generation || !s.account) return
  if (session.state === "signed-out") return s.showSignIn(MESSAGES.signedOut)
  if (session.state === "signed-in" && session.userId !== s.account.userId)
    return start(s)
  const result = await s.send({ type: "revision" })
  if (generation !== s.generation || !s.account) return
  if (result.state === "signed-out") return s.showSignIn(MESSAGES.signedOut)
  if (result.state === "not-approved") {
    // This browser was removed from the account's devices.
    s.forgetVault()
    s.show({ name: "loading" })
    return checkDevice(s, generation)
  }
  if (result.state === "ok" && result.revision !== s.revision)
    return openVault(s, generation)
  s.schedule(generation, s.vaultPollMs, () => watch(s, generation))
}
