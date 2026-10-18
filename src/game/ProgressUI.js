// Progress between runs: what a Map 1 run reports (_onPlayEvent, _recordRunEnd,
// leaderboard entries), achievements (panel, toasts), quests (lifetime and
// rolling), Upgrades and Prestige, the login streak, best stats and the stats
// dashboard, and the red dots / tab badge that say something is waiting.
//
// Moved out of Game.js (2026-10-16, bit by bit - see CLAUDE.md). Plain functions
// taking `game`, all state on the Game instance; Game.js keeps a one-line
// stand-in for each, so callers are unchanged.
import * as CloudSaveUI from './CloudSaveUI.js'
import { ACHIEVEMENTS } from './Achievements.js'
import { ACHIEVEMENTS_SEEN_IDS_KEY, ACHIEVEMENT_CHAINS, ACHIEVEMENT_TOAST_GAP_MS, APEX_PREDATOR_WAVES, BONE_COLLECTOR_SKELETONS, BOSS_HUNTER_BOSSES, DEEP_POCKETS_COINS, ENDGAME_ACHIEVEMENT, EXTERMINATOR_CAREER_KILLS, FORTUNE_HUNTER_COINS, FULLY_LOADED_UPGRADES, HARDENED_WAVES, HEADHUNTER_HEADSHOTS, LEADERBOARD_MAX_ENTRIES, LOGIN_CALENDAR_DAYS, LOGIN_STREAK_COIN_PER_DAY, LOGIN_STREAK_MAX_BONUS_DAYS, LOGIN_STREAK_MAX_FREEZES, MARATHON_SECONDS, MASSACRE_KILLS, MEAT_GRINDER_STREAK, MUTATOR_CHALLENGE_WAVES, PLAYTIME_MILESTONES, PLAY_META_UPGRADES, PRESTIGE_BONUS_PERCENT, PRESTIGE_COST_STEP, QUESTS_SEEN_IDS_KEY, RATTLED_SKELETONS, REGULAR_CAREER_RUNS, RUN_HISTORY_MAX, SHARPSHOOTER_HEADSHOTS, SURVIVOR_20_WAVES, SURVIVOR_30_WAVES, TREASURE_HUNTER_CHESTS, UNTOUCHABLE_STREAK, UPGRADES_SEEN_IDS_KEY, UP_CLOSE_KNIFE_KILLS, VETERAN_PERKS, WEEKLY_FEATURED_MUTATOR_BONUS_COINS, _escapeHtml, _formatDurationShort, _loadSeenIds, _safeStatNumber, _saveSeenIds, _weeklyFeaturedMutatorKey, careerRankTitleKey, formatTime, saveBestRunPace, saveBestStats, saveCareerStats, saveLeaderboard, saveLoginStreak, saveRunHistory, saveSettings, saveShopProgress, todayDateString, yesterdayDateString } from './Game.js'
import { DEATH_POINTS_CONVERSION, META_UPGRADES, saveMetaProgress } from './MetaProgress.js'
import { POINTS_PER_KILL, POINTS_PER_WAVE } from './PlayRules.js'
import { QUESTS } from './Quests.js'
import { EXPIRE_MS as ROLLING_QUEST_EXPIRE_MS } from './RollingQuests.js'
import { t } from './i18n.js'

// Personal stats dashboard (batch feature) - a simple bar chart of kills
// per run from runHistory (already tracked, newest-first), most recent run on the right so reading
// left-to-right matches reading oldest-to-newest.
export function _drawStatsDashboard(game) {
  const canvas = game.statsDashboardCanvas
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const runs = game.runHistory.slice(0, 10).reverse()
  if (runs.length === 0) return
  const maxKills = Math.max(1, ...runs.map((r) => r.kills))
  const barW = w / runs.length
  runs.forEach((run, i) => {
    const barH = (run.kills / maxKills) * (h - 14)
    const x = i * barW + 2
    ctx.fillStyle = run.survived ? 'rgba(78, 224, 111, 0.8)' : 'rgba(214, 69, 69, 0.8)'
    ctx.fillRect(x, h - barH - 12, barW - 4, barH)
    // Black on the Old theme's paper, like the rest of Profile.
    ctx.fillStyle = document.documentElement.classList.contains('ui-theme-old') ? '#000' : 'rgba(232, 232, 232, 0.6)'
    ctx.font = '9px monospace'
    ctx.textAlign = 'center'
    ctx.fillText(String(run.kills), x + (barW - 4) / 2, h - 2)
  })
}

// Daily Login Streak - checked once per page load (not per run-restart),
// so playing several runs in one sitting only ever grants today's bonus
// the first time. today/yesterday comparison keeps it simple: any bigger
// gap resets to a fresh streak of 1 rather than trying to partially credit it.
// Online Features batch: a broken streak (gap > 1 day) now shows a
// "welcome back, it's been N days" toast instead of the normal streak
// toast - same hook, no separate tracking needed, since the gap is
// already implicit in wasConsecutive/previousLastDate below.
export function _checkLoginStreak(game) {
  const today = todayDateString()
  if (game.loginStreak.lastDate === today) return
  const previousLastDate = game.loginStreak.lastDate
  const wasConsecutive = previousLastDate === yesterdayDateString()
  // Streak Freeze - a gap of exactly 1 missed day (2 real days since
  // last play) spends a banked freeze to preserve the streak instead of
  // resetting to 1. A bigger gap still resets outright - a freeze
  // covers one missed day, not an open-ended vacation.
  const gapDays = previousLastDate ? Math.round((new Date(today) - new Date(previousLastDate)) / 86400000) : 0
  const usedFreeze = !wasConsecutive && gapDays === 2 && game.loginStreak.freezesAvailable > 0
  if (usedFreeze) {
    game.loginStreak.freezesAvailable -= 1
    game.loginStreak.streak += 1
  } else {
    game.loginStreak.streak = wasConsecutive ? game.loginStreak.streak + 1 : 1
  }
  if (game.loginStreak.streak % 7 === 0 && game.loginStreak.freezesAvailable < LOGIN_STREAK_MAX_FREEZES) {
    game.loginStreak.freezesAvailable += 1
  }
  // Kept distinct from lastDate (which game function itself immediately
  // overwrites to today, every page load) - Profile panel's "Last
  // Played" row needs the date BEFORE today's visit, not today's own
  // date reflected back.
  if (previousLastDate) game.loginStreak.previousDate = previousLastDate
  game.loginStreak.lastDate = today
  game.loginStreak.recentDates = [...(game.loginStreak.recentDates || []), today].slice(-LOGIN_CALENDAR_DAYS)
  saveLoginStreak(game.loginStreak)
  const bonusDays = Math.min(game.loginStreak.streak, LOGIN_STREAK_MAX_BONUS_DAYS)
  const coinBonus = bonusDays * LOGIN_STREAK_COIN_PER_DAY
  game.coins += coinBonus
  if (usedFreeze) {
    game._showLoreToast(t('loginStreakFreezeUsedToast', { n: game.loginStreak.streak, coins: coinBonus }))
  } else if (!wasConsecutive && previousLastDate) {
    const days = Math.max(1, gapDays)
    game._showLoreToast(t('welcomeBackToast', { days, coins: coinBonus }))
  } else {
    game._showLoreToast(t('loginStreakToast', { n: game.loginStreak.streak, coins: coinBonus }))
  }
}

// What a homepage Map 1 run tells the game (BuildSurvival._report):
// 'kill', 'wave', and 'end' once per run. Guest Mode saves none of it.
// 'end' returns what the run earned, for the game-over card.
export function _onPlayEvent(game, type, data) {
  if (game.settings.guestMode) return null
  if (type === 'kill') {
    game.rollingQuests.recordKill()
    game._checkWeeklyChallengeProgress()
    game.achievements.unlock('first_blood')
    if (data.boss) game.achievements.unlock('giant_slayer')
    if (data.weapon) game._recordArsenalKill(data.weapon)
    if (data.skeleton) _recordSkeletonKill(game, data.skeleton)
    return null
  }
  if (type === 'wave') {
    const wave = data.wave
    game.rollingQuests.recordWave(wave)
    if (wave >= 5) game.achievements.unlock('survivor_5')
    if (wave >= 10) game.achievements.unlock('survivor_10')
    if (wave >= SURVIVOR_20_WAVES) game.achievements.unlock('survivor_20')
    if (game.settings.difficulty === 'nightmare' && wave >= 5) game.achievements.unlock('nightmare_survivor_5')
    if (wave >= SURVIVOR_30_WAVES) game.achievements.unlock('survivor_30')
    if (wave >= SURVIVOR_40_WAVES) game.achievements.unlock('survivor_40')
    if (wave >= SURVIVOR_50_WAVES) game.achievements.unlock('survivor_50')
    const hardOrHarder = ['hard', 'nightmare', 'apex'].includes(data.difficulty)
    if (hardOrHarder && wave >= HARDENED_WAVES) game.achievements.unlock('hardened')
    if (data.difficulty === 'apex' && wave >= APEX_PREDATOR_WAVES) game.achievements.unlock('apex_predator')
    const mutators = Array.isArray(data.mutators) ? data.mutators : []
    if (mutators.includes('glassHouse') && wave >= MUTATOR_CHALLENGE_WAVES) game.achievements.unlock('glass_cannon')
    if (mutators.includes('ironMode') && wave >= MUTATOR_CHALLENGE_WAVES) game.achievements.unlock('iron_will')
    return null
  }
  if (type !== 'end') return null
  const points = data.kills * POINTS_PER_KILL + data.waves * POINTS_PER_WAVE
  // _recordRunEnd (the old Map 1's end-of-run bookkeeping: best stats,
  // career totals, run history, leaderboards, gems, Cloud Save) reads
  // these run fields.
  game.wave = data.waves
  game.kills = data.kills
  game.peakKillStreakThisRun = data.bestStreak
  game.points = points
  game.runStartedAt = performance.now() - data.seconds * 1000
  game._runStartCoins = game.coins
  // The camp coins earned in the run go to your real coins too, plus
  // game week's featured mutator bonus.
  let coins = data.coins
  if (game.settings.mutators[_weeklyFeaturedMutatorKey()]) coins += WEEKLY_FEATURED_MUTATOR_BONUS_COINS
  game.coins += coins
  game.careerStats.lifetimePointsEarned = (game.careerStats.lifetimePointsEarned || 0) + points
  if (data.died) game.achievements.unlock('first_death')
  if (data.kills >= 100) game.achievements.unlock('centurion')
  if (data.bestStreak >= MEAT_GRINDER_STREAK) game.achievements.unlock('meat_grinder')
  if (data.won && game.settings.difficulty === 'nightmare') game.achievements.unlock('nightmare_conqueror')
  if (data.won && data.mode === 'zombieDefense') game.achievements.unlock('holding_the_line')
  if (data.headshots >= HEADHUNTER_HEADSHOTS) game.achievements.unlock('headhunter')
  if (data.meleeKills >= UP_CLOSE_KNIFE_KILLS) game.achievements.unlock('up_close')
  if (data.seconds >= MARATHON_SECONDS) game.achievements.unlock('marathon')
  if (data.chests >= TREASURE_HUNTER_CHESTS) game.achievements.unlock('treasure_hunter')
  if (data.upgrades >= FULLY_LOADED_UPGRADES) game.achievements.unlock('fully_loaded')
  if (data.coins >= DEEP_POCKETS_COINS) game.achievements.unlock('deep_pockets')
  if (data.kills >= MASSACRE_KILLS) game.achievements.unlock('massacre')
  if (data.bestStreak >= UNTOUCHABLE_STREAK) game.achievements.unlock('untouchable')
  if (data.headshots >= SHARPSHOOTER_HEADSHOTS) game.achievements.unlock('sharpshooter')
  if (data.bosses >= BOSS_HUNTER_BOSSES) game.achievements.unlock('boss_hunter')
  if (data.won && data.mode === 'zombieExtraction') game.achievements.unlock('get_to_the_chopper')
  if (data.coins >= FORTUNE_HUNTER_COINS) game.achievements.unlock('fortune_hunter')
  if (data.skeletonKills >= RATTLED_SKELETONS) game.achievements.unlock('rattled')
  if (data.seconds >= ENDURANCE_SECONDS) game.achievements.unlock('endurance')
  if (data.coins >= TYCOON_COINS) game.achievements.unlock('tycoon')
  if (data.kills >= SLAUGHTERHOUSE_KILLS) game.achievements.unlock('slaughterhouse')
  if (data.bestStreak >= UNSTOPPABLE_STREAK) game.achievements.unlock('unstoppable')
  if (data.headshots >= DEAD_CENTER_HEADSHOTS) game.achievements.unlock('dead_center')
  if (data.meleeKills >= BLADE_MASTER_KNIFE_KILLS) game.achievements.unlock('blade_master')
  if (data.bosses >= BOSS_SLAYER_BOSSES) game.achievements.unlock('boss_slayer')
  if (data.skeletonKills >= BONE_BREAKER_SKELETONS) game.achievements.unlock('bone_breaker')
  // +10% per Prestige level, as the Prestige line promises.
  const legacy = Math.floor(points * DEATH_POINTS_CONVERSION * (1 + (PRESTIGE_BONUS_PERCENT / 100) * Math.floor(_safeStatNumber(game.metaProgress.prestigeLevel))))
  game.metaProgress.legacyPoints += legacy
  saveMetaProgress(game.metaProgress)
  game._recordRunEnd(!data.died)
  // Career totals (_recordRunEnd just added game run to them).
  if (_safeStatNumber(game.careerStats.totalKills) >= EXTERMINATOR_CAREER_KILLS) game.achievements.unlock('exterminator')
  if (_safeStatNumber(game.careerStats.totalRuns) >= REGULAR_CAREER_RUNS) game.achievements.unlock('regular')
  if (_safeStatNumber(game.careerStats.totalKills) >= APOCALYPSE_CAREER_KILLS) game.achievements.unlock('apocalypse')
  if (_safeStatNumber(game.careerStats.totalRuns) >= VETERAN_CAREER_RUNS) game.achievements.unlock('veteran')
  saveShopProgress(game)
  game._renderCurrencyBar()
  game._updateUpgradesDot()
  game._updateQuestsDot()
  return { legacy, coins }
}

// 2026-10-17 achievement thresholds (the older ones live in Game.js).
const SURVIVOR_40_WAVES = 40
const SURVIVOR_50_WAVES = 50
const ENDURANCE_SECONDS = 45 * 60
const TYCOON_COINS = 7500
const SLAUGHTERHOUSE_KILLS = 500
const UNSTOPPABLE_STREAK = 100
const DEAD_CENTER_HEADSHOTS = 150
const BLADE_MASTER_KNIFE_KILLS = 75
const BOSS_SLAYER_BOSSES = 15
const BONE_BREAKER_SKELETONS = 75
const APOCALYPSE_CAREER_KILLS = 5000
const VETERAN_CAREER_RUNS = 100
const WELL_EQUIPPED_UPGRADES = 10

// Well Equipped / Maxed Out: how many Zombie Survival upgrades you own.
function _checkUpgradeAchievements(game) {
  const owned = PLAY_META_UPGRADES.filter((u) => game.metaProgress.purchased.has(u.id)).length
  if (owned >= WELL_EQUIPPED_UPGRADES) game.achievements.unlock('well_equipped')
  if (owned >= PLAY_META_UPGRADES.length) game.achievements.unlock('maxed_out')
}

// A skeleton kill (kind: minion/rogue/warrior/mage) - career totals for
// Bone Collector and Skeleton Key, saved straight away so a run that's
// quit midway still counts them.
const SKELETON_KIND_FIELDS = { minion: 'skeletonKillsMinion', rogue: 'skeletonKillsRogue', warrior: 'skeletonKillsWarrior', mage: 'skeletonKillsMage' }
function _recordSkeletonKill(game, kind) {
  const c = game.careerStats
  c.skeletonKills = _safeStatNumber(c.skeletonKills) + 1
  const field = SKELETON_KIND_FIELDS[kind]
  if (field) c[field] = _safeStatNumber(c[field]) + 1
  saveCareerStats(c)
  if (c.skeletonKills >= BONE_COLLECTOR_SKELETONS) game.achievements.unlock('bone_collector')
  if (Object.values(SKELETON_KIND_FIELDS).every((f) => _safeStatNumber(c[f]) > 0)) game.achievements.unlock('skeleton_key')
}

// Opened from the main menu (not gameplay) - spends persistent Legacy
// Points (see MetaProgress.js) on one-time permanent upgrades.
export function _openUpgradesPanel(game) {
  game._closeAllMenuPanels()
  // Opened from the pause overlay (still on screen, unlocked) as well as
  // the main menu - hide it explicitly rather than relying on DOM/paint
  // order, since #pause-overlay comes after #upgrades-panel in index.html
  // and would otherwise render on top and eat every click meant for an
  // upgrade card underneath it.
  game.upgradesPanel.style.display = 'flex'
  game.upgradesPanelTitle.textContent = t('upgradesPanelTitle')
  game._renderUpgradesOptions()
  game._markUpgradesSeen()
}

export function _renderUpgradesOptions(game) {
  // The star at the top left is these Points - keep it in step with every
  // buy, respec and prestige (it used to only update after a run).
  game._renderCurrencyBar()
  game.upgradesPointsLine.textContent = t('legacyScrapLabel', { n: game.metaProgress.legacyPoints })
  game.upgradesOptions.innerHTML = ''
  for (const upgrade of PLAY_META_UPGRADES) {
    const owned = game.metaProgress.purchased.has(upgrade.id)
    const locked = !!upgrade.requires && !game.metaProgress.purchased.has(upgrade.requires)
    // Veteran's Cache pair moved here from the Coin Shop keeps its
    // lifetime-earned-coins gate (see MetaProgress.js's own comment on
    // requiresLifetimeCoins) - a second, different kind of lock from
    // `requires` above, shown with the same "locked" treatment but its
    // own distinct label (you have the Legacy Points, you just haven't
    // played long enough yet).
    const lifetimeLocked = !!upgrade.requiresLifetimeCoins && game.careerStats.lifetimeCoinsEarned < upgrade.requiresLifetimeCoins
    const btn = document.createElement('button')
    btn.className = (locked || lifetimeLocked) ? 'perk-option locked' : 'perk-option'
    btn.disabled = owned || locked || lifetimeLocked || game.metaProgress.legacyPoints < upgrade.cost
    const costLine = owned
      ? t('upgradesOwned')
      : locked
        ? t('upgradesRequires', { name: t(META_UPGRADES.find((u) => u.id === upgrade.requires)?.titleKey) })
        : lifetimeLocked
          ? t('cacheLifetimeLocked', { have: _safeStatNumber(game.careerStats.lifetimeCoinsEarned), need: upgrade.requiresLifetimeCoins })
          : t('perkCostLabel', { n: upgrade.cost })
    btn.innerHTML = `
      <span class="perk-name">${t(upgrade.titleKey)}</span>
      <span class="perk-cost">${costLine}</span>
    `
    btn.addEventListener('click', () => {
      if (owned || locked || lifetimeLocked || game.metaProgress.legacyPoints < upgrade.cost) return
      game.metaProgress.legacyPoints -= upgrade.cost
      game.metaProgress.purchased.add(upgrade.id)
      saveMetaProgress(game.metaProgress)
      _checkUpgradeAchievements(game)
      game._renderUpgradesOptions()
      game._updateUpgradesDot()
    })
    game.upgradesOptions.appendChild(btn)
  }

  // Gated behind the same milestone as Nightmare difficulty (see the
  // constructor's diff-nightmare toggle) - both read as "you've actually
  // beaten the game," which is the bar for offering a full reset+bonus.
  const prestigeUnlocked = game.achievements.unlocked.has(ENDGAME_ACHIEVEMENT)
  game.prestigeSection.style.display = prestigeUnlocked ? 'block' : 'none'
  if (prestigeUnlocked) {
    game.prestigeLevelLine.textContent = t('prestigeLevelLine', { level: game.metaProgress.prestigeLevel, bonus: game.metaProgress.prestigeLevel * PRESTIGE_BONUS_PERCENT })
    // Each Prestige level costs more (2026-10-12, "100k points to
    // prestige to level 1 then 200k for level 2 and keep going").
    const cost = game._prestigeCost()
    game.prestigeBtn.textContent = t('prestigeBtn')
    game.prestigeBtn.disabled = game.metaProgress.legacyPoints < cost
    if (game.prestigeCostLine) game.prestigeCostLine.textContent = t('prestigeCostLine', { level: game.metaProgress.prestigeLevel + 1, cost: cost.toLocaleString(), have: Math.floor(_safeStatNumber(game.metaProgress.legacyPoints)).toLocaleString() })
  }

  // Legacy Tree Respec (Long-Term Goals batch) - only worth showing once
  // there's actually something purchased to redistribute.
  if (game.respecSection) {
    const canRespec = game.metaProgress.purchased.size > 0
    game.respecSection.style.display = canRespec ? 'block' : 'none'
    if (canRespec) game.respecBtn.textContent = t('respecBtn')
  }
}

// Irreversible from the player's side (wipes Legacy Points and every
// purchased Permanent Upgrade), so gated behind a real confirm dialog
// rather than a single click, unlike everything else in this panel.
// Points needed for the next Prestige level: PRESTIGE_COST_STEP per level.
export function _prestigeCost(game) {
  return (Math.floor(_safeStatNumber(game.metaProgress.prestigeLevel)) + 1) * PRESTIGE_COST_STEP
}

export function _prestige(game) {
  if (game.metaProgress.legacyPoints < game._prestigeCost()) return
  if (!window.confirm(t('prestigeConfirm'))) return
  game.metaProgress.prestigeLevel += 1
  game.metaProgress.legacyPoints = 0
  game.metaProgress.purchased = new Set()
  game.metaProgress.prestigeHistory.push({ level: game.metaProgress.prestigeLevel, ts: Date.now() })
  saveMetaProgress(game.metaProgress)
  game._showLoreToast(t('prestigeComplete', { level: game.metaProgress.prestigeLevel, bonus: game.metaProgress.prestigeLevel * PRESTIGE_BONUS_PERCENT }))
  game._renderUpgradesOptions()
  game._saveMenuPaintCache?.()
}

// Respec (Long-Term Goals batch) - refunds every purchased Permanent
// Upgrade's cost back into Legacy Points and clears `purchased`, same
// reset-then-let-the-next-run's-apply-loop-sort-it-out mechanism
// _prestige() above already relies on (see the constructor's own
// "if (this.metaProgress.purchased.has(upgrade.id)) upgrade.apply(this)"
// loop) - nothing needs undoing mid-run, only future runs read this set.
// No prestigeLevel change and no currency cost of its own, unlike
// Prestige - this is pure redistribution, not a fresh-start bonus.
export function _respecMetaUpgrades(game) {
  if (game.metaProgress.purchased.size === 0) return
  if (!window.confirm(t('respecConfirm'))) return
  let refund = 0
  for (const id of game.metaProgress.purchased) {
    const upgrade = META_UPGRADES.find((u) => u.id === id)
    if (upgrade) refund += upgrade.cost
  }
  game.metaProgress.purchased = new Set()
  game.metaProgress.legacyPoints += refund
  saveMetaProgress(game.metaProgress)
  game._showLoreToast(t('respecComplete', { n: refund }))
  game._renderUpgradesOptions()
}

export function _closeUpgradesPanel(game) {
  game.upgradesPanel.style.display = 'none'
}

// Quests panel - tiered career-kill and best-killstreak goals, each a
// one-time coin reward (see Quests.js for the exact tiers/amounts).
// Uses real clickable buttons (unlike Achievements/Bestiary above,
// which are pure display) since completed-but-unclaimed quests need a
// Claim action - one delegated click listener on the container handles
// every quest button rather than rebinding per-button on every render.
export function _openQuestsPanel(game) {
  game._closeAllMenuPanels()
  game.questsPanel.style.display = 'flex'
  // The X/Y claimed count used to live on the homepage nav button, then
  // briefly moved into the panel title on open - removed per direct
  // follow-up request, not shown anywhere any more.
  game.questsPanelTitle.textContent = t('questsPanelTitle')
  game.rollingQuestsSubtitle.textContent = t('rollingQuestsSubtitle')
  if (game.monthlyQuestsPlaceholder) game.monthlyQuestsPlaceholder.textContent = t('monthlyQuestsPlaceholder')
  if (game.yearlyQuestsPlaceholder) game.yearlyQuestsPlaceholder.textContent = t('yearlyQuestsPlaceholder')
  // Lifetime quests are Coming Soon while QUESTS is empty.
  const lifetimeSoon = document.getElementById('lifetime-quests-placeholder')
  if (lifetimeSoon) {
    lifetimeSoon.textContent = t('monthlyQuestsPlaceholder')
    lifetimeSoon.style.display = QUESTS.length ? 'none' : ''
  }
  game._renderQuestsPanel()
  game._renderRollingQuestsPanel()
  game._markQuestsSeen()
}

export function _renderQuestsPanel(game) {
  game.questsOptions.innerHTML = ''
  for (const quest of QUESTS) {
    const claimed = game.quests.isClaimed(quest.id)
    const progress = Math.min(quest.target, game.quests.currentProgress(quest, game))
    const complete = game.quests.isComplete(quest, game)
    const btn = document.createElement('button')
    btn.className = 'perk-option'
    btn.dataset.questId = quest.id
    btn.disabled = claimed || !complete
    const statusText = claimed
      ? t('questClaimed')
      : complete
        ? t('questClaimReward', { n: quest.rewardCoins })
        : t('questProgress', { current: progress.toLocaleString(), target: quest.target.toLocaleString() })
    btn.innerHTML = `
      <span class="perk-name">${t(quest.titleKey, { n: quest.target.toLocaleString() })}</span>
      <span class="perk-cost">${statusText}</span>
    `
    game.questsOptions.appendChild(btn)
  }
}

// Rolling Quests - separate from the lifetime tiers above (see
// RollingQuests.js): a GLOBAL rotation of 5 quests every 30 minutes
// (all still-alive ones shown at once, each expiring 3 hours after its
// spawn window), computed deterministically from wall-clock time rather than
// per-player spawn history - every player sees the same quests at the
// same real-world moment, reset on schedule whether or not anyone was
// online to trigger it. refresh() just prunes expired local
// progress/claim records; it doesn't need its own always-running timer
// loop since the active set itself is recomputed fresh on every call.
export function _renderRollingQuestsPanel(game) {
  game.rollingQuests.refresh()
  game.rollingQuestsOptions.innerHTML = ''
  const active = game.rollingQuests.activeQuests()
  if (active.length === 0) {
    game.rollingQuestsOptions.innerHTML = `<p class="menu-best-stats">${t('rollingQuestNone')}</p>`
    return
  }
  const now = Date.now()
  for (const q of active) {
    const progress = Math.min(q.template.target, q.progress)
    const complete = progress >= q.template.target
    const timeLeftSeconds = Math.max(0, Math.floor((q.spawnedAt + ROLLING_QUEST_EXPIRE_MS - now) / 1000))
    const btn = document.createElement('button')
    btn.className = 'perk-option'
    btn.dataset.spawnedAt = q.spawnedAt
    btn.disabled = !complete
    const statusText = complete
      ? t('rollingQuestClaimReward', { coins: q.template.rewardCoins, xp: q.template.rewardXp })
      : `${t('questProgress', { current: progress.toLocaleString(), target: q.template.target.toLocaleString() })} · ${t('rollingQuestTimeLeft', { time: _formatDurationShort(timeLeftSeconds) })}`
    btn.innerHTML = `
      <span class="perk-name">${t(q.template.titleKey, { n: q.template.target.toLocaleString() })}</span>
      <span class="perk-cost">${statusText}</span>
    `
    game.rollingQuestsOptions.appendChild(btn)
  }
}

export function _closeQuestsPanel(game) {
  game.questsPanel.style.display = 'none'
}

export function _claimQuest(game, id) {
  if (!game.quests.claim(id, game)) return
  saveShopProgress(game)
  game._showHomepageToast(t('questClaimedToast', { n: QUESTS.find((q) => q.id === id)?.rewardCoins || 0 }))
  game._renderQuestsPanel()
  game._updateQuestsDot()
  game._updateFaviconQuestBadge()
}

export function _claimRollingQuest(game, spawnedAt) {
  const reward = game.rollingQuests.claim(spawnedAt, game)
  if (!reward) return
  // RollingQuests.claim() applies the coin reward itself (mirrors
  // Quests.claim()) but deliberately leaves XP to us - game.xp has its
  // own HUD/level-up side effects that belong here, not duplicated in a
  // plain data module - only run that side effect if a run is actually active;
  // claiming from the homepage just banks the XP toward the next
  // level-up, which gets caught for real the next time xp is gained
  // during real play.
  game.xp += reward.xp
  saveShopProgress(game)
  game._showHomepageToast(t('rollingQuestClaimedToast', { coins: reward.coins, xp: reward.xp }))
  game._renderRollingQuestsPanel()
  game._updateQuestsDot()
  game._updateFaviconQuestBadge()
}

// Favicon Quest Badge - draws the real tab icon (favicon-64.png) onto an offscreen
// canvas plus a small red count badge (capped display at "9+") when
// quests are complete but not yet claimed, then swaps the <link
// rel="icon"> href to the resulting data URL. Same-origin PNG, so the
// canvas is never tainted and toDataURL works normally. No-ops (leaves
// the plain icon alone) if canvas/SVG loading ever fails - a badge that
// silently doesn't appear is fine, a thrown error breaking the menu
// refresh batch is not.
export function _updateFaviconQuestBadge(game) {
  const lifetimeCount = QUESTS.filter((q) => game.quests.isComplete(q, game) && !game.quests.isClaimed(q.id)).length
  const rollingCount = game.rollingQuests.activeQuests().filter((q) => q.progress >= q.template.target).length
  const count = lifetimeCount + rollingCount
  const link = document.querySelector('link[rel="icon"]')
  if (!link) return
  if (count <= 0) {
    if (game._faviconBaseHref) link.href = game._faviconBaseHref
    return
  }
  if (!game._faviconBaseHref) game._faviconBaseHref = link.href
  if (!game._faviconImg) {
    game._faviconImg = new Image()
    game._faviconImg.onload = () => game._updateFaviconQuestBadge()
    game._faviconImg.src = game._faviconBaseHref
    return
  }
  if (!game._faviconImg.complete || game._faviconImg.naturalWidth === 0) return
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const ctx = canvas.getContext('2d')
    ctx.drawImage(game._faviconImg, 0, 0, 32, 32)
    ctx.beginPath()
    ctx.arc(24, 8, 8, 0, Math.PI * 2)
    ctx.fillStyle = '#d3392f'
    ctx.fill()
    ctx.strokeStyle = '#1a1a1a'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 10px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(count > 9 ? '9+' : String(count), 24, 9)
    link.href = canvas.toDataURL('image/png')
  } catch {
    // Best-effort - leave whatever icon is currently set.
  }
}

export function _openAchievementsPanel(game) {
  game._closeAllMenuPanels()
  game.achievementsPanel.style.display = 'flex'
  // Same move as the Quests panel title above - the X/Y count used to
  // live on the homepage nav button, now shown here instead when the
  // panel is actually open.
  game.achievementsPanelTitle.textContent = `${t('achievementsPanelTitle')} (${game.achievements.unlocked.size}/${ACHIEVEMENTS.length})`
  if (game.achievementsFilterInput) game.achievementsFilterInput.placeholder = t('achievementsFilterPlaceholder')
  game._renderAchievementsPanel()
  game._markAchievementsSeen()
}

export function _renderAchievementsPanel(game) {
  // Deathmatch and Parkour have no achievements yet - a placeholder.
  const deathmatch = game._achievementsMode !== 'survival'
  if (game.achievementsFilterInput) game.achievementsFilterInput.style.display = deathmatch ? 'none' : ''
  if (game.achievementsControlsRow) game.achievementsControlsRow.style.display = deathmatch ? 'none' : ''
  if (game.printAchievementsBtn) game.printAchievementsBtn.style.display = deathmatch ? 'none' : ''
  game.achievementsOptions.style.display = deathmatch ? 'none' : ''
  if (game.achievementsDeathmatchPlaceholder) {
    game.achievementsDeathmatchPlaceholder.style.display = deathmatch ? '' : 'none'
    game.achievementsDeathmatchPlaceholder.textContent = t('menuInventoryPlaceholder')
  }
  if (deathmatch) return

  const filter = (game.achievementsFilterInput?.value || '').trim().toLowerCase()
  const category = game.achievementsCategorySelect?.value || 'all'
  const sortMode = game.achievementsSortSelect?.value || 'default'
  let list = ACHIEVEMENTS.filter((ach) => category === 'all' || ach.category === category)
  // Achieved/Incomplete - a straight filter on unlock state, not a sort
  // (replaced the old Unlock Date sort per direct request).
  if (sortMode === 'achieved') list = list.filter((ach) => game.achievements.unlocked.has(ach.id))
  else if (sortMode === 'incomplete') list = list.filter((ach) => !game.achievements.unlocked.has(ach.id))
  game.achievementsOptions.innerHTML = ''
  for (const ach of list) {
    const unlocked = game.achievements.unlocked.has(ach.id)
    const name = unlocked ? t(ach.titleKey) : '???'
    if (filter && !name.toLowerCase().includes(filter)) continue
    const btn = document.createElement('button')
    btn.className = 'perk-option'
    btn.disabled = true
    // Chain preview - only for an achievement that's both unlocked and
    // has a defined next tier still locked, so it reads as "here's
    // what's next," not a spoiler of a locked achievement's own name.
    const nextId = ACHIEVEMENT_CHAINS[ach.id]
    const next = nextId && unlocked && !game.achievements.unlocked.has(nextId) ? ACHIEVEMENTS.find((a) => a.id === nextId) : null
    btn.innerHTML = `
      <span class="perk-name">${name}</span>
      <span class="perk-cost">${unlocked ? t('achievementUnlockedShort') : (ach.hintKey ? t(ach.hintKey) : t('achievementLocked'))}</span>
      ${next ? `<span class="perk-lore">${_escapeHtml(t('achievementChainNext', { name: t(next.titleKey) }))}</span>` : ''}
    `
    game.achievementsOptions.appendChild(btn)
  }
}

export function _closeAchievementsPanel(game) {
  game.achievementsPanel.style.display = 'none'
}

export function _updateBestStatsDisplay(game) {
  const { bestWave } = game.bestStats
  game._renderCurrencyBar()

  // Your Stats panel - a different stat slice than the hero pair above,
  // matching the redesigned menu's own left-column panel. All pulled
  // from data game game already tracks (careerStats/bestRunPace/
  // runHistory), nothing new recorded just for game display.
  // K/D ratio appended inline rather than as its own stat row - the
  // Your Stats panel has no spare vertical budget for a new row (see
  // CLAUDE.md's menu-redesign notes on the zero-scroll fight).
  {
    const kd = (_safeStatNumber(game.careerStats.totalKills) / Math.max(1, _safeStatNumber(game.careerStats.totalDeaths))).toFixed(1)
    game.statTotalKills.forEach((el) => { el.textContent = `${_safeStatNumber(game.careerStats.totalKills)} (K/D ${kd})` })
  }
  {
    const hours = (_safeStatNumber(game.careerStats.lifetimePlaytimeSeconds) / 3600).toFixed(1)
    game.statRunsPlayed.forEach((el) => { el.textContent = `${_safeStatNumber(game.careerStats.totalRuns)} · ${hours}h played` })
  }
  {
    const survivalText = game.bestRunPace && game.bestRunPace.elapsedMs
      ? formatTime(_safeStatNumber(game.bestRunPace.elapsedMs))
      : '--'
    game.statLongestSurvival.forEach((el) => { el.textContent = survivalText })
  }
  {
    const last = game.runHistory[0]
    let lastRunText = '--'
    if (last) {
      let line = t(last.survived ? 'runHistorySurvived' : 'runHistoryDied', { night: _safeStatNumber(last.night), kills: _safeStatNumber(last.kills), coins: _safeStatNumber(last.coins) })
      // Personal-best delta - compares only against bestStats.bestWave
      // (already the single source of truth for "your best run ever"),
      // not a new "is game actually the best" computation of its own.
      const nightDelta = _safeStatNumber(last.night) - _safeStatNumber(bestWave)
      if (nightDelta === 0 && _safeStatNumber(last.night) > 0) line += ` — ${t('deltaNewBest')}`
      else if (nightDelta < 0) line += ` (${t('deltaFromBest', { n: Math.abs(nightDelta) })})`
      lastRunText = line
    }
    game.statLastRun.forEach((el) => { el.textContent = lastRunText })
  }

  // Avatar level badge - the same tier index careerRankTitleKey already
  // derives from totalKills, just as a plain 1-5 number instead of a title.
  if (game.menuAvatarLevel) {
    const level = game._computeAvatarLevel()
    game.menuAvatarLevel.textContent = level
    // Rank-Up Toasts (General tab) - fires only on an actual increase,
    // not the first read game session (_lastAvatarLevel starting
    // undefined would otherwise fire once on page load for anyone
    // already above level 1).
    if (game.settings.rankUpToasts && game._lastAvatarLevel !== undefined && level > game._lastAvatarLevel) {
      game._showHomepageToast(t('rankUpToast', { level }))
    }
    game._lastAvatarLevel = level
    // Logo blood-tint intensity - same tier index, purely cosmetic (a
    // CSS filter, not a different image asset). Doesn't touch the
    // logo's size, only how saturated/red its existing blood-crack
    // texture reads.
    const logoImg = document.getElementById('menu-title-img')
    if (logoImg) {
      for (let i = 2; i <= 5; i++) logoImg.classList.remove(`logo-tier-${i}`)
      if (level >= 2) logoImg.classList.add(`logo-tier-${level}`)
    }
  }
  game._renderPlayerTag()
  game._updateMenuNewsTicker()
  game._updateRecommendedDifficultyHint()
  game._updateWhatsNewDot()
  game._updateUpgradesDot()
  game._updateAchievementsDot()
  game._updateQuestsDot()
  game._checkFriendAcceptedNotifications()
  game._checkKillMilestones()
  game._updateFaviconQuestBadge()
  game._updateLongestSession()
  if (game._pendingConfetti && !game.gameStarted) {
    game._pendingConfetti = false
    game._fireConfetti()
    game._showHomepageToast(t('newPersonalBestToast'))
  }
  if (game.menuAriaSummary) {
    game.menuAriaSummary.textContent = t('menuAriaSummary', {
      night: _safeStatNumber(game.bestStats.bestWave),
      kills: _safeStatNumber(game.careerStats.totalKills),
      coins: _safeStatNumber(game.coins),
    })
  }
}

// Upgrades nav dot - red, lights up if either (a) a new upgrade was
// added since this player last opened Upgrades, or (b) they can afford
// an upgrade they haven't bought yet right now (checked live, not
// persisted - this one naturally turns off the moment they buy it or
// spend their points elsewhere).
export function _updateUpgradesDot(game) {
  if (!game.upgradesDot) return
  let seen = _loadSeenIds(UPGRADES_SEEN_IDS_KEY)
  if (!seen) {
    seen = new Set(PLAY_META_UPGRADES.map((u) => u.id))
    _saveSeenIds(UPGRADES_SEEN_IDS_KEY, seen)
  }
  const hasNewUpgrade = PLAY_META_UPGRADES.some((u) => !seen.has(u.id))
  const canAffordOne = PLAY_META_UPGRADES.some((u) => {
    if (game.metaProgress.purchased.has(u.id)) return false
    if (u.requires && !game.metaProgress.purchased.has(u.requires)) return false
    return game.metaProgress.legacyPoints >= u.cost
  })
  game.upgradesDot.style.display = (hasNewUpgrade || canAffordOne) ? '' : 'none'
}

export function _markUpgradesSeen(game) {
  _saveSeenIds(UPGRADES_SEEN_IDS_KEY, PLAY_META_UPGRADES.map((u) => u.id))
  game._updateUpgradesDot()
}

// Achievements nav dot - gold, lights up if an achievement unlocked
// since this player last opened the Achievements panel.
export function _updateAchievementsDot(game) {
  if (!game.achievementsNewDot) return
  let seen = _loadSeenIds(ACHIEVEMENTS_SEEN_IDS_KEY)
  if (!seen) {
    seen = new Set(game.achievements.unlocked)
    _saveSeenIds(ACHIEVEMENTS_SEEN_IDS_KEY, seen)
  }
  game.achievementsNewDot.style.display = [...game.achievements.unlocked].some((id) => !seen.has(id)) ? '' : 'none'
}

export function _markAchievementsSeen(game) {
  _saveSeenIds(ACHIEVEMENTS_SEEN_IDS_KEY, game.achievements.unlocked)
  game._updateAchievementsDot()
}

// Quests nav dot - gold, lights up if any lifetime or rolling quest is
// complete and waiting to be claimed. Purely live-computed (no seen-
// tracking needed) since "claimable right now" already turns itself off
// the instant the reward is claimed.
export function _updateQuestsDot(game) {
  if (!game.questsClaimDot) return
  const lifetimeReady = QUESTS.some((q) => game.quests.isComplete(q, game) && !game.quests.isClaimed(q.id))
  const rollingReady = game.rollingQuests.activeQuests().some((q) => q.progress >= q.template.target)
  game.questsClaimDot.style.display = (lifetimeReady || rollingReady) ? '' : 'none'
  game._updateQuestsNewDot()
}

// Quests nav dot - red, lights up if there's a lifetime quest (id-based)
// or an active rolling quest (spawnedAt-based, since rolling quests
// don't have a fixed id - see RollingQuests.activeQuests()) the player
// hasn't opened the Quests panel to see yet. Same seen-id pattern as
// Store/Upgrades/Achievements, just tracking two different kinds of id
// in one set since lifetime ids and rolling spawnedAt timestamps can
// never collide (one's a short string, the other's a large number).
export function _updateQuestsNewDot(game) {
  if (!game.questsNewDot) return
  let seen = _loadSeenIds(QUESTS_SEEN_IDS_KEY)
  if (!seen) {
    seen = new Set([...QUESTS.map((q) => q.id), ...game.rollingQuests.activeQuests().map((q) => q.spawnedAt)])
    _saveSeenIds(QUESTS_SEEN_IDS_KEY, seen)
  }
  const hasNewLifetime = QUESTS.some((q) => !seen.has(q.id))
  const hasNewRolling = game.rollingQuests.activeQuests().some((q) => !seen.has(q.spawnedAt))
  game.questsNewDot.style.display = (hasNewLifetime || hasNewRolling) ? '' : 'none'
}

export function _markQuestsSeen(game) {
  _saveSeenIds(QUESTS_SEEN_IDS_KEY, [...QUESTS.map((q) => q.id), ...game.rollingQuests.activeQuests().map((q) => q.spawnedAt)])
  game._updateQuestsNewDot()
}

// Local leaderboard - see loadLeaderboard's own doc comment for how this
// differs from bestStats above. Called once per run end (Map 1's
// _onPlayEvent 'end').
export function _recordLeaderboardEntry(game) {
  game.leaderboard.push({ night: game.wave, kills: game.kills, points: game.points, date: Date.now() })
  game.leaderboard.sort((a, b) => (b.night - a.night) || (b.kills - a.kills) || (b.points - a.points))
  game.leaderboard = game.leaderboard.slice(0, LEADERBOARD_MAX_ENTRIES)
  saveLeaderboard(game.leaderboard)
}

export function _showAchievementToast(game, def) {
  // State changes (skin unlock, trophy wall) happen immediately, same as
  // before - only the visual toast display itself is queued below, so an
  // unlock is never delayed, just its notification.
  // The live game world (zombies, weather) keeps simulating behind the
  // menu before Play is ever clicked (see main.js) - no gameplay toast
  // should actually reach the screen before then, even if whatever
  // triggered game fired anyway.
  if (!game.gameStarted) return
  if (!game.settings.achievementToasts) return
  game._achievementToastQueue.push(def)
  game._drainAchievementToastQueue()
}

// Achievement toast queue (see _achievementToastQueue's own comment) -
// shows one at a time so two simultaneous unlocks (e.g. the completionist
// auto-cascade) each get their own visible moment on the shared toast
// element instead of the first silently getting clobbered by the second.
export function _drainAchievementToastQueue(game) {
  if (game._achievementToastShowing || game._achievementToastQueue.length === 0) return
  game._achievementToastShowing = true
  const def = game._achievementToastQueue.shift()
  game.achievementLabel.textContent = t('achievementUnlocked')
  game.achievementTitle.textContent = t(def.titleKey)
  game.achievementToast.classList.remove('show')
  void game.achievementToast.offsetWidth
  game.achievementToast.classList.add('show')
  setTimeout(() => {
    game._achievementToastShowing = false
    game._drainAchievementToastQueue()
  }, ACHIEVEMENT_TOAST_GAP_MS)
}

// Called when a Map 1 run ends (died, won or left) - updates every persistent
// record (bestStats, career totals, Veteran Perks) the same way. `survived`
// distinguishes the two for Run History's result column (see below).
export function _recordRunEnd(game, survived) {
  // Guest Mode (Local Sharing batch) - game entire method is exactly
  // "update a persistent/lifetime record" (bestStats, careerStats,
  // runHistory, milestones, companionLegacy, the local leaderboard), so
  // skipping it wholesale is the correct behavior, not a shortcut - a
  // guest run genuinely shouldn't move any of these numbers.
  if (game.settings.guestMode) return
  // Guest Mode already gates the whole method above (same "guest runs
  // don't move persistent records" reasoning applies here too, since
  // claiming a rolling quest grants real coins).
  game.rollingQuests.recordRunComplete()

  // Gems - earned per completed run from two independent sources, added
  // together: 1 gem per 5 nights survived (5=1, 10=2, 15=3...) and 1 gem
  // per 50 kills (50=1, 100=2, 150=3...). No shop use for them yet
  // (display-only for now, per direct request), same "build the earn
  // side now, spend side later" precedent as the empty Settings >
  // General tab. Dying before reaching either threshold naturally earns
  // 0 from that source (Math.floor of a value under the first tier is
  // 0) - no separate zero-case needed. Saved explicitly here rather
  // than relying on a later save.
  const wavesGems = Math.floor(game.wave / 5)
  const killsGems = Math.floor(game.kills / 50)
  const gemsEarned = wavesGems + killsGems
  if (gemsEarned > 0) {
    game.gems += gemsEarned
    saveShopProgress(game)
  }
  let improved = false
  if (game.wave > game.bestStats.bestWave) {
    game.bestStats.bestWave = game.wave
    improved = true
    // Best-Run Pace baseline - only
    // ever overwritten on an actual new record, so the projection always
    // reflects the single best-ever run, not just the most recent one.
    game.bestRunPace = { night: game.wave, elapsedMs: performance.now() - game.runStartedAt }
    saveBestRunPace(game.bestRunPace)
  }
  if (game.kills > game.bestStats.bestKills) { game.bestStats.bestKills = game.kills; improved = true }
  if (game.peakKillStreakThisRun > game.bestStats.bestKillStreak) {
    game.bestStats.bestKillStreak = game.peakKillStreakThisRun
    game.bestStats.bestKillStreakDate = todayDateString()
    improved = true
  }
  if (improved) {
    saveBestStats(game.bestStats)
    // Confetti burst - armed here, actually fired the next time
    // _updateBestStatsDisplay runs with gameStarted false (i.e. once
    // the menu is genuinely showing again, not game same synchronous
    // call which still fires mid-run right as the record is set).
    game._pendingConfetti = true
    game._updateBestStatsDisplay()
  }
  game._recordLeaderboardEntry()

  game._sessionKills += game.kills
  game.careerStats.totalKills += game.kills
  game.careerStats.totalRuns += 1
  if (!game.careerStats.firstPlayedDate) game.careerStats.firstPlayedDate = todayDateString()
  // Most-used mutator (Profile panel) - one increment per active mutator
  // per completed run, same settings.mutators flags the Coin Shop/Play
  // button already read, no separate tracking.
  for (const [id, active] of Object.entries(game.settings.mutators)) {
    if (active) game.careerStats.mutatorUseCounts[id] = (game.careerStats.mutatorUseCounts[id] || 0) + 1
  }
  for (const perk of VETERAN_PERKS) {
    if (game.careerStats.totalKills >= perk.killThreshold && !game.careerStats.veteranPerksGranted.includes(perk.id)) {
      game.careerStats.veteranPerksGranted.push(perk.id)
      game._showLoreToast(t('veteranPerkToast', { rank: t(careerRankTitleKey(game.careerStats.totalKills)) }))
    }
  }

  // Run History Log - one capped entry per completed run (see
  // RUN_HISTORY_KEY's own comment). difficulty/loadout
  // captured alongside (Homepage batch) so a "Play Again" action can
  // restore the exact setup game run used, not just show its stats.
  game.runHistory.unshift({
    night: game.wave, kills: game.kills, coins: Math.max(0, game.coins - game._runStartCoins), survived: !!survived,
    prestige: game.metaProgress.prestigeLevel, ts: Date.now(),
    difficulty: game.settings.difficulty, loadout: game.settings.loadout,
  })
  game.runHistory = game.runHistory.slice(0, RUN_HISTORY_MAX)
  saveRunHistory(game.runHistory)

  // Homepage batch - lifetime deaths (K/D ratio) and per-difficulty
  // run/death tallies (Recommended Difficulty hint). Deaths is every
  // non-survived run; DIFFICULTY_PRESETS keys are the same ids
  // settings.difficulty already uses everywhere else.
  if (!survived) game.careerStats.totalDeaths += 1
  const diffId = game.settings.difficulty
  if (!game.careerStats.difficultyStats[diffId]) game.careerStats.difficultyStats[diffId] = { runs: 0, deaths: 0 }
  game.careerStats.difficultyStats[diffId].runs += 1
  if (!survived) game.careerStats.difficultyStats[diffId].deaths += 1

  // Lifetime Playtime/Distance/Coins-Earned/Flawless-Runs (Long-Term Goals
  // batch) - each a new cumulative axis on careerStats, checked against
  // its own milestone ladder the same way Veteran Perks checks kills above.
  game.careerStats.lifetimePlaytimeSeconds += (performance.now() - game.runStartedAt) / 1000
  game.careerStats.lifetimeCoinsEarned += Math.max(0, game.coins - game._runStartCoins)
  // Most Profitable Run (Profile panel) - a single-run coin delta, same
  // Math.max(0, ...) clamp lifetimeCoinsEarned above already uses (a
  // run that ended with fewer coins than it started, e.g. after a big
  // Coin Shop purchase mid-run, shouldn't count as negative profit).
  game.careerStats.mostProfitableRun = Math.max(game.careerStats.mostProfitableRun, Math.max(0, game.coins - game._runStartCoins))

  for (const m of PLAYTIME_MILESTONES) {
    if (game.careerStats.lifetimePlaytimeSeconds >= m.seconds && !game.careerStats.playtimeMilestonesGranted.includes(m.id)) {
      game.careerStats.playtimeMilestonesGranted.push(m.id)
      game.coins += m.rewardCoins
      game._showLoreToast(t('playtimeMilestoneToast', { hours: Math.round(m.seconds / 3600), coins: m.rewardCoins }))
    }
  }
  saveCareerStats(game.careerStats)

  // Cloud Save auto-sync - best-effort, only if already signed in (never
  // prompts here; a mid-game consent popup would be jarring). See
  // pushToCloud's own comment on why manual=false swallows errors.
  CloudSaveUI.pushToCloud(game, false)
  game._pushOnlineStats()
}

// Prestige History Log (Profile panel) - forward-only, see
// metaProgress.prestigeHistory's own comment. Hidden entirely (not just
// empty) for players who have never prestiged, same show/hide pattern
// Weekly Recap's own title/line pair already uses.
export function _renderPrestigeHistory(game) {
  if (!game.prestigeHistoryList) return
  if (!game.metaProgress.prestigeHistory.length) {
    if (game.prestigeHistoryHeading) game.prestigeHistoryHeading.style.display = 'none'
    game.prestigeHistoryList.style.display = 'none'
    return
  }
  if (game.prestigeHistoryHeading) {
    game.prestigeHistoryHeading.style.display = ''
    game.prestigeHistoryHeading.textContent = t('prestigeHistoryHeading')
  }
  game.prestigeHistoryList.style.display = ''
  game.prestigeHistoryList.innerHTML = [...game.metaProgress.prestigeHistory].reverse().map((entry) => `
    <p class="nearly-there-line">${_escapeHtml(t('prestigeHistoryLine', { level: entry.level, date: new Date(entry.ts).toLocaleDateString() }))}</p>
  `).join('')
}

// Pin a Stat (see _openProfilePanel) - populates the select fresh every
// render (cheap, just <option> elements) but wires its change listener
// only once (_pinnedStatBound guard) so repeated panel opens don't stack
// duplicate listeners.
export function _renderPinnedStatSelect(game, rows) {
  if (!game.pinnedStatSelect) return
  const current = game.settings.pinnedStat
  game.pinnedStatSelect.innerHTML = `<option value="">${t('pinnedStatNone')}</option>` +
    rows.map(([id, label]) => `<option value="${id}"${id === current ? ' selected' : ''}>${label}</option>`).join('')
  if (!game._pinnedStatBound) {
    game._pinnedStatBound = true
    game.pinnedStatSelect.addEventListener('change', () => {
      game.settings.pinnedStat = game.pinnedStatSelect.value || null
      saveSettings(game.settings)
      game._openProfilePanel()
    })
  }
}

// Unclaimed Quests reminder - a dedicated toast alongside the passive
// favicon badge (see _updateFaviconQuestBadge), once per page load.
export function _checkUnclaimedQuestsReminder(game) {
  const count = QUESTS.filter((q) => game.quests.isComplete(q, game) && !game.quests.isClaimed(q.id)).length
  if (count > 0) game._showHomepageToast(t('unclaimedQuestsToast', { n: count }))
}
