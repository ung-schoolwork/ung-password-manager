"use client"

import { useState } from "react"
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
import { copyWithAutoClear } from "@/lib/vault/clipboard"

export function GeneratorWorkspace() {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)

  async function copyPassword(password: string) {
    setCopyError(null)

    try {
      await copyWithAutoClear(password)
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
            Adjust the length and character types to see a new password straight
            away.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordGeneratorPanel
            renderActions={(password) => (
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
                  {copied ? "Copied" : "Copy password"}
                </Button>
                <p
                  className="min-h-4 text-xs text-muted-foreground"
                  aria-live="polite"
                >
                  {copyError}
                </p>
              </div>
            )}
          />
        </CardContent>
      </Card>
    </div>
  )
}
