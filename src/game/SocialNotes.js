// Social Notes (social six plan, Batch 3, 2026-11-20): Profile Guestbook +
// Message in a Bottle. Plan: docs/notes/social-six-plan.md.
//
// - Guestbook: every player's profile has one. Signed-in players can sign
//   someone else's (one line a day per guestbook). It loads only when you
//   press Open Guestbook (one small query). Your own is the Profile panel's
//   Guestbook tab, where you can delete any line.
// - Message in a Bottle (Friends panel): throw a note into the sea for a
//   random stranger, or fish one out. BOTTLES_PER_DAY of each a day. Found
//   bottles are kept on this device (KEPT_MAX, newest first).
//
// Gaymi's rules for both: the normal chat filter runs before sending
// (_censorText) and the viewer's Strict setting on show (shownChatText),
// TEXT_MAX letters, and a Report button - one report hides the message for
// everyone (`reported: true`; the rules only let anyone flip it on).
//
// Firestore (CloudSync's Social Notes functions and rules):
//   guestbook/{ownerUid}/entries/{writerUid_day}  (day = UTC days since 1970,
//     checked against the server clock, so one line a day per guestbook)
//   bottles/{uid_day_n}  (n = 1..BOTTLES_PER_DAY, so the throw cap is in the
//     rules; the find cap is this device only). rnd = a random 0..1 number
//     used to pick a random bottle with one small query.
import * as CloudSync from './CloudSync.js'
import { t } from './i18n.js'
import { _escapeHtml, _censorText } from './Game.js'
import { shownChatText } from './SocialSettings.js'

export const TEXT_MAX = 100
export const BOTTLES_PER_DAY = 3 // throws a day, and finds a day (a guess for "a few")
export const GUESTBOOK_SHOW = 10
export const GUESTBOOK_FETCH = 20 // a few extra, since reported lines are skipped
export const KEPT_MAX = 10
export const BOTTLE_KEY = 'gayz-bottles'
const DAY_MS = 24 * 60 * 60 * 1000
const UID_RE = /^[A-Za-z0-9]{6,128}$/

const $ = (id) => document.getElementById(id)

function api(game) {
  return game.__socialNotesBackendForTests || CloudSync
}

// UTC days since 1970 - the same number the rules work out from the server clock.
export function utcDay(now = Date.now()) {
  return Math.floor(now / DAY_MS)
}

function nick(game) {
  return String(game.settings?.nickname || 'Survivor').slice(0, 24) || 'Survivor'
}

// What gets sent: trimmed, capped, swear filter on.
export function cleanNote(text) {
  return _censorText(String(text || '').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX)).slice(0, TEXT_MAX)
}

function shown(m) {
  return m && typeof m.id === 'string' && m.reported !== true && typeof m.text === 'string' && m.text.length > 0
}

function rowHtml(game, m, buttons) {
  const name = String(m.fromNickname || '?').slice(0, 24)
  const text = shownChatText(game.settings, String(m.text || '').slice(0, TEXT_MAX))
  return `<div class="friend-mail-row social-note-row">
      <p class="friend-mail-line"><strong>${_escapeHtml(name)}</strong>: ${_escapeHtml(text)}</p>
      <div class="friend-mail-buttons">${buttons}</div>
    </div>`
}

function btn(act, id, label) {
  return `<button type="button" class="mini-action-btn" data-note-act="${act}" data-note-id="${_escapeHtml(id)}">${_escapeHtml(label)}</button>`
}

function setText(id, text) {
  const el = $(id)
  if (el) el.textContent = text
}

// --- binding ---

export function bindSocialNotes(game) {
  if (game._socialNotesBound) return
  game._socialNotesBound = true
  game._guestbook = []
  game._myGuestbook = []
  $('guestbook-open-btn')?.addEventListener('click', () => loadGuestbook(game))
  $('guestbook-sign-btn')?.addEventListener('click', () => signGuestbook(game))
  $('guestbook-list')?.addEventListener('click', (e) => onListClick(game, e, 'other'))
  $('my-guestbook-list')?.addEventListener('click', (e) => onListClick(game, e, 'mine'))
  $('profile-tab-guestbook')?.addEventListener('click', () => loadMyGuestbook(game))
  $('bottle-throw-btn')?.addEventListener('click', () => throwBottle(game))
  $('bottle-find-btn')?.addEventListener('click', () => findBottle(game))
  $('bottle-list')?.addEventListener('click', (e) => onListClick(game, e, 'bottle'))
  for (const id of ['guestbook-input', 'bottle-input']) {
    const el = $(id)
    if (!el) continue
    el.maxLength = TEXT_MAX
    // Typing here must not move the player or trigger hotkeys.
    el.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') { e.preventDefault(); (id === 'guestbook-input' ? signGuestbook : throwBottle)(game) }
    })
    el.addEventListener('input', () => counter(id))
  }
  renderSocialNotesTexts()
}

function counter(inputId) {
  const el = $(inputId)
  setText(`${inputId.replace('-input', '')}-count`, `${el?.value.length || 0}/${TEXT_MAX}`)
}

export function renderSocialNotesTexts() {
  setText('guestbook-heading', t('guestbookHeading'))
  setText('guestbook-open-btn', t('guestbookOpen'))
  setText('guestbook-sign-btn', t('guestbookSign'))
  setText('profile-tab-guestbook', t('guestbookHeading'))
  setText('my-guestbook-hint', t('guestbookMineHint'))
  setText('bottle-heading', t('bottleHeading'))
  setText('bottle-hint', t('bottleHint', { n: BOTTLES_PER_DAY }))
  setText('bottle-throw-btn', t('bottleThrow'))
  setText('bottle-find-btn', t('bottleFind'))
  setText('bottle-kept-heading', t('bottleKeptHeading'))
  const gb = $('guestbook-input')
  if (gb) gb.placeholder = t('guestbookPlaceholder', { n: TEXT_MAX })
  const bt = $('bottle-input')
  if (bt) bt.placeholder = t('bottlePlaceholder', { n: TEXT_MAX })
  counter('guestbook-input')
  counter('bottle-input')
}

async function onListClick(game, e, where) {
  const b = e.target.closest('[data-note-act]')
  if (!b || b.disabled) return
  const id = b.dataset.noteId
  const act = b.dataset.noteAct
  b.disabled = true
  try {
    if (where === 'bottle') {
      if (act === 'report') await reportBottle(game, id)
      else if (act === 'dismiss') dropKept(id)
      renderBottles(game)
    } else if (act === 'report') {
      await reportEntry(game, where, id)
    } else if (act === 'delete') {
      await deleteEntry(game, where, id)
    }
  } finally {
    b.disabled = false
  }
}

// --- Guestbook on someone else's profile (FriendsUI._renderOtherProfileEntry) ---

// uid null = still loading / no entry: box hidden.
export function showGuestbook(game, uid) {
  bindSocialNotes(game)
  renderSocialNotesTexts()
  const box = $('guestbook-box')
  const ok = typeof uid === 'string' && UID_RE.test(uid) && uid !== game._cloudUid
  game._guestbookOwner = ok ? uid : null
  game._guestbook = []
  if (box) box.hidden = !ok
  const body = $('guestbook-body')
  if (body) body.hidden = true
  const open = $('guestbook-open-btn')
  if (open) open.hidden = false
  const input = $('guestbook-input')
  if (input) input.value = ''
  counter('guestbook-input')
  setText('guestbook-status', '')
}

export async function loadGuestbook(game) {
  const owner = game._guestbookOwner
  if (!owner) return
  const body = $('guestbook-body')
  if (body) body.hidden = false
  const open = $('guestbook-open-btn')
  if (open) open.hidden = true
  const write = $('guestbook-write')
  if (write) write.hidden = !game._cloudUid
  const list = $('guestbook-list')
  if (!game._cloudUid) {
    if (list) list.innerHTML = `<p class="friend-mail-empty">${_escapeHtml(t('guestbookSignIn'))}</p>`
    return
  }
  if (list) list.innerHTML = `<p class="friend-mail-empty">${_escapeHtml(t('friendMailLoading'))}</p>`
  let entries
  try {
    entries = await api(game).fetchGuestbook(owner, GUESTBOOK_FETCH)
  } catch {
    entries = null
  }
  if (game._guestbookOwner !== owner) return // another profile opened meanwhile
  if (!entries) {
    if (list) list.innerHTML = `<p class="friend-mail-empty">${_escapeHtml(t('friendMailLoadFailed'))}</p>`
    return
  }
  game._guestbook = entries.filter(shown).slice(0, GUESTBOOK_SHOW)
  renderGuestbook(game, 'other')
}

function renderGuestbook(game, where) {
  const list = $(where === 'mine' ? 'my-guestbook-list' : 'guestbook-list')
  if (!list) return
  const entries = where === 'mine' ? game._myGuestbook : game._guestbook
  if (!entries.length) {
    list.innerHTML = `<p class="friend-mail-empty">${_escapeHtml(t(where === 'mine' ? 'guestbookMineEmpty' : 'guestbookEmpty'))}</p>`
    return
  }
  list.innerHTML = entries.map((m) => {
    const mineLine = m.fromUid === game._cloudUid
    const buttons = [
      mineLine ? '' : btn('report', m.id, t('noteReport')),
      where === 'mine' || mineLine ? btn('delete', m.id, t('noteDelete')) : '',
    ].join('')
    return rowHtml(game, m, buttons)
  }).join('')
}

async function signGuestbook(game) {
  const owner = game._guestbookOwner
  if (!owner || !game._cloudUid) return
  const text = cleanNote($('guestbook-input')?.value)
  if (!text) return setText('guestbook-status', t('noteEmpty'))
  const b = $('guestbook-sign-btn')
  if (b) b.disabled = true
  setText('guestbook-status', t('friendMailSending'))
  const day = utcDay()
  const entry = { fromUid: game._cloudUid, fromNickname: nick(game), text, day }
  try {
    await api(game).signGuestbook(owner, entry)
  } catch {
    setText('guestbook-status', t('guestbookFailed'))
    return
  } finally {
    if (b) b.disabled = false
  }
  const input = $('guestbook-input')
  if (input) input.value = ''
  counter('guestbook-input')
  setText('guestbook-status', t('guestbookSigned'))
  const id = `${game._cloudUid}_${day}`
  game._guestbook = [{ ...entry, id, reported: false, sentAt: Date.now() }, ...game._guestbook.filter((m) => m.id !== id)].slice(0, GUESTBOOK_SHOW)
  renderGuestbook(game, 'other')
}

// --- Your own Guestbook (Profile panel > Guestbook tab) ---

export async function loadMyGuestbook(game) {
  bindSocialNotes(game)
  renderSocialNotesTexts()
  const list = $('my-guestbook-list')
  if (!list) return
  if (!game._cloudUid) {
    list.innerHTML = `<p class="friend-mail-empty">${_escapeHtml(t('guestbookSignIn'))}</p>`
    return
  }
  list.innerHTML = `<p class="friend-mail-empty">${_escapeHtml(t('friendMailLoading'))}</p>`
  let entries
  try {
    entries = await api(game).fetchGuestbook(game._cloudUid, GUESTBOOK_FETCH)
  } catch {
    entries = null
  }
  if (!entries) {
    list.innerHTML = `<p class="friend-mail-empty">${_escapeHtml(t('friendMailLoadFailed'))}</p>`
    return
  }
  game._myGuestbook = entries.filter(shown).slice(0, GUESTBOOK_SHOW)
  renderGuestbook(game, 'mine')
}

async function reportEntry(game, where, id) {
  const owner = where === 'mine' ? game._cloudUid : game._guestbookOwner
  if (!owner || !game._cloudUid) return
  try {
    await api(game).reportGuestbookEntry(owner, id)
  } catch {
    game._showHomepageToast?.(t('friendMailLoadFailed'))
    return
  }
  if (where === 'mine') game._myGuestbook = game._myGuestbook.filter((m) => m.id !== id)
  else game._guestbook = game._guestbook.filter((m) => m.id !== id)
  renderGuestbook(game, where)
  game._showHomepageToast?.(t('noteReported'))
}

async function deleteEntry(game, where, id) {
  const owner = where === 'mine' ? game._cloudUid : game._guestbookOwner
  if (!owner || !game._cloudUid) return
  try {
    await api(game).deleteGuestbookEntry(owner, id)
  } catch {
    game._showHomepageToast?.(t('friendMailLoadFailed'))
    return
  }
  if (where === 'mine') game._myGuestbook = game._myGuestbook.filter((m) => m.id !== id)
  else game._guestbook = game._guestbook.filter((m) => m.id !== id)
  renderGuestbook(game, where)
}

// --- Message in a Bottle (Friends panel) ---

// { day, thrown, found, seen: [ids], kept: [{ id, fromNickname, text }] }
export function loadBottleState(now = Date.now()) {
  let s = {}
  try {
    const raw = JSON.parse(localStorage.getItem(BOTTLE_KEY) || '{}')
    if (raw && typeof raw === 'object') s = raw
  } catch { s = {} }
  const day = utcDay(now)
  const sameDay = s.day === day
  return {
    day,
    thrown: sameDay ? Math.max(0, Math.floor(Number(s.thrown) || 0)) : 0,
    found: sameDay ? Math.max(0, Math.floor(Number(s.found) || 0)) : 0,
    seen: Array.isArray(s.seen) ? s.seen.filter((x) => typeof x === 'string').slice(-200) : [],
    kept: Array.isArray(s.kept) ? s.kept.filter((m) => m && typeof m.id === 'string' && typeof m.text === 'string').slice(0, KEPT_MAX) : [],
  }
}

function saveBottleState(s) {
  try { localStorage.setItem(BOTTLE_KEY, JSON.stringify(s)) } catch { /* storage full or blocked */ }
}

function dropKept(id) {
  const s = loadBottleState()
  s.kept = s.kept.filter((m) => m.id !== id)
  saveBottleState(s)
}

export function renderBottles(game) {
  bindSocialNotes(game)
  renderSocialNotesTexts()
  const s = loadBottleState()
  setText('bottle-left', t('bottleLeft', { thrown: Math.max(0, BOTTLES_PER_DAY - s.thrown), found: Math.max(0, BOTTLES_PER_DAY - s.found) }))
  const list = $('bottle-list')
  if (!list) return
  if (!s.kept.length) {
    list.innerHTML = `<p class="friend-mail-empty">${_escapeHtml(t('bottleNone'))}</p>`
    return
  }
  list.innerHTML = s.kept.map((m) => rowHtml(game, m, btn('report', m.id, t('noteReport')) + btn('dismiss', m.id, t('bottleDismiss')))).join('')
}

async function throwBottle(game) {
  if (!game._cloudUid) return
  const s = loadBottleState()
  if (s.thrown >= BOTTLES_PER_DAY) return setText('bottle-status', t('bottleThrowLimit', { n: BOTTLES_PER_DAY }))
  const text = cleanNote($('bottle-input')?.value)
  if (!text) return setText('bottle-status', t('noteEmpty'))
  const b = $('bottle-throw-btn')
  if (b) b.disabled = true
  setText('bottle-status', t('friendMailSending'))
  // Slots 1..3 for today; one may already be used on another device.
  let sent = 0
  try {
    for (let n = s.thrown + 1; n <= BOTTLES_PER_DAY && !sent; n++) {
      try {
        await api(game).throwBottle({ fromUid: game._cloudUid, fromNickname: nick(game), text, day: s.day, n, rnd: Math.random() })
        sent = n
      } catch { /* that slot is taken (or offline) - try the next */ }
    }
  } finally {
    if (b) b.disabled = false
  }
  const after = loadBottleState()
  if (!sent) {
    setText('bottle-status', t('bottleThrowFailed', { n: BOTTLES_PER_DAY }))
    return
  }
  after.thrown = Math.max(after.thrown, sent)
  saveBottleState(after)
  const input = $('bottle-input')
  if (input) input.value = ''
  setText('bottle-status', t('bottleThrown'))
  renderBottles(game)
}

async function findBottle(game) {
  if (!game._cloudUid) return
  const s = loadBottleState()
  if (s.found >= BOTTLES_PER_DAY) return setText('bottle-status', t('bottleFindLimit', { n: BOTTLES_PER_DAY }))
  const b = $('bottle-find-btn')
  if (b) b.disabled = true
  setText('bottle-status', t('bottleSearching'))
  const usable = (m) => shown(m) && m.fromUid !== game._cloudUid && !s.seen.includes(m.id)
  let got = null
  try {
    const r = Math.random()
    let batch = await api(game).fetchBottles(r, 5)
    got = (batch || []).find(usable) || null
    if (!got && r > 0) {
      batch = await api(game).fetchBottles(0, 5) // wrap round to the start
      got = (batch || []).find(usable) || null
    }
  } catch {
    setText('bottle-status', t('friendMailLoadFailed'))
    return
  } finally {
    if (b) b.disabled = false
  }
  if (!got) {
    setText('bottle-status', t('bottleEmptySea'))
    return
  }
  const after = loadBottleState()
  after.found += 1
  after.seen = [...after.seen, got.id].slice(-200)
  after.kept = [{ id: got.id, fromNickname: String(got.fromNickname || '?').slice(0, 24), text: String(got.text).slice(0, TEXT_MAX) }, ...after.kept.filter((m) => m.id !== got.id)].slice(0, KEPT_MAX)
  saveBottleState(after)
  setText('bottle-status', t('bottleFound'))
  renderBottles(game)
}

async function reportBottle(game, id) {
  if (!game._cloudUid) return
  try {
    await api(game).reportBottle(id)
  } catch {
    game._showHomepageToast?.(t('friendMailLoadFailed'))
    return
  }
  dropKept(id)
  game._showHomepageToast?.(t('noteReported'))
}
