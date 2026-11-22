// The Global panel's Custom tab (2026-11-15, spin ring plan Batch 4):
// custom lobbies, where the host sets the rules (LobbyRules.js). The tab
// lists the custom lobbies (ServerBrowser.renderServerList) and has a
// Create Custom Lobby button that swaps the list for this form: name,
// mode, players, password, ring or guns, friendly fire, and how strong the
// zombies and the players are. Every value picker has a Custom choice to
// type your own number (Gaymi's "always add custom").
//
// Same module shape as ServerBrowser.js: plain functions taking `game`.
import { t } from './i18n.js'
import { _escapeHtml } from './Game.js'
import { PARTY_SERVER_MODES } from './PartyModes.js'
import { lobbyCode, readLobbyCode, copyText } from './ShareCodes.js'
import { LOBBY_PICKS, LOBBY_ZOMBIE_MODES, LOBBY_PARTY_MODES, LOBBY_RING_MODES, PASSWORD_MAX, cleanLobbyRules, defaultLobbyRules, rewardMult, changedRules } from './LobbyRules.js'

// A server mode -> the game mode it plays (BuildSurvival.start does the same).
const PARTY_BY_SERVER = Object.fromEntries(Object.entries(PARTY_SERVER_MODES).map(([k, v]) => [v, k]))
export function gameModeOf(serverMode) {
  return { main: 'classic', zone: 'shrinkingZone', td: 'towerDefense', infection: 'infection', escape: 'escapeRoom', escapeSolo: 'escapeRace' }[serverMode] || PARTY_BY_SERVER[serverMode] || 'classic'
}
export function modeName(serverMode) {
  const m = gameModeOf(serverMode)
  return t(`topBarMode${m[0].toUpperCase()}${m.slice(1)}`)
}

// How a picked value reads: "2x", "150", "6 players", "Every 5 waves".
export function pickText(k, v) {
  if (k === 'max') return t('lobbyPlayersN', { n: v })
  if (k === 'boss') return v ? t('lobbyBossEvery', { n: v }) : t('lobbyBossDefault')
  if (k === 'hp') return String(v)
  return `${v}x`
}

// One rule that differs from normal, as a short chip: "Zombie health 2x".
export function ruleChip([k, v]) {
  if (k === 'ring') return t('lobbyRingChip')
  if (k === 'ff') return t('lobbyFfChip')
  return `${t(`lobbyRule_${k}`)} ${pickText(k, v)}`
}

function pickerHtml(k, value) {
  const p = LOBBY_PICKS[k]
  const custom = !p.choices.includes(value)
  const opts = p.choices.map((c) => `<option value="${c}"${!custom && c === value ? ' selected' : ''}>${_escapeHtml(pickText(k, c))}</option>`).join('')
  return `<label class="lobby-field">
    <span>${_escapeHtml(t(`lobbyRule_${k}`))}</span>
    <span class="lobby-pick">
      <select class="nickname-input lobby-select" data-pick="${k}">${opts}<option value="custom"${custom ? ' selected' : ''}>${_escapeHtml(t('lobbyCustomChoice'))}</option></select>
      <input type="number" class="nickname-input lobby-number" data-pick-num="${k}" min="${p.min}" max="${p.max}" step="${p.step}" value="${value}" aria-label="${_escapeHtml(t(`lobbyRule_${k}`))}"${custom ? '' : ' hidden'} />
    </span>
  </label>`
}

function modeOptions(selected) {
  const opt = (m) => `<option value="${m}"${m === selected ? ' selected' : ''}>${_escapeHtml(modeName(m))}</option>`
  return `<optgroup label="${_escapeHtml(t('lobbyZombieModes'))}">${LOBBY_ZOMBIE_MODES.map(opt).join('')}</optgroup><optgroup label="${_escapeHtml(t('lobbyPartyModes'))}">${LOBBY_PARTY_MODES.map(opt).join('')}</optgroup>`
}

// Swaps the Custom tab's list for the form (or back).
export function showLobbyForm(game, on) {
  game._lobbyFormOpen = !!on
  const form = document.getElementById('custom-lobby-form')
  const list = document.getElementById('server-list')
  const line = document.getElementById('server-count-line')
  if (!form) return
  form.hidden = !on
  if (list) list.hidden = !!on
  if (line) line.hidden = !!on
  if (on) {
    game._lobbyCodeMsg = ''
    renderLobbyForm(game)
  }
}

export function renderLobbyForm(game) {
  const form = document.getElementById('custom-lobby-form')
  if (!form) return
  const r = cleanLobbyRules(game._lobbyDraft?.rules) || defaultLobbyRules()
  const mode = game._lobbyDraft?.mode || 'main'
  const ringMode = LOBBY_RING_MODES.includes(mode)
  const zombies = LOBBY_RING_MODES.includes(mode)
  form.innerHTML = `
    <h3 class="lobby-title">${_escapeHtml(t('lobbyCreateTitle'))}</h3>
    <label class="lobby-field"><span>${_escapeHtml(t('lobbyName'))}</span><input type="text" class="nickname-input" id="lobby-name" maxlength="24" autocomplete="off" placeholder="${_escapeHtml(t('serverNamePlaceholder'))}" value="${_escapeHtml(game._lobbyDraft?.name || '')}" /></label>
    <label class="lobby-field"><span>${_escapeHtml(t('lobbyMode'))}</span><select class="nickname-input lobby-select" id="lobby-mode">${modeOptions(mode)}</select></label>
    ${pickerHtml('max', r.max)}
    <label class="lobby-field"><span>${_escapeHtml(t('lobbyPassword'))}</span><input type="text" class="nickname-input" id="lobby-password" maxlength="${PASSWORD_MAX}" autocomplete="off" placeholder="${_escapeHtml(t('lobbyPasswordNone'))}" value="${_escapeHtml(game._lobbyDraft?.password || '')}" /></label>
    ${ringMode ? `<label class="lobby-field"><span>${_escapeHtml(t('lobbyWeapons'))}</span><select class="nickname-input lobby-select" id="lobby-ring"><option value="guns"${r.ring ? '' : ' selected'}>${_escapeHtml(t('lobbyGunsChoice'))}</option><option value="ring"${r.ring ? ' selected' : ''}>${_escapeHtml(t('lobbyRingChoice'))}</option></select></label>` : ''}
    ${ringMode && r.ring ? `<label class="lobby-field lobby-check"><input type="checkbox" class="audio-checkbox" id="lobby-ff"${r.ff ? ' checked' : ''} /><span>${_escapeHtml(t('lobbyFf'))}</span></label>` : ''}
    ${zombies ? `<h4 class="lobby-sub">${_escapeHtml(t('lobbyZombiesHeading'))}</h4>${pickerHtml('zh', r.zh)}${pickerHtml('zc', r.zc)}${pickerHtml('boss', r.boss)}` : ''}
    <h4 class="lobby-sub">${_escapeHtml(t('lobbyPlayersHeading'))}</h4>
    ${pickerHtml('hp', r.hp)}${pickerHtml('dmg', r.dmg)}${pickerHtml('spd', r.spd)}
    <p class="lobby-reward" id="lobby-reward">${_escapeHtml(rewardLine(r))}</p>
    <div class="share-code-box lobby-share">
      <h4 class="lobby-sub">${_escapeHtml(t('shareCodeLobbyTitle'))}</h4>
      <div class="share-code-row">
        <input type="text" class="nickname-input share-code-input" id="lobby-code-input" maxlength="600" autocomplete="off" spellcheck="false" placeholder="${_escapeHtml(t('shareCodePaste'))}" aria-label="${_escapeHtml(t('shareCodePaste'))}" />
        <button type="button" class="mini-action-btn" id="lobby-code-use">${_escapeHtml(t('shareCodeUse'))}</button>
        <button type="button" class="mini-action-btn" id="lobby-code-copy">${_escapeHtml(t('shareCodeCopy'))}</button>
      </div>
      <p class="share-code-status" id="lobby-code-status" aria-live="polite">${_escapeHtml(game._lobbyCodeMsg || '')}</p>
    </div>
    <div class="lobby-buttons">
      <button type="button" class="mini-action-btn" id="lobby-cancel-btn">${_escapeHtml(t('lobbyCancel'))}</button>
      <button type="button" class="mini-action-btn" id="lobby-create-btn">${_escapeHtml(t('lobbyCreate'))}</button>
    </div>`
}

export function rewardLine(r) {
  const m = rewardMult(r)
  return m < 1 ? t('lobbyRewardLess', { n: Math.round(m * 100) }) : t('lobbyRewardFull')
}

// What the form says now: { name, mode, password, rules }.
export function readLobbyForm() {
  const val = (id) => document.getElementById(id)?.value ?? ''
  const rules = defaultLobbyRules()
  for (const k of Object.keys(LOBBY_PICKS)) {
    const sel = document.querySelector(`[data-pick="${k}"]`)
    if (!sel) continue
    rules[k] = sel.value === 'custom' ? Number(document.querySelector(`[data-pick-num="${k}"]`)?.value) : Number(sel.value)
  }
  const ring = document.getElementById('lobby-ring')
  if (ring) rules.ring = ring.value !== 'guns'
  rules.ff = !!document.getElementById('lobby-ff')?.checked
  return { name: val('lobby-name').trim(), mode: val('lobby-mode') || 'main', password: val('lobby-password'), rules: cleanLobbyRules(rules) }
}

// The form's own clicks and changes (ServerBrowser.bindServerBrowser calls
// this once). create: makes the lobby from the form.
export function bindLobbyForm(game, create) {
  const form = document.getElementById('custom-lobby-form')
  if (!form || form._bound) return
  form._bound = true
  form.addEventListener('change', (e) => {
    if (e.target.id === 'lobby-code-input') return
    const sel = e.target.closest('[data-pick]')
    if (sel) {
      const num = form.querySelector(`[data-pick-num="${sel.dataset.pick}"]`)
      if (num) {
        num.hidden = sel.value !== 'custom'
        if (!num.hidden) num.focus()
      }
    }
    game._lobbyDraft = readLobbyForm()
    // A new mode or ring/guns shows or hides some rows.
    if (e.target.id === 'lobby-mode' || e.target.id === 'lobby-ring') renderLobbyForm(game)
    else document.getElementById('lobby-reward').textContent = rewardLine(game._lobbyDraft.rules)
  })
  form.addEventListener('keydown', (e) => {
    if (e.target.id === 'lobby-code-input' && e.key === 'Enter') useLobbyCode(game)
  })
  form.addEventListener('input', (e) => {
    if (!e.target.matches('[data-pick-num]')) return
    game._lobbyDraft = readLobbyForm()
    document.getElementById('lobby-reward').textContent = rewardLine(game._lobbyDraft.rules)
  })
  form.addEventListener('click', (e) => {
    if (e.target.closest('#lobby-cancel-btn')) showLobbyForm(game, false)
    else if (e.target.closest('#lobby-create-btn')) create(readLobbyForm())
    else if (e.target.closest('#lobby-code-copy')) copyLobbyCode(game)
    else if (e.target.closest('#lobby-code-use')) useLobbyCode(game)
  })
}

// The rules line shown when a custom lobby starts ("Custom rules: ...").
export function rulesMessage(rules) {
  const chips = changedRules(rules).map(ruleChip)
  const m = rewardMult(rules)
  return [t('lobbyRulesInGame', { list: chips.length ? chips.join(', ') : t('lobbyRulesNormal') }), m < 1 ? t('lobbyRewardLess', { n: Math.round(m * 100) }) : ''].filter(Boolean).join(' ')
}

// Share codes (ShareCodes.js): the form's rules as a code, or a code into the form.
function codeSay(game, key) {
  game._lobbyCodeMsg = t(key)
  const el = document.getElementById('lobby-code-status')
  if (el) el.textContent = game._lobbyCodeMsg
}

async function copyLobbyCode(game) {
  const d = readLobbyForm()
  const code = lobbyCode(d.mode, d.rules)
  if (await copyText(code)) codeSay(game, 'shareCodeCopiedFriend')
  else {
    const input = document.getElementById('lobby-code-input')
    if (input) {
      input.value = code
      input.select()
    }
    codeSay(game, 'shareCodeCopyByHand')
  }
}

// Fills the form from a code (name and password stay as typed).
function useLobbyCode(game) {
  const got = readLobbyCode(document.getElementById('lobby-code-input')?.value)
  if (!got) return codeSay(game, 'shareCodeBad')
  const now = readLobbyForm()
  game._lobbyDraft = { ...now, mode: got.mode, rules: got.rules }
  game._lobbyCodeMsg = t('shareCodeLobbyUsed')
  renderLobbyForm(game)
}
