# Changelog

## [2.1.0] — 2026-04-08

### Security hardening — P0

- **Multi-window logout loop** fixed. The shell no longer reopens
  itself in a loop when the dashboard redirects to `/login` after a
  real logout. A swap mutex in `main.js` and a new
  `window.fakturDesktop.logout()` bridge in the frontend keep the
  window state consistent.
- **Full wipe on logout**. Every persisted surface is now cleared on
  `auth:logout`: cookies, localStorage, sessionStorage, IndexedDB,
  service workers, HTTP cache, host resolver cache, auth cache, plus
  the encrypted secure store. Covers both the `persist:faktur-desktop-shell`
  and `persist:faktur-desktop-login` partitions.
- **`safeStorage` fallback refused**. On any OS where Electron returns
  `basic_text` as the backing store, the app refuses to persist
  tokens. Linux users must install `libsecret-tools` or `kwallet`.

### Security hardening — P1

- **Client secret removed**. The desktop is now a public OAuth client
  relying exclusively on PKCE. The backend's `authenticateClient()`
  method skips the secret check for apps flagged `kind: 'desktop'` or
  `'cli'`, and the `/oauth/token` controller enforces PKCE for all
  public clients.
- **Cryptographic desktop proof header**. Every outgoing API request
  now includes `X-Faktur-Desktop-Proof` + nonce + timestamp. The
  backend verifies the HMAC with a constant-time compare, a ±5 minute
  freshness window, and an in-memory nonce cache to block replay. Bots
  spoofing the User-Agent string can no longer impersonate a real
  desktop client.
- **Electron window hardening**. `contextIsolation`, `nodeIntegration:
  false`, `webSecurity: true`, `allowRunningInsecureContent: false`,
  `experimentalFeatures: false` on every BrowserWindow. Login window
  is fully sandboxed. Shell window uses a dedicated
  `persist:faktur-desktop-shell` session partition.
- **Permission blocker**. `setPermissionRequestHandler` now denies
  every OS-level permission except clipboard read/sanitized-write.
- **Navigation and popup lockdown**. `will-navigate`, `will-attach-webview`,
  and `setWindowOpenHandler` are all wired to block anything outside
  the dashboard origin, the API origin, and the loopback listener.
  External links open in the system browser.
- **Dangerous launch flags blocked**. `main.js` refuses to start if
  `--no-sandbox`, `--disable-web-security`, `--remote-debugging-port`,
  `--inspect`, or any variant is present on the command line.

### Build pipeline hardening — P1

- **ASAR integrity** enabled with Electron fuses:
  - `runAsNode: false`
  - `enableNodeOptionsEnvironmentVariable: false`
  - `enableNodeCliInspectArguments: false`
  - `enableEmbeddedAsarIntegrityValidation: true`
  - `onlyLoadAppFromAsar: true`
  - `grantFileProtocolExtraPrivileges: false`
  - `enableCookieEncryption: true`
- **macOS hardened runtime** enabled with a restrictive
  `build/entitlements.mac.plist` (no camera, microphone, location,
  contacts, calendars; keychain access group for safeStorage; network
  client/server for OAuth loopback).
- **Windows signing** config scaffolded (`signAndEditExecutable: true`,
  `signingHashAlgorithms: ['sha256']`). Certificate injection is
  expected from the CI secret store at publish time.

### Branding

- **Real Faktur logo** (owl) replaces the "F" placeholder in
  `login.html` and `loading.html`. A dedicated
  `renderer/assets/logo.svg` file ships with the bundle.
- **Sidebar and About page** in the dashboard now show "Faktur
  Desktop" + native version when the shell detects a Faktur Desktop
  runtime. A new About card explains the zero-password, OS-backed
  storage model.

### Developer experience

- **Code cleanup**. All JSDoc-heavy explanatory comments removed;
  only section markers remain. Each file is shorter and easier to
  review.
- **New documentation**:
  - `instruction.md` — end-to-end walkthrough of the program.
  - `docs/PLAN.md` — prioritized hardening roadmap (v2.1 and v2.2).
  - `docs/SECURITY_AUDIT.md` — full point-by-point audit mapping the
    Perplexity report findings to the applied mitigations.

### Known limitations (tracked for v2.2)

- The HMAC desktop proof key is still a static constant compiled into
  the binary. An attacker who unpacks the ASAR can extract it. The
  v2.2 roadmap calls for migrating to device-bound Ed25519 keys
  provisioned during OAuth registration.
- The shell window runs with `sandbox: false` because the Chrome
  DevTools Protocol debugger is required for the pre-navigation
  bootstrap script. We compensate with strict partitions, strict
  permissions, and a strict navigation guard. Re-sandboxing requires
  replacing the CDP injection with a preload-based handshake.
- JavaScript bytecode obfuscation (`bytenode`) for the security module
  is pending v2.2.
- End-to-end Playwright tests are scaffolded in the plan but not yet
  implemented.
- Production code signing certificates (Windows EV, Apple Developer
  ID) need to be provisioned before the public 2.1.0 release.

---

## [2.0.0] — 2026-03-14

Initial Electron client with OAuth2 PKCE + safeStorage + session bridge.
