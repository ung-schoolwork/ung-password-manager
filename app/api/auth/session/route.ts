import { activeSession, failure, json, readToken } from "@/lib/auth/server"

export const runtime = "nodejs"
export async function GET(request: Request) {
  const token = readToken(request)
  if (!token) return json({ error: "Not authenticated" }, 401)
  try {
    const active = await activeSession(token)
    if (!active) return json({ error: "Not authenticated" }, 401)
    const { session, user } = active
    return json({ user: { id: String(user._id), email: user.email }, expiresAt: session.expiresAt.toISOString() })
  } catch { return failure() }
}
