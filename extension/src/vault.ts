// The extension encrypts and decrypts vaults with the same module as the web
// app; the bundler compiles it into the extension instead of copying it.
export {
  decryptVault,
  encryptVault,
  VaultUnlockError,
} from "@/lib/vault/crypto.client"
export type { VaultDataV1, VaultEnvelopeV1 } from "@/lib/vault/types"
