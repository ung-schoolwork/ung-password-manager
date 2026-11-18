import type { Metadata } from "next"

import { VaultWorkspace } from "@/app/vault/_components/vault-workspace"

export const metadata: Metadata = {
  title: "Vault · UNG Password Manager",
}

export default function VaultPage() {
  return <VaultWorkspace />
}
