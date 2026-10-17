import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame, waitForGame, hideAssetLoader } from './helpers.js'

test('a settings change persists across a real page reload', async ({ page }) => {
  await gotoAndWaitForGame(page)

  await page.evaluate(() => {
    const g = window.__game
    g.sensitivitySlider.value = 150
    g.sensitivitySlider.dispatchEvent(new Event('input'))
  })

  // A genuine page.reload(), not a reload triggered from inside
  // page.evaluate() - CLAUDE.md documents the latter as unreliable to
  // observe (throws "Execution context was destroyed" mid-call).
  await page.reload()
  await waitForGame(page)
  await hideAssetLoader(page)

  const persisted = await page.evaluate(() => window.__game.settings.sensitivity)
  expect(persisted).toBe(150)
})

test('Restore Default Settings actually resets a changed value', async ({ page }) => {
  // This test does THREE full Game() constructions (initial load, the
  // explicit reload below, and the one _restoreDefaultSettings triggers) -
  // playwright.config.js's global 120s timeout was sized for "two
  // constructions plus margin" (see its own comment), which this test
  // structurally exceeds under any real system load. That mismatch (not
  // app or test-logic behavior) is what made this test flaky across a long
  // session of otherwise-unrelated work - confirmed by manually driving
  // the exact same reload sequence outside the Playwright runner, which
  // passed reliably every single time. Overriding just this one test's
  // timeout rather than raising the global one, since every other test in
  // the suite really is covered by the existing 120s budget.
  test.setTimeout(240000)
  await gotoAndWaitForGame(page)

  await page.evaluate(() => {
    const g = window.__game
    g.sensitivitySlider.value = 250
    g.sensitivitySlider.dispatchEvent(new Event('input'))
  })
  await page.reload()
  await waitForGame(page)
  await hideAssetLoader(page)

  const beforeRestore = await page.evaluate(() => window.__game.settings.sensitivity)
  expect(beforeRestore).toBe(250)

  // Restore Default Settings reloads the page itself (see
  // _restoreDefaultSettings in Game.js) - trigger it in its own isolated
  // call, wrapped in try/catch for the expected navigation-time error,
  // per CLAUDE.md's documented pattern for reload-triggering actions.
  try {
    await page.evaluate(() => window.__game._restoreDefaultSettings())
  } catch {
    // Expected - the reload can destroy the evaluate context mid-call.
  }
  await page.waitForTimeout(1500)
  await waitForGame(page)
  await hideAssetLoader(page)

  const afterRestore = await page.evaluate(() => window.__game.settings.sensitivity)
  expect(afterRestore).toBe(100) // defaultSettings()'s baseline value
})

// A lost graphics connection pauses the game behind a small note, and
// coming back carries on with Lite Textures on (LiteTextures.js).
test('graphics loss pauses quietly and recovers with Lite Textures', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    const wait = (ms) => new Promise((res) => setTimeout(res, ms))
    const ext = g.renderer.getContext().getExtension('WEBGL_lose_context')
    const out = { liteBefore: g.settings.liteTextures }
    ext.loseContext()
    await wait(500)
    out.paused = g._glLost === true
    out.note = getComputedStyle(document.getElementById('graphics-reconnecting')).display
    out.panel = getComputedStyle(document.getElementById('graphics-lost-panel')).display
    ext.restoreContext()
    await wait(1500)
    out.resumed = g._glLost === false
    out.noteAfter = getComputedStyle(document.getElementById('graphics-reconnecting')).display
    out.liteAfter = g.settings.liteTextures
    let fullSize = 0
    const roots = Object.values(g.weapons.viewmodels)
    for (const root of roots) root.traverse((o) => {
      for (const m of [].concat(o.material || [])) {
        for (const k in m) {
          const tex = m[k]
          if (tex?.isTexture && (tex.image instanceof HTMLImageElement || tex.image instanceof ImageBitmap) && tex.image.width >= 128) fullSize++
        }
      }
    })
    out.fullSizeLeft = fullSize
    // Turning it off puts the full pictures back.
    g.settings.liteTextures = false
    g._applyLiteTextures()
    let restored = 0
    for (const root of roots) root.traverse((o) => { for (const m of [].concat(o.material || [])) for (const k in m) { const tex = m[k]; if (tex?.isTexture && (tex.image instanceof HTMLImageElement || tex.image instanceof ImageBitmap) && tex.image.width >= 128) restored++ } })
    out.restored = restored > 0
    return out
  })

  expect(r.liteBefore).toBe(false)
  expect(r.paused).toBe(true)
  expect(r.note).toBe('flex')
  expect(r.panel).toBe('none')
  expect(r.resumed).toBe(true)
  expect(r.noteAfter).toBe('none')
  expect(r.liteAfter).toBe(true)
  expect(r.fullSizeLeft).toBe(0)
  expect(r.restored).toBe(true)
})

// Settings > Controls > Homepage lists every real nav button (read from
// #menu-nav-buttons, so new ones join on their own), and moving one moves
// the homepage button. A save from before (8 fixed ids) keeps its order,
// with the buttons it never knew slotted in after their HTML neighbour.
test('nav order lists every homepage button and old saves still work', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const result = await page.evaluate(() => {
    const g = window.__game
    const navIds = [...document.querySelectorAll('#menu-nav-buttons > button')].map((b) => b.id)
    g._renderNavOrderList()
    const listed = [...document.querySelectorAll('#nav-order-list .nav-order-row')].map((r) => r.dataset.id)
    document.querySelector('#nav-order-list .nav-order-row[data-id="build-mode-btn"] .nav-order-up').click()
    const sidebar = [...document.querySelectorAll('#menu-nav-buttons > button')].sort((a, b) => a.style.order - b.style.order).map((b) => b.id)
    g.settings.navOrder = ['achievements-btn', 'hub-btn', 'coinshop-btn', 'upgrades-btn', 'server-btn', 'friends-btn', 'quests-btn', 'menu-inventory-btn']
    g._applyNavOrder()
    const old = [...document.querySelectorAll('#menu-nav-buttons > button')].sort((a, b) => a.style.order - b.style.order).map((b) => b.id)
    return { navIds, listed, sidebar, old }
  })
  expect(result.listed).toEqual(result.navIds)
  expect(result.listed).toContain('market-btn')
  expect(result.listed).toContain('build-mode-btn')
  expect(result.sidebar.indexOf('build-mode-btn')).toBe(result.sidebar.indexOf('achievements-btn') - 1)
  expect(result.old.slice(0, 2)).toEqual(['achievements-btn', 'build-mode-btn'])
  expect(result.old.indexOf('market-btn')).toBe(result.old.indexOf('coinshop-btn') + 1)
})

// Each tab's Reset to Defaults only resets that tab's settings.
test('a tab reset only resets that tab', async ({ page }) => {
  test.setTimeout(240000)
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    const g = window.__game
    g.settings.masterVolume = 30
    g.settings.sensitivity = 40
    g.settings.timeFormat = '24h'
    localStorage.setItem('gayz-settings', JSON.stringify(g.settings))
  })
  try {
    await page.evaluate(() => document.getElementById('reset-audio-defaults-btn').click())
  } catch {
    // Expected - the reset reloads the page.
  }
  await page.waitForTimeout(1500)
  await waitForGame(page)
  const after = await page.evaluate(() => {
    const s = window.__game.settings
    return { vol: s.masterVolume, sens: s.sensitivity, tf: s.timeFormat }
  })
  expect(after).toEqual({ vol: 100, sens: 40, tf: '24h' })
})
