import { randomUUID } from "node:crypto"
import mongoose, { Schema } from "mongoose"
import { connectAuth, User } from "@/lib/auth/server"
import type { VaultEnvelope } from "@/lib/vault/types"
import {
  parseWrappedVaultKey,
  VaultConflictError,
  type AccountVaultSnapshot,
  type VaultWrite,
} from "@/lib/vault/remote"

interface StoredVault {
  ownerId: string
  revision: string
  envelope: VaultEnvelope
}

const schema = new Schema<StoredVault>({
  ownerId: { type: String, required: true, unique: true },
  revision: { type: String, required: true },
  envelope: { type: Schema.Types.Mixed, required: true },
})
const Vault =
  (mongoose.models.AccountVault as mongoose.Model<StoredVault> | undefined) ||
  mongoose.model<StoredVault>("AccountVault", schema)

let indexesReady: Promise<void> | undefined
async function connectVault() {
  if (mongoose.connection.readyState === 0) indexesReady = undefined
  await connectAuth()
  indexesReady ??= Vault.createIndexes().catch((error) => {
    indexesReady = undefined
    throw error
  })
  await indexesReady
}

export async function loadAccountVault(
  ownerId: string
): Promise<AccountVaultSnapshot> {
  await connectVault()
  const [user, vault] = await Promise.all([
    User.findById(ownerId, { wrappedVaultKey: 1 }).lean<{
      wrappedVaultKey?: unknown
    }>(),
    Vault.findOne({ ownerId }).lean(),
  ])
  // Every account is created with a wrapped vault key.
  const wrappedVaultKey = parseWrappedVaultKey(user?.wrappedVaultKey)
  if (!wrappedVaultKey) throw new Error("Account vault key is missing")
  return vault
    ? { wrappedVaultKey, envelope: vault.envelope, revision: vault.revision }
    : { wrappedVaultKey, envelope: null, revision: null }
}

export async function saveAccountVault(ownerId: string, write: VaultWrite) {
  await connectVault()
  const revision = randomUUID()
  if (write.expectedRevision === null) {
    try {
      await Vault.create({ ownerId, revision, envelope: write.envelope })
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        throw new VaultConflictError()
      throw error
    }
  } else {
    const result = await Vault.findOneAndUpdate(
      { ownerId, revision: write.expectedRevision },
      { $set: { envelope: write.envelope, revision } }
    )
    if (!result) throw new VaultConflictError()
  }
  return { revision }
}

export async function loadAccountRevision(
  ownerId: string
): Promise<string | null> {
  await connectVault()
  const vault = await Vault.findOne({ ownerId }, { revision: 1 }).lean()
  return vault?.revision ?? null
}
