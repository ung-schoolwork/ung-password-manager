"use client"

import { Check, Copy } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { copyWithAutoClear, onClipboardClear } from "@/lib/vault/clipboard"
import { clipboardClearMessage } from "@/lib/vault/clipboard-messages"

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
  const [clearMessageText, setClearMessageText] = useState<string | null>(
    null
  )
  const [copyFailed, setCopyFailed] = useState(false)
  // The last copy made from these buttons, so a clear message only shows for
  // a copy of ours.
  const lastCopyRef = useRef<{ id: number; field: CopyField } | null>(null)

  // Swap the "copied" message for how the clear went. The pending clear never
  // holds a callback from here (it would keep this component's props, the
  // password included, alive after unmount); we listen instead, and stop
  // when the buttons unmount.
  useEffect(
    () =>
      onClipboardClear((copyId, result) => {
        const lastCopy = lastCopyRef.current
        if (lastCopy?.id !== copyId) return
        lastCopyRef.current = null
        setCopiedField(null)
        setClearMessageText(
          clipboardClearMessage(FIELD_LABELS[lastCopy.field], result)
        )
      }),
    []
  )

  async function copy(value: string, field: CopyField) {
    try {
      lastCopyRef.current = { id: await copyWithAutoClear(value), field }
    } catch {
      setCopiedField(null)
      setClearMessageText(null)
      setCopyFailed(true)
      return
    }

    setCopiedField(field)
    setClearMessageText(null)
    setCopyFailed(false)
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
        {clearMessageText ?? ""}
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
