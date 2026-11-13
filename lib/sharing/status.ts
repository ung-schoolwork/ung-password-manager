// Share lifetime rules shared by the browser and the server. The server is
// the one that enforces them; the browser uses the same rules to label shares
// and to build the end date it asks for.

export const SHARE_STATUSES = ["active", "expired", "removed"] as const
export type ShareStatus = (typeof SHARE_STATUSES)[number]

/** Who ended a removed share: the owner revoked it or the recipient declined it. */
export type ShareRemovedBy = "owner" | "recipient"

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** A share may end at most this far in the future. */
export const MAX_SHARE_DURATION_MS = 365 * DAY
/** An end date must leave at least this much time to use the share. */
export const MIN_SHARE_DURATION_MS = 60 * 1000

export const SHARE_DURATION_PRESETS = [
  { id: "none", label: "No end date", durationMs: null },
  { id: "1h", label: "1 hour", durationMs: HOUR },
  { id: "1d", label: "1 day", durationMs: DAY },
  { id: "7d", label: "7 days", durationMs: 7 * DAY },
  { id: "30d", label: "30 days", durationMs: 30 * DAY },
] as const

export type ShareDurationPresetId =
  (typeof SHARE_DURATION_PRESETS)[number]["id"] | "custom"

/**
 * Where a share stands at `now`. Records saved before shares could end have
 * neither field, so they read as active with no end date.
 */
export function shareStatus(
  share: { revokedAt?: Date | null; expiresAt?: Date | null },
  now: Date = new Date()
): ShareStatus {
  if (share.revokedAt) return "removed"
  if (share.expiresAt && share.expiresAt.getTime() <= now.getTime())
    return "expired"
  return "active"
}

export class ShareExpiryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ShareExpiryError"
  }
}

/**
 * Checks an end date sent with a new share. `null`/`undefined` mean no end
 * date. Anything else must be an ISO date string between one minute and one
 * year from `now`.
 */
export function parseShareExpiry(
  value: unknown,
  now: Date = new Date()
): Date | null {
  if (value === null || value === undefined) return null
  if (typeof value !== "string" || value.length > 40)
    throw new ShareExpiryError("Choose a valid end date.")
  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    throw new ShareExpiryError("Choose a valid end date.")
  const remaining = date.getTime() - now.getTime()
  if (remaining < MIN_SHARE_DURATION_MS)
    throw new ShareExpiryError("Choose an end date in the future.")
  if (remaining > MAX_SHARE_DURATION_MS)
    throw new ShareExpiryError("Choose an end date within one year.")
  return date
}

/** The end date for a preset, or `null` for no end date. */
export function presetExpiry(
  presetId: Exclude<ShareDurationPresetId, "custom">,
  now: Date = new Date()
): Date | null {
  const preset = SHARE_DURATION_PRESETS.find((item) => item.id === presetId)
  if (!preset || preset.durationMs === null) return null
  return new Date(now.getTime() + preset.durationMs)
}

/**
 * Reads the value of an `<input type="datetime-local">` ("2026-11-10T14:30")
 * as local time. Returns null when it is empty or malformed.
 */
export function parseLocalDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [, year, month, day, hour, minute] = match.map(Number)
  const date = new Date(year, month - 1, day, hour, minute)
  // Reject dates the Date constructor rolled over, such as February 31.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  )
    return null
  return date
}

/** Formats a date for a `datetime-local` input, in local time. */
export function toLocalDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
