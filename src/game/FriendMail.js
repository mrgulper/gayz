// Friend Mail (social six plan, Batch 1, 2026-11-20): Gift Box + Friend
// Challenges. Plan: docs/notes/social-six-plan.md.
//
// - Gift Box: on a friend's profile, Send Gift sends up to GIFT_MAX_COINS
//   coins and/or up to GIFT_MAX_ITEMS of one spin-ring item from your bag
//   (Gaymi picked "coins + items"). They come off your wallet/bag only once
//   the send worked. The friend opens it from Friends > Gifts & Challenges.
// - Friend Challenges: on a friend's profile, Challenge sends "survive N
//   waves" or "get N zombie kills" in one game (N starts at your own best
//   + 1). The friend Accepts it; it then sits in Your Challenges for
//   CHALLENGE_DAYS days, and the first finished game that reaches N pays
//   CHALLENGE_COINS coins (ProgressUI's end-of-game code calls
//   checkFriendChallenges).
//
// Firestore: friendMail/{toUid}/inbox/{kind_sender_day} (CloudSync's Friend
// Mail functions and rules). One inbox for both kinds, read only when the
// Friends panel opens (one small query, limit MAX_MAIL). A gift is credited
// only after its doc is deleted, so the same gift can't be opened twice on
// two devices. Accepted challenges live in localStorage (ACTIVE_KEY, a
// gayz-* key, so Cloud Save carries it).
//
// Everything a friend wrote is escaped and run through the viewer's chat
// filter setting (shownChatText), same as postcards.
import * as CloudSync from './CloudSync.js'
import { t } from './i18n.js'
import { _escapeHtml, _censorText } from './Game.js'
import { shownChatText } from './SocialSettings.js'
import { parseKey, loadBag, saveBag, ownedList, loadLoadout, fitLoadout, saveLoadout, RING_ITEMS, rarityNameKey } from './RingItems.js'

export const GIFT_MAX_COINS = 500
export const GIFT_MAX_ITEMS = 5
export const CHALLENGE_COINS = 150 // a guess
export const CHALLENGE_DAYS = 7
export const MAX_ACTIVE = 5
export const MAX_MAIL = 20
export const NOTE_MAX = 80
export const ACTIVE_KEY = 'gayz-friend-challenges'
const DAY_MS = 24 * 60 * 60 * 1000
const UID_RE = /^[A-Za-z0-9]{6,128}$/

const $ = (id) => document.getElementById(id)

function api(game) {
  return game.__friendMailBackendForTests || CloudSync
}

// Local date as YYYY-MM-DD (the "one per friend per day" part of the id).
export function dayKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function nick(game) {
  return String(game.settings?.nickname || 'Survivor').slice(0, 24) || 'Survivor'
}

function isFriend(game, uid) {
  return typeof uid === 'string' && UID_RE.test(uid) && uid !== game._cloudUid && (game.settings?.savedFriends || []).some((f) => f && f.uid === uid)
}

function friendName(game, uid) {
  const f = (game.settings?.savedFriends || []).find((x) => x && x.uid === uid)
  return String(f?.name || '?').slice(0, 24)
}

export function itemLabel(key) {
  const p = parseKey(key)
  if (!p) return ''
  return `${t(rarityNameKey(p.rarity))} ${t(RING_ITEMS[p.id].nameKey)}`
}

// Bag items you can give away (the free starters can't be given).
export function giftableItems(bag = loadBag()) {
  return ownedList(bag).filter((k) => (bag[k] || 0) > 0)
}

export function giftText(mail) {
  const parts = []
  const coins = Math.max(0, Math.floor(Number(mail.coins) || 0))
  if (coins > 0) parts.push(t('friendGiftCoinsPart', { n: coins.toLocaleString() }))
  const count = Math.max(0, Math.floor(Number(mail.itemCount) || 0))
  if (count > 0 && parseKey(mail.item)) parts.push(`${count} × ${itemLabel(mail.item)}`)
  return parts.join(' + ')
}

export function goalText(stat, target) {
  const n = Math.max(1, Math.floor(Number(target) || 1)).toLocaleString()
  return t(stat === 'kills' ? 'friendChallengeGoalKills' : 'friendChallengeGoalWaves', { n })
}

// --- accepted challenges (localStorage) ---

export function loadActiveChallenges(now = Date.now()) {
  let list = []
  try {
    const raw = JSON.parse(localStorage.getItem(ACTIVE_KEY) || '[]')
    if (Array.isArray(raw)) list = raw
  } catch { list = [] }
  return list.filter((c) => c && typeof c.id === 'string' && (c.stat === 'waves' || c.stat === 'kills')
    && Number(c.target) >= 1 && Number(c.until) > now).slice(0, MAX_ACTIVE)
}

function saveActiveChallenges(list) {
  try { localStorage.setItem(ACTIVE_KEY, JSON.stringify(list)) } catch { /* storage full or blocked */ }
}

// End of a game (ProgressUI): every accepted challenge this game reached
// pays out and goes away. Returns the coins paid.
export function checkFriendChallenges(game, endData, now = Date.now()) {
  const list = loadActiveChallenges(now)
  if (!list.length || !endData) return 0
  let paid = 0
  const left = []
  for (const c of list) {
    const value = Number(c.stat === 'kills' ? endData.kills : endData.waves) || 0
    if (value >= Number(c.target)) {
      paid += CHALLENGE_COINS
      game._showHomepageToast?.(t('friendChallengeWon', { name: String(c.fromNickname || '?').slice(0, 24), n: CHALLENGE_COINS }))
    } else {
      left.push(c)
    }
  }
  if (paid) {
    saveActiveChallenges(left)
    game.coins += paid
  }
  return paid
}

// --- binding ---

export function bindFriendMail(game) {
  if (game._friendMailBound) return
  game._friendMailBound = true
  game._friendMail = []
  $('friend-gift-btn')?.addEventListener('click', () => openForm(game, 'gift'))
  $('friend-challenge-btn')?.addEventListener('click', () => openForm(game, 'challenge'))
  for (const id of ['friend-gift-cancel', 'friend-challenge-cancel']) $(id)?.addEventListener('click', () => openForm(game, null))
  $('friend-gift-send')?.addEventListener('click', () => sendGift(game))
  $('friend-challenge-send')?.addEventListener('click', () => sendChallenge(game))
  $('friend-challenge-stat')?.addEventListener('change', () => fillTarget(game))
  $('friend-gift-item')?.addEventListener('change', () => fillCount())
  // Typing here must not move the player or trigger hotkeys.
  for (const id of ['friend-gift-coins', 'friend-gift-count', 'friend-gift-note', 'friend-challenge-target', 'friend-challenge-note']) {
    $(id)?.addEventListener('keydown', (e) => e.stopPropagation())
  }
  $('friend-mail-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mail-act]')
    if (btn) actOnMail(game, btn.dataset.mailId, btn.dataset.mailAct)
  })
  $('friend-challenges-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-giveup]')
    if (!btn) return
    saveActiveChallenges(loadActiveChallenges().filter((c) => c.id !== btn.dataset.giveup))
    renderActive(game)
  })
  renderFriendMailTexts()
}

export function renderFriendMailTexts() {
  const text = (id, key, vars) => { const el = $(id); if (el) el.textContent = t(key, vars) }
  text('friend-gift-btn', 'friendGiftBtn')
  text('friend-challenge-btn', 'friendChallengeBtn')
  text('friend-gift-coins-label', 'friendGiftCoins', { n: GIFT_MAX_COINS })
  text('friend-gift-item-label', 'friendGiftItem')
  text('friend-gift-count-label', 'friendGiftCount')
  text('friend-challenge-stat-label', 'friendChallengeStat')
  text('friend-challenge-target-label', 'friendChallengeTarget')
  text('friend-gift-send', 'friendMailSend')
  text('friend-challenge-send', 'friendMailSend')
  text('friend-gift-cancel', 'friendMailCancel')
  text('friend-challenge-cancel', 'friendMailCancel')
  text('friend-mail-heading', 'friendMailHeading')
  text('friend-challenges-heading', 'friendChallengesHeading')
  for (const id of ['friend-gift-note', 'friend-challenge-note']) {
    const el = $(id)
    if (el) el.placeholder = t('friendMailNote')
  }
  const stat = $('friend-challenge-stat')
  if (stat) {
    const keep = stat.value || 'waves'
    stat.innerHTML = `<option value="waves">${_escapeHtml(t('friendChallengeWaves'))}</option><option value="kills">${_escapeHtml(t('friendChallengeKills'))}</option>`
    stat.value = keep
  }
}

// --- the friend's profile (FriendsUI._renderOtherProfileEntry) ---

// Shows Send Gift / Challenge only for a friend's profile, signed in.
export function showFriendMailActions(game, uid) {
  bindFriendMail(game)
  renderFriendMailTexts()
  game._friendMailTo = isFriend(game, uid) && game._cloudUid ? uid : null
  const box = $('friend-mail-actions')
  if (box) box.hidden = !game._friendMailTo
  openForm(game, null)
}

function status(text) {
  const el = $('friend-mail-status')
  if (el) el.textContent = text
}

function openForm(game, which) {
  const gift = $('friend-gift-form')
  const ch = $('friend-challenge-form')
  if (gift) gift.hidden = which !== 'gift'
  if (ch) ch.hidden = which !== 'challenge'
  status('')
  if (which === 'gift') {
    const coins = $('friend-gift-coins')
    if (coins) { coins.value = ''; coins.max = String(GIFT_MAX_COINS) }
    const sel = $('friend-gift-item')
    if (sel) {
      const bag = loadBag()
      sel.innerHTML = `<option value="">${_escapeHtml(t('friendGiftNoItem'))}</option>` + giftableItems(bag)
        .map((k) => `<option value="${_escapeHtml(k)}">${_escapeHtml(itemLabel(k))} (${bag[k]})</option>`).join('')
    }
    fillCount()
    const note = $('friend-gift-note')
    if (note) { note.value = ''; note.maxLength = NOTE_MAX }
  } else if (which === 'challenge') {
    fillTarget(game)
    const note = $('friend-challenge-note')
    if (note) { note.value = ''; note.maxLength = NOTE_MAX }
  }
}

function fillCount() {
  const key = $('friend-gift-item')?.value || ''
  const count = $('friend-gift-count')
  if (!count) return
  const have = key ? (loadBag()[key] || 0) : 0
  count.max = String(Math.min(GIFT_MAX_ITEMS, have))
  count.value = key ? '1' : '0'
  count.disabled = !key
}

function fillTarget(game) {
  const stat = $('friend-challenge-stat')?.value === 'kills' ? 'kills' : 'waves'
  const best = Math.floor(Number(stat === 'kills' ? game.bestStats?.bestKills : game.bestStats?.bestWave) || 0)
  const el = $('friend-challenge-target')
  if (el) { el.value = String(Math.max(1, Math.min(100000, best + 1))); el.max = '100000' }
}

async function send(game, mail, btnId) {
  const to = game._friendMailTo
  if (!to || !game._cloudUid) return false
  const btn = $(btnId)
  if (btn) btn.disabled = true
  status(t('friendMailSending'))
  try {
    await api(game).sendFriendMail(to, { ...mail, fromUid: game._cloudUid, fromNickname: nick(game), day: dayKey() })
    return true
  } catch {
    status(t('friendMailFailed'))
    return false
  } finally {
    if (btn) btn.disabled = false
  }
}

async function sendGift(game) {
  const coins = Math.floor(Number($('friend-gift-coins')?.value) || 0)
  const item = $('friend-gift-item')?.value || ''
  const itemCount = item ? Math.floor(Number($('friend-gift-count')?.value) || 0) : 0
  if (coins < 0 || coins > GIFT_MAX_COINS || itemCount < 0 || itemCount > GIFT_MAX_ITEMS || (item && !parseKey(item))) return status(t('friendGiftNotEnough'))
  if (coins === 0 && itemCount === 0) return status(t('friendGiftNothing'))
  if (coins > (Number(game.coins) || 0) || itemCount > (loadBag()[item] || 0)) return status(t('friendGiftNotEnough'))
  const note = _censorText(String($('friend-gift-note')?.value || '').trim().slice(0, NOTE_MAX))
  const name = friendName(game, game._friendMailTo)
  const ok = await send(game, { kind: 'gift', coins, item: itemCount ? item : '', itemCount, note }, 'friend-gift-send')
  if (!ok) return
  // Taken only now that the send worked.
  game.coins -= coins
  if (itemCount) {
    const bag = loadBag()
    bag[item] = Math.max(0, (bag[item] || 0) - itemCount)
    if (!bag[item]) delete bag[item]
    saveBag(bag)
    saveLoadout(fitLoadout(loadLoadout(bag), bag))
  }
  game._afterTradeChange?.()
  game._renderCurrencyBar?.()
  openForm(game, null)
  game._showHomepageToast?.(t('friendGiftSent', { name }))
}

async function sendChallenge(game) {
  const stat = $('friend-challenge-stat')?.value === 'kills' ? 'kills' : 'waves'
  const target = Math.max(1, Math.min(100000, Math.floor(Number($('friend-challenge-target')?.value) || 1)))
  const note = _censorText(String($('friend-challenge-note')?.value || '').trim().slice(0, NOTE_MAX))
  const name = friendName(game, game._friendMailTo)
  const ok = await send(game, { kind: 'challenge', stat, target, note }, 'friend-challenge-send')
  if (!ok) return
  openForm(game, null)
  game._showHomepageToast?.(t('friendChallengeSent', { name }))
}

// --- the mailbox (Friends panel) ---

export async function loadFriendMail(game) {
  bindFriendMail(game)
  renderFriendMailTexts()
  renderActive(game)
  const list = $('friend-mail-list')
  if (!list) return
  if (!game._cloudUid) {
    list.innerHTML = ''
    return
  }
  list.innerHTML = `<p class="friend-mail-empty">${_escapeHtml(t('friendMailLoading'))}</p>`
  let mail
  try {
    mail = await api(game).fetchFriendMail(game._cloudUid, MAX_MAIL)
  } catch {
    mail = null
  }
  if (!mail) {
    list.innerHTML = `<p class="friend-mail-empty">${_escapeHtml(t('friendMailLoadFailed'))}</p>`
    return
  }
  game._friendMail = mail.filter((m) => m && typeof m.id === 'string' && (m.kind === 'gift' || m.kind === 'challenge'))
  renderMail(game)
}

function renderMail(game) {
  const list = $('friend-mail-list')
  if (!list) return
  if (!game._friendMail.length) {
    list.innerHTML = `<p class="friend-mail-empty">${_escapeHtml(t('friendMailEmpty'))}</p>`
    return
  }
  list.innerHTML = game._friendMail.map((m) => {
    const name = String(m.fromNickname || '?').slice(0, 24)
    const note = shownChatText(game.settings, String(m.note || '').slice(0, NOTE_MAX))
    const id = _escapeHtml(m.id)
    const line = m.kind === 'gift'
      ? t('friendGiftFrom', { name, what: giftText(m) })
      : `${t('friendChallengeFrom', { name, goal: goalText(m.stat, m.target) })} ${t('friendChallengeReward', { n: CHALLENGE_COINS, days: CHALLENGE_DAYS })}`
    const buttons = m.kind === 'gift'
      ? `<button type="button" class="mini-action-btn" data-mail-act="open" data-mail-id="${id}">${_escapeHtml(t('friendGiftOpen'))}</button>`
      : `<button type="button" class="mini-action-btn" data-mail-act="accept" data-mail-id="${id}">${_escapeHtml(t('friendChallengeAccept'))}</button>
         <button type="button" class="mini-action-btn" data-mail-act="decline" data-mail-id="${id}">${_escapeHtml(t('friendChallengeDecline'))}</button>`
    return `<div class="friend-mail-row" data-kind="${m.kind === 'gift' ? 'gift' : 'challenge'}">
      <p class="friend-mail-line">${_escapeHtml(line)}</p>
      ${note ? `<p class="friend-mail-note">“${_escapeHtml(note)}”</p>` : ''}
      <div class="friend-mail-buttons">${buttons}</div>
    </div>`
  }).join('')
}

function renderActive(_game) {
  const list = $('friend-challenges-list')
  if (!list) return
  const now = Date.now()
  const active = loadActiveChallenges(now)
  if (!active.length) {
    list.innerHTML = `<p class="friend-mail-empty">${_escapeHtml(t('friendChallengesEmpty'))}</p>`
    return
  }
  list.innerHTML = active.map((c) => `<div class="friend-mail-row">
      <p class="friend-mail-line">${_escapeHtml(t('friendChallengeLeft', { goal: goalText(c.stat, c.target), name: String(c.fromNickname || '?').slice(0, 24), n: Math.max(1, Math.ceil((c.until - now) / DAY_MS)) }))}</p>
      <div class="friend-mail-buttons"><button type="button" class="mini-action-btn" data-giveup="${_escapeHtml(c.id)}">${_escapeHtml(t('friendChallengeGiveUp'))}</button></div>
    </div>`).join('')
}

async function actOnMail(game, id, act) {
  const m = (game._friendMail || []).find((x) => x.id === id)
  if (!m || !game._cloudUid) return
  if (act === 'accept' && loadActiveChallenges().length >= MAX_ACTIVE) {
    game._showHomepageToast?.(t('friendChallengeFull', { n: MAX_ACTIVE }))
    return
  }
  // Delete first: if that fails nothing is given, so a gift can't be
  // opened twice (two devices, double click).
  try {
    await api(game).deleteFriendMail(game._cloudUid, id)
  } catch {
    game._showHomepageToast?.(t('friendMailLoadFailed'))
    return
  }
  game._friendMail = game._friendMail.filter((x) => x.id !== id)
  if (act === 'open' && m.kind === 'gift') {
    const coins = Math.max(0, Math.min(GIFT_MAX_COINS, Math.floor(Number(m.coins) || 0)))
    const count = Math.max(0, Math.min(GIFT_MAX_ITEMS, Math.floor(Number(m.itemCount) || 0)))
    if (coins) game.coins += coins
    if (count && parseKey(m.item)) {
      const bag = loadBag()
      bag[m.item] = (bag[m.item] || 0) + count
      saveBag(bag)
    }
    game._afterTradeChange?.()
    game._renderCurrencyBar?.()
    game._showHomepageToast?.(t('friendGiftOpened', { what: giftText({ coins, item: m.item, itemCount: count }) }))
  } else if (act === 'accept' && m.kind === 'challenge') {
    const list = loadActiveChallenges()
    list.push({
      id: m.id,
      fromNickname: String(m.fromNickname || '?').slice(0, 24),
      stat: m.stat === 'kills' ? 'kills' : 'waves',
      target: Math.max(1, Math.min(100000, Math.floor(Number(m.target) || 1))),
      until: Date.now() + CHALLENGE_DAYS * DAY_MS,
    })
    saveActiveChallenges(list)
  }
  renderMail(game)
  renderActive(game)
}
