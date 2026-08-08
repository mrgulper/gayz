import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

test('careerStats.totalKills persists after a completed run', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(() => {
    const g = window.__game
    const before = g.careerStats.totalKills
    // Minimal realistic state _recordRunEnd() reads from - same fields
    // this project's own ad-hoc verification scripts have set up all
    // session (night/kills/points, runStartedAt for playtime,
    // lowestHealthThisRun for the flawless-run check).
    g.night = 5
    g.kills = 37
    g.points = 100
    g.coins = g.coins || 0
    g.runStartedAt = performance.now() - 60000
    g._runStartCoins = g.coins
    g.peakKillStreakThisRun = 0
    g.lowestHealthThisRun = Infinity
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
