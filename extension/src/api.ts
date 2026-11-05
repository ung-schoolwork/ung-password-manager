// The service worker is the extension's only API client. Popups and (later)
// content scripts ask it over runtime messaging instead of calling the app
// themselves: a content script's requests would carry the visited site's
// origin, which the server rejects.
//
// Requests carry the browser's own session and device cookies, because the
// extension has host permission for the app's origin. The service worker only
// ever handles ciphertext and the auth key: it never sees the password, the
// vault keys, or decrypted vault data, and it keeps nothing between messages.

import {
  isVaultRevision,
  parseVaultWrite,
  parseWrappedVaultKey,
} from "@/lib/vault/remote"
import type { VaultEnvelope, WrappedVaultKey } from "@/lib/vault/types"

export type SignedOut = { state: "signed-out" }
export type Unavailable = { state: "unavailable" }
/** This Chrome profile is signed in but is not an approved device. */
export type NotApproved = { state: "not-approved" }

export type SessionStatus =
  | { state: "signed-in"; userId: string; email: string }
  | SignedOut
  | Unavailable

export type SignInResult =
  | Extract<SessionStatus, { state: "signed-in" }>
  | { state: "rejected" }
  | { state: "throttled" }
  | Unavailable

export type DeviceStatus =
  | { state: "approved" }
  | { state: "pending"; code: string; expiresAt: string }
  | SignedOut
  | Unavailable

export interface VaultSnapshot {
  wrappedVaultKey: WrappedVaultKey
  envelope: VaultEnvelope | null
  revision: string | null
}

export type VaultResult =
  | { state: "ok"; snapshot: VaultSnapshot }
  | SignedOut
  | NotApproved
  | Unavailable

export type RevisionResult =
  | { state: "ok"; revision: string | null }
  | SignedOut
  | NotApproved
  | Unavailable

export type SignOutResult = SignedOut | Unavailable

export type ExtensionRequest =
  | { type: "session" }
  | { type: "sign-in"; email: string; authKey: string }
  | { type: "sign-out" }
  | { type: "device" }
  | { type: "vault" }
  | { type: "revision" }

/** What the service worker answers to each request type. */
export interface ExtensionResponses {
  session: SessionStatus
  "sign-in": SignInResult
  "sign-out": SignOutResult
  device: DeviceStatus
  vault: VaultResult
  revision: RevisionResult
}

const SIMPLE_TYPES = new Set([
  "session",
  "sign-out",
  "device",
  "vault",
  "revision",
])

export function isExtensionRequest(value: unknown): value is ExtensionRequest {
  if (typeof value !== "object" || value === null) return false
  const { type, email, authKey } = value as Record<string, unknown>
  if (type === "sign-in")
    return (
      typeof email === "string" &&
      email.length <= 254 &&
      typeof authKey === "string" &&
      /^[0-9a-f]{64}$/.test(authKey)
    )
  return typeof type === "string" && SIMPLE_TYPES.has(type)
}

type Fetch = typeof fetch

async function call(
  appOrigin: string,
  path: string,
  fetchImpl: Fetch,
  init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" }
): Promise<{ status: number; body: unknown } | null> {
  try {
    const response = await fetchImpl(`${appOrigin}${path}`, {
      method: init.method,
      credentials: "include",
      cache: "no-store",
      headers:
        init.body === undefined
          ? undefined
          : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    return {
      status: response.status,
      body: await response.json().catch(() => null),
    }
  } catch {
    return null
  }
}

function signedInFrom(body: unknown): SessionStatus {
  const user = (body as { user?: { id?: unknown; email?: unknown } } | null)
    ?.user
  return typeof user?.id === "string" && typeof user.email === "string"
    ? { state: "signed-in", userId: user.id, email: user.email }
    : { state: "unavailable" }
}

/** Asks the app who is signed in to this Chrome profile. */
export async function fetchSession(
  appOrigin: string,
  fetchImpl: Fetch = fetch
): Promise<SessionStatus> {
  const result = await call(appOrigin, "/api/auth/session", fetchImpl)
  if (result?.status === 401) return { state: "signed-out" }
  if (result?.status !== 200) return { state: "unavailable" }
  return signedInFrom(result.body)
}

/**
 * Signs this Chrome profile in with the key derived from the password. The
 * session cookie the app sets is the browser's, so the app is signed in too.
 */
export async function signIn(
  appOrigin: string,
  proof: { email: string; authKey: string },
  fetchImpl: Fetch = fetch
): Promise<SignInResult> {
  const result = await call(appOrigin, "/api/auth/login", fetchImpl, {
    method: "POST",
    body: { email: proof.email, authKey: proof.authKey },
  })
  if (result?.status === 400 || result?.status === 401)
    return { state: "rejected" }
  if (result?.status === 429) return { state: "throttled" }
  if (result?.status !== 200) return { state: "unavailable" }
  const session = signedInFrom(result.body)
  return session.state === "signed-in" ? session : { state: "unavailable" }
}

/** Revokes the browser's session, which signs the app out as well. */
export async function signOut(
  appOrigin: string,
  fetchImpl: Fetch = fetch
): Promise<SignOutResult> {
  const result = await call(appOrigin, "/api/auth/logout", fetchImpl, {
    method: "POST",
  })
  return result?.status === 200 || result?.status === 401
    ? { state: "signed-out" }
    : { state: "unavailable" }
}

/**
 * Registers this Chrome profile as a device, exactly as the app does, and
 * reports whether it is approved or which code an approved device must enter.
 * The app and the extension share the device cookie, so they are one device.
 */
export async function fetchDevice(
  appOrigin: string,
  fetchImpl: Fetch = fetch
): Promise<DeviceStatus> {
  const result = await call(appOrigin, "/api/devices", fetchImpl, {
    method: "POST",
    body: {},
  })
  if (result?.status === 401) return { state: "signed-out" }
  if (result?.status !== 200) return { state: "unavailable" }
  const body = result.body as {
    approved?: unknown
    code?: unknown
    expiresAt?: unknown
  } | null
  if (body?.approved === true) return { state: "approved" }
  if (
    body?.approved === false &&
    typeof body.code === "string" &&
    /^\d{8}$/.test(body.code) &&
    typeof body.expiresAt === "string"
  )
    return { state: "pending", code: body.code, expiresAt: body.expiresAt }
  return { state: "unavailable" }
}

function vaultAccessFailure(
  status: number | undefined
): SignedOut | NotApproved | Unavailable {
  if (status === 401) return { state: "signed-out" }
  if (status === 403) return { state: "not-approved" }
  return { state: "unavailable" }
}

/** Downloads the encrypted vault. Only approved devices receive it. */
export async function fetchVault(
  appOrigin: string,
  fetchImpl: Fetch = fetch
): Promise<VaultResult> {
  const result = await call(appOrigin, "/api/vault", fetchImpl)
  if (result?.status !== 200) return vaultAccessFailure(result?.status)
  const body = result.body as Record<string, unknown> | null
  const wrappedVaultKey = parseWrappedVaultKey(body?.wrappedVaultKey)
  if (!wrappedVaultKey) return { state: "unavailable" }
  if (body?.envelope === null && body.revision === null)
    return {
      state: "ok",
      snapshot: { wrappedVaultKey, envelope: null, revision: null },
    }
  // A saved vault has the same shape as a save: an envelope and its revision.
  const saved = parseVaultWrite({
    envelope: body?.envelope,
    expectedRevision: body?.revision,
  })
  if (!saved?.expectedRevision) return { state: "unavailable" }
  return {
    state: "ok",
    snapshot: {
      wrappedVaultKey,
      envelope: saved.envelope,
      revision: saved.expectedRevision,
    },
  }
}

/** Checks for vault changes, and whether this device may still open it. */
export async function fetchRevision(
  appOrigin: string,
  fetchImpl: Fetch = fetch
): Promise<RevisionResult> {
  const result = await call(appOrigin, "/api/vault/revision", fetchImpl)
  if (result?.status !== 200) return vaultAccessFailure(result?.status)
  const revision = (result.body as { revision?: unknown } | null)?.revision
  if (revision === null) return { state: "ok", revision: null }
  return isVaultRevision(revision)
    ? { state: "ok", revision }
    : { state: "unavailable" }
}

/** Answers one popup request. */
export function handleRequest(
  appOrigin: string,
  request: ExtensionRequest,
  fetchImpl: Fetch = fetch
): Promise<ExtensionResponses[ExtensionRequest["type"]]> {
  switch (request.type) {
    case "session":
      return fetchSession(appOrigin, fetchImpl)
    case "sign-in":
      return signIn(appOrigin, request, fetchImpl)
    case "sign-out":
      return signOut(appOrigin, fetchImpl)
    case "device":
      return fetchDevice(appOrigin, fetchImpl)
    case "vault":
      return fetchVault(appOrigin, fetchImpl)
    case "revision":
      return fetchRevision(appOrigin, fetchImpl)
  }
}
