import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

// Clan War + share codes (ClanWar.js, ShareCodes.js - social six plan
// Batch 2, 2026-11-20). The clipboard is made to say no, so the code lands
// in the box (the "copy it by hand" path) where the test can read it.
function noClipboard() {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('no')) }, configurable: true })
}

test('Clan War: board switch, last week winner, claim the prize once; lobby rules share code', async ({ page }) => {
  await page.addInitScript(noClipboard)
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    const g = window.__game
    Object.defineProperty(g, '_cloudUid', { get: () => 'me1234', set: () => {}, configurable: true })
    g.settings.clanId = 'c1'
    g.coins = 100
    localStorage.removeItem('gayz-clan-war-claimed')
    // My record: points last week (rolled from an old week by the game).
    const monday = (d) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10) }
    const lastWeek = monday(new Date(Date.now() - 7 * 86400000 - 12 * 3600000))
    localStorage.setItem('gayz-clan-war', JSON.stringify({ clan: 'c1', w: lastWeek, wp: 250, m: 'x', mp: 0 }))
    const list = [
      { clanId: 'c2', name: 'Big XP', memberCount: 3, monthXp: 900, weekPts: 120, monthPts: 400, lastWeekPts: 100, lastMonthPts: 0 },
      { clanId: 'c1', name: 'Mine', memberCount: 2, monthXp: 100, weekPts: 560, monthPts: 300, lastWeekPts: 250, lastMonthPts: 0 },
    ]
    g._clanRankingLast = list
    g._fetchClanRanking = () => Promise.resolve(list)
    g._openFriendsPanel()
  })
  await page.click('#friends-tab-clan')
  await page.click('#clan-subtab-ranking')
  // Opening the panel checks the (fake) membership and clears it: set it again.
  await page.evaluate(() => {
    window.__game.settings.clanId = 'c1'
    window.__game._renderClanRanking()
  })
  const rows = page.locator('#clan-all-list .clan-list-name')
  // Month XP board: the old order.
  await expect(page.locator('[data-clan-board="xp"]')).toHaveClass(/active/)
  await expect(rows.first()).toContainText('Big XP')
  await expect(page.locator('#clan-war-top')).toBeHidden()
  // War: Week - points order, last week's winner, my 1st-place prize.
  await page.click('[data-clan-board="week"]')
  await expect(rows.first()).toContainText('Mine')
  await expect(page.locator('#clan-all-list .clan-list-kills').first()).toHaveText('5.6 pts')
  await expect(page.locator('.clan-war-winner')).toContainText('Mine')
  await expect(page.locator('#clan-reset-note')).toContainText('days')
  const claim = page.locator('.clan-war-claim')
  await expect(claim).toHaveText('Claim #1 prize: 300 coins')
  await claim.click()
  await expect(claim).toHaveCount(0)
  expect(await page.evaluate(() => window.__game.coins)).toBe(400)
  // Only once.
  await page.evaluate(() => window.__game._renderClanRanking())
  await expect(page.locator('.clan-war-claim')).toHaveCount(0)
  // War: Month - nobody won last month, so nothing over the board.
  await page.click('[data-clan-board="month"]')
  await expect(rows.first()).toContainText('Big XP')
  await expect(page.locator('#clan-war-top')).toBeHidden()

  // Lobby rules share code: copy, change the form, paste back.
  await page.evaluate(() => {
    const g = window.__game
    g._closeAllMenuPanels()
    g.__serversBackendForTests = { list: async () => ({ servers: [] }) }
    g._openServerPanel()
  })
  await page.click('#server-tab-custom')
  await page.click('#server-create-btn')
  await expect(page.locator('#custom-lobby-form')).toBeVisible()
  await page.selectOption('#lobby-mode', 'zone')
  await page.selectOption('[data-pick="zh"]', '3')
  await page.selectOption('[data-pick="hp"]', '200')
  await page.click('#lobby-code-copy')
  const code = await page.inputValue('#lobby-code-input')
  expect(code).toMatch(/^GZL1-/)
  await page.selectOption('#lobby-mode', 'main')
  await page.selectOption('[data-pick="zh"]', '1')
  await page.fill('#lobby-code-input', 'GZL1-nonsense')
  await page.click('#lobby-code-use')
  await expect(page.locator('#lobby-code-status')).toContainText("doesn't work")
  await page.fill('#lobby-code-input', code)
  await page.click('#lobby-code-use')
  await expect(page.locator('#lobby-mode')).toHaveValue('zone')
  await expect(page.locator('[data-pick="zh"]')).toHaveValue('3')
  await expect(page.locator('[data-pick="hp"]')).toHaveValue('200')
  await expect(page.locator('#lobby-code-status')).toContainText('filled in')
})

test('Clan War points from zombie kills; ring loadout share code', async ({ page }) => {
  await page.addInitScript(noClipboard)
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    const g = window.__game
    g.__testNoDraw = true
    window.__ringForTests = true
    localStorage.removeItem('gayz-play-saved-run')
    localStorage.removeItem('gayz-clan-war')
    localStorage.setItem('gayz-ring-bag', JSON.stringify({ 'icecube:rare': 1 }))
    localStorage.setItem('gayz-ring-loadout', JSON.stringify(['icecube:rare', 'sawblade:common', 'bandage:common']))
    Object.defineProperty(g, '_cloudUid', { get: () => 'me1234', set: () => {}, configurable: true })
    g.settings.clanId = 'c1'
    g.careerStats.totalRuns = 1
    g.settings.selectedGameMode = 'classic'
    g.playBtn.click()
  })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  const pts = await page.evaluate(async () => {
    const s = window.__game.buildMode.survival
    const p = s.bodyPos()
    // A 100-health zombie = 0.10, a 500-health one = 0.50 (hundredths).
    for (const hp of [100, 500]) {
      const z = s._makeZombie(++s._zid, p.x + 3, p.y, p.z, hp, false)
      s.zombies.push(z)
      z.tier = 'common'
      s.damageZombie(z, 99999, null)
    }
    await new Promise((res) => setTimeout(res, 2600))
    return JSON.parse(localStorage.getItem('gayz-clan-war') || 'null')
  })
  expect(pts).toMatchObject({ clan: 'c1', wp: 60, mp: 60 })

  // Ring share code: copy mine, empty the ring, paste it back.
  await page.evaluate(() => window.__game.buildMode.survival.ringEditor.open())
  await expect(page.locator('#play-ring-editor')).toBeVisible()
  await page.click('[data-ring="code-copy"]')
  const code = await page.inputValue('#play-ring-editor .share-code-input')
  expect(code).toBe('GZR1-icecube.2_sawblade.0_bandage.0')
  await page.evaluate(() => {
    const s = window.__game.buildMode.survival
    s.ringEditor._apply(['', '', ''])
    s.ringEditor.render()
  })
  // A friend's code with an item I don't own: only mine go in.
  await page.fill('#play-ring-editor .share-code-input', 'GZR1-magnet.5_sawblade.0_bandage.0')
  await page.click('[data-ring="code-use"]')
  await expect(page.locator('#play-ring-editor .share-code-status')).toContainText('2 of 3')
  await page.fill('#play-ring-editor .share-code-input', code)
  // Typing in the box doesn't close the window (I is the Ring Bag key).
  await page.press('#play-ring-editor .share-code-input', 'i')
  await expect(page.locator('#play-ring-editor')).toBeVisible()
  await page.fill('#play-ring-editor .share-code-input', code)
  await page.press('#play-ring-editor .share-code-input', 'Enter')
  expect(await page.evaluate(() => window.__game.buildMode.survival.ring.keys.join(','))).toBe('icecube:rare,sawblade:common,bandage:common')
})
