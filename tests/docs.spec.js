import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

// The player-facing pages that used to be typed by hand and drift from the
// game (2026-10-04): GayZ Features' lists, How to Play's keys, and the Map
// Editor pause screen's Shortcuts box. scripts/check-docs.mjs catches typed
// numbers before a commit; these check the pages against the running game.

test('GayZ Features lists are built from the game data, every entry described', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(() => {
    const g = window.__game
    const c = g.featuresContent
    const catalogs = g._featureCatalogs()
    const lists = {}
    for (const list of c.querySelectorAll('[data-feature-list]')) {
      const key = list.dataset.featureList
      lists[key] = {
        shown: [...list.querySelectorAll('.detail-item[data-id]')].map((e) => e.dataset.id),
        expected: Object.keys(catalogs[key] || {}),
        line: c.querySelector(`[data-feature-list-line="${key}"]`)?.textContent || '',
      }
    }
    const values = g._featureValues()
    return {
      lists,
      catalogKeys: Object.keys(catalogs),
      // Things in the game with no name/description in code yet (an
      // ITEM_INFO, MUTATOR_INFO, GAME_MODE_INFO entry or an `about` field).
      undescribed: [...c.querySelectorAll('[data-missing]')].map((e) => `${e.closest('[data-feature-list]').dataset.featureList}:${e.dataset.id}`),
      unknownValueKeys: [...c.querySelectorAll('[data-feature-value]')].map((e) => e.dataset.featureValue).filter((k) => values[k] == null || values[k] === '' || values[k] === 0),
      unknownCountKeys: [...c.querySelectorAll('[data-feature-count]')].map((e) => e.dataset.featureCount).filter((k) => !(g._featureCounts()[k] > 0)),
    }
  })

  expect(Object.keys(result.lists).sort()).toEqual(result.catalogKeys.sort())
  for (const [key, list] of Object.entries(result.lists)) {
    expect(list.shown, `${key} list`).toEqual(list.expected)
    expect(list.shown.length, `${key} list is empty`).toBeGreaterThan(0)
    expect(list.line.length, `${key} summary line is empty`).toBeGreaterThan(0)
  }
  expect(result.undescribed, 'give these a name and description in the code').toEqual([])
  expect(result.unknownValueKeys, 'add these keys to _featureValues()').toEqual([])
  expect(result.unknownCountKeys, 'add these keys to _featureCounts()').toEqual([])
})

test('How to Play shows the real keys, with no unfilled placeholders', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(() => {
    const g = window.__game
    g._openHowToPlayPanel()
    const html = g.howtoplayContent.innerHTML
    const text = g.howtoplayContent.textContent
    g._closeHowToPlayPanel()
    return { placeholders: html.match(/\{(?:key:)?[a-zA-Z]+\}/g) || [], text }
  })

  expect(result.placeholders).toEqual([])
  expect(result.text.length).toBeGreaterThan(100)
})

// Text names keys as {key:interact}, {key:sprint}... (i18n.js), so a
// rebound key shows up everywhere without anyone editing the text.
test('in-game text shows the player\'s rebound keys, not the defaults', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('gayz-keybinds', JSON.stringify({ interact: 'KeyH', sprint: 'KeyP' }))
  })
  await gotoAndWaitForGame(page)

  const html = await page.evaluate(() => {
    const g = window.__game
    g._openHowToPlayPanel()
    const out = g.howtoplayContent.innerHTML
    g._closeHowToPlayPanel()
    return out
  })

  expect(html).toContain('<b>H</b>')
  expect(html).toContain('<b>P</b>')
  expect(html).not.toContain('<b>F</b>')
  expect(html).not.toContain('{key:')
})

// Every key the Map Editor's Shortcuts box lists is pressed for real (a
// keydown on window, where BuildMode listens) and must do its job. A new
// shortcut fails here until it gets an entry in CHECKS.
test('every Map Editor shortcut on the pause screen really works', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const press = (code, opts = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, ...opts }))
    const release = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }))
    const spy = (name) => {
      const original = bm[name]
      let calls = 0
      bm[name] = function (...args) { calls++; return original.apply(this, args) }
      return () => { bm[name] = original; return calls }
    }
    const setTry = (on) => { if (bm.tryMode.active !== on) bm.toggleTryMode() }
    const speedWith = (codes) => {
      bm._keys.clear()
      bm.tryMode.vel.set(0, 0, 0)
      codes.forEach((c) => press(c))
      for (let i = 0; i < 20; i++) bm.tryMode.update(0.05, bm._keys)
      const v = Math.hypot(bm.tryMode.vel.x, bm.tryMode.vel.z)
      codes.forEach(release)
      bm._keys.clear()
      return v
    }

    const CHECKS = {
      buildModeTryBtn: () => { setTry(false); press('KeyT'); const on = bm.tryMode.active; press('KeyT'); return on && !bm.tryMode.active },
      buildMenuRun: () => { setTry(true); const walk = speedWith(['KeyW']); const run = speedWith(['ShiftLeft', 'KeyW']); setTry(false); return run > walk * 1.3 },
      buildMenuCrouch: () => { setTry(true); press('KeyC'); bm.tryMode.update(0.05, bm._keys); const crouched = bm.tryMode._crouch; release('KeyC'); bm._keys.clear(); setTry(false); return crouched },
      buildMenuUseDoor: () => { setTry(true); const done = spy('_tryUseFromCamera'); press('KeyE'); const calls = done(); setTry(false); return calls === 1 },
      buildMenuMapSize: () => { setTry(true); const before = bm.tryMode._mapMode; press('KeyM'); const after = bm.tryMode._mapMode; setTry(false); return after !== before },
      buildModeUndoBtn: () => { const done = spy('undo'); press('KeyZ', { ctrlKey: true }); return done() === 1 },
      buildModeRedoBtn: () => { const done = spy('redo'); press('KeyY', { ctrlKey: true }); return done() === 1 },
      buildModeSaveBtn: () => { const done = spy('save'); press('KeyS', { ctrlKey: true }); return done() === 1 },
      buildModeMirrorBtn: () => { const before = bm.mirrorMode; press('KeyM'); const after = bm.mirrorMode; if (after !== before) bm.toggleMirror(); return after !== before },
      buildModeLineBtn: () => { const before = bm.lineToolMode; press('KeyL'); const after = bm.lineToolMode; if (after !== before) bm.toggleLineTool(); return after !== before },
      buildModeCopyBtn: () => { const before = bm.copyToolMode; press('KeyC'); const after = bm.copyToolMode; if (after !== before) bm.toggleCopyTool(); return after !== before },
      buildModePasteBtn: () => { const done = spy('pasteClipboard'); press('KeyP'); return done() === 1 },
      buildMenuBlockPicker: () => { const before = bm.pickerOpen; press('Tab'); const after = bm.pickerOpen; if (after !== before) bm.togglePicker(); return after !== before },
    }

    const out = {}
    for (const [keys, labelKey] of bm.constructor.MENU_SHORTCUTS) {
      const label = `${keys.join('+')} (${labelKey})`
      out[label] = CHECKS[labelKey] ? CHECKS[labelKey]() : 'no check written'
    }
    g._exitBuildMode()
    return out
  })

  for (const [label, ok] of Object.entries(result)) expect(ok, label).toBe(true)
})
