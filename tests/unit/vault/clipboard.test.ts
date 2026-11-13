import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import {
  type ClipboardClearResult,
  copyWithAutoClear,
  onClipboardClear,
} from "../../../lib/vault/clipboard"
import { clipboardClearMessage } from "../../../lib/vault/clipboard-messages"

// A stand-in clipboard whose reads and writes can be made to fail, as when the
// browser denies permission or the tab loses focus.
const clipboard = {
  text: "",
  denyRead: false,
  denyWrite: false,
  async readText() {
    if (this.denyRead) throw new DOMException("Read denied", "NotAllowedError")
    return this.text
  },
  async writeText(value: string) {
    if (this.denyWrite) {
      throw new DOMException("Write denied", "NotAllowedError")
    }
    this.text = value
  },
}
Object.defineProperty(globalThis.navigator, "clipboard", {
  value: clipboard,
  configurable: true,
})

// Captures the auto-clear timers so tests decide when each one fires.
type Timer = { callback: () => Promise<void> | void; cancelled: boolean }
let timers: Timer[] = []
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout

const results: Array<[number, ClipboardClearResult]> = []
let stopListening: () => void = () => {}

beforeEach(() => {
  clipboard.text = ""
  clipboard.denyRead = false
  clipboard.denyWrite = false
  timers = []
  results.length = 0
  globalThis.setTimeout = ((callback: () => void) => {
    const timer: Timer = { callback, cancelled: false }
    timers.push(timer)
    return timer
  }) as unknown as typeof setTimeout
  globalThis.clearTimeout = ((timer: Timer | undefined) => {
    if (timer) timer.cancelled = true
  }) as unknown as typeof clearTimeout
  stopListening = onClipboardClear((copyId, result) => {
    results.push([copyId, result])
  })
})

afterEach(() => {
  stopListening()
  globalThis.setTimeout = realSetTimeout
  globalThis.clearTimeout = realClearTimeout
})

async function fire(timer: Timer | undefined) {
  if (!timer) throw new Error("No auto-clear was scheduled")
  if (!timer.cancelled) await timer.callback()
}

describe("copyWithAutoClear", () => {
  it("clears the clipboard when it still holds the copy", async () => {
    const copyId = await copyWithAutoClear("secret-one")
    expect(clipboard.text).toBe("secret-one")

    await fire(timers.at(-1))

    expect(clipboard.text).toBe("")
    expect(results).toEqual([[copyId, "cleared"]])
  })

  it("leaves unrelated content alone and reports nothing", async () => {
    await copyWithAutoClear("secret-one")
    clipboard.text = "something the user copied elsewhere"

    await fire(timers.at(-1))

    expect(clipboard.text).toBe("something the user copied elsewhere")
    expect(results).toEqual([])
  })

  it("never lets an older timer clear a newer copy", async () => {
    const first = await copyWithAutoClear("secret-one")
    const firstTimer = timers.at(-1)
    const second = await copyWithAutoClear("secret-two")
    const secondTimer = timers.at(-1)

    expect(firstTimer?.cancelled).toBe(true)
    // Even if the stale callback still runs, it must not touch the clipboard.
    await firstTimer?.callback()
    expect(clipboard.text).toBe("secret-two")
    expect(results).toEqual([])

    await fire(secondTimer)
    expect(clipboard.text).toBe("")
    expect(results).toEqual([[second, "cleared"]])
    expect(first).not.toBe(second)
  })

  it("clears anyway and says so when reading the clipboard is denied", async () => {
    const copyId = await copyWithAutoClear("secret-one")
    clipboard.denyRead = true

    await fire(timers.at(-1))

    expect(clipboard.text).toBe("")
    expect(results).toEqual([[copyId, "cleared-unchecked"]])
  })

  it("clears without reading when clipboard reads would ask the user", async () => {
    let reads = 0
    const readText = clipboard.readText
    clipboard.readText = async function () {
      reads += 1
      return readText.call(this)
    }
    Object.defineProperty(globalThis.navigator, "permissions", {
      value: { query: async () => ({ state: "prompt" }) },
      configurable: true,
    })
    try {
      const copyId = await copyWithAutoClear("secret-one")

      await fire(timers.at(-1))

      expect(reads).toBe(0)
      expect(clipboard.text).toBe("")
      expect(results).toEqual([[copyId, "cleared-unchecked"]])
    } finally {
      clipboard.readText = readText
      Reflect.deleteProperty(globalThis.navigator, "permissions")
    }
  })

  it("checks the clipboard when reads are already granted", async () => {
    Object.defineProperty(globalThis.navigator, "permissions", {
      value: { query: async () => ({ state: "granted" }) },
      configurable: true,
    })
    try {
      await copyWithAutoClear("secret-one")
      clipboard.text = "something the user copied elsewhere"

      await fire(timers.at(-1))

      expect(clipboard.text).toBe("something the user copied elsewhere")
      expect(results).toEqual([])
    } finally {
      Reflect.deleteProperty(globalThis.navigator, "permissions")
    }
  })

  it("reports when the clear itself fails", async () => {
    const copyId = await copyWithAutoClear("secret-one")
    clipboard.denyWrite = true

    await fire(timers.at(-1))

    expect(clipboard.text).toBe("secret-one")
    expect(results).toEqual([[copyId, "clear-failed"]])
  })

  it("reports a failed clear when both reading and clearing are denied", async () => {
    const copyId = await copyWithAutoClear("secret-one")
    clipboard.denyRead = true
    clipboard.denyWrite = true

    await fire(timers.at(-1))

    expect(results).toEqual([[copyId, "clear-failed"]])
  })

  it("stops notifying a listener once it unsubscribes", async () => {
    stopListening()
    await copyWithAutoClear("secret-one")

    await fire(timers.at(-1))

    expect(clipboard.text).toBe("")
    expect(results).toEqual([])
  })

  it("rejects when the browser refuses the copy", async () => {
    clipboard.denyWrite = true

    await expect(copyWithAutoClear("secret-one")).rejects.toThrow()
    expect(timers).toEqual([])
  })
})

describe("clipboardClearMessage", () => {
  it("describes each outcome to the user", () => {
    expect(clipboardClearMessage("Password", "cleared")).toBe(
      "Password cleared from clipboard."
    )
    expect(clipboardClearMessage("Username", "cleared-unchecked")).toContain(
      "anything you copied since was cleared too"
    )
    expect(clipboardClearMessage("Password", "clear-failed")).toBe(
      "Couldn't clear the password from your clipboard. Copy something else to replace it."
    )
  })
})
