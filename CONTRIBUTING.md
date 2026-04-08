<div align="center">

  <img src="renderer/assets/favicon.svg" alt="Faktur Desktop" height="40" />

  <p><strong>Guide de contribution</strong></p>

</div>

---

Merci de vouloir contribuer à Faktur Desktop. Ce projet est sous [Personal Use License](./LICENSE) : le code est ouvert pour audit et transparence, mais les contributions acceptées doivent respecter cette licence restrictive.

## Avant de contribuer

1. Lisez la [LICENSE](./LICENSE). Les forks destinés à créer un client concurrent ne seront pas acceptés.
2. Lisez la [politique de sécurité](./SECURITY.md). Toute vulnérabilité doit être signalée en privé à `support@fakturapp.cc`, pas via une pull request publique.
3. Vérifiez que votre idée n'est pas déjà discutée dans les [issues](https://github.com/fakturapp/faktur-desktop/issues).

## Signaler un bug

Les bugs visuels, les problèmes de compatibilité OS, les crashes ou les comportements inattendus peuvent être rapportés via [GitHub Issues](https://github.com/fakturapp/faktur-desktop/issues/new).

Incluez toujours :

- Version exacte (visible dans la sidebar Faktur ou dans `package.json`)
- OS + version (Windows 11 22H2, macOS 14.2, Ubuntu 24.04, etc.)
- Étapes de reproduction
- Logs s'il y en a (lancez le binaire depuis un terminal pour capturer stdout)
- Capture d'écran si le bug est visuel

**Ne postez jamais** votre `FAKTUR_OAUTH_CLIENT_ID`, vos jetons OAuth ou votre clé privée Ed25519.

## Proposer une amélioration

Les propositions d'amélioration sont bienvenues via [GitHub Issues](https://github.com/fakturapp/faktur-desktop/issues/new). Avant de coder, ouvrez une issue pour discuter de l'approche — ça évite que votre PR soit rejetée pour des raisons d'architecture ou de modèle de menace.

## Pull requests

Les PR qui sont acceptées :

- Correctifs de bugs clairement identifiés
- Améliorations de sécurité (hors vulnérabilités — voir [SECURITY.md](./SECURITY.md))
- Traductions de l'UI (i18n)
- Améliorations de documentation
- Support de nouvelles plateformes (ex : ARM Linux, Windows on ARM)

Les PR qui seront refusées :

- Changements de licence ou suppression de mentions de copyright
- Modifications qui transforment l'app en produit dérivé
- Ajout de dépendances lourdes sans justification
- Code qui introduit des failles de sécurité (bypass CSP, disable sandbox, etc.)
- Changements cosmétiques massifs sans discussion préalable

### Format des commits

Nous utilisons le format [Conventional Commits](https://www.conventionalcommits.org/) :

```
feat(oauth): add device-bound Ed25519 keys for attestation
fix(login): remove animation-fill-mode:both to prevent black page
docs(security): document the HMAC proof limitation
chore(deps): bump electron to 36.0.0
```

### Processus

1. Fork le dépôt
2. Crée une branche : `git checkout -b feat/ma-feature`
3. Code + test local : `npm run start:dev`
4. Strip les commentaires : `node scripts/strip-comments.js src renderer`
5. Vérifie la syntaxe : `node --check src/**/*.js`
6. Lance les tests unitaires : `npm test`
7. Commit avec un message conforme
8. Push sur ton fork
9. Ouvre une PR vers `main` avec une description claire

### Revue

Chaque PR est relue manuellement par le maintainer avant merge. Les PR qui touchent à la sécurité (hardening, CSP, sandbox, crypto) peuvent prendre plus de temps.

## Environnement de développement

```bash
git clone https://github.com/fakturapp/faktur-desktop
cd faktur-desktop
cp .env.example .env
# Remplis FAKTUR_OAUTH_CLIENT_ID dans .env
npm install
npm run start:dev
```

En mode dev, les DevTools s'ouvrent automatiquement et la plupart des protections anti-debug sont désactivées pour ne pas gêner le développement. Voir `src/security/hardening.js` → `isDevMode()`.

## Zones sensibles

Ces fichiers demandent une attention particulière lors d'une PR :

- `src/security/hardening.js` — durcissement global, fuses, CSP, sandbox
- `src/security/attestation.js` — vérification Ed25519 au runtime
- `src/security/desktop_proof.js` — HMAC desktop proof
- `src/config/keys.js` — clé publique officielle
- `src/oauth/token_manager.js` — logique de rotation des jetons
- `src/main/main.js` — ordre d'initialisation (launch flag policy en premier)
- `scripts/afterPack.js` — signature au build

Toute modification dans ces fichiers doit être accompagnée d'une justification claire dans le message de commit et la description de la PR.

## Code de conduite

Voir [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Licence des contributions

En soumettant une PR, vous acceptez que votre contribution soit publiée sous la [Personal Use License](./LICENSE) du projet, et que le copyright reste attribué à danbenba.

---

<div align="center">
  <sub>Voir le <a href="README.md">README</a> pour la vue d'ensemble du projet.</sub>
</div>
