import { VAULT_STORAGE_KEY } from "@/lib/vault/repository.client"
import { parseVaultWrite } from "@/lib/vault/remote"

export type LocalVaultSource = "account" | "legacy"

function storageKey(accountId: string, source: LocalVaultSource) {
  return source === "account"
    ? `${VAULT_STORAGE_KEY}:account:${accountId}`
    : VAULT_STORAGE_KEY
}

export function localVaultSources(storage: Storage, accountId: string) {
  return (["account", "legacy"] as const).filter(
    (source) => storage.getItem(storageKey(accountId, source)) !== null
  )
}

export function readLocalVault(
  storage: Storage,
  accountId: string,
  source: LocalVaultSource
) {
  try {
    const value = storage.getItem(storageKey(accountId, source))
    const parsed =
      value &&
      parseVaultWrite({
        envelope: JSON.parse(value),
        expectedRevision: null,
      })
    if (!parsed) throw new Error("Invalid vault")
    return parsed.envelope
  } catch {
    throw new Error("Your existing vault could not be opened.")
  }
}
