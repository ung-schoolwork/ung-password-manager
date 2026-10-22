import type { Credential, CredentialDraft } from "@/lib/vault/types"

const EDITABLE_FIELDS = [
  "accountName",
  "siteOrApp",
  "username",
  "password",
  "notes",
  "riskLevel",
] as const satisfies readonly (keyof CredentialDraft)[]

export function toDraft(credential: Credential): CredentialDraft {
  return {
    accountName: credential.accountName,
    siteOrApp: credential.siteOrApp,
    username: credential.username,
    password: credential.password,
    notes: credential.notes ?? "",
    riskLevel: credential.riskLevel ?? "low",
  }
}

export function mergeEdit(
  base: CredentialDraft,
  mine: CredentialDraft,
  theirs: CredentialDraft
): {
  draft: CredentialDraft
  updated: (typeof EDITABLE_FIELDS)[number][]
  bothChanged: (typeof EDITABLE_FIELDS)[number][]
} {
  const draft = { ...mine }
  const updated: (typeof EDITABLE_FIELDS)[number][] = []
  const bothChanged: (typeof EDITABLE_FIELDS)[number][] = []

  for (const field of EDITABLE_FIELDS) {
    const mineChanged = mine[field] !== base[field]
    const theirsChanged = theirs[field] !== base[field]
    if (!theirsChanged) continue

    if (!mineChanged) {
      Object.assign(draft, { [field]: theirs[field] })
      updated.push(field)
    } else if (mine[field] !== theirs[field]) {
      bothChanged.push(field)
    }
  }

  return { draft, updated, bothChanged }
}
