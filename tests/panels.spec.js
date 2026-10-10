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
// panel") - index.html's __menuLayout (fitLinksRow) tightens or wraps the row.
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

// Signed-out Profile is Sign Up or Login (2026-10-10): the two plaques open
// their own pages, whose Google button is the real sign-in, and Back /
// re-opening the panel returns to the choice.
test('signed-out Profile shows Sign Up or Login', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    let signIns = 0
    g._handleCloudSignIn = () => { signIns++ }
    await g._openProfilePanel()
    const shown = (id) => !document.getElementById(id).hidden
    const out = { gate: getComputedStyle(document.getElementById('profile-login-gate')).display }
    out.choose = shown('auth-view-choose') && !shown('auth-view-signup') && !shown('auth-view-login')
    out.title = document.getElementById('profile-panel-title').textContent
    out.chooseTerms = document.querySelectorAll('#auth-view-choose .auth-terms').length
    out.buttons = [document.getElementById('profile-gate-register-btn').textContent, document.getElementById('profile-gate-login-btn').textContent]
    document.getElementById('profile-gate-register-btn').click()
    out.signup = shown('auth-view-signup') && !shown('auth-view-choose') && shown('auth-back-btn')
    out.signupSub = document.getElementById('auth-signup-sub').textContent
    out.signupTerms = document.querySelectorAll('#auth-view-signup .auth-terms .auth-link').length
    document.getElementById('auth-back-btn').click()
    out.back = shown('auth-view-choose') && !shown('auth-back-btn')
    document.getElementById('profile-gate-login-btn').click()
    out.login = shown('auth-view-login')
    out.loginTitle = document.getElementById('profile-panel-title').textContent
    out.terms = document.querySelectorAll('#auth-view-login .auth-terms .auth-link').length
    document.getElementById('auth-login-google-btn').click()
    document.getElementById('profile-gate-register-btn').click()
    document.getElementById('auth-signup-google-btn').click()
    out.signIns = signIns
    // Signed in: the title goes back to Profile.
    Object.defineProperty(g, '_cloudUid', { get: () => 'test-uid', configurable: true })
    await g._openProfilePanel()
    out.signedInTitle = document.getElementById('profile-panel-title').textContent
    delete g._cloudUid
    g._cloudUid = null
    await g._openProfilePanel()
    out.reset = shown('auth-view-choose')
    return out
  })
  expect(r.gate).toBe('flex')
  expect(r.choose).toBe(true)
  expect(r.title).toBe('Welcome to GayZ')
  expect(r.chooseTerms).toBe(0)
  expect(r.signupTerms).toBe(2)
  expect(r.signedInTitle).toBe('Profile')
  expect(r.buttons).toEqual(['Sign Up', 'Login'])
  expect(r.signup).toBe(true)
  expect(r.signupSub).toBe('Sign in to avoid losing progress')
  expect(r.back).toBe(true)
  expect(r.login).toBe(true)
  expect(r.loginTitle).toBe('Welcome back to GayZ')
  expect(r.terms).toBe(2)
  expect(r.signIns).toBe(2)
  expect(r.reset).toBe(true)
})
