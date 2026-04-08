'use strict'

// ---------- Official Ed25519 public key ----------
// This key verifies that a running Faktur Desktop binary was built and
// signed by the official maintainer. The matching private key lives
// ONLY on the maintainer's build machine (env var FAKTUR_DESKTOP_SIGNING_KEY).
//
// Replace this constant when rotating the signing key. Rotation
// invalidates every previously-released binary — make sure to publish
// the new version widely before doing it.
//
// Format: SPKI DER encoded public key, base64.
// Generate a fresh keypair with:
//   node scripts/generate-signing-key.js

const OFFICIAL_PUBLIC_KEY_SPKI_BASE64 =
  'MCowBQYDK2VwAyEAjtiVBX2ZylLz+cSmX2k5JMxYV1olEzrgBc1CtfMRObI='

module.exports = { OFFICIAL_PUBLIC_KEY_SPKI_BASE64 }
