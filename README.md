# UNG Password Manager

A team software-engineering project for a secure, accessible password-manager web application.

## Stack

- Next.js 16 with the App Router
- React 19 and TypeScript
- Tailwind CSS 4
- shadcn/ui with Base UI primitives
- Bun for dependency management and scripts

Email/password registration and sign-in use MongoDB Atlas through Mongoose. Each account has a separate client-encrypted vault in this browser and a configurable cryptographically secure password generator. Account sign-in never unlocks the vault. Remote encrypted-vault persistence, migration, and approved-device synchronization remain separate work.

## Where the code lives

```
app/                 routes only - each page.tsx renders one component
  page.tsx           redirects to /vault
  vault/page.tsx     the vault: saved credentials and the add-credential form
  generate/page.tsx  the standalone password generator
components/vault/    everything specific to this app
components/ui/       vendored shadcn/ui primitives - generated, not written by us
lib/vault/           vault logic: validation, encryption, storage, service
lib/password-generator.ts   password generation
tests/unit/          bun tests for lib/
tests/e2e/           playwright tests that drive the real browser
```

Vault encryption and credential operations run in the browser. `lib/vault/service.client.ts` is the one place
that ties the pieces together: it validates a credential, encrypts the whole
vault, and hands it to `repository.client.ts` to store. Start there.

## Development

Copy `.env.example` to `.env.local`. Set `MONGODB_URI` to your MongoDB Atlas database (or a local MongoDB instance) and `APP_ORIGIN` to the exact origin you will open, such as `http://localhost:3000`. Production requires HTTPS. Keep database credentials server-side; never use `NEXT_PUBLIC_*` for them.

Production also requires `AUTH_TRUSTED_IP_HEADER` naming a header that your trusted reverse proxy **overwrites** with a single validated client IP. Do not enable it behind a proxy that forwards arbitrary client-supplied values. Missing or invalid source identity fails closed. Development without this setting uses a shared loopback source. Login and registration share database-backed global, source, and source/account rate limits; no account-wide lockout is shared between sources. Hashing is limited to two concurrent jobs per process. Add perimeter request limits when deploying; application throttling is not DDoS protection.

Mongoose creates unique account/session indexes and expiration indexes for sessions and rate-limit counters before serving authentication requests. The database account needs permission to create these indexes. Accounts store versioned salted scrypt hashes (`N=32768, r=8, p=3`); session records store only token digests. Sessions expire after eight hours. Production cookies are Secure, HttpOnly, SameSite Strict, and use the `__Host-` prefix. Sign-out revokes the current session and removes decrypted vault state. Other open tabs are notified; server revocation is also checked on focus and every 30 seconds.

Account mutations are serialized across tabs with Web Locks where supported. A durable, non-sensitive sign-out generation also invalidates outstanding authentication when Web Locks are unavailable and cross-tab notifications arrive late, even after logout completes. A successful authentication response invalidated by sign-out is explicitly revoked, including any cookie it installed. A non-sensitive pending-sign-out flag keeps the app signed out across reloads if revocation fails; retrying sign-out (or signing in again) completes revocation before further authentication. Normal sign-out preserves encrypted vault data. If browser storage is unavailable, only the in-memory guard is available; local vault persistence also cannot work in that environment.

Registration signs the new account in. Duplicate registration returns a generic error, but its status differs from success, so registration can reveal whether an email is already registered. Email verification and a privacy-preserving registration flow are outside this ticket.

Existing pre-account local vaults are left untouched at their original storage key. They are not silently assigned to a registered account or overwritten. Explicit migration belongs to SCRUM-41. Account-specific local keys separate the UI's vaults, but do not isolate same-origin storage from malicious scripts.

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
