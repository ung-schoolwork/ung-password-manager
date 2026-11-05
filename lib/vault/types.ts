export const VAULT_DATA_VERSION = 1 as const
export const VAULT_ENVELOPE_VERSION = 2 as const
export const WRAPPED_VAULT_KEY_VERSION = 1 as const

export const RISK_LEVELS = ["low", "medium", "high"] as const
export type RiskLevel = (typeof RISK_LEVELS)[number]

export interface CredentialDraft {
  accountName: string
  siteOrApp: string
  username: string
  password: string
  notes?: string
  riskLevel?: RiskLevel
}

export interface Credential extends CredentialDraft {
  id: string
  createdAt: string
  updatedAt: string
  passwordUpdatedAt: string
}

export interface VaultDataV1 {
  version: typeof VAULT_DATA_VERSION
  credentials: Credential[]
}

/** Vault data encrypted with the account's vault key. */
export interface VaultEnvelope {
  version: typeof VAULT_ENVELOPE_VERSION
  cipher: {
    name: "AES-GCM"
    iv: string
  }
  ciphertext: string
}

/**
 * The account's random vault key, encrypted with a key derived in the browser
 * from the account email and password. Changing the password only replaces
 * this wrapping; the vault itself stays encrypted with the same vault key.
 */
export interface WrappedVaultKey {
  version: typeof WRAPPED_VAULT_KEY_VERSION
  cipher: {
    name: "AES-GCM"
    iv: string
  }
  wrappedKey: string
}
