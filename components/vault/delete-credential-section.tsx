"use client"

import { Trash2 } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { useVault } from "@/components/vault/vault-provider"
import type { Credential } from "@/lib/vault/types"

// Deleting asks once more before the credential is removed from the vault.
export function DeleteCredentialSection({
  credential,
  onDeleted,
}: {
  credential: Credential
  onDeleted(): void
}) {
  const { removeCredential, busy } = useVault()
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function confirmDelete() {
    setMessage(null)
    try {
      await removeCredential(credential.id)
      onDeleted()
    } catch (caught) {
      setMessage(
        caught instanceof Error
          ? caught.message
          : "The credential could not be deleted."
      )
    }
  }

  return (
    <div className="space-y-2 border-t pt-4">
      {confirming ? (
        <div
          role="group"
          aria-labelledby="delete-credential-question"
          className="space-y-2"
        >
          <p id="delete-credential-question" className="text-sm">
            Delete {credential.accountName}? This can’t be undone.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              className="h-11 w-full px-4 text-sm"
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {busy ? "Deleting…" : "Delete"}
            </Button>
            <Button
              className="h-11 w-full px-4 text-sm"
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setConfirming(false)
                setMessage(null)
              }}
            >
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <Button
          className="h-11 w-full px-4 text-sm"
          type="button"
          variant="destructive"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Delete credential
        </Button>
      )}
      <p
        className="min-h-5 text-xs text-destructive"
        role={message ? "alert" : undefined}
        aria-live="polite"
      >
        {message}
      </p>
    </div>
  )
}
