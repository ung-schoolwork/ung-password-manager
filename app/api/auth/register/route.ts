import { randomBytes } from "node:crypto"
import {
  connectAuth,
  credentials,
  failure,
  HashBusyError,
  hashPassword,
  issueSession,
  json,
  limited,
  originAllowed,
  throttled,
  User,
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
    const salt = randomBytes(16).toString("hex")
    const passwordHash = await hashPassword(input.password, salt)
    const user = await User.create({ email: input.email, passwordHash, salt })
    try {
      return await issueSession(user, 201)
    } catch {
      // Avoid leaving an account that the caller believes failed to register.
      try {
        await User.deleteOne({ _id: user._id })
      } catch {
        return json(
          { error: "Account created but sign-in failed. Please sign in." },
          503
        )
      }
      return failure()
    }
  } catch (error) {
    if (error instanceof HashBusyError) return throttled(1)
    if ((error as { code?: number }).code === 11000)
      return json({ error: "Unable to register account" }, 409)
    return failure()
  }
}
