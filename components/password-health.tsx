// ---------------------------------------------------------------------------
// password-health.tsx: the Password Health UI
//
// Reads credentials from the vault context, runs the audit from health.ts,
// and renders: (1) a summary banner, (2) a per-account report list, and
// (3) a small form to add/tag an account by risk level.
// ---------------------------------------------------------------------------

// Marks this as a CLIENT component. Required because it uses useState,
// useMemo, event handlers, and window.confirm, none of which run on the server.
"use client"

import { useMemo, useState, type FormEvent } from "react"
import { AlertTriangle, ShieldCheck, KeyRound, Plus } from "lucide-react"

// Custom hook (React context) exposing the vault's data and actions.
import { useVault } from "@/components/vault/vault-provider"
// The pure audit function: length, reuse, and age checks.
import { analyzeCredentialsHealth } from "@/lib/vault/health"
// shadcn/ui building blocks.
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { RiskLevel } from "@/lib/vault/types" // "low" | "medium" | "high"

export function PasswordHealth() {
  // Credential list plus two async actions from the vault context.
  const { credentials, addCredential, updateCredential } = useVault()

  // --- Local form state -----------------------------------------------------
  const [accountName, setAccountName] = useState("") // text input
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("medium") // dropdown
  const [formError, setFormError] = useState<string | null>(null) // null = no error

  // --- Derived data ---------------------------------------------------------
  // Memoized so the audit only reruns when `credentials` changes, not on every
  // keystroke in the form. Each result is a credential plus its `warnings`.
  const auditedAccounts = useMemo(
    () => analyzeCredentialsHealth(credentials),
    [credentials]
  )
  // Only accounts with at least one warning.
  const accountsWithIssues = auditedAccounts.filter(
    (acc) => acc.warnings.length > 0
  )
  // Sum of ALL warnings (an account with 3 warnings counts as 3).
  const totalIssues = accountsWithIssues.reduce(
    (acc, curr) => acc + curr.warnings.length,
    0
  )

  // --- Form submit handler --------------------------------------------------
  async function handleQuickAdd(e: FormEvent) {
    e.preventDefault() // stop the browser's default page-reloading submit
    setFormError(null) // clear any previous error

    // Validation: reject empty or whitespace-only names.
    if (!accountName.trim()) {
      setFormError("Enter an account name.")
      return
    }

    // Duplicate check: case-insensitive, trimmed.
    const existing = credentials.find(
      (c) => c.accountName.toLowerCase() === accountName.trim().toLowerCase()
    )

    // --- Path A: account already exists -> update its risk level only -------
    if (existing) {
      // NOTE: window.confirm blocks the UI and looks out of place; a shadcn
      // AlertDialog would match the design better.
      const confirmed = window.confirm(
        `An account named "${existing.accountName}" already exists. Do you want to overwrite its risk rating?`
      )
      if (!confirmed) return

      try {
        await updateCredential(existing.id, { riskLevel })
        setAccountName("")
        setRiskLevel("medium")
        return // early exit so we don't fall through to the "add new" path
      } catch {
        setFormError("Could not update existing credential.")
        return
      }
    }

    // --- Path B: new account -> create it -----------------------------------
    try {
      await addCredential({
        accountName: accountName.trim(),
        // NOTE: these three values are hardcoded placeholders. Only the name
        // and risk level come from the form. "password123" is weak, so the
        // audit will immediately flag every account added this way.
        siteOrApp: "example.com",
        username: "user@example.com",
        password: "password123",
        riskLevel,
      })
      setAccountName("")
      setRiskLevel("medium")
    } catch {
      setFormError("Could not save credential.")
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* ===== 1. Summary banner (only when the vault isn't empty) ===== */}
      {credentials.length > 0 && (
        <div
          // Styling switches on whether any issues exist:
          // issues -> red left border/tint, none -> green.
          className={`flex items-center gap-3 rounded-xl border p-4 shadow-sm ${
            totalIssues > 0
              ? "border-l-4 border-l-destructive bg-destructive/5 text-destructive"
              : "border-l-4 border-l-emerald-500 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
          }`}
        >
          {/* aria-hidden: the icons are decorative, so screen readers skip them */}
          {totalIssues > 0 ? (
            <AlertTriangle className="size-5 shrink-0" aria-hidden="true" />
          ) : (
            <ShieldCheck className="size-5 shrink-0" aria-hidden="true" />
          )}
          <div>
            <h2 className="text-sm font-semibold">Password check</h2>
            <p className="text-xs opacity-90">
              {/* Ternaries handle singular/plural: "1 issue" vs "2 issues" */}
              {totalIssues > 0
                ? `Found ${totalIssues} ${totalIssues === 1 ? "issue" : "issues"} across ${accountsWithIssues.length} ${
                    accountsWithIssues.length === 1 ? "account" : "accounts"
                  }.`
                : "No issues found by these checks."}
            </p>
          </div>
        </div>
      )}

      {/* ===== 2. Health report card ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Vault Password Health</CardTitle>
          <CardDescription className="text-sm">
            Review saved passwords for length, reuse, and when they were last
            changed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {credentials.length === 0 ? (
            // Empty state: dashed placeholder with an icon and a hint.
            <div className="grid min-h-64 place-items-center rounded-lg border border-dashed bg-muted/20 p-8 text-center">
              <div>
                <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <KeyRound className="size-5" aria-hidden="true" />
                </div>
                <p className="mt-4 font-medium">No credentials in vault</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Add a credential to check its password.
                </p>
              </div>
            </div>
          ) : (
            // One <li> per audited account (already sorted by health.ts).
            // aria-label gives screen readers a name for the list.
            <ul className="space-y-3" aria-label="Password health reports">
              {auditedAccounts.map((acc) => {
                const hasWarnings = acc.warnings.length > 0
                // Fall back to "low" if the field is somehow missing.
                const risk = acc.riskLevel || "low"
                return (
                  <li
                    key={acc.id} // stable unique id as the React key
                    // Red left border only when this account has warnings.
                    className={`rounded-lg border bg-card p-4 text-card-foreground shadow-sm ${
                      hasWarnings ? "border-l-4 border-l-destructive" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      {/* Left side: account name and site */}
                      <div>
                        <h3 className="text-sm font-semibold tracking-wide uppercase">
                          {acc.accountName}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {acc.siteOrApp}
                        </p>
                      </div>

                      {/* Right side: two badges */}
                      <div className="flex items-center gap-2">
                        {/* Risk badge. Nested ternary: high=red, medium=amber, else green */}
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${
                            risk === "high"
                              ? "bg-destructive/10 text-destructive"
                              : risk === "medium"
                              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                              : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {risk}
                        </span>
                        {/* Issue-count badge: red with a count, or green "No warnings" */}
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                            hasWarnings
                              ? "bg-destructive/10 text-destructive"
                              : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {hasWarnings
                            ? `${acc.warnings.length} ${acc.warnings.length === 1 ? "issue" : "issues"}`
                            : "No warnings"}
                        </span>
                      </div>
                    </div>

                    {/* Warning details: one red box per warning */}
                    {hasWarnings && (
                      <div className="mt-3 space-y-2">
                        {acc.warnings.map((w, i) => (
                          <div
                            // Index as key is OK here: the list is never reordered.
                            key={i}
                            className="flex items-start gap-2 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive"
                          >
                            <AlertTriangle
                              className="mt-0.5 size-4 shrink-0"
                              aria-hidden="true"
                            />
                            <div>
                              {/* w.type is "Weak" | "Short" | "Reused" | "Overdue" */}
                              <span className="font-bold">{w.type}: </span>
                              <span>{w.explanation}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ===== 3. Add / tag account form ===== */}
      {/* NOTE: titled "Add Account Credential" but it really only tags a risk
          level (see the hardcoded placeholders in handleQuickAdd). */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Account Credential</CardTitle>
          <CardDescription className="text-xs">
            Tag an account by risk level to prioritize its security warnings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Stacks vertically on mobile (flex-col), horizontal from `sm:` up */}
          <form
            onSubmit={handleQuickAdd}
            className="flex flex-col gap-4 sm:flex-row sm:items-end"
          >
            <div className="flex-1 space-y-1.5">
              {/* htmlFor matches the input id, so clicking the label focuses the field */}
              <Label htmlFor="quick-account-name">Account name</Label>
              {/* Controlled input: value comes from state, onChange updates it */}
              <Input
                id="quick-account-name"
                placeholder="e.g., Student Database"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
              />
            </div>
            <div className="w-full sm:w-48 space-y-1.5">
              <Label htmlFor="quick-risk-level">Risk level</Label>
              {/* Native <select> styled to match the design system.
                  `as RiskLevel` casts the string to the union type. */}
              <select
                id="quick-risk-level"
                className="h-7 w-full rounded-md border border-input bg-input/20 px-2 text-xs outline-none dark:bg-input/30"
                value={riskLevel}
                onChange={(e) => setRiskLevel(e.target.value as RiskLevel)}
              >
                <option value="low">Low Risk</option>
                <option value="medium">Medium Risk</option>
                <option value="high">High Risk</option>
              </select>
            </div>
            {/* type="submit" triggers the form's onSubmit -> handleQuickAdd */}
            <Button type="submit" className="h-7 px-4">
              <Plus className="size-3.5" aria-hidden="true" />
              Save
            </Button>
          </form>
          {/* Shown only when formError is set */}
          {formError && (
            <p className="mt-2 text-xs text-destructive">{formError}</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
