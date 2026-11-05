// The extension derives account keys and encrypts and decrypts vaults with the
// same module as the web app; the bundler compiles it into the extension
// instead of copying it.
export {
  decryptVault,
  deriveAccountKeys,
  encryptVault,
  unwrapVaultKey,
  VaultUnlockError,
  type AccountKeys,
} from "@/lib/vault/crypto.client"
export type {
  VaultDataV1,
  VaultEnvelope,
  WrappedVaultKey,
} from "@/lib/vault/types"
