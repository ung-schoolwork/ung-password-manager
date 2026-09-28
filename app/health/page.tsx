import type { Metadata } from "next"

import { HealthWorkspace } from "@/components/vault/health-workspace"

export const metadata: Metadata = {
  title: "Health · UNG Password Manager",
}

export default function HealthPage() {
  return <HealthWorkspace />
}
