"use client"

import type { ReactNode } from "react"
import { usePathname } from "next/navigation"

import { VaultGate } from "@/components/vault/vault-gate"
import { VaultProvider, useVault } from "@/components/vault/vault-provider"
import { VaultShell } from "@/components/vault/vault-shell"

export function VaultApp({
  children,
  accountId,
}: {
  children: ReactNode
  accountId: string
}) {
  return (
    <VaultProvider accountId={accountId}>
      <VaultScreen>{children}</VaultScreen>
    </VaultProvider>
  )
}

function VaultScreen({ children }: { children: ReactNode }) {
  const { status } = useVault()
  const pathname = usePathname()
  const settingsPage =
    pathname === "/settings" || pathname.startsWith("/settings/")
  // Settings manages the account and its approved devices, so it does not
  // need the vault itself to be unlocked.
  const settingsAvailable =
    settingsPage && (status === "locked" || status === "needs-setup")

  if (status !== "unlocked" && !settingsAvailable) return <VaultGate />

  return <VaultShell showLock={status === "unlocked"}>{children}</VaultShell>
}
