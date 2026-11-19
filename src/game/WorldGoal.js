// World Goal (big-ideas plan, World Goal Batch 2, 2026-11-19): every
// player in the world adds to one shared number each week. What it counts
// changes each week (WORLD_GOALS, picked from the week number), so every
// week is a fresh goal. Batch 3 adds the homepage bar and the reward.
//
// Cheap on purpose (same lesson as the world kill counter):
// - One Firestore doc per week: worldGoal/{week} = { count }. Nothing else.
// - Players don't send after every kill. A finished game adds its amount to
//   a "still to send" pile in localStorage (gayz-world-goal-pending, kept per
//   week), and the pile is sent at most once every SEND_GAP_MS, in steps of
//   at most WORLD_GOAL_STEP (the rules refuse a bigger jump in one write).
//   A send that fails (offline, rules not pasted yet) leaves the pile for
//   next time.
// - Reading the number (Batch 3's bar) is one doc read, cached for
//   READ_CACHE_MS in localStorage.
// - Everyone counts, signed in or not (Gaymi's pick). Each write is capped,
//   so a cheater can only add a little per write.

export const WORLD_GOAL_STEP = 500
const MAX_STEPS_PER_SEND = 40
const SEND_GAP_MS = 5 * 60 * 1000
const READ_CACHE_MS = 10 * 60 * 1000
const PENDING_KEY = 'gayz-world-goal-pending'
const LAST_SEND_KEY = 'gayz-world-goal-last-send'
const CACHE_KEY = 'gayz-world-goal-cache'

// stat = the field of the game's 'end' report it adds up. Targets are big
// (Gaymi's pick) and a guess - nobody knows yet how many people play a week.
export const WORLD_GOALS = [
  { id: 'kills', stat: 'kills', target: 100000 },
  { id: 'nights', stat: 'waves', target: 5000 },
  { id: 'headshots', stat: 'headshots', target: 25000 },
  { id: 'bosses', stat: 'bosses', target: 1000 },
  { id: 'coins', stat: 'coins', target: 1000000 },
  { id: 'knifeKills', stat: 'meleeKills', target: 10000 },
]

// weekStr is _thisWeekStr()'s "2026-W47". Same week -> same goal for
// everyone; the list is walked in order, one goal per week.
export function worldGoalForWeek(weekStr) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(String(weekStr || ''))
  const n = m ? Number(m[1]) * 53 + Number(m[2]) : 0
  return WORLD_GOALS[n % WORLD_GOALS.length]
}

// What one finished game adds to this week's goal (a whole number >= 0).
export function worldGoalAmount(goal, endData) {
  const v = Math.floor(Number(endData?.[goal.stat]) || 0)
  return v > 0 ? v : 0
}

// Splits an amount into rule-sized steps (at most `maxSteps` of them).
export function worldGoalSteps(amount, maxSteps = MAX_STEPS_PER_SEND) {
  const out = []
  let left = Math.floor(Number(amount) || 0)
  while (left > 0 && out.length < maxSteps) {
    const n = Math.min(left, WORLD_GOAL_STEP)
    out.push(n)
    left -= n
  }
  return out
}

function readJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key))
    return v && typeof v === 'object' ? v : fallback
  } catch { return fallback }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage full or blocked */ }
}

// { "2026-W47": 123, ... } - only well-formed weeks with whole numbers,
// newest two weeks kept (an older pile is too late to matter).
export function loadWorldGoalPending() {
  const raw = readJson(PENDING_KEY, {})
  const out = {}
  for (const [week, n] of Object.entries(raw)) {
    const v = Math.floor(Number(n) || 0)
    if (/^\d{4}-W\d{1,2}$/.test(week) && v > 0) out[week] = v
  }
  const keep = Object.keys(out).sort(byWeek).slice(-2)
  return Object.fromEntries(keep.map((w) => [w, out[w]]))
}

function byWeek(a, b) {
  const [ay, aw] = a.split('-W').map(Number)
  const [by, bw] = b.split('-W').map(Number)
  return ay - by || aw - bw
}

// Called once per finished game. Adds to the pile; doesn't send.
export function addToWorldGoal(weekStr, endData) {
  const amount = worldGoalAmount(worldGoalForWeek(weekStr), endData)
  if (!amount) return 0
  const pending = loadWorldGoalPending()
  pending[weekStr] = (pending[weekStr] || 0) + amount
  writeJson(PENDING_KEY, pending)
  return amount
}

// Sends the pile if the last send was long enough ago (`force` skips that
// wait). `send(week, n)` is CloudSync.addWorldGoalCount - passed in so this
// file never loads Firebase and tests can use a fake. Returns how much went.
export async function sendWorldGoalPending(send, { force = false, now = Date.now() } = {}) {
  const last = Number(readJson(LAST_SEND_KEY, {}).at) || 0
  if (!force && now - last < SEND_GAP_MS) return 0
  const pending = loadWorldGoalPending()
  const weeks = Object.keys(pending).sort(byWeek)
  if (!weeks.length) return 0
  writeJson(LAST_SEND_KEY, { at: now })
  const sentByWeek = {}
  let sent = 0
  let stepsLeft = MAX_STEPS_PER_SEND
  try {
    for (const week of weeks) {
      for (const n of worldGoalSteps(pending[week], stepsLeft)) {
        await send(week, n)
        sentByWeek[week] = (sentByWeek[week] || 0) + n
        sent += n
        stepsLeft--
      }
    }
  } catch {
    // Offline, or the rules refused it - what's left stays for next time.
  }
  // Re-read: a game may have ended (and added to the pile) while sending.
  const now2 = loadWorldGoalPending()
  for (const [week, n] of Object.entries(sentByWeek)) {
    now2[week] = (now2[week] || 0) - n
    if (now2[week] <= 0) delete now2[week]
  }
  writeJson(PENDING_KEY, now2)
  return sent
}

// This week's goal with its count, for Batch 3's bar. `fetch(week)` is
// CloudSync.fetchWorldGoalCount. One read per READ_CACHE_MS per device.
export async function getWorldGoal(weekStr, fetch, { now = Date.now() } = {}) {
  const goal = worldGoalForWeek(weekStr)
  const cache = readJson(CACHE_KEY, {})
  let count = null
  if (cache.week === weekStr && now - (Number(cache.at) || 0) < READ_CACHE_MS && Number.isFinite(cache.count)) {
    count = cache.count
  } else {
    try {
      count = Math.max(0, Math.floor(Number(await fetch(weekStr)) || 0))
      writeJson(CACHE_KEY, { week: weekStr, count, at: now })
    } catch {
      if (cache.week === weekStr && Number.isFinite(cache.count)) count = cache.count
    }
  }
  return { ...goal, week: weekStr, count }
}
