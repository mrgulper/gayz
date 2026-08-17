// Permanent, cross-run per-weapon progression: every kill with a gun counts
// toward that gun's own tally (see Game.js's _onZombieKilled), and crossing
// MASTERY_THRESHOLD kills unlocks a permanent damage bonus for that weapon
// specifically - distinct from MetaProgress.js's Legacy Points upgrades
// (spent currency, not earned through use) and from rarityMult (a per-run
// loot roll that resets every fresh weapon).
const STORAGE_KEY = 'gayz-weapon-mastery'
export const MASTERY_THRESHOLD = 75
export const MASTERY_DAMAGE_MULT = 1.12
// Grandmaster - a second, further-out tier past mastery (see Game.js's
// _trackWeaponMastery), replacing MASTERY_DAMAGE_MULT with a bigger bonus
// rather than stacking on top of it, so the number on a fully-progressed
// weapon stays a single clean multiplier instead of two compounding ones.
export const GRANDMASTER_THRESHOLD = 250
export const GRANDMASTER_DAMAGE_MULT = 1.25
// Legendary - a 3rd tier past Grandmaster (see Game.js's _trackWeaponMastery).
// Deliberately a different stat (reload speed) rather than a 3rd damage
// multiplier stacked on top, so a fully-progressed weapon feels distinct at
// each tier instead of just "the same bonus, bigger number" again.
export const LEGENDARY_THRESHOLD = 600
export const LEGENDARY_RELOAD_MULT = 0.8

export function loadMastery() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return {
      kills: parsed.kills || {},
      mastered: new Set(parsed.mastered || []),
      grandmastered: new Set(parsed.grandmastered || []),
      legendary: new Set(parsed.legendary || []),
      // Heirlooms (see Game.js's _offerHeirloomForge) - a purely cosmetic,
      // player-opted-into 'heirloom' skin tier on top of an already-
      // grandmastered weapon, the one cosmetic payoff Grandmaster's flat
      // damage bonus alone doesn't give.
      heirlooms: new Set(parsed.heirlooms || []),
    }
  } catch {
    return { kills: {}, mastered: new Set(), grandmastered: new Set(), legendary: new Set(), heirlooms: new Set() }
  }
}

export function saveMastery(mastery) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      kills: mastery.kills,
      mastered: [...mastery.mastered],
      grandmastered: [...mastery.grandmastered],
      legendary: [...mastery.legendary],
      heirlooms: [...mastery.heirlooms],
    }))
  } catch {
    // Storage unavailable - mastery progress just won't persist across sessions.
  }
}
