import { DeviceNotApprovedError } from "@/lib/devices/shared"
import type { VaultRepository } from "@/lib/vault/repository.client"
import type { VaultEnvelopeV1 } from "@/lib/vault/types"
import {
  isVaultRevision,
  MAX_VAULT_REQUEST_BYTES,
  parseVaultWrite,
  VaultConflictError,
} from "@/lib/vault/remote"

export async function fetchVaultRevision(
  signal?: AbortSignal
): Promise<string | null> {
  const value = await vaultRequest(
    "GET",
    undefined,
    "/api/vault/revision",
    signal
  )
  if (value.revision === null) return null
  if (!isVaultRevision(value.revision))
    throw new Error("Your vault could not be checked for changes.")
  return value.revision
}

async function vaultRequest(
  method: "GET" | "PUT",
  body?: string,
  path = "/api/vault",
  signal?: AbortSignal
) {
  const message =
    method === "GET"
      ? "Your vault could not be opened. Try again."
      : "Your vault could not be saved. Try again."
  let response: Response
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body,
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error(message)
  }
  if (response.status === 403) throw new DeviceNotApprovedError()
  if (response.status === 409) throw new VaultConflictError()
  if (response.status === 401)
    throw new Error("Your account session has ended. Sign in again.")
  if (!response.ok) throw new Error(message)
  try {
    return (await response.json()) as Record<string, unknown>
  } catch {
    throw new Error(message)
  }
}

export class RemoteVaultRepository implements VaultRepository {
  private revision: string | null = null

  currentRevision(): string | null {
    return this.revision
  }

  async load(): Promise<VaultEnvelopeV1 | null> {
    const value = await vaultRequest("GET")
    if (value?.envelope === null && value.revision === null) {
      this.revision = null
      return null
    }
    const parsed = parseVaultWrite({
      envelope: value?.envelope,
      expectedRevision: value?.revision,
    })
    if (!parsed || !isVaultRevision(parsed.expectedRevision))
      throw new Error("Your saved vault is invalid or unsupported.")
    this.revision = parsed.expectedRevision
    return parsed.envelope
  }

  async save(envelope: VaultEnvelopeV1): Promise<void> {
    const write = { envelope, expectedRevision: this.revision }
    if (!parseVaultWrite(write))
      throw new Error("Your vault could not be saved in a supported format.")
    const body = JSON.stringify(write)
    if (new TextEncoder().encode(body).byteLength > MAX_VAULT_REQUEST_BYTES)
      throw new Error("Your vault is too large to save.")
    const result = await vaultRequest("PUT", body)
    if (!isVaultRevision(result?.revision))
      throw new Error(
        "Your vault save could not be confirmed. Reopen your vault."
      )
    this.revision = result.revision
  }
}
