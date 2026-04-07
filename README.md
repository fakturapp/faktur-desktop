# Faktur Desktop

Open-source desktop client for [Faktur](https://fakturapp.cc) — built on
Electron, authenticating via OAuth2 with PKCE, and never asking the user
for a password directly inside the app.

## Architecture

```
src/
├── config/          # Env loading, constants, runtime flags
├── crypto/          # safeStorage wrapper for OS-backed encryption
├── loopback/        # Ephemeral HTTP server for the OAuth callback
├── oauth/           # OAuth2 client, PKCE helper, token lifecycle
├── store/           # Encrypted persistent state (tokens + session)
├── ipc/             # Main ↔ renderer message bridge
├── windows/         # BrowserWindow factories (login, shell, vault)
└── main/            # App lifecycle — entry point
renderer/
├── login.html       # Standalone landing page before auth
├── shell.html       # Embeds dash.fakturapp.cc post-auth
└── js/              # Preload scripts + UI logic
assets/              # App icons and static files
```

## Security model

- **No passwords in Electron.** The user's password is only ever typed
  into the real Faktur website, rendered by the system browser — never
  inside this app's chrome.
- **OAuth2 + PKCE.** Every auth flow uses a fresh code_verifier and an
  ephemeral `http://127.0.0.1:<port>/callback` redirect URI.
- **Encrypted at rest.** Access and refresh tokens are persisted via
  Electron `safeStorage` which wraps OS-level encryption (Keychain on
  macOS, DPAPI on Windows, libsecret on Linux).
- **Rotating refresh tokens.** Every `/oauth/token` call issues a brand
  new access + refresh pair and revokes the old one.
- **Webhook-driven kick.** The admin panel can revoke sessions
  remotely; the next silent refresh sees the 401 and wipes the
  local store.
- **Vault unlock in the browser.** If the user has a locked vault, the
  desktop app pops a modal explaining this and opens the real
  `dash.fakturapp.cc/vault/unlock` page in the browser. The vault
  passphrase never touches Electron.

## Getting started

```bash
git clone https://github.com/fakturapp/faktur-desktop
cd faktur-desktop
cp .env.example .env
# Fill FAKTUR_OAUTH_CLIENT_ID and FAKTUR_OAUTH_CLIENT_SECRET with the
# values generated in the Faktur admin panel → Applications OAuth → New.
npm install
npm run start
```

## License

MIT © Faktur
