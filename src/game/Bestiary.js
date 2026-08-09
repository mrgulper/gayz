// Tracks which zombie types the player has ever killed, for the bestiary
// section of the Achievements panel (see Game.js's _renderBestiaryPanel).
// Lore blurbs themselves live on each entry in ZombieTypes.js.
const STORAGE_KEY = 'gayz-bestiary'

export function loadEncountered() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return new Set(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set()
  }
}

export function saveEncountered(set) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]))
  } catch {
    // Storage unavailable (e.g. private browsing) - progress just won't persist.
  }
}
