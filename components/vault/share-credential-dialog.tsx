"use client"

import { useState } from "react"
import { CheckCircle2, Share2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { shareCredential, ShareRequestError } from "@/lib/sharing/client"
import type { Credential } from "@/lib/vault/types"

export function ShareCredentialDialog({
  credential,
  open,
  onOpenChange,
}: {
  credential: Credential
  open: boolean
  onOpenChange(open: boolean): void
}) {
  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setEmail("")
      setError(null)
      setDone(false)
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await shareCredential(email.trim(), {
        accountName: credential.accountName,
        siteOrApp: credential.siteOrApp,
        username: credential.username,
        password: credential.password,
        notes: credential.notes,
      })
      setDone(true)
    } catch (caught) {
      setError(
        caught instanceof ShareRequestError
          ? caught.message
          : "Something went wrong. Try again."
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle>Credential shared</DialogTitle>
              <DialogDescription>
                {credential.accountName} was shared with {email.trim()}.
                They&apos;ll see it waiting for them the next time they open
                their vault.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Share {credential.accountName}</DialogTitle>
              <DialogDescription>
                The recipient must already have an account. They&apos;ll see
                this credential waiting for them in their vault — it&apos;s
                never sent by text or email.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-2">
              <Label htmlFor="share-recipient-email">
                Recipient&apos;s email
              </Label>
              <Input
                id="share-recipient-email"
                type="email"
                required
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="teammate@example.com"
              />
            </div>

            {error ? (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !email.trim()}>
                <Share2 className="size-4" aria-hidden="true" />
                {submitting ? "Sharing…" : "Share"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}