import { KeyRound, Pencil, Plus, ShieldCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { CredentialCopyActions } from "@/components/vault/credential-copy-actions"
import type { Credential } from "@/lib/vault/types"

export function CredentialList({
  credentials,
  onAddCredential,
  onEditCredential,
  editingCredentialId,
}: {
  credentials: Credential[]
  onAddCredential(): void
  onEditCredential(credential: Credential): void
  editingCredentialId: string | null
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-lg">Saved credentials</CardTitle>
        <CardDescription className="text-sm">
          {credentials.length === 0
            ? "Your vault is empty."
            : `${credentials.length} saved ${credentials.length === 1 ? "credential" : "credentials"}.`}
        </CardDescription>
        <CardAction>
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
            {credentials.map((credential) => (
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
  credential: Credential
  editing: boolean
  onEdit(): void
}) {
  return (
    <article
      className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-center sm:px-3 sm:py-2.5"
      data-credential-id={credential.id}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border"
          title="Encrypted in the saved vault"
        >
          <ShieldCheck className="size-4" aria-hidden="true" />
        </div>

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