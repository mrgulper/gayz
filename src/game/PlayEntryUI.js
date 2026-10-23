// Getting into a game: Play and the Map Editor (fading out, loading
// BuildMode, entering/leaving), the Game Mode picks that become the run's
// config, difficulty, and the editor's automatic resolution.
//
// Moved out of Game.js (2026-10-16, bit by bit - see CLAUDE.md). Plain functions
// taking `game`, all state on the Game instance; Game.js keeps a one-line
// stand-in for each, so callers are unchanged.
import { DIFFICULTY_PRESETS, EDITOR_FADE_OUT_MS, FADE_IN_FAST_MS, FADE_IN_SLOW_MS, FADE_LAG_FRAME_MS, FADE_LAG_LOAD_MS, PLAY_FADE_MS, saveSettings } from './Game.js'
import { seedFromText } from './OpenWorld.js'
import { PlayNet } from './PlayNet.js'
import { loadEarthTerrain } from './EarthTerrain.js'
import { playConfig } from './PlayRules.js'
import { t } from './i18n.js'

export function _bindDifficulty(game) {
  for (const btn of game.difficultyBtns) {
    btn.classList.toggle('active', btn.dataset.difficulty === game.settings.difficulty)
    btn.addEventListener('click', () => {
      const id = btn.dataset.difficulty
      if (!DIFFICULTY_PRESETS[id]) return
      game.settings.difficulty = id
      saveSettings(game.settings)
      game.difficulty = DIFFICULTY_PRESETS[id]
      for (const b of game.difficultyBtns) b.classList.toggle('active', b === btn)
    })
  }
}

// Game Modes grid (Choose Your Challenge) - single-select like Choose
// Class's role/loadout buttons above, not the general checkbox mutators
// list. Locked (Coming Soon) entries carry a real `disabled` attribute
// in the HTML, so they never reach this click handler at all - no extra
// guard needed here for those. zombieDefense/bossHunt/zombieRush each
// just flip the matching settings.mutators.* flag Map 1's run setup
// (PlayRules.playConfig) reads.
export function _bindGameModeSelect(game) {
  for (const btn of game.gameModeSelectBtns) {
    btn.classList.toggle('active', btn.dataset.gameMode === game.settings.selectedGameMode)
    btn.addEventListener('click', () => {
      const mode = btn.dataset.gameMode
      const wasZombieRush = game.settings.selectedGameMode === 'zombieRush'
      const isZombieRush = mode === 'zombieRush'
      game.settings.selectedGameMode = mode
      game.settings.mutators.zombieDefense = mode === 'zombieDefense'
      game.settings.mutators.bossHunt = mode === 'bossHunt'
      game.settings.mutators.zombieRush = isZombieRush
      // Zombie Rush's "limited resources" - reuses Iron Mode's existing
      // no-Trader/no-Shop-spending restriction rather than a new one.
      // Only touched on an actual enter/exit of Zombie Rush (not on
      // every click, e.g. re-clicking the already-active tile or
      // switching between two other modes) - forcing it on remembers
      // whatever the player's own Iron Mode checkbox was set to first,
      // so leaving Zombie Rush restores their real preference instead
      // of always resetting it to off. Also re-syncs the actual
      // checkbox in the Mutators panel, which otherwise silently
      // disagreed with settings.mutators.ironMode.
      if (isZombieRush && !wasZombieRush) {
        game._ironModeBeforeZombieRush = game.settings.mutators.ironMode
        game.settings.mutators.ironMode = true
      } else if (!isZombieRush && wasZombieRush) {
        game.settings.mutators.ironMode = game._ironModeBeforeZombieRush ?? false
      }
      if (game.mutatorIronMode) game.mutatorIronMode.checked = game.settings.mutators.ironMode
      saveSettings(game.settings)
      for (const b of game.gameModeSelectBtns) b.classList.toggle('active', b === btn)
    })
  }
}

// The editor's code (BuildMode.js and everything it imports) - one
// download shared by the idle preload and _enterBuildMode.
export function _preloadBuildMode(game) {
  if (!game._buildModeImport) {
    game._buildModeImport = import('./BuildMode.js')
    game._buildModeImport.catch(() => { game._buildModeImport = null })
  }
  return game._buildModeImport
}

// Build Mode - a standalone block-placing sandbox (see BuildMode.js's own
// comment), reachable from the homepage. Reuses this.menu's existing
// hide/show pattern (same as starting a real run) rather than a new panel.
// map: 'map3' opens the ready-made Map 3 city (Map3Generator.js); 'map2'
// leaves it for the player's own slots. Omitted keeps the last slot.
// play: start Play (zombie waves, BuildSurvival.js) on it straight away -
// Game Mode's Map 3 + the Play button.
// server: a server joined or made from the Global panel (ServerBrowser.js)
// - the run is played with the others on it (PlayNet.js).
export async function _enterBuildMode(game, { map, play = false, server = null } = {}) {
  // A second click while the code is still downloading does nothing.
  if (game._enteringBuildMode) return
  // No "Loading Map Editor..." screen any more (2026-10-10, Gaymi: "dont
  // make it loading game just load the game"): the homepage stays up
  // while the code loads (already fetched in the background, see
  // _preloadBuildMode) and is hidden in the same frame the map appears.
  // Play fades the screen to black first and does the heavy part (the
  // code, building Map 1) while it's dark, then fades back in on the map
  // - a smooth fade instead of the homepage freezing for a moment
  // (2026-10-10, "make it just slowly fade when it's loading instead of
  // making the page lag").
  game._enteringBuildMode = true
  try {
    // The Map Editor fades too (2026-10-12): a quick dip to black, then
    // a fade back in whose speed follows how heavy the load was.
    game._fadeStartedAt = performance.now()
    await game._fadeScreen(1, play ? PLAY_FADE_MS : EDITOR_FADE_OUT_MS)
    if (typeof game.buildMode.enter !== 'function') {
      const { BuildMode } = await game._preloadBuildMode()
      game.buildMode = new BuildMode(game.renderer, game)
    }
    // The World Map mode's real land (EarthTerrain.js) loads while the
    // screen is dark, so you (and friends joining) are never placed on
    // land that changes once it arrives.
    if (play && (server?.world?.earth || (!server && game._playConfig?.()?.mode === 'worldMap'))) await loadEarthTerrain()
  } catch (e) {
    game._fadeScreen(0)
    throw e
  } finally {
    game._enteringBuildMode = false
  }
  // Every other nav button routes through trackAndOpen/_open*Panel(),
  // which calls _closeAllMenuPanels() first (see that function's own
  // comment on the z-index/stacking bug game prevents). Build Mode
  // isn't one of those panels (it hides game.menu itself instead), but
  // the panels themselves are siblings of #menu, not children of it -
  // hiding #menu does NOT hide an already-open panel. Currently
  // unreachable through a normal click (every panel sits at a higher
  // z-index than #menu and blocks the nav button underneath), but
  // calling it here too is a one-line no-op the rest of the time and
  // closes the gap for any future path that reaches _enterBuildMode()
  // without going through a blocked nav click first.
  game._closeAllMenuPanels()
  // Deferred a tick (queueMicrotask, not called inline here) - the
  // _closeAllMenuPanels() call above, when it actually closes something
  // (e.g. entering from the Map 2 tile in the Game Mode panel), flips a
  // routable panel's display:none, which _bindPanelRouting's own
  // MutationObserver reacts to on its OWN microtask by pushing '/' (no
  // routable panel reads as "open" anymore - Build Mode isn't one of
  // _routes). That observer microtask was queued first (the mutation
  // happened above, before game line), so an inline pushState here would
  // still lose the race and get silently overwritten back to '/' the
  // instant the observer's callback ran. Queueing game one as its own
  // microtask puts it strictly after the observer's in the same FIFO
  // queue, so '/map-editor' is the last write and actually sticks -
  // verified live (was reproducibly overwritten back to '/' without
  // game). Harmless no-op when entered from the bare homepage nav
  // button instead (nothing closes, no mutation, no race to lose).
  queueMicrotask(() => {
    if (location.pathname !== '/map-editor') history.pushState({}, '', '/map-editor')
  })
  // Build Mode is only ever reachable from the homepage nav (#menu is
  // hidden the instant a real run starts, see the 'lock' handler), but
  // force game false regardless rather than trust that precondition -
  // the 'lock'/'unlock' handlers above both gate on it, and a stray
  // true here would make Build Mode's own pointer-lock cycle re-trigger
  // the entire real-run HUD on top of it.
  game.gameStarted = false
  // A homepage toast still fading out (e.g. the backup reminder) would
  // otherwise sit over the editor.
  if (game.loreToast) game.loreToast.classList.remove('show')
  // Build Mode is a standalone sandbox with its own scene/camera, but it
  // reuses the same shared renderer/DOM as the zombie survival game (see
  // BuildMode.js's own comment) - so any real-run HUD element that was
  // left visible (health/armor, weather overlay, etc.) sits on top of it
  // with nothing to cover it, since #menu is hidden here too.
  // Chat stays with you in the Map Editor and Try Map (Enter to type).
  game.chatPanel.style.display = 'flex'
  document.body.classList.add('build-mode-on')
  // The weather overlays start hidden; the Map Editor's own weather
  // (BuildSky.js) switches them on once it's open.
  if (game.rainOverlayEl) game.rainOverlayEl.style.display = 'none'
  if (game.rainOverlayHardEl) game.rainOverlayHardEl.style.display = 'none'
  if (game.snowOverlayEl) game.snowOverlayEl.style.display = 'none'
  if (game.snowOverlayHardEl) game.snowOverlayHardEl.style.display = 'none'
  // Exit/Save/Export/Import etc. now live inside #build-menu, which
  // BuildMode.js's own enter()/exit() shows/hides (see toggleMenu) -
  // same pattern already used for its hotbar/slot-picker/tool buttons,
  // nothing left for Game.js to individually toggle here.
  // No auto requestPointerLock() here any more - the mouse used to get
  // captured the instant Build Mode opened, before the player had even
  // gotten oriented. It now starts free; clicking into the viewport
  // acquires it (see BuildMode.js's _onPointerDown), and Escape releases
  // it again at any time (see _onKeyDownPicker).
  if (game._shopTryOn) game._endShopTryOn(false)
  game.menu.style.display = 'none'
  const current = game.buildMode.activeSlot
  const slot = map === 'map3' ? 'map3' : map === 'map2' && current === 'map3' ? 0 : undefined
  game.buildMode.enter({ slot })
  // Map 1's open world grows new land every game (OpenWorld.js) - the
  // same land for everyone on a server, made from its id, and the same land
  // again for a run saved from the pause menu (BuildSurvival.saveRun).
  // (BuildSurvival through the loaded editor - BuildMode.js loads lazily.)
  const savedSeed = play && !server ? game.buildMode.survival?.constructor.savedRun?.()?.seed : null
  // A game made joinable with Invite Friends carries its own world (seed,
  // and the World Map mode's Earth) - see api/_lib/servers.js cleanWorld.
  if (server?.world?.earth) game.buildMode.world?.setEarth(true)
  game.buildMode.world?.reseed(server?.world ? server.world.seed : server?.serverId ? seedFromText(server.serverId) : savedSeed ?? undefined)
  // The 3D canvas isn't resized on the homepage (_onResize) - catch up now.
  if (game._sizeDirty) game._onResize()
  if (play) game.buildMode.survival.start({ fromMenu: true, net: server ? new PlayNet(game, server) : null })
  game._applyRenderScale()
  game._fadeScreen(0)
  // A boss bar left over from a run would otherwise sit over the editor.
  // FPS readout in the top-left corner (the save slot buttons moved into
  // the Escape menu), shown whenever the gameplay one would be.
  game.fpsEl.style.left = '16px'
  game.fpsEl.style.top = '16px'
  game.fpsEl.style.transform = ''
  game.fpsEl.style.opacity = game.settings.hudFpsCounter ? '1' : '0'
  game._fpsFrameCount = 0
  game._fpsLastUpdate = performance.now()
  // Opening the editor builds every chunk - don't judge fps on that.
  game._editorResHoldUntil = performance.now() + 2000
}

// Fades #play-fade (a black cover over everything) in (1) or out (0).
// Resolves once the fade has finished and the screen has painted, so
// work done after `await this._fadeScreen(1)` happens behind black. Fading
// out waits two frames first, so the map's first frame is already drawn.
export async function _fadeScreen(game, to, ms = PLAY_FADE_MS) {
  let el = document.getElementById('play-fade')
  if (!el) {
    el = document.createElement('div')
    el.id = 'play-fade'
    document.body.appendChild(el)
  }
  const frame = () => new Promise((r) => requestAnimationFrame((t) => r(t)))
  if (to) {
    el.style.transitionDuration = ms + 'ms'
    el.style.display = 'block'
    void el.offsetWidth
    el.classList.add('on')
    await new Promise((r) => setTimeout(r, ms))
    await frame()
    await frame()
    return
  }
  // Fading back in: slowly if the load was heavy or the first frames on
  // the map are still slow (it would stutter otherwise), quickly if not
  // (2026-10-12, "make it slowly fade in if it's lagging, if not just
  // make it fade in faster").
  const loadMs = performance.now() - (game._fadeStartedAt || performance.now())
  let last = await frame()
  let slowest = 0
  for (let i = 0; i < 4; i++) {
    const t = await frame()
    slowest = Math.max(slowest, t - last)
    last = t
  }
  const lagging = loadMs > FADE_LAG_LOAD_MS || slowest > FADE_LAG_FRAME_MS
  const inMs = lagging ? FADE_IN_SLOW_MS : FADE_IN_FAST_MS
  game._lastFadeIn = { loadMs: Math.round(loadMs), slowest: Math.round(slowest), inMs }
  el.style.transitionDuration = inMs + 'ms'
  el.classList.remove('on')
  setTimeout(() => {
    if (!el.classList.contains('on')) el.style.display = 'none'
  }, inMs)
}

// The run settings for a Map 1 run from the homepage: Game Mode's
// Difficulty / Game Modes / Challenges & Mutators, plus
// the Upgrades bought with Legacy Points (PlayRules.js).
export function _playConfig(game) {
  return {
    ...playConfig({
      difficulty: DIFFICULTY_PRESETS[game.settings.difficulty] || DIFFICULTY_PRESETS.normal,
      gameMode: game.settings.selectedGameMode,
      mutators: game.settings.mutators,
      purchased: game.metaProgress.purchased,
    }),
    // Read by achievements (what the run was played on).
    difficulty: game.settings.difficulty,
  }
}

export function _exitBuildMode(game) {
  game.buildMode.exit()
  game._topBar?.hide()
  game.chatPanel.style.display = 'none'
  document.body.classList.remove('build-mode-on')
  game._applyRenderScale()
  game.fpsEl.style.left = '6px'
  game.fpsEl.style.top = '6px'
  game.fpsEl.style.transform = ''
  game.fpsEl.style.opacity = game.settings.homepageFpsCounter ? '1' : '0'
  document.exitPointerLock()
  // Defensive reset, not just un-suspending - a stray real jump/fall
  // velocity firing for real the instant _tick() resumes calling
  // game.player.update() again would be a jarring launch off the
  // homepage's own spawn point.
  game.menu.style.display = ''
  if (location.pathname === '/map-editor') history.pushState({}, '', '/')
  // Back on the homepage - say so if a newer version was deployed.
  game._checkForUpdate()
}

// Recommended Difficulty hint - only shown once a difficulty has at
// least MIN_RUNS_FOR_HINT runs logged (career-wide, never resets), so
// it never guesses off a single unlucky/lucky run. Flags the current
// difficulty specifically when its own death rate is high, nudging
// toward Normal rather than computing a full skill rating.
export function _updateRecommendedDifficultyHint(game) {
  if (!game.recommendedDifficultyHint) return
  const MIN_RUNS_FOR_HINT = 3
  const current = game.careerStats.difficultyStats[game.settings.difficulty]
  if (!current || current.runs < MIN_RUNS_FOR_HINT) {
    game.recommendedDifficultyHint.style.display = 'none'
    return
  }
  const deathRate = current.deaths / current.runs
  if (deathRate >= 0.8 && game.settings.difficulty !== 'easy') {
    game.recommendedDifficultyHint.textContent = t('recommendedDifficultyEasier')
    game.recommendedDifficultyHint.style.display = ''
  } else if (deathRate <= 0.2 && game.settings.difficulty !== 'apex') {
    game.recommendedDifficultyHint.textContent = t('recommendedDifficultyHarder')
    game.recommendedDifficultyHint.style.display = ''
  } else {
    game.recommendedDifficultyHint.style.display = 'none'
  }
}

// Every render of the main scene goes through here - the per-frame one in
// _tick and the portrait capture - so they
// all use the same path and therefore the same compiled shader variants
// (three.js compiles a separate variant of every material for rendering
// straight to the canvas vs. into a render target, since tone mapping/
// color space conversion happen in-shader only for the former; warming up
// one path and then playing on the other would compile every material
// again on the first frames of a run).
//
// The composer only earns its keep when a post effect is actually on.
// With bloom/AO/motion blur all off (the default - LOW_QUALITY_MODE keeps
// bloom off, AO and motion blur are opt-in), it still rendered the whole
// scene into an offscreen target and then copied that to the screen in a
// second fullscreen OutputPass - an extra full-resolution read+write every
// frame for an identical image, since rendering straight to the canvas
// applies the same toneMapping/outputColorSpace OutputPass exists to apply
// to an offscreen target.
// Map editor auto resolution (Auto Quality setting) - holds 60 fps by
// giving up high-DPI extra pixels when frames run slow, and taking them
// back once there's headroom. Called every ~500ms with the average frame
// time. Steps down fast (one slow sample), steps up slowly (after 6 good
// samples, never within 20s of a step down), so it settles instead of
// bouncing.
export function _updateEditorResScale(game, msPerFrame, now) {
  if (!game.settings.autoQuality || now < (game._editorResHoldUntil || 0)) return
  const scale = game._editorResScale ?? 1
  // Slow = well over the frame time the player asked for (60 fps, or
  // their FPS Cap) - a 30 cap must not read as "too slow" forever.
  const targetMs = game.settings.fpsCap > 0 ? 1000 / game.settings.fpsCap : 1000 / 60
  // A step that wouldn't change the real pixel ratio (already at the
  // floor) is skipped entirely.
  const down = Math.max(0.25, scale - 0.125)
  const canLower = scale > 0.25 && game._editorPixelRatio(down) < game._editorPixelRatio(scale) - 1e-3
  // Sharpness first (2026-10-18, Gaymi: "the gameplay feels very blurry"):
  // a slow device draws less of the map before it drops any pixels, and
  // gets its pixels back before its view distance.
  if (msPerFrame > targetMs * 1.11) {
    game._editorResGood = 0
    if (game.buildMode.stepAutoView(-1)) {
      game._editorResHoldUntil = now + 2000
      game._editorResUpAfter = now + 20000
    } else if (canLower) {
      game._editorResScale = down
      game._editorResUpAfter = now + 20000
      // Draw straight away - a resize clears the canvas, and waiting for
      // the next frame would show one black frame.
      if (game._applyRenderScale()) game.buildMode.render()
    }
  } else if (msPerFrame < targetMs * 1.05) {
    game._editorResGood = (game._editorResGood || 0) + 1
    if (game._editorResGood >= 6 && now > (game._editorResUpAfter || 0)) {
      game._editorResGood = 0
      if (scale < 1) {
        game._editorResScale = Math.min(1, scale + 0.125)
        if (game._applyRenderScale()) game.buildMode.render()
        game._editorResUpAfter = now + 20000
      } else if (game.buildMode.stepAutoView(1)) {
        game._editorResUpAfter = now + 20000
      }
    }
  } else {
    game._editorResGood = 0
  }
}
