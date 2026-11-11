import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame, waitForGame, hideAssetLoader } from './helpers.js'

test('a settings change persists across a real page reload', async ({ page }) => {
  await gotoAndWaitForGame(page)

  await page.evaluate(() => {
    const g = window.__game
    g.sensitivitySlider.value = 150
    g.sensitivitySlider.dispatchEvent(new Event('input'))
  })

  // A genuine page.reload(), not a reload triggered from inside
  // page.evaluate() - CLAUDE.md documents the latter as unreliable to
  // observe (throws "Execution context was destroyed" mid-call).
  await page.reload()
  await waitForGame(page)
  await hideAssetLoader(page)

  const persisted = await page.evaluate(() => window.__game.settings.sensitivity)
  expect(persisted).toBe(150)
})

test('Restore Default Settings actually resets a changed value', async ({ page }) => {
  // This test does THREE full Game() constructions (initial load, the
  // explicit reload below, and the one _restoreDefaultSettings triggers) -
  // playwright.config.js's global 120s timeout was sized for "two
  // constructions plus margin" (see its own comment), which this test
  // structurally exceeds under any real system load. That mismatch (not
  // app or test-logic behavior) is what made this test flaky across a long
  // session of otherwise-unrelated work - confirmed by manually driving
  // the exact same reload sequence outside the Playwright runner, which
  // passed reliably every single time. Overriding just this one test's
  // timeout rather than raising the global one, since every other test in
  // the suite really is covered by the existing 120s budget.
  test.setTimeout(240000)
  await gotoAndWaitForGame(page)

  await page.evaluate(() => {
    const g = window.__game
    g.sensitivitySlider.value = 250
    g.sensitivitySlider.dispatchEvent(new Event('input'))
  })
  await page.reload()
  await waitForGame(page)
  await hideAssetLoader(page)

  const beforeRestore = await page.evaluate(() => window.__game.settings.sensitivity)
  expect(beforeRestore).toBe(250)

  // Restore Default Settings reloads the page itself (see
  // _restoreDefaultSettings in Game.js) - trigger it in its own isolated
  // call, wrapped in try/catch for the expected navigation-time error,
  // per CLAUDE.md's documented pattern for reload-triggering actions.
  try {
    await page.evaluate(() => window.__game._restoreDefaultSettings())
  } catch {
    // Expected - the reload can destroy the evaluate context mid-call.
  }
  await page.waitForTimeout(1500)
  await waitForGame(page)
  await hideAssetLoader(page)

  const afterRestore = await page.evaluate(() => window.__game.settings.sensitivity)
  expect(afterRestore).toBe(100) // defaultSettings()'s baseline value
})

// A lost graphics connection pauses the game behind a small note, and
// coming back carries on with Lite Textures on (LiteTextures.js).
test('graphics loss pauses quietly and recovers with Lite Textures', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    const wait = (ms) => new Promise((res) => setTimeout(res, ms))
    const ext = g.renderer.getContext().getExtension('WEBGL_lose_context')
    const out = { liteBefore: g.settings.liteTextures }
    ext.loseContext()
    await wait(500)
    out.paused = g._glLost === true
    out.note = getComputedStyle(document.getElementById('graphics-reconnecting')).display
    out.panel = getComputedStyle(document.getElementById('graphics-lost-panel')).display
    ext.restoreContext()
    await wait(1500)
    out.resumed = g._glLost === false
    out.noteAfter = getComputedStyle(document.getElementById('graphics-reconnecting')).display
    out.liteAfter = g.settings.liteTextures
    let fullSize = 0
    const roots = Object.values(g.weapons.viewmodels)
    for (const root of roots) root.traverse((o) => {
      for (const m of [].concat(o.material || [])) {
        for (const k in m) {
          const tex = m[k]
          if (tex?.isTexture && (tex.image instanceof HTMLImageElement || tex.image instanceof ImageBitmap) && tex.image.width >= 128) fullSize++
        }
      }
    })
    out.fullSizeLeft = fullSize
    // Turning it off puts the full pictures back.
    g.settings.liteTextures = false
    g._applyLiteTextures()
    let restored = 0
    for (const root of roots) root.traverse((o) => { for (const m of [].concat(o.material || [])) for (const k in m) { const tex = m[k]; if (tex?.isTexture && (tex.image instanceof HTMLImageElement || tex.image instanceof ImageBitmap) && tex.image.width >= 128) restored++ } })
    out.restored = restored > 0
    return out
  })

  expect(r.liteBefore).toBe(false)
  expect(r.paused).toBe(true)
  expect(r.note).toBe('flex')
  expect(r.panel).toBe('none')
  expect(r.resumed).toBe(true)
  expect(r.noteAfter).toBe('none')
  expect(r.liteAfter).toBe(true)
  expect(r.fullSizeLeft).toBe(0)
  expect(r.restored).toBe(true)
})

// Settings > Controls > Homepage lists every real nav button (read from
// #menu-nav-buttons, so new ones join on their own), and moving one moves
// the homepage button. A save from before (8 fixed ids) keeps its order,
// with the buttons it never knew slotted in after their HTML neighbour.
test('nav order lists every homepage button and old saves still work', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const result = await page.evaluate(() => {
    const g = window.__game
    const navIds = [...document.querySelectorAll('#menu-nav-buttons > button')].map((b) => b.id)
    g._renderNavOrderList()
    const listed = [...document.querySelectorAll('#nav-order-list .nav-order-row')].map((r) => r.dataset.id)
    document.querySelector('#nav-order-list .nav-order-row[data-id="build-mode-btn"] .nav-order-up').click()
    const sidebar = [...document.querySelectorAll('#menu-nav-buttons > button')].sort((a, b) => a.style.order - b.style.order).map((b) => b.id)
    g.settings.navOrder = ['achievements-btn', 'hub-btn', 'coinshop-btn', 'upgrades-btn', 'server-btn', 'friends-btn', 'quests-btn', 'menu-inventory-btn']
    g._applyNavOrder()
    const old = [...document.querySelectorAll('#menu-nav-buttons > button')].sort((a, b) => a.style.order - b.style.order).map((b) => b.id)
    return { navIds, listed, sidebar, old }
  })
  expect(result.listed).toEqual(result.navIds)
  expect(result.listed).toContain('market-btn')
  expect(result.listed).toContain('build-mode-btn')
  expect(result.sidebar.indexOf('build-mode-btn')).toBe(result.sidebar.indexOf('achievements-btn') - 1)
  expect(result.old.slice(0, 2)).toEqual(['achievements-btn', 'build-mode-btn'])
  // (A save from before the Store button's id changed still works.)
  expect(result.old.indexOf('market-btn')).toBe(result.old.indexOf('store-btn') + 1)
})

// Each tab's Reset to Defaults only resets that tab's settings.
test('a tab reset only resets that tab', async ({ page }) => {
  test.setTimeout(240000)
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    const g = window.__game
    g.settings.masterVolume = 30
    g.settings.sensitivity = 40
    g.settings.timeFormat = '24h'
    localStorage.setItem('gayz-settings', JSON.stringify(g.settings))
  })
  // The reset asks first (themed warning box); Cancel keeps everything.
  const asked = await page.evaluate(() => {
    document.getElementById('reset-audio-defaults-btn').click()
    const open = document.getElementById('reset-confirm-modal').classList.contains('open')
    document.getElementById('reset-confirm-cancel-btn').click()
    return { open, kept: window.__game.settings.masterVolume, closed: !document.getElementById('reset-confirm-modal').classList.contains('open') }
  })
  expect(asked).toEqual({ open: true, kept: 30, closed: true })
  try {
    await page.evaluate(() => {
      document.getElementById('reset-audio-defaults-btn').click()
      document.getElementById('reset-confirm-ok-btn').click()
    })
  } catch {
    // Expected - the reset reloads the page.
  }
  await page.waitForTimeout(1500)
  await waitForGame(page)
  const after = await page.evaluate(() => {
    const s = window.__game.settings
    return { vol: s.masterVolume, sens: s.sensitivity, tf: s.timeFormat }
  })
  expect(after).toEqual({ vol: 100, sens: 40, tf: '24h' })
})

// 2026-10-24: Settings > Graphics level cards. The game picks a level for
// the device once; a card sets the level and the options it owns, and the
// Map Editor follows it (plain or detailed blocks, waves, swaying leaves).
test('graphics levels: picked for the device, cards switch the look', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const detectGraphicsLevel = (gpu, env) => g._detectGraphicsLevel(gpu, env)
    const textureDetail = () => g.buildMode.look?.detail
    const guesses = [
      detectGraphicsLevel('Google SwiftShader', { cores: 8, memory: 8, touch: false }),
      detectGraphicsLevel('Mali-T720', { cores: 4, memory: 2, touch: true }),
      detectGraphicsLevel('Intel(R) UHD Graphics 620', { cores: 4, memory: 8, touch: false }),
      detectGraphicsLevel('ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)', { cores: 10, memory: 8, touch: false }),
      detectGraphicsLevel('NVIDIA GeForce RTX 4070', { cores: 16, memory: 8, touch: false }),
    ]
    const picked = !!g.settings.graphicsLevel && g.settings.graphicsLevel === g._deviceGraphicsLevel
    const cards = document.querySelectorAll('#gfx-level-cards .gfx-level-card').length
    document.querySelector('.gfx-level-card[data-level="simple"]').click()
    const simple = { view: g.settings.viewDistance, shadows: g.settings.shadowsEnabled, select: g.gfxViewDistanceSelect.value }
    await g._enterBuildMode({ map: 'map2' })
    await new Promise((d) => requestAnimationFrame(() => requestAnimationFrame(d)))
    const plain = textureDetail()
    g._applyGraphicsLevel('ultra')
    await new Promise((d) => requestAnimationFrame(() => requestAnimationFrame(d)))
    const fx = g.buildMode._chunks.fx
    const ultra = { detail: textureDetail(), sway: fx.sway.value > 0, waves: fx.waves.value > 0 }
    // 2026-10-25: In Real Life turns the realistic shader all the way up;
    // Potato drops the resolution.
    g._applyGraphicsLevel('irl')
    await new Promise((d) => requestAnimationFrame(() => requestAnimationFrame(d)))
    const real = fx.real.value
    const irlDetail = textureDetail()
    const irlAtlas = g.buildMode._chunks.atlas.image.width
    g._applyGraphicsLevel('potato')
    await new Promise((d) => requestAnimationFrame(() => requestAnimationFrame(d)))
    const potato = { res: g.settings.renderResolution, real: fx.real.value, detail: textureDetail() }
    return { guesses, picked, cards, simple, plain, ...ultra, real, irlDetail, irlAtlas, potato }
  })
  expect(r.guesses).toEqual(['potato', 'simple', 'balanced', 'realistic', 'ultra'])
  expect(r.picked).toBe(true)
  expect(r.cards).toBe(7)
  expect(r.simple).toEqual({ view: 'short', shadows: false, select: 'short' })
  // Simple got the detailed pictures too (2026-10-26); In Real Life the
  // smooth 64x64 ones in a double-size atlas.
  expect(r.plain).toBe(2)
  expect(r.irlDetail).toBe(4)
  expect(r.irlAtlas).toBe(4096)
  expect(r.detail).toBe(2)
  expect(r.sway).toBe(true)
  expect(r.waves).toBe(true)
  expect(r.real).toBe(1)
  expect(r.potato).toEqual({ res: 40, real: 0, detail: 1 })
})

// 2026-10-30: the homepage settings moved from Controls to General, keys
// got their own heading, the Drop key is listed, and General keeps a list
// of every setting you change.
test('homepage settings live in General, and General lists your settings changes', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const general = document.getElementById('settings-page-general')
    const controls = document.getElementById('settings-page-controls')
    const ids = ['nav-order-list', 'bg-mood-select', 'weather-particles-toggle', 'homepage-fps-toggle', 'accent-color-picker', 'layout-density-select', 'cursor-trail-toggle']
    const out = {
      inGeneral: ids.filter((id) => general.contains(document.getElementById(id))).length,
      inControls: ids.filter((id) => controls.contains(document.getElementById(id))).length,
      keyHeading: controls.contains(document.getElementById('settings-section-key-bindings')),
    }
    g._renderControlsGrid()
    out.dropKey = document.getElementById('controls-grid').textContent.includes('Drop Item')
    // A toggle and a list, the way a player changes them.
    document.getElementById('settings-log-clear').click()
    const fps = document.getElementById('homepage-fps-toggle')
    const was = fps.checked
    fps.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    fps.click()
    const mood = document.getElementById('bg-mood-select')
    mood.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    mood.value = 'bloodmoon'
    mood.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((res) => setTimeout(res, 50))
    const rows = [...document.querySelectorAll('#settings-log-list .settings-log-row')].map((row) => row.querySelector('.settings-log-what').textContent)
    out.rows = rows
    out.fpsRow = rows.some((t) => t.includes('Show FPS Counter on Homepage') && t.includes(was ? 'On → Off' : 'Off → On'))
    out.moodRow = rows[0]?.includes('Homepage Background Mood') && rows[0]?.includes('Blood Moon')
    out.saved = JSON.parse(localStorage.getItem('gayz-settings-log')).length
    document.getElementById('settings-log-clear').click()
    out.cleared = document.querySelectorAll('#settings-log-list .settings-log-row').length === 0 && !!document.querySelector('#settings-log-list .settings-log-empty')
    return out
  })
  expect(r).toMatchObject({ inGeneral: 7, inControls: 0, keyHeading: true, dropKey: true, fpsRow: true, moodRow: true, saved: 2, cleared: true })
})

test('the extra Audio settings save, work and reset with the Audio tab', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const live = await page.evaluate(async () => {
    const a = window.__audioEngine
    a.init()
    const set = (id, v) => {
      const el = document.getElementById(id)
      if (el.type === 'checkbox') { el.checked = v; el.dispatchEvent(new Event('change')) } else { el.value = v; el.dispatchEvent(new Event(el.type === 'range' ? 'input' : 'change')) }
    }
    set('ms-music-volume', 30)
    set('ms-mono-audio', true)
    set('ms-quiet-hours', '22')
    set('ms-sound-subtitles', true)
    a.playZombieMoan(1, 0.9)
    return {
      music: Math.round(a.musicGain.gain.value * 100) / 100,
      channels: a.outGain.channelCount,
      caption: document.querySelector('.sound-caption')?.textContent,
    }
  })
  expect(live.channels).toBe(1)
  expect(live.caption).toBe('[zombie growl, right]')
  await page.reload()
  await waitForGame(page)
  await hideAssetLoader(page)
  const saved = await page.evaluate(() => {
    const s = window.__game.settings
    return [s.musicVolume, s.monoAudio, s.quietHours, document.getElementById('ms-music-volume').value]
  })
  expect(saved).toEqual([30, true, '22', '30'])
  await page.evaluate(() => window.__game._resetSettingsTab('audio'))
  await waitForGame(page)
  const reset = await page.evaluate(() => [window.__game.settings.musicVolume, window.__game.settings.monoAudio])
  expect(reset).toEqual([100, false])
})

test('the Controls settings (ideas 11-24) work in a game', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    const set = (id, v) => {
      const el = document.getElementById(id)
      if (el.type === 'checkbox') { el.checked = v; el.dispatchEvent(new Event('change')) } else { el.value = v; el.dispatchEvent(new Event(el.type === 'range' ? 'input' : 'change')) }
    }
    out.rows = ['ms-crouch-mode', 'ms-aim-sensitivity', 'ms-mouse-smoothing', 'ms-camera-smoothness', 'ms-default-camera-view', 'ms-hold-to-interact',
      'ms-controller-support', 'ms-controller-vibration', 'ms-stick-deadzone', 'ms-left-handed-mobile', 'ms-joystick-mode', 'ms-double-tap-sprint', 'ms-gyro-aim']
      .filter((id) => document.getElementById(id)?.closest('#settings-page-controls')).length
    out.autoRunKey = !!document.querySelector('#controls-grid')?.textContent.includes('Auto-Run')
    set('ms-crouch-mode', 'toggle')
    set('ms-hold-to-interact', '0.6')
    set('ms-default-camera-view', 'back')
    await g._enterBuildMode()
    const b = g.buildMode
    b.toggleTryMode()
    b.update(0.016)
    const tm = b.tryMode
    out.view = tm.view
    const key = (code, down) => (down ? b._onKeyDown : b._onKeyUp)({ code, repeat: false, target: null, preventDefault() {} })
    const step = (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) b.update(dt) }
    // Crouch: Toggle - a tap crouches, the next tap stands.
    key('KeyC', true); step(); key('KeyC', false); step(4)
    out.crouchAfterTap = tm._crouch
    key('KeyC', true); step(); key('KeyC', false); step(4)
    out.crouchAfterSecondTap = tm._crouch
    // Auto-Run: on with its key, off with Back.
    key('KeyO', true); key('KeyO', false); step()
    out.autoRunOn = !!tm._autoRun
    key('KeyS', true); step(); key('KeyS', false)
    out.autoRunOffByBack = !tm._autoRun
    // Hold to Interact 0.6 s: nothing at 0.3 s, used by 0.7 s, ring shown meanwhile.
    let used = 0
    const realUse = b._tryUseFromCamera
    b._tryUseFromCamera = () => { used++ }
    key('KeyE', true); step(6)
    out.useEarly = used
    out.ring = document.getElementById('use-hold-ring')?.style.display
    step(8)
    out.useLate = used
    key('KeyE', false)
    b._tryUseFromCamera = realUse
    // A pretend controller: left stick forward, right stick right, then A and Start.
    let rumbles = 0
    const pad = { index: 0, connected: true, mapping: 'standard', axes: [0, -1, 0.6, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), vibrationActuator: { playEffect() { rumbles++; return Promise.resolve() } } }
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad], configurable: true })
    const yaw0 = b._yaw
    step()
    out.padMoveY = Math.round((b._padMove?.y || 0) * 100) / 100
    out.padTurned = b._yaw < yaw0
    pad.buttons[0] = { pressed: true, value: 1 }
    step()
    out.padJumpKey = b._keys.has('Space')
    pad.buttons[0] = { pressed: false, value: 0 }
    step()
    out.padJumpReleased = !b._keys.has('Space')
    // Deadzone: a small push (under 15%) does nothing.
    pad.axes = [0.1, 0, 0, 0]
    step()
    out.deadzoneIgnores = b._padMove === null
    pad.buttons[9] = { pressed: true, value: 1 }
    step()
    out.startPauses = b.menuOpen
    pad.buttons[9] = { pressed: false, value: 0 }
    step()
    pad.buttons[9] = { pressed: true, value: 1 }
    step()
    out.startResumes = !b.menuOpen
    pad.buttons[9] = { pressed: false, value: 0 }
    step()
    // RT shoots, and the controller rumbles with each shot.
    pad.buttons[7] = { pressed: true, value: 1 }
    step()
    out.rtFires = b._fireHeld === true
    out.rumbles = rumbles
    pad.buttons[7] = { pressed: false, value: 0 }
    step()
    out.rtReleased = b._fireHeld === false
    Object.defineProperty(navigator, 'getGamepads', { value: () => [], configurable: true })
    step()
    out.padGone = b._padMove === null
    return out
  })
  expect(r).toMatchObject({
    rows: 13, autoRunKey: true, view: 1,
    crouchAfterTap: true, crouchAfterSecondTap: false,
    autoRunOn: true, autoRunOffByBack: true,
    useEarly: 0, ring: 'block', useLate: 1,
    padMoveY: 1, padTurned: true, padJumpKey: true, padJumpReleased: true, deadzoneIgnores: true,
    startPauses: true, startResumes: true, padGone: true, rtFires: true, rtReleased: true,
  })
  expect(r.rumbles).toBeGreaterThan(0)
})
