// Clan War (2026-11-20, social six plan Batch 2): every clan races on one
// board, a weekly race and a monthly race at the same time. Points (Gaymi):
//   a real player in Deathmatch / Team Deathmatch = 1 point,
//   a zombie or a Deathmatch bot = 0.01 to 0.99, by how tough it is
//   (zombies: their full health; bots: how hard their gun hits).
// Points are kept in hundredths (whole numbers): 1 point = 100.
//
// Like clan XP (Xp.js), my points ride on my own public leaderboard doc
// (cw* fields, OnlineUI) and the clan board adds up the members' docs it
// already loads (CloudSync.fetchClanCombinedStats) - no extra reads.
// Each doc also keeps the week and month before, so last week's and last
// month's results can still be added up after the reset (the prizes).
//
// Weeks start Monday 00:00 and months on the 1st, on the game owner's
// clock (Los Angeles), so everyone races on the same week.
//
// Prizes: the top 3 clans of last week / last month - every member who
// scored for it claims coins once, in the Clan panel. Weekly prizes are
// smaller (Gaymi). Coins are client-side, like every other reward here.
import { clanMonthKey } from './Xp.js'

export const CW_KEY = 'gayz-clan-war'
export const CW_CLAIMED_KEY = 'gayz-clan-war-claimed'
// Coins for 1st, 2nd, 3rd. Guesses.
export const WEEK_PRIZES = [300, 150, 75]
export const MONTH_PRIZES = [1500, 750, 400]
export const PLAYER_PTS = 100

const TZ = 'America/Los_Angeles'
function laDay(now) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(now))
  const get = (type) => Number(parts.find((p) => p.type === type)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'))
}
const DAY = 86400000
// This week's Monday (LA), '2026-11-16'.
export function warWeekKey(now = Date.now()) {
  const d = laDay(now)
  const back = (new Date(d).getUTCDay() + 6) % 7
  return new Date(d - back * DAY).toISOString().slice(0, 10)
}
export function lastWeekKey(now = Date.now()) {
  return new Date(Date.parse(warWeekKey(now)) - 7 * DAY).toISOString().slice(0, 10)
}
export function warMonthKey(now = Date.now()) {
  return clanMonthKey(now)
}
export function lastMonthKey(now = Date.now()) {
  const [y, m] = warMonthKey(now).split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
// Whole days left in this week (1 on Sunday).
export function daysLeftInWeek(now = Date.now()) {
  return 7 - Math.round((laDay(now) - Date.parse(warWeekKey(now))) / DAY)
}

// --- points for one kill (hundredths) ---

const clampPts = (n) => Math.max(1, Math.min(99, Math.round(n)))
// A zombie: 100 health (a plain wave-1 one) = 0.10, 990+ = 0.99.
export function zombiePts(maxHealth) {
  return clampPts((Number(maxHealth) || 100) / 10)
}
// A Deathmatch bot, by its gun: damage per second (with its chance to
// hit) x 2. A rifle bot is about 0.45, a sniper bot about 0.2.
export function botPts(gun) {
  if (!gun) return 30
  const avg = (r) => (r[0] + r[1]) / 2
  const dps = (avg(gun.dmg) / avg(gun.every)) * (gun.hit ?? 1)
  return clampPts(dps * 2)
}

// --- my record ---

function num(n) {
  return Math.max(0, Math.floor(Number(n) || 0))
}

// My saved record, moved on to this week / month (the old one becomes
// "last"). Another clan = a fresh record.
export function rollRecord(rec, clanId, now = Date.now()) {
  const w = warWeekKey(now)
  const m = warMonthKey(now)
  const ok = rec && typeof rec === 'object' && rec.clan === clanId
  const r = ok ? { ...rec } : { clan: clanId }
  if (r.w !== w) {
    if (ok && r.w && r.w === lastWeekKey(now)) {
      r.pw = r.w
      r.pwp = num(r.wp)
    } else if (r.pw !== lastWeekKey(now)) {
      delete r.pw
      delete r.pwp
    }
    r.w = w
    r.wp = 0
  }
  if (r.m !== m) {
    if (ok && r.m && r.m === lastMonthKey(now)) {
      r.pm = r.m
      r.pmp = num(r.mp)
    } else if (r.pm !== lastMonthKey(now)) {
      delete r.pm
      delete r.pmp
    }
    r.m = m
    r.mp = 0
  }
  for (const k of ['wp', 'mp', 'pwp', 'pmp']) if (k in r) r[k] = num(r[k])
  return r
}

export function loadRecord() {
  try {
    const r = JSON.parse(localStorage.getItem(CW_KEY) || 'null')
    return r && typeof r === 'object' && typeof r.clan === 'string' ? r : null
  } catch {
    return null
  }
}
function saveRecord(r) {
  try { localStorage.setItem(CW_KEY, JSON.stringify(r)) } catch { /* storage full or blocked */ }
}

// My points for my clan right now: { week, month } in hundredths.
export function myPoints(clanId, now = Date.now()) {
  if (!clanId) return { week: 0, month: 0 }
  const r = rollRecord(loadRecord(), clanId, now)
  return { week: r.wp, month: r.mp }
}

// A kill worth `pts` hundredths. Only counts while signed in and in a clan.
// Saved a moment later (a burst of kills = one write).
let pending = 0
let timer = null
export function addWarPoints(game, pts) {
  const n = num(pts)
  if (!n || !game?._cloudUid || !game.settings?.clanId || game.settings.guestMode) return
  pending += n
  game._clanWarDirty = true
  if (!timer) timer = setTimeout(() => flushWarPoints(game), 2000)
}
export function flushWarPoints(game) {
  clearTimeout(timer)
  timer = null
  if (!pending) return
  const clanId = game?.settings?.clanId
  const n = pending
  pending = 0
  if (!clanId) return
  const r = rollRecord(loadRecord(), clanId)
  r.wp += n
  r.mp += n
  saveRecord(r)
}

// The cw* fields for my leaderboard doc (OnlineUI), or null.
export function entryFields(clanId, now = Date.now()) {
  if (!clanId) return null
  const raw = loadRecord()
  if (!raw) return null
  const r = rollRecord(raw, clanId, now)
  const out = { cwClan: clanId, cwW: r.w, cwWP: r.wp, cwM: r.m, cwMP: r.mp }
  if (r.pw) Object.assign(out, { cwPW: r.pw, cwPWP: r.pwp || 0 })
  if (r.pm) Object.assign(out, { cwPM: r.pm, cwPMP: r.pmp || 0 })
  return out
}

// One member's leaderboard doc -> what it adds to the clan's totals:
// { week, month, lastWeek, lastMonth } (hundredths).
export function entryWar(entry, clanId, now = Date.now()) {
  const out = { week: 0, month: 0, lastWeek: 0, lastMonth: 0 }
  if (!entry || entry.cwClan !== clanId) return out
  const w = warWeekKey(now)
  const lw = lastWeekKey(now)
  const m = warMonthKey(now)
  const lm = lastMonthKey(now)
  if (entry.cwW === w) out.week = num(entry.cwWP)
  if (entry.cwW === lw) out.lastWeek = num(entry.cwWP)
  else if (entry.cwPW === lw) out.lastWeek = num(entry.cwPWP)
  if (entry.cwM === m) out.month = num(entry.cwMP)
  if (entry.cwM === lm) out.lastMonth = num(entry.cwMP)
  else if (entry.cwPM === lm) out.lastMonth = num(entry.cwPMP)
  return out
}

// 1234 hundredths -> '12.34', 1200 -> '12', 1210 -> '12.1'.
export function fmtPts(h) {
  const n = num(h) / 100
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

// --- prizes ---

function loadClaimed() {
  try {
    const l = JSON.parse(localStorage.getItem(CW_CLAIMED_KEY) || '[]')
    return Array.isArray(l) ? l.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

// The prizes I can claim now, from the loaded clan list (each clan with
// lastWeekPts / lastMonthPts): [{ id, kind: 'week'|'month', place, coins }].
// Only for my clan, only a top-3 place with points, only if I scored for
// it myself (my record's last week / month), only once.
export function claimablePrizes(clans, clanId, now = Date.now()) {
  if (!clanId || !Array.isArray(clans)) return []
  const rec = rollRecord(loadRecord(), clanId, now)
  const claimed = loadClaimed()
  const out = []
  const check = (kind, field, key, mine, prizes) => {
    if (!mine) return
    const id = `${kind}:${key}:${clanId}`
    if (claimed.includes(id)) return
    const ranked = clans.filter((c) => (c[field] || 0) > 0).sort((a, b) => b[field] - a[field])
    const place = ranked.findIndex((c) => c.clanId === clanId)
    if (place >= 0 && place < prizes.length) out.push({ id, kind, place: place + 1, coins: prizes[place] })
  }
  check('week', 'lastWeekPts', lastWeekKey(now), rec.pw === lastWeekKey(now) && rec.pwp > 0, WEEK_PRIZES)
  check('month', 'lastMonthPts', lastMonthKey(now), rec.pm === lastMonthKey(now) && rec.pmp > 0, MONTH_PRIZES)
  return out
}

export function markClaimed(id) {
  const l = loadClaimed()
  if (l.includes(id)) return false
  l.push(id)
  try { localStorage.setItem(CW_CLAIMED_KEY, JSON.stringify(l.slice(-40))) } catch { /* storage full */ }
  return true
}

// Who won last week / last month (for the line over the board), or null.
export function lastWinner(clans, field) {
  if (!Array.isArray(clans)) return null
  let best = null
  for (const c of clans) if ((c[field] || 0) > 0 && (!best || c[field] > best[field])) best = c
  return best
}
