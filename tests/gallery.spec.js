import { test, expect } from '@playwright/test'
import path from 'path'

// The Gallery (2026-10-16): post a skin from Design a Skin, then open it,
// like it, comment, wear it and delete it - against an in-memory backend
// (game.__galleryBackendForTests, the same functions as CloudSync's).
test('a skin posted from Design a Skin can be liked, commented on, worn and deleted', async ({ page }) => {
  // The designer's import map loads three.js from a CDN the sandbox can't reach.
  await page.route(/cdn\.jsdelivr\.net\/npm\/three@[^/]+\/(.*)$/, (route) => {
    const rel = route.request().url().replace(/^.*three@[^/]+\//, '')
    route.fulfill({ path: path.resolve('node_modules/three', rel), contentType: 'application/javascript' })
  })
  await page.goto('/')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 })
  await page.evaluate(() => {
    const g = window.__game
    Object.defineProperty(g, '_cloudUid', { get: () => 'me', set: () => {}, configurable: true })
    g.settings.nickname = 'Tester'
    const posts = new Map()
    const likes = new Set()
    const dislikes = new Set()
    const comments = new Map()
    let next = 1
    g.__galleryBackendForTests = {
      async fetchGalleryPosts(kind) { return [...posts.values()].filter((p) => p.kind === kind).map((p) => ({ ...p })) },
      async createGalleryPost(post) { const id = `p${next++}`; posts.set(id, { ...post, id, likes: 0, createdAt: Date.now() }); return id },
      async deleteGalleryPost(id) { posts.delete(id) },
      async likeGalleryPost(id, uid) { if (likes.has(id + uid)) return false; likes.add(id + uid); posts.get(id).likes++; return true },
      async hasLikedGalleryPost(id, uid) { return likes.has(id + uid) },
      async dislikeGalleryPost(id, uid) { if (dislikes.has(id + uid) || likes.has(id + uid)) return false; dislikes.add(id + uid); posts.get(id).dislikes = (posts.get(id).dislikes || 0) + 1; return true },
      async hasDislikedGalleryPost(id, uid) { return dislikes.has(id + uid) },
      async fetchGalleryComments(id) { return [...(comments.get(id) || [])] },
      async addGalleryComment(id, c) { const cid = `c${next++}`; comments.set(id, [...(comments.get(id) || []), { ...c, id: cid, createdAt: Date.now() }]); return cid },
      async deleteGalleryComment(id, cid) { comments.set(id, (comments.get(id) || []).filter((c) => c.id !== cid)) },
      _posts: posts,
    }
    window.confirm = () => true
  })

  // The Gallery link sits beside Design a Skin; Weapon is Coming Soon.
  await page.click('#nav-gallery-link')
  await expect(page.locator('#gallery-panel')).toBeVisible()
  await expect(page.locator('#gallery-empty')).toBeVisible()
  await page.click('#gallery-tab-weapon')
  await expect(page.locator('#gallery-weapon-page')).toBeVisible()
  await page.click('#gallery-tab-character')

  // Post to Gallery inside Design a Skin opens the post form.
  await page.evaluate(() => window.__game._openSkinDesignerPanel())
  const frame = page.frameLocator('#skindesigner-frame')
  await frame.locator('#postToGalleryBtn').click({ timeout: 30000 })
  await expect(page.locator('#gallery-post-form')).toBeVisible()
  await page.fill('#gallery-post-title', '<b>My Skin</b>')
  await page.click('#gallery-post-submit')
  await expect(page.locator('.gallery-card')).toHaveCount(1)
  // Titles are shown as text, never as markup.
  await expect(page.locator('.gallery-card-title')).toHaveText('<b>My Skin</b>')

  await page.click('.gallery-card')
  await expect(page.locator('#gallery-detail')).toBeVisible()
  await expect(page.locator('#gallery-delete-btn')).toBeVisible()
  await page.click('#gallery-like-btn')
  await expect(page.locator('#gallery-like-btn')).toBeDisabled()
  await expect(page.locator('#gallery-like-btn')).toContainText('1')
  // One vote per post (2026-10-30): liking locks the thumbs-down too.
  await expect(page.locator('#gallery-dislike-btn')).toBeDisabled()
  await expect(page.locator('#gallery-dislike-btn')).toContainText('0')

  await page.fill('#gallery-comment-input', 'Nice one')
  await page.click('#gallery-comment-send')
  await expect(page.locator('.gallery-comment-text')).toHaveText('Nice one')
  await page.click('.gallery-comment-delete')
  await expect(page.locator('.gallery-comment')).toHaveCount(0)

  const before = await page.evaluate(() => window.__game.settings.customSkinDataUrl || '')
  await page.click('#gallery-use-btn')
  await expect.poll(() => page.evaluate(() => window.__game.settings.customSkinDataUrl || '')).not.toBe(before)

  await page.click('#gallery-delete-btn')
  await expect(page.locator('#gallery-list-view')).toBeVisible()
  await expect(page.locator('.gallery-card')).toHaveCount(0)
  expect(await page.evaluate(() => window.__game.__galleryBackendForTests._posts.size)).toBe(0)
})

// 2026-10-30: thumbs-down votes, both counts on the cards, My Posts and
// Top This Week.
test('Gallery has dislikes, My Posts and Top This Week', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 })
  await page.evaluate(() => {
    const g = window.__game
    Object.defineProperty(g, '_cloudUid', { get: () => 'me', set: () => {}, configurable: true })
    const day = 24 * 60 * 60 * 1000
    const img = 'data:image/png;base64,AAAA'
    const posts = new Map([
      ['mine', { id: 'mine', kind: 'character', title: 'Mine', creatorUid: 'me', creatorNickname: 'Me', image: img, likes: 1, dislikes: 0, createdAt: Date.now() - day }],
      ['old', { id: 'old', kind: 'character', title: 'Old', creatorUid: 'x', creatorNickname: 'X', image: img, likes: 9, createdAt: Date.now() - 10 * day }],
      ['new', { id: 'new', kind: 'character', title: 'New', creatorUid: 'y', creatorNickname: 'Y', image: img, likes: 3, dislikes: 2, createdAt: Date.now() - 2 * day }],
    ])
    const votes = new Set()
    g.__galleryBackendForTests = {
      async fetchGalleryPosts(kind) { return [...posts.values()].filter((p) => p.kind === kind).map((p) => ({ ...p })) },
      async likeGalleryPost(id, uid) { if (votes.has(id + uid)) return false; votes.add(id + uid); posts.get(id).likes++; return true },
      async hasLikedGalleryPost() { return false },
      async dislikeGalleryPost(id, uid) { if (votes.has(id + uid)) return false; votes.add(id + uid); posts.get(id).dislikes = (posts.get(id).dislikes || 0) + 1; return true },
      async hasDislikedGalleryPost() { return false },
      async fetchGalleryComments() { return [] },
    }
  })
  await page.click('#nav-gallery-link')
  await expect(page.locator('.gallery-card')).toHaveCount(3)
  const titles = () => page.locator('.gallery-card-title').allTextContents()
  // Newest first; both counts on every card.
  expect(await titles()).toEqual(['Mine', 'New', 'Old'])
  await expect(page.locator('.gallery-card[data-id="new"] .gallery-card-likes')).toContainText('3')
  await expect(page.locator('.gallery-card[data-id="new"] .gallery-card-down')).toContainText('2')
  // Top This Week: last 7 days only, most liked first.
  await page.selectOption('#gallery-sort', 'week')
  expect(await titles()).toEqual(['New', 'Mine'])
  await page.selectOption('#gallery-sort', 'likes')
  expect(await titles()).toEqual(['Old', 'New', 'Mine'])
  // My Posts: only your own.
  await page.click('#gallery-mine-btn')
  expect(await titles()).toEqual(['Mine'])
  await page.click('#gallery-mine-btn')
  await expect(page.locator('.gallery-card')).toHaveCount(3)
  // A thumbs-down counts once and locks both buttons.
  await page.click('.gallery-card[data-id="new"]')
  await page.click('#gallery-dislike-btn')
  await expect(page.locator('#gallery-dislike-btn')).toContainText('3')
  await expect(page.locator('#gallery-dislike-btn')).toBeDisabled()
  await expect(page.locator('#gallery-like-btn')).toBeDisabled()
})
