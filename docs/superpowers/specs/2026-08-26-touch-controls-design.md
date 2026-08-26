# Touch Controls (Mobile/Tablet Playability, Part 1 of 3) - Design

## Context

GayZ is currently 100% mouse-and-keyboard: movement is WASD via
`PlayerController.js`, looking is `PointerLockControls` (real OS mouse
lock), shooting/aiming are left/right mouse buttons, and there are 30+
other keybound actions (grenades, flashlight, night vision, parry,
etc. - see `src/game/Keybinds.js`'s `ACTIONS` list). There is currently
zero touch handling anywhere in the codebase (confirmed via grep).

This is the first of three approved sub-projects toward "GayZ playable
on iPad/phone":
1. **Touch controls** (this spec) - make every control reachable and
   usable via touch, alongside the existing mouse/keyboard, without
   redesigning the HUD.
2. HUD/menu reflow for small portrait phone screens (separate spec,
   later).
3. Mobile performance tuning (separate spec, informed by real testing
   once part 1 exists).

This spec covers only part 1. Explicitly out of scope: reworking any
menu/HUD layout for narrow/portrait screens (part 2's job) and any
performance work (part 3's job) - this pass just needs controls to
work, not to look perfect on a 6" screen.

## Existing prior art (why this is lower-risk than it sounds)

The game already has a second, fully-alternate input source: gamepad
support (`Game.js`'s `_updateGamepad()`). It establishes the exact
pattern this spec reuses:

- Movement: the left stick's axes are converted into the same boolean
  flags keyboard WASD already sets - `player.input.forward/back/left/right`
  (`_updateGamepad`, e.g. `this.player.input.left = lx < -GAMEPAD_DEADZONE`).
- Look: the right stick directly rotates `this.camera.quaternion` via
  Euler angles each frame - it does **not** go through
  `PointerLockControls` at all.
- Firing: the trigger sets `this.weapons.triggerDown` directly - the
  same boolean the mouse's left-button handler sets
  (`WeaponSystem.js`, `if (e.button === 0) this.triggerDown = true`).
- Everything else (interact, reload): the gamepad handler dispatches a
  **synthetic `KeyboardEvent`** with `code: getKeyFor('interact')` on
  `window` - the same `window.dispatchEvent(new KeyboardEvent('keydown',
  { code: getKeyFor(action) }))` pattern the existing "One-Handed
  Layout" accessibility feature already uses (mouse side-buttons 4/5
  trigger Interact/Reload this same way). `PlayerController`'s own real
  keydown/keyup listener is registered on `window` (not `document`),
  confirmed at `PlayerController.js:297-298` - so a synthetic dispatch
  on `window` reaches it correctly (this matters - see this project's
  own CLAUDE.md note about `document`-only capture-phase listeners
  never receiving a `window`-dispatched event; that gotcha does not
  apply here because the real listener is on `window`).

**Touch controls are designed as a third input source following this
exact same pattern** - not a parallel control system. Every touch
control writes into the same fields keyboard/mouse/gamepad already
write into, or dispatches the same synthetic key events the
One-Handed Layout feature already dispatches. This means the ~24
"extra" abilities (grenade, flashlight, parry, night vision, etc.)
need zero new logic anywhere else in the codebase - toggle-vs-hold
sprint/crouch, double-tap-prone, toggle-ADS, all keep working
unchanged, because touch is just another way to "press the key."

Not reused: the existing weapon wheel (`_openWeaponWheel` et al.) -
confirmed via reading it that it's specifically weapon-switching only
(a radial ring of owned guns), not a general ability menu. Weapon
switching on touch instead reuses the existing Digit1-4 hotbar
shortcuts directly (see "More Actions Menu" below for the general
ability case).

## Detection & Activation

- **Auto-detect**: `window.matchMedia('(hover: none) and (pointer:
  coarse)').matches` - true for a touch-primary device (phone/tablet
  with no mouse), false for a touchscreen laptop that also has a
  trackpad/mouse (which reports `hover: hover`). Checked once when the
  main menu loads.
- **Manual override**: a new Settings toggle, "Force Touch Controls" /
  "Force Mouse & Keyboard" (`settings.touchControlsOverride`: `null`
  (auto) | `'touch'` | `'desktop'`), for edge cases the media query
  gets wrong (e.g. a Bluetooth-mouse iPad user who still wants touch,
  or a developer testing via Chrome DevTools device emulation). Checked
  before the auto-detect result.
- When touch mode is active: `PointerLockControls.lock()` is never
  called (the game currently calls this on clicking Play/canvas - it
  gets skipped entirely for touch, since iOS Safari's pointer-lock
  support is inconsistent and this project's own CLAUDE.md already
  documents Pointer Lock as unreliable even in headless test
  environments). The touch HUD (joystick + look zone + action buttons)
  is shown instead of relying on any lock state.
- Switching mode requires a page reload (simplest correct behavior -
  matches how several existing settings that need a fresh page state
  already work, e.g. Import Save). Not a live hot-swap.

## Layout (Fixed Dual-Stick)

Per the approved approach:

- **Bottom-left**: a semi-transparent circular joystick base (~110px
  diameter) with a draggable knob, inside a larger invisible activation
  zone (roughly the whole bottom-left quarter of the screen) - a touch
  landing anywhere in that generous zone grabs the joystick, not just
  a pixel-precise hit on the visible circle, since real thumbs don't
  land exactly on target. Dragging maps to a direction; releasing snaps
  the knob back to center.
- **Right ~60% of the screen**: a look-drag zone. Dragging a finger
  anywhere in this zone rotates the camera.
- **Small circular action buttons**, overlaid on top of the look zone
  (positioned so they don't overlap the joystick or each other):
  Fire, Aim (ADS), Jump, Reload, Melee, Interact, weapon-switch 1-4,
  and one "More" button for everything else.
- **Hit-test priority**: a `touchstart`'s role is decided by
  `e.target` (or `document.elementFromPoint`) at the touch point,
  checked in this order: a button element first (buttons are visually
  on top and should always win where they overlap the look zone
  beneath them), then the joystick's activation zone, then - anywhere
  else in the right-side zone - look-drag. This ordering is what makes
  "hold Fire while still dragging to look" work: the Fire button
  touch's role is locked in as soon as it lands, regardless of what's
  visually underneath it.
- All touch-specific DOM elements sit in a single new overlay
  (`#touch-controls-layer`), shown/hidden as a whole based on the
  active control mode, `touch-action: none` to suppress the browser's
  own scroll/pinch-zoom gestures on top of the canvas.

Multi-touch is tracked per **touch identifier**, not as one global
touch state - each active finger is assigned a role (joystick / look /
a specific button) the moment it touches down, tracked in a `Map`
keyed by `touch.identifier`, and released independently on its own
`touchend`/`touchcancel`. This is what allows holding Fire with one
thumb while the other thumb is still dragging to look, simultaneously
- the standard expectation for any mobile shooter.

## Control Wiring

| Control | Mechanism |
|---|---|
| Movement joystick | Knob offset from center, past a deadzone, sets `player.input.forward/back/left/right` booleans (same fields WASD/gamepad already set; diagonal drag can set two at once, matching held-diagonal-WASD). No new analog-speed plumbing - the existing input model is boolean-only (gamepad already treats its stick the same way), so touch matches it rather than inventing continuous speed. |
| Look-drag | Frame-to-frame touch position delta directly rotates `camera.quaternion` via Euler angles - the same technique `_updateGamepad`'s right-stick handling already uses, not routed through `PointerLockControls`. Respects `settings.invertY`. Speed is scaled by the existing Sensitivity slider (`settings.sensitivity / 100`, the same value `pointerSpeed` already uses for mouse) times a new touch-specific base constant, so there's no new setting to learn. |
| Fire | Touchstart on the Fire button sets `weapons.triggerDown = true`; touchend/touchcancel sets it `false` - identical to the mouse left-button and gamepad trigger. |
| Aim (ADS) | Touchstart mirrors the existing right-click handler exactly: if `weapons.toggleAds`, flip `weapons.aiming`; else set it `true`. Touchend sets it `false` only when not in toggle mode - same logic already in `WeaponSystem.js`, not reimplemented, just called from a new touch listener. |
| Jump | Instant tap dispatches a synthetic `keydown` + `keyup` with `code: 'Space'` on `window` (jump is hardcoded to `Space` in `PlayerController`, not part of the rebindable `ACTIONS` list, so this uses the literal code rather than `getKeyFor`). |
| Reload / Interact | Tap dispatches synthetic `keydown`+`keyup` with `code: getKeyFor('reload')` / `getKeyFor('interact')` on `window` - identical to the existing One-Handed Layout precedent. |
| Melee / weapon-switch 1-4 | Tap dispatches synthetic `keydown` for `Digit1`-`Digit4` on `window` (hotbar switching is handled in `Game.js`'s `_bindHotbar` off these literal digit codes, confirmed via reading it - melee is just whichever slot the player's hotbar has their melee weapon in, same as pressing "1" on a keyboard already means today). |
| Sprint / Crouch | Tap-and-hold OR toggle, matching whatever the player's existing `toggleSprint`/`toggleCrouch` settings already say - achieved by dispatching the same synthetic `keydown`/`keyup` for `getKeyFor('sprint')`/`getKeyFor('crouch')` that a real key already would, so `PlayerController._onKey`'s existing toggle-vs-hold branch (and double-tap-to-prone detection on crouch) runs completely unchanged. |
| More Actions menu | New small grid overlay (see below). |

## More Actions Menu

A new "More" button opens `#touch-more-actions-menu`, a scrollable grid
overlay generated by iterating the live `ACTIONS` array (`Keybinds.js`)
at build time - not a hand-transcribed list - and excluding a fixed
set of ids already covered elsewhere: `moveForward/moveBack/moveLeft/
moveRight` (joystick), `sprint`, `crouch`, `reload`, `interact`
(dedicated buttons), and **`weaponWheel`** specifically excluded even
though it has no dedicated button of its own - the desktop weapon
wheel it opens is driven by tracking mouse position to highlight a
slice (`_updateWeaponWheelHighlight`), which has no touch equivalent,
and the same functional need (switching weapons) is already fully
covered by the dedicated 1-4 buttons. Everything else - roughly 30
entries: grenade, molotov, barricade, trap, c4, adrenaline, emp,
flashlight, night vision, parry, grapple, dodge, threat ping, taunt,
fast travel, smoke bomb, drink water, journal, photo mode, screenshot,
toggle view, horn, radio, squad hold, minimap zoom, weapon inspect,
clip recording, stealth screen, decoy dummy, whistle, noisemaker,
toggle map - is rendered as an icon + label button reusing that
action's existing i18n label key (`labelKey` on each `ACTIONS` entry).
Tapping one dispatches a synthetic `keydown`+`keyup` for that action's
`getKeyFor(action)` code (same mechanism as every other button above)
and closes the menu. The game does not pause while this menu is open
(consistent with how a real keyboard press doesn't pause anything
either) - it's a quick-access list, not a menu that needs its own
state machine.

## Aim Assist

Touch aiming is inherently less precise than a mouse. Entering touch
mode turns on the game's existing (currently off-by-default)
`settings.aimAssist` for the current session only - it does **not**
overwrite the player's saved preference, so a player who later plays
on desktop still gets whatever they had before. Implemented as a
session-only in-memory flag check, not a settings mutation.

## Files Touched (for the implementation plan)

- New: `src/game/TouchControls.js` - owns the touch-identifier-to-role
  map, joystick math, look-drag rotation, and all button wiring
  described above. One class, constructed once, `update(dt)` called
  from the main tick loop same as `_updateGamepad`.
- `index.html` - new `#touch-controls-layer` markup (joystick base/knob,
  look zone, action buttons, `#touch-more-actions-menu`), and the new
  Settings toggle for the manual override.
- `src/style.css` - styling for all of the above, plus hiding the whole
  layer by default (shown only when touch mode is active).
- `src/game/Game.js` - constructs `TouchControls`, decides activation
  (media query + settings override) at menu load, skips
  `PointerLockControls.lock()` when active, wires the new Settings
  toggle, calls `TouchControls.update(dt)` from the tick loop.
- `src/game/Keybinds.js` - no changes needed (read-only from
  `TouchControls.js`, reusing `ACTIONS`/`getKeyFor` as-is).
- `src/game/i18n.js` - a handful of new labels (More Actions menu
  title, the two Settings toggle option labels); every `ACTIONS` entry
  already has a `labelKey`, reused as-is for the More Actions grid.

## Testing

Playwright can dispatch synthetic `touchstart`/`touchmove`/`touchend`
events to verify the **wiring** end-to-end: dragging the joystick
sets the correct `player.input.*` booleans, dragging the look zone
changes `camera.quaternion`, holding Fire sets `weapons.triggerDown`,
tapping Reload/Interact/a More Actions entry dispatches the expected
synthetic keydown and produces the expected game-state change (e.g.
ammo actually reloads). This confirms correctness of the logic, but
does **not** confirm real touch *feel* (button size/reach, whether the
look-drag sensitivity feels right, whether two thumbs comfortably
reach everything on an actual phone) - that needs a real device or at
minimum manual testing via a phone/iPad, which will be called out
explicitly rather than claimed as covered by the automated pass.
