"use client"

import { Check, Copy } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"

type CopyField = "username" | "password"

const FIELD_LABELS: Record<CopyField, string> = {
  username: "Username",
  password: "Password",
}

// How long a copied credential stays on the clipboard before it is
// cleared automatically (SCRUM-24). NEXT_PUBLIC_CLIPBOARD_CLEAR_MS lets the
// browser tests shorten the wait; the value is clamped so a typo or an
// out-of-range override cannot turn the clear off or fire it instantly.
const DEFAULT_CLEAR_AFTER_MS = 15_000
const MIN_CLEAR_AFTER_MS = 1_000
const MAX_CLEAR_AFTER_MS = 60_000

function clearAfterMs() {
  const configured = process.env.NEXT_PUBLIC_CLIPBOARD_CLEAR_MS?.trim()
  if (!configured) return DEFAULT_CLEAR_AFTER_MS

  const parsed = Number(configured)
  if (!Number.isFinite(parsed)) return DEFAULT_CLEAR_AFTER_MS

  return Math.min(Math.max(parsed, MIN_CLEAR_AFTER_MS), MAX_CLEAR_AFTER_MS)
}

const CLEAR_AFTER_MS = clearAfterMs()

// One pending auto-clear for the whole page (SCRUM-54). Locking the vault,
// signing out, opening Edit, or navigating away unmounts the copy buttons,
// so the timer lives outside React and survives that unmount. A later copy
// from any credential replaces the pending clear instead of racing it, so an
// older timer can never wipe a value the user copied afterwards.
let pendingClear: {
  timer: ReturnType<typeof setTimeout>
  value: string
  sequence: number
} | null = null
let copySequence = 0

function cancelPendingClear() {
  if (!pendingClear) return
  clearTimeout(pendingClear.timer)
  pendingClear = null
}

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

  async function copy(value: string, field: CopyField) {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      setCopiedField(null)
      setClearedField(null)
      setCopyFailed(true)
      return
    }

    // This copy owns the clipboard now: the previous pending clear is
    // dropped and its timer can no longer touch what we just wrote.
    cancelPendingClear()
    const sequence = ++copySequence
    setCopiedField(field)
    setClearedField(null)
    setCopyFailed(false)

    const timer = setTimeout(async () => {
      if (pendingClear?.sequence !== sequence) return

      // Only clear if the clipboard still holds what we copied — the
      // user may have copied something else in the meantime (SCRUM-24 AC).
      let stillOurs = true
      try {
        stillOurs = (await navigator.clipboard.readText()) === value
      } catch {
        // Some browsers block reads; clearing anyway is safer than
        // leaving a credential sitting in the clipboard.
      }

      // A copy may have landed while the clipboard was being read.
      if (pendingClear?.sequence !== sequence) return
      pendingClear = null

      if (stillOurs) {
        try {
          await navigator.clipboard.writeText("")
          // Swap the "copied" message for the "cleared" one. The buttons may
          // have unmounted by now, in which case these updates do nothing.
          setCopiedField(null)
          setClearedField(field)
        } catch {
          // Leave the "copied" message as-is if the clear itself fails.
        }
      }
    }, CLEAR_AFTER_MS)

    pendingClear = { timer, value, sequence }
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
