// Permanent, cross-run per-weapon progression: every kill with a gun counts
// toward that gun's own tally (see Game.js's _onZombieKilled), and crossing
// MASTERY_THRESHOLD kills unlocks a permanent damage bonus for that weapon
// specifically - distinct from MetaProgress.js's Legacy Points upgrades
// (spent currency, not earned through use) and from rarityMult (a per-run
// loot roll that resets every fresh weapon).
const STORAGE_KEY = 'gayz-weapon-mastery'
export const MASTERY_THRESHOLD = 75
export const MASTERY_DAMAGE_MULT = 1.12

export function loadMastery() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return {
      kills: parsed.kills || {},
      mastered: new Set(parsed.mastered || []),
    }
  } catch {
    return { kills: {}, mastered: new Set() }
  }
}

export function saveMastery(mastery) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ kills: mastery.kills, mastered: [...mastery.mastered] }))
  } catch {
    // Storage unavailable - mastery progress just won't persist across sessions.
  }
}
