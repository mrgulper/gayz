// Settings > General > Wellbeing + Misc, ideas 73-80 of Gaymi's settings
// list (2026-11-11, the last section). Gaymi's picks: presets = ready-made
// ones + 3 save slots; Silly Setting of the Day really changes something
// (harmless); the QR code is scanned with a phone camera and opens GayZ
// with those settings (it asks first).
//   73 Break Reminder / 75 Bedtime Reminder: a small note at the top
//      (#wellbeing-note) with OK and "10 more minutes".
//   74 Session Timer: a line in the in-game info box (HudSettings.infoTick).
//   76 Data Saver: Audio.js loads fewer sound files, Game.js skips the
//      idle downloads (Play / Design a Skin load when opened instead).
//   77 Presets + 78 QR code: SettingsPresets.js (loaded when opened).
//   79 Silly Setting of the Day: html.silly-<id>, FunnyZombies all hats,
//      Audio squeaky footsteps.
//   80 Undo Last Change: SettingsLog's undo stack (one control at a time),
//      or the whole-settings snapshot a preset / slot / QR left.
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { setAllHats } from './FunnyZombies.js'
import { undoLastSettingChange } from './SettingsLog.js'

// ---------- play time (73, 74) ----------

// No key / click / touch for this long = not playing.
const IDLE_MS = 2 * 60000
// Away (idle or tab hidden) this long counts as a real break.
const BREAK_RESET_MS = 5 * 60000
const SNOOZE_MS = 10 * 60000

const pageStart = Date.now()
let testShift = 0
let lastInput = performance.now()
let awayMs = 0
let sinceBreakMs = 0
let breakSnoozeUntil = 0

// Time since GayZ was opened (what the Session Timer shows).
export function sessionMs(now = Date.now()) {
  return Math.max(0, now - pageStart - testShift)
}

export function sessionText(now = Date.now()) {
  const s = Math.floor(sessionMs(now) / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const two = (n) => String(n).padStart(2, '0')
  return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`
}

// ---------- the note at the top (73, 75) ----------

let note = null

function closeNote() {
  if (note) note.remove()
  note = null
}

// text + two buttons; onOk / onLater run after it closes.
function showNote(kind, text, onOk, onLater) {
  closeNote()
  note = document.createElement('div')
  note.id = 'wellbeing-note'
  note.dataset.kind = kind
  note.setAttribute('role', 'status')
  const p = document.createElement('p')
  p.textContent = text
  const row = document.createElement('div')
  row.className = 'wellbeing-note-btns'
  const ok = document.createElement('button')
  ok.type = 'button'
  ok.className = 'wellbeing-ok'
  ok.textContent = t(kind === 'bed' ? 'bedtimeOkBtn' : 'breakOkBtn')
  const later = document.createElement('button')
  later.type = 'button'
  later.className = 'wellbeing-later'
  later.textContent = t('wellbeingLaterBtn')
  ok.addEventListener('click', () => { closeNote(); onOk?.() })
  later.addEventListener('click', () => { closeNote(); onLater?.() })
  row.append(ok, later)
  note.append(p, row)
  document.body.appendChild(note)
}

// ---------- 75 Bedtime ----------

const BED_KEY = 'gayz-bedtime-shown'
// Bedtime lasts until this hour in the morning.
const BED_UNTIL = 5
let bedSnoozeUntil = 0

// The night this moment belongs to (after midnight = the evening before).
function nightOf(now) {
  const d = new Date(now)
  if (d.getHours() < BED_UNTIL) d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export function isBedtime(settings, now = new Date()) {
  const from = Number(settings?.bedtimeReminder)
  if (settings?.bedtimeReminder === 'off' || !Number.isFinite(from)) return false
  const h = now.getHours()
  if (from === 0) return h < BED_UNTIL
  return h >= from || h < BED_UNTIL
}

function bedShownTonight(now) {
  try { return localStorage.getItem(BED_KEY) === nightOf(now) } catch { return false }
}

function bedTimeText(settings) {
  const h = Number(settings.bedtimeReminder)
  try {
    return new Date(2000, 0, 1, h, 0).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: settings.timeFormat !== '24h' })
  } catch {
    return `${h}:00`
  }
}

// ---------- 79 Silly Setting of the Day ----------

export const SILLY = ['rainbowCrosshair', 'upsideChat', 'comicFont', 'squeakyFeet', 'hatsForAll', 'bouncyButtons']

// Today's one (local date), the same all day for everyone.
export function sillyToday(now = new Date()) {
  const day = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000)
  return SILLY[((day % SILLY.length) + SILLY.length) % SILLY.length]
}

let sillyShown = null

export function applySilly(settings) {
  const today = sillyToday()
  const on = !!settings?.sillyOfDay
  const root = document.documentElement
  for (const id of SILLY) root.classList.toggle(`silly-${id}`, on && id === today)
  setAllHats(on && today === 'hatsForAll')
  audioEngine.squeaky = on && today === 'squeakyFeet'
  if (sillyShown !== today) {
    sillyShown = today
    const label = document.getElementById('ms-silly-of-day-label')
    if (label) label.textContent = sillyLabel()
  }
}

export function sillyLabel() {
  return t('sillyOfDayLabel', { name: t(`silly_${sillyToday()}`) })
}

// ---------- 76 Data Saver ----------

export function applyDataSaver(on) {
  audioEngine.dataSaver = !!on
}

// ---------- 80 Undo ----------

const SNAP_KEY = 'gayz-settings-undo'

// A preset / save slot / QR code changes many settings and reloads: keep
// what they were so Undo can bring them back (this tab only).
export function rememberBeforeBigChange(settings, keys) {
  const was = {}
  for (const k of keys) if (k in settings) was[k] = settings[k]
  try { sessionStorage.setItem(SNAP_KEY, JSON.stringify(was)) } catch { /* no undo then */ }
}

function undo(game) {
  const name = undoLastSettingChange()
  if (name !== null) {
    game._showHomepageToast?.(t('undoSettingDone', { name }))
    return
  }
  let was = null
  try { was = JSON.parse(sessionStorage.getItem(SNAP_KEY) || 'null') } catch { was = null }
  if (was && typeof was === 'object') {
    try { sessionStorage.removeItem(SNAP_KEY) } catch { /* fine */ }
    import('./SettingsPresets.js').then((p) => p.applySettingsValues(game, was, false)).catch(() => {})
    return
  }
  game._showHomepageToast?.(t('undoSettingNothing'))
}

// ---------- buttons + start-up ----------

export function onWellbeingButton(key, game) {
  if (key === 'undoSettingChange') undo(game)
  else if (key === 'settingsPresets' || key === 'settingsQr') {
    import('./SettingsPresets.js').then((p) => (key === 'settingsQr' ? p.openSettingsQr(game) : p.openPresets(game))).catch(() => {})
  }
}

export function bindWellbeing(game) {
  game._wellbeing = { isBedtime, sessionText, sillyToday, test: _testWellbeing }
  const seen = () => { lastInput = performance.now() }
  for (const ev of ['keydown', 'pointerdown', 'wheel', 'touchstart']) window.addEventListener(ev, seen, { passive: true, capture: true })
  // Ctrl/Cmd+Z in Settings (not while typing) = Undo Last Change.
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return
    if (!game.settingsOpen) return
    if (e.target?.matches?.('input[type="text"], input:not([type]), textarea, [contenteditable="true"]')) return
    e.preventDefault()
    undo(game)
  })
  let last = performance.now()
  setInterval(() => {
    const now = performance.now()
    const step = Math.min(5000, now - last)
    last = now
    tickReminders(game, step, now)
    applySilly(game.settings)
  }, 1000)
  // Opened from a settings QR code (or the link pasted into this tab).
  const fromQr = () => {
    if (/^#sc=/.test(location.hash)) import('./SettingsPresets.js').then((p) => p.offerQrSettings(game, location.hash.slice(4))).catch(() => {})
  }
  fromQr()
  window.addEventListener('hashchange', fromQr)
}

function tickReminders(game, step, now) {
  const set = game.settings
  const playing = document.visibilityState === 'visible' && now - lastInput < IDLE_MS
  if (playing) {
    awayMs = 0
    sinceBreakMs += step
  } else {
    awayMs += step
    if (awayMs >= BREAK_RESET_MS) sinceBreakMs = 0
  }
  if (note) return
  const mins = Number(set.breakReminder)
  if (playing && Number.isFinite(mins) && mins > 0 && sinceBreakMs >= mins * 60000 && Date.now() >= breakSnoozeUntil) {
    const played = Math.round(sinceBreakMs / 60000)
    showNote('break', t('breakReminderText', { n: played }), () => { sinceBreakMs = 0 }, () => { breakSnoozeUntil = Date.now() + SNOOZE_MS })
    return
  }
  const d = new Date()
  if (playing && isBedtime(set, d) && !bedShownTonight(d) && Date.now() >= bedSnoozeUntil) {
    showNote('bed', t('bedtimeReminderText', { time: bedTimeText(set) }), () => {
      try { localStorage.setItem(BED_KEY, nightOf(new Date())) } catch { /* shows again then */ }
    }, () => { bedSnoozeUntil = Date.now() + SNOOZE_MS })
  }
}

// Tests: pretend `ms` of playing has passed since the last break, and the
// session started `ms` earlier.
export function _testWellbeing({ played, session } = {}) {
  if (Number.isFinite(played)) { sinceBreakMs = played; breakSnoozeUntil = 0; lastInput = performance.now() }
  if (Number.isFinite(session)) testShift = -session
  bedSnoozeUntil = 0
  try { localStorage.removeItem(BED_KEY) } catch { /* fine */ }
}
