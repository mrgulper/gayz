const STORAGE_KEY = 'gayz-quests-claimed'

// Two tracks: cumulative career kills (careerStats.totalKills, already
// tracked - see Achievements/Profile for the same field) and single-run
// kill streak (bestStats.bestKillStreak, the existing all-time-best
// streak stat, not a per-run value that resets). No new tracking needed
// for either - both quest types just read data this game already saves.
export const QUESTS = [
  { id: 'kill_100', type: 'kills', target: 100, rewardCoins: 200, titleKey: 'questKill100' },
  { id: 'kill_500', type: 'kills', target: 500, rewardCoins: 750, titleKey: 'questKill500' },
  { id: 'kill_1000', type: 'kills', target: 1000, rewardCoins: 1500, titleKey: 'questKill1000' },
  { id: 'kill_5000', type: 'kills', target: 5000, rewardCoins: 6000, titleKey: 'questKill5000' },
  { id: 'kill_10000', type: 'kills', target: 10000, rewardCoins: 12000, titleKey: 'questKill10000' },
  { id: 'streak_5', type: 'killstreak', target: 5, rewardCoins: 150, titleKey: 'questStreak5' },
  { id: 'streak_10', type: 'killstreak', target: 10, rewardCoins: 400, titleKey: 'questStreak10' },
  { id: 'streak_20', type: 'killstreak', target: 20, rewardCoins: 1000, titleKey: 'questStreak20' },
  { id: 'streak_30', type: 'killstreak', target: 30, rewardCoins: 2000, titleKey: 'questStreak30' },
  { id: 'streak_50', type: 'killstreak', target: 50, rewardCoins: 4000, titleKey: 'questStreak50' },
]

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
    return quest.type === 'kills' ? game.careerStats.totalKills : game.bestStats.bestKillStreak
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
