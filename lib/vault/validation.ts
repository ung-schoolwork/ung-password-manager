import {
  RISK_LEVELS,
  VAULT_DATA_VERSION,
  type Credential,
  type CredentialDraft,
  type VaultDataV1,
} from "@/lib/vault/types"

export const MASTER_PASSPHRASE_MIN_LENGTH = 12

export type CredentialField =
  | "accountName"
  | "siteOrApp"
  | "username"
  | "password"

export class CredentialValidationError extends Error {
  readonly fields: Partial<Record<CredentialField, string>>

  constructor(fields: Partial<Record<CredentialField, string>>) {
    super("Credential information is incomplete.")
    this.name = "CredentialValidationError"
    this.fields = fields
  }
}

export function validateMasterPassphrase(passphrase: string): void {
  if (passphrase.length < MASTER_PASSPHRASE_MIN_LENGTH) {
    throw new Error(
      `Vault password must be at least ${MASTER_PASSPHRASE_MIN_LENGTH} characters.`
    )
  }
}

export function validateCredentialDraft(
  draft: CredentialDraft
): CredentialDraft {
  const fields: Partial<Record<CredentialField, string>> = {}
  const accountName = draft.accountName.trim()
  const siteOrApp = draft.siteOrApp.trim()
  const username = draft.username.trim()

  if (!accountName) fields.accountName = "Enter an account label."
  if (!siteOrApp) fields.siteOrApp = "Enter a website or app."
  if (!username) fields.username = "Enter a username."
  if (draft.password.length === 0) fields.password = "Enter a password."

  if (Object.keys(fields).length > 0) {
    throw new CredentialValidationError(fields)
  }

  return {
    accountName,
    siteOrApp,
    username,
    password: draft.password,
    notes: draft.notes?.trim() || undefined,
    riskLevel: draft.riskLevel,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isCredential(value: unknown): value is Credential {
  if (!isRecord(value)) return false

  return (
    typeof value.id === "string" &&
    typeof value.accountName === "string" &&
    typeof value.siteOrApp === "string" &&
    typeof value.username === "string" &&
    typeof value.password === "string" &&
    (value.notes === undefined || typeof value.notes === "string") &&
    (value.riskLevel === undefined ||
      (typeof value.riskLevel === "string" &&
        RISK_LEVELS.includes(value.riskLevel as (typeof RISK_LEVELS)[number]))) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.passwordUpdatedAt === "string"
  )
}

export function parseVaultData(value: unknown): VaultDataV1 {
  if (
    !isRecord(value) ||
    value.version !== VAULT_DATA_VERSION ||
    !Array.isArray(value.credentials) ||
    !value.credentials.every(isCredential)
  ) {
    throw new Error("Vault data is invalid or unsupported.")
  }

  return {
    version: VAULT_DATA_VERSION,
    credentials: value.credentials,
  }
}
