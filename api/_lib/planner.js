// Event Planner giveaways (2026-11-27): the Console plans a giveaway for a
// time; when that time comes, the site-check poke (api/live.js
// dailySummary, every 10 minutes) picks the winners at random from players
// who opened the game lately and pings Discord. Nothing is given until the
// owner presses Give prizes in the Console (they asked to confirm first).
// The other planned things (banner, message of the day, off-switches,
// maintenance, events) need no poke: admin.js works them out on every ask
// (plannedNow / liveEvents).
//
//   plannedGiveaways/{id} { at, winners, days, coins, gems, skins, text,
//                  state ('planned' | 'picked' | 'given'), picked: [{ pid,
//                  nick }], pickedAt, givenAt, createdAt }
import { ServerError } from './servers.js'
import { activePlayers, giveTo, cleanText, validPid, ACTIVE_DAYS } from './admin.js'
import { sendAlert } from './inbox.js'

export const GIVEAWAY_WINNERS_MAX = 10
const PLANNED_MAX = 20
// Given (or never-picked) giveaways stay listed this long, then drop.
const KEEP_MS = 7 * 86400000
const AHEAD_MAX_MS = 90 * 86400000
const validId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(v)

function cleanPrize(g) {
  const coins = Math.max(0, Math.min(100000, Math.floor(Number(g?.coins) || 0)))
  const gems = Math.max(0, Math.min(1000, Math.floor(Number(g?.gems) || 0)))
  const skins = (Array.isArray(g?.skins) ? g.skins : []).filter((s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(s)).slice(0, 1)
  return { coins, gems, skins }
}

function cleanGiveaway(id, g) {
  if (!validId(id) || !g || typeof g !== 'object' || !(Number(g.at) > 0)) return null
  return {
    id,
    at: Number(g.at),
    winners: Math.max(1, Math.min(GIVEAWAY_WINNERS_MAX, Math.floor(Number(g.winners) || 1))),
    days: ACTIVE_DAYS.includes(Number(g.days)) ? Number(g.days) : 7,
    ...cleanPrize(g),
    text: cleanText(g.text, 120),
    state: ['planned', 'picked', 'given'].includes(g.state) ? g.state : 'planned',
    picked: (Array.isArray(g.picked) ? g.picked : []).filter((p) => validPid(p?.pid)).map((p) => ({ pid: p.pid, nick: cleanText(p.nick, 24) })),
    pickedAt: Number(g.pickedAt) || 0,
    givenAt: Number(g.givenAt) || 0,
  }
}

export async function plannedGiveaways(db, now = Date.now()) {
  const all = (await db.get('plannedGiveaways')) || {}
  return Object.entries(all)
    .map(([id, g]) => cleanGiveaway(id, g))
    .filter((g) => g && !(g.state === 'given' && g.givenAt < now - KEEP_MS))
    .sort((a, b) => a.at - b.at)
}

const prizeWords = (g) => [g.coins ? `${g.coins} coins` : '', g.gems ? `${g.gems} gems` : '', g.skins.length ? 'a skin' : ''].filter(Boolean).join(' + ') || 'nothing'

export async function addPlannedGiveaway(db, body = {}, now = Date.now()) {
  const at = Math.floor(Number(body.at))
  if (!(at > now - 60000) || at > now + AHEAD_MAX_MS) throw new ServerError(400, 'bad-time')
  const prize = cleanPrize(body)
  if (!prize.coins && !prize.gems && !prize.skins.length) throw new ServerError(400, 'no-prize')
  const all = (await db.get('plannedGiveaways')) || {}
  const updates = {}
  for (const [id, g] of Object.entries(all)) {
    const c = cleanGiveaway(id, g)
    if (!c || (c.state === 'given' && c.givenAt < now - KEEP_MS)) updates[`plannedGiveaways/${id}`] = null
  }
  if (Object.keys(all).length - Object.keys(updates).length >= PLANNED_MAX) throw new ServerError(400, 'too-many')
  const id = `${now}${Math.random().toString(36).slice(2, 6)}`
  updates[`plannedGiveaways/${id}`] = {
    at,
    winners: Math.max(1, Math.min(GIVEAWAY_WINNERS_MAX, Math.floor(Number(body.winners) || 1))),
    days: ACTIVE_DAYS.includes(Number(body.days)) ? Number(body.days) : 7,
    ...prize,
    text: cleanText(body.text, 120),
    state: 'planned',
    createdAt: now,
  }
  await db.update(updates)
  return { ok: true, id }
}

export async function removePlannedGiveaway(db, { id } = {}) {
  if (!validId(id)) throw new ServerError(400, 'bad-request')
  await db.update({ [`plannedGiveaways/${id}`]: null })
  return { ok: true }
}

// Random winners, never the same Player ID twice.
async function drawWinners(db, g, now) {
  const { list } = await activePlayers(db, { days: g.days }, now)
  const pool = [...list]
  const out = []
  while (pool.length && out.length < g.winners) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
  return out.map((p) => ({ pid: p.pid, nick: cleanText(p.nick, 24) }))
}

// The Console's "Pick again" (also works before the time comes).
export async function repickGiveaway(db, { id } = {}, now = Date.now()) {
  const g = cleanGiveaway(id, await db.get(`plannedGiveaways/${id}`))
  if (!g) throw new ServerError(404, 'not-found')
  if (g.state === 'given') throw new ServerError(400, 'already-given')
  const picked = await drawWinners(db, g, now)
  await db.update({ [`plannedGiveaways/${id}/picked`]: picked, [`plannedGiveaways/${id}/state`]: 'picked', [`plannedGiveaways/${id}/pickedAt`]: now })
  return { ok: true, picked }
}

// "Give prizes": each winner gets the prize the same way as a player-card
// gift (it waits for them to open the game). Marked given first, so a
// double click can't pay twice.
export async function givePlannedGiveaway(db, { id } = {}, now = Date.now()) {
  if (!validId(id)) throw new ServerError(400, 'bad-request')
  let before = null
  const r = await db.transaction(`plannedGiveaways/${id}`, (cur) => {
    const g = cleanGiveaway(id, cur)
    if (!g || g.state !== 'picked' || !g.picked.length) return undefined
    before = g
    return { ...cur, state: 'given', givenAt: now }
  })
  if (!r.committed || !before) throw new ServerError(400, 'not-picked')
  let given = 0
  for (const w of before.picked) {
    try {
      await giveTo(db, { pid: w.pid, coins: before.coins, gems: before.gems, skins: before.skins, text: before.text }, now)
      given++
    } catch {
      // One bad Player ID never stops the rest.
    }
  }
  return { ok: true, given, of: before.picked.length }
}

// The site-check poke: every planned giveaway whose time has come gets
// its winners and one Discord line. Never throws (the summary goes on).
export async function runPlanner(db, now = Date.now()) {
  const due = (await plannedGiveaways(db, now)).filter((g) => g.state === 'planned' && g.at <= now)
  let picked = 0
  for (const g of due) {
    try {
      const winners = await drawWinners(db, g, now)
      await db.update({ [`plannedGiveaways/${g.id}/picked`]: winners, [`plannedGiveaways/${g.id}/state`]: 'picked', [`plannedGiveaways/${g.id}/pickedAt`]: now })
      picked++
      const names = winners.map((w) => `${w.nick || '(no name)'} #${w.pid}`).join(', ')
      await sendAlert(db, winners.length
        ? `🎁 Planned giveaway: ${winners.length} winner${winners.length === 1 ? '' : 's'} picked for ${prizeWords(g)} - ${names}. Nothing is given yet: open the Planner tab and press Give prizes.`
        : `🎁 Planned giveaway for ${prizeWords(g)}: nobody played in the last ${g.days} day${g.days === 1 ? '' : 's'}, so there are no winners. Open the Planner tab to pick again or remove it.`, now).catch(() => false)
    } catch {
      // Tried again on the next poke.
    }
  }
  return { picked }
}

export const giveawayLog = {
  planGiveaway: (b) => `Planned a giveaway: ${Math.max(1, Math.min(GIVEAWAY_WINNERS_MAX, Math.floor(Number(b.winners) || 1)))} winner(s) of ${prizeWords(cleanPrize(b))} on ${new Date(Number(b.at) || 0).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  planGiveawayRemove: () => 'Removed a planned giveaway',
  planGiveawayRepick: () => 'Picked new winners for a planned giveaway',
  planGiveawayGive: () => 'Gave the prizes of a planned giveaway',
}
