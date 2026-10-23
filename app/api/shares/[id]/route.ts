import {
  authenticatedUser,
  failure,
  json,
  originAllowed,
} from "@/lib/auth/server"
import { removeShare, ShareNotFoundError } from "@/lib/sharing/server"

export const runtime = "nodejs"

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!originAllowed(request)) return json({ error: "Forbidden" }, 403)
  try {
    const user = await authenticatedUser(request)
    if (!user) return json({ error: "Not authenticated" }, 401)
    const { id } = await params
    await removeShare(id, user.id)
    return json({ ok: true })
  } catch (error) {
    if (error instanceof ShareNotFoundError)
      return json({ error: error.message }, 404)
    return failure()
  }
}