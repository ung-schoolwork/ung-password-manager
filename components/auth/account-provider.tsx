"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  accountRequest,
  AccountRequestError,
  markSignOutPending,
  signOutIsPending,
  signOutGeneration,
  PENDING_SIGN_OUT,
  withAccountMutation,
  type AccountProof,
  type AccountSession,
} from "@/lib/auth/client"
import { ACCOUNT_ERROR_MESSAGES } from "@/lib/auth/messages"
import { accountPasswordProblem } from "@/lib/auth/shared"
import {
  createWrappedVaultKey,
  deriveAccountKeys,
} from "@/lib/vault/crypto.client"

type AccountStatus = "loading" | "signed-out" | "signed-in" | "error"
/** The key that opens this account's vault, kept from sign-in until used. */
export interface VaultUnlockKey {
  userId: string
  wrappingKey: CryptoKey
}
interface AccountContextValue {
  status: AccountStatus
  session: AccountSession | null
  error: string | null
  vaultUnlockKey: VaultUnlockKey | null
  /** Forgets the sign-in key once the vault has been opened with it. */
  releaseVaultUnlockKey(): void
  authenticate(
    mode: "login" | "register",
    email: string,
    password: string
  ): Promise<void>
  signOut(): Promise<void>
  refresh(): Promise<void>
}
const AccountContext = createContext<AccountContextValue | null>(null)
const CHANNEL = "ung-password-manager:account"

export function AccountProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AccountStatus>("loading")
  const [session, setSession] = useState<AccountSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vaultUnlockKey, setVaultUnlockKey] = useState<VaultUnlockKey | null>(
    null
  )
  const generation = useRef(0)
  const channel = useRef<BroadcastChannel | null>(null)
  const signedOutLocally = useRef(false)
  const refreshing = useRef(false)
  const refreshQueued = useRef(false)

  const forget = useCallback(() => {
    generation.current += 1
    signedOutLocally.current = true
    setSession(null)
    setVaultUnlockKey(null)
    setStatus("signed-out")
    setError(null)
  }, [])

  const refresh = useCallback(
    async function refreshAccount(): Promise<void> {
      if (signedOutLocally.current) return
      if (signOutIsPending()) {
        forget()
        setError(ACCOUNT_ERROR_MESSAGES.session.signOutFailed)
        return
      }
      if (refreshing.current) {
        refreshQueued.current = true
        return
      }
      refreshing.current = true
      const current = generation.current
      try {
        const next = await accountRequest<AccountSession>("session")
        if (current !== generation.current || signedOutLocally.current) return
        if (Date.parse(next.expiresAt) <= Date.now()) {
          forget()
          return
        }
        setSession(next)
        setStatus("signed-in")
        setError(null)
      } catch (caught) {
        if (current !== generation.current || signedOutLocally.current) return
        setSession(null)
        if (caught instanceof AccountRequestError && caught.status === 401) {
          setStatus("signed-out")
          setError(null)
        } else {
          setStatus("error")
          setError(ACCOUNT_ERROR_MESSAGES.request.accountUnavailable)
        }
      } finally {
        refreshing.current = false
        if (refreshQueued.current) {
          refreshQueued.current = false
          void refreshAccount()
        }
      }
    },
    [forget]
  )

  useEffect(() => {
    const initial = setTimeout(() => {
      void refresh()
    }, 0)
    const timer = setInterval(() => {
      void refresh()
    }, 30_000)
    const onFocus = () => {
      void refresh()
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh()
    }
    window.addEventListener("focus", onFocus)
    const onStorage = (event: StorageEvent) => {
      if (event.key === PENDING_SIGN_OUT && event.newValue === "true") forget()
    }
    window.addEventListener("storage", onStorage)
    document.addEventListener("visibilitychange", onVisibility)
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel(CHANNEL)
      channel.current.onmessage = (event) => {
        if (event.data === "signed-out") forget()
        else if (event.data === "account-changed") {
          if (signOutIsPending()) return
          // Hide the old account before checking the newly established session.
          generation.current += 1
          signedOutLocally.current = false
          setSession(null)
          setVaultUnlockKey(null)
          setStatus("loading")
          void refresh()
        } else if (event.data === "sign-out-complete" && !signOutIsPending()) {
          setError(null)
        }
      }
    }
    return () => {
      generation.current += 1
      clearInterval(timer)
      clearTimeout(initial)
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("storage", onStorage)
      document.removeEventListener("visibilitychange", onVisibility)
      channel.current?.close()
      channel.current = null
    }
  }, [forget, refresh])

  useEffect(() => {
    if (!session) return
    const remaining = Date.parse(session.expiresAt) - Date.now()
    const timer = setTimeout(
      () => {
        forget()
        channel.current?.postMessage("signed-out")
      },
      Math.max(0, remaining)
    )
    return () => clearTimeout(timer)
  }, [session, forget])

  const authenticate = useCallback(
    async (mode: "login" | "register", email: string, password: string) => {
      if (mode === "register") {
        const problem = accountPasswordProblem(password)
        if (problem) throw new Error(problem)
      }
      // The password stays in the browser. The server receives only a key
      // derived from it that cannot decrypt the vault.
      const keys = await deriveAccountKeys(email, password)
      const proof: AccountProof = { email, authKey: keys.authKey }
      if (mode === "register")
        proof.wrappedVaultKey = await createWrappedVaultKey(keys.wrappingKey)
      const current = ++generation.current
      const signOutAtStart = signOutGeneration()
      signedOutLocally.current = true
      await withAccountMutation(async () => {
        if (
          current !== generation.current ||
          signOutAtStart !== signOutGeneration()
        )
          throw new Error(ACCOUNT_ERROR_MESSAGES.session.signInInterrupted)
        if (signOutIsPending()) {
          await accountRequest("logout", {})
          markSignOutPending(false)
        }
        if (
          current !== generation.current ||
          signOutAtStart !== signOutGeneration()
        )
          throw new Error(ACCOUNT_ERROR_MESSAGES.session.signInInterrupted)
        const next = await accountRequest<AccountSession>(mode, proof)
        if (
          current !== generation.current ||
          signOutIsPending() ||
          signOutAtStart !== signOutGeneration()
        ) {
          // A stale response may already have installed a cookie. Revoke it,
          // rather than merely discarding its React state.
          markSignOutPending(true)
          try {
            await accountRequest("logout", {})
            markSignOutPending(false)
            channel.current?.postMessage("sign-out-complete")
          } catch {
            setError(ACCOUNT_ERROR_MESSAGES.session.signOutFailed)
          }
          throw new Error(ACCOUNT_ERROR_MESSAGES.session.signInInterrupted)
        }
        markSignOutPending(false)
        signedOutLocally.current = false
        setError(null)
        setSession(next)
        setVaultUnlockKey({
          userId: next.user.id,
          wrappingKey: keys.wrappingKey,
        })
        setStatus("signed-in")
        channel.current?.postMessage("account-changed")
      })
    },
    []
  )

  const signOut = useCallback(async () => {
    // Remove all account-bound UI immediately, even if revocation fails.
    markSignOutPending(true)
    forget()
    channel.current?.postMessage("signed-out")
    const current = generation.current
    try {
      await withAccountMutation(() => accountRequest("logout", {}))
      markSignOutPending(false)
      channel.current?.postMessage("sign-out-complete")
    } catch {
      if (current === generation.current)
        setError(ACCOUNT_ERROR_MESSAGES.session.signOutFailed)
    }
  }, [forget])

  const releaseVaultUnlockKey = useCallback(() => setVaultUnlockKey(null), [])

  return (
    <AccountContext.Provider
      value={{
        status,
        session,
        error,
        vaultUnlockKey,
        releaseVaultUnlockKey,
        authenticate,
        signOut,
        refresh,
      }}
    >
      {children}
    </AccountContext.Provider>
  )
}

export function useAccount() {
  const context = useContext(AccountContext)
  if (!context) throw new Error("AccountProvider is required.")
  return context
}
