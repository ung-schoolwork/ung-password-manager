"use client"

import { useState, type FormEvent } from "react"

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
import { useVault } from "@/components/vault/vault-provider"
import { cn } from "@/lib/utils"
import { RISK_LEVELS, type RiskLevel } from "@/lib/vault/types"

export const RISK_WEIGHTS: Record<RiskLevel, number> = {
  high: 3,
  medium: 2,
  low: 1,
}

export const RISK_LABELS: Record<RiskLevel, string> = {
  high: "High Risk",
  medium: "Medium Risk",
  low: "Low Risk",
}

export const RISK_TAG_STYLES: Record<RiskLevel, string> = {
  high: "bg-[#fee2e2] text-[#dc2626] dark:bg-red-950/60 dark:text-red-300",
  medium:
    "bg-[#fef3c7] text-[#d97706] dark:bg-amber-950/60 dark:text-amber-300",
  low: "bg-[#d1fae5] text-[#059669] dark:bg-emerald-950/60 dark:text-emerald-300",
}

function isRiskLevel(value: string): value is RiskLevel {
  return RISK_LEVELS.includes(value as RiskLevel)
}

export function HealthWorkspace() {
  const { credentials, addCredential, updateCredential, busy } = useVault()
  const [accountName, setAccountName] = useState("")
  const [riskLevel, setRiskLevel] = useState<"" | RiskLevel>("")

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    // Basic client-side check so we don't push an incomplete entry.
    // This is a UX convenience, not a security control.
    const trimmedName = accountName.trim()
    if (!trimmedName || !isRiskLevel(riskLevel)) return // Fail closed

    const existing = credentials.find(
      (cred) => cred.accountName.toLowerCase() === trimmedName.toLowerCase()
    )

    if (existing) {
      await updateCredential(existing.id, { riskLevel })
    } else {
      await addCredential({
        accountName: trimmedName,
        siteOrApp: "school-portal.edu",
        username: "teacher",
        password: "SavedInVault!123",
        riskLevel,
      })
    }

    setAccountName("")
    setRiskLevel("")
  }

  const sortedCredentials = [...credentials].sort((left, right) => {
    const leftWeight = RISK_WEIGHTS[left.riskLevel ?? "low"]
    const rightWeight = RISK_WEIGHTS[right.riskLevel ?? "low"]
    return rightWeight - leftWeight
  })

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add Account Credential</CardTitle>
          <CardDescription className="text-sm">
            Tag an account by risk level to prioritize its security warnings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            id="credentialForm"
            className="flex flex-wrap items-end gap-2.5"
            onSubmit={handleSubmit}
          >
            <div className="min-w-48 flex-1 space-y-1.5">
              <Label htmlFor="accountName">Account name</Label>
              {/* pattern/maxLength are client-side UX hints only, not a
                  security boundary — React text rendering below prevents
                  arbitrary HTML/script execution. */}
              <Input
                id="accountName"
                type="text"
                className="h-10 px-3 text-sm"
                placeholder="e.g., Student Database"
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                required
                maxLength={100}
                pattern="[a-zA-Z0-9\s\-_]+"
                title="Alphanumeric characters, spaces, hyphens, and underscores only."
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="riskLevel">Risk level</Label>
              <select
                id="riskLevel"
                className="h-10 rounded-md border border-input bg-input/20 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
                value={riskLevel}
                onChange={(event) =>
                  setRiskLevel(event.target.value as "" | RiskLevel)
                }
                required
              >
                <option value="" disabled>
                  Select Risk Level...
                </option>
                <option value="high">High Risk</option>
                <option value="medium">Medium Risk</option>
                <option value="low">Low Risk</option>
              </select>
            </div>

            <Button
              className="h-10 px-4 text-sm font-semibold"
              type="submit"
              disabled={busy}
            >
              Save
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Security Health Warnings</CardTitle>
          <CardDescription className="text-sm">
            Sorted by priority (High risk first)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div id="warningsList" className="space-y-2" aria-live="polite">
            {sortedCredentials.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No accounts added yet.
              </p>
            ) : (
              sortedCredentials.map((cred) => {
                const risk = cred.riskLevel ?? "low"

                return (
                  <div
                    key={cred.id}
                    className="credential-item flex items-center justify-between rounded-md border bg-background p-4"
                  >
                    {/* XSS prevention: React renders this value as plain text
                        nodes, never as parsed HTML, so a name like
                        "<script>...</script>" is displayed literally. */}
                    <span className="font-medium">{cred.accountName}</span>
                    <span
                      className={cn(
                        "tag rounded-full px-3 py-1 text-xs font-bold uppercase",
                        "tag-" + risk,
                        RISK_TAG_STYLES[risk]
                      )}
                    >
                      { risk }
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
