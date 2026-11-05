import type { ExtensionRequest, SessionStatus } from "./api"
import { APP_ORIGIN } from "./config"

const status = document.getElementById("status")!
const openApp = document.getElementById("open-app") as HTMLButtonElement

openApp.addEventListener("click", () => {
  void chrome.tabs.create({ url: APP_ORIGIN })
  window.close()
})

async function showSession() {
  const request: ExtensionRequest = { type: "session" }
  let session: SessionStatus
  try {
    session = await chrome.runtime.sendMessage(request)
  } catch {
    session = { state: "unavailable" }
  }
  if (session?.state === "signed-in") {
    status.textContent = `Signed in as ${session.email}`
    openApp.textContent = "Open your vault"
  } else if (session?.state === "signed-out") {
    status.textContent = "You're not signed in."
    openApp.textContent = "Sign in"
  } else {
    status.textContent =
      "Can't reach UNG Password Manager right now. Check your connection and try again."
    openApp.textContent = "Open UNG Password Manager"
  }
  status.removeAttribute("aria-busy")
  openApp.hidden = false
}

void showSession()
