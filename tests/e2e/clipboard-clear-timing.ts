// The clipboard auto-clear delay the browser tests run with. Both
// playwright.config.ts (which hands it to the web server) and the clipboard
// specs import it, so a test can never wait out a different delay than the
// app uses.
export const CLIPBOARD_CLEAR_MS = 1500
