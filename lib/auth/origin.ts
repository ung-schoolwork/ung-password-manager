// Origin checks for state-changing API routes (CSRF protection alongside the
// SameSite=Strict session cookie). Kept free of server dependencies so the
// rules can be unit-tested directly.

const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/

export interface OriginSettings {
  APP_ORIGIN?: string
  EXTENSION_ORIGINS?: string
  NODE_ENV?: string
}

/**
 * Parses EXTENSION_ORIGINS: a comma-separated list of exact
 * `chrome-extension://<id>` origins. Anything else is ignored, so a malformed
 * entry never widens what the server accepts.
 */
export function extensionOrigins(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => EXTENSION_ORIGIN.test(entry))
}

export function isAllowedOrigin(
  requestOrigin: string | null,
  settings: OriginSettings
) {
  const appOrigin = settings.APP_ORIGIN
  const production = settings.NODE_ENV === "production"
  // With no APP_ORIGIN, any origin may call the API outside production.
  // Production still fails closed so a missing setting never opens it up.
  if (!appOrigin) return !production
  try {
    if (new URL(appOrigin).origin !== appOrigin) return false
  } catch {
    return false
  }
  if (production && !appOrigin.startsWith("https://")) return false
  if (!requestOrigin) return false
  return (
    requestOrigin === appOrigin ||
    extensionOrigins(settings.EXTENSION_ORIGINS).includes(requestOrigin)
  )
}
