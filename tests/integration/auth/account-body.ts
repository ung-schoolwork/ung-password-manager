import { createHash, randomBytes } from "node:crypto"

// The browser derives the auth key and wraps the vault key; the server only
// checks their shape, so these stand-ins exercise the same routes.
export function authKeyFor(password: string) {
  return createHash("sha256").update(password).digest("hex")
}

export function wrappedVaultKey() {
  return {
    version: 1,
    cipher: { name: "AES-GCM", iv: randomBytes(12).toString("base64") },
    wrappedKey: randomBytes(48).toString("base64"),
  }
}

/** What the sign-in and registration forms send for an email and password. */
export function accountBody(email: string, password: string) {
  return {
    email,
    authKey: authKeyFor(password),
    wrappedVaultKey: wrappedVaultKey(),
  }
}
