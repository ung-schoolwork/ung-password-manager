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
let pendingClear: {
  timer: ReturnType<typeof setTimeout>
  value: string
  sequence: number
} | null = null
let copySequence = 0

function cancelPendingClear() {
  if (!pendingClear) return
  clearTimeout(pendingClear.timer)
  pendingClear = null
}

// Copies `value` and schedules it to be cleared. Rejects if the browser
// refuses the copy. `onCleared` runs only if the clipboard was actually
// cleared; the component that copied may have unmounted by then.
export async function copyWithAutoClear(
  value: string,
  onCleared?: () => void
): Promise<void> {
  await navigator.clipboard.writeText(value)

  // This copy owns the clipboard now: the previous pending clear is dropped
  // and its timer can no longer touch what we just wrote.
  cancelPendingClear()
  const sequence = ++copySequence

  const timer = setTimeout(async () => {
    if (pendingClear?.sequence !== sequence) return

    // Only clear if the clipboard still holds what we copied — the user may
    // have copied something else in the meantime (SCRUM-24 AC).
    let stillOurs = true
    try {
      stillOurs = (await navigator.clipboard.readText()) === value
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
        onCleared?.()
      } catch {
        // Leave things as they are if the clear itself fails.
      }
    }
  }, CLEAR_AFTER_MS)

  pendingClear = { timer, value, sequence }
}
