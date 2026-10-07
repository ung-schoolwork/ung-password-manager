import {
  clearSessionCookie,
  connectAuth,
  digest,
  failure,
  json,
  originAllowed,
  readToken,
  Session,
} from "@/lib/auth/server"

export const runtime = "nodejs"
export async function POST(request: Request) {
  if (!originAllowed(request)) return json({ error: "Forbidden" }, 403)
  try {
    await connectAuth()
    const token = readToken(request)
    if (token) await Session.deleteOne({ tokenDigest: digest(token) })
    const response = json({ ok: true })
    clearSessionCookie(response)
    return response
  } catch {
    return failure()
  }
}
