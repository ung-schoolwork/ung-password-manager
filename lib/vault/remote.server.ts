import { randomUUID } from "node:crypto"
import mongoose, { Schema } from "mongoose"
import { connectAuth } from "@/lib/auth/server"
import type { VaultEnvelopeV1 } from "@/lib/vault/types"
import {
  VaultConflictError,
  type AccountVaultSnapshot,
  type VaultWrite,
} from "@/lib/vault/remote"

interface StoredVault {
  ownerId: string
  revision: string
  envelope: VaultEnvelopeV1
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
  const vault = await Vault.findOne({ ownerId }).lean()
  return vault
    ? { envelope: vault.envelope, revision: vault.revision }
    : { envelope: null, revision: null }
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
