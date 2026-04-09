'use strict'

const { app, Menu } = require('electron')

function isDevMode() {
  return !app.isPackaged
}

const DANGEROUS_FLAGS = [
  '--no-sandbox',
  '--disable-web-security',
  '--disable-site-isolation-trials',
  '--disable-features=IsolateOrigins',
  '--allow-running-insecure-content',
  '--remote-debugging-port',
  '--remote-debugging-pipe',
  '--inspect',
  '--inspect-brk',
  '--inspect-port',
  '--js-flags=--inspect',
  '--enable-logging',
  '--v=',
]

function isDangerousArg(raw) {
  if (typeof raw !== 'string') return false
  const arg = raw.toLowerCase()
  return DANGEROUS_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`))
}

function enforceLaunchFlagPolicy() {
  if (isDevMode()) return

  const offenders = process.argv.slice(1).filter(isDangerousArg)
  if (offenders.length > 0) {
    console.error(
      `[hardening] refusing to start: forbidden launch flag(s) detected: ${offenders.join(', ')}`
    )
    app.exit(1)
    throw new Error('Dangerous launch flags detected')
  }

  try {
    app.commandLine.removeSwitch('remote-debugging-port')
    app.commandLine.removeSwitch('remote-debugging-pipe')
    app.commandLine.removeSwitch('inspect')
    app.commandLine.removeSwitch('inspect-brk')
    app.commandLine.removeSwitch('js-flags')
    app.commandLine.removeSwitch('enable-logging')
  } catch {
  }

  if (process.env.NODE_OPTIONS) {
    delete process.env.NODE_OPTIONS
  }
}

// ---------- webPreferences baseline validator ----------
const REQUIRED_PREFS = {
  contextIsolation: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  sandbox: true,
  webviewTag: false,
}

function assertSecureWebPreferences(windowName, prefs) {
  const violations = []
  for (const [key, expected] of Object.entries(REQUIRED_PREFS)) {
    if (prefs[key] !== expected) {
      violations.push(`${key}=${prefs[key]} (expected ${expected})`)
    }
  }
  if (!isDevMode() && prefs.devTools === true) {
    violations.push(`devTools=true (expected false in production)`)
  }
  if (violations.length > 0) {
    throw new Error(
      `[hardening] BrowserWindow "${windowName}" failed security baseline: ${violations.join(', ')}`
    )
  }
}

// ---------- Global web-contents guard ----------
function installGlobalContentsGuard(allowedOrigins) {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (evt, url) => {
      try {
        if (!allowedOrigins.some((prefix) => url.startsWith(prefix))) {
          evt.preventDefault()
        }
      } catch {
        evt.preventDefault()
      }
    })

    contents.on('will-attach-webview', (evt, webPreferences, _params) => {
      evt.preventDefault()
      webPreferences.preload = undefined
      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      webPreferences.webSecurity = true
      webPreferences.sandbox = true
    })

    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}

// ---------- DevTools lockdown for a specific window ----------
function installDevToolsLockdown(win) {
  if (!win || win.isDestroyed?.()) return
  if (isDevMode()) return

  const contents = win.webContents

  contents.on('before-input-event', (evt, input) => {
    if (!input || input.type !== 'keyDown') return
    const key = (input.key || '').toLowerCase()
    const { control, shift, meta, alt } = input

    if (key === 'f12') {
      evt.preventDefault()
      return
    }
    if ((control || meta) && shift && key === 'i') {
      evt.preventDefault()
      return
    }
    if ((control || meta) && shift && key === 'j') {
      evt.preventDefault()
      return
    }
    if ((control || meta) && shift && key === 'c') {
      evt.preventDefault()
      return
    }
    if (meta && alt && (key === 'i' || key === 'j' || key === 'c')) {
      evt.preventDefault()
      return
    }
    if (app.isPackaged && (control || meta) && key === 'r') {
      evt.preventDefault()
      return
    }
    if (app.isPackaged && (control || meta) && shift && key === 'r') {
      evt.preventDefault()
    }
  })

  contents.on('context-menu', (evt) => {
    evt.preventDefault()
  })

  contents.on('devtools-opened', () => {
    try {
      contents.closeDevTools()
    } catch {
    }
  })
}

// ---------- HTTPS-only network policy ----------
const LOCAL_SCHEME_PREFIXES = [
  'file:',
  'data:',
  'blob:',
  'devtools:',
  'chrome:',
  'chrome-extension:',
  'chrome-devtools:',
  'chrome-error:',
  'about:',
]

function installHttpsOnlyGuard(sessionInstance) {
  sessionInstance.webRequest.onBeforeRequest((details, callback) => {
    const raw = typeof details.url === 'string' ? details.url : ''

    for (const prefix of LOCAL_SCHEME_PREFIXES) {
      if (raw.startsWith(prefix)) {
        return callback({})
      }
    }

    try {
      const url = new URL(raw)
      if (url.protocol === 'https:') {
        return callback({})
      }
      if (
        url.protocol === 'http:' &&
        (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
      ) {
        return callback({})
      }
      console.warn(`[hardening] blocking non-HTTPS request: ${raw}`)
      callback({ cancel: true })
    } catch {
      console.warn(`[hardening] could not parse request URL, allowing: ${raw}`)
      callback({})
    }
  })
}

// ---------- TLS certificate verification ----------
function installCertificateValidator(sessionInstance) {
  sessionInstance.setCertificateVerifyProc((request, callback) => {
    if (request.verificationResult !== 'net::OK') {
      console.warn(
        `[hardening] TLS verify warning for ${request.hostname}: ` +
          `${request.verificationResult} (errorCode=${request.errorCode})`
      )
    }
    callback(-3)
  })
}

// ---------- Application menu wipeout ----------
function removeApplicationMenu() {
  if (isDevMode()) return
  Menu.setApplicationMenu(null)
}

// ---------- Runtime debugger detection ----------
function startDebuggerWatchdog(intervalMs = 4000) {
  if (isDevMode()) return
  let inspector
  try {
    inspector = require('node:inspector')
  } catch {
    return
  }
  const interval = setInterval(() => {
    try {
      const url = typeof inspector.url === 'function' ? inspector.url() : null
      if (url) {
        console.error('[hardening] inspector attached at', url, '— quitting')
        clearInterval(interval)
        app.exit(1)
      }
    } catch {
    }
  }, intervalMs)
  interval.unref?.()
}

module.exports = {
  DANGEROUS_FLAGS,
  isDevMode,
  enforceLaunchFlagPolicy,
  assertSecureWebPreferences,
  installGlobalContentsGuard,
  installDevToolsLockdown,
  installHttpsOnlyGuard,
  installCertificateValidator,
  removeApplicationMenu,
  startDebuggerWatchdog,
}
