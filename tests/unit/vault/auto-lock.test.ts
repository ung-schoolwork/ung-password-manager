import { describe, expect, it } from "bun:test"

import {
  ActivityThrottle,
  DEFAULT_AUTO_LOCK_MINUTES,
  InactivityTimer,
  isAutoLockMessage,
  parseAutoLockMinutes,
  warningLeadMs,
  type Clock,
} from "../../../lib/vault/auto-lock"

/** A clock whose time only moves when a test advances it. */
class FakeClock implements Clock {
  time = 1_000_000
  private nextId = 0
  private timers = new Map<number, { at: number; callback: () => void }>()

  now = () => this.time

  setTimeout = (callback: () => void, ms: number) => {
    const id = ++this.nextId
    this.timers.set(id, { at: this.time + Math.max(0, ms), callback })
    return id
  }

  clearTimeout = (handle: unknown) => {
    this.timers.delete(handle as number)
  }

  /** Moves time forward, firing due timers in order. */
  advance(ms: number) {
    const end = this.time + ms
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      this.timers.delete(due[0])
      this.time = due[1].at
      due[1].callback()
    }
    this.time = end
  }

  /** Jumps forward without firing anything, like a sleeping laptop. */
  sleep(ms: number) {
    this.time += ms
  }

  pending() {
    return this.timers.size
  }
}

const MINUTE = 60_000

function timer(clock: FakeClock, timeoutMs = 15 * MINUTE) {
  const events: Array<string> = []
  const instance = new InactivityTimer({
    timeoutMs,
    clock,
    onWarning: (lockAt) =>
      events.push(lockAt === null ? "warning-cleared" : `warning:${lockAt}`),
    onLock: () => events.push("lock"),
  })
  return { instance, events }
}

describe("parseAutoLockMinutes", () => {
  it("defaults to 15 minutes", () => {
    expect(DEFAULT_AUTO_LOCK_MINUTES).toBe(15)
    expect(parseAutoLockMinutes(null)).toBe(15)
    expect(parseAutoLockMinutes(undefined)).toBe(15)
  })

  it("accepts only the offered choices", () => {
    expect(parseAutoLockMinutes("30")).toBe(30)
    expect(parseAutoLockMinutes("1")).toBe(1)
    for (const value of ["0", "-5", "7", "abc", "", "Infinity", "15.5"])
      expect(parseAutoLockMinutes(value)).toBe(15)
  })
})

describe("warningLeadMs", () => {
  it("warns a minute ahead, or a quarter of short timeouts", () => {
    expect(warningLeadMs(15 * MINUTE)).toBe(MINUTE)
    expect(warningLeadMs(MINUTE)).toBe(15_000)
  })
})

describe("InactivityTimer", () => {
  it("warns a minute before locking after 15 idle minutes", () => {
    const clock = new FakeClock()
    const start = clock.time
    const { events } = timer(clock)

    clock.advance(14 * MINUTE - 1)
    expect(events).toEqual([])
    clock.advance(1)
    expect(events).toEqual([`warning:${start + 15 * MINUTE}`])
    clock.advance(MINUTE - 1)
    expect(events).toHaveLength(1)
    clock.advance(1)
    expect(events).toEqual([
      `warning:${start + 15 * MINUTE}`,
      "warning-cleared",
      "lock",
    ])
    expect(clock.pending()).toBe(0)
  })

  it("restarts the countdown on activity and clears a shown warning", () => {
    const clock = new FakeClock()
    const { instance, events } = timer(clock)

    clock.advance(14.5 * MINUTE)
    expect(events).toHaveLength(1)
    instance.recordActivity()
    expect(events.at(-1)).toBe("warning-cleared")

    clock.advance(14 * MINUTE)
    expect(events).not.toContain("lock")
    clock.advance(MINUTE)
    expect(events.at(-1)).toBe("lock")
  })

  it("ignores activity older than what it already knows", () => {
    const clock = new FakeClock()
    const { instance, events } = timer(clock)

    clock.advance(10 * MINUTE)
    instance.recordActivity(clock.time - 11 * MINUTE)
    clock.advance(5 * MINUTE)
    expect(events.at(-1)).toBe("lock")
  })

  it("never treats activity reported from the future as later than now", () => {
    const clock = new FakeClock()
    const { instance, events } = timer(clock)

    instance.recordActivity(clock.time + 60 * MINUTE)
    clock.advance(15 * MINUTE)
    expect(events.at(-1)).toBe("lock")
  })

  it("locks at once when it wakes up after the deadline", () => {
    const clock = new FakeClock()
    const { instance, events } = timer(clock)

    clock.sleep(20 * MINUTE)
    instance.check()
    expect(events).toEqual(["lock"])
  })

  it("does nothing after it is stopped", () => {
    const clock = new FakeClock()
    const { instance, events } = timer(clock)

    instance.stop()
    instance.recordActivity()
    clock.advance(60 * MINUTE)
    expect(events).toEqual([])
    expect(clock.pending()).toBe(0)
  })
})

describe("ActivityThrottle", () => {
  it("sends the first activity at once and the latest one at the end of the interval", () => {
    const clock = new FakeClock()
    const sent: number[] = []
    const throttle = new ActivityThrottle((at) => sent.push(at), 5_000, clock)
    const start = clock.time

    throttle.record()
    expect(sent).toEqual([start])

    for (let step = 0; step < 4; step++) {
      clock.advance(1_000)
      throttle.record()
    }
    expect(sent).toHaveLength(1)

    clock.advance(1_000)
    expect(sent).toEqual([start, start + 4_000])

    clock.advance(10_000)
    expect(sent).toHaveLength(2)
  })

  it("sends at most one message per interval under constant activity", () => {
    const clock = new FakeClock()
    const sent: number[] = []
    const throttle = new ActivityThrottle((at) => sent.push(at), 5_000, clock)

    for (let step = 0; step < 600; step++) {
      throttle.record()
      clock.advance(100)
    }
    // 60 seconds of activity: one message per 5 seconds.
    expect(sent.length).toBeLessThanOrEqual(13)
    expect(sent.length).toBeGreaterThanOrEqual(12)
  })

  it("drops a pending message when stopped", () => {
    const clock = new FakeClock()
    const sent: number[] = []
    const throttle = new ActivityThrottle((at) => sent.push(at), 5_000, clock)

    throttle.record()
    clock.advance(1_000)
    throttle.record()
    throttle.stop()
    clock.advance(10_000)
    expect(sent).toHaveLength(1)
  })
})

describe("isAutoLockMessage", () => {
  it("accepts activity and lock messages only", () => {
    expect(isAutoLockMessage({ type: "lock", accountId: "a" })).toBe(true)
    expect(isAutoLockMessage({ type: "activity", accountId: "a", at: 5 })).toBe(
      true
    )
    expect(isAutoLockMessage({ type: "activity", accountId: "a" })).toBe(false)
    expect(
      isAutoLockMessage({ type: "activity", accountId: "a", at: NaN })
    ).toBe(false)
    expect(isAutoLockMessage({ type: "lock" })).toBe(false)
    expect(isAutoLockMessage("signed-out")).toBe(false)
    expect(isAutoLockMessage(null)).toBe(false)
  })
})
