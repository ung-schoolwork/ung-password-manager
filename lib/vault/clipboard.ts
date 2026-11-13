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
// (and its props, such as the password) alive. Components hear how a clear
// went through onClipboardClear instead, and stop listening when they unmount.
let pendingClear: {
  timer: ReturnType<typeof setTimeout>
  digest: string
  sequence: number
} | null = null
let copySequence = 0

// How an auto-clear ended (SCRUM-38). Nothing is reported when the clipboard
// no longer held our copy, because then there was nothing of ours to clear.
//   cleared            the clipboard still held our copy and was emptied
//   cleared-unchecked  the browser refused to let us read the clipboard, so it
//                      was emptied without checking; anything copied since
//                      (outside this page) was emptied too
//   clear-failed       the browser refused to empty the clipboard, so the
//                      copied value may still be on it
export type ClipboardClearResult =
  "cleared" | "cleared-unchecked" | "clear-failed"

type ClearListener = (copyId: number, result: ClipboardClearResult) => void
const clearListeners = new Set<ClearListener>()

function notify(copyId: number, result: ClipboardClearResult) {
  for (const listener of clearListeners) listener(copyId, result)
}

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

// How long the auto-clear waits for a clipboard read before giving up on
// checking and clearing anyway.
const READ_TIMEOUT_MS = 2_000

// Reads the clipboard for the auto-clear check, or rejects when it cannot be
// read without asking the user (SCRUM-73). Chrome answers readText() on a site
// that has not been granted clipboard access with a permission prompt, and the
// read waits until that prompt is answered: the clear stalled and the password
// stayed on the clipboard. So only read when access is already granted, and
// never wait long for the answer. Browsers that cannot report the permission
// (Firefox, Safari) refuse reads made from a timer, which also rejects here.
async function readClipboardWithoutPrompt(): Promise<string> {
  let state: PermissionState | undefined
  try {
    state = (
      await navigator.permissions.query({
        name: "clipboard-read" as PermissionName,
      })
    ).state
  } catch {
    state = undefined
  }
  if (state === "prompt" || state === "denied")
    throw new DOMException("Clipboard read not granted", "NotAllowedError")

  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      navigator.clipboard.readText(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new DOMException("Clipboard read timed out", "TimeoutError")
            ),
          READ_TIMEOUT_MS
        )
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

// Calls `listener` with the copy's id (as returned by copyWithAutoClear) and
// the outcome each time an auto-clear runs for a copy that was still on the
// clipboard (or could not be checked). Returns a function that stops
// listening; call it on unmount.
export function onClipboardClear(listener: ClearListener): () => void {
  clearListeners.add(listener)
  return () => {
    clearListeners.delete(listener)
  }
}

// Copies `value` and schedules it to be cleared. Rejects if the browser
// refuses the copy. Resolves with an id for this copy, which onClipboardClear
// listeners receive when its auto-clear runs.
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
    let checked = true
    let stillOurs = true
    try {
      stillOurs =
        (await digestOf(await readClipboardWithoutPrompt())) === digest
    } catch {
      // Some browsers block reads. Clearing anyway is safer than leaving a
      // credential sitting in the clipboard, but it may also remove something
      // the user copied elsewhere, so the user is told (SCRUM-38).
      checked = false
    }

    // A copy may have landed while the clipboard was being read.
    if (pendingClear?.sequence !== sequence) return
    pendingClear = null

    if (!stillOurs) return

    try {
      await navigator.clipboard.writeText("")
    } catch {
      notify(sequence, "clear-failed")
      return
    }
    notify(sequence, checked ? "cleared" : "cleared-unchecked")
  }, CLEAR_AFTER_MS)

  pendingClear = { timer, digest, sequence }
  return sequence
}
