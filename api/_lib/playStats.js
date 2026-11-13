// Anonymous play counts (2026-11-13): how many players a day, the busiest
// hour, the most-played modes/maps/skins/weapons, where people close the
// game, phone vs computer and languages. Only totals - no Player ID,
// account, name or address is ever stored, so nobody can be picked out.
//
// Layout in the Realtime Database (no daily read limit):
//   stats/{YYYY-MM-DD (UTC)}/{s|g}/{category}/{key}: count
//   s = signed in, g = guest. Every category and key comes from a fixed
//   list below, so nothing a page sends can add new names.
//
// Written by api/live.js { action: 'stats', who, hits: [[category, key]] }
// (src/game/PlayStats.js), read by the owner tools through api/admin.js.
import { ServerError } from './servers.js'
import { PLAY_GAME_MODES } from '../../src/game/PlayRules.js'
import { PLAY_WEAPONS } from '../../src/game/PlayWeapons.js'
import { MARKET_SKINS } from '../../src/game/MarketSkins.js'

export const STAT_LANGS = ['en', 'zh', 'hi', 'es', 'fr', 'ru', 'id', 'de', 'ja', 'vi', 'it', 'pt-BR']
export const STAT_QUIT = ['home', 'panel', 'editor', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6-10', 'w11-20', 'w21up', 'nozombie']
export const STAT_MAPS = ['city', 'own', 'shared', 'server']
// What each category may hold, and how many of one key a single message
// may add (a page sends at most one "players"/"visits" per message).
export const STAT_CATS = {
  sum: { keys: ['players', 'visits', 'runs'], max: 1 },
  hour: { keys: Array.from({ length: 24 }, (_, h) => String(h)), max: 1 },
  device: { keys: ['phone', 'tablet', 'computer'], max: 1 },
  lang: { keys: STAT_LANGS, max: 1 },
  mode: { keys: PLAY_GAME_MODES, max: 5 },
  map: { keys: STAT_MAPS, max: 5 },
  skin: { keys: ['default', 'alisa', 'gaygarx', 'custom', ...MARKET_SKINS.map((s) => s.id)], max: 5 },
  weapon: { keys: Object.keys(PLAY_WEAPONS), max: 10 },
  quit: { keys: STAT_QUIT, max: 1 },
}
const HITS_MAX = 40
export const STATS_DAYS = [7, 14, 30, 90]

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10)

export async function recordStats(db, { who, hits } = {}, now = Date.now()) {
  if ((who !== 's' && who !== 'g') || !Array.isArray(hits) || !hits.length || hits.length > HITS_MAX) throw new ServerError(400, 'bad-request')
  const add = {}
  for (const h of hits) {
    if (!Array.isArray(h)) continue
    const [cat, key] = [String(h[0]), String(h[1])]
    const rule = STAT_CATS[cat]
    if (!rule || !rule.keys.includes(key)) continue
    const path = `stats/${dayOf(now)}/${who}/${cat}/${key}`
    add[path] = Math.min(rule.max, (add[path] || 0) + 1)
  }
  await db.increment(add)
  return { ok: true }
}

// The owner tools' Charts: the last `days` days (UTC), oldest first, as
// { day, s: {cat: {key: n}}, g: {...} }. The page adds them up.
export async function statsReport(db, { days } = {}, now = Date.now()) {
  const n = STATS_DAYS.includes(Number(days)) ? Number(days) : 7
  const list = Array.from({ length: n }, (_, i) => dayOf(now - (n - 1 - i) * 86400000))
  const all = await Promise.all(list.map((d) => db.get(`stats/${d}`)))
  return {
    days: list.map((day, i) => ({ day, s: all[i]?.s || {}, g: all[i]?.g || {} })),
    cats: Object.fromEntries(Object.entries(STAT_CATS).map(([k, v]) => [k, v.keys])),
  }
}
