import { test, expect } from '@playwright/test'
import { waitForGame, hideAssetLoader } from './helpers.js'

// 2026-10-17: after one online visit the whole game plays with no internet
// (src/sw.js keeps it on the device, Offline.js handles the online-only
// buttons): it boots, opens a panel link, plays Map 1, opens the Map
// Editor and Design a Skin (its three.js and the fonts come from the game
// itself), and online-only buttons say they need internet instead.
test('the game plays offline after one online visit', async ({ page, context }) => {
  await context.addInitScript(() => { try { localStorage.setItem('gayz-sw-in-tests', '1') } catch { /* no storage */ } })
  await page.goto('/')
  await waitForGame(page)
  const cached = await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    const names = await caches.keys()
    const urls = (await (await caches.open(names[0])).keys()).map((r) => new URL(r.url).pathname)
    return { names, count: urls.length, fonts: urls.filter((u) => u.startsWith('/fonts/')).length, three: urls.filter((u) => u.startsWith('/skin-designer/three/')).length, oldModels: urls.filter((u) => u.startsWith('/models/buildings/')).length }
  })
  expect(cached.names.length).toBe(1)
  expect(cached.count).toBeGreaterThan(60)
  expect(cached.fonts).toBeGreaterThan(10)
  expect(cached.three).toBe(3)
  expect(cached.oldModels).toBe(0)

  await context.setOffline(true)
  await page.goto('/settings')
  await waitForGame(page)
  await hideAssetLoader(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = { settings: g.settingsOpen, marked: document.documentElement.classList.contains('is-offline'), toast: g.loreToast.textContent }
    g._toggleSettings(false)
    document.getElementById('market-btn').click()
    out.market = getComputedStyle(document.getElementById('market-panel')).display
    out.needs = g.loreToast.textContent
    out.font = (await document.fonts.load('16px Rye')).length
    return out
  })
  expect(r.settings).toBe(true)
  expect(r.marked).toBe(true)
  expect(r.toast.length).toBeGreaterThan(0)
  expect(r.market).toBe('none')
  expect(r.needs).not.toBe(r.toast)
  expect(r.font).toBeGreaterThan(0)

  await page.evaluate(() => window.__game._openSkinDesignerPanel())
  let frame = null
  for (let i = 0; i < 60 && !frame; i++) {
    frame = page.frames().find((f) => f.url().includes('skin-designer'))
    if (!frame) await page.waitForTimeout(250)
  }
  const three = await frame.evaluate(async () => (await import('three')).REVISION)
  expect(Number(three)).toBeGreaterThan(150)
  await page.evaluate(() => window.__game._closeAllMenuPanels())

  await page.evaluate(() => { localStorage.removeItem('gayz-play-saved-run'); window.__game.playBtn.click() })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 90000 })
  const play = await page.evaluate(() => {
    const bm = window.__game.buildMode
    bm.survival._pickWeapon('rifle')
    return { blocks: bm.blockCount, gun: !!bm.tryMode._gun }
  })
  expect(play.blocks).toBeGreaterThan(10000)
  expect(play.gun).toBe(true)
})
