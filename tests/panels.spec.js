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

// Every "Sign Up or Login" button (Friend List, Global chat, Cloud Save)
// opens the Welcome to GayZ page instead of Google's popup directly
// (2026-10-10), and a friend list shows its count.
test('sign-in buttons go to the Welcome page; friend count shows', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    let popups = 0
    g._handleCloudSignIn = () => { popups++ }
    const out = {}
    for (const id of ['friends-signin-btn', 'server-chat-signin-btn', 'cloudsave-signin-btn']) {
      document.getElementById(id).click()
      await new Promise((res) => setTimeout(res, 50))
      out[id] = [getComputedStyle(document.getElementById('profile-panel')).display, document.getElementById('profile-panel-title').textContent]
      g._closeAllMenuPanels()
    }
    out.popups = popups
    g.settings.savedFriends = [{ name: 'A', uid: 'a' }, { name: 'B', uid: 'b' }, { name: 'C', uid: 'c' }]
    g._renderFriendsCount()
    out.count = document.getElementById('friends-count').textContent
    // Picking a friend again (by ID or name) says they're already a friend.
    g.settings.savedFriends = [{ name: 'Tazbot', uid: 'tz', playerId: 'ABC123' }]
    Object.defineProperty(g, '_cloudUid', { get: () => 'me', configurable: true })
    for (const typed of ['#abc123', 'tazbot']) {
      g.cloudsaveFriendInput.value = typed
      await g._sendFriendRequestClick()
      out['typed:' + typed] = g.cloudsaveFriendResult.textContent
    }
    await g._sendFriendRequestTo({ uid: 'tz', name: 'Tazbot', playerId: 'ABC123' })
    out.picked = g.cloudsaveFriendResult.textContent
    return out
  })
  for (const id of ['friends-signin-btn', 'server-chat-signin-btn', 'cloudsave-signin-btn']) {
    expect(r[id]).toEqual(['flex', 'Welcome to GayZ'])
  }
  expect(r.popups).toBe(0)
  expect(r.count).toBe('(3)')
  expect(r['typed:#abc123']).toBe('Tazbot is already your friend.')
  expect(r['typed:tazbot']).toBe('Tazbot is already your friend.')
  expect(r.picked).toBe('Tazbot is already your friend.')
})

// 2026-10-11 batch: the level coin opens Levels (Coming Soon) even with a
// panel open, nothing outside a text box can be selected, and the Add a
// Friend name list floats instead of pushing the page down.
test('Levels from a panel, nothing selectable, friend list floats', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await gotoAndWaitForGame(page)
  await page.evaluate(() => document.getElementById('menu-inventory-btn').click())
  await page.waitForTimeout(300)
  const coin = await page.evaluate(() => { const r = document.getElementById('menu-avatar-level').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await page.mouse.click(coin.x, coin.y)
  await page.waitForTimeout(300)
  const levels = await page.evaluate(() => ({
    levels: getComputedStyle(document.getElementById('levels-panel')).display,
    profile: getComputedStyle(document.getElementById('profile-panel')).display,
    text: document.getElementById('levels-content').textContent.replace(/\s+/g, ' ').trim(),
  }))
  expect(levels.levels).toBe('flex')
  expect(levels.profile).toBe('none')
  expect(levels.text).toBe('Coming Soon Levels are coming soon.')

  await page.evaluate(() => window.__game._closeAllMenuPanels())
  const badge = await page.evaluate(() => { const r = document.getElementById('menu-player-badge').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })
  await page.mouse.move(badge.x - 300, badge.y + 10)
  await page.mouse.down()
  await page.mouse.move(badge.x + badge.w - 5, badge.y + badge.h - 5, { steps: 8 })
  await page.mouse.up()
  await page.mouse.dblclick(badge.x + badge.w / 2, badge.y + badge.h - 15)
  await page.keyboard.press('Control+A')
  expect(await page.evaluate(() => getSelection().toString())).toBe('')

  const moved = await page.evaluate(async () => {
    const g = window.__game
    g._openFriendsPanel()
    g.friendsSignedOut.style.display = 'none'
    g.friendsSignedIn.style.display = 'flex'
    const status = document.getElementById('status-row-heading')
    const before = status.getBoundingClientRect().top
    g._showFriendSuggestions([{ name: 'Tazbot', playerId: 'ABC123' }, { name: 'Tazzy', playerId: 'XYZ999' }])
    const after = status.getBoundingClientRect().top
    return { before, after, open: g.cloudsaveFriendSuggestions.classList.contains('open') }
  })
  expect(moved.open).toBe(true)
  expect(moved.after).toBe(moved.before)
})

// 2026-10-11: Game Mode has no Choose Class / Save Setup / Surprise Me /
// Keybinds / Share and no Map 2 card, and Profile > Hidden has private
// Notes that are saved but never put on the public leaderboard entry.
test('Game Mode is trimmed and Profile has private Notes', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(() => {
    const g = window.__game
    const gone = ['hub-section-choose-class', 'menu-preset-row', 'save-preset-btn', 'surprise-me-btn', 'quick-keybinds-btn', 'open-share-btn', 'share-panel', 'map-select-2', 'class-comparison-table']
      .filter((id) => document.getElementById(id))
    g._openProfilePanel()
    const notes = document.getElementById('profile-notes-input')
    notes.value = 'remember: camp trader sells armor'
    notes.dispatchEvent(new Event('input'))
    const saved = JSON.parse(localStorage.getItem('gayz-settings')).privateNotes
    const hover = getComputedStyle(document.querySelector('.mode-toggle')).backgroundColor
    return { gone, saved, inHidden: !!notes.closest('#profile-page-hidden'), cfgMove: g._playConfig().moveMult, hover }
  })
  expect(r.gone).toEqual([])
  expect(r.saved).toBe('remember: camp trader sells armor')
  expect(r.inHidden).toBe(true)
  expect(r.cfgMove).toBe(1)
})

// 2026-10-11: an HD (128 px) skin from Design a Skin is worn like a normal
// one, and the nameplate is the same on the homepage and in Inventory -
// clan on top with no brackets.
test('HD skins are worn; the nameplate matches in both places', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const c = document.createElement('canvas')
    c.width = 128; c.height = 128
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#3366cc'; ctx.fillRect(0, 0, 128, 128)
    ctx.fillStyle = '#ffcc00'; ctx.fillRect(16, 16, 16, 16) // the face, in 2x pixels
    await g._applyImportedSkin(c.toDataURL('image/png'))
    g.settings.clanName = 'Raiders'
    g.settings.nickname = 'Tester'
    g._renderPlayerTag()
    document.getElementById('menu-inventory-btn').click()
    await new Promise((res) => setTimeout(res, 400))
    const plate = (sel) => {
      const el = document.querySelector(sel)
      const part = (cls) => el.querySelector('.' + cls)
      return {
        text: [...el.children].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.textContent).join('|'),
        clanAbove: part('nameplate-clan').getBoundingClientRect().bottom <= part('nameplate-name').getBoundingClientRect().top + 1,
      }
    }
    return {
      saved: g.settings.customSkinDataUrl.length > 0,
      face: document.getElementById('menu-avatar-photo').src.startsWith('data:image/png'),
      home: plate('#player-showcase-title'),
      inv: plate('#inv-skin-preview-title'),
      spins: g._invSkinAvatar3D?.noSpin !== true,
    }
  })
  expect(r.saved).toBe(true)
  expect(r.face).toBe(true)
  expect(r.home.text).toBe(r.inv.text)
  expect(r.home.text).toBe('1|Tester|Raiders')
  expect(r.home.clanAbove).toBe(true)
  expect(r.inv.clanAbove).toBe(true)
  expect(r.spins).toBe(false)
})

// 2026-10-11: with a panel open, pointing at the right column's buttons or
// profile card lights them up like real hover (the panel's backdrop sits
// over them, so :hover alone never reached them); a Settings checkbox
// that's on shows a check mark; the Market's filters fit their words.
test('right column lights up over a panel; checkbox check; filters fit', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await gotoAndWaitForGame(page)
  await page.evaluate(() => document.getElementById('market-btn').click())
  await page.waitForTimeout(300)
  const at = (id) => page.evaluate((i) => { const r = document.getElementById(i).getBoundingClientRect(); return { x: r.x + r.width - 40, y: r.y + r.height / 2 } }, id)
  const inv = await at('menu-inventory-btn')
  await page.mouse.move(inv.x, inv.y)
  expect(await page.evaluate(() => document.getElementById('menu-inventory-btn').classList.contains('nav-hover'))).toBe(true)
  const badge = await at('menu-player-badge')
  await page.mouse.move(badge.x, badge.y)
  expect(await page.evaluate(() => [document.getElementById('menu-player-badge').classList.contains('nav-hover'), document.getElementById('menu-inventory-btn').classList.contains('nav-hover')])).toEqual([true, false])

  const widths = await page.evaluate(() => ['market-item-filter-btn', 'market-rarity-filter-btn'].map((id) => document.getElementById(id).getBoundingClientRect().width))
  for (const w of widths) expect(w).toBeLessThan(160)

  await page.evaluate(() => window.__game._closeAllMenuPanels())
  const bg = await page.evaluate(() => {
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.className = 'audio-checkbox'
    cb.checked = true
    document.body.appendChild(cb)
    const img = getComputedStyle(cb).backgroundImage
    cb.remove()
    return img
  })
  expect(bg).toContain('svg')
})
