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
  // A dark blue's opposite is a light orange. The page is the colour a
  // shade toward the text (white -> light grey, like apple.com).
  expect(r).toMatchObject({ theme: 'clean', clean: true, old: false, rain: 'none', photo: 'none', hexBox: 0, bg: 'rgb(34, 49, 64)', fg: 'rgb(233, 190, 165)', saved: '#1a2b3c', yellowInk: 'rgb(95, 0, 163)' })
  await page.reload()
  await page.waitForFunction(() => window.__game)
  // The first paint already has the opposite-colour text (gayz-clean-vars).
  await page.waitForFunction(() => document.documentElement.classList.contains('ui-theme-clean'))
  const after = await page.evaluate(() => [document.documentElement.className, getComputedStyle(document.body).backgroundColor, document.documentElement.style.getPropertyValue('--clean-fg')])
  expect(after[0]).toContain('ui-theme-clean')
  expect(after[1]).toBe('rgb(34, 49, 64)')
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
  // A real file pick: the bin icon shows straight away.
  await page.evaluate(() => { window.__game._toggleSettings(true); document.getElementById('tab-theme').click() })
  await page.setInputFiles('#theme-clean-bg-file', { name: 'p.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') })
  await expect(page.locator('#theme-clean-bg-clear')).toBeVisible({ timeout: 3000 })
  // Too big for Cloud Save: kept on this device only.
  expect(DEVICE_ONLY_KEYS.has('gayz-clean-bg-image')).toBe(true)
})

// Theme is its own Settings tab after Graphics (2026-10-26; it was in
// General) and Inventory has a Pets tab after Weapons (2026-10-24). Every dark/gold box from before - the
// weapon cards, Inspect, the Market dropdowns, the Status list - follows
// the Simple colour.
test('Theme is a Settings tab, Inventory has Pets, and the menus follow Simple', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    out.inventoryTabs = [...document.querySelectorAll('.inventory-tab')].map((b) => b.dataset.inventoryPage)
    out.themeInSettings = !!document.getElementById('theme-picker-grid').closest('#settings-panel #settings-page-theme')
    out.settingsTabs = [...document.querySelectorAll('.settings-tab')].map((b) => b.dataset.page)
    g._openClanPanel()
    out.generalOpensOn = [...g.clanPanel.querySelectorAll('.general-tab-page')].filter((p) => p.style.display !== 'none').map((p) => p.id)
    g._toggleSettings(true)
    document.getElementById('tab-theme').click()
    out.afterClick = [...document.querySelectorAll('.settings-page')].filter((p) => p.style.display !== 'none').map((p) => p.id)
    out.friendsPageKept = document.getElementById('general-page-friends').style.display !== 'none'
    document.getElementById('theme-picker-clean').click()
    out.marketItems = g._marketItemOptions().map((i) => i.id).slice(-1)
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--clean-bg').trim()
    const surface = getComputedStyle(document.documentElement).getPropertyValue('--clean-surface').trim()
    const hex = (h) => `rgb(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')})`
    g._openMenuInventoryPanel()
    document.getElementById('inventory-tab-weapons').click()
    await new Promise((res) => setTimeout(res, 300))
    const card = document.querySelector('#inventory-weapons-list .inv-weapon-card')
    out.cardMatches = getComputedStyle(card).backgroundImage.includes(surface)
    out.cardName = getComputedStyle(card.querySelector('.inv-skin-card-name')).color === getComputedStyle(document.documentElement).getPropertyValue('--clean-fg').trim()
    out.inspectBox = getComputedStyle(document.getElementById('inspect-box')).backgroundColor === hex(bg)
    out.marketMenu = getComputedStyle(document.getElementById('market-item-filter-menu')).backgroundColor === hex(bg)
    out.statusList = getComputedStyle(document.getElementById('status-picker-options')).backgroundColor === hex(bg)
    out.tradeBox = getComputedStyle(document.getElementById('trade-dialog-box')).backgroundColor === hex(bg)
    return out
  })
  expect(r).toEqual({
    inventoryTabs: ['character', 'crates', 'weapons', 'pets', 'cosmetics'],
    themeInSettings: true,
    settingsTabs: ['general', 'language', 'audio', 'controls', 'graphics', 'theme'],
    generalOpensOn: ['general-page-general'],
    afterClick: ['settings-page-theme'],
    friendsPageKept: true,
    marketItems: ['pets'],
    cardMatches: true,
    cardName: true,
    inspectBox: true,
    marketMenu: true,
    statusList: true,
    tradeBox: true,
  })
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
  // With a page open, pointing at a link does nothing (2026-10-24): no
  // card, no dimming, the page stays; a click opens the other page.
  await page.evaluate(() => window.__game._openQuestsPanel?.() ?? document.getElementById('quests-btn').click())
  await expect(page.locator('#quests-panel')).toBeVisible()
  await page.hover('#nav-privacy-link')
  await page.waitForTimeout(250)
  await expect(menu).not.toHaveClass(/open/)
  await expect(page.locator('#quests-panel')).toBeVisible()
  await page.click('#nav-privacy-link')
  await expect(page.locator('#privacy-panel')).toBeVisible()
  await expect(page.locator('#quests-panel')).toBeHidden()
})

// The right column, Game Mode and Settings get the same menus (to the side),
// and while a panel is open only the button that opened it stays lit.
// Since 2026-10-24 nothing on the right column fades while a panel is open.
test('homepage buttons show their tabs; the right column stays lit over a panel', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await gotoAndWaitForGame(page)
  const menu = page.locator('#footer-menu')
  await page.hover('#settings-btn')
  await expect(menu).toHaveAttribute('data-place', 'beside')
  await expect(menu.locator('.footer-menu-sections button')).toHaveText(['General', 'Language', 'Audio', 'Controls', 'Graphics', 'Theme'])
  await page.hover('#play-btn')
  await expect(menu).not.toHaveClass(/open/)
  await page.hover('#hub-btn')
  await expect(menu).toHaveAttribute('data-place', 'side')
  await expect(menu.locator('.footer-menu-sections button')).toHaveText(['Leaderboard'])
  await page.hover('#settings-btn')
  await menu.locator('.footer-menu-sections button', { hasText: 'Theme' }).click()
  await expect(page).toHaveURL(/\/settings\/theme$/)
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('menu-panel-open'))).toBe(true)
  expect(await page.evaluate(() => [...document.querySelectorAll('#menu-nav-buttons > button, #menu-player-badge')].filter((b) => b.offsetParent && getComputedStyle(b).opacity !== '1').map((b) => b.id))).toEqual([])
  await page.evaluate(() => window.__game._closeAllMenuPanels())
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('menu-panel-open'))).toBe(false)
})

// Simple (was Clean): every homepage box is the picked colour with the text
// colour for words, on a page a shade darker (2026-10-24, like apple.com:
// white boxes on light grey); the picture buttons are icons.
test('Simple theme: homepage boxes are the picked colour on a darker page', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('gayz-settings', JSON.stringify({ uiTheme: 'clean', cleanColor: '#80ab30' })))
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(() => {
    const fg = getComputedStyle(document.documentElement).getPropertyValue('--clean-fg').trim()
    const boxes = ['play-btn', 'store-btn', 'gamemode-btn', 'settings-btn', 'menu-player-badge', 'menu-currency-bar', 'homepage-clock']
      .map((id) => [getComputedStyle(document.getElementById(id)).backgroundColor, getComputedStyle(document.getElementById(id)).color === fg])
    const badge = document.getElementById('menu-player-badge').getBoundingClientRect()
    const general = document.getElementById('hub-btn').getBoundingClientRect()
    return { boxes, page: getComputedStyle(document.body).backgroundColor, gap: general.top - badge.bottom, name: document.getElementById('theme-picker-clean-label').textContent, icons: ['theme-clean-bg-btn', 'theme-clean-bg-clear'].map((id) => [document.getElementById(id).textContent.trim(), !!document.querySelector(`#${id} svg`)]) }
  })
  for (const b of r.boxes) expect(b).toEqual(['rgb(128, 171, 48)', true])
  expect(r.page).not.toBe('rgb(128, 171, 48)')
  // The profile card no longer sits on top of General.
  expect(r.gap).toBeGreaterThan(0)
  expect(r.name).toBe('Simple')
  expect(r.icons).toEqual([['', true], ['', true]])
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
    g._openClanPanel()
    await g._authReadyPromise
    await new Promise((res) => setTimeout(res, 50))
    const section = document.getElementById('cloudsave-section')
    out.inGeneral = !!section.closest('#general-page-general')
    out.generalOpen = getComputedStyle(g.clanPanel).display
    out.visible = section.offsetParent !== null
    // No 'Cloud Save' heading, 'Sign in to sync...' line or sign-in button
    // while signed out (2026-10-23).
    out.title = document.querySelectorAll('#cloudsave-panel-title, #cloudsave-signed-out-desc').length
    out.signedOutShown = getComputedStyle(document.getElementById('cloudsave-signed-out')).display
    // Clan moved to Friendship (2026-10-24): General's tabs are
    // Leaderboard and Theme, and Friendship has Friend List and Clan.
    out.generalTabs = [...g.clanPanel.querySelectorAll('.general-tab')].map((b) => b.id)
    g._openFriendsPanel()
    await new Promise((res) => setTimeout(res, 50))
    out.friendsTitle = document.getElementById('friends-panel-title').textContent
    out.friendsBtn = g.friendsBtn.querySelector('span').textContent
    out.clanInFriends = !!document.getElementById('clan-subtabs').closest('#friends-panel')
    out.friendsTabs = [...g.friendsPanel.querySelectorAll('.general-tab')].map((b) => b.id)
    document.getElementById('friends-tab-clan').click()
    out.clanShown = document.getElementById('clan-subtabs').offsetParent !== null
    out.friendsHidden = document.getElementById('general-page-friends').offsetParent === null
    g._openClanPanel()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }))
    out.closedByEscape = getComputedStyle(g.clanPanel).display
    return out
  })
  expect(r.oldPanel).toBe(0)
  expect(r.inGeneral).toBe(true)
  expect(r.generalOpen).toBe('flex')
  expect(r.visible).toBe(true)
  expect(r.title).toBe(0)
  expect(r.signedOutShown).toBe('none')
  expect(r.generalTabs).toEqual(['general-tab-general'])
  expect(r.friendsTitle).toBe('Friendship')
  expect(r.friendsBtn).toBe('Friendship')
  expect(r.clanInFriends).toBe(true)
  expect(r.friendsTabs).toEqual(['friends-tab-friends', 'friends-tab-clan'])
  expect(r.clanShown).toBe(true)
  expect(r.friendsHidden).toBe(true)
  expect(r.closedByEscape).toBe('none')
})

// Every "Sign up or login to use ..." button (Friend List, Global chat,
// Clans, Market, Gallery, and the cloud icon while signed out) opens the Welcome to GayZ page instead of a
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
    out.words = ['friends-signin-btn', 'server-chat-signin-btn', 'clan-signin-btn', 'gallery-signin-btn'].map((id) => document.getElementById(id).textContent)
    for (const id of ['friends-signin-btn', 'server-chat-signin-btn', 'clan-signin-btn', 'market-signin-btn', 'gallery-signin-btn', 'quick-cloud-btn']) {
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
  // The cloud icon too, while signed out (General has no sign-in now).
  for (const id of ['friends-signin-btn', 'server-chat-signin-btn', 'clan-signin-btn', 'market-signin-btn', 'gallery-signin-btn', 'quick-cloud-btn']) {
    expect(r[id]).toEqual(['flex', 'Welcome to GayZ'])
  }
  // Each says what it's for (2026-10-23).
  expect(r.marketBar).toEqual([true, 'Sign up or login to use the Market'])
  expect(r.words).toEqual(['Sign up or login to use friends', 'Sign up or login to use chat', 'Sign up or login to use clans', 'Sign up or login to use the Gallery'])
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
    const status = document.getElementById('friends-two-col')
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
// buying and selling can't make Gems. Since 2026-10-24 its button is
// Inspect (was Try On): GaygarX big in the Inspect window, even unowned.
test('Shop: GaygarX price, Inspect, buying', async ({ page }) => {
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
    const label = document.getElementById('shop-skin-tryon-btn').textContent
    document.getElementById('shop-skin-tryon-btn').click()
    await wait(300)
    const inspect = document.getElementById('inspect-dialog').style.display === 'flex' && document.getElementById('inspect-title').textContent.includes('GaygarX') && g.shopPanel.style.display === 'flex'
    g._closeInspectDialog()
    const spinning = g._shopSkinAvatar3D.spinSpeed > 0.5
    g.gems = 500
    g._renderShopSkinState()
    window.confirm = () => true
    g.shopSkinBuyBtn.click()
    await wait(100)
    const confetti = document.querySelectorAll('.shop-confetti').length
    return { price, shortBuy, label, inspect, spinning, gems: g.gems, owns: g.ownsShopSkin, confetti }
  })
  const { INVENTORY_SKINS } = await import('../src/game/InventorySkins.js')
  expect(r.price).toBe('500')
  expect(r.shortBuy).toBe(true)
  expect(r.label).toBe('Inspect')
  expect(r.inspect).toBe(true)
  expect(r.spinning).toBe(true)
  expect(r.gems).toBe(0)
  expect(r.owns).toBe(true)
  expect(r.confetti).toBeGreaterThan(0)
  expect(INVENTORY_SKINS.find((s) => s.id === 'gaygarx').sell.amount).toBe(250)
})

// 2026-10-24: right-column number badges, leaderboard rows that open a
// player's profile, no account row on General, Terms/Privacy without the
// disclaimer and with a build-dated "Last updated", the clan list preloaded.
test('number badges, clickable leaderboard, General without account row, legal pages', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    // Two finished quests waiting to be claimed (and both unseen - the
    // finished number wins, the new-quests circle stays hidden).
    g.rollingQuests.activeQuests = () => [1, 2].map((spawnedAt) => ({ spawnedAt, progress: 5, template: { target: 5 } }))
    g._updateQuestsDot()
    const claim = document.getElementById('quests-claim-dot')
    out.quest = [claim.style.display, claim.textContent, document.getElementById('quests-new-dot').style.display]
    // A circle with the number; pointing at the button changes nothing
    // (2026-10-31) - checked below with a real hover.
    const questsLabel = document.querySelector('#quests-btn > span:not(.nav-badge-dot)')
    out.questLabel = getComputedStyle(questsLabel, '::after').content
    out.circleShown = claim.getClientRects().length > 0
    out.account = ['cloudsave-avatar', 'cloudsave-account-name', 'cloudsave-sync-now-btn', 'cloudsave-signout-btn'].map((id) => !!document.getElementById(id))
    out.conflict = !!document.getElementById('cloudsave-conflict')
    g._cloudUid = 'me-uid'
    g._renderLeaderboardRows([{ uid: 'a', name: 'Tazbot', bestNight: 9, bestKills: 217 }, { uid: 'me-uid', name: 'Me', bestNight: 4, bestKills: 5 }])
    const rows = [...document.querySelectorAll('#cloudsave-leaderboard-list .lb-row:not(.lb-head)')]
    out.rows = rows.map((row) => [row.querySelector('.lb-rank').textContent, row.classList.contains('me'), [...row.querySelectorAll('.lb-stat')].map((s) => s.textContent)])
    let opened = null
    g._openOtherPlayerProfile = (uid, name) => { opened = [uid, name] }
    rows[0].querySelector('.lb-name-link').click()
    out.opened = opened
    g._openTermsPanel()
    out.notes = document.querySelectorAll('.legal-note').length
    out.updated = document.querySelector('#terms-content .legal-updated').textContent
    out.clanLoaded = await Promise.race([g._fetchClanRanking().then(() => true), new Promise((res) => setTimeout(() => res('slow'), 8000))])
    return out
  })
  expect(r.quest).toEqual(['', '2', 'none'])
  expect(r.questLabel).toBe('none')
  expect(r.circleShown).toBe(true)
  expect(r.account).toEqual([false, false, false, false])
  expect(r.conflict).toBe(true)
  expect(r.rows).toEqual([['1', false, ['9', '217']], ['2', true, ['4', '5']]])
  expect(r.opened).toEqual(['a', 'Tazbot'])
  expect(r.notes).toBe(0)
  expect(r.updated).toMatch(/^Last updated: [A-Z][a-z]+ \d{1,2}, 20\d\d$/)
  expect(r.clanLoaded).toBe(true)
  // Pointing at Quests changes nothing: the circle stays, no "(2)".
  await page.evaluate(() => {
    for (const id of ['terms-panel', 'privacy-panel']) document.getElementById(id)?.querySelector('.panel-close-btn')?.click()
  })
  await page.hover('#quests-btn')
  const hover = await page.evaluate(() => ({
    label: getComputedStyle(document.querySelector('#quests-btn > span:not(.nav-badge-dot)'), '::after').content,
    circle: document.getElementById('quests-claim-dot').getClientRects().length > 0,
  }))
  expect(hover).toEqual({ label: 'none', circle: true })
})

// 2026-10-30: Lock sits between Sell and Inspect in the Inventory's card
// menu. A locked card shows a lock on its corner and can't be sold or put
// on the Market until it's unlocked; it stays locked through a reload.
test('Inventory: Lock keeps a skin from being sold or listed', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const wait = (ms) => new Promise((res) => setTimeout(res, ms))
    g.ownsShopSkin = true
    document.getElementById('menu-inventory-btn').click()
    await wait(300)
    g._renderInventorySkins()
    const card = () => document.querySelector('[data-inventory-skin="gaygarx"]')
    const out = {}
    card().click()
    out.order = [...document.querySelectorAll('#inv-skin-menu button')].map((b) => b.id.replace('inv-skin-menu-', ''))
    out.lockLabel = g.invSkinMenuLock.textContent
    out.sellOpenBefore = !g.invSkinMenuSell.classList.contains('locked')
    g.invSkinMenuLock.click()
    await wait(50)
    out.saved = g.settings.lockedSkins.includes('character:gaygarx')
    out.icon = !!card().querySelector('.inv-skin-card-lock') && card().classList.contains('locked')
    card().click()
    out.unlockLabel = g.invSkinMenuLock.textContent
    out.sellLocked = g.invSkinMenuSell.classList.contains('locked') && g.invSkinMenuMarket.classList.contains('locked')
    g.invSkinMenuSell.click()
    out.noSellDialog = document.getElementById('trade-dialog')?.style.display !== 'flex'
    card().click()
    g.invSkinMenuLock.click()
    await wait(50)
    out.unlocked = !g.settings.lockedSkins.includes('character:gaygarx') && !card().querySelector('.inv-skin-card-lock')
    return out
  })
  expect(r).toEqual({
    order: ['equip', 'market', 'sell', 'lock', 'inspect'],
    lockLabel: 'Lock', sellOpenBefore: true, saved: true, icon: true, unlockLabel: 'Unlock', sellLocked: true, noSellDialog: true, unlocked: true,
  })
})

// 2026-10-31: homepage extras (HomeExtras.js) - corner cards or one Today
// panel (Settings > General > Homepage), Continue / New here? tags on
// Play, a tap on your character plays an emote, December snow.
test('homepage extras: cards, Today panel, Play tags, emote', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const wait = (ms) => new Promise((res) => setTimeout(res, ms))
    const out = {}
    g.careerStats.xp = 600
    g.runHistory = [{ night: 7, kills: 43, ts: Date.now() }]
    g.bestStats.bestWave = 12
    g._homeTop3 = [{ name: '<b>x</b>', wave: 20 }]
    g._renderHomeExtras()
    const text = (id) => document.getElementById(id).textContent
    out.left = text('home-extras-left')
    out.right = text('home-extras-right')
    out.escaped = !document.querySelector('#home-extras-right .home-x-top3 b')
    // Nothing in the corners covers the character, the nav or the links.
    const box = (sel) => document.querySelector(sel).getBoundingClientRect()
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    const visibleCards = [...document.querySelectorAll('.home-extras > *')].filter((c) => c.getClientRects().length)
    out.cards = visibleCards.length
    out.overlaps = visibleCards.filter((c) => ['#menu-nav-buttons', '#setup-avatar-wrap', '#menu-links-row', '#play-btn'].some((s) => document.querySelector(s) && hit(c.getBoundingClientRect(), box(s)))).length
    // The Today panel layout.
    g.homeExtrasLayoutSelect.value = 'panel'
    g.homeExtrasLayoutSelect.dispatchEvent(new Event('change'))
    out.panelCorner = text('home-extras-right')
    out.leftEmpty = document.getElementById('home-extras-left').children.length
    document.getElementById('home-today-btn').click()
    await wait(100)
    out.panelOpen = getComputedStyle(document.getElementById('today-panel')).display
    out.panelCards = document.querySelectorAll('#today-panel-list .home-x-card').length
    document.querySelector('#today-panel .panel-close-btn').click()
    out.panelClosed = getComputedStyle(document.getElementById('today-panel')).display
    g.homeExtrasLayoutSelect.value = 'cards'
    g.homeExtrasLayoutSelect.dispatchEvent(new Event('change'))
    // New here? with no runs; Continue once a run is saved.
    g.careerStats.totalRuns = 0
    localStorage.removeItem('gayz-play-saved-run')
    g._renderHomeExtras()
    const shown = (id) => getComputedStyle(document.getElementById(id)).display !== 'none'
    out.newHere = [shown('home-newhere-tag'), shown('home-continue-tag')]
    localStorage.setItem('gayz-play-saved-run', JSON.stringify({ v: 1, wave: 6, mode: 'classic', difficulty: 'hard' }))
    g._renderHomeExtras()
    out.cont = [shown('home-newhere-tag'), shown('home-continue-tag'), document.getElementById('home-continue-tag').textContent]
    localStorage.removeItem('gayz-play-saved-run')
    // A tap on the character plays an emote.
    const avatar = g._menuAvatar3D
    avatar.onTap()
    out.emote = !!avatar._emote
    await wait(400)
    out.armMoved = Math.abs(avatar.character.limbPivots.armR.rotation.x) > 0.1
    out.holiday = document.documentElement.dataset.holiday
    return out
  })
  expect(r.left).not.toMatch(/Level/)
  expect(r.left).toMatch(/Wave 7 · 43 kills/)
  expect(r.left).toMatch(/Best: Wave 12/)
  expect(r.right).not.toMatch(/streak/i)
  expect(r.right).toMatch(/Invite a friend/)
  expect(r.escaped).toBe(true)
  expect(r.cards).toBeGreaterThan(2)
  expect(r.overlaps).toBe(0)
  expect(r.panelCorner).toMatch(/Today/)
  expect(r.leftEmpty).toBe(0)
  expect(r.panelOpen).toBe('flex')
  expect(r.panelCards).toBe(4)
  expect(r.panelClosed).toBe('none')
  expect(r.newHere).toEqual([true, false])
  expect(r.cont).toEqual([false, true, '▶ Continue Wave 6 · Hard'])
  expect(r.emote).toBe(true)
  expect(r.armMoved).toBe(true)
  const d = new Date()
  expect(r.holiday).toBe(d.getMonth() === 11 ? 'winter' : '')
})
