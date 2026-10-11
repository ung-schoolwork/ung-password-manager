import {
  connectAuth,
  credentials,
  failure,
  HashBusyError,
  issueSession,
  json,
  limited,
  originAllowed,
  throttled,
  User,
  validPassword,
} from "@/lib/auth/server"

export const runtime = "nodejs"
export async function POST(request: Request) {
  if (!originAllowed(request)) return json({ error: "Forbidden" }, 403)
  try {
    const input = await credentials(request)
    if (!input) return json({ error: "Invalid credentials" }, 400)
    await connectAuth()
    const limit = await limited(request, input.email)
    if (limit && "invalidSource" in limit)
      return json({ error: "Forbidden" }, 403)
    if (limit && "retryAfter" in limit) return throttled(limit.retryAfter)
    const user = await User.findOne({ email: input.email })
    if (
      !(await validPassword(input.password, user?.passwordHash, user?.salt)) ||
      !user
    )
      return json({ error: "Invalid credentials" }, 401)
    return await issueSession(user)
  } catch (error) {
    if (error instanceof HashBusyError) return throttled(1)
    return failure()
  }
}
