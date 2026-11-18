import {
  authenticatedUser,
  failure,
  json,
  originAllowed,
} from "@/lib/auth/server"
import { currentApprovedDevice } from "@/lib/devices/server"
import { readJsonObject } from "@/lib/http/json-body"
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
    if (!(await currentApprovedDevice(request, user.id)))
      return json({ error: "Device not approved" }, 403)
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
    if (!(await currentApprovedDevice(request, user.id)))
      return json({ error: "Device not approved" }, 403)
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
  const body = await readJsonObject(request, MAX_VAULT_REQUEST_BYTES)
  return body ? parseVaultWrite(body) : null
}
