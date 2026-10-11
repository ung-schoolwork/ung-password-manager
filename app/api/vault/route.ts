import {
  authenticatedUser,
  failure,
  json,
  originAllowed,
} from "@/lib/auth/server"
import { loadAccountVault, saveAccountVault } from "@/lib/vault/remote.server"
import {
  MAX_VAULT_REQUEST_BYTES,
  parseVaultWrite,
  VaultConflictError,
} from "@/lib/vault/remote"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const user = await authenticatedUser(request)
    if (!user) return json({ error: "Not authenticated" }, 401)
    return json(await loadAccountVault(user.id))
  } catch {
    return failure()
  }
}

export async function PUT(request: Request) {
  if (!originAllowed(request)) return json({ error: "Forbidden" }, 403)
  try {
    const user = await authenticatedUser(request)
    if (!user) return json({ error: "Not authenticated" }, 401)
    const write = await readWrite(request)
    if (!write) return json({ error: "Invalid encrypted vault" }, 400)
    return json(await saveAccountVault(user.id, write))
  } catch (error) {
    if (error instanceof VaultConflictError)
      return json({ error: error.message }, 409)
    return failure()
  }
}

async function readWrite(request: Request) {
  if (
    !/^application\/json(?:\s*;|\s*$)/i.test(
      request.headers.get("content-type") || ""
    ) ||
    !request.body
  )
    return null
  const declared = request.headers.get("content-length")
  if (
    declared &&
    (!/^\d+$/.test(declared) || Number(declared) > MAX_VAULT_REQUEST_BYTES)
  ) {
    void request.body.cancel().catch(() => undefined)
    return null
  }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_VAULT_REQUEST_BYTES) {
        void reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
    return parseVaultWrite(JSON.parse(Buffer.concat(chunks).toString("utf8")))
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}
