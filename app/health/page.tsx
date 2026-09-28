import type { Metadata } from "next"
import { PasswordHealth } from "@/components/password-health"

export const metadata: Metadata = {
  title: "Health · UNG Password Manager",
}

export default function HealthPage() {
  return <PasswordHealth />
}
