"use client"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { CredentialForm } from "@/components/vault/credential-form"
import type { Credential } from "@/lib/vault/types"

export interface EditCredentialDialogProps {
  credential: Credential | null
  open: boolean
  onOpenChange(open: boolean): void
}

export function EditCredentialDialog({
  credential,
  open,
  onOpenChange,
}: EditCredentialDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "top-auto bottom-0 left-1/2 max-h-[90svh] w-full max-w-full -translate-y-0 overflow-y-auto rounded-b-none p-5",
          "data-open:slide-in-from-bottom-4 data-closed:slide-out-to-bottom-4",
          "sm:top-1/2 sm:bottom-auto sm:max-w-lg sm:-translate-y-1/2 sm:rounded-b-xl sm:data-open:slide-in-from-bottom-0 sm:data-closed:slide-out-to-bottom-0"
        )}
      >
        <DialogHeader>
          <DialogTitle className="text-lg">Edit credential</DialogTitle>
          <DialogDescription className="text-sm">
            Update the account details for this credential.
          </DialogDescription>
        </DialogHeader>
        {credential ? (
          <CredentialForm
            key={credential.id}
            initialCredential={credential}
            onSaved={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}