"use client"

import { useEffect, useState, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { usePathname, useRouter } from "next/navigation"
import { AccountProvider, useAccount } from "@/components/auth/account-provider"
import { AccountMenu } from "@/components/auth/account-menu"
import { Button } from "@/components/ui/button"
import { VaultApp } from "@/components/vault/vault-app"

export function AccountApp({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={queryClient}>
      <AccountProvider>
        <AccountScreen>{children}</AccountScreen>
      </AccountProvider>
    </QueryClientProvider>
  )
}

function AccountScreen({ children }: { children: ReactNode }) {
  const { status, session, signOut } = useAccount()
  const pathname = usePathname()
  const router = useRouter()
  const accountPage = pathname === "/sign-in" || pathname === "/register"
  const authenticated = status === "signed-in" && session !== null

  useEffect(() => {
    if (status === "loading") return
    if (authenticated && accountPage) router.replace("/vault")
    else if (!authenticated && !accountPage) router.replace("/sign-in")
  }, [status, authenticated, accountPage, router])

  if (status === "loading" || (authenticated && accountPage)) {
    return (
      <main className="grid min-h-svh place-items-center p-6">
        <p role="status">Loading your account…</p>
      </main>
    )
  }
  if (!authenticated) {
    // Render the actual route segment so navigation cannot expose a temporary
    // form that gets replaced while the user is typing.
    return accountPage ? (
      children
    ) : (
      <main className="grid min-h-svh place-items-center p-6">
        <p role="status">Opening sign-in…</p>
      </main>
    )
  }
  return (
    <div>
      <div className="flex items-center justify-end gap-3 border-b px-5 py-2 sm:px-8">
        <AccountMenu key={session.user.id} email={session.user.email} />
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          onClick={() => void signOut()}
        >
          Sign out
        </Button>
      </div>
      <VaultApp key={session.user.id} accountId={session.user.id}>
        {children}
      </VaultApp>
    </div>
  )
}
