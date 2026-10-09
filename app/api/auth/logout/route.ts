import {
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
    // Revocation invalidates the request's token. A cookie-clearing response
    // could arrive after another tab signs in and erase its newer session.
    return json({ ok: true })
  } catch {
    return failure()
  }
}
