// The popup's account and vault state. All secrets live here, in the popup's
// memory, and nowhere else: the wrapping key derived from the password, the
// unwrapped vault key, and the decrypted list of logins (without passwords).
// Closing the popup
// discards them; reopening it asks for the password again. Nothing is written
// to extension storage, and the service worker only relays requests.

import {
  indexCredentialSearch,
  searchCredentials,
  type CredentialSearchEntry,
} from "@/lib/vault/search"
import {
  credentialsForSite,
  fillProblem,
  savedSiteHost,
  tabSiteHost,
  type FillProblem,
} from "@/lib/vault/site-match"
import type { VaultEnvelope } from "@/lib/vault/types"

import type { ExtensionRequest, ExtensionResponses, VaultSnapshot } from "./api"
import type { FillOutcome } from "./fill-page"
import {
  decryptVault,
  deriveAccountKeys,
  unwrapVaultKey,
  VaultUnlockError,
} from "./vault"

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
  | { name: "unavailable" }

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
  /** How often a waiting device checks whether it has been approved. */
  approvalPollMs?: number
  /** How often an open vault checks it may still be shown. */
  vaultPollMs?: number
  deriveKeys?: typeof deriveAccountKeys
}

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

const MESSAGES = {
  rejected: "The email or password is incorrect.",
  throttled: "Too many attempts. Wait a few minutes and try again.",
  unavailable:
    "Can't reach UNG Password Manager right now. Check your connection and try again.",
  signOutFailed: "Sign-out could not be completed. Try signing out again.",
  signedOut: "You were signed out.",
}

export class PopupController {
  private readonly send: Send
  private readonly render: (view: PopupView) => void
  private readonly approvalPollMs: number
  private readonly vaultPollMs: number
  private readonly deriveKeys: typeof deriveAccountKeys
  private readonly site: string | null
  private readonly tabUrl: string | null
  private readonly currentTab: () => Promise<CurrentTab | null>
  private readonly fillPage: (
    tabId: number,
    login: FillLogin
  ) => Promise<FillOutcome | null>

  // Bumped whenever the account state is reset, so a reply to an earlier
  // request can never reopen a vault that was locked in the meantime.
  private generation = 0
  private account: { userId: string; email: string } | null = null
  /** Kept from sign-in only until this device is approved and the vault opens. */
  private wrappingKey: CryptoKey | null = null
  private vaultKey: CryptoKey | null = null
  private revision: string | null = null
  private entries: VaultEntry[] = []
  private searchIndex: CredentialSearchEntry<VaultEntry>[] = []
  private siteEntries: VaultEntry[] = []
  private query = ""
  /** The encrypted vault, kept to decrypt one login when it is filled. */
  private envelope: VaultEnvelope | null = null
  private notice: Notice | null = null
  private filling = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private view: PopupView = { name: "loading" }

  constructor(options: PopupControllerOptions) {
    this.send = options.send
    this.render = options.render
    this.approvalPollMs = options.approvalPollMs ?? 3_000
    this.vaultPollMs = options.vaultPollMs ?? 5_000
    this.deriveKeys = options.deriveKeys ?? deriveAccountKeys
    this.tabUrl = options.tabUrl ?? null
    this.currentTab = options.currentTab ?? (async () => null)
    this.fillPage = options.fillPage ?? (async () => null)
    this.site = tabSiteHost(this.tabUrl)
  }

  get current(): PopupView {
    return this.view
  }

  /** Checks the browser's session and shows what this profile may do. */
  async start(): Promise<void> {
    const generation = this.reset()
    this.show({ name: "loading" })
    const session = await this.send({ type: "session" })
    if (generation !== this.generation) return
    if (session.state === "signed-out") return this.showSignIn(null)
    if (session.state !== "signed-in") return this.showUnavailable()
    this.account = { userId: session.userId, email: session.email }
    await this.checkDevice(generation)
  }

  /** Signs this Chrome profile in, which signs the app in as well. */
  async signIn(email: string, password: string): Promise<void> {
    if (this.view.name !== "sign-in" || this.view.busy) return
    const generation = this.reset()
    this.show({ name: "sign-in", error: null, busy: true })
    let keys: Awaited<ReturnType<typeof deriveAccountKeys>>
    try {
      keys = await this.deriveKeys(email, password)
    } catch {
      return this.showSignIn(MESSAGES.rejected)
    }
    if (generation !== this.generation) return
    const result = await this.send({
      type: "sign-in",
      email,
      authKey: keys.authKey,
    })
    if (generation !== this.generation) return
    if (result.state === "rejected") return this.showSignIn(MESSAGES.rejected)
    if (result.state === "throttled") return this.showSignIn(MESSAGES.throttled)
    if (result.state !== "signed-in")
      return this.showSignIn(MESSAGES.unavailable)
    this.account = { userId: result.userId, email: result.email }
    this.wrappingKey = keys.wrappingKey
    await this.checkDevice(generation)
  }

  /** Opens the vault of the account this browser is already signed in to. */
  async unlock(password: string): Promise<void> {
    if (this.view.name !== "unlock" || this.view.busy || !this.account) return
    const generation = this.generation
    const email = this.account.email
    this.show({ name: "unlock", email, error: null, busy: true })
    let wrappingKey: CryptoKey
    try {
      ;({ wrappingKey } = await this.deriveKeys(email, password))
    } catch {
      if (generation === this.generation)
        this.showUnlock("Your vault could not be opened. Try again.")
      return
    }
    if (generation !== this.generation) return
    this.wrappingKey = wrappingKey
    await this.openVault(generation)
  }

  /** Signs out the browser (the app and the extension) and locks the vault. */
  async signOut(): Promise<void> {
    // Forget every secret first, even if the request below fails.
    const generation = this.reset()
    this.show({ name: "loading" })
    const result = await this.send({ type: "sign-out" })
    if (generation !== this.generation) return
    if (result.state === "signed-out") return this.showSignIn(null)
    // The session may still be valid: show where the browser stands now.
    await this.start()
    if (this.view.name === "unlock") this.showUnlock(MESSAGES.signOutFailed)
  }

  /** Searches every saved login by account name, website, or username. */
  search(query: string): void {
    if (this.view.name !== "vault") return
    this.query = query
    this.notice = null
    this.showVault()
  }

  /**
   * Fills the chosen login into the current tab. Only that login's password
   * is decrypted, and only after the tab has been checked again: it must still
   * be on the login's site, over HTTPS (or http on this computer).
   */
  async fill(id: string): Promise<void> {
    if (this.view.name !== "vault" || this.filling) return
    const entry = this.entries.find((candidate) => candidate.id === id)
    if (!entry) return
    const generation = this.generation
    this.filling = true
    try {
      const tab = await this.currentTab()
      if (generation !== this.generation) return
      const problem = tab
        ? fillProblem(tab.url, entry.siteOrApp)
        : "not-a-website"
      if (!tab || problem)
        return this.showNotice(
          refusal(problem ?? "not-a-website", tab?.url, entry.siteOrApp),
          "error"
        )
      const login = await this.decryptLogin(id)
      if (generation !== this.generation) return
      if (!login) return this.showNotice(FILL.failed, "error")
      const outcome = await this.fillPage(tab.id, login)
      if (generation !== this.generation) return
      if (!outcome || "refused" in outcome)
        return this.showNotice(FILL.failed, "error")
      if (outcome.username && outcome.password)
        return this.showNotice(FILL.both, "info")
      if (outcome.username) return this.showNotice(FILL.username, "info")
      if (outcome.password) return this.showNotice(FILL.password, "info")
      this.showNotice(FILL.none, "error")
    } finally {
      this.filling = false
    }
  }

  /** Locks the vault but keeps the browser signed in. */
  lock(): void {
    const account = this.account
    this.reset()
    if (!account) return this.showSignIn(null)
    this.account = account
    this.showUnlock(null)
  }

  /** Forgets every secret, for example when the popup closes. */
  dispose(): void {
    this.reset()
  }

  private reset(): number {
    this.generation += 1
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.account = null
    this.wrappingKey = null
    this.forgetVault()
    return this.generation
  }

  private forgetVault() {
    this.vaultKey = null
    this.revision = null
    this.entries = []
    this.searchIndex = []
    this.siteEntries = []
    this.query = ""
    this.envelope = null
    this.notice = null
  }

  private showVault() {
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

  private show(view: PopupView) {
    this.view = view
    this.render(view)
  }

  private showSignIn(error: string | null) {
    this.reset()
    this.show({ name: "sign-in", error, busy: false })
  }

  private showUnavailable() {
    this.reset()
    this.show({ name: "unavailable" })
  }

  private showUnlock(error: string | null) {
    if (!this.account) return this.showSignIn(null)
    this.show({ name: "unlock", email: this.account.email, error, busy: false })
  }

  private schedule(
    generation: number,
    delay: number,
    work: () => Promise<void>
  ) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      if (generation === this.generation) void work()
    }, delay)
  }

  private async checkDevice(generation: number): Promise<void> {
    const device = await this.send({ type: "device" })
    if (generation !== this.generation || !this.account) return
    if (device.state === "signed-out")
      return this.showSignIn(MESSAGES.signedOut)
    if (device.state === "unavailable") return this.showUnavailable()
    if (device.state === "pending") {
      this.show({
        name: "approval",
        email: this.account.email,
        code: device.code,
      })
      this.schedule(generation, this.approvalPollMs, () =>
        this.checkDevice(generation)
      )
      return
    }
    if (this.wrappingKey) return this.openVault(generation)
    this.showUnlock(null)
  }

  private async openVault(generation: number): Promise<void> {
    const result = await this.send({ type: "vault" })
    if (generation !== this.generation) return
    if (result.state === "signed-out")
      return this.showSignIn(MESSAGES.signedOut)
    if (result.state === "not-approved") {
      // No vault data was sent. Keep the sign-in key until approval.
      this.forgetVault()
      return this.checkDevice(generation)
    }
    if (result.state !== "ok") return this.showUnavailable()
    try {
      await this.decrypt(generation, result.snapshot)
    } catch (error) {
      if (generation !== this.generation) return
      this.wrappingKey = null
      this.forgetVault()
      this.showUnlock(
        error instanceof VaultUnlockError
          ? error.message
          : "Your vault could not be opened. Try again."
      )
    }
  }

  private showNotice(text: string, tone: Notice["tone"]) {
    this.notice = { text, tone }
    this.showVault()
  }

  private async decryptLogin(id: string): Promise<FillLogin | null> {
    if (!this.vaultKey || !this.envelope) return null
    try {
      const data = await decryptVault(this.vaultKey, this.envelope)
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

  private async decrypt(generation: number, snapshot: VaultSnapshot) {
    let vaultKey = this.vaultKey
    if (!vaultKey) {
      if (!this.wrappingKey) throw new VaultUnlockError()
      vaultKey = await unwrapVaultKey(
        this.wrappingKey,
        snapshot.wrappedVaultKey
      )
    }
    const data = snapshot.envelope
      ? await decryptVault(vaultKey, snapshot.envelope)
      : { credentials: [] }
    if (generation !== this.generation || !this.account) return
    // The vault key replaces the password-derived key from here on.
    this.wrappingKey = null
    this.vaultKey = vaultKey
    this.revision = snapshot.revision
    this.envelope = snapshot.envelope
    this.entries = data.credentials
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
    this.showVault()
    this.schedule(generation, this.vaultPollMs, () => this.watch(generation))
  }

  // While the vault is shown, confirm the browser is still signed in to the
  // same account and still an approved device, and pick up changes.
  private async watch(generation: number): Promise<void> {
    const session = await this.send({ type: "session" })
    if (generation !== this.generation || !this.account) return
    if (session.state === "signed-out")
      return this.showSignIn(MESSAGES.signedOut)
    if (session.state === "signed-in" && session.userId !== this.account.userId)
      return this.start()
    const result = await this.send({ type: "revision" })
    if (generation !== this.generation || !this.account) return
    if (result.state === "signed-out")
      return this.showSignIn(MESSAGES.signedOut)
    if (result.state === "not-approved") {
      // This browser was removed from the account's devices.
      this.forgetVault()
      this.show({ name: "loading" })
      return this.checkDevice(generation)
    }
    if (result.state === "ok" && result.revision !== this.revision)
      return this.openVault(generation)
    this.schedule(generation, this.vaultPollMs, () => this.watch(generation))
  }
}
