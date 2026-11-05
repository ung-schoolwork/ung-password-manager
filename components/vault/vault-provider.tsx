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

import { useQuery, useQueryClient } from "@tanstack/react-query"

import { registerThisDevice } from "@/lib/devices/client"
import { DeviceNotApprovedError } from "@/lib/devices/shared"
import {
  fetchVaultRevision,
  RemoteVaultRepository,
} from "@/lib/vault/remote.client"
import { deriveAccountKeys } from "@/lib/vault/crypto.client"
import {
  CredentialConflictError,
  VaultService,
} from "@/lib/vault/service.client"
import type { Credential, CredentialDraft } from "@/lib/vault/types"

type VaultStatus =
  "loading" | "device-pending" | "locked" | "unlocked" | "error"

export const VAULT_POLL_INTERVAL_MS = 15_000
const DEVICE_POLL_INTERVAL_MS = 3_000

interface VaultContextValue {
  status: VaultStatus
  credentials: Credential[]
  busy: boolean
  initializationError: string | null
  /** The code to enter on an approved device while this device waits. */
  deviceCode: string | null
  /** Opens the vault with the account password. */
  unlockVault(password: string): Promise<void>
  lockVault(): void
  addCredential(draft: CredentialDraft): Promise<Credential>
  updateCredential(
    id: string,
    patch: Partial<CredentialDraft>,
    expectedUpdatedAt?: string
  ): Promise<Credential>
  removeCredential(id: string): Promise<void>
}

const VaultContext = createContext<VaultContextValue | null>(null)

const unavailable = async () => {
  throw new Error("The vault is not available on this device yet.")
}

interface VaultAccount {
  accountId: string
  email: string
  /** Derived at sign-in; opens the vault without asking for the password again. */
  unlockKey: CryptoKey | null
  onUnlockKeyUsed: () => void
}

// Holds the vault back until this browser is an approved device on the account.
export function VaultProvider({
  children,
  ...account
}: VaultAccount & { children: ReactNode }) {
  const { accountId } = account
  const device = useQuery({
    queryKey: ["device", accountId],
    queryFn: registerThisDevice,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.approved === false ? DEVICE_POLL_INTERVAL_MS : false,
    refetchOnWindowFocus: (query) => query.state.data?.approved === false,
  })
  const { refetch } = device
  const onDeviceRemoved = useCallback(() => void refetch(), [refetch])

  if (device.data?.approved) {
    return (
      <ApprovedVaultProvider
        key={device.data.deviceId}
        {...account}
        onDeviceRemoved={onDeviceRemoved}
      >
        {children}
      </ApprovedVaultProvider>
    )
  }

  const pending = device.data && !device.data.approved ? device.data : null
  const failed = device.isError && !device.data
  return (
    <VaultContext.Provider
      value={{
        status: pending ? "device-pending" : failed ? "error" : "loading",
        credentials: [],
        busy: false,
        initializationError: failed
          ? "This device could not be checked. Refresh the page and try again."
          : null,
        deviceCode: pending?.code ?? null,
        unlockVault: unavailable,
        lockVault: () => undefined,
        addCredential: unavailable,
        updateCredential: unavailable,
        removeCredential: unavailable,
      }}
    >
      {children}
    </VaultContext.Provider>
  )
}

function ApprovedVaultProvider({
  children,
  accountId,
  email,
  unlockKey,
  onUnlockKeyUsed,
  onDeviceRemoved,
}: VaultAccount & {
  children: ReactNode
  onDeviceRemoved: () => void
}) {
  const serviceRef = useRef<VaultService | null>(null)
  // With a key from sign-in the vault opens by itself; otherwise ask for the password.
  const [status, setStatus] = useState<VaultStatus>(() =>
    unlockKey ? "loading" : "locked"
  )
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [busy, setBusy] = useState(false)
  const [initializationError, setInitializationError] = useState<string | null>(
    null
  )

  useEffect(() => {
    const service = new VaultService(new RemoteVaultRepository())
    serviceRef.current = service

    return () => {
      service.lockVault()
      serviceRef.current = null
    }
  }, [accountId])
  // Pick up changes made on other approved devices while the vault is open.
  const revision = useQuery({
    queryKey: ["vault-revision", accountId],
    queryFn: fetchVaultRevision,
    enabled: status === "unlocked",
    retry: false,
    refetchInterval: VAULT_POLL_INTERVAL_MS,
  })
  const queryClient = useQueryClient()
  const { data: latestRevision, error: revisionError } = revision

  useEffect(() => {
    const service = serviceRef.current
    if (status !== "unlocked" || !service) return
    const removed = () => {
      service.lockVault()
      setCredentials([])
      setStatus("locked")
      queryClient.removeQueries({ queryKey: ["vault-revision", accountId] })
      onDeviceRemoved()
    }
    if (revisionError instanceof DeviceNotApprovedError) {
      removed()
      return
    }
    if (
      busy ||
      latestRevision === undefined ||
      latestRevision === service.knownRevision()
    )
      return
    service
      .refresh()
      .then(() => {
        if (serviceRef.current === service)
          setCredentials(service.listCredentials())
      })
      .catch((caught) => {
        if (caught instanceof DeviceNotApprovedError) removed()
        // Other failures retry on the next check; the open vault stays usable.
      })
  }, [
    status,
    busy,
    latestRevision,
    revisionError,
    accountId,
    onDeviceRemoved,
    queryClient,
  ])

  const requireService = useCallback(() => {
    if (!serviceRef.current) throw new Error("The vault is still loading.")
    return serviceRef.current
  }, [])

  const refreshCredentials = useCallback((service: VaultService) => {
    if (serviceRef.current !== service) return
    setCredentials(service.listCredentials())
  }, [])

  const syncVaultRevision = useCallback(
    async (service: VaultService) => {
      if (serviceRef.current !== service) return
      const queryKey = ["vault-revision", accountId]
      await queryClient.cancelQueries({ queryKey })
      queryClient.setQueryData(queryKey, service.knownRevision())
    },
    [accountId, queryClient]
  )

  // Open the vault with the key derived when the user signed in, so signing
  // in is the only time they enter their password.
  useEffect(() => {
    const service = serviceRef.current
    if (!unlockKey || !service || service.isUnlocked()) return
    let active = true
    service
      .unlockVault(unlockKey)
      .then(async () => {
        if (!active || serviceRef.current !== service) return
        refreshCredentials(service)
        await syncVaultRevision(service)
        if (!active) return
        setStatus("unlocked")
        onUnlockKeyUsed()
      })
      .catch((caught) => {
        if (!active || serviceRef.current !== service) return
        if (caught instanceof DeviceNotApprovedError) onDeviceRemoved()
        setInitializationError(
          "Your vault could not be opened. Enter your password to try again."
        )
        setStatus("locked")
        onUnlockKeyUsed()
      })
    return () => {
      active = false
    }
  }, [
    unlockKey,
    onUnlockKeyUsed,
    onDeviceRemoved,
    refreshCredentials,
    syncVaultRevision,
  ])

  const unlockVault = useCallback(
    async (password: string) => {
      const service = requireService()
      setBusy(true)
      try {
        const { wrappingKey } = await deriveAccountKeys(email, password)
        await service.unlockVault(wrappingKey)
        if (serviceRef.current !== service) return
        refreshCredentials(service)
        await syncVaultRevision(service)
        setInitializationError(null)
        setStatus("unlocked")
      } finally {
        setBusy(false)
      }
    },
    [email, refreshCredentials, requireService, syncVaultRevision]
  )

  const lockVault = useCallback(() => {
    serviceRef.current?.lockVault()
    setCredentials([])
    setStatus("locked")
  }, [])

  const addCredential = useCallback(
    async (draft: CredentialDraft) => {
      const service = requireService()
      setBusy(true)
      try {
        const credential = await service.saveCredential(draft)
        refreshCredentials(service)
        await syncVaultRevision(service)
        return credential
      } finally {
        setBusy(false)
      }
    },
    [refreshCredentials, requireService, syncVaultRevision]
  )

  const updateCredential = useCallback(
    async (
      id: string,
      patch: Partial<CredentialDraft>,
      expectedUpdatedAt?: string
    ) => {
      const service = requireService()
      setBusy(true)
      try {
        const credential = await service.updateCredential(
          id,
          patch,
          expectedUpdatedAt
        )
        refreshCredentials(service)
        await syncVaultRevision(service)
        return credential
      } catch (error) {
        // The service now holds the newer vault; show it in the list too.
        if (error instanceof CredentialConflictError) {
          refreshCredentials(service)
          await syncVaultRevision(service)
        }
        throw error
      } finally {
        setBusy(false)
      }
    },
    [refreshCredentials, requireService, syncVaultRevision]
  )

  const removeCredential = useCallback(
    async (id: string) => {
      const service = requireService()
      setBusy(true)
      try {
        await service.removeCredential(id)
        refreshCredentials(service)
        await syncVaultRevision(service)
      } finally {
        setBusy(false)
      }
    },
    [refreshCredentials, requireService, syncVaultRevision]
  )

  return (
    <VaultContext.Provider
      value={{
        status,
        credentials,
        busy,
        initializationError,
        deviceCode: null,
        unlockVault,
        lockVault,
        addCredential,
        updateCredential,
        removeCredential,
      }}
    >
      {children}
    </VaultContext.Provider>
  )
}

export function useVault(): VaultContextValue {
  const context = useContext(VaultContext)
  if (!context) throw new Error("useVault must be used inside VaultProvider.")
  return context
}
