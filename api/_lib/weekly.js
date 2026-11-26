// Weekly report (2026-11-26): one private Discord post on Mondays (first
// site-check poke after REPORT_HOUR, Los Angeles time) comparing the last
// 7 days with the 7 before: players, new vs coming back, feedback,
// reports, errors and uptime. Counts only, like the daily summary.
//   alertLimits/weeklyReport  the Monday (LA day) it last went out
import { alertsSetUp, sendAlert, FEEDBACK_KINDS } from './inbox.js'
import { laParts, upPercent, downMinutes, minutesText } from './uptime.js'

export const REPORT_HOUR = 9
const DAY = 24 * 60 * 60 * 1000

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10)
const shortDate = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function sumCat(days, cat, keys = null) {
  let n = 0
  for (const d of days) for (const who of ['s', 'g']) for (const [k, v] of Object.entries(d?.[who]?.[cat] || {})) if (!keys || keys.includes(k)) n += Number(v) || 0
  return n
}

// "▲ 20%" / "▼ 5%" / "same" / "new" - this week against last.
export function change(now, before) {
  if (now === before) return 'same'
  if (!before) return '▲ new'
  const pct = Math.round(((now - before) * 100) / before)
  if (pct === 0) return now > before ? '▲ <1%' : '▼ <1%'
  return pct > 0 ? `▲ ${pct}%` : `▼ ${-pct}%`
}
const line = (icon, label, a, b, unit = '') => `${icon} ${label}: **${a}${unit}** (${change(a, b)}, was ${b}${unit})`

// `stats` = 14 UTC days of stats/{day}, oldest first ({ s, g } each);
// the others are the database lists as saved. `now` = the report time.
export function weeklyText({ days, stats, feedback, reports, errors, outages }, now) {
  const last = stats.slice(0, 7)
  const cur = stats.slice(7)
  const thisFrom = now - 7 * DAY
  const lastFrom = now - 14 * DAY
  const inWeek = (list, field, a, b) => Object.values(list || {}).filter((x) => x && Number(x[field]) >= a && Number(x[field]) < b)
  const fbA = inWeek(feedback, 'at', thisFrom, now)
  const fbB = inWeek(feedback, 'at', lastFrom, thisFrom)
  const kind = (l, k) => l.filter((f) => (FEEDBACK_KINDS.includes(f.kind) ? f.kind : 'other') === k).length
  const avg = (l) => Math.round(sumCat(l, 'sum', ['players']) / 7)
  const backKeys = ['d1', 'd2-6', 'd7-29', 'd30up']
  const outA = inWeek(outages, 'to', thisFrom, now).length
  const outB = inWeek(outages, 'to', lastFrom, thisFrom).length
  const downA = downMinutes(outages, thisFrom, now)
  return [
    `📅 **Weekly report** (${shortDate(days[7])} - ${shortDate(days[13])} vs ${shortDate(days[0])} - ${shortDate(days[6])})`,
    line('👥', 'Players a day (average)', avg(cur), avg(last)),
    line('🆕', 'New players', sumCat(cur, 'back', ['new']), sumCat(last, 'back', ['new'])),
    line('🔁', 'Players coming back', sumCat(cur, 'back', backKeys), sumCat(last, 'back', backKeys)),
    line('🎮', 'Games played', sumCat(cur, 'sum', ['runs']), sumCat(last, 'sum', ['runs'])),
    line('💬', 'Feedback', fbA.length, fbB.length) + ` - 💡 ${kind(fbA, 'idea')} ideas, 🐞 ${kind(fbA, 'bug')} bugs`,
    line('🚩', 'Player reports', inWeek(reports, 'at', thisFrom, now).length, inWeek(reports, 'at', lastFrom, thisFrom).length),
    line('⚠️', 'New kinds of errors', inWeek(errors, 'first', thisFrom, now).length, inWeek(errors, 'first', lastFrom, thisFrom).length),
    `🟢 Uptime: **${upPercent(outages, thisFrom, now)}** (was ${upPercent(outages, lastFrom, thisFrom)}) - ${outA} outage${outA === 1 ? '' : 's'}${outA ? `, down ${minutesText(downA)} in all` : ''} (was ${outB})`,
  ].join('\n')
}

async function buildText(db, now) {
  // The 14 full UTC days before today.
  const days = Array.from({ length: 14 }, (_, i) => utcDay(now - (14 - i) * DAY))
  const [stats, feedback, reports, errors, outages] = await Promise.all([Promise.all(days.map((d) => db.get(`stats/${d}`))), db.get('feedback'), db.get('playerReports'), db.get('errors'), db.get('uptime/outages')])
  return weeklyText({ days, stats: stats.map((s) => s || {}), feedback, reports, errors, outages }, now)
}

// The site check's poke (api/live.js): posts on Mondays after REPORT_HOUR,
// once. Earlier pokes, or any other day, change nothing.
export async function weeklyReport(db, now = Date.now()) {
  if (!alertsSetUp()) return { ok: true, sent: false }
  const { day, hour, weekday } = laParts(now)
  if (weekday !== 'Mon' || hour < REPORT_HOUR) return { ok: true, sent: false }
  const r = await db.transaction('alertLimits/weeklyReport', (cur) => (cur === day ? undefined : day))
  if (!r.committed) return { ok: true, sent: false }
  return { ok: true, sent: await sendAlert(db, await buildText(db, now), now) }
}

// The owner's "Preview" button: the same text, nothing sent.
export async function weeklyPreview(db, now = Date.now()) {
  return { text: await buildText(db, now), hour: REPORT_HOUR }
}
