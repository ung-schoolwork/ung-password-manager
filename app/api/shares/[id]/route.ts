import {
  authenticatedUser,
  failure,
  json,
  originAllowed,
} from "@/lib/auth/server"
import { currentApprovedDevice } from "@/lib/devices/server"
import {
  readIncomingShare,
  removeShare,
  ShareEndedError,
  ShareNotFoundError,
} from "@/lib/sharing/server"

export const runtime = "nodejs"

// Returns the shared credential to its recipient while the share is active.
// An expired or removed share answers 410 with its status and no credential.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticatedUser(request)
    if (!user) return json({ error: "Not authenticated" }, 401)
    if (!(await currentApprovedDevice(request, user.id)))
      return json({ error: "Device not approved" }, 403)
    const { id } = await params
    return json(await readIncomingShare(id, user.id))
  } catch (error) {
    if (error instanceof ShareNotFoundError)
      return json({ error: error.message }, 404)
    if (error instanceof ShareEndedError)
      return json({ error: error.message, status: error.status }, 410)
    return failure()
  }
}

// The owner revokes a share, or the recipient declines it. Either can also
// clear a share that has already ended from their own list.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!originAllowed(request)) return json({ error: "Forbidden" }, 403)
  try {
    const user = await authenticatedUser(request)
    if (!user) return json({ error: "Not authenticated" }, 401)
    if (!(await currentApprovedDevice(request, user.id)))
      return json({ error: "Device not approved" }, 403)
    const { id } = await params
    return json({ ok: true, ...(await removeShare(id, user.id)) })
  } catch (error) {
    if (error instanceof ShareNotFoundError)
      return json({ error: error.message }, 404)
    return failure()
  }
}
