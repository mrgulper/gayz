// The rows for the settings in MoreSettingsList.js (2026-11-11), and the
// Audio ones' hook-ups. Each row looks exactly like the hand-written ones
// in index.html (.audio-row, "?" button, label, control), so search, the
// Settings Changes list, themes and the info popup all work on it.
import { MORE_SETTINGS } from './MoreSettingsList.js'
import { t } from './i18n.js'
import { saveSettings } from './Game.js'
import { audioEngine } from './Audio.js'
import { ensureGyro } from './ControlSettings.js'
import { applyHudLook } from './HudSettings.js'
import { bindGraphicsSettings, applyBatterySaver } from './GraphicsSettings.js'
import { onGameplayButton, bindPauseHelpers, bindSpoilerReveal } from './GameplayAssist.js'
import { applySocialLook } from './SocialSettings.js'
import { bindWellbeing, onWellbeingButton, applySilly, applyDataSaver, sillyLabel } from './Wellbeing.js'

const WELLBEING_BUTTONS = new Set(['settingsPresets', 'settingsQr', 'undoSettingChange'])

const listeners = new Map()

// Run fn(value, game) whenever `key` changes (and once at start-up).
export function onMoreSetting(key, fn) {
  if (!listeners.has(key)) listeners.set(key, [])
  listeners.get(key).push(fn)
}

function emit(game, key) {
  for (const fn of listeners.get(key) || []) {
    try { fn(game.settings[key], game) } catch { /* one hook failing never stops the rest */ }
  }
}

const rowId = (key) => `ms-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`

function clean(def, raw) {
  if (def.type === 'toggle') return typeof raw === 'boolean' ? raw : def.def
  if (def.type === 'select') return def.opts.includes(String(raw)) ? String(raw) : def.def
  if (def.type === 'range') {
    const n = Number(raw)
    return Number.isFinite(n) && raw !== null && raw !== '' ? Math.max(def.min, Math.min(def.max, n)) : def.def
  }
  return def.def
}

// Saved values are untrusted: anything odd falls back to the default.
export function parseMoreSettings(parsed) {
  const out = {}
  for (const def of MORE_SETTINGS) if (def.type !== 'button') out[def.key] = clean(def, parsed?.[def.key])
  return out
}

export function moreDefaults() {
  const out = {}
  for (const def of MORE_SETTINGS) if (def.type !== 'button') out[def.key] = def.def
  return out
}

function rowHtml(def) {
  const id = rowId(def.key)
  let control
  if (def.type === 'button') control = `<button type="button" id="${id}" class="mini-action-btn"></button>`
  else if (def.type === 'toggle') control = `<input type="checkbox" id="${id}" class="audio-checkbox" />`
  else if (def.type === 'select') control = `<select id="${id}">${def.opts.map((v) => `<option value="${v}"></option>`).join('')}</select>`
  else control = `<input type="range" id="${id}" min="${def.min}" max="${def.max}" step="${def.step || 1}" value="${def.def}" /><span id="${id}-value" class="audio-value"></span>`
  return `<button type="button" class="settings-info-btn" data-info="${def.key}" aria-label="What does this do?">?</button><label for="${id}" id="${id}-label"></label>${control}`
}

// Puts every row in its tab. Safe to call twice.
export function buildMoreRows() {
  for (const def of MORE_SETTINGS) {
    if (document.getElementById(rowId(def.key))) continue
    const anchor = document.getElementById(def.before)
    if (!anchor) continue
    // `before` may name a control inside a row: go in front of that row.
    const target = anchor.closest('.audio-row') || anchor
    const row = document.createElement('div')
    row.className = 'audio-row'
    row.dataset.more = def.key
    row.innerHTML = rowHtml(def)
    target.parentNode.insertBefore(row, target)
  }
  applyMoreText()
}

function shownValue(def, v) {
  return `${v}${def.unit || ''}`
}

// Labels and list choices in the current language (called from
// Game._applyLanguage too).
export function applyMoreText() {
  for (const def of MORE_SETTINGS) {
    const id = rowId(def.key)
    const label = document.getElementById(`${id}-label`)
    // Silly Setting of the Day names today's silly thing.
    if (label) label.textContent = def.key === 'sillyOfDay' ? sillyLabel() : t(`${def.key}Label`)
    if (def.type === 'button') {
      const btn = document.getElementById(id)
      if (btn) btn.textContent = t(`${def.key}Btn`)
    }
    if (def.type === 'select') {
      const sel = document.getElementById(id)
      if (sel) for (const opt of sel.options) opt.textContent = t(`${def.key}Opt_${opt.value}`)
    }
  }
}

export function bindMoreSettings(game) {
  buildMoreRows()
  for (const def of MORE_SETTINGS) {
    const el = document.getElementById(rowId(def.key))
    if (!el) continue
    if (def.type === 'button') {
      el.addEventListener('click', () => (WELLBEING_BUTTONS.has(def.key) ? onWellbeingButton(def.key, game) : onGameplayButton(def.key, game)))
      continue
    }
    const shown = document.getElementById(`${rowId(def.key)}-value`)
    const show = () => {
      if (def.type === 'toggle') el.checked = !!game.settings[def.key]
      else el.value = String(game.settings[def.key])
      if (shown) shown.textContent = shownValue(def, game.settings[def.key])
    }
    show()
    const read = () => {
      game.settings[def.key] = clean(def, def.type === 'toggle' ? el.checked : el.value)
      if (shown) shown.textContent = shownValue(def, game.settings[def.key])
      emit(game, def.key)
      saveSettings(game.settings)
    }
    el.addEventListener(def.type === 'range' ? 'input' : 'change', read)
    if (shown && def.type === 'range') game._bindEditableSliderValue?.(shown, el)
  }
  bindAudioExtras(game)
  // Gyro Aim: iPhones ask to use motion here (the toggle is a tap).
  onMoreSetting('gyroAim', (on) => ensureGyro(on))
  // HUD (ideas 25-38): the looks that are pure CSS; the rest is HudSettings.hudTick.
  for (const key of ['hudScale', 'chatOpacity', 'healthDisplay', 'minimapSize', 'hitMarker', 'killFeed']) onMoreSetting(key, (v, g) => applyHudLook(g.settings))
  // Graphics > Effects (ideas 39-50): most are read where they're used
  // (GraphicsSettings.js); these three redo the canvas filter.
  bindGraphicsSettings(game)
  for (const key of ['gamma', 'saturation', 'sharpen']) onMoreSetting(key, (v, g) => g._applyGraphicsFilters?.())
  onMoreSetting('batterySaver', (v, g) => applyBatterySaver(g))
  // Gameplay (ideas 51-62): read where they're used (GameplayAssist.js).
  bindPauseHelpers(game)
  bindSpoilerReveal()
  onMoreSetting('spoilerFreeStory', (on) => document.documentElement.classList.toggle('spoiler-free', !!on))
  // Social & Safety (ideas 63-72): read where they're used (SocialSettings.js).
  for (const key of ['hideChat', 'hideCurrency']) onMoreSetting(key, (v, g) => applySocialLook(g.settings))
  for (const key of ['chatFilter', 'friendsOnlyChat']) {
    onMoreSetting(key, (v, g) => {
      import('./ChatUI.js').then((c) => {
        if (g._lastChatMsgs) c.renderChatMessages(g, g._lastChatMsgs)
        if (g._lastServerChatMsgs) c.renderServerChatMessages(g, g._lastServerChatMsgs)
      }).catch(() => {})
    })
  }
  // Public profile bits: send the leaderboard doc again.
  for (const key of ['hideClan', 'hideCurrency']) onMoreSetting(key, (v, g) => { if (g._moreSettingsReady) g._pushOnlineStats?.() })
  // Wellbeing & Misc (ideas 73-80): reminders + timer run in Wellbeing.js.
  onMoreSetting('sillyOfDay', (v, g) => applySilly(g.settings))
  onMoreSetting('dataSaver', (on) => applyDataSaver(on))
  bindWellbeing(game)
  for (const def of MORE_SETTINGS) if (def.type !== 'button') emit(game, def.key)
  game._moreSettingsReady = true
}

// ---------- Audio (ideas 1-10) ----------

// Quiet Hours: from the chosen hour until 7 in the morning, everything
// plays at QUIET_LEVEL of its normal volume.
const QUIET_LEVEL = 0.35
const QUIET_UNTIL = 7

export function quietHoursFactor(settings, now = new Date()) {
  const from = Number(settings?.quietHours)
  if (!Number.isFinite(from)) return 1
  const h = now.getHours()
  return h >= from || h < QUIET_UNTIL ? QUIET_LEVEL : 1
}

function bindAudioExtras(game) {
  const volumes = () => game._applyAllVolumes?.()
  // Sound starts on the first click or key press (a browser only lets a
  // page play sound after one). Since the old city map went (2026-10-05)
  // nothing started it, so games were silent unless Settings > Audio >
  // Test had been pressed.
  const wake = (e) => {
    if (!e.isTrusted) return
    try {
      audioEngine.init()
      audioEngine.resume()
      volumes()
    } catch { /* no sound on this browser */ }
    window.removeEventListener('pointerdown', wake, true)
    window.removeEventListener('keydown', wake, true)
  }
  window.addEventListener('pointerdown', wake, true)
  window.addEventListener('keydown', wake, true)
  for (const key of ['musicVolume', 'uiVolume', 'footstepVolume', 'weaponVolume', 'quietHours']) onMoreSetting(key, volumes)
  onMoreSetting('monoAudio', (on) => audioEngine.setMono?.(on))
  // Homepage Music (2026-11-13): calm music on the homepage only - it
  // fades out when a game or the Map Editor opens and back in after.
  onMoreSetting('menuMusic', (on) => audioEngine.setMenuMusic?.(on !== false))
  setInterval(() => {
    if (!audioEngine.ctx) return
    const home = !game.buildMode?.active && !document.hidden
    if (home && !audioEngine.menuMusicPlaying) audioEngine.startMenuMusic?.()
    else if (!home && audioEngine.menuMusicPlaying) audioEngine.stopMenuMusic?.()
  }, 500)
  onMoreSetting('duckNearZombies', (on) => { if (!on) audioEngine.setDuck?.(1) })
  onMoreSetting('soundSubtitles', (on) => { if (!on) clearCaptions() })
  // Quiet hours start and end on their own: check the clock every minute.
  let quietWas = quietHoursFactor(game.settings)
  setInterval(() => {
    const q = quietHoursFactor(game.settings)
    if (q !== quietWas) { quietWas = q; volumes() }
    // Nobody's playing any more: music back to full.
    if (performance.now() - lastSurvivalTick > 1500) audioEngine.setDuck?.(1)
  }, 1000)
  // UI Sounds: a soft tick on every button press (not in a game, where
  // buttons are rare and the guns are louder anyway).
  document.addEventListener('click', (e) => {
    if (!e.isTrusted) return
    const el = e.target.closest?.('button, .settings-tab, [role="button"], select, input[type="checkbox"]')
    if (!el) return
    // Homepage / store / market sounds (2026-11-13): the right-side
    // buttons open with a swoosh, X closes, tabs flick, the rest click.
    // (Buying and crates play their own from where the coins change.)
    const cls = typeof el.className === 'string' ? el.className : ''
    if (el.closest('#menu-nav-buttons, #menu-player-badge') || /^(store|market|menu-inventory|settings|gamemode)-btn$/.test(el.id)) audioEngine.playUi?.('open')
    else if (/close/i.test(cls) || /close/i.test(el.id)) audioEngine.playUi?.('close')
    else if (/(^|[\s-])tab(\b|-)/i.test(cls) || el.getAttribute('role') === 'tab') audioEngine.playUi?.('tab')
    else audioEngine.playUiClick?.()
  }, true)
  audioEngine.onCaption = (kind, pan) => {
    if (game.settings.soundSubtitles) showCaption(kind, pan)
  }
}

// Heartbeat + ducking, run from BuildSurvival.update every frame of a game.
let lastSurvivalTick = 0
let heartbeatIn = 0
let duckCheckIn = 0
const DUCK_RANGE = 12
const DUCK_LEVEL = 0.35

export function survivalAudioTick(s, dt) {
  lastSurvivalTick = performance.now()
  const set = s.bm?.game?.settings
  if (!set) return
  const max = s.maxHealth || 100
  const low = !s.dead && s.health > 0 && s.health / max <= 0.3
  if (low && set.lowHealthHeartbeat) {
    heartbeatIn -= dt
    if (heartbeatIn <= 0) {
      // Faster the closer to dying: ~0.55 s apart near 0, ~1.15 s at 30%.
      heartbeatIn = 0.55 + 0.6 * (s.health / (max * 0.3))
      audioEngine.playHeartbeat?.()
    }
  } else heartbeatIn = 0
  duckCheckIn -= dt
  if (duckCheckIn > 0) return
  duckCheckIn = 0.25
  let near = false
  if (set.duckNearZombies && !s.dead) {
    const p = s.bodyPos?.()
    if (p) {
      for (const zb of s.zombies || []) {
        if (Math.hypot(zb.x - p.x, zb.z - p.z) < DUCK_RANGE) { near = true; break }
      }
    }
  }
  audioEngine.setDuck?.(near ? DUCK_LEVEL : 1)
}

// Chat Ping: a sound when a new message from someone else arrives.
// The first list a chat shows is old messages, so it only remembers them.
const seenChat = new Set()
const primedChats = new Set()
const PING_FRESH_MS = 20000

export function chatPingCheck(game, channel, msgs) {
  const sig = (m) => m.id || `${m.nickname}|${m.createdAt || ''}|${m.text}`
  const first = !primedChats.has(channel)
  primedChats.add(channel)
  let ping = false
  const muted = new Set(game.settings.mutedChatPlayers || [])
  for (const m of msgs || []) {
    const k = `${channel}|${sig(m)}`
    if (seenChat.has(k)) continue
    seenChat.add(k)
    if (first) continue
    if (m.nickname && m.nickname === game.settings.nickname) continue
    if (muted.has(m.nickname)) continue
    if (m.createdAt && Date.now() - m.createdAt > PING_FRESH_MS) continue
    ping = true
  }
  if (seenChat.size > 2000) seenChat.clear()
  if (ping && game.settings.chatPing) audioEngine.playChatPing?.()
}

// Sound Subtitles: little "[zombie growl, left]" lines low in the middle
// of the screen, each for CAPTION_S seconds; the same sound again just
// refreshes its line.
const CAPTION_S = 2.6
const CAPTION_MAX = 3
let captionBox = null
const captionLines = new Map()

function showCaption(kind, pan) {
  if (!captionBox) {
    captionBox = document.createElement('div')
    captionBox.id = 'sound-captions'
    captionBox.setAttribute('aria-live', 'polite')
    document.body.appendChild(captionBox)
  }
  const side = pan < -0.3 ? 'Left' : pan > 0.3 ? 'Right' : ''
  const text = side
    ? t('soundCaptionWithSide', { sound: t(`soundCaption_${kind}`), side: t(`soundCaptionSide${side}`) })
    : t('soundCaptionPlain', { sound: t(`soundCaption_${kind}`) })
  const id = `${kind}|${side}`
  let line = captionLines.get(id)
  if (!line) {
    line = { el: document.createElement('div'), timer: 0 }
    line.el.className = 'sound-caption'
    captionBox.appendChild(line.el)
    captionLines.set(id, line)
    while (captionLines.size > CAPTION_MAX) {
      const [oldId, old] = captionLines.entries().next().value
      clearTimeout(old.timer)
      old.el.remove()
      captionLines.delete(oldId)
    }
  }
  line.el.textContent = text
  clearTimeout(line.timer)
  line.timer = setTimeout(() => {
    line.el.remove()
    captionLines.delete(id)
  }, CAPTION_S * 1000)
}

function clearCaptions() {
  for (const line of captionLines.values()) {
    clearTimeout(line.timer)
    line.el.remove()
  }
  captionLines.clear()
}
