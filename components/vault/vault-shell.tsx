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
]

export function VaultShell({ children }: { children: React.ReactNode }) {
  const { lockVault } = useVault()
  const pathname = usePathname()

  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <Link
            className="flex min-w-0 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            href="/vault"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>
            <span className="hidden truncate font-semibold sm:inline">
              UNG Password Manager
            </span>
          </Link>

          <nav aria-label="Primary">
            <ul className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`)

                return (
                  <li key={item.href}>
                    <Link
                      className={cn(
                        "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors",
                        active
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
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

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              className="h-9 px-3 text-sm"
              type="button"
              variant="outline"
              onClick={lockVault}
            >
              <Lock className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Lock vault</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
        {children}
      </main>
    </div>
  )
}
