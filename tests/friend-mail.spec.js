import { test, expect } from '@playwright/test'

// Gift Box + Friend Challenges (FriendMail.js, 2026-11-20), against an
// in-memory backend (game.__friendMailBackendForTests, the same functions
// as CloudSync's Friend Mail ones).
test('Friend Mail: send a gift and a challenge, open a gift, win a challenge', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 })
  await page.evaluate(() => {
    const g = window.__game
    Object.defineProperty(g, '_cloudUid', { get: () => 'me1234', set: () => {}, configurable: true })
    g.settings.nickname = 'Tester'
    g.settings.savedFriends = [{ name: 'Pal', uid: 'friend123' }]
    g.coins = 1000
    localStorage.setItem('gayz-ring-bag', JSON.stringify({ 'brick:rare': 3 }))
    localStorage.removeItem('gayz-friend-challenges')
    const sent = []
    let inbox = [
      { id: 'gift_friend123_2026-11-20', kind: 'gift', fromUid: 'friend123', fromNickname: '<i>Pal</i>', coins: 200, item: 'icecube:epic', itemCount: 2, stat: '', target: 0, note: 'Hi <b>there</b>', sentAt: Date.now() - 1000 },
      { id: 'challenge_friend123_2026-11-20', kind: 'challenge', fromUid: 'friend123', fromNickname: 'Pal', coins: 0, item: '', itemCount: 0, stat: 'waves', target: 3, note: '', sentAt: Date.now() - 2000 },
    ]
    g.__friendMailBackendForTests = {
      async sendFriendMail(to, mail) { sent.push({ to, ...mail }) },
      async fetchFriendMail() { return inbox.map((m) => ({ ...m })) },
      async deleteFriendMail(uid, id) { inbox = inbox.filter((m) => m.id !== id) },
      _sent: sent,
    }
    g._showOtherProfileLoading('Pal')
    g._renderOtherProfileEntry({ uid: 'friend123', name: 'Pal', playerId: 'ABCDE' }, 'Pal')
  })

  // A friend's profile shows Send Gift and Challenge.
  await expect(page.locator('#friend-mail-actions')).toBeVisible()
  await page.click('#friend-gift-btn')
  await expect(page.locator('#friend-gift-form')).toBeVisible()
  // Only real bag items (not free starters) can be given.
  await expect(page.locator('#friend-gift-item option')).toHaveCount(2)
  // More coins than the cap is refused.
  await page.fill('#friend-gift-coins', '5000')
  await page.click('#friend-gift-send')
  await expect(page.locator('#friend-mail-status')).not.toHaveText('')
  await page.fill('#friend-gift-coins', '300')
  await page.selectOption('#friend-gift-item', 'brick:rare')
  await page.fill('#friend-gift-count', '2')
  await page.fill('#friend-gift-note', 'Enjoy')
  await page.click('#friend-gift-send')
  await expect(page.locator('#friend-gift-form')).toBeHidden()
  let state = await page.evaluate(() => ({ coins: window.__game.coins, bag: JSON.parse(localStorage.getItem('gayz-ring-bag')), sent: window.__game.__friendMailBackendForTests._sent }))
  expect(state.coins).toBe(700)
  expect(state.bag['brick:rare']).toBe(1)
  expect(state.sent[0]).toMatchObject({ to: 'friend123', kind: 'gift', coins: 300, item: 'brick:rare', itemCount: 2, note: 'Enjoy', fromUid: 'me1234' })
  expect(state.sent[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/)

  // Challenge: starts at your own best + 1.
  await page.click('#friend-challenge-btn')
  await page.selectOption('#friend-challenge-stat', 'kills')
  await page.fill('#friend-challenge-target', '50')
  await page.click('#friend-challenge-send')
  state = await page.evaluate(() => window.__game.__friendMailBackendForTests._sent)
  expect(state[1]).toMatchObject({ kind: 'challenge', stat: 'kills', target: 50 })

  // Not a friend: no buttons.
  await page.evaluate(() => window.__game._renderOtherProfileEntry({ uid: 'stranger99', name: 'X' }, 'X'))
  await expect(page.locator('#friend-mail-actions')).toBeHidden()

  // The mailbox in the Friends panel: text from others shows as text.
  await page.evaluate(() => { window.__game._closeOtherPlayerProfile?.(); return window.__game._openFriendsPanel() })
  await expect(page.locator('#friend-mail-list .friend-mail-row')).toHaveCount(2)
  await expect(page.locator('#friend-mail-list')).toContainText('<i>Pal</i>')
  await expect(page.locator('.friend-mail-note')).toHaveText('“Hi <b>there</b>”')
  await page.evaluate(() => document.querySelector('[data-mail-act="open"]').click())
  await expect(page.locator('#friend-mail-list .friend-mail-row')).toHaveCount(1)
  state = await page.evaluate(() => ({ coins: window.__game.coins, bag: JSON.parse(localStorage.getItem('gayz-ring-bag')) }))
  expect(state.coins).toBe(900)
  expect(state.bag['icecube:epic']).toBe(2)

  // Accept the challenge, then a game that reaches it pays 150 coins.
  await page.evaluate(() => document.querySelector('[data-mail-act="accept"]').click())
  await expect(page.locator('#friend-challenges-list .friend-mail-row')).toHaveCount(1)
  const after = await page.evaluate(() => {
    const g = window.__game
    const before = g.coins
    g._onPlayEvent('end', { waves: 2, kills: 5, bestStreak: 1, headshots: 0, chests: 0, meleeKills: 0, upgrades: 0, bosses: 0, skeletonKills: 0, assists: 0, won: false, died: true, mode: 'survival', difficulty: 'normal', seconds: 60, coins: 0, bonusXp: 0, rewardMult: 1 })
    const stillThere = JSON.parse(localStorage.getItem('gayz-friend-challenges')).length
    const mid = g.coins
    g._onPlayEvent('end', { waves: 4, kills: 5, bestStreak: 1, headshots: 0, chests: 0, meleeKills: 0, upgrades: 0, bosses: 0, skeletonKills: 0, assists: 0, won: false, died: true, mode: 'survival', difficulty: 'normal', seconds: 60, coins: 0, bonusXp: 0, rewardMult: 1 })
    return { before, mid, end: g.coins, stillThere, left: JSON.parse(localStorage.getItem('gayz-friend-challenges')).length }
  })
  expect(after.stillThere).toBe(1)
  expect(after.left).toBe(0)
  // Level-up coins can also land, so check the challenge's 150 at least.
  expect(after.end - after.mid).toBeGreaterThanOrEqual(150)
})
