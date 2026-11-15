import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

// The player-facing pages that used to be typed by hand and drift from the
// game (2026-10-04): How to Play's keys and the Map Editor pause screen's
// Shortcuts box. These check the pages against the running game.

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
    localStorage.setItem('gayz-keybinds', JSON.stringify({ reload: 'KeyH', sprint: 'KeyP' }))
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
  expect(html).not.toContain('<b>R</b>')
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
      buildMenuInspect: () => { setTry(true); press('KeyX'); const turning = bm.tryMode._inspectT >= 0; setTry(false); return turning },
      buildMenuMapSize: () => { setTry(true); const before = bm.tryMode._mapMode; press('KeyM'); const after = bm.tryMode._mapMode; setTry(false); return after !== before },
      buildMenuCameraView: () => { setTry(true); const before = bm.tryMode.view; press('KeyP'); const after = bm.tryMode.view; setTry(false); return after !== before },
      buildModeUndoBtn: () => { const done = spy('undo'); press('KeyZ', { ctrlKey: true }); return done() === 1 },
      buildModeRedoBtn: () => { const done = spy('redo'); press('KeyY', { ctrlKey: true }); return done() === 1 },
      buildModeSaveBtn: () => { const done = spy('save'); press('KeyS', { ctrlKey: true }); return done() === 1 },
      buildModeMirrorBtn: () => { const before = bm.mirrorMode; press('KeyN'); const after = bm.mirrorMode; if (after !== before) bm.toggleMirror(); return after !== before },
      buildModeLineBtn: () => { const before = bm.lineToolMode; press('KeyL'); const after = bm.lineToolMode; if (after !== before) bm.toggleLineTool(); return after !== before },
      buildModeCopyBtn: () => { const before = bm.copyToolMode; press('KeyC'); const after = bm.copyToolMode; if (after !== before) bm.toggleCopyTool(); return after !== before },
      buildModePasteBtn: () => { const done = spy('pasteClipboard'); press('KeyP'); return done() === 1 },
      buildModeRotateBtn: () => { bm._clipboard = { blocks: [{ dx: 0, dy: 0, dz: 0, type: 'stone' }, { dx: 1, dy: 0, dz: 0, type: 'stone' }], width: 2, height: 1, depth: 1 }; press('KeyQ'); const ok = bm._clipboard.width === 1 && bm._clipboard.depth === 2; bm._clipboard = null; return ok },
      buildModeFillBtn: () => { press('KeyF'); const on = bm.tools.mode === 'fill'; press('KeyF'); return on && !bm.tools.mode },
      buildModeReplaceBtn: () => { press('KeyR'); const on = bm.tools.mode === 'replace'; press('KeyR'); return on && !bm.tools.mode },
      buildModeShapeBtn: () => { const seen = []; for (let i = 0; i < 6; i++) { press('KeyG'); seen.push(bm.tools.mode) } return seen.join() === 'wall,floor,box,circle,ball,' },
      buildMenuBlockPicker: () => { const before = bm.pickerOpen; press('Tab'); const after = bm.pickerOpen; if (after !== before) bm.togglePicker(); return after !== before },
    }

    const out = {}
    for (const [keys, labelKey] of bm.constructor.MENU_SHORTCUTS) {
      const label = `${(typeof keys === 'function' ? keys() : keys).join('+')} (${labelKey})`
      out[label] = CHECKS[labelKey] ? CHECKS[labelKey]() : 'no check written'
    }
    g._exitBuildMode()
    return out
  })

  for (const [label, ok] of Object.entries(result)) expect(ok, label).toBe(true)
})
