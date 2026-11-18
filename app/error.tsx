"use client"

import { useEffect } from "react"

import { Button } from "@/components/ui/button"

// Catches a page that throws while rendering, so the user gets a way to
// recover instead of a blank screen. Details go to the console, not the page.
export default function PageError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="grid min-h-[60svh] place-items-center p-6">
      <div className="max-w-sm space-y-4 text-center" role="alert">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-muted-foreground">
          This page could not be shown. Try again, or reload the page if the
          problem continues.
        </p>
        <Button type="button" onClick={() => retry()}>
          Try again
        </Button>
      </div>
    </main>
  )
}
