import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

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

test('a quest can only be claimed once', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(() => {
    const g = window.__game
    g.careerStats.totalKills = 100 // meets the kill_100 quest's target
    const firstClaim = g.quests.claim('kill_100', g)
    const secondClaim = g.quests.claim('kill_100', g)
    return { firstClaim, secondClaim, isClaimed: g.quests.isClaimed('kill_100') }
  })

  expect(result.firstClaim).toBe(true)
  expect(result.secondClaim).toBe(false)
  expect(result.isClaimed).toBe(true)
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
