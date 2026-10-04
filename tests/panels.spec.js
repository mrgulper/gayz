import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

// Every menu panel, and every tab inside one, is the same height (Gaymi,
// 2026-10-04: "dont make the panel behind change sizes" - Achievements'
// Deathmatch tab shrank the Old theme's paper). See --panel-chrome in
// style.css. Checked in both themes.
for (const theme of ['old', 'golden']) {
  test(`every panel and tab is the same height (${theme} theme)`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1010 })
    await gotoAndWaitForGame(page)

    const heights = await page.evaluate(async (theme) => {
      document.documentElement.classList.toggle('ui-theme-old', theme === 'old')
      const g = window.__game
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const out = {}
      for (const route of g._routes) {
        route.open()
        await wait(120)
        const box = route.panel?.querySelector('.panel-box')
        if (!box) continue
        out[route.slug] = box.offsetHeight
        const tabs = route.panel.querySelectorAll('.achievements-mode-tab, .hub-tab, .settings-tab, .quest-tab, .clan-tab, .inv-tab')
        for (const tab of tabs) {
          tab.click()
          await wait(60)
          out[`${route.slug} > ${tab.textContent.trim().slice(0, 24)}`] = box.offsetHeight
        }
        g._closeAllMenuPanels()
      }
      return out
    }, theme)

    const expected = heights.store
    const different = Object.entries(heights).filter(([, h]) => h !== expected)
    expect(Object.keys(heights).length).toBeGreaterThan(20)
    expect(different, `panels whose height isn't ${expected}px`).toEqual([])
  })
}
