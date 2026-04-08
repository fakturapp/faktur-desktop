<div align="center">

  <img src="renderer/assets/favicon.svg" alt="Faktur Desktop" height="40" />

  <p><strong>Politique de sécurité</strong></p>

</div>

---

## Signaler une vulnérabilité

La sécurité des utilisateurs de Faktur Desktop est une priorité absolue. Si vous découvrez une vulnérabilité, merci de la signaler de manière responsable.

**Ne créez pas d'issue publique.** Envoyez un email à :

> **contact@fakturapp.cc**

Incluez dans votre rapport :

- Une description claire de la vulnérabilité
- Les étapes pour la reproduire (OS, version du binaire, tag GitHub)
- L'impact potentiel estimé
- Une suggestion de correctif, si possible

Nous nous engageons à :

- Accuser réception sous **48 heures**
- Fournir une évaluation initiale sous **7 jours**
- Corriger les vulnérabilités critiques dans les plus brefs délais
- Créditer le reporter dans le changelog si souhaité

---

## Modèle de menace

Faktur Desktop est une application Electron open-source. Son modèle de menace suppose :

| Adversaire | Capacité | Protection |
|---|---|---|
| Malware sur la même machine, sans privilège root | Lire les fichiers utilisateur | `safeStorage` lie les jetons à la session OS |
| Utilisateur qui extrait l'asar | Lire le code source, les clés publiques, les constantes | Code source déjà public, clés publiques par design, aucun secret "vraiment secret" dans le binaire |
| Utilisateur qui rebuild un fork | Créer un clone avec du code malveillant | Attestation Ed25519 + badge bleu → le fork ne passe pas la vérification au runtime côté dashboard |
| Attaquant réseau (MITM local, point d'accès WiFi compromis) | Intercepter le trafic HTTP | HTTPS-only guard + TLS verify → seul le trafic HTTPS passe, sauf loopback OAuth |
| Bot/script qui spoofe l'User-Agent `FakturDesktop` | Contourner les contrôles "client desktop" côté backend | HMAC desktop proof signé par requête, vérifié par le backend avec replay protection |
| Debugger attaché au processus Electron | Extraire les jetons en RAM | `inspector.url()` watchdog → quit immédiat ; `enableNodeCliInspectArguments: false` dans les fuses |
| Physical access à la machine avec session OS verrouillée | Accéder aux fichiers du profil | `safeStorage` est déverrouillé uniquement quand la session OS est active |

Faktur Desktop **ne protège pas** contre :

- Un attaquant avec accès root à la machine et session OS débloquée
- Un utilisateur qui extrait sa propre clé privée de signature et rebuild le binaire comme "officiel" — c'est un problème de distribution, pas de logiciel
- Les zero-days Chromium/Electron non corrigés

---

## Architecture cryptographique

### Authentification OAuth2 + PKCE

Chaque flux d'authentification :

```
Click "Se connecter"
       │
       ▼
Génération PKCE : code_verifier (48 bytes) + code_challenge (SHA-256 base64url)
       │
       ▼
Démarrage serveur loopback 127.0.0.1:<port_aléatoire>/callback
       │
       ▼
shell.openExternal(https://dash.fakturapp.cc/oauth/authorize?...&code_challenge=...)
       │
       ▼
Utilisateur autorise dans le navigateur système
       │
       ▼
Callback reçu via loopback → validation du `state` → échange code + code_verifier
       │
       ▼
Réponse : { access_token, refresh_token, expires_in, refresh_expires_in }
       │
       ▼
Persistence via safeStorage (chiffrement OS-backed)
```

Le `code_verifier` n'est jamais écrit sur disque. Le `client_secret` n'est pas utilisé (desktop = public client). Les jetons sont rotés à chaque refresh.

### Attestation Ed25519

Au build :

```
1. electron-builder pack app.asar
2. Hook afterPack.js calcule SHA-256 de app.asar
3. Signe { version, asarSha256, issuedAt, expiresAt } avec la clé privée Ed25519
4. Écrit resources/attestation.json dans l'asar final
```

Au runtime (dans le binaire installé chez l'utilisateur) :

```
1. Lit resources/attestation.json
2. Vérifie la signature avec la clé publique hardcodée dans src/config/keys.js
3. Recalcule le SHA-256 de l'app.asar actuel
4. Compare avec le hash signé
5. Si les deux passent → reason: null, certified: true
```

La clé privée ne quitte jamais la machine du maintainer. Un fork qui rebuild sans cette clé ne peut pas produire une attestation valide → le dashboard n'affiche pas le badge bleu.

### Desktop proof HMAC

Chaque requête sortante vers l'API Faktur embarque trois headers :

```
X-Faktur-Desktop-Proof: <HMAC-SHA256(key, nonce + ts + client_id)>
X-Faktur-Desktop-Nonce: <16 bytes aléatoires base64url>
X-Faktur-Desktop-Ts:    <timestamp unix ms>
```

Le backend vérifie :

- La signature HMAC avec la même clé (partagée via env var serveur)
- La fraîcheur du timestamp (±5 min)
- L'unicité du nonce (cache LRU 10 000 entrées pour bloquer le replay)

Un bot qui met simplement `User-Agent: FakturDesktop/2.0` ne peut pas générer un proof valide sans la clé partagée. **Limitation** : la clé vit dans le binaire, donc un attaquant qui unpack l'asar peut l'extraire. Cette couche raises-the-bar, elle ne remplace pas une signature asymétrique device-bound.

### Chiffrement du bundle d'env

Le fichier `.env` contenant le `FAKTUR_OAUTH_CLIENT_ID` n'est jamais distribué en clair. Au build :

```
1. scripts/compile-env.js lit .env
2. Chiffre en AES-256-GCM avec une clé dérivée SHA-256 de 4 constantes obfusquées
3. Écrit src/config/env.bundle.bin (format: magic FKT1 + IV 12B + tag 16B + ciphertext)
```

Au runtime, `src/config/env.js` déchiffre le bundle avant le premier appel à `required('FAKTUR_OAUTH_CLIENT_ID')`. La clé de dérivation est compilée dans le code source — même niveau de protection qu'une constante JavaScript. Suffisant pour éviter un `grep FAKTUR_OAUTH_CLIENT_ID` sur le filesystem installé, insuffisant contre un reverse déterminé.

---

## Durcissement Electron

### webPreferences (toutes les fenêtres)

```js
{
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  webviewTag: false,
  devTools: false, // en production
}
```

Chaque création de `BrowserWindow` passe par `assertSecureWebPreferences()` qui throw si une de ces valeurs dévie du baseline.

### Electron Fuses

```json
{
  "runAsNode": false,
  "enableCookieEncryption": true,
  "enableNodeOptionsEnvironmentVariable": false,
  "enableNodeCliInspectArguments": false,
  "enableEmbeddedAsarIntegrityValidation": true,
  "onlyLoadAppFromAsar": true,
  "loadBrowserProcessSpecificV8Snapshot": false,
  "grantFileProtocolExtraPrivileges": false
}
```

Les fuses sont embarquées dans le binaire Electron et ne peuvent pas être désactivées à l'exécution. Elles :

- Empêchent le binaire de tourner en mode Node.js standalone
- Bloquent `NODE_OPTIONS` pour empêcher l'injection de `--inspect`
- Refusent `--inspect` et `--inspect-brk` en ligne de commande
- Vérifient l'intégrité de l'asar au démarrage (si modifié, refus de boot)
- Chiffrent les cookies persistés
- Retirent les privilèges spéciaux du protocole `file://`

### Launch flag policy

Au lancement, `src/security/hardening.js` rejette immédiatement l'app si un de ces flags est présent :

```
--no-sandbox
--disable-web-security
--disable-site-isolation-trials
--disable-features=IsolateOrigins
--allow-running-insecure-content
--remote-debugging-port
--remote-debugging-pipe
--inspect
--inspect-brk
--inspect-port
--js-flags=--inspect
--enable-logging
--v=
```

Cette vérification complète celle des fuses : même si quelqu'un arrive à contourner les fuses (binaire patché), le code JavaScript refuse toujours de démarrer.

---

## Ce que Faktur Desktop ne stocke pas

- Le mot de passe utilisateur — il ne transite jamais par l'app
- La KEK du coffre-fort — calculée côté serveur via dérivation Argon2id
- La DEK en clair — toujours chiffrée par la KEK
- Les cookies de session dashboard en dehors de la partition sandboxée
- Les fichiers de backup ou export locaux

---

## Versions supportées

Seule la dernière release GitHub reçoit des correctifs de sécurité. Les versions antérieures ne sont pas maintenues.

| Version | Support |
|---|---|
| Dernière version | Correctifs actifs |
| Versions antérieures | Non supportées |

Les utilisateurs sont fortement encouragés à activer l'auto-update (activé par défaut) pour recevoir immédiatement les correctifs critiques.

---

## Dépendances

Les dépendances sont auditées régulièrement via `npm audit`. Les mises à jour de sécurité critiques sont appliquées en priorité.

Dépendances runtime :

- `electron` — Chromium + Node.js
- `dotenv` — chargement de fichier env en dev mode uniquement

Aucune autre dépendance runtime. Toutes les librairies cryptographiques utilisées (`crypto`, `node:crypto`, `node:inspector`) sont fournies par la stdlib Node.js.

---

<div align="center">
  <sub>Voir le <a href="README.md">README</a> pour la vue d'ensemble du projet.</sub>
</div>
