// Auto Quality (Graphics tab, settings.autoQuality, on by default) - keeps
// weak devices (phones, school Chromebooks, old laptops) near 60fps by
// stepping visual quality down one notch at a time while the frame rate is
// low, and back up once there's sustained headroom. A device that already
// holds 60fps never leaves level 0, so it looks exactly like it did before
// this existed.
//
// Only worth doing since the 2026-09-28 CPU fixes (see docs/PERFORMANCE.md
// section 0): the earlier dynamic-resolution attempt (see _dynResScale's
// comment in Game.js) was disabled because the game was CPU-bound at the
// time, so rendering fewer pixels bought nothing. With the per-frame CPU
// cost cut to a few ms, what's left on a weak device is mostly GPU fill
// and draw work - which is exactly what these levers reduce.
//
// Each level only ever makes things cheaper than the one before, least
// noticeable lever first:
//   res       - render resolution multiplier (Game.js's _dynResScale)
//   view      - view distance + fog multiplier (on top of _perfDistanceMult)
//   zombieCap - ceiling for the live zombie population governor (null = the
//               governor's own default ceiling)
//   animFar / animSkip - zombies farther than animFar only animate every
//               animSkip-th frame (Zombie.js's zombieAnimLod)
//   lights    - rendered point lights (LightProxies.js). Changing this
//               recompiles every shader, so it's only ever read once, at
//               page load, from the level this device ended its last
//               session on - never switched mid-run.
export const AUTO_QUALITY_LEVELS = [
  { res: 1, view: 1, zombieCap: null, animFar: 40, animSkip: 3, lights: 10 },
  { res: 0.85, view: 1, zombieCap: null, animFar: 40, animSkip: 3, lights: 10 },
  { res: 0.72, view: 0.85, zombieCap: 16, animFar: 30, animSkip: 3, lights: 8 },
  { res: 0.6, view: 0.7, zombieCap: 12, animFar: 22, animSkip: 4, lights: 6 },
  { res: 0.5, view: 0.55, zombieCap: 8, animFar: 15, animSkip: 5, lights: 4 },
]
export const AUTO_QUALITY_MAX_LEVEL = AUTO_QUALITY_LEVELS.length - 1

const LEVEL_STORAGE_KEY = 'gayz-auto-quality-level'

// Below this the game steps quality down; at or above UPGRADE_FPS for
// UPGRADE_HOLD_MS it steps back up. The gap between the two keeps it from
// flipping back and forth around a single threshold.
const DOWNGRADE_FPS = 50
const UPGRADE_FPS = 58
// Two consecutive low 500ms samples (1s of real lag, not one stutter).
const DOWNGRADE_STREAK = 2
const UPGRADE_HOLD_MS = 10000
// After any change, wait this long before judging the new level - the
// first frames after a resolution change aren't representative.
const CHANGE_COOLDOWN_MS = 3000
// Stepping up and then immediately having to step back down means this
// device sits right on the edge of that level - wait much longer before
// trying it again, so it doesn't bounce every ten seconds.
const BOUNCE_WINDOW_MS = 20000
const BOUNCE_HOLD_MS = 120000

// First-visit guess at where to start, so a phone doesn't have to lag
// through several downgrades before settling. Only used when this device
// has no saved level yet; the controller corrects it either way within
// seconds of play.
export function guessInitialLevel() {
  try {
    const ua = navigator.userAgent || ''
    const mobile = (navigator.userAgentData && navigator.userAgentData.mobile) || /iPhone|iPad|iPod|Android/i.test(ua) ||
      // iPadOS reports itself as a Mac - a touch-capable "Mac" is an iPad.
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
    if (mobile) return 2
    const chromebook = /CrOS/.test(ua)
    const lowMemory = typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 4
    const fewCores = typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 4
    if (chromebook || lowMemory || fewCores) return 1
  } catch {
    // Feature detection only - fall through to full quality.
  }
  return 0
}

export function loadSavedLevel() {
  try {
    const raw = localStorage.getItem(LEVEL_STORAGE_KEY)
    if (raw === null) return null
    const n = Number(raw)
    return Number.isInteger(n) && n >= 0 && n <= AUTO_QUALITY_MAX_LEVEL ? n : null
  } catch {
    return null
  }
}

function saveLevel(level) {
  try {
    localStorage.setItem(LEVEL_STORAGE_KEY, String(level))
  } catch {
    // Storage unavailable - next visit just starts from the device guess.
  }
}

export class AutoQualityController {
  // apply(levelConfig, levelIndex) does the actual work (Game.js owns every
  // lever); this class only decides WHEN to change level.
  constructor(initialLevel, apply) {
    this.level = initialLevel
    this._apply = apply
    this._lowStreak = 0
    this._goodSince = null
    this._cooldownUntil = 0
    this._lastUpgradeAt = -Infinity
    this._upgradeHoldMs = UPGRADE_HOLD_MS
  }

  get config() {
    return AUTO_QUALITY_LEVELS[this.level]
  }

  setLevel(level, now = performance.now()) {
    const clamped = Math.max(0, Math.min(AUTO_QUALITY_MAX_LEVEL, level))
    if (clamped === this.level) return
    this.level = clamped
    this._cooldownUntil = now + CHANGE_COOLDOWN_MS
    this._lowStreak = 0
    this._goodSince = null
    saveLevel(clamped)
    this._apply(this.config, clamped)
  }

  // Called with each ~500ms fps sample. `active` is false for any sample
  // that wasn't entirely real gameplay (menus, pause, a panel open, a
  // hidden tab) - those say nothing about how the game itself runs, so
  // they reset the counters instead of counting either way.
  sample(fps, active, now = performance.now()) {
    if (!active) {
      this._lowStreak = 0
      this._goodSince = null
      return
    }
    if (now < this._cooldownUntil) return

    if (fps < DOWNGRADE_FPS) {
      this._goodSince = null
      this._lowStreak++
      if (this._lowStreak >= DOWNGRADE_STREAK && this.level < AUTO_QUALITY_MAX_LEVEL) {
        if (now - this._lastUpgradeAt < BOUNCE_WINDOW_MS) this._upgradeHoldMs = BOUNCE_HOLD_MS
        this.setLevel(this.level + 1, now)
      }
      return
    }
    this._lowStreak = 0

    if (fps >= UPGRADE_FPS && this.level > 0) {
      if (this._goodSince === null) this._goodSince = now
      if (now - this._goodSince >= this._upgradeHoldMs) {
        this._lastUpgradeAt = now
        this.setLevel(this.level - 1, now)
      }
    } else {
      this._goodSince = null
    }
  }
}
