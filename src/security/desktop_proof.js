'use strict'

const crypto = require('node:crypto')
const config = require('../config/env')

function getProofKey() {
  const envKey = process.env.FAKTUR_DESKTOP_PROOF_KEY
  if (envKey && envKey.length >= 32) return envKey
  return 'faktur-desktop-v1-proof-key-change-in-prod'
}

function computeDesktopProofHeader() {
  try {
    const key = getProofKey()
    const ts = Date.now()
    const nonce = crypto.randomBytes(16).toString('base64url')
    const clientId = config.oauth.clientId
    const material = `${nonce}:${ts}:${clientId}`
    const signature = crypto.createHmac('sha256', key).update(material).digest('base64url')
    return { signature, nonce, ts, clientId }
  } catch {
    return null
  }
}

module.exports = { computeDesktopProofHeader }
