// Player inbox (2026-11-13): the homepage Feedback box, quick polls, the
// game's own error reports, and private alerts to the owner's Discord.
// Same tiny database interface as servers.js / admin.js (get, update,
// increment, transaction), so tests/servers.spec.js runs it on an
// in-memory copy.
//
// Layout in the Realtime Database (no daily read limit):
//   feedback/{id}   { kind: idea|bug|other, text, pid, nick, info, pics, at, done }
//                   `pics` = how many pictures went to Discord with it
//                   `info` (bugs only) = device, browser, screen, language,
//                   build - what the old "Copy Bug Report" button gave
//                   + `reply` { tpl, text, at } the team's last answer,
//                   `stage` (bugs) new | working | fixed (2026-11-26)
//   feedbackReplies/{pid}/{id} { tpl, text, orig, at, seen } - answers the
//                   player sees once, in a "Staff replied" popup
//                   (LiveConfig.js renderWarning). `tpl` = a ready-made
//                   reply (REPLY_TEMPLATES, translated in the game)
//   feedbackLimits/{pid} { n, at }  messages sent this hour (spam limit)
//   alertLimits/dailySummary  the day (America/Los_Angeles) the daily
//                   summary last went out
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
import { loadRudeChecker, autoModWords, AUTOMOD_WORDS_MAX, AUTOMOD_WORD_MAX } from './autoMod.js'

export const FEEDBACK_KINDS = ['idea', 'bug', 'other']
export const FEEDBACK_MAX = 10000
// Pictures added to feedback or a report (2026-11-22): sent straight on to
// the Discord alert channel as files, never saved in the database.
export const IMAGES_MAX = 3
export const IMAGE_BYTES_MAX = 700 * 1024
export const FEEDBACK_PER_HOUR = 5
// Ready-made replies (2026-11-26). Same ids in the game's i18n
// (`staffReplyTpl_<id>`) and the owner's tools.
export const REPLY_TEMPLATES = ['thanks', 'added', 'working', 'fixed', 'more', 'cant']
export const REPLY_MAX = 500
export const BUG_STAGES = ['new', 'working', 'fixed']
const REPLIES_KEPT = 10
const REPLY_ORIG_MAX = 200
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
// Up to IMAGES_MAX pictures sent as data URLs (jpeg/png/webp), each at
// most IMAGE_BYTES_MAX. Anything else is dropped.
export function cleanImages(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const v of list.slice(0, IMAGES_MAX)) {
    if (typeof v !== 'string' || v.length > IMAGE_BYTES_MAX * 1.4) continue
    const m = v.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/)
    if (!m) continue
    const buf = Buffer.from(m[2], 'base64')
    if (!buf.length || buf.length > IMAGE_BYTES_MAX) continue
    out.push({ name: `picture-${out.length + 1}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`, type: `image/${m[1]}`, buf })
  }
  return out
}

// `files` ({ name, type, buf }) go along as Discord attachments.
export async function sendAlert(db, text, now = Date.now(), files = []) {
  if (!alertsSetUp()) return false
  const hour = Math.floor(now / HOUR)
  try {
    const r = await db.transaction('alertBudget', (cur) => {
      const n = cur && cur.hour === hour ? Number(cur.n) || 0 : 0
      if (n >= ALERTS_PER_HOUR) return undefined
      return { hour, n: n + 1 }
    })
    if (!r.committed) return false
    const payload = { content: String(text).slice(0, 1900), allowed_mentions: { parse: [] } }
    let init
    if (files.length) {
      const form = new FormData()
      form.append('payload_json', JSON.stringify(payload))
      files.forEach((f, i) => form.append(`files[${i}]`, new Blob([f.buf], { type: f.type }), f.name))
      init = { method: 'POST', body: form, signal: AbortSignal.timeout(10000) }
    } else {
      init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(4000) }
    }
    const res = await fetch(process.env.DISCORD_ALERT_WEBHOOK.trim(), init)
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

// `rude` (auto-mod): the name had a rude word, so it's left out.
const who = (name, pid, rude = false) => `${rude ? '(name hidden)' : oneLine(name, 24) || '?'} #${pid}`

// Auto-mod: what an alert says instead of rude words. Pictures still go,
// but as Discord spoilers (blurred until clicked).
const HIDDEN_LINE = '> 🙈 Hidden by auto-mod (rude words). Open your owner tools to read it.'
const spoilers = (files) => files.map((f) => ({ ...f, name: `SPOILER_${f.name}` }))

// A player report (admin.js reportPlayer calls this after saving it).
export async function reportAlert(db, r, now = Date.now(), files = []) {
  const text = oneLine(r.text, 600)
  const isRude = await loadRudeChecker(db)
  const rude = isRude(text)
  return sendAlert(db, `🚩 **Player report** (${oneLine(r.where, 20) || 'chat'}): ${who(r.targetName, r.target, isRude(r.targetName))} reported by ${who(r.byName, r.by, isRude(r.byName))}${rude ? `\n${HIDDEN_LINE}` : text ? `\n> ${text}` : ''}`, now, rude ? spoilers(files) : files)
}

// A long message's full words ride along as a text file (Discord shows
// only the first part of a message).
function fullTextFile(text, shown) {
  return text.length > shown ? [{ name: 'message.txt', type: 'text/plain', buf: Buffer.from(text, 'utf8') }] : []
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
    [`feedback/${id}`]: { kind, text, pid, nick, info, pics: Array.isArray(body.images) ? Math.min(body.images.length, IMAGES_MAX) : 0, at: now, done: false },
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
  const isRude = await loadRudeChecker(db)
  const rude = isRude(text)
  const files = rude ? spoilers(cleanImages(body.images)) : [...cleanImages(body.images), ...fullTextFile(text, 600)]
  await sendAlert(db, `${label} from ${who(nick, pid, isRude(nick))}\n${rude ? HIDDEN_LINE : `> ${oneLine(text, 600)}`}`, now, files)
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
  const [feedback, errors, polls, cur, isRude, words] = await Promise.all([db.get('feedback'), db.get('errors'), db.get('polls'), db.get('liveConfig/poll'), loadRudeChecker(db), autoModWords(db)])
  const live = livePoll(cur, now)
  const pollList = Object.entries(polls || {})
    .map(([id, p]) => ({ id, q: oneLine(p?.q, POLL_Q_MAX), options: Array.isArray(p?.options) ? p.options.map((o) => oneLine(o, POLL_OPTION_MAX)) : [], at: Number(p?.at) || 0, until: Number(p?.until) || 0 }))
    .filter((p) => p.q && p.options.length >= 2)
    .sort((a, b) => b.at - a.at)
    .slice(0, POLLS_SHOWN)
  const votes = await Promise.all(pollList.map((p) => db.get(`pollVotes/${p.id}`)))
  return {
    alertsSetUp: alertsSetUp(),
    autoMod: { words, max: AUTOMOD_WORDS_MAX, wordMax: AUTOMOD_WORD_MAX },
    feedback: Object.entries(feedback || {})
      .map(([id, f]) => ({ id, kind: FEEDBACK_KINDS.includes(f?.kind) ? f.kind : 'other', text: cleanText(f?.text, FEEDBACK_MAX), pid: validPid(f?.pid) ? f.pid : '', nick: oneLine(f?.nick, 24), info: cleanInfo(f?.info), at: Number(f?.at) || 0, done: f?.done === true, reply: cleanReply(f?.reply), stage: f?.kind === 'bug' ? (BUG_STAGES.includes(f?.stage) ? f.stage : 'new') : null }))
      .map((f) => (isRude(f.text, f.nick) ? { ...f, rude: true } : f))
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

// --- Replies (2026-11-26) ---

function cleanReply(r) {
  if (!r || typeof r !== 'object') return null
  const tpl = REPLY_TEMPLATES.includes(r.tpl) ? r.tpl : ''
  const text = cleanText(r.text, REPLY_MAX)
  return tpl || text ? { tpl, text, at: Number(r.at) || 0 } : null
}

// The team answers one feedback message: the player sees it the next time
// their page asks /api/live, and the message moves to Done.
export async function replyFeedback(db, { id, tpl, text } = {}, now = Date.now()) {
  if (!validId(id)) throw new ServerError(400, 'bad-request')
  const reply = cleanReply({ tpl, text, at: now })
  if (!reply) throw new ServerError(400, 'empty-reply')
  const f = await db.get(`feedback/${id}`)
  if (!f) throw new ServerError(404, 'not-found')
  const pid = validPid(f.pid) ? f.pid : ''
  if (!pid) throw new ServerError(409, 'no-player')
  const rid = `${now}${crypto.randomBytes(3).toString('hex')}`
  const updates = {
    [`feedbackReplies/${pid}/${rid}`]: { ...reply, orig: oneLine(f.text, REPLY_ORIG_MAX), seen: 0 },
    [`feedback/${id}/reply`]: reply,
    [`feedback/${id}/done`]: true,
  }
  if (f.kind === 'bug' && tpl === 'fixed') updates[`feedback/${id}/stage`] = 'fixed'
  if (f.kind === 'bug' && tpl === 'working' && f.stage !== 'fixed') updates[`feedback/${id}/stage`] = 'working'
  await db.update(updates)
  const all = (await db.get(`feedbackReplies/${pid}`)) || {}
  const ids = Object.keys(all).sort((a, b) => (all[a]?.at || 0) - (all[b]?.at || 0))
  if (ids.length > REPLIES_KEPT) {
    const drop = {}
    for (const old of ids.slice(0, ids.length - REPLIES_KEPT)) drop[`feedbackReplies/${pid}/${old}`] = null
    await db.update(drop)
  }
  return { ok: true, reply }
}

// Bug tracker: New -> Working on it -> Fixed. Fixed tells the player (a
// ready-made "fixed" reply) unless they were already told.
export async function setBugStage(db, { id, stage } = {}, now = Date.now()) {
  if (!validId(id) || !BUG_STAGES.includes(stage)) throw new ServerError(400, 'bad-request')
  const f = await db.get(`feedback/${id}`)
  if (!f) throw new ServerError(404, 'not-found')
  if (f.kind !== 'bug') throw new ServerError(400, 'not-a-bug')
  if (stage === 'fixed') {
    if (f.reply?.tpl !== 'fixed' && validPid(f.pid)) return { ...(await replyFeedback(db, { id, tpl: 'fixed' }, now)), told: true }
    await db.update({ [`feedback/${id}/stage`]: 'fixed', [`feedback/${id}/done`]: true })
    return { ok: true, told: false }
  }
  await db.update({ [`feedback/${id}/stage`]: stage, [`feedback/${id}/done`]: false })
  return { ok: true }
}

// The answers this player hasn't pressed OK on yet (publicConfig).
export function unseenReplies(all) {
  return Object.entries(all || {})
    .filter(([id, r]) => validId(id) && r && !r.seen && cleanReply(r))
    .map(([id, r]) => ({ id, ...cleanReply(r), orig: oneLine(r.orig, REPLY_ORIG_MAX) }))
    .sort((a, b) => a.at - b.at)
    .slice(0, 5)
}

// The player pressed OK on an answer (api/live.js).
export async function seenReply(db, { pid, id } = {}, now = Date.now()) {
  if (!validPid(pid) || !validId(id)) throw new ServerError(400, 'bad-request')
  const r = await db.get(`feedbackReplies/${pid}/${id}`)
  if (r && !r.seen) await db.update({ [`feedbackReplies/${pid}/${id}/seen`]: now })
  return { ok: true }
}

// --- Daily summary (2026-11-26) ---
// One private Discord post a day with the last 24 hours' counts. GitHub's
// site check (site-check.yml) pokes /api/live every 10 minutes; the post
// goes out on the first poke after SUMMARY_HOUR (Los Angeles time), once
// per day. Anyone poking it early changes nothing.
export const SUMMARY_HOUR = 9
function laDay(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)).map((p) => [p.type, p.value]))
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) }
}

// `isRude` (auto-mod) adds how many of them were hidden.
export function summaryText(feedback, reports, errors, now, isRude = () => false) {
  const since = now - 24 * HOUR
  const fb = Object.values(feedback || {}).filter((f) => f && Number(f.at) >= since)
  const n = (k) => fb.filter((f) => (FEEDBACK_KINDS.includes(f.kind) ? f.kind : 'other') === k).length
  const open = Object.values(feedback || {}).filter((f) => f && !f.done).length
  const bugsOpen = Object.values(feedback || {}).filter((f) => f?.kind === 'bug' && f.stage !== 'fixed').length
  const reps = Object.values(reports || {}).filter((r) => r && Number(r.at) >= since)
  const rep = reps.length
  const fbHidden = fb.filter((f) => isRude(f.text, f.nick)).length
  const repHidden = reps.filter((r) => isRude(r.text, r.targetName, r.byName)).length
  const hidden = (n) => (n ? ` · 🙈 ${n} hidden by auto-mod` : '')
  const errs = Object.values(errors || {})
  const newErr = errs.filter((e) => e && Number(e.first) >= since).length
  const errHits = errs.filter((e) => e && Number(e.last) >= since).length
  return [
    '📋 **Daily summary** (last 24 hours)',
    `💬 Feedback: ${fb.length} (💡 ${n('idea')} ideas, 🐞 ${n('bug')} bugs, ${n('other')} other) - ${open} waiting in New${hidden(fbHidden)}`,
    `🛠️ Bugs not fixed yet: ${bugsOpen}`,
    `🚩 Player reports: ${rep}${hidden(repHidden)}`,
    `⚠️ Errors: ${newErr} new kind${newErr === 1 ? '' : 's'}, ${errHits} seen`,
  ].join('\n')
}

export async function dailySummary(db, now = Date.now()) {
  if (!alertsSetUp()) return { ok: true, sent: false }
  const { day, hour } = laDay(now)
  if (hour < SUMMARY_HOUR) return { ok: true, sent: false }
  const r = await db.transaction('alertLimits/dailySummary', (cur) => (cur === day ? undefined : day))
  if (!r.committed) return { ok: true, sent: false }
  const [feedback, reports, errors, isRude] = await Promise.all([db.get('feedback'), db.get('playerReports'), db.get('errors'), loadRudeChecker(db)])
  const sent = await sendAlert(db, summaryText(feedback, reports, errors, now, isRude), now)
  return { ok: true, sent }
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
