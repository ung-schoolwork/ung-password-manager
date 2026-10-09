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
  const [editingCredential, setEditingCredential] = useState<Credential | null>(
    null
  )

  return (
    <>
      <CredentialList
        credentials={credentials}
        onAddCredential={() => setAddOpen(true)}
        onEditCredential={(credential) => setEditingCredential(credential)}
      />
      <AddCredentialDialog open={addOpen} onOpenChange={setAddOpen} />
      <EditCredentialDialog
        credential={editingCredential}
        open={Boolean(editingCredential)}
        onOpenChange={(open) => {
          if (!open) setEditingCredential(null)
        }}
      />
    </>
  )
}