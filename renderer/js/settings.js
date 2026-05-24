'use strict'

const f = window.fakturDesktop

const elAlwaysShow = document.getElementById('always-show')
const elStatus = document.getElementById('status')
const elReset = document.getElementById('reset')
const elBack = document.getElementById('back')

let savedTimer = null

function flashSaved() {
  if (savedTimer) clearTimeout(savedTimer)
  elStatus.textContent = 'Préférences sauvegardées'
  elStatus.classList.add('saved')
  savedTimer = setTimeout(() => {
    elStatus.textContent = ''
    elStatus.classList.remove('saved')
  }, 1500)
}

async function init() {
  try {
    const prefs = await f.getPrefs()
    if (prefs && typeof prefs.alwaysShowTeamSelect === 'boolean') {
      elAlwaysShow.checked = prefs.alwaysShowTeamSelect
    }
  } catch (err) {
    elStatus.textContent = err?.message || 'Impossible de charger les préférences'
  }
}

elAlwaysShow.addEventListener('change', async () => {
  try {
    await f.setPrefs({ alwaysShowTeamSelect: !!elAlwaysShow.checked })
    flashSaved()
  } catch (err) {
    elStatus.textContent = err?.message || 'Erreur lors de la sauvegarde'
  }
})

elReset.addEventListener('click', async () => {
  try {
    await f.setPrefs({ alwaysShowTeamSelect: true, lastTeamId: null })
    elAlwaysShow.checked = true
    flashSaved()
  } catch (err) {
    elStatus.textContent = err?.message || 'Erreur lors de la réinitialisation'
  }
})

elBack.addEventListener('click', () => {
  window.history.back()
})

init()
