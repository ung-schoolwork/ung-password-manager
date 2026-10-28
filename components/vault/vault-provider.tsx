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
import {
  localVaultSources as findLocalVaultSources,
  readLocalVault,
  type LocalVaultSource,
} from "@/lib/vault/local-migration.client"
import {
  CredentialConflictError,
  VaultService,
} from "@/lib/vault/service.client"
import type { Credential, CredentialDraft } from "@/lib/vault/types"

type VaultStatus =
  "loading" | "device-pending" | "needs-setup" | "locked" | "unlocked" | "error"

export const VAULT_POLL_INTERVAL_MS = 15_000
const DEVICE_POLL_INTERVAL_MS = 3_000

interface VaultContextValue {
  status: VaultStatus
  credentials: Credential[]
  busy: boolean
  initializationError: string | null
  /** The code to enter on an approved device while this device waits. */
  deviceCode: string | null
  localVaultSources: LocalVaultSource[]
  migrateVault(source: LocalVaultSource, passphrase: string): Promise<void>
  createVault(passphrase: string): Promise<void>
  unlockVault(passphrase: string): Promise<void>
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

// Holds the vault back until this browser is an approved device on the account.
export function VaultProvider({
  children,
  accountId,
}: {
  children: ReactNode
  accountId: string
}) {
  const device = useQuery({
    queryKey: ["device", accountId],
    queryFn: registerThisDevice,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.approved === false ? DEVICE_POLL_INTERVAL_MS : false,
    refetchOnWindowFocus: (query) => query.state.data?.approved === false,
  })
  const { refetch } = device

  if (device.data?.approved) {
    return (
      <ApprovedVaultProvider
        key={device.data.deviceId}
        accountId={accountId}
        onDeviceRemoved={() => void refetch()}
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
        localVaultSources: [],
        migrateVault: unavailable,
        createVault: unavailable,
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
  onDeviceRemoved,
}: {
  children: ReactNode
  accountId: string
  onDeviceRemoved: () => void
}) {
  const serviceRef = useRef<VaultService | null>(null)
  const [status, setStatus] = useState<VaultStatus>("loading")
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [busy, setBusy] = useState(false)
  const [localVaultSources, setLocalVaultSources] = useState<
    LocalVaultSource[]
  >([])
  const [initializationError, setInitializationError] = useState<string | null>(
    null
  )

  useEffect(() => {
    let active = true
    const repository = new RemoteVaultRepository()
    const service = new VaultService(repository)
    serviceRef.current = service

    void service
      .hasVault()
      .then((hasVault) => {
        if (!active) return
        if (!hasVault) {
          try {
            setLocalVaultSources(
              findLocalVaultSources(window.localStorage, accountId)
            )
          } catch {
            // Remote vaults remain usable when local storage is unavailable.
            setLocalVaultSources([])
          }
        }
        setStatus(hasVault ? "locked" : "needs-setup")
      })
      .catch(() => {
        if (!active) return
        setInitializationError(
          "Your saved vault could not be opened. Refresh the page and try again."
        )
        setStatus("error")
      })

    return () => {
      active = false
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

  const createVault = useCallback(
    async (passphrase: string) => {
      const service = requireService()
      setBusy(true)
      try {
        await service.createVault(passphrase)
        if (serviceRef.current !== service) return
        refreshCredentials(service)
        setStatus("unlocked")
      } finally {
        setBusy(false)
      }
    },
    [refreshCredentials, requireService]
  )

  const migrateVault = useCallback(
    async (source: LocalVaultSource, passphrase: string) => {
      const service = requireService()
      setBusy(true)
      try {
        let storage: Storage
        try {
          storage = window.localStorage
        } catch {
          throw new Error("Your existing vault could not be opened.")
        }
        const envelope = readLocalVault(storage, accountId, source)
        await service.migrateVault(passphrase, envelope)
        if (serviceRef.current !== service) return
        refreshCredentials(service)
        setStatus("unlocked")
      } finally {
        setBusy(false)
      }
    },
    [accountId, refreshCredentials, requireService]
  )
  const unlockVault = useCallback(
    async (passphrase: string) => {
      const service = requireService()
      setBusy(true)
      try {
        await service.unlockVault(passphrase)
        if (serviceRef.current !== service) return
        refreshCredentials(service)
        setStatus("unlocked")
      } finally {
        setBusy(false)
      }
    },
    [refreshCredentials, requireService]
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
        return credential
      } finally {
        setBusy(false)
      }
    },
    [refreshCredentials, requireService]
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
        return credential
      } catch (error) {
        // The service now holds the newer vault; show it in the list too.
        if (error instanceof CredentialConflictError)
          refreshCredentials(service)
        throw error
      } finally {
        setBusy(false)
      }
    },
    [refreshCredentials, requireService]
  )

  const removeCredential = useCallback(
    async (id: string) => {
      const service = requireService()
      setBusy(true)
      try {
        await service.removeCredential(id)
        refreshCredentials(service)
      } finally {
        setBusy(false)
      }
    },
    [refreshCredentials, requireService]
  )

  return (
    <VaultContext.Provider
      value={{
        status,
        credentials,
        busy,
        initializationError,
        deviceCode: null,
        localVaultSources,
        migrateVault,
        createVault,
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
