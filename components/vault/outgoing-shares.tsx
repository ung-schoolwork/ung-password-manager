"use client"

import { useState } from "react"
import { Send, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  currentStatus,
  formatShareDate,
  ShareStatusBadge,
  useNow,
} from "@/components/vault/share-status"
import {
  removeShare,
  ShareRequestError,
  type OutgoingShare,
} from "@/lib/sharing/client"
import type { ShareStatus } from "@/lib/sharing/status"

function statusDetail(share: OutgoingShare, status: ShareStatus): string {
  if (status === "active")
    return share.expiresAt
      ? `Access ends ${formatShareDate(share.expiresAt)}`
      : "No end date"
  if (status === "expired")
    return `Access ended ${formatShareDate(share.expiresAt ?? share.createdAt)}`
  const when = share.endedAt ? ` ${formatShareDate(share.endedAt)}` : ""
  return share.removedBy === "recipient"
    ? `They removed it${when}`
    : `You removed access${when}`
}

/** Credentials this account has shared, with their access status. */
export function OutgoingShares({
  shares,
  onChanged,
  onCleared,
}: {
  shares: OutgoingShare[]
  onChanged(): void
  onCleared(id: string): void
}) {
  const now = useNow()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleRemove(share: OutgoingShare, ended: boolean) {
    setBusyId(share.id)
    setError(null)
    try {
      await removeShare(share.id)
      setConfirmingId(null)
      if (ended) onCleared(share.id)
      onChanged()
    } catch (caught) {
      if (caught instanceof ShareRequestError && caught.status === 404) {
        onCleared(share.id)
        onChanged()
      } else {
        setError(
          ended
            ? "Could not clear that share. Try again."
            : "Could not remove access. Try again."
        )
      }
    } finally {
      setBusyId(null)
    }
  }

  if (shares.length === 0) return null

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-lg">Shared by you</CardTitle>
        <CardDescription className="text-sm">
          {error ?? "People you've shared credentials with."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2" aria-label="Shared by you">
          {shares.map((share) => {
            const status = currentStatus(share, now)
            const busy = busyId === share.id
            const confirming = confirmingId === share.id && status === "active"
            return (
              <li key={share.id}>
                <article
                  className="flex flex-col gap-3 rounded-lg border bg-muted/20 px-3 py-2.5"
                  aria-label={`${share.accountName} shared with ${share.toEmail}`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border">
                        <Send className="size-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                          <span className="truncate">
                            {share.accountName}
                            <span className="font-normal text-muted-foreground">
                              {" "}
                              · {share.toEmail}
                            </span>
                          </span>
                          <ShareStatusBadge status={status} />
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {statusDetail(share, status)}
                        </p>
                      </div>
                    </div>
                    {confirming ? null : (
                      <div className="flex shrink-0 gap-2">
                        {status === "active" ? (
                          <Button
                            className="h-9 px-3 text-sm"
                            type="button"
                            variant="outline"
                            disabled={busy}
                            aria-label={`Remove access to ${share.accountName} for ${share.toEmail}`}
                            onClick={() => {
                              setError(null)
                              setConfirmingId(share.id)
                            }}
                          >
                            <X className="size-4" aria-hidden="true" />
                            Remove access
                          </Button>
                        ) : (
                          <Button
                            className="h-9 px-3 text-sm"
                            type="button"
                            variant="outline"
                            disabled={busy}
                            aria-label={`Clear ${share.accountName} shared with ${share.toEmail}`}
                            onClick={() => handleRemove(share, true)}
                          >
                            <X className="size-4" aria-hidden="true" />
                            Clear
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  {confirming ? (
                    <div
                      role="group"
                      aria-label={`Confirm removing access for ${share.toEmail}`}
                      className="space-y-2"
                    >
                      <p className="text-sm">
                        {share.toEmail} will no longer be able to see{" "}
                        {share.accountName}. If they already copied the
                        password, change it to be safe.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={busy}
                          onClick={() => handleRemove(share, false)}
                        >
                          Remove access
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy}
                          onClick={() => setConfirmingId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </article>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
