import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

// Every menu panel, and every tab inside one, is the same height (Gaymi,
// 2026-10-04: "dont make the panel behind change sizes" - Achievements'
// Deathmatch tab shrank the Old theme's paper). See --panel-chrome in
// style.css. Checked in both themes.
for (const theme of ['old', 'golden']) {
  test(`every panel and tab is the same height and never scrolls sideways (${theme} theme)`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1010 })
    await gotoAndWaitForGame(page)

    const heights = await page.evaluate(async (theme) => {
      document.documentElement.classList.toggle('ui-theme-old', theme === 'old')
      const g = window.__game
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const out = {}
      // Nothing inside a panel may scroll sideways (Gaymi, 2026-10-04 -
      // Game Mode had a left-right scrollbar).
      const sideways = []
      const findSideways = (panel, label) => {
        for (const el of panel.querySelectorAll('*')) {
          if (/(auto|scroll)/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1) sideways.push(`${label}: ${el.id || el.className}`)
        }
      }
      for (const route of g._routes) {
        route.open()
        await wait(120)
        const box = route.panel?.querySelector('.panel-box')
        if (!box) continue
        out[route.slug] = box.offsetHeight
        findSideways(route.panel, route.slug)
        const tabs = route.panel.querySelectorAll('.achievements-mode-tab, .hub-tab, .settings-tab, .quest-tab, .clan-tab, .inv-tab')
        for (const tab of tabs) {
          tab.click()
          await wait(60)
          out[`${route.slug} > ${tab.textContent.trim().slice(0, 24)}`] = box.offsetHeight
          findSideways(route.panel, `${route.slug} > ${tab.textContent.trim().slice(0, 24)}`)
        }
        g._closeAllMenuPanels()
      }
      out.sideways = sideways
      return out
    }, theme)

    expect(heights.sideways, 'panel areas that scroll sideways').toEqual([])
    delete heights.sideways
    const expected = heights.store
    const different = Object.entries(heights).filter(([, h]) => h !== expected)
    expect(Object.keys(heights).length).toBeGreaterThan(20)
    expect(different, `panels whose height isn't ${expected}px`).toEqual([])
  })
}

// The footer links stay clear of the right column's buttons at every
// window size (Gaymi, 2026-10-04: "dont make it touch the right side
// panel") - Game.js _fitMenuLinksRow() tightens or wraps the row.
test('the footer links never reach the right-side buttons', async ({ page }) => {
  await gotoAndWaitForGame(page)
  for (const [width, height] of [[1280, 800], [1366, 768], [1440, 900], [1600, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(300)
    const r = await page.evaluate(() => {
      const nav = [...document.querySelectorAll('#menu-nav-buttons button')].filter((b) => b.offsetParent)
      const navLeft = Math.min(...nav.map((b) => b.getBoundingClientRect().left))
      const linksRight = Math.max(...[...document.querySelectorAll('#menu-links-row > *')].map((e) => e.getBoundingClientRect().right))
      const menu = document.getElementById('menu')
      return { gap: navLeft - linksRight, scroll: menu.scrollHeight - menu.clientHeight }
    })
    expect(r.gap, `${width}x${height}: space between the footer links and the buttons`).toBeGreaterThanOrEqual(24)
    expect(r.scroll, `${width}x${height}: homepage must not scroll`).toBeLessThanOrEqual(0)
  }
})
