// Uptime history (2026-11-26). GitHub's site check (site-check.yml) pokes
// /api/live every 10 minutes while the site answers. Each poke is a
// heartbeat; a long gap between two heartbeats is either
//   - an outage: the check saw the site fail, then sends `back: true` on
//     the first poke that works again, or
//   - a missed check: no failure was seen, GitHub just ran late (its
//     timer often slips), so it doesn't count as down time.
// An outage posts one "back up" report to the owner's private Discord.
//
// Saved in the Realtime Database at
//   uptime/last              ms of the last heartbeat
//   uptime/checks/{LA day}   heartbeats that day (144 = every check)
//   uptime/outages/{from}    { from, to } the site was down in between
//   uptime/missed/{from}     { from, to } no check reached the site
// Nothing here reaches players.
import { sendAlert } from './inbox.js'

const MIN = 60 * 1000
const DAY = 24 * 60 * MIN
// A real outage hides at least one 10-minute check, so its gap is about
// 20 minutes or more; anything shorter with `back` is ignored.
export const OUTAGE_MIN_GAP = 15
// Without `back`, a gap this long is a missed check (GitHub late).
export const MISSED_MIN_GAP = 30
const OUTAGES_KEPT = 100
const MISSED_KEPT = 50
export const UPTIME_DAYS = 30

export function laParts(now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(now)).map((x) => [x.type, x.value]))
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: p.weekday }
}
export const laTime = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(new Date(ms))
const laDate = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' }).format(new Date(ms))

export function minutesText(min) {
  const m = Math.max(1, Math.round(min))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
}

// Minutes the outages cover inside [a, b).
export function downMinutes(outages, a, b) {
  let ms = 0
  for (const o of Object.values(outages || {})) {
    const from = Math.max(a, Number(o?.from) || 0)
    const to = Math.min(b, Number(o?.to) || 0)
    if (to > from) ms += to - from
  }
  return ms / MIN
}

// "99.6%" up over [a, b).
export function upPercent(outages, a, b) {
  const total = (b - a) / MIN
  if (total <= 0) return '100%'
  const pct = Math.max(0, 100 - (downMinutes(outages, a, b) * 100) / total)
  return `${pct >= 99.95 ? 100 : pct.toFixed(1)}%`
}

async function keepNewest(db, path, kept) {
  const all = (await db.get(path)) || {}
  const keys = Object.keys(all).sort((x, y) => Number(x) - Number(y))
  if (keys.length <= kept) return
  const drop = {}
  for (const k of keys.slice(0, keys.length - kept)) drop[`${path}/${k}`] = null
  await db.update(drop)
}

export function backUpText(from, to, outages, now) {
  const week = Object.values(outages || {}).filter((o) => Number(o?.to) > now - 7 * DAY).length
  return [
    `🟢 **GayZ is back up** - down for about ${minutesText((to - from) / MIN)} (${laTime(from)} to ${laTime(to)}, ${laDate(to)}, Los Angeles time).`,
    `📈 Last 7 days: ${upPercent(outages, now - 7 * DAY, now)} up, ${week} outage${week === 1 ? '' : 's'}.`,
  ].join('\n')
}

// One heartbeat (api/live.js, on the site check's poke).
export async function heartbeat(db, { back } = {}, now = Date.now()) {
  let prev = 0
  // Two pokes within a minute count once.
  const r = await db.transaction('uptime/last', (cur) => {
    prev = Number(cur) || 0
    return prev && now - prev < MIN ? undefined : now
  })
  if (!r.committed) return { ok: true, beat: false }
  await db.increment({ [`uptime/checks/${laParts(now).day}`]: 1 })
  const gap = prev ? (now - prev) / MIN : 0
  if (back === true && gap >= OUTAGE_MIN_GAP) {
    await db.update({ [`uptime/outages/${prev}`]: { from: prev, to: now } })
    await keepNewest(db, 'uptime/outages', OUTAGES_KEPT)
    const reported = await sendAlert(db, backUpText(prev, now, await db.get('uptime/outages'), now), now)
    return { ok: true, beat: true, outage: Math.round(gap), reported }
  }
  if (gap >= MISSED_MIN_GAP) {
    await db.update({ [`uptime/missed/${prev}`]: { from: prev, to: now } })
    await keepNewest(db, 'uptime/missed', MISSED_KEPT)
    return { ok: true, beat: true, missed: Math.round(gap) }
  }
  return { ok: true, beat: true }
}

// The owner's Uptime card: the last UPTIME_DAYS days (Los Angeles), the
// outages and missed checks, newest first.
export async function uptimeReport(db, now = Date.now()) {
  const [last, checks, outages, missed] = await Promise.all([db.get('uptime/last'), db.get('uptime/checks'), db.get('uptime/outages'), db.get('uptime/missed')])
  const days = []
  for (let i = UPTIME_DAYS - 1; i >= 0; i--) {
    const day = laParts(now - i * DAY).day
    if (days.some((d) => d.day === day)) continue
    days.push({ day, checks: Number(checks?.[day]) || 0 })
  }
  // Down minutes per day, counted by the day each outage started.
  for (const o of Object.values(outages || {})) {
    const d = days.find((x) => x.day === laParts(Number(o?.from) || 0).day)
    if (d) d.down = (d.down || 0) + Math.round(((Number(o.to) || 0) - (Number(o.from) || 0)) / MIN)
  }
  const list = (obj) => Object.values(obj || {}).filter((o) => o && o.from && o.to).map((o) => ({ from: Number(o.from), to: Number(o.to) })).sort((a, b) => b.from - a.from)
  return {
    last: Number(last) || 0,
    days,
    outages: list(outages),
    missed: list(missed),
    up7: upPercent(outages, now - 7 * DAY, now),
    up30: upPercent(outages, now - 30 * DAY, now),
  }
}
