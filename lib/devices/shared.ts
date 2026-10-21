export const DEVICE_CODE_LENGTH = 8
export const DEVICE_NAME_MAX_LENGTH = 60

export interface DeviceSummary {
  id: string
  name: string
  current: boolean
  approvedAt: string
  lastSeenAt: string
}

export type DeviceState =
  | { approved: true; deviceId: string }
  | { approved: false; deviceId: string; code: string; expiresAt: string }

export class DeviceNotApprovedError extends Error {
  constructor() {
    super("This device is not approved to open your vault.")
    this.name = "DeviceNotApprovedError"
  }
}

export function normalizeDeviceCode(value: string): string | null {
  const digits = value.replace(/[\s-]/g, "")
  return new RegExp(`^\\d{${DEVICE_CODE_LENGTH}}$`).test(digits) ? digits : null
}

export function formatDeviceCode(code: string): string {
  const half = Math.ceil(code.length / 2)
  return `${code.slice(0, half)} ${code.slice(half)}`
}

// A readable label such as "Chrome on Windows", so owners can tell devices apart.
export function deviceNameFromUserAgent(userAgent: string | null): string {
  const agent = userAgent ?? ""
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /OPR\/|Opera/.test(agent)
      ? "Opera"
      : /Firefox\//.test(agent)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(agent)
          ? "Chrome"
          : /Safari\//.test(agent)
            ? "Safari"
            : null
  const system = /Android/.test(agent)
    ? "Android"
    : /iPhone|iPad|iPod/.test(agent)
      ? "iOS"
      : /Windows/.test(agent)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(agent)
          ? "macOS"
          : /CrOS/.test(agent)
            ? "ChromeOS"
            : /Linux/.test(agent)
              ? "Linux"
              : null
  const name =
    browser && system ? `${browser} on ${system}` : (browser ?? system)
  return (name ?? "Unknown device").slice(0, DEVICE_NAME_MAX_LENGTH)
}
