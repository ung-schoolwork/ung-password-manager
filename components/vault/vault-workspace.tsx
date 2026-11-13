"use client"

import { useState } from "react"

import { AddCredentialDialog } from "@/components/vault/add-credential-dialog"
import { CredentialList } from "@/components/vault/credential-list"
import { EditCredentialDialog } from "@/components/vault/edit-credential-dialog"
import { ImportCredentialsDialog } from "@/components/vault/import-credentials-dialog"
import { SharedCredentials } from "@/components/vault/shared-credentials"
import { useVault } from "@/components/vault/vault-provider"
import {
  SAVE_FAILED_REASON,
  type ImportSaveResult,
} from "@/lib/vault/import-report"
import type { Credential, CredentialDraft } from "@/lib/vault/types"

export function VaultWorkspace() {
  const { credentials, addCredential } = useVault()
  const [addOpen, setAddOpen] = useState(() => credentials.length === 0)
  const [credentialToEdit, setCredentialToEdit] = useState<Credential | null>(
    null
  )
  const [importOpen, setImportOpen] = useState(false)

  async function handleImport(
    drafts: CredentialDraft[]
  ): Promise<ImportSaveResult[]> {
    const results: ImportSaveResult[] = []

    // addCredential encrypts and saves one at a time, so we go
    // through the imported rows in sequence rather than in parallel.
    for (const draft of drafts) {
      try {
        await addCredential(draft)
        results.push({ ok: true })
      } catch (error) {
        results.push({
          ok: false,
          reason:
            error instanceof Error && error.message
              ? error.message
              : SAVE_FAILED_REASON,
        })
      }
    }

    return results
  }

  return (
    <div className="flex flex-col gap-4">
      <SharedCredentials />
      <CredentialList
        credentials={credentials}
        onAddCredential={() => setAddOpen(true)}
        onImportCredentials={() => setImportOpen(true)}
        onEditCredential={setCredentialToEdit}
        editingCredentialId={credentialToEdit?.id ?? null}
      />
      <AddCredentialDialog open={addOpen} onOpenChange={setAddOpen} />
      {credentialToEdit ? (
        <EditCredentialDialog
          credential={credentialToEdit}
          open
          onOpenChange={(open) => {
            if (!open) setCredentialToEdit(null)
          }}
        />
      ) : null}
      <ImportCredentialsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={handleImport}
      />
    </div>
  )
}
