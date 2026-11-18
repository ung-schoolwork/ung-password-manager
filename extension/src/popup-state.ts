// The popup's account and vault state. All secrets live here, in the popup's
// memory, and nowhere else: the wrapping key derived from the password, the
// unwrapped vault key, the decrypted list of logins (without passwords), and a
// login being saved until it is encrypted. Closing the popup discards them;
// reopening it asks for the password again. Nothing is written
// to extension storage, and the service worker only relays requests.

import {
  indexCredentialSearch,
  searchCredentials,
  type CredentialSearchEntry,
} from "@/lib/vault/search"
import { credentialsForSite, tabSiteHost } from "@/lib/vault/site-match"
import type { Credential, VaultEnvelope } from "@/lib/vault/types"
import type { CredentialField } from "@/lib/vault/validation"

import type { ExtensionRequest, ExtensionResponses } from "./api"
import type { FillOutcome, PageLogin } from "./fill-page"
import { deriveAccountKeys } from "./vault"

/** What the popup lists for each saved login. Passwords are not kept. */
export interface VaultEntry {
  id: string
  accountName: string
  siteOrApp: string
  username: string
}

export type PopupView =
  | { name: "loading" }
  | { name: "sign-in"; error: string | null; busy: boolean }
  | { name: "unlock"; email: string; error: string | null; busy: boolean }
  | { name: "approval"; email: string; code: string }
  | {
      name: "vault"
      email: string
      /** The current tab's site, or null for a page that is not a website. */
      site: string | null
      /** Logins saved for the current tab's site. */
      siteEntries: VaultEntry[]
      query: string
      /** Every login matching `query`, or null while the search is empty. */
      results: VaultEntry[] | null
      /** How many logins the vault holds. */
      total: number
      /** The result of the last fill, if any. */
      notice: Notice | null
    }
  | {
      name: "save"
      email: string
      draft: SaveDraft
      /** Problems with single fields, shown next to them. */
      errors: Partial<Record<CredentialField, string>>
      error: string | null
      busy: boolean
    }
  /** The app could not be reached, or failed to answer. */
  | { name: "unavailable" }
  /** The app answered but does not accept requests from this extension. */
  | { name: "blocked" }

/** A login the user is about to save from the popup. */
export interface SaveDraft {
  accountName: string
  siteOrApp: string
  username: string
  password: string
}

export interface Notice {
  text: string
  tone: "info" | "error"
}

/** The tab the popup was opened on, read again when the user fills a login. */
export interface CurrentTab {
  id: number
  url: string | null
}

/** One login, decrypted only to be filled and then dropped. */
export interface FillLogin {
  username: string
  password: string
  siteOrApp: string
}

export type Send = <T extends ExtensionRequest>(
  request: T
) => Promise<ExtensionResponses[T["type"]]>

export interface PopupControllerOptions {
  send: Send
  render(view: PopupView): void
  /** The URL of the tab the popup was opened on, if the browser shares it. */
  tabUrl?: string | null
  /** Reads the active tab when the user chooses a login to fill. */
  currentTab?: () => Promise<CurrentTab | null>
  /** Fills the login into the tab; null when the page could not be reached. */
  fillPage?: (tabId: number, login: FillLogin) => Promise<FillOutcome | null>
  /** Reads the sign-in fields the user filled in on the tab, to save them. */
  readPage?: (tabId: number) => Promise<PageLogin | null>
  /** How often a waiting device checks whether it has been approved. */
  approvalPollMs?: number
  /** How often an open vault checks it may still be shown. */
  vaultPollMs?: number
  deriveKeys?: typeof deriveAccountKeys
}

export const MESSAGES = {
  rejected: "The email or password is incorrect.",
  throttled: "Too many attempts. Wait a few minutes and try again.",
  unavailable:
    "Can't reach UNG Password Manager right now. Check your connection and try again.",
  signOutFailed: "Sign-out could not be completed. Try signing out again.",
  signedOut: "You were signed out.",
}

/** The popup's state and the screens every flow can fall back to. */
export class PopupState {
  readonly send: Send
  readonly render: (view: PopupView) => void
  readonly approvalPollMs: number
  readonly vaultPollMs: number
  readonly deriveKeys: typeof deriveAccountKeys
  readonly site: string | null
  readonly tabUrl: string | null
  readonly currentTab: () => Promise<CurrentTab | null>
  readonly fillPage: (
    tabId: number,
    login: FillLogin
  ) => Promise<FillOutcome | null>
  readonly readPage: (tabId: number) => Promise<PageLogin | null>

  // Bumped whenever the account state is reset, so a reply to an earlier
  // request can never reopen a vault that was locked in the meantime.
  generation = 0
  account: { userId: string; email: string } | null = null
  /** Kept from sign-in only until this device is approved and the vault opens. */
  wrappingKey: CryptoKey | null = null
  vaultKey: CryptoKey | null = null
  revision: string | null = null
  entries: VaultEntry[] = []
  searchIndex: CredentialSearchEntry<VaultEntry>[] = []
  siteEntries: VaultEntry[] = []
  query = ""
  /** The encrypted vault, kept to decrypt one login when it is filled. */
  envelope: VaultEnvelope | null = null
  notice: Notice | null = null
  filling = false
  timer: ReturnType<typeof setTimeout> | null = null
  view: PopupView = { name: "loading" }

  constructor(options: PopupControllerOptions) {
    this.send = options.send
    this.render = options.render
    this.approvalPollMs = options.approvalPollMs ?? 3_000
    this.vaultPollMs = options.vaultPollMs ?? 5_000
    this.deriveKeys = options.deriveKeys ?? deriveAccountKeys
    this.tabUrl = options.tabUrl ?? null
    this.currentTab = options.currentTab ?? (async () => null)
    this.fillPage = options.fillPage ?? (async () => null)
    this.readPage = options.readPage ?? (async () => null)
    this.site = tabSiteHost(this.tabUrl)
  }

  reset(): number {
    this.generation += 1
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.account = null
    this.wrappingKey = null
    this.forgetVault()
    return this.generation
  }

  forgetVault() {
    this.vaultKey = null
    this.revision = null
    this.entries = []
    this.searchIndex = []
    this.siteEntries = []
    this.query = ""
    this.envelope = null
    this.notice = null
  }

  showVault() {
    if (!this.account) return this.showSignIn(null)
    this.show({
      name: "vault",
      email: this.account.email,
      site: this.site,
      siteEntries: this.siteEntries,
      query: this.query,
      results: this.query.trim()
        ? searchCredentials(this.searchIndex, this.query)
        : null,
      total: this.entries.length,
      notice: this.notice,
    })
  }

  show(view: PopupView) {
    this.view = view
    this.render(view)
  }

  showSignIn(error: string | null) {
    this.reset()
    this.show({ name: "sign-in", error, busy: false })
  }

  showUnavailable() {
    this.reset()
    this.show({ name: "unavailable" })
  }

  showBlocked() {
    this.reset()
    this.show({ name: "blocked" })
  }

  showUnlock(error: string | null) {
    if (!this.account) return this.showSignIn(null)
    this.show({ name: "unlock", email: this.account.email, error, busy: false })
  }

  showNotice(text: string, tone: Notice["tone"]) {
    this.notice = { text, tone }
    this.showVault()
  }

  schedule(generation: number, delay: number, work: () => Promise<void>) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      if (generation === this.generation) void work()
    }, delay)
  }

  /** Keeps the name, website, and username of each login; not passwords. */
  setEntries(credentials: Credential[]) {
    this.entries = credentials
      .map(({ id, accountName, siteOrApp, username }) => ({
        id,
        accountName,
        siteOrApp,
        username,
      }))
      .sort((a, b) =>
        a.accountName.localeCompare(b.accountName, undefined, {
          sensitivity: "base",
        })
      )
    this.searchIndex = indexCredentialSearch(this.entries)
    this.siteEntries = credentialsForSite(this.entries, this.tabUrl)
  }
}
