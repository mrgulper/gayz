// Helper accounts (2026-11-13): people the owner trusts to look through
// player and map/build reports, test whether each one is real, and pass
// the real ones on. A helper can't ban, hide, delete or change anything
// else - they only add a "checked: real / not real" note to a report.
//
// Each helper gets one long random password, made here and shown to the
// owner once: `<id>-<secret>`. Only a hash of the secret is stored, so
// the database never holds a usable password. Removing a helper stops
// their password straight away.
//
// Realtime Database:
//   helpers/{id}       { name, hash, at, seen }
//   reportChecks/{key} { verdict: 'real'|'fake', note, by, hid, at }
//                      key = p_<player report id> or map_<id> / build_<id>
import crypto from 'node:crypto'
import { ServerError } from './servers.js'
import { contentReports, cleanText, logAction } from './admin.js'
import { sendAlert } from './inbox.js'

export const HELPERS_MAX = 20
export const HELPER_NAME_MAX = 24
export const CHECK_NOTE_MAX = 300
const VERDICTS = ['real', 'fake']

const validHelperId = (v) => typeof v === 'string' && /^[a-z0-9]{6}$/.test(v)
export const validCheckKey = (v) => typeof v === 'string' && /^(p|map|build)_[A-Za-z0-9_-]{1,60}$/.test(v)
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')

function randomText(n, letters) {
  const bytes = crypto.randomBytes(n)
  let out = ''
  for (let i = 0; i < n; i++) out += letters[bytes[i] % letters.length]
  return out
}

// --- The owner's side ---

export async function helperList(db) {
  const all = (await db.get('helpers')) || {}
  return Object.entries(all)
    .map(([id, h]) => ({ id, name: cleanText(h?.name, HELPER_NAME_MAX), at: Number(h?.at) || 0, seen: Number(h?.seen) || 0 }))
    .sort((a, b) => a.at - b.at)
}

// A new helper. The password comes back ONCE - only its hash is kept.
export async function addHelper(db, { name } = {}, now = Date.now()) {
  const clean = cleanText(name, HELPER_NAME_MAX).replace(/\n/g, ' ')
  if (!clean) throw new ServerError(400, 'bad-request')
  const all = (await db.get('helpers')) || {}
  if (Object.keys(all).length >= HELPERS_MAX) throw new ServerError(400, 'too-many-helpers')
  let id
  do id = randomText(6, 'abcdefghijkmnpqrstuvwxyz23456789')
  while (all[id])
  const secret = randomText(24, 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789')
  await db.update({ [`helpers/${id}`]: { name: clean, hash: sha(secret), at: now } })
  return { ok: true, id, name: clean, password: `${id}-${secret}` }
}

export async function removeHelper(db, { id } = {}) {
  if (!validHelperId(id)) throw new ServerError(400, 'bad-request')
  await db.update({ [`helpers/${id}`]: null })
  return { ok: true }
}

// --- The helper's side ---

// Which helper this password belongs to, or null.
export async function helperFor(db, pw) {
  if (typeof pw !== 'string' || pw.length > 80) return null
  const m = /^([a-z0-9]{6})-([A-Za-z0-9]{24})$/.exec(pw)
  if (!m) return null
  const h = await db.get(`helpers/${m[1]}`)
  if (!h || typeof h.hash !== 'string' || h.hash.length !== 64) return null
  const a = Buffer.from(sha(m[2]), 'hex')
  const b = Buffer.from(h.hash, 'hex')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  return { id: m[1], name: cleanText(h.name, HELPER_NAME_MAX) || 'Helper' }
}

async function mustBeHelper(db, pw, now) {
  const who = await helperFor(db, pw)
  if (!who) throw new ServerError(401, 'locked')
  await db.update({ [`helpers/${who.id}/seen`]: now })
  return who
}

export async function helperLogin(db, { helperPw } = {}, now = Date.now()) {
  const who = await helperFor(db, helperPw)
  if (!who) return { ok: false }
  await db.update({ [`helpers/${who.id}/seen`]: now })
  return { ok: true, name: who.name }
}

function cleanChecks(all) {
  const out = {}
  for (const [key, c] of Object.entries(all || {})) {
    if (!validCheckKey(key) || !c || !VERDICTS.includes(c.verdict)) continue
    out[key] = { verdict: c.verdict, note: cleanText(c.note, CHECK_NOTE_MAX), by: cleanText(c.by, HELPER_NAME_MAX), at: Number(c.at) || 0 }
  }
  return out
}

export async function reportChecks(db) {
  return cleanChecks(await db.get('reportChecks'))
}

// What a helper sees: the reports (no notes, bans or anything private),
// how many other reports each player has, and every check so far.
export async function helperReports(db, fs, { helperPw } = {}, now = Date.now()) {
  const who = await mustBeHelper(db, helperPw, now)
  const [reports, cfg, checks] = await Promise.all([db.get('playerReports'), db.get('liveConfig'), reportChecks(db)])
  const list = Object.entries(reports || {}).map(([id, r]) => ({
    id,
    key: `p_${id}`,
    target: r?.target || '',
    targetName: cleanText(r?.targetName, 24),
    by: r?.by || '',
    byName: cleanText(r?.byName, 24),
    where: cleanText(r?.where, 20),
    text: cleanText(r?.text, 600),
    at: Number(r?.at) || 0,
  }))
  const perTarget = {}
  for (const r of list) perTarget[r.target] = (perTarget[r.target] || 0) + 1
  const content = await contentReports(db, fs, cfg?.hidden)
  return {
    name: who.name,
    playerReports: list.map((r) => ({ ...r, others: perTarget[r.target] - 1 })).sort((a, b) => b.at - a.at),
    contentReports: content.list.filter((r) => !r.hidden).map((r) => ({ kind: r.kind, id: r.id, key: r.key, name: r.name, by: r.by, count: r.count, latest: r.latest })),
    contentReportsError: content.error,
    checks,
  }
}

// A helper's verdict on one report: 'real' (also pings the owner's
// Discord alert channel, if set up), 'fake', or 'none' to take it back.
export async function checkReport(db, { helperPw, key, verdict, note } = {}, now = Date.now()) {
  const who = await mustBeHelper(db, helperPw, now)
  if (!validCheckKey(key) || !(VERDICTS.includes(verdict) || verdict === 'none')) throw new ServerError(400, 'bad-request')
  let what = key.startsWith('p_') ? 'a player report' : `${key.startsWith('map_') ? 'map' : 'build'} ${key.slice(key.indexOf('_') + 1)}`
  if (key.startsWith('p_')) {
    const r = await db.get(`playerReports/${key.slice(2)}`)
    if (!r) throw new ServerError(404, 'gone')
    what = `the report on ${cleanText(r.targetName, 24) || '?'} #${r.target}`
  }
  if (verdict === 'none') {
    await db.update({ [`reportChecks/${key}`]: null })
    await logAction(db, `Helper ${who.name} took back their check on ${what}`, now).catch(() => {})
    return { ok: true }
  }
  const clean = cleanText(note, CHECK_NOTE_MAX)
  await db.update({ [`reportChecks/${key}`]: { verdict, note: clean, by: who.name, hid: who.id, at: now } })
  await logAction(db, `Helper ${who.name} checked ${what}: ${verdict === 'real' ? 'REAL' : 'not real'}${clean ? ` ("${cleanText(clean, 60)}")` : ''}`, now).catch(() => {})
  if (verdict === 'real') {
    await sendAlert(db, `✅ **Helper ${who.name}** says ${what} is real${clean ? `\n> ${clean.replace(/\n+/g, ' ')}` : ''}`, now).catch(() => {})
  }
  return { ok: true }
}
