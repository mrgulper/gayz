// Pet trading with friends (pet battles round 4, Batch N, 2026-11-24).
// Plan: docs/notes/team-battle-batches.md.
//
// Gaymi's answers: a live trade window (both online), up to TRADE_MAX pets
// each side and one side may give nothing (a gift), a pet keeps everything
// (level, shiny, held item, nickname - its snack stays behind), no limits,
// and a pet you get by trade fills its Collection book page.
//
// How it works: a Trade Pets button on a friend's profile, or the Pets
// tab's "Trade with a Friend" list of online friends, sends an invite
// (Firestore petTrades/{id}, CloudSync's Pet trading functions + rules).
// The friend has INVITE_S seconds to say yes. Then the same window opens
// on both screens: each taps up to 3 of their pets, sees the other's
// offer live, presses Ready, then Confirm. Any change to either offer
// makes both press Ready again (the trade's v goes up), so nobody can
// swap a pet out at the last second. The second Confirm closes the deal;
// each screen then collects its side once (claimPetTrade), so two
// devices can't both collect. A finished trade that wasn't collected
// (the app closed) is collected at the next sign-in (checkMyPetTrades).
//
// Pets live in each player's own save, same trust as Skin Trades: a
// friend's pets are checked again (cleanCreature) before they're kept.
import * as CloudSync from './CloudSync.js'
import { loadCreatures, saveCreatures, cleanCreature, swapCreatures, creatureName, MAX_CREATURES } from './Creatures.js'
import { updateBook } from './PetBook.js'
import { listOnlineFriends } from './FriendBattle.js'
import { t } from './i18n.js'

export const TRADE_MAX = 3
export const INVITE_S = 60
// Unfinished trades older than this are tidied away at sign-in.
const STALE_MS = 60 * 60 * 1000

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const $ = (id) => document.getElementById(id)
const api = (game) => game.__petTradeBackendForTests || CloudSync
const toast = (game, text) => game._showHomepageToast?.(text)
const other = (side) => (side === 'a' ? 'b' : 'a')
// The card drawing is TeamUI's (handed over in bindPetTrade).
let drawCard = () => ''

function nick(game) {
  return (game.settings?.nickname || '').trim().slice(0, 24) || t('teamDefaultNick')
}

function friendOf(game, uid) {
  return (game.settings?.savedFriends || []).find((f) => f.uid && f.uid === uid) || null
}

function friendName(game, uid, fallback = '') {
  return String(friendOf(game, uid)?.name || fallback || '?').slice(0, 24)
}

// One of my pets as offered: everything it is, minus the snack, plus my
// own id for it (so my screen knows which ones leave).
export function packTradePet(c) {
  const clean = cleanCreature(c)
  if (!clean) return null
  delete clean.sn
  return { ...clean, id: c.id }
}

// An offer from the trade, checked again (the friend's is never trusted).
export function unpackOffer(list) {
  if (!Array.isArray(list)) return []
  return list.slice(0, TRADE_MAX).map((p) => {
    const c = cleanCreature(p)
    if (!c) return null
    delete c.sn
    return c
  }).filter(Boolean)
}

// Invites and the trade window only show on the homepage and menus.
export function canShowTrade(game) {
  return !game.buildMode?.active && !game._enteringBuildMode && !game._teamBattle?.root && !game._petDuel && !game._petTrade
}

// --- the small box (my invite waiting, or an invite to me) ---

function box() {
  let el = $('pet-trade-box')
  if (el) return el
  el = document.createElement('div')
  el.id = 'pet-trade-box'
  el.className = 'panel-box pet-duel-box'
  el.setAttribute('role', 'dialog')
  el.innerHTML = `
    <p class="pet-duel-text"></p>
    <p class="pet-duel-time"></p>
    <div class="pet-duel-btns">
      <button type="button" class="mini-action-btn pet-duel-yes"></button>
      <button type="button" class="mini-action-btn pet-duel-no"></button>
    </div>`
  el.addEventListener('keydown', (e) => e.stopPropagation())
  document.body.appendChild(el)
  return el
}

function showBox({ text, yes, no, onYes, onNo }) {
  const el = box()
  el.querySelector('.pet-duel-text').textContent = text
  el.querySelector('.pet-duel-time').textContent = ''
  const y = el.querySelector('.pet-duel-yes')
  const n = el.querySelector('.pet-duel-no')
  y.hidden = !yes
  y.textContent = yes || ''
  y.onclick = onYes || null
  n.textContent = no
  n.onclick = onNo || null
  el.hidden = false
}

function setBoxTime(text) {
  const el = $('pet-trade-box')
  if (el) el.querySelector('.pet-duel-time').textContent = text
}

function hideBox() {
  const el = $('pet-trade-box')
  if (el) el.hidden = true
}

// --- the trade window ---

function win() {
  let el = $('pet-trade')
  if (el) return el
  el = document.createElement('div')
  el.id = 'pet-trade'
  el.className = 'panel-box pet-trade'
  el.setAttribute('role', 'dialog')
  el.hidden = true
  el.innerHTML = `
    <h3 class="pet-trade-title"></h3>
    <div class="pet-trade-sides">
      <div class="pet-trade-side"><h4 class="pet-trade-mine-title"></h4><div class="pet-trade-mine team-cards"></div></div>
      <div class="pet-trade-side"><h4 class="pet-trade-theirs-title"></h4><div class="pet-trade-theirs team-cards"></div></div>
    </div>
    <p class="pet-trade-status"></p>
    <div class="pet-trade-btns">
      <button type="button" class="mini-action-btn pet-trade-ready"></button>
      <button type="button" class="mini-action-btn pet-trade-confirm"></button>
      <button type="button" class="mini-action-btn pet-trade-cancel"></button>
    </div>
    <h4 class="pet-trade-pick-title"></h4>
    <div class="pet-trade-pick team-cards"></div>`
  el.addEventListener('keydown', (e) => e.stopPropagation())
  document.body.appendChild(el)
  return el
}

function closeWindow() {
  const el = $('pet-trade')
  if (el) el.hidden = true
}

// What the window says (pure, for the tests): s = my side, d = the trade.
export function tradeStatus(d, s, name, { offer = [], room = true, changed = false } = {}) {
  const o = other(s)
  const meReady = d[`r${s}`] === d.v
  const themReady = d[`r${o}`] === d.v
  const theirs = Array.isArray(d[o]) ? d[o].length : 0
  if (!room) return t('petTradeNoRoom', { n: MAX_CREATURES })
  if (d[`c${s}`] === d.v && meReady && themReady) return t('petTradeWaitConfirm', { name })
  if (meReady && themReady) return d[`c${o}`] === d.v ? t('petTradeTheyConfirmed', { name }) : t('petTradeBothReady')
  if (meReady) return t('petTradeWaitReady', { name })
  if (changed) return t('petTradeChanged')
  if (themReady) return t('petTradeTheyReady', { name })
  if (!offer.length && !theirs) return t('petTradeHow', { n: TRADE_MAX })
  return t('petTradePressReady')
}

function renderWindow(game) {
  const st = game._petTrade
  const d = st?.doc
  if (!st || !d || st.phase !== 'open') return
  const el = win()
  const s = st.side
  const o = other(s)
  const data = loadCreatures()
  const mine = st.offer.map((id) => data.list.find((c) => c.id === id)).filter(Boolean)
  const theirs = unpackOffer(d[o])
  const room = data.list.length - mine.length + theirs.length <= MAX_CREATURES
  // My Ready counted on an older offer: say it changed.
  const changed = st.readyV >= 0 && d[`r${s}`] !== d.v
  const meReady = d[`r${s}`] === d.v
  const bothReady = meReady && d[`r${o}`] === d.v
  el.querySelector('.pet-trade-title').textContent = t('petTradeTitle', { name: st.name })
  el.querySelector('.pet-trade-mine-title').textContent = t('petTradeYouGive', { n: mine.length, max: TRADE_MAX })
  el.querySelector('.pet-trade-theirs-title').textContent = t('petTradeTheyGive', { name: st.name, n: theirs.length })
  el.querySelector('.pet-trade-mine').innerHTML = mine.length
    ? mine.map((c, i) => drawCard(c, i + 1)).join('')
    : `<p class="team-snack-hint">${esc(t('petTradeNothing'))}</p>`
  el.querySelector('.pet-trade-theirs').innerHTML = theirs.length
    ? theirs.map((c, i) => drawCard({ ...c, id: -1 - i }, 0)).join('')
    : `<p class="team-snack-hint">${esc(t('petTradeNothing'))}</p>`
  el.querySelector('.pet-trade-status').textContent = tradeStatus(d, s, st.name, { offer: mine, room, changed })
  const ready = el.querySelector('.pet-trade-ready')
  ready.textContent = t('petTradeReady')
  ready.hidden = meReady
  ready.disabled = st.busy || !room || (!mine.length && !theirs.length)
  const confirm = el.querySelector('.pet-trade-confirm')
  confirm.textContent = t('petTradeConfirm')
  confirm.hidden = !bothReady || d[`c${s}`] === d.v
  confirm.disabled = st.busy || !room
  el.querySelector('.pet-trade-cancel').textContent = t('petTradeCancel')
  el.querySelector('.pet-trade-pick-title').textContent = t('petTradePickTitle', { n: TRADE_MAX })
  el.querySelector('.pet-trade-pick').innerHTML = data.list.length
    ? [...data.list].reverse().map((c) => drawCard(c, st.offer.indexOf(c.id) + 1)).join('')
    : `<p class="team-snack-hint">${esc(t('petTradeNoPets'))}</p>`
  el.hidden = false
}

// Tap a pet: in my offer, or out of it.
async function togglePet(game, id) {
  const st = game._petTrade
  if (!st || st.phase !== 'open' || st.busy) return
  const offer = st.offer.includes(id) ? st.offer.filter((x) => x !== id) : st.offer.concat(id)
  if (offer.length > TRADE_MAX) return toast(game, t('petTradeMax', { n: TRADE_MAX }))
  const data = loadCreatures()
  const list = offer.map((x) => data.list.find((c) => c.id === x)).filter(Boolean).map(packTradePet).filter(Boolean)
  st.busy = true
  renderWindow(game)
  let v = null
  try {
    v = await api(game).setPetTradeOffer(st.id, st.side, list)
  } catch { /* gone */ }
  st.busy = false
  if (game._petTrade !== st) return
  if (v === null) return toast(game, t('petTradeFailed'))
  st.offer = list.map((p) => p.id)
  if (st.doc) st.doc = { ...st.doc, [st.side]: list, v }
  renderWindow(game)
}

async function pressReady(game) {
  const st = game._petTrade
  if (!st || st.busy || !st.doc) return
  const v = st.doc.v
  st.busy = true
  let ok = false
  try {
    ok = await api(game).readyPetTrade(st.id, st.side, v)
  } catch { /* gone */ }
  st.busy = false
  if (game._petTrade !== st) return
  if (ok) {
    st.readyV = v
    st.doc = { ...st.doc, [`r${st.side}`]: v }
  }
  renderWindow(game)
}

async function pressConfirm(game) {
  const st = game._petTrade
  if (!st || st.busy || !st.doc) return
  const v = st.doc.v
  st.busy = true
  let res = null
  try {
    res = await api(game).confirmPetTrade(st.id, st.side, v)
  } catch { /* gone */ }
  st.busy = false
  if (game._petTrade !== st) return
  if (res === 'done') return collect(game, st)
  if (res === 'ok') st.doc = { ...st.doc, [`c${st.side}`]: v }
  renderWindow(game)
}

// Closes everything for this trade. del: also delete it (a cancel).
function end(game, st, msg, del = false) {
  if (st.closed) return
  st.closed = true
  st.unwatch?.()
  clearInterval(st.timer)
  if (del && st.id) api(game).deletePetTrade(st.id).catch(() => {})
  hideBox()
  closeWindow()
  if (game._petTrade === st) game._petTrade = null
  if (msg) toast(game, msg)
}

// The trade is done: my side, once.
async function collect(game, st) {
  if (st.collecting) return
  st.collecting = true
  const got = await claimAndApply(game, st.id, st.side)
  end(game, st, got ? null : t('petTradeDoneElsewhere'))
}

// Collects my side of a finished trade and swaps the pets in my save.
// Returns the pets I got (maybe none: a gift I gave), or null.
export async function claimAndApply(game, id, side) {
  let d = null
  try {
    d = await api(game).claimPetTrade(id, side)
  } catch { /* gone */ }
  if (!d) return null
  const data = loadCreatures()
  const gave = (Array.isArray(d[side]) ? d[side] : []).map((p) => p && p.id).filter(Number.isInteger)
  const got = swapCreatures(data, gave, d[other(side)])
  saveCreatures(data)
  // New kinds can reach a Collection book milestone (pays its coins).
  updateBook(game)
  game._renderTeamPanel?.()
  game._refreshHomePet?.()
  const name = friendName(game, side === 'a' ? d.to : d.from, side === 'b' ? d.fromName : '')
  toast(game, got.length
    ? t('petTradeDone', { name, list: got.map((c) => creatureName(c)).join(', ') })
    : t('petTradeGiftDone', { name, n: gave.length }))
  return got
}

function onDoc(game, st, d) {
  if (st.closed || st.collecting) return
  if (!d) return end(game, st, st.phase === 'open' ? t('petTradeClosed', { name: st.name }) : t('petTradeGone', { name: st.name }))
  if (d.state === 'no') return end(game, st, t('petTradeSaidNo', { name: st.name }), true)
  if (d.state === 'done') {
    st.doc = d
    return collect(game, st)
  }
  if (d.state !== 'open') return
  if (st.phase !== 'open') {
    st.phase = 'open'
    clearInterval(st.timer)
    hideBox()
  }
  // My offer as the trade has it (another write of mine may still be on
  // its way - then my own wins).
  if (!st.busy) st.offer = (Array.isArray(d[st.side]) ? d[st.side] : []).map((p) => p && p.id).filter(Number.isInteger)
  st.doc = d
  renderWindow(game)
}

function newState(game, { id = null, side, friend, name, phase }) {
  const st = { id, side, friend, name, phase, offer: [], doc: null, readyV: -1, busy: false, closed: false, collecting: false, unwatch: null, timer: null }
  game._petTrade = st
  return st
}

// --- asking a friend (profile button, Pets tab list) ---

export async function inviteTrade(game, uid) {
  if (game._petTrade || game._petDuel) return toast(game, t('petTradeBusy'))
  if (!game._cloudUid) return toast(game, t('petTradeSignIn'))
  if (!uid || !friendOf(game, uid)) return
  const name = friendName(game, uid)
  const st = newState(game, { side: 'a', friend: uid, name, phase: 'wait' })
  showBox({ text: t('petTradeSending', { name }), no: t('petTradeCancel'), onNo: () => end(game, st, null, true) })
  let id
  try {
    id = await api(game).createPetTrade(game._cloudUid, nick(game), uid)
  } catch {
    end(game, st, t('petTradeFailed'))
    return
  }
  st.id = id
  if (st.closed) {
    // Cancelled while it was being sent.
    api(game).deletePetTrade(id).catch(() => {})
    return
  }
  const until = Date.now() + INVITE_S * 1000
  showBox({ text: t('petTradeWaiting', { name }), no: t('petTradeCancel'), onNo: () => end(game, st, null, true) })
  const tick = () => {
    if (st.phase !== 'wait') return
    const left = Math.ceil((until - Date.now()) / 1000)
    if (left <= 0) end(game, st, t('petTradeNoAnswer', { name }), true)
    else setBoxTime(t('petDuelSeconds', { n: left }))
  }
  tick()
  st.timer = setInterval(tick, 1000)
  st.unwatch = api(game).watchPetTrade(id, (d) => onDoc(game, st, d))
}

// --- invites to me ---

// Started on every sign-in change (CloudSaveUI), like friend battles.
export function watchPetTrades(game, uid) {
  game._petTradeInvitesUnsub?.()
  game._petTradeInvitesUnsub = null
  clearInterval(game._petTradeTick)
  game._tradeInvites = []
  game._tradeInviteShown = null
  if (!uid) return
  if (!game.__petTradeBackendForTests && !CloudSync.isConfigured?.()) return
  const backend = api(game)
  checkMyPetTrades(game).catch(() => {})
  game._petTradeInvitesUnsub = backend.subscribePetTradeInvites(uid, (list) => {
    const now = Date.now()
    const seen = new Map((game._tradeInvites || []).map((d) => [d.id, d.seen]))
    const fresh = []
    for (const d of list || []) {
      if (!d || typeof d.id !== 'string') continue
      if (!(d.at > now - STALE_MS)) {
        backend.deletePetTrade(d.id).catch(() => {})
        continue
      }
      if (!friendOf(game, d.from)) continue
      fresh.push({ ...d, seen: seen.get(d.id) || now })
    }
    game._tradeInvites = fresh
    tradeInviteTick(game)
  })
  game._petTradeTick = setInterval(() => tradeInviteTick(game), 1000)
}

export function tradeInviteTick(game, now = Date.now()) {
  game._tradeInvites = (game._tradeInvites || []).filter((d) => now - d.seen < INVITE_S * 1000)
  const shown = game._tradeInviteShown
  if (shown) {
    const still = game._tradeInvites.find((d) => d.id === shown.id)
    if (!still) {
      game._tradeInviteShown = null
      if (!game._petTrade) hideBox()
      return
    }
    setBoxTime(t('petDuelSeconds', { n: Math.max(1, Math.ceil((still.seen + INVITE_S * 1000 - now) / 1000)) }))
    return
  }
  const next = game._tradeInvites[0]
  if (!next || !canShowTrade(game) || game._petInviteShown) return
  game._tradeInviteShown = next
  const name = friendName(game, next.from, next.fromName)
  showBox({
    text: t('petTradeInvite', { name }),
    yes: t('petTradeYes'),
    no: t('petTradeNo'),
    onYes: () => answerInvite(game, next, true),
    onNo: () => answerInvite(game, next, false),
  })
  tradeInviteTick(game, now)
}

async function answerInvite(game, d, yes) {
  game._tradeInviteShown = null
  game._tradeInvites = (game._tradeInvites || []).filter((o) => o.id !== d.id)
  hideBox()
  const backend = api(game)
  if (!yes || game._petTrade || game._petDuel) {
    backend.answerPetTrade(d.id, false).catch(() => {})
    return
  }
  const name = friendName(game, d.from, d.fromName)
  const st = newState(game, { id: d.id, side: 'b', friend: d.from, name, phase: 'wait' })
  let was = null
  try {
    was = await backend.answerPetTrade(d.id, true)
  } catch { /* gone */ }
  if (!was) return end(game, st, t('petTradeGone', { name }))
  onDoc(game, st, was)
  st.unwatch = backend.watchPetTrade(d.id, (doc) => onDoc(game, st, doc))
}

// At sign-in: collect finished trades I didn't collect (the app closed
// first), and tidy away old unfinished ones.
export async function checkMyPetTrades(game) {
  const uid = game._cloudUid
  if (!uid) return
  const backend = api(game)
  const list = await backend.fetchMyPetTrades(uid)
  const now = Date.now()
  for (const d of list || []) {
    if (!d || typeof d.id !== 'string' || d.id === game._petTrade?.id) continue
    const side = d.from === uid ? 'a' : 'b'
    if (d.state === 'done') {
      if (!d[`g${side}`]) await claimAndApply(game, d.id, side)
    } else if (d.state === 'no' || !(d.at > now - STALE_MS)) {
      backend.deletePetTrade(d.id).catch(() => {})
    }
  }
}

// --- Pets tab: Trade with a Friend ---

export function renderPetTrade() {
  const btn = $('pet-trade-btn')
  if (btn) btn.textContent = t('petTradeListBtn')
}

export async function showTradeFriends(game) {
  const list = $('pet-trade-list')
  if (!list) return
  if (!game._cloudUid) {
    list.innerHTML = `<p class="team-snack-hint">${esc(t('petTradeSignIn'))}</p>`
    return
  }
  list.innerHTML = `<p class="team-snack-hint">${esc(t('petDuelLooking'))}</p>`
  const { friends, online } = await listOnlineFriends(game, api(game))
  list.innerHTML = online.length
    ? online.map((f) => `<div class="friend-battle-row"><span>${esc(String(f.name).slice(0, 24))}</span><button type="button" class="mini-action-btn" data-trade-uid="${esc(f.uid)}">${esc(t('petTradeBtn'))}</button></div>`).join('')
    : `<p class="team-snack-hint">${esc(t(friends.length ? 'petDuelNoneOnline' : 'petTradeNoFriends'))}</p>`
}

export function bindPetTrade(game, { card } = {}) {
  if (game._petTradeBound) return
  game._petTradeBound = true
  if (card) drawCard = card
  // The friend's profile button (FriendMail.js) calls this.
  game._tradePetFriend = (uid) => inviteTrade(game, uid)
  // For the tests (tests/team.spec.js).
  game._petTradeApi = { inviteTrade, watchPetTrades, tradeInviteTick, checkMyPetTrades, claimAndApply, packTradePet, unpackOffer, tradeStatus, canShowTrade, TRADE_MAX, INVITE_S }
  $('pet-trade-btn')?.addEventListener('click', () => showTradeFriends(game))
  $('pet-trade-list')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-trade-uid]')
    if (b) inviteTrade(game, b.dataset.tradeUid)
  })
  const el = win()
  el.addEventListener('click', (e) => {
    if (e.target.closest('.pet-trade-ready')) return pressReady(game)
    if (e.target.closest('.pet-trade-confirm')) return pressConfirm(game)
    if (e.target.closest('.pet-trade-cancel')) {
      const st = game._petTrade
      if (st) end(game, st, null, true)
      return
    }
    const c = e.target.closest('.pet-trade-pick .team-card[data-id], .pet-trade-mine .team-card[data-id]')
    if (c) togglePet(game, Number(c.dataset.id))
  })
}
