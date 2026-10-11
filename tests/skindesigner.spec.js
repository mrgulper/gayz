import { test, expect } from '@playwright/test'
import path from 'path'

// Design a Skin's prompt generator understands everyday words, word endings
// and typos (2026-10-11, "make it think like a very smart AI because some
// common words it might not even know"). The designer's import map loads
// three.js from a CDN the test sandbox can't reach, so it's served from
// node_modules instead.
test('Design a Skin understands everyday words and typos', async ({ page }) => {
  await page.route(/cdn\.jsdelivr\.net\/npm\/three@[^/]+\/(.*)$/, (route) => {
    const rel = route.request().url().replace(/^.*three@[^/]+\//, '')
    route.fulfill({ path: path.resolve('node_modules/three', rel), contentType: 'application/javascript' })
  })
  await page.goto('/skin-designer/index.html')
  await page.waitForSelector('#generateBtn')
  const results = {}
  for (const prompt of ['sexy girl', 'cowgirl with red hair', 'pirte with a hat', 'zombi ninjas', 'businessman with sunglasses', 'santa', 'qwertyzz']) {
    await page.fill('#promptInput', prompt)
    await page.click('#generateBtn')
    await page.waitForFunction(() => !document.getElementById('generateBtn').disabled, null, { timeout: 15000 })
    results[prompt] = (await page.textContent('#themeNote')).trim()
  }
  expect(results['sexy girl']).toContain('Stylish style')
  expect(results['sexy girl']).not.toContain("Didn't know")
  expect(results['cowgirl with red hair']).toContain('Cowboy style with red hair')
  expect(results['pirte with a hat']).toContain('Pirate style with hat')
  expect(results['pirte with a hat']).toContain('Read "pirte" as pirate')
  expect(results['zombi ninjas']).toContain('Zombie style with Ninja gear')
  expect(results['businessman with sunglasses']).toContain('Suit style with sunglasses')
  expect(results['santa']).toContain('beard')
  expect(results['qwertyzz']).toContain("Didn't recognize")
})
