import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'
import { DEVICE_ONLY_KEYS } from '../src/game/CloudMerge.js'

// Every menu panel, and every tab inside one, is the same height (Gaymi,
// 2026-10-04: "dont make the panel behind change sizes" - Achievements'
// Deathmatch tab shrank the Old theme's paper). See --panel-chrome in
// style.css. Checked in both themes.
for (const theme of ['old', 'clean']) {
  test(`every panel and tab is the same height and never scrolls sideways (${theme} theme)`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1010 })
    await gotoAndWaitForGame(page)

    const heights = await page.evaluate(async (theme) => {
      document.documentElement.classList.toggle('ui-theme-old', theme === 'old')
      document.documentElement.classList.toggle('ui-theme-clean', theme === 'clean')
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

// Golden was deleted (2026-10-23): a saved 'golden' opens on Clean, and
// Clean's colour (Inventory > Theme) applies live from a typed hex code,
// flips the text to white on a dark colour, is saved, and survives a reload
// from the first paint. Clean has no rain or background photo.
test('Clean theme: Golden saves land on it; the colour picker works', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1')
      localStorage.setItem('gayz-settings', JSON.stringify({ uiTheme: 'golden' }))
    }
  })
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const root = document.documentElement
    const out = { theme: g.settings.uiTheme, clean: root.classList.contains('ui-theme-clean'), old: root.classList.contains('ui-theme-old') }
    out.rain = getComputedStyle(document.getElementById('menu-bg-rain')).display
    out.photo = getComputedStyle(document.getElementById('menu-bg-photo')).display
    out.hexBox = document.querySelectorAll('#theme-clean-hex').length
    const swatch = document.getElementById('theme-clean-color')
    swatch.value = '#1a2b3c'
    swatch.dispatchEvent(new Event('input'))
    swatch.dispatchEvent(new Event('change'))
    out.bg = getComputedStyle(document.body).backgroundColor
    out.fg = getComputedStyle(root).getPropertyValue('--clean-fg').trim()
    out.saved = JSON.parse(localStorage.getItem('gayz-settings')).cleanColor
    // Yellow's text is its opposite, purple (dark enough to read).
    swatch.value = '#ffff00'
    swatch.dispatchEvent(new Event('input'))
    out.yellowInk = getComputedStyle(root).getPropertyValue('--clean-fg').trim()
    swatch.value = '#1a2b3c'
    swatch.dispatchEvent(new Event('change'))
    return out
  })
  // A dark blue's opposite is a light orange.
  expect(r).toMatchObject({ theme: 'clean', clean: true, old: false, rain: 'none', photo: 'none', hexBox: 0, bg: 'rgb(26, 43, 60)', fg: 'rgb(233, 190, 165)', saved: '#1a2b3c', yellowInk: 'rgb(95, 0, 163)' })
  await page.reload()
  await page.waitForFunction(() => window.__game)
  // The first paint already has the opposite-colour text (gayz-clean-vars).
  await page.waitForFunction(() => document.documentElement.classList.contains('ui-theme-clean'))
  const after = await page.evaluate(() => [document.documentElement.className, getComputedStyle(document.body).backgroundColor, document.documentElement.style.getPropertyValue('--clean-fg')])
  expect(after[0]).toContain('ui-theme-clean')
  expect(after[1]).toBe('rgb(26, 43, 60)')
  expect(after[2]).toBe('rgb(233, 190, 165)')
  // Picking Old switches straight back.
  const old = await page.evaluate(() => {
    document.getElementById('theme-picker-old').click()
    return [window.__game.settings.uiTheme, document.documentElement.classList.contains('ui-theme-old'), document.documentElement.classList.contains('ui-theme-clean')]
  })
  expect(old).toEqual(['old', true, false])
})

// Clean's Upload picture: the file is cut to the screen's shape, shown
// behind the homepage (Clean only), kept off Cloud Save, and removable.
test('Clean theme: a homepage picture can be uploaded and removed', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 900
    canvas.height = 900
    canvas.getContext('2d').fillRect(0, 0, 900, 900)
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'pic.png', { type: 'image/png' }))
    const input = document.getElementById('theme-clean-bg-file')
    input.files = dt.files
    input.dispatchEvent(new Event('change'))
    for (let i = 0; i < 40 && !localStorage.getItem('gayz-clean-bg-image'); i++) await new Promise((res) => setTimeout(res, 50))
    const img = new Image()
    img.src = localStorage.getItem('gayz-clean-bg-image')
    await img.decode()
    const out = {
      theme: window.__game.settings.uiTheme,
      shape: Math.abs(img.width / img.height - innerWidth / innerHeight) < 0.02,
      shown: getComputedStyle(document.getElementById('menu-bg')).backgroundImage.startsWith('url("data:image/jpeg'),
    }
    document.getElementById('theme-clean-bg-clear').click()
    out.gone = localStorage.getItem('gayz-clean-bg-image') === null && getComputedStyle(document.getElementById('menu-bg')).backgroundImage === 'none, none'
    return out
  })
  expect(r).toEqual({ theme: 'clean', shape: true, shown: true, gone: true })
  // Too big for Cloud Save: kept on this device only.
  expect(DEVICE_ONLY_KEYS.has('gayz-clean-bg-image')).toBe(true)
})

// Bottom-link drop-downs (FooterMenus.js): pointing at a link opens its
// sections above the links; clicking one opens that page at that section.
test('bottom links show a drop-down of their sections', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.hover('#terms-btn')
  const menu = page.locator('#footer-menu')
  await expect(menu).toHaveClass(/open/)
  await expect(menu.locator('.footer-menu-title')).toHaveText('Terms of Use')
  await expect(menu.locator('.footer-menu-sections button')).toHaveCount(await page.locator('#terms-content h3').count())
  await page.hover('#nav-howtoplay-link')
  await expect(menu.locator('.footer-menu-title')).toHaveText('How to Play')
  await page.hover('#nav-designskin-link')
  await expect(menu).not.toHaveClass(/open/)
  await page.hover('#terms-btn')
  await menu.locator('.footer-menu-sections button').nth(5).click()
  await expect(menu).not.toHaveClass(/open/)
  await expect(page.locator('#terms-panel')).toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const h = document.querySelectorAll('#terms-content h3')[5]
    return Math.abs(h.getBoundingClientRect().top - h.closest('#terms-content').getBoundingClientRect().top)
  })).toBeLessThan(40)
})

// The picked tab stays filled while the pointer is on it (Clean's hover
// colour used to win and grey it out).
test('Clean theme: the picked tab stays filled under the pointer', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('gayz-settings', JSON.stringify({ uiTheme: 'clean', cleanColor: '#f5f5f7' })))
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game._openHubPanel())
  const tab = page.locator('#hub-panel button.active:visible').first()
  const before = await tab.evaluate((b) => getComputedStyle(b).backgroundColor)
  await tab.hover()
  expect(await tab.evaluate((b) => [b.matches(':hover'), getComputedStyle(b).backgroundColor])).toEqual([true, before])
})

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

// Signed-out Profile (2026-10-23): no Sign Up / Login choice any more -
// one full-width "Login with ..." button per sign-in, each calling
// _handleCloudSignIn with its site, the last one used tagged "Last used".
// No "or" line or terms line.
test('signed-out Profile shows Google and the other sign-ins', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('gayz-last-sign-in', 'github'))
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const picked = []
    g._handleCloudSignIn = (provider) => { picked.push(provider) }
    await g._openProfilePanel()
    const out = { gate: getComputedStyle(document.getElementById('profile-login-gate')).display }
    out.title = document.getElementById('profile-panel-title').textContent
    out.sub = document.getElementById('auth-sub').textContent
    out.google = document.getElementById('auth-google-label').textContent
    out.more = document.querySelectorAll('#auth-more-label, .auth-divider').length
    out.lastUsed = [...document.querySelectorAll('.auth-last-used')].map((e) => [e.closest('[data-provider]').dataset.provider, e.textContent])
    out.oldPages = document.querySelectorAll('#auth-view-choose, #auth-view-signup, #auth-view-login, #profile-gate-login-btn').length
    out.terms = document.querySelectorAll('#auth-terms').length
    const googleWidth = document.getElementById('auth-google-btn').getBoundingClientRect().width
    out.logos = [...document.querySelectorAll('.auth-provider')].map((b) => [b.dataset.provider, b.querySelector('span').textContent.trim(), Math.abs(b.getBoundingClientRect().width - googleWidth) < 1])
    document.getElementById('auth-google-btn').click()
    for (const b of document.querySelectorAll('.auth-provider')) b.click()
    out.picked = picked
    // Signed in: the title goes back to Profile.
    Object.defineProperty(g, '_cloudUid', { get: () => 'test-uid', configurable: true })
    await g._openProfilePanel()
    out.signedInTitle = document.getElementById('profile-panel-title').textContent
    out.signedInGate = getComputedStyle(document.getElementById('profile-login-gate')).display
    return out
  })
  expect(r.gate).toBe('flex')
  expect(r.title).toBe('Welcome to GayZ')
  expect(r.sub).toBe('Login to avoid losing progress')
  expect(r.google).toBe('Login with Google')
  expect(r.more).toBe(0)
  expect(r.lastUsed).toEqual([['github', 'Last used']])
  expect(r.oldPages).toBe(0)
  expect(r.terms).toBe(0)
  expect(r.logos).toEqual([
    ['steam', 'Login with Steam', true], ['github', 'Login with GitHub', true], ['discord', 'Login with Discord', true],
  ])
  expect(r.picked).toEqual(['google', 'steam', 'github', 'discord'])
  expect(r.signedInTitle).toBe('Profile')
  expect(r.signedInGate).toBe('none')
})

// Cloud Save is a section of General's General tab (2026-10-23), not its
// own popup: the quick-cloud icon and the sign-in "which save?" question
// both open General there, and Escape closes it.
test('Cloud Save lives on the General tab', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = { oldPanel: document.querySelectorAll('#cloudsave-panel').length }
    document.getElementById('quick-cloud-btn').click()
    await g._authReadyPromise
    await new Promise((res) => setTimeout(res, 50))
    const section = document.getElementById('cloudsave-section')
    out.inGeneral = !!section.closest('#general-page-general')
    out.generalOpen = getComputedStyle(g.clanPanel).display
    out.visible = section.offsetParent !== null
    // No 'Cloud Save' heading or 'Sign in to sync...' line (2026-10-23).
    out.title = document.querySelectorAll('#cloudsave-panel-title, #cloudsave-signed-out-desc').length
    out.signedOutShown = getComputedStyle(document.getElementById('cloudsave-signed-out')).display
    // Clan tab hides it; General tab shows it again.
    document.getElementById('general-tab-clan').click()
    out.hiddenOnClan = section.offsetParent === null
    document.getElementById('general-tab-general').click()
    out.backOnGeneral = section.offsetParent !== null
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }))
    out.closedByEscape = getComputedStyle(g.clanPanel).display
    return out
  })
  expect(r.oldPanel).toBe(0)
  expect(r.inGeneral).toBe(true)
  expect(r.generalOpen).toBe('flex')
  expect(r.visible).toBe(true)
  expect(r.title).toBe(0)
  expect(r.signedOutShown).toBe('flex')
  expect(r.hiddenOnClan).toBe(true)
  expect(r.backOnGeneral).toBe(true)
  expect(r.closedByEscape).toBe('none')
})

// Every "Sign up or login to use..." button (Friend List, Global chat, Cloud
// Save, Clans, Market, Gallery) opens the Welcome to GayZ page instead of a
// sign-in popup directly (2026-10-10; Market/Gallery 2026-10-23), and a
// friend list shows its count.
test('sign-in buttons go to the Welcome page; friend count shows', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    let popups = 0
    g._handleCloudSignIn = () => { popups++ }
    const out = {}
    await g._openMarketPanel()
    await g._authReadyPromise
    await new Promise((res) => setTimeout(res, 50))
    out.marketBar = [!document.getElementById('market-signed-out').hidden, document.getElementById('market-signin-btn').textContent]
    g._closeAllMenuPanels()
    for (const id of ['friends-signin-btn', 'server-chat-signin-btn', 'cloudsave-signin-btn', 'clan-signin-btn', 'market-signin-btn', 'gallery-signin-btn']) {
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
  for (const id of ['friends-signin-btn', 'server-chat-signin-btn', 'cloudsave-signin-btn', 'clan-signin-btn', 'market-signin-btn', 'gallery-signin-btn']) {
    expect(r[id]).toEqual(['flex', 'Welcome to GayZ'])
  }
  expect(r.marketBar).toEqual([true, 'Sign up or login to use...'])
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
  expect(levels.text).toMatch(/^Level \d+ .*XP/)

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

// Patch Notes go live at 12am on each player's own clock, and the What's
// New card (top-right corner) never shows a version What's New hasn't got.
test('Patch Notes follow the player\'s clock and the What\'s New card matches them', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const label = (d) => `${M[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
    const today = new Date()
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
    const entry = (v, d) => `<div class="changelog-entry"><span class="changelog-date">${v} · ${label(d)}</span><div class="changelog-text"><ul><li>${v} notes</li></ul></div></div>`
    const list = document.getElementById('changelog-list')
    const freshHtml = `<div id="changelog-list">${entry('v9.02', tomorrow)}${entry('v9.01', today)}${list.innerHTML}</div>`
    // A newer build is out: its notes come from the fresh page.
    const realFetch = window.fetch
    window.fetch = async (url) => {
      if (String(url).includes('version.json')) return new Response(JSON.stringify({ id: 'test-build' }))
      if (String(url).includes('index.html')) return new Response(`<html><body>${freshHtml}</body></html>`)
      return realFetch(url)
    }
    g.settings.lastSeenBuildId = ''
    await g._checkForUpdate()
    window.fetch = realFetch
    const visible = [...list.querySelectorAll('.changelog-entry')].filter((el) => getComputedStyle(el).display !== 'none')
    const banner = document.getElementById('update-available-banner')
    const box = banner.getBoundingClientRect()
    return {
      listNewest: visible[0]?.querySelector('.changelog-date')?.textContent || '',
      tomorrowHidden: [...list.querySelectorAll('.changelog-entry')].some((el) => el.textContent.includes('v9.02') && getComputedStyle(el).display === 'none'),
      bannerShows: document.getElementById('update-available-changelog').textContent,
      top: box.top,
      rightGap: window.innerWidth - box.right,
    }
  })
  expect(r.listNewest).toContain('v9.01')
  expect(r.tomorrowHidden).toBe(true)
  expect(r.bannerShows).toContain('v9.01')
  expect(r.bannerShows).not.toContain('v9.02')
  expect(r.top).toBeLessThan(30)
  expect(r.rightGap).toBeLessThan(30)
})

// Shop (2026-10-23): GaygarX costs 500 Gems and sells back for 250, so
// buying and selling can't make Gems; Try On dresses the homepage
// character and Back to Shop puts the old skin back.
test('Shop: GaygarX price, Try On, buying', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const wait = (ms) => new Promise((res) => setTimeout(res, ms))
    g.ownsShopSkin = false
    g.gems = 499
    g._openShopPanel()
    await wait(300)
    const price = document.getElementById('shop-skin-price-amount').textContent
    const shortBuy = g.shopSkinBuyBtn.disabled
    const before = g.settings.customSkinDataUrl
    document.getElementById('shop-skin-tryon-btn').click()
    await wait(300)
    const trying = g._shopTryOn && g.shopPanel.style.display === 'none' && getComputedStyle(document.getElementById('shop-tryon-bar')).display === 'flex'
    document.getElementById('shop-tryon-back-btn').click()
    await wait(300)
    const back = !g._shopTryOn && g.shopPanel.style.display === 'flex' && g.settings.customSkinDataUrl === before
    g.gems = 500
    g._renderShopSkinState()
    window.confirm = () => true
    g.shopSkinBuyBtn.click()
    await wait(100)
    const confetti = document.querySelectorAll('.shop-confetti').length
    return { price, shortBuy, trying, back, gems: g.gems, owns: g.ownsShopSkin, confetti, tryOnHidden: document.getElementById('shop-skin-tryon-btn').style.display === 'none' }
  })
  const { INVENTORY_SKINS } = await import('../src/game/InventorySkins.js')
  expect(r.price).toBe('500')
  expect(r.shortBuy).toBe(true)
  expect(r.trying).toBe(true)
  expect(r.back).toBe(true)
  expect(r.gems).toBe(0)
  expect(r.owns).toBe(true)
  expect(r.confetti).toBeGreaterThan(0)
  expect(r.tryOnHidden).toBe(true)
  expect(INVENTORY_SKINS.find((s) => s.id === 'gaygarx').sell.amount).toBe(250)
})
