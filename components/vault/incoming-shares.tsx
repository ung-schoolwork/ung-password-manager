"use client"

import { useEffect, useState } from "react"
import { Eye, EyeOff, Inbox, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { CredentialCopyActions } from "@/components/vault/credential-copy-actions"
import {
  currentStatus,
  formatShareDate,
  ShareStatusBadge,
  useNow,
} from "@/components/vault/share-status"
import {
  readSharedCredential,
  removeShare,
  ShareRequestError,
  type IncomingShare,
} from "@/lib/sharing/client"
import type { ShareStatus } from "@/lib/sharing/status"
import type { CredentialDraft } from "@/lib/vault/types"

const ENDED_MESSAGES: Record<Exclude<ShareStatus, "active">, string> = {
  expired: "Your access to this shared credential has ended.",
  removed: "Your access to this shared credential was removed.",
}

export function IncomingShares({
  shares,
  listError,
  onChanged,
  onRemoved,
}: {
  shares: IncomingShare[]
  listError: string | null
  onChanged(): void
  onRemoved(id: string): void
}) {
  const now = useNow()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Open credentials, kept only in memory and only while the share is active.
  const [opened, setOpened] = useState<Record<string, CredentialDraft>>({})
  // Shares the server refused to open because access had ended, before the
  // next list refresh catches up.
  const [endedLocally, setEndedLocally] = useState<
    Record<string, Exclude<ShareStatus, "active">>
  >({})

  const statusOf = (share: IncomingShare): ShareStatus =>
    endedLocally[share.id] ?? currentStatus(share, now)

  // Forget an open credential as soon as its share stops being active.
  const staleIds = Object.keys(opened)
    .filter((id) => {
      const share = shares.find((item) => item.id === id)
      return !share || statusOf(share) !== "active"
    })
    .join(",")
  useEffect(() => {
    if (!staleIds) return
    const stale = staleIds.split(",")
    // eslint-disable-next-line react-hooks/set-state-in-effect -- forget credentials whose access ended
    setOpened((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id]) => !stale.includes(id))
      )
    )
  }, [staleIds])

  async function handleOpen(share: IncomingShare) {
    setBusyId(share.id)
    setError(null)
    try {
      const { credential } = await readSharedCredential(share.id)
      setOpened((current) => ({ ...current, [share.id]: credential }))
    } catch (caught) {
      if (caught instanceof ShareRequestError && caught.shareStatus) {
        const status = caught.shareStatus
        setEndedLocally((current) => ({ ...current, [share.id]: status }))
        onChanged()
      } else if (caught instanceof ShareRequestError && caught.status === 404) {
        onRemoved(share.id)
        onChanged()
      } else {
        setError("Could not open that credential. Try again.")
      }
    } finally {
      setBusyId(null)
    }
  }

  function handleHide(share: IncomingShare) {
    setOpened((current) => {
      const next = { ...current }
      delete next[share.id]
      return next
    })
  }

  async function handleRemove(share: IncomingShare) {
    setBusyId(share.id)
    setError(null)
    try {
      await removeShare(share.id)
      handleHide(share)
      onRemoved(share.id)
      onChanged()
    } catch (caught) {
      if (caught instanceof ShareRequestError && caught.status === 404) {
        onRemoved(share.id)
        onChanged()
      } else {
        setError("Could not remove that credential. Try again.")
      }
    } finally {
      setBusyId(null)
    }
  }

  const shownError = error ?? listError
  if (shares.length === 0 && !shownError) return null
  const activeCount = shares.filter(
    (share) => statusOf(share) === "active"
  ).length

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-lg">Shared with you</CardTitle>
        <CardDescription className="text-sm">
          {shownError
            ? shownError
            : `${activeCount} ${activeCount === 1 ? "credential" : "credentials"} available to you.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2" aria-label="Shared with you">
          {shares.map((share) => {
            const status = statusOf(share)
            const credential = status === "active" ? opened[share.id] : null
            const busy = busyId === share.id
            return (
              <li key={share.id}>
                <article
                  className="flex flex-col gap-3 rounded-lg border bg-muted/20 px-3 py-2.5"
                  aria-label={`${share.accountName} shared by ${share.fromEmail}`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border">
                        <Inbox className="size-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                          <span className="truncate">
                            {share.accountName}
                            {share.siteOrApp ? (
                              <span className="font-normal text-muted-foreground">
                                {" "}
                                · {share.siteOrApp}
                              </span>
                            ) : null}
                          </span>
                          <ShareStatusBadge status={status} />
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          Shared by {share.fromEmail}
                          {status === "active"
                            ? share.expiresAt
                              ? ` · Access ends ${formatShareDate(share.expiresAt)}`
                              : " · No end date"
                            : null}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {status === "active" ? (
                        <>
                          <Button
                            className="h-9 px-3 text-sm"
                            type="button"
                            variant="outline"
                            disabled={busy}
                            aria-label={`Remove ${share.accountName} shared by ${share.fromEmail}`}
                            onClick={() => handleRemove(share)}
                          >
                            <X className="size-4" aria-hidden="true" />
                            Remove
                          </Button>
                          {credential ? (
                            <Button
                              className="h-9 px-3 text-sm"
                              type="button"
                              variant="outline"
                              onClick={() => handleHide(share)}
                            >
                              <EyeOff className="size-4" aria-hidden="true" />
                              Hide
                            </Button>
                          ) : (
                            <Button
                              className="h-9 px-3 text-sm"
                              type="button"
                              disabled={busy}
                              aria-label={`Open ${share.accountName}`}
                              onClick={() => handleOpen(share)}
                            >
                              <Eye className="size-4" aria-hidden="true" />
                              Open
                            </Button>
                          )}
                        </>
                      ) : (
                        <Button
                          className="h-9 px-3 text-sm"
                          type="button"
                          variant="outline"
                          disabled={busy}
                          aria-label={`Clear ${share.accountName} shared by ${share.fromEmail}`}
                          onClick={() => handleRemove(share)}
                        >
                          <X className="size-4" aria-hidden="true" />
                          Clear
                        </Button>
                      )}
                    </div>
                  </div>
                  {status !== "active" ? (
                    <p className="text-sm text-muted-foreground" role="status">
                      {ENDED_MESSAGES[status]} Ask {share.fromEmail} to share it
                      again if you still need it.
                    </p>
                  ) : null}
                  {credential ? (
                    <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center">
                      <dl className="min-w-0 flex-1 text-xs text-muted-foreground">
                        <div className="flex min-w-0 gap-2">
                          <dt>Username</dt>
                          <dd className="truncate text-foreground">
                            {credential.username}
                          </dd>
                        </div>
                        {credential.notes ? (
                          <div className="mt-1 flex min-w-0 gap-2">
                            <dt>Notes</dt>
                            <dd className="break-words text-foreground">
                              {credential.notes}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                      <CredentialCopyActions
                        username={credential.username}
                        password={credential.password}
                      />
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
