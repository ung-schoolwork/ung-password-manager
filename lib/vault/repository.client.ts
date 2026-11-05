import type { VaultEnvelope, WrappedVaultKey } from "@/lib/vault/types"

/** An account's vault as stored: its wrapped key and, once saved, its data. */
export interface StoredVault {
  wrappedVaultKey: WrappedVaultKey
  /** Null until the first credential change is saved. */
  envelope: VaultEnvelope | null
}

export interface VaultRepository {
  load(): Promise<StoredVault>
  save(envelope: VaultEnvelope): Promise<void>
  /** The revision last loaded or saved, for repositories that version writes. */
  currentRevision?(): string | null
}
