// XP and levels (2026-10-23, Gaymi: "points ... like how kirka.io ... not a
// currency"). XP is earned at the end of every game, never spent, and is not
// the blue-star Points (the Upgrades currency). Lifetime XP sets your level;
// XP earned while in a clan also counts for that clan this month, and every
// clan starts the next month at 0.
//
// Pure functions only (no DOM/Firebase), so they can be tested directly.

// What one game is worth, kirka-style: how you did, not just one number.
export const XP_PER_KILL = 10
export const XP_PER_WAVE = 25
export const XP_PER_MINUTE = 5
export const XP_WIN_BONUS = 100
export const XP_DIFFICULTY = { easy: 1, normal: 1, hard: 1.25, nightmare: 1.5, apex: 2 }
// Old players start with XP from what they already did (lifetime kills and
// games), so nobody drops back to level 1 when levels switch to XP.
export const STARTER_XP_PER_KILL = 10
export const STARTER_XP_PER_RUN = 25

export function xpForGame({ kills = 0, waves = 0, seconds = 0, won = false, difficulty = 'normal' } = {}) {
  const n = (v) => Math.max(0, Number(v) || 0)
  const base = n(kills) * XP_PER_KILL + n(waves) * XP_PER_WAVE + Math.floor(n(seconds) / 60) * XP_PER_MINUTE + (won ? XP_WIN_BONUS : 0)
  return Math.round(base * (XP_DIFFICULTY[difficulty] || 1))
}

export function starterXp(totalKills, totalRuns) {
  return Math.max(0, Number(totalKills) || 0) * STARTER_XP_PER_KILL + Math.max(0, Number(totalRuns) || 0) * STARTER_XP_PER_RUN
}

// Levels never end: level 1 -> 2 takes 500 XP and each level after takes
// 250 more than the one before (500, 750, 1000...).
export function xpToNextLevel(level) {
  return 500 + 250 * (Math.max(1, level) - 1)
}

// { level, into: XP gained inside this level, need: XP this level takes }
export function levelFromXp(xp) {
  let left = Math.max(0, Math.floor(Number(xp) || 0))
  let level = 1
  while (left >= xpToNextLevel(level) && level < 100000) {
    left -= xpToNextLevel(level)
    level++
  }
  return { level, into: left, need: xpToNextLevel(level) }
}

// Coins for reaching a level (2026-10-26, Gaymi: a Kirka-style level-up
// popup with a reward): 50 per level number, so level 12 gives 600.
export function levelUpCoins(level) {
  return 50 * Math.max(1, Math.floor(level))
}

// Clan months follow the game owner's clock (Los Angeles), so the board
// goes back to 0 at midnight on the 1st there. '2026-10'.
const CLAN_TZ = 'America/Los_Angeles'
function laParts(now) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: CLAN_TZ, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(now))
  const get = (type) => Number(parts.find((p) => p.type === type)?.value)
  return { year: get('year'), month: get('month'), day: get('day') }
}
export function clanMonthKey(now = Date.now()) {
  const { year, month } = laParts(now)
  return `${year}-${String(month).padStart(2, '0')}`
}
// Whole days left before the reset (1 on the month's last day).
export function daysUntilClanReset(now = Date.now()) {
  const { year, month, day } = laParts(now)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return daysInMonth - day + 1
}

// This month's clan XP for one player (settings.clanXp = { month, clanId,
// xp }): XP only counts for the clan it was earned in, and only this month.
export function currentClanXp(record, clanId, month = clanMonthKey()) {
  if (!record || !clanId || record.clanId !== clanId || record.month !== month) return 0
  return Math.max(0, Math.floor(Number(record.xp) || 0))
}
export function addClanXp(record, clanId, xp, month = clanMonthKey()) {
  return { month, clanId, xp: currentClanXp(record, clanId, month) + Math.max(0, Math.floor(Number(xp) || 0)) }
}
// Same rule for another player's public leaderboard doc.
export function entryClanXp(entry, clanId, month = clanMonthKey()) {
  if (!entry || entry.clanXpClan !== clanId || entry.clanXpMonth !== month) return 0
  return Math.max(0, Math.floor(Number(entry.clanXp) || 0))
}
