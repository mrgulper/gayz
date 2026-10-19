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
  // Nothing recognised: a best guess, the same one every time (2026-10-17).
  expect(notes['qwertyzz']).toContain('best guess')
  expect(parsed['qwertyzz'].guessed).toEqual((await page.evaluate(() => window.__parsePrompt('qwertyzz'))).guessed)
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

// 2026-10-11: changing Pixels after Generate really adds detail (the skin is
// drawn again at the new size), Randomize says what it made, and "no"/
// "without" words leave things off.
test('Pixels adds detail, Randomize describes, "without" leaves things off', async ({ page }) => {
  await openDesigner(page)
  await page.click('#res1Btn')
  await generate(page, 'girl with long pink hair')
  const colours = () => page.evaluate(() => {
    const c = window.__skinAtlas, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, s = new Set()
    for (let i = 0; i < d.length; i += 4) s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
    return s.size
  })
  const at1 = await colours()
  await page.click('#res16Btn')
  await page.waitForFunction(() => window.__skinAtlas.width === 1024 && !document.getElementById('generateBtn').disabled)
  expect(await colours()).toBeGreaterThan(at1 * 4)

  const note = await (async () => { await page.click('#randomizeBtn'); await page.waitForFunction(() => !document.getElementById('generateBtn').disabled); return (await page.textContent('#themeNote')).trim() })()
  expect(note).toMatch(/^Randomized an? .+ with .+\. Hit Randomize/)

  expect(await page.evaluate(() => window.__parsePrompt('knight without a cape and no helmet').without.sort())).toEqual(['cape', 'helmet'])
  expect(await page.evaluate(() => window.__parsePrompt('pirate with no hat').without)).toEqual(['hat'])
  expect(await generate(page, 'pirate without a hat')).toContain('Left out: headwear')
})

// Smart Edit (2026-10-12): a request beside undo/redo changes just that
// part - on a generated skin by redrawing it from the same seed, on a
// painted one by recolouring the part it finds.
test('Smart Edit changes only what was asked', async ({ page }) => {
  await openDesigner(page)
  await page.click('#res1Btn')
  expect(await page.evaluate(() => window.__parseEdit('make the shirt blue and remove the hat').actions.map((a) => a.type + ':' + (a.part || a.what)))).toEqual(['color:shirt', 'remove:hat'])
  expect(await page.evaluate(() => window.__parseEdit('blonde hair, add sunglasses, darker pants').actions.map((a) => a.type + ':' + (a.part || a.what)))).toEqual(['color:hair', 'add:sunglasses', 'shade:pants'])
  expect(await page.evaluate(() => window.__parseEdit('take off the glases').actions.map((a) => a.type + ':' + a.what))).toEqual(['remove:glasses'])
  expect(await page.evaluate(() => window.__parseEdit('make it a pirate').actions[0].key)).toBe('pirate')

  await generate(page, 'red shirt pirate with a hat')
  // [x0, y0, x1, y1] in 64-pixel units: torso front, both legs' front, head overlay top.
  const read = () => page.evaluate(() => {
    const c = window.__skinAtlas, R = c.width / 64, ctx = c.getContext('2d')
    const avg = ([x0, y0, x1, y1]) => {
      const d = ctx.getImageData(x0 * R, y0 * R, (x1 - x0) * R, (y1 - y0) * R).data
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3] > 0 ? 1 : 0; n++ }
      return { r: r / n, g: g / n, b: b / n, opaque: a / n }
    }
    const legs = ctx.getImageData(4 * R, 20 * R, 4 * R, 12 * R).data
    return { torso: avg([20, 20, 28, 32]), hatTop: avg([40, 0, 48, 8]), legs: Array.from(legs).join(',') }
  })
  const before = await read()
  expect(before.torso.r).toBeGreaterThan(before.torso.b)
  await page.fill('#aiEditInput', 'make the shirt blue and remove the hat')
  await page.click('#aiEditBtn')
  await page.waitForFunction(() => !document.getElementById('aiEditBtn').disabled)
  const after = await read()
  expect(after.torso.b).toBeGreaterThan(after.torso.r)
  expect(after.hatTop.opaque).toBeLessThan(before.hatTop.opaque)
  expect(after.legs).toBe(before.legs)
  expect(await page.textContent('#aiEditNote')).toContain('Changed:')

  // A painted skin: the part is found on the picture and recoloured.
  await page.evaluate(() => { const ctx = window.__skinAtlas.getContext('2d'); ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, 1, 1) })
  await page.fill('#aiEditInput', 'green pants')
  await page.click('#aiEditBtn')
  await page.waitForFunction(() => !document.getElementById('aiEditBtn').disabled)
  const legsGreen = await page.evaluate(() => {
    const c = window.__skinAtlas, R = c.width / 64, d = c.getContext('2d').getImageData(4 * R, 20 * R, 4 * R, 8 * R).data
    let r = 0, g = 0, b = 0
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2] }
    return g > r && g > b
  })
  expect(legsGreen).toBe(true)
  await page.click('#undoBtn')

  // "add a black hat" makes a black hat, not one in the shirt's colour.
  await generate(page, 'girl in a white dress')
  await page.fill('#aiEditInput', 'add a black hat')
  await page.click('#aiEditBtn')
  await page.waitForFunction(() => !document.getElementById('aiEditBtn').disabled)
  const hatLight = await page.evaluate(() => {
    const c = window.__skinAtlas, R = c.width / 64, d = c.getContext('2d').getImageData(40 * R, 0, 8 * R, 8 * R).data
    let sum = 0, n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) { sum += (d[i] + d[i + 1] + d[i + 2]) / 3; n++ }
    return { avg: sum / Math.max(1, n), n }
  })
  expect(hatLight.n).toBeGreaterThan(0)
  expect(hatLight.avg).toBeLessThan(70)
})

// 2026-10-16: Design a Skin loads in the background once the homepage is
// ready, draws nothing while its panel is hidden, and is ready the moment
// it's opened.
test('Design a Skin is loaded ahead of time and idle while hidden', async ({ page }) => {
  await page.route(/cdn\.jsdelivr\.net\/npm\/three@[^/]+\/(.*)$/, (route) => {
    const rel = route.request().url().replace(/^.*three@[^/]+\//, '')
    route.fulfill({ path: path.resolve('node_modules/three', rel), contentType: 'application/javascript' })
  })
  await page.goto('/')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 })
  await page.waitForFunction(() => {
    const d = document.getElementById('skindesigner-frame').contentDocument
    return d?.readyState === 'complete' && d.getElementById('stageLoading')?.hidden === true
  }, null, { timeout: 60000 })
  expect(await page.evaluate(() => document.getElementById('skindesigner-panel').style.display)).not.toBe('flex')
  const draws = await page.evaluate(() => new Promise((resolve) => {
    const gl = document.getElementById('skindesigner-frame').contentDocument.querySelector('canvas').getContext('webgl2')
    let n = 0
    const orig = gl.drawElements.bind(gl)
    gl.drawElements = (...a) => { n++; return orig(...a) }
    setTimeout(() => { gl.drawElements = orig; resolve(n) }, 1500)
  }))
  expect(draws).toBe(0)
  await page.evaluate(() => window.__game._openSkinDesignerPanel())
  await expect(page.frameLocator('#skindesigner-frame').locator('#generateBtn')).toBeVisible({ timeout: 3000 })
})

// 2026-10-17 ("make it when a player types any word thats an offical word
// will work"): ~1,600 more everyday words, words run together, and edits
// to one arm or leg.
test('Design a Skin knows many more words', async ({ page }) => {
  await openDesigner(page)
  const r = await page.evaluate(() => {
    const bad = []
    for (const [meaning, list] of window.__moreMeanings) for (const t of meaning.split(' ')) if (!window.__knownWord(t)) bad.push(meaning + ' (' + list.split(' ')[0] + ')')
    const p = (t) => window.__parsePrompt(t)
    return {
      bad,
      banana: p('banana'), dragon: p('dragon girl'), steve: p('steve'), icequeen: p('icequeen'), zombiecat: p('zombiecat'),
      herobrine: p('herobrine boy'), lion: p('lion'), loves: p('a tall girl who loves pizza'),
    }
  })
  expect(r.bad).toEqual([])
  expect(r.banana.unknown).toEqual([])
  expect(r.banana.loose[0].name).toBe('yellow')
  expect(r.dragon.themes).toContain('demon')
  expect(r.dragon.gear).toContain('horns')
  expect(r.icequeen.themes).toContain('ice')
  expect(r.zombiecat.themes).toContain('zombie')
  expect(r.zombiecat.animal).toBe('cat')
  expect(r.zombiecat.fixes[0]).toEqual(['zombiecat', 'zombie cat'])
  expect(r.herobrine.skinTone).toBe(null)
  expect(r.lion.animal).toBe('cat')
  expect(r.loves.unknown).toEqual([])
  expect(r.loves.loose.map((c) => c.name)).toContain('brown')

  const edit = await page.evaluate(() => window.__parseEdit('make the left arm blue and the right leg darker').actions.map((a) => a.type + ':' + a.part))
  expect(edit).toEqual(['color:armL', 'shade:legR'])
  await page.click('#res1Btn')
  await generate(page, 'white shirt chef')
  const armL = () => page.evaluate(() => {
    const d = window.__skinAtlas.getContext('2d').getImageData(36, 52, 4, 12).data
    let r = 0, b = 0
    for (let i = 0; i < d.length; i += 4) { r += d[i]; b += d[i + 2] }
    return { r, b }
  })
  const armR = () => page.evaluate(() => Array.from(window.__skinAtlas.getContext('2d').getImageData(44, 20, 4, 12).data).join(','))
  const rightBefore = await armR()
  await page.fill('#aiEditInput', 'make the left arm blue')
  await page.click('#aiEditBtn')
  await page.waitForFunction(() => !document.getElementById('aiEditBtn').disabled)
  const left = await armL()
  expect(left.b).toBeGreaterThan(left.r)
  expect(await armR()).toBe(rightBefore)
  expect(await page.textContent('#aiEditNote')).toContain('left arm')
})

// 2026-10-17: Classic (4px) / Slim (3px) arms under the character, like
// minecraftskins.com, with Download / Upload / Reset to my skin beside them.
test('Design a Skin switches between classic and slim arms', async ({ page }) => {
  await openDesigner(page)
  await page.click('#res1Btn')
  // The arm switch sits under the 3D character; Download and Upload at
  // the bottom of the tools, and Reset to my skin is gone (2026-10-17).
  for (const id of ['armClassicBtn', 'armSlimBtn']) expect(await page.evaluate((i) => !!document.querySelector('.stage .stage-actions #' + i), id)).toBe(true)
  for (const id of ['downloadBtn', 'importBtn']) expect(await page.evaluate((i) => !!document.querySelector('.editor .actions #' + i), id)).toBe(true)
  expect(await page.$('#resetBtn')).toBe(null)
  // Download saves the file straight away.
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#downloadBtn')])
  expect(dl.suggestedFilename()).toBe('skin.png')
  expect(await page.isVisible('#exportOverlay')).toBe(false)
  await generate(page, 'red shirt pirate')
  const strip = () => page.evaluate(() => {
    const ctx = window.__skinAtlas.getContext('2d')
    const alpha = (x, y, w, h) => { const d = ctx.getImageData(x, y, w, h).data; let n = 0; for (let i = 3; i < d.length; i += 4) n += d[i] > 0; return n }
    return { armR: alpha(54, 20, 2, 12), armL: alpha(46, 52, 2, 12), armFront: alpha(44, 20, 3, 12) }
  })
  expect((await strip()).armR).toBeGreaterThan(0)
  await page.click('#armSlimBtn')
  expect(await page.evaluate(() => window.__skinSlim())).toBe(true)
  let s = await strip()
  expect(s.armR).toBe(0)
  expect(s.armL).toBe(0)
  expect(s.armFront).toBe(36)
  // Generating while slim keeps slim arms; undo puts classic back.
  await generate(page, 'blue ninja')
  s = await strip()
  expect(s.armR).toBe(0)
  await page.click('#armClassicBtn')
  expect((await strip()).armR).toBeGreaterThan(0)
  await page.click('#undoBtn')
  expect(await page.evaluate(() => window.__skinSlim())).toBe(true)
  expect((await strip()).armR).toBe(0)
  // A slim skin loaded from a file is recognised as slim.
  await page.click('#armClassicBtn')
  const slimPng = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 64
    const ctx = c.getContext('2d'); ctx.fillStyle = '#4080c0'; ctx.fillRect(0, 0, 64, 64)
    ctx.clearRect(54, 20, 2, 12); ctx.clearRect(46, 52, 2, 12)
    return c.toDataURL('image/png')
  })
  await page.setInputFiles('#importFile', { name: 'skin.png', mimeType: 'image/png', buffer: Buffer.from(slimPng.split(',')[1], 'base64') })
  await page.waitForFunction(() => window.__skinSlim() === true)
})

test('the game wears slim arms', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__game && !!window.__game._menuAvatar3D, null, { timeout: 60000 })
  const widths = await page.evaluate(async () => {
    const make = (slim) => {
      const c = document.createElement('canvas'); c.width = c.height = 64
      const ctx = c.getContext('2d'); ctx.fillStyle = '#30a050'; ctx.fillRect(0, 0, 64, 64)
      if (slim) { ctx.clearRect(54, 20, 2, 12); ctx.clearRect(46, 52, 2, 12) }
      return c.toDataURL('image/png')
    }
    const armWidth = () => {
      const arm = window.__game._menuAvatar3D.character.limbPivots.armR.children[0]
      arm.geometry.computeBoundingBox()
      const b = arm.geometry.boundingBox
      return Math.round((b.max.x - b.min.x) * 10) / 10
    }
    const out = {}
    await window.__game._applyImportedSkin(make(true))
    await new Promise((r) => setTimeout(r, 500))
    out.slim = armWidth()
    await window.__game._applyImportedSkin(make(false))
    await new Promise((r) => setTimeout(r, 500))
    out.classic = armWidth()
    return out
  })
  expect(widths).toEqual({ slim: 3, classic: 4 })

})

// 2026-10-17 second pass: long hair at the front, detailed animal looks,
// two-word colours, "match the shirt", face marks.
test('Design a Skin: long hair in front, cat details, smarter edits', async ({ page }) => {
  await openDesigner(page)
  await page.click('#res1Btn')
  const p = (t) => page.evaluate((x) => window.__parsePrompt(x), t)
  const e = (t) => page.evaluate((x) => window.__parseEdit(x).actions.map((a) => a.type + ':' + (a.part ?? a.what ?? a.key ?? a.kind ?? a.style) + (a.name ? ':' + a.name : '') + (a.matchPart ? '<' + a.matchPart : '') + (a.kind && a.what ? ':' + a.kind : '')), t)
  expect((await p('girl with light blue hair')).colors.hair.name).toBe('light blue')
  expect((await p('dark red shirt')).colors.shirt.name).toBe('dark red')
  expect((await p('cat girl')).gear).toEqual([])
  expect(await e('add cat paw')).toEqual(['add:paws:cat'])
  expect(await e('make her a fox')).toEqual(['animal:fox'])
  expect(await e('make the hair match the shirt')).toEqual(['color:hair:the shirt\'s colour<shirt'])
  expect(await e('hot pink pants and add freckles')).toEqual(['color:pants:hot pink', 'add:freckles'])
  expect(await e('longer hair')).toEqual(['hair:2:longer'])
  expect(await e('give her a ponytail and turn her into a vampire')).toEqual(['hair:2:ponytail', 'theme:vampire:vampire'])

  const alpha = (x, y, w, h) => page.evaluate(([x, y, w, h]) => { const d = window.__skinAtlas.getContext('2d').getImageData(x, y, w, h).data; let n = 0; for (let i = 3; i < d.length; i += 4) n += d[i] > 0; return n }, [x, y, w, h])
  const colorAt = (x, y) => page.evaluate(([x, y]) => Array.from(window.__skinAtlas.getContext('2d').getImageData(x, y, 1, 1).data), [x, y])
  // Long hair: the torso front's outer layer has hair down both edges.
  await generate(page, 'girl with very long black hair and a white shirt')
  const front = await page.evaluate(() => { const d = window.__skinAtlas.getContext('2d').getImageData(20, 36, 8, 6).data; let edge = 0; for (let y = 0; y < 6; y++) for (const x of [0, 7]) { const i = (y * 8 + x) * 4; if (d[i + 3] && d[i] + d[i + 1] + d[i + 2] < 250) edge++ } return edge })
  expect(front).toBeGreaterThanOrEqual(10)
  // Cat girl: paw pads under the hands and a tail down the back of a leg.
  await generate(page, 'cute cat girl')
  const pad = await colorAt(41 + 8 + 1, 32 + 1) // right sleeve overlay bottom face
  expect(pad[0]).toBeGreaterThan(200)
  expect(await alpha(12, 36, 4, 8)).toBeGreaterThan(8) // right leg overlay back
})

// 2026-10-18, "make the edit and generating a skin smarter": sentences tie
// colours to parts, Generate offers 4 options, Smart Edit remembers the
// conversation, and a part picked on the character takes the next words.
test('Design a Skin reads whole sentences', async ({ page }) => {
  await openDesigner(page)
  const read = (p) => page.evaluate((t) => { const r = window.__parsePrompt(t); return Object.fromEntries(Object.entries(r.colors).map(([k, v]) => [k, v.name])) }, p)
  expect(await read('a pirate whose hair is red')).toEqual({ hair: 'red' })
  expect(await read('her eyes are green')).toEqual({ eye: 'green' })
  expect(await read('red and black shirt')).toEqual({ shirt: 'red', accent: 'black' })
  expect(await read('cat girl, hair: white, eyes: blue')).toEqual({ hair: 'white', eye: 'blue' })
  expect(await read('a zombie wearing a red hat')).toEqual({ hat: 'red' })
  // A colour word that is also a look ("gold") only recolours in Smart Edit.
  const edit = await page.evaluate(() => window.__parseEdit('make the shirt gold').actions.map((a) => a.type))
  expect(edit).toEqual(['color'])
})

test('Design a Skin offers 4 options to pick from', async ({ page }) => {
  await openDesigner(page)
  await page.click('#res1Btn')
  const note = await generate(page, 'pirate')
  expect(note).toContain('4 options')
  expect(await page.evaluate(() => window.__genOptions())).toBe(4)
  await expect(page.locator('#genOptions .gen-option')).toHaveCount(4)
  await expect(page.locator('#genOptions .gen-option.active')).toHaveText('1')
  const pic = () => page.evaluate(() => Array.from(window.__skinAtlas.getContext('2d').getImageData(0, 0, 64, 64).data).join(','))
  const first = await pic()
  await page.locator('#genOptions .gen-option').nth(2).click()
  await expect(page.locator('#genOptions .gen-option.active')).toHaveText('3')
  expect(await pic()).not.toBe(first)
  await page.click('#undoBtn')
  expect(await pic()).toBe(first)
})

test('Design a Skin Smart Edit remembers the conversation', async ({ page }) => {
  await openDesigner(page)
  await page.click('#res1Btn')
  await generate(page, 'white shirt chef')
  const torso = () => page.evaluate(() => {
    const d = window.__skinAtlas.getContext('2d').getImageData(20, 20, 8, 12).data
    let r = 0, g = 0, b = 0
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2] }
    return { r, g, b, sum: r + g + b }
  })
  const ask = async (t) => {
    await page.fill('#aiEditInput', t)
    await page.click('#aiEditBtn')
    await page.waitForFunction(() => !document.getElementById('aiEditBtn').disabled)
    return (await page.textContent('#aiEditNote .chat-turn.latest')).trim()
  }
  await ask('red shirt')
  let t = await torso()
  expect(t.r).toBeGreaterThan(t.b)
  // "no, blue": the last change is swapped, on the same part.
  expect(await ask('no, blue')).toContain('Swapped')
  t = await torso()
  expect(t.b).toBeGreaterThan(t.r)
  const blue = t.sum
  await ask('darker')
  expect((await torso()).sum).toBeLessThan(blue)
  await ask('undo')
  expect((await torso()).sum).toBe(blue)
  // Follow-up buttons and earlier turns stay listed.
  await expect(page.locator('#aiEditNote .chat-turn')).toHaveCount(4)
  await expect(page.locator('#aiEditNote button[data-ask="darker"]')).toHaveCount(0) // undo's reply has none
  await ask('more green')
  await expect(page.locator('#aiEditNote button[data-ask="darker"]')).toHaveCount(1)
})

test('Design a Skin edits a part picked on the character', async ({ page }) => {
  await openDesigner(page)
  await page.click('#res1Btn')
  await generate(page, 'white shirt chef')
  const area = (x, y, w, h) => page.evaluate(([x, y, w, h]) => {
    const d = window.__skinAtlas.getContext('2d').getImageData(x, y, w, h).data
    let r = 0, g = 0, b = 0
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2] }
    return { r, g, b, raw: Array.from(d).join(',') }
  }, [x, y, w, h])
  const leftBefore = await area(36, 52, 4, 12)
  await page.click('#aiPickBtn')
  expect(await page.evaluate(() => window.__pickAt(45, 22))).toBe(true) // right arm, front
  await expect(page.locator('#aiPickChip')).toBeVisible()
  await expect(page.locator('#aiPickLabel')).toContainText('right')
  await page.fill('#aiEditInput', 'make this blue')
  await page.click('#aiEditBtn')
  await page.waitForFunction(() => !document.getElementById('aiEditBtn').disabled)
  const right = await area(45, 22, 1, 1)
  expect(right.b).toBeGreaterThan(right.r)
  expect((await area(36, 52, 4, 12)).raw).toBe(leftBefore.raw)
  // "both" reaches the other arm too.
  await page.fill('#aiEditInput', 'both green')
  await page.click('#aiEditBtn')
  await page.waitForFunction(() => !document.getElementById('aiEditBtn').disabled)
  const left = await area(36, 52, 4, 12)
  expect(left.raw).not.toBe(leftBefore.raw)
  expect(left.g).toBeGreaterThan(left.r)
  await page.click('#aiPickClear')
  await expect(page.locator('#aiPickChip')).toBeHidden()
})
