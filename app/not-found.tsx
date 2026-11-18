import type { Metadata } from "next"
import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"

export const metadata: Metadata = {
  title: "Page not found · UNG Password Manager",
}

export default function NotFound() {
  return (
    <main className="grid min-h-[60svh] place-items-center p-6">
      <div className="max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="text-muted-foreground">
          There is no page at this address.
        </p>
        <Link href="/vault" className={buttonVariants()}>
          Go to your vault
        </Link>
      </div>
    </main>
  )
}
