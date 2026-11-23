import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame, waitForGame } from './helpers.js'
import * as Xp from '../src/game/Xp.js'
import { DAILY_TEMPLATES, challengeFor } from '../src/game/DailyChallenge.js'
import en from '../src/game/i18n/en.js'
import * as WG from '../src/game/WorldGoal.js'

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
    const names = [...document.querySelectorAll('#skill-map-stage .skill-map-node .skill-map-name')].map((n) => n.textContent)
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
    const kevlar = document.querySelector('.skill-map-node[data-upgrade="kevlar"]')
    const locked = kevlar.classList.contains('is-locked')
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
    for (let i = 0; i < 120; i++) {
      const btn = document.querySelector('.skill-map-node.is-buy')
      if (!btn) break
      btn.click()
      document.getElementById('skill-map-buy').click()
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
// Upgrades skill tree (2026-11-14, Batch 4b): upgrades bought before the
// tree are refunded once, each branch unlocks in order, a fork locks its
// partner, the Map view buys too, and the new upgrades reach the game.
test('Upgrades skill tree: refund, order, forks, Map and new effects', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('tree-test-seeded')) return
    sessionStorage.setItem('tree-test-seeded', '1')
    localStorage.setItem('gayz-meta-progress', JSON.stringify({ legacyPoints: 100, purchased: ['vitality', 'ironwill', 'fortune'], prestigeLevel: 0 }))
  })
  await gotoAndWaitForGame(page)
  const first = await page.evaluate(() => {
    const g = window.__game
    return { pts: g.metaProgress.legacyPoints, owned: g.metaProgress.purchased.size, saved: JSON.parse(localStorage.getItem('gayz-meta-progress')).legacyPoints }
  })
  // 400 + 350 + 250 given back, and saved.
  expect(first).toEqual({ pts: 1100, owned: 0, saved: 1100 })
  await page.reload()
  await waitForGame(page)
  const r = await page.evaluate(() => {
    const g = window.__game
    const out = { afterReload: g.metaProgress.legacyPoints }
    g.settings.difficulty = 'normal'
    g.settings.mutators = Object.fromEntries(Object.keys(g.settings.mutators).map((k) => [k, false]))
    g.metaProgress.legacyPoints = 100000
    g._openUpgradesPanel()
    // One florr-style map (2026-11-22): round icon spots with a price
    // badge, your skin in the middle, a hover card with the stats.
    const q = (id) => document.querySelector(`.skill-map-node[data-upgrade="${id}"]`)
    const buy = (id) => { q(id).click(); document.getElementById('skill-map-buy').click() }
    out.oldViewsGone = !document.getElementById('upgrades-options') && !document.querySelector('.skill-view-btn')
    out.cards = document.querySelectorAll('#skill-map-stage .skill-map-node').length
    out.icons = [...document.querySelectorAll('#skill-map-stage .skill-map-node')].every((n) => n.querySelector('.skill-map-icon svg') && n.querySelector('.skill-map-cost').textContent)
    out.me = !!document.querySelector('.skill-map-start .skill-map-me')
    q('vitality').dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
    const tip = document.getElementById('skill-map-tip')
    out.tip = tip.classList.contains('show') && tip.textContent.includes('Max Health')
    // In order: Iron Will waits for +50 Max Health.
    out.ironLocked = q('ironwill').classList.contains('is-locked')
    for (const id of ['vitality', 'ironwill', 'juggernaut', 'tank']) buy(id)
    q('regenerator').click()
    out.forkLocked = q('regenerator').classList.contains('is-fork') && !document.getElementById('skill-map-buy')
    buy('swiftfoot')
    out.mapBought = g.metaProgress.purchased.has('swiftfoot') && q('swiftfoot').classList.contains('is-owned') && q('swiftfoot').querySelector('.skill-map-cost').textContent === '\u2713'
    out.owned = document.getElementById('skill-map-owned').textContent.includes('5 / 76')
    out.saved = JSON.parse(localStorage.getItem('gayz-meta-progress')).tree.includes('tank')
    // Numbers and reacting skills reach the game's config.
    for (const id of ['extendedMags', 'ironGut', 'finisher', 'notToday']) g.metaProgress.purchased.add(id)
    const cfg = g._playConfig()
    out.cfg = { mag: cfg.magMult, hunger: +cfg.hungerMult.toFixed(2), skills: [...cfg.skills].sort() }
    return out
  })
  expect(r).toEqual({
    afterReload: 1100, oldViewsGone: true, cards: 76, icons: true, me: true, tip: true, ironLocked: true, forkLocked: true, mapBought: true, owned: true, saved: true,
    cfg: { mag: 1.25, hunger: 0.6, skills: ['finisher', 'notToday'] },
  })
})

// TreeSkills.js in a real game: damage bonuses, a saved life, wave rewards.
test('skill tree upgrades work in a real game', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    const g = window.__game
    g.careerStats.totalRuns = Math.max(1, g.careerStats.totalRuns)
    g.settings.selectedGameMode = 'classic'
    g.settings.mutators = Object.fromEntries(Object.keys(g.settings.mutators).map((k) => [k, false]))
    g.metaProgress.purchased = new Set(['giantKiller', 'firstStrike', 'finisher', 'notToday', 'shrugOff', 'armorRefill', 'patchUp', 'restock', 'packedLunch'])
    g.playBtn.click()
  })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  const r = await page.evaluate(() => {
    const s = window.__game.buildMode.survival
    const k = s.skills
    const z = { boss: true, health: 100, maxHealth: 100, x: 0, z: 0 }
    const out = { fresh: k.shotDamage(z, 10, s.weapon) }
    z.health = 10
    out.low = k.shotDamage(z, 10, s.weapon)
    let blocked = 0
    for (let i = 0; i < 5; i++) if (k.blocksHit()) blocked++
    out.shrug = blocked
    s.health = 0
    out.saved = k.cheatDeath() && s.health === 25 && !k.cheatDeath()
    s.health = 40
    s.armor = 0
    s.cfg.armor = 50
    const reserve = s.reserve
    k.onWaveCleared(25)
    out.wave = { health: s.health, armor: s.armor, restocked: s.reserve - reserve === s.magSize() }
    k.giveStartItems()
    out.lunch = [...s.inv.hotbar, ...s.inv.grid].filter((x) => x?.id === 'cookedMeat').reduce((n, x) => n + x.n, 0) >= 3
    return out
  })
  // Boss + unhurt: x1.7; boss + under a quarter health: x1.8.
  expect(r).toEqual({ fresh: 17, low: 18, shrug: 1, saved: true, wave: { health: 60, armor: 15, restocked: true }, lunch: true })
})

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

// Level up (2026-10-26): a game that passes a level pays its coins and the
// level number on the badge and the nameplate updates straight away.
test('levelling up pays coins and updates the level number at once', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(() => {
    const g = window.__game
    g.careerStats.xp = 490
    g._updateBestStatsDisplay()
    g._renderPlayerTag()
    const coins = g.coins
    const res = g._onPlayEvent('end', { waves: 1, kills: 1, bestStreak: 1, won: false, died: true, mode: 'zombieDefense', seconds: 30, coins: 0 })
    return {
      before: res.levelBefore.level,
      after: res.levelAfter.level,
      levelCoins: res.levelCoins,
      coinsGained: g.coins - coins,
      badge: document.getElementById('menu-avatar-level').textContent,
      nameplate: document.querySelector('#player-showcase-title .nameplate-level').textContent,
    }
  })
  expect(r).toEqual({ before: 1, after: 2, levelCoins: Xp.levelUpCoins(2), coinsGained: Xp.levelUpCoins(2), badge: '2', nameplate: '2' })
})

// 2026-10-30: Quests are Kirka-style cards, two to a row, each with a
// rarity (by how hard it is) and a search box and All rarities menu on top.
test('Quests have rarities, two to a row, with search and a rarity filter', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g._openQuestsPanel()
    await new Promise((res) => setTimeout(res, 300))
    const cards = () => [...document.querySelectorAll('#rolling-quests-options .quest-card')]
    const out = {}
    out.count = cards().length
    out.allRated = cards().every((c) => ['common', 'uncommon', 'rare', 'epic', 'legendary'].includes(c.dataset.rarity) && c.querySelector('.quest-card-rarity').textContent.length > 0)
    out.columns = getComputedStyle(document.getElementById('rolling-quests-options')).gridTemplateColumns.split(' ').length
    document.getElementById('quest-rarity-filter-btn').click()
    document.querySelector('#quest-rarity-filter-menu [data-market-rarity="legendary"]').click()
    out.legendaryOnly = cards().every((c) => c.dataset.rarity === 'legendary')
    g._questRarity = 'all'
    const search = document.getElementById('quest-search')
    search.value = 'kill'
    search.dispatchEvent(new Event('input'))
    out.searchHits = cards().every((c) => /kill/i.test(c.querySelector('.perk-name').textContent))
    search.value = 'nothing matches this'
    search.dispatchEvent(new Event('input'))
    out.none = cards().length
    return out
  })
  expect(r.count).toBeGreaterThan(0)
  expect(r.allRated).toBe(true)
  expect(r.columns).toBe(2)
  expect(r.legendaryOnly).toBe(true)
  expect(r.searchHits).toBe(true)
  expect(r.none).toBe(0)
})

// 2026-10-31: the Daily Challenge is very hard now (about 3x, some days
// one run or Hard and up only), and a claimed quest card fades away on
// its own instead of the whole list being drawn again.
test('daily challenge is hard with run rules; a claimed quest fades away', async ({ page }) => {
  expect(DAILY_TEMPLATES.find((d) => d.type === 'kills').targets[0]).toBeGreaterThanOrEqual(120)
  expect(DAILY_TEMPLATES.find((d) => d.type === 'wave').targets[0]).toBeGreaterThanOrEqual(12)
  expect(DAILY_TEMPLATES.map((d) => d.type)).toEqual(expect.arrayContaining(['runKills', 'hardKills', 'hardWave']))
  // Every goal has its own words (the kill-streak one used to say "day streak").
  for (const d of DAILY_TEMPLATES) {
    expect(en[d.titleKey]).toBeTruthy()
    expect(en[d.titleKey]).not.toMatch(/day streak/)
  }
  const findDay = (type) => {
    for (let i = 0; i < 2000; i++) {
      const day = `2030-${i}`
      if (challengeFor(day).template.type === type) return day
    }
    return null
  }
  const days = { runKills: findDay('runKills'), hardKills: findDay('hardKills') }
  expect(days.runKills).toBeTruthy()
  expect(days.hardKills).toBeTruthy()
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async (days) => {
    const g = window.__game
    const out = {}
    // Run rules: a single run's kills, and Hard-and-up kills only.
    const dc = new g.dailyChallenge.constructor()
    dc._roll = () => {}
    dc._save = () => {}
    dc.state = { day: days.runKills, progress: 0, claimed: false, streak: 0, lastClaim: null, v: 2 }
    dc.record('kill', { runKills: 30 })
    dc.record('kill', { runKills: 10 })
    out.runKills = dc.state.progress
    dc.state = { day: days.hardKills, progress: 0, claimed: false, streak: 0, lastClaim: null, v: 2 }
    dc.record('kill', { difficulty: 'normal' })
    dc.record('kill', { difficulty: 'hard' })
    dc.record('kill', { difficulty: 'nightmare' })
    out.hardKills = dc.state.progress
    // A claimed quest card fades and is removed; the list isn't redrawn.
    g.rollingQuests.activeQuests = () => [1, 2, 3].map((spawnedAt) => ({ spawnedAt, progress: 5, template: { target: 5, rarity: 'common', titleKey: 'rollingQuestKills', rewardCoins: 1, rewardXp: 1 } }))
    g.rollingQuests.claim = () => ({ coins: 1, xp: 1 })
    g._openQuestsPanel()
    await new Promise((res) => setTimeout(res, 300))
    const list = g.rollingQuestsOptions
    const keep = list.querySelector('[data-spawned-at="2"]')
    const card = list.querySelector('[data-spawned-at="1"]')
    card.click()
    out.fading = card.classList.contains('quest-fade-out')
    // Halfway through the fade (read off the animation itself: a busy test
    // machine may not have drawn a single frame of it after 200ms).
    const fade = card.getAnimations().find((a) => a.animationName === 'quest-card-out')
    if (fade) fade.currentTime = 200
    out.midOpacity = Number(getComputedStyle(card).opacity)
    for (let i = 0; i < 40 && list.querySelector('[data-spawned-at="1"]'); i++) await new Promise((res) => setTimeout(res, 50))
    out.removed = !list.querySelector('[data-spawned-at="1"]')
    out.sameOthers = list.querySelector('[data-spawned-at="2"]') === keep
    return out
  }, days)
  expect(r.runKills).toBe(30)
  expect(r.hardKills).toBe(2)
  expect(r.fading).toBe(true)
  expect(r.midOpacity).toBeLessThan(1)
  expect(r.removed).toBe(true)
  expect(r.sameOthers).toBe(true)
})

// World Goal (WorldGoal.js): a finished game goes on a "still to send"
// pile; sending goes in rule-sized steps and keeps what failed.
test('World Goal: a finished game adds to the weekly pile, sent in small steps', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const inGame = await page.evaluate(() => {
    const g = window.__game
    g.settings.guestMode = false
    localStorage.removeItem('gayz-world-goal-pending')
    const end = { waves: 12, kills: 1234, headshots: 300, bosses: 2, coins: 900, meleeKills: 7, bestStreak: 5, won: false, died: true, mode: 'zombieRush', seconds: 300 }
    g._onPlayEvent('end', end)
    return { end, pile: JSON.parse(localStorage.getItem('gayz-world-goal-pending') || '{}') }
  })
  const weeks = Object.keys(inGame.pile)
  expect(weeks.length).toBe(1)
  const goal = WG.worldGoalForWeek(weeks[0])
  expect(inGame.pile[weeks[0]]).toBe(inGame.end[goal.stat])

  // The sending part, here in the test with a fake storage and sender.
  const store = {}
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v) }, removeItem: (k) => { delete store[k] } }
  try {
    store['gayz-world-goal-pending'] = JSON.stringify({ '2026-W47': 1234 })
    const got = []
    let calls = 0
    // The first two steps land, the third fails (offline).
    const sent = await WG.sendWorldGoalPending(async (w, n) => { if (++calls === 3) throw new Error('offline'); got.push(n) }, { force: true })
    expect(sent).toBe(1000)
    expect(got).toEqual([500, 500])
    expect(WG.loadWorldGoalPending()['2026-W47']).toBe(234)
    // Too soon after a send: nothing goes out.
    expect(await WG.sendWorldGoalPending(async () => { throw new Error('should not send') })).toBe(0)
  } finally {
    delete globalThis.localStorage
  }
  expect(WG.worldGoalSteps(1234)).toEqual([500, 500, 234])
  expect(WG.worldGoalForWeek('2026-W47').id).not.toBe(WG.worldGoalForWeek('2026-W48').id)
})

// World Goal Batch 3: the homepage card and the reward. Helping (a
// finished game that adds to the goal) is kept in careerStats; once the
// world's count reaches the target, Claim gives the week's hat or cape
// plus coins, once. The second time a goal comes round it's coins only.
test('World Goal: homepage card, helpers claim the hat or cape + coins once', async ({ page }) => {
  // The rules part, here in the test.
  const career = {}
  WG.noteMyWorldGoalPart(career, '2026-W46', 10)
  WG.noteMyWorldGoalPart(career, '2026-W47', 5)
  WG.noteMyWorldGoalPart(career, '2026-W47', 7)
  WG.noteMyWorldGoalPart(career, '2026-W48', 3)
  expect(career.worldGoalMine).toEqual({ '2026-W47': 12, '2026-W48': 3 })
  const g47 = { ...WG.worldGoalForWeek('2026-W47'), week: '2026-W47' }
  expect(WG.worldGoalRewardReady(career, { ...g47, count: g47.target - 1 })).toBe(false)
  expect(WG.worldGoalRewardReady({}, { ...g47, count: g47.target })).toBe(false) // didn't help
  const got = WG.claimWorldGoalReward(career, { ...g47, count: g47.target })
  expect(got).toEqual({ cosmetic: g47.reward, coins: WG.WORLD_GOAL_COINS })
  expect(WG.claimWorldGoalReward(career, { ...g47, count: g47.target })).toBe(null) // only once
  expect(WG.ownedWorldGoalRewards(career).has(g47.reward)).toBe(true)
  // Six goals later the same goal comes back: already owned -> coins only.
  const again = ['2026-W53', '2027-W6', '2027-W7', '2027-W1', '2026-W51', '2026-W52'].map((w) => ({ ...WG.worldGoalForWeek(w), week: w })).find((g) => g.id === g47.id)
  expect(again).toBeTruthy()
  WG.noteMyWorldGoalPart(career, again.week, 1)
  expect(WG.claimWorldGoalReward(career, { ...again, count: again.target })).toEqual({ cosmetic: '', coins: WG.WORLD_GOAL_COINS })

  // In the game: finish a game, the card says my part; reach the target,
  // Claim, coins go up and the reward is mine.
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.settings.guestMode = false
    g.careerStats.worldGoalMine = {}
    g.careerStats.worldGoalClaimed = []
    localStorage.removeItem('gayz-world-goal-pending')
    localStorage.removeItem('gayz-world-goal-cache')
    g._onPlayEvent('end', { waves: 12, kills: 1234, headshots: 300, bosses: 2, coins: 900, meleeKills: 7, bestStreak: 5, won: false, died: true, mode: 'zombieRush', seconds: 300 })
    const week = Object.keys(g.careerStats.worldGoalMine)[0]
    const mine = g.careerStats.worldGoalMine[week]
    g._homeWorldGoalWeek = undefined
    g._updateQuestsDot()
    const wait = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((res) => setTimeout(res, 50)); return fn() }
    const card = () => document.querySelector('#home-extras-left [data-card="worldgoal"]')
    await wait(card)
    const before = card()?.textContent.replace(/\s+/g, ' ') || ''
    // The world reaches the target (the cached count, as if just read).
    localStorage.setItem('gayz-world-goal-cache', JSON.stringify({ [week]: { count: 99999999, at: Date.now() } }))
    g._homeWorldGoalWeek = undefined
    g._updateQuestsDot()
    const btn = await wait(() => document.querySelector('[data-worldgoal-claim="this"]'))
    const coins = g.coins
    btn?.click()
    const after = card()?.textContent.replace(/\s+/g, ' ') || ''
    return { week, mine, before, hadBtn: !!btn, gained: g.coins - coins, claimed: g.careerStats.worldGoalClaimed, after, saved: JSON.parse(localStorage.getItem('gayz-career-stats') || '{}').worldGoalClaimed }
  })
  expect(r.mine).toBeGreaterThan(0)
  expect(r.before).toContain('World Goal')
  expect(r.before).toContain(`Your part: ${r.mine.toLocaleString('en-US')}`)
  expect(r.hadBtn).toBe(true)
  expect(r.gained).toBe(WG.WORLD_GOAL_COINS)
  expect(r.claimed).toEqual([r.week])
  expect(r.saved).toEqual([r.week])
  expect(r.after).toContain('Reward claimed')
  // The hat or cape now shows as unlocked in Inventory > Hats & Capes.
  const reward = WG.worldGoalForWeek(r.week).reward
  const locked = await page.evaluate(async (id) => {
    document.getElementById('inventory-tab-cosmetics')?.click()
    return document.querySelector(`[data-cosmetic="${id}"]`)?.classList.contains('locked')
  }, reward)
  expect(locked).toBe(false)
})
