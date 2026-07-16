# Neon Decay + Found Footage Visual Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin GayZ's night lighting, zombies, and HUD toward a magenta/cyan "Neon Decay" palette, add neon signage to the world, and layer a "Found Footage" camera effect (scanlines, grain, vignette, REC indicator + timestamp, handheld wobble) over the whole screen, always-on.

**Architecture:** Two independent pieces per the design spec (`docs/superpowers/specs/2026-07-16-visual-identity-design.md`): (1) real changes to 3D scene color/lighting/materials, and (2) a screen-space DOM overlay + a whole-viewport CSS transform for camera wobble. Neither piece depends on the other, so tasks can be done and verified in any order, but are listed in a sensible build order below.

**Tech Stack:** Vite + vanilla JS + three.js. No test framework is configured in this project (no Jest/Vitest/etc in `package.json`) — this plan does not use TDD. Each task's verification step is `npm run build` (catches syntax errors) plus a visual check via the dev server (`npm run dev`, or a Playwright screenshot). This matches how the rest of this codebase has been built and verified so far.

## Global Constraints

- Always-on — no settings toggle for this visual style (per user decision in brainstorming).
- Daytime lighting stays as-is; only the NIGHT palette changes (per spec, to limit risk since night is when the game is mostly played).
- The found-footage overlay is `pointer-events: none` and must never block clicks/interaction with any game or menu element.
- No new npm dependencies — everything uses vanilla CSS/SVG/three.js already in the project.
- Follow existing code style: no comments explaining *what* code does, only non-obvious *why* comments; reuse existing helper functions/patterns rather than duplicating them.

---

### Task 1: Neon night lighting palette

**Files:**
- Modify: `src/game/DayNightCycle.js:9-19` (the `NIGHT` constant)

**Interfaces:**
- Consumes: nothing new
- Produces: nothing new — this only changes color values already read by `DayNightCycle.update()`, which every other task can rely on being in place for their own visual verification (night = neon palette from here on).

- [ ] **Step 1: Replace the NIGHT color palette**

In `src/game/DayNightCycle.js`, replace the existing `NIGHT` object:

```js
const NIGHT = {
  background: 0x161c22,
  fog: 0x161c22,
  fogNear: 18,
  fogFar: 90,
  skyColor: 0x7f93ab,
  groundColor: 0x20201a,
  hemiIntensity: 0.85,
  sunColor: 0xc3d2ec,
  sunIntensity: 1.0,
  sunPos: new THREE.Vector3(30, 45, -15),
}
```

with:

```js
const NIGHT = {
  background: 0x1a0d2e,
  fog: 0x1a0d2e,
  fogNear: 18,
  fogFar: 90,
  skyColor: 0x8f4fd6,
  groundColor: 0x140a1f,
  hemiIntensity: 0.85,
  sunColor: 0x6fe8ff,
  sunIntensity: 1.1,
  sunPos: new THREE.Vector3(30, 45, -15),
}
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: builds with no errors (same output shape as prior builds — an `index.html`, CSS bundle, JS bundle under `dist/`).

- [ ] **Step 3: Visual check**

Run `npm run dev`, open the game in a browser, click Play. Since the day/night cycle starts at night (elapsed time 0 lands in the night portion of the cycle), the world should immediately render in purple/magenta fog and cyan moonlight instead of the old blue-gray. No console errors.

- [ ] **Step 4: Commit**

```bash
git add src/game/DayNightCycle.js
git commit -m "Recolor night lighting to Neon Decay purple/magenta/cyan palette"
```

---

### Task 2: Cool/sickly zombie retint

**Files:**
- Modify: `src/game/ZombieTypes.js` (the `skinTones`/`clothesTones` arrays on `shambler`, `runner`, `brute`, `spitter`, `crawler`, `exploder`, `colossus`; `screamer` is left unchanged since its existing purple tones already fit)

**Interfaces:**
- Consumes: nothing new
- Produces: nothing new — `Zombie.js`'s `_buildBody()` already reads `cfg.skinTones`/`cfg.clothesTones` by picking a random entry, so no code changes are needed anywhere else.

- [ ] **Step 1: Replace each type's color arrays**

In `src/game/ZombieTypes.js`, apply these exact replacements (only `skinTones`/`clothesTones` lines change; every other field on each type stays the same):

`shambler`:
```js
    skinTones: [0x39506a, 0x33485f, 0x3d5470, 0x2f4459, 0x455a75],
    clothesTones: [0x161a24, 0x1a1e2a, 0x14171f, 0x1c2028],
```

`runner`:
```js
    skinTones: [0x4a6b7a, 0x527888, 0x436374],
    clothesTones: [0x1e222b, 0x242835],
```

`brute`:
```js
    skinTones: [0x283a4a, 0x223240, 0x2a3d4d],
    clothesTones: [0x0f1216, 0x12161a],
```

`spitter`:
```js
    skinTones: [0x5a3a7a, 0x653f88, 0x4f3468],
    clothesTones: [0x1a1428, 0x201a30],
```

`crawler`:
```js
    skinTones: [0x3d5560, 0x364c56, 0x455e6a],
    clothesTones: [0x0f1611, 0x131c15],
```

`exploder`:
```js
    skinTones: [0x3a5a4a, 0x3f6350, 0x355547],
    clothesTones: [0x152018, 0x18251a],
```

`colossus`:
```js
    skinTones: [0x1a2530, 0x16202a, 0x1c2732],
    clothesTones: [0x0a0d10, 0x0d1013],
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 3: Visual check**

Run `npm run dev`, click Play, let a few zombies approach. Expected: zombies read as cool blue/teal/violet-toned rather than the old olive-green, and still look distinct from each other by silhouette/type as before (color change only, no shape/behavior change).

- [ ] **Step 4: Commit**

```bash
git add src/game/ZombieTypes.js
git commit -m "Retint zombies toward cool/sickly tones for the Neon Decay palette"
```

---

### Task 3: Cyan HUD accent recolor

**Files:**
- Modify: `src/style.css` (global recolor of the single accent color used throughout menus/panels/sliders)

**Interfaces:**
- Consumes: nothing new
- Produces: nothing new — pure color swap, no new classes or markup.

- [ ] **Step 1: Replace the accent hex globally**

In `src/style.css`, replace every occurrence of `#b6e6a1` with `#5be3ff` (16 occurrences — title text, buttons, sliders, panel borders/titles, checkboxes).

- [ ] **Step 2: Replace the accent rgb-triplet globally**

In the same file, replace every occurrence of `182, 230, 161` with `91, 227, 255` (8 occurrences — these are the same accent color used inside `rgba(...)` calls for hover backgrounds/borders).

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 4: Visual check**

Run `npm run dev`. Expected: the "GayZ" title, Play/Settings buttons, sliders, and perk/trader panel accents are now cyan instead of green. Then check Settings → Controls → toggle "Colorblind Mode" and look at a zombie's health bar — it should still clearly read as blue→yellow→orange (colorblind palette lives in `Zombie.js`/`Accessibility.js`, untouched by this task) and still be easy to tell apart from the new cyan UI accent.

- [ ] **Step 5: Commit**

```bash
git add src/style.css
git commit -m "Recolor UI accent from green to cyan for the Neon Decay palette"
```

---

### Task 4: Neon signage props in the world

**Files:**
- Modify: `src/game/World.js` (add a new `addNeonSigns` function and call it from `buildWorld`)

**Interfaces:**
- Consumes: nothing new
- Produces: nothing new — purely decorative meshes/lights added directly to the scene, not returned from `buildWorld` and not referenced anywhere else.

- [ ] **Step 1: Add the `addNeonSigns` function**

In `src/game/World.js`, add this function near `buildTraderStall` (same file, any location outside another function body):

```js
// Purely decorative neon signage for the Neon Decay look - not registered as
// colliders (signage mounted flush on a facade shouldn't block movement).
function addNeonSigns(scene) {
  const signSpots = [
    { x: -17, y: 6, z: -20, w: 3, h: 1, color: 0xff2bd6, rotY: Math.PI / 2 },
    { x: 17, y: 8, z: 10, w: 4, h: 1.2, color: 0x2be6ff, rotY: -Math.PI / 2 },
    { x: -17, y: 5, z: 25, w: 2.5, h: 1, color: 0x2be6ff, rotY: Math.PI / 2 },
    { x: 17, y: 7, z: -30, w: 3.5, h: 1, color: 0xff2bd6, rotY: -Math.PI / 2 },
    { x: -32, y: 10, z: 0, w: 5, h: 1.5, color: 0xff2bd6, rotY: Math.PI / 2 },
  ]

  for (const spot of signSpots) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0f,
      emissive: spot.color,
      emissiveIntensity: 2.2,
      side: THREE.DoubleSide,
    })
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(spot.w, spot.h), mat)
    sign.position.set(spot.x, spot.y, spot.z)
    sign.rotation.y = spot.rotY
    scene.add(sign)

    const light = new THREE.PointLight(spot.color, 1.2, 10, 2)
    light.position.set(spot.x, spot.y, spot.z)
    scene.add(light)
  }
}
```

- [ ] **Step 2: Call it from `buildWorld`**

In `src/game/World.js`, find this line (added in the tunnel-connector work):

```js
  const tunnel = buildTunnel(scene, colliders, solidMeshes, flickerLights)
```

Add the new call directly after it:

```js
  const tunnel = buildTunnel(scene, colliders, solidMeshes, flickerLights)
  addNeonSigns(scene)
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 4: Visual check**

Run `npm run dev`, click Play, walk toward the building rows (x around ±17/±32). Expected: a handful of glowing magenta/cyan sign panels visible on/near building facades, each with a soft point-light glow. No performance stutter (5 extra point lights is a small addition against the existing streetlights/generator/trader lights already in the scene).

- [ ] **Step 5: Commit**

```bash
git add src/game/World.js
git commit -m "Add neon signage props to the world for the Neon Decay look"
```

---

### Task 5: Found-footage screen overlay (scanlines/vignette/grain)

**Files:**
- Modify: `src/game/Game.js` (index.html file reference below is easier to place first; either order is fine since neither depends on the other yet)
- Modify: `index.html` (new overlay markup)
- Modify: `src/style.css` (new overlay styles)

**Interfaces:**
- Consumes: nothing new
- Produces: DOM elements with ids `found-footage-overlay`, `ff-rec`, `ff-timestamp` that Task 6 will read via `document.getElementById`.

- [ ] **Step 1: Add the overlay markup to `index.html`**

In `index.html`, find this line:

```html
      <div id="interact-prompt">Press <b>F</b> to open</div>
```

Add the new overlay directly after it (before `<div id="menu">`):

```html
      <div id="found-footage-overlay">
        <div class="ff-vignette"></div>
        <div class="ff-scanlines"></div>
        <div class="ff-grain"></div>
        <div class="ff-hud" id="ff-rec"><span class="dot"></span>REC</div>
        <div class="ff-hud" id="ff-timestamp">00:00:00</div>
      </div>
```

- [ ] **Step 2: Add the overlay CSS**

In `src/style.css`, add at the end of the file:

```css
#found-footage-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.ff-vignette {
  position: absolute;
  inset: 0;
  box-shadow: inset 0 0 160px 60px rgba(0, 0, 0, 0.75);
}

.ff-scanlines {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    rgba(0, 0, 0, 0.18) 0px,
    rgba(0, 0, 0, 0.18) 1px,
    transparent 1px,
    transparent 3px
  );
  mix-blend-mode: multiply;
}

.ff-grain {
  position: absolute;
  inset: -50%;
  width: 200%;
  height: 200%;
  opacity: 0.05;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
  animation: ff-grain-shift 0.4s steps(4) infinite;
}

@keyframes ff-grain-shift {
  0% { transform: translate(0, 0); }
  25% { transform: translate(-2%, 1%); }
  50% { transform: translate(1%, -1%); }
  75% { transform: translate(-1%, 2%); }
  100% { transform: translate(0, 0); }
}

.ff-hud {
  position: absolute;
  top: 12px;
  font-family: monospace;
  font-size: 13px;
  letter-spacing: 0.5px;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
}

#ff-rec {
  left: 16px;
  color: #ff6b9d;
  display: flex;
  align-items: center;
  gap: 6px;
}

#ff-rec .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff2b2b;
  box-shadow: 0 0 6px #ff2b2b;
  animation: ff-rec-blink 1s steps(1) infinite;
}

@keyframes ff-rec-blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0.15; }
}

#ff-timestamp {
  right: 16px;
  color: #5be3ff;
}
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 4: Visual check**

Run `npm run dev`. Expected: the whole screen (menu included) now shows a vignette, faint moving scanlines/grain, a blinking "● REC" top-left in pink, and a static "00:00:00" top-right in cyan (it won't count up yet — that's Task 6). Nothing should be un-clickable — Play/Settings buttons must still work (confirms `pointer-events: none` is working).

- [ ] **Step 5: Commit**

```bash
git add index.html src/style.css
git commit -m "Add found-footage screen overlay: scanlines, grain, vignette, REC/timestamp markup"
```

---

### Task 6: Wire the REC timestamp to the run clock

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `#ff-timestamp` element (from Task 5), the existing module-level `formatTime(ms)` function already defined in this file at line 114
- Produces: `this.ffTimestampEl` (a cached DOM reference other future code could reuse, though nothing currently needs to)

- [ ] **Step 1: Cache the DOM reference**

In `src/game/Game.js`, find:

```js
    this.interactPrompt = document.getElementById('interact-prompt')
```

Add directly after it:

```js
    this.ffTimestampEl = document.getElementById('ff-timestamp')
```

- [ ] **Step 2: Update it every tick**

Find the `_tick()` method's start:

```js
  _tick() {
    this.timer.update()
    const dt = Math.min(this.timer.getDelta(), 0.1)
    const elapsed = this.timer.getElapsed()

    this.dayNight.update()
    this._updateFlicker(elapsed)
```

Add the timestamp update directly after `this._updateFlicker(elapsed)`:

```js
    this.dayNight.update()
    this._updateFlicker(elapsed)
    this.ffTimestampEl.textContent = formatTime(performance.now() - this.runStartedAt)
```

(This runs unconditionally every frame, same as `_updateFlicker` above it, so the "recording" timestamp keeps counting even while paused/in menus — consistent with it being a diegetic camera overlay rather than gameplay HUD.)

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 4: Visual check**

Run `npm run dev`, load the page, wait a few seconds without clicking Play. Expected: the cyan timestamp top-right counts up in `HH:MM:SS`-style format (exact format matches whatever the existing progress-HUD time readout already uses, since it's the same `formatTime` function).

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js
git commit -m "Wire found-footage REC timestamp to the existing run clock"
```

---

### Task 7: Handheld camera wobble

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: nothing new
- Produces: nothing new — purely a per-frame CSS transform on the existing `#app` root element.

Applying the wobble to the whole `#app` container (not just the `<canvas>`) keeps the crosshair, HUD, and 3D world moving together as one unit — if only the canvas wobbled, the fixed-position crosshair would drift out of sync with where the gun is actually aiming.

- [ ] **Step 1: Cache the `#app` element and a wobble clock**

In `src/game/Game.js` constructor, find:

```js
    this.canvas = document.getElementById('scene')
```

Add directly after it:

```js
    this.appEl = document.getElementById('app')
    this._wobbleTime = 0
```

- [ ] **Step 2: Apply the wobble every tick**

In `_tick()`, find the line added in Task 6 (`this.ffTimestampEl.textContent = ...`) and add directly after it:

```js
    this._wobbleTime += dt
    const wobbleX = Math.sin(this._wobbleTime * 1.3) * 1.4 + Math.sin(this._wobbleTime * 0.7) * 0.8
    const wobbleY = Math.cos(this._wobbleTime * 1.1) * 1.1
    const wobbleRot = Math.sin(this._wobbleTime * 0.9) * 0.25
    this.appEl.style.transform = `translate(${wobbleX}px, ${wobbleY}px) rotate(${wobbleRot}deg)`
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 4: Visual check**

Run `npm run dev`. Expected: a subtle, continuous handheld-camera-style drift/wobble of the entire screen (a couple pixels of movement, barely perceptible rotation) — noticeable but not distracting, and shooting/aiming still feels accurate since the crosshair moves with the world instead of staying pinned to the screen center.

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js
git commit -m "Add subtle handheld camera wobble to the whole viewport"
```

---

### Task 8: Full playthrough verification

**Files:** none (verification only)

- [ ] **Step 1: Full build check**

Run: `npm run build`
Expected: clean build, no warnings beyond the pre-existing chunk-size notice.

- [ ] **Step 2: Playwright smoke test for console errors**

Reuse the same approach as the previous feature batch: start the dev server, load the page, click Play, and confirm no new console errors beyond the already-known headless-only pointer-lock limitation.

- [ ] **Step 3: Manual browser playthrough**

Run `npm run dev`, play for a couple of minutes: confirm neon night lighting, retinted zombies, cyan UI accents, neon signage, and the found-footage overlay (scanlines/grain/vignette/REC/timestamp/wobble) all show up together and nothing else visibly broke (HUD legibility, aiming accuracy, existing panels like trader/perk/inventory still open/close normally).

- [ ] **Step 4: Deploy**

Ask the user before deploying to production, same as every previous deploy in this project (`npx vercel --prod --yes`, per the established workflow).
