// ---------------------------------------------------------------------------
// page.tsx: the route file for the "Health" page (likely /health)
//
// This is a SERVER component (no "use client" directive). Its only jobs are
// to set the page's metadata and to render the client component that does
// the real work. Keeping it separate matters: `metadata` can only be exported
// from server components, while PasswordHealth needs client-side hooks.
// ---------------------------------------------------------------------------

// Type-only import: erased at build time, adds nothing to the bundle.
import type { Metadata } from "next"

// "@/" is a path alias (configured in tsconfig) pointing at the project root/src.
import { PasswordHealth } from "@/components/password-health"

// In the Next.js App Router, exporting a `metadata` object from a page sets
// the <title> (and other <head> tags) for this route.
export const metadata: Metadata = {
  title: "Health · UNG Password Manager",
}

// The default export is what Next.js renders for this route.
export default function HealthPage() {
  return <PasswordHealth />
}
