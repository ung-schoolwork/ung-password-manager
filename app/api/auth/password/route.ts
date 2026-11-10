import {
  activeSession,
  failure,
  HashBusyError,
  json,
  limited,
  originAllowed,
  readToken,
  throttled,
} from "@/lib/auth/server"
import {
  changeAccountPassword,
  passwordChangeInput,
} from "@/lib/auth/password-change.server"
import {
  PASSWORD_CHANGE_WRONG_PASSWORD,
  PASSWORD_CHANGED_SIGNED_OUT,
} from "@/lib/auth/password-change"
import { currentApprovedDevice } from "@/lib/devices/server"

export const runtime = "nodejs"
export async function POST(request: Request) {
  if (!originAllowed(request)) return json({ error: "Forbidden" }, 403)
  try {
    const token = readToken(request)
    const active = token ? await activeSession(token) : null
    if (!active) return json({ error: "Not authenticated" }, 401)
    const userId = String(active.user._id)
    // Only a device that can already open the vault may replace its password.
    if (!(await currentApprovedDevice(request, userId)))
      return json({ error: "Device not approved" }, 403)
    const input = await passwordChangeInput(request)
    if (!input) return json({ error: "Invalid password change" }, 400)
    // Shares the sign-in budget, so this cannot be used to guess passwords faster.
    const limit = await limited(request, active.user.email)
    if (limit && "invalidSource" in limit)
      return json({ error: "Forbidden" }, 403)
    if (limit && "retryAfter" in limit) return throttled(limit.retryAfter)
    const result = await changeAccountPassword(userId, input)
    switch (result.outcome) {
      case "changed":
        return result.response
      case "invalid-credentials":
        return json({ error: PASSWORD_CHANGE_WRONG_PASSWORD }, 401)
      case "conflict":
        return json({ error: "Account changed" }, 409)
      case "changed-signed-out":
        return json({ error: PASSWORD_CHANGED_SIGNED_OUT }, 503)
    }
  } catch (error) {
    if (error instanceof HashBusyError) return throttled(1)
    return failure()
  }
}
