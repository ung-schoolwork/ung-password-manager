"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Lock, ShieldCheck } from "lucide-react"

import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { useVault } from "@/components/vault/vault-provider"
import { cn } from "@/lib/utils"

export interface NavItem {
  href: string
  label: string
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/vault", label: "Vault" },
  { href: "/generate", label: "Generator" },
  { href: "/health", label: "Health" },
  { href: "/settings", label: "Settings" },
]

export function VaultShell({
  children,
  showLock = true,
}: {
  children: React.ReactNode
  showLock?: boolean
}) {
  const { lockVault } = useVault()
  const pathname = usePathname()

  return (
    <div className="min-h-svh bg-background">
      <a
        className="sr-only rounded-md bg-background px-4 py-3 font-medium text-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-20 focus-visible:ring-2 focus-visible:ring-ring"
        href="#main-content"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="relative mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:flex-nowrap sm:gap-4 sm:px-8">
          <Link
            className="flex min-w-0 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            href="/vault"
            aria-label="UNG Password Manager"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>
            <span className="sr-only truncate font-semibold sm:not-sr-only">
              UNG Password Manager
            </span>
          </Link>

          <nav className="basis-full sm:basis-auto" aria-label="Primary">
            <ul className="grid w-full grid-cols-2 gap-1 sm:flex sm:w-auto sm:items-center">
              {NAV_ITEMS.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`)

                return (
                  <li key={item.href}>
                    <Link
                      className={cn(
                        "inline-flex min-h-11 w-full items-center justify-center rounded-md px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9 sm:w-auto",
                        active
                          ? "bg-muted text-foreground"
                          : "text-foreground hover:bg-muted/60"
                      )}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                    >
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>

          <div className="absolute top-3 right-4 flex items-center gap-2 sm:static">
            <ThemeToggle />
            {showLock ? (
              <Button
                className="h-11 px-3 text-sm sm:h-9"
                type="button"
                variant="outline"
                aria-label="Lock vault"
                onClick={lockVault}
              >
                <Lock className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline" aria-hidden="true">
                  Lock vault
                </span>
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-6xl px-4 py-8 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-8 sm:py-10"
      >
        {children}
      </main>
    </div>
  )
}
