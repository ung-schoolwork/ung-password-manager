"use client"

import { Check, Copy } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"

type CopyField = "username" | "password"

const FIELD_LABELS: Record<CopyField, string> = {
  username: "Username",
  password: "Password",
}

export function CredentialCopyActions({
  username,
  password,
}: {
  username: string
  password: string
}) {
  const [copiedField, setCopiedField] = useState<CopyField | null>(null)
  const [copyFailed, setCopyFailed] = useState(false)

  async function copy(value: string, field: CopyField) {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedField(field)
      setCopyFailed(false)
    } catch {
      setCopiedField(null)
      setCopyFailed(true)
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {/* Stacked on narrow screens so the credential text keeps its space. */}
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

      {/* Text is visible from the sm breakpoint up; below it, it is only
          announced to screen readers and the button icon shows the state. */}
      <p
        className="sr-only text-right text-xs text-muted-foreground sm:not-sr-only sm:min-h-4 sm:max-w-56"
        role="status"
        aria-live="polite"
      >
        {copiedField ? `${FIELD_LABELS[copiedField]} copied.` : ""}
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
