export interface AccountSession {
  user: { id: string; email: string }
  expiresAt: string
}

export async function accountRequest<T>(
  path: string,
  body?: { email: string; password: string } | Record<string, never>
): Promise<T> {
  const response = await fetch(`/api/auth/${path}`, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new AccountRequestError(
      typeof data?.error === "string"
        ? data.error
        : "Your account could not be reached. Try again.",
      response.status
    )
  }
  return data as T
}

export class AccountRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = "AccountRequestError"
  }
}

const MUTATION_LOCK = "ung-password-manager:account-mutation"
export const PENDING_SIGN_OUT = "ung-password-manager:pending-sign-out"
const SIGN_OUT_GENERATION = "ung-password-manager:sign-out-generation"
let localSignOutGeneration = ""
let localMutation: Promise<unknown> = Promise.resolve()

// Cookies are installed by the browser before fetch resolves. Serialize account
// mutations across tabs, then revoke any successful auth response made stale by logout.
export async function withAccountMutation<T>(
  work: () => Promise<T>
): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return await navigator.locks.request(MUTATION_LOCK, work)
  }
  const result = localMutation.then(work, work)
  localMutation = result.catch(() => undefined)
  return result
}

// Keep this generation after logout completes: the pending flag alone cannot
// invalidate an in-flight login when cross-tab notifications arrive late.
export function signOutGeneration(): string {
  try {
    return (
      window.localStorage.getItem(SIGN_OUT_GENERATION) || localSignOutGeneration
    )
  } catch {
    return localSignOutGeneration
  }
}
export function signOutIsPending(): boolean {
  try {
    return window.localStorage.getItem(PENDING_SIGN_OUT) === "true"
  } catch {
    return false
  }
}

export function markSignOutPending(pending: boolean): void {
  if (pending) localSignOutGeneration = crypto.randomUUID()
  try {
    if (pending) {
      window.localStorage.setItem(SIGN_OUT_GENERATION, localSignOutGeneration)
      window.localStorage.setItem(PENDING_SIGN_OUT, "true")
    } else window.localStorage.removeItem(PENDING_SIGN_OUT)
  } catch {
    /* The in-memory guard still applies when storage is unavailable. */
  }
}
