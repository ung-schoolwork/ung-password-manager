import {
  authenticatedUser,
  failure,
  increment,
  json,
  originAllowed,
  throttled,
} from "@/lib/auth/server"
import {
  approvePendingDevice,
  currentApprovedDevice,
} from "@/lib/devices/server"
import { readJsonObject } from "@/lib/http/json-body"
import { normalizeDeviceCode } from "@/lib/devices/shared"

export const runtime = "nodejs"
// Codes are short, so cap guesses per account to keep brute force impractical.
const ATTEMPT_CAP = 10
const MAX_BODY_BYTES = 1024

export async function POST(request: Request) {
  if (!originAllowed(request)) return json({ error: "Forbidden" }, 403)
  try {
    const user = await authenticatedUser(request)
    if (!user) return json({ error: "Not authenticated" }, 401)
    if (!(await currentApprovedDevice(request, user.id)))
      return json({ error: "Device not approved" }, 403)
    const body = await readJsonObject(request, MAX_BODY_BYTES)
    const code =
      typeof body?.code === "string" ? normalizeDeviceCode(body.code) : null
    if (!code) return json({ error: "Invalid code" }, 400)
    const attempts = await increment(`device-approve:${user.id}`, new Date())
    if (attempts.count > ATTEMPT_CAP)
      return throttled(
        Math.max(
          1,
          Math.ceil((attempts.expiresAt.getTime() - Date.now()) / 1000)
        )
      )
    const device = await approvePendingDevice(user.id, code)
    if (!device) return json({ error: "Code not found or expired" }, 404)
    return json({ device })
  } catch {
    return failure()
  }
}
