"use client"

import { useMemo, useState, type FormEvent } from "react"
import { AlertTriangle, ShieldCheck, KeyRound, Plus } from "lucide-react"
import { useVault } from "@/components/vault/vault-provider"
import { analyzeCredentialsHealth } from "@/lib/vault/health"
import { cn } from "@/lib/utils"
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
import type { RiskLevel } from "@/lib/vault/types"
import { HealthShield, type HealthStatus } from "@/components/vault/health-shield"

export function PasswordHealth() {
  const { credentials, addCredential, updateCredential } = useVault()
  const [accountName, setAccountName] = useState("")
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("medium")
  const [formError, setFormError] = useState<string | null>(null)

  const auditedAccounts = useMemo(
    () => analyzeCredentialsHealth(credentials),
    [credentials]
  )
  const accountsWithIssues = auditedAccounts.filter((acc) => acc.warnings.length > 0)
  const totalIssues = accountsWithIssues.reduce((acc, curr) => acc + curr.warnings.length, 0)

  async function handleQuickAdd(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!accountName.trim()) {
      setFormError("Enter an account name.")
      return
    }
    const existing = credentials.find((c) => c.accountName.toLowerCase() === accountName.trim().toLowerCase())

    if (existing) {
      const confirmed = window.confirm(`An account named "${existing.accountName}" already exists. Overwrite risk?`)
      if (!confirmed) return
      try {
        await updateCredential(existing.id, { riskLevel })
        setAccountName("")
        return
      } catch {
        setFormError("Update failed.")
        return
      }
    }

    try {
      await addCredential({
        accountName: accountName.trim(),
        siteOrApp: "manual-entry",
        username: "user@example.com",
        password: "password123",
        riskLevel,
      })
      setAccountName("")
    } catch {
      setFormError("Save failed.")
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {credentials.length > 0 && (
        <div className={cn(
          "flex items-center gap-4 rounded-xl border p-4 shadow-sm",
          totalIssues > 0 ? "bg-red-500/5 border-red-500/20" : "bg-emerald-500/5 border-emerald-500/20"
        )}>
          <HealthShield status={totalIssues > 0 ? "danger" : "success"} size="lg" />
          <div>
            <h2 className={cn("text-base font-bold", totalIssues > 0 ? "text-red-600" : "text-emerald-600")}>Password check</h2>
            <p className="text-sm opacity-80">
              {totalIssues > 0 ? `Found ${totalIssues} security issues.` : "No issues found."}
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Vault Password Health</CardTitle>
          <CardDescription>Review saved passwords for length, reuse, and age.</CardDescription>
        </CardHeader>
        <CardContent>
          {credentials.length === 0 ? (
            <div className="grid min-h-64 place-items-center rounded-lg border border-dashed bg-muted/20 p-8 text-center">
              <KeyRound className="size-5 text-muted-foreground" />
              <p className="mt-2 font-medium">No credentials in vault</p>
            </div>
          ) : (
            <ul className="space-y-4">
              {auditedAccounts.map((acc) => {
                const hasWarnings = acc.warnings.length > 0
                const risk = acc.riskLevel || "low"
                let status: HealthStatus = "success"
                if (hasWarnings) status = risk === "high" ? "danger" : "warning"

                return (
                  <li key={acc.id} className={cn(
                    "flex gap-4 rounded-xl border p-5 shadow-sm transition-colors",
                    status === "danger" && "bg-red-500/5 border-red-200 dark:border-red-900/30",
                    status === "warning" && "bg-yellow-500/5 border-yellow-200 dark:border-yellow-900/30",
                    status === "success" && "bg-emerald-500/5 border-emerald-200 dark:border-emerald-900/30"
                  )}>
                    <HealthShield status={status} size="md" className="mt-1" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-bold uppercase">{acc.accountName}</h3>
                        <div className="flex gap-2">
                           <span className="rounded-full px-2 py-0.5 text-[10px] font-bold border uppercase bg-background">{risk} risk</span>
                        </div>
                      </div>
                      {hasWarnings && (
                        <div className="space-y-2">
                          {acc.warnings.map((w, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs text-destructive">
                              <AlertTriangle className="size-3.5 mt-0.5" />
                              <p><span className="font-bold">{w.type}:</span> {w.explanation}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
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
