export const DEFAULT_APP_ORIGIN = "http://localhost:3000"

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

/**
 * Validates the app origin the extension is built against. It must be an
 * exact origin (no path or trailing slash), and plain HTTP is only accepted
 * for a local server, so a deployed build never talks to the app unencrypted.
 */
export function parseAppOrigin(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`EXTENSION_APP_ORIGIN is not a URL: ${value}`)
  }
  if (url.origin !== value)
    throw new Error(
      `EXTENSION_APP_ORIGIN must be an exact origin such as https://app.example.com, not ${value}`
    )
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
  )
    throw new Error(
      `EXTENSION_APP_ORIGIN must use https unless it is a local server: ${value}`
    )
  return url.origin
}
