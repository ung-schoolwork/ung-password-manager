import type { Credential } from "@/lib/vault/types"

export interface CredentialSearchEntry<T> {
  credential: T
  fields: string[]
}

/** The fields search looks at; the password and notes are never searched. */
export type SearchableCredential = Pick<
  Credential,
  "accountName" | "siteOrApp" | "username"
>

export function indexCredentialSearch<T extends SearchableCredential>(
  credentials: T[]
): CredentialSearchEntry<T>[] {
  return credentials.map((credential) => ({
    credential,
    fields: [
      credential.accountName,
      credential.siteOrApp,
      credential.username,
    ].map((value) => value.toLowerCase()),
  }))
}

export function searchCredentials<T>(
  entries: CredentialSearchEntry<T>[],
  query: string
): T[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return entries.map(({ credential }) => credential)

  return entries
    .filter(({ fields }) =>
      fields.some((field) => field.includes(normalizedQuery))
    )
    .map(({ credential }) => credential)
}
