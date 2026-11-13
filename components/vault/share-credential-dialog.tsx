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
import { formatShareDate } from "@/components/vault/share-status"
import {
  notifySharesChanged,
  shareCredential,
  ShareRequestError,
} from "@/lib/sharing/client"
import {
  MAX_SHARE_DURATION_MS,
  MIN_SHARE_DURATION_MS,
  parseLocalDateTime,
  presetExpiry,
  SHARE_DURATION_PRESETS,
  toLocalDateTimeValue,
  type ShareDurationPresetId,
} from "@/lib/sharing/status"
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
  const [duration, setDuration] = useState<ShareDurationPresetId>("none")
  const [customEnd, setCustomEnd] = useState("")
  // The range the date picker offers, set when "custom" is chosen.
  const [customRange, setCustomRange] = useState({ min: "", max: "" })
  const [sharedUntil, setSharedUntil] = useState<Date | null>(null)

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setEmail("")
      setError(null)
      setDone(false)
      setDuration("none")
      setCustomEnd("")
      setSharedUntil(null)
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    let expiresAt: Date | null
    if (duration === "custom") {
      expiresAt = parseLocalDateTime(customEnd)
      const remaining = expiresAt ? expiresAt.getTime() - Date.now() : 0
      if (!expiresAt) {
        setError("Choose when access should end.")
        return
      }
      if (remaining < MIN_SHARE_DURATION_MS) {
        setError("Choose an end date in the future.")
        return
      }
      if (remaining > MAX_SHARE_DURATION_MS) {
        setError("Choose an end date within one year.")
        return
      }
    } else {
      expiresAt = presetExpiry(duration)
    }
    setSubmitting(true)
    try {
      await shareCredential(
        email.trim(),
        {
          accountName: credential.accountName,
          siteOrApp: credential.siteOrApp,
          username: credential.username,
          password: credential.password,
          notes: credential.notes,
        },
        expiresAt
      )
      setSharedUntil(expiresAt)
      setDone(true)
      notifySharesChanged()
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
                They&apos;ll see it the next time they open their vault.{" "}
                {sharedUntil
                  ? `Their access ends ${formatShareDate(sharedUntil)}.`
                  : "They keep access until you remove it."}{" "}
                You can remove access at any time under Shared by you.
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
                this credential in their vault — it&apos;s never sent by text or
                email.
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

            <div className="mt-4 space-y-2">
              <Label htmlFor="share-duration">Access ends</Label>
              <select
                id="share-duration"
                className="h-7 w-full min-w-0 rounded-md border border-input bg-input/20 px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 md:text-xs/relaxed dark:bg-input/30"
                value={duration}
                onChange={(event) => {
                  const next = event.target.value as ShareDurationPresetId
                  setDuration(next)
                  if (next !== "custom") return
                  const now = Date.now()
                  setCustomRange({
                    min: toLocalDateTimeValue(new Date(now)),
                    max: toLocalDateTimeValue(
                      new Date(now + MAX_SHARE_DURATION_MS)
                    ),
                  })
                  if (!customEnd)
                    setCustomEnd(
                      toLocalDateTimeValue(new Date(now + 24 * 60 * 60 * 1000))
                    )
                }}
              >
                {SHARE_DURATION_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.id === "none"
                      ? preset.label
                      : `After ${preset.label}`}
                  </option>
                ))}
                <option value="custom">On a date I choose</option>
              </select>
              {duration === "custom" ? (
                <>
                  <Label htmlFor="share-custom-end" className="sr-only">
                    End date and time
                  </Label>
                  <Input
                    id="share-custom-end"
                    type="datetime-local"
                    required
                    min={customRange.min}
                    max={customRange.max}
                    value={customEnd}
                    onChange={(event) => setCustomEnd(event.target.value)}
                  />
                </>
              ) : null}
              <p className="text-xs text-muted-foreground">
                You can also remove access yourself at any time.
              </p>
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
