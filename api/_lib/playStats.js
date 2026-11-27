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
import { GRAPHICS_LEVELS } from '../../src/game/GraphicsLevels.js'
import { DEATH_KEYS } from '../../src/game/DeathCells.js'

export const STAT_LANGS = ['en', 'zh', 'hi', 'es', 'fr', 'ru', 'id', 'de', 'ja', 'vi', 'it', 'pt-BR']
export const STAT_QUIT = ['home', 'panel', 'editor', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6-10', 'w11-20', 'w21up', 'nozombie']
export const STAT_MAPS = ['city', 'own', 'shared', 'server']
// Game speed (2026-11-26): device + seconds to load, and device + graphics
// level + a game's usual frames per second.
export const STAT_DEVICES = ['phone', 'tablet', 'computer']
export const STAT_LOAD = ['s0-2', 's2-4', 's4-7', 's7-12', 's12up']
export const STAT_FPS = ['f0-19', 'f20-29', 'f30-44', 'f45-59', 'f60up']
export const STAT_GFX = [...GRAPHICS_LEVELS, 'other']
const cross = (...lists) => lists.reduce((acc, l) => acc.flatMap((a) => l.map((b) => `${a}-${b}`)))
// What each category may hold, and how many of one key a single message
// may add (a page sends at most one "players"/"visits" per message).
export const STAT_CATS = {
  sum: { keys: ['players', 'visits', 'runs'], max: 1 },
  hour: { keys: Array.from({ length: 24 }, (_, h) => String(h)), max: 1 },
  device: { keys: STAT_DEVICES, max: 1 },
  lang: { keys: STAT_LANGS, max: 1 },
  mode: { keys: PLAY_GAME_MODES, max: 5 },
  map: { keys: STAT_MAPS, max: 5 },
  skin: { keys: ['default', 'alisa', 'gaygarx', 'custom', ...MARKET_SKINS.map((s) => s.id)], max: 5 },
  weapon: { keys: Object.keys(PLAY_WEAPONS), max: 10 },
  quit: { keys: STAT_QUIT, max: 1 },
  // New player, or back after 1 / 2-6 / 7-29 / 30+ days away (2026-11-26).
  back: { keys: ['new', 'd1', 'd2-6', 'd7-29', 'd30up'], max: 1 },
  // More comeback detail (2026-11-26): days played on that device in all,
  // days since its first day (coming back only), and device + new/back.
  days: { keys: ['1', '2', '3-6', '7-29', '30up'], max: 1 },
  since: { keys: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8-13', 'd14', 'd15-29', 'd30', 'd31up'], max: 1 },
  backdev: { keys: ['phone-new', 'phone-back', 'tablet-new', 'tablet-back', 'computer-new', 'computer-back'], max: 1 },
  load: { keys: cross(STAT_DEVICES, STAT_LOAD), max: 1 },
  fps: { keys: cross(STAT_DEVICES, STAT_GFX, STAT_FPS), max: 5 },
  // Death Heatmap (2026-11-27): which 8-block square of the city map a
  // death happened in (DeathCells.js), or "out" off the city.
  death: { keys: DEATH_KEYS, max: 5 },
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

// One line for the daily summary (inbox.js) from one day's stats
// ({ s: {...}, g: {...} }): the usual load wait and how many games ran
// choppy (under 30 fps) on each kind of device.
const LOAD_TEXT = { 's0-2': 'under 2s', 's2-4': '2-4s', 's4-7': '4-7s', 's7-12': '7-12s', 's12up': '12s+' }
export function speedLine(day) {
  const add = (cat) => {
    const out = {}
    for (const who of ['s', 'g']) for (const [k, n] of Object.entries(day?.[who]?.[cat] || {})) out[k] = (out[k] || 0) + (Number(n) || 0)
    return out
  }
  const load = add('load')
  const loadBy = Object.fromEntries(STAT_LOAD.map((b) => [b, 0]))
  for (const [k, n] of Object.entries(load)) { const b = STAT_LOAD.find((x) => k.endsWith(`-${x}`)); if (b) loadBy[b] += n }
  const loads = Object.values(loadBy).reduce((a, b) => a + b, 0)
  let usual = null
  for (let i = 0, seen = 0; i < STAT_LOAD.length; i++) { seen += loadBy[STAT_LOAD[i]]; if (seen * 2 >= loads && loads) { usual = STAT_LOAD[i]; break } }
  const fps = add('fps')
  const parts = []
  for (const dev of STAT_DEVICES) {
    let all = 0
    let slow = 0
    for (const [k, n] of Object.entries(fps)) {
      if (!k.startsWith(`${dev}-`)) continue
      all += n
      if (k.endsWith('-f0-19') || k.endsWith('-f20-29')) slow += n
    }
    if (all) parts.push(`${dev}s ${Math.round((slow * 100) / all)}%`)
  }
  if (!usual && !parts.length) return '⚡ Speed: no data yet'
  return `⚡ Speed: loads in ${usual ? LOAD_TEXT[usual] : '?'} (usual)${parts.length ? ` · choppy games (under 30 fps): ${parts.join(', ')}` : ''}`
}
