const STORAGE_KEY = 'gayz-achievements'

// Each achievement is unlocked by a direct Game.js call - see the check
// points threaded through _tick/_onPickup/_onPlayerDeath. titleKey looks up
// the display name in i18n.js.
// tag/color: a short 2-letter monogram + accent color, used only by the
// homepage Achievement Showcase (see Game.js's _cycleShowcaseSlot) to
// render a pin-able badge. Colored-swatch-with-text, not an emoji glyph -
// matches #profile-emblem-row's existing "no-emoji UI" convention (see
// that rule's own comment in style.css) rather than introducing a new one.
export const ACHIEVEMENTS = [
  { id: 'first_blood', titleKey: 'achFirstBlood', tag: 'FB', color: '#c9564a' },
  { id: 'survivor_5', titleKey: 'achSurvivor5', tag: '5N', color: '#6fa8dc' },
  { id: 'survivor_10', titleKey: 'achSurvivor10', tag: '10N', color: '#6fa8dc' },
  { id: 'brute_knife', titleKey: 'achBruteKnife', tag: 'BK', color: '#e08a4f' },
  { id: 'minigun_unlocked', titleKey: 'achMinigunUnlocked', tag: 'MG', color: '#92a05e' },
  { id: 'centurion', titleKey: 'achCenturion', tag: '100', color: '#d9a34a' },
  { id: 'first_death', titleKey: 'achFirstDeath', tag: 'RIP', color: '#8a6d47' },
  { id: 'meat_grinder', titleKey: 'achMeatGrinder', tag: 'MG', color: '#c9564a' },
  { id: 'full_story', titleKey: 'achFullStory', tag: 'FS', color: '#b07cd6' },
  { id: 'true_ending', titleKey: 'achTrueEnding', tag: 'TE', color: '#d9a34a' },
  { id: 'shadow_hunter', titleKey: 'achShadowHunter', tag: 'SH', color: '#34383c' },
  { id: 'weapon_evolved', titleKey: 'achWeaponEvolved', tag: 'WE', color: '#92a05e' },
  { id: 'elite_hunter', titleKey: 'achEliteHunter', tag: 'EH', color: '#7fd8a0' },
  { id: 'road_kill', titleKey: 'achRoadKill', tag: 'RK', color: '#e08a4f' },
  { id: 'bestiary_master', titleKey: 'achBestiaryMaster', tag: 'BM', color: '#b07cd6' },
  { id: 'nightmare_survivor_5', titleKey: 'achNightmareSurvivor5', tag: 'N5', color: '#c9564a' },
  { id: 'nightmare_conqueror', titleKey: 'achNightmareConqueror', tag: 'NC', color: '#c9564a' },
  { id: 'fashion_icon', titleKey: 'achFashionIcon', tag: 'FI', color: '#6fa8dc' },
  // Deliberately last in the array - see unlock()'s own completionist
  // check, which excludes this id from "every OTHER achievement."
  { id: 'completionist', titleKey: 'achCompletionist', tag: '★', color: '#d9a34a' },
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

export class Achievements {
  constructor(onUnlock) {
    this.unlocked = loadUnlocked()
    this.onUnlock = onUnlock
  }

  // Safe to call repeatedly - a no-op once already unlocked.
  unlock(id) {
    if (this.unlocked.has(id)) return
    this.unlocked.add(id)
    saveUnlocked(this.unlocked)
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
}
