const STORAGE_KEY = 'gayz-achievements'

// Each achievement is unlocked by a direct Game.js call - see the check
// points threaded through _tick/_onPickup/_onPlayerDeath. titleKey looks up
// the display name in i18n.js.
export const ACHIEVEMENTS = [
  { id: 'first_blood', titleKey: 'achFirstBlood' },
  { id: 'survivor_5', titleKey: 'achSurvivor5' },
  { id: 'survivor_10', titleKey: 'achSurvivor10' },
  { id: 'brute_knife', titleKey: 'achBruteKnife' },
  { id: 'minigun_unlocked', titleKey: 'achMinigunUnlocked' },
  { id: 'centurion', titleKey: 'achCenturion' },
  { id: 'first_death', titleKey: 'achFirstDeath' },
  { id: 'meat_grinder', titleKey: 'achMeatGrinder' },
  { id: 'full_story', titleKey: 'achFullStory' },
  { id: 'true_ending', titleKey: 'achTrueEnding' },
  { id: 'shadow_hunter', titleKey: 'achShadowHunter' },
  { id: 'weapon_evolved', titleKey: 'achWeaponEvolved' },
  { id: 'elite_hunter', titleKey: 'achEliteHunter' },
  { id: 'road_kill', titleKey: 'achRoadKill' },
  { id: 'bestiary_master', titleKey: 'achBestiaryMaster' },
  { id: 'nightmare_survivor_5', titleKey: 'achNightmareSurvivor5' },
  { id: 'nightmare_conqueror', titleKey: 'achNightmareConqueror' },
  { id: 'fashion_icon', titleKey: 'achFashionIcon' },
  // Deliberately last in the array - see unlock()'s own completionist
  // check, which excludes this id from "every OTHER achievement."
  { id: 'completionist', titleKey: 'achCompletionist' },
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
