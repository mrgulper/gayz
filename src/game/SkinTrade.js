// Skin Trades (2026-11-23, Gaymi: "a trading system like what kirka has"):
// typed in either Global chat (the in-game HUD chat or the homepage Global
// panel).
//
//   /trade fox for wolf      post an offer: you give Fox, you want Wolf.
//                            Everyone sees it in Global chat with a 5-digit
//                            code, e.g. 48213.
//   /trade accept 48213      anyone who owns a Wolf takes the offer. Their
//                            Wolf is held (taken out of their Inventory) so
//                            it can't be sold or traded twice meanwhile.
//   /trade confirm 48213     the poster says yes: Fox and Wolf swap.
//   /trade cancel 48213      the poster closes their offer (a held Wolf goes
//                            back), or the accepter backs out (offer opens
//                            again, their Wolf comes back).
//   /trade list              your open offers.
//   /trade                   help + the names of the skins you can trade.
//
// Gaymi's answers: skins only (Market skins - the free Gaymi/Alisa skins
// and the gem-shop GaygarX can't be traded), anyone in Global can accept,
// typed names with a "did you mean" hint, and an offer stays open forever
// (until it's done or cancelled).
//
// Firestore: skinTrades/{code} (CloudSync's Skin Trade functions + rules).
// Every step is a transaction, so two people can't accept the same offer.
// Skins live in each player's own save (game.charSkins), same client-trust
// model as the Market. The accepter's client collects the poster's skin (or
// gets its held skin back after a cancel) by flipping acceptorPaid - once,
// even with two devices open (checkMyTrades / watchSkinTrades).
//
// The chat line a trade posts is "[trade] <code> <offer|accepted|done>
// <give> <want>" (skin ids, never translated), and each player's game
// draws it in their own language (renderTradeChatRow).
import * as CloudSync from './CloudSync.js'
import { t } from './i18n.js'
import { _escapeHtml } from './Game.js'
import { MARKET_SKINS } from './MarketSkins.js'
import { SKIN_RARITIES } from './InventorySkins.js'
import { _isSkinLocked } from './InventoryUI.js'
import { addChatSystemLine } from './ChatUI.js'

export const MAX_OPEN_TRADES = 10
export const TRADE_COOLDOWN_MS = 2000
export const CODE_RE = /^#?(\d{5})$/
export const CHAT_RE = /^\[trade\] (\d{5}) (offer|accepted|done) ([a-z0-9]{1,40}) ([a-z0-9]{1,40})$/

function api(game) {
  return game.__tradeBackendForTests || CloudSync
}

function nick(game) {
  return String(game.settings?.nickname || 'Player').slice(0, 16) || 'Player'
}

// ---- skins ---------------------------------------------------------------

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

export function tradeSkin(id) {
  return MARKET_SKINS.find((s) => s.id === id) || null
}

export function findSkin(text) {
  const n = norm(text)
  if (!n) return null
  return MARKET_SKINS.find((s) => s.id === n || norm(s.name) === n) || null
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = keep
    }
  }
  return row[b.length]
}

// The closest skin name to a typo ("panada" -> Panda), or null.
export function guessSkin(text) {
  const n = norm(text)
  if (!n) return null
  let best = null
  let bestD = Infinity
  for (const s of MARKET_SKINS) {
    const name = norm(s.name)
    const d = name.startsWith(n) ? 0 : Math.min(editDistance(n, name), editDistance(n, s.id))
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return bestD <= Math.max(2, Math.floor(n.length / 3)) ? best : null
}

export function ownedCount(game, id) {
  return Math.max(0, Math.floor(Number(game.charSkins?.[id]) || 0))
}

function takeSkin(game, id) {
  game.charSkins[id] = Math.max(0, ownedCount(game, id) - 1)
  if (game.charSkins[id] === 0 && game._equippedInventorySkinId?.() === id) game._equipInventorySkin?.('default')
  game._afterTradeChange?.()
}

function giveSkin(game, id) {
  game.charSkins[id] = ownedCount(game, id) + 1
  game._afterTradeChange?.()
}

function skinName(id) {
  return tradeSkin(id)?.name || String(id)
}

function skinHtml(id) {
  const s = tradeSkin(id)
  const color = SKIN_RARITIES[s?.rarity]?.color || '#ccc'
  return `<b class="chat-trade-skin" style="--trade-rarity:${color}">${_escapeHtml(skinName(id))}</b>`
}

// ---- local lines ---------------------------------------------------------

// A line only you see, in the chat you typed into.
function say(game, surface, text) {
  if (surface === 'server') addServerChatSystemLine(game, text)
  else if (game.chatMessages) addChatSystemLine(game, text)
  else game._showHomepageToast?.(text)
}

export const SERVER_SYSTEM_MAX = 30
export function addServerChatSystemLine(game, text) {
  game._serverChatSystemLines = (game._serverChatSystemLines || []).concat({ text, at: Date.now() }).slice(-SERVER_SYSTEM_MAX)
  game._rerenderServerChat?.()
}

// ---- commands ------------------------------------------------------------

export function isTradeCommand(text) {
  return /^\/trade(\s|$)/i.test(String(text || '').trim())
}

// surface: 'hud' (in-game chat) or 'server' (homepage Global panel).
export async function runTradeCommand(game, text, surface = 'hud') {
  const args = String(text || '').trim().replace(/^\/trade\s*/i, '')
  const [first = '', ...rest] = args.split(/\s+/)
  const word = first.toLowerCase()
  if (!args || word === 'help') return showHelp(game, surface)
  if (!game._cloudUid) return say(game, surface, t('chatSignInRequired'))
  const now = Date.now()
  if (now - (game._lastTradeCmdAt || 0) < TRADE_COOLDOWN_MS) return say(game, surface, t('tradeTooFast'))
  game._lastTradeCmdAt = now
  try {
    if (word === 'list') return await listTrades(game, surface)
    if (['accept', 'confirm', 'cancel'].includes(word)) {
      const m = CODE_RE.exec(rest.join('').trim())
      if (!m) return say(game, surface, t('tradeNeedCode', { cmd: `/trade ${word} 12345` }))
      if (word === 'accept') return await acceptTrade(game, surface, m[1])
      if (word === 'confirm') return await confirmTrade(game, surface, m[1])
      return await cancelTrade(game, surface, m[1])
    }
    return await postTrade(game, surface, args)
  } catch (err) {
    console.warn('Trade failed', err)
    say(game, surface, t('tradeFailed'))
  }
}

function showHelp(game, surface) {
  const mine = MARKET_SKINS.filter((s) => ownedCount(game, s.id) > 0).map((s) => `${s.name} x${ownedCount(game, s.id)}`)
  say(game, surface, t('tradeHelp1'))
  say(game, surface, t('tradeHelp2'))
  say(game, surface, mine.length ? t('tradeYourSkins', { list: mine.join(', ') }) : t('tradeNoSkins'))
  say(game, surface, t('tradeAllSkins', { list: MARKET_SKINS.map((s) => s.name).join(', ') }))
}

function resolveSkin(game, surface, text) {
  const skin = findSkin(text)
  if (skin) return skin
  const guess = guessSkin(text)
  say(game, surface, guess ? t('tradeDidYouMean', { typed: text, name: guess.name }) : t('tradeUnknownSkin', { typed: text }))
  return null
}

// The skins this player has promised in trades that aren't finished yet.
async function promised(game, uid) {
  const mine = await api(game).fetchMySkinTrades(uid)
  return mine.filter((tr) => tr.status === 'open' || tr.status === 'accepted')
}

async function postTrade(game, surface, args) {
  const parts = args.split(/\s+for\s+/i)
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) return say(game, surface, t('tradeHowTo'))
  const give = resolveSkin(game, surface, parts[0].trim())
  if (!give) return
  const want = resolveSkin(game, surface, parts[1].trim())
  if (!want) return
  if (give.id === want.id) return say(game, surface, t('tradeSameSkin'))
  if (ownedCount(game, give.id) < 1) return say(game, surface, t('tradeYouDontOwn', { name: give.name }))
  if (_isSkinLocked(game, 'character', give.id)) return say(game, surface, t('tradeLocked', { name: give.name }))
  const uid = game._cloudUid
  const open = await promised(game, uid)
  if (open.length >= MAX_OPEN_TRADES) return say(game, surface, t('tradeTooMany', { n: MAX_OPEN_TRADES }))
  if (open.filter((tr) => tr.give === give.id).length >= ownedCount(game, give.id)) return say(game, surface, t('tradeAlreadyOffered', { name: give.name }))
  const code = await api(game).createSkinTrade(uid, nick(game), give.id, want.id)
  if (!code) return say(game, surface, t('tradeFailed'))
  await api(game).postTradeChat(uid, nick(game), `[trade] ${code} offer ${give.id} ${want.id}`).catch(() => {})
  say(game, surface, t('tradePosted', { code, give: give.name, want: want.name }))
}

async function acceptTrade(game, surface, code) {
  const uid = game._cloudUid
  const tr = await api(game).getSkinTrade(code)
  if (!tr) return say(game, surface, t('tradeNotFound', { code }))
  if (tr.fromUid === uid) return say(game, surface, t('tradeOwnOffer'))
  if (tr.status !== 'open') return say(game, surface, t('tradeNotOpen', { code }))
  const want = tradeSkin(tr.want)
  if (!want) return say(game, surface, t('tradeFailed'))
  if (ownedCount(game, want.id) < 1) return say(game, surface, t('tradeYouDontOwn', { name: want.name }))
  if (_isSkinLocked(game, 'character', want.id)) return say(game, surface, t('tradeLocked', { name: want.name }))
  const res = await api(game).acceptSkinTrade(code, uid, nick(game))
  if (!res) return say(game, surface, t('tradeNotOpen', { code }))
  // Held until the poster confirms or cancels (or you back out).
  takeSkin(game, want.id)
  await api(game).postTradeChat(uid, nick(game), `[trade] ${code} accepted ${tr.give} ${tr.want}`).catch(() => {})
  say(game, surface, t('tradeAccepted', { code, name: want.name, poster: tr.fromName }))
}

async function confirmTrade(game, surface, code) {
  const uid = game._cloudUid
  const tr = await api(game).getSkinTrade(code)
  if (!tr) return say(game, surface, t('tradeNotFound', { code }))
  if (tr.fromUid !== uid) return say(game, surface, t('tradeNotYours', { code }))
  if (tr.status === 'open') return say(game, surface, t('tradeNobodyYet', { code }))
  if (tr.status !== 'accepted') return say(game, surface, t('tradeNotOpen', { code }))
  const give = tradeSkin(tr.give)
  if (!give || ownedCount(game, give.id) < 1) return say(game, surface, t('tradeYouDontOwn', { name: skinName(tr.give) }))
  if (_isSkinLocked(game, 'character', give.id)) return say(game, surface, t('tradeLocked', { name: give.name }))
  const res = await api(game).confirmSkinTrade(code, uid)
  if (!res) return say(game, surface, t('tradeNotOpen', { code }))
  takeSkin(game, tr.give)
  giveSkin(game, tr.want)
  game._tradesAwaitingConfirm?.delete(code)
  await api(game).postTradeChat(uid, nick(game), `[trade] ${code} done ${tr.give} ${tr.want}`).catch(() => {})
  say(game, surface, t('tradeDone', { code, got: skinName(tr.want), gave: skinName(tr.give) }))
}

async function cancelTrade(game, surface, code) {
  const uid = game._cloudUid
  const tr = await api(game).getSkinTrade(code)
  if (!tr) return say(game, surface, t('tradeNotFound', { code }))
  if (tr.fromUid === uid) {
    if (tr.status !== 'open' && tr.status !== 'accepted') return say(game, surface, t('tradeNotOpen', { code }))
    const res = await api(game).cancelSkinTrade(code, uid)
    if (!res) return say(game, surface, t('tradeNotOpen', { code }))
    game._tradesAwaitingConfirm?.delete(code)
    return say(game, surface, t('tradeCancelled', { code }))
  }
  if (tr.acceptorUid === uid && tr.status === 'accepted') {
    const res = await api(game).unacceptSkinTrade(code, uid)
    if (!res) return say(game, surface, t('tradeNotOpen', { code }))
    giveSkin(game, tr.want)
    return say(game, surface, t('tradeBackedOut', { code, name: skinName(tr.want) }))
  }
  say(game, surface, t('tradeNotYours', { code }))
}

async function listTrades(game, surface) {
  const open = await promised(game, game._cloudUid)
  if (!open.length) return say(game, surface, t('tradeListEmpty'))
  open.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  for (const tr of open) {
    const key = tr.status === 'accepted' ? 'tradeListAccepted' : 'tradeListOpen'
    say(game, surface, t(key, { code: tr.code, give: skinName(tr.give), want: skinName(tr.want), name: tr.acceptorName || '' }))
  }
}

// ---- background: collect skins, tell the poster -------------------------

// Accepter side: a confirmed trade pays the poster's skin; a cancelled one
// gives the held skin back. Poster side: remembers which offers wait for
// /trade confirm and says so once.
export async function handleMyTrades(game, acceptorTrades, awaiting) {
  const uid = game._cloudUid
  if (!uid) return
  for (const tr of acceptorTrades || []) {
    if (tr.acceptorPaid || (tr.status !== 'done' && tr.status !== 'cancelled')) continue
    const claimed = await api(game).claimSkinTrade(tr.code, uid).catch(() => null)
    if (!claimed) continue
    if (claimed.status === 'done') {
      giveSkin(game, claimed.give)
      game._showHomepageToast?.(t('tradeGotSkin', { code: claimed.code, name: skinName(claimed.give) }))
    } else {
      giveSkin(game, claimed.want)
      game._showHomepageToast?.(t('tradeRefunded', { code: claimed.code, name: skinName(claimed.want) }))
    }
  }
  if (awaiting) {
    const before = game._tradesAwaitingConfirm || new Set()
    const now = new Set()
    for (const tr of awaiting) {
      if (tr.status !== 'accepted') continue
      now.add(tr.code)
      if (!before.has(tr.code)) {
        const text = t('tradeWaitingForYou', { name: tr.acceptorName, code: tr.code, give: skinName(tr.give), want: skinName(tr.want) })
        game._showHomepageToast?.(text)
      }
    }
    game._tradesAwaitingConfirm = now
    game._rerenderServerChat?.()
  }
}

// One-shot version (also what the tests drive).
export async function checkMyTrades(game) {
  const uid = game._cloudUid
  if (!uid) return
  const [acc, awaiting] = await Promise.all([
    api(game).fetchTradesIAccepted(uid),
    api(game).fetchTradesAwaitingMe(uid),
  ])
  await handleMyTrades(game, acc, awaiting)
}

// Live while signed in (CloudSaveUI's onAuthChange calls it with the new uid
// or null). Two small queries, read again only when one of them changes.
export function watchSkinTrades(game, uid) {
  game._skinTradeUnsub?.()
  game._skinTradeUnsub = null
  game._tradesAwaitingConfirm = new Set()
  if (!uid || game.__tradeBackendForTests) return
  if (!CloudSync.isConfigured?.()) return
  game._skinTradeUnsub = CloudSync.subscribeMySkinTrades(uid, (acceptorTrades, awaiting) => {
    handleMyTrades(game, acceptorTrades, awaiting).catch((err) => console.warn('Trade check failed', err))
  })
}

// ---- drawing the chat line -----------------------------------------------

// The chat row for a "[trade] ..." message, or null if it isn't one (then
// it's drawn like any other message). nameBtn is the sender's name button.
export function renderTradeChatRow(game, m, nameBtn) {
  const match = CHAT_RE.exec(String(m.text || ''))
  if (!match) return null
  const [, code, kind, give, want] = match
  if (!tradeSkin(give) || !tradeSkin(want)) return null
  // The translated text is escaped first, then the coloured skin names go in.
  const line = (key) => _escapeHtml(t(key, { code, give: '@@G@@', want: '@@W@@' })).replace('@@G@@', skinHtml(give)).replace('@@W@@', skinHtml(want))
  const fill = (cmd) => `<button type="button" class="chat-trade-fill" data-trade-fill="${_escapeHtml(`/trade ${cmd} ${code}`)}">/trade ${cmd} ${code}</button>`
  let body
  if (kind === 'offer') {
    body = line('tradeChatOffer')
    if (m.uid !== game._cloudUid) body += ' ' + fill('accept')
  } else if (kind === 'accepted') {
    body = line('tradeChatAccepted')
    if (game._tradesAwaitingConfirm?.has(code)) body += ' ' + fill('confirm')
  } else {
    body = line('tradeChatDone')
  }
  return `<div class="chat-message-row chat-trade-row">${nameBtn}<span class="chat-message-text">${body}</span></div>`
}

// Clicking "/trade accept 12345" puts it in that chat's box - one more
// press of Enter / Send does it (and works the same on a phone).
export function bindTradeFillButtons(game) {
  if (game._tradeFillBound) return
  game._tradeFillBound = true
  game._checkSkinTrades = () => checkMyTrades(game)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.chat-trade-fill')
    if (!btn) return
    const input = btn.closest('#server-panel') ? game.serverChatInput : game.chatInput
    if (!input) return
    input.value = btn.dataset.tradeFill || ''
    input.focus()
  })
}
