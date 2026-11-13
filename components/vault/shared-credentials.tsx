"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { IncomingShares } from "@/components/vault/incoming-shares"
import { OutgoingShares } from "@/components/vault/outgoing-shares"
import {
  listShares,
  onSharesChanged,
  type IncomingShare,
  type OutgoingShare,
} from "@/lib/sharing/client"

const REFRESH_INTERVAL_MS = 30_000

/** Credentials shared with this account, and the ones it has shared. */
export function SharedCredentials() {
  const [incoming, setIncoming] = useState<IncomingShare[]>([])
  const [outgoing, setOutgoing] = useState<OutgoingShare[]>([])
  const [error, setError] = useState<string | null>(null)
  // Bumped by every refresh and every change made here, so a list that was
  // requested earlier can't bring back a share the user has just handled.
  const refreshVersion = useRef(0)

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current
    try {
      const latest = await listShares()
      if (version === refreshVersion.current) {
        setIncoming(latest.incoming)
        setOutgoing(latest.outgoing)
        setError(null)
      }
    } catch {
      if (version === refreshVersion.current)
        setError("Could not check for shared credentials.")
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of shares on mount
    void refresh()
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    const onFocus = () => void refresh()
    window.addEventListener("focus", onFocus)
    const stopListening = onSharesChanged(() => void refresh())
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", onFocus)
      stopListening()
    }
  }, [refresh])

  const changed = useCallback(() => void refresh(), [refresh])

  return (
    <>
      <IncomingShares
        shares={incoming}
        listError={error}
        onChanged={changed}
        onRemoved={(id) =>
          setIncoming((current) => current.filter((share) => share.id !== id))
        }
      />
      <OutgoingShares
        shares={outgoing}
        onChanged={changed}
        onCleared={(id) =>
          setOutgoing((current) => current.filter((share) => share.id !== id))
        }
      />
    </>
  )
}
