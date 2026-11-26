// Leaderboard cleanup, the cheat alarm and the chat viewer (2026-11-26).
// Owner-only (api/admin.js), except cheatScan, which GitHub's site check
// starts through api/live.js every 10 minutes (it only really runs every
// SCAN_EVERY_MS).
//
// Layout in the Realtime Database:
//   liveConfig.hidden.players/{uid} { at, why, name, pid } - left out of
//                  every leaderboard list (publicConfig sends the uids,
//                  CloudSync filters them). Part of liveConfig, so backups
//                  hold it.
//   cheatAlerts/{id} { uid, name, pid, why: [text], at } - scores that look
//                  impossible, newest ALERTS_KEPT kept
//   cheatSeen/{uid} - the scores last alerted on, so the same score never
//                  pings twice (a NEW impossible score does)
//   cheatScan/last - when the last automatic scan ran
//
// Firestore (through firestoreRest.js, passed in as `fs`): leaderboard
// docs are only read here; chat messages are read and deleted.
import { randomBytes } from 'node:crypto'
import { ServerError } from './servers.js'
import { ACHIEVEMENTS } from '../../src/game/Achievements.js'
import { sendAlert } from './inbox.js'
import { loadRudeChecker } from './autoMod.js'

const HOUR = 60 * 60 * 1000
export const SCAN_EVERY_MS = 3 * HOUR
const ALERTS_KEPT = 50
export const HIDE_WHY_MAX = 120
export const CHAT_ROOMS = ['globalChat', 'serverChat']
const CHAT_LIMIT = 40
const STAFF_UID = 'gayzTeam' // admin.js STAFF_UID (the gold "GayZ Team" line)

// What counts as impossible. The achievements one is certain; the others
// are guesses at "no real player gets this" - raise one if it flags real
// players.
export const CHEAT_LIMITS = {
  night: 150, // best night reached
  killsPerNight: 150, // best kills in one run, per night reached (+200 spare)
  speedrunMs: 60 * 1000, // Speedrun: 5 waves in under a minute
  parkourMs: 20 * 1000, // Obstacle Course in under 20 seconds
  duelRating: 4000, // Duel Arena rating
}

// The boards the scan and the Leaderboard tab read (top 10 each).
export const BOARDS = [
  ['night', 'Best night', 'bestNight', 'DESCENDING'],
  ['kills', 'Most kills in a run', 'bestKills', 'DESCENDING'],
  ['streak', 'Best kill streak', 'bestKillStreak', 'DESCENDING'],
  ['ach', 'Achievements', 'achievementCount', 'DESCENDING'],
  ['speedrun', 'Speedrun', 'speedrunMs', 'ASCENDING'],
  ['parkour', 'Obstacle Course', 'parkourMs', 'ASCENDING'],
  ['duel', 'Duel rating', 'duelRating', 'DESCENDING'],
]

const secs = (ms) => `${Math.round(ms / 100) / 10} s`

// Why one leaderboard row looks impossible ([] = it looks fine).
export function cheatReasons(r, limits = CHEAT_LIMITS) {
  const why = []
  const night = Number(r.bestNight) || 0
  const kills = Number(r.bestKills) || 0
  if (Number(r.achievementCount) > ACHIEVEMENTS.length) why.push(`${r.achievementCount} achievements (the game only has ${ACHIEVEMENTS.length})`)
  if (night > limits.night) why.push(`reached night ${night}`)
  if (kills > limits.killsPerNight * Math.max(1, night) + 200) why.push(`${kills} kills in one run but best night is only ${night}`)
  if (kills && Number(r.bestKillStreak) > kills) why.push(`kill streak ${r.bestKillStreak} is more than their best kills (${kills})`)
  if (r.speedrunMs && r.speedrunMs < limits.speedrunMs) why.push(`Speedrun in ${secs(r.speedrunMs)}`)
  if (r.parkourMs && r.parkourMs < limits.parkourMs) why.push(`Obstacle Course in ${secs(r.parkourMs)}`)
  if (Number(r.duelRating) > limits.duelRating) why.push(`Duel rating ${r.duelRating}`)
  return why
}

// eslint-disable-next-line no-control-regex -- strips control characters on purpose
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
const validUid = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(v)
const validPid = (v) => typeof v === 'string' && /^[A-Z0-9]{3,12}$/.test(v)
const scoreSig = (r) => [r.bestNight, r.bestKills, r.bestKillStreak, r.achievementCount, r.speedrunMs, r.parkourMs, r.duelRating].map((v) => Number(v) || 0).join(',')
const who = (r) => `${clean(r.name, 24) || '?'}${r.pid ? ` #${r.pid}` : ''}`

async function topBoards(fs) {
  const lists = await Promise.all(BOARDS.map(([, , field, dir]) => fs.topBy(field, dir, 10).catch(() => [])))
  return Object.fromEntries(BOARDS.map(([id], i) => [id, lists[i]]))
}

// Reads the top of every board, saves an alert for each new impossible
// score and pings Discord once with all of them. Hidden players are skipped.
export async function runCheatScan(db, fs, now = Date.now()) {
  const [boards, hidden, seen] = await Promise.all([topBoards(fs), db.get('liveConfig/hidden/players'), db.get('cheatSeen')])
  const rows = new Map()
  for (const list of Object.values(boards)) for (const r of list) rows.set(r.uid, r)
  const found = []
  const updates = {}
  for (const r of rows.values()) {
    if (hidden?.[r.uid]) continue
    const why = cheatReasons(r)
    if (!why.length) continue
    const sig = scoreSig(r)
    if (seen?.[r.uid] === sig) continue
    const id = `${now.toString(36)}${randomBytes(3).toString('hex')}`
    updates[`cheatAlerts/${id}`] = { uid: r.uid, name: clean(r.name, 24), pid: validPid(r.pid) ? r.pid : '', why, at: now }
    updates[`cheatSeen/${r.uid}`] = sig
    found.push({ ...r, why })
  }
  if (found.length) {
    await db.update(updates)
    await trimAlerts(db)
    const lines = found.slice(0, 5).map((r) => `• **${who(r)}**: ${r.why.join('; ')}`)
    if (found.length > 5) lines.push(`…and ${found.length - 5} more.`)
    await sendAlert(db, `🚩 **Cheat alarm** - ${found.length === 1 ? 'a score looks' : `${found.length} scores look`} impossible:\n${lines.join('\n')}\nOpen the Leaderboard tab to hide them (or dismiss if it's real).`, now)
  }
  return { scanned: true, found: found.length }
}

async function trimAlerts(db) {
  const all = (await db.get('cheatAlerts')) || {}
  const ids = Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0))
  if (ids.length > ALERTS_KEPT) await db.update(Object.fromEntries(ids.slice(ALERTS_KEPT).map((id) => [`cheatAlerts/${id}`, null])))
}

// The site check's poke (api/live.js): at most once per SCAN_EVERY_MS.
export async function cheatScan(db, fs, now = Date.now()) {
  if (!fs) return { scanned: false }
  const r = await db.transaction('cheatScan/last', (cur) => (Number(cur) && now - Number(cur) < SCAN_EVERY_MS ? undefined : now))
  if (!r.committed) return { scanned: false }
  return runCheatScan(db, fs, now)
}

// Everything the Leaderboard tab shows.
export async function leaderboardState(db, fs, now = Date.now()) {
  const [hidden, alerts, last, boards] = await Promise.all([
    db.get('liveConfig/hidden/players'),
    db.get('cheatAlerts'),
    db.get('cheatScan/last'),
    fs ? topBoards(fs) : {},
  ])
  const hiddenSet = hidden || {}
  for (const list of Object.values(boards)) {
    for (const r of list) {
      r.hidden = !!hiddenSet[r.uid]
      r.why = cheatReasons(r)
    }
  }
  return {
    hidden: Object.entries(hiddenSet).map(([uid, h]) => ({ uid, name: h?.name || '', pid: h?.pid || '', why: h?.why || '', at: h?.at || 0 })).sort((a, b) => b.at - a.at),
    alerts: Object.entries(alerts || {}).map(([id, a]) => ({ id, ...a, hidden: !!hiddenSet[a.uid] })).sort((a, b) => b.at - a.at),
    boards: BOARDS.map(([id, title, field, dir]) => ({ id, title, field, low: dir === 'ASCENDING', rows: boards[id] || [] })),
    lastScan: Number(last) || 0,
    nextScan: Number(last) ? Number(last) + SCAN_EVERY_MS : now,
    limits: { ...CHEAT_LIMITS, achievements: ACHIEVEMENTS.length },
  }
}

// Hide one account (uid), or every account with a Player ID (pid).
export async function hideFromBoards(db, fs, { uid, pid, name, why } = {}, now = Date.now()) {
  let targets
  if (validUid(uid)) targets = [{ uid, name: clean(name, 24), pid: validPid(pid) ? pid : '' }]
  else if (validPid(pid) && fs) targets = (await fs.accountsByPid(pid)).map((a) => ({ uid: a.uid, name: clean(a.nickname, 24), pid }))
  else throw new ServerError(400, 'bad-player')
  if (!targets.length) throw new ServerError(404, 'no-account')
  const w = clean(why, HIDE_WHY_MAX)
  await db.update(Object.fromEntries(targets.map((t) => [`liveConfig/hidden/players/${t.uid}`, { at: now, why: w, name: t.name, pid: t.pid }])))
  return { ok: true, hid: targets.length }
}

export async function unhideFromBoards(db, { uid } = {}) {
  if (!validUid(uid)) throw new ServerError(400, 'bad-player')
  await db.update({ [`liveConfig/hidden/players/${uid}`]: null })
  return { ok: true }
}

export async function dismissCheat(db, { id } = {}) {
  if (typeof id !== 'string' || !/^[a-z0-9]{4,40}$/.test(id)) throw new ServerError(400, 'bad-id')
  await db.update({ [`cheatAlerts/${id}`]: null })
  return { ok: true }
}

// The newest messages in both chat rooms, with each sender's Player ID
// (from their leaderboard doc) and auto-mod's rude flag.
export async function chatState(db, fs) {
  if (!fs) return { rooms: [] }
  const [rooms, rude] = await Promise.all([Promise.all(CHAT_ROOMS.map((r) => fs.recentChat(r, CHAT_LIMIT))), loadRudeChecker(db)])
  const uids = rooms.flat().map((m) => m.uid).filter((u) => u && u !== STAFF_UID)
  const accounts = await fs.boardRowsByUids(uids).catch(() => [])
  const pidOf = Object.fromEntries(accounts.map((a) => [a.uid, a.pid]))
  return {
    rooms: CHAT_ROOMS.map((room, i) => ({
      room,
      messages: rooms[i].map((m) => ({ ...m, pid: pidOf[m.uid] || '', staff: m.uid === STAFF_UID, rude: rude(m.text, m.nick) })),
    })),
  }
}

export async function deleteChatMessage(db, fs, { room, id } = {}) {
  if (!CHAT_ROOMS.includes(room) || typeof id !== 'string' || !/^[A-Za-z0-9]{6,40}$/.test(id)) throw new ServerError(400, 'bad-id')
  await fs.deleteChat(room, id)
  return { ok: true }
}
