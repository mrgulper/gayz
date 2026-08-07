const STORAGE_KEY = 'gayz-achievements'
// Unlock timestamps (for the homepage "Recently Unlocked" feed) - added
// after the unlocked Set above already existed, so this is forward-only:
// achievements unlocked before this shipped have no recorded time and
// simply never appear in the feed, rather than backfilling a fake time.
const UNLOCK_TIMES_KEY = 'gayz-achievement-unlock-times'

// Each achievement is unlocked by a direct Game.js call - see the check
// points threaded through _tick/_onPickup/_onPlayerDeath. titleKey looks up
// the display name in i18n.js.
// tag/color: a short 2-letter monogram + accent color, used only by the
// homepage Achievement Showcase (see Game.js's _cycleShowcaseSlot) to
// render a pin-able badge. Colored-swatch-with-text, not an emoji glyph -
// this project's established "no-emoji UI" convention.
// hintKey (Online Features batch, round 4): a locked-state description of
// how to unlock, shown in the Achievements panel instead of a bare "???"
// with zero guidance.
export const ACHIEVEMENTS = [
  { id: 'first_blood', titleKey: 'achFirstBlood', tag: 'FB', color: '#c9564a', hintKey: 'achHintFirstBlood' },
  { id: 'survivor_5', titleKey: 'achSurvivor5', tag: '5N', color: '#6fa8dc', hintKey: 'achHintSurvivor5' },
  { id: 'survivor_10', titleKey: 'achSurvivor10', tag: '10N', color: '#6fa8dc', hintKey: 'achHintSurvivor10' },
  { id: 'brute_knife', titleKey: 'achBruteKnife', tag: 'BK', color: '#e08a4f', hintKey: 'achHintBruteKnife' },
  { id: 'minigun_unlocked', titleKey: 'achMinigunUnlocked', tag: 'MG', color: '#92a05e', hintKey: 'achHintMinigunUnlocked' },
  { id: 'centurion', titleKey: 'achCenturion', tag: '100', color: '#d9a34a', hintKey: 'achHintCenturion' },
  { id: 'first_death', titleKey: 'achFirstDeath', tag: 'RIP', color: '#8a6d47', hintKey: 'achHintFirstDeath' },
  { id: 'meat_grinder', titleKey: 'achMeatGrinder', tag: 'MG', color: '#c9564a', hintKey: 'achHintMeatGrinder' },
  { id: 'full_story', titleKey: 'achFullStory', tag: 'FS', color: '#b07cd6', hintKey: 'achHintFullStory' },
  { id: 'true_ending', titleKey: 'achTrueEnding', tag: 'TE', color: '#d9a34a', hintKey: 'achHintTrueEnding' },
  { id: 'shadow_hunter', titleKey: 'achShadowHunter', tag: 'SH', color: '#34383c', hintKey: 'achHintShadowHunter' },
  { id: 'weapon_evolved', titleKey: 'achWeaponEvolved', tag: 'WE', color: '#92a05e', hintKey: 'achHintWeaponEvolved' },
  { id: 'elite_hunter', titleKey: 'achEliteHunter', tag: 'EH', color: '#7fd8a0', hintKey: 'achHintEliteHunter' },
  { id: 'road_kill', titleKey: 'achRoadKill', tag: 'RK', color: '#e08a4f', hintKey: 'achHintRoadKill' },
  { id: 'bestiary_master', titleKey: 'achBestiaryMaster', tag: 'BM', color: '#b07cd6', hintKey: 'achHintBestiaryMaster' },
  { id: 'nightmare_survivor_5', titleKey: 'achNightmareSurvivor5', tag: 'N5', color: '#c9564a', hintKey: 'achHintNightmareSurvivor5' },
  { id: 'nightmare_conqueror', titleKey: 'achNightmareConqueror', tag: 'NC', color: '#c9564a', hintKey: 'achHintNightmareConqueror' },
  { id: 'fashion_icon', titleKey: 'achFashionIcon', tag: 'FI', color: '#6fa8dc', hintKey: 'achHintFashionIcon' },
  // Deliberately last in the array - see unlock()'s own completionist
  // check, which excludes this id from "every OTHER achievement."
  { id: 'completionist', titleKey: 'achCompletionist', tag: '★', color: '#d9a34a', hintKey: 'achHintCompletionist' },
]

function loadUnlocked() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return new Set(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set()
  }
}

function saveUnlocked(set) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]))
  } catch {
    // Storage unavailable - unlocks just won't persist across sessions.
  }
}

function loadUnlockTimes() {
  try {
    const raw = localStorage.getItem(UNLOCK_TIMES_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveUnlockTimes(obj) {
  try {
    localStorage.setItem(UNLOCK_TIMES_KEY, JSON.stringify(obj))
  } catch {
    // Storage unavailable - same best-effort as saveUnlocked above.
  }
}

export class Achievements {
  constructor(onUnlock) {
    this.unlocked = loadUnlocked()
    this.unlockTimes = loadUnlockTimes()
    this.onUnlock = onUnlock
  }

  // Safe to call repeatedly - a no-op once already unlocked.
  unlock(id) {
    if (this.unlocked.has(id)) return
    this.unlocked.add(id)
    saveUnlocked(this.unlocked)
    this.unlockTimes[id] = Date.now()
    saveUnlockTimes(this.unlockTimes)
    const def = ACHIEVEMENTS.find((a) => a.id === id)
    if (def && this.onUnlock) this.onUnlock(def)
    // Completionist - auto-unlocks once every OTHER achievement is earned.
    // Checked here rather than scattered across every unlock() call site in
    // Game.js, so any achievement added later automatically counts toward
    // it for free.
    if (id !== 'completionist' && !this.unlocked.has('completionist')) {
      const others = ACHIEVEMENTS.filter((a) => a.id !== 'completionist')
      if (others.every((a) => this.unlocked.has(a.id))) this.unlock('completionist')
    }
  }

  // Homepage "Recently Unlocked" feed - only ever includes ids present in
  // unlockTimes (see UNLOCK_TIMES_KEY's own comment on why that's not
  // every unlocked achievement).
  getRecentUnlocks(n) {
    return Object.keys(this.unlockTimes)
      .sort((a, b) => this.unlockTimes[b] - this.unlockTimes[a])
      .slice(0, n)
      .map((id) => ACHIEVEMENTS.find((a) => a.id === id))
      .filter(Boolean)
  }
}
