# Faktur Desktop — Guide de fonctionnement

Ce document explique en détail comment fonctionne Faktur Desktop, le client
Electron de Faktur, de l'installation au flux OAuth2 en passant par la
persistance des tokens et la communication avec le backend.

---

## 1. Vue d'ensemble

Faktur Desktop est une application Electron qui embarque le dashboard web
Faktur dans une `BrowserWindow`. Contrairement au navigateur, le bureau
n'a pas de formulaire email/mot de passe : toute l'authentification passe
par **OAuth2 avec PKCE** via le navigateur système.

```
┌─────────────────────────────────────────────────────────────────┐
│                      FAKTUR DESKTOP                             │
│                                                                 │
│  ┌──────────────┐      ┌───────────────┐                        │
│  │ Login Window │ ───▶ │  OAuth Flow   │ ──▶ Navigateur système │
│  │ (natif)      │      │  (PKCE)       │                        │
│  └──────────────┘      └───────┬───────┘                        │
│                                │                                │
│                                ▼                                │
│                     ┌─────────────────────┐                     │
│                     │  Secure Store       │                     │
│                     │  (access + refresh) │                     │
│                     └──────────┬──────────┘                     │
│                                │                                │
│                                ▼                                │
│                     ┌─────────────────────┐                     │
│                     │ POST /oauth/        │                     │
│                     │  exchange-session   │                     │
│                     └──────────┬──────────┘                     │
│                                │                                │
│                                ▼                                │
│                     ┌─────────────────────┐                     │
│                     │  Shell Window       │                     │
│                     │  (dashboard web)    │                     │
│                     └─────────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Architecture des fichiers

```
faktur-desktop/
├── package.json                 Config Electron + electron-builder
├── .env                         Variables (client_id, secret, URLs)
├── instruction.md               Ce fichier
├── renderer/
│   ├── login.html               UI du login (bouton "Se connecter")
│   ├── loading.html             Écran d'attente pendant exchange-session
│   ├── js/
│   │   └── login.js             Logique front du login (bouton + bannière)
│   └── preload/
│       ├── login_preload.js     contextBridge pour la fenêtre login
│       └── shell_preload.js     contextBridge pour la fenêtre dashboard
└── src/
    ├── main/
    │   └── main.js              Point d'entrée, cycle de vie de l'app
    ├── config/
    │   ├── env.js               Chargement et validation du .env
    │   └── constants.js         IPC channels, session states, storage keys
    ├── crypto/
    │   └── safe_storage.js      Wrapper sur Electron safeStorage (DPAPI/Keychain)
    ├── store/
    │   └── secure_store.js      Key/value chiffré persisté en JSON
    ├── oauth/
    │   ├── pkce.js              Génération code_verifier + code_challenge S256
    │   ├── oauth_client.js      Client HTTP bas-niveau (/oauth/token, /revoke)
    │   ├── session_bridge.js    Client HTTP pour /oauth/exchange-session
    │   └── token_manager.js     Orchestrateur OAuth + refresh + persistance
    ├── loopback/
    │   └── callback_server.js   Serveur HTTP 127.0.0.1 pour le redirect_uri
    ├── windows/
    │   ├── login_window.js      Factory de la fenêtre de connexion (480×640)
    │   └── shell_window.js      Factory de la fenêtre dashboard (1400×900)
    └── ipc/
        └── ipc_handlers.js      Handlers IPC (auth:start, auth:logout, etc.)
```

---

## 3. Cycle de vie de l'application

### 3.1 Démarrage (`src/main/main.js`)

1. **Single-instance lock** : `app.requestSingleInstanceLock()` empêche
   deux instances de tourner en parallèle (sinon plusieurs loopbacks
   OAuth se battent pour le même port).
2. **Chargement du .env** : `src/config/env.js` valide `FAKTUR_OAUTH_CLIENT_ID`
   et `FAKTUR_OAUTH_CLIENT_SECRET`. Si l'un manque, l'app quitte avec un
   message d'erreur explicite.
3. **Enregistrement des IPC handlers** : `registerIpcHandlers()` branche
   `auth:start`, `auth:logout`, `session:get-state`, etc.
4. **Bootstrap du token manager** : `tokenManager.bootstrap()` lit le
   secure store. Si un couple `(access_token, refresh_token)` existe,
   l'état initial est `AUTHENTICATED`. Sinon `UNAUTHENTICATED`.
5. **Ouverture de la fenêtre** : `openForState(initial)` crée soit la
   login window, soit la shell window, en fonction de l'état.

### 3.2 Login Window

Ouverte si aucun token n'est trouvé au démarrage. C'est une
`BrowserWindow` 480×640 non redimensionnable qui charge un HTML statique
(`renderer/login.html`).

Composition :
- Un bouton **"Se connecter avec Faktur"**.
- Une bannière de déconnexion (affichée si `?reason=...` est passé dans
  l'URL). Les raisons sont :
  - `token_invalid` — token révoqué ou expiré côté backend.
  - `bridge_failed` — `/oauth/exchange-session` a échoué.
  - `vault_locked` — le coffre-fort chiffré n'a pas pu être déverrouillé.
  - `network_error` — backend injoignable.
  - `refresh_failed` — refresh OAuth rejeté (400/401).
  - `session_expired` — le dashboard a redirigé vers `/login` en cours
    d'usage (1 jour de session dashboard écoulé).
  - `revoked` — l'utilisateur a révoqué l'app depuis les réglages.
  - `user_logout` — déconnexion volontaire (pas de bannière).

### 3.3 Shell Window

Ouverte dès qu'un token OAuth est disponible. C'est une `BrowserWindow`
1400×900 qui :
1. Charge **`loading.html`** en local (<100 ms pour éviter le flash blanc).
2. En arrière-plan, appelle `tokenManager.getAccessToken()` pour récupérer
   le token OAuth (rafraîchi à la volée si besoin).
3. Appelle `exchangeForDashboardSession(oauthAccessToken)` →
   **POST /api/v1/oauth/exchange-session** → reçoit un token de session
   AdonisJS + `vaultKey` + `vaultLocked`.
4. Si `vaultLocked === true`, émet `vault_locked` et bascule sur la login
   window (le coffre-fort ne peut être déverrouillé que dans le navigateur).
5. Via le **Chrome DevTools Protocol**, injecte un script
   `Page.addScriptToEvaluateOnNewDocument` qui écrit dans `localStorage`
   **avant** que tout script du dashboard ne s'exécute :
   - `faktur_token` → le token de session
   - `faktur_vault_key` → la clé de déchiffrement du coffre-fort
   - `faktur_source` → `'desktop'`
6. Charge l'URL `https://dash.fakturapp.cc/dashboard#faktur_desktop_session=<base64>`.
   Le fragment contient une copie redondante du payload, au cas où le CDP
   injection échoue (double sécurité).
7. Le frontend Next.js lit le hash via `consumeDesktopSessionHash()` dans
   `src/lib/auth.tsx`, réécrit `localStorage`, nettoie l'URL, et
   l'`AuthProvider` appelle `/api/v1/auth/me` avec le token de session.

> **Important** : c'est le token **de session AdonisJS** que le dashboard
> utilise pour toutes ses requêtes API, pas le token OAuth. Le token OAuth
> reste dans le secure store d'Electron et ne sort jamais du processus
> principal.

### 3.4 Navigation Guard

`installNavigationGuard()` dans `shell_window.js` surveille deux événements :
- `will-navigate` : bloque toute navigation hors du domaine dashboard /
  API / loopback.
- `did-navigate-in-page` : attrape les `router.push('/login')` client-side.

Quand une navigation vers `/login` est détectée (session du dashboard
expirée, logout déclenché depuis le dashboard, etc.), on fire
`onFatalError('session_expired')`. Le main process gère ça en réouvrant
simplement la shell (qui fait un nouveau `exchange-session`) **sans effacer
les tokens OAuth**. Ça évite la boucle "login → bref aperçu → kick" qui
arrivait avant.

---

## 4. Flux OAuth2 complet (PKCE)

```
[1] User clique "Se connecter"
     │
     ▼
[2] tokenManager.startAuthorizationFlow()
     │
     ├─▶ pkce.createPkcePair() → (verifier, challenge S256)
     │
     ├─▶ loopback.startCallbackServer() → HTTP 127.0.0.1:<port_libre>/callback
     │
     ├─▶ oauth_client.buildAuthorizeUrl({ redirect_uri, state, challenge })
     │       └─ https://dash.fakturapp.cc/oauth/authorize?...
     │
     └─▶ shell.openExternal(authorizeUrl)
             │
             ▼
[3] Navigateur système : utilisateur se connecte + autorise l'app
     │
     ▼
[4] Le backend redirige vers http://127.0.0.1:<port>/callback?code=...&state=...
     │
     ▼
[5] Le loopback server capture la requête, vérifie `state`, renvoie une
     page HTML "Connexion réussie" et se ferme.
     │
     ▼
[6] oauth_client.exchangeCodeForToken({ code, verifier, deviceInfo })
     │
     └─▶ POST /api/v1/oauth/token (grant_type=authorization_code)
          │
          └─▶ Réponse : { access_token, refresh_token, expires_in, ... }
     │
     ▼
[7] secureStore.setMany({ access, refresh, expires_at, ... })
     │
     ▼
[8] _emit(AUTHENTICATED)
     │
     ▼
[9] main.js onSessionChange → openForState(AUTHENTICATED) → Shell Window
```

### 4.1 Refresh automatique

`getAccessToken()` vérifie l'expiration avant chaque utilisation :
- Si le token expire dans **plus de 60 s** → on le renvoie tel quel.
- Sinon → **POST /oauth/token (grant_type=refresh_token)** pour rotation.
- Si le refresh renvoie **400 ou 401** → le refresh token est mort,
  on wipe le store et on bascule sur la login window.
- Si le refresh échoue pour une autre raison (timeout réseau, 500) →
  **on ne touche pas au store** et on propage l'erreur. L'utilisateur
  peut retenter plus tard sans perdre sa session.

### 4.2 Logout

Deux voies :
- **Utilisateur clique "Déconnexion"** dans le dashboard → le frontend
  appelle `/auth/logout` puis redirige vers `/login` → le navigation
  guard détecte `/login` → `session_expired` → réouverture de la shell
  (qui retentera exchange-session).
- **Utilisateur clique "Déconnexion" depuis un menu Electron** (IPC
  `auth:logout`) → `tokenManager.logout({ remoteRevoke: true })` →
  efface le store + révoque les tokens côté backend → bascule sur la
  login window.

---

## 5. Persistance et chiffrement

### 5.1 Secure Store

Fichier : `<userData>/faktur-secure-store.json`
- macOS : `~/Library/Application Support/faktur-desktop/`
- Windows : `%APPDATA%\faktur-desktop\`
- Linux : `~/.config/faktur-desktop/`

Format : un simple map JSON `{ key: base64_ciphertext }`. Chaque valeur
est chiffrée avec `electron.safeStorage` (`src/crypto/safe_storage.js`) :
- macOS → Keychain
- Windows → DPAPI (lié à la session Windows de l'utilisateur)
- Linux → libsecret / kwallet (si dispo, sinon l'app refuse de persister)

Les clés stockées (voir `constants.storageKeys`) :
- `access_token` — token OAuth courant
- `refresh_token` — token OAuth de rafraîchissement
- `token_expires_at` — timestamp ms d'expiration de l'access
- `refresh_expires_at` — timestamp ms d'expiration du refresh
- `scopes` — scopes accordés

Même quelqu'un avec un accès complet au disque ne peut pas lire les
tokens sans aussi détenir la session OS de l'utilisateur.

### 5.2 Vault key (coffre-fort)

Faktur chiffre les données sensibles des utilisateurs (factures
détaillées, clients, etc.) avec une clé dérivée du mot de passe : la
**KEK**. Dans le navigateur, la KEK est dérivée au moment du login.
Dans le bureau, on n'a pas de mot de passe : on tente donc de récupérer
une KEK **déjà "warm"** dans le `key_store` du backend (issue d'une
session navigateur concurrente de l'utilisateur).

- Si une KEK warm existe → le backend la rewrap avec une clé de session
  dédiée et renvoie la clé dans `vaultKey`. Le bureau l'injecte dans
  `localStorage.faktur_vault_key` et l'api.ts frontend l'envoie via
  l'en-tête `X-Vault-Key` sur chaque requête.
- Sinon → `vaultLocked: true` et la shell bascule sur la login window
  avec `reason=vault_locked`. L'utilisateur doit aller déverrouiller son
  coffre dans le navigateur.

---

## 6. IPC (communication main ↔ renderer)

Les canaux sont centralisés dans `src/config/constants.js` pour que main
et renderer restent synchrones.

| Canal                        | Direction       | Rôle                                  |
|------------------------------|-----------------|---------------------------------------|
| `session:get-state`          | renderer → main | Lit l'état courant de la session      |
| `session:state-changed`      | main → renderer | Push du nouvel état à tous les        |
|                              |                 | renderers ouverts                     |
| `auth:start`                 | renderer → main | Déclenche le flux OAuth complet       |
| `auth:logout`                | renderer → main | Logout + révocation côté backend      |
| `vault:open-unlock`          | renderer → main | Ouvre la page de unlock dans le       |
|                              |                 | navigateur système                    |
| `window:open-external`       | renderer → main | Ouvre une URL dans le navigateur      |

### Preload bridges

- **login_preload.js** expose `window.faktur.{startAuth, logout, ...}`
  dans la login window.
- **shell_preload.js** expose `window.fakturDesktop.{isDesktop: true,
  version, logout, openVaultUnlock, ...}` dans la shell window. Le
  dashboard frontend lit `window.fakturDesktop?.isDesktop` pour
  détecter qu'il tourne dans Faktur Desktop (voir
  `apps/frontend/src/lib/is-desktop.ts`).

---

## 7. Variables d'environnement (.env)

Créer un `.env` à la racine du projet :

```bash
FAKTUR_OAUTH_CLIENT_ID=xxxxxxxxxxxxxxxx
FAKTUR_OAUTH_CLIENT_SECRET=yyyyyyyyyyyyyyyy
FAKTUR_OAUTH_SCOPES=profile invoices:read invoices:write clients:read clients:write vault:unlock offline_access

FAKTUR_API_BASE_URL=https://api.fakturapp.cc
FAKTUR_API_PREFIX=/api/v1
FAKTUR_DASHBOARD_URL=https://dash.fakturapp.cc
FAKTUR_AUTHORIZE_URL=https://dash.fakturapp.cc/oauth/authorize

FAKTUR_CALLBACK_HOST=127.0.0.1
FAKTUR_CALLBACK_PATH=/callback
FAKTUR_CALLBACK_PORT=0

FAKTUR_ENV=development
FAKTUR_DEVTOOLS=true
```

- `FAKTUR_CALLBACK_PORT=0` → le port est assigné dynamiquement par l'OS
  à chaque flux (évite les collisions).
- `FAKTUR_DEVTOOLS=true` → ouvre l'inspecteur Chromium en mode detached.
- Pour pointer vers un backend local :
  ```
  FAKTUR_API_BASE_URL=http://localhost:3333
  FAKTUR_DASHBOARD_URL=http://localhost:3000
  FAKTUR_AUTHORIZE_URL=http://localhost:3000/oauth/authorize
  ```

---

## 8. Développement

```bash
# Installation
npm install

# Lancement en dev (avec DevTools auto)
npm run start:dev

# Lancement en prod-like
npm run start

# Build installeur natif
npm run build:win      # .exe NSIS (Windows)
npm run build:mac      # .dmg (macOS)
npm run build:linux    # .AppImage (Linux)
```

Les builds sortent dans `dist/`.

---

## 9. Endpoints backend utilisés

| Méthode | Endpoint                          | Usage                                       |
|---------|-----------------------------------|---------------------------------------------|
| `POST`  | `/api/v1/oauth/token`             | Échange code ↔ token + refresh token        |
| `POST`  | `/api/v1/oauth/revoke`            | Révocation d'un token (logout)              |
| `POST`  | `/api/v1/oauth/exchange-session`  | OAuth token → token de session AdonisJS     |
| `GET`   | `/api/v1/auth/me`                 | Premier appel du dashboard au chargement    |
| `POST`  | `/api/v1/auth/logout`             | Appelé par le dashboard sur logout manuel   |

Le contrôleur backend `ExchangeSession` (`apps/backend/app/controllers/oauth/exchange_session.ts`) :
1. Valide le Bearer OAuth via `oauthTokenService.findActiveByAccessToken`.
2. Vérifie le scope `profile`.
3. Vérifie que l'utilisateur est actif.
4. Mint un token de session AdonisJS (1 jour de TTL) via `User.accessTokens.create`.
5. Rewrap la KEK en mémoire avec une clé de session si elle est disponible.
6. Retourne `{ token, user, vaultKey, vaultLocked }`.

---

## 10. Points importants corrigés

1. **`shell_window.js` — suppression de `installApiAuthBridge`** :
   l'ancien code écrasait l'en-tête `Authorization` sortant avec le
   token OAuth, au lieu de laisser passer le token de session AdonisJS
   posé par le frontend depuis `localStorage`. Le backend rejetait le
   token OAuth sur `/auth/me` → 401 → déclenchement d'un logout → effacement
   du secure store → au prochain démarrage, retour à la login window.
   **Le fix : ne plus toucher à l'`Authorization`, laisser le frontend
   gérer comme dans le navigateur.**

2. **`main.js` — `session_expired` ne wipe plus les tokens** :
   quand le dashboard redirige vers `/login` en cours d'usage, on
   réouvre la shell (qui refait un `exchange-session` avec le token
   OAuth toujours valide) au lieu de tout effacer.

3. **`token_manager.js` — refresh plus tolérant** :
   on ne wipe plus le store sur une erreur réseau transitoire. Seuls
   les 400/401 (refresh token vraiment mort) déclenchent un wipe.

---

## 11. Flux complet résumé

```
┌─────────────┐                ┌────────────────────┐
│  App Start  │                │   Backend Faktur   │
└──────┬──────┘                └──────────▲─────────┘
       │                                  │
       ▼                                  │
 bootstrap() lit secure store             │
       │                                  │
       ├── tokens OK ────▶ Shell Window   │
       │                      │           │
       │                      │ POST /oauth/exchange-session
       │                      ├──────────▶│
       │                      │           │
       │                      │◀──── { token, vaultKey, vaultLocked }
       │                      │           │
       │                      │ inject localStorage + loadURL(dashboard#...)
       │                      │           │
       │                      │ GET /auth/me (Bearer session_token)
       │                      ├──────────▶│
       │                      │◀──── user profile
       │                      │           │
       │                      ▼           │
       │              Dashboard rendu     │
       │                                  │
       └── pas de token ──▶ Login Window  │
                             │            │
                             │ click "Se connecter"
                             │            │
                             │ PKCE + loopback + shell.openExternal
                             │     ┌──────┴─────────┐
                             │     │  Navigateur    │
                             │     │  système       │
                             │     └──────┬─────────┘
                             │            │
                             │            │ POST /oauth/token
                             │            ├────────▶│
                             │            │◀──── { access_token, refresh_token }
                             │            │        │
                             │     redirect 127.0.0.1:<port>/callback
                             │            │        │
                             │◀───────────┘        │
                             │                     │
                             ▼                     │
                 secure store + _emit(AUTH)        │
                             │                     │
                             ▼                     │
                        Shell Window ──────────────┘
                        (cf. branche du haut)
```
