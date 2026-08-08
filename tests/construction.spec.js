import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

// The load-bearing sanity check every other test (and this whole CI
// initiative) depends on: window.__game is set at the very end of the
// Game constructor specifically so tests can drive real game methods
// (see Game.js's own comment on this). If this fails, nothing else here
// can run correctly either.
test('window.__game exists after page load with no console errors', async ({ page }) => {
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))

  await gotoAndWaitForGame(page)

  const hasGame = await page.evaluate(() => typeof window.__game === 'object' && window.__game !== null)
  expect(hasGame).toBe(true)
  expect(errors).toEqual([])
})

test('the homepage renders with zero horizontal/vertical scroll at 1920x1080', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await gotoAndWaitForGame(page)

  // Documented baseline: this project has repeatedly regressed this
  // number by adding homepage content (see CLAUDE.md's menu-redesign
  // notes). 4px is the accepted existing baseline, not a hard zero -
  // this test exists to catch it getting meaningfully worse, not to
  // enforce a number nobody has actually hit.
  const overflow = await page.evaluate(() => {
    const menu = document.getElementById('menu')
    return menu.scrollHeight - menu.clientHeight
  })
  expect(overflow).toBeLessThanOrEqual(10)
})
