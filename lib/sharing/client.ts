import type { ShareRemovedBy, ShareStatus } from "@/lib/sharing/status"
import type { CredentialDraft } from "@/lib/vault/types"

export class ShareRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** For a share whose access has ended, how it ended. */
    readonly shareStatus?: Exclude<ShareStatus, "active">
  ) {
    super(message)
    this.name = "ShareRequestError"
  }
}

interface ShareDetails {
  id: string
  accountName: string
  siteOrApp: string
  status: ShareStatus
  removedBy: ShareRemovedBy | null
  createdAt: string
  expiresAt: string | null
  endedAt: string | null
}

/** A share sent to this account. The credential is read separately. */
export interface IncomingShare extends ShareDetails {
  fromEmail: string
}

/** A share this account sent. */
export interface OutgoingShare extends ShareDetails {
  toEmail: string
}

async function sharesRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/shares${path}`, {
      credentials: "same-origin",
      cache: "no-store",
      ...init,
    })
  } catch {
    throw new ShareRequestError("Could not reach the server. Try again.", 0)
  }
  if (!response.ok) {
    let message = "Something went wrong. Try again."
    let shareStatus: "expired" | "removed" | undefined
    try {
      const body = (await response.json()) as {
        error?: string
        status?: unknown
      }
      if (body?.error) message = body.error
      if (body?.status === "expired" || body?.status === "removed")
        shareStatus = body.status
    } catch {
      // Ignore bodies that are not JSON.
    }
    throw new ShareRequestError(message, response.status, shareStatus)
  }
  try {
    return (await response.json()) as T
  } catch {
    return undefined as T
  }
}

export async function shareCredential(
  recipientEmail: string,
  credential: CredentialDraft,
  expiresAt: Date | null = null
): Promise<void> {
  await sharesRequest("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipientEmail,
      credential,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    }),
  })
}

export async function listShares(): Promise<{
  incoming: IncomingShare[]
  outgoing: OutgoingShare[]
}> {
  return sharesRequest("")
}

/** Reads a shared credential. Fails with a 410 once access has ended. */
export async function readSharedCredential(
  id: string
): Promise<{ credential: CredentialDraft; expiresAt: string | null }> {
  return sharesRequest(`/${encodeURIComponent(id)}`)
}

/**
 * Revokes a share you sent, declines one sent to you, or clears a share that
 * has already ended from your list.
 */
export async function removeShare(id: string): Promise<void> {
  await sharesRequest(`/${encodeURIComponent(id)}`, { method: "DELETE" })
}

const changeListeners = new Set<() => void>()

/** Tells open share lists that a share was created or ended on this page. */
export function notifySharesChanged(): void {
  for (const listener of changeListeners) listener()
}

export function onSharesChanged(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}
