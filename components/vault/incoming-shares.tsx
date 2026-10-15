"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, Inbox, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useVault } from "@/components/vault/vault-provider"
import {
  listIncomingShares,
  respondToShare,
  type IncomingShare,
} from "@/lib/sharing/client"

export function IncomingShares() {
  const { addCredential } = useVault()
  const [shares, setShares] = useState<IncomingShare[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setShares(await listIncomingShares())
      setError(null)
    } catch {
      setError("Could not check for shared credentials.")
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function handleAccept(share: IncomingShare) {
    setBusyId(share.id)
    try {
      await addCredential(share.credential)
      await respondToShare(share.id)
      setShares((current) => current.filter((item) => item.id !== share.id))
    } catch {
      setError("Could not accept that credential. Try again.")
    } finally {
      setBusyId(null)
    }
  }

  async function handleDecline(share: IncomingShare) {
    setBusyId(share.id)
    try {
      await respondToShare(share.id)
      setShares((current) => current.filter((item) => item.id !== share.id))
    } catch {
      setError("Could not decline that credential. Try again.")
    } finally {
      setBusyId(null)
    }
  }

  if (shares.length === 0 && !error) return null

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-lg">Shared with you</CardTitle>
        <CardDescription className="text-sm">
          {error
            ? error
            : `${shares.length} ${shares.length === 1 ? "credential" : "credentials"} waiting for your review.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2" aria-label="Shared with you">
          {shares.map((share) => (
            <li key={share.id}>
              <article className="flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border">
                  <Inbox className="size-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {share.credential.accountName}{" "}
                    <span className="font-normal text-muted-foreground">
                      · {share.credential.siteOrApp}
                    </span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    Shared by {share.fromEmail}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    className="h-9 px-3 text-sm"
                    type="button"
                    variant="outline"
                    disabled={busyId === share.id}
                    onClick={() => handleDecline(share)}
                  >
                    <X className="size-4" aria-hidden="true" />
                    Decline
                  </Button>
                  <Button
                    className="h-9 px-3 text-sm"
                    type="button"
                    disabled={busyId === share.id}
                    onClick={() => handleAccept(share)}
                  >
                    <Check className="size-4" aria-hidden="true" />
                    Accept
                  </Button>
                </div>
              </article>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}