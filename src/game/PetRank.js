// Pet battle leaderboard (pet battles round 4, Batch M, 2026-11-24).
// Gaymi picked: trophies (win = more for beating a stronger team, lose = a
// few taken away), only the Pets tab Battle button counts, lists All-time
// top 50 / This week / Friends + my own place, a rank badge (no coins).
//
// Trophies are kept in the pet save (Creatures tr / tw) and, when signed
// in, sent to Firestore after each battle (petTrophies/{uid} and
// petTrophyWeeks/{week}/entries/{uid}, see the rules in CloudSync.js -
// they cap how fast trophies can go up). The lists are only read when the
// Leaderboard is opened, and kept for CACHE_MS.
import * as CloudSync from './CloudSync.js'
import { loadCreatures } from './Creatures.js'
import { weekId } from './TeamTournament.js'
import { _censorText } from './Game.js'
import { t } from './i18n.js'

// All a guess (Gaymi didn't pick numbers).
export const TROPHY_WIN = 20
export const TROPHY_LOSS = 10
// The most one battle can give - the Firestore rules use the same 40.
export const TROPHY_MAX = 40
export const TOP_N = 50
const CACHE_MS = 2 * 60 * 1000
export const RANKS = [
  { id: 'bronze', at: 0, color: '#c87f4a' },
  { id: 'silver', at: 300, color: '#c9d1d9' },
  { id: 'gold', at: 800, color: '#ffd84a' },
  { id: 'platinum', at: 1500, color: '#7fe0d0' },
  { id: 'diamond', at: 2500, color: '#8fc4ff' },
  { id: 'champion', at: 4000, color: '#ff7ad9' },
]

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const api = (game) => game.__petRankBackendForTests || CloudSync
const num = (n) => (Number.isInteger(n) && n >= 0 ? n : 0)

// A win against a team twice as strong = TROPHY_WIN x 2 (the most); half
// as strong = x 0.5. A loss to a stronger team costs less.
export function trophyChange(won, mine, theirs) {
  const ratio = Math.min(2, Math.max(0.5, (theirs || 1) / (mine || 1)))
  return won ? Math.min(TROPHY_MAX, Math.round(TROPHY_WIN * ratio)) : -Math.round(TROPHY_LOSS / ratio)
}

export function rankOf(tr) {
  let r = RANKS[0]
  for (const x of RANKS) if (num(tr) >= x.at) r = x
  return r
}

export const rankName = (r) => t(`rank${r.id[0].toUpperCase()}${r.id.slice(1)}`)

export function badge(tr) {
  const r = rankOf(tr)
  return `<span class="pet-rank-badge" style="--rank: ${r.color}">${esc(rankName(r))}</span>`
}

// This week's trophies (0 when the saved week is an old one).
export function weekTrophies(d, week = weekId()) {
  return d.tw && d.tw.w === week ? d.tw.n : 0
}

// A Battle-button battle ended: trophies changed on the pet save d (the
// caller saves it). Returns { delta, rank } - rank set when it went up.
export function applyTrophies(d, won, mine, theirs) {
  const delta = trophyChange(won, mine, theirs)
  const before = rankOf(d.tr)
  d.tr = Math.max(0, num(d.tr) + delta)
  const week = weekId()
  d.tw = { w: week, n: Math.max(0, weekTrophies(d, week) + delta) }
  const after = rankOf(d.tr)
  return { delta, rank: after.at > before.at ? after : null }
}

// Settings > Anonymous Mode hides it here too.
function nickname(game) {
  if (game.settings?.anonymousLeaderboard) return String(t('anonymousLeaderboardName')).slice(0, 24)
  return (game.settings?.nickname || '').trim().slice(0, 24) || t('teamDefaultNick')
}

// Send my trophies, when signed in (never waits on it; a failure is quiet -
// the next battle sends them again).
export async function pushTrophies(game) {
  const uid = game._cloudUid
  const backend = api(game)
  if (!uid || !navigator.onLine || !backend.isConfigured()) return false
  const d = loadCreatures()
  game._petRankCache = null
  try {
    await backend.savePetTrophies(uid, weekId(), { nickname: nickname(game), tr: d.tr, n: weekTrophies(d) })
    game._petRankPushed = true
    return true
  } catch {
    return false
  }
}

// The line under Wins / Losses.
export function renderRankLine() {
  const el = $('pet-rank-line')
  if (!el) return
  const d = loadCreatures()
  el.innerHTML = `${badge(d.tr)} <span>${esc(t('petRankTrophies', { n: d.tr }))} · ${esc(t('petRankWeek', { n: weekTrophies(d) }))}</span>`
}

function row(place, name, score, tr, me) {
  return `<div class="pet-rank-row${me ? ' me' : ''}">
    <span class="pet-rank-place">#${place}</span>
    ${badge(tr)}
    <span class="pet-rank-name">${esc(_censorText(String(name || '?').slice(0, 24)))}${me ? ` <em>${esc(t('petRankYou'))}</em>` : ''}</span>
    <span class="pet-rank-score">${num(score)}</span>
  </div>`
}

async function load(game, tab) {
  const backend = api(game)
  const uid = game._cloudUid
  const week = weekId()
  const d = loadCreatures()
  if (tab === 'friends') {
    const friends = (game.settings?.savedFriends || []).filter((f) => f.uid).map((f) => f.uid).slice(0, 5)
    const rows = friends.length ? await backend.fetchPetTrophies(friends, week) : []
    if (uid) rows.push({ uid, nickname: nickname(game), tr: d.tr, n: weekTrophies(d) })
    rows.sort((a, b) => num(b.tr) - num(a.tr))
    return { rows: rows.map((r) => ({ ...r, score: r.tr })), me: null, friends: friends.length }
  }
  const w = tab === 'week' ? week : null
  const rows = (await backend.fetchPetTrophyTop(w, TOP_N)).map((r) => ({ ...r, score: tab === 'week' ? r.n : r.tr }))
  const mine = tab === 'week' ? weekTrophies(d) : d.tr
  const me = uid && mine > 0 ? await backend.fetchPetTrophyRank(w, mine).catch(() => null) : null
  return { rows, me }
}

export async function renderPetRank(game) {
  const box = $('pet-rank')
  const list = $('pet-rank-list')
  const meEl = $('pet-rank-me')
  if (!box || box.hidden || !list) return
  const tab = game._petRankTab || 'all'
  box.querySelectorAll('[data-rank-tab]').forEach((b) => b.classList.toggle('open', b.dataset.rankTab === tab))
  const uid = game._cloudUid
  if (meEl) meEl.textContent = uid ? '' : t('petRankSignIn')
  const backend = api(game)
  if (!navigator.onLine || !backend.isConfigured()) {
    list.innerHTML = `<p class="team-snack-hint">${esc(t('petRankError'))}</p>`
    return
  }
  // My latest trophies first (battles played offline or before signing in).
  if (uid && !game._petRankPushed && loadCreatures().tr > 0) await pushTrophies(game)
  const cache = game._petRankCache || (game._petRankCache = {})
  let got = cache[tab]
  if (!got || Date.now() - got.at > CACHE_MS) {
    list.innerHTML = `<p class="team-snack-hint">${esc(t('petRankLoading'))}</p>`
    try {
      got = { ...(await load(game, tab)), at: Date.now() }
      cache[tab] = got
    } catch {
      if ((game._petRankTab || 'all') === tab) list.innerHTML = `<p class="team-snack-hint">${esc(t('petRankError'))}</p>`
      return
    }
  }
  // Another tab was picked while this one loaded.
  if ((game._petRankTab || 'all') !== tab || box.hidden) return
  if (tab === 'friends' && !got.friends) {
    list.innerHTML = `<p class="team-snack-hint">${esc(t('petRankNoFriends'))}</p>`
    return
  }
  const rows = got.rows.filter((r) => num(r.score) > 0 || r.uid === uid)
  list.innerHTML = rows.length
    ? rows.map((r, i) => row(i + 1, r.nickname, r.score, r.tr, r.uid === uid)).join('')
    : `<p class="team-snack-hint">${esc(t('petRankEmpty'))}</p>`
  if (meEl && uid && tab !== 'friends') meEl.textContent = got.me ? t('petRankMe', { n: got.me }) : t('petRankMeNone')
}

export function bindPetRank(game) {
  if (game._petRankBound) return
  game._petRankBound = true
  const btn = $('pet-rank-btn')
  const box = $('pet-rank')
  if (!btn || !box) return
  btn.textContent = t('petRankBtn')
  box.querySelectorAll('[data-rank-tab]').forEach((b) => {
    b.textContent = t(`petRankTab${b.dataset.rankTab[0].toUpperCase()}${b.dataset.rankTab.slice(1)}`)
  })
  const how = $('pet-rank-how')
  if (how) how.textContent = t('petRankHow')
  btn.addEventListener('click', () => {
    box.hidden = !box.hidden
    btn.classList.toggle('open', !box.hidden)
    renderPetRank(game)
  })
  box.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-rank-tab]')
    if (!tab) return
    game._petRankTab = tab.dataset.rankTab
    renderPetRank(game)
  })
}
