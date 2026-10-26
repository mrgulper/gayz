import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame, waitForGame } from './helpers.js'
import * as Xp from '../src/game/Xp.js'

test('careerStats.totalKills persists after a completed run', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(() => {
    const g = window.__game
    const before = g.careerStats.totalKills
    // Minimal realistic state _recordRunEnd() reads from (night/kills/
    // points, runStartedAt for playtime).
    g.night = 5
    g.kills = 37
    g.points = 100
    g.coins = g.coins || 0
    g.runStartedAt = performance.now() - 60000
    g._runStartCoins = g.coins
    g.peakKillStreakThisRun = 0
    g.settings.guestMode = false
    g._recordRunEnd(true)
    const afterInMemory = g.careerStats.totalKills
    const persisted = JSON.parse(localStorage.getItem('gayz-career-stats')).totalKills
    return { before, afterInMemory, persisted, delta: afterInMemory - before }
  })

  expect(result.delta).toBe(37)
  expect(result.persisted).toBe(result.afterInMemory)
})

// Lifetime quests are Coming Soon (2026-10-10): the tab says so, and the
// old milestones can't be claimed for coins any more.
test('Lifetime quests are Coming Soon and the old ones pay nothing', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(() => {
    const g = window.__game
    g.careerStats.totalKills = 100 // met the removed kill_100 quest's target
    const coins = g.coins
    const claimed = g.quests.claim('kill_100', g)
    g._openQuestsPanel()
    document.getElementById('quest-tab-lifetime').click()
    const soon = document.getElementById('lifetime-quests-placeholder')
    return {
      claimed,
      coinsSame: g.coins === coins,
      soonShown: getComputedStyle(soon).display !== 'none' && soon.offsetParent !== null,
      soonText: soon.textContent,
      cards: document.querySelectorAll('#quests-options button').length,
    }
  })

  expect(result.claimed).toBe(false)
  expect(result.coinsSame).toBe(true)
  expect(result.soonShown).toBe(true)
  expect(result.soonText).toBe('Coming soon.')
  expect(result.cards).toBe(0)
})

test('a Map 1 run feeds achievements and the weekly challenge; crates stay locked', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(() => {
    const g = window.__game
    g.settings.guestMode = false
    g.settings.difficulty = 'nightmare'
    const weekly0 = g.weeklyChallenge.progress
    for (let i = 0; i < 3; i++) g._onPlayEvent('kill', { boss: false, streak: i + 1 })
    const weekly = g.weeklyChallenge.progress - weekly0
    g._onPlayEvent('end', { waves: 10, kills: 30, bestStreak: 25, won: true, died: false, mode: 'zombieDefense', seconds: 120, coins: 40 })
    const runCoins = g.runHistory[0].coins
    // Crates are Coming Soon: buying does nothing and every button is off.
    g.coins = 1e6
    g._openCrate('wood')
    g._renderCrateTiers()
    return {
      weekly,
      meat: g.achievements.unlocked.has('meat_grinder'),
      conqueror: g.achievements.unlocked.has('nightmare_conqueror'),
      runCoins,
      crateStock: g.crateStock.wood,
      coinsKept: g.coins === 1e6,
      cratesEnabled: [...document.querySelectorAll('.crate-card .crate-open-btn')].filter((b) => !b.disabled).length,
    }
  })

  expect(result.weekly).toBe(3)
  expect(result.meat).toBe(true)
  expect(result.conqueror).toBe(true)
  expect(result.runCoins).toBe(40)
  expect(result.crateStock).toBe(0)
  expect(result.coinsKept).toBe(true)
  expect(result.cratesEnabled).toBe(0)
})

test('the 2026-10-09 achievements unlock from what a Map 1 run reports', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(() => {
    const g = window.__game
    g.settings.guestMode = false
    g.settings.difficulty = 'normal'
    localStorage.removeItem('gayz-ach-weapon-kills')
    const has = (id) => g.achievements.unlocked.has(id)
    const before = ['giant_slayer', 'arsenal', 'survivor_20', 'holding_the_line', 'headhunter', 'up_close', 'marathon', 'treasure_hunter', 'fully_loaded', 'deep_pockets'].filter(has)
    // Four guns isn't an Arsenal yet; the fifth (and a repeat) is.
    for (const weapon of ['rifle', 'pistol', 'shotgun', 'awp', 'rifle']) g._onPlayEvent('kill', { boss: false, streak: 1, weapon })
    const arsenalAt4 = has('arsenal')
    g._onPlayEvent('kill', { boss: true, streak: 1, weapon: 'melee' })
    g._onPlayEvent('wave', { wave: 20 })
    g._onPlayEvent('end', {
      waves: 10, kills: 40, bestStreak: 3, won: true, died: false, mode: 'zombieDefense', seconds: 20 * 60,
      coins: 1000, headshots: 25, meleeKills: 25, chests: 10, upgrades: 5, bosses: 1,
    })
    return {
      before,
      arsenalAt4,
      after: ['giant_slayer', 'arsenal', 'survivor_20', 'holding_the_line', 'headhunter', 'up_close', 'marathon', 'treasure_hunter', 'fully_loaded', 'deep_pockets'].filter((id) => !has(id)),
      // Every achievement has a name and a hint in the four supported languages.
      untitled: (() => {
        const missing = []
        const panel = document.getElementById('achievements-options')
        g._openAchievementsPanel()
        if (panel.children.length < 19) missing.push(`only ${panel.children.length} cards`)
        return missing
      })(),
    }
  })

  expect(result.before).toEqual([])
  expect(result.arsenalAt4).toBe(false)
  expect(result.after).toEqual([])
  expect(result.untitled).toEqual([])
})

// The Zombie Survival upgrades added 2026-10-10 change a Map 1 run
// (PlayRules.js's UPGRADE_PLAY -> Game._playConfig()), and each shows in
// the Upgrades panel.
test('new Zombie Survival upgrades change the run', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(() => {
    const g = window.__game
    g.settings.difficulty = 'normal'
    g.settings.loadout = 'balanced'
    g.settings.mutators = Object.fromEntries(Object.keys(g.settings.mutators).map((k) => [k, false]))
    const base = g._playConfig()
    for (const id of ['swiftfoot', 'sprinter', 'scavenger', 'treasureHunter', 'warChest', 'secondWind', 'ammoBelt', 'bandolier', 'headhunter', 'thickSkin', 'lastStand']) g.metaProgress.purchased.add(id)
    const cfg = g._playConfig()
    g._openUpgradesPanel()
    const names = [...document.querySelectorAll('#upgrades-options .perk-name')].map((n) => n.textContent)
    return {
      speed: +(cfg.moveMult / base.moveMult).toFixed(2),
      coins: +(cfg.coinMult - base.coinMult).toFixed(2),
      startCoins: cfg.startCoins - base.startCoins,
      regen: cfg.regen,
      ammo: cfg.ammoMult,
      headshot: cfg.headshotMult,
      softer: +(cfg.zombieDamageMult / base.zombieDamageMult).toFixed(2),
      health: cfg.maxHealth - base.maxHealth,
      armor: cfg.armor - base.armor,
      listed: ['Swift Feet', 'Second Wind', 'Last Stand', 'Field Medic'].every((w) => names.some((n) => n.startsWith(w))),
    }
  })
  expect(r).toEqual({ speed: 1.2, coins: 0.5, startCoins: 60, regen: true, ammo: 2, headshot: 1.25, softer: 0.9, health: 40, armor: 20, listed: true })
})

// 2026-10-12 batch: each one comes from a real run report - the wave
// report carries the difficulty and mutators, the end report the run's
// totals, and career totals add up across runs.
test('the 2026-10-12 Zombie Survival achievements unlock from run reports', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const result = await page.evaluate(() => {
    const g = window.__game
    g.settings.guestMode = false
    const ids = ['survivor_30', 'massacre', 'untouchable', 'sharpshooter', 'boss_hunter', 'get_to_the_chopper', 'hardened', 'apex_predator', 'glass_cannon', 'iron_will', 'exterminator', 'regular', 'fortune_hunter']
    const has = (id) => g.achievements.unlocked.has(id)
    const before = ids.filter(has)
    // Not yet: wave 9 on Hard, wave 10 on Normal with no mutators.
    g._onPlayEvent('wave', { wave: 9, difficulty: 'hard', mutators: ['glassHouse', 'ironMode'] })
    g._onPlayEvent('wave', { wave: 10, difficulty: 'normal', mutators: [] })
    const early = ids.filter(has)
    g._onPlayEvent('wave', { wave: 30, difficulty: 'hard', mutators: ['glassHouse', 'ironMode'] })
    g._onPlayEvent('wave', { wave: 5, difficulty: 'apex', mutators: [] })
    g.careerStats.totalKills = 900
    g.careerStats.totalRuns = 24
    g._onPlayEvent('end', {
      waves: 30, kills: 250, bestStreak: 50, won: true, died: false, mode: 'zombieExtraction', difficulty: 'hard', seconds: 600,
      coins: 3000, headshots: 75, meleeKills: 0, chests: 0, upgrades: 0, bosses: 5,
    })
    g._openAchievementsPanel()
    const cards = document.getElementById('achievements-options').children.length
    return { before, early, missing: ids.filter((id) => !has(id)), cards }
  })
  expect(result.before).toEqual([])
  expect(result.early).toEqual([])
  expect(result.missing).toEqual([])
  expect(result.cards).toBeGreaterThanOrEqual(32)
})

// Prestige costs Points per level (100k, 200k, ...), the star at the top
// left updates at once, and each level really adds +10% Points per run.
test('Prestige costs more each level and the star updates at once', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(() => {
    const g = window.__game
    g.settings.guestMode = false
    g.achievements.unlocked.add('survivor_10')
    window.confirm = () => true
    const m = g.metaProgress
    m.prestigeLevel = 0
    m.purchased = new Set()
    m.legacyPoints = 99999
    g._openUpgradesPanel?.()
    g._renderUpgradesOptions()
    const out = { blocked: document.getElementById('prestige-btn').disabled }
    g._prestige()
    out.stillLevel0 = m.prestigeLevel === 0 && m.legacyPoints === 99999
    m.legacyPoints = 150000
    g._renderUpgradesOptions()
    out.star = document.getElementById('currency-points-amount').textContent
    g._prestige()
    out.level1 = m.prestigeLevel === 1
    out.starAfter = document.getElementById('currency-points-amount').textContent
    out.nextCost = g._prestigeCost()
    out.costLine = document.getElementById('prestige-cost-line').textContent
    // A run now pays +10%.
    const before = m.legacyPoints
    g._onPlayEvent('end', { waves: 0, kills: 100, bestStreak: 0, won: false, died: true, mode: 'classic', seconds: 60, coins: 0, headshots: 0, meleeKills: 0, chests: 0, upgrades: 0, bosses: 0 })
    out.earned = m.legacyPoints - before
    return out
  })
  expect(r.blocked).toBe(true)
  expect(r.stillLevel0).toBe(true)
  expect(r.star).toBe('150000')
  expect(r.level1).toBe(true)
  expect(r.starAfter).toBe('0')
  expect(r.nextCost).toBe(200000)
  expect(r.costLine).toContain('200,000')
  expect(r.earned).toBe(220) // 100 kills x 10 x 0.2, +10% for level 1
})

// 2026-10-17 batch: third-tier upgrades (each after an existing one) and
// 14 more achievements from run reports, career totals and the Upgrades
// panel itself.
test('the 2026-10-17 upgrades and achievements work', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(() => {
    const g = window.__game
    g.settings.guestMode = false
    g.settings.difficulty = 'normal'
    g.settings.mutators = Object.fromEntries(Object.keys(g.settings.mutators).map((k) => [k, false]))
    const base = g._playConfig()
    for (const id of ['kevlar', 'berserker', 'speedLoader', 'marathoner', 'goldRush', 'bankroll', 'ammoHoarder', 'sharpEye', 'hardenedHide', 'haggler']) g.metaProgress.purchased.add(id)
    const cfg = g._playConfig()
    const up = {
      armor: cfg.armor - base.armor,
      damage: +(cfg.damageMult - base.damageMult).toFixed(2),
      startCoins: cfg.startCoins - base.startCoins,
      discount: cfg.discount,
      ammo: +(cfg.ammoMult - base.ammoMult).toFixed(2),
      headshot: +(cfg.headshotMult - base.headshotMult).toFixed(2),
    }
    // Locked until the upgrade before it is bought.
    g.metaProgress.purchased = new Set()
    g._openUpgradesPanel()
    const kevlar = [...document.querySelectorAll('#upgrades-options .perk-option')].find((b) => b.textContent.includes('Kevlar Vest'))
    const locked = kevlar.classList.contains('locked')
    const ids = ['survivor_40', 'survivor_50', 'endurance', 'tycoon', 'slaughterhouse', 'unstoppable', 'dead_center', 'blade_master', 'boss_slayer', 'bone_breaker', 'apocalypse', 'veteran', 'well_equipped', 'maxed_out']
    const has = (id) => g.achievements.unlocked.has(id)
    const before = ids.filter(has)
    g._onPlayEvent('wave', { wave: 50, difficulty: 'normal', mutators: [] })
    g.careerStats.totalKills = 4600
    g.careerStats.totalRuns = 99
    g._onPlayEvent('end', {
      waves: 50, kills: 500, bestStreak: 100, won: false, died: true, mode: 'classic', difficulty: 'normal', seconds: 2700,
      coins: 7500, headshots: 150, meleeKills: 75, chests: 0, upgrades: 0, bosses: 15, skeletonKills: 75,
    })
    const afterRun = ids.filter(has)
    // Buying upgrades: Well Equipped at 10, Maxed Out with every one.
    g.metaProgress.legacyPoints = 1e7
    g.careerStats.lifetimeCoinsEarned = 1e6
    g._renderUpgradesOptions()
    for (let i = 0; i < 60; i++) {
      const btn = [...document.querySelectorAll('#upgrades-options .perk-option')].find((b) => !b.disabled)
      if (!btn) break
      btn.click()
    }
    return { up, locked, before, afterRun: afterRun.length, missing: ids.filter((id) => !has(id)) }
  })
  expect(r.up).toEqual({ armor: 25, damage: 0.15, startCoins: 100, discount: 0.25, ammo: 0.5, headshot: 0.25 })
  expect(r.locked).toBe(true)
  expect(r.before).toEqual([])
  expect(r.afterRun).toBe(12)
  expect(r.missing).toEqual([])
})

// XP (2026-10-23): every finished game earns XP (never spent, not the
// Points currency), XP sets your endless level, and clan XP only counts
// for the clan it was earned in, this month.
test('a finished game earns XP, levels come from XP, clan XP is per clan and month', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(() => {
    const g = window.__game
    g.settings.guestMode = false
    g.settings.difficulty = 'normal'
    g.careerStats.xp = 0
    const legacyBefore = g.metaProgress.legacyPoints
    const reward = g._onPlayEvent('end', { waves: 4, kills: 20, bestStreak: 5, won: false, died: true, mode: 'zombieSurvival', difficulty: 'normal', seconds: 130, coins: 0 })
    const xpAfterGame = g.careerStats.xp
    g.careerStats.xp = 1300
    g._openLevelsPanel()
    const text = document.getElementById('levels-content').textContent.replace(/\s+/g, ' ').trim()
    return {
      reward: reward && reward.xp,
      xpAfterGame,
      pointsStillCurrency: g.metaProgress.legacyPoints >= legacyBefore,
      level: g._computeAvatarLevel(),
      text,
    }
  })
  let rec = Xp.addClanXp(null, 'clanA', 100, '2026-10')
  rec = Xp.addClanXp(rec, 'clanA', 50, '2026-10')
  Object.assign(r, {
    sameMonth: Xp.currentClanXp(rec, 'clanA', '2026-10'),
    nextMonth: Xp.currentClanXp(rec, 'clanA', '2026-11'),
    otherClan: Xp.currentClanXp(rec, 'clanB', '2026-10'),
    entry: Xp.entryClanXp({ clanXp: 70, clanXpClan: 'clanA', clanXpMonth: '2026-10' }, 'clanA', '2026-10'),
    oldEntry: Xp.entryClanXp({ clanXp: 70, clanXpClan: 'clanA', clanXpMonth: '2026-09' }, 'clanA', '2026-10'),
    starter: Xp.starterXp(100, 4),
    lastDayOfMonth: Xp.daysUntilClanReset(Date.UTC(2026, 9, 31, 20)),
    laMidnightFlip: [Xp.clanMonthKey(Date.UTC(2026, 10, 1, 6)), Xp.clanMonthKey(Date.UTC(2026, 10, 1, 8))],
  })
  // 20 kills x10 + 4 waves x25 + 2 minutes x5 = 310
  expect(r.reward).toBe(310)
  expect(r.xpAfterGame).toBe(310)
  expect(r.pointsStillCurrency).toBe(true)
  expect(r.level).toBe(3)
  expect(r.text).toContain('Level 3')
  expect(r.text).toContain('50 / 1,000 XP to level 4')
  expect(r.sameMonth).toBe(150)
  expect(r.nextMonth).toBe(0)
  expect(r.otherClan).toBe(0)
  expect(r.entry).toBe(70)
  expect(r.oldEntry).toBe(0)
  expect(r.starter).toBe(1100)
  expect(r.lastDayOfMonth).toBe(1)
  // Nov 1 starts at midnight Los Angeles time (07:00 UTC in daylight time).
  expect(r.laMidnightFlip).toEqual(['2026-10', '2026-11'])
})

// Clan XP survives a reload (2026-10-26, "the clan still is 0 xp"):
// loadSettings used to drop settings.clanXp, so it never reached the
// leaderboard doc that clans add up.
test('clan XP earned in a game is still there after a reload', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    const g = window.__game
    g.settings.guestMode = false
    g._cloudUid = 'test-uid'
    g.settings.clanId = 'clanA'
    g._onPlayEvent('end', { waves: 2, kills: 10, bestStreak: 3, won: false, died: true, mode: 'zombieSurvival', difficulty: 'normal', seconds: 60, coins: 0 })
  })
  await page.reload()
  await waitForGame(page)
  const r = await page.evaluate(() => ({ rec: window.__game.settings.clanXp, clanId: window.__game.settings.clanId }))
  expect(r.clanId).toBe('clanA')
  expect(r.rec && r.rec.clanId).toBe('clanA')
  // 10 kills x10 + 2 waves x25 + 1 minute x5 = 155
  expect(r.rec && r.rec.xp).toBe(155)
})

// Print Achievements List (2026-10-24): every achievement, whatever the
// panel's filter, 8 across x 9 down on one landscape page.
test('printing achievements puts all of them on one page', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const count = await page.evaluate(() => {
    window.print = () => {}
    const g = window.__game
    if (g.achievementsSortSelect) g.achievementsSortSelect.value = 'achieved'
    g.printAchievementsBtn.click()
    return document.querySelectorAll('#print-stats-sheet .print-ach-row').length
  })
  expect(count).toBe(72)
  await page.emulateMedia({ media: 'print' })
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
  expect(pages).toBe(1)
  const fs = await import('node:fs')
  fs.writeFileSync(test.info().outputPath('achievements-print.pdf'), pdf)
})
