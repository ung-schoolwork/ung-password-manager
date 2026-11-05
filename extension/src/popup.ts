import { formatDeviceCode } from "@/lib/devices/shared"

import type { ExtensionRequest } from "./api"
import { APP_ORIGIN } from "./config"
import {
  PopupController,
  type PopupView,
  type Send,
  type VaultEntry,
} from "./popup-controller"

function element<T extends HTMLElement = HTMLElement>(id: string) {
  return document.getElementById(id) as T
}

const views = {
  loading: element("loading-view"),
  "sign-in": element("sign-in-view"),
  unlock: element("unlock-view"),
  approval: element("approval-view"),
  vault: element("vault-view"),
  unavailable: element("unavailable-view"),
} satisfies Record<PopupView["name"], HTMLElement>

const signInForm = element<HTMLFormElement>("sign-in-form")
const signInEmail = element<HTMLInputElement>("sign-in-email")
const signInPassword = element<HTMLInputElement>("sign-in-password")
const signInSubmit = element<HTMLButtonElement>("sign-in-submit")
const signInError = element("sign-in-error")
const unlockForm = element<HTMLFormElement>("unlock-form")
const unlockPassword = element<HTMLInputElement>("unlock-password")
const unlockSubmit = element<HTMLButtonElement>("unlock-submit")
const unlockError = element("unlock-error")
const unlockAccount = element("unlock-account")
const approvalCode = element("approval-code")
const vaultAccount = element("vault-account")
const vaultEmpty = element("vault-empty")
const vaultContent = element("vault-content")
const vaultSearch = element<HTMLInputElement>("vault-search")
const siteLogins = element("site-logins")
const siteHeading = element("site-heading")
const siteEntries = element("site-entries")
const siteEmpty = element("site-empty")
const searchResults = element("search-results")
const resultEntries = element("result-entries")
const resultsEmpty = element("results-empty")

const send: Send = async (request: ExtensionRequest) => {
  try {
    const response = await chrome.runtime.sendMessage(request)
    return response ?? { state: "unavailable" }
  } catch {
    return { state: "unavailable" }
  }
}

function showError(target: HTMLElement, message: string | null) {
  target.textContent = message ?? ""
  target.hidden = !message
}

let shown: PopupView["name"] | null = null

function listEntries(list: HTMLElement, entries: VaultEntry[]) {
  list.replaceChildren(
    ...entries.map((entry) => {
      const item = document.createElement("li")
      const name = document.createElement("span")
      name.className = "name"
      name.textContent = entry.accountName || entry.siteOrApp
      const username = document.createElement("span")
      username.className = "username"
      username.textContent = entry.username
      item.append(name, username)
      return item
    })
  )
}

/** Removes every decrypted login from the page. */
function clearVault() {
  siteEntries.replaceChildren()
  resultEntries.replaceChildren()
  vaultSearch.value = ""
}

function renderVault(view: Extract<PopupView, { name: "vault" }>) {
  vaultAccount.textContent = `Signed in as ${view.email}`
  vaultEmpty.hidden = view.total > 0
  vaultContent.hidden = view.total === 0
  if (vaultSearch.value !== view.query) vaultSearch.value = view.query

  const searching = view.results !== null
  siteLogins.hidden = searching
  searchResults.hidden = !searching
  listEntries(siteEntries, searching ? [] : view.siteEntries)
  listEntries(resultEntries, view.results ?? [])

  if (view.site) {
    siteHeading.hidden = false
    siteHeading.textContent = `Saved for ${view.site}`
    siteEmpty.textContent = `No logins saved for ${view.site}. Search to find another one.`
  } else {
    siteHeading.hidden = true
    siteEmpty.textContent = "Search to find a saved login."
  }
  siteEmpty.hidden = view.siteEntries.length > 0
  resultsEmpty.textContent =
    view.results?.length === 0 ? "No logins match your search." : ""
  resultsEmpty.hidden = view.results?.length !== 0
}

function render(view: PopupView) {
  for (const [name, section] of Object.entries(views))
    section.hidden = name !== view.name
  // Decrypted logins stay in the page only while the vault is shown.
  if (view.name !== "vault") clearVault()

  switch (view.name) {
    case "sign-in":
      signInEmail.disabled = signInPassword.disabled = view.busy
      signInSubmit.disabled = view.busy
      signInSubmit.textContent = view.busy ? "Signing in…" : "Sign in"
      showError(signInError, view.error)
      if (!view.busy) {
        signInPassword.value = ""
        if (shown !== "sign-in")
          (signInEmail.value ? signInPassword : signInEmail).focus()
      }
      break
    case "unlock":
      unlockAccount.textContent = `Signed in as ${view.email}`
      unlockPassword.disabled = unlockSubmit.disabled = view.busy
      unlockSubmit.textContent = view.busy ? "Unlocking…" : "Unlock vault"
      showError(unlockError, view.error)
      if (!view.busy) {
        unlockPassword.value = ""
        unlockPassword.focus()
      }
      break
    case "approval":
      approvalCode.textContent = formatDeviceCode(view.code)
      break
    case "vault":
      renderVault(view)
      if (shown !== "vault" && view.total > 0) vaultSearch.focus()
      break
  }
  shown = view.name
}

/**
 * The address of the tab the popup was opened on. Clicking the toolbar button
 * lets the popup read it once (the activeTab permission); it is not kept.
 */
async function currentTabUrl(): Promise<string | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    return tab?.url ?? null
  } catch {
    return null
  }
}

const controller = new PopupController({
  send,
  render,
  tabUrl: await currentTabUrl(),
})

vaultSearch.addEventListener("input", () =>
  controller.search(vaultSearch.value)
)

signInForm.addEventListener("submit", (event) => {
  event.preventDefault()
  const email = signInEmail.value.trim()
  const password = signInPassword.value
  if (!email || !password) {
    showError(signInError, "Enter your email and password.")
    return
  }
  void controller.signIn(email, password)
})

unlockForm.addEventListener("submit", (event) => {
  event.preventDefault()
  const password = unlockPassword.value
  if (!password) {
    showError(unlockError, "Enter your password.")
    return
  }
  void controller.unlock(password)
})

for (const button of document.querySelectorAll(".sign-out"))
  button.addEventListener("click", () => void controller.signOut())
element("lock").addEventListener("click", () => controller.lock())
element("retry").addEventListener("click", () => void controller.start())

function openApp(path: string) {
  void chrome.tabs.create({ url: `${APP_ORIGIN}${path}` })
  window.close()
}
element("create-account").addEventListener("click", () => openApp("/register"))
element("open-vault").addEventListener("click", () => openApp("/vault"))

// Closing the popup ends this page and everything it held; drop the keys and
// logins explicitly as well, in case the page lingers.
window.addEventListener("pagehide", () => {
  controller.dispose()
  clearVault()
})

void controller.start()
