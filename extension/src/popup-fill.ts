// Searching the vault list and filling a login into the current tab.

import {
  fillProblem,
  savedSiteHost,
  tabSiteHost,
  type FillProblem,
} from "@/lib/vault/site-match"

import type { FillLogin, PopupState } from "./popup-state"
import { decryptVault } from "./vault"

const FILL = {
  both: "Filled your username and password.",
  username:
    "Filled your username. When the page asks for your password, open the extension and choose this login again.",
  password: "Filled your password.",
  none: "No sign-in fields were found on this page.",
  failed:
    "This page couldn't be filled. Open the extension from the page you want to sign in to.",
}

function refusal(
  problem: FillProblem,
  pageUrl: string | null | undefined,
  siteOrApp: string
): string {
  switch (problem) {
    case "not-a-website":
      return "Logins can only be filled on websites."
    case "insecure":
      return "This page isn't secure, so the login wasn't filled."
    case "no-website":
      return "This login has no website address, so it can't be filled."
    case "different-site":
      return `This login is for ${savedSiteHost(siteOrApp)}, not ${tabSiteHost(pageUrl)}, so it wasn't filled.`
  }
}

/** Searches every saved login by account name, website, or username. */
export function search(s: PopupState, query: string): void {
  if (s.view.name !== "vault") return
  s.query = query
  s.notice = null
  s.showVault()
}

/**
 * Fills the chosen login into the current tab. Only that login's password
 * is decrypted, and only after the tab has been checked again: it must still
 * be on the login's site, over HTTPS (or http on this computer).
 */
export async function fill(s: PopupState, id: string): Promise<void> {
  if (s.view.name !== "vault" || s.filling) return
  const entry = s.entries.find((candidate) => candidate.id === id)
  if (!entry) return
  const generation = s.generation
  s.filling = true
  try {
    const tab = await s.currentTab()
    if (generation !== s.generation) return
    const problem = tab
      ? fillProblem(tab.url, entry.siteOrApp)
      : "not-a-website"
    if (!tab || problem)
      return s.showNotice(
        refusal(problem ?? "not-a-website", tab?.url, entry.siteOrApp),
        "error"
      )
    const login = await decryptLogin(s, id)
    if (generation !== s.generation) return
    if (!login) return s.showNotice(FILL.failed, "error")
    const outcome = await s.fillPage(tab.id, login)
    if (generation !== s.generation) return
    if (!outcome || "refused" in outcome)
      return s.showNotice(FILL.failed, "error")
    if (outcome.username && outcome.password)
      return s.showNotice(FILL.both, "info")
    if (outcome.username) return s.showNotice(FILL.username, "info")
    if (outcome.password) return s.showNotice(FILL.password, "info")
    s.showNotice(FILL.none, "error")
  } finally {
    s.filling = false
  }
}

async function decryptLogin(
  s: PopupState,
  id: string
): Promise<FillLogin | null> {
  if (!s.vaultKey || !s.envelope) return null
  try {
    const data = await decryptVault(s.vaultKey, s.envelope)
    const credential = data.credentials.find((item) => item.id === id)
    return credential
      ? {
          username: credential.username,
          password: credential.password,
          siteOrApp: credential.siteOrApp,
        }
      : null
  } catch {
    return null
  }
}
