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
