import {
  authenticatedUser,
  failure,
  json,
  originAllowed,
} from "@/lib/auth/server"
import {
  currentApprovedDevice,
  ensureDevice,
  listDevices,
  setDeviceCookie,
} from "@/lib/devices/server"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const user = await authenticatedUser(request)
    if (!user) return json({ error: "Not authenticated" }, 401)
    const device = await currentApprovedDevice(request, user.id)
    if (!device) return json({ error: "Device not approved" }, 403)
    return json({ devices: await listDevices(user.id, device.id) })
  } catch {
    return failure()
  }
}

// Registers this browser and reports whether it may open the vault.
export async function POST(request: Request) {
  if (!originAllowed(request)) return json({ error: "Forbidden" }, 403)
  try {
    const user = await authenticatedUser(request)
    if (!user) return json({ error: "Not authenticated" }, 401)
    const { state, deviceCookie } = await ensureDevice(request, user.id)
    const response = json(state)
    if (deviceCookie) setDeviceCookie(response, deviceCookie)
    return response
  } catch {
    return failure()
  }
}
