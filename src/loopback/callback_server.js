'use strict'

/**
 * Ephemeral loopback HTTP server used as the OAuth2 redirect target.
 *
 * The server binds to 127.0.0.1 on an OS-assigned port and awaits a
 * single GET on the configured path (/callback by default). When the
 * request arrives, we parse `code` and `state` from the query string,
 * respond with a tiny "vous pouvez fermer cette fenêtre" HTML page,
 * and immediately tear the server down. Anything that arrives after
 * the first response is refused.
 *
 * We also guard against 'state' mismatches: the caller passes in an
 * expected state value and the promise rejects if the incoming one
 * differs. That's the only thing stopping CSRF from another tab
 * racing into our callback listener first.
 */

const http = require('node:http')
const url = require('node:url')
const config = require('../config/env')

class CallbackServerError extends Error {
  constructor(message, code = 'callback_error') {
    super(message)
    this.name = 'CallbackServerError'
    this.code = code
  }
}

const SUCCESS_HTML = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Faktur — Connexion réussie</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; background: #faf9f7; color: #1a1a1a; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { max-width: 420px; padding: 32px; border-radius: 20px; background: white; box-shadow: 0 10px 40px rgba(0,0,0,.06); text-align: center; }
    .check { width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%; background: #dcfce7; display: flex; align-items: center; justify-content: center; }
    h1 { font-size: 20px; margin: 0 0 8px; }
    p { color: #6b6b6b; font-size: 14px; line-height: 1.5; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg></div>
    <h1>Connexion réussie</h1>
    <p>Vous pouvez fermer cette fenêtre et retourner à l'application Faktur.</p>
  </div>
  <script>setTimeout(() => window.close(), 2500)</script>
</body>
</html>`

const ERROR_HTML = (message) => `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Faktur — Erreur</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; background: #faf9f7; color: #1a1a1a; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { max-width: 420px; padding: 32px; border-radius: 20px; background: white; box-shadow: 0 10px 40px rgba(0,0,0,.06); text-align: center; }
    .x { width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%; background: #fee2e2; display: flex; align-items: center; justify-content: center; }
    h1 { font-size: 20px; margin: 0 0 8px; }
    p { color: #6b6b6b; font-size: 14px; line-height: 1.5; margin: 0; }
    code { display: block; margin-top: 12px; padding: 10px; border-radius: 8px; background: #f3f2ef; font-size: 12px; word-break: break-word; }
  </style>
</head>
<body>
  <div class="card">
    <div class="x"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></div>
    <h1>Connexion impossible</h1>
    <p>Une erreur s'est produite pendant l'autorisation.</p>
    <code>${message}</code>
  </div>
</body>
</html>`

/**
 * Starts the loopback listener and returns a promise that resolves
 * with the { code, state } tuple the browser hands us, or rejects on
 * timeout / error / mismatched state.
 *
 * @param {{ expectedState: string, timeoutMs?: number }} opts
 * @returns {{ wait: Promise<{code: string, state: string}>, redirectUri: string, close: () => void }}
 */
function startCallbackServer({ expectedState, timeoutMs = 5 * 60 * 1000 }) {
  let resolve
  let reject
  const wait = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })

  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true)

    if (parsed.pathname !== config.callback.path) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not found')
      return
    }

    const { code, state, error, error_description } = parsed.query

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(ERROR_HTML(String(error_description || error)))
      reject(new CallbackServerError(String(error_description || error), String(error)))
      setTimeout(() => server.close(), 50)
      return
    }

    if (!code || typeof code !== 'string') {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(ERROR_HTML('Missing code in callback'))
      reject(new CallbackServerError('Missing code', 'invalid_callback'))
      setTimeout(() => server.close(), 50)
      return
    }

    if (expectedState && state !== expectedState) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(ERROR_HTML('State mismatch'))
      reject(new CallbackServerError('State mismatch', 'state_mismatch'))
      setTimeout(() => server.close(), 50)
      return
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(SUCCESS_HTML)
    resolve({ code, state: String(state) })
    setTimeout(() => server.close(), 50)
  })

  let timer = null
  const close = () => {
    if (timer) clearTimeout(timer)
    try {
      server.close()
    } catch {
      /* ignore */
    }
  }

  server.listen(config.callback.port, config.callback.host, () => {
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : config.callback.port
    this.assignedPort = port
  })

  // Bail out if the browser never comes back.
  timer = setTimeout(() => {
    reject(new CallbackServerError('Authentication timeout', 'timeout'))
    close()
  }, timeoutMs)

  // Expose the redirect URI computed from the actually-assigned port.
  const getRedirectUri = () => {
    const address = server.address()
    if (!address || typeof address !== 'object') {
      throw new CallbackServerError('Server not listening yet', 'not_ready')
    }
    return `http://${config.callback.host}:${address.port}${config.callback.path}`
  }

  // Small wait-for-listen helper so the caller can compute the redirect
  // URI synchronously once the promise returned below resolves.
  const ready = new Promise((resReady) => {
    server.once('listening', resReady)
  })

  return {
    wait,
    ready,
    close,
    getRedirectUri,
  }
}

module.exports = { startCallbackServer, CallbackServerError }
