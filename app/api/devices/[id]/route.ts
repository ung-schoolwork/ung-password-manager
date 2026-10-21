import {
  authenticatedUser,
  failure,
  json,
  originAllowed,
} from "@/lib/auth/server"
import { currentApprovedDevice, removeDevice } from "@/lib/devices/server"
import { normalizeDeviceId } from "@/lib/devices/shared"

export const runtime = "nodejs"

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!originAllowed(request)) return json({ error: "Forbidden" }, 403)
  try {
    const user = await authenticatedUser(request)
    if (!user) return json({ error: "Not authenticated" }, 401)
    const current = await currentApprovedDevice(request, user.id)
    if (!current) return json({ error: "Device not approved" }, 403)
    const id = normalizeDeviceId((await context.params).id)
    if (!id) return json({ error: "Invalid device" }, 400)
    const result = await removeDevice(user.id, current.id, id)
    if (result === "current")
      return json({ error: "Use another device to remove this one" }, 400)
    if (result === "not-approved")
      return json({ error: "Device not approved" }, 403)
    if (result === "busy") return json({ error: "Try again in a moment" }, 409)
    if (result === "not-found") return json({ error: "Device not found" }, 404)
    return json({ ok: true })
  } catch {
    return failure()
  }
}
