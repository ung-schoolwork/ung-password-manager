"use client"

import { useState, type FormEvent } from "react"
import { AlertTriangle, LockKeyhole, ShieldCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useVault } from "@/components/vault/vault-provider"
import { MASTER_PASSPHRASE_MIN_LENGTH } from "@/lib/vault/validation"

export function VaultGate() {
  const {
    status,
    busy,
    initializationError,
    createVault,
    unlockVault,
  } = useVault()
  const [passphrase, setPassphrase] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [error, setError] = useState<string | null>(null)

  if (status === "loading") {
    return (
      <main className="grid min-h-svh place-items-center p-6">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <ShieldCheck className="size-5 animate-pulse" aria-hidden="true" />
          Loading your encrypted vault…
        </div>
      </main>
    )
  }

  if (status === "error") {
    return (
      <main className="grid min-h-svh place-items-center p-6">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </div>
            <h1 className="font-heading text-xl font-medium">Vault unavailable</h1>
            <CardDescription className="text-sm">
              {initializationError}
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    )
  }

  const creating = status === "needs-setup"

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (creating && passphrase !== confirmation) {
      setError("The vault passwords do not match.")
      return
    }

    try {
      if (creating) await createVault(passphrase)
      else await unlockVault(passphrase)
      setPassphrase("")
      setConfirmation("")
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The vault could not be opened."
      )
    }
  }

  return (
    <main className="relative grid min-h-svh place-items-center overflow-hidden bg-background p-6">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,var(--color-muted),transparent_42%)] opacity-70"
        aria-hidden="true"
      />
      <Card className="relative w-full max-w-lg shadow-2xl shadow-foreground/5">
        <CardHeader className="gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <LockKeyhole className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-medium">
              {creating ? "Create your vault" : "Unlock your vault"}
            </h1>
            <CardDescription className="mt-1 text-sm">
              {creating
                ? "Choose a vault password to protect your credentials."
                : "Enter your vault password to continue."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="vault-passphrase">Vault password</Label>
              <Input
                id="vault-passphrase"
                className="h-11 px-3 text-sm"
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                autoComplete={creating ? "new-password" : "current-password"}
                minLength={creating ? MASTER_PASSPHRASE_MIN_LENGTH : undefined}
                required
                aria-describedby={creating ? "vault-password-help" : undefined}
              />
              {creating ? (
                <p id="vault-password-help" className="text-xs text-muted-foreground">
                  Use at least {MASTER_PASSPHRASE_MIN_LENGTH} characters and choose
                  something memorable and hard to guess.
                </p>
              ) : null}
            </div>

            {creating ? (
              <div className="space-y-2">
                <Label htmlFor="vault-passphrase-confirmation">
                  Confirm vault password
                </Label>
                <Input
                  id="vault-passphrase-confirmation"
                  className="h-11 px-3 text-sm"
                  type="password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
            ) : null}

            {error ? (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            ) : null}

            <Button
              className="h-11 w-full px-4 text-sm"
              type="submit"
              disabled={busy}
            >
              {busy
                ? creating
                  ? "Creating encrypted vault…"
                  : "Unlocking…"
                : creating
                  ? "Create encrypted vault"
                  : "Unlock vault"}
            </Button>
          </form>

        </CardContent>
      </Card>
    </main>
  )
}
