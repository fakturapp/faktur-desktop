# Faktur Desktop — Plan de durcissement et corrections

Date : 2026-04-08
Version cible : 2.1.0
Branche : `desktop`

Ce document décrit tout ce qui a été fait, ce qu'il reste à faire, et
dans quel ordre. Il est la contrepartie pratique du rapport d'audit
sécurité ([SECURITY_AUDIT.md](./SECURITY_AUDIT.md)).

---

## 1. Objectifs

1. **Corriger le bug fenêtres multiples** à la déconnexion.
2. **Durcir l'intégration Electron** : `contextIsolation`, `webSecurity`,
   partitions de session, blocage des permissions, etc.
3. **Éliminer la dépendance au `client_secret`** côté desktop : PKCE
   suffit pour un client public.
4. **Effacement total** de l'état local à la déconnexion.
5. **Signature cryptographique du User-Agent desktop** pour que le
   backend puisse distinguer un vrai client Faktur Desktop d'un
   navigateur qui spoofe l'en-tête.
6. **Refus du backend `basic_text`** de `safeStorage` (Linux sans
   libsecret / kwallet).
7. **Intégrité ASAR** + fuses Electron pour freiner le reverse
   engineering.
8. **Nettoyage complet** du code : retrait des commentaires verbeux,
   commentaires de section uniquement.
9. **Branding** : logo Faktur (chouette) à la place du "F", libellé
   "Faktur Desktop" dans la sidebar et la page About.
10. **Documentation** : `instruction.md`, `PLAN.md`, `SECURITY_AUDIT.md`.

---

## 2. État d'avancement

### Done

| # | Tâche | Fichiers modifiés |
|---|-------|-------------------|
| 1 | Bug fenêtres multiples au logout | `src/main/main.js`, `apps/frontend/src/lib/auth.tsx` |
| 2 | Ré-entrée `openForState` verrouillée | `src/main/main.js` |
| 3 | `sandbox: true` pour login, partitions dédiées | `src/windows/login_window.js`, `src/windows/shell_window.js` |
| 4 | `webSecurity`, `allowRunningInsecureContent: false`, fermeture des popups | `src/windows/shell_window.js` |
| 5 | `setPermissionRequestHandler` — blocage par défaut | `src/windows/shell_window.js` |
| 6 | `safeStorage` strict (refus `basic_text`) | `src/crypto/safe_storage.js` |
| 7 | `client_secret` retiré du desktop | `src/config/env.js`, `src/oauth/oauth_client.js` |
| 8 | Backend : `client_secret` optionnel pour public clients | `apps/backend/app/validators/oauth_validator.ts`, `apps/backend/app/services/oauth/oauth_app_service.ts`, `apps/backend/app/controllers/oauth/token.ts` |
| 9 | PKCE enforcé pour public clients côté backend | `apps/backend/app/controllers/oauth/token.ts` |
| 10 | HMAC desktop proof (header `X-Faktur-Desktop-Proof`) | `src/security/desktop_proof.js`, `src/windows/shell_window.js` |
| 11 | Vérif HMAC + anti-replay côté backend | `apps/backend/app/services/security/desktop_proof_service.ts` |
| 12 | Wipe total `session.clearStorageData` sur logout | `src/oauth/token_manager.js` |
| 13 | Logo Faktur dans login.html et loading.html | `renderer/login.html`, `renderer/loading.html`, `renderer/assets/logo.svg` |
| 14 | Sidebar "Faktur Desktop" conditionnel | `apps/frontend/src/components/layout/sidebar.tsx`, `apps/frontend/src/lib/is-desktop.ts` |
| 15 | Page About — carte Faktur Desktop | `apps/frontend/src/app/dashboard/about/page.tsx` |
| 16 | `asar: true` + `electronFuses` + macOS hardened runtime | `package.json` |
| 17 | Refactor : commentaires JSDoc supprimés, commentaires de section ajoutés | 14 fichiers JS |

### En cours / À compléter

- **Obfuscation JS** : `bytenode` ou `javascript-obfuscator` pour freiner
  l'extraction du `FAKTUR_DESKTOP_PROOF_KEY`. Approche recommandée :
  compiler les fichiers sensibles (`src/security/`, `src/oauth/`) en
  bytecode V8 avec `bytenode` et charger via `require('./module.jsc')`.
- **Device-bound keys** : remplacer le HMAC statique par un Ed25519
  généré à la première exécution, enregistré auprès du backend pendant
  le flux OAuth, et stocké dans `safeStorage`. Invalide automatiquement
  le spoofing par extraction de clé binaire.
- **Code signing** : certificat EV Windows + Apple Developer ID pour
  signer `.exe`/`.app`. À faire au moment de la release.
- **`build/entitlements.mac.plist`** à créer (`com.apple.security.app-sandbox`
  + runtime exceptions nécessaires pour `safeStorage`).
- **Tests E2E** : Playwright avec Electron launcher pour couvrir
  login/logout/expiration.
- **Télémétrie sécurité** : log anonyme des échecs de proof verification
  côté backend (flag admin).

### Suivi backend

- **Activer `requireDesktopProof` sur `/oauth/exchange-session`** dès que
  l'app desktop 2.1.0 est déployée chez tous les utilisateurs (rétro-
  compatibilité).
- **Admin UI** : bouton "Rotate desktop proof key" qui met à jour
  `FAKTUR_DESKTOP_PROOF_KEY` et pousse une mise à jour desktop forcée.
- **Détection anti-spoof** : ajouter un dashboard admin listant les
  requêtes qui claiment `FakturDesktop/*` UA mais n'ont pas de header
  proof ou dont le proof échoue.

---

## 3. Contraintes et décisions

### 3.1 Pourquoi `sandbox: false` sur la shell ?

Le fichier `shell_window.js` utilise `webContents.debugger.attach('1.3')`
pour exécuter `Page.addScriptToEvaluateOnNewDocument`. Le debugger CDP
n'est pas compatible avec `sandbox: true`. Mitigation :

- La shell ne charge QUE `https://dash.fakturapp.cc` + loopback + fichiers
  locaux signés.
- `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`.
- `setPermissionRequestHandler` n'autorise que `clipboard-read/write`.
- Partition de session isolée `persist:faktur-desktop-shell`.
- `allowRunningInsecureContent: false`, `experimentalFeatures: false`.

### 3.2 Pourquoi un HMAC plutôt qu'Ed25519 device-bound ?

C'est un compromis de v2.1 : le HMAC ne nécessite pas de refacto du flux
OAuth ni de table supplémentaire côté backend. Ed25519 device-bound est
prévu en v2.2 (voir section "À compléter").

### 3.3 Pourquoi garder la double tokenisation (OAuth + session AdonisJS) ?

- Le dashboard est une SPA Next.js existante qui attend un token
  AdonisJS dans `localStorage.faktur_token`. Changer ça impliquerait une
  refonte de `api.ts` et de toutes les routes d'auth.
- Les tokens OAuth ont une durée de vie longue (30 jours), les tokens
  AdonisJS sont courts (1 jour) : on limite l'exposition des tokens SPA
  sans refaire OAuth à chaque fois.
- Le pont `/oauth/exchange-session` est un point de contrôle unique
  qu'on peut révoquer globalement.

### 3.4 Pourquoi ne pas tout chiffrer client-side avec une clé desktop ?

Les données du dashboard sont déjà chiffrées bout-en-bout dans le coffre
Faktur : la KEK dérivée du mot de passe chiffre toutes les factures/
clients/produits sensibles via AES-256-GCM. Le token de session et le
HMAC proof ne protègent que le transport authentifié — ils transitent en
TLS 1.3. Ajouter une couche de chiffrement desktop supplémentaire
ajouterait de la complexité sans gain réel.

---

## 4. Commits effectués

Ordre chronologique sur `desktop` et `master` :

```
desktop       feat(ui): replace F letter with real Faktur owl logo in login + loading screens
desktop       feat(security): refuse persistence when safeStorage falls back to basic_text
desktop       feat(oauth): treat desktop as public client (PKCE only, drop client_secret)
desktop       feat(security): harden BrowserWindows, add signed desktop proof header
desktop       feat(auth): nuke all session partitions (cookies/localStorage/cache) on logout
desktop       fix(main): guard window swap against re-entry to stop multi-window logout loop
desktop       feat(ipc): expose app:get-info + strictly filtered fakturDesktop bridge

master        feat(oauth): make client_secret optional for public clients, enforce PKCE
master        feat(security): add HMAC-signed desktop proof verifier with nonce replay protection
master        feat(frontend): expose typed fakturDesktop bridge + version accessor
master        feat(sidebar): show "Faktur Desktop" + native version when running in desktop shell
master        feat(about): add Faktur Desktop info card with version + platform
master        fix(auth): delegate desktop logout to Electron main process to break multi-window loop
```

---

## 5. Roadmap prioritisée (post-Perplexity)

Ordre recommandé par le rapport d'audit Perplexity final, mappé à notre
backlog :

### P0 — Finalisation v2.1.0 (done)

| # | Item | Statut |
|---|------|--------|
| 1 | Logout/wipe complet testé | ✅ |
| 2 | `safeStorage` faible refusé | ✅ |
| 3 | Audit de toutes les fenêtres et IPC | ✅ `hardening.assertSecureWebPreferences` |
| 4 | Tests de base du desktop proof | ✅ `tests/desktop_proof.test.js` |
| 5 | Launch flags dangereux bloqués | ✅ `enforceLaunchFlagPolicy` |
| 6 | ASAR integrity + fuses | ✅ `package.json` |
| 7 | macOS entitlements | ✅ `build/entitlements.mac.plist` |

### P1 — Release production (pré-publication 2.1.0)

| # | Item | Statut |
|---|------|--------|
| 1 | Signer binaires Windows EV | ⬜ CI secret + certificat à provisionner |
| 2 | Signer binaires macOS Developer ID | ⬜ CI secret + certificat à provisionner |
| 3 | Notarization Apple (`xcrun notarytool submit`) | ⬜ |
| 4 | Vérifier fuses dans le binaire final (`electron-fuses --app dist/...`) | ⬜ |
| 5 | Tester l'ASAR integrity après modification manuelle (`.asar` corrompu → refus de boot) | ⬜ |
| 6 | Page de téléchargement + changelog publics | ⬜ |
| 7 | Télémétrie échecs de proof verification (dashboard admin) | ⬜ |

### P2 — v2.2 (durcissement avancé)

| # | Item | Statut |
|---|------|--------|
| 1 | Device-bound Ed25519 à la place du HMAC statique | ⬜ majeur — refonte OAuth registration + table backend |
| 2 | Obfuscation JS (`bytenode` pour `src/security/` + `src/oauth/`) | ⬜ |
| 3 | Anti-debug hooks (détection Frida / ptrace) | ⬜ |
| 4 | Tests E2E Playwright-Electron | ⬜ |
| 5 | Remettre la shell en sandbox (ou remplacer CDP par handshake preload) | ⬜ |
| 6 | Rotation automatique de la desktop proof key via electron-updater | ⬜ |
| 7 | Audit externe tiers | ⬜ |

---

## 6. Checklist de release 2.1.0

- [x] Tous les commits de la section 4 mergés sur `main`.
- [ ] `FAKTUR_DESKTOP_PROOF_KEY` défini en production dans les secrets
      backend (32+ caractères aléatoires).
- [ ] `FAKTUR_OAUTH_CLIENT_ID` rotaté et tagué `kind: 'desktop'` dans la
      table `oauth_apps`.
- [ ] Build `electron-builder --win --mac --linux` réussi avec signatures.
- [ ] Fuses Electron vérifiées dans l'.exe final (`electron-fuses --app
      dist/Faktur\ Desktop.exe`).
- [ ] Test E2E manuel :
  - [ ] Login via navigateur → redirection → dashboard
  - [ ] Fermeture de l'app → réouverture → toujours connecté
  - [ ] Déconnexion → login window affichée → un seul écran, pas de boucle
  - [ ] Inspection DevTools impossible en prod
  - [ ] Network : `X-Faktur-Desktop-Proof` présent sur toutes les
        requêtes API
- [ ] Publication du binaire signé sur <https://dash.fakturapp.cc/download>
- [ ] Entrée de changelog : référencer `SECURITY_AUDIT.md`
