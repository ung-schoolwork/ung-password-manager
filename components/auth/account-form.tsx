"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"
import { ShieldCheck } from "lucide-react"
import { useAccount } from "@/components/auth/account-provider"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function AccountForm({ mode }: { mode: "login" | "register" }) {
  const {
    authenticate,
    error: accountError,
    signOut,
    refresh,
    status,
  } = useAccount()
  const router = useRouter()
  const registering = mode === "register"
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (registering && password !== confirmation) {
      setError("The account passwords do not match.")
      return
    }
    setBusy(true)
    try {
      await authenticate(mode, email, password)
      router.replace("/vault")
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not sign in. Try again."
      )
    } finally {
      setPassword("")
      setConfirmation("")
      setBusy(false)
    }
  }

  return (
    <main className="grid min-h-svh place-items-center bg-background p-6">
      <Card className="w-full max-w-lg">
        <CardHeader className="gap-3">
          <ShieldCheck className="size-9 text-primary" aria-hidden="true" />
          <h1 className="font-heading text-2xl font-medium">
            {registering ? "Create your account" : "Sign in"}
          </h1>
          <CardDescription>
            {registering
              ? "Choose an account password. You’ll unlock your vault separately."
              : "Sign in to your account, then unlock your vault."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {accountError ? (
            <div className="mb-4 space-y-2" role="alert">
              <p className="text-sm text-destructive">{accountError}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  void (status === "error" ? refresh() : signOut())
                }
              >
                {status === "error" ? "Try again" : "Retry sign-out"}
              </Button>
            </div>
          ) : null}
          <form onSubmit={submit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="account-email">Email</Label>
              <Input
                id="account-email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-password">Account password</Label>
              <Input
                id="account-password"
                type="password"
                autoComplete={registering ? "new-password" : "current-password"}
                required
                minLength={12}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
                aria-describedby={
                  registering ? "account-password-help" : undefined
                }
              />
              {registering ? (
                <p
                  id="account-password-help"
                  className="text-xs text-muted-foreground"
                >
                  Use 12 to 128 characters. Choose a different password for your
                  vault.
                </p>
              ) : null}
            </div>
            {registering ? (
              <div className="space-y-2">
                <Label htmlFor="account-password-confirmation">
                  Confirm account password
                </Label>
                <Input
                  id="account-password-confirmation"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  disabled={busy}
                />
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="h-11 w-full" disabled={busy}>
              {busy
                ? "Please wait…"
                : registering
                  ? "Create account"
                  : "Sign in"}
            </Button>
          </form>
          <p className="mt-5 text-center text-sm text-muted-foreground">
            {registering
              ? "Already have an account? "
              : "Don’t have an account? "}
            <Link
              className="font-medium text-foreground underline underline-offset-4"
              href={registering ? "/sign-in" : "/register"}
            >
              {registering ? "Sign in" : "Create an account"}
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
