"use client"

import type { ReactNode } from "react"

import { VaultGate } from "@/components/vault/vault-gate"
import {
  VaultProvider,
  useVault,
} from "@/components/vault/vault-provider"
import { VaultShell } from "@/components/vault/vault-shell"

export function VaultApp({ children }: { children: ReactNode }) {
  return (
    <VaultProvider>
      <VaultScreen>{children}</VaultScreen>
    </VaultProvider>
  )
}

function VaultScreen({ children }: { children: ReactNode }) {
  const { status } = useVault()

  if (status !== "unlocked") return <VaultGate />

  return <VaultShell>{children}</VaultShell>
}
