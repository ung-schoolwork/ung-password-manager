import { createHash } from "node:crypto"

// Public half of an RSA key pair. Chrome derives an unpacked extension's ID
// from the manifest `key`, so every developer and CI run loads the extension
// under the same ID, and the server can allow exactly that origin. Only the
// public key is kept; it identifies the extension but cannot sign a package.
export const EXTENSION_PUBLIC_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwU8F5tTFhjOptSwFLly9I56/Wmo66yGgAyFrkb3cMvPJ/PsVMfNNeFlOyQle7bklL783PrTMT7bj6P98VQEju8XtA2GdiyYWoQ3J/Hcc2nncLEQ+lq9bFg3Uus7reROvUTxk4UTtjghSj+qU6HbK/ra+4Qg8cbC84u4iddOHwczv5cVHrTSWr33qG8N7jiVFXLUl+sFb45nOhXnKf+Fku3leWGaHoqBRqb4ZnS69aCjn0HS5oyrg51aQ3C+fMUhD5UiwBOC9gBV6uQz9Mq4bNy4vBa06NgJTgWuXBRnaN/dvXkgxNLAnx3CUZJ17epQi4nw12pkKgHz/Tyarrd0iLQIDAQAB"

/** Chrome's ID: the first 128 bits of SHA-256(key), written with letters a-p. */
export function extensionIdFromKey(publicKey: string) {
  return createHash("sha256")
    .update(Buffer.from(publicKey, "base64"))
    .digest("hex")
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (digit) =>
      String.fromCharCode(97 + Number.parseInt(digit, 16))
    )
}

export const EXTENSION_ID = extensionIdFromKey(EXTENSION_PUBLIC_KEY)
export const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`
