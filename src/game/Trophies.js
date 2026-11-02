// Trophies (2026-11-01, Gaymi's idea list 4, quick wins: "trophy room" -
// picked "both": a room at Safe Camp and a tab on your Profile).
//
// Each trophy is one of your saved records (career stats, best run, the
// Team, the Zombie Book, your best speedrun) - nothing new is saved. It
// comes in bronze, silver and gold, at TROPHIES[].tiers: the next one up
// shows how far you are. The Profile's Trophies tab draws them as cards
// (renderTrophies); CampTrophies.js puts them on shelves in the camp.
import { _escapeHtml, _safeStatNumber } from './Game.js'
import { t } from './i18n.js'
import { levelFromXp } from './Xp.js'
import { loadCreatures } from './Creatures.js'
import { ZOMBIE_TIER_IDS } from './ZombieNames.js'
import { BOOK_IDS, loadBook } from './ZombieBook.js'
import { loadBest, runTime } from './Speedrun.js'

export const TIER_NAMES = ['trophyLocked', 'trophyBronze', 'trophySilver', 'trophyGold']
export const TIER_COLORS = [0x3a3a3a, 0xc0763a, 0xd8dde4, 0xffcf3a]

// value(game) -> a number; higher is better unless `lower` (a time).
// show(v) -> how it's written. Rare Catch counts rarity steps (0 common).
export const TROPHIES = [
  { id: 'kills', key: 'trophyKills', tiers: [100, 1000, 10000], value: (g) => _safeStatNumber(g.careerStats?.totalKills) },
  { id: 'wave', key: 'trophyWave', tiers: [10, 25, 50], value: (g) => _safeStatNumber(g.bestStats?.bestWave) },
  { id: 'streak', key: 'trophyStreak', tiers: [10, 25, 50], value: (g) => _safeStatNumber(g.bestStats?.bestKillStreak) },
  { id: 'skeletons', key: 'trophySkeletons', tiers: [25, 250, 1000], value: (g) => _safeStatNumber(g.careerStats?.skeletonKills) },
  { id: 'games', key: 'trophyGames', tiers: [10, 100, 500], value: (g) => _safeStatNumber(g.careerStats?.totalRuns) },
  { id: 'hours', key: 'trophyHours', tiers: [1, 10, 50], value: (g) => Math.floor(_safeStatNumber(g.careerStats?.lifetimePlaytimeSeconds) / 3600) },
  { id: 'coins', key: 'trophyCoins', tiers: [1000, 10000, 100000], value: (g) => _safeStatNumber(g.careerStats?.lifetimeCoinsEarned) },
  { id: 'level', key: 'trophyLevel', tiers: [10, 25, 50], value: (g) => levelFromXp(_safeStatNumber(g.careerStats?.xp)).level },
  { id: 'assists', key: 'trophyAssists', tiers: [10, 100, 500], value: (g) => _safeStatNumber(g.careerStats?.totalAssists) },
  { id: 'achievements', key: 'trophyAchievements', tiers: [10, 40, 80], value: (g) => g.achievements?.unlocked?.size || 0 },
  { id: 'creatures', key: 'trophyCreatures', tiers: [5, 25, 100], value: () => loadCreatures().list.length },
  { id: 'rare', key: 'trophyRare', tiers: [2, 4, 5], value: () => Math.max(0, ...loadCreatures().list.map((c) => ZOMBIE_TIER_IDS.indexOf(c.r))), show: (v) => (v > 0 ? t(`rarity${ZOMBIE_TIER_IDS[v][0].toUpperCase()}${ZOMBIE_TIER_IDS[v].slice(1)}`) : '-') },
  { id: 'battles', key: 'trophyBattles', tiers: [5, 25, 100], value: () => loadCreatures().wins },
  { id: 'book', key: 'trophyBook', tiers: [Math.ceil(BOOK_IDS.length / 4), Math.ceil(BOOK_IDS.length / 2), BOOK_IDS.length], value: () => Object.keys(loadBook()).length, show: (v) => `${v}/${BOOK_IDS.length}` },
  // Seconds: under 5, 3 and 2 minutes.
  { id: 'speedrun', key: 'trophySpeedrun', lower: true, tiers: [300000, 180000, 120000], value: () => loadBest()?.ms || 0, show: (v) => (v ? runTime(v) : '-') },
]

// 0 locked .. 3 gold.
export function tierOf(trophy, v) {
  let tier = 0
  trophy.tiers.forEach((need, i) => {
    const ok = trophy.lower ? v > 0 && v <= need : v >= need
    if (ok) tier = i + 1
  })
  return tier
}

const shown = (trophy, v) => (trophy.show ? trophy.show(v) : Number(v).toLocaleString())

// Every trophy right now: { id, name, tier, value (written), next (the
// next tier's goal, written, or '' at gold) }.
export function trophyList(game) {
  return TROPHIES.map((tr) => {
    let v = 0
    try { v = Number(tr.value(game)) || 0 } catch { /* a record that can't be read counts as none */ }
    const tier = tierOf(tr, v)
    return { id: tr.id, name: t(tr.key), tier, value: shown(tr, v), next: tier < 3 ? shown(tr, tr.tiers[tier]) : '' }
  })
}

// The Profile's Trophies tab.
export function renderTrophies(game) {
  const box = document.getElementById('profile-trophies-grid')
  if (!box) return
  const list = trophyList(game)
  const golds = list.filter((x) => x.tier === 3).length
  const head = document.getElementById('profile-trophies-count')
  if (head) head.textContent = t('trophiesCount', { n: list.filter((x) => x.tier > 0).length, total: list.length, gold: golds })
  box.innerHTML = list.map((x) => `
    <div class="trophy-card" data-tier="${x.tier}">
      <div class="trophy-cup" aria-hidden="true"><i></i><b></b><s></s></div>
      <div class="trophy-text">
        <strong>${_escapeHtml(x.name)}</strong>
        <span class="trophy-tier">${_escapeHtml(t(TIER_NAMES[x.tier]))} · ${_escapeHtml(x.value)}</span>
        ${x.next ? `<span class="trophy-next">${_escapeHtml(t('trophyNext', { n: x.next }))}</span>` : ''}
      </div>
    </div>`).join('')
}
