"use client"

import { useState, type FormEvent } from "react"

import { useAccount } from "@/components/auth/account-provider"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  changeAccountPassword,
  PASSWORD_CHANGE_MESSAGES,
  PasswordChangeError,
  validatePasswordChange,
  type PasswordChangeFieldErrors,
} from "@/lib/auth/password-change.client"
import {
  ACCOUNT_PASSWORD_MAX_LENGTH,
  ACCOUNT_PASSWORD_MIN_LENGTH,
} from "@/lib/auth/shared"

type Field = keyof PasswordChangeFieldErrors

const FIELDS: {
  field: Field
  id: string
  label: string
  autoComplete: string
}[] = [
  {
    field: "current",
    id: "current-password",
    label: "Current password",
    autoComplete: "current-password",
  },
  {
    field: "next",
    id: "new-password",
    label: "New password",
    autoComplete: "new-password",
  },
  {
    field: "confirmation",
    id: "new-password-confirmation",
    label: "Confirm new password",
    autoComplete: "new-password",
  },
]

export function PasswordSettings({ email }: { email: string }) {
  const { refresh } = useAccount()
  const [values, setValues] = useState<Record<Field, string>>({
    current: "",
    next: "",
    confirmation: "",
  })
  const [fieldErrors, setFieldErrors] = useState<PasswordChangeFieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setNotice(null)
    setError(null)
    const errors = validatePasswordChange(
      values.current,
      values.next,
      values.confirmation
    )
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return
    setBusy(true)
    try {
      await changeAccountPassword(email, values.current, values.next)
      setValues({ current: "", next: "", confirmation: "" })
      setNotice(
        "Your password was changed. Other devices were signed out and will need your new password."
      )
    } catch (caught) {
      const failure =
        caught instanceof PasswordChangeError
          ? caught
          : new PasswordChangeError(PASSWORD_CHANGE_MESSAGES.fallback)
      if (failure.field) setFieldErrors({ [failure.field]: failure.message })
      else setError(failure.message)
    } finally {
      setBusy(false)
      // Picks up the new session, or notices that this browser was signed out.
      void refresh()
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Password</CardTitle>
        <CardDescription className="text-sm">
          Change the password you use to sign in and open your vault. Your saved
          passwords stay as they are.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {/* Lets password managers tie the new password to this account. */}
          <input
            type="email"
            name="username"
            autoComplete="username"
            value={email}
            readOnly
            hidden
          />
          {FIELDS.map(({ field, id, label, autoComplete }) => {
            const message = fieldErrors[field]
            const help = field === "next" ? `${id}-help` : null
            return (
              <div key={field} className="space-y-2">
                <Label htmlFor={id}>{label}</Label>
                <Input
                  id={id}
                  type="password"
                  autoComplete={autoComplete}
                  required
                  maxLength={ACCOUNT_PASSWORD_MAX_LENGTH}
                  value={values[field]}
                  aria-invalid={Boolean(message)}
                  aria-describedby={
                    [help, message ? `${id}-error` : null]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                  onChange={(event) => {
                    const value = event.target.value
                    setValues((current) => ({ ...current, [field]: value }))
                    if (message)
                      setFieldErrors((current) => ({
                        ...current,
                        [field]: undefined,
                      }))
                  }}
                  disabled={busy}
                />
                {help ? (
                  <p id={help} className="text-xs text-muted-foreground">
                    Use {ACCOUNT_PASSWORD_MIN_LENGTH} to{" "}
                    {ACCOUNT_PASSWORD_MAX_LENGTH} characters. If you forget your
                    password, your saved passwords can’t be recovered.
                  </p>
                ) : null}
                {message ? (
                  <p
                    id={`${id}-error`}
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {message}
                  </p>
                ) : null}
              </div>
            )
          })}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="text-sm text-muted-foreground">
              {notice}
            </p>
          ) : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Changing password…" : "Change password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
