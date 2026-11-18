// Saving a new login from the popup.

import { tabSiteHost } from "@/lib/vault/site-match"
import {
  VAULT_DATA_VERSION,
  type Credential,
  type CredentialDraft,
  type VaultDataV1,
  type VaultEnvelope,
} from "@/lib/vault/types"
import {
  CredentialValidationError,
  validateCredentialDraft,
  type CredentialField,
} from "@/lib/vault/validation"

import { checkDevice } from "./popup-session"
import { MESSAGES, type PopupState, type SaveDraft } from "./popup-state"
import { decryptVault, encryptVault } from "./vault"

const SAVE_MESSAGES = {
  blocked:
    "UNG Password Manager isn't accepting this extension, so your login wasn't saved.",
  failed: "Your login couldn't be saved. Check your connection and try again.",
  busy: "Your vault is changing on another device. Wait a moment, then save again.",
}

// Saves attempted against newer vaults from other devices before giving up.
const SAVE_ATTEMPTS = 3

/**
 * Starts saving a login for the current website. When the page has a
 * sign-in form the user filled in, its username and password are offered.
 */
export async function startSave(s: PopupState): Promise<void> {
  if (s.view.name !== "vault" || !s.account) return
  const generation = s.generation
  const email = s.account.email
  const tab = await s.currentTab()
  if (generation !== s.generation || s.view.name !== "vault") return
  const host = tabSiteHost(tab?.url)
  const page = tab && host ? await s.readPage(tab.id) : null
  if (generation !== s.generation || s.view.name !== "vault") return
  const typed = page && !("refused" in page) ? page : null
  s.notice = null
  s.show({
    name: "save",
    email,
    draft: {
      accountName: host ?? "",
      siteOrApp: host ?? "",
      username: typed?.username ?? "",
      password: typed?.password ?? "",
    },
    errors: {},
    error: null,
    busy: false,
  })
}

/** Leaves the save form without saving. */
export function cancelSave(s: PopupState): void {
  if (s.view.name !== "save" || s.view.busy) return
  s.showVault()
}

/**
 * Adds a login to the vault. The whole vault is encrypted again here, with
 * the vault key, and only ciphertext leaves the popup. If another device
 * saved first, the newer vault is loaded and the login is added to it.
 */
export async function saveLogin(
  s: PopupState,
  draft: SaveDraft
): Promise<void> {
  if (s.view.name !== "save" || s.view.busy || !s.account) return
  const email = s.account.email
  const showForm = (
    errors: Partial<Record<CredentialField, string>>,
    error: string | null,
    busy = false
  ) => s.show({ name: "save", email, draft, errors, error, busy })
  let normalized: CredentialDraft
  try {
    normalized = validateCredentialDraft(draft)
  } catch (error) {
    if (error instanceof CredentialValidationError)
      return showForm(error.fields, null)
    throw error
  }
  const generation = s.generation
  showForm({}, null, true)
  const timestamp = new Date().toISOString()
  const credential: Credential = {
    ...normalized,
    id: crypto.randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
    passwordUpdatedAt: timestamp,
  }
  for (let attempt = 1; attempt <= SAVE_ATTEMPTS; attempt++) {
    const vaultKey = s.vaultKey
    const base = { envelope: s.envelope, revision: s.revision }
    if (!vaultKey) return
    let data: VaultDataV1
    let envelope: VaultEnvelope
    try {
      data = base.envelope
        ? await decryptVault(vaultKey, base.envelope)
        : { version: VAULT_DATA_VERSION, credentials: [] }
      data = { ...data, credentials: [credential, ...data.credentials] }
      envelope = await encryptVault(vaultKey, data)
    } catch {
      if (generation === s.generation) showForm({}, SAVE_MESSAGES.failed)
      return
    }
    if (generation !== s.generation) return
    const result = await s.send({
      type: "save-vault",
      envelope,
      expectedRevision: base.revision,
    })
    if (generation !== s.generation) return
    if (result.state === "saved") {
      s.envelope = envelope
      s.revision = result.revision
      s.setEntries(data.credentials)
      s.notice = {
        text: `Saved ${credential.accountName}.`,
        tone: "info",
      }
      return s.showVault()
    }
    if (result.state === "signed-out") return s.showSignIn(MESSAGES.signedOut)
    if (result.state === "not-approved") {
      s.forgetVault()
      s.show({ name: "loading" })
      return checkDevice(s, generation)
    }
    if (result.state === "blocked") return showForm({}, SAVE_MESSAGES.blocked)
    if (result.state !== "conflict") return showForm({}, SAVE_MESSAGES.failed)
    // Another device saved first: add the login to its vault instead.
    const latest = await s.send({ type: "vault" })
    if (generation !== s.generation) return
    if (latest.state !== "ok") return showForm({}, SAVE_MESSAGES.failed)
    s.envelope = latest.snapshot.envelope
    s.revision = latest.snapshot.revision
  }
  showForm({}, SAVE_MESSAGES.busy)
}
