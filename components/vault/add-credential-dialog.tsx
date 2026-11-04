"use client"

import { useEffect, useRef } from "react"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { CredentialForm } from "@/components/vault/credential-form"

export interface AddCredentialDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
}

export function AddCredentialDialog({
  open,
  onOpenChange,
}: AddCredentialDialogProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      const activeDialog = document.activeElement?.closest('[role="dialog"]')
      if (activeDialog !== contentRef.current) return

      event.preventDefault()
      event.stopPropagation()
      onOpenChange(false)
    }

    document.addEventListener("keydown", handleKeyDown, true)
    return () => document.removeEventListener("keydown", handleKeyDown, true)
  }, [open, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        className={cn(
          "top-auto bottom-0 left-1/2 max-h-[90svh] w-full max-w-full -translate-y-0 overflow-y-auto rounded-b-none p-5",
          "data-open:slide-in-from-bottom-4 data-closed:slide-out-to-bottom-4",
          "sm:top-1/2 sm:bottom-auto sm:max-w-lg sm:-translate-y-1/2 sm:rounded-b-xl sm:data-open:slide-in-from-bottom-0 sm:data-closed:slide-out-to-bottom-0"
        )}
      >
        <DialogHeader>
          <DialogTitle className="text-lg">Add a credential</DialogTitle>
          <DialogDescription className="text-sm">
            Enter the account details you want to keep in your vault.
          </DialogDescription>
        </DialogHeader>
        <CredentialForm onSaved={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}
