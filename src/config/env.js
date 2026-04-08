'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const dotenv = require('dotenv')
const { app } = require('electron')

const OBFUSCATED_KEY_PARTS = [
  'ZmFrdHVyLWRlc2t0b3Atdg==',
  'Mi0xLWVudi1zYWx0',
  'LTIwMjYtdm9sdW50',
  'YXJpbHktdXNlZA==',
]

function deriveBundleKey() {
  const seed = Buffer.concat(OBFUSCATED_KEY_PARTS.map((p) => Buffer.from(p, 'base64')))
  return crypto.createHash('sha256').update(seed).digest()
}

function decryptBundle(blob) {
  if (blob.length < 4 + 12 + 16) return null
  const magic = blob.subarray(0, 4)
  if (!(magic[0] === 0x46 && magic[1] === 0x4b && magic[2] === 0x54 && magic[3] === 0x31)) {
    return null
  }
  const iv = blob.subarray(4, 16)
  const tag = blob.subarray(16, 32)
  const ciphertext = blob.subarray(32)
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveBundleKey(), iv)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return JSON.parse(plain.toString('utf8'))
  } catch {
    return null
  }
}

function loadBundledEnv() {
  const candidates = []
  if (app?.isPackaged) {
    candidates.push(path.join(app.getAppPath(), 'src', 'config', 'env.bundle.bin'))
    candidates.push(path.join(process.resourcesPath, 'app.asar', 'src', 'config', 'env.bundle.bin'))
  }
  candidates.push(path.join(__dirname, 'env.bundle.bin'))

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue
      const blob = fs.readFileSync(candidate)
      const parsed = decryptBundle(blob)
      if (parsed && typeof parsed === 'object') return parsed
    } catch {}
  }
  return null
}

function loadPlainEnv() {
  const envPath = path.join(
    app?.isPackaged ? path.dirname(app.getAppPath()) : process.cwd(),
    '.env'
  )
  dotenv.config({ path: envPath })
}

const bundled = loadBundledEnv()
if (bundled) {
  for (const [key, value] of Object.entries(bundled)) {
    if (process.env[key] === undefined) process.env[key] = String(value)
  }
} else {
  loadPlainEnv()
}

function parseScopes(raw) {
  if (!raw) return ['profile']
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function required(name, fallback) {
  const value = process.env[name] ?? fallback
  if (!value) {
    throw new Error(
      `[faktur-desktop] Missing required env variable ${name}. ` +
        `Copy .env.example to .env and fill in the values issued by the admin panel.`
    )
  }
  return value
}

function optional(name, fallback) {
  return process.env[name] ?? fallback
}

const config = Object.freeze({
  env: optional('FAKTUR_ENV', 'production'),
  devtools: !app?.isPackaged,

  oauth: {
    clientId: required('FAKTUR_OAUTH_CLIENT_ID'),
    scopes: parseScopes(
      optional(
        'FAKTUR_OAUTH_SCOPES',
        'profile invoices:read invoices:write clients:read clients:write vault:unlock offline_access'
      )
    ),
  },

  api: {
    baseUrl: optional('FAKTUR_API_BASE_URL', 'https://api.fakturapp.cc'),
    prefix: optional('FAKTUR_API_PREFIX', '/api/v1'),
  },

  urls: {
    dashboard: optional('FAKTUR_DASHBOARD_URL', 'https://dash.fakturapp.cc'),
    authorize: optional('FAKTUR_AUTHORIZE_URL', 'https://dash.fakturapp.cc/oauth/authorize'),
  },

  callback: {
    host: optional('FAKTUR_CALLBACK_HOST', '127.0.0.1'),
    path: optional('FAKTUR_CALLBACK_PATH', '/callback'),
    port: Number.parseInt(optional('FAKTUR_CALLBACK_PORT', '0'), 10) || 0,
  },
})

module.exports = config
