import type { NextConfig } from "next"

const production = process.env.NODE_ENV === "production"

// The vault is decrypted in the page, so the page must only run this app's
// own code and must never be framed by another site (clickjacking). Next.js
// and next-themes inject inline scripts, so 'unsafe-inline' stays until the
// app moves to nonces; React needs 'unsafe-eval' only in development.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(production ? ["upgrade-insecure-requests"] : []),
].join("; ")

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  // Older browsers that ignore frame-ancestors.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Page URLs never leave the app in the Referer header.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  // Production is served only over HTTPS (APP_ORIGIN must be https://).
  ...(production
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
      ]
    : []),
]

const nextConfig: NextConfig = {
  serverExternalPackages: ["mongoose"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }]
  },
}

export default nextConfig
