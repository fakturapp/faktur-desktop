# Faktur Desktop — Rapport d'audit sécurité

Date : 2026-04-08
Cible : Faktur Desktop 2.1.0 (post-durcissement)
Auditeur : interne + synthèse Perplexity (sources ci-dessous)

Ce document reprend le rapport Perplexity fourni, confirme ou infirme
chaque point, documente les mitigations appliquées dans la release
2.1.0, et liste les risques résiduels avec priorité.

---

## Résumé exécutif

> **Verdict** : Faktur Desktop 2.1.0 est **sécurisé pour une application
> de bureau "normale"**. Les fondamentaux OAuth2 (PKCE, navigateur
> système, refresh rotation) sont bons. Le durcissement Electron a été
> appliqué. Il reste des risques classiques du bureau (extraction du
> binaire, compromission OS) qui ne peuvent pas être intégralement
> résolus côté client et qui sont documentés ici comme acceptés.

Statut global par catégorie :

| Catégorie | Statut |
|-----------|--------|
| Authentification OAuth2 | ✅ Bon (PKCE + loopback + navigateur système) |
| Stockage local | ✅ Bon (safeStorage strict, basic_text refusé) |
| Fenêtre Electron | ✅ Bon (contextIso, webSecurity, partitions, permissions) |
| Communication client↔backend | ⚠️ Acceptable (TLS + HMAC desktop proof) |
| Anti-extraction du binaire | ⚠️ Partiel (asar integrity + fuses, pas d'obfuscation) |
| Coffre-fort chiffré | ✅ Bon (KEK zero-access AES-256-GCM côté backend) |

---

## 1. Usage du `client_secret`

**Diagnostic Perplexity** : un `client_secret` embarqué dans une app
desktop n'offre pas de garantie réelle car il est extractible. PKCE est
justement prévu pour éviter cette dépendance.

**Statut 2.1.0** : ✅ **Corrigé**.

- `FAKTUR_OAUTH_CLIENT_SECRET` retiré du `.env.example` et de
  `src/config/env.js`.
- Tous les appels `oauth_client.js` envoient `client_id` mais plus
  `client_secret`.
- Backend : `OauthAppService.authenticateClient` skip la vérification
  du secret pour les clients marqués `kind: 'desktop'` ou `'cli'`
  (nouveau helper `isPublicClient()`).
- Backend `token.ts` impose PKCE obligatoirement pour les clients
  publics (erreur `invalid_grant` si le code n'a pas de `code_challenge`).

**Risque résiduel** : aucun sur ce point précis.

---

## 2. Risque du loopback OAuth

**Diagnostic Perplexity** : le redirect `127.0.0.1:<port>` peut être
intercepté par une autre application locale sur certaines plateformes.
PKCE limite fortement mais n'élimine pas totalement.

**Statut 2.1.0** : ⚠️ **Accepté avec mitigations**.

- Port dynamique (`port: 0`) : OS assigne un port libre ; l'attaquant
  doit deviner.
- Validation stricte du `state` : CSRF-safe.
- `state` mismatch → rejet immédiat + reject de la promesse.
- `codeChallenge` S256 : un attaquant qui intercepte le code ne peut
  pas l'échanger sans le `code_verifier`.
- Timeout 5 min : au-delà, le serveur se ferme.

**Risque résiduel** : une app malveillante déjà présente sur la machine
qui monitore activement les ports loopback pourrait théoriquement
intercepter l'URL du callback. Mais sans le `code_verifier` (jamais
écrit sur disque, uniquement en RAM du main process Electron), elle ne
peut pas échanger le code. Le seul DoS possible (répondre plus vite que
le callback légitime) est contré par le single-instance lock.

---

## 3. Fenêtre Electron sensible

**Diagnostic Perplexity** : une `BrowserWindow` qui charge du contenu
distant doit avoir `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`, et bloquer les APIs dangereuses.

**Statut 2.1.0** : ✅ **Corrigé (avec exception documentée)**.

Nouveau `webPreferences` de la shell :

```js
{
  contextIsolation: true,           // ✅
  nodeIntegration: false,           // ✅
  sandbox: false,                   // ⚠️ nécessaire pour CDP debugger
  webSecurity: true,                // ✅ nouveau
  allowRunningInsecureContent: false, // ✅ nouveau
  experimentalFeatures: false,      // ✅ nouveau
  session: shellSession,            // ✅ partition dédiée
}
```

Nouveau `webPreferences` de la login window :

```js
{
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,                    // ✅ full sandbox
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  session: loginSession,            // partition séparée de la shell
}
```

`sandbox: false` sur la shell est nécessaire pour que le debugger CDP
puisse injecter le bootstrap script via `Page.addScriptToEvaluateOnNewDocument`.
Mitigations additionnelles pour compenser :

- `setPermissionRequestHandler` : seules `clipboard-read` et
  `clipboard-sanitized-write` sont acceptées.
- `setWindowOpenHandler` : bloque toutes les popups, délégue à
  `shell.openExternal`.
- Guard `will-navigate` : bloque toute navigation hors du dashboard, de
  l'API, du loopback ou des fichiers locaux.

**Risque résiduel** : une XSS persistante dans le dashboard web pourrait
exécuter du code dans le renderer shell. Mitigation : le dashboard
applique déjà CSP strict + React auto-escape. Voir point 4 pour la
gestion des secrets exposés au renderer.

---

## 4. Injection de tokens dans `localStorage`

**Diagnostic Perplexity** : placer `faktur_token` + `faktur_vault_key`
dans `localStorage` augmente la surface d'attaque en cas de XSS.

**Statut 2.1.0** : ⚠️ **Accepté avec mitigations**.

Changer ça impliquerait de refondre toute la couche `api.ts` du
dashboard, ce qui dépasse le périmètre 2.1.0. Mitigations appliquées :

- Le token de session AdonisJS est **court** (1 jour) et **révocable**.
  Une compromission est limitée dans le temps.
- La `vaultKey` est **dérivée** d'une KEK serveur : elle n'est pas la
  clé maîtresse. Un attaquant qui vole la vaultKey ne peut plus
  déchiffrer après rotation du KEK.
- CSP strict côté dashboard empêche le chargement de scripts externes.
- Les requêtes API sont signées par le header `X-Faktur-Desktop-Proof`
  sur le desktop — un attaquant XSS qui copie le token ne peut pas
  reproduire le proof sans avoir extrait la clé du binaire.

**Risque résiduel** : XSS persistante + extraction de la clé binaire =
session complètement compromise. Mitigation v2.2 : device-bound Ed25519.

---

## 5. `safeStorage` non uniforme

**Diagnostic Perplexity** : sur Linux, `safeStorage` peut tomber sur
`basic_text` (protection très faible).

**Statut 2.1.0** : ✅ **Corrigé**.

`src/crypto/safe_storage.js` appelle `safeStorage.getSelectedStorageBackend()`
et refuse catégoriquement si le résultat est dans `WEAK_BACKENDS` :

```js
const WEAK_BACKENDS = new Set(['basic_text'])

function ensureAvailable() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new SafeStorageError('OS-level encryption is not available...')
  }
  const backend = getBackend()
  if (WEAK_BACKENDS.has(backend)) {
    throw new SafeStorageError(
      `safeStorage fell back to '${backend}' — refusing to persist secrets.`
    )
  }
}
```

L'utilisateur Linux est donc forcé d'installer libsecret-tools / kwallet.
En prod, l'AppImage bundle documentera cette dépendance.

---

## 6. Double tokenisation OAuth + AdonisJS

**Diagnostic Perplexity** : séparation defensive mais complexité
augmentée, multiplication des points de rupture.

**Statut 2.1.0** : ⚠️ **Acceptée, documentée**.

Le pont `POST /oauth/exchange-session` reste le point de contrôle
unique. Voir [instruction.md](../instruction.md) pour le flux complet.
Le bug de 2.0 ("réentrée infinie sur logout") a été corrigé :

- `main.js` a un mutex `swapping` qui empêche la ré-entrée de
  `openForState`.
- `reason: 'session_expired'` ne wipe plus les tokens OAuth.
- `reason: 'user_logout'` wipe tout + reason prioritaire.
- Le frontend appelle `window.fakturDesktop.logout()` **avant** toute
  navigation vers `/login` quand il est dans Faktur Desktop.

---

## 7. Dépendance à une session navigateur warm

**Diagnostic Perplexity** : le vault ne peut se déverrouiller que si une
KEK est warm dans le key store backend via une session navigateur
concurrente.

**Statut 2.1.0** : ⚠️ **Accepté, par design**.

Le coffre chiffré ne peut jamais être déverrouillé sans mot de passe.
Permettre au desktop de déverrouiller en solo demanderait soit un
password prompt natif (qui casserait la promesse "zero password dans
Electron"), soit un stockage du mot de passe (refusé). La v2.1 reste
sur la même logique : vault locked → login window → bascule navigateur.

Améliorations possibles en v2.2 :

- **Passkeys** : utiliser WebAuthn via le navigateur système pour
  débloquer le vault sans mot de passe.
- **Touch ID / Windows Hello** : Electron 35+ expose des APIs
  biométriques.

---

## 8. Rechargement sur `/login`

**Diagnostic Perplexity** : réouvrir la shell sur `/login` peut masquer
un vrai problème de session.

**Statut 2.1.0** : ✅ **Corrigé**.

Distinction explicite dans `main.js` :

- `reason === 'session_expired'` (redirection automatique du dashboard) :
  réouvre la shell, ne wipe rien.
- `reason === 'token_invalid'` (OAuth token refusé par le backend) :
  wipe tout, bascule login.
- `reason === 'user_logout'` (utilisateur explicite) : wipe tout +
  révocation remote, bascule login.

Le frontend (`auth.tsx logout()`) distingue maintenant desktop et web :
si `window.fakturDesktop?.logout` existe, le frontend délègue au main
process et s'arrête là. Fini la boucle de réouverture.

---

## 9. IPC et preload

**Diagnostic Perplexity** : les bridges IPC doivent être strictement
filtrés.

**Statut 2.1.0** : ✅ **Corrigé**.

`renderer/preload/shell_preload.js` :

```js
contextBridge.exposeInMainWorld('fakturDesktop', {
  isDesktop: true,
  version: '2.0.0',
  platform: process.platform,
  getSessionState: () => ipcRenderer.invoke('session:get-state'),
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  openVaultUnlock: () => ipcRenderer.invoke('vault:open-unlock'),
  openExternal: (url) => {
    if (typeof url !== 'string') return Promise.resolve({ ok: false })
    return ipcRenderer.invoke('window:open-external', url)
  },
  onSessionChange: (listener) => { /* event subscription */ },
})
```

- Pas d'accès direct à `ipcRenderer` ni aux modules Node.
- Toutes les méthodes passent par des canaux IPC nommés, chacun validé
  côté main process (`ipc_handlers.js`).
- `openExternal` valide le protocole HTTPS avant d'appeler
  `shell.openExternal` (déjà présent, confirmé).

---

## 10. Navigation et contenu distant

**Diagnostic Perplexity** : contrôler toutes les navigations et popups.

**Statut 2.1.0** : ✅ **Corrigé**.

- `win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))` :
  toute tentative de `window.open` redirige vers le navigateur système.
- `contents.setWindowOpenHandler(() => ({ action: 'deny' }))` au niveau
  de `app.on('web-contents-created')` pour capturer aussi les iframes.
- `installNavigationGuard` bloque `will-navigate` et
  `did-navigate-in-page` hors whitelist.
- Permissions OS (microphone, caméra, notifications, géolocation) :
  refusées par défaut via `setPermissionRequestHandler`.

---

## 11. Secret stocké dans `.env`

**Diagnostic Perplexity** : ne pas surestimer la sécurité des `.env`
dans un binaire.

**Statut 2.1.0** : ✅ **Partiellement corrigé**.

- Le `client_secret` n'est plus dans le `.env` du desktop (retiré).
- Les variables publiques (URLs, client_id, scopes) restent dans le
  `.env` : ce ne sont PAS des secrets au sens cryptographique.
- Le `FAKTUR_DESKTOP_PROOF_KEY` n'est PAS dans le `.env` distribué :
  il est embarqué en tant que constante dans `src/security/desktop_proof.js`
  avec une valeur fallback compilée. En prod, il sera injecté au build
  via `electron-builder` et un CI/CD secret.
- Mitigation contre l'extraction : ASAR integrity (voir point 12).

---

## 12. Surface d'attaque globale

**Diagnostic Perplexity** : accumulation de surfaces sensibles.

**Statut 2.1.0** : ⚠️ **Réduite, mais non éliminée**.

Mesures appliquées dans 2.1.0 :

- **ASAR integrity** : `asar: true` + `electronFuses.enableEmbeddedAsarIntegrityValidation: true`.
  Electron refuse de charger un `.asar` modifié après signature.
- **Electron fuses** :
  - `runAsNode: false` — empêche l'exécution comme Node.js CLI.
  - `enableNodeOptionsEnvironmentVariable: false` — bloque
    `NODE_OPTIONS` qui pouvait charger des scripts attaquants.
  - `enableNodeCliInspectArguments: false` — bloque `--inspect`.
  - `onlyLoadAppFromAsar: true` — refuse de charger depuis un dossier
    non-ASAR.
  - `grantFileProtocolExtraPrivileges: false` — durcit `file://`.
- **Cookie encryption** : `enableCookieEncryption: true`.
- **macOS hardened runtime** : `hardenedRuntime: true` +
  `entitlements` restreints.
- **Windows** : `signAndEditExecutable: true` + `signingHashAlgorithms: ['sha256']`.
- **Partitions de session** séparées shell/login : une compromission de
  cookies dans une partition ne touche pas l'autre.
- **Wipe complet à la déconnexion** : `session.clearStorageData` sur
  toutes les partitions + `clearCache` + `clearAuthCache` +
  `clearHostResolverCache`.

Ce qu'il reste à faire en v2.2 :

- **Obfuscation JS** avec `javascript-obfuscator` ou compilation
  bytecode V8 avec `bytenode` pour `src/security/` et `src/oauth/`.
- **Device-bound Ed25519 keys** à la place du HMAC statique.
- **Anti-debug hooks** : détection de Frida / ptrace / breakpoint au
  démarrage, sortie immédiate si détecté.
- **Code signing production** avec certificats EV pour Windows et
  Apple Developer ID pour macOS.

---

## 13. Nouveau : signature cryptographique desktop

**Ajout 2.1.0** (pas dans le rapport Perplexity initial).

Tous les appels desktop vers l'API portent maintenant trois headers :

```
X-Faktur-Desktop-Proof: <HMAC-SHA256 base64url>
X-Faktur-Desktop-Nonce: <16 bytes base64url>
X-Faktur-Desktop-Ts:    <unix ms>
```

Le backend vérifie avec `DesktopProofService.verifyDesktopProof` :

1. Fraicheur du timestamp (`±5 min` max).
2. Non-replay du nonce (cache LRU de 10 000 entrées).
3. Validité HMAC (`timingSafeEqual` sur SHA-256 de `nonce:ts:clientId`
   avec la clé partagée).

**Limitations** : la clé HMAC est statique et compilée dans le binaire.
Un attaquant qui unpack l'ASAR peut l'extraire. C'est **acceptable**
comme défense en profondeur contre les bots/navigateurs qui spoofent
l'User-Agent, mais **pas** comme défense contre un attaquant
déterminé. La rotation périodique de la clé + v2.2 Ed25519 est le
chemin d'évolution.

---

## 14. Risques résiduels classés

| # | Risque | Sévérité | Mitigation appliquée | Mitigation future |
|---|--------|----------|----------------------|-------------------|
| A | Extraction de `FAKTUR_DESKTOP_PROOF_KEY` du binaire | Moyenne | ASAR integrity + fuses | Bytecode V8 + Ed25519 device-bound |
| B | XSS persistante dans dashboard → vol de token | Haute | CSP dashboard + wipe sur logout + session TTL 1j | Migration vers cookies HttpOnly + BFF |
| C | Compromission complète de la session OS utilisateur | Très haute | Tokens chiffrés par `safeStorage` lié à l'OS user | Rien de réaliste — l'OS user est la racine de confiance |
| D | Interception loopback par autre app locale | Faible | PKCE + state + timeout | Port ≠ loopback impossible sans HTTPS local cert |
| E | Fork/recompile d'un faux client Faktur Desktop qui bypass les contrôles | Moyenne | HMAC proof + code signing | App store distribution obligatoire |
| F | Révocation d'une clé compromise | Moyenne | Rotation via `FAKTUR_DESKTOP_PROOF_KEY` | Push de mise à jour forcée via electron-updater |
| G | `safeStorage` fallback en `basic_text` | Haute (avant) → Nulle (après) | Refus explicite | — |

---

## 15. Sources et références

- Electron security tutorial : <https://electronjs.org/docs/latest/tutorial/security>
- Electron `safeStorage` API : <https://electronjs.org/docs/latest/api/safe-storage>
- Electron fuses : <https://www.electronjs.org/docs/latest/tutorial/fuses>
- RFC 8252 (OAuth 2.0 for Native Apps) : <https://datatracker.ietf.org/doc/html/rfc8252>
- RFC 7636 (PKCE) : <https://datatracker.ietf.org/doc/html/rfc7636>
- Bishop Fox — Reasonably secure Electron : <https://bishopfox.com/blog/reasonably-secure-electron>
- Context isolation : <https://electronjs.org/docs/latest/tutorial/context-isolation>

---

## Verdict final v2.1.0

Faktur Desktop est maintenant au niveau **"sécurisé pour usage
professionnel normal"**. Les corrections critiques (P0) sont toutes
appliquées. Les points résiduels (obfuscation, Ed25519 device-bound,
code signing production) sont documentés dans le [PLAN.md](./PLAN.md)
comme objectifs v2.2.

**Recommandation** : déployer 2.1.0 en production après validation
manuelle de la checklist de release, et lancer immédiatement l'itération
2.2 pour les points résiduels.
