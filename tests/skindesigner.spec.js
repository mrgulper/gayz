import { test, expect } from '@playwright/test'
import path from 'path'

// Design a Skin's prompt generator understands everyday words, word endings
// and typos (2026-10-11, "make it think like a very smart AI because some
// common words it might not even know"), and builds the skin from what was
// asked rather than naming a preset style. The designer's import map loads
// three.js from a CDN the test sandbox can't reach, so it's served from
// node_modules instead.
async function openDesigner(page) {
  await page.route(/cdn\.jsdelivr\.net\/npm\/three@[^/]+\/(.*)$/, (route) => {
    const rel = route.request().url().replace(/^.*three@[^/]+\//, '')
    route.fulfill({ path: path.resolve('node_modules/three', rel), contentType: 'application/javascript' })
  })
  await page.goto('/skin-designer/index.html')
  await page.waitForSelector('#generateBtn')
}
async function generate(page, prompt) {
  await page.fill('#promptInput', prompt)
  await page.click('#generateBtn')
  await page.waitForFunction(() => !document.getElementById('generateBtn').disabled, null, { timeout: 15000 })
  return (await page.textContent('#themeNote')).trim()
}

test('Design a Skin understands everyday words and typos', async ({ page }) => {
  await openDesigner(page)
  const parsed = {}
  for (const prompt of ['sexy girl', 'cowgirl with red hair', 'pirte with a hat', 'zombi ninjas', 'businessman with sunglasses', 'santa', 'girl with a blonde ponytail', 'boy with long black hair', 'qwertyzz']) {
    parsed[prompt] = await page.evaluate((p) => window.__parsePrompt(p), prompt)
  }
  expect(parsed['sexy girl'].themes).toContain('stylish')
  expect(parsed['sexy girl'].unknown).toEqual([])
  expect(parsed['cowgirl with red hair'].themes[0]).toBe('cowboy')
  expect(parsed['cowgirl with red hair'].colors.hair.name).toBe('red')
  expect(parsed['pirte with a hat'].themes).toContain('pirate')
  expect(parsed['pirte with a hat'].gear).toContain('hat')
  expect(parsed['zombi ninjas'].themes).toEqual(expect.arrayContaining(['zombie', 'ninja']))
  expect(parsed['businessman with sunglasses'].gear).toContain('sunglasses')
  expect(parsed['santa'].gear).toContain('beard')
  expect(parsed['girl with a blonde ponytail'].colors.hair.name).toBe('blonde')
  expect(parsed['girl with a blonde ponytail'].ponytail).toBe(true)
  expect(parsed['boy with long black hair'].hairStyle).toBe(2)
  expect(parsed['boy with long black hair'].colors.hair.name).toBe('black')

  // The message describes what was made - never "X style".
  const notes = {}
  for (const prompt of ['pirte with a hat', 'santa', 'qwertyzz']) notes[prompt] = await generate(page, prompt)
  for (const note of Object.values(notes)) expect(note).not.toMatch(/style/i)
  expect(notes['pirte with a hat']).toContain('Read "pirte" as pirate')
  expect(notes['santa']).toContain('beard')
  expect(notes['qwertyzz']).toContain("Didn't recognize")
})

test('Design a Skin paints long hair down the back on both layers', async ({ page }) => {
  await openDesigner(page)
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  // Several generations - each one is random.
  for (let i = 0; i < 4; i++) {
    await generate(page, 'girl with long green hair and a white shirt')
    const r = await page.evaluate(() => {
      const d = window.__skinAtlas.getContext('2d').getImageData(0, 0, 64, 64).data
      const avg = (x0, y0, x1, y1) => {
        let n = 0; const c = [0, 0, 0]
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * 64 + x) * 4; if (!d[i + 3]) continue; n++; c[0] += d[i]; c[1] += d[i + 1]; c[2] += d[i + 2] }
        return n ? c.map((v) => v / n) : null
      }
      // Head back (24..32 x 8..16); torso back, top five rows, on the base
      // layer (32..40 x 20..25) and outer layer (32..40 x 36..41); the
      // shirt on the base layer's front, middle rows (22..26 x 24..30).
      return { head: avg(24, 8, 32, 16), base: avg(32, 20, 40, 25), outer: avg(32, 36, 40, 41), shirt: avg(22, 24, 26, 30) }
    })
    expect(r.base).not.toBeNull()
    expect(r.outer).not.toBeNull()
    // Hair, not shirt, on both layers of the back.
    expect(dist(r.head, r.base)).toBeLessThan(dist(r.shirt, r.base))
    expect(dist(r.head, r.outer)).toBeLessThan(dist(r.shirt, r.outer))
  }
})
