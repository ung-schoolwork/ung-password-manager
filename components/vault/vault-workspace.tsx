"use client"

import { useState } from "react"

import { AddCredentialDialog } from "@/components/vault/add-credential-dialog"
import { CredentialList } from "@/components/vault/credential-list"
import { EditCredentialDialog } from "@/components/vault/edit-credential-dialog"
import { useVault } from "@/components/vault/vault-provider"
import type { Credential } from "@/lib/vault/types"

export function VaultWorkspace() {
  const { credentials } = useVault()
  const [addOpen, setAddOpen] = useState(() => credentials.length === 0)
  const [credentialToEdit, setCredentialToEdit] = useState<Credential | null>(
    null
  )

  return (
    <>
      <CredentialList
        credentials={credentials}
        onAddCredential={() => setAddOpen(true)}
        onEditCredential={setCredentialToEdit}
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
    </>
  )
}
