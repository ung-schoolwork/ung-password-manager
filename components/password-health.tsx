"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, ShieldCheck, KeyRound, Loader2 } from "lucide-react"

import { useVault } from "@/components/vault/vault-provider"
import { analyzeCredentialsHealth, type CredentialHealthReport } from "@/lib/vault/health"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function PasswordHealth() {
  const { credentials } = useVault()
  const [auditedAccounts, setAuditedAccounts] = useState<CredentialHealthReport[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)

    void analyzeCredentialsHealth(credentials)
      .then((report) => {
        if (active) {
          setAuditedAccounts(report)
          setLoading(false)
        }
      })
      .catch(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [credentials])

  const accountsWithIssues = auditedAccounts.filter((acc) => acc.warnings.length > 0)
  const totalIssues = accountsWithIssues.reduce((acc, curr) => acc + curr.warnings.length, 0)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {credentials.length > 0 && !loading && (
        <div
          className={`flex items-center gap-3 rounded-xl border p-4 shadow-sm ${
            totalIssues > 0
              ? "border-l-4 border-l-destructive bg-destructive/5 text-destructive"
              : "border-l-4 border-l-emerald-500 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
          }`}
        >
          {totalIssues > 0 ? (
            <AlertTriangle className="size-5 shrink-0" aria-hidden="true" />
          ) : (
            <ShieldCheck className="size-5 shrink-0" aria-hidden="true" />
          )}
          <div>
            <h2 className="text-sm font-semibold">Security Audit</h2>
            <p className="text-xs opacity-90">
              {totalIssues > 0
                ? `Found ${totalIssues} issue(s) across ${accountsWithIssues.length} ${
                    accountsWithIssues.length === 1 ? "account" : "accounts"
                  }.`
                : "All accounts in your vault are secure and healthy."}
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Vault Password Health</CardTitle>
          <CardDescription className="text-sm">
            Review your saved credentials for NIST-compliant weakness, reuse risks, and aging passwords.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid min-h-64 place-items-center">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                Analyzing credential security…
              </div>
            </div>
          ) : credentials.length === 0 ? (
            <div className="grid min-h-64 place-items-center rounded-lg border border-dashed bg-muted/20 p-8 text-center">
              <div>
                <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <KeyRound className="size-5" aria-hidden="true" />
                </div>
                <p className="mt-4 font-medium">No credentials in vault</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Add credentials to your vault to run security audits.
                </p>
              </div>
            </div>
          ) : (
            <ul className="space-y-3" aria-label="Password health reports">
              {auditedAccounts.map((acc) => {
                const hasWarnings = acc.warnings.length > 0
                return (
                  <li
                    key={acc.id}
                    className={`rounded-lg border bg-card p-4 text-card-foreground shadow-sm ${
                      hasWarnings ? "border-l-4 border-l-destructive" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold uppercase tracking-wide">{acc.accountName}</h3>
                        <p className="text-xs text-muted-foreground">{acc.siteOrApp}</p>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          hasWarnings
                            ? "bg-destructive/10 text-destructive"
                            : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        {hasWarnings ? `${acc.warnings.length} Issue(s)` : "Secure"}
                      </span>
                    </div>

                    {hasWarnings && (
                      <div className="mt-3 space-y-2">
                        {acc.warnings.map((w, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-2 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive"
                          >
                            <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
                            <div>
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
    </div>
  )
}
