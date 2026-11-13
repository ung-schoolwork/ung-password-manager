import type { ClipboardClearResult } from "./clipboard"

// What to tell the user once an auto-clear has run for something they copied.
// `label` names what was copied, capitalized ("Password", "Username").
export function clipboardClearMessage(
  label: string,
  result: ClipboardClearResult
): string {
  switch (result) {
    case "cleared":
      return `${label} cleared from clipboard.`
    case "cleared-unchecked":
      return `${label} cleared from clipboard. Your browser didn't let us check it first, so anything you copied since was cleared too.`
    case "clear-failed":
      return `Couldn't clear the ${label.toLowerCase()} from your clipboard. Copy something else to replace it.`
  }
}
