const STORAGE_KEY = 'gayz-quests-claimed'

// Three tracks: cumulative career kills (careerStats.totalKills, already
// tracked - see Achievements/Profile for the same field), single-run kill
// streak (bestStats.bestKillStreak, the existing all-time-best streak
// stat, not a per-run value that resets), and cumulative lifetime points
// earned (careerStats.lifetimePointsEarned - a new field, since the
// existing `points` balance is spent on perks/rerolls and goes back down,
// so it can't gate a "reach X lifetime" milestone on its own; see Game.js's
// _gainPoints, the one place every points award now routes through).
export const QUESTS = [
  { id: 'kill_100', type: 'kills', target: 100, rewardCoins: 200, titleKey: 'questKill100' },
  { id: 'kill_500', type: 'kills', target: 500, rewardCoins: 750, titleKey: 'questKill500' },
  { id: 'kill_1000', type: 'kills', target: 1000, rewardCoins: 1500, titleKey: 'questKill1000' },
  { id: 'kill_5000', type: 'kills', target: 5000, rewardCoins: 6000, titleKey: 'questKill5000' },
  { id: 'kill_10000', type: 'kills', target: 10000, rewardCoins: 12000, titleKey: 'questKill10000' },
  { id: 'kill_20000', type: 'kills', target: 20000, rewardCoins: 24000, titleKey: 'questKill20000' },
  { id: 'kill_50000', type: 'kills', target: 50000, rewardCoins: 55000, titleKey: 'questKill50000' },
  { id: 'kill_100000', type: 'kills', target: 100000, rewardCoins: 100000, titleKey: 'questKill100000' },
  { id: 'streak_5', type: 'killstreak', target: 5, rewardCoins: 150, titleKey: 'questStreak5' },
  { id: 'streak_10', type: 'killstreak', target: 10, rewardCoins: 400, titleKey: 'questStreak10' },
  { id: 'streak_20', type: 'killstreak', target: 20, rewardCoins: 1000, titleKey: 'questStreak20' },
  { id: 'streak_30', type: 'killstreak', target: 30, rewardCoins: 2000, titleKey: 'questStreak30' },
  { id: 'streak_50', type: 'killstreak', target: 50, rewardCoins: 4000, titleKey: 'questStreak50' },
  { id: 'streak_100', type: 'killstreak', target: 100, rewardCoins: 8000, titleKey: 'questStreak100' },
  { id: 'streak_200', type: 'killstreak', target: 200, rewardCoins: 18000, titleKey: 'questStreak200' },
  { id: 'streak_500', type: 'killstreak', target: 500, rewardCoins: 50000, titleKey: 'questStreak500' },
  { id: 'streak_1000', type: 'killstreak', target: 1000, rewardCoins: 120000, titleKey: 'questStreak1000' },
  { id: 'points_1000', type: 'points', target: 1000, rewardCoins: 300, titleKey: 'questPoints1000' },
  { id: 'points_5000', type: 'points', target: 5000, rewardCoins: 1200, titleKey: 'questPoints5000' },
  { id: 'points_10000', type: 'points', target: 10000, rewardCoins: 2200, titleKey: 'questPoints10000' },
  { id: 'points_50000', type: 'points', target: 50000, rewardCoins: 9000, titleKey: 'questPoints50000' },
  { id: 'points_100000', type: 'points', target: 100000, rewardCoins: 16000, titleKey: 'questPoints100000' },
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
