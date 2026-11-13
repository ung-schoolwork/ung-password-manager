import { randomBytes } from "node:crypto"
import {
  hashAuthKey,
  issueSession,
  Session,
  User,
  validAuthKey,
} from "@/lib/auth/server"
import { parseWrappedVaultKey } from "@/lib/vault/remote"
import type { WrappedVaultKey } from "@/lib/vault/types"

const MAX_BODY_BYTES = 4096
const AUTH_KEY = /^[0-9a-f]{64}$/

/**
 * A password change as the browser sends it: the auth key for the current
 * password (as at sign-in), and the auth key and re-wrapped vault key for the
 * new password (as at registration). The password itself never leaves the
 * browser, and the server cannot unwrap the vault key.
 */
export interface PasswordChangeInput {
  currentAuthKey: string
  authKey: string
  wrappedVaultKey: WrappedVaultKey
}

export async function passwordChangeInput(
  request: Request
): Promise<PasswordChangeInput | null> {
  if (
    !/^application\/json(?:\s*;|\s*$)/i.test(
      request.headers.get("content-type") || ""
    )
  )
    return null
  const declared = request.headers.get("content-length")
  if (
    declared &&
    (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)
  ) {
    await request.body?.cancel().catch(() => undefined)
    return null
  }
  if (!request.body) return null
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    if (!body || typeof body !== "object" || Array.isArray(body)) return null
    const keys = Object.keys(body)
    if (
      keys.length !== 3 ||
      !["currentAuthKey", "authKey", "wrappedVaultKey"].every((key) =>
        keys.includes(key)
      )
    )
      return null
    const { currentAuthKey, authKey, wrappedVaultKey } = body as Record<
      string,
      unknown
    >
    if (
      typeof currentAuthKey !== "string" ||
      typeof authKey !== "string" ||
      !AUTH_KEY.test(currentAuthKey) ||
      !AUTH_KEY.test(authKey) ||
      // The same auth key means the same password.
      currentAuthKey === authKey
    )
      return null
    const wrapped = parseWrappedVaultKey(wrappedVaultKey)
    return wrapped
      ? { currentAuthKey, authKey, wrappedVaultKey: wrapped }
      : null
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}

export type PasswordChangeResult =
  | { outcome: "changed"; response: Response }
  /** The current password did not match. Nothing changed. */
  | { outcome: "invalid-credentials" }
  /** The account changed during this request, such as another password change. Nothing changed. */
  | { outcome: "conflict" }
  /** The password changed, but this browser could not be signed in again. */
  | { outcome: "changed-signed-out" }

/**
 * Replaces the account's auth key hash and wrapped vault key in one atomic
 * update, then signs this browser in again and every other session out.
 *
 * The update is conditional on the hash checked here, so a concurrent change
 * cannot interleave and leave a hash for one password with a vault key wrapped
 * for another. It also raises the account's credentialsVersion, which retires
 * every existing session in the same write, before any other step can fail.
 */
export async function changeAccountPassword(
  userId: string,
  input: PasswordChangeInput
): Promise<PasswordChangeResult> {
  const user = await User.findById(userId)
  if (
    !(await validAuthKey(
      input.currentAuthKey,
      user?.authKeyHash,
      user?.salt
    )) ||
    !user
  )
    return { outcome: "invalid-credentials" }
  const salt = randomBytes(16).toString("hex")
  const authKeyHash = await hashAuthKey(input.authKey, salt)
  const updated = await User.findOneAndUpdate(
    { _id: user._id, authKeyHash: user.authKeyHash, salt: user.salt },
    {
      $set: { authKeyHash, salt, wrappedVaultKey: input.wrappedVaultKey },
      $inc: { credentialsVersion: 1 },
    },
    { returnDocument: "after" }
  )
  if (!updated) return { outcome: "conflict" }

  // Every older session is already rejected; deleting them only tidies up.
  await Session.deleteMany({ userId: user._id }).catch(() => undefined)
  try {
    return { outcome: "changed", response: await issueSession(updated) }
  } catch {
    // This browser's old session was retired with the others, so it is signed
    // out cleanly and can sign in with the new password.
    return { outcome: "changed-signed-out" }
  }
}
