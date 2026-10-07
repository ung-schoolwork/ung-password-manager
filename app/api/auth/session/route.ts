import { connectAuth, digest, failure, json, readToken, Session, User } from "@/lib/auth/server"

export const runtime = "nodejs"
export async function GET(request: Request) {
  const token = readToken(request)
  if (!token) return json({ error: "Not authenticated" }, 401)
  try {
    await connectAuth()
    const session = await Session.findOne({ tokenDigest: digest(token), expiresAt: { $gt: new Date() } })
    if (!session) return json({ error: "Not authenticated" }, 401)
    const user = await User.findById(session.userId)
    if (!user) return json({ error: "Not authenticated" }, 401)
    return json({ user: { id: String(user._id), email: user.email }, expiresAt: session.expiresAt.toISOString() })
  } catch { return failure() }
}
