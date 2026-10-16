import {
  authenticatedUser,
  failure,
  json,
  originAllowed,
} from "@/lib/auth/server"
import { currentApprovedDevice, removeDevice } from "@/lib/devices/server"

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
    const { id } = await context.params
    if (id === current.id)
      return json({ error: "Use another device to remove this one" }, 400)
    if (!(await removeDevice(user.id, id)))
      return json({ error: "Device not found" }, 404)
    return json({ ok: true })
  } catch {
    return failure()
  }
}
