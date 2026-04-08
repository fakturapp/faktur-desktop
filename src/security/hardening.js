'use strict'

const { app, Menu } = require('electron')

// ---------- Dev mode detection ----------
// True when the app is either unpackaged OR explicitly flagged as
// development via FAKTUR_ENV=development. All hardening measures that
// hurt the developer loop (keyboard locks, menu wipe, devtools auto-
// close, debugger watchdog) are skipped in dev mode.
function isDevMode() {
  if (!app.isPackaged) return true
  return process.env.FAKTUR_ENV === 'development'
}

// ---------- Dangerous launch-flag filter ----------
// Some Chromium/Electron flags silently disable critical security
// layers (sandbox, web security, same-origin). We refuse to boot if
// any of these appear in process.argv or in the app.commandLine switch
// store. This protects against both accidental debugging leftovers and
// privilege-escalation attempts via LOLBAS-style shortcut tampering.

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
  // Skip the whole policy in dev mode so developers can run with
  // --inspect, --remote-debugging-port, etc.
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
    /* pre-ready; ignore */
  }

  if (process.env.NODE_OPTIONS) {
    delete process.env.NODE_OPTIONS
  }
}

// ---------- webPreferences baseline validator ----------
// Every BrowserWindow factory must pass its prefs through this check.
// In production all flags are forced to their strictest value. In dev,
// devTools can stay on but everything else is still enforced.
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
// Blocks any navigation, popup or <webview> attachment outside the
// explicit allow-list. Runs for EVERY renderer Electron spawns.
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
// Blocks keyboard shortcuts that toggle DevTools, blocks the native
// "Inspect element" context menu, and closes DevTools if anything else
// tries to open it at runtime. All no-ops in dev mode.
function installDevToolsLockdown(win) {
  if (!win || win.isDestroyed?.()) return
  if (isDevMode()) return

  const contents = win.webContents

  contents.on('before-input-event', (evt, input) => {
    if (!input || input.type !== 'keyDown') return
    const key = (input.key || '').toLowerCase()
    const { control, shift, meta, alt } = input

    // F12
    if (key === 'f12') {
      evt.preventDefault()
      return
    }
    // Ctrl+Shift+I / Cmd+Opt+I — inspector
    if ((control || meta) && shift && key === 'i') {
      evt.preventDefault()
      return
    }
    // Ctrl+Shift+J / Cmd+Opt+J — console
    if ((control || meta) && shift && key === 'j') {
      evt.preventDefault()
      return
    }
    // Ctrl+Shift+C / Cmd+Opt+C — element picker
    if ((control || meta) && shift && key === 'c') {
      evt.preventDefault()
      return
    }
    // Cmd+Opt+I/J/C on macOS
    if (meta && alt && (key === 'i' || key === 'j' || key === 'c')) {
      evt.preventDefault()
      return
    }
    // Ctrl+R / Cmd+R — reload (block in production)
    if (app.isPackaged && (control || meta) && key === 'r') {
      evt.preventDefault()
      return
    }
    // Ctrl+Shift+R / Cmd+Shift+R — hard reload
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
      /* ignore */
    }
  })
}

// ---------- HTTPS-only network policy ----------
// Blocks any outbound HTTP request except on the loopback interface
// (needed for the OAuth callback during auth flow).
function installHttpsOnlyGuard(sessionInstance) {
  sessionInstance.webRequest.onBeforeRequest((details, callback) => {
    try {
      const url = new URL(details.url)
      if (url.protocol === 'https:' || url.protocol === 'file:' || url.protocol === 'data:') {
        return callback({})
      }
      if (
        url.protocol === 'http:' &&
        (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
      ) {
        return callback({})
      }
      console.warn(`[hardening] blocking non-HTTPS request: ${details.url}`)
      callback({ cancel: true })
    } catch {
      callback({ cancel: true })
    }
  })
}

// ---------- TLS certificate verification ----------
// Leaves Chromium's built-in verification in place (return -3 = use
// default verdict). We log any verification failure so a compromised
// CA or a MITM attempt is immediately visible in the dev console.
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
// Removes the entire native menu bar so there is no "View → Toggle
// DevTools" entry. Must be called before creating any window.
// No-op in dev mode so developers still have access to reload,
// inspector, zoom, etc.
function removeApplicationMenu() {
  if (isDevMode()) return
  Menu.setApplicationMenu(null)
}

// ---------- Runtime debugger detection ----------
// Polls process.debugPort. Non-zero = Node inspector attached. Quits
// immediately. Not foolproof against native debuggers (x64dbg, Frida)
// but catches the most common remote-debugging scenarios. No-op in dev
// mode.
function startDebuggerWatchdog(intervalMs = 4000) {
  if (isDevMode()) return
  const interval = setInterval(() => {
    try {
      if (process.debugPort && process.debugPort > 0) {
        console.error('[hardening] debugger attach detected — quitting')
        clearInterval(interval)
        app.exit(1)
      }
    } catch {
      /* ignore */
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
