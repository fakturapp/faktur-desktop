'use strict'

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

const PAGE_SHELL = (title, body) => `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Faktur — ${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #080808;
      --bg-card: #141414;
      --border: #222222;
      --fg: #efefef;
      --fg-muted: #999999;
      --primary: #6366f1;
      --primary-hover: #818cf8;
      --emerald: #22c55e;
      --emerald-soft: rgba(34, 197, 94, 0.12);
      --destructive: #ef4444;
      --destructive-soft: rgba(239, 68, 68, 0.1);
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      min-height: 100vh;
      font-family: 'Lexend', -apple-system, system-ui, sans-serif;
      background: var(--bg);
      color: var(--fg);
      -webkit-font-smoothing: antialiased;
      letter-spacing: -0.01em;
    }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 32px;
      position: relative;
      overflow: hidden;
    }
    body::before {
      content: '';
      position: absolute;
      inset: 0;
      background:
        radial-gradient(ellipse at 15% 15%, rgba(99, 102, 241, 0.1) 0%, transparent 45%),
        radial-gradient(ellipse at 85% 85%, rgba(139, 92, 246, 0.06) 0%, transparent 45%);
      pointer-events: none;
    }
    main {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 440px;
      animation: fadeInUp 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
    }
    .brand {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 14px;
      margin-bottom: 22px;
    }
    .brand-logo {
      width: 44px;
      height: 44px;
      filter: drop-shadow(0 8px 20px rgba(99, 102, 241, 0.35));
    }
    .brand-logo svg { width: 100%; height: 100%; display: block; }
    .brand-text {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      line-height: 1.1;
    }
    .brand-name {
      font-size: 18px;
      font-weight: 700;
      color: var(--fg);
      letter-spacing: -0.02em;
    }
    .brand-sub {
      font-size: 11px;
      color: var(--fg-muted);
      letter-spacing: 0.02em;
      margin-top: 2px;
    }
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 36px 32px;
      text-align: center;
      box-shadow:
        0 20px 60px rgba(0, 0, 0, 0.5),
        0 0 0 1px rgba(255, 255, 255, 0.02);
    }
    .faktur-spinner {
      width: 32px;
      height: 32px;
      position: relative;
    }
    .faktur-spinner::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 3px solid rgba(99, 102, 241, 0.2);
      border-top-color: var(--primary);
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .stage { display: none; }
    .stage.visible { display: block; animation: fadeInUp 0.25s ease-out both; }
    .icon-wrap {
      position: relative;
      width: 72px;
      height: 72px;
      margin: 0 auto 22px;
    }
    .icon {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 22px;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
      z-index: 2;
    }
    .icon.ok    { background: var(--emerald-soft); color: var(--emerald); }
    .icon.error { background: var(--destructive-soft); color: var(--destructive); }
    .halo {
      position: absolute;
      inset: -4px;
      border-radius: 26px;
      filter: blur(20px);
      opacity: 0.45;
      animation: pulse 2s ease-in-out infinite;
    }
    .halo.ok    { background: var(--emerald); }
    .halo.error { background: var(--destructive); }
    @keyframes pulse {
      0%, 100% { opacity: 0.3;  transform: scale(0.94); }
      50%      { opacity: 0.55; transform: scale(1.08); }
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 8px;
      letter-spacing: -0.02em;
    }
    p {
      color: var(--fg-muted);
      font-size: 14px;
      line-height: 1.6;
      margin: 0;
    }
    code {
      display: block;
      margin-top: 18px;
      padding: 10px 12px;
      border-radius: 10px;
      background: var(--bg);
      border: 1px solid var(--border);
      font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
      font-size: 11px;
      color: #fca5a5;
      word-break: break-word;
      text-align: left;
    }
    .faktur-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 22px;
      padding: 8px 14px;
      border-radius: 999px;
      background: rgba(99, 102, 241, 0.08);
      border: 1px solid rgba(99, 102, 241, 0.2);
      color: var(--primary);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .f-mark {
      width: 18px; height: 18px;
      border-radius: 6px;
      background: linear-gradient(135deg, var(--primary), var(--primary-hover));
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 800;
      box-shadow: 0 2px 6px rgba(99, 102, 241, 0.3);
    }
    .countdown {
      margin-top: 18px;
      font-size: 11px;
      color: #606060;
    }
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(12px); }
      to   { opacity: 1; transform: translateY(0);    }
    }
  </style>
</head>
<body>
  <main>
    ${body}
  </main>
</body>
</html>`

const CHECK_SVG = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>`
const X_SVG = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`

const FAKTUR_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><g transform="translate(60, 20)"><path d="M 40 0 H 190 L 280 90 V 320 A 40 40 0 0 1 240 360 H 40 A 40 40 0 0 1 0 320 V 40 A 40 40 0 0 1 40 0 Z" fill="#6366f1"/><path d="M 190 0 V 60 A 30 30 0 0 0 220 90 H 280 Z" fill="#4f46e5"/><ellipse cx="90" cy="150" rx="30" ry="32" fill="white"/><ellipse cx="98" cy="146" rx="15" ry="16" fill="#1e1b4b"/><ellipse cx="104" cy="138" rx="5" ry="5" fill="white"/><ellipse cx="190" cy="150" rx="30" ry="32" fill="white"/><ellipse cx="198" cy="146" rx="15" ry="16" fill="#1e1b4b"/><ellipse cx="204" cy="138" rx="5" ry="5" fill="white"/><path d="M 105 220 C 120 245 160 245 175 220" stroke="white" stroke-width="15" stroke-linecap="round" fill="none"/><ellipse cx="70" cy="200" rx="20" ry="12" fill="#a5b4fc" opacity="0.5"/><ellipse cx="210" cy="200" rx="20" ry="12" fill="#a5b4fc" opacity="0.5"/><line x1="70" y1="280" x2="210" y2="280" stroke="#a5b4fc" stroke-width="12" stroke-linecap="round" opacity="0.6"/><line x1="70" y1="310" x2="160" y2="310" stroke="#a5b4fc" stroke-width="12" stroke-linecap="round" opacity="0.6"/><path d="M -20 200 C -40 200 -50 220 -40 235" stroke="#6366f1" stroke-width="20" stroke-linecap="round" fill="none"/><path d="M 300 200 C 320 200 330 220 320 235" stroke="#6366f1" stroke-width="20" stroke-linecap="round" fill="none"/></g></svg>`

const BRAND_HEADER = `<div class="brand">
  <div class="brand-logo">${FAKTUR_LOGO_SVG}</div>
  <div class="brand-text">
    <span class="brand-name">Faktur Desktop</span>
    <span class="brand-sub">Authentification sécurisée</span>
  </div>
</div>`

const SUCCESS_HTML = PAGE_SHELL(
  'Connexion en cours',
  `${BRAND_HEADER}
  <div class="card">
    <div id="stage-progress" class="stage visible">
      <div class="icon-wrap">
        <div class="icon ok" style="background: rgba(99, 102, 241, 0.1); color: var(--primary);">
          <div class="faktur-spinner"></div>
        </div>
      </div>
      <h1>Connexion en cours</h1>
      <p>Validation de votre session avec Faktur Desktop…</p>
    </div>
    <div id="stage-success" class="stage">
      <div class="icon-wrap">
        <div class="halo ok"></div>
        <div class="icon ok">${CHECK_SVG}</div>
      </div>
      <h1>Connexion réussie</h1>
      <p>Vous pouvez fermer cette fenêtre et revenir à l'application Faktur Desktop.</p>
      <div class="countdown" id="countdown"></div>
    </div>
  </div>
  <script>
    setTimeout(function () {
      var progress = document.getElementById('stage-progress');
      var success = document.getElementById('stage-success');
      if (progress) progress.classList.remove('visible');
      if (success) success.classList.add('visible');
      var n = 3;
      var el = document.getElementById('countdown');
      if (el) el.textContent = 'Fermeture automatique dans 3 secondes…';
      var int = setInterval(function () {
        n--;
        if (n <= 0) { clearInterval(int); window.close(); return; }
        if (el) el.textContent = 'Fermeture automatique dans ' + n + ' secondes…';
      }, 1000);
    }, 500);
  </script>`
)

const ERROR_HTML = (message) =>
  PAGE_SHELL(
    'Erreur',
    `${BRAND_HEADER}
    <div class="card">
      <div class="icon-wrap">
        <div class="halo error"></div>
        <div class="icon error">${X_SVG}</div>
      </div>
      <h1>Connexion impossible</h1>
      <p>Une erreur s'est produite pendant l'autorisation. Retournez à l'application pour réessayer.</p>
      <code>${String(message).replace(/</g, '&lt;')}</code>
    </div>`
  )

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

  server.listen(config.callback.port, config.callback.host)

  timer = setTimeout(() => {
    reject(new CallbackServerError('Authentication timeout', 'timeout'))
    close()
  }, timeoutMs)

  const getRedirectUri = () => {
    const address = server.address()
    if (!address || typeof address !== 'object') {
      throw new CallbackServerError('Server not listening yet', 'not_ready')
    }
    return `http://${config.callback.host}:${address.port}${config.callback.path}`
  }

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
