'use strict'

const bar = document.getElementById('bar')
const statusEl = document.getElementById('status')
const downloadedEl = document.getElementById('downloaded')
const percentEl = document.getElementById('percent')
const errorEl = document.getElementById('error')
const versionEl = document.getElementById('target-version')
const titleEl = document.getElementById('title')

function formatBytes(n) {
  if (!n || n < 1024) return '0 MB'
  const mb = n / (1024 * 1024)
  return `${mb.toFixed(1)} MB`
}

function showError(msg) {
  errorEl.textContent = msg
  errorEl.classList.add('visible')
  statusEl.textContent = 'Échec de la mise à jour'
}

;(async function init() {
  try {
    const info = await window.fakturUpdate.getUpdateInfo()
    if (info?.version) versionEl.textContent = `v${info.version}`
  } catch {
  }

  window.fakturUpdate.onProgress((payload) => {
    if (!payload) return
    const { downloaded, total, percent, phase, message } = payload

    if (phase === 'error') {
      showError(message || 'Erreur inconnue')
      return
    }
    if (phase === 'installing') {
      if (titleEl) titleEl.textContent = 'Installation va commencer'
      statusEl.textContent = 'Fermeture de Faktur pour lancer l’installeur…'
      bar.style.width = '100%'
      percentEl.textContent = '100%'
      if (typeof total === 'number' && total > 0) {
        downloadedEl.textContent = `${formatBytes(total)} / ${formatBytes(total)}`
      }
      return
    }
    if (phase === 'launching') {
      statusEl.textContent = 'Lancement de l’installeur…'
      bar.style.width = '100%'
      percentEl.textContent = '100%'
      return
    }
    if (phase === 'downloading' || phase === undefined) {
      statusEl.textContent = 'Téléchargement en cours…'
      if (typeof percent === 'number') {
        bar.style.width = `${percent}%`
        percentEl.textContent = `${percent}%`
      }
      if (typeof downloaded === 'number') {
        if (typeof total === 'number' && total > 0) {
          downloadedEl.textContent = `${formatBytes(downloaded)} / ${formatBytes(total)}`
        } else {
          downloadedEl.textContent = formatBytes(downloaded)
        }
      }
    }
  })

  try {
    await window.fakturUpdate.start()
  } catch (err) {
    showError(err?.message || 'Erreur inattendue')
  }
})()
