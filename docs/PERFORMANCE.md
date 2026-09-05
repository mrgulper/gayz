# Performance handoff — the FPS bottleneck, diagnosed

Written 2026-08-05. **This document closes the open question left in
`QualitySettings.js:4`** ("while the real fps bottleneck is still
unresolved"). The bottleneck has now been measured and identified. This is
a complete takeover brief: findings, evidence, and the full implementation
plan for three fixes (A, B, C) in priority order.

The original author is not continuing on this project. Everything needed
to finish A through C is in this file. Nothing here has been implemented —
**no source file was changed by the investigation that produced it.**

---

## 1. The answer in one paragraph

The game is CPU-bound on scene-graph traversal, not GPU-bound on pixels.
The world is built as **14,792 individual `Object3D`s / 8,869 separate
meshes**, and three.js walks and matrix-updates that entire tree every
frame regardless of what is on screen. That costs **~10–16 ms per frame
before any game logic runs**, against a 16.7 ms budget for 60fps. Draw
calls are **470 for only 35,218 triangles — 75 triangles per draw call**,
which is almost pure per-call CPU overhead. Fixing this means reducing
object and draw-call count, not lowering graphics settings.

---

## 2. What is NOT the cause

Do not spend time here. Each of these was checked and ruled out with
evidence. Two of them have already cost this project real time once.

| Suspect | Verdict | Evidence |
|---|---|---|
| **Hosting / "a better server"** | **Ruled out** | The game makes **zero** network requests during gameplay. Grep for `fetch(`/`WebSocket`/`XMLHttpRequest` across `src/` returns exactly one hit — `Audio.js:58`, lazy-loading zombie sound files at startup. There is no game server, no netcode, no multiplayer. Vercel serves a static folder once; every frame is computed client-side. Better hosting improves **load time only** and cannot change FPS. |
| **Render resolution / pixel count** | **Ruled out (twice)** | The dynamic resolution scaler was disabled on 2026-07-21 after dropping resolution to the floor recovered no FPS (see the comment in `Game.js:_tick`). Independently confirmed here: the whole cost sits in JS, before rasterisation. |
| **Graphics quality settings** | **Ruled out** | `LOW_QUALITY_MODE` is hardcoded `true` (`QualitySettings.js:11`). The game already ships permanently in its cheapest mode — shadows off, 0.75× pixel ratio, Lambert instead of PBR materials, 12-light cap — and still stutters. Every quality lever is already on the floor. |
| **Zombie count** | **Not the primary cause** | All figures below were measured with **zero zombies alive**, standing still, doing nothing. The existing zombie population governor (`Game.js:_tick`) is a reasonable safety net but it is treating a symptom. |
| **Texture sizes** | **Fine as-is** | Largest texture is 1024×1024 (`ground-asphalt.png`); the rest are 512² or smaller. Not a factor. |

---

## 3. Measured evidence

Method: repo cloned fresh, `npm install`, `npx vite`, loaded in a real
browser via Playwright, clicked Play, waited for world build, then read
`renderer.info` and timed phases with `performance.now()` through the
existing `window.__game` debug hook.

**Caveat, stated honestly:** this run used a headless browser with
software rendering, so the *GPU-side* millisecond figures are inflated
versus a real machine with a real GPU. The object counts, draw-call
counts, material/geometry duplication factors, and the JS timings
(`updateMatrixWorld`, scene traversal) are pure CPU/JavaScript and are
accurate on any machine. **The diagnosis rests only on those.** Anyone
picking this up should re-run §7 on real hardware to get true baselines
before and after each change.

### Scene composition (at spawn, 0 zombies)

| Metric | Measured | Healthy target |
|---|---|---|
| Total objects in scene graph | **14,792** | 1,000–2,000 |
| Meshes | **8,869** | — |
| Skinned meshes | 2,750 | — |
| Bones | 1,299 | — |
| Objects parented under the camera | **862** | <50 |
| Lights in scene | **71** (cap of 20 lit at once) | ≤8 |
| Material instances | **8,869** | — |
| …but *distinct* material signatures | **332** | ← **27× duplication** |
| Parametric-geometry meshes | 3,945 | — |
| …but *distinct* shape signatures | **560** | ← **7× duplication** |
| Colliders | 2,621 | — |
| Registered cullables | 3,188 | — |

Worst offenders in the duplication data — these are single shapes
instantiated hundreds of times, each as its own object with its own
material instance:

- **674 ×** identical `BoxGeometry` 0.035 × 0.035 × 0.02 (a 3.5 cm detail —
  invisible at gameplay distance, full per-object cost)
- **464 ×** identical `BoxGeometry` 1.6 × 0.25 × 1
- **128 ×** identical `BoxGeometry` 0.2 × 3.2 × 2
- 96 ×, 96 ×, 94 ×, 80 ×, 64 ×, 64 ×, 64 × … and a long tail

### Frame cost

| Phase | Cost per frame |
|---|---|
| `composer.render()` (whole render) | **16.2 ms** |
| ├ of which `scene.updateMatrixWorld()` | **10.5 ms** |
| └ of which bare graph traversal (empty callback) | **5.1 ms** |
| `_updateCulling()` | 0.21 ms (this one is fine — leave it alone) |
| Draw calls / triangles | **470 / 35,218** = **75 tris per call** |

Live frame-time distribution over 120 frames, idle at spawn:

```
p50  20.7 ms   (48 fps)
p90  34.8 ms   (29 fps)
p99  49.6 ms   (20 fps)
max  64.1 ms   (16 fps)
```

The spread matters as much as the median — a frame time swinging between
20 ms and 64 ms is what is felt as stutter, and it is worse subjectively
than a steady low frame rate.

### Known-bad diagnostic — fix this first

`Game.js:13895` reads `this.renderer.info.render.calls` to feed the
on-screen `draws` counter. Because `EffectComposer`'s final `OutputPass`
renders one fullscreen quad and `renderer.info` auto-resets per
`render()` call, **that counter always reads `1`.** The real value is 470.
Anyone tuning against the current HUD is flying blind. See A4.

---

## 4. Root cause

> The world is authored as thousands of small, individually-instantiated
> boxes, each carrying its own material instance, all parented directly
> into one flat scene. Three.js's per-frame cost scales with the number of
> objects in the graph, not with what is visible — so this cost is paid in
> full, every frame, forever, no matter what the graphics settings say.

Two structural consequences follow, and both fixes below target them
directly:

1. **Per-frame graph cost.** `scene.updateMatrixWorld()` and the renderer's
   projection walk visit all 14,792 nodes. `_updateCulling()` sets
   `obj.visible = false` on distant objects — this correctly skips their
   *draw calls*, but **hidden objects are still walked and still have their
   matrices recomputed.** Hiding is not removing.
2. **Draw-call overhead.** 8,869 meshes with 8,869 material instances (only
   332 of them actually distinct) cannot be batched by the renderer.
   Identical geometry drawn 674 times as 674 separate objects should be
   one `InstancedMesh` with 674 instances — 674 draw calls collapse to 1.

The only existing use of `InstancedMesh` in the whole codebase is
`Decals.js:97`. There is no geometry merging anywhere.

**Update (2026-09-04): this is no longer true.** `buildStairFlight` now uses
`InstancedMesh` (B2, done for every staircase in the game). B3 (geometry
merging) is now done for `buildRoom` (the most-reused wall primitive,
covering nearly every regular building), the subway/maintenance tunnel
connectors (`buildCorridorWalls`), the Safe Zone, Underground Station,
Vireo Facility, Toxic Sewer Level, Mine Level, every skyscraper
(`buildSkyscraper`/`buildFireEscape`), the lookout-tower platforms
(`buildElevatedRoom`), the Sewer, the main Subway platform, both
underground entrance kiosks, the two "real" staircases
(`buildRealStaircase`), and the park's trees. See each function's own
comments for the exact technique (merge visual geometry into one mesh per
material group; keep colliders computed individually via direct corner
math, or a throwaway never-added scratch mesh for rotated pieces).
Deliberately left unmerged (too few pieces, called once or twice, not
worth the risk): `buildSubwayJunctionRoom`, `buildWreckedTrainChamber`,
`buildUnstableBeam` (its hazard beams must stay individually
recolorable/rotatable for `Game.js`'s `_triggerRockfall`). §7's
measurement script still works for re-baselining B3's actual real-hardware
payoff, which was never re-measured after landing (see §5's own caveat
that B/C gains are projected, not measured).

---

## 5. Implementation plan

Do these in order. A is cheap, low-risk and buys a trustworthy measuring
instrument. B is where the real win is. C is only worth it if the map is
going to grow.

Estimated gains for A are **measured** (I ran both changes live against
the running game). Gains for B and C are **projected** from the draw-call
and object-count arithmetic — treat them as estimates, not results.

| | Change | Effort | Gain | Risk |
|---|---|---|---|---|
| **A** | Quick wins, no visual change | ~1 session | ~30–35 % faster frames (measured) | Very low |
| **B** | Merge + instance the world geometry | ~3–5 sessions | 2–4×, and *stable* frame times (projected) | Medium |
| **C** | Chunk the map into tiles | ~1–2 weeks | Biggest; scales to a larger map | High |

---

### Option A — quick wins (do this first)

Nothing here changes a single pixel on screen. All four are independent;
each can ship and be verified separately.

#### A1. Detach culled objects instead of hiding them — **measured −3.0 ms/frame (−19 % render time)**

`_updateCulling()` at `Game.js:12633` currently does `obj.visible = distSq < cullSq`.
Hidden objects stay in the graph and keep costing traversal + matrix work.

Change it to remove distant objects from their parent and re-add them when
back in range. Keep a stable reference to the original parent — do **not**
re-parent to the scene root, several props are children of building groups
and rely on inherited transforms.

```js
// sketch — hold the original parent at registration time
if (wantsVisible && !obj.parent) obj.__parkedParent.add(obj)
else if (!wantsVisible && obj.parent) { obj.__parkedParent = obj.parent; obj.parent.remove(obj) }
```

Register `__parkedParent` where cullables are collected, in `World.js:277`
(`register()`), which already does `cullables.push(object)`.

**Verified in a live run:** parking the 2,496 objects that were already
`visible = false` took the graph from 14,792 → 10,050 objects and
`composer.render()` from **16.25 ms → 13.22 ms**.

**Pitfalls:** (a) `Game.js` code that looks objects up by traversing the
scene will no longer find parked objects — grep for `scene.traverse` and
`getObjectByName` before shipping; (b) raycasts against parked objects
silently miss, so anything in `solidMeshes` used for collision must either
stay attached or have its collider handled separately (colliders are a
separate `Box3` array, so this is probably already safe — **verify**).

#### A2. Freeze static objects' matrices — **measured −3.0 ms/frame (−16 % render time)**

Every one of the 14,792 objects has `matrixAutoUpdate = true`, so
three.js recomputes a local matrix for each of them every frame. The
overwhelming majority are buildings, roads and props that never move.

In `World.js:register()` (line 277), after positioning an object:

```js
object.updateMatrix()
object.matrixAutoUpdate = false
```

Skip anything animated: the camera rig, skinned meshes and their bones,
zombies, companions, the vehicle, flicker lights, swaying banners, the
wrecking pendulum, doors.

**Verified in a live run:** freezing 7,821 static objects took
`scene.updateMatrixWorld()` from **12.04 ms → 8.94 ms** and
`composer.render()` from **18.18 ms → 15.21 ms**.

**Pitfall:** if anything later moves a frozen object, it will appear stuck.
Any code that writes `.position`/`.rotation`/`.scale` on a frozen object
must call `object.updateMatrix()` afterwards. Grep for writes to
`.position.set(` on world props before shipping.

#### A3. Cap the device pixel ratio

`Game.js:7233` returns raw `window.devicePixelRatio` when
`LOW_QUALITY_MODE` is false. On a 2× or 2.5× high-DPI laptop that renders
4–6× the pixels. This is dormant today (the flag is hardcoded `true`, so
0.75 is used) but it is a landmine for whoever turns the flag off — which
is the whole point of B.

```js
return LOW_QUALITY_MODE ? 0.75 : Math.min(window.devicePixelRatio, 2)
```

#### A4. Fix the lying draw-call counter

`Game.js:13895`. Set `renderer.info.autoReset = false`, reset manually at
the top of `_tick()`, and read the counter after `composer.render()` — or
simply read it after a direct `renderer.render(scene, camera)` in a debug
path. Without this there is no way to tell whether B is working.

**Acceptance check for Option A:** on real hardware, with the fixed
counter, median frame time drops by roughly 30 % and the p99/p50 spread
narrows. Verify visually that nothing pops in/out incorrectly while
walking the full map, especially near building interiors, the subway, the
sewer and the mine (the deepest nested groups).

---

### Option B — merge and instance the world geometry

This is the real fix, and it is what makes it possible to set
`LOW_QUALITY_MODE = false` again and get the full 3D-asset-overhaul look
back at a *higher* frame rate than the flat look runs at today.

**Goal:** 470 draw calls → roughly 80. 8,869 meshes → roughly 1,500.

Three sub-tasks, in order:

**B1. Share materials.** 8,869 material instances collapse to 332. Add a
module-level cache in `QualitySettings.js` keyed on the options object, so
`flatMaterial()` returns the *same* material instance for identical
inputs instead of constructing a new one at each of World.js's ~160 call
sites:

```js
const _matCache = new Map()
export function flatMaterial(opts) {
  const key = JSON.stringify(opts)          // opts are plain literals
  let m = _matCache.get(key)
  if (!m) { m = /* existing construction */; _matCache.set(key, m) }
  return m
}
```

**Pitfall — this is the one that will bite.** Any code that mutates a
material per-object (damage flashes, hit tints, emissive pulses, the
companion's per-role jacket tint noted in `flattenedClone`) would now
mutate every object sharing it. Grep for `.material.color.set`,
`.material.emissive`, `.material.opacity` and give exactly those objects
an explicit `.clone()`. Do this sub-task **first** and test it alone — it
is the cheapest of the three and the most likely to cause visual bugs.

**B2. Instance the repeated shapes.** Convert the top duplicated shapes
(674 ×, 464 ×, 128 ×, 96 ×, 96 ×, 94 ×, 80 ×, 64 × …) to `InstancedMesh`.
`Decals.js:97` is the working in-repo reference for the API. The top ~15
shapes alone account for well over 2,000 meshes. Reuse the shape signature
key from §7's script to find them programmatically rather than by hand.

**Pitfall:** instanced objects can't be individually removed from the
graph, so they interact with A1 — instance *within* a chunk, and cull the
whole `InstancedMesh` as a unit.

**B3. Merge static geometry per building.** For props that are static and
share a material after B1, merge with
`BufferGeometryUtils.mergeGeometries()` into one mesh per building/zone.
`World.js` already has 72 discrete `build*()` functions, each of which is
a natural merge boundary — merge inside each one before returning.

**Pitfall:** merged geometry loses per-object culling and per-object
collision. Keep the `colliders` array (`Box3`s) exactly as it is — it is
already independent of the meshes, which is what makes this safe.

**Acceptance check for Option B:** draw calls under 150 (with the A4
counter), scene objects under ~2,500, p50 frame time under 16.7 ms on a
mid-range laptop, p99 under 25 ms — *and* the game looks identical.
Screenshot-compare before/after at several fixed positions.

---

### Option C — chunk the map

Only worth doing if the 750 × 750 map is going to grow, or if B lands and
frame times still are not stable. C is a real architectural change and
should not be started casually.

**Concept:** split the map into a grid of tiles (100 × 100 units is a
reasonable starting point → ~56 tiles). Build each tile's geometry lazily
the first time the player comes within range, and dispose it when they
leave. Objects for distant tiles then do not merely get hidden or
detached — **they do not exist at all**, so they cost nothing: no memory,
no traversal, no build time at startup.

**Where the seams already are:** `buildWorld()` (`World.js:231`) calls 72
`build*()` functions, most of which already take explicit `(x, z)`
coordinates. That is most of the work of assigning builders to tiles
already done. `register()` at line 277 is the single choke point where
every object enters `colliders`/`solidMeshes`/`cullables`, so it is the
natural place to tag an object with its owning tile.

**Order of work:** (1) tag every registered object with a tile id in
`register()`; (2) build a tile→objects index; (3) implement
attach/detach per tile driven from `_updateCulling`; (4) only then
attempt lazy *construction* and `dispose()`, which is where the real
complexity and the leak risk live.

**Pitfalls:** disposing geometries/materials that are shared after B1 will
break other tiles — reference-count them or exempt shared materials from
disposal. Zombie spawn points, chest spots and quest markers reference
world objects across tile boundaries; they need to survive their tile
being unloaded. Expect this to surface latent bugs in `Game.js`'s many
`_updateX(playerPos)` proximity checks, which currently assume every world
object exists at all times.

---

## 6. Two things worth knowing that are not on the A/B/C path

- **`_tick()` (`Game.js:13883`) runs ~120 sequential `_updateX(playerPos)`
  proximity checks every frame** — campfire, payphone, valve, siren,
  pendulum, manholes, terminals, and so on. Individually cheap, but it is
  an obvious candidate for a simple spatial index or a round-robin
  scheduler (check a fifth of them per frame) once A and B are done. Not
  measured as a top cost, so not prioritised here.
- **The interact-prompt block in `_tick()` writes `innerHTML` every single
  frame** while the player is near any interactable, re-parsing the same
  HTML 60×/sec. Cheap fix: track the last-set string and skip the write
  when unchanged.

Load time is a separate concern from FPS and was not the question asked,
but for the record: 24 MB of assets (9.5 MB audio, 9.4 MB models, 3.1 MB
textures), plus a 1.5 MB main JS bundle (396 KB gzipped) and a 567 KB
Firebase chunk (166 KB gzipped) loaded eagerly. GLB models use no
Draco/meshopt compression. None of this affects frame rate.

---

## 7. Reproducing the measurements

Run the game, click Play, wait for the world to build, then paste this
into the browser console. It uses the existing `window.__game` hook.

```js
const g = window.__game, r = g.renderer;
// Real draw calls — must bypass the composer, whose final pass resets the counter
r.info.autoReset = false; r.info.reset();
r.render(g.scene, g.camera);
const draws = r.info.render.calls, tris = r.info.render.triangles;
r.info.autoReset = true;

let objs=0, meshes=0, lights=0;
const shapes={}, mats={};
g.scene.traverse(o => {
  objs++;
  if (o.isLight) lights++;
  if (!o.isMesh) return;
  meshes++;
  if (o.geometry?.parameters) {
    const k = o.geometry.type + JSON.stringify(o.geometry.parameters);
    shapes[k] = (shapes[k]||0)+1;
  }
  const m = o.material;
  if (m && !Array.isArray(m)) {
    const k = `${m.type}|${m.color?.getHexString()}|${m.map?.uuid}|${m.transparent}|${m.opacity}`;
    mats[k] = (mats[k]||0)+1;
  }
});

const time = (fn,n) => { const a=performance.now(); for(let i=0;i<n;i++) fn(); return ((performance.now()-a)/n).toFixed(2); };
console.table({
  objects: objs, meshes, lights, draws, tris,
  trisPerDraw: Math.round(tris/draws),
  distinctShapes: Object.keys(shapes).length,
  distinctMaterials: Object.keys(mats).length,
  ms_render: time(()=>g.composer.render(), 10),
  ms_updateMatrixWorld: time(()=>g.scene.updateMatrixWorld(), 25),
  ms_bareTraverse: time(()=>{let n=0;g.scene.traverse(()=>n++)}, 25),
});
console.log('most duplicated shapes:',
  Object.entries(shapes).sort((a,b)=>b[1]-a[1]).slice(0,15));
```

Frame-time distribution (run separately, while actually playing):

```js
const s=[]; let last=performance.now(), n=0;
(function probe(){ const t=performance.now(); s.push(t-last); last=t;
  if (++n<300) requestAnimationFrame(probe);
  else { s.sort((a,b)=>a-b); const p=q=>s[Math.floor(s.length*q)].toFixed(1);
    console.log(`p50 ${p(.5)}ms  p90 ${p(.9)}ms  p99 ${p(.99)}ms  max ${s.at(-1).toFixed(1)}ms`); }
})();
```

Record these numbers before and after every change. There is no committed
test suite (a standing property of this project), so measured before/after
pairs are the only real verification available.

---

## 8. Suggested first session for whoever takes this over

1. `npm install && npx vite` — confirm the game runs.
2. Run §7 on your own hardware. Write the numbers down. **These are your
   baseline; the ones in this document came from software rendering and
   will not match yours.**
3. Do **A4** first (fix the counter) — you cannot verify anything without it.
4. Do **A2** (freeze static matrices). Re-measure. Expect ~15 % off render time.
5. Do **A1** (detach instead of hide). Re-measure. Expect another ~19 %.
6. Do **A3** (cap pixel ratio) — one line, no measurement needed.
7. Only then start B, and do **B1 alone first** with careful visual testing.

If B lands successfully, try setting `LOW_QUALITY_MODE = false`
(`QualitySettings.js:11`) and re-measure. Restoring the intended visual
quality *and* gaining frame rate is the actual goal, and B is what makes
it reachable. Do not flip that flag before B — it will be slower, not
faster, and nothing about the current diagnosis says otherwise.
