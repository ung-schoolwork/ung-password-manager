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

import { RemoteVaultRepository } from "@/lib/vault/remote.client"
import {
  localVaultSources as findLocalVaultSources,
  readLocalVault,
  type LocalVaultSource,
} from "@/lib/vault/local-migration.client"
import { VaultService } from "@/lib/vault/service.client"
import type { Credential, CredentialDraft } from "@/lib/vault/types"

type VaultStatus = "loading" | "needs-setup" | "locked" | "unlocked" | "error"

interface VaultContextValue {
  status: VaultStatus
  credentials: Credential[]
  busy: boolean
  initializationError: string | null
  localVaultSources: LocalVaultSource[]
  migrateVault(source: LocalVaultSource, passphrase: string): Promise<void>
  createVault(passphrase: string): Promise<void>
  unlockVault(passphrase: string): Promise<void>
  lockVault(): void
  addCredential(draft: CredentialDraft): Promise<Credential>
  updateCredential(
    id: string,
    patch: Partial<CredentialDraft>
  ): Promise<Credential>
  removeCredential(id: string): Promise<void>
}

const VaultContext = createContext<VaultContextValue | null>(null)

export function VaultProvider({
  children,
  accountId,
}: {
  children: ReactNode
  accountId: string
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
    async (id: string, patch: Partial<CredentialDraft>) => {
      const service = requireService()
      setBusy(true)
      try {
        const credential = await service.updateCredential(id, patch)
        refreshCredentials(service)
        return credential
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
