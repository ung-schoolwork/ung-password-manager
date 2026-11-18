"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { ShieldCheck } from "lucide-react"

import { useAccount } from "@/components/auth/account-provider"
import { ThemeToggle } from "@/components/theme-toggle"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Signed-in people see the page inside the app's own header. Everyone else
 * gets a header of its own that leads to sign-in.
 */
export function ExtensionPageFrame({ children }: { children: ReactNode }) {
  const { status, session } = useAccount()
  if (status === "signed-in" && session !== null) return children

  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <Link
            className="flex min-w-0 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            href="/sign-in"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>
            <span className="truncate font-semibold">UNG Password Manager</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-9 px-3 text-sm"
              )}
              href="/sign-in"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
        {children}
      </main>
    </div>
  )
}
