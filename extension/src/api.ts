// The service worker is the extension's only API client. Popups and (later)
// content scripts ask it over runtime messaging instead of calling the app
// themselves: a content script's requests would carry the visited site's
// origin, which the server rejects.

export type SessionStatus =
  | { state: "signed-in"; email: string }
  | { state: "signed-out" }
  | { state: "unavailable" }

export type ExtensionRequest = { type: "session" }

export function isExtensionRequest(value: unknown): value is ExtensionRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "session"
  )
}

/**
 * Asks the app who is signed in. The request carries the browser's session
 * cookie, because the extension has host permission for the app's origin.
 */
export async function fetchSession(
  appOrigin: string,
  fetchImpl: typeof fetch = fetch
): Promise<SessionStatus> {
  try {
    const response = await fetchImpl(`${appOrigin}/api/auth/session`, {
      credentials: "include",
      cache: "no-store",
    })
    if (response.status === 401) return { state: "signed-out" }
    if (!response.ok) return { state: "unavailable" }
    const body = (await response.json()) as { user?: { email?: unknown } }
    return typeof body.user?.email === "string"
      ? { state: "signed-in", email: body.user.email }
      : { state: "unavailable" }
  } catch {
    return { state: "unavailable" }
  }
}
