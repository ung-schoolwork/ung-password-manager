import { randomBytes } from "node:crypto"
import { ensureDevice, setDeviceCookie } from "@/lib/devices/server"
import {
  connectAuth,
  accountInput,
  failure,
  HashBusyError,
  hashAuthKey,
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
    const input = await accountInput(request)
    // Registration also stores the new vault key, wrapped in the browser.
    if (!input?.wrappedVaultKey)
      return json({ error: "Invalid credentials" }, 400)
    await connectAuth()
    const limit = await limited(request, input.email)
    if (limit && "invalidSource" in limit)
      return json({ error: "Forbidden" }, 403)
    if (limit && "retryAfter" in limit) return throttled(limit.retryAfter)
    const salt = randomBytes(16).toString("hex")
    const authKeyHash = await hashAuthKey(input.authKey, salt)
    const user = await User.create({
      email: input.email,
      authKeyHash,
      salt,
      wrappedVaultKey: input.wrappedVaultKey,
    })
    try {
      const response = await issueSession(user, 201)
      const { deviceCookie } = await ensureDevice(request, String(user._id))
      if (deviceCookie) setDeviceCookie(response, deviceCookie)
      return response
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
