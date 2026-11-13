"use client"

import { useMemo, useRef, useState } from "react"
import { KeyRound, Pencil, Plus, Share2, Upload } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CredentialCopyActions } from "@/components/vault/credential-copy-actions"
import {
  getHealthStatusLabel,
  getHealthStatusText,
  getHealthStatusTextClassName,
  HealthShield,
} from "@/components/vault/health-shield"
import { ShareCredentialDialog } from "@/components/vault/share-credential-dialog"
import { usePassphraseWordSet } from "@/components/vault/use-passphrase-word-set"
import {
  analyzeCredentialsHealth,
  type CredentialHealthReport,
} from "@/lib/vault/health"
import { indexCredentialSearch, searchCredentials } from "@/lib/vault/search"
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
  const passphraseWords = usePassphraseWordSet()
  const audited = useMemo(
    () => analyzeCredentialsHealth(credentials, passphraseWords),
    [credentials, passphraseWords]
  )
  const [credentialToShare, setCredentialToShare] = useState<Credential | null>(
    null
  )
  const [searchValue, setSearchValue] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)
  const query = searchValue.trim().toLowerCase()
  const searchableCredentials = useMemo(
    () => indexCredentialSearch(audited),
    [audited]
  )
  const filteredCredentials = useMemo(
    () => searchCredentials(searchableCredentials, query),
    [query, searchableCredentials]
  )

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-lg">Saved credentials</CardTitle>
        <CardDescription className="text-sm">
          {credentials.length === 0
            ? "Your vault is empty."
            : query
              ? `Showing ${filteredCredentials.length} of ${credentials.length} ${
                  credentials.length === 1 ? "credential" : "credentials"
                }.`
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
          <div className="space-y-4">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="credential-search">Search credentials</Label>
                <Input
                  ref={searchInputRef}
                  id="credential-search"
                  type="search"
                  placeholder="Search by account, website, or username"
                  value={searchValue}
                  onChange={(event) => setSearchValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && searchValue.length > 0) {
                      event.preventDefault()
                      setSearchValue("")
                    }
                  }}
                />
              </div>
              {searchValue.length > 0 ? (
                <Button
                  className="h-9 px-3 text-sm"
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSearchValue("")
                    searchInputRef.current?.focus()
                  }}
                >
                  Clear search
                </Button>
              ) : null}
            </div>
            {query && filteredCredentials.length === 0 ? (
              <p
                className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
                role="status"
              >
                No credentials match &quot;{searchValue.trim()}&quot;.
              </p>
            ) : (
              <ul
                className="flex flex-col gap-2"
                aria-label="Saved credentials"
              >
                {filteredCredentials.map((credential) => (
                  <li key={credential.id}>
                    <CredentialRow
                      credential={credential}
                      editing={credential.id === editingCredentialId}
                      onEdit={() => onEditCredential(credential)}
                      onShare={() => setCredentialToShare(credential)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>

      {credentialToShare ? (
        <ShareCredentialDialog
          credential={credentialToShare}
          open
          onOpenChange={(open) => {
            if (!open) setCredentialToShare(null)
          }}
        />
      ) : null}
    </Card>
  )
}

function CredentialRow({
  credential,
  editing,
  onEdit,
  onShare,
}: {
  credential: CredentialHealthReport
  editing: boolean
  onEdit(): void
  onShare(): void
}) {
  const hasWarnings = credential.warnings.length > 0
  const status = !hasWarnings
    ? "success"
    : credential.riskLevel === "high"
      ? "danger"
      : "warning"

  return (
    <article
      className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-center sm:px-3 sm:py-2.5"
      data-credential-id={credential.id}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Link
          aria-label={`Password health for ${credential.accountName}: ${getHealthStatusLabel(status)}`}
          className="flex shrink-0 items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          href="/health"
        >
          <HealthShield status={status} size="sm" />
          <span
            className={cn(
              "text-xs font-medium",
              getHealthStatusTextClassName(status)
            )}
          >
            {getHealthStatusText(status)}
          </span>
        </Link>

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
        <div className="flex gap-2">
          <Button
            className="h-9 px-3 text-sm"
            type="button"
            variant="outline"
            aria-label={`Share ${credential.accountName}`}
            onClick={onShare}
          >
            <Share2 className="size-4" aria-hidden="true" />
            Share
          </Button>
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
        </div>
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
