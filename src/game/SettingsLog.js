// Settings > General > "Your Settings Changes" (2026-10-30, Gaymi: "in the
// settings for general section add a changelog for each settings change").
// Every setting the player changes in the Settings panel is written down:
// when, which setting (its label, in the current language), and the old
// value -> the new one. Newest first, the last LOG_MAX kept in this
// browser only (LOG_KEY), with a Clear button.
//
// One capture listener on the panel does the toggles, lists, sliders,
// colours and text boxes: the old value is read when the control is first
// touched (pointerdown / focusin), the new one just after its own change
// handler has run. Key rebinds, Reset buttons and anything else that isn't
// a form control call logSettingChange themselves.
import { t } from './i18n.js'

const LOG_KEY = 'gayz-settings-log'
export const LOG_MAX = 100
// Typing in these isn't a setting.
const SKIP_IDS = new Set(['settings-search-input', 'import-keybinds-input', 'import-settings-code-input'])

function readLog() {
  try {
    const list = JSON.parse(localStorage.getItem(LOG_KEY) || '[]')
    if (!Array.isArray(list)) return []
    // Untrusted: only well-formed rows, short strings.
    return list.filter((r) => r && typeof r.n === 'string' && Number.isFinite(r.at)).slice(0, LOG_MAX).map((r) => ({
      at: r.at,
      n: r.n.slice(0, 80),
      o: typeof r.o === 'string' ? r.o.slice(0, 60) : '',
      v: typeof r.v === 'string' ? r.v.slice(0, 60) : '',
    }))
  } catch {
    return []
  }
}

function writeLog(list) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(0, LOG_MAX)))
  } catch {
    // Storage full or blocked - the list just isn't kept.
  }
}

// One change: name of the setting, old value, new value (strings).
export function logSettingChange(name, oldValue, newValue) {
  const o = String(oldValue ?? '')
  const v = String(newValue ?? '')
  if (!name || (o === v && o !== '')) return
  const list = readLog()
  list.unshift({ at: Date.now(), n: String(name), o, v })
  writeLog(list)
  renderSettingsLog()
}

export function settingsLogEntries() {
  return readLog()
}

function labelFor(el) {
  const label = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null
  return (label?.textContent || el.getAttribute('aria-label') || el.id || '').trim()
}

// What a control shows right now, the way a player reads it.
function valueOf(el) {
  if (el.type === 'checkbox') return el.checked ? t('settingsLogOn') : t('settingsLogOff')
  if (el.tagName === 'SELECT') return el.selectedOptions[0]?.textContent.trim() || el.value
  if (el.type === 'range') {
    // The number beside the slider ("100%"), when there is one.
    const shown = el.parentElement?.querySelector('.audio-value')
    return shown?.textContent.trim() || el.value
  }
  return el.value
}

function tracked(el) {
  return el?.matches?.('input, select') && !SKIP_IDS.has(el.id) && !el.closest('#settings-log') && el.type !== 'file' && el.type !== 'button'
}

export function bindSettingsLog(panel) {
  if (!panel) return
  const before = new WeakMap()
  const remember = (e) => {
    const el = e.target
    if (!tracked(el) || before.has(el)) return
    // A checkbox's old value is simply the other one.
    before.set(el, el.type === 'checkbox' ? null : valueOf(el))
  }
  panel.addEventListener('pointerdown', remember, true)
  panel.addEventListener('focusin', remember, true)
  panel.addEventListener('change', (e) => {
    const el = e.target
    if (!tracked(el)) return
    const old = before.has(el) ? before.get(el) : undefined
    // After the control's own handler (it may round the value or update
    // the number shown beside it).
    setTimeout(() => {
      const now = valueOf(el)
      const was = el.type === 'checkbox' ? (el.checked ? t('settingsLogOff') : t('settingsLogOn')) : old ?? ''
      before.set(el, el.type === 'checkbox' ? null : now)
      logSettingChange(labelFor(el), was, now)
    }, 0)
  }, true)
  document.getElementById('settings-log-clear')?.addEventListener('click', () => {
    writeLog([])
    renderSettingsLog()
  })
  renderSettingsLog()
}

export function renderSettingsLog() {
  const box = document.getElementById('settings-log-list')
  if (!box) return
  const list = readLog()
  box.textContent = ''
  const clear = document.getElementById('settings-log-clear')
  if (clear) clear.disabled = !list.length
  if (!list.length) {
    const p = document.createElement('p')
    p.className = 'settings-log-empty'
    p.textContent = t('settingsLogEmpty')
    box.appendChild(p)
    return
  }
  for (const r of list) {
    const row = document.createElement('div')
    row.className = 'settings-log-row'
    const when = document.createElement('span')
    when.className = 'settings-log-when'
    when.textContent = new Date(r.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    const what = document.createElement('span')
    what.className = 'settings-log-what'
    const name = document.createElement('b')
    name.textContent = r.n
    what.appendChild(name)
    if (r.o || r.v) {
      const change = document.createElement('span')
      change.className = 'settings-log-change'
      change.textContent = r.o ? `${r.o} → ${r.v}` : r.v
      what.appendChild(change)
    }
    row.append(when, what)
    box.appendChild(row)
  }
}
