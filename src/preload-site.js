const { ipcRenderer } = require('electron');

let credentialsSent = false;

function extractCredentials() {
  const pwInput = document.querySelector('input[type="password"]');
  if (!pwInput || !pwInput.value) return null;

  const form = pwInput.closest('form');
  const container = form || pwInput.parentElement?.parentElement || document.body;

  let username = '';
  const emailInput = container.querySelector('input[type="email"]')
    || container.querySelector('input[name*="email" i]')
    || container.querySelector('input[name*="user" i]')
    || container.querySelector('input[autocomplete="email"]')
    || container.querySelector('input[autocomplete="username"]');

  if (emailInput) {
    username = emailInput.value;
  } else {
    const textInputs = container.querySelectorAll('input[type="text"], input:not([type])');
    for (const input of textInputs) {
      if (input.value && input !== pwInput) {
        username = input.value;
        break;
      }
    }
  }

  if (!username || !pwInput.value) return null;
  return { url: window.location.origin, username, password: pwInput.value };
}

function trySendCredentials() {
  const creds = extractCredentials();
  if (creds && !credentialsSent) {
    credentialsSent = true;
    ipcRenderer.sendToHost('password-submit', creds);
    setTimeout(() => { credentialsSent = false; }, 3000);
  }
}

// Detect form submit
document.addEventListener('submit', () => trySendCredentials(), true);

// Detect Enter in password field
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.activeElement?.type === 'password') {
    trySendCredentials();
  }
}, true);

// Detect click on submit button near password field
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button[type="submit"], input[type="submit"], button:not([type])');
  if (!btn) return;
  const form = btn.closest('form');
  if (form && form.querySelector('input[type="password"]')) {
    setTimeout(() => trySendCredentials(), 100);
  }
}, true);

// Auto-fill: listen for credentials from host
ipcRenderer.on('fill-credentials', (_, data) => {
  if (!data) return;
  const pwInput = document.querySelector('input[type="password"]');
  if (!pwInput) return;

  const form = pwInput.closest('form');
  const container = form || pwInput.parentElement?.parentElement || document.body;

  const emailInput = container.querySelector('input[type="email"]')
    || container.querySelector('input[name*="email" i]')
    || container.querySelector('input[name*="user" i]')
    || container.querySelector('input[autocomplete="email"]')
    || container.querySelector('input[autocomplete="username"]');

  let target = emailInput;
  if (!target) {
    const textInputs = container.querySelectorAll('input[type="text"], input:not([type])');
    if (textInputs.length > 0) target = textInputs[0];
  }

  if (target) setNativeValue(target, data.username);
  setNativeValue(pwInput, data.password);
});

function setNativeValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// Request credentials when password field is present
function requestCredentials() {
  if (document.querySelector('input[type="password"]')) {
    ipcRenderer.sendToHost('request-credentials', { url: window.location.origin });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', requestCredentials);
} else {
  requestCredentials();
}

// Watch for dynamically added password fields (SPA)
const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches?.('input[type="password"]') ||
          node.querySelector?.('input[type="password"]')) {
        requestCredentials();
        return;
      }
    }
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });
