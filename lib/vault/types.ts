export const VAULT_DATA_VERSION = 1 as const
export const VAULT_ENVELOPE_VERSION = 1 as const

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
  sourceShareId?: string
  createdAt: string
  updatedAt: string
  passwordUpdatedAt: string
}

export interface VaultDataV1 {
  version: typeof VAULT_DATA_VERSION
  credentials: Credential[]
}

export interface VaultEnvelopeV1 {
  version: typeof VAULT_ENVELOPE_VERSION
  kdf: {
    name: "PBKDF2"
    hash: "SHA-256"
    iterations: number
    salt: string
  }
  cipher: {
    name: "AES-GCM"
    iv: string
  }
  ciphertext: string
}
