// Daily Challenge (2026-10-30, Gaymi: one goal a day for coins + XP, with
// a streak bonus). Like RollingQuests, the pick is a pure function of the
// date - everyone playing on the same calendar day gets the same goal, no
// server needed. Only this player's progress, claim and streak are kept
// (localStorage, written per kill like the rolling quests - never per frame).
//
// Streak: claiming on the day after your last claim adds one; missing a
// day starts again at 1. Each day of streak adds STREAK_STEP to the reward,
// up to STREAK_MAX_DAYS (day 7 pays 2.5x).
const STORAGE_KEY = 'gayz-daily-challenge'
export const STREAK_STEP = 0.25
export const STREAK_MAX_DAYS = 7

// type: what counts (see record()). targets: easy / medium / hard -
// the day's seed picks one, and harder pays more (REWARDS).
export const DAILY_TEMPLATES = [
  { type: 'kills', titleKey: 'dailyChallengeKills', targets: [40, 60, 80] },
  { type: 'melee', titleKey: 'dailyChallengeMelee', targets: [15, 25, 35] },
  { type: 'skeletons', titleKey: 'dailyChallengeSkeletons', targets: [8, 12, 16] },
  { type: 'rare', titleKey: 'dailyChallengeRare', targets: [5, 8, 12] },
  { type: 'wave', titleKey: 'dailyChallengeWave', targets: [5, 7, 9] },
  { type: 'streak', titleKey: 'dailyChallengeStreak', targets: [15, 25, 35] },
  { type: 'bosses', titleKey: 'dailyChallengeBosses', targets: [1, 2, 3] },
]
const REWARDS = [{ coins: 250, xp: 80 }, { coins: 400, xp: 130 }, { coins: 600, xp: 200 }]
const RARE_TIERS = new Set(['rare', 'epic', 'legendary', 'mythic'])

// The local calendar day, "2026-10-30".
export function dayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

function yesterdayKey(date = new Date()) {
  const d = new Date(date)
  d.setDate(d.getDate() - 1)
  return dayKey(d)
}

// A small string hash, so the same day always gives the same number.
function hashDay(day) {
  let h = 2166136261
  for (let i = 0; i < day.length; i++) h = Math.imul(h ^ day.charCodeAt(i), 16777619)
  return h >>> 0
}

// The day's challenge: { template, level, target, coins, xp }.
export function challengeFor(day) {
  const h = hashDay(day)
  const template = DAILY_TEMPLATES[h % DAILY_TEMPLATES.length]
  const level = Math.floor(h / DAILY_TEMPLATES.length) % 3
  return { template, level, target: template.targets[level], ...REWARDS[level] }
}

export function streakMult(streak) {
  return 1 + STREAK_STEP * (Math.min(Math.max(streak, 1), STREAK_MAX_DAYS) - 1)
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (parsed && typeof parsed === 'object') {
      return {
        day: typeof parsed.day === 'string' ? parsed.day : null,
        progress: Number.isFinite(parsed.progress) ? Math.max(0, parsed.progress) : 0,
        claimed: !!parsed.claimed,
        streak: Number.isInteger(parsed.streak) ? Math.max(0, parsed.streak) : 0,
        lastClaim: typeof parsed.lastClaim === 'string' ? parsed.lastClaim : null,
      }
    }
  } catch {
    // Malformed or unavailable - fresh state below.
  }
  return { day: null, progress: 0, claimed: false, streak: 0, lastClaim: null }
}

export class DailyChallenge {
  constructor() {
    this.state = loadState()
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state))
    } catch {
      // Storage unavailable - progress just won't persist.
    }
  }

  // A new day: fresh progress (the streak stays until a claim decides it).
  _roll() {
    const today = dayKey()
    if (this.state.day === today) return
    this.state.day = today
    this.state.progress = 0
    this.state.claimed = false
    this._save()
  }

  // Everything the Quests card needs.
  current() {
    this._roll()
    const c = challengeFor(this.state.day)
    const live = this.state.lastClaim === this.state.day || this.state.lastClaim === yesterdayKey()
    // The streak you're on (0 once a day was missed) and what claiming
    // today would make it.
    const streak = live ? this.state.streak : 0
    const next = this.state.claimed ? streak : (this.state.lastClaim === yesterdayKey() ? this.state.streak + 1 : 1)
    const mult = streakMult(next)
    return {
      ...c,
      progress: Math.min(c.target, this.state.progress),
      done: this.state.progress >= c.target,
      claimed: this.state.claimed,
      streak,
      nextStreak: next,
      mult,
      rewardCoins: Math.round(c.coins * mult),
      rewardXp: Math.round(c.xp * mult),
    }
  }

  // A play event (ProgressUI._onPlayEvent). Returns true the moment the
  // challenge gets finished, so the game can say so.
  record(type, data = {}) {
    this._roll()
    if (this.state.claimed) return false
    const c = challengeFor(this.state.day)
    const before = this.state.progress
    let next = before
    const kind = c.template.type
    if (type === 'kill') {
      if (kind === 'kills') next++
      else if (kind === 'melee' && data.melee) next++
      else if (kind === 'skeletons' && data.skeleton) next++
      else if (kind === 'rare' && RARE_TIERS.has(data.tier)) next++
      else if (kind === 'bosses' && data.boss) next++
      else if (kind === 'streak') next = Math.max(next, data.streak || 0)
    } else if (type === 'wave' && kind === 'wave') next = Math.max(next, data.wave || 0)
    if (next === before) return false
    this.state.progress = next
    this._save()
    return before < c.target && next >= c.target
  }

  // Returns { coins, xp, streak } once, when finished and not yet claimed.
  claim() {
    const c = this.current()
    if (!c.done || c.claimed) return null
    this.state.streak = c.nextStreak
    this.state.lastClaim = this.state.day
    this.state.claimed = true
    this._save()
    return { coins: c.rewardCoins, xp: c.rewardXp, streak: c.nextStreak }
  }

  // Ready to claim (the Quests button's number).
  ready() {
    const c = this.current()
    return c.done && !c.claimed ? 1 : 0
  }

  // Midnight tonight, for the countdown.
  msLeft(now = new Date()) {
    const end = new Date(now)
    end.setHours(24, 0, 0, 0)
    return end - now
  }
}
