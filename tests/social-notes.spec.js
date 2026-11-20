import { test, expect } from '@playwright/test'

// Profile Guestbook + Message in a Bottle (SocialNotes.js, 2026-11-20),
// against an in-memory backend (game.__socialNotesBackendForTests, the
// same functions as CloudSync's Social Notes ones).
test('Social Notes: sign, report and delete guestbook lines; throw and find bottles', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 })
  await page.evaluate(() => {
    const g = window.__game
    Object.defineProperty(g, '_cloudUid', { get: () => 'me1234', set: () => {}, configurable: true })
    g.settings.nickname = 'Tester'
    localStorage.removeItem('gayz-bottles')
    const now = Date.now()
    const books = {
      other123: [
        { id: 'aaaaaa_1', fromUid: 'aaaaaa', fromNickname: '<i>Al</i>', text: 'Hi <b>there</b>', reported: false, sentAt: now - 1000 },
        { id: 'bbbbbb_1', fromUid: 'bbbbbb', fromNickname: 'Bo', text: 'hidden one', reported: true, sentAt: now - 2000 },
      ],
      me1234: [{ id: 'cccccc_1', fromUid: 'cccccc', fromNickname: 'Cy', text: 'nice profile', reported: false, sentAt: now }],
    }
    let bottles = [
      { id: 'me1234_1_1', fromUid: 'me1234', fromNickname: 'Tester', text: 'my own', rnd: 0.1, reported: false },
      { id: 'zzzzzz_1_1', fromUid: 'zzzzzz', fromNickname: 'Zed', text: 'hello sailor', rnd: 0.5, reported: false },
      { id: 'yyyyyy_1_1', fromUid: 'yyyyyy', fromNickname: 'Yo', text: 'reported', rnd: 0.6, reported: true },
    ]
    const log = { signed: [], thrown: [], reported: [], deleted: [] }
    g.__socialNotesBackendForTests = {
      async fetchGuestbook(owner) { return (books[owner] || []).map((m) => ({ ...m })) },
      async signGuestbook(owner, e) { log.signed.push({ owner, ...e }) },
      async reportGuestbookEntry(owner, id) { log.reported.push(id); books[owner].find((m) => m.id === id).reported = true },
      async deleteGuestbookEntry(owner, id) { log.deleted.push(id); books[owner] = books[owner].filter((m) => m.id !== id) },
      async throwBottle(b) { if (b.n === 1) throw new Error('taken'); log.thrown.push(b) },
      async fetchBottles(r) { return bottles.filter((b) => b.rnd >= r).sort((a, b) => a.rnd - b.rnd).map((b) => ({ ...b })) },
      async reportBottle(id) { log.reported.push(id); bottles.find((b) => b.id === id).reported = true },
      _log: log,
    }
    g._showOtherProfileLoading('Al')
    g._renderOtherProfileEntry({ uid: 'other123', name: 'Al', playerId: 'ABCDE' }, 'Al')
  })

  // Someone else's profile: guestbook loads only on click, reported lines left out, text stays text.
  await expect(page.locator('#guestbook-box')).toBeVisible()
  await expect(page.locator('#guestbook-body')).toBeHidden()
  await page.click('#guestbook-open-btn')
  await expect(page.locator('#guestbook-list .social-note-row')).toHaveCount(1)
  await expect(page.locator('#guestbook-list')).toContainText('<i>Al</i>')
  await expect(page.locator('#guestbook-list')).toContainText('Hi <b>there</b>')
  // Sign: swear filter on, capped at 100 letters.
  await page.fill('#guestbook-input', 'what the fuck ' + 'x'.repeat(200))
  await page.click('#guestbook-sign-btn')
  await expect(page.locator('#guestbook-list .social-note-row')).toHaveCount(2)
  let log = await page.evaluate(() => window.__game.__socialNotesBackendForTests._log)
  expect(log.signed[0].owner).toBe('other123')
  expect(log.signed[0].text.startsWith('what the fudge')).toBe(true)
  expect(log.signed[0].text.length).toBeLessThanOrEqual(100)
  expect(log.signed[0].day).toBe(Math.floor(Date.now() / 86400000))
  // Report hides it.
  await page.evaluate(() => document.querySelector('#guestbook-list [data-note-act="report"][data-note-id="aaaaaa_1"]').click())
  await expect(page.locator('#guestbook-list .social-note-row')).toHaveCount(1)

  // Own profile: no guestbook box there.
  await page.evaluate(() => window.__game._renderOtherProfileEntry({ uid: 'me1234', name: 'Tester' }, 'Tester'))
  await expect(page.locator('#guestbook-box')).toBeHidden()

  // Profile panel > Guestbook tab: owner can delete.
  await page.evaluate(() => { window.__game._closeOtherPlayerProfile?.(); return window.__game._openProfilePanel() })
  await page.click('#profile-tab-guestbook')
  await expect(page.locator('#my-guestbook-list .social-note-row')).toHaveCount(1)
  await page.evaluate(() => document.querySelector('#my-guestbook-list [data-note-act="delete"]').click())
  await expect(page.locator('#my-guestbook-list .social-note-row')).toHaveCount(0)
  await expect(page.locator('#my-guestbook-list')).not.toBeEmpty()

  // Bottles in the Friends panel.
  await page.evaluate(() => { window.__game._closeAllMenuPanels?.(); return window.__game._openFriendsPanel() })
  // The fake sign-in above doesn't set a cloud profile, so show the signed-in part by hand.
  await page.evaluate(() => { document.getElementById('friends-signed-in').style.display = 'flex' })
  await expect(page.locator('#bottle-left')).toContainText('3')
  await page.fill('#bottle-input', 'hello world')
  await page.click('#bottle-throw-btn')
  await expect(page.locator('#bottle-status')).not.toHaveText('')
  log = await page.evaluate(() => window.__game.__socialNotesBackendForTests._log)
  // Slot 1 was taken (another device), so slot 2 was used.
  expect(log.thrown).toHaveLength(1)
  expect(log.thrown[0]).toMatchObject({ n: 2, text: 'hello world', fromUid: 'me1234' })
  // Find: never your own, never a reported one.
  await page.evaluate(() => { Math.random = () => 0 })
  await page.click('#bottle-find-btn')
  await expect(page.locator('#bottle-list .social-note-row')).toHaveCount(1)
  await expect(page.locator('#bottle-list')).toContainText('hello sailor')
  // Same bottle isn't found twice.
  await page.click('#bottle-find-btn')
  await expect(page.locator('#bottle-list .social-note-row')).toHaveCount(1)
  // Nothing new left in the sea: no find is used up.
  await page.click('#bottle-find-btn')
  await page.click('#bottle-find-btn')
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('gayz-bottles')))
  expect(state.found).toBe(1)
  // Report removes it.
  await page.evaluate(() => document.querySelector('#bottle-list [data-note-act="report"]').click())
  await expect(page.locator('#bottle-list .social-note-row')).toHaveCount(0)
  log = await page.evaluate(() => window.__game.__socialNotesBackendForTests._log)
  expect(log.reported).toContain('zzzzzz_1_1')
})
