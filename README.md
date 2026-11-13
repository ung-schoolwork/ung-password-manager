# UNG Password Manager

A team software-engineering project for a secure, accessible password-manager web application.

## Stack

- Next.js 16 with the App Router
- React 19 and TypeScript
- Tailwind CSS 4
- shadcn/ui with Base UI primitives
- Bun for dependency management and scripts

Email/password registration and sign-in use MongoDB Atlas through Mongoose. Each account has a separate client-encrypted vault saved through its account and a configurable cryptographically secure password generator. Encryption and decryption run in the browser; the server receives only the encrypted envelope. One password signs in and opens the vault, and it never leaves the browser. Vault changes sync between the account's approved devices.

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
lib/password-generator.ts   password and passphrase generation
lib/eff-large-wordlist.ts   EFF passphrase word list (CC BY 3.0 US, see below)
extension/           Chrome extension (Manifest V3): popup, service worker, build script
tests/unit/          bun tests for lib/
tests/e2e/           playwright tests that drive the real browser
```

Vault encryption and credential operations run in the browser. `lib/vault/service.client.ts` is the one place
that ties the pieces together: it validates a credential, encrypts the whole
vault, and hands it to `remote.client.ts` to save through the account. Start there.

## Passphrases

The generator can also build a passphrase of 4 to 10 words (5 by default) drawn with `crypto.getRandomValues` and rejection sampling from the [EFF Large Wordlist](https://www.eff.org/dice) of 7,776 words, about 12.9 bits a word. The list is loaded with a dynamic import, so it is fetched only when a passphrase is generated or the Health checks need it. The Health checks recognise passphrases built from the list and judge them by word count instead of length rules.

The word list in `lib/eff-large-wordlist.ts` is © Electronic Frontier Foundation, used under the [Creative Commons Attribution 3.0 United States](https://creativecommons.org/licenses/by/3.0/us/) licence. Only the dice numbers were removed.

## One password: sign-in and vault keys

`lib/vault/crypto.client.ts` derives every key from the account email and password. It uses only the Web Crypto API, so other clients can import it unchanged.

```
email + password --PBKDF2-SHA256, 600,000 rounds--> account secret
account secret --HKDF "auth-key"-------------> auth key      sent to the server to sign in
account secret --HKDF "vault-wrapping-key"---> wrapping key  stays in the browser
wrapping key --AES-GCM--> wraps a random vault key
vault key    --AES-GCM--> encrypts the vault
```

The PBKDF2 salt is `ung-password-manager:account:v1:` followed by the email, trimmed and lowercased (`lib/auth/shared.ts`). The two HKDF outputs are independent, so the auth key the server sees cannot recover the wrapping key. Registration creates the random vault key in the browser and sends `{ email, authKey, wrappedVaultKey }`; sign-in sends `{ email, authKey }`. The server stores a salted scrypt hash of the auth key and the wrapped vault key, and neither can decrypt the vault. Changing the password only needs the vault key re-wrapped (`rewrapVaultKey`) and the auth key hash replaced, not the vault re-encrypted.

### Changing the password

Settings asks for the current password and the new one twice; the new one follows the registration rules. The browser (`lib/auth/password-change.client.ts`):

1. derives the keys for both passwords and loads the wrapped vault key from `/api/vault`, so only an approved device can change the password;
2. unwraps the vault key with the current wrapping key (a wrong current password stops here), re-wraps it with the new one, and checks that the new wrapping opens the same key and decrypts the saved vault before sending anything;
3. sends `{ currentAuthKey, authKey, wrappedVaultKey }` to `POST /api/auth/password`: the sign-in auth key, the registration auth key, and the re-wrapped key. No password or plaintext vault key leaves the browser, and the vault itself is not re-encrypted.

The route requires the exact origin, a live session, and an approved device, and shares the sign-in rate limits (`limited`). It checks the current auth key like sign-in, then replaces the auth key hash, its salt, and the wrapped vault key in one conditional update on the account document (`lib/auth/password-change.server.ts`). The condition is the hash it checked, so two overlapping changes cannot mix one password's hash with the other's wrapped key; the loser gets 409 or 401 and changes nothing.

The same update raises the account's `credentialsVersion`. Every session records the version it signed in with, and `activeSession` rejects sessions from an older version, so all existing sessions, including a sign-in that checked the old password while the change was in progress, stop working in the same write. Old session records are then deleted, and the browser that made the change gets a new session cookie. If that new session cannot be created, the password is still changed and the route returns 503; the browser is signed out and signs in with the new password.

Approved devices stay approved: approval belongs to the browser, not the password, and nothing on a device is wrapped with the password. Their sessions are signed out, so they need the new password to sign in again. Pending credential shares are encrypted with the server's sharing key and are not affected.

After sign-in the browser keeps the wrapping key in memory until this device is approved and the vault opens, then drops it. Locking the vault or reloading the page asks for the same password again.

The vault also locks itself after a stretch without activity: 15 minutes by default, or 1, 5, 30 or 60 minutes as chosen in Settings. The choice is stored per browser in `localStorage`. A warning appears shortly before locking (a minute ahead, or a quarter of the timeout if that is shorter) and offers to stay unlocked. Tabs of the same account share activity and locks over a `BroadcastChannel` (`lib/vault/auto-lock.ts`, `components/vault/auto-lock.tsx`), so activity in any tab keeps the vault open and locking one tab locks them all.

## Account vault storage

`/api/vault` persists one encrypted vault per authenticated account. `GET` returns `{ wrappedVaultKey, envelope, revision }`, with `envelope` and `revision` null until the account first saves its vault. `PUT` accepts `{ envelope, expectedRevision }`: null creates a vault only if none exists; a matching revision updates it atomically. A stale revision or concurrent create returns 409 without overwriting the current vault. Ownership comes only from the authenticated session, never from a request-supplied account ID.

Writes require the exact configured origin and a validated version-2 encrypted envelope. Request bodies are capped at 1 MiB, including chunked bodies. Only ciphertext and encryption metadata are stored; these routes do not decrypt vaults. The database needs permission to create the unique account-vault index. Authentication failures return 401, invalid payloads 400, and unavailable storage 503; responses are not cached.

The browser repository remembers the revision loaded with the encrypted envelope and sends it with each save. Decrypted state is committed only after a successful save. Failed saves retain the credential draft and display an error; conflicts require reopening the latest vault before retrying. A fresh browser can sign in and open the same vault as soon as it is an approved device.

## Approved devices and sync

Each browser is identified by a long-lived, HttpOnly device cookie and registered against the signed-in account. The first device on an account is approved automatically. Every later device shows an eight-digit approval code, valid for ten minutes, and cannot read, write, or poll the vault until an approved device enters that code on the Settings page. Approval attempts are rate-limited per account.

`/api/vault` and `/api/vault/revision` return 403 to unapproved devices. An open vault polls the revision every 15 seconds and when the tab regains focus. When another device has saved a newer revision, the browser fetches it and decrypts it with the vault key held by the unlocked session, and a save built on the replaced data is rejected as a conflict instead of overwriting it.

`/api/devices` lists the account's approved devices and `/api/devices/[id]` removes one after the user confirms on the Settings page. A removed device loses vault access immediately and returns to the approval screen. The current device cannot remove itself.

## Sharing a credential

A credential can be shared with another account by email (`/api/shares`). Sharing is not end-to-end encrypted: the server encrypts the credential at rest with `SHARE_ENCRYPTION_KEY` (`lib/sharing/server.ts`).

The recipient does not get a copy. Each time they open a shared credential, `GET /api/shares/[id]` decrypts it for them, and only while the share is active. An owner can give a share an end date (1 hour, 1 day, 7 days, 30 days or a chosen date, up to a year) and can remove access at any time. Once a share expires or is removed the route answers 410 with its status and no credential, and the encrypted credential is deleted from the record. The account label and site stay, encrypted separately, so both people still see which share ended. The rules live in `lib/sharing/status.ts`.

`GET /api/shares` lists `incoming` and `outgoing` shares with their status (`active`, `expired` or `removed`) and never includes a credential. `DELETE /api/shares/[id]` lets the owner revoke a share or the recipient decline it, and either one clear an ended share from their own list; the record is deleted once both have. Shares saved before end dates existed read as active with no end date. A password the recipient already copied cannot be taken back, so the owner is reminded to change it.

## Chrome extension

`extension/` holds a Manifest V3 Chrome extension with a toolbar popup and a background service worker. The popup signs in, shows the device approval code, and opens the vault: it lists the logins saved for the website in the current tab, searches all of them, fills the one the user chooses into the page, and saves a new login, offering what the user typed into the page's form. It is bundled with `Bun.build`; there is no separate package or framework.

### Installing the extension in Chrome

The extension is not in the Chrome Web Store, so Chrome loads it from a folder. There is no packed `.crx` or zip: a `.crx` must be signed with the private key, which is not in the repository, and Chrome cannot load a zip directly.

1. Start the app (see [Development](#development)) and add this line to `.env.local` before starting it, so the server accepts the extension:
   `EXTENSION_ORIGINS=chrome-extension://ibfocpogcdoolfmhcmnkiojgfpbkfbgj`
2. Build the extension for the address you open the app at. The default is `http://localhost:3000`; use the same host name you type in the address bar (`localhost` and `127.0.0.1` are different sites to Chrome):
   `bun run build:extension`, or `EXTENSION_APP_ORIGIN=https://your-app.example.com bun run build:extension`
3. In Chrome, open `chrome://extensions` and turn on **Developer mode** (top right).
4. Choose **Load unpacked** and select the `extension/dist` folder.
5. Click the puzzle-piece icon in the toolbar and pin **UNG Password Manager**, then click it to sign in.

To share the extension, copy or zip the `extension/dist` folder; the person receiving it unzips it and follows steps 3 to 5. After rebuilding, press the reload button on the extension's card in `chrome://extensions`. If the popup says it can't reach UNG Password Manager, check that the app is running at the address the extension was built for and that `EXTENSION_ORIGINS` is set.

### Building and how it works

```bash
bun run build:extension                                         # app at http://localhost:3000
EXTENSION_APP_ORIGIN=https://app.example.com bun run build:extension   # deployed app
```

The build writes an unpacked extension to `extension/dist` (ignored by git). To load it, open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select `extension/dist`. After rebuilding, press the extension's reload button on that page. `EXTENSION_APP_ORIGIN` must be an exact origin and must use HTTPS unless it is a local server; the extension is granted host permission for that origin only.

**Extension ID.** The build puts the public key from `extension/identity.ts` in the manifest `key`, so Chrome loads the unpacked extension as `chrome-extension://ibfocpogcdoolfmhcmnkiojgfpbkfbgj` on every machine. The build prints this origin. Only the public key is kept in the repository; it fixes the ID but cannot sign a package. Publishing to the Chrome Web Store assigns a different ID, which must then be added to `EXTENSION_ORIGINS`.

**Server access.** State-changing routes still require an allowed `Origin`. Set `EXTENSION_ORIGINS` to a comma-separated list of exact `chrome-extension://<id>` origins to accept them alongside `APP_ORIGIN`:

```bash
EXTENSION_ORIGINS=chrome-extension://ibfocpogcdoolfmhcmnkiojgfpbkfbgj
```

Entries that are not exactly `chrome-extension://` followed by a 32-letter ID are ignored, so a typo never widens access. Every other origin, including other extensions, is still rejected, and production still fails closed without an HTTPS `APP_ORIGIN`. The server adds no CORS headers: Chrome lets an extension read responses from origins in its `host_permissions`, while web pages on other origins still cannot.

**Authentication.** The extension uses the browser's existing session cookie rather than a separate token. Chrome treats requests from an extension page or service worker to an origin in its `host_permissions` as same-site, so the HttpOnly, `SameSite=Strict` session and device cookies are sent and set as they are for the app itself; the cookie settings did not change. No credential is stored in extension storage or readable by extension code. The trade-off is that the extension and the app in the same Chrome profile share one session and one device approval: signing out in either signs out both. The Playwright test `tests/e2e/extension.spec.ts` loads the built extension in Chromium and checks both the cookie and the origin rules.

**Requests go through the service worker.** The popup asks the service worker over `chrome.runtime` messaging, and the service worker calls the API. Content scripts must do the same: a request made from a content script carries the visited site's origin and is rejected.

**Signing in and opening the vault.** The extension is not a separate device: it uses the Chrome profile's sign-in and device approval (`extension/src/popup-controller.ts`).

- Signed out: the popup asks for the email and password, derives the keys, and sends `{ email, authKey }` to `/api/auth/login`. The session cookie is the browser's, so the app is signed in too.
- Signed in: the popup takes the email from `/api/auth/session` and asks only for the password, which opens the vault locally; there is no second sign-in.
- Not approved: `POST /api/devices` (the same call the app makes) returns the approval code, which the popup shows and re-checks every 3 seconds. `/api/vault` returns 403 until an approved device enters the code in Settings. A password entered at sign-in is kept as the wrapping key until then, so the vault opens without asking again.
- Open vault: every 5 seconds the popup re-checks the session and `/api/vault/revision`. A 401 or a different account shows sign-in or unlock again, a 403 (this browser was removed in Settings) shows a new approval code, and a new revision is downloaded and decrypted.
- Sign-out in the popup calls `/api/auth/logout`, which signs out the app as well; the app notices on focus or within 30 seconds. Sign-out in the app is noticed by the open popup within 5 seconds, or when it next opens.

The wrapping key, the vault key, the decrypted list, and a login being saved live only in the popup's memory. The service worker relays requests and only handles the auth key and ciphertext; it keeps nothing between messages. Nothing is written to `chrome.storage` (the extension does not request the `storage` permission, so the API is not even available to it), and the manifest requests only `activeTab` and `scripting` besides host access to the app. Closing the popup, locking, signing out, a 401, or a 403 drops the keys and the list, and opening the popup again asks for the password. The popup keeps only the account name, website, and username of each login, plus the encrypted vault; passwords are decrypted with the rest of the vault but not kept.

**Logins for the current website.** Clicking the toolbar button grants `activeTab`, so the popup can read the current tab's address once when it opens; it is not stored. `lib/vault/site-match.ts` compares hosts: a credential's website is free text, read with or without a scheme or path, ignoring `www.` and any port. A tab matches when its host equals the saved host or is a subdomain of it, so a login for `example.com` shows on `accounts.example.com`, but a login for `accounts.example.com` does not show on `example.com`, and `evil-example.com` never matches `example.com`. A saved single label (`com`, `localhost`) or IP address matches only itself. There is no public-suffix list, so a login saved for `co.uk` would match every `co.uk` site. Pages that are not `http` or `https` (`chrome://`, `file:`) get no suggestions. The search box uses `lib/vault/search.ts`, as the app does, over account name, website, and username.

**Filling a login.** Nothing runs on websites until the user chooses a login, or starts saving one, in the popup; there is no content script. Then the popup:

1. Reads the active tab again and checks it with `fillProblem` (`lib/vault/site-match.ts`): the page must be HTTPS, or http on `localhost`, `127.0.0.1`, or `[::1]`, and its host must match the login's website by the rules above. Otherwise it says why and fills nothing.
2. Decrypts the vault with the vault key it holds and keeps only the chosen login's username and password for this one fill. The vault is encrypted as a whole, so it cannot decrypt a single entry.
3. Injects `fill-page.js` into the tab's top frame only (`chrome.scripting.executeScript`, `frameIds: [0]`, in the extension's isolated world), then calls it with the login as arguments. Nothing is written to storage or sent through the service worker.

`fill-page.js` checks the page's address again, so a tab that moved on in the meantime is not filled. It then picks fields with `pickLoginFields` (`extension/src/fill-fields.ts`). Only visible, editable inputs count: hidden, transparent, zero-sized, and off-page fields are skipped. A `current-password` field is preferred, and `new-password` fields (sign-up, password change) are never filled. The username is the field marked `username`/`email` or the text field just before the password. With no password on the page (the first step of a two-step sign-in), only a field marked as an email or username is filled; with no username shown (the second step), only the password. Values are set through the native setter, followed by `input` and `change` events, so framework-managed forms notice. For two steps the popup says to open it again on the next step, which asks for the password again because closing the popup forgets the vault.

The e2e test opens the real toolbar popup with `chrome.action.openPopup()` and reaches it over the DevTools protocol. That does not grant `activeTab`, so the test's "current website" is the app's own origin, which the extension's host permission lets it read and fill; subdomain rules and the HTTPS check are covered by unit tests. The fill tests serve sign-in pages on that origin with `context.route`. They include hidden and off-page trap fields, an embedded frame, and a two-step form.

**Saving a login.** **Save a login** in the open vault reads the current tab once, as filling does, and only in its top frame: `fill-page.js` also defines a reader that picks the page's fields with `pickLoginFields` in its saving mode, which prefers a `new-password` field (sign-up or password change) over the current one. The form is filled with what the user typed there, and the label and website default to the tab's host; when the page has no sign-in fields, or is not a website, the form starts empty. The popup validates the login with `validateCredentialDraft` from `lib/vault/validation.ts`, the same rules as the app, decrypts the vault with the vault key, adds the login, encrypts the whole vault again, and sends only the envelope and the revision it started from (`save-vault`) through the service worker to `PUT /api/vault`. If another device saved first, the server answers 409 without overwriting; the popup loads the newer vault and adds the login to it, up to three times. The typed login lives only in the popup's form until it is encrypted and is cleared when the form closes. Nothing is captured when a form is submitted: that would need a content script on every site, which the extension avoids.

**Shared vault encryption.** `extension/src/vault.ts` re-exports `lib/vault/crypto.client.ts`; the bundler compiles the same module into the extension, so encryption is never copied. A unit test bundles it for the browser and round-trips a vault through it.

## Development

Copy `.env.example` to `.env.local`. Set `MONGODB_URI` to your MongoDB Atlas database (or a local MongoDB instance) and `APP_ORIGIN` to the exact origin you will open, such as `http://localhost:3000`. If `APP_ORIGIN` is unset, any origin is accepted outside production. Production requires it, and it must be HTTPS. Keep database credentials server-side; never use `NEXT_PUBLIC_*` for them. Set `SHARE_ENCRYPTION_KEY` to a 32-byte base64 value (generate one with `openssl rand -base64 32`) to enable sharing a credential with another account; sharing fails closed without it.

Production also requires `AUTH_TRUSTED_IP_HEADER`, which names the header your reverse proxy sets to the client IP; see [Deployment](#deployment). Development without this setting uses a shared loopback source. Login and registration share database-backed global, source, and source/account rate limits; no account-wide lockout is shared between sources. Hashing is limited to two concurrent jobs per process. Add perimeter request limits when deploying; application throttling is not DDoS protection.

Mongoose creates unique account/session indexes and expiration indexes for sessions and rate-limit counters before serving authentication requests. The database account needs permission to create these indexes. Accounts store versioned salted scrypt hashes (`N=32768, r=8, p=3`) of the browser-derived auth key; session records store only token digests. Sessions expire after eight hours. Production cookies are Secure, HttpOnly, SameSite Strict, and use the `__Host-` prefix. Sign-out revokes the current session and removes decrypted vault state. Other open tabs are notified; server revocation is also checked on focus and every 30 seconds.

Sign-out does not send a cookie-clearing header: a delayed logout response must not erase a newer login from another tab. The revoked token may remain in the HttpOnly cookie until it expires or is overwritten by the next login, but the server no longer accepts it.

Account mutations are serialized across tabs with Web Locks where supported. A durable, non-sensitive sign-out generation also invalidates outstanding authentication when Web Locks are unavailable and cross-tab notifications arrive late, even after logout completes. The session created by a successful authentication response invalidated by sign-out is explicitly revoked, so its cookie cannot authorize requests. A non-sensitive pending-sign-out flag keeps the app signed out across reloads if revocation fails; retrying sign-out (or signing in again) completes revocation before further authentication. Normal sign-out preserves encrypted vault data. If browser storage is unavailable, the durable cross-tab sign-out guard and local migration are unavailable; remote vault persistence does not require local storage.

Registration signs the new account in. Duplicate registration returns a generic error, but its status differs from success, so registration can reveal whether an email is already registered. Email verification and a privacy-preserving registration flow are outside this ticket.

Vaults saved in browser storage by earlier versions of the app are ignored and left untouched.

```bash
bun install
bun dev
```

Open <http://localhost:3000>.

## Deployment

Two settings must be right before anyone can sign in or register on a deployed site:

| Variable                 | Value                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `APP_ORIGIN`             | The exact public origin, such as `https://app.example.com`: HTTPS, no path, no trailing slash. Requests from any other origin are refused. |
| `AUTH_TRUSTED_IP_HEADER` | The header your host or reverse proxy sets to the client IP (table below). Case does not matter.                                           |

Sign-in and registration are rate-limited per client IP, so the server must know which IP each request came from. If `AUTH_TRUSTED_IP_HEADER` is unset, the header is missing from a request, or it does not hold an IP address, those requests are refused (fail closed), never let through without a limit. Users see "Sign-in is temporarily unavailable. Try again later." and the server logs the cause, without header values, at most once every 15 minutes per problem:

```
[auth] Sign-in and registration are refused: requests are missing the "x-real-ip" header named by AUTH_TRUSTED_IP_HEADER. ...
```

**Pick the header for your host.** Only trust a header that the proxy in front of the app sets or overwrites itself; a client can send any header it likes.

| Host                               | `AUTH_TRUSTED_IP_HEADER` | Proxy setup                                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nginx                              | `x-real-ip`              | `proxy_set_header X-Real-IP $remote_addr;` in the `location` that proxies to the app. This replaces any value the client sent.                                                                                                |
| Caddy                              | `x-real-ip`              | `reverse_proxy localhost:3000 { header_up X-Real-IP {client_ip} }`. Without `trusted_proxies`, `{client_ip}` is the connecting address.                                                                                       |
| Cloudflare (proxied DNS or Tunnel) | `cf-connecting-ip`       | Nothing to add; Cloudflare sets it. The origin must accept traffic **only** from Cloudflare (a Tunnel, or a firewall limited to Cloudflare's IP ranges); otherwise anyone can reach the origin directly and forge the header. |
| Vercel                             | `x-real-ip`              | Nothing to add; Vercel sets it to the client IP and replaces any value the client sent.                                                                                                                                       |

When proxies are chained, configure the one that faces the internet. Behind Cloudflare and then nginx, either use `cf-connecting-ip` (with the origin locked to Cloudflare as above) or have nginx restore the client address with `set_real_ip_from <Cloudflare ranges>; real_ip_header CF-Connecting-IP;` and keep `x-real-ip`.

**How values are read.** Single-value headers such as `x-real-ip` and `cf-connecting-ip` must hold exactly one IPv4 or IPv6 address; a port or IPv6 brackets are accepted, and a comma-separated list is refused. `x-forwarded-for` is the one list form accepted: each proxy appends the address it received the request from, so only the **rightmost** entry was written by the proxy in front of the app. The leftmost entry is whatever the client sent and is never used, because trusting it would let anyone pick their own rate-limit bucket. This means `x-forwarded-for` gives the right answer only when exactly one proxy that appends (such as nginx with `$proxy_add_x_forwarded_for`) sits in front of the app; with more hops it yields a proxy's address, so prefer a single-value header. The RFC 7239 `Forwarded` header is not supported.

## Checks

```bash
bun run lint
bun run typecheck
bun run test
bun run build
bun run build:extension
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
