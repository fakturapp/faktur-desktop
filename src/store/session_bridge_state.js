'use strict'

let bridged = null
let selectedTeamId = null

function set(data) {
  bridged = data
}

function get() {
  return bridged
}

function clear() {
  bridged = null
  selectedTeamId = null
}

function setSelectedTeamId(id) {
  selectedTeamId = id || null
}

function getSelectedTeamId() {
  return selectedTeamId
}

module.exports = { set, get, clear, setSelectedTeamId, getSelectedTeamId }
