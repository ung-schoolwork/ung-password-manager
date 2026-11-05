"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"
import { ShieldCheck } from "lucide-react"
import { useAccount } from "@/components/auth/account-provider"
import {
  accountFailureMessage,
  validateAccountFields,
  type AccountFieldErrors,
} from "@/lib/auth/feedback"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ACCOUNT_EMAIL_MAX_LENGTH,
  ACCOUNT_PASSWORD_MAX_LENGTH,
  ACCOUNT_PASSWORD_MIN_LENGTH,
} from "@/lib/auth/shared"

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
  const [fieldErrors, setFieldErrors] = useState<AccountFieldErrors>({})
  const [validationAttempted, setValidationAttempted] = useState(false)
  const [busy, setBusy] = useState(false)

  function edited(next: {
    email?: string
    password?: string
    confirmation?: string
  }) {
    setError(null)
    if (!validationAttempted) return
    setFieldErrors(
      validateAccountFields(
        mode,
        next.email ?? email,
        next.password ?? password,
        next.confirmation ?? confirmation
      )
    )
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const errors = validateAccountFields(mode, email, password, confirmation)
    setFieldErrors(errors)
    // Re-check fields as the user types only while a field problem is shown.
    setValidationAttempted(Object.keys(errors).length > 0)
    if (Object.keys(errors).length > 0) {
      return
    }
    setBusy(true)
    try {
      await authenticate(mode, email.trim(), password)
      router.replace("/vault")
    } catch (caught) {
      setError(accountFailureMessage(caught, mode))
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
              ? "Choose one password for signing in and protecting your vault."
              : "Sign in to open your vault."}
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
          <form onSubmit={submit} className="space-y-5" noValidate>
            <div className="space-y-2">
              <Label htmlFor="account-email">Email</Label>
              <Input
                id="account-email"
                type="email"
                autoComplete="email"
                required
                maxLength={ACCOUNT_EMAIL_MAX_LENGTH}
                value={email}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={
                  fieldErrors.email ? "account-email-error" : undefined
                }
                onChange={(event) => {
                  setEmail(event.target.value)
                  edited({ email: event.target.value })
                }}
                disabled={busy}
              />
              {fieldErrors.email ? (
                <p
                  id="account-email-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {fieldErrors.email}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-password">Password</Label>
              <Input
                id="account-password"
                type="password"
                autoComplete={registering ? "new-password" : "current-password"}
                required
                minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
                maxLength={ACCOUNT_PASSWORD_MAX_LENGTH}
                value={password}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={
                  [
                    registering ? "account-password-help" : null,
                    fieldErrors.password ? "account-password-error" : null,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                onChange={(event) => {
                  setPassword(event.target.value)
                  edited({ password: event.target.value })
                }}
                disabled={busy}
              />
              {registering ? (
                <p
                  id="account-password-help"
                  className="text-xs text-muted-foreground"
                >
                  Use {ACCOUNT_PASSWORD_MIN_LENGTH} to{" "}
                  {ACCOUNT_PASSWORD_MAX_LENGTH} characters. Your vault is
                  encrypted with this password, so if you forget it your saved
                  passwords can’t be recovered.
                </p>
              ) : null}
              {fieldErrors.password ? (
                <p
                  id="account-password-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {fieldErrors.password}
                </p>
              ) : null}
            </div>
            {registering ? (
              <div className="space-y-2">
                <Label htmlFor="account-password-confirmation">
                  Confirm password
                </Label>
                <Input
                  id="account-password-confirmation"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
                  maxLength={ACCOUNT_PASSWORD_MAX_LENGTH}
                  value={confirmation}
                  aria-invalid={Boolean(fieldErrors.confirmation)}
                  aria-describedby={
                    fieldErrors.confirmation
                      ? "account-password-confirmation-error"
                      : undefined
                  }
                  onChange={(event) => {
                    setConfirmation(event.target.value)
                    edited({ confirmation: event.target.value })
                  }}
                  disabled={busy}
                />
                {fieldErrors.confirmation ? (
                  <p
                    id="account-password-confirmation-error"
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {fieldErrors.confirmation}
                  </p>
                ) : null}
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
