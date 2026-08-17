# Build Mode (v1) — Design

## Purpose

A standalone block-placing creative mode, inspired by Kirka.io/Bloxd.io's map editors. Explicitly **not** connected to zombie survival gameplay — no zombies spawn here, no pathfinding, no run stats. It's a separate sandbox for building for its own sake, reachable from the homepage and fully disconnected from `World.js`'s hand-built city and the night/day survival loop.

This is a deliberately scoped-down first slice. Kirka's own editor (multiple block categories, named map lists, import/export codes, lighting/skybox/fog controls) is the eventual reference point, not the v1 target — see "Deferred" below.

## Why this shape

- **Standalone, not integrated with zombie gameplay** (confirmed with the user): the alternative — letting zombies path and spawn on an arbitrary player-built layout — is an open-ended pathfinding problem on top of a new editor, too much for a first slice.
- **Free-fly camera, not the real PlayerController**: building requires flying up to place blocks at height with no gravity/collision fighting you. Reusing the survival game's grounded, gravity-and-collision movement code would mean fighting it the whole time; a small dedicated fly-cam is simpler to build and matches how every reference block editor actually works.
- **`InstancedMesh` per block type, not one mesh per block**: this project's own `docs/PERFORMANCE.md` already diagnosed the live game as CPU-bound on scene-graph traversal at ~14,800 objects. A voxel editor can easily reach thousands of placed blocks; giving each one its own `THREE.Mesh`/scene-graph node would reproduce that exact bottleneck. `InstancedMesh` keeps one scene-graph object *per block type* (9 total for v1) regardless of how many instances are placed, with per-instance position handled via a shared transform buffer instead of a scene-graph node each.
- **One save slot, not named maps**: matches this project's existing `localStorage`-only persistence pattern (no backend needed) and keeps v1 buildable without designing a save-browsing UI yet.

## Architecture

New module: `src/game/BuildMode.js`, following this codebase's established pattern for self-contained subsystems (`ZombieManager.js`, `PickupManager` in `Pickups.js`) — a class owning its own THREE.js objects and per-frame `update(dt)`, instantiated by `Game.js` and only active while Build Mode is open.

```
Game.js
  ├─ "Build" button (homepage) → BuildMode.enter()
  ├─ owns: buildScene (separate THREE.Scene, not World.js's city scene)
  └─ delegates per-frame update + input to BuildMode while active

BuildMode.js
  ├─ FreeFlyCamera        - WASD/mouse/Space/Shift, no gravity or collision
  ├─ BlockPalette         - 9 fixed types, flat-colored (no textures in v1)
  ├─ InstancedBlockLayer  - one THREE.InstancedMesh per block type (9 total)
  ├─ placement raycasting - left-click place, right-click remove, grid-snapped
  ├─ picker overlay       - Tab toggles a simple DOM grid (not in-3D UI) of the 9 block types; click one to select, Tab/Escape closes it
  └─ save/load            - one localStorage key, sparse {x,y,z,type} array
```

### Data flow

1. **Enter**: `Game.js`'s Build button hides the homepage, shows a blank canvas rendering `buildScene`, activates `BuildMode`, which loads the saved layout (if any) from `localStorage` and instantiates each block type's `InstancedMesh` sized to the loaded instance count (+ headroom for new placements).
2. **Placing**: every frame, raycast from screen center against the ground plane and all placed block instances. On left-click, if the ray hits something, compute the adjacent empty grid cell (hit point + face normal, snapped to block size) and add an instance of the currently-selected type there (update the `InstancedMesh`'s instance matrix buffer + an in-memory sparse map keyed by `"x,y,z"` for O(1) placed/empty lookups during raycasting and removal).
3. **Removing**: right-click on a placed block removes its instance (swap-remove from the buffer, per `InstancedMesh`'s usual pattern of shrinking `count` and moving the last instance into the removed slot) and deletes it from the sparse map.
4. **Picker**: Tab toggles a plain DOM overlay (not part of the 3D scene) showing the 9 block types as colored swatches; clicking one sets the "currently selected type" and closes the picker.
5. **Save**: a Save button serializes the sparse map to `[{x,y,z,type}, ...]` JSON and writes it to a single fixed `localStorage` key (e.g. `gayz-build-mode`), overwriting any prior save — matching the "one save slot" scope.
6. **Exit**: an Exit button (or Escape when the picker isn't open) tears down `BuildMode`'s per-frame update, hides the build canvas, and returns to the homepage. The saved layout persists in `localStorage` regardless of whether Save was clicked again on this visit (auto-save on exit is a reasonable default; exact trigger is an implementation detail, not a design fork).

### Components in detail

- **Ground plane**: a single large flat plane (e.g. 64×64 blocks) at y=0, textured or flat-colored to visually read as "buildable area," with a subtle grid line shader or texture so placement alignment is visible.
- **Block size**: one fixed unit cube size for all 9 types in v1 (no half-blocks, slabs, or stairs yet — flat parity with "just place cubes").
- **Palette content** (v1, flat colors only): Concrete, Brick, Wood, Metal, Grass, Dirt, Glass, Asphalt, Stone.

## Error handling

- **`localStorage` unavailable** (private browsing, quota exceeded): save silently no-ops with a toast, matching this project's existing `saveSettings`/`saveSecretsProgress` try/catch convention — never throws, never blocks Build Mode from working, just doesn't persist for that session.
- **Corrupted/malformed save data on load**: wrap the JSON parse + array validation in a try/catch; on failure, start from an empty layout rather than crashing Build Mode open. Every entry is validated as `{x,y,z: finite numbers, type: one of the 9 known ids}` before being placed — same defensive stance this project already applies to untrusted persisted data (see `_safeStatNumber`/`_escapeHtml`'s own established precedent for "anything from localStorage is untrusted").

## Testing

Following this project's existing Playwright-driven verification (real game methods via `page.evaluate()`, not simulated input):

- Entering Build Mode sets up the expected state (`window.__game`'s Build Mode flag/reference exists, `buildScene` has the ground plane).
- A placed block is reflected in both the `InstancedMesh` instance count and the sparse in-memory map.
- Removing a placed block correctly decrements the instance count and removes it from the map (and that a *different* still-placed block isn't accidentally removed by the swap-remove).
- Save → reload (a fresh `BuildMode` instance reading the same `localStorage` key) reproduces the same set of placed blocks.
- A malformed save value doesn't crash Build Mode on entry (starts empty instead).
- Exiting and re-entering Build Mode doesn't leak the free-fly camera's per-frame update loop (no lingering `requestAnimationFrame`/input listeners from a previous session).

## Deferred (explicitly out of scope for v1)

- Multiple block categories / dozens of textured block types (Kirka's "cube / HB / plants / different" tabs) - since built out to 90+ textured types (see `BLOCK_TYPES` in `BuildMode.js`), well past v1's scope.
- Import/export as a shareable code (matches this project's existing setup/loadout-code pattern, but not built yet) - file-based export/import (`exportMap`/`importMapFile`) was built instead.
- Skybox and fog controls (still deferred). Lighting itself is no longer fully deferred - block types with an emissive material (lava, glowstone, sea lantern, etc.) now spawn a real `THREE.PointLight` when placed (see `LIGHT_BLOCK_COLORS`/`MAX_ACTIVE_LIGHTS`), not just a glowing texture. No player-controlled skybox/fog/global lighting settings yet.
- Any connection to zombie survival gameplay (explicitly ruled out for v1, confirmed again directly with the user in a later round - see "Why this shape").

## Since v1 (not exhaustive - see BuildMode.js's own comments for detail)

- **Undo/Redo** (Ctrl+Z / Ctrl+Y or Ctrl+Shift+Z) - a batched history (`_undoStack`/`_redoStack`), so one user action (a single click, or a whole line/mirror/paste) undoes as one step.
- **Multiple save slots** (`SAVE_SLOT_COUNT = 3`) - the "one save slot" v1 decision above was superseded once a save-slot picker UI was actually built; `SAVE_SLOTS_KEY` holds the 3 slots, with the original single `SAVE_KEY` kept only as a one-time migration source.
- **Mirror mode** (M key) - mirrors every placement/removal across world x=0.
- **Line tool** (L key) - two clicks (start, end) fills a straight line of the selected block between them, as one undo step.
- **Copy/Paste** (C key to mark a box, P key to paste) - copies every placed block inside an axis-aligned box (as offsets from its minimum corner) and can stamp it anywhere, as one undo step.
