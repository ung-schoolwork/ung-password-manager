"use client"

import { useEffect, useState } from "react"

import type { ShareStatus } from "@/lib/sharing/status"
import { cn } from "@/lib/utils"

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

export function formatShareDate(value: string | Date): string {
  return dateFormat.format(typeof value === "string" ? new Date(value) : value)
}

/**
 * The share's status as of now. A share the server last reported as active
 * reads as expired once its end date passes, until the next refresh.
 */
export function currentStatus(
  share: { status: ShareStatus; expiresAt: string | null },
  now: number
): ShareStatus {
  if (
    share.status === "active" &&
    share.expiresAt &&
    new Date(share.expiresAt).getTime() <= now
  )
    return "expired"
  return share.status
}

/** The current time, updated every few seconds while mounted. */
export function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

const STATUS_LABELS: Record<ShareStatus, string> = {
  active: "Active",
  expired: "Expired",
  removed: "Removed",
}

export function ShareStatusBadge({ status }: { status: ShareStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1",
        status === "active" &&
          "bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300",
        status === "expired" &&
          "bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:text-amber-300",
        status === "removed" && "bg-muted text-muted-foreground ring-border"
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}
