"use client"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react"
import { AlertTriangle, KeyRound, Plus } from "lucide-react"

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
import type { Credential, RiskLevel } from "@/lib/vault/types"
import {
  HealthShield,
  type HealthStatus,
} from "@/components/vault/health-shield"

export function PasswordHealth() {
  const { credentials, updateCredential, busy } = useVault()
  const [accountName, setAccountName] = useState("")
  const [selectedCredentialId, setSelectedCredentialId] = useState<
    string | null
  >(null)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1)
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("medium")
  const [formError, setFormError] = useState<string | null>(null)
  const activeOptionRef = useRef<HTMLLIElement>(null)

  const emptyVault = credentials.length === 0
  const query = accountName.trim().toLowerCase()
  const matchingCredentials = credentials.filter(
    (credential) =>
      query.length > 0 &&
      (credential.accountName.toLowerCase().includes(query) ||
        credential.siteOrApp.toLowerCase().includes(query))
  )

  // The highlight has to stay visible when the list is longer than its box.
  useEffect(() => {
    if (!suggestionsOpen || activeSuggestionIndex < 0) return
    activeOptionRef.current?.scrollIntoView({ block: "nearest" })
  }, [activeSuggestionIndex, suggestionsOpen])

  const auditedAccounts = useMemo(
    () => analyzeCredentialsHealth(credentials),
    [credentials]
  )
  const accountsWithIssues = auditedAccounts.filter(
    (acc) => acc.warnings.length > 0
  )
  const totalIssues = accountsWithIssues.reduce(
    (acc, curr) => acc + curr.warnings.length,
    0
  )

  async function handleQuickAdd(e: FormEvent) {
    e.preventDefault()
    setFormError(null)

    const selectedCredential = credentials.find(
      (credential) => credential.id === selectedCredentialId
    )
    if (!selectedCredential) {
      setFormError("Select a saved account from the suggestions.")
      return
    }

    try {
      await updateCredential(
        selectedCredential.id,
        { riskLevel },
        selectedCredential.updatedAt
      )
      setAccountName("")
      setSelectedCredentialId(null)
    } catch (caught) {
      setFormError(
        caught instanceof Error
          ? caught.message
          : "Could not update existing credential."
      )
    }
  }

  function selectCredential(credential: Credential) {
    setAccountName(credential.accountName)
    setSelectedCredentialId(credential.id)
    // Start from the tag the account already has, so saving keeps it.
    setRiskLevel(credential.riskLevel ?? "low")
    setSuggestionsOpen(false)
    setActiveSuggestionIndex(-1)
    setFormError(null)
  }

  function handleAccountKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setSuggestionsOpen(false)
      return
    }

    if (event.key === "ArrowDown" && matchingCredentials.length > 0) {
      event.preventDefault()
      setSuggestionsOpen(true)
      setActiveSuggestionIndex((index) =>
        Math.min(index + 1, matchingCredentials.length - 1)
      )
    } else if (event.key === "ArrowUp" && matchingCredentials.length > 0) {
      event.preventDefault()
      setSuggestionsOpen(true)
      setActiveSuggestionIndex((index) =>
        index < 0 ? matchingCredentials.length - 1 : Math.max(index - 1, 0)
      )
    } else if (event.key === "Enter" && suggestionsOpen) {
      const credential = matchingCredentials[activeSuggestionIndex]
      if (!credential) return
      event.preventDefault()
      selectCredential(credential)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {credentials.length > 0 && (
        <div
          className={cn(
            "flex items-center gap-3 rounded-xl border p-4 shadow-sm",
            totalIssues > 0
              ? "border-l-4 border-l-destructive bg-destructive/5 text-destructive"
              : "border-l-4 border-l-emerald-500 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
          )}
        >
          <HealthShield
            status={totalIssues > 0 ? "danger" : "success"}
            size="md"
          />
          <div>
            <h2 className="text-sm font-semibold">Password check</h2>
            <p className="text-xs opacity-90">
              {totalIssues > 0
                ? `Found ${totalIssues} ${totalIssues === 1 ? "issue" : "issues"} across ${accountsWithIssues.length} ${
                    accountsWithIssues.length === 1 ? "account" : "accounts"
                  }.`
                : "No issues found by these checks."}
            </p>
          </div>
        </div>
      )}

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
            <ul className="space-y-3" aria-label="Password health reports">
              {auditedAccounts.map((acc) => {
                const hasWarnings = acc.warnings.length > 0
                const risk = acc.riskLevel || "low"

                let status: HealthStatus = "success"
                if (hasWarnings) {
                  status = risk === "high" ? "danger" : "warning"
                }

                return (
                  <li
                    key={acc.id}
                    className={cn(
                      "rounded-lg border p-4 text-card-foreground shadow-sm transition-colors",
                      status === "danger" &&
                        "border-l-4 border-l-destructive bg-red-500/5",
                      status === "warning" &&
                        "border-l-4 border-l-yellow-500 bg-yellow-500/5",
                      status === "success" &&
                        "border-l-4 border-l-emerald-500 bg-emerald-500/5"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <HealthShield status={status} size="sm" />
                        <div>
                          <h3 className="text-sm font-semibold tracking-wide uppercase">
                            {acc.accountName}
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            {acc.siteOrApp}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
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

                    {hasWarnings && (
                      <div className="mt-3 space-y-2">
                        {acc.warnings.map((w, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-2 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive"
                          >
                            <AlertTriangle
                              className="mt-0.5 size-4 shrink-0"
                              aria-hidden="true"
                            />
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

      <Card className="overflow-visible">
        <CardHeader>
          <CardTitle className="text-base">Tag Existing Account</CardTitle>
          <CardDescription className="text-xs">
            Choose a saved account to prioritize its security warnings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleQuickAdd}
            className="flex flex-col gap-4 sm:flex-row sm:items-end"
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="quick-account-name">Account name</Label>
              <div className="relative">
                <Input
                  id="quick-account-name"
                  placeholder="Type to search saved accounts"
                  value={accountName}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={
                    suggestionsOpen && matchingCredentials.length > 0
                  }
                  aria-controls="quick-account-suggestions"
                  aria-describedby={
                    emptyVault ? "quick-account-hint" : undefined
                  }
                  aria-activedescendant={
                    suggestionsOpen &&
                    activeSuggestionIndex >= 0 &&
                    matchingCredentials[activeSuggestionIndex]
                      ? `quick-account-option-${activeSuggestionIndex}`
                      : undefined
                  }
                  disabled={emptyVault}
                  onFocus={() => {
                    setSuggestionsOpen(true)
                    setActiveSuggestionIndex(0)
                  }}
                  onBlur={() => setSuggestionsOpen(false)}
                  onKeyDown={handleAccountKeyDown}
                  onChange={(event) => {
                    setAccountName(event.target.value)
                    setSelectedCredentialId(null)
                    // Highlight the top match so Enter cannot pick blind.
                    setActiveSuggestionIndex(0)
                    setSuggestionsOpen(true)
                    setFormError(null)
                  }}
                />
                {suggestionsOpen && matchingCredentials.length > 0 ? (
                  <ul
                    id="quick-account-suggestions"
                    className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                    role="listbox"
                    aria-label="Matching saved accounts"
                  >
                    {matchingCredentials.map((credential, index) => (
                      <li
                        key={credential.id}
                        id={`quick-account-option-${index}`}
                        ref={
                          index === activeSuggestionIndex
                            ? activeOptionRef
                            : undefined
                        }
                        className={cn(
                          "cursor-pointer rounded-sm px-3 py-2 text-sm",
                          index === activeSuggestionIndex
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent/50"
                        )}
                        role="option"
                        aria-selected={index === activeSuggestionIndex}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectCredential(credential)}
                      >
                        <span className="block font-medium">
                          {credential.accountName}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {credential.siteOrApp}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
            <div className="w-full space-y-1.5 sm:w-48">
              <Label htmlFor="quick-risk-level">Risk level</Label>
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
            <Button
              type="submit"
              className="h-7 px-4"
              disabled={busy || emptyVault}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Save risk level
            </Button>
          </form>
          {emptyVault ? (
            <p
              id="quick-account-hint"
              className="mt-2 text-xs text-muted-foreground"
            >
              Add a credential in the Vault before assigning a risk level.
            </p>
          ) : formError ? (
            <p className="mt-2 text-xs text-destructive" role="alert">
              {formError}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
