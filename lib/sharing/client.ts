import type { CredentialDraft } from "@/lib/vault/types"

export class ShareRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = "ShareRequestError"
  }
}

export interface IncomingShare {
  id: string
  fromEmail: string
  credential: CredentialDraft
  createdAt: string
}

async function sharesRequest<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
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
    try {
      const body = (await response.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch {
      // Ignore bodies that are not JSON.
    }
    throw new ShareRequestError(message, response.status)
  }
  try {
    return (await response.json()) as T
  } catch {
    return undefined as T
  }
}

export async function shareCredential(
  recipientEmail: string,
  credential: CredentialDraft
): Promise<void> {
  await sharesRequest("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipientEmail, credential }),
  })
}

export async function listIncomingShares(): Promise<IncomingShare[]> {
  const result = await sharesRequest<{ shares: IncomingShare[] }>("")
  return result.shares
}

export async function respondToShare(id: string): Promise<void> {
  await sharesRequest(`/${encodeURIComponent(id)}`, { method: "DELETE" })
}