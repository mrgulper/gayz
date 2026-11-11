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

test('the HUD settings (ideas 25-38) work in a game', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    const set = (id, v) => {
      const el = document.getElementById(id)
      if (el.type === 'checkbox') { el.checked = v; el.dispatchEvent(new Event('change')) } else { el.value = v; el.dispatchEvent(new Event(el.type === 'range' ? 'input' : 'change')) }
    }
    out.rows = ['ms-hud-scale', 'ms-hide-hud', 'ms-minimap-size', 'ms-minimap-rotate', 'ms-kill-feed', 'ms-hit-marker', 'ms-low-ammo-warning',
      'ms-show-ping', 'ms-hud-clock', 'ms-show-coords', 'ms-compass-bar', 'ms-chat-opacity', 'ms-chat-fade', 'ms-health-display']
      .filter((id) => document.getElementById(id)?.closest('#settings-page-controls')).length
    out.hideKey = !!document.querySelector('#controls-grid')?.textContent.includes('Hide HUD')
    set('ms-hud-clock', 'real')
    set('ms-show-coords', true)
    set('ms-compass-bar', true)
    set('ms-minimap-size', 'big')
    set('ms-health-display', 'number')
    set('ms-hud-scale', 120)
    set('ms-hit-marker', false)
    await g._enterBuildMode({ map: 'map3' })
    const b = g.buildMode
    b.update(0.016)
    b.survival.start()
    const s = b.survival
    const step = (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) b.update(dt) }
    step(8)
    out.mapBig = b.tryMode._mapEl.dataset.size
    out.info = document.getElementById('play-hud-info')?.textContent || ''
    out.compass = getComputedStyle(document.getElementById('play-compass')).display
    out.healthText = getComputedStyle(document.getElementById('build-play-health-fill')).display
    out.scale = getComputedStyle(document.getElementById('build-play-ammo')).scale
    out.noHit = document.documentElement.classList.contains('no-hitmarker')
    // F1 hides the HUD and saves it; again shows it.
    const key = (code) => { b._onKeyDown({ code, repeat: false, target: null, preventDefault() {} }); b._onKeyUp({ code, repeat: false, target: null, preventDefault() {} }) }
    key('F1'); step()
    out.hidden = document.body.classList.contains('hud-hidden') && g.settings.hideHud && getComputedStyle(document.getElementById('build-play-ammo')).visibility === 'hidden'
    key('F1'); step()
    out.shown = !document.body.classList.contains('hud-hidden')
    // A kill of mine shows in the kill feed.
    s.kills++
    step()
    out.feed = [...document.querySelectorAll('.kill-feed-line')].map((e) => e.textContent)
    // Low ammo.
    s._reloadLeft = 0
    s.mag = 1
    step()
    out.lowAmmo = document.getElementById('build-play-ammo').dataset.low || ''
    s.mag = s.magSize()
    step()
    out.lowGone = !document.getElementById('build-play-ammo').classList.contains('low-ammo')
    // Chat fades 5 s after the newest message.
    set('ms-chat-fade', '5')
    const realNow = performance.now
    performance.now = () => realNow.call(performance) + 6000
    try { step() } finally { performance.now = realNow }
    out.chatFaded = document.getElementById('chat-panel').classList.contains('chat-faded')
    // (A real-time frame again, so the clean-up below sees the game stop.)
    set('ms-chat-fade', 'off')
    step()
    // Placed clear of the corner map (under it, or beside it when the big map fills the right edge).
    const m = b.tryMode._mapEl.getBoundingClientRect()
    const i = document.getElementById('play-hud-info').getBoundingClientRect()
    out.infoClearOfMap = i.top >= m.bottom || i.right <= m.left
    s.stop()
    step(2)
    await new Promise((res) => setTimeout(res, 700))
    out.cleanedUp = document.getElementById('play-hud-info').style.display === 'none' && !document.body.classList.contains('hud-hidden')
    g._exitBuildMode()
    return out
  })
  expect(r).toMatchObject({
    rows: 14, hideKey: true, mapBig: 'big', compass: 'block', healthText: 'none', scale: '1.2', noHit: true,
    hidden: true, shown: true, feed: ['You took down a zombie'], lowAmmo: 'Low ammo', lowGone: true, chatFaded: true, infoClearOfMap: true, cleanedUp: true,
  })
  expect(r.info).toMatch(/Time .+\nX -?\d+ {2}Y -?\d+ {2}Z -?\d+/)
})

test('the Graphics settings (ideas 39-50) work in a game', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    const set = (id, v) => {
      const el = document.getElementById(id)
      if (el.type === 'checkbox') { el.checked = v; el.dispatchEvent(new Event('change')) } else { el.value = v; el.dispatchEvent(new Event(el.type === 'range' ? 'input' : 'change')) }
    }
    out.rows = ['ms-screen-shake', 'ms-particle-amount', 'ms-grass-tufts', 'ms-clouds-enabled', 'ms-weather-effects', 'ms-blood-style',
      'ms-zombie-outline', 'ms-battery-saver', 'ms-gamma', 'ms-saturation', 'ms-sharpen', 'ms-hand-fov']
      .filter((id) => document.getElementById(id)?.closest('#settings-page-graphics')).length
    out.heading = document.getElementById('settings-section-effects')?.textContent
    // Gamma / saturation / sharpen go on the canvas's filter; nothing at the defaults.
    out.filterDefault = g.canvas.style.filter
    set('ms-saturation', 150)
    set('ms-gamma', 120)
    out.filter = g.canvas.style.filter
    set('ms-saturation', 100)
    set('ms-gamma', 100)
    out.filterBack = g.canvas.style.filter
    // Battery Saver On: 30 fps cap; Off: back to the FPS Cap setting.
    set('ms-battery-saver', 'on')
    out.saverMs = Math.round(g._fpsCapMinFrameMs)
    set('ms-battery-saver', 'off')
    out.saverOffMs = g._fpsCapMinFrameMs
    set('ms-battery-saver', 'auto')

    await g._enterBuildMode({ map: 'map3' })
    const b = g.buildMode
    b.update(0.016)
    b.survival.start()
    const s = b.survival
    const step = (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) b.update(dt) }
    step(8)
    // Screen shake: 0% none, 200% double.
    const view = b.renderer.domElement
    set('ms-screen-shake', 0)
    view.classList.remove('boom-shake')
    s._shake(5)
    out.shakeOff = !view.classList.contains('boom-shake')
    set('ms-screen-shake', 200)
    s._shake(5)
    out.shakeDouble = view.style.getPropertyValue('--boom')
    set('ms-screen-shake', 100)
    // Particles: Low makes far fewer than High.
    const Vec = b.camera.position.constructor
    const made = () => {
      const n0 = s._fx._next
      s._fx.explode(new Vec(0, 50, 0), 2)
      return (s._fx._next - n0 + 220) % 220
    }
    out.particlesHigh = made()
    set('ms-particle-amount', 'low')
    out.particlesLow = made()
    set('ms-particle-amount', 'high')
    // Blood: green goo from a zombie; Off: nothing.
    const colors = []
    const realBlood = s._fx.blood.bind(s._fx)
    s._fx.blood = (x, y, z, c, size) => { colors.push(c); realBlood(x, y, z, c, size) }
    let z = null
    for (let i = 0; i < 20 && !z; i++) { s._spawnZombie(); z = s.zombies[0] }
    if (z) {
      z.health = 9999
      s.damageZombie(z, 1)
      z._bledAt = 0
      set('ms-blood-style', 'off')
      s.damageZombie(z, 1)
      set('ms-blood-style', 'normal')
    }
    out.blood = colors
    // Clouds off: the cloud layer goes see-through.
    set('ms-clouds-enabled', false)
    step(2)
    out.cloudOpacity = b.sky.bodies.cloudMat.uniforms.opacity.value
    set('ms-clouds-enabled', true)
    // Weather off: no falling rain.
    const w = b.sky.weather3d
    w.set('hardRain')
    step(4)
    out.rainOn = w.points.visible
    set('ms-weather-effects', false)
    step()
    out.rainHidden = !w.points.visible
    set('ms-weather-effects', true)
    // Zombie outline: a zombie behind a wall is drawn again on layer 7.
    let outlineDraws = 0
    const realRender = b.renderer.render.bind(b.renderer)
    b.renderer.render = (sc, cam) => { if (cam.layers.mask === 1 << 7) outlineDraws++; return realRender(sc, cam) }
    if (z) {
      const B = s.B
      const cx = Math.floor(b.camera.position.x / B)
      const cy = Math.floor(b.camera.position.y / B)
      const cz = Math.floor(b.camera.position.z / B)
      for (let dy = -3; dy <= 4; dy++) for (let dz = -3; dz <= 3; dz++) b.placeBlock(cx + 4, cy + dy, cz + dz, 'stone')
      z.x = cx + 8.5
      z.z = cz + 0.5
      z.y = cy - 1
      b.render()
      out.outlineOffDraws = outlineDraws
      set('ms-zombie-outline', true)
      b.render()
      out.outlineOnDraws = outlineDraws
      set('ms-zombie-outline', false)
    }
    b.renderer.render = realRender
    s.stop()
    step(2)
    g._exitBuildMode()
    return out
  })
  expect(r).toMatchObject({
    rows: 12, heading: 'Effects', filterDefault: 'none', filterBack: 'none', saverMs: 33, saverOffMs: 0,
    shakeOff: true, shakeDouble: '10.0px', cloudOpacity: 0, rainOn: true, rainHidden: true, outlineOffDraws: 0,
  })
  expect(r.filter).toContain('saturate(150%)')
  expect(r.filter).toContain('#gfx-post')
  expect(r.particlesLow).toBeLessThan(r.particlesHigh * 0.6)
  expect(r.blood).toEqual([0x6fbf3a])
  expect(r.outlineOnDraws).toBeGreaterThan(0)
})

test('the Gameplay settings (ideas 51-62) work in a game', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    const set = (id, v) => {
      const el = document.getElementById(id)
      if (el.type === 'checkbox') { el.checked = v; el.dispatchEvent(new Event('change')) } else { el.value = v; el.dispatchEvent(new Event('change')) }
    }
    out.rows = ['ms-auto-reload', 'ms-auto-sort-inventory', 'ms-confirm-sell', 'ms-confirm-buy-over', 'ms-loot-highlight', 'ms-game-tips',
      'ms-pause-when-hidden', 'ms-afk-pause', 'ms-spoiler-free-story', 'ms-replay-tutorial', 'ms-reset-hints']
      .filter((id) => document.getElementById(id)?.closest('#settings-page-controls')).length
    out.btnText = document.getElementById('ms-reset-hints').textContent
    // Spoiler-Free: the html class blurs the Story card.
    set('ms-spoiler-free-story', true)
    out.spoilerClass = document.documentElement.classList.contains('spoiler-free')
    set('ms-spoiler-free-story', false)
    // Replay Tutorial / Reset Hints buttons.
    localStorage.setItem('gayz-hint-counts', JSON.stringify({ kart: 3 }))
    document.getElementById('ms-replay-tutorial').click()
    out.replayFlag = localStorage.getItem('gayz-replay-tutorial')
    out.hintsCleared = localStorage.getItem('gayz-hint-counts')
    localStorage.removeItem('gayz-replay-tutorial')
    // Buttons aren't settings.
    out.notSaved = !('resetHints' in g.settings) && !('replayTutorial' in g.settings)

    await g._enterBuildMode({ map: 'map3' })
    const b = g.buildMode
    b.update(0.016)
    b.survival.start()
    const s = b.survival
    const step = (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) b.update(dt) }
    step(4)
    // Auto-Reload: the last bullet starts a reload; off, it doesn't.
    s.holding = null
    s._equipWeapon('pistol')
    s.holding = null
    const lastShot = () => { s._reloadLeft = 0; s.mag = 1; s.reserve = 20; s._nextShotAt = 0; s.tryFire(); return s._reloadLeft > 0 }
    out.autoReloadOn = lastShot()
    set('ms-auto-reload', false)
    out.autoReloadOff = lastShot()
    set('ms-auto-reload', true)
    s._reloadLeft = 0
    // Auto-Sort: armor goes before blocks in the bag.
    s.inv.grid.fill(null)
    s.inv.hotbar.fill(null)
    s.inv.hotbar[0] = { kind: 'gun', id: 'pistol', n: 1 }
    for (let i = 1; i < 10; i++) s.inv.hotbar[i] = { kind: 'block', id: 'stone', n: 999 }
    s.inv.grid[5] = { kind: 'block', id: 'dirt', n: 3 }
    set('ms-auto-sort-inventory', true)
    s.inv.add({ kind: 'item', id: 'helmet', n: 1 })
    out.sorted = s.inv.grid.slice(0, 3).map((it) => it?.id || null)
    set('ms-auto-sort-inventory', false)
    // Confirm Buying Over 100: a 120-coin upgrade needs two clicks; Never: one.
    s.coins = 1000
    s.shop.openPanel()
    s.shop.tab = 'upgrades'
    s.shop._panelKey = ''
    set('ms-confirm-buy-over', '100')
    s.shop._click('upgrade', 'damage')
    out.afterOneClick = s.coins
    out.sureShown = !!document.querySelector('#play-npc-panel button.buy-sure')
    s.shop._click('upgrade', 'damage')
    out.afterTwoClicks = s.coins
    set('ms-confirm-buy-over', 'never')
    s.shop._click('buy', 'medkit')
    out.afterNever = s.coins
    set('ms-confirm-buy-over', '100')
    s.shop.closePanel(false)
    // Loot Glow / Beams on a Loot Chest next to you.
    const p = s.bodyPos()
    b.placeBlock(Math.floor(p.x) + 2, Math.floor(p.y), Math.floor(p.z), 'lootchest')
    set('ms-loot-highlight', 'beam')
    step(2)
    out.marks = s.lootMarks.shown
    out.beamVisible = !!s.lootMarks.marks[0]?.beam.visible
    set('ms-loot-highlight', 'off')
    step()
    out.marksOff = s.lootMarks.shown
    // Game Tips: Off shows none on the pause screen.
    s.fromMenu = true
    set('ms-game-tips', 'off')
    b.toggleMenu()
    out.tipOff = document.getElementById('play-pause-tip').textContent
    b.toggleMenu()
    set('ms-game-tips', 'helpful')
    b.toggleMenu()
    out.tipHelpful = document.getElementById('play-pause-tip').textContent
    b.toggleMenu()
    set('ms-game-tips', 'silly')
    // Pause When Tab Is Hidden.
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    delete document.visibilityState
    out.pausedHidden = b.menuOpen
    out.pauseNote = document.getElementById('play-pause-status').textContent
    if (b.menuOpen) b.toggleMenu()
    // AFK Pause after 1 minute.
    set('ms-afk-pause', '1')
    g._testIdle(61000)
    b._keys.clear()
    step()
    out.pausedAfk = b.menuOpen
    out.afkNote = document.getElementById('play-pause-status').textContent
    if (b.menuOpen) b.toggleMenu()
    set('ms-afk-pause', 'off')
    s.stop()
    step(2)
    g._exitBuildMode()
    return out
  })
  expect(r).toMatchObject({
    rows: 11, btnText: 'Reset', spoilerClass: true, replayFlag: '1', hintsCleared: null, notSaved: true,
    autoReloadOn: true, autoReloadOff: false, sorted: ['helmet', 'dirt', null],
    afterOneClick: 1000, sureShown: true, afterTwoClicks: 880, afterNever: 840,
    beamVisible: true, marksOff: 0, tipOff: '', pausedHidden: true, pauseNote: 'Paused while you were in another tab.',
    pausedAfk: true, afkNote: 'Paused - no input for 1 min.',
  })
  expect(r.marks).toBeGreaterThan(0)
  expect(r.tipHelpful).toMatch(/^Tip: /)
})

test('the Social & Safety settings (ideas 63-72) work', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    const tick = () => new Promise((res) => setTimeout(res, 400))
    const set = async (id, v) => {
      const el = document.getElementById(id)
      if (el.type === 'checkbox') el.checked = v
      else el.value = v
      el.dispatchEvent(new Event('change'))
      await tick()
    }
    out.rows = ['ms-chat-filter', 'ms-hide-chat', 'ms-friends-only-chat', 'ms-friend-requests-from', 'ms-hide-clan',
      'ms-hide-currency', 'ms-server-access', 'ms-postcards-from']
      .filter((id) => document.getElementById(id)?.closest('#settings-page-general')).length
    out.label = document.getElementById('ms-server-access-label').textContent
    // Chat Filter + Friends-Only redraw the in-game chat list.
    const saved = g.settings.savedFriends
    g.settings.savedFriends = [{ name: 'Pal', uid: 'u-pal' }]
    g._chatSessionStartMs = 0
    // Pinned: the (offline) chat feed would swap in its own empty list.
    const msgs = [{ nickname: 'Pal', uid: 'u-pal', text: 'you are stupid', createdAt: 5 }, { nickname: 'Stranger', text: 'hi www.spam.com', createdAt: 6 }]
    Object.defineProperty(g, '_lastChatMsgs', { configurable: true, get: () => msgs, set: () => {} })
    // ...and its empty redraws clear the list, so keep the last real one.
    let drawn = ''
    const inner = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')
    Object.defineProperty(g.chatMessages, 'innerHTML', { configurable: true, get() { return inner.get.call(this) }, set(v) { if (v) drawn = v; inner.set.call(this, v) } })
    const shown = () => { const d = document.createElement('div'); d.innerHTML = drawn; return d.textContent }
    await set('ms-chat-filter', 'normal')
    out.normal = shown()
    await set('ms-chat-filter', 'strict')
    out.strict = shown()
    await set('ms-friends-only-chat', true)
    out.friendsOnly = shown()
    await set('ms-friends-only-chat', false)
    await set('ms-chat-filter', 'normal')
    g.settings.savedFriends = saved
    delete g._lastChatMsgs
    delete g.chatMessages.innerHTML
    // Hide Chat and Hide My Coins are html classes.
    await set('ms-hide-chat', true)
    out.chatHidden = getComputedStyle(document.getElementById('chat-panel')).display
    await set('ms-hide-chat', false)
    await set('ms-hide-currency', true)
    out.coinBlur = getComputedStyle(document.getElementById('currency-coins-amount')).filter
    await set('ms-hide-currency', false)
    out.coinBlurOff = getComputedStyle(document.getElementById('currency-coins-amount')).filter
    return out
  })
  expect(r.rows).toBe(8)
  expect(r.label).toBe('Who Can Join My Server')
  expect(r.normal).toContain('you are stupid')
  expect(r.strict).toContain('you are ******')
  expect(r.strict).toContain('[link]')
  expect(r.friendsOnly).toContain('Pal')
  expect(r.friendsOnly).not.toContain('Stranger')
  expect(r.chatHidden).toBe('none')
  expect(r.coinBlur).toContain('blur')
  expect(r.coinBlurOff).toBe('none')
})

test('Social & Safety: public profile, postcards and the strict filter', async () => {
  const { applyPublicPrivacy, postcardShows, strictClean, chatShows } = await import('../src/game/SocialSettings.js')
  expect(applyPublicPrivacy({ hideCurrency: true, hideClan: true }, { lastRunCoins: 5, bestRunCoins: 9, clanId: 'c1' })).toEqual({ clanId: 'c1', hideCoins: true, hideClan: true })
  expect(applyPublicPrivacy({}, { lastRunCoins: 5 })).toEqual({ lastRunCoins: 5 })
  const friends = [{ name: 'Pal', uid: 'u-pal' }]
  expect(postcardShows({ postcardsFrom: 'friends', savedFriends: friends }, { fromUid: 'u-pal' })).toBe(true)
  expect(postcardShows({ postcardsFrom: 'friends', savedFriends: friends }, { fromUid: 'u-x', fromNickname: 'X' })).toBe(false)
  expect(postcardShows({ postcardsFrom: 'nobody', savedFriends: friends }, { fromUid: 'u-pal' })).toBe(false)
  expect(strictClean('GET OVER HERE #AB12CD')).toBe('get over here #AB12CD')
  expect(strictClean('class assassin')).toBe('class assassin')
  expect(chatShows({ friendsOnlyChat: true, nickname: 'Me', savedFriends: friends }, { nickname: 'Me' })).toBe(true)
})
