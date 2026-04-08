'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const ENV_PATH = path.join(PROJECT_ROOT, '.env')
const OUT_PATH = path.join(PROJECT_ROOT, 'src', 'config', 'env.bundle.bin')

// ---------- Obfuscated symmetric key ----------
// Baked into the binary. NOT a real secret — an attacker with asar
// extract + source reading can recover the plaintext. Raises the bar
// against plain-file recovery and keeps credentials out of string
// greps on the installed folder.
const OBFUSCATED_KEY_PARTS = [
  'ZmFrdHVyLWRlc2t0b3Atdg==',
  'Mi0xLWVudi1zYWx0',
  'LTIwMjYtdm9sdW50',
  'YXJpbHktdXNlZA==',
]

function deriveKey() {
  const seed = Buffer.concat(OBFUSCATED_KEY_PARTS.map((p) => Buffer.from(p, 'base64')))
  return crypto.createHash('sha256').update(seed).digest()
}

function parseEnvFile(raw) {
  const out = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function encrypt(plainJson) {
  const key = deriveKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(Buffer.from(plainJson, 'utf8')), cipher.final()])
  const tag = cipher.getAuthTag()
  const header = Buffer.from([0x46, 0x4b, 0x54, 0x31])
  return Buffer.concat([header, iv, tag, enc])
}

function main() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error(`[compile-env] .env not found at ${ENV_PATH}`)
    process.exit(1)
  }
  const raw = fs.readFileSync(ENV_PATH, 'utf8')
  const parsed = parseEnvFile(raw)
  const requiredKeys = ['FAKTUR_OAUTH_CLIENT_ID']
  for (const key of requiredKeys) {
    if (!parsed[key]) {
      console.error(`[compile-env] missing required key ${key} in .env`)
      process.exit(1)
    }
  }
  const json = JSON.stringify(parsed)
  const blob = encrypt(json)
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  fs.writeFileSync(OUT_PATH, blob)
  console.log(
    `[compile-env] wrote ${path.relative(PROJECT_ROOT, OUT_PATH)} (${blob.length} bytes, ${Object.keys(parsed).length} keys)`
  )
}

main()
