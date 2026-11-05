"use client"

import { useState, type FormEvent } from "react"
import {
  AlertTriangle,
  LockKeyhole,
  MonitorSmartphone,
  ShieldCheck,
} from "lucide-react"

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
import { formatDeviceCode } from "@/lib/devices/shared"

export function VaultGate() {
  const { status, busy, initializationError, deviceCode, unlockVault } =
    useVault()
  const [password, setPassword] = useState("")
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

  if (status === "device-pending") {
    return (
      <main className="grid min-h-svh place-items-center p-6">
        <Card className="w-full max-w-lg">
          <CardHeader className="gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <MonitorSmartphone className="size-5" aria-hidden="true" />
            </div>
            <h1 className="font-heading text-2xl font-medium">
              Approve this device
            </h1>
            <CardDescription className="text-sm">
              Open your account menu on a device you already use, choose “Add a
              device”, and enter this code. A new code appears here
              automatically if this one expires.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p
              aria-label="Device approval code"
              className="rounded-lg bg-muted px-4 py-5 text-center font-mono text-3xl font-semibold tracking-[0.3em]"
            >
              {deviceCode ? formatDeviceCode(deviceCode) : "…"}
            </p>
            <p
              role="status"
              className="text-center text-sm text-muted-foreground"
            >
              Waiting for approval…
            </p>
          </CardContent>
        </Card>
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
            <h1 className="font-heading text-xl font-medium">
              Vault unavailable
            </h1>
            <CardDescription className="text-sm">
              {initializationError}
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (busy) return

    try {
      await unlockVault(password)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The vault could not be opened."
      )
    } finally {
      setPassword("")
    }
  }

  const message = error ?? initializationError

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
              Unlock your vault
            </h1>
            <CardDescription className="mt-1 text-sm">
              Enter the password you use to sign in.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="vault-password">Password</Label>
              <Input
                id="vault-password"
                className="h-11 px-3 text-sm"
                type="password"
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            {message ? (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {message}
              </p>
            ) : null}

            <Button
              className="h-11 w-full px-4 text-sm"
              type="submit"
              disabled={busy}
            >
              {busy ? "Unlocking…" : "Unlock vault"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
