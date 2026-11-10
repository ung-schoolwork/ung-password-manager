// Locks the vault after a stretch without activity (SCRUM-60). Everything here
// is free of React and browser globals so it can be unit tested with a fake
// clock; components/vault/auto-lock.tsx wires it to the page.

export const AUTO_LOCK_MINUTE_OPTIONS = [1, 5, 15, 30, 60] as const
export type AutoLockMinutes = (typeof AUTO_LOCK_MINUTE_OPTIONS)[number]
export const DEFAULT_AUTO_LOCK_MINUTES: AutoLockMinutes = 15

/** The timeout is a per-browser preference, so it lives in localStorage. */
export const AUTO_LOCK_STORAGE_KEY = "ung-password-manager:auto-lock-minutes"

/** How long before locking the warning appears. */
export const MAX_WARNING_MS = 60_000

/** Activity is shared with other tabs at most this often (plus one trailing message). */
export const ACTIVITY_BROADCAST_INTERVAL_MS = 5_000

export function parseAutoLockMinutes(
  value: string | null | undefined
): AutoLockMinutes {
  const parsed = Number(value)
  return (AUTO_LOCK_MINUTE_OPTIONS as readonly number[]).includes(parsed)
    ? (parsed as AutoLockMinutes)
    : DEFAULT_AUTO_LOCK_MINUTES
}

/** The warning gets a minute, or a quarter of very short timeouts. */
export function warningLeadMs(timeoutMs: number): number {
  return Math.min(MAX_WARNING_MS, Math.floor(timeoutMs / 4))
}

export function formatAutoLockMinutes(minutes: number): string {
  if (minutes === 60) return "1 hour"
  return minutes === 1 ? "1 minute" : `${minutes} minutes`
}

/** Messages shared between tabs of the same account. */
export type AutoLockMessage =
  | { type: "activity"; accountId: string; at: number }
  | { type: "lock"; accountId: string }

export function isAutoLockMessage(value: unknown): value is AutoLockMessage {
  if (!value || typeof value !== "object") return false
  const message = value as Record<string, unknown>
  if (typeof message.accountId !== "string") return false
  if (message.type === "lock") return true
  return (
    message.type === "activity" &&
    typeof message.at === "number" &&
    Number.isFinite(message.at)
  )
}

export interface Clock {
  now(): number
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export interface InactivityTimerOptions {
  timeoutMs: number
  clock?: Clock
  /** Called with the lock time when the warning appears, and null when it goes away. */
  onWarning(lockAt: number | null): void
  onLock(): void
}

/**
 * Tracks the last activity and fires a warning, then a lock. Deadlines are
 * recomputed from the clock on every wake-up, so a timer delayed by a
 * sleeping laptop or a throttled background tab locks as soon as it runs.
 */
export class InactivityTimer {
  private readonly clock: Clock
  private readonly timeoutMs: number
  private lastActivity: number
  private handle: unknown = null
  private warningAt: number | null = null
  private stopped = false

  constructor(private readonly options: InactivityTimerOptions) {
    this.clock = options.clock ?? systemClock
    this.timeoutMs = options.timeoutMs
    this.lastActivity = this.clock.now()
    this.schedule()
  }

  /** Records activity at `at` (defaults to now); older activity is ignored. */
  recordActivity(at: number = this.clock.now()) {
    if (this.stopped || at <= this.lastActivity) return
    this.lastActivity = Math.min(at, this.clock.now())
    this.schedule()
  }

  /** Re-checks the deadlines, e.g. when a hidden tab becomes visible again. */
  check() {
    if (!this.stopped) this.schedule()
  }

  stop() {
    this.stopped = true
    this.clear()
    this.setWarning(null)
  }

  private clear() {
    if (this.handle !== null) this.clock.clearTimeout(this.handle)
    this.handle = null
  }

  private setWarning(lockAt: number | null) {
    if (lockAt === this.warningAt) return
    this.warningAt = lockAt
    this.options.onWarning(lockAt)
  }

  private schedule() {
    this.clear()
    const now = this.clock.now()
    const lockAt = this.lastActivity + this.timeoutMs
    const warnAt = lockAt - warningLeadMs(this.timeoutMs)

    if (now >= lockAt) {
      this.stop()
      this.options.onLock()
      return
    }
    if (now >= warnAt) {
      this.setWarning(lockAt)
      this.handle = this.clock.setTimeout(() => this.schedule(), lockAt - now)
      return
    }
    this.setWarning(null)
    this.handle = this.clock.setTimeout(() => this.schedule(), warnAt - now)
  }
}

/**
 * Sends at most one message per interval: the first activity goes out at
 * once, and later activity in the same interval goes out once at its end, so
 * other tabs never see an older last-activity time than this tab has.
 */
export class ActivityThrottle {
  private readonly clock: Clock
  private lastSent = Number.NEGATIVE_INFINITY
  private pending: number | null = null
  private handle: unknown = null

  constructor(
    private readonly send: (at: number) => void,
    private readonly intervalMs = ACTIVITY_BROADCAST_INTERVAL_MS,
    clock: Clock = systemClock
  ) {
    this.clock = clock
  }

  record(at: number = this.clock.now()) {
    const now = this.clock.now()
    if (now - this.lastSent >= this.intervalMs) {
      this.lastSent = now
      this.send(at)
      return
    }
    this.pending = at
    if (this.handle !== null) return
    this.handle = this.clock.setTimeout(
      () => {
        this.handle = null
        if (this.pending === null) return
        const latest = this.pending
        this.pending = null
        this.lastSent = this.clock.now()
        this.send(latest)
      },
      this.lastSent + this.intervalMs - now
    )
  }

  stop() {
    if (this.handle !== null) this.clock.clearTimeout(this.handle)
    this.handle = null
    this.pending = null
  }
}
