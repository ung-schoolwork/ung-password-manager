"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { Clock } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  ActivityThrottle,
  AUTO_LOCK_STORAGE_KEY,
  DEFAULT_AUTO_LOCK_MINUTES,
  InactivityTimer,
  isAutoLockMessage,
  parseAutoLockMinutes,
  type AutoLockMessage,
  type AutoLockMinutes,
} from "@/lib/vault/auto-lock"

const CHANNEL = "ung-password-manager:vault-activity"
const ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
] as const
/** Local activity is handled at most this often; pointer moves fire constantly. */
const LOCAL_ACTIVITY_INTERVAL_MS = 1_000
const WARNING_SELECTOR = "[data-auto-lock-warning]"

// The timeout preference: one value per browser, shared by its tabs.
const minuteListeners = new Set<() => void>()
/** A choice the browser refused to store still applies to this tab. */
let unsavedMinutes: AutoLockMinutes | null = null

function readAutoLockMinutes(): AutoLockMinutes {
  if (unsavedMinutes !== null) return unsavedMinutes
  try {
    return parseAutoLockMinutes(
      window.localStorage.getItem(AUTO_LOCK_STORAGE_KEY)
    )
  } catch {
    return DEFAULT_AUTO_LOCK_MINUTES
  }
}

function subscribeAutoLockMinutes(listener: () => void) {
  minuteListeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === AUTO_LOCK_STORAGE_KEY) listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    minuteListeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

export function useAutoLockMinutes(): AutoLockMinutes {
  return useSyncExternalStore(
    subscribeAutoLockMinutes,
    readAutoLockMinutes,
    () => DEFAULT_AUTO_LOCK_MINUTES
  )
}

/** Saves the timeout; returns false if this browser would not keep it. */
export function saveAutoLockMinutes(minutes: AutoLockMinutes): boolean {
  let saved = true
  try {
    window.localStorage.setItem(AUTO_LOCK_STORAGE_KEY, String(minutes))
    unsavedMinutes = null
  } catch {
    saved = false
    unsavedMinutes = minutes
  }
  minuteListeners.forEach((listener) => listener())
  return saved
}

/**
 * Locks the vault after the chosen time without activity in any of this
 * account's tabs, and locks every tab when one of them locks.
 */
export function useAutoLock({
  accountId,
  unlocked,
  onLock,
}: {
  accountId: string
  unlocked: boolean
  /** Locks this tab only. */
  onLock: () => void
}) {
  const minutes = useAutoLockMinutes()
  const [lockAt, setLockAt] = useState<number | null>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const timerRef = useRef<InactivityTimer | null>(null)
  const recordRef = useRef<() => void>(() => undefined)
  const onLockRef = useRef(onLock)
  const unlockedRef = useRef(unlocked)
  useEffect(() => {
    onLockRef.current = onLock
    unlockedRef.current = unlocked
  })

  const broadcastLock = useCallback(() => {
    const message: AutoLockMessage = { type: "lock", accountId }
    channelRef.current?.postMessage(message)
  }, [accountId])

  // Activity is tracked and shared even while this tab is locked: someone
  // using any tab of the account keeps the others open.
  useEffect(() => {
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(CHANNEL)
    channelRef.current = channel
    const throttle = new ActivityThrottle((at) => {
      const message: AutoLockMessage = { type: "activity", accountId, at }
      channel?.postMessage(message)
    })
    let lastLocal = Number.NEGATIVE_INFINITY

    const record = () => {
      const at = Date.now()
      if (at - lastLocal < LOCAL_ACTIVITY_INTERVAL_MS) return
      lastLocal = at
      timerRef.current?.recordActivity(at)
      throttle.record(at)
    }
    recordRef.current = record

    const onActivity = (event: Event) => {
      // Moving around inside the warning must not dismiss it before the user
      // reaches its buttons.
      if (
        event.target instanceof Element &&
        event.target.closest(WARNING_SELECTOR)
      )
        return
      record()
    }
    // Coming back to this window counts; focus moved by the page itself does not.
    const onWindowFocus = (event: FocusEvent) => {
      if (event.target === window) record()
    }
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return
      // Timers in hidden tabs may run late; catch up before counting this.
      timerRef.current?.check()
      record()
    }
    if (channel)
      channel.onmessage = (event: MessageEvent) => {
        const message: unknown = event.data
        if (!isAutoLockMessage(message) || message.accountId !== accountId)
          return
        if (message.type === "activity") {
          timerRef.current?.recordActivity(message.at)
        } else if (unlockedRef.current) {
          timerRef.current?.stop()
          timerRef.current = null
          onLockRef.current()
        }
      }

    for (const name of ACTIVITY_EVENTS)
      window.addEventListener(name, onActivity, {
        capture: true,
        passive: true,
      })
    window.addEventListener("focus", onWindowFocus)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.removeEventListener("focus", onWindowFocus)
      for (const name of ACTIVITY_EVENTS)
        window.removeEventListener(name, onActivity, { capture: true })
      document.removeEventListener("visibilitychange", onVisibility)
      throttle.stop()
      channel?.close()
      if (channelRef.current === channel) channelRef.current = null
      recordRef.current = () => undefined
    }
  }, [accountId])

  // Choosing a new timeout restarts the countdown.
  useEffect(() => {
    if (!unlocked) return
    const timer = new InactivityTimer({
      timeoutMs: minutes * 60_000,
      onWarning: setLockAt,
      onLock: () => {
        if (timerRef.current === timer) timerRef.current = null
        onLockRef.current()
        broadcastLock()
      },
    })
    timerRef.current = timer
    return () => {
      timer.stop()
      if (timerRef.current === timer) timerRef.current = null
    }
  }, [unlocked, minutes, broadcastLock])

  const stayUnlocked = useCallback(() => {
    const at = Date.now()
    timerRef.current?.recordActivity(at)
    recordRef.current()
  }, [])

  return { lockAt: unlocked ? lockAt : null, stayUnlocked, broadcastLock }
}

function secondsUntil(lockAt: number) {
  return Math.max(0, Math.ceil((lockAt - Date.now()) / 1000))
}

function describeSeconds(seconds: number) {
  if (seconds >= 60 && seconds % 60 === 0) {
    const minutes = seconds / 60
    return minutes === 1 ? "1 minute" : `${minutes} minutes`
  }
  return seconds === 1 ? "1 second" : `${seconds} seconds`
}

/** Shown shortly before the vault locks itself. */
export function AutoLockWarning({
  lockAt,
  onStay,
  onLockNow,
}: {
  lockAt: number
  onStay: () => void
  onLockNow: () => void
}) {
  const [seconds, setSeconds] = useState(() => secondsUntil(lockAt))
  const stayButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const timer = setInterval(() => setSeconds(secondsUntil(lockAt)), 1000)
    return () => clearInterval(timer)
  }, [lockAt])

  // Move focus to the warning so it is announced, and put it back afterwards.
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    stayButton.current?.focus()
    return () => {
      const active = document.activeElement
      if (
        previous?.isConnected &&
        (!active ||
          active === document.body ||
          active.closest(WARNING_SELECTOR))
      )
        previous.focus()
    }
  }, [])

  return (
    <div
      data-auto-lock-warning=""
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="auto-lock-warning-title"
      aria-describedby="auto-lock-warning-description"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-xl border bg-background p-4 shadow-2xl shadow-foreground/10"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          onStay()
        }
      }}
    >
      <div className="flex gap-3">
        <Clock
          className="mt-0.5 size-5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <h2 id="auto-lock-warning-title" className="text-sm font-medium">
              Your vault is about to lock
            </h2>
            <p
              id="auto-lock-warning-description"
              className="text-sm text-muted-foreground"
            >
              There has been no activity for a while. Your vault will lock in{" "}
              {describeSeconds(seconds)}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              ref={stayButton}
              type="button"
              className="h-9 px-3 text-sm"
              onClick={onStay}
            >
              Stay unlocked
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9 px-3 text-sm"
              onClick={onLockNow}
            >
              Lock now
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
