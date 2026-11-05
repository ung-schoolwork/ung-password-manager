// How long a copied secret stays on the clipboard before it is cleared
// automatically (SCRUM-24). NEXT_PUBLIC_CLIPBOARD_CLEAR_MS lets the browser
// tests shorten the wait; the value is clamped so a typo or an out-of-range
// override cannot turn the clear off or fire it instantly.
const DEFAULT_CLEAR_AFTER_MS = 15_000
const MIN_CLEAR_AFTER_MS = 1_000
const MAX_CLEAR_AFTER_MS = 60_000

function clearAfterMs() {
  const configured = process.env.NEXT_PUBLIC_CLIPBOARD_CLEAR_MS?.trim()
  if (!configured) return DEFAULT_CLEAR_AFTER_MS

  const parsed = Number(configured)
  if (!Number.isFinite(parsed)) return DEFAULT_CLEAR_AFTER_MS

  return Math.min(Math.max(parsed, MIN_CLEAR_AFTER_MS), MAX_CLEAR_AFTER_MS)
}

const CLEAR_AFTER_MS = clearAfterMs()

// One pending auto-clear for the whole page (SCRUM-54). Locking the vault,
// signing out, opening Edit, or navigating away unmounts the copy buttons,
// so the timer lives outside React and survives that unmount. A later copy
// from any credential or from the generator replaces the pending clear
// instead of racing it, so an older timer can never wipe a value the user
// copied afterwards.
//
// The timer can outlive the vault, so it must never hold the copied value
// itself (SCRUM-64): only a digest is kept, and nothing the timer closes over
// may reference the plaintext. That includes callbacks from the component
// that copied: a closure created in a component keeps the component's scope
// (and its props, such as the password) alive. Components hear about a clear
// through onClipboardCleared instead, and stop listening when they unmount.
let pendingClear: {
  timer: ReturnType<typeof setTimeout>
  digest: string
  sequence: number
} | null = null
let copySequence = 0
const clearedListeners = new Set<(copyId: number) => void>()

function cancelPendingClear() {
  if (!pendingClear) return
  clearTimeout(pendingClear.timer)
  pendingClear = null
}

async function digestOf(text: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  )
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

// Calls `listener` with the copy's id (as returned by copyWithAutoClear) each
// time a copy is actually cleared from the clipboard. Returns a function that
// stops listening; call it on unmount.
export function onClipboardCleared(
  listener: (copyId: number) => void
): () => void {
  clearedListeners.add(listener)
  return () => {
    clearedListeners.delete(listener)
  }
}

// Copies `value` and schedules it to be cleared. Rejects if the browser
// refuses the copy. Resolves with an id for this copy, which
// onClipboardCleared listeners receive if it is cleared.
export async function copyWithAutoClear(value: string): Promise<number> {
  await navigator.clipboard.writeText(value)

  // This copy owns the clipboard now: the previous pending clear is dropped
  // and its timer can no longer touch what we just wrote.
  cancelPendingClear()
  const sequence = ++copySequence

  // Hash before arming the timer so the timer never needs the plaintext.
  const digest = await digestOf(value)

  // A newer copy may have landed while hashing; it owns the clipboard now.
  if (sequence !== copySequence) return sequence

  const timer = setTimeout(async () => {
    if (pendingClear?.sequence !== sequence) return

    // Only clear if the clipboard still holds what we copied — the user may
    // have copied something else in the meantime (SCRUM-24 AC).
    let stillOurs = true
    try {
      stillOurs =
        (await digestOf(await navigator.clipboard.readText())) === digest
    } catch {
      // Some browsers block reads; clearing anyway is safer than leaving a
      // credential sitting in the clipboard.
    }

    // A copy may have landed while the clipboard was being read.
    if (pendingClear?.sequence !== sequence) return
    pendingClear = null

    if (stillOurs) {
      try {
        await navigator.clipboard.writeText("")
      } catch {
        // Leave things as they are if the clear itself fails.
        return
      }
      for (const listener of clearedListeners) listener(sequence)
    }
  }, CLEAR_AFTER_MS)

  pendingClear = { timer, digest, sequence }
  return sequence
}
