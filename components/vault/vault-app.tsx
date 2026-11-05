"use client"

import type { ReactNode } from "react"
import { usePathname } from "next/navigation"

import { VaultGate } from "@/components/vault/vault-gate"
import { VaultProvider, useVault } from "@/components/vault/vault-provider"
import { VaultShell } from "@/components/vault/vault-shell"

export function VaultApp({
  children,
  ...account
}: {
  children: ReactNode
  accountId: string
  email: string
  unlockKey: CryptoKey | null
  onUnlockKeyUsed: () => void
}) {
  return (
    <VaultProvider {...account}>
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
  const settingsAvailable = settingsPage && status === "locked"

  if (status !== "unlocked" && !settingsAvailable) return <VaultGate />

  return <VaultShell showLock={status === "unlocked"}>{children}</VaultShell>
}
