// Admin controls (2026-11-12, Console batch 4): the homepage banner, the
// event switches, bans and player reports. Written against the same tiny
// database interface as servers.js (`db.get(path)`, `db.update(paths)`),
// so tests/servers.spec.js runs this very code on an in-memory copy.
//
// Two doors in:
//   api/live.js  - public: every player's page asks for the live config
//                  (banner, events, hidden maps, their own ban) and sends
//                  player reports.
//   api/admin.js - the Console only, locked with ADMIN_SECRET.
//
// Layout in the Realtime Database (not Firestore - no daily read limit):
//   liveConfig    { banner: { text, style, until, id },
//                   events: { doubleCoins, doubleXp, hordeNight, holiday },
//                   hidden: { maps: { CODE: true }, builds: { id: true } } }
//   bans/{pid}    { until (0 = forever), reason, nick, at }
//   playerReports/{id}  { target, targetName, by, byName, where, text, at }
//   reportLimits/{by}/{target}  when `by` last reported `target`
//   reportsSeen/{kind_id}  how many map/build reports there were when the
//                  Console last pressed Dismiss on it
//   serverPids/{serverId}/{slot}  the Player ID behind a server slot
//                  (servers.js writes it on create/join)
//   liveConfig.off { online|chat|market|sharing|gallery|leaderboards: true }
//                  feature off-switches (Console batch 5, "Safety")
//   liveConfig.maintenance { on, text, at }  maintenance screen
//   adminLog/{id}  { at, text } - the Console's action history, newest
//                  LOG_KEPT kept
//   warnings/{pid}/{id}  { text, at, seen } - a message from the team the
//                  player must press OK on (Console "Players" batch)
//   mutes/{pid}    { until (0 = forever), reason, nick, at, uids }
//                  chat mute. Checked here for server chat bubbles
//                  (servers.js syncServer) and by Firebase's rules for
//                  Global/Server/Clan chat: muting also writes
//                  chatMutes/{uid} in Firestore for every signed-in
//                  account whose leaderboard doc has this Player ID.
//   playerNotes/{pid}  { text, at } - the Console's private notes, never
//                  sent to any player
//   Live events (Console "Live events" batch), all inside liveConfig:
//   liveConfig.schedule/{id} { what, start, end, pct } - the event
//                  calendar: `what` (an EVENT_IDS id, a holiday or 'sale')
//                  is on between start and end by itself
//   liveConfig.sale { pct, until (0 = until stopped) } - Market sale:
//                  buyers pay pct% less, sellers still get their full price
//   liveConfig.staffMsg { id, text, at, until } - the latest staff message
//                  (a popup on open games; also posted to Global chat)
//   liveConfig.gift { id, coins, gems, text, until } - a surprise gift for
//                  everyone who has the game open before `until`
//   liveConfig.mapWeek { code, title, by } - the Console's Map of the
//                  Week (none = the game picks the most-liked by itself)
import { ServerError } from './servers.js'

export const EVENT_IDS = ['doubleCoins', 'doubleXp', 'hordeNight']
export const HOLIDAYS = ['halloween', 'christmas']
export const BANNER_STYLES = ['info', 'warning', 'celebrate']
export const BANNER_MAX = 200
// Minutes a ban lasts; 0 = forever. -1 = just a kick: out now, and kept
// out for KICK_MINUTES so the game's automatic rejoin doesn't put them
// straight back in.
export const BAN_MINUTES = [-1, 60, 1440, 10080, 0]
export const KICK_MINUTES = 2
// One report per player per target per this long.
export const REPORT_GAP_MS = 6 * 60 * 60 * 1000
const REPORTS_KEPT = 200
// Feature off-switches: each one pauses a part of the game for everyone
// (LiveConfig.switchedOff on the page; `online` is also enforced below in
// createServer/joinServer).
export const SWITCH_IDS = ['online', 'chat', 'market', 'sharing', 'gallery', 'leaderboards']
export const MAINT_TEXT_MAX = 200
const LOG_KEPT = 300
// What a backup holds and Restore puts back (servers come and go, so
// they're left out).
export const BACKUP_PATHS = ['liveConfig', 'bans', 'playerReports', 'reportsSeen', 'adminLog', 'warnings', 'mutes', 'playerNotes']
// Restore leaves the history alone: it stays a true record (including the
// Restore itself).
const RESTORE_PATHS = BACKUP_PATHS.filter((p) => p !== 'adminLog')
const BACKUP_MAX_CHARS = 2_000_000
// Chat mute lengths in minutes; 0 = forever.
export const MUTE_MINUTES = [60, 1440, 10080, 0]
export const WARNING_MAX = 300
const WARNINGS_KEPT = 20
export const NOTE_MAX = 2000

// A Player ID (Game.js _generatePlayerId) or a server slot id.
export function validPid(v) {
  return typeof v === 'string' && /^[A-Za-z0-9]{4,40}$/.test(v)
}

function cleanText(v, max) {
  if (typeof v !== 'string') return ''
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  return v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max)
}

const validCode = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(v)

function activeBan(ban, now) {
  if (!ban || typeof ban !== 'object') return null
  const until = Number(ban.until) || 0
  if (until && until <= now) return null
  return { until, reason: cleanText(ban.reason, 120), kick: ban.kick === true }
}

function liveBanner(b, now) {
  if (!b || typeof b !== 'object' || !b.text) return null
  if (b.until && b.until <= now) return null
  return { text: cleanText(b.text, BANNER_MAX), style: BANNER_STYLES.includes(b.style) ? b.style : 'info', until: Number(b.until) || 0, id: Number(b.id) || 0 }
}

function cleanEvents(e) {
  const out = {}
  for (const id of EVENT_IDS) out[id] = e?.[id] === true
  out.holiday = HOLIDAYS.includes(e?.holiday) ? e.holiday : null
  return out
}

// --- Live events: calendar, Market sale, staff message, gift, Map of
// the Week ---
export const SCHEDULE_WHAT = [...EVENT_IDS, ...HOLIDAYS, 'sale']
export const SALE_PCTS = [10, 20, 30, 50]
const SCHEDULE_MAX = 50
const SCHEDULE_MAX_DAYS = 31
// Ended calendar entries stay listed (as "ended") this long, then drop.
const SCHEDULE_KEEP_MS = 24 * 60 * 60 * 1000
export const STAFF_MAX = 200
// How long a staff message pops up on games opened after it was sent.
export const STAFF_POPUP_MS = 30 * 60 * 1000
// The Global chat sender id of a staff message (no sign-in account can
// have it: real ids are 28 random characters or start with a provider).
export const STAFF_UID = 'gayzTeam'
export const STAFF_NAME = 'GayZ Team'
export const GIFT_MINUTES = [15, 60, 1440]
export const GIFT_MAX = { coins: 100000, gems: 1000 }
const validMapCode = (v) => typeof v === 'string' && /^[A-Z0-9]{6}$/.test(v)

function cleanSchedule(all) {
  return Object.entries(all && typeof all === 'object' ? all : {})
    .filter(([id, e]) => validCode(id) && e && SCHEDULE_WHAT.includes(e.what) && Number(e.end) > Number(e.start))
    .map(([id, e]) => ({ id, what: e.what, start: Number(e.start), end: Number(e.end), pct: e.what === 'sale' && SALE_PCTS.includes(Number(e.pct)) ? Number(e.pct) : 0 }))
    .sort((a, b) => a.start - b.start)
}

// The switches + calendar together: { events, ends, sale }. `ends` holds
// when a calendar-only event stops (a Console switch has no end).
function liveEvents(cfg, now) {
  const events = cleanEvents(cfg?.events)
  const ends = {}
  let sale = null
  const s = cfg?.sale
  if (s && SALE_PCTS.includes(Number(s.pct)) && (!Number(s.until) || Number(s.until) > now)) sale = { pct: Number(s.pct), until: Number(s.until) || 0 }
  for (const e of cleanSchedule(cfg?.schedule)) {
    if (!(e.start <= now && now < e.end)) continue
    if (EVENT_IDS.includes(e.what)) {
      if (!events[e.what]) {
        events[e.what] = true
        ends[e.what] = e.end
      } else if (ends[e.what]) ends[e.what] = Math.max(ends[e.what], e.end)
    } else if (HOLIDAYS.includes(e.what)) {
      if (!events.holiday) {
        events.holiday = e.what
        ends.holiday = e.end
      }
    } else if (e.what === 'sale' && e.pct && (!sale || e.pct > sale.pct)) sale = { pct: e.pct, until: e.end }
  }
  return { events, ends, sale }
}

function liveStaffMsg(m, now) {
  if (!m || typeof m !== 'object' || !(Number(m.until) > now)) return null
  const text = cleanText(m.text, STAFF_MAX)
  return text && validCode(String(m.id)) ? { id: String(m.id), text } : null
}

function liveGift(g, now) {
  if (!g || typeof g !== 'object' || !(Number(g.until) > now) || !validCode(String(g.id))) return null
  const coins = Math.max(0, Math.min(GIFT_MAX.coins, Math.floor(Number(g.coins) || 0)))
  const gems = Math.max(0, Math.min(GIFT_MAX.gems, Math.floor(Number(g.gems) || 0)))
  if (!coins && !gems) return null
  return { id: String(g.id), coins, gems, text: cleanText(g.text, 120), until: Number(g.until) }
}

function liveMapWeek(m) {
  if (!m || typeof m !== 'object' || !validMapCode(m.code)) return null
  return { code: m.code, title: cleanText(m.title, 40), by: cleanText(m.by, 24) }
}

function cleanOff(o) {
  return SWITCH_IDS.filter((id) => o?.[id] === true)
}

function activeMute(m, now) {
  if (!m || typeof m !== 'object') return null
  const until = Number(m.until) || 0
  if (until && until <= now) return null
  return { until, reason: cleanText(m.reason, 120) }
}

// Warnings the player hasn't pressed OK on yet, oldest first.
function unseenWarnings(all) {
  return Object.entries(all || {})
    .filter(([id, w]) => validCode(id) && w && !w.seen && cleanText(w.text, WARNING_MAX))
    .map(([id, w]) => ({ id, text: cleanText(w.text, WARNING_MAX), at: Number(w.at) || 0 }))
    .sort((a, b) => a.at - b.at)
    .slice(0, 5)
}

// Is this Player ID chat-muted right now? (servers.js, for chat bubbles)
export async function isMuted(db, pid, now = Date.now()) {
  if (!validPid(pid)) return false
  return !!activeMute(await db.get(`mutes/${pid}`), now)
}

function liveMaintenance(m) {
  if (!m || typeof m !== 'object' || m.on !== true) return null
  return { text: cleanText(m.text, MAINT_TEXT_MAX), at: Number(m.at) || 0 }
}

// Servers are closed while Online is switched off or during maintenance
// (servers.js createServer/joinServer).
export async function onlineClosed(db) {
  const cfg = await db.get('liveConfig')
  return cfg?.off?.online === true || !!liveMaintenance(cfg?.maintenance)
}

// What every player's page gets (api/live.js). Only the asker's own ban,
// never the list.
export async function publicConfig(db, { pid } = {}, now = Date.now()) {
  const ok = validPid(pid)
  const [cfg, ban, mute, warnings] = await Promise.all([db.get('liveConfig'), ok ? db.get(`bans/${pid}`) : null, ok ? db.get(`mutes/${pid}`) : null, ok ? db.get(`warnings/${pid}`) : null])
  const live = liveEvents(cfg, now)
  return {
    banner: liveBanner(cfg?.banner, now),
    events: live.events,
    ends: live.ends,
    sale: live.sale,
    staffMsg: liveStaffMsg(cfg?.staffMsg, now),
    gift: liveGift(cfg?.gift, now),
    mapWeek: liveMapWeek(cfg?.mapWeek),
    hidden: {
      maps: Object.keys(cfg?.hidden?.maps || {}),
      builds: Object.keys(cfg?.hidden?.builds || {}),
    },
    ban: activeBan(ban, now),
    mute: activeMute(mute, now),
    warnings: unseenWarnings(warnings),
    off: cleanOff(cfg?.off),
    maintenance: liveMaintenance(cfg?.maintenance),
  }
}

// A player's Report button (chat's name popup). One per reporter per
// target every REPORT_GAP_MS; the oldest are dropped past REPORTS_KEPT.
export async function reportPlayer(db, body = {}, now = Date.now()) {
  const { target, by } = body
  if (!validPid(target) || !validPid(by) || target === by) throw new ServerError(400, 'bad-request')
  const last = Number(await db.get(`reportLimits/${by}/${target}`)) || 0
  if (last && now - last < REPORT_GAP_MS) return { ok: true, already: true }
  const id = `${now}${by}`
  await db.update({
    [`playerReports/${id}`]: {
      target,
      targetName: cleanText(body.targetName, 24),
      by,
      byName: cleanText(body.byName, 24),
      where: cleanText(body.where, 20),
      text: cleanText(body.text, 600),
      at: now,
    },
    [`reportLimits/${by}/${target}`]: now,
  })
  const all = (await db.get('playerReports')) || {}
  const ids = Object.keys(all).sort((a, b) => (all[a]?.at || 0) - (all[b]?.at || 0))
  if (ids.length > REPORTS_KEPT) {
    const drop = {}
    for (const old of ids.slice(0, ids.length - REPORTS_KEPT)) drop[`playerReports/${old}`] = null
    await db.update(drop)
  }
  return { ok: true }
}

// The player pressed OK on a warning (api/live.js).
export async function seenWarning(db, { pid, id } = {}, now = Date.now()) {
  if (!validPid(pid) || !validCode(id)) throw new ServerError(400, 'bad-request')
  const w = await db.get(`warnings/${pid}/${id}`)
  if (w && !w.seen) await db.update({ [`warnings/${pid}/${id}/seen`]: now })
  return { ok: true }
}

// Is this Player ID banned right now? (servers.js, on create/join)
export async function isBanned(db, pid, now = Date.now()) {
  if (!validPid(pid)) return false
  return !!activeBan(await db.get(`bans/${pid}`), now)
}

// --- The Console's side (api/admin.js) ---

// Everyone in a server right now: { serverId, name, mode, slot, nick, pid }.
async function serverPlayers(db, now) {
  const [servers, pids] = await Promise.all([db.get('servers'), db.get('serverPids')])
  const out = []
  for (const [serverId, s] of Object.entries(servers || {})) {
    for (const [slot, p] of Object.entries(s?.players || {})) {
      if (!p || now - (p.t || 0) >= 10000) continue
      out.push({ serverId, name: cleanText(s.name, 24), mode: s.mode || 'main', slot, nick: cleanText(p.nick, 20), pid: pids?.[serverId]?.[slot] || null })
    }
  }
  return out
}

// Map/build reports from Firestore, grouped. `fs` is firestoreRest.js
// (or a fake in tests); null skips them.
async function contentReports(db, fs, hidden) {
  if (!fs) return { list: [], error: null }
  try {
    const [rows, seen] = await Promise.all([fs.reports(), db.get('reportsSeen')])
    return {
      error: null,
      list: rows
        .map((r) => ({ ...r, key: `${r.kind}_${r.id}`, hidden: !!hidden?.[r.kind === 'map' ? 'maps' : 'builds']?.[r.id] }))
        .filter((r) => r.count > (Number(seen?.[r.key]) || 0) || r.hidden)
        .sort((a, b) => b.latest - a.latest),
    }
  } catch (err) {
    return { list: [], error: String(err?.message || err).slice(0, 200) }
  }
}

export async function adminState(db, fs, now = Date.now()) {
  const [cfg, bans, reports, players, log] = await Promise.all([db.get('liveConfig'), db.get('bans'), db.get('playerReports'), serverPlayers(db, now), db.get('adminLog')])
  const content = await contentReports(db, fs, cfg?.hidden)
  return {
    banner: cfg?.banner || null,
    bannerLive: !!liveBanner(cfg?.banner, now),
    events: cleanEvents(cfg?.events),
    bans: Object.entries(bans || {})
      .filter(([, b]) => activeBan(b, now))
      .map(([pid, b]) => ({ pid, nick: cleanText(b.nick, 24), reason: cleanText(b.reason, 120), until: Number(b.until) || 0, at: Number(b.at) || 0, kick: b.kick === true })),
    playerReports: Object.entries(reports || {})
      .map(([id, r]) => ({ id, ...r }))
      .sort((a, b) => (b.at || 0) - (a.at || 0)),
    contentReports: content.list,
    contentReportsError: content.error,
    players,
    mutes: await mutedList(db, now),
    off: cleanOff(cfg?.off),
    maintenance: liveMaintenance(cfg?.maintenance),
    liveNow: liveEvents(cfg, now),
    schedule: cleanSchedule(cfg?.schedule).filter((e) => e.end > now - SCHEDULE_KEEP_MS).map((e) => ({ ...e, state: e.end <= now ? 'ended' : e.start <= now ? 'live' : 'soon' })),
    sale: cfg?.sale && SALE_PCTS.includes(Number(cfg.sale.pct)) && (!Number(cfg.sale.until) || Number(cfg.sale.until) > now) ? { pct: Number(cfg.sale.pct), until: Number(cfg.sale.until) || 0 } : null,
    staffMsg: cfg?.staffMsg && typeof cfg.staffMsg === 'object' ? { text: cleanText(cfg.staffMsg.text, STAFF_MAX), at: Number(cfg.staffMsg.at) || 0, error: cleanText(cfg.staffMsg.error, 200) } : null,
    gift: liveGift(cfg?.gift, now),
    mapWeek: liveMapWeek(cfg?.mapWeek),
    history: Object.values(log || {})
      .map((e) => ({ at: Number(e?.at) || 0, text: cleanText(e?.text, 300) }))
      .sort((a, b) => b.at - a.at),
  }
}

export async function setBanner(db, { text, style, minutes } = {}, now = Date.now()) {
  const clean = cleanText(text, BANNER_MAX)
  if (!clean) {
    await db.update({ 'liveConfig/banner': null })
    return { ok: true }
  }
  const mins = Math.max(0, Math.min(60 * 24 * 60, Number(minutes) || 0))
  await db.update({
    'liveConfig/banner': { text: clean, style: BANNER_STYLES.includes(style) ? style : 'info', until: mins ? now + mins * 60000 : 0, id: now },
  })
  return { ok: true }
}

export async function setEvents(db, events = {}) {
  await db.update({ 'liveConfig/events': cleanEvents(events) })
  return { ok: true }
}

// Out of every server they're in now (by Player ID, or just the one slot
// when the old page didn't send its Player ID), and banned for `minutes`
// (0 forever, -1 just a kick, see BAN_MINUTES).
export async function kickPlayer(db, { pid, serverId, slot, minutes, reason, nick } = {}, now = Date.now()) {
  const mins = Number(minutes)
  if (!BAN_MINUTES.includes(mins)) throw new ServerError(400, 'bad-minutes')
  if (!validPid(pid) && !(validPid(serverId) && validPid(slot))) throw new ServerError(400, 'bad-request')
  const updates = {}
  const out = (sid, sl) => {
    updates[`servers/${sid}/players/${sl}`] = null
    updates[`serverSecrets/${sid}/${sl}`] = null
    updates[`serverSkins/${sid}/${sl}`] = null
    updates[`serverPids/${sid}/${sl}`] = null
  }
  if (validPid(serverId) && validPid(slot)) out(serverId, slot)
  if (validPid(pid)) {
    const all = (await db.get('serverPids')) || {}
    for (const [sid, slots] of Object.entries(all)) {
      for (const [sl, p] of Object.entries(slots || {})) if (p === pid) out(sid, sl)
    }
    const len = mins === -1 ? KICK_MINUTES : mins
    updates[`bans/${pid}`] = { until: len ? now + len * 60000 : 0, reason: cleanText(reason, 120) || (mins === -1 ? 'Kicked' : ''), nick: cleanText(nick, 24), at: now, ...(mins === -1 ? { kick: true } : {}) }
  }
  await db.update(updates)
  return { ok: true, banned: validPid(pid) }
}

export async function unban(db, { pid } = {}) {
  if (!validPid(pid)) throw new ServerError(400, 'bad-request')
  await db.update({ [`bans/${pid}`]: null })
  return { ok: true }
}

export async function dismissPlayerReport(db, { id } = {}) {
  if (!validCode(id)) throw new ServerError(400, 'bad-request')
  await db.update({ [`playerReports/${id}`]: null })
  return { ok: true }
}

// Dismiss on a map/build: out of the list until a new report comes in.
export async function dismissContentReport(db, { kind, id, count } = {}) {
  if (!['map', 'build'].includes(kind) || !validCode(id)) throw new ServerError(400, 'bad-request')
  await db.update({ [`reportsSeen/${kind}_${id}`]: Math.max(0, Math.floor(Number(count) || 0)) })
  return { ok: true }
}

// Hide takes a map/build off every player's lists (CloudSync filters by
// liveConfig.hidden); nothing is deleted, Unhide puts it back.
export async function hideContent(db, { kind, id, hide } = {}) {
  if (!['map', 'build'].includes(kind) || !validCode(id)) throw new ServerError(400, 'bad-request')
  await db.update({ [`liveConfig/hidden/${kind === 'map' ? 'maps' : 'builds'}/${id}`]: hide === false ? null : true })
  return { ok: true }
}

// Feature off-switches: `off` lists the ids to switch off; every other one
// is switched back on.
export async function setSwitches(db, { off } = {}) {
  const list = Array.isArray(off) ? off : []
  const out = {}
  for (const id of SWITCH_IDS) if (list.includes(id)) out[id] = true
  await db.update({ 'liveConfig/off': Object.keys(out).length ? out : null })
  return { ok: true }
}

export async function setMaintenance(db, { on, text } = {}, now = Date.now()) {
  await db.update({ 'liveConfig/maintenance': on === true ? { on: true, text: cleanText(text, MAINT_TEXT_MAX), at: now } : null })
  return { ok: true }
}

// One line in the action history; the oldest drop off past LOG_KEPT.
export async function logAction(db, text, now = Date.now()) {
  const clean = cleanText(text, 300)
  if (!clean) return
  await db.update({ [`adminLog/${now}${Math.random().toString(36).slice(2, 6)}`]: { at: now, text: clean } })
  const all = (await db.get('adminLog')) || {}
  const ids = Object.keys(all).sort((a, b) => (all[a]?.at || 0) - (all[b]?.at || 0))
  if (ids.length > LOG_KEPT) {
    const drop = {}
    for (const old of ids.slice(0, ids.length - LOG_KEPT)) drop[`adminLog/${old}`] = null
    await db.update(drop)
  }
}

// --- Players (Console "Players" batch): lookup card, warnings, chat
// mutes, private notes ---

const validUid = (v) => typeof v === 'string' && /^[A-Za-z0-9]{1,128}$/.test(v)
const MUTE_NAMES = { 60: '1 hour', 1440: '1 day', 10080: '7 days', 0: 'forever' }

// Notes keep their line breaks (cleanText would drop them).
function cleanNote(v) {
  if (typeof v !== 'string') return ''
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f<>]/g, '').trim().slice(0, NOTE_MAX)
}

async function mutedList(db, now) {
  const all = (await db.get('mutes')) || {}
  return Object.entries(all)
    .filter(([pid, m]) => validPid(pid) && activeMute(m, now))
    .map(([pid, m]) => ({ pid, nick: cleanText(m.nick, 24), reason: cleanText(m.reason, 120), until: Number(m.until) || 0, at: Number(m.at) || 0, accounts: Object.keys(m.uids || {}).length }))
    .sort((a, b) => b.at - a.at)
}

// The signed-in accounts (Firestore leaderboard docs) with this Player ID.
// `fs` is firestoreRest.js or a fake; errors come back as text.
async function accountsFor(fs, pid) {
  if (!fs?.accountsByPid) return { list: [], error: null }
  try {
    return { list: (await fs.accountsByPid(pid)).filter((a) => validUid(a?.uid)), error: null }
  } catch (err) {
    return { list: [], error: String(err?.message || err).slice(0, 200) }
  }
}

// Every Player ID the Console has seen, with the names it went by.
async function knownPlayers(db, now) {
  const [bans, reports, mutes, warnings, notes, players] = await Promise.all([db.get('bans'), db.get('playerReports'), db.get('mutes'), db.get('warnings'), db.get('playerNotes'), serverPlayers(db, now)])
  const known = new Map()
  const add = (pid, nick) => {
    if (!validPid(pid)) return
    if (!known.has(pid)) known.set(pid, new Set())
    const n = cleanText(nick, 24)
    if (n) known.get(pid).add(n)
  }
  for (const [pid, b] of Object.entries(bans || {})) add(pid, b?.nick)
  for (const [pid, m] of Object.entries(mutes || {})) add(pid, m?.nick)
  for (const r of Object.values(reports || {})) {
    add(r?.target, r?.targetName)
    add(r?.by, r?.byName)
  }
  for (const pid of Object.keys(warnings || {})) add(pid)
  for (const pid of Object.keys(notes || {})) add(pid)
  for (const p of players) add(p.pid, p.nick)
  return { known, reports: reports || {}, players }
}

// Everything about one Player ID, for the Console's player card.
export async function playerCard(db, fs, pid, now = Date.now()) {
  if (!validPid(pid)) throw new ServerError(400, 'bad-request')
  const [{ known, reports, players }, ban, mute, warnings, note, accounts] = await Promise.all([
    knownPlayers(db, now),
    db.get(`bans/${pid}`),
    db.get(`mutes/${pid}`),
    db.get(`warnings/${pid}`),
    db.get(`playerNotes/${pid}`),
    accountsFor(fs, pid),
  ])
  const nicks = new Set(known.get(pid) || [])
  for (const a of accounts.list) if (cleanText(a.nickname, 24)) nicks.add(cleanText(a.nickname, 24))
  const reportList = Object.entries(reports).map(([id, r]) => ({ id, ...r })).sort((a, b) => (b.at || 0) - (a.at || 0))
  const liveBan = activeBan(ban, now)
  const liveMute = activeMute(mute, now)
  return {
    pid,
    nicks: [...nicks],
    online: players.filter((p) => p.pid === pid),
    ban: liveBan ? { ...liveBan, at: Number(ban.at) || 0 } : null,
    mute: liveMute ? { ...liveMute, at: Number(mute.at) || 0, accounts: Object.keys(mute.uids || {}).length } : null,
    warnings: Object.entries(warnings || {})
      .map(([id, w]) => ({ id, text: cleanText(w?.text, WARNING_MAX), at: Number(w?.at) || 0, seen: Number(w?.seen) || 0 }))
      .sort((a, b) => b.at - a.at),
    note: note && typeof note === 'object' ? { text: cleanNote(note.text), at: Number(note.at) || 0 } : null,
    reportsAgainst: reportList.filter((r) => r.target === pid),
    reportsBy: reportList.filter((r) => r.by === pid),
    accounts: accounts.list.map((a) => ({ uid: a.uid, nickname: cleanText(a.nickname, 24), bestNight: Number(a.bestNight) || 0, lastActiveAt: Number(a.lastActiveAt) || 0, clanId: cleanText(a.clanId, 40) })),
    accountsError: accounts.error,
  }
}

// The Console's search box: a Player ID (with or without #) or part of a
// name. One match -> { card }; several -> { matches } to pick from.
export async function lookupPlayer(db, fs, { query } = {}, now = Date.now()) {
  const q = cleanText(query, 40).replace(/^#/, '')
  if (!q) throw new ServerError(400, 'bad-request')
  const { known } = await knownPlayers(db, now)
  const found = new Map()
  const add = (pid, nick) => {
    if (!validPid(pid)) return
    if (!found.has(pid)) found.set(pid, new Set(known.get(pid) || []))
    if (cleanText(nick, 24)) found.get(pid).add(cleanText(nick, 24))
  }
  if (known.has(q)) add(q)
  const lower = q.toLowerCase()
  for (const [pid, nicks] of known) if ([...nicks].some((n) => n.toLowerCase().includes(lower))) add(pid)
  let fsError = null
  if (fs?.accountsByName && fs?.accountsByPid) {
    try {
      const [byPid, byName] = await Promise.all([validPid(q) ? fs.accountsByPid(q) : [], fs.accountsByName(q)])
      if (byPid.length) add(q, byPid[0]?.nickname)
      for (const a of byName) add(a?.playerId, a?.nickname)
    } catch (err) {
      fsError = String(err?.message || err).slice(0, 200)
    }
  }
  // A Player ID nobody has seen yet still gets a card (to warn, mute or
  // write notes ahead of time).
  if (!found.size && validPid(q)) add(q)
  if (found.size === 1) return { card: await playerCard(db, fs, [...found.keys()][0], now), fsError }
  return { matches: [...found].slice(0, 30).map(([pid, nicks]) => ({ pid, nicks: [...nicks] })), fsError }
}

export async function warnPlayer(db, { pid, text, nick } = {}, now = Date.now()) {
  const clean = cleanText(text, WARNING_MAX)
  if (!validPid(pid) || !clean) throw new ServerError(400, 'bad-request')
  const id = `${now}${Math.random().toString(36).slice(2, 6)}`
  await db.update({ [`warnings/${pid}/${id}`]: { text: clean, at: now, seen: 0, nick: cleanText(nick, 24) } })
  const all = (await db.get(`warnings/${pid}`)) || {}
  const ids = Object.keys(all).sort((a, b) => (all[a]?.at || 0) - (all[b]?.at || 0))
  if (ids.length > WARNINGS_KEPT) {
    const drop = {}
    for (const old of ids.slice(0, ids.length - WARNINGS_KEPT)) drop[`warnings/${pid}/${old}`] = null
    await db.update(drop)
  }
  return { ok: true, id }
}

export async function deleteWarning(db, { pid, id } = {}) {
  if (!validPid(pid) || !validCode(id)) throw new ServerError(400, 'bad-request')
  await db.update({ [`warnings/${pid}/${id}`]: null })
  return { ok: true }
}

// Chat mute: the Realtime Database record (server chat bubbles + the
// player's own page) and a chatMutes/{uid} doc in Firestore for each
// signed-in account with this Player ID (Firebase's rules then refuse
// their Global/Server/Clan messages). A Firestore hiccup doesn't undo
// the rest; it comes back as `error`.
export async function mutePlayer(db, fs, { pid, minutes, reason, nick } = {}, now = Date.now()) {
  const mins = Number(minutes)
  if (!MUTE_MINUTES.includes(mins)) throw new ServerError(400, 'bad-minutes')
  if (!validPid(pid)) throw new ServerError(400, 'bad-request')
  const old = await db.get(`mutes/${pid}`)
  const accounts = await accountsFor(fs, pid)
  const uids = {}
  for (const uid of Object.keys(old?.uids || {})) if (validUid(uid)) uids[uid] = true
  for (const a of accounts.list) uids[a.uid] = true
  const until = mins ? now + mins * 60000 : 0
  await db.update({ [`mutes/${pid}`]: { until, reason: cleanText(reason, 120), nick: cleanText(nick, 24), at: now, uids: Object.keys(uids).length ? uids : null } })
  let error = accounts.error
  if (fs?.setChatMute) {
    for (const uid of Object.keys(uids)) {
      try {
        await fs.setChatMute(uid, until, now)
      } catch (err) {
        error = String(err?.message || err).slice(0, 200)
      }
    }
  }
  return { ok: true, accounts: Object.keys(uids).length, error }
}

export async function unmutePlayer(db, fs, { pid } = {}) {
  if (!validPid(pid)) throw new ServerError(400, 'bad-request')
  const old = await db.get(`mutes/${pid}`)
  await db.update({ [`mutes/${pid}`]: null })
  let error = null
  if (fs?.clearChatMute) {
    for (const uid of Object.keys(old?.uids || {})) {
      if (!validUid(uid)) continue
      try {
        await fs.clearChatMute(uid)
      } catch (err) {
        error = String(err?.message || err).slice(0, 200)
      }
    }
  }
  return { ok: true, error }
}

// Private notes: only ever shown in the Console. Empty text deletes them.
export async function setNote(db, { pid, text } = {}, now = Date.now()) {
  if (!validPid(pid)) throw new ServerError(400, 'bad-request')
  const clean = cleanNote(text)
  await db.update({ [`playerNotes/${pid}`]: clean ? { text: clean, at: now } : null })
  return { ok: true }
}

// After a Restore: Firestore's chatMutes made to match the restored mutes.
async function syncChatMutes(fs, before, after, now) {
  if (!fs?.setChatMute || !fs?.clearChatMute) return null
  const want = new Map()
  for (const m of Object.values(after || {})) {
    if (!activeMute(m, now)) continue
    for (const uid of Object.keys(m?.uids || {})) if (validUid(uid)) want.set(uid, Number(m.until) || 0)
  }
  const had = new Set()
  for (const m of Object.values(before || {})) for (const uid of Object.keys(m?.uids || {})) if (validUid(uid)) had.add(uid)
  let error = null
  const run = async (fn) => {
    try {
      await fn()
    } catch (err) {
      error = String(err?.message || err).slice(0, 200)
    }
  }
  for (const [uid, until] of want) await run(() => fs.setChatMute(uid, until, now))
  for (const uid of had) if (!want.has(uid)) await run(() => fs.clearChatMute(uid))
  return error
}

export async function backup(db, now = Date.now()) {
  const values = await Promise.all(BACKUP_PATHS.map((p) => db.get(p)))
  const data = {}
  BACKUP_PATHS.forEach((p, i) => { data[p] = values[i] ?? null })
  return { gayzBackup: 1, at: now, data }
}

// Puts a backup file back exactly: every RESTORE_PATHS part is replaced
// (a part the file doesn't have is emptied). The Console downloads a fresh
// backup of what's there first, so a Restore can itself be undone.
export async function restore(db, { file } = {}, fs = null, now = Date.now()) {
  if (!file || typeof file !== 'object' || file.gayzBackup !== 1 || !file.data || typeof file.data !== 'object') throw new ServerError(400, 'bad-backup')
  if (JSON.stringify(file).length > BACKUP_MAX_CHARS) throw new ServerError(400, 'bad-backup')
  const updates = {}
  for (const p of RESTORE_PATHS) {
    const v = file.data[p]
    if (v != null && (typeof v !== 'object' || Array.isArray(v))) throw new ServerError(400, 'bad-backup')
    updates[p] = v ?? null
  }
  const mutesBefore = await db.get('mutes')
  await db.update(updates)
  const error = await syncChatMutes(fs, mutesBefore, updates.mutes, now)
  return { ok: true, at: Number(file.at) || 0, error }
}

// --- Live events (the Console's side) ---

// A calendar entry: `what` turns on at `start` and off at `end` by itself.
export async function addSchedule(db, { what, start, end, pct } = {}, now = Date.now()) {
  const st = Math.floor(Number(start))
  const en = Math.floor(Number(end))
  if (!SCHEDULE_WHAT.includes(what) || !(st > 0) || !(en > st) || en <= now) throw new ServerError(400, 'bad-request')
  if (en - st > SCHEDULE_MAX_DAYS * 86400000) throw new ServerError(400, 'too-long')
  if (what === 'sale' && !SALE_PCTS.includes(Number(pct))) throw new ServerError(400, 'bad-request')
  const all = (await db.get('liveConfig/schedule')) || {}
  const updates = {}
  // Long-ended ones are tidied away on each add.
  for (const [id, e] of Object.entries(all)) if (!(Number(e?.end) > now - SCHEDULE_KEEP_MS)) updates[`liveConfig/schedule/${id}`] = null
  if (Object.keys(all).length - Object.keys(updates).length >= SCHEDULE_MAX) throw new ServerError(400, 'too-many')
  const id = `${now}${Math.random().toString(36).slice(2, 6)}`
  updates[`liveConfig/schedule/${id}`] = { what, start: st, end: en, ...(what === 'sale' ? { pct: Number(pct) } : {}) }
  await db.update(updates)
  return { ok: true, id }
}

export async function removeSchedule(db, { id } = {}) {
  if (!validCode(id)) throw new ServerError(400, 'bad-request')
  await db.update({ [`liveConfig/schedule/${id}`]: null })
  return { ok: true }
}

// Market sale now: pct 0 stops it; minutes 0 = until stopped.
export async function setSale(db, { pct, minutes } = {}, now = Date.now()) {
  const p = Number(pct)
  if (!p) {
    await db.update({ 'liveConfig/sale': null })
    return { ok: true }
  }
  if (!SALE_PCTS.includes(p)) throw new ServerError(400, 'bad-request')
  const mins = Math.max(0, Math.min(SCHEDULE_MAX_DAYS * 1440, Number(minutes) || 0))
  await db.update({ 'liveConfig/sale': { pct: p, until: mins ? now + mins * 60000 : 0 } })
  return { ok: true }
}

// A staff message: a popup on every open game (and ones opened in the
// next STAFF_POPUP_MS) plus a gold line in Global chat (both the in-game
// and the homepage rooms). A chat hiccup doesn't stop the popup; it comes
// back as `error`.
export async function staffMessage(db, fs, { text } = {}, now = Date.now()) {
  const clean = cleanText(text, STAFF_MAX)
  if (!clean) throw new ServerError(400, 'bad-request')
  let error = null
  if (fs?.postStaffChat) {
    try {
      await fs.postStaffChat(STAFF_UID, STAFF_NAME, clean, now)
    } catch (err) {
      error = String(err?.message || err).slice(0, 200)
    }
  }
  await db.update({ 'liveConfig/staffMsg': { id: `${now}`, text: clean, at: now, until: now + STAFF_POPUP_MS, ...(error ? { error } : {}) } })
  return { ok: true, error }
}

// A surprise gift: everyone who has the game open before it ends gets it
// once. `cancel` takes it back off (anyone who already got it keeps it).
export async function sendGift(db, { coins, gems, minutes, text, cancel } = {}, now = Date.now()) {
  if (cancel === true) {
    await db.update({ 'liveConfig/gift': null })
    return { ok: true }
  }
  const c = Math.floor(Number(coins) || 0)
  const g = Math.floor(Number(gems) || 0)
  const mins = Number(minutes)
  if (c < 0 || g < 0 || c > GIFT_MAX.coins || g > GIFT_MAX.gems || (!c && !g) || !GIFT_MINUTES.includes(mins)) throw new ServerError(400, 'bad-request')
  await db.update({ 'liveConfig/gift': { id: `${now}`, coins: c, gems: g, text: cleanText(text, 120), until: now + mins * 60000, at: now } })
  return { ok: true }
}

// Map of the Week: a map code (title/by shown when the Gallery has no
// post for it), or an empty code for "pick by itself".
export async function setMapWeek(db, { code, title, by } = {}) {
  if (!code) {
    await db.update({ 'liveConfig/mapWeek': null })
    return { ok: true }
  }
  const c = String(code).trim().toUpperCase()
  if (!validMapCode(c)) throw new ServerError(400, 'bad-code')
  await db.update({ 'liveConfig/mapWeek': { code: c, title: cleanText(title, 40), by: cleanText(by, 24) } })
  return { ok: true }
}

// The Gallery's map posts, for the Console's picker.
export async function mapPosts(fs) {
  if (!fs?.galleryMaps) return { list: [], error: null }
  try {
    return { list: (await fs.galleryMaps()).filter((p) => validMapCode(p?.mapCode)), error: null }
  } catch (err) {
    return { list: [], error: String(err?.message || err).slice(0, 200) }
  }
}

const WHAT_NAMES = { doubleCoins: 'Double Coins', doubleXp: 'Double XP', hordeNight: 'Horde Night', halloween: 'Halloween look', christmas: 'Christmas look', sale: 'Market sale' }

const FEATURE_NAMES = { online: 'Online servers', chat: 'Chat', market: 'Market', sharing: 'Map & build sharing', gallery: 'Gallery', leaderboards: 'Leaderboards' }
const BAN_NAMES = { '-1': 'Kicked', 60: 'Banned 1 hour', 1440: 'Banned 1 day', 10080: 'Banned 7 days', 0: 'Banned forever' }
const day = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ')

// The history line for each change (reads like state/backup log nothing).
const LOG_TEXT = {
  banner: (b) => (cleanText(b.text, BANNER_MAX) ? `Banner shown: "${cleanText(b.text, 80)}"` : 'Banner removed'),
  events: (b) => {
    const e = cleanEvents(b.events)
    const on = EVENT_IDS.filter((id) => e[id]).concat(e.holiday ? [`Holiday: ${e.holiday}`] : [])
    return `Events saved: ${on.length ? on.join(', ') : 'all off'}`
  },
  kick: (b) => `${BAN_NAMES[Number(b.minutes)] || 'Kicked'}: ${cleanText(b.nick, 24) || '?'}${validPid(b.pid) ? ` #${b.pid}` : ''}${cleanText(b.reason, 60) ? ` ("${cleanText(b.reason, 60)}")` : ''}`,
  unban: (b) => `Unbanned #${b.pid}`,
  dismissPlayerReport: () => 'Dismissed a player report',
  dismissContentReport: (b) => `Dismissed reports on ${b.kind} ${b.id}`,
  hide: (b) => `${b.hide === false ? 'Unhid' : 'Hid'} ${b.kind} ${b.id}`,
  switches: (b) => {
    const off = SWITCH_IDS.filter((id) => Array.isArray(b.off) && b.off.includes(id))
    return off.length ? `Switched off: ${off.map((id) => FEATURE_NAMES[id]).join(', ')}` : 'Every feature switched on'
  },
  maintenance: (b) => (b.on === true ? `Maintenance ON${cleanText(b.text, 80) ? `: "${cleanText(b.text, 80)}"` : ''}` : 'Maintenance OFF'),
  backup: () => 'Downloaded a backup',
  warn: (b) => `Warned ${cleanText(b.nick, 24) || '?'} #${b.pid}: "${cleanText(b.text, 80)}"`,
  deleteWarning: (b) => `Deleted a warning for #${b.pid}`,
  mute: (b) => `Chat-muted ${cleanText(b.nick, 24) || '?'} #${b.pid} for ${MUTE_NAMES[Number(b.minutes)] || '?'}${cleanText(b.reason, 60) ? ` ("${cleanText(b.reason, 60)}")` : ''}`,
  unmute: (b) => `Unmuted #${b.pid}`,
  // The note itself stays private - only that it changed.
  note: (b) => `${cleanNote(b.text) ? 'Edited' : 'Deleted'} the notes on #${b.pid}`,
  // `label`: the backup's time in the Console's own time zone.
  scheduleAdd: (b) => `Planned ${WHAT_NAMES[b.what] || '?'}${b.what === 'sale' ? ` ${Number(b.pct)}%` : ''}: ${day(Number(b.start) || 0)} to ${day(Number(b.end) || 0)} UTC`,
  scheduleRemove: () => 'Removed a planned event',
  sale: (b) => (Number(b.pct) ? `Market sale ON: ${Number(b.pct)}% off${Number(b.minutes) ? ` for ${Math.round(Number(b.minutes) / 60)} h` : ''}` : 'Market sale OFF'),
  staffMessage: (b) => `Staff message: "${cleanText(b.text, 80)}"`,
  gift: (b) => (b.cancel === true ? 'Surprise gift stopped' : `Surprise gift: ${Math.floor(Number(b.coins) || 0)} coins, ${Math.floor(Number(b.gems) || 0)} gems`),
  mapWeek: (b) => (b.code ? `Map of the Week set to ${String(b.code).toUpperCase()}` : 'Map of the Week back to automatic'),
  restore: (b) => `Restored the backup from ${cleanText(b.label, 40) || (Number(b.file?.at) ? `${day(Number(b.file.at))} UTC` : '?')}`,
}

const ACTION_FNS = {
  state: (db, body, fs) => adminState(db, fs),
  banner: (db, body) => setBanner(db, body),
  events: (db, body) => setEvents(db, body.events),
  kick: (db, body) => kickPlayer(db, body),
  unban: (db, body) => unban(db, body),
  dismissPlayerReport: (db, body) => dismissPlayerReport(db, body),
  dismissContentReport: (db, body) => dismissContentReport(db, body),
  hide: (db, body) => hideContent(db, body),
  switches: (db, body) => setSwitches(db, body),
  maintenance: (db, body) => setMaintenance(db, body),
  backup: (db) => backup(db),
  restore: (db, body, fs) => restore(db, body, fs),
  lookup: (db, body, fs) => lookupPlayer(db, fs, body),
  card: (db, body, fs) => playerCard(db, fs, body.pid),
  warn: (db, body) => warnPlayer(db, body),
  deleteWarning: (db, body) => deleteWarning(db, body),
  mute: (db, body, fs) => mutePlayer(db, fs, body),
  unmute: (db, body, fs) => unmutePlayer(db, fs, body),
  note: (db, body) => setNote(db, body),
  scheduleAdd: (db, body) => addSchedule(db, body),
  scheduleRemove: (db, body) => removeSchedule(db, body),
  sale: (db, body) => setSale(db, body),
  staffMessage: (db, body, fs) => staffMessage(db, fs, body),
  gift: (db, body) => sendGift(db, body),
  mapWeek: (db, body) => setMapWeek(db, body),
  mapPosts: (db, body, fs) => mapPosts(fs),
}

// Every change also adds its line to the history - after it worked, and
// a history hiccup never undoes or fails the change itself.
export const ADMIN_ACTIONS = Object.fromEntries(
  Object.entries(ACTION_FNS).map(([name, fn]) => [
    name,
    async (db, body, fs) => {
      const result = await fn(db, body, fs)
      if (LOG_TEXT[name]) await logAction(db, LOG_TEXT[name](body || {})).catch(() => {})
      return result
    },
  ])
)
