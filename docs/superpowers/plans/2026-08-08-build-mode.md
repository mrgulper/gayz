# Build Mode (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone block-placing creative sandbox ("Build Mode") to GayZ, reachable from the homepage, fully disconnected from zombie survival gameplay.

**Architecture:** A new self-contained module `src/game/BuildMode.js` (a class with its own THREE.Scene, free-fly camera, and per-frame `update(dt)`), following this codebase's existing pattern for subsystems like `ZombieManager`/`PickupManager`. `Game.js` owns one `BuildMode` instance, swaps `_tick()`'s render target to it while active (same canvas/renderer, no second WebGL context), and toggles homepage visibility the same way starting a real run already does.

**Tech Stack:** Three.js (`THREE.InstancedMesh` for block rendering), vanilla DOM for the picker overlay, `localStorage` for the single save slot, Playwright for verification (this project has no other test framework — see `tests/helpers.js`).

## Global Constraints

- No zombie/survival gameplay integration — Build Mode is fully standalone (per `docs/superpowers/specs/2026-08-08-build-mode-design.md`).
- Reuse the existing canvas (`#scene`) and `this.renderer` — do not create a second `THREE.WebGLRenderer`.
- Block rendering must use `THREE.InstancedMesh` (one per block type), never one `THREE.Mesh` per placed block — see the spec's performance rationale (`docs/PERFORMANCE.md`'s CPU-bound-on-scene-graph-traversal finding).
- 9 fixed block types for v1, flat-colored (no textures): Concrete, Brick, Wood, Metal, Grass, Dirt, Glass, Asphalt, Stone.
- One `localStorage` save slot (key: `gayz-build-mode`), auto-save on exit, malformed data must never crash Build Mode — start empty instead.
- After any homepage markup change, re-verify the zero-scroll overflow budget at all 4 tracked heights (1920×1080, 1600×900, 1440×900, 1366×768) — this project has repeatedly regressed this and has a standing rule to re-check.
- Match this codebase's existing conventions: `export class` for the module, JSDoc-free code (this codebase uses none), comments only where genuinely non-obvious (see any existing file for the house style), no emoji anywhere in UI text (enforced by `eslint.config.js`'s `local/no-emoji` rule).
- Every verification step runs against the real `vite preview` production build via Playwright driving `window.__game`, per `tests/helpers.js`'s established `gotoAndWaitForGame`/poll-loop pattern — never assume dev-server-only behavior is representative.

---

### Task 1: BuildMode.js skeleton — scene, ground plane, free-fly camera

**Files:**
- Create: `src/game/BuildMode.js`
- Modify: `src/game/Game.js` (constructor area near `this.canvas`/`this.renderer` setup, ~line 3392; `_tick()` at line 17065; `_bindHomepageBatch()` at line 11509)
- Modify: `index.html` (new nav button near `#menu-nav-buttons`, index.html:465-499; a hidden `#build-mode-exit-btn`)
- Test: `tests/buildmode.spec.js` (new file)

**Interfaces:**
- Produces: `export class BuildMode` with constructor `(renderer)`, methods `enter()`, `exit()`, `update(dt)`, `render()`, and public fields `scene` (`THREE.Scene`), `camera` (`THREE.PerspectiveCamera`), `active` (`boolean`).
- Consumes (from `Game.js`): `this.renderer` (existing `THREE.WebGLRenderer`, canvas `#scene`).

- [ ] **Step 1: Create `BuildMode.js` with the scene, ground plane, and free-fly camera**

```javascript
// src/game/BuildMode.js
// Standalone block-placing creative sandbox - explicitly NOT connected to
// zombie survival gameplay (see docs/superpowers/specs/2026-08-08-build-mode-design.md).
// Reuses Game.js's existing renderer/canvas rather than a second WebGL
// context - only the scene/camera passed to render() changes.
import * as THREE from 'three'

const GROUND_SIZE = 64
const BLOCK_SIZE = 1
const FLY_SPEED = 8
const LOOK_SENSITIVITY = 0.0022

export class BuildMode {
  constructor(renderer) {
    this.renderer = renderer
    this.active = false

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x87ceeb)

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2)
    this.scene.add(hemiLight)
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.0)
    sunLight.position.set(20, 30, 10)
    this.scene.add(sunLight)

    const groundGeo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE)
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x6b8f4e })
    this.ground = new THREE.Mesh(groundGeo, groundMat)
    this.ground.rotation.x = -Math.PI / 2
    this.scene.add(this.ground)

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500)
    this.camera.position.set(0, 5, 10)

    // Free-fly input state - WASD + Space/Shift for up/down, mouse look
    // while pointer-locked. No gravity, no collision (see spec's "why this
    // shape" section).
    this._keys = new Set()
    this._yaw = 0
    this._pitch = 0
    this._onKeyDown = (e) => this._keys.add(e.code)
    this._onKeyUp = (e) => this._keys.delete(e.code)
    this._onMouseMove = (e) => {
      if (document.pointerLockElement !== this.renderer.domElement) return
      this._yaw -= e.movementX * LOOK_SENSITIVITY
      this._pitch -= e.movementY * LOOK_SENSITIVITY
      this._pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this._pitch))
    }
  }

  enter() {
    this.active = true
    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)
    window.addEventListener('mousemove', this._onMouseMove)
  }

  exit() {
    this.active = false
    this._keys.clear()
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)
    window.removeEventListener('mousemove', this._onMouseMove)
  }

  update(dt) {
    this.camera.rotation.set(0, 0, 0)
    this.camera.rotateY(this._yaw)
    this.camera.rotateX(this._pitch)

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion)
    const move = new THREE.Vector3()
    if (this._keys.has('KeyW')) move.add(forward)
    if (this._keys.has('KeyS')) move.sub(forward)
    if (this._keys.has('KeyD')) move.add(right)
    if (this._keys.has('KeyA')) move.sub(right)
    if (this._keys.has('Space')) move.y += 1
    if (this._keys.has('ShiftLeft')) move.y -= 1
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(FLY_SPEED * dt)
      this.camera.position.add(move)
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }
}
```

- [ ] **Step 2: Wire `BuildMode` into `Game.js` — instantiate, enter/exit, and hook `_tick()`**

In `Game.js`, add the import near the other module imports (alongside `import * as MenuPresets from './MenuPresets.js'`):

```javascript
import { BuildMode } from './BuildMode.js'
```

In the constructor, right after `this.renderer = new THREE.WebGLRenderer(...)` (Game.js:3392), add:

```javascript
this.buildMode = new BuildMode(this.renderer)
```

At the very top of `_tick()` (Game.js:17065), before the existing FPS-counter block, add the early-return branch that fully bypasses normal gameplay while Build Mode is active:

```javascript
_tick() {
  if (this.buildMode.active) {
    const dt = Math.min(this.timer.getDelta(), 0.1)
    this.buildMode.update(dt)
    this.buildMode.render()
    return
  }
  this._fpsFrameCount++
  // ... existing code unchanged from here
```

Add two methods near `_toggleSettings` (Game.js, same general area as other panel-open/close methods):

```javascript
_enterBuildMode() {
  this.menu.style.display = 'none'
  document.getElementById('build-mode-exit-btn').style.display = 'block'
  this.buildMode.enter()
  this.renderer.domElement.requestPointerLock()
}

_exitBuildMode() {
  this.buildMode.exit()
  document.exitPointerLock()
  document.getElementById('build-mode-exit-btn').style.display = 'none'
  this.menu.style.display = ''
}
```

- [ ] **Step 3: Add the homepage button and exit button to `index.html`**

In `index.html`, inside `#menu-nav-buttons` (index.html:465-499), add a new button after the existing `credits-btn` block (before the closing `</nav>` at line 499):

```html
<button id="build-mode-btn">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
  <span>Build</span>
</button>
```

Outside `#menu` (as a sibling, so it isn't hidden when the homepage hides — e.g. right after the `<canvas id="scene"></canvas>` line, index.html:19), add the exit button, hidden by default:

```html
<button id="build-mode-exit-btn" style="display: none">Exit Build Mode</button>
```

In `Game.js`'s DOM-ref section (near other `document.getElementById` calls in the constructor), add:

```javascript
this.buildModeBtn = document.getElementById('build-mode-btn')
```

In `_bindHomepageBatch()` (Game.js:11509), add the click wiring right before the closing `MenuEasterEggs.bindAll(this)` line (Game.js:11529):

```javascript
if (this.buildModeBtn) this.buildModeBtn.addEventListener('click', () => this._enterBuildMode())
const exitBtn = document.getElementById('build-mode-exit-btn')
if (exitBtn) exitBtn.addEventListener('click', () => this._exitBuildMode())
```

- [ ] **Step 4: Write the Playwright test file and verify entry/exit/movement**

```javascript
// tests/buildmode.spec.js
import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

test('entering Build Mode shows a scene with a ground plane, exiting returns to the homepage', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(() => {
    const g = window.__game
    g._enterBuildMode()
    const enteredActive = g.buildMode.active
    const hasGround = !!g.buildMode.ground
    const menuHiddenWhileActive = getComputedStyle(g.menu).display === 'none'
    g._exitBuildMode()
    const exitedActive = g.buildMode.active
    const menuVisibleAfterExit = getComputedStyle(g.menu).display !== 'none'
    return { enteredActive, hasGround, menuHiddenWhileActive, exitedActive, menuVisibleAfterExit }
  })

  expect(result.enteredActive).toBe(true)
  expect(result.hasGround).toBe(true)
  expect(result.menuHiddenWhileActive).toBe(true)
  expect(result.exitedActive).toBe(false)
  expect(result.menuVisibleAfterExit).toBe(true)
})

test('free-fly movement moves the camera in Build Mode', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    g._enterBuildMode()
    const before = g.buildMode.camera.position.clone()
    g.buildMode._keys.add('KeyW')
    g.buildMode.update(0.5)
    g.buildMode._keys.delete('KeyW')
    const after = g.buildMode.camera.position.clone()
    g._exitBuildMode()
    return { moved: before.distanceTo(after) > 0.1 }
  })

  expect(result.moved).toBe(true)
})
```

- [ ] **Step 5: Run the new tests against the real preview build**

Run: `npm test -- tests/buildmode.spec.js`
Expected: both tests PASS (this spins up `vite build` + `vite preview` per `playwright.config.js`'s `webServer` config, same as every other spec in this suite).

- [ ] **Step 6: Re-check the zero-scroll overflow budget**

The new nav button adds real height to the homepage. Using the same technique as this project's existing overflow checks (see `tests/construction.spec.js`'s "zero horizontal/vertical scroll" test as the pattern), verify `document.getElementById('menu').scrollHeight - document.getElementById('menu').clientHeight` stays within the documented baseline (≤10px) at 1920×1080, 1600×900, 1440×900, and 1366×768. If it regresses, trim `.menu-panel` padding or `#menu-nav-buttons` gap in `src/style.css` (do not touch unrelated CSS) until it's back in budget.

- [ ] **Step 7: Commit**

```bash
git add src/game/BuildMode.js src/game/Game.js index.html tests/buildmode.spec.js
git commit -m "Add Build Mode skeleton: scene, ground plane, free-fly camera"
```

---

### Task 2: Block palette + placement/removal via InstancedMesh

**Files:**
- Modify: `src/game/BuildMode.js`
- Modify: `tests/buildmode.spec.js`

**Interfaces:**
- Consumes: `BuildMode`'s existing `scene`, `camera`, `renderer` from Task 1.
- Produces: `BuildMode.BLOCK_TYPES` (array of `{ id, color }`, 9 entries), `BuildMode.prototype.selectedType` (string, one of the 9 ids), `placeBlock(x, y, z, type)`, `removeBlock(x, y, z)`, `getBlockAt(x, y, z)` (returns the type string or `null`), and a `_onPointerDown` handler wired in `enter()`/`exit()` for left-click place / right-click remove. Later tasks (save/load) rely on `placeBlock`/`getBlockAt`/the internal sparse map's key format (`` `${x},${y},${z}` ``, all integers).

- [ ] **Step 1: Add the block palette and InstancedMesh layer**

In `src/game/BuildMode.js`, add after the existing constants:

```javascript
export const BLOCK_TYPES = [
  { id: 'concrete', color: 0x9a9a92 },
  { id: 'brick', color: 0xa8503a },
  { id: 'wood', color: 0x8a5a34 },
  { id: 'metal', color: 0xb0b8bd },
  { id: 'grass', color: 0x5fa84a },
  { id: 'dirt', color: 0x6b4a30 },
  { id: 'glass', color: 0xaee0e8 },
  { id: 'asphalt', color: 0x3a3a3c },
  { id: 'stone', color: 0x808078 },
]
const MAX_INSTANCES_PER_TYPE = 4096
```

In the constructor, after the ground-plane setup, add:

```javascript
// One InstancedMesh per block type (not one Mesh per block) - keeps the
// scene graph at a fixed 9 objects regardless of how many blocks are
// placed, avoiding this project's own documented CPU-bound-on-scene-
// graph-traversal bottleneck (see docs/PERFORMANCE.md).
this.selectedType = BLOCK_TYPES[0].id
this._blocks = new Map() // "x,y,z" -> type id
this._instancedMeshes = {}
this._instanceKeyByIndex = {} // type id -> array mapping instance index -> "x,y,z" key, for swap-remove
const blockGeo = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE)
for (const { id, color } of BLOCK_TYPES) {
  const mesh = new THREE.InstancedMesh(blockGeo, new THREE.MeshStandardMaterial({ color }), MAX_INSTANCES_PER_TYPE)
  mesh.count = 0
  this.scene.add(mesh)
  this._instancedMeshes[id] = mesh
  this._instanceKeyByIndex[id] = []
}

this._raycaster = new THREE.Raycaster()
this._onPointerDown = (e) => {
  if (document.pointerLockElement !== this.renderer.domElement) return
  if (e.button === 0) this._placeFromCamera()
  else if (e.button === 2) this._removeFromCamera()
}
```

- [ ] **Step 2: Add placement/removal core methods and raycasting**

```javascript
_key(x, y, z) {
  return `${x},${y},${z}`
}

getBlockAt(x, y, z) {
  return this._blocks.get(this._key(x, y, z)) ?? null
}

placeBlock(x, y, z, type) {
  const key = this._key(x, y, z)
  if (this._blocks.has(key)) return
  const mesh = this._instancedMeshes[type]
  if (!mesh || mesh.count >= MAX_INSTANCES_PER_TYPE) return
  const index = mesh.count
  const matrix = new THREE.Matrix4().makeTranslation(x + 0.5, y + 0.5, z + 0.5)
  mesh.setMatrixAt(index, matrix)
  mesh.count++
  mesh.instanceMatrix.needsUpdate = true
  this._blocks.set(key, type)
  this._instanceKeyByIndex[type][index] = key
}

removeBlock(x, y, z) {
  const key = this._key(x, y, z)
  const type = this._blocks.get(key)
  if (!type) return
  const mesh = this._instancedMeshes[type]
  const keys = this._instanceKeyByIndex[type]
  const removedIndex = keys.indexOf(key)
  const lastIndex = mesh.count - 1
  if (removedIndex !== lastIndex) {
    // Swap-remove: move the last instance's transform into the removed
    // slot, then shrink count - InstancedMesh has no native "delete at
    // index", this is the standard technique.
    const lastMatrix = new THREE.Matrix4()
    mesh.getMatrixAt(lastIndex, lastMatrix)
    mesh.setMatrixAt(removedIndex, lastMatrix)
    keys[removedIndex] = keys[lastIndex]
  }
  keys.pop()
  mesh.count--
  mesh.instanceMatrix.needsUpdate = true
  this._blocks.delete(key)
}

_placeFromCamera() {
  this._raycaster.setFromCamera({ x: 0, y: 0 }, this.camera)
  const hit = this._raycastGridAligned()
  if (!hit) return
  const [px, py, pz] = hit.placeAt
  this.placeBlock(px, py, pz, this.selectedType)
}

_removeFromCamera() {
  this._raycaster.setFromCamera({ x: 0, y: 0 }, this.camera)
  const hit = this._raycastGridAligned()
  if (!hit || !hit.existingBlock) return
  const [rx, ry, rz] = hit.existingBlock
  this.removeBlock(rx, ry, rz)
}

// Steps a ray forward in fixed small increments and checks the sparse
// block map at each grid cell - simpler and more robust for a uniform
// grid than THREE's mesh-based raycasting against InstancedMesh (which
// needs per-instance bounding data this project doesn't otherwise need).
_raycastGridAligned() {
  const origin = this._raycaster.ray.origin
  const dir = this._raycaster.ray.direction
  const maxDist = 40
  const step = 0.1
  let prevCell = null
  for (let t = 0; t < maxDist; t += step) {
    const px = origin.x + dir.x * t
    const py = origin.y + dir.y * t
    const pz = origin.z + dir.z * t
    const cell = [Math.floor(px), Math.floor(py), Math.floor(pz)]
    if (py <= 0) {
      // Hit the ground plane before hitting any block.
      return prevCell ? { placeAt: prevCell, existingBlock: null } : { placeAt: cell, existingBlock: null }
    }
    if (this.getBlockAt(cell[0], cell[1], cell[2])) {
      return { placeAt: prevCell || cell, existingBlock: cell }
    }
    prevCell = cell
  }
  return null
}
```

- [ ] **Step 3: Wire pointer-down listener into `enter()`/`exit()`, and disable the browser's right-click menu while active**

In `enter()`, add:

```javascript
this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown)
this._onContextMenu = (e) => { if (this.active) e.preventDefault() }
window.addEventListener('contextmenu', this._onContextMenu)
```

In `exit()`, add:

```javascript
this.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown)
window.removeEventListener('contextmenu', this._onContextMenu)
```

- [ ] **Step 4: Add Playwright tests for placement and removal**

Append to `tests/buildmode.spec.js`:

```javascript
test('placing and removing a block updates both the InstancedMesh and the internal map', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(() => {
    const g = window.__game
    g._enterBuildMode()
    g.buildMode.placeBlock(2, 0, 3, 'brick')
    const afterPlace = {
      atBlock: g.buildMode.getBlockAt(2, 0, 3),
      meshCount: g.buildMode._instancedMeshes.brick.count,
    }
    g.buildMode.removeBlock(2, 0, 3)
    const afterRemove = {
      atBlock: g.buildMode.getBlockAt(2, 0, 3),
      meshCount: g.buildMode._instancedMeshes.brick.count,
    }
    g._exitBuildMode()
    return { afterPlace, afterRemove }
  })

  expect(result.afterPlace.atBlock).toBe('brick')
  expect(result.afterPlace.meshCount).toBe(1)
  expect(result.afterRemove.atBlock).toBe(null)
  expect(result.afterRemove.meshCount).toBe(0)
})

test('removing one block does not remove a different still-placed block of the same type (swap-remove correctness)', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(() => {
    const g = window.__game
    g._enterBuildMode()
    g.buildMode.placeBlock(0, 0, 0, 'stone')
    g.buildMode.placeBlock(1, 0, 0, 'stone')
    g.buildMode.placeBlock(2, 0, 0, 'stone')
    g.buildMode.removeBlock(1, 0, 0) // remove the middle one
    const remaining = {
      first: g.buildMode.getBlockAt(0, 0, 0),
      removed: g.buildMode.getBlockAt(1, 0, 0),
      third: g.buildMode.getBlockAt(2, 0, 0),
      meshCount: g.buildMode._instancedMeshes.stone.count,
    }
    g._exitBuildMode()
    return remaining
  })

  expect(result.first).toBe('stone')
  expect(result.removed).toBe(null)
  expect(result.third).toBe('stone')
  expect(result.meshCount).toBe(2)
})
```

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/buildmode.spec.js`
Expected: all 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/game/BuildMode.js tests/buildmode.spec.js
git commit -m "Add block palette, InstancedMesh placement/removal to Build Mode"
```

---

### Task 3: Tab picker overlay

**Files:**
- Modify: `index.html` (new `#build-picker` overlay markup)
- Modify: `src/style.css` (picker grid styling)
- Modify: `src/game/BuildMode.js` (Tab toggle + swatch click wiring)
- Modify: `tests/buildmode.spec.js`

**Interfaces:**
- Consumes: `BuildMode.BLOCK_TYPES`, `this.selectedType` from Task 2.
- Produces: `BuildMode.prototype.togglePicker()`, public field `pickerOpen` (boolean) — no later task depends on this beyond the test file.

- [ ] **Step 1: Add the picker overlay markup to `index.html`**

Add right after the `#build-mode-exit-btn` line from Task 1 Step 3:

```html
<div id="build-picker" style="display: none"></div>
```

- [ ] **Step 2: Add picker styling to `src/style.css`**

```css
#build-picker {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 20;
  display: grid;
  grid-template-columns: repeat(3, 64px);
  gap: 10px;
  padding: 16px;
  background: rgba(10, 10, 10, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
}

.build-picker-swatch {
  width: 64px;
  height: 64px;
  border-radius: 4px;
  border: 2px solid transparent;
  cursor: pointer;
}

.build-picker-swatch.selected {
  border-color: #d9a34a;
}
```

- [ ] **Step 3: Render the swatches and wire Tab/click in `BuildMode.js`**

In the constructor, after the pointer-down setup from Task 2, add:

```javascript
this.pickerOpen = false
this._pickerEl = document.getElementById('build-picker')
this._renderPicker()
this._onKeyDownPicker = (e) => {
  if (e.code === 'Tab') {
    e.preventDefault()
    this.togglePicker()
  } else if (e.code === 'Escape' && this.pickerOpen) {
    this.togglePicker()
  }
}
```

Add these methods:

```javascript
_renderPicker() {
  if (!this._pickerEl) return
  this._pickerEl.innerHTML = ''
  for (const { id, color } of BLOCK_TYPES) {
    const swatch = document.createElement('div')
    swatch.className = 'build-picker-swatch' + (id === this.selectedType ? ' selected' : '')
    swatch.style.background = `#${color.toString(16).padStart(6, '0')}`
    swatch.addEventListener('click', () => {
      this.selectedType = id
      this.togglePicker()
    })
    this._pickerEl.appendChild(swatch)
  }
}

togglePicker() {
  this.pickerOpen = !this.pickerOpen
  if (this._pickerEl) this._pickerEl.style.display = this.pickerOpen ? 'grid' : 'none'
  if (this.pickerOpen) this._renderPicker()
  if (document.pointerLockElement === this.renderer.domElement && this.pickerOpen) {
    document.exitPointerLock()
  } else if (!this.pickerOpen) {
    this.renderer.domElement.requestPointerLock()
  }
}
```

In `enter()`, add `window.addEventListener('keydown', this._onKeyDownPicker)`. In `exit()`, add `window.removeEventListener('keydown', this._onKeyDownPicker)` and `this.pickerOpen = false; if (this._pickerEl) this._pickerEl.style.display = 'none'`.

- [ ] **Step 4: Add Playwright test for the picker**

Append to `tests/buildmode.spec.js`:

```javascript
test('Tab opens the picker, clicking a swatch changes the selected block type', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    g._enterBuildMode()
    const beforeType = g.buildMode.selectedType
    g.buildMode.togglePicker()
    const openAfterToggle = g.buildMode.pickerOpen
    const swatches = document.querySelectorAll('.build-picker-swatch')
    swatches[2].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const afterClickType = g.buildMode.selectedType
    const closedAfterClick = g.buildMode.pickerOpen
    g._exitBuildMode()
    return { beforeType, openAfterToggle, afterClickType, closedAfterClick, swatchCount: swatches.length }
  })

  expect(result.openAfterToggle).toBe(true)
  expect(result.swatchCount).toBe(9)
  expect(result.afterClickType).not.toBe(result.beforeType)
  expect(result.closedAfterClick).toBe(false)
})
```

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/buildmode.spec.js`
Expected: all 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html src/style.css src/game/BuildMode.js tests/buildmode.spec.js
git commit -m "Add Tab block picker overlay to Build Mode"
```

---

### Task 4: Save/load to localStorage

**Files:**
- Modify: `src/game/BuildMode.js`
- Modify: `index.html` (Save button)
- Modify: `tests/buildmode.spec.js`

**Interfaces:**
- Consumes: `this._blocks` (the sparse map from Task 2), `placeBlock`/`getBlockAt` from Task 2.
- Produces: `save()`, `load()` — both called automatically (`load()` from `enter()`, `save()` from `exit()`), plus a manual Save button wired to `save()`.

- [ ] **Step 1: Add save/load methods to `BuildMode.js`**

```javascript
const SAVE_KEY = 'gayz-build-mode'
const VALID_TYPE_IDS = new Set(BLOCK_TYPES.map((b) => b.id))

save() {
  const entries = []
  for (const [key, type] of this._blocks) {
    const [x, y, z] = key.split(',').map(Number)
    entries.push({ x, y, z, type })
  }
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(entries))
  } catch {
    // Storage unavailable (e.g. private browsing) - build just won't persist.
  }
}

load() {
  let raw
  try {
    raw = localStorage.getItem(SAVE_KEY)
  } catch {
    return
  }
  if (!raw) return
  let entries
  try {
    entries = JSON.parse(raw)
  } catch {
    return
  }
  if (!Array.isArray(entries)) return
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const { x, y, z, type } = entry
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    if (!VALID_TYPE_IDS.has(type)) continue
    this.placeBlock(Math.trunc(x), Math.trunc(y), Math.trunc(z), type)
  }
}
```

- [ ] **Step 2: Call `load()` on enter and `save()` on exit**

In `enter()`, add `this.load()` as the last line. In `exit()`, add `this.save()` as the first line (before clearing any state).

- [ ] **Step 3: Add a manual Save button**

In `index.html`, right after `#build-mode-exit-btn`:

```html
<button id="build-mode-save-btn" style="display: none">Save</button>
```

In `Game.js`'s `_enterBuildMode()`/`_exitBuildMode()` (Task 1 Step 2), add showing/hiding this button alongside the exit button (`document.getElementById('build-mode-save-btn').style.display = 'block'` / `'none'`). In `_bindHomepageBatch()`, alongside the exit button wiring from Task 1 Step 3:

```javascript
const saveBtn = document.getElementById('build-mode-save-btn')
if (saveBtn) saveBtn.addEventListener('click', () => this.buildMode.save())
```

- [ ] **Step 4: Add Playwright tests for save/load and malformed-data resilience**

Append to `tests/buildmode.spec.js`:

```javascript
test('a saved build reloads correctly in a fresh BuildMode instance', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(() => {
    const g = window.__game
    g._enterBuildMode()
    g.buildMode.placeBlock(5, 0, 5, 'metal')
    g.buildMode.placeBlock(6, 0, 5, 'glass')
    g.buildMode.save()
    g._exitBuildMode()

    // Fresh instance reading the same localStorage key, same technique
    // this project's own settings-persistence tests already use.
    g.buildMode = new g.buildMode.constructor(g.renderer)
    g.buildMode.load()
    return {
      metal: g.buildMode.getBlockAt(5, 0, 5),
      glass: g.buildMode.getBlockAt(6, 0, 5),
    }
  })

  expect(result.metal).toBe('metal')
  expect(result.glass).toBe('glass')
})

test('malformed save data does not crash Build Mode - starts empty instead', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))

  const result = await page.evaluate(() => {
    localStorage.setItem('gayz-build-mode', 'not valid json {{{')
    const g = window.__game
    g._enterBuildMode()
    const blockCount = g.buildMode._blocks.size
    g._exitBuildMode()
    return { blockCount }
  })

  expect(result.blockCount).toBe(0)
  expect(errors).toEqual([])
})
```

Note: `BuildMode` is imported inside `Game.js` as a named export, not attached to `window`, so `g.buildMode.constructor` (used above to construct a fresh instance without a second import) relies on the existing instance's own constructor reference — this works because `class` instances always carry a `.constructor` property back to their class, no separate export needed for the test.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/buildmode.spec.js`
Expected: all 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/game/BuildMode.js index.html tests/buildmode.spec.js
git commit -m "Add save/load to Build Mode (localStorage, one slot)"
```

---

### Task 5: Full verification pass and deploy

**Files:**
- Modify: `tests/buildmode.spec.js` (one more test, see Step 1)

- [ ] **Step 1: Add a test confirming repeated enter/exit doesn't leak listeners**

Every `enter()` across Tasks 1-3 adds global `keydown`/`keyup`/`mousemove`/`contextmenu` listeners; every `exit()` removes the matching one. If any pair drifted out of sync, re-entering Build Mode multiple times would silently accumulate duplicate listeners - e.g. movement would get faster each time you re-enter, since `KeyW` would move the camera once per surviving listener. Append to `tests/buildmode.spec.js`:

```javascript
test('re-entering Build Mode multiple times does not accumulate duplicate movement listeners', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(() => {
    const g = window.__game
    // Enter/exit 3 times before the real measurement - if listeners were
    // leaking, this is where duplicates would build up.
    for (let i = 0; i < 3; i++) {
      g._enterBuildMode()
      g._exitBuildMode()
    }
    g._enterBuildMode()
    const before = g.buildMode.camera.position.clone()
    g.buildMode._keys.add('KeyW')
    g.buildMode.update(0.5)
    g.buildMode._keys.delete('KeyW')
    const after = g.buildMode.camera.position.clone()
    g._exitBuildMode()
    return { distanceMoved: before.distanceTo(after) }
  })

  // update(dt) is called exactly once here regardless of prior enter/exit
  // cycles, so distance moved must match a single un-duplicated call -
  // same FLY_SPEED * 0.5 used in Task 1's movement test, not some
  // multiple of it.
  expect(result.distanceMoved).toBeGreaterThan(3.9)
  expect(result.distanceMoved).toBeLessThan(4.1)
})
```

- [ ] **Step 2: Run the complete Playwright suite (not just the new spec)**

Run: `npm test`
Expected: all tests PASS, including the pre-existing `construction`/`save`/`settings`/`progression` specs — confirms Build Mode's new global listeners/DOM changes didn't regress anything else.

- [ ] **Step 3: Run lint and build**

Run: `npm run lint`
Expected: 0 errors (pre-existing warnings unrelated to this feature are fine, per this project's established baseline).

Run: `npm run build`
Expected: builds clean.

- [ ] **Step 4: Manual smoke check against the real preview build**

Start `npm run preview`, open the app, click Build, confirm: WASD+mouse-look flying works, left-click places the selected block, right-click removes it, Tab opens/closes the picker and clicking a swatch changes the block, Save persists across a real page reload (re-enter Build Mode after reloading the tab), Exit returns cleanly to the homepage with no leftover pointer-lock or stuck input.

- [ ] **Step 5: Re-verify zero-scroll overflow one more time (final)**

Same check as Task 1 Step 6, at all 4 tracked heights, confirming the final state (all 5 tasks' worth of homepage changes) still holds the budget.

- [ ] **Step 6: Commit, push, deploy**

```bash
git add -A
git commit -m "Build Mode v1 complete"
git push origin main
npx vercel --prod --yes --scope mrgulper
```
