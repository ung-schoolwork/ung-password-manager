"use client"

import { useState } from "react"

import { AddCredentialDialog } from "@/components/vault/add-credential-dialog"
import { CredentialList } from "@/components/vault/credential-list"
import {
  ImportCredentialsDialog,
  type ImportOutcome,
} from "@/components/vault/import-credentials-dialog"
import { useVault } from "@/components/vault/vault-provider"
import type { CredentialDraft } from "@/lib/vault/types"

export function VaultWorkspace() {
  const { credentials, addCredential } = useVault()
  const [addOpen, setAddOpen] = useState(() => credentials.length === 0)
  const [importOpen, setImportOpen] = useState(false)

  async function handleImport(
    drafts: CredentialDraft[]
  ): Promise<ImportOutcome> {
    let succeeded = 0
    let failed = 0

    // addCredential encrypts and saves one at a time, so we go
    // through the imported rows in sequence rather than in parallel.
    for (const draft of drafts) {
      try {
        await addCredential(draft)
        succeeded++
      } catch {
        failed++
      }
    }

    return { succeeded, failed }
  }

  return (
    <>
      <CredentialList
        credentials={credentials}
        onAddCredential={() => setAddOpen(true)}
        onImportCredentials={() => setImportOpen(true)}
      />
      <AddCredentialDialog open={addOpen} onOpenChange={setAddOpen} />
      <ImportCredentialsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={handleImport}
      />
    </>
  )
}
