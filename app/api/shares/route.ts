import {
  authenticatedUser,
  failure,
  json,
  originAllowed,
} from "@/lib/auth/server"
import {
  createShare,
  listPendingShares,
  RecipientNotFoundError,
  SelfShareError,
} from "@/lib/sharing/server"
import {
  CredentialValidationError,
  validateCredentialDraft,
} from "@/lib/vault/validation"
import type { CredentialDraft } from "@/lib/vault/types"

export const runtime = "nodejs"

const MAX_SHARE_REQUEST_BYTES = 4096

export async function GET(request: Request) {
  try {
    const user = await authenticatedUser(request)
    if (!user) return json({ error: "Not authenticated" }, 401)
    return json({ shares: await listPendingShares(user.id) })
  } catch {
    return failure()
  }
}

export async function POST(request: Request) {
  if (!originAllowed(request)) return json({ error: "Forbidden" }, 403)
  try {
    const user = await authenticatedUser(request)
    if (!user) return json({ error: "Not authenticated" }, 401)

    const body = await readBody(request)
    if (!body) return json({ error: "Invalid request" }, 400)

    const normalized = validateCredentialDraft(body.credential)

    const result = await createShare({
      fromUserId: user.id,
      fromEmail: user.email,
      toEmail: body.recipientEmail,
      credential: normalized,
    })
    return json(result, 201)
  } catch (error) {
    if (error instanceof RecipientNotFoundError)
      return json({ error: error.message }, 404)
    if (error instanceof SelfShareError)
      return json({ error: error.message }, 400)
    if (error instanceof CredentialValidationError)
      return json({ error: "Credential information is incomplete." }, 400)
    return failure()
  }
}

async function readBody(
  request: Request
): Promise<{ recipientEmail: string; credential: CredentialDraft } | null> {
  if (
    !/^application\/json(?:\s*;|\s*$)/i.test(
      request.headers.get("content-type") || ""
    ) ||
    !request.body
  )
    return null
  const declared = request.headers.get("content-length")
  if (
    declared &&
    (!/^\d+$/.test(declared) || Number(declared) > MAX_SHARE_REQUEST_BYTES)
  ) {
    void request.body.cancel().catch(() => undefined)
    return null
  }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_SHARE_REQUEST_BYTES) {
        void reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null
    const { recipientEmail, credential } = parsed as Record<string, unknown>
    if (
      typeof recipientEmail !== "string" ||
      !credential ||
      typeof credential !== "object" ||
      Array.isArray(credential)
    )
      return null
    const { accountName, siteOrApp, username, password, notes } =
      credential as Record<string, unknown>
    if (
      typeof accountName !== "string" ||
      typeof siteOrApp !== "string" ||
      typeof username !== "string" ||
      typeof password !== "string" ||
      (notes !== undefined && typeof notes !== "string")
    )
      return null
    return {
      recipientEmail,
      credential: { accountName, siteOrApp, username, password, notes },
    }
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}