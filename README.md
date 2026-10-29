# UNG Password Manager

A team software-engineering project for a secure, accessible password-manager web application.

## Stack

- Next.js 16 with the App Router
- React 19 and TypeScript
- Tailwind CSS 4
- shadcn/ui with Base UI primitives
- Bun for dependency management and scripts

Email/password registration and sign-in use MongoDB Atlas through Mongoose. Each account has a separate client-encrypted vault saved through its account and a configurable cryptographically secure password generator. Encryption and decryption run in the browser; the server receives only the encrypted envelope. Account sign-in never unlocks the vault. Vault changes sync between the account's approved devices.

## Where the code lives

```
app/                 routes only - each page.tsx renders one component
  page.tsx           redirects to /vault
  vault/page.tsx     the vault: saved credentials and the add-credential form
  generate/page.tsx  the standalone password generator
  settings/page.tsx  account details and approved devices
components/vault/    everything specific to this app
components/settings/ account and device settings
components/ui/       vendored shadcn/ui primitives - generated, not written by us
lib/vault/           vault logic: validation, encryption, storage, service
lib/password-generator.ts   password generation
tests/unit/          bun tests for lib/
tests/e2e/           playwright tests that drive the real browser
```

Vault encryption and credential operations run in the browser. `lib/vault/service.client.ts` is the one place
that ties the pieces together: it validates a credential, encrypts the whole
vault, and hands it to `remote.client.ts` to save through the account. Start there.

## Account vault storage

`/api/vault` persists one encrypted vault per authenticated account. `GET` returns `{ envelope, revision }`, with both values null when the account has no saved vault. `PUT` accepts `{ envelope, expectedRevision }`: null creates a vault only if none exists; a matching revision updates it atomically. A stale revision or concurrent create returns 409 without overwriting the current vault. Ownership comes only from the authenticated session, never from a request-supplied account ID.

Writes require the exact configured origin and a validated version-1 encrypted envelope. Request bodies are capped at 1 MiB, including chunked bodies. Only ciphertext and encryption metadata are stored; these routes do not decrypt vaults. The database needs permission to create the unique account-vault index. Authentication failures return 401, invalid payloads 400, and unavailable storage 503; responses are not cached.

The browser repository remembers the revision loaded with the encrypted envelope and sends it with each save. Decrypted state is committed only after a successful save. Failed saves retain the credential draft and display an error; conflicts require reopening the latest vault before retrying. A fresh browser can sign in and retrieve the same encrypted vault once it is an approved device, but still needs its separate vault password.

## Approved devices and sync

Each browser is identified by a long-lived, HttpOnly device cookie and registered against the signed-in account. The first device on an account is approved automatically. Every later device shows an eight-digit approval code, valid for ten minutes, and cannot read, write, or poll the vault until an approved device enters that code on the Settings page. Approval attempts are rate-limited per account.

`/api/vault` and `/api/vault/revision` return 403 to unapproved devices. An open vault polls the revision every 15 seconds and when the tab regains focus. When another device has saved a newer revision, the browser fetches it and decrypts it with the vault password held by the unlocked session, and a save built on the replaced data is rejected as a conflict instead of overwriting it.

`/api/devices` lists the account's approved devices and `/api/devices/[id]` removes one after the user confirms on the Settings page. A removed device loses vault access immediately and returns to the approval screen. The current device cannot remove itself.

## Development

Copy `.env.example` to `.env.local`. Set `MONGODB_URI` to your MongoDB Atlas database (or a local MongoDB instance) and `APP_ORIGIN` to the exact origin you will open, such as `http://localhost:3000`. If `APP_ORIGIN` is unset, any origin is accepted outside production. Production requires it, and it must be HTTPS. Keep database credentials server-side; never use `NEXT_PUBLIC_*` for them. Set `SHARE_ENCRYPTION_KEY` to a 32-byte base64 value (generate one with `openssl rand -base64 32`) to enable sharing a credential with another account; sharing fails closed without it.

Production also requires `AUTH_TRUSTED_IP_HEADER` naming a header that your trusted reverse proxy **overwrites** with a single validated client IP. Do not enable it behind a proxy that forwards arbitrary client-supplied values. Missing or invalid source identity fails closed. Development without this setting uses a shared loopback source. Login and registration share database-backed global, source, and source/account rate limits; no account-wide lockout is shared between sources. Hashing is limited to two concurrent jobs per process. Add perimeter request limits when deploying; application throttling is not DDoS protection.

Mongoose creates unique account/session indexes and expiration indexes for sessions and rate-limit counters before serving authentication requests. The database account needs permission to create these indexes. Accounts store versioned salted scrypt hashes (`N=32768, r=8, p=3`); session records store only token digests. Sessions expire after eight hours. Production cookies are Secure, HttpOnly, SameSite Strict, and use the `__Host-` prefix. Sign-out revokes the current session and removes decrypted vault state. Other open tabs are notified; server revocation is also checked on focus and every 30 seconds.

Sign-out does not send a cookie-clearing header: a delayed logout response must not erase a newer login from another tab. The revoked token may remain in the HttpOnly cookie until it expires or is overwritten by the next login, but the server no longer accepts it.

Account mutations are serialized across tabs with Web Locks where supported. A durable, non-sensitive sign-out generation also invalidates outstanding authentication when Web Locks are unavailable and cross-tab notifications arrive late, even after logout completes. The session created by a successful authentication response invalidated by sign-out is explicitly revoked, so its cookie cannot authorize requests. A non-sensitive pending-sign-out flag keeps the app signed out across reloads if revocation fails; retrying sign-out (or signing in again) completes revocation before further authentication. Normal sign-out preserves encrypted vault data. If browser storage is unavailable, the durable cross-tab sign-out guard and local migration are unavailable; remote vault persistence does not require local storage.

Registration signs the new account in. Duplicate registration returns a generic error, but its status differs from success, so registration can reveal whether an email is already registered. Email verification and a privacy-preserving registration flow are outside this ticket.

Existing pre-account and account-specific local vaults are never adopted automatically. When no remote vault exists, users can explicitly choose an existing vault and enter its password. The browser validates and decrypts it before copying only its encrypted envelope through the account. A concurrent remote create prevents migration; existing remote vaults are never silently overwritten. Original local copies remain untouched on success or failure. Local keys do not isolate same-origin storage from malicious scripts.

```bash
bun install
bun dev
```

Open <http://localhost:3000>.

## Checks

```bash
bun run lint
bun run typecheck
bun run test
bun run build
bun run test:e2e
```

Auth integration and browser tests require a real, disposable MongoDB database. From this repository:

```bash
docker run --detach --rm --name ung-auth-test --publish 127.0.0.1:27018:27017 mongo:8
MONGODB_URI=mongodb://127.0.0.1:27018/ung_auth_test APP_ORIGIN=http://127.0.0.1:3100 bun run test:integration
MONGODB_URI=mongodb://127.0.0.1:27018/ung_auth_test bun run test:e2e
docker stop ung-auth-test
```

Integration tests use Node because the workspace's Bun 1.2 runtime cannot load Mongoose's BSON dependency. Browser tests register unique accounts against real routes; they do not bypass authentication. The Playwright server sets its own exact test origin. Only use disposable test databases.

> This project is under development. Do not store real credentials in it.
