# Touch Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GayZ actually playable on a touchscreen (phone/tablet) by adding a fourth input source (touch) alongside keyboard+mouse and the existing gamepad support, without redesigning any menu/HUD layout (that's a later, separate sub-project).

**Architecture:** A new `TouchControls` class feeds the exact same hooks keyboard/mouse/gamepad already feed - `player.input.*` booleans for movement, direct `camera.quaternion` rotation for looking, `weapons.triggerDown`/`weapons.aiming` for combat, and synthetic `KeyboardEvent`s dispatched on `window` for every other action (reload, jump, sprint, crouch, weapon switch, and ~30 extra abilities via a new "More Actions" grid). Two real, previously-hidden gaps surfaced while re-reading the code for this plan (see Tasks 1-2) - both are must-fix prerequisites, not later polish, since without them the game would never visibly "start" or run its gameplay tick at all on a device that never acquires real Pointer Lock.

**Tech Stack:** Vanilla JS, Three.js (camera quaternion/Euler math already used by `_updateGamepad`), native Touch Events API, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-26-touch-controls-design.md`

## Global Constraints

- Every touch control must reuse an existing hook (`player.input.*`, `weapons.triggerDown`/`aiming`, synthetic `KeyboardEvent` on `window` matching `getKeyFor(action)`) rather than duplicate logic - this is the whole point of the design, not a style preference.
- The desktop mouse/keyboard/gamepad path must be completely unaffected - every change either adds a new touch-only path or replaces a call site with a wrapper that behaves identically for the non-touch case.
- `PointerLockControls.lock()`/`.unlock()` must never be called directly when touch mode is active (route through the new `_requestPointerLock()`/`_requestPointerUnlock()` wrappers from Task 2 everywhere).
- Switching the touch-controls override setting requires a page reload - no live hot-swap (matches the spec and this project's existing precedent for settings that need fresh page state, e.g. Import Save).
- Out of scope for this plan: any HUD/menu layout changes for small/portrait screens (a separate later spec), and any performance tuning (also separate, later, informed by real device testing once this plan ships).
- Before applying any edit in any task, re-read the actual current file content fresh (fuzzy-match against the line numbers/snippets below, don't trust them blindly) - this file has been edited heavily all session and line numbers may have drifted since this plan was written.
- This project has no automated test suite - verification is via Playwright driving the real running game (`npx vite` dev server + `page.evaluate()` calls to real game methods), per this project's own CLAUDE.md. Follow its documented Playwright gotchas (poll for `window.__game` instead of `waitForFunction`, force-hide `#asset-loader`, `pkill -f chromium` between batches if stray processes pile up, etc.).
- After each task: run a production build (`npx vite build`) to confirm no syntax/import errors, then commit. Push to GitHub and deploy to Vercel only at the end of the whole plan (Task 14), not after every task - this avoids shipping a half-wired touch layer to production mid-plan.

---

### Task 1: `_isActivelyPlaying()` helper - fix the gameplay gates that would silently never run on touch

**Why this has to come first:** re-reading `Game.js`'s main tick loop fresh surfaced that `this.player.update(dt)` itself - the actual movement/physics integration - only runs inside a branch gated on `this.player.controls.isLocked` (currently around line 21449: `} else if (this.player.controls.isLocked && this.playerState.alive && !this.inventoryOpen && ...) { this.player.update(dt) ... }`). Real Pointer Lock is never requested on a touch device in this plan (see Task 2), so `isLocked` would stay `false` forever - meaning `player.update()`, weapon updates, hotbar refresh, stamina/hunger/thirst/warmth, and `_updateGamepad`/the future `TouchControls.update()` call would ALL silently never run, even though the joystick/buttons would correctly be setting `player.input.forward = true` etc. This exact same reasoning is already documented inline at the real `_updateGamepad`'s own comment (search for "rather than controls.isLocked" in `Game.js`) - gamepad already avoids depending on it for its own gating, but doesn't help the many OTHER `isLocked` checks elsewhere.

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Produces: `Game.prototype._isActivelyPlaying()` - returns `boolean`. Every later task that needs to know "is the player actively controlling gameplay right now" (regardless of input device) calls this instead of reading `this.player.controls.isLocked` directly.
- Consumes: `this.player.controls.isLocked` (existing), `this.touchControlsActive` (new field, added in this task, default `false` - Task 4 is what actually computes its real value; this task just needs the field to exist so the helper compiles and defaults to today's exact behavior).

- [ ] **Step 1: Add the `touchControlsActive` field and the helper method**

Find the `Game` class constructor (search for `this.gameStarted = false` or similar early constructor field - re-read fresh to find a sensible spot near other top-level state flags) and add:

```js
    // Touch Controls (see TouchControls.js) - true once device detection
    // (Task 4) decides this session should use touch input instead of
    // mouse/keyboard. Starts false; never flips true before that decision
    // runs, so every isLocked-based gate below behaves identically to
    // today until touch mode is actually wired up.
    this.touchControlsActive = false
```

Then find a convenient spot among the other small helper methods (e.g. near `_updateGamepad`) and add:

```js
  // Returns whether the player is actively controlling gameplay right now,
  // regardless of which input device is driving it. Real Pointer Lock
  // (`controls.isLocked`) is the desktop/mouse signal; touch mode never
  // acquires real Pointer Lock at all (see _requestPointerLock in
  // TouchControls' wiring), so it needs its own equivalent "yes, actively
  // playing" signal instead of being gated out entirely.
  _isActivelyPlaying() {
    return this.player.controls.isLocked || this.touchControlsActive
  }
```

- [ ] **Step 2: Replace every gameplay-gating `isLocked` check with the helper**

Grep fresh first: `grep -n "controls.isLocked" src/game/Game.js` - re-confirm the current set of matches (this plan was written against 7 real occurrences: two in `_bindItemKeys`-style keydown gates, one in an audio-resume check, two in inventory/hotbar-adjacent keydown gates, and two in the main tick loop's `if (this.driving && this.player.controls.isLocked ...)` / `else if (this.player.controls.isLocked && this.playerState.alive ...)` branches). For each real occurrence (skip any that turn out to be inside a comment), replace the literal `this.player.controls.isLocked` with `this._isActivelyPlaying()`. This is a safe, uniform substring replacement - every occurrence uses it as a plain boolean in a larger `&&`/`!` expression, so swapping in a same-shape boolean-returning call doesn't change any other part of these lines.

Use a single `Edit` call with `replace_all: true` on the exact substring `this.player.controls.isLocked` (confirm via the grep above that every remaining match is a real gameplay-gate check, not a comment - if a comment happens to contain the literal substring, exclude it by editing that one occurrence with more surrounding context first, then replace_all the rest).

- [ ] **Step 3: Build check**

Run: `cd /Users/yanny/Desktop/2nan10nu/zombie-survival-3d && npx vite build`
Expected: builds with no new errors (same warnings as before are fine).

- [ ] **Step 4: Verify with Playwright that flipping the flag actually unblocks gameplay**

Write a throwaway script (e.g. in the scratchpad directory) using the `example-skills:webapp-testing` pattern - launch the dev server, wait for `window.__game`, force-hide `#asset-loader`, then in one `page.evaluate()`:

```js
() => {
  const g = window.__game
  g.gameStarted = true
  g.touchControlsActive = true
  const before = g.player.controls.object.position.clone()
  g.playerState.alive = true
  g.player.input.forward = true
  // One manual tick-equivalent call - update() is normally driven by the
  // render loop, but calling it directly here proves the gate itself
  // (isActivelyPlaying) is what was blocking it, not the render loop.
  g.player.update(0.1)
  const after = g.player.controls.object.position.clone()
  return { moved: before.distanceTo(after) > 0.01, isLocked: g.player.controls.isLocked }
}
```

Expected: `moved: true` even though `isLocked` is still `false` - proving the gate no longer silently blocks movement once `touchControlsActive` is true, without needing real Pointer Lock at all.

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js
git commit -m "Add _isActivelyPlaying() helper so gameplay gates don't depend on real Pointer Lock"
```

---

### Task 2: Extract lock/unlock handler bodies; add `_requestPointerLock()`/`_requestPointerUnlock()` wrappers

**Why:** re-reading `Game.js` fresh found that `gameStarted = true` and ALL of the "show the real-run HUD" logic (crosshair, hotbar, health/inventory/progress HUD, minimap, compass) only happens inside the `player.controls.addEventListener('lock', ...)` callback - and conversely, pausing (showing the pause overlay) only happens inside the `'unlock'` callback, which is how this game currently implements "Escape pauses the game" (it relies on the browser's own native pointer-lock-exit behavior firing that event, not a custom Escape keydown handler). Touch mode will never call real `.lock()`/`.unlock()` (no mouse to lock), so on its own neither of these would ever fire, meaning a touch player's game would never actually "start" and there would be no way to pause. This task extracts each handler's body into a standalone method so touch mode can invoke the same logic directly, without going through the browser's real Pointer Lock APIs at all.

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `this._isActivelyPlaying()` (Task 1), `this.touchControlsActive` (Task 1's field, real value computed in Task 4).
- Produces: `Game.prototype._onGameplayResumed()`, `Game.prototype._onGameplayPaused()`, `Game.prototype._requestPointerLock()`, `Game.prototype._requestPointerUnlock()`. Every later task (and every existing call site) that wants to "start/resume gameplay" or "pause/open a panel" calls `_requestPointerLock()`/`_requestPointerUnlock()` instead of `this.player.controls.lock()`/`.unlock()` directly.

- [ ] **Step 1: Extract the `'lock'` listener's body into `_onGameplayResumed()`**

Find `this.player.controls.addEventListener('lock', () => { ... })` (re-read fresh - was around line 5949 when this plan was written). Move the entire callback body into a new method:

```js
  // Extracted from the real 'lock' event listener below so touch mode
  // (which never acquires real Pointer Lock) can trigger the exact same
  // "gameplay is now visibly running" state change directly - see
  // _requestPointerLock().
  _onGameplayResumed() {
    if (this.buildMode.active) return
    this.gameStarted = true
    audioEngine.resume()
    this.pauseOverlay.style.display = 'none'
    this.screenshotCropOverlay.style.display = 'none'
    this.screenshotCropOpen = false
    this.menu.style.display = 'none'
    this.crosshair.style.display = this.driving ? 'none' : 'block'
    this.hudEl.style.display = this.driving ? 'none' : 'block'
    this.hotbarEl.style.display = this.driving ? 'none' : 'flex'
    if (this.hotbarPowerScoreEl) this.hotbarPowerScoreEl.style.display = this.driving ? 'none' : 'block'
    this.statusHud.style.display = 'flex'
    this.inventoryHud.style.display = 'flex'
    this.progressHud.style.display = 'flex'
    this.statsPanel.style.display = 'flex'
    if (this.keybindCheatsheet) this.keybindCheatsheet.style.display = this.settings.keybindCheatSheet ? '' : 'none'
    this.minimapWrap.style.display = 'block'
    this.compassStrip.style.display = 'block'
    if (this.driving) {
      this.interactPrompt.innerHTML = tHtml('interactExitVehicle')
      this.interactPrompt.style.display = 'block'
    }
  }
```

Then replace the listener registration with:

```js
    this.player.controls.addEventListener('lock', () => this._onGameplayResumed())
```

- [ ] **Step 2: Extract the `'unlock'` listener's body into `_onGameplayPaused()`**

Same move for the `'unlock'` listener (re-read fresh - was around line 5980):

```js
  // Extracted from the real 'unlock' event listener below - see
  // _onGameplayResumed's own comment for why touch mode needs this callable
  // directly instead of only ever firing from a real browser event.
  _onGameplayPaused() {
    if (this.buildMode.active) return
    this.interactPrompt.style.display = 'none'
    this.infectionIndicator.style.display = 'none'
    if (!this.playerState.alive) return
    if (this.screenshotCropOpen || this.perkPanelOpen || this.xpLevelupPanelOpen || this.traderPanelOpen || this.inventoryOpen) {
      // handled by whichever panel is open
    } else if (this.gameStarted) {
      audioEngine.pause()
      this.pauseOverlayTitle.textContent = t('pauseOverlayTitle')
      this.pauseResumeBtn.textContent = t('pauseResumeBtn')
      this.pauseUpgradesBtn.textContent = t('upgradesBtn')
      this.pauseSpectateBtn.textContent = t('pauseSpectateBtn')
      this.pauseWeaponBtn.textContent = t('pauseWeaponBtn')
      this.pauseSettingsBtn.textContent = t('settingsBtn')
      this.pauseQuitBtn.textContent = t('pauseQuitBtn')
      this.pauseOverlay.style.display = 'flex'
    } else {
      this.menu.style.display = 'flex'
    }
    this.crosshair.style.display = 'none'
    this.hudEl.style.display = 'none'
    this.hotbarEl.style.display = 'none'
    this.statusHud.style.display = 'none'
    this.inventoryHud.style.display = 'none'
    this.progressHud.style.display = 'none'
    this.statsPanel.style.display = 'none'
    this.minimapWrap.style.display = 'none'
    this.compassStrip.style.display = 'none'
  }
```

Replace the listener registration with:

```js
    this.player.controls.addEventListener('unlock', () => this._onGameplayPaused())
```

- [ ] **Step 3: Add the wrapper methods**

Right next to the two methods above:

```js
  // Every call site that wants to "start/resume real gameplay" calls this
  // instead of this.player.controls.lock() directly - on a real
  // mouse/keyboard/gamepad session it's the exact same real Pointer Lock
  // request as before (which still fires the 'lock' listener above
  // normally); in touch mode (which never acquires real Pointer Lock) it
  // runs the identical resulting state change directly instead.
  _requestPointerLock() {
    if (this.touchControlsActive) this._onGameplayResumed()
    else this.player.controls.lock()
  }

  // Same reasoning as _requestPointerLock, for pausing/opening a panel.
  _requestPointerUnlock() {
    if (this.touchControlsActive) this._onGameplayPaused()
    else this.player.controls.unlock()
  }
```

- [ ] **Step 4: Replace every direct lock()/unlock() call site**

Grep fresh: `grep -n "player\.controls\.lock()\|player\.controls\.unlock()" src/game/Game.js` (this plan was written against 13 `.lock()` and 8 `.unlock()` real call sites, all outside the two listener registrations already handled in Steps 1-2 above - don't touch those two, they're the real event listeners registered on the actual `PointerLockControls` instance and must keep calling the real API as their trigger source). For every OTHER occurrence, replace `this.player.controls.lock()` → `this._requestPointerLock()` and `this.player.controls.unlock()` → `this._requestPointerUnlock()`.

Use two `Edit` calls with `replace_all: true` for the two exact substrings - confirm via the grep above that the count matches expectations before and after (grepping for the OLD substring afterward should only still match inside the two listener-registration lines from Steps 1/2, nowhere else).

- [ ] **Step 5: Build check**

Run: `npx vite build`
Expected: no new errors.

- [ ] **Step 6: Verify with Playwright**

In one `page.evaluate()` after the usual `window.__game` wait + hiding `#asset-loader`:

```js
() => {
  const g = window.__game
  g.touchControlsActive = true
  g.playerState.alive = true
  g._requestPointerLock()
  const startedAfterLock = g.gameStarted
  const hudShown = g.hudEl.style.display === 'block'
  g._requestPointerUnlock()
  const pausedAfterUnlock = g.pauseOverlay.style.display === 'flex'
  return { startedAfterLock, hudShown, pausedAfterUnlock, isLocked: g.player.controls.isLocked }
}
```

Expected: `startedAfterLock: true`, `hudShown: true`, `pausedAfterUnlock: true`, and `isLocked: false` throughout - proving the whole start/pause flow now works without ever touching real Pointer Lock.

- [ ] **Step 7: Commit**

```bash
git add src/game/Game.js
git commit -m "Extract lock/unlock handler bodies into _onGameplayResumed/_onGameplayPaused, add pointer-lock request wrappers"
```

---

### Task 3: `touchControlsOverride` setting + Settings UI + i18n labels

**Files:**
- Modify: `src/game/Game.js`
- Modify: `index.html`
- Modify: `src/game/i18n.js`

**Interfaces:**
- Produces: `settings.touchControlsOverride` (`null | 'auto' | 'touch' | 'desktop'` - stored as `'auto'` for the default/no-override case, read as equivalent to `null`/unset for older saves via the same `parsed.x ?? default` pattern every other setting already uses).
- Consumes: none new (follows the exact existing `compassStyle`/`killFeedPosition` enum-setting pattern in this file).

- [ ] **Step 1: Add the default value in both settings-default locations**

`loadSettings()` (re-read fresh, was around line 258 next to `aimAssist`):

```js
      aimAssist: parsed.aimAssist ?? false,
      touchControlsOverride: ['auto', 'touch', 'desktop'].includes(parsed.touchControlsOverride) ? parsed.touchControlsOverride : 'auto',
```

The bare-defaults object (re-read fresh - the huge one-liner, was around line 555) - find the `aimAssist: false,` segment inside it and insert `touchControlsOverride: 'auto',` immediately after it.

- [ ] **Step 2: Add the Settings UI dropdown**

In `index.html`, find the accessibility/controls section of the Settings panel (near where `#toggle-ads-toggle`/`#aim-assist-toggle` live - re-read fresh, this plan was written against them being around index.html's Settings panel accessibility block). Add, following the exact `#compass-style-select` markup pattern:

```html
          <div class="audio-row">
            <label for="touch-controls-override-select" id="touch-controls-override-label">Touch Controls</label>
            <select id="touch-controls-override-select">
              <option value="auto">Auto-detect</option>
              <option value="touch">Force On</option>
              <option value="desktop">Force Off (Mouse &amp; Keyboard)</option>
            </select>
          </div>
          <p id="touch-controls-override-hint" class="menu-hint-line">Changing this reloads the page.</p>
```

- [ ] **Step 3: Wire the dropdown in `Game.js`**

Find where `this.compassStyleSelect` is captured (re-read fresh, near line 3798) and add alongside it:

```js
    this.touchControlsOverrideSelect = document.getElementById('touch-controls-override-select')
```

Find where `compassStyleSelect`'s value/listener is wired (re-read fresh, near line 9789-9793) and add the matching block:

```js
    if (this.touchControlsOverrideSelect) {
      this.touchControlsOverrideSelect.value = this.settings.touchControlsOverride
      this.touchControlsOverrideSelect.addEventListener('change', () => {
        this.settings.touchControlsOverride = this.touchControlsOverrideSelect.value
        saveSettings(this.settings)
        window.location.reload()
      })
    }
```

- [ ] **Step 4: Add i18n labels**

In `src/game/i18n.js`'s English block (near `compassStyleLabel`, re-read fresh), add:

```js
    touchControlsOverrideLabel: 'Touch Controls',
    touchControlsOverrideHint: 'Changing this reloads the page.',
```

Update `_updateTexts()` (the function that sets `.textContent` on Settings labels from i18n keys - grep for where `compassStyleLabel` or a similar label is applied) to also set `document.getElementById('touch-controls-override-label').textContent = t('touchControlsOverrideLabel')` and the hint line similarly, following the exact same pattern as the neighboring label it's copied from.

- [ ] **Step 5: Build check**

Run: `npx vite build`
Expected: no errors.

- [ ] **Step 6: Verify with Playwright**

```js
() => {
  const g = window.__game
  const sel = document.getElementById('touch-controls-override-select')
  return { defaultValue: g.settings.touchControlsOverride, selectValue: sel ? sel.value : null, hasOptions: sel ? sel.options.length : 0 }
}
```

Expected: `{ defaultValue: 'auto', selectValue: 'auto', hasOptions: 3 }`.

- [ ] **Step 7: Commit**

```bash
git add src/game/Game.js index.html src/game/i18n.js
git commit -m "Add touchControlsOverride setting and its Settings UI dropdown"
```

---

### Task 4: Device detection - compute `touchControlsActive` once at menu load

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `settings.touchControlsOverride` (Task 3), `this.touchControlsActive` field (Task 1).
- Produces: `this.touchControlsActive` now holds its real, decided value for the whole session (no live hot-swap - matches the Global Constraints).

- [ ] **Step 1: Compute the real value in the constructor**

Find where `this.touchControlsActive = false` was added in Task 1 and replace the hardcoded `false` with a real computation, run once:

```js
    // Touch Controls (see TouchControls.js) - decided once per session, not
    // re-evaluated live (changing the override setting reloads the page -
    // see its own change handler). 'auto' falls back to a media query that
    // is true only for a touch-primary device (no mouse/trackpad) - a
    // touchscreen laptop that also has a real pointer still reports
    // hover:hover and is correctly treated as desktop.
    this.touchControlsActive = this.settings.touchControlsOverride === 'touch'
      || (this.settings.touchControlsOverride === 'auto' && window.matchMedia('(hover: none) and (pointer: coarse)').matches)
```

(This line must run AFTER `this.settings` is already loaded/assigned in the constructor - re-read the constructor fresh to place it right after `this.settings = loadSettings()` or equivalent, not before.)

- [ ] **Step 2: Build check**

Run: `npx vite build`

- [ ] **Step 3: Verify with Playwright - all three override states**

Three separate `page.evaluate()` calls (each on a fresh reload, since localStorage persists the setting):

```js
// 1. Force desktop
() => { const raw = JSON.parse(localStorage.getItem('gayz-settings') || '{}'); raw.touchControlsOverride = 'desktop'; localStorage.setItem('gayz-settings', JSON.stringify(raw)) }
```
reload, then `() => window.__game.touchControlsActive` → expect `false`.

```js
// 2. Force touch
() => { const raw = JSON.parse(localStorage.getItem('gayz-settings') || '{}'); raw.touchControlsOverride = 'touch'; localStorage.setItem('gayz-settings', JSON.stringify(raw)) }
```
reload, then `() => window.__game.touchControlsActive` → expect `true`.

(Use whatever the real settings localStorage key constant actually is - re-read `SETTINGS_STORAGE_KEY`'s value fresh rather than assuming `'gayz-settings'`.)

For the `'auto'` case, Playwright's default Chromium launch reports `hover: hover, pointer: fine` (a real mouse profile) unless launched with a touch-emulating device descriptor, so simply asserting `touchControlsActive === false` under plain default launch options with `touchControlsOverride: 'auto'` is sufficient to prove the auto-detect branch runs (a true positive touch-detection case would need `p.chromium.launch()` with `hasTouch: true` and a matching device profile, which is a nice-to-have but not required to prove the wiring is correct - the override-forced cases above already prove both outcomes of the boolean).

- [ ] **Step 4: Commit**

```bash
git add src/game/Game.js
git commit -m "Compute touchControlsActive once at construction from the override setting / media query"
```

---

### Task 5: `TouchControls` class skeleton + tick-loop wiring

**Files:**
- Create: `src/game/TouchControls.js`
- Modify: `src/game/Game.js`

**Interfaces:**
- Produces: `class TouchControls { constructor(game); update(dt); dispose(); }` - `game` is the full `Game` instance (matches how `ZombieManager`/other systems in this codebase already take the whole game object rather than a narrow interface, per this project's existing convention). Later tasks (6-12) all add methods/state onto this same class - this task only establishes the shell, the touch-identifier tracking map, and the hit-test-priority stub.
- Consumes: `game.touchControlsActive` (Task 4), `game.camera`, `game.player`, `game.weapons` (all pre-existing).

- [ ] **Step 1: Create the class file**

```js
// src/game/TouchControls.js
//
// Fourth input source alongside keyboard+mouse and gamepad (see Game.js's
// _updateGamepad for the pattern this mirrors). Every control here writes
// into the exact same fields those two already write into, or dispatches
// the same synthetic KeyboardEvents the existing "One-Handed Layout"
// feature already dispatches - see docs/superpowers/specs/
// 2026-08-26-touch-controls-design.md for the full design.

// Movement joystick deadzone, as a fraction of the joystick's max travel
// radius - matches the spirit of GAMEPAD_DEADZONE in Game.js (a stick
// nudge this small doesn't count as a real directional input).
const JOYSTICK_DEADZONE = 0.2

// Look-drag base sensitivity (touch pixels of drag -> radians of camera
// rotation, before the Settings sensitivity slider's multiplier is
// applied). Tuned independently from mouse/gamepad since raw touch pixel
// deltas behave differently from either.
const TOUCH_LOOK_BASE_SENSITIVITY = 0.0028

export class TouchControls {
  constructor(game) {
    this.game = game
    // Touch-identifier -> role map. A role is one of: 'joystick', 'look',
    // or a button id string (e.g. 'fire', 'jump'). Populated on
    // touchstart, read on touchmove, deleted on touchend/touchcancel -
    // see _roleForTouch() (Task 6) for how a fresh touch gets assigned one.
    this._activeTouches = new Map()
    this._joystickTouchId = null
    this._joystickOrigin = { x: 0, y: 0 }
    this._joystickKnob = { x: 0, y: 0 }
    this._lookTouchId = null
    this._lookLast = { x: 0, y: 0 }
  }

  // Called once per frame from Game.js's main tick loop, same spot
  // _updateGamepad(dt) is already called from - see Step 2 below.
  update(dt) {
    // Per-frame continuous work (joystick->input booleans, if needed
    // beyond the touchmove-driven update) goes here in later tasks.
    // Left empty in this task - the skeleton just needs to exist and be
    // called safely every frame with no functional behavior yet.
  }

  dispose() {
    this._activeTouches.clear()
  }
}
```

- [ ] **Step 2: Construct it and call `update(dt)` from the tick loop**

In `Game.js`'s constructor, after `this.touchControlsActive` is computed (Task 4):

```js
    this.touchControls = new TouchControls(this)
```

Add the import at the top of `Game.js` alongside the other same-directory imports:

```js
import { TouchControls } from './TouchControls.js'
```

In the main tick loop, find `this._updateGamepad(dt)` (re-read fresh, was around line 21527, inside the `_isActivelyPlaying()`-gated branch from Task 1) and add right after it:

```js
      if (this.touchControlsActive) this.touchControls.update(dt)
```

- [ ] **Step 3: Build check**

Run: `npx vite build`
Expected: no errors, no unused-import warnings for `TouchControls`.

- [ ] **Step 4: Verify with Playwright**

```js
() => {
  const g = window.__game
  return { exists: !!g.touchControls, isMap: g.touchControls._activeTouches instanceof Map, hasUpdate: typeof g.touchControls.update === 'function' }
}
```

Expected: all `true`.

- [ ] **Step 5: Commit**

```bash
git add src/game/TouchControls.js src/game/Game.js
git commit -m "Add TouchControls class skeleton, wire construction and tick-loop update()"
```

---

### Task 6: `#touch-controls-layer` HTML/CSS skeleton

**Files:**
- Modify: `index.html`
- Modify: `src/style.css`
- Modify: `src/game/Game.js`

**Interfaces:**
- Produces: all the static DOM/CSS the later logic tasks (7-11) attach behavior to - `#touch-controls-layer`, `#touch-joystick-base`/`#touch-joystick-knob`, `#touch-look-zone`, `#touch-btn-fire`/`-aim`/`-jump`/`-reload`/`-melee`/`-interact`/`-weapon-1`..`-weapon-4`/`-more`, `#touch-more-actions-menu` (empty, populated by Task 11).
- Consumes: `_onGameplayResumed()`/`_onGameplayPaused()` (Task 2) - this task wires the layer's visibility into both, so it shows exactly when the real HUD shows and hides exactly when it hides, with no separate state to keep in sync.

- [ ] **Step 1: Add the HTML skeleton**

In `index.html`, add this as a sibling of the other full-screen gameplay overlays (near `#hudEl`/`#crosshair` - re-read fresh to place it in the same DOM neighborhood):

```html
    <div id="touch-controls-layer" style="display: none">
      <div id="touch-joystick-base">
        <div id="touch-joystick-knob"></div>
      </div>
      <div id="touch-look-zone"></div>
      <button id="touch-btn-fire" class="touch-action-btn" aria-label="Fire">FIRE</button>
      <button id="touch-btn-aim" class="touch-action-btn" aria-label="Aim">AIM</button>
      <button id="touch-btn-jump" class="touch-action-btn" aria-label="Jump">JUMP</button>
      <button id="touch-btn-reload" class="touch-action-btn" aria-label="Reload">RELOAD</button>
      <button id="touch-btn-melee" class="touch-action-btn" aria-label="Melee">MELEE</button>
      <button id="touch-btn-interact" class="touch-action-btn" aria-label="Interact">USE</button>
      <button id="touch-btn-weapon-1" class="touch-action-btn touch-weapon-btn" aria-label="Weapon 1">1</button>
      <button id="touch-btn-weapon-2" class="touch-action-btn touch-weapon-btn" aria-label="Weapon 2">2</button>
      <button id="touch-btn-weapon-3" class="touch-action-btn touch-weapon-btn" aria-label="Weapon 3">3</button>
      <button id="touch-btn-weapon-4" class="touch-action-btn touch-weapon-btn" aria-label="Weapon 4">4</button>
      <button id="touch-btn-more" class="touch-action-btn" aria-label="More Actions">MORE</button>
    </div>
    <div id="touch-more-actions-menu" style="display: none">
      <h2 id="touch-more-actions-title">More Actions</h2>
      <div id="touch-more-actions-grid"></div>
      <p class="panel-close-hint">Tap an action, or tap outside to close</p>
    </div>
```

- [ ] **Step 2: Add the CSS**

In `src/style.css`, following the existing documented z-index scale in its own comments (`#menu-bg`=0, layout=1, play-btn=5, `#asset-loader`=10, panels=15, `#ending-panel`=20, `#cinematic-bars`=25, `#screen-fade`=30) - the touch layer needs to sit above ordinary gameplay HUD (which has no explicit z-index, i.e. effectively 0 via DOM order) but the More Actions menu, being a genuine full-screen panel, should match the existing panel tier:

```css
#touch-controls-layer {
  position: fixed;
  inset: 0;
  z-index: 8;
  touch-action: none;
  user-select: none;
}

#touch-joystick-base {
  position: absolute;
  left: 30px;
  bottom: 30px;
  width: 110px;
  height: 110px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  border: 2px solid rgba(255, 255, 255, 0.25);
}

#touch-joystick-knob {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 50px;
  height: 50px;
  margin: -25px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.35);
  pointer-events: none;
}

#touch-look-zone {
  position: absolute;
  right: 0;
  top: 0;
  width: 60%;
  height: 100%;
}

.touch-action-btn {
  position: absolute;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.4);
  border: 2px solid rgba(255, 255, 255, 0.3);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

#touch-btn-fire { right: 40px; bottom: 90px; width: 78px; height: 78px; }
#touch-btn-aim { right: 130px; bottom: 60px; }
#touch-btn-jump { right: 40px; bottom: 190px; }
#touch-btn-reload { right: 200px; bottom: 40px; }
#touch-btn-melee { right: 280px; bottom: 40px; }
#touch-btn-interact { right: 40px; bottom: 270px; }
#touch-btn-more { left: 30px; top: 30px; width: 48px; height: 48px; font-size: 9px; }

.touch-weapon-btn {
  width: 44px;
  height: 44px;
  top: 30px;
}
#touch-btn-weapon-1 { right: 200px; }
#touch-btn-weapon-2 { right: 150px; }
#touch-btn-weapon-3 { right: 100px; }
#touch-btn-weapon-4 { right: 50px; }

#touch-more-actions-menu {
  position: fixed;
  inset: 0;
  z-index: 15;
  background: rgba(10, 8, 4, 0.92);
  padding: 24px;
  overflow-y: auto;
}

#touch-more-actions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
  gap: 12px;
}

.touch-more-action-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 6px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: #fff;
  font-size: 12px;
}
```

(Exact pixel positions here are a first pass for reachability testing, not final visual polish - the spec explicitly defers pixel-perfect small-screen layout to the next sub-project. What matters for this plan is that every button is reachable and non-overlapping at a reasonable tablet/phone size, verified in Task 13.)

- [ ] **Step 3: Wire visibility into `_onGameplayResumed`/`_onGameplayPaused`**

In `_onGameplayResumed()` (Task 2), add:

```js
    if (this.touchControlsActive) document.getElementById('touch-controls-layer').style.display = 'block'
```

In `_onGameplayPaused()` (Task 2), add:

```js
    if (this.touchControlsActive) document.getElementById('touch-controls-layer').style.display = 'none'
```

- [ ] **Step 4: Build check**

Run: `npx vite build`

- [ ] **Step 5: Verify with Playwright**

```js
() => {
  const g = window.__game
  g.touchControlsActive = true
  g.playerState.alive = true
  g._requestPointerLock()
  const shownWhenPlaying = document.getElementById('touch-controls-layer').style.display
  g._requestPointerUnlock()
  const hiddenWhenPaused = document.getElementById('touch-controls-layer').style.display
  return { shownWhenPlaying, hiddenWhenPaused, buttonCount: document.querySelectorAll('.touch-action-btn').length }
}
```

Expected: `shownWhenPlaying: 'block'`, `hiddenWhenPaused: 'none'`, `buttonCount: 11`.

- [ ] **Step 6: Commit**

```bash
git add index.html src/style.css src/game/Game.js
git commit -m "Add touch controls HTML/CSS skeleton, wired to show/hide with gameplay state"
```

---

### Task 7: Movement joystick

**Files:**
- Modify: `src/game/TouchControls.js`

**Interfaces:**
- Consumes: `this.game.player.input` (existing boolean fields).
- Produces: `_bindJoystick()` (called once from the constructor), internal state already declared in Task 5 (`_joystickTouchId`, `_joystickOrigin`, `_joystickKnob`).

- [ ] **Step 1: Implement joystick touch handling**

In the `TouchControls` constructor, after the field declarations from Task 5, call a new setup method:

```js
    this._joystickBase = document.getElementById('touch-joystick-base')
    this._joystickKnobEl = document.getElementById('touch-joystick-knob')
    this._bindJoystick()
```

Add the method:

```js
  _bindJoystick() {
    const base = this._joystickBase
    const maxRadius = 40 // px the knob can travel from center before clamping

    const rect = () => base.getBoundingClientRect()

    const isInActivationZone = (x, y) => {
      // Generous activation zone (spec: "roughly the whole bottom-left
      // quarter of the screen"), not just the visible ~110px circle -
      // real thumbs don't land pixel-precise.
      return x < window.innerWidth * 0.4 && y > window.innerHeight * 0.5
    }

    const setInput = (dx, dy, mag) => {
      const input = this.game.player.input
      if (mag < JOYSTICK_DEADZONE * maxRadius) {
        input.forward = input.back = input.left = input.right = false
        return
      }
      input.forward = dy < -maxRadius * 0.2
      input.back = dy > maxRadius * 0.2
      input.left = dx < -maxRadius * 0.2
      input.right = dx > maxRadius * 0.2
    }

    const reset = () => {
      this._joystickTouchId = null
      this._joystickKnob.x = 0
      this._joystickKnob.y = 0
      this._joystickKnobEl.style.transform = 'translate(0, 0)'
      const input = this.game.player.input
      input.forward = input.back = input.left = input.right = false
    }

    document.addEventListener('touchstart', (e) => {
      if (this._joystickTouchId !== null) return
      for (const touch of e.changedTouches) {
        if (this._activeTouches.has(touch.identifier)) continue
        if (!isInActivationZone(touch.clientX, touch.clientY)) continue
        this._joystickTouchId = touch.identifier
        this._activeTouches.set(touch.identifier, 'joystick')
        const r = rect()
        this._joystickOrigin.x = r.left + r.width / 2
        this._joystickOrigin.y = r.top + r.height / 2
        break
      }
    }, { passive: true })

    document.addEventListener('touchmove', (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier !== this._joystickTouchId) continue
        let dx = touch.clientX - this._joystickOrigin.x
        let dy = touch.clientY - this._joystickOrigin.y
        const mag = Math.hypot(dx, dy)
        if (mag > maxRadius) {
          dx = (dx / mag) * maxRadius
          dy = (dy / mag) * maxRadius
        }
        this._joystickKnob.x = dx
        this._joystickKnob.y = dy
        this._joystickKnobEl.style.transform = `translate(${dx}px, ${dy}px)`
        setInput(dx, dy, Math.hypot(dx, dy))
      }
    }, { passive: true })

    const onEnd = (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier !== this._joystickTouchId) continue
        this._activeTouches.delete(touch.identifier)
        reset()
      }
    }
    document.addEventListener('touchend', onEnd, { passive: true })
    document.addEventListener('touchcancel', onEnd, { passive: true })
  }
```

- [ ] **Step 2: Build check**

Run: `npx vite build`

- [ ] **Step 3: Verify with Playwright**

Dispatch synthetic touch events (Playwright's `page.evaluate()` can construct and dispatch real `Touch`/`TouchEvent` objects in Chromium):

```js
() => {
  const g = window.__game
  g.touchControlsActive = true
  const base = document.getElementById('touch-joystick-base')
  const rect = base.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const makeTouch = (x, y) => new Touch({ identifier: 1, target: base, clientX: x, clientY: y })
  base.dispatchEvent(new TouchEvent('touchstart', { touches: [makeTouch(cx, cy)], changedTouches: [makeTouch(cx, cy)], bubbles: true }))
  document.dispatchEvent(new TouchEvent('touchmove', { touches: [makeTouch(cx, cy - 35)], changedTouches: [makeTouch(cx, cy - 35)], bubbles: true }))
  const forwardWhilePushingUp = g.player.input.forward
  document.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [makeTouch(cx, cy - 35)], bubbles: true }))
  const forwardAfterRelease = g.player.input.forward
  return { forwardWhilePushingUp, forwardAfterRelease }
}
```

Expected: `forwardWhilePushingUp: true`, `forwardAfterRelease: false`.

- [ ] **Step 4: Commit**

```bash
git add src/game/TouchControls.js
git commit -m "Wire movement joystick to player.input booleans"
```

---

### Task 8: Look-drag camera rotation

**Files:**
- Modify: `src/game/TouchControls.js`

**Interfaces:**
- Consumes: `this.game.camera`, `this.game.settings.invertY`, `this.game.settings.sensitivity`.
- Produces: `_bindLookZone()`.

- [ ] **Step 1: Implement look-drag handling**

Add a reusable Euler instance and the binding method, called from the constructor alongside `_bindJoystick()`:

```js
import * as THREE from 'three'
```

(add this import at the top of `TouchControls.js` if not already present from an earlier task)

```js
    this._lookEuler = new THREE.Euler(0, 0, 0, 'YXZ')
    this._bindLookZone()
```

```js
  _bindLookZone() {
    const isLookTouch = (x, y) => {
      // Anything on the right side of the screen that isn't already
      // claimed by the joystick or a button - button touches are always
      // assigned their own role first in each button's own touchstart
      // handler (Tasks 9-10), which runs before this check ever sees that
      // identifier, since touchstart handlers all check
      // this._activeTouches.has(identifier) first and bail if already
      // claimed.
      return x >= window.innerWidth * 0.4
    }

    document.addEventListener('touchstart', (e) => {
      for (const touch of e.changedTouches) {
        if (this._activeTouches.has(touch.identifier)) continue
        if (!isLookTouch(touch.clientX, touch.clientY)) continue
        this._lookTouchId = touch.identifier
        this._activeTouches.set(touch.identifier, 'look')
        this._lookLast.x = touch.clientX
        this._lookLast.y = touch.clientY
      }
    }, { passive: true })

    document.addEventListener('touchmove', (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier !== this._lookTouchId) continue
        const dx = touch.clientX - this._lookLast.x
        let dy = touch.clientY - this._lookLast.y
        this._lookLast.x = touch.clientX
        this._lookLast.y = touch.clientY
        if (this.game.settings.invertY) dy = -dy
        const sens = TOUCH_LOOK_BASE_SENSITIVITY * (this.game.settings.sensitivity / 100)
        this._lookEuler.setFromQuaternion(this.game.camera.quaternion)
        this._lookEuler.y -= dx * sens
        this._lookEuler.x -= dy * sens
        this._lookEuler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this._lookEuler.x))
        this.game.camera.quaternion.setFromEuler(this._lookEuler)
      }
    }, { passive: true })

    const onEnd = (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier !== this._lookTouchId) continue
        this._activeTouches.delete(touch.identifier)
        this._lookTouchId = null
      }
    }
    document.addEventListener('touchend', onEnd, { passive: true })
    document.addEventListener('touchcancel', onEnd, { passive: true })
  }
```

- [ ] **Step 2: Build check**

Run: `npx vite build`

- [ ] **Step 3: Verify with Playwright**

```js
() => {
  const g = window.__game
  g.touchControlsActive = true
  const before = g.camera.quaternion.clone()
  const lookZone = document.getElementById('touch-look-zone')
  const makeTouch = (id, x, y) => new Touch({ identifier: id, target: lookZone, clientX: x, clientY: y })
  const startX = window.innerWidth * 0.7
  lookZone.dispatchEvent(new TouchEvent('touchstart', { touches: [makeTouch(2, startX, 300)], changedTouches: [makeTouch(2, startX, 300)], bubbles: true }))
  document.dispatchEvent(new TouchEvent('touchmove', { touches: [makeTouch(2, startX + 100, 300)], changedTouches: [makeTouch(2, startX + 100, 300)], bubbles: true }))
  const after = g.camera.quaternion.clone()
  document.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [makeTouch(2, startX + 100, 300)], bubbles: true }))
  return { rotated: !before.equals(after) }
}
```

Expected: `rotated: true`.

- [ ] **Step 4: Commit**

```bash
git add src/game/TouchControls.js
git commit -m "Wire look-drag to camera rotation, respecting invertY and the sensitivity setting"
```

---

### Task 9: Fire + Aim buttons

**Files:**
- Modify: `src/game/TouchControls.js`

**Interfaces:**
- Consumes: `this.game.weapons.triggerDown`, `this.game.weapons.aiming`, `this.game.weapons.toggleAds` (all pre-existing on `WeaponSystem`).
- Produces: `_bindHoldButton(elementId, onDown, onUp)` - a small shared helper, reused by Task 10's Sprint/Crouch too (both are also hold-or-toggle style), so it's written generically here rather than duplicated.

- [ ] **Step 1: Add the shared hold-button helper**

```js
  // Shared by Fire/Aim here and Sprint/Crouch in the next task - a button
  // that needs to know both "pressed" and "released" (as opposed to the
  // instant-tap buttons in Task 10, which only need one event). Assigns
  // the touch its own role in the identifier map so a look-drag or the
  // joystick never steals it, and vice versa.
  _bindHoldButton(elementId, onDown, onUp) {
    const el = document.getElementById(elementId)
    let touchId = null
    el.addEventListener('touchstart', (e) => {
      e.preventDefault()
      if (touchId !== null) return
      const touch = e.changedTouches[0]
      touchId = touch.identifier
      this._activeTouches.set(touchId, elementId)
      onDown()
    }, { passive: false })
    const onEnd = (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier !== touchId) continue
        this._activeTouches.delete(touchId)
        touchId = null
        onUp()
      }
    }
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })
  }
```

- [ ] **Step 2: Wire Fire and Aim**

Call from the constructor:

```js
    this._bindFireAndAim()
```

```js
  _bindFireAndAim() {
    this._bindHoldButton('touch-btn-fire',
      () => { this.game.weapons.triggerDown = true },
      () => { this.game.weapons.triggerDown = false })

    this._bindHoldButton('touch-btn-aim',
      () => {
        const w = this.game.weapons
        const wasAiming = w.aiming
        if (w.toggleAds) w.aiming = !w.aiming
        else w.aiming = true
        if (w.aiming && !wasAiming) w.aimStartedAt = performance.now()
      },
      () => {
        const w = this.game.weapons
        if (!w.toggleAds) w.aiming = false
      })
  }
```

- [ ] **Step 3: Build check**

Run: `npx vite build`

- [ ] **Step 4: Verify with Playwright**

```js
() => {
  const g = window.__game
  g.touchControlsActive = true
  const fireBtn = document.getElementById('touch-btn-fire')
  const t1 = new Touch({ identifier: 10, target: fireBtn, clientX: 0, clientY: 0 })
  fireBtn.dispatchEvent(new TouchEvent('touchstart', { touches: [t1], changedTouches: [t1], bubbles: true }))
  const downState = g.weapons.triggerDown
  fireBtn.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t1], bubbles: true }))
  const upState = g.weapons.triggerDown
  return { downState, upState }
}
```

Expected: `downState: true`, `upState: false`.

- [ ] **Step 5: Commit**

```bash
git add src/game/TouchControls.js
git commit -m "Wire Fire and Aim touch buttons to weapons.triggerDown/aiming"
```

---

### Task 10: Instant-tap buttons (Jump, Reload, Interact, Melee, weapon-switch 1-4) + Sprint/Crouch

**Files:**
- Modify: `src/game/TouchControls.js`

**Interfaces:**
- Consumes: `getKeyFor` (import from `./Keybinds.js`).
- Produces: `_dispatchKey(code)` (instant tap: keydown+keyup), `_dispatchKeyDown(code)`/`_dispatchKeyUp(code)` (for Sprint/Crouch, which need real down/up so `PlayerController._onKey`'s existing toggle-vs-hold branch works correctly), `_bindTapButton(elementId, code)`, wiring for all 9 buttons.

- [ ] **Step 1: Add the shared dispatch helpers**

```js
import { getKeyFor } from './Keybinds.js'
```

(add to `TouchControls.js`'s imports if not already present)

```js
  // Matches the exact pattern this codebase's own "One-Handed Layout"
  // feature and gamepad support already use - window.dispatchEvent with a
  // synthetic KeyboardEvent, since PlayerController's real listener is
  // registered on window (not document), confirmed in the spec.
  _dispatchKeyDown(code) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code }))
  }

  _dispatchKeyUp(code) {
    window.dispatchEvent(new KeyboardEvent('keyup', { code }))
  }

  _dispatchKey(code) {
    this._dispatchKeyDown(code)
    this._dispatchKeyUp(code)
  }

  // Instant-tap button: fires once per touchstart, no separate up-state
  // needed (matches a quick real keypress).
  _bindTapButton(elementId, code) {
    const el = document.getElementById(elementId)
    el.addEventListener('touchstart', (e) => {
      e.preventDefault()
      this._dispatchKey(code)
    }, { passive: false })
  }
```

- [ ] **Step 2: Wire the instant-tap buttons**

```js
    this._bindInstantButtons()
```

```js
  _bindInstantButtons() {
    this._bindTapButton('touch-btn-jump', 'Space')
    this._bindTapButton('touch-btn-reload', getKeyFor('reload'))
    this._bindTapButton('touch-btn-interact', getKeyFor('interact'))
    this._bindTapButton('touch-btn-melee', 'Digit1')
    this._bindTapButton('touch-btn-weapon-1', 'Digit1')
    this._bindTapButton('touch-btn-weapon-2', 'Digit2')
    this._bindTapButton('touch-btn-weapon-3', 'Digit3')
    this._bindTapButton('touch-btn-weapon-4', 'Digit4')
  }
```

(Melee and Weapon 1 are deliberately the same `Digit1` dispatch - per the spec, melee is "whichever slot the hotbar has the melee weapon in," which for the default hotbar is slot 1; this doesn't special-case melee detection, it just gives players two visible buttons that both mean "switch to slot 1," matching how a keyboard player only has the one key for it today too.)

- [ ] **Step 3: Wire Sprint and Crouch (hold-or-toggle, respecting existing settings)**

These need real keydown/keyup (not just an instant tap), since `PlayerController._onKey`'s existing toggle-vs-hold branch reads `isDown` on each call - it must see a `keydown` then later a `keyup`, exactly like a real held key, for both the hold-mode and toggle-mode logic (including double-tap-to-prone on crouch) to behave identically to keyboard:

```js
    this._bindSprintAndCrouch()
```

```js
  _bindSprintAndCrouch() {
    this._bindHoldButton('touch-btn-sprint',
      () => this._dispatchKeyDown(getKeyFor('sprint')),
      () => this._dispatchKeyUp(getKeyFor('sprint')))

    this._bindHoldButton('touch-btn-crouch',
      () => this._dispatchKeyDown(getKeyFor('crouch')),
      () => this._dispatchKeyUp(getKeyFor('crouch')))
  }
```

Note: `#touch-btn-sprint`/`#touch-btn-crouch` need adding to the HTML/CSS from Task 6 (that task's button list didn't include them - add both now):

In `index.html`'s `#touch-controls-layer` (from Task 6), add two more buttons:

```html
      <button id="touch-btn-sprint" class="touch-action-btn" aria-label="Sprint">SPRINT</button>
      <button id="touch-btn-crouch" class="touch-action-btn" aria-label="Crouch">CROUCH</button>
```

In `src/style.css`, add positioning for both (pick spots that don't collide with the existing button layout from Task 6 - e.g.):

```css
#touch-btn-sprint { right: 40px; bottom: 350px; }
#touch-btn-crouch { right: 130px; bottom: 190px; }
```

- [ ] **Step 4: Build check**

Run: `npx vite build`

- [ ] **Step 5: Verify with Playwright**

```js
() => {
  const g = window.__game
  g.touchControlsActive = true
  g.playerState.alive = true
  const before = g.weapons.currentIndex
  const w2Btn = document.getElementById('touch-btn-weapon-2')
  const t1 = new Touch({ identifier: 20, target: w2Btn, clientX: 0, clientY: 0 })
  w2Btn.dispatchEvent(new TouchEvent('touchstart', { touches: [t1], changedTouches: [t1], bubbles: true }))
  const after = g.weapons.currentIndex

  const crouchBtn = document.getElementById('touch-btn-crouch')
  const t2 = new Touch({ identifier: 21, target: crouchBtn, clientX: 0, clientY: 0 })
  crouchBtn.dispatchEvent(new TouchEvent('touchstart', { touches: [t2], changedTouches: [t2], bubbles: true }))
  const crouchedWhileHeld = g.player.input.crouch
  crouchBtn.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t2], bubbles: true }))
  const crouchedAfterRelease = g.player.input.crouch

  return { weaponSwitched: before !== after, crouchedWhileHeld, crouchedAfterRelease }
}
```

Expected: `weaponSwitched: true` (assuming slot 2 differs from the starting weapon), `crouchedWhileHeld: true`, `crouchedAfterRelease: false` (assuming `toggleCrouch` is off by default, matching the settings default from earlier in the session).

- [ ] **Step 6: Commit**

```bash
git add src/game/TouchControls.js index.html src/style.css
git commit -m "Wire Jump/Reload/Interact/Melee/weapon-switch/Sprint/Crouch touch buttons via synthetic key dispatch"
```

---

### Task 11: More Actions menu

**Files:**
- Modify: `src/game/TouchControls.js`
- Modify: `src/game/i18n.js`

**Interfaces:**
- Consumes: `ACTIONS` (import from `./Keybinds.js`), `t()`/`labelKey` (existing i18n helper and per-action label keys, all already defined for every `ACTIONS` entry).
- Produces: `_bindMoreActionsMenu()`, the populated `#touch-more-actions-grid`.

- [ ] **Step 1: Add the exclusion set and menu population**

```js
import { getKeyFor, ACTIONS } from './Keybinds.js'
```

(update the existing `Keybinds.js` import from Task 10 to also bring in `ACTIONS`)

```js
  // Ids already covered by a dedicated button elsewhere in this class, or
  // (weaponWheel specifically) whose target UI has no touch equivalent and
  // is redundant with the dedicated weapon-switch buttons - see the
  // spec's "More Actions Menu" section for why weaponWheel is excluded
  // even though it isn't given its own dedicated button.
  static EXCLUDED_FROM_MORE_MENU = new Set([
    'moveForward', 'moveBack', 'moveLeft', 'moveRight',
    'sprint', 'crouch', 'reload', 'interact', 'weaponWheel',
  ])

  _bindMoreActionsMenu() {
    const grid = document.getElementById('touch-more-actions-grid')
    const menu = document.getElementById('touch-more-actions-menu')

    for (const action of ACTIONS) {
      if (TouchControls.EXCLUDED_FROM_MORE_MENU.has(action.id)) continue
      const btn = document.createElement('button')
      btn.className = 'touch-more-action-btn'
      btn.textContent = t(action.labelKey)
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault()
        this._dispatchKey(getKeyFor(action.id))
        menu.style.display = 'none'
      }, { passive: false })
      grid.appendChild(btn)
    }

    document.getElementById('touch-btn-more').addEventListener('touchstart', (e) => {
      e.preventDefault()
      menu.style.display = 'block'
    }, { passive: false })

    menu.addEventListener('touchstart', (e) => {
      if (e.target === menu) menu.style.display = 'none'
    }, { passive: true })
  }
```

Add the import for `t` at the top of `TouchControls.js` if not already present:

```js
import { t } from './i18n.js'
```

Call `this._bindMoreActionsMenu()` from the constructor alongside the other `_bind*()` calls.

- [ ] **Step 2: Add the menu title i18n label**

In `src/game/i18n.js`'s English block (near the other new labels from Task 3):

```js
    touchMoreActionsTitle: 'More Actions',
```

Wire it in `_updateTexts()` (`Game.js`) alongside the other label assignments:

```js
    document.getElementById('touch-more-actions-title').textContent = t('touchMoreActionsTitle')
```

- [ ] **Step 3: Build check**

Run: `npx vite build`

- [ ] **Step 4: Verify with Playwright**

```js
() => {
  const g = window.__game
  g.touchControlsActive = true
  const grid = document.getElementById('touch-more-actions-grid')
  const buttonCount = grid.children.length
  const hasWeaponWheelBtn = Array.from(grid.children).some((b) => b.textContent === 'Weapon Wheel')
  const before = g.settings.flashlightOn || false
  const moreBtn = document.getElementById('touch-btn-more')
  const t1 = new Touch({ identifier: 30, target: moreBtn, clientX: 0, clientY: 0 })
  moreBtn.dispatchEvent(new TouchEvent('touchstart', { touches: [t1], changedTouches: [t1], bubbles: true }))
  const menuShown = document.getElementById('touch-more-actions-menu').style.display
  return { buttonCount, hasWeaponWheelBtn, menuShown }
}
```

Expected: `buttonCount` around 30 (total `ACTIONS` length minus the 9 excluded ids - compute the exact expected number from the live `ACTIONS.length` at verification time rather than hardcoding it), `hasWeaponWheelBtn: false`, `menuShown: 'block'`.

- [ ] **Step 5: Commit**

```bash
git add src/game/TouchControls.js src/game/i18n.js src/game/Game.js
git commit -m "Add More Actions touch menu, generated from the live ACTIONS list"
```

---

### Task 12: Aim-assist session-only override

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `this.touchControlsActive` (Task 4), `this.weapons.aimAssist` (existing field already read from `settings.aimAssist` elsewhere).
- Produces: no new field - just a session-only in-memory assignment, deliberately never written back to `settings`/localStorage.

- [ ] **Step 1: Turn on aim assist for the session when touch mode is active**

Find where `this.weapons.aimAssist = this.settings.aimAssist` is set (re-read fresh, was around line 8799, right where the Settings toggle for it is wired) and add immediately after:

```js
    // Touch aiming is inherently less precise than a mouse - entering
    // touch mode turns on aim assist for this session only. Deliberately
    // does NOT write back to this.settings.aimAssist/saveSettings - a
    // player who later plays on desktop keeps whatever they had before.
    if (this.touchControlsActive) this.weapons.aimAssist = true
```

- [ ] **Step 2: Build check**

Run: `npx vite build`

- [ ] **Step 3: Verify with Playwright**

Two reloads, same pattern as Task 4's override test:

```js
// touchControlsOverride: 'desktop', aimAssist setting left at its default false
() => window.__game.weapons.aimAssist
```
Expected: `false`.

```js
// touchControlsOverride: 'touch', aimAssist setting left at its default false
() => ({ sessionAimAssist: window.__game.weapons.aimAssist, savedSetting: window.__game.settings.aimAssist })
```
Expected: `{ sessionAimAssist: true, savedSetting: false }` - proving the in-memory flag flipped but the saved preference didn't.

- [ ] **Step 4: Commit**

```bash
git add src/game/Game.js
git commit -m "Turn on aim assist for the session when touch controls are active, without overwriting the saved setting"
```

---

### Task 13: Full end-to-end Playwright verification pass

**Files:**
- No source changes - verification only (a throwaway script in the scratchpad directory, not committed to the repo).

- [ ] **Step 1: Write one comprehensive script covering the full control set together**

Beyond the individual per-task checks already done, write a single script that: forces `touchControlsOverride: 'touch'`, reloads, confirms `touchControlsActive` is `true` and the game reaches `gameStarted: true` via a real `_requestPointerLock()` call (not a manually-set flag), then in sequence: drags the joystick and confirms actual world-position movement happens (not just the input booleans - call through the real tick path this time, e.g. by letting a few real `requestAnimationFrame`s pass rather than calling `player.update()` manually), drags the look zone and confirms the camera actually rotated, holds Fire near a spawned test zombie (this project's existing test convention already has a pattern for spawning a fake zombie stub with a `hittableMeshes: []` field - reuse it) and confirms a hit registers, taps Reload and confirms ammo actually changes, taps a weapon-switch button and confirms the equipped weapon changes, opens the More Actions menu and taps Flashlight and confirms `this.game.flashlightOn` toggles, and finally taps the Pause-equivalent (there is no dedicated Pause button in this plan's button set - use the existing pause overlay's own Resume/Quit flow by calling `game._requestPointerUnlock()` directly, matching Task 2's own verification pattern) and confirms the touch layer hides.

Run it against a fresh dev server (`npx vite` on a free port, following this project's own recurring cwd-reset gotcha - `cd` back into the project directory explicitly before running if a prior background command may have reset the shell's working directory).

Expected: every check passes. If anything fails, this is exactly the point in the process (per this project's established pattern across every phase tonight) where a REAL bug gets found via live multi-step testing rather than code review alone - fix it with a targeted change, re-run this same script, and only move on once it's clean.

- [ ] **Step 2: Note what this does NOT prove**

Record (in the PR/commit message for Task 14, not a new file) that this verifies the wiring is logically correct end-to-end, but does not confirm real touch *feel* - button reachability with actual thumbs, whether the look-drag sensitivity constant feels right, whether the fixed pixel button positions from Task 6 actually fit a real phone screen without overlapping. That needs a real device or at minimum manual testing via a phone/iPad's browser pointed at a locally-exposed dev server or the Vercel preview URL.

---

### Task 14: Build, commit, push, deploy

**Files:**
- No source changes.

- [ ] **Step 1: Final production build check**

Run: `npx vite build`
Expected: clean build, no new errors.

- [ ] **Step 2: Push to GitHub**

```bash
git push origin main
```

- [ ] **Step 3: Deploy to Vercel production**

```bash
npx vercel --prod --yes
```

- [ ] **Step 4: Report to the user with plain, honest test steps**

Per this project's standing "explain in plain language, give exact test steps, say when something is untested" rules: tell the user this shipped and is live, give them exact steps to try it on their own phone/iPad (open gayz.vercel.app in its browser, since `touchControlsOverride` defaults to `'auto'` it should just work without any setting change - if it doesn't auto-detect correctly, show them where the "Touch Controls" dropdown in Settings lives to force it on), and say plainly that this was verified by an automated script checking the underlying logic, not by physically testing on a real device - so their first real playtest is the actual first real-world confirmation, and any control that feels awkward (button position, look sensitivity, etc.) is expected early feedback to act on, not a sign something is broken.
