# GayZ project notes

Browser Three.js zombie-survival FPS. Vite build, no framework. No committed test suite — verification is done by driving the real running game (Playwright, real game methods via `page.evaluate()`, not simulated input events).

**`3D_ASSET_OVERHAUL.md` (repo root)** holds a complete, adversarially-verified research handoff + phased plan for replacing all ~75 procedural models with real 3D assets at zero cost (CC0 packs / free tiers / Blender scripting). Self-contained — read it before starting any asset/visual-overhaul work.

## Standing rules for this project

- Every completed update gets committed, pushed to GitHub (`mrgulper/gayz`, private), and deployed to Vercel production (`npx vercel --prod --yes` → `gayz.vercel.app`) without asking each time.
- For batched/greenlit feature work, build straight through without stopping for confirmation checkpoints between items.
- Don't ship inert UI. If a feature's markup/CSS is scaffolded before its logic is wired up, leave it uncommitted rather than deploying a checkbox or HUD element that does nothing.

## Recurring bug classes

- **Shared-material mutation**: runtime flash/recolor effects (barrels, targets, hit-flash, etc.) must `.clone()` their material per instance. A shared module-level material fought over by simultaneous instances is a recurring source of visual bugs in this codebase.
- **Rotated-mesh AABB inflation**: `THREE.Box3.setFromObject()` on a rotated mesh inflates well past its visual footprint. Build axis-aligned collider boxes explicitly from known dimensions instead, for anything not axis-aligned.
- **`buildingLayout()` in `src/game/World.js` is fully deterministic** (seeded arithmetic, no `Math.random()`). Any "player stuck here" report can be root-caused by hand-computing the relevant building index's bounds directly from the array, rather than guessing from the visuals.
- **Safe zone (`buildSafeZone`) and street-grid buildings (`buildingLayout`) have no mutual awareness of each other.** They were placed independently. Before adding new safe-zone-interior features, check nearby `buildingLayout()` indices aren't secretly overlapping — building index 7 did (see `EXCLUDED_BUILDING_IDXS` in `World.js`) and silently bisected the compound with an invisible wall until root-caused.
- **The safe zone's position is `SAFE_ZONE_X`/`SAFE_ZONE_Z` (module-level constants in `World.js`, currently `0, 42` — moved once already from `-13, -10`).** Anything meant to live inside it should be positioned as an offset from these constants (like the Vault/practice range/trophy wall already are), never hardcoded absolute coordinates — `buildTraderStall`/`buildAmmoStation` used to hardcode their own position matching the *old* safe zone location, and got silently left behind on the last move until root-caused. Also re-check any other underground/surface structure whose fixed coordinates might now fall inside the safe zone's footprint (x=±7, z=±7 of center) — the sewer tunnel did.

## Gotchas

- `WeaponSystem.current` is a getter off `currentIndex` (`get current() { return this.weapons[this.currentIndex] }`). Assigning `weapons.current = X` is a silent no-op — set `currentIndex` instead.
- i18n keys (`src/game/i18n.js`) are only added to the English block in this codebase's current state — other language blocks are intentionally not kept in sync yet.
- Persistent (localStorage) vs per-run state: `MetaProgress.js`, `WeaponMastery.js`, `Achievements.js` persist across runs. `companionTrainingLevel`, `companionGear`, shop purchases reset on a fresh `new Game()` but survive a same-session "restart run" click — match this precedent for any new per-run state.

## Playwright verification quirks (no test suite exists — this is the actual verification method)

- Separate `page.evaluate()` calls can have multi-second real wall-clock gaps even for trivial scripts. Timing-sensitive assertions must happen inside one `evaluate()` call.
- `THREE` isn't globally exposed in the bundled build — `new THREE.Vector3()` inside `page.evaluate()` fails. Clone an existing Vector3 already in scope instead.
- Moving a mesh via `.position.set()` post-construction doesn't update `matrixWorld` until the next `renderer.render()`. Call `mesh.updateWorldMatrix(true, false)` before raycasting against a repositioned mesh.
- Fake zombie/rival test stubs need a `hittableMeshes: []` field or `WeaponSystem._fire()`'s `flatMap` throws.
- `Game.js`'s constructor sets `window.__game = this` at the very end, specifically so Playwright can drive real game methods without reaching into module scope — use `page.waitForFunction(() => window.__game)` to know the game finished constructing before calling anything on it.
- Headless Playwright can't actually grant real Pointer Lock (`THREE.PointerLockControls: Unable to use Pointer Lock API`) — the `lock`/`unlock` events this game relies on for pause-menu/audio state never fire from a real `.lock()` call in that environment. Set `game.gameStarted = true` (and whatever other flag the test needs) directly instead of assuming a `playBtn.click()` produced real lock state.
- Raycasting against a zombie (a `SkinnedMesh`) returns zero hits until `game.renderer.render(game.scene, game.camera)` has actually run at least once — `SkinnedMesh.raycast()` lazily computes its own world-space bounding sphere from live bone transforms, which are only ever baked by the renderer's normal per-frame `skeleton.update()`. Spawning a zombie and immediately calling `WeaponSystem._fire()`/a manual raycast in the same `evaluate()` silently misses every time; call `renderer.render(...)` once after positioning everything and before the raycast. Also don't aim at eye-height (~1.6) — this game's zombie mesh's own vertical extent is only about ±1 around its group origin, not a human eye-height collider.

## New hittable-object categories

`WeaponSystem._fire()`'s raycast checks `hit.object.userData.<flag>` (`.explosive`, `.practiceTarget`, `.rival`, `.zombie`, etc.) — add a new flag and a hook rather than restructuring the core raycast when adding a new shootable thing.
