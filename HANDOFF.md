# GayZ — Session Handoff

Resume-kit for picking this session back up. Written 2026-07-18.

> **Taking this project over? Start with [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) (2026-08-05).**
> It diagnoses the FPS/stutter problem that was still open when this file was
> written, and lays out the full plan to fix it. The rest of this document is a
> point-in-time resume kit from July and its "uncommitted work" section is
> stale — treat it as history, not as a to-do list.

## Git state

- Branch: `main`, up to date with `origin/main`, no stashes.
- Uncommitted (unstaged, not yet added): `index.html`, `src/style.css` — see "Uncommitted work" below. Everything else from this session is already committed and pushed/deployed per standing auto-commit/deploy rules.

Last 6 commits (newest first):
```
8f42c5b Add trophy wall to the safe zone + fix a pre-existing invisible wall
1136a0e Add passive radio chatter lore broadcasts
c322bbe Add ambient environmental hazards: toxic gas and EMP field events
c5f2759 Add companion gear: Vest and Tactical Rig loadout items
315ed2d Add weapon mastery: permanent per-gun damage bonus at 75 kills
d1cb471 Turn permanent upgrades into a branching talent tree
```

Full session span (24 commits, `36b8a87..8f42c5b`), each already carrying a descriptive "what/why" message — see `git log 36b8a87..HEAD` for the complete list. Cumulative diff for the session:
```
21 files changed, 2612 insertions(+), 90 deletions(-)
```
Touched: `index.html`, `src/game/Audio.js`, `BarricadeWindows.js`, `Chests.js`, `Companion.js`, `Game.js` (heaviest — 834 lines), `Inventory.js`, `Keybinds.js`, `MetaProgress.js`, `Minimap.js`, `NightEvents.js`, `Pickups.js`, `PlayerController.js`, `RivalScavenger.js` (new file), `WeaponMastery.js` (new file), `WeaponSystem.js`, `World.js` (520 lines — new buildings/geometry), `Zombie.js`, `ZombieManager.js`, `i18n.js`, `src/style.css`.

## Uncommitted work (King of the Hill — UI scaffolding only, not wired)

`index.html`: added the `#mutator-koth` checkbox (round-mode-select panel, after `mutator-horde-mode`) and the `#koth-wrap`/`#koth-label`/`#koth-fill` HUD bar (after `#boss-health-wrap`), `display:none` by default.

`src/style.css`: added `#koth-wrap`/`#koth-label`/`.koth-fill` styling — gold/tan palette (`#ffcf5c`/`#e3a63c`), positioned `top:100px` so it sits below the boss health bar (`top:54px`) without overlapping.

**Neither file has any JS behind it yet.** The checkbox doesn't do anything when clicked; the HUD bar never appears. Left uncommitted deliberately rather than shipping dead UI to production. `npx vite build` still succeeds with these in place (verified below) since they're inert markup/CSS.

## Resume commands

```bash
npm install        # if node_modules is missing/stale
npx vite            # dev server, default port 5173 (falls back if busy)
npx vite build       # production build → dist/
npx vite preview     # serve the dist/ build locally
```
No env vars or external services required to run locally. Deploy target is Vercel (`npx vercel --prod --yes`) to `gayz.vercel.app`; repo is `mrgulper/gayz` on GitHub (private), remote already configured as `origin`.

No test suite exists (no Jest/Vitest/Playwright config committed to the repo) — verification this whole session was done via one-off Playwright scripts in the scratchpad directory (not part of the repo), calling real game methods through `page.evaluate()` rather than simulating input events. None of those scripts are meant to be kept long-term.

## Last known build baseline

Ran `npx vite build` just now with the uncommitted KOTH scaffolding in place:
```
✓ 57 modules transformed.
dist/index.html                    21.37 kB │ gzip:   4.11 kB
dist/assets/index-CWXyUb9j.css     25.77 kB │ gzip:   5.53 kB
dist/assets/index-DLk1XCk6.js   1,019.43 kB │ gzip: 268.41 kB
✓ built in 698ms
```
One pre-existing warning (main JS chunk >500kB, no code-splitting configured) — not new this session, not an error, safe to ignore unless load time becomes a real concern.

No failing tests or errors to report — build is clean.

## Next steps (file-level)

1. **Finish King of the Hill mode.** Nothing beyond the HTML/CSS scaffolding above exists yet. To wire it up:
   - `src/game/Game.js`: add `mutators.kingOfTheHill` to the settings object (mirror `mutators.hordeMode`'s checkbox-sync pattern — find where `mutatorHordeMode.checked = this.settings.mutators.hordeMode` is set and its change listener, do the same for `#mutator-koth`).
   - `src/game/Game.js`: hill-zone state — a position (pick via same pattern as existing safe-zone/vault placement, staying clear of `EXCLUDED_BUILDING_IDXS` and existing structures), a radius, a "controlled by player" flag, and a capture-progress float.
   - `src/game/Game.js` `_tick()`: distance-check player position against the hill zone each frame; accumulate capture progress while inside, decay or hold while outside (decide which — not designed yet); award coins/score on full capture; relocate the hill after capture (open question — see below).
   - `src/game/Game.js`: drive `#koth-wrap` visibility, `#koth-label` text, and `#koth-fill` width from the capture-progress state (same pattern as `#boss-health-fill`).
   - Consider: increased zombie spawn pressure near the hill while it's active, per the original feature-list description — not yet designed.
   - `src/game/World.js`: only touch if the hill needs a visual marker/geometry (e.g. a flag or a ring on the ground); not required for a first pass — a HUD-only implementation could ship first and get a visual marker after.

2. After King of the Hill ships (build → verify via Playwright real-method calls → commit → push → deploy, same as the other 24 features this session), continue the round-1 backlog in order: Extraction mode, Daily Challenge, Rooftop layer, Interior building, Recruitable survivor NPCs, Base upgrades, Prestige/New Game+ system. None of these have any code started.

## Open / deferred

- **King of the Hill mechanic details are fully undesigned** beyond "hold a zone for bonus points": exact capture rate, whether progress decays when the player leaves, whether/how the hill relocates after a successful capture, and whether zombie spawn rate increases near it, are all open decisions to make during implementation, not before.
- No TODO/FIXME comments were added anywhere in this session's diff (`git diff 36b8a87^..HEAD` swept clean) — nothing else deferred inline in code.
- Trophy wall's final placement (east wall, `x = safeZone.x + safeZone.radius - 0.5, z = safeZone.z - 4`) was originally a workaround chosen mid-investigation before the real root cause (skyscraper idx7 overlapping the safe zone) was found; kept post-fix because it already worked and gave a clean interact spot, not because the west wall is unusable — revisit only if the east side gets crowded by a future feature.

## Gotchas / landmines hit this session

- **`buildingLayout()` in `src/game/World.js` is fully deterministic** (seeded arithmetic, no `Math.random()`). Any "player stuck at position X" bug can be root-caused by hand-computing that building index's bounds from the array rather than guessing — used twice this session (fire-escape/idx12-neighbor collision, safe-zone/idx7 overlap).
- **Shared-material mutation bug class**: several effects (barrels, practice targets, trophy medallions, fire-escape stairs, hazard zones) flash/recolor a material on hit/trigger. If that material is a shared module-level constant instead of `.clone()`d per instance, simultaneous instances fight over one material's state. Always `.clone()` per-instance materials for anything that gets mutated at runtime.
- **`WeaponSystem.current` is a getter off `currentIndex`** (`get current() { return this.weapons[this.currentIndex] }`) — assigning `weapons.current = X` directly is a silent no-op. Set `weapons.currentIndex` instead.
- **Rotated-mesh AABB inflation**: a `THREE.Box3` built from a rotated mesh's geometry inflates well past the mesh's visual footprint. Hit this class of bug multiple times (fire escape connectors). Prefer axis-aligned collider boxes built explicitly from known dimensions over `Box3.setFromObject()` on anything non-axis-aligned.
- **Safe zone and building placement have no mutual awareness** — `buildSafeZone()` and `buildingLayout()` were written independently. Building index 7 (`cx=-17.6, cz=-3, d=10`) overlapped the safe zone's interior regardless of whether it was forced into a skyscraper (thin wall bisecting the compound at z=-8) or left as a regular building (whole 11×11 footprint solid). Fixed by adding it to `EXCLUDED_BUILDING_IDXS` in `World.js` rather than moving either system — if you add new safe-zone-interior features in the future, sanity-check against nearby `buildingLayout()` indices first rather than assuming the lot is empty.
- **Playwright verification quirks** (this project has no committed test suite; all verification is scratchpad Playwright scripts calling real game methods via `page.evaluate()`):
  - Separate `page.evaluate()` round-trips can have multi-second real wall-clock gaps even for trivial scripts — any timing-sensitive assertion must happen inside a single `evaluate()` call, not split across two.
  - `THREE` is not globally exposed in the bundled build. `new THREE.Vector3()` fails inside `page.evaluate()`. Clone an existing Vector3 already in scope (e.g. `player.controls.object.position.clone()`) instead.
  - Moving a mesh via `.position.set(...)` after construction doesn't update `matrixWorld` until the next `renderer.render()` call — raycasts against it will miss until you call `mesh.updateWorldMatrix(true, false)` manually.
  - Fake test stubs for zombies/rivals need a `hittableMeshes: []` field or `WeaponSystem._fire()`'s `flatMap` over `hittableMeshes` throws `Cannot read properties of undefined (reading 'layers')`.
- **`_showAchievementToast` had a real pre-existing crash bug**, unrelated to any feature built this session, discovered incidentally while testing Black Market: it called `this.weapons.setGoldenSkin('pistol', true)`, a method that doesn't exist. The real method is `setWeaponSkin(weaponId, skinId)` (i.e. `setWeaponSkin('pistol', 'gold')`). This would have thrown for any real player reaching the Centurion achievement (100 kills) before this session's fix — already corrected in `WeaponSystem.js`/`Game.js`, not something to redo.
