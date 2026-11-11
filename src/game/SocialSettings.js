// Settings > General > Social, ideas 63-72 of Gaymi's settings list
// (2026-11-11). Gaymi's picks: chat filter Normal / Strict (no Off - the
// normal filter already runs before a message is sent, so everyone sees
// it cleaned); Hide My Coins hides them on your screen AND from your
// public profile; Who Can Join = Anyone / Link Only / Nobody; postcards
// = who can SEND you one (they were already private). #66 muted list and
// #68 appear offline were already in the game.
//
// Plain helpers asked from where each thing happens (ChatUI, PlayNet,
// CloudSaveUI, OnlineUI, FriendsUI, Postcards, ServerBrowser) - no
// imports, so any of them can use it without a loop.

// ---------- 63 Chat Filter: Strict ----------
// On top of the normal swear filter (Game._censorText, run before
// sending), Strict hides mean words, links, and turns SHOUTING into
// normal letters - only in what you see.
const STRICT_WORDS = ['stupid', 'idiot', 'idiots', 'dumb', 'dumbo', 'loser', 'losers', 'moron', 'morons', 'trash', 'noob', 'noobs', 'stfu', 'kys', 'shut up', 'shutup', 'ugly', 'fatso', 'dummy', 'crap', 'crappy', 'suck', 'sucks', 'hate you', 'l bozo', 'bozo', 'cringe', 'clown']
const STRICT_RE = new RegExp(`(?<![a-zA-Z])(${STRICT_WORDS.map((w) => w.replace(/ /g, '\\s+')).join('|')})(?![a-zA-Z])`, 'gi')
const LINK_RE = /\b(?:https?:\/\/\S+|www\.\S+|[a-z0-9-]+\.(?:com|net|org|gg|io|xyz|ru|tk|ly|me|co|app|link)(?:\/\S*)?)/gi
const SHOUT_MIN = 6

export function strictClean(text) {
  let out = String(text || '').replace(LINK_RE, '[link]').replace(STRICT_RE, (m) => '*'.repeat(m.replace(/\s+/g, '').length))
  // SHOUTING: most of the letters are capitals. A pasted Player ID
  // (#ABC123) stays as it is.
  const letters = out.replace(/#[A-Z0-9]{6}/g, '').replace(/[^A-Za-z]/g, '')
  const caps = letters.replace(/[^A-Z]/g, '').length
  if (letters.length >= SHOUT_MIN && caps / letters.length > 0.7) {
    out = out.replace(/(#[A-Z0-9]{6})|[^#]+?(?=#[A-Z0-9]{6}|$)/g, (m, id) => (id ? m : m.toLowerCase()))
  }
  return out
}

// What a chat message (or speech bubble, or postcard note) shows as.
export function shownChatText(settings, text) {
  return settings?.chatFilter === 'strict' ? strictClean(text) : String(text ?? '')
}

// ---------- 64 Hide Chat / 65 Friends-Only Chat ----------
export function isFriend(settings, { uid, name } = {}) {
  const lower = name ? String(name).toLowerCase() : ''
  return (settings?.savedFriends || []).some((f) => (uid && f.uid === uid) || (lower && f.name && String(f.name).toLowerCase() === lower))
}

// false = this message is left out of what you see.
export function chatShows(settings, m) {
  if (!settings?.friendsOnlyChat) return true
  if (!m?.nickname) return true
  if (m.nickname === settings.nickname) return true
  return isFriend(settings, { uid: m.uid, name: m.nickname })
}

// A speech bubble over another player's head (servers).
export function bubbleShows(settings, nick) {
  if (settings?.hideChat) return false
  return chatShows(settings, { nickname: nick })
}

export function applySocialLook(settings) {
  const root = document.documentElement
  root.classList.toggle('hide-chat', !!settings.hideChat)
  root.classList.toggle('hide-currency', !!settings.hideCurrency)
  bindCurrencyPeek()
}

// Hidden coins: a tap on the currency bar shows them for PEEK_MS.
const PEEK_MS = 3000
let peekBound = false
function bindCurrencyPeek() {
  const bar = document.getElementById('menu-currency-bar')
  if (peekBound || !bar) return
  peekBound = true
  let timer = 0
  bar.addEventListener('click', () => {
    if (!document.documentElement.classList.contains('hide-currency')) return
    bar.classList.add('currency-peek')
    clearTimeout(timer)
    timer = setTimeout(() => bar.classList.remove('currency-peek'), PEEK_MS)
  })
}

// ---------- 67 Friend Requests From ----------
// Clan Members Only: requests from anyone outside your clan are declined
// as they arrive (no clan = all of them). Resolves the ones to keep.
export async function keepFriendRequests(game, uid, requests, cloud) {
  if (game.settings.friendRequestsFrom !== 'clan' || !requests.length) return requests
  let members = []
  if (game.settings.clanId) {
    try { members = await cloud.fetchClanMembers(game.settings.clanId) } catch { return requests }
  }
  const inClan = new Set((members || []).map((m) => m.uid || m.id).filter(Boolean))
  const keep = []
  for (const r of requests) {
    if (inClan.has(r.fromUid)) keep.push(r)
    else cloud.respondToFriendRequest(uid, r.fromUid).catch(() => {})
  }
  return keep
}

// ---------- 69 Hide My Clan / 70 Hide My Coins ----------
export const MONEY_HIDDEN = '•••'

// A coin/gem amount on your own screen.
export function money(settings, n) {
  return settings?.hideCurrency ? MONEY_HIDDEN : n
}

// Your public profile (the leaderboard doc): hidden coins leave out the
// numbers and say so; a hidden clan stays on the doc (the clan boards add
// up its members) but other players' profile view doesn't show it.
export function applyPublicPrivacy(settings, entry) {
  if (settings.hideCurrency) {
    delete entry.lastRunCoins
    delete entry.bestRunCoins
    entry.hideCoins = true
  }
  if (settings.hideClan) entry.hideClan = true
  return entry
}

// ---------- 71 Who Can Join My Server ----------
// What the server is told: 'anyone' is sent as '' (no limit).
export function serverAccess(settings) {
  const v = settings?.serverAccess
  return v === 'link' || v === 'nobody' ? v : ''
}

// ---------- 72 Postcards From ----------
export function postcardShows(settings, card) {
  if (settings?.postcardsFrom === 'nobody') return false
  return isFriend(settings, { uid: card?.fromUid, name: card?.fromNickname })
}
