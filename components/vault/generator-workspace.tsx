"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PasswordGeneratorPanel } from "@/components/vault/password-generator-panel"
import { copyWithAutoClear, onClipboardClear } from "@/lib/vault/clipboard"
import { clipboardClearMessage } from "@/lib/vault/clipboard-messages"

export function GeneratorWorkspace() {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [clearNotice, setClearNotice] = useState<string | null>(null)
  // The last copy made here, so a clear message only shows for a copy of ours.
  const lastCopyIdRef = useRef<number | null>(null)

  useEffect(
    () =>
      onClipboardClear((copyId, result) => {
        if (lastCopyIdRef.current !== copyId) return
        lastCopyIdRef.current = null
        setClearNotice(clipboardClearMessage("Password", result))
      }),
    []
  )

  async function copyPassword(password: string) {
    setCopyError(null)
    setClearNotice(null)

    try {
      lastCopyIdRef.current = await copyWithAutoClear(password)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyError("Your browser blocked copying. Select the password instead.")
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Password generator</CardTitle>
          <CardDescription className="text-sm">
            Choose a password or a passphrase of random words, then adjust the
            options to see a new one straight away.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordGeneratorPanel
            renderActions={(password, kind) => (
              <div className="space-y-2">
                <Button
                  className="h-10 w-full text-sm"
                  type="button"
                  variant="secondary"
                  disabled={!password}
                  onClick={() => void copyPassword(password)}
                >
                  {copied ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : (
                    <Copy className="size-4" aria-hidden="true" />
                  )}
                  {copied ? "Copied" : `Copy ${kind}`}
                </Button>
                <p
                  className="min-h-4 text-xs text-muted-foreground"
                  aria-live="polite"
                >
                  {copyError ?? clearNotice}
                </p>
              </div>
            )}
          />
        </CardContent>
      </Card>
    </div>
  )
}
