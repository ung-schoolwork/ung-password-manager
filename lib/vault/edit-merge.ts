import type { Credential, CredentialDraft } from "@/lib/vault/types"

export const EDITABLE_FIELDS = [
  "accountName",
  "siteOrApp",
  "username",
  "password",
  "notes",
  "riskLevel",
] as const satisfies readonly (keyof CredentialDraft)[]

export type EditableField = (typeof EDITABLE_FIELDS)[number]

/** The editable values of a saved credential, with optional fields filled in. */
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

export interface MergedEdit {
  draft: CredentialDraft
  /** Fields only the other device changed; the draft now has its values. */
  updated: EditableField[]
  /** Fields both devices changed differently; the draft keeps this edit's values. */
  bothChanged: EditableField[]
}

/**
 * Applies this device's edit on top of a newer saved version, so saving it
 * again never reverts a field that only the other device changed.
 */
export function mergeEdit(
  base: CredentialDraft,
  mine: CredentialDraft,
  theirs: CredentialDraft
): MergedEdit {
  let draft = { ...mine }
  const updated: EditableField[] = []
  const bothChanged: EditableField[] = []
  for (const field of EDITABLE_FIELDS) {
    if (theirs[field] === base[field]) continue
    if (mine[field] === base[field]) {
      draft = { ...draft, [field]: theirs[field] }
      updated.push(field)
    } else if (mine[field] !== theirs[field]) {
      bothChanged.push(field)
    }
  }
  return { draft, updated, bothChanged }
}
