// Resolves the client IP used for sign-in and registration rate limits.
// Kept free of server dependencies so the rules can be unit-tested directly.
import { isIP } from "node:net"

export interface SourceSettings {
  AUTH_TRUSTED_IP_HEADER?: string
  NODE_ENV?: string
}

export type SourceProblem =
  "header-not-configured" | "header-missing" | "header-invalid"

export type SourceResult =
  { address: string } | { address: null; problem: SourceProblem }

// Development without a configured header shares one loopback source.
const DEVELOPMENT_SOURCE = "127.0.0.1"
const MAX_HEADER_LENGTH = 1024

/**
 * Reads the client IP from the header named by AUTH_TRUSTED_IP_HEADER.
 *
 * X-Forwarded-For is a chain that each proxy appends to, so only its
 * rightmost entry was written by the proxy directly in front of the app.
 * Everything to its left came from the client or an earlier hop and can be
 * forged, so the leftmost entry is never used. Every other header must hold
 * exactly one IP (CF-Connecting-IP, X-Real-IP, or a custom header the proxy
 * overwrites); a list there is rejected rather than guessed at.
 *
 * Anything missing or not an IP address fails closed.
 */
export function resolveSourceAddress(
  headers: Headers,
  settings: SourceSettings
): SourceResult {
  const name = settings.AUTH_TRUSTED_IP_HEADER?.trim().toLowerCase()
  if (!name) {
    return settings.NODE_ENV === "production"
      ? { address: null, problem: "header-not-configured" }
      : { address: DEVELOPMENT_SOURCE }
  }
  let raw: string | null
  try {
    raw = headers.get(name)
  } catch {
    // An invalid header name in the setting can never match a request.
    return { address: null, problem: "header-not-configured" }
  }
  if (raw === null || !raw.trim())
    return { address: null, problem: "header-missing" }
  if (raw.length > MAX_HEADER_LENGTH)
    return { address: null, problem: "header-invalid" }
  const value =
    name === "x-forwarded-for" ? raw.slice(raw.lastIndexOf(",") + 1) : raw
  const address = parseAddress(value)
  return address ? { address } : { address: null, problem: "header-invalid" }
}

const REPORT_INTERVAL_MS = 15 * 60 * 1000
const lastReported = new Map<SourceProblem, number>()

/**
 * Logs a misconfigured client IP header for operators, at most once per
 * problem every 15 minutes per process. Header values are never logged.
 */
export function reportSourceProblem(
  problem: SourceProblem,
  headerName: string | undefined,
  log: (message: string) => void = console.error,
  now = Date.now()
) {
  const last = lastReported.get(problem)
  if (last !== undefined && now - last < REPORT_INTERVAL_MS) return
  lastReported.set(problem, now)
  const name = JSON.stringify(headerName?.trim().toLowerCase() ?? "")
  const detail = {
    "header-not-configured":
      "AUTH_TRUSTED_IP_HEADER is not set to a valid header name",
    "header-missing": `requests are missing the ${name} header named by AUTH_TRUSTED_IP_HEADER`,
    "header-invalid": `the ${name} header named by AUTH_TRUSTED_IP_HEADER does not hold a client IP address`,
  }[problem]
  log(
    `[auth] Sign-in and registration are refused: ${detail}. Configure the reverse proxy to set this header to the client IP; see "Deployment" in README.md.`
  )
}

/** Test hook: forget which problems have been logged. */
export function resetSourceReports() {
  lastReported.clear()
}

/** Accepts a bare IPv4 or IPv6 address, allowing a port and IPv6 brackets. */
export function parseAddress(value: string): string | null {
  let candidate = value.trim()
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(candidate)
  if (bracketed) candidate = bracketed[1]
  else if (/^[\d.]+:\d{1,5}$/.test(candidate))
    candidate = candidate.slice(0, candidate.lastIndexOf(":"))
  const version = isIP(candidate)
  if (version === 4) return candidate
  if (version !== 6) return null
  // Zone IDs are local to the server and never identify a remote client.
  if (candidate.includes("%")) return null
  const lower = candidate.toLowerCase()
  // One client must map to one limit key, whichever form the proxy sends.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
  if (mapped && isIP(mapped[1]) === 4) return mapped[1]
  // The URL parser writes IPv6 in its shortest canonical form.
  return new URL(`http://[${lower}]`).hostname.slice(1, -1)
}
