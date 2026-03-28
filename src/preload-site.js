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
