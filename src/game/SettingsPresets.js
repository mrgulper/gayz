// Settings > General > Misc: Presets (idea 77) and the Settings QR Code
// (idea 78). Loaded only when one of them is opened (Wellbeing.js).
//   - Presets: ready-made ones (one click) + SLOT_COUNT save slots of your
//     own (this browser). Applying saves the settings and reloads, the
//     same way Paste Settings Code does, so every control shows them.
//   - QR code: a link to GayZ with your changed settings in the part after
//     # (never sent to the server). Scanning it opens GayZ, which asks
//     before copying them (offerQrSettings).
// Before a preset / slot / QR changes anything, Wellbeing remembers the
// old values, so Undo Last Change brings them all back.
import qrcode from 'qrcode-generator'
import { t } from './i18n.js'
import { saveSettings, defaultSettings, SETTINGS_CODE_KEYS } from './Game.js'
import { LEVEL_LOOK } from './GraphicsLevels.js'
import { rememberBeforeBigChange } from './Wellbeing.js'

const SLOT_KEY = 'gayz-settings-slots'
const SLOT_COUNT = 3

const level = (name) => {
  const look = LEVEL_LOOK[name]
  return { graphicsLevel: name, viewDistance: look.view, shadowsEnabled: look.shadows, shadowQuality: look.shadowQuality, renderResolution: look.res ?? 100 }
}

export const PRESETS = {
  phone: { ...level('simple'), batterySaver: 'on', particleAmount: 'medium', grassTufts: false, performanceMode: false },
  slowPc: { ...level('potato'), performanceMode: true, particleAmount: 'low', grassTufts: false, cloudsEnabled: false, weatherEffects: false, batterySaver: 'on' },
  calm: { screenShake: 0, bloodStyle: 'off', reduceFlashing: true, viewBobbing: false, lowHealthHeartbeat: false, gameTips: 'helpful', chatFilter: 'strict' },
  streaming: { hideCurrency: true, hideClan: true, chatFilter: 'strict', showCoords: false },
  maxGraphics: { ...level('ultra'), performanceMode: false, batterySaver: 'off', particleAmount: 'high', grassTufts: true, cloudsEnabled: true, weatherEffects: true },
}

// Only the shareable preference fields, never identity or progress.
function pick(values) {
  const out = {}
  if (!values || typeof values !== 'object') return out
  for (const k of SETTINGS_CODE_KEYS) if (Object.prototype.hasOwnProperty.call(values, k)) out[k] = values[k]
  return out
}

function currentValues(game) {
  const out = {}
  for (const k of SETTINGS_CODE_KEYS) out[k] = game.settings[k]
  return out
}

// Puts `values` into the settings, saves and reloads (Game's load step
// cleans anything odd). remember: keep the old ones for Undo.
export function applySettingsValues(game, values, remember = true) {
  const v = pick(values)
  const keys = Object.keys(v)
  if (!keys.length) return
  if (remember) rememberBeforeBigChange(game.settings, keys)
  for (const k of keys) game.settings[k] = v[k]
  saveSettings(game.settings)
  window.location.reload()
}

function readSlots() {
  try {
    const list = JSON.parse(localStorage.getItem(SLOT_KEY) || '[]')
    return Array.from({ length: SLOT_COUNT }, (_, i) => {
      const s = Array.isArray(list) ? list[i] : null
      return s && typeof s === 'object' && Number.isFinite(s.at) && s.values && typeof s.values === 'object' ? { at: s.at, values: s.values } : null
    })
  } catch {
    return Array(SLOT_COUNT).fill(null)
  }
}

function writeSlots(slots) {
  try { localStorage.setItem(SLOT_KEY, JSON.stringify(slots)) } catch { /* not kept */ }
}

// ---------- the popup ----------

let pop = null

function closePopup() {
  if (pop) pop.remove()
  pop = null
}

function button(text, cls, onClick) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = cls
  b.textContent = text
  b.addEventListener('click', onClick)
  return b
}

function openPopup(id, title) {
  closePopup()
  pop = document.createElement('div')
  pop.id = id
  pop.className = 'wellbeing-pop'
  pop.addEventListener('click', (e) => { if (e.target === pop) closePopup() })
  const box = document.createElement('div')
  box.className = 'wellbeing-pop-box'
  const h = document.createElement('h3')
  h.textContent = title
  box.appendChild(h)
  pop.appendChild(box)
  const close = button(t('wellbeingCloseBtn'), 'wellbeing-pop-close', closePopup)
  document.body.appendChild(pop)
  return { box, close }
}

// Settings can be open in a game too: a reload would end the game.
function inGame(game) {
  return !!(game.buildMode?.active)
}

export function openPresets(game) {
  const { box, close } = openPopup('settings-presets-pop', t('settingsPresetsLabel'))
  const playing = inGame(game)
  if (playing) {
    const p = document.createElement('p')
    p.className = 'wellbeing-pop-note'
    p.textContent = t('presetsInGameNote')
    box.appendChild(p)
  }
  const ready = document.createElement('div')
  ready.className = 'preset-grid'
  for (const id of Object.keys(PRESETS)) {
    const b = button(t(`preset_${id}`), 'preset-btn', () => applySettingsValues(game, PRESETS[id]))
    b.dataset.preset = id
    b.title = t(`preset_${id}_info`)
    b.disabled = playing
    ready.appendChild(b)
  }
  box.appendChild(ready)
  const h = document.createElement('h4')
  h.textContent = t('presetSlotsHeading')
  box.appendChild(h)
  const slots = readSlots()
  slots.forEach((slot, i) => {
    const row = document.createElement('div')
    row.className = 'preset-slot'
    row.dataset.slot = String(i)
    const name = document.createElement('span')
    name.className = 'preset-slot-name'
    name.textContent = slot
      ? t('presetSlotSaved', { n: i + 1, when: new Date(slot.at).toLocaleDateString([], { month: 'short', day: 'numeric' }) })
      : t('presetSlotEmpty', { n: i + 1 })
    const save = button(t('presetSaveBtn'), 'preset-save', () => {
      const list = readSlots()
      list[i] = { at: Date.now(), values: currentValues(game) }
      writeSlots(list)
      game._showHomepageToast?.(t('presetSavedToast', { n: i + 1 }))
      openPresets(game)
    })
    const load = button(t('presetLoadBtn'), 'preset-load', () => applySettingsValues(game, slot.values))
    load.disabled = !slot || playing
    row.append(name, save, load)
    box.appendChild(row)
  })
  box.appendChild(close)
}

// ---------- 78 QR code ----------

// Only what differs from the defaults, so the code stays small.
export function qrPayload(game) {
  const def = defaultSettings()
  const out = {}
  for (const k of SETTINGS_CODE_KEYS) {
    if (JSON.stringify(game.settings[k]) !== JSON.stringify(def[k])) out[k] = game.settings[k]
  }
  return out
}

export function qrLink(game) {
  const code = btoa(unescape(encodeURIComponent(JSON.stringify(qrPayload(game)))))
  return `${location.origin}/#sc=${encodeURIComponent(code)}`
}

export function openSettingsQr(game) {
  const { box, close } = openPopup('settings-qr-pop', t('settingsQrLabel'))
  const link = qrLink(game)
  let svg
  try {
    const qr = qrcode(0, 'L')
    qr.addData(link)
    qr.make()
    svg = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })
  } catch {
    svg = null
  }
  const p = document.createElement('p')
  p.className = 'wellbeing-pop-note'
  if (svg) {
    const pic = document.createElement('div')
    pic.className = 'settings-qr-pic'
    // The library's own SVG (only black/white squares, no player text).
    pic.innerHTML = svg
    box.appendChild(pic)
    p.textContent = t('settingsQrHelp', { n: Object.keys(qrPayload(game)).length })
  } else {
    p.textContent = t('settingsQrTooBig')
  }
  box.appendChild(p)
  box.appendChild(close)
}

// The page was opened from a settings QR code: ask, then copy them.
export function offerQrSettings(game, raw) {
  const clearHash = () => { try { history.replaceState(null, '', location.pathname + location.search) } catch { /* fine */ } }
  let values = null
  try {
    values = pick(JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(raw))))))
  } catch {
    values = null
  }
  if (!values || !Object.keys(values).length) {
    clearHash()
    if (values) return
    game._showHomepageToast?.(t('settingsCodeInvalid'))
    return
  }
  const { box } = openPopup('settings-qr-offer', t('settingsQrOfferTitle'))
  const p = document.createElement('p')
  p.className = 'wellbeing-pop-note'
  p.textContent = t('settingsQrOfferText', { n: Object.keys(values).length })
  const row = document.createElement('div')
  row.className = 'wellbeing-note-btns'
  row.append(
    button(t('settingsQrOfferYes'), 'wellbeing-ok', () => { clearHash(); applySettingsValues(game, values) }),
    button(t('settingsQrOfferNo'), 'wellbeing-later', () => { clearHash(); closePopup() }),
  )
  box.append(p, row)
}
