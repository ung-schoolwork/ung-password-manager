import { authenticatedUser, failure, json } from "@/lib/auth/server"
import { currentApprovedDevice } from "@/lib/devices/server"
import { loadAccountRevision } from "@/lib/vault/remote.server"

export const runtime = "nodejs"

// Lets approved devices check for changes without downloading the vault.
export async function GET(request: Request) {
  try {
    const user = await authenticatedUser(request)
    if (!user) return json({ error: "Not authenticated" }, 401)
    if (!(await currentApprovedDevice(request, user.id)))
      return json({ error: "Device not approved" }, 403)
    return json({ revision: await loadAccountRevision(user.id) })
  } catch {
    return failure()
  }
}
