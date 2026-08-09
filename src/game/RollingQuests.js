// Rolling quests - distinct from Quests.js's fixed lifetime milestones
// (kill_100, streak_20, etc., each claimed once ever). These expire 3
// hours after they spawn and a new one spawns every 30 minutes (so up to
// 6 can be active at once), matching Kirka.io's own quest cadence per the
// user's explicit ask. Real-clock-time based (not the date-string-seeded
// pattern the existing Daily Challenge mutator uses), since these rotate
// within a day, not once per day.
const STORAGE_KEY = 'gayz-rolling-quests'
export const SPAWN_INTERVAL_MS = 30 * 60 * 1000
export const EXPIRE_MS = 3 * 60 * 60 * 1000
const MAX_ACTIVE = 6

// Three objective types, each with a single clean live hook point in
// Game.js (_onZombieKilled, the this.night += 1 line, _recordRunEnd) -
// deliberately not points/coins (incremented from a dozen+ scattered call
// sites across Game.js, no single place to hook without a much bigger
// refactor).
export const QUEST_TEMPLATES = [
  { type: 'kills', target: 10, titleKey: 'rollingQuestKills', rewardCoins: 80, rewardXp: 30 },
  { type: 'kills', target: 25, titleKey: 'rollingQuestKills', rewardCoins: 180, rewardXp: 60 },
  { type: 'kills', target: 50, titleKey: 'rollingQuestKills', rewardCoins: 350, rewardXp: 120 },
  { type: 'night', target: 2, titleKey: 'rollingQuestNight', rewardCoins: 120, rewardXp: 40 },
  { type: 'night', target: 4, titleKey: 'rollingQuestNight', rewardCoins: 280, rewardXp: 90 },
  { type: 'night', target: 6, titleKey: 'rollingQuestNight', rewardCoins: 500, rewardXp: 160 },
  { type: 'runs', target: 1, titleKey: 'rollingQuestRuns', rewardCoins: 100, rewardXp: 35 },
  { type: 'runs', target: 3, titleKey: 'rollingQuestRuns', rewardCoins: 280, rewardXp: 90 },
]

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && Array.isArray(parsed.active) && Number.isFinite(parsed.lastSpawnAt)) {
      return {
        active: parsed.active.filter((q) => q && Number.isFinite(q.templateIndex) && Number.isFinite(q.spawnedAt) && Number.isFinite(q.progress)),
        lastSpawnAt: parsed.lastSpawnAt,
      }
    }
  } catch {
    // Malformed/unavailable - fresh state below.
  }
  return { active: [], lastSpawnAt: Date.now() }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage unavailable - quests just won't persist across sessions.
  }
}

export class RollingQuests {
  constructor() {
    this.state = loadState()
    this._tick()
  }

  // Prunes expired entries and spawns any quests that should have appeared
  // while the game wasn't open, one real SPAWN_INTERVAL_MS at a time (not
  // jumping straight to now) so a long absence still only ever fills up to
  // MAX_ACTIVE rather than dumping a huge backlog in one go.
  _tick() {
    const now = Date.now()
    this.state.active = this.state.active.filter((q) => now - q.spawnedAt < EXPIRE_MS)
    let spawnedAny = false
    while (now - this.state.lastSpawnAt >= SPAWN_INTERVAL_MS && this.state.active.length < MAX_ACTIVE) {
      this.state.lastSpawnAt += SPAWN_INTERVAL_MS
      const activeTemplateIndexes = new Set(this.state.active.map((q) => q.templateIndex))
      const candidates = QUEST_TEMPLATES.map((_, i) => i).filter((i) => !activeTemplateIndexes.has(i))
      const pool = candidates.length > 0 ? candidates : QUEST_TEMPLATES.map((_, i) => i)
      const templateIndex = pool[Math.floor(Math.random() * pool.length)]
      this.state.active.push({ templateIndex, spawnedAt: this.state.lastSpawnAt, progress: 0, claimed: false })
      spawnedAny = true
    }
    // lastSpawnAt can drift behind "now" forever once MAX_ACTIVE is full
    // (the while loop above stops early) - catch it back up so a slot that
    // frees up later (expiry or claim) doesn't immediately spawn a whole
    // backlog of intervals that piled up while the list was full.
    if (this.state.active.length >= MAX_ACTIVE && now - this.state.lastSpawnAt >= SPAWN_INTERVAL_MS) {
      this.state.lastSpawnAt = now - (now % SPAWN_INTERVAL_MS)
    }
    saveState(this.state)
    return spawnedAny
  }

  // Call periodically (e.g. whenever the homepage/panel re-renders) so
  // expiry and new spawns are reflected without needing a real-time timer
  // loop of their own.
  refresh() {
    this._tick()
  }

  activeQuests() {
    return this.state.active.map((q) => ({ ...q, template: QUEST_TEMPLATES[q.templateIndex] }))
  }

  // additive=true accumulates (kills, runs - each event adds to a running
  // total since the quest spawned); additive=false takes the max seen so
  // far (night - "reach Night 4" should stay satisfied once hit, even if a
  // later run only gets to Night 2, not get overwritten downward).
  _recordProgress(type, value, additive) {
    let changed = false
    for (const q of this.state.active) {
      if (q.claimed) continue
      const template = QUEST_TEMPLATES[q.templateIndex]
      if (template.type !== type) continue
      const next = additive ? q.progress + value : Math.max(q.progress, value)
      if (next !== q.progress) {
        q.progress = next
        changed = true
      }
    }
    if (changed) saveState(this.state)
  }

  recordKill() {
    this._recordProgress('kills', 1, true)
  }

  recordNight(night) {
    this._recordProgress('night', night, false)
  }

  recordRunComplete() {
    this._recordProgress('runs', 1, true)
  }

  // Safe to call repeatedly - a no-op if already claimed or not yet at
  // target. Returns the reward on an actual successful claim (so the
  // caller knows whether/what to show a toast for), otherwise null. Applies
  // the coin reward directly (same as Quests.js's own claim()), but
  // deliberately leaves XP for the caller to apply - game.xp has its own
  // _updateXpHud()/_checkXpLevelUp() side effects that belong on the
  // Game.js side, not duplicated in here.
  claim(spawnedAt, game) {
    const q = this.state.active.find((x) => x.spawnedAt === spawnedAt)
    if (!q || q.claimed) return null
    const template = QUEST_TEMPLATES[q.templateIndex]
    if (q.progress < template.target) return null
    q.claimed = true
    this.state.active = this.state.active.filter((x) => x.spawnedAt !== spawnedAt)
    saveState(this.state)
    game.coins += template.rewardCoins
    return { coins: template.rewardCoins, xp: template.rewardXp }
  }
}
