"use client"

import { useMemo } from "react"
import { AlertTriangle, CheckCircle2, KeyRound, Pencil, Plus, Upload } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { CredentialCopyActions } from "@/components/vault/credential-copy-actions"
import {
  getHealthStatusLabel,
  HealthShield,
} from "@/components/vault/health-shield"
import {
  analyzeCredentialsHealth,
  type CredentialHealthReport,
} from "@/lib/vault/health"
import type { Credential } from "@/lib/vault/types"
import { cn } from "@/lib/utils"

export function CredentialList({
  credentials,
  onAddCredential,
  onImportCredentials,
  onEditCredential,
  editingCredentialId,
}: {
  credentials: Credential[]
  onAddCredential(): void
  onImportCredentials(): void
  onEditCredential(credential: Credential): void
  editingCredentialId: string | null
}) {
  const audited = useMemo(
    () => analyzeCredentialsHealth(credentials),
    [credentials]
  )

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-lg">Saved credentials</CardTitle>
        <CardDescription className="text-sm">
          {credentials.length === 0
            ? "Your vault is empty."
            : `${credentials.length} saved ${credentials.length === 1 ? "credential" : "credentials"}.`}
        </CardDescription>
        <CardAction className="flex gap-2">
          <Button
            className="h-9 px-3 text-sm"
            type="button"
            variant="outline"
            onClick={onImportCredentials}
          >
            <Upload className="size-4" aria-hidden="true" />
            Import credentials
          </Button>
          <Button
            className="h-9 px-3 text-sm"
            type="button"
            onClick={onAddCredential}
          >
            <Plus className="size-4" aria-hidden="true" />
            Add credential
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {credentials.length === 0 ? (
          <div className="grid min-h-64 place-items-center rounded-lg border border-dashed bg-muted/20 p-8 text-center">
            <div>
              <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <KeyRound className="size-5" aria-hidden="true" />
              </div>
              <p className="mt-4 font-medium">No credentials yet</p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Add your first credential to get started.
              </p>
              <Button
                className="mt-4 h-9 px-3 text-sm"
                type="button"
                onClick={onAddCredential}
              >
                <Plus className="size-4" aria-hidden="true" />
                Add credential
              </Button>
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Saved credentials">
            {audited.map((credential) => (
              <li key={credential.id}>
                <CredentialRow
                  credential={credential}
                  editing={credential.id === editingCredentialId}
                  onEdit={() => onEditCredential(credential)}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function CredentialRow({
  credential,
  editing,
  onEdit,
}: {
  credential: CredentialHealthReport
  editing: boolean
  onEdit(): void
}) {
  const hasWarnings = credential.warnings.length > 0
  const risk = credential.riskLevel || "low"
  const status = !hasWarnings
    ? "success"
    : risk === "high"
      ? "danger"
      : "warning"

  return (
    <article
      className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-center sm:px-3 sm:py-2.5"
      data-credential-id={credential.id}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label={`Password health for ${credential.accountName}: ${getHealthStatusLabel(status)}`}
                className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/40 cursor-pointer"
              />
            }
          >
            <HealthShield status={status} size="sm" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <PopoverTitle className="truncate font-semibold text-sm">
                  {credential.accountName}
                </PopoverTitle>
                <PopoverDescription className="truncate text-xs text-muted-foreground">
                  {credential.siteOrApp}
                </PopoverDescription>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[0.6875rem] font-bold uppercase",
                    risk === "high"
                      ? "bg-destructive/10 text-destructive"
                      : risk === "medium"
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  )}
                >
                  {risk}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[0.6875rem] font-bold",
                    hasWarnings
                      ? "bg-destructive/10 text-destructive"
                      : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  )}
                >
                  {hasWarnings
                    ? `${credential.warnings.length} ${
                        credential.warnings.length === 1 ? "issue" : "issues"
                      }`
                    : "No warnings"}
                </span>
              </div>
            </div>

            {hasWarnings ? (
              <div className="space-y-1.5 max-h-48 overflow-y-auto" role="list" aria-label="Password warnings">
                {credential.warnings.map((w, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive"
                  >
                    <AlertTriangle
                      className="mt-0.5 size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    <div>
                      <span className="font-bold">{w.type}: </span>
                      <span>{w.explanation}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-400">
                <CheckCircle2
                  className="size-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span>No security issues found for this password.</span>
              </div>
            )}

            <div className="border-t pt-2">
              <Link
                href="/health"
                className="text-xs font-medium text-primary underline underline-offset-4 hover:text-primary/80"
              >
                View full health report →
              </Link>
            </div>
          </PopoverContent>
        </Popover>

        <dl className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <dt className="sr-only">Account label</dt>
            <dd className="truncate text-sm font-semibold">
              {credential.accountName}
            </dd>
            <dt className="sr-only">Website or app</dt>
            <dd className="truncate text-xs text-muted-foreground">
              {credential.siteOrApp}
            </dd>
          </div>

          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <dt className="sr-only">Username</dt>
            <dd className="truncate">{credential.username}</dd>
            <span aria-hidden="true">{"\u00B7"}</span>
            <dt className="sr-only">Password</dt>
            <dd
              className="shrink-0 font-mono tracking-wider"
              aria-label="Password hidden"
            >
              {"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}
            </dd>
          </div>
          {credential.notes ? (
            <div
              className={`mt-1 min-w-0 text-xs text-muted-foreground ${
                credential.updatedAt !== credential.createdAt
                  ? "flex"
                  : "hidden sm:flex"
              }`}
            >
              <dt className="sr-only">Notes</dt>
              <dd className="break-words">{credential.notes}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2 border-t pt-2 sm:border-t-0 sm:pt-0">
        <Button
          className="h-9 px-3 text-sm"
          type="button"
          variant="outline"
          aria-label={`Edit ${credential.accountName}`}
          onClick={onEdit}
        >
          <Pencil className="size-4" aria-hidden="true" />
          Edit
        </Button>
        {editing ? null : (
          <CredentialCopyActions
            username={credential.username}
            password={credential.password}
          />
        )}
      </div>
    </article>
  )
}
