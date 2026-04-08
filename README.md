# Faktur Desktop

<a href="https://fakturapp.cc"><img src="https://img.shields.io/badge/Site-fakturapp.cc-6366f1?style=flat-square" alt="Site" /></a>
<a href="https://dash.fakturapp.cc"><img src="https://img.shields.io/badge/App-dash.fakturapp.cc-818cf8?style=flat-square" alt="App" /></a>
<a href="https://github.com/fakturapp/faktur-desktop/releases/latest"><img src="https://img.shields.io/github/v/release/fakturapp/faktur-desktop?style=flat-square&color=22c55e" alt="Release" /></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/Licence-Personal_Use-ef4444?style=flat-square" alt="Licence" /></a>

Client de bureau Electron pour [Faktur](https://fakturapp.cc). Authentification OAuth2 + PKCE via le navigateur système, stockage des jetons dans le coffre-fort sécurisé du système d'exploitation, et aucun mot de passe ne transite par l'application.

> Faktur Desktop n'est pas un logiciel séparé : c'est le dashboard Faktur embarqué dans une fenêtre native, avec tous les avantages d'une app de bureau (auto-update, icône dans la barre des tâches, raccourci clavier) et sans compromettre la sécurité zero-access du coffre-fort.

## Pourquoi une app de bureau

- **Sessions longue durée** — les jetons OAuth2 sont conservés dans le Keychain macOS, DPAPI Windows ou libsecret Linux, pas dans un cookie de navigateur qui peut disparaître
- **Lancement direct** — un clic sur l'icône te redonne Faktur, pas besoin d'ouvrir un navigateur, taper une URL et te connecter
- **Mises à jour automatiques** — l'app vérifie les nouvelles releases GitHub et propose l'update dans la sidebar
- **Pas de mot de passe dans Electron** — toute l'authentification passe par le navigateur système, seul le jeton OAuth arrive dans l'app
- **Intégrité vérifiée** — le binaire officiel est signé par le maintainer, le dashboard affiche un badge ✓ bleu à côté de "Faktur Desktop" quand la signature Ed25519 correspond

## Architecture

```
faktur-desktop/
├── src/
│   ├── config/          Chargement .env + constantes + clés publiques
│   ├── crypto/          Wrapper safeStorage (OS-backed encryption)
│   ├── loopback/        Serveur HTTP éphémère pour le callback OAuth
│   ├── oauth/           Client OAuth2, PKCE, rotation des jetons
│   ├── store/           Stockage clé-valeur chiffré persistant
│   ├── ipc/             Bridge main ↔ renderer
│   ├── security/        Durcissement Electron + attestation + desktop proof
│   ├── update/          Auto-updater via GitHub Releases
│   ├── windows/         Factories BrowserWindow (login, shell, update)
│   └── main/            Point d'entrée app
├── renderer/
│   ├── login.html       Page de connexion OAuth (avant auth)
│   ├── loading.html     Splash pendant exchange-session
│   ├── update.html      Écran de téléchargement de mise à jour
│   ├── js/              Scripts UI renderer
│   ├── preload/         Ponts contextBridge
│   └── assets/          Logos, favicons
├── scripts/
│   ├── compile-env.js       Chiffre .env en bundle AES-256-GCM
│   ├── generate-icon.js     Génère icon.png 512x512 depuis le logo
│   ├── generate-signing-key.js  Crée la keypair Ed25519 one-shot
│   ├── afterPack.js         Hook electron-builder : signe l'asar
│   └── strip-comments.js    Nettoie les commentaires du code source
└── build/                   Entitlements macOS + icônes générés
```

## Sécurité

Faktur Desktop combine plusieurs couches :

| Couche | Rôle |
|---|---|
| **OAuth2 + PKCE (RFC 7636)** | Aucun mot de passe dans l'app, code_verifier éphémère par flow |
| **safeStorage OS-backed** | Jetons persistés via Keychain/DPAPI/libsecret, refus du mode `basic_text` |
| **Ed25519 attestation** | Signature de l'asar au build, vérifiée au runtime, badge ✓ si officiel |
| **HMAC desktop proof** | Header signé sur chaque requête API → backend distingue vrai client vs bot |
| **Electron sandbox** | `contextIsolation`, `nodeIntegration: false`, `sandbox: true` sur toutes les fenêtres |
| **Electron fuses** | `runAsNode: false`, `onlyLoadAppFromAsar: true`, ASAR integrity |
| **CSP strict** | `default-src 'none'` sur tous les HTML locaux |
| **Launch flag policy** | Refuse `--inspect`, `--remote-debugging-port`, etc. |
| **Inspector watchdog** | Détection runtime d'un inspecteur Node via `inspector.url()` |
| **Permission blocker** | Caméra, micro, géoloc, notifs bloquées par défaut |
| **HTTPS-only guard** | Bloque tout trafic non-HTTPS sauf loopback OAuth |
| **TLS certificate verify** | Hook `setCertificateVerifyProc` pour logger les anomalies |
| **Total wipe au logout** | Cookies + localStorage + cache + indexedDB + jetons OAuth |
| **env.bundle.bin chiffré** | Le `.env` est compilé en AES-256-GCM au build, jamais en clair sur disque |

Pour la politique complète, voir [SECURITY.md](./SECURITY.md).

## Installation (utilisateur)

1. Télécharge la dernière release sur [github.com/fakturapp/faktur-desktop/releases/latest](https://github.com/fakturapp/faktur-desktop/releases/latest)
2. Lance `FakturDesktop-Installer.exe` (Windows) ou le `.dmg`/`.AppImage` équivalent
3. Au premier démarrage, clique sur **Se connecter avec Faktur**
4. Ton navigateur s'ouvre sur `dash.fakturapp.cc/oauth/authorize` → tu autorises → retour auto dans l'app

## Développement

```bash
git clone https://github.com/fakturapp/faktur-desktop
cd faktur-desktop
cp .env.example .env
# Remplis FAKTUR_OAUTH_CLIENT_ID avec la valeur générée depuis
# dash.fakturapp.cc → Admin → Applications OAuth → Nouvelle
npm install
npm run start:dev
```

En mode `start:dev`, les DevTools s'ouvrent automatiquement, tous les raccourcis clavier (F12, Ctrl+R) fonctionnent, et les protections anti-debug sont désactivées.

## Build production

```bash
# Génère icon.png/ico, compile l'env chiffré, puis packe
npm run build:win      # Windows NSIS installer
npm run build:mac      # macOS DMG
npm run build:linux    # Linux AppImage
```

Chaque build :

1. `scripts/generate-icon.js` → `build/icon.png` + `build/icon.ico` (512×512)
2. `scripts/compile-env.js` → `src/config/env.bundle.bin` (AES-256-GCM)
3. `electron-builder` → `dist/FakturDesktop-Installer.exe`

Pour signer aussi le binaire comme "officiel" (nécessaire pour que le badge ✓ apparaisse dans la sidebar Faktur), définis `FAKTUR_DESKTOP_SIGNING_KEY` dans l'environnement avant le build. Voir [generate-signing-key.js](./scripts/generate-signing-key.js) pour générer une keypair Ed25519.

## Publier une release

1. Bump la version dans `package.json` (ex : `"version": "2.1.0"`)
2. `npm run build:win`
3. Va sur [github.com/fakturapp/faktur-desktop/releases/new](https://github.com/fakturapp/faktur-desktop/releases/new)
4. **Tag** : `v2.1.0` (le préfixe `v` est optionnel, mais le tag DOIT contenir un numéro de version)
5. **Title** : `Faktur 2.1.0` (contient aussi le numéro de version — sert de fallback si le tag est mal formé)
6. Upload `dist/FakturDesktop-Installer.exe` comme asset
7. Coche **Set as the latest release**
8. Publie

> **Important** : ne tague JAMAIS une release avec un label non-numérique comme `latest`, `stable`, etc. L'auto-updater cherche un semver dans le tag OU dans le titre de la release. Si ni l'un ni l'autre ne contient de version parsable, aucun client ne verra l'update.

## Auto-update

L'app interroge l'API GitHub toutes les heures :

```
GET https://api.github.com/repos/fakturapp/faktur-desktop/releases/latest
```

Si la version distante est supérieure à la version locale ET qu'un asset `FakturDesktop-Installer.exe` existe, une carte "Mise à jour disponible" apparaît dans la sidebar du dashboard. Un clic sur "Relancer maintenant" ferme l'app, télécharge l'installeur dans `%TEMP%` et le lance avec `/S --force-run` (silencieux + relance auto).

## Licence

Faktur Desktop — Personal Use License © 2026 danbenba. Voir [LICENSE](./LICENSE).

Usage personnel uniquement. Pas d'utilisation commerciale, pas de redistribution, pas de produits dérivés.
