// Player inbox (2026-11-13): the homepage Feedback box, quick polls, the
// game's own error reports, and private alerts to the owner's Discord.
// Same tiny database interface as servers.js / admin.js (get, update,
// increment, transaction), so tests/servers.spec.js runs it on an
// in-memory copy.
//
// Layout in the Realtime Database (no daily read limit):
//   feedback/{id}   { kind: idea|bug|other, text, pid, nick, info, at, done }
//                   `info` (bugs only) = device, browser, screen, language,
//                   build - what the old "Copy Bug Report" button gave
//   feedbackLimits/{pid} { n, at }  messages sent this hour (spam limit)
//   liveConfig.poll { id, q, options: [..], until }  the poll running now
//                   (players see it once, in a popup on the homepage)
//   polls/{id}      { q, options, at, until, ended }  every poll, for results
//   pollVotes/{id}/{pid}  the option number this player picked (once each)
//   errors/{key}    { msg, where, build, count, first, last, phone,
//                   computer, alerted } - one row per kind of error
//   alertBudget     { hour, n }  alerts sent this hour (at most ALERTS_PER_HOUR)
//   alertLimits/{what}  when that thing last sent an alert
//
// Alerts go to DISCORD_ALERT_WEBHOOK (a Vercel Environment Variable, never
// in code). Without it nothing is sent and everything else still works.
import crypto from 'node:crypto'
import { ServerError } from './servers.js'

export const FEEDBACK_KINDS = ['idea', 'bug', 'other']
export const FEEDBACK_MAX = 1000
export const FEEDBACK_PER_HOUR = 5
const FEEDBACK_KEPT = 300
export const POLL_Q_MAX = 150
export const POLL_OPTION_MAX = 60
export const POLL_HOURS = [24, 72, 168]
const POLLS_SHOWN = 10
const ERRORS_KEPT = 150
// An error's count passing one of these sends an "error spike" alert.
export const ERROR_SPIKES = [25, 100, 500, 2000]
export const ALERTS_PER_HOUR = 20
const HOUR = 60 * 60 * 1000

function validPid(v) {
  return typeof v === 'string' && /^[A-Za-z0-9]{4,40}$/.test(v)
}
const validId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(v)

function cleanText(v, max) {
  if (typeof v !== 'string') return ''
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  return v.replace(/[\u0000-\u0009\u000b-\u001f<>]/g, '').trim().slice(0, max)
}
const oneLine = (v, max) => cleanText(v, max).replace(/\n+/g, ' ')

// --- Alerts ---

export function alertsSetUp() {
  return /^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\//.test((process.env.DISCORD_ALERT_WEBHOOK || '').trim())
}

// One message to the owner's private Discord channel. Never pings anyone
// (player words could hold @everyone), at most ALERTS_PER_HOUR an hour,
// and a failure never breaks what the player was doing.
export async function sendAlert(db, text, now = Date.now()) {
  if (!alertsSetUp()) return false
  const hour = Math.floor(now / HOUR)
  try {
    const r = await db.transaction('alertBudget', (cur) => {
      const n = cur && cur.hour === hour ? Number(cur.n) || 0 : 0
      if (n >= ALERTS_PER_HOUR) return undefined
      return { hour, n: n + 1 }
    })
    if (!r.committed) return false
    const res = await fetch(process.env.DISCORD_ALERT_WEBHOOK.trim(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: String(text).slice(0, 1900), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(4000),
    })
    return res.ok
  } catch {
    return false
  }
}

// At most one alert per `what` every `gapMs`.
async function alertOnce(db, what, gapMs, text, now) {
  if (!alertsSetUp()) return false
  const last = Number(await db.get(`alertLimits/${what}`)) || 0
  if (last && now - last < gapMs) return false
  await db.update({ [`alertLimits/${what}`]: now })
  return sendAlert(db, text, now)
}

const who = (name, pid) => `${oneLine(name, 24) || '?'} #${pid}`

// A player report (admin.js reportPlayer calls this after saving it).
export function reportAlert(db, r, now = Date.now()) {
  const text = oneLine(r.text, 300)
  return sendAlert(db, `🚩 **Player report** (${oneLine(r.where, 20) || 'chat'}): ${who(r.targetName, r.target)} reported by ${who(r.byName, r.by)}${text ? `\n> ${text}` : ''}`, now)
}

// A map reported in the Gallery (the report itself is saved in Firestore
// by the page; this only says so). Once an hour per map.
export async function contentReportAlert(db, { kind, code } = {}, now = Date.now()) {
  const k = kind === 'build' ? 'build' : 'map'
  const c = String(code || '').toUpperCase()
  if (!/^[A-Z0-9]{4,40}$/.test(c)) throw new ServerError(400, 'bad-request')
  await alertOnce(db, `${k}_${c}`, HOUR, `🚩 **${k === 'map' ? 'Map' : 'Build'} reported** in the Gallery: code ${c}`, now)
  return { ok: true }
}

// --- Feedback ---

function cleanInfo(info) {
  if (!info || typeof info !== 'object') return null
  const out = {}
  for (const k of ['device', 'browser', 'screen', 'lang', 'build', 'theme', 'where']) {
    const v = oneLine(info[k], 80)
    if (v) out[k] = v
  }
  return Object.keys(out).length ? out : null
}

export async function sendFeedback(db, body = {}, now = Date.now()) {
  const { pid } = body
  const kind = FEEDBACK_KINDS.includes(body.kind) ? body.kind : 'other'
  const text = cleanText(body.text, FEEDBACK_MAX)
  if (!validPid(pid) || text.length < 3) throw new ServerError(400, 'bad-request')
  const lim = await db.get(`feedbackLimits/${pid}`)
  const n = lim && now - (Number(lim.at) || 0) < HOUR ? Number(lim.n) || 0 : 0
  if (n >= FEEDBACK_PER_HOUR) throw new ServerError(429, 'too-many')
  const id = `${now}${pid}`.slice(0, 60)
  const nick = oneLine(body.nick, 24)
  const info = kind === 'bug' ? cleanInfo(body.info) : null
  await db.update({
    [`feedback/${id}`]: { kind, text, pid, nick, info, at: now, done: false },
    [`feedbackLimits/${pid}`]: { n: n + 1, at: n ? Number(lim.at) : now },
  })
  const all = (await db.get('feedback')) || {}
  const ids = Object.keys(all).sort((a, b) => (all[a]?.at || 0) - (all[b]?.at || 0))
  if (ids.length > FEEDBACK_KEPT) {
    const drop = {}
    for (const old of ids.slice(0, ids.length - FEEDBACK_KEPT)) drop[`feedback/${old}`] = null
    await db.update(drop)
  }
  const label = { idea: '💡 Idea', bug: '🐞 Bug', other: '💬 Feedback' }[kind]
  await sendAlert(db, `${label} from ${who(nick, pid)}\n> ${oneLine(text, 600)}`, now)
  return { ok: true }
}

// --- Polls ---

function cleanPoll(p) {
  if (!p || typeof p !== 'object' || !validId(String(p.id || ''))) return null
  const q = oneLine(p.q, POLL_Q_MAX)
  const options = (Array.isArray(p.options) ? p.options : []).map((o) => oneLine(o, POLL_OPTION_MAX)).filter(Boolean).slice(0, 4)
  if (!q || options.length < 2) return null
  return { id: String(p.id), q, options, until: Number(p.until) || 0 }
}

// The poll players should see now, or null (publicConfig).
export function livePoll(p, now = Date.now()) {
  const poll = cleanPoll(p)
  return poll && poll.until > now ? poll : null
}

export async function votePoll(db, { pid, id, choice } = {}, now = Date.now()) {
  if (!validPid(pid) || !validId(id)) throw new ServerError(400, 'bad-request')
  const poll = livePoll(await db.get('liveConfig/poll'), now)
  if (!poll || poll.id !== id) throw new ServerError(409, 'poll-ended')
  const c = Number(choice)
  if (!Number.isInteger(c) || c < 0 || c >= poll.options.length) throw new ServerError(400, 'bad-request')
  const r = await db.transaction(`pollVotes/${id}/${pid}`, (cur) => (cur == null ? c : undefined))
  return { ok: true, already: !r.committed }
}

function tally(votes, n) {
  const counts = Array(n).fill(0)
  for (const v of Object.values(votes || {})) if (Number.isInteger(v) && v >= 0 && v < n) counts[v]++
  return counts
}

export async function startPoll(db, { q, options, hours } = {}, now = Date.now()) {
  const h = POLL_HOURS.includes(Number(hours)) ? Number(hours) : 72
  const id = `p${now}`
  const poll = cleanPoll({ id, q, options, until: now + h * HOUR })
  if (!poll) throw new ServerError(400, 'bad-poll')
  const cur = cleanPoll(await db.get('liveConfig/poll'))
  const updates = {
    'liveConfig/poll': poll,
    [`polls/${id}`]: { q: poll.q, options: poll.options, at: now, until: poll.until, ended: false },
  }
  if (cur && cur.until > now) updates[`polls/${cur.id}/until`] = now
  await db.update(updates)
  return { ok: true, id }
}

export async function endPoll(db, now = Date.now()) {
  const cur = cleanPoll(await db.get('liveConfig/poll'))
  const updates = { 'liveConfig/poll': null }
  if (cur && (await db.get(`polls/${cur.id}`)) && cur.until > now) updates[`polls/${cur.id}/until`] = now
  await db.update(updates)
  return { ok: true }
}

export async function deletePoll(db, { id } = {}) {
  if (!validId(id)) throw new ServerError(400, 'bad-request')
  const cur = cleanPoll(await db.get('liveConfig/poll'))
  const updates = { [`polls/${id}`]: null, [`pollVotes/${id}`]: null }
  if (cur?.id === id) updates['liveConfig/poll'] = null
  await db.update(updates)
  return { ok: true }
}

// --- Error reports ---

// One row per kind of error: the same message at the same place.
export function errorKey(msg, where) {
  return crypto.createHash('sha1').update(`${msg}|${where}`).digest('hex').slice(0, 16)
}

export async function recordError(db, body = {}, now = Date.now()) {
  // Numbers inside a message (ids, sizes) would split one bug into many rows.
  const msg = oneLine(body.msg, 300).replace(/\d{4,}/g, 'N')
  const where = oneLine(body.where, 120)
  if (!msg) throw new ServerError(400, 'bad-request')
  const build = oneLine(body.build, 40)
  const dev = body.device === 'phone' || body.device === 'tablet' ? 'phone' : 'computer'
  const key = errorKey(msg, where)
  const r = await db.transaction(`errors/${key}`, (cur) => {
    const row = cur && typeof cur === 'object' ? cur : { msg, where, count: 0, first: now, phone: 0, computer: 0, alerted: 0 }
    return { ...row, msg, where, build: build || row.build || '', count: (Number(row.count) || 0) + 1, [dev]: (Number(row[dev]) || 0) + 1, last: now }
  })
  const row = r.value || {}
  const count = Number(row.count) || 0
  if (count === 1) {
    // Keep only the newest ERRORS_KEPT kinds.
    const all = (await db.get('errors')) || {}
    const keys = Object.keys(all).sort((a, b) => (all[a]?.last || 0) - (all[b]?.last || 0))
    if (keys.length > ERRORS_KEPT) {
      const drop = {}
      for (const old of keys.slice(0, keys.length - ERRORS_KEPT)) drop[`errors/${old}`] = null
      await db.update(drop)
    }
    await sendAlert(db, `⚠️ **New error** in the game\n> ${msg}${where ? `\n> at ${where}` : ''}`, now)
  } else {
    const spike = ERROR_SPIKES.filter((s) => count >= s).pop()
    if (spike && (Number(row.alerted) || 0) < spike) {
      await db.update({ [`errors/${key}/alerted`]: spike })
      await sendAlert(db, `🔥 **Error spike**: seen ${count} times now\n> ${msg}${where ? `\n> at ${where}` : ''}`, now)
    }
  }
  return { ok: true }
}

// --- The owner's Inbox ---

export async function inboxState(db, now = Date.now()) {
  const [feedback, errors, polls, cur] = await Promise.all([db.get('feedback'), db.get('errors'), db.get('polls'), db.get('liveConfig/poll')])
  const live = livePoll(cur, now)
  const pollList = Object.entries(polls || {})
    .map(([id, p]) => ({ id, q: oneLine(p?.q, POLL_Q_MAX), options: Array.isArray(p?.options) ? p.options.map((o) => oneLine(o, POLL_OPTION_MAX)) : [], at: Number(p?.at) || 0, until: Number(p?.until) || 0 }))
    .filter((p) => p.q && p.options.length >= 2)
    .sort((a, b) => b.at - a.at)
    .slice(0, POLLS_SHOWN)
  const votes = await Promise.all(pollList.map((p) => db.get(`pollVotes/${p.id}`)))
  return {
    alertsSetUp: alertsSetUp(),
    feedback: Object.entries(feedback || {})
      .map(([id, f]) => ({ id, kind: FEEDBACK_KINDS.includes(f?.kind) ? f.kind : 'other', text: cleanText(f?.text, FEEDBACK_MAX), pid: validPid(f?.pid) ? f.pid : '', nick: oneLine(f?.nick, 24), info: cleanInfo(f?.info), at: Number(f?.at) || 0, done: f?.done === true }))
      .sort((a, b) => b.at - a.at),
    errors: Object.entries(errors || {})
      .map(([key, e]) => ({ key, msg: oneLine(e?.msg, 300), where: oneLine(e?.where, 120), build: oneLine(e?.build, 40), count: Number(e?.count) || 0, phone: Number(e?.phone) || 0, computer: Number(e?.computer) || 0, first: Number(e?.first) || 0, last: Number(e?.last) || 0 }))
      .sort((a, b) => b.last - a.last),
    polls: pollList.map((p, i) => ({ ...p, live: live?.id === p.id, counts: tally(votes[i], p.options.length) })),
  }
}

export async function setFeedbackDone(db, { id, done } = {}) {
  if (!validId(id) || !(await db.get(`feedback/${id}`))) throw new ServerError(404, 'not-found')
  await db.update({ [`feedback/${id}/done`]: done !== false })
  return { ok: true }
}

export async function deleteFeedback(db, { id } = {}) {
  if (!validId(id)) throw new ServerError(400, 'bad-request')
  await db.update({ [`feedback/${id}`]: null })
  return { ok: true }
}

// Clears one kind of error (`key`), or all of them.
export async function clearErrors(db, { key } = {}) {
  if (key && !/^[0-9a-f]{16}$/.test(key)) throw new ServerError(400, 'bad-request')
  await db.update({ [key ? `errors/${key}` : 'errors']: null })
  return { ok: true }
}

export async function testAlert(db, now = Date.now()) {
  if (!alertsSetUp()) return { ok: false, setUp: false }
  return { ok: await sendAlert(db, '✅ Test alert - alerts are working.', now), setUp: true }
}
