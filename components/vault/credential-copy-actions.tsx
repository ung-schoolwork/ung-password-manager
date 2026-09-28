"use client"

import { Check, Copy } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"

type CopyField = "username" | "password"

const FIELD_LABELS: Record<CopyField, string> = {
  username: "Username",
  password: "Password",
}

// How long a copied credential stays on the clipboard before it is
// cleared automatically (SCRUM-24).
const CLEAR_AFTER_MS = 15_000

export function CredentialCopyActions({
  username,
  password,
}: {
  username: string
  password: string
}) {
  const [copiedField, setCopiedField] = useState<CopyField | null>(null)
  const [clearedField, setClearedField] = useState<CopyField | null>(null)
  const [copyFailed, setCopyFailed] = useState(false)

  // Tracks the pending auto-clear so a new copy can cancel the old one,
  // and so we know exactly what value we're checking the clipboard against.
  const pendingClear = useRef<{
    timer: ReturnType<typeof setTimeout>
    value: string
  } | null>(null)

  const cancelPendingClear = useCallback(() => {
    if (pendingClear.current) {
      clearTimeout(pendingClear.current.timer)
      pendingClear.current = null
    }
  }, [])

  // If the component unmounts (e.g. the credential is deleted) while a
  // clear is still pending, stop the timer without touching state.
  useEffect(() => cancelPendingClear, [cancelPendingClear])

  async function copy(value: string, field: CopyField) {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      setCopiedField(null)
      setClearedField(null)
      setCopyFailed(true)
      return
    }

    cancelPendingClear()
    setCopiedField(field)
    setClearedField(null)
    setCopyFailed(false)

    const timer = setTimeout(async () => {
      pendingClear.current = null

      // Only clear if the clipboard still holds what we copied — the
      // user may have copied something else in the meantime (SCRUM-24 AC).
      let stillOurs = true
      try {
        stillOurs = (await navigator.clipboard.readText()) === value
      } catch {
        // Some browsers block reads; clearing anyway is safer than
        // leaving a credential sitting in the clipboard.
      }

      if (stillOurs) {
        try {
          await navigator.clipboard.writeText("")
          // Swap the "copied" message for the "cleared" one.
          setCopiedField(null)
          setClearedField(field)
        } catch {
          // Leave the "copied" message as-is if the clear itself fails.
        }
      }
    }, CLEAR_AFTER_MS)

    pendingClear.current = { timer, value }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <CopyButton
          field="username"
          justCopied={copiedField === "username"}
          onCopy={() => copy(username, "username")}
        />
        <CopyButton
          field="password"
          justCopied={copiedField === "password"}
          onCopy={() => copy(password, "password")}
        />
      </div>

      <p
        className="sr-only text-right text-xs text-muted-foreground sm:not-sr-only sm:min-h-4 sm:max-w-56"
        role="status"
        aria-live="polite"
      >
        {copiedField ? `${FIELD_LABELS[copiedField]} copied.` : ""}
        {clearedField
          ? `${FIELD_LABELS[clearedField]} cleared from clipboard.`
          : ""}
        {copyFailed
          ? "Could not copy. Check your browser's clipboard permission."
          : ""}
      </p>
    </div>
  )
}

function CopyButton({
  field,
  justCopied,
  onCopy,
}: {
  field: CopyField
  justCopied: boolean
  onCopy(): void
}) {
  const Icon = justCopied ? Check : Copy

  return (
    <Button
      className="h-9 px-3 text-sm"
      type="button"
      variant="outline"
      aria-label={`Copy ${field}`}
      onClick={onCopy}
    >
      <Icon className="size-4" aria-hidden="true" />
      {FIELD_LABELS[field]}
    </Button>
  )
}
