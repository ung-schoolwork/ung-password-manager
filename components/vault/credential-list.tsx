"use client"

import { useMemo } from "react"
import { KeyRound, Plus } from "lucide-react"
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
import { HealthShield } from "@/components/vault/health-shield"
import { analyzeCredentialsHealth } from "@/lib/vault/health"
import type { Credential } from "@/lib/vault/types"

export function CredentialList({
  credentials,
  onAddCredential,
}: {
  credentials: Credential[]
  onAddCredential(): void
}) {
  // Use the audit logic to determine the health color for each row
  const audited = useMemo(() => analyzeCredentialsHealth(credentials), [credentials])

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-lg">Saved credentials</CardTitle>
        <CardDescription className="text-sm">
          {credentials.length === 0 ? "Vault is empty." : `${credentials.length} saved accounts.`}
        </CardDescription>
        <CardAction>
          <Button onClick={onAddCredential}><Plus className="size-4" />Add</Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {credentials.length === 0 ? (
          <div className="min-h-32 grid place-items-center border-dashed border rounded-lg bg-muted/20">
            <p className="text-muted-foreground text-sm">No credentials yet.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {audited.map((credential) => (
              <li key={credential.id}>
                <CredentialRow credential={credential} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function CredentialRow({ credential }: { credential: any }) {
  const hasWarnings = credential.warnings.length > 0
  const status = !hasWarnings ? "success" : (credential.riskLevel === "high" ? "danger" : "warning")

  return (
    <article className="flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2.5">
      <HealthShield status={status} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold">{credential.accountName}</span>
          <span className="truncate text-xs text-muted-foreground">{credential.siteOrApp}</span>
        </div>
        <div className="text-xs text-muted-foreground truncate">{credential.username}</div>
      </div>
      <CredentialCopyActions username={credential.username} password={credential.password} />
    </article>
  )
}
