// Watch list (2026-11-27): the team flags a Player ID and gets a ping on
// the private alerts channel (inbox.js sendAlert) plus a line in the
// owner's alert list when that player:
//   - opens the game after at least ONLINE_GAP_MS away (publicConfig in
//     admin.js calls watchOnline on every page ask),
//   - newly shows up in the top 10 of any leaderboard (the cheat scan,
//     every 3 hours, hands its boards to watchBoards),
//   - is reported again (reportPlayer -> watchReport; the normal report
//     alert gets a "watch list" line instead of a second ping).
// Owner-only actions (api/admin.js): watch, unwatch, watchClear. The list
// and the alerts come with the `state` and `card` actions.
//
// Layout in the Realtime Database:
//   watchList/{pid} { at, until (0 = forever), why, name, seen, boards: { boardId: rank } }
//                   seen = last page ask (written at most every SEEN_EVERY_MS)
//   watchAlerts/{id} { pid, name, kind: 'online' | 'board' | 'report', text, at }
//                   newest ALERTS_KEPT kept
import { randomBytes } from 'node:crypto'
import { ServerError } from './servers.js'
import { sendAlert } from './inbox.js'

const MIN = 60 * 1000
export const ONLINE_GAP_MS = 60 * MIN
const SEEN_EVERY_MS = 5 * MIN
export const WATCH_DAYS = [7, 30, 0]
export const WATCH_WHY_MAX = 120
const ALERTS_KEPT = 100

// eslint-disable-next-line no-control-regex -- strips control characters on purpose
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
const validPid = (v) => typeof v === 'string' && /^[A-Z0-9]{3,12}$/.test(v)
const num = (v) => Number(v) || 0
const who = (w, pid) => `${clean(w?.name, 24) || '?'} #${pid}`

// Still on the list right now?
export function watchActive(w, now = Date.now()) {
  return !!w && typeof w === 'object' && (!num(w.until) || num(w.until) > now)
}

async function addAlert(db, pid, w, kind, text, now) {
  const id = `${now.toString(36)}${randomBytes(3).toString('hex')}`
  await db.update({ [`watchAlerts/${id}`]: { pid, name: clean(w?.name, 24), kind, text: clean(text, 300), at: now } })
  const all = (await db.get('watchAlerts')) || {}
  const ids = Object.keys(all).sort((a, b) => num(all[b]?.at) - num(all[a]?.at))
  if (ids.length > ALERTS_KEPT) await db.update(Object.fromEntries(ids.slice(ALERTS_KEPT).map((k) => [`watchAlerts/${k}`, null])))
}

// --- The game's side ---

// Every page ask (publicConfig). `w` is watchList/{pid}, already read.
export async function watchOnline(db, pid, w, now = Date.now()) {
  if (!validPid(pid) || !watchActive(w, now)) return false
  const seen = num(w.seen)
  if (seen && now - seen < SEEN_EVERY_MS) return false
  await db.update({ [`watchList/${pid}/seen`]: now })
  if (seen && now - seen < ONLINE_GAP_MS) return false
  const away = seen ? ` (away ${awayText(now - seen)})` : ''
  const text = `${who(w, pid)} just opened the game${away}.`
  await addAlert(db, pid, w, 'online', text, now)
  await sendAlert(db, `👀 **Watch list:** ${text}${w.why ? `\n> Why you're watching: ${clean(w.why, WATCH_WHY_MAX)}` : ''}`, now)
  return true
}

function awayText(ms) {
  const h = Math.round(ms / (60 * MIN))
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`
  const d = Math.round(h / 24)
  return `${d} days`
}

// A player report just came in against `pid` (reportPlayer). Returns the
// watch entry when they're on the list (the report alert then says so).
export async function watchReport(db, pid, r = {}, now = Date.now()) {
  if (!validPid(pid)) return null
  const w = await db.get(`watchList/${pid}`)
  if (!watchActive(w, now)) return null
  const by = clean(r.byName, 24) || '?'
  await addAlert(db, pid, w, 'report', `${who(w, pid)} was reported again by ${by}${r.by ? ` #${r.by}` : ''}${clean(r.text, 120) ? `: "${clean(r.text, 120)}"` : '.'}`, now)
  return w
}

// The cheat scan's boards ({ boardId: [rows] }, rows have pid + name).
// Pings once when a watched player newly enters a top 10; dropping out
// and coming back pings again.
export async function watchBoards(db, boards, titles = {}, now = Date.now()) {
  const list = (await db.get('watchList')) || {}
  const updates = {}
  const lines = []
  for (const [pid, w] of Object.entries(list)) {
    if (!validPid(pid) || !watchActive(w, now)) continue
    const ranks = {}
    for (const [board, rows] of Object.entries(boards || {})) {
      const i = (rows || []).findIndex((r) => r?.pid === pid)
      if (i >= 0) ranks[board] = i + 1
    }
    const before = w.boards && typeof w.boards === 'object' ? w.boards : {}
    const fresh = Object.keys(ranks).filter((b) => !before[b])
    const sig = (o) => JSON.stringify(Object.entries(o).map(([k, v]) => [k, num(v)]).sort())
    if (sig(ranks) !== sig(before)) updates[`watchList/${pid}/boards`] = Object.keys(ranks).length ? ranks : null
    if (!fresh.length) continue
    const where = fresh.map((b) => `#${ranks[b]} on ${titles[b] || b}`).join(', ')
    const text = `${who(w, pid)} is now in the top 10: ${where}.`
    await addAlert(db, pid, w, 'board', text, now)
    lines.push(`• ${text}`)
  }
  if (Object.keys(updates).length) await db.update(updates)
  if (lines.length) await sendAlert(db, `👀 **Watch list - leaderboard:**\n${lines.slice(0, 8).join('\n')}`, now)
  return lines.length
}

// --- The owner's side (api/admin.js) ---

// For `state`: everyone on the list (expired ones are tidied away) and
// the newest alerts.
export async function watchState(db, now = Date.now()) {
  const [list, alerts] = await Promise.all([db.get('watchList'), db.get('watchAlerts')])
  const gone = {}
  const people = []
  for (const [pid, w] of Object.entries(list || {})) {
    if (!watchActive(w, now)) {
      gone[`watchList/${pid}`] = null
      continue
    }
    people.push({ pid, name: clean(w.name, 24), why: clean(w.why, WATCH_WHY_MAX), at: num(w.at), until: num(w.until), seen: num(w.seen), boards: w.boards || {} })
  }
  if (Object.keys(gone).length) await db.update(gone).catch(() => {})
  return {
    list: people.sort((a, b) => b.at - a.at),
    alerts: Object.entries(alerts || {})
      .map(([id, a]) => ({ id, pid: clean(a?.pid, 12), name: clean(a?.name, 24), kind: clean(a?.kind, 10), text: clean(a?.text, 300), at: num(a?.at) }))
      .sort((a, b) => b.at - a.at),
    days: WATCH_DAYS,
  }
}

// For the player card.
export async function watchFor(db, pid, now = Date.now()) {
  const w = await db.get(`watchList/${pid}`)
  return watchActive(w, now) ? { why: clean(w.why, WATCH_WHY_MAX), at: num(w.at), until: num(w.until), seen: num(w.seen) } : null
}

// Add someone (or change their reason / how long).
export async function watchPlayer(db, { pid, name, why, days } = {}, now = Date.now()) {
  if (!validPid(pid)) throw new ServerError(400, 'bad-player')
  const d = Number(days)
  if (!WATCH_DAYS.includes(d)) throw new ServerError(400, 'bad-days')
  const old = await db.get(`watchList/${pid}`)
  await db.update({
    [`watchList/${pid}`]: {
      at: watchActive(old, now) ? num(old.at) || now : now,
      until: d ? now + d * 24 * 60 * MIN : 0,
      why: clean(why, WATCH_WHY_MAX),
      name: clean(name, 24) || clean(old?.name, 24),
      // Starts "last seen" at now, so the first ping is the next time
      // they open the game after an hour away (not straight away).
      seen: num(old?.seen) || now,
      ...(old?.boards ? { boards: old.boards } : {}),
    },
  })
  return { ok: true }
}

export async function unwatchPlayer(db, { pid } = {}) {
  if (!validPid(pid)) throw new ServerError(400, 'bad-player')
  await db.update({ [`watchList/${pid}`]: null })
  return { ok: true }
}

// Clear one alert (`id`) or all of them (`all: true`).
export async function clearWatchAlerts(db, { id, all } = {}) {
  if (all === true) {
    await db.update({ watchAlerts: null })
    return { ok: true }
  }
  if (typeof id !== 'string' || !/^[a-z0-9]{4,40}$/.test(id)) throw new ServerError(400, 'bad-id')
  await db.update({ [`watchAlerts/${id}`]: null })
  return { ok: true }
}

// Change Player ID (admin.js changeId): the watch follows them.
export async function watchMoveUpdates(db, from, to) {
  const w = await db.get(`watchList/${from}`)
  return w ? { [`watchList/${to}`]: w, [`watchList/${from}`]: null } : {}
}
