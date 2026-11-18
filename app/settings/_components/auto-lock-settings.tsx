"use client"

import { useState } from "react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  saveAutoLockMinutes,
  useAutoLockMinutes,
} from "@/components/vault/auto-lock"
import {
  AUTO_LOCK_MINUTE_OPTIONS,
  formatAutoLockMinutes,
  parseAutoLockMinutes,
} from "@/lib/vault/auto-lock"

export function AutoLockSettings() {
  const minutes = useAutoLockMinutes()
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Automatic lock</CardTitle>
        <CardDescription className="text-sm">
          Your vault locks itself when you have not used it for a while. You
          will see a warning first and can choose to stay unlocked.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="auto-lock-minutes">Lock after no activity for</Label>
          <select
            id="auto-lock-minutes"
            aria-describedby="auto-lock-minutes-help"
            className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            value={minutes}
            onChange={(event) => {
              const next = parseAutoLockMinutes(event.target.value)
              if (saveAutoLockMinutes(next)) {
                setError(null)
                setNotice(
                  `Your vault now locks after ${formatAutoLockMinutes(next)} without activity.`
                )
              } else {
                setNotice(null)
                setError(
                  "This browser could not save your choice. It applies until you close this tab."
                )
              }
            }}
          >
            {AUTO_LOCK_MINUTE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {formatAutoLockMinutes(option)}
              </option>
            ))}
          </select>
          <p
            id="auto-lock-minutes-help"
            className="text-xs text-muted-foreground"
          >
            This applies to every tab in this browser. Activity in any tab keeps
            your vault open, and locking one tab locks them all.
          </p>
        </div>

        {notice ? (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
