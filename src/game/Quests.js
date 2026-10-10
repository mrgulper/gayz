const STORAGE_KEY = 'gayz-quests-claimed'

// Lifetime quests are Coming Soon (2026-10-10, Gaymi: "remove what's
// currently in it and change it to coming soon") - the old career kills /
// best streak / lifetime points milestones were removed. A future one is
// { id, type: 'kills' | 'killstreak' | 'points', target, rewardCoins,
// titleKey }, counted by Quests.currentProgress below; the Quests panel's
// Lifetime tab shows its Coming Soon line while this list is empty.
export const QUESTS = []

function loadClaimed() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return new Set(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set()
  }
}

function saveClaimed(set) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]))
  } catch {
    // Storage unavailable - claims just won't persist across sessions,
    // same best-effort precedent as Achievements.js's saveUnlocked.
  }
}

export class Quests {
  constructor() {
    this.claimed = loadClaimed()
  }

  isClaimed(id) {
    return this.claimed.has(id)
  }

  // game is the live Game instance - reads whichever stat this quest's
  // type tracks, never a second copy of it.
  currentProgress(quest, game) {
    if (quest.type === 'kills') return game.careerStats.totalKills
    if (quest.type === 'points') return game.careerStats.lifetimePointsEarned || 0
    return game.bestStats.bestKillStreak
  }

  isComplete(quest, game) {
    return this.currentProgress(quest, game) >= quest.target
  }

  // Safe to call repeatedly - a no-op once claimed or if not yet
  // complete. Returns true only on an actual successful claim, so the
  // caller knows whether to show a reward toast.
  claim(id, game) {
    const quest = QUESTS.find((q) => q.id === id)
    if (!quest || this.claimed.has(id) || !this.isComplete(quest, game)) return false
    this.claimed.add(id)
    saveClaimed(this.claimed)
    game.coins += quest.rewardCoins
    return true
  }
}
