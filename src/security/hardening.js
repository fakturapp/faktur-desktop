'use strict'

const { app } = require('electron')

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
]

function isDangerousArg(raw) {
  if (typeof raw !== 'string') return false
  const arg = raw.toLowerCase()
  return DANGEROUS_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`))
}

function enforceLaunchFlagPolicy() {
  const offenders = process.argv.slice(1).filter(isDangerousArg)
  if (offenders.length > 0) {
    console.error(
      `[hardening] refusing to start: forbidden launch flag(s) detected: ${offenders.join(', ')}`
    )
    app.exit(1)
    throw new Error('Dangerous launch flags detected')
  }

  // Preemptively remove any switch Electron may set by default.
  try {
    app.commandLine.removeSwitch('remote-debugging-port')
    app.commandLine.removeSwitch('remote-debugging-pipe')
    app.commandLine.removeSwitch('inspect')
    app.commandLine.removeSwitch('inspect-brk')
  } catch {
    /* pre-ready; ignore */
  }
}

// ---------- webPreferences validator ----------
// Any BrowserWindow we create MUST pass through this check to guarantee
// a secure baseline. Call from window factories before `new BrowserWindow`.
const REQUIRED_PREFS = {
  contextIsolation: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
}

function assertSecureWebPreferences(windowName, prefs) {
  const violations = []
  for (const [key, expected] of Object.entries(REQUIRED_PREFS)) {
    if (prefs[key] !== expected) {
      violations.push(`${key}=${prefs[key]} (expected ${expected})`)
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `[hardening] BrowserWindow "${windowName}" failed security baseline: ${violations.join(', ')}`
    )
  }
}

// ---------- Navigation guard for any new web-contents ----------
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
    })

    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}

module.exports = {
  DANGEROUS_FLAGS,
  enforceLaunchFlagPolicy,
  assertSecureWebPreferences,
  installGlobalContentsGuard,
}
