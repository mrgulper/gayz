// Rolling quests - distinct from Quests.js's fixed lifetime milestones
// (kill_100, streak_20, etc., each claimed once ever). A GLOBAL rotation:
// every player sees the exact same currently-active quests at the same
// real-world moment, computed deterministically from wall-clock time (a
// seeded PRNG keyed by a fixed-length time bucket index) rather than each
// player tracking their own local spawn history from whenever they first
// opened the game. This means the rotation "resets" on a real schedule
// even if nobody was online to trigger it - whoever logs in next sees
// whatever's currently active, same as everyone else, with no backend
// needed (every browser derives the identical selection independently).
// Only PROGRESS and CLAIMED status are personal/local - this player's own
// kill count toward a shared quest, not a shared counter.
const STORAGE_KEY = 'gayz-rolling-quests-v2'
export const SPAWN_INTERVAL_MS = 30 * 60 * 1000
export const QUESTS_PER_SPAWN = 5
export const EXPIRE_MS = 3 * 60 * 60 * 1000
const BUCKET_LOOKBACK = Math.ceil(EXPIRE_MS / SPAWN_INTERVAL_MS) + 1

// Deliberately non-round targets (11/23/58, not 10/25/50) so a quest
// reads like a found number, not an obviously-generated one.
export const QUEST_TEMPLATES = [
  { type: 'kills', target: 11, titleKey: 'rollingQuestKills', rewardCoins: 80, rewardXp: 30 },
  { type: 'kills', target: 23, titleKey: 'rollingQuestKills', rewardCoins: 180, rewardXp: 60 },
  { type: 'kills', target: 58, titleKey: 'rollingQuestKills', rewardCoins: 350, rewardXp: 120 },
  { type: 'night', target: 2, titleKey: 'rollingQuestNight', rewardCoins: 120, rewardXp: 40 },
  { type: 'night', target: 4, titleKey: 'rollingQuestNight', rewardCoins: 280, rewardXp: 90 },
  { type: 'night', target: 6, titleKey: 'rollingQuestNight', rewardCoins: 500, rewardXp: 160 },
  { type: 'runs', target: 1, titleKey: 'rollingQuestRuns', rewardCoins: 100, rewardXp: 35 },
  { type: 'runs', target: 3, titleKey: 'rollingQuestRuns', rewardCoins: 280, rewardXp: 90 },
]

// Deterministic PRNG (mulberry32) - the same seed always produces the same
// sequence, which is the whole point here: every player's browser derives
// the identical quest selection for a given bucket index with no server
// round-trip involved.
function mulberry32(seed) {
  let t = seed >>> 0
  return function () {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), t | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

// Which QUEST_TEMPLATES indexes are active for a given 30-minute bucket -
// pure function of the bucket index, so it's cheap to recompute on every
// call rather than caching (no per-kill hot path concerns; this runs at
// most BUCKET_LOOKBACK times per activeQuests() call).
function templatesForBucket(bucket) {
  const rand = mulberry32(bucket)
  const pool = QUEST_TEMPLATES.map((_, i) => i)
  const picked = []
  for (let i = 0; i < QUESTS_PER_SPAWN && pool.length > 0; i++) {
    const idx = Math.floor(rand() * pool.length)
    picked.push(pool.splice(idx, 1)[0])
  }
  return picked
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && parsed.progress && typeof parsed.progress === 'object' && Array.isArray(parsed.claimed)) {
      return { progress: parsed.progress, claimed: new Set(parsed.claimed) }
    }
  } catch {
    // Malformed/unavailable - fresh state below.
  }
  return { progress: {}, claimed: new Set() }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ progress: state.progress, claimed: [...state.claimed] }))
  } catch {
    // Storage unavailable - progress just won't persist across sessions.
  }
}

export class RollingQuests {
  constructor() {
    this.state = loadState()
    this._prune()
  }

  // Drops progress/claimed entries whose bucket has fully expired, so
  // localStorage doesn't grow forever. Safe to call often - it's just a
  // filter over two small collections, no real work most of the time.
  _prune() {
    const now = Date.now()
    let changed = false
    for (const key of Object.keys(this.state.progress)) {
      if (now - Number(key) >= EXPIRE_MS + SPAWN_INTERVAL_MS) {
        delete this.state.progress[key]
        changed = true
      }
    }
    for (const key of this.state.claimed) {
      if (now - key >= EXPIRE_MS + SPAWN_INTERVAL_MS) {
        this.state.claimed.delete(key)
        changed = true
      }
    }
    if (changed) saveState(this.state)
  }

  // No real "spawning" happens here any more - the active set is a pure
  // function of the current time, recomputed fresh every call. Kept as a
  // method since Game.js calls this as its panel-open/render refresh hook.
  refresh() {
    this._prune()
  }

  // Union of every non-expired, non-claimed quest instance across recent
  // buckets, most recent first - same overall shape (spawnedAt/progress/
  // template) the old per-player version returned, so nothing downstream
  // in Game.js needed to change. No cap - every instance still alive
  // (hasn't hit EXPIRE_MS since its spawn) shows.
  activeQuests() {
    const now = Date.now()
    const currentBucket = Math.floor(now / SPAWN_INTERVAL_MS)
    const results = []
    for (let b = currentBucket; b > currentBucket - BUCKET_LOOKBACK && b >= 0; b--) {
      const spawnedAtBase = b * SPAWN_INTERVAL_MS
      if (now - spawnedAtBase >= EXPIRE_MS) continue
      for (const [slot, templateIndex] of templatesForBucket(b).entries()) {
        const spawnedAt = spawnedAtBase + slot
        if (this.state.claimed.has(spawnedAt)) continue
        results.push({
          spawnedAt,
          progress: this.state.progress[spawnedAt] || 0,
          template: QUEST_TEMPLATES[templateIndex],
        })
      }
    }
    return results
  }

  // additive=true accumulates (kills, runs - each event adds to a running
  // total since the quest spawned); additive=false takes the max seen so
  // far (night - "reach Night 4" should stay satisfied once hit, even if a
  // later run only gets to Night 2, not get overwritten downward).
  _recordProgress(type, value, additive) {
    let changed = false
    for (const q of this.activeQuests()) {
      if (q.template.type !== type) continue
      const current = this.state.progress[q.spawnedAt] || 0
      const next = additive ? current + value : Math.max(current, value)
      if (next !== current) {
        this.state.progress[q.spawnedAt] = next
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
  // caller knows whether/what to show a toast for), otherwise null.
  // Re-derives which template spawnedAt refers to from its bucket+slot
  // (spawnedAt = bucket*SPAWN_INTERVAL_MS + slot) rather than needing a
  // stored list, matching activeQuests()'s own pure-function approach.
  claim(spawnedAt, game) {
    if (this.state.claimed.has(spawnedAt)) return null
    const bucket = Math.floor(spawnedAt / SPAWN_INTERVAL_MS)
    const slot = spawnedAt - bucket * SPAWN_INTERVAL_MS
    const templateIndex = templatesForBucket(bucket)[slot]
    if (templateIndex === undefined) return null
    const template = QUEST_TEMPLATES[templateIndex]
    const progress = this.state.progress[spawnedAt] || 0
    if (progress < template.target) return null
    this.state.claimed.add(spawnedAt)
    saveState(this.state)
    game.coins += template.rewardCoins
    return { coins: template.rewardCoins, xp: template.rewardXp }
  }
}
