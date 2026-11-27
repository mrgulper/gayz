// Time Capsule (2026-11-27): Profile > Time Capsule. Write a note to your
// future self; it stays locked for the days you pick (1 day, 1 week,
// 1 month or Custom). When it opens you see the note plus a "then vs now"
// of your level, zombie kills and coins.
//
// Gaymi's picks: lives in the Profile panel; kept on THIS DEVICE ONLY
// (CAPSULE_KEY is in CloudMerge's DEVICE_ONLY_KEYS, so Cloud Save never
// copies it - no Firebase reads or writes). On homepage start, any capsule
// that opened since the last visit shows one toast.
//
// Stored: [{ id, text, made, opensAt, snap: { level, kills, coins }, told }]
// Untrusted when read back: every field is checked and text is escaped.
import { t } from './i18n.js'
import { _escapeHtml } from './Game.js'
import { levelFromXp } from './Xp.js'

export const CAPSULE_KEY = 'gayz-time-capsules'
export const TEXT_MAX = 300
export const LOCKED_MAX = 5 // capsules waiting at once (a guess for "a few")
export const KEEP_MAX = 30 // opened ones kept, newest first
export const CUSTOM_DAYS_MAX = 365
export const WAIT_CHOICES = [
  { days: 1, key: 'capsuleWait1d' },
  { days: 7, key: 'capsuleWait1w' },
  { days: 30, key: 'capsuleWait1m' },
]
const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

const $ = (id) => document.getElementById(id)

function num(v) {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export function loadCapsules() {
  let raw
  try {
    raw = JSON.parse(localStorage.getItem(CAPSULE_KEY) || '[]')
  } catch { raw = [] }
  if (!Array.isArray(raw)) return []
  return raw
    .filter((c) => c && typeof c.id === 'string' && typeof c.text === 'string' && Number.isFinite(Number(c.opensAt)))
    .map((c) => ({
      id: c.id.slice(0, 40),
      text: c.text.slice(0, TEXT_MAX),
      made: num(c.made),
      opensAt: num(c.opensAt),
      snap: { level: num(c.snap?.level) || 1, kills: num(c.snap?.kills), coins: num(c.snap?.coins) },
      told: c.told === true,
    }))
}

function saveCapsules(list) {
  try { localStorage.setItem(CAPSULE_KEY, JSON.stringify(list)) } catch { /* storage full or blocked */ }
}

// Your numbers right now (the "then" when sealing, the "now" when opening).
export function snapshot(game) {
  const cs = game.careerStats || {}
  return {
    level: levelFromXp(num(cs.xp)).level,
    kills: num(cs.totalKills),
    coins: num(game.coins),
  }
}

export function isOpen(c, now = Date.now()) {
  return now >= c.opensAt
}

// Days picked -> whole days 1..365, or 0 if not a number.
export function cleanDays(v) {
  const n = Math.floor(Number(v))
  if (!Number.isFinite(n) || n < 1) return 0
  return Math.min(CUSTOM_DAYS_MAX, n)
}

// "Opens in 3 days" / "in 5 hours" / "in less than an hour".
export function timeLeftText(ms) {
  if (ms >= DAY_MS) return t('capsuleInDays', { n: Math.ceil(ms / DAY_MS) })
  if (ms >= HOUR_MS) return t('capsuleInHours', { n: Math.ceil(ms / HOUR_MS) })
  return t('capsuleInMinutes')
}

function fmt(n) {
  return Number(n).toLocaleString()
}

function dateText(ms) {
  try { return new Date(ms).toLocaleDateString() } catch { return '' }
}

function setText(id, text) {
  const el = $(id)
  if (el) el.textContent = text
}

// --- writing ---

function pickedDays() {
  const sel = $('capsule-wait-select')
  if (!sel) return 7
  if (sel.value === 'custom') return cleanDays($('capsule-custom-days')?.value)
  return cleanDays(sel.value)
}

export function sealCapsule(game, now = Date.now()) {
  const input = $('capsule-input')
  const text = String(input?.value || '').trim().slice(0, TEXT_MAX)
  if (!text) return setText('capsule-status', t('capsuleEmpty'))
  const days = pickedDays()
  if (!days) return setText('capsule-status', t('capsuleBadDays', { max: CUSTOM_DAYS_MAX }))
  const list = loadCapsules()
  if (list.filter((c) => !isOpen(c, now)).length >= LOCKED_MAX) {
    return setText('capsule-status', t('capsuleTooMany', { n: LOCKED_MAX }))
  }
  list.unshift({
    id: `c${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    text,
    made: now,
    opensAt: now + days * DAY_MS,
    snap: snapshot(game),
    told: false,
  })
  saveCapsules(trim(list, now))
  if (input) input.value = ''
  counter()
  setText('capsule-status', t('capsuleSealed', { date: dateText(now + days * DAY_MS) }))
  renderCapsules(game, now)
}

// Keeps every locked one, plus the newest KEEP_MAX opened ones.
function trim(list, now) {
  const locked = list.filter((c) => !isOpen(c, now))
  const opened = list.filter((c) => isOpen(c, now)).sort((a, b) => b.opensAt - a.opensAt).slice(0, KEEP_MAX)
  return [...locked, ...opened]
}

// --- list ---

function changeLine(label, then, now) {
  const diff = now - then
  const sign = diff > 0 ? `+${fmt(diff)}` : diff < 0 ? `-${fmt(-diff)}` : '±0'
  return `<li><strong>${_escapeHtml(label)}</strong> ${_escapeHtml(fmt(then))} → ${_escapeHtml(fmt(now))} <span class="capsule-diff">(${_escapeHtml(sign)})</span></li>`
}

function rowHtml(c, game, now) {
  const del = `<button type="button" class="mini-action-btn" data-capsule-del="${_escapeHtml(c.id)}">${_escapeHtml(t('capsuleDelete'))}</button>`
  if (!isOpen(c, now)) {
    return `<div class="friend-mail-row capsule-row capsule-locked">
      <p class="friend-mail-line"><strong>${_escapeHtml(t('capsuleLockedTitle'))}</strong> · ${_escapeHtml(t('capsuleOpens', { when: timeLeftText(c.opensAt - now) }))}</p>
      <p class="friend-mail-note">${_escapeHtml(t('capsuleSealedOn', { date: dateText(c.made) }))}</p>
      <div class="friend-mail-buttons">${del}</div>
    </div>`
  }
  const cur = snapshot(game)
  return `<div class="friend-mail-row capsule-row capsule-open">
      <p class="friend-mail-note">${_escapeHtml(t('capsuleFromYou', { date: dateText(c.made) }))}</p>
      <p class="friend-mail-line capsule-text">${_escapeHtml(c.text)}</p>
      <p class="friend-mail-line"><strong>${_escapeHtml(t('capsuleThenNow'))}</strong></p>
      <ul class="capsule-stats">
        ${changeLine(t('capsuleStatLevel'), c.snap.level, cur.level)}
        ${changeLine(t('capsuleStatKills'), c.snap.kills, cur.kills)}
        ${changeLine(t('capsuleStatCoins'), c.snap.coins, cur.coins)}
      </ul>
      <div class="friend-mail-buttons">${del}</div>
    </div>`
}

export function renderCapsules(game, now = Date.now()) {
  bindTimeCapsule(game)
  renderCapsuleTexts()
  const list = $('capsule-list')
  if (!list) return
  const all = loadCapsules()
  // Opened ones first (newest opening on top), then locked by soonest.
  const opened = all.filter((c) => isOpen(c, now)).sort((a, b) => b.opensAt - a.opensAt)
  const locked = all.filter((c) => !isOpen(c, now)).sort((a, b) => a.opensAt - b.opensAt)
  const shown = [...opened, ...locked]
  list.innerHTML = shown.length
    ? shown.map((c) => rowHtml(c, game, now)).join('')
    : `<p class="friend-mail-empty">${_escapeHtml(t('capsuleNone'))}</p>`
  // Looking at the list counts as being told.
  if (opened.some((c) => !c.told)) {
    saveCapsules(all.map((c) => (isOpen(c, now) ? { ...c, told: true } : c)))
  }
}

// Two taps to delete: the first turns the button into "Sure?".
function onListClick(game, e) {
  const b = e.target.closest('[data-capsule-del]')
  if (!b) return
  if (b.dataset.sure !== '1') {
    b.dataset.sure = '1'
    b.textContent = t('capsuleDeleteSure')
    return
  }
  const id = b.dataset.capsuleDel
  saveCapsules(loadCapsules().filter((c) => c.id !== id))
  setText('capsule-status', '')
  renderCapsules(game)
}

// --- homepage toast ---

// Called once at homepage start. Returns how many just opened.
export function checkOpenedCapsules(game, now = Date.now()) {
  const all = loadCapsules()
  const fresh = all.filter((c) => isOpen(c, now) && !c.told)
  if (!fresh.length) return 0
  saveCapsules(all.map((c) => (fresh.includes(c) ? { ...c, told: true } : c)))
  const msg = fresh.length === 1 ? t('capsuleOpenedToast') : t('capsuleOpenedToastMany', { n: fresh.length })
  setTimeout(() => game._showHomepageToast?.(msg), 3000)
  return fresh.length
}

// --- binding + texts ---

function counter() {
  setText('capsule-count', `${$('capsule-input')?.value.length || 0}/${TEXT_MAX}`)
}

function syncCustom() {
  const row = $('capsule-custom-row')
  if (row) row.hidden = $('capsule-wait-select')?.value !== 'custom'
}

export function bindTimeCapsule(game) {
  if (game._timeCapsuleBound) return
  game._timeCapsuleBound = true
  const input = $('capsule-input')
  if (input) {
    input.maxLength = TEXT_MAX
    // Typing here must not move the player or trigger hotkeys.
    input.addEventListener('keydown', (e) => e.stopPropagation())
    input.addEventListener('input', counter)
  }
  const days = $('capsule-custom-days')
  if (days) {
    days.max = String(CUSTOM_DAYS_MAX)
    days.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') { e.preventDefault(); sealCapsule(game) }
    })
  }
  $('capsule-wait-select')?.addEventListener('change', syncCustom)
  $('capsule-seal-btn')?.addEventListener('click', () => sealCapsule(game))
  $('capsule-list')?.addEventListener('click', (e) => onListClick(game, e))
  $('profile-tab-capsule')?.addEventListener('click', () => renderCapsules(game))
}

export function renderCapsuleTexts() {
  setText('profile-tab-capsule', t('capsuleTab'))
  setText('capsule-hint', t('capsuleHint'))
  setText('capsule-wait-label', t('capsuleWaitLabel'))
  setText('capsule-custom-label', t('capsuleCustomLabel', { max: CUSTOM_DAYS_MAX }))
  setText('capsule-seal-btn', t('capsuleSeal'))
  setText('capsule-list-heading', t('capsuleListHeading'))
  const input = $('capsule-input')
  if (input) input.placeholder = t('capsulePlaceholder')
  const sel = $('capsule-wait-select')
  if (sel) {
    const keep = sel.value || '7'
    sel.innerHTML = [
      ...WAIT_CHOICES.map((w) => `<option value="${w.days}">${_escapeHtml(t(w.key))}</option>`),
      `<option value="custom">${_escapeHtml(t('capsuleWaitCustom'))}</option>`,
    ].join('')
    sel.value = keep
  }
  syncCustom()
  counter()
}
