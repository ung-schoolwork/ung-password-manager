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
  PENDING_SIGN_OUT,
  withAccountMutation,
  type AccountSession,
} from "@/lib/auth/client"

type AccountStatus = "loading" | "signed-out" | "signed-in" | "error"
interface AccountContextValue {
  status: AccountStatus
  session: AccountSession | null
  error: string | null
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
  const generation = useRef(0)
  const channel = useRef<BroadcastChannel | null>(null)
  const signedOutLocally = useRef(false)
  const refreshing = useRef(false)
  const refreshQueued = useRef(false)

  const forget = useCallback(() => {
    generation.current += 1
    signedOutLocally.current = true
    setSession(null)
    setStatus("signed-out")
    setError(null)
  }, [])

  const refresh = useCallback(
    async function refreshAccount(): Promise<void> {
      if (signedOutLocally.current) return
      if (signOutIsPending()) {
        forget()
        setError("Sign-out could not be completed. Try signing out again.")
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
          setError("Your account could not be reached. Try again.")
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
      const current = ++generation.current
      signedOutLocally.current = true
      await withAccountMutation(async () => {
        if (current !== generation.current)
          throw new Error("Sign-in was interrupted. Try again.")
        if (signOutIsPending()) {
          await accountRequest("logout", {})
          markSignOutPending(false)
        }
        if (current !== generation.current)
          throw new Error("Sign-in was interrupted. Try again.")
        const next = await accountRequest<AccountSession>(mode, {
          email,
          password,
        })
        if (current !== generation.current || signOutIsPending()) {
          // A stale response may already have installed a cookie. Revoke it,
          // rather than merely discarding its React state.
          markSignOutPending(true)
          try {
            await accountRequest("logout", {})
            markSignOutPending(false)
            channel.current?.postMessage("sign-out-complete")
          } catch {
            setError("Sign-out could not be completed. Try signing out again.")
          }
          throw new Error("Sign-in was interrupted. Try again.")
        }
        markSignOutPending(false)
        signedOutLocally.current = false
        setError(null)
        setSession(next)
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
        setError("Sign-out could not be completed. Try signing out again.")
    }
  }, [forget])

  return (
    <AccountContext.Provider
      value={{ status, session, error, authenticate, signOut, refresh }}
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
