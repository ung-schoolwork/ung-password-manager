// Matches saved credentials to the website open in a browser tab. Pure and
// framework-free so the extension and the web app can share it.
//
// A credential's website is free text ("example.com", "https://example.com/login",
// "www.example.com"), so it is parsed leniently. A tab matches when its host
// is the saved host or a subdomain of it: a login for example.com shows on
// accounts.example.com, but a login for accounts.example.com does not show on
// example.com, and evil-example.com never matches example.com.

// "name:" starts a scheme unless digits follow, as in "example.com:8443".
const SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/

function webHost(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  // "user@example.com" is an account, not a website.
  if (url.username || url.password) return null
  let host = url.hostname.toLowerCase().replace(/\.$/, "")
  if (host.startsWith("www.")) host = host.slice(4)
  return host || null
}

/**
 * The host of a credential's website, or null when it is not a web address
 * (for example "My bank app"). A scheme and path are optional; "www." is ignored.
 */
export function savedSiteHost(siteOrApp: string): string | null {
  const text = siteOrApp.trim()
  if (!text || /\s/.test(text)) return null
  return webHost(SCHEME.test(text) ? text : `https://${text}`)
}

/** The host of a tab's URL. Only http and https pages have one. */
export function tabSiteHost(url: string | null | undefined): string | null {
  return url ? webHost(url) : null
}

/** Whether a page on `tabHost` belongs to the site saved as `savedHost`. */
export function hostMatchesSite(tabHost: string, savedHost: string): boolean {
  if (tabHost === savedHost) return true
  // Only a saved name with at least two labels covers its subdomains, so a
  // saved "com" or "localhost" never matches every site. IP addresses have no
  // subdomains.
  if (
    !savedHost.includes(".") ||
    IPV4.test(savedHost) ||
    savedHost.startsWith("[")
  )
    return false
  return tabHost.endsWith(`.${savedHost}`)
}

/** The credentials saved for the website at `tabUrl`, in their given order. */
export function credentialsForSite<T extends { siteOrApp: string }>(
  credentials: T[],
  tabUrl: string | null | undefined
): T[] {
  const tabHost = tabSiteHost(tabUrl)
  if (!tabHost) return []
  return credentials.filter((credential) => {
    const savedHost = savedSiteHost(credential.siteOrApp)
    return savedHost !== null && hostMatchesSite(tabHost, savedHost)
  })
}
