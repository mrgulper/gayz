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
      const d = window.__skinAtlas.getContext('2d').getImageData(0, 0, window.__skinAtlas.width, window.__skinAtlas.height).data
      const k = window.__skinRes(), S = window.__skinAtlas.width
      // Averages over a rect given in the 64-pixel skin layout.
      const avg = (x0, y0, x1, y1) => {
        let n = 0; const c = [0, 0, 0]
        for (let y = y0 * k; y < y1 * k; y++) for (let x = x0 * k; x < x1 * k; x++) { const i = (y * S + x) * 4; if (!d[i + 3]) continue; n++; c[0] += d[i]; c[1] += d[i + 1]; c[2] += d[i + 2] }
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

// More pixels (2026-10-11, Gaymi: "add more pixels, 2x or 4x"): the
// Pixels buttons make a 128 or 256 pixel skin, the generator fills every
// one of them, and the game wears it.
test('Design a Skin makes 2x and 4x skins', async ({ page }) => {
  await openDesigner(page)
  const sizes = {}
  for (const n of [1, 2, 4]) {
    await page.click(`#res${n}Btn`)
    await generate(page, 'pirate with a hat')
    sizes[n] = await page.evaluate(() => {
      const c = window.__skinAtlas
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      // Distinct colours inside the head's front - more pixels, more detail.
      const k = window.__skinRes(), set = new Set()
      for (let y = 8 * k; y < 16 * k; y++) for (let x = 8 * k; x < 16 * k; x++) { const i = (y * c.width + x) * 4; set.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]) }
      return { w: c.width, h: c.height, colours: set.size }
    })
  }
  expect(sizes[1]).toMatchObject({ w: 64, h: 64 })
  expect(sizes[2]).toMatchObject({ w: 128, h: 128 })
  expect(sizes[4]).toMatchObject({ w: 256, h: 256 })
  expect(sizes[4].colours).toBeGreaterThan(sizes[1].colours)
})

// 2026-10-11, "add 8x and 16x ... make every current feature in design a
// skin work for more pixels too": generating, painting with mirror, fill,
// undo and the slots all work on a 1024-wide skin, and the game wears it.
test('Design a Skin works at 8x and 16x', async ({ page }) => {
  await openDesigner(page)
  await page.click('#res8Btn')
  await generate(page, 'pirate with a hat')
  expect(await page.evaluate(() => window.__skinAtlas.width)).toBe(512)
  await page.click('#res16Btn')
  await generate(page, 'girl with long red hair')
  expect(await page.evaluate(() => [window.__skinAtlas.width, document.getElementById('atlasSizeLabel').textContent])).toEqual([1024, '1024×1024'])

  await page.click('#clearBtn')
  // Scrolls the atlas pixel to the middle of the window, then returns where it is.
  const at = (x, y) => page.evaluate(([x, y]) => {
    const c = document.getElementById('atlas2d'), zp = c.width / window.__skinAtlas.width
    const spot = () => { const r = c.getBoundingClientRect(); return { x: r.left + (x * zp + zp / 2) * r.width / c.width, y: r.top + (y * zp + zp / 2) * r.height / c.height } }
    let s = spot()
    for (let el = c.parentElement; el; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) {
        const r = el.getBoundingClientRect()
        el.scrollTop += s.y - (r.top + Math.min(r.height, innerHeight) / 2)
        el.scrollLeft += s.x - (r.left + Math.min(r.width, innerWidth) / 2)
        s = spot()
      }
    }
    window.scrollBy(s.x - innerWidth / 2, s.y - innerHeight / 2)
    return spot()
  }, [x, y])
  const px = (x, y) => page.evaluate(([x, y]) => Array.from(window.__skinAtlas.getContext('2d').getImageData(x, y, 1, 1).data), [x, y])
  // Head front is 8..16 x 8..16 in skin units; 16 atlas pixels each.
  await page.fill('#colorHex', '#ff0000')
  await page.press('#colorHex', 'Enter')
  await page.click('#toolPencil')
  await page.click('#mirrorBtn')
  const p = await at(8 * 16 + 3, 8 * 16 + 40)
  await page.mouse.click(p.x, p.y)
  expect(await px(8 * 16 + 3, 8 * 16 + 40)).toEqual([255, 0, 0, 255])
  expect(await px(16 * 16 - 1 - 3, 8 * 16 + 40)).toEqual([255, 0, 0, 255])
  await page.click('#mirrorBtn')

  await page.fill('#colorHex', '#00ff00')
  await page.press('#colorHex', 'Enter')
  await page.click('#toolFill')
  const f = await at(20 * 16 + 5, 20 * 16 + 5)
  await page.mouse.click(f.x, f.y)
  expect(await px(20 * 16 + 5, 20 * 16 + 5)).toEqual([0, 255, 0, 255])
  await page.click('#undoBtn')
  expect((await px(20 * 16 + 5, 20 * 16 + 5))[3]).toBe(0)
  expect(await px(8 * 16 + 3, 8 * 16 + 40)).toEqual([255, 0, 0, 255])

  // The slot keeps the 16x skin.
  await page.click('#slotBar button:nth-of-type(2)')
  await page.click('#slotBar button:nth-of-type(1)')
  await page.waitForFunction(() => window.__skinAtlas.width === 1024)
  await expect.poll(() => px(8 * 16 + 3, 8 * 16 + 40)).toEqual([255, 0, 0, 255])
})

test('the game wears a 16x skin', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 })
  const w = await page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = c.height = 1024
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#c08040'
    ctx.fillRect(0, 0, 1024, 1024)
    await window.__game._applyImportedSkin(c.toDataURL('image/png'))
    const img = new Image()
    img.src = window.__game.settings.customSkinDataUrl
    await img.decode()
    return img.naturalWidth
  })
  expect(w).toBe(1024)
})
