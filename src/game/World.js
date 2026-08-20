import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { registerZone, clearZones } from './Zones.js'
import { LOOT_WEIGHTS } from './Chests.js'
import { LOW_QUALITY_MODE, flatMaterial, cachedFlatMaterial, flattenedClone } from './QualitySettings.js'

// Cheap procedural grime: speckle noise + a handful of jagged crack/stain
// strokes baked onto a canvas once, then tiled via RepeatWrapping. Replaces
// flat single-color ground/facade materials with something that reads as
// worn concrete/asphalt instead of a solid-color primitive, at effectively
// zero runtime cost (one canvas draw at world-build time, reused after).
function createGrimeTexture(baseColor, { size = 256, noise = 20, cracks = 10, rustStreaks = 0 } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = baseColor
  ctx.fillRect(0, 0, size, size)

  const img = ctx.getImageData(0, 0, size, size)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * noise
    img.data[i] = Math.min(255, Math.max(0, img.data[i] + n))
    img.data[i + 1] = Math.min(255, Math.max(0, img.data[i + 1] + n))
    img.data[i + 2] = Math.min(255, Math.max(0, img.data[i + 2] + n))
  }
  ctx.putImageData(img, 0, 0)

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)'
  for (let i = 0; i < cracks; i++) {
    let x = Math.random() * size
    let y = Math.random() * size
    ctx.lineWidth = 0.6 + Math.random() * 1.8
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let s = 0; s < 4; s++) {
      x += (Math.random() - 0.5) * size * 0.35
      y += (Math.random() - 0.5) * size * 0.35
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  // Rust/water-stain streaks: soft vertical gradients dripping down from a
  // random height, mimicking rusted rebar or corroded gutters bleeding down
  // a weathered facade. Purely a canvas-time cost, same as the rest of this
  // texture.
  for (let i = 0; i < rustStreaks; i++) {
    const x = Math.random() * size
    const topY = Math.random() * size * 0.5
    const height = size * (0.3 + Math.random() * 0.55)
    const width = 3 + Math.random() * 8
    const alpha = 0.16 + Math.random() * 0.24
    const grad = ctx.createLinearGradient(0, topY, 0, topY + height)
    grad.addColorStop(0, `rgba(130, 75, 32, ${alpha})`)
    grad.addColorStop(0.6, `rgba(110, 62, 28, ${alpha * 0.6})`)
    grad.addColorStop(1, 'rgba(110, 62, 28, 0)')
    ctx.fillStyle = grad
    ctx.fillRect(x - width / 2, topY, width, height)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  return tex
}

// Facade grime textures are cached per base color (only a handful of
// building color variants exist) so ~20 buildings share 4 canvases instead
// of generating one each.
const _facadeTextureCache = new Map()
function getFacadeTexture(hexColor) {
  if (!_facadeTextureCache.has(hexColor)) {
    const hex = '#' + hexColor.toString(16).padStart(6, '0')
    _facadeTextureCache.set(hexColor, createGrimeTexture(hex, { size: 256, noise: 18, cracks: 9, rustStreaks: 7 }))
  }
  return _facadeTextureCache.get(hexColor)
}

// Grayscale companion to createGrimeTexture, fed into MeshStandardMaterial's
// bumpMap - panel seams + the same noise/crack pattern read as real surface
// relief under the scene's directional moonlight instead of a flat color
// swatch, at effectively zero extra runtime cost (one shared canvas, reused
// by every color variant since bump doesn't need to match the tint).
function createBumpTexture({ size = 256, noise = 34, cracks = 10, panels = 5 } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, size, size)

  ctx.strokeStyle = 'rgba(40, 40, 40, 0.5)'
  ctx.lineWidth = 1.5
  const step = size / panels
  for (let i = 1; i < panels; i++) {
    ctx.beginPath()
    ctx.moveTo(i * step, 0)
    ctx.lineTo(i * step, size)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, i * step)
    ctx.lineTo(size, i * step)
    ctx.stroke()
  }

  const img = ctx.getImageData(0, 0, size, size)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * noise
    const v = Math.min(255, Math.max(0, img.data[i] + n))
    img.data[i] = v
    img.data[i + 1] = v
    img.data[i + 2] = v
  }
  ctx.putImageData(img, 0, 0)

  ctx.strokeStyle = 'rgba(15, 15, 15, 0.7)'
  for (let i = 0; i < cracks; i++) {
    let x = Math.random() * size
    let y = Math.random() * size
    ctx.lineWidth = 0.8 + Math.random() * 2
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let s = 0; s < 4; s++) {
      x += (Math.random() - 0.5) * size * 0.35
      y += (Math.random() - 0.5) * size * 0.35
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  return tex
}

let _sharedBumpTexture = null
function getSharedBumpTexture() {
  if (!_sharedBumpTexture) _sharedBumpTexture = createBumpTexture()
  return _sharedBumpTexture
}

// Same "load once, .clone() per instance" pattern as getSharedBumpTexture
// above - buildSkyscraper used to call `new THREE.TextureLoader().load(...)`
// itself on every single call, which fetched and GPU-uploaded this same
// 1.8MB image separately for every one of the 51 skyscrapers in the map
// (measured ~1.7x slower frame time than sharing it - see the tall-building-
// to-skyscraper conversion this was found during). .clone() shares the
// already-decoded image/GPU texture, only the wrapper Texture object (and
// its own .repeat) is new per call, which is cheap.
let _sharedWallDecayTexture = null
function getSharedWallDecayTexture() {
  if (!_sharedWallDecayTexture) {
    _sharedWallDecayTexture = new THREE.TextureLoader().load('/textures/building-wall-decay.png')
    _sharedWallDecayTexture.wrapS = THREE.RepeatWrapping
    _sharedWallDecayTexture.wrapT = THREE.RepeatWrapping
    _sharedWallDecayTexture.colorSpace = THREE.SRGBColorSpace
  }
  return _sharedWallDecayTexture
}

// Builds a small broken-city block: cracked streets, damaged buildings with
// lit/dark windows, burnt-out cars, rubble, and a couple of dying streetlights.
// Also returns a list of open street-side spawn points for pickups/zombies.
// Phase 6 of the 3D asset overhaul - distance culling, added ahead of the
// new zones below specifically so their extra buildings/streetlights don't
// all render/shadow-cast at once across the full 750x750 map (see this
// function's own register() comment and Game.js's _updateCulling). Matches
// the fog far distance (140) plus a small buffer so nothing visibly pops
// out of existence before fog would have hidden it anyway.
// Shrunk under LOW_QUALITY_MODE (bare-bones/minimum-resource mode) - less
// geometry rendered/shadowed at any given moment, a direct cut to both
// draw calls and shaded pixels, not just a quality preference.
export const WORLD_CULL_DISTANCE = LOW_QUALITY_MODE ? 90 : 150
// Shadow casting is the expensive part, not the JS-side distance check, so
// it's turned off well before the object disappears entirely.
export const WORLD_SHADOW_CULL_DISTANCE = LOW_QUALITY_MODE ? 45 : 70

export function buildWorld(scene, trophyCount = 15) {
  // buildWorld only runs once per real Game instance today, but clearing
  // defensively costs nothing and avoids ever silently accumulating
  // duplicate zone entries if that ever changes (a same-session "restart
  // run" reuses the existing Game instance and doesn't call this again, so
  // this isn't reachable in practice yet - see ChestManager.reset()'s
  // similar defensive pattern).
  clearZones()

  const colliders = []
  const solidMeshes = []
  const flickerLights = []
  const spawnPoints = []
  // Every object registered via register() below (buildings, streetlights,
  // the perimeter wall, generator/trader/ammo station) goes in here too -
  // Game.js ticks this list each frame and toggles .visible/.castShadow by
  // distance to the player. Deliberately NOT the same array as colliders/
  // solidMeshes (collision must never depend on visibility), and
  // deliberately doesn't include underground corridors/the safe zone/park -
  // those are a small, fixed, already-bounded object count, not what scales
  // with the new zones.
  const cullables = []

  // Registers a mesh/group as both a movement collider (AABB) and a
  // raycast-solid target (for bullets), keeping the two lists in sync.
  //
  // updateWorldMatrix(true, false) forces this object's ancestors to
  // recompute their world matrices before we read them. Box3.setFromObject
  // calls updateWorldMatrix(false, false) internally - it deliberately does
  // NOT walk up to parents - so registering a child of a group that was
  // just positioned (e.g. the generator body, the trader stall counter)
  // without this would read the group's still-default (identity, i.e.
  // world-origin) transform instead of its real position, producing a
  // phantom collider sitting at (0,0,0) regardless of where the group
  // actually is. See https://threejs.org/docs/#api/en/core/Object3D.updateWorldMatrix.
  //
  // Optional `explicitBox` lets a caller hand in a pre-computed Box3 instead
  // of deriving one from the object automatically. Needed for anything
  // rotated around Y (e.g. the trader stall, tilted ~27deg for visual
  // flair): Box3 is always axis-aligned, so setFromObject on a rotated mesh
  // returns an AABB inflated well past the mesh's actual footprint (a
  // 1.6x0.6 box rotated 27deg needs a ~1.7x1.26 AABB to fully contain it) -
  // an invisible collision buffer bulging out well beyond what's visible,
  // which is exactly the "phantom collider" shape reported around rotated
  // props. Passing the object's true, unrotated footprint here keeps the
  // collider honest instead of ballooning with the rotation.
  const register = (object, explicitBox) => {
    object.updateWorldMatrix(true, false)
    colliders.push(explicitBox || new THREE.Box3().setFromObject(object))
    solidMeshes.push(object)
    cullables.push(object)
  }
  // Split halves of register(), for callers merging several small meshes
  // into one bigger one (see docs/PERFORMANCE.md Option B3, buildRoom's
  // wall merging) - the individual per-segment colliders still need to
  // exist separately (so doorway gaps stay walkable, not sealed by one
  // big box), but only the ONE merged mesh should be tracked for
  // rendering/culling. Attached to `register` itself rather than adding
  // new parameters threaded through every caller (~250+ call sites).
  register.colliderOnly = (box) => colliders.push(box)
  register.meshOnly = (object) => {
    solidMeshes.push(object)
    cullables.push(object)
  }

  scene.background = new THREE.Color(0x12161b)
  // Far distance pushed from 85 to 140 for the bigger (750x750) map - not
  // scaled 1:1 with the map (that would mean seeing hundreds of units in
  // open ground, killing the atmosphere this fog is for), but far enough
  // that it lines up with WORLD_CULL_DISTANCE below, so buildings fade out
  // in fog before they pop out of existence from culling, not after.
  scene.fog = new THREE.Fog(0x12161b, 15, 140)

  const hemi = new THREE.HemisphereLight(0x7f93ab, 0x20201a, 0.85)
  scene.add(hemi)

  const moon = new THREE.DirectionalLight(0xc3d2ec, 1.0)
  moon.position.set(30, 45, -15)
  moon.castShadow = true
  // 1024 instead of 1536 - a real, unconditional per-frame cost (this is
  // the only shadow-casting light in the whole game, but its map still
  // gets sampled by every shadow-receiving fragment in the frustum every
  // frame) for a texel density that's still ~3.4/unit over this light's
  // own fixed local frustum below, plenty for how close shadows actually
  // get inspected during normal play.
  moon.shadow.mapSize.set(1024, 1024)
  // Kept at a fixed local size (not scaled to the full 750 map) - a shadow
  // frustum that large would spread the same 1536px shadow map over a much
  // bigger area and turn every shadow blurry. This covers everything within
  // the fog/cull range, which is the only area shadows are ever visible in.
  moon.shadow.camera.left = -150
  moon.shadow.camera.right = 150
  moon.shadow.camera.top = 150
  moon.shadow.camera.bottom = -150
  scene.add(moon)

  const groundSize = 750
  // Ground always gets the real asphalt photo texture, regardless of
  // LOW_QUALITY_MODE - explicitly requested even at the cost of the
  // tiling/memory savings LOW_QUALITY_MODE otherwise gets here (see
  // QualitySettings.js). bumpMap/roughness still get silently dropped by
  // cachedFlatMaterial under LOW_QUALITY_MODE (Lambert has no use for
  // them), but `map` is kept either way.
  const groundMat = (() => {
    const groundTex = new THREE.TextureLoader().load('/textures/ground-asphalt.png')
    groundTex.wrapS = THREE.RepeatWrapping
    groundTex.wrapT = THREE.RepeatWrapping
    groundTex.colorSpace = THREE.SRGBColorSpace
    groundTex.repeat.set(groundSize / 12, groundSize / 12)
    const groundBumpTex = getSharedBumpTexture().clone()
    groundBumpTex.needsUpdate = true
    groundBumpTex.repeat.set(groundSize / 3, groundSize / 3)
    return cachedFlatMaterial({ map: groundTex, bumpMap: groundBumpTex, bumpScale: 0.06, roughness: 1 })
  })()
  // This is the surface PlayerController._sampleGroundHeight raycasts
  // against for standing height - a plain, hole-less PlaneGeometry here
  // would physically stop the player at y=0 above either underground
  // stairwell no matter how the stairs themselves look, since this plane
  // sits above (and would occlude/support-block) the actual steps. Cutting
  // the same two holes used for the park's grass/plaza here is what lets
  // the player's own floor-raycast fall through onto the real stair steps
  // instead.
  const ground = buildGroundPlaneWithHoles(
    scene,
    groundMat,
    0, 0, groundSize, groundSize,
    [UNDERGROUND_HOLE_SUBWAY, UNDERGROUND_HOLE_NEW_ENTRANCE, UNDERGROUND_HOLE_HIDDEN_COMPLEX, UNDERGROUND_HOLE_VIREO_EXIT],
    0
  )
  solidMeshes.push(ground) // walkable ground for the player's floor-height raycast

  addPerimeterBarricade(scene, register, groundSize)
  const buildings = buildingLayout()

  // Three of the generated building slots become real enterable skyscrapers
  // (walkable interior floors + stairwell) instead of solid decorative boxes.
  // Index 12 was the original second slot, but its exterior fire escape
  // (see buildFireEscape) sticks 0.9 units past the blind wall and that
  // lands squarely inside slot 17's footprint (the adjacent building row is
  // only 14 units away and slot 17 is wide) - fully blocking flights 1/2.
  // buildingLayout() is deterministic (no randomness), so this was verified
  // by hand against every same/adjacent-row neighbor; index 10 has ~3.8
  // units of clearance to the nearest neighbor on its escape side. Index 3
  // (row x=-32, z=16) is the third slot - an outer-row building, so its
  // blind side faces 30+ clear units of perimeter instead of a neighboring
  // row (same reasoning as the extra fire-escape-only rooftops below), and
  // its ground footprint (roughly x=[-36.7,-25.7], z=[10.5,21.5] before the
  // skyscraper override shrinks it to 10x10) sits well clear of both the
  // safe zone (x=[-20,-6], z=[-17,-3]) and the park (z=[52,72]).
  const skyscraperIdxs = [6, 10, 3]
  for (const i of skyscraperIdxs) {
    buildings[i].skyscraper = true
    buildings[i].broken = false
    buildings[i].w = 10
    buildings[i].d = 10
    buildings[i].h = SKYSCRAPER_FLOOR_H * SKYSCRAPER_FLOORS
  }

  // Index 7 was the original first skyscraper slot (cx=-17.6, cz=-3) and
  // was swapped out for the same reason it's excluded here entirely now: its
  // footprint overlaps the safe zone's own north-west interior regardless
  // of whether it's built as a skyscraper (its shell wall alone cuts across
  // the compound at z=-8) or a regular solid box (11x11, even worse - the
  // whole footprint becomes solid). The safe zone (see buildSafeZone) and
  // buildingLayout() were placed independently with no mutual awareness, so
  // this lot is simply skipped rather than moving either one - a straight-
  // line walk test from the entrance to the Vault/practice range/trophy
  // wall only surfaced this once those needed to path across it.
  const EXCLUDED_BUILDING_IDXS = new Set([7])

  // Rooftop layer: bolt the same exterior fire escape used on the two real
  // skyscrapers onto four more buildings, without giving them a walkable
  // interior - buildFireEscape only reads x/z/w/d/h and climbs the outside,
  // so any building spec works. Picked the tallest non-broken building in
  // each outer row (x=-32, x=32) specifically because those rows have no
  // neighboring row on their blind (fire-escape) side - the nearest thing
  // out there is the perimeter wall, 33-37 units clear by hand-computing
  // buildingLayout() for every candidate. Every inner-row building has a
  // same-distance (14 unit) neighboring row on its blind side instead,
  // which is exactly what ruled out index 12 as a third skyscraper.
  const EXTRA_FIRE_ESCAPE_IDXS = new Set([0, 1, 18, 19])

  const towerChestSpots = []
  // Elevator Shortcuts (batch feature) - one ground-floor call point per
  // real walkable skyscraper, {x, z, topY}. Game.js turns each into an
  // interact prompt that scripted-moves the player straight to the top
  // floor, reusing PlayerController's existing startScriptedMove (the same
  // primitive the Elevator Tower ride and mantle hop already use) rather
  // than building a second visual elevator car system from scratch.
  const skyscraperShortcuts = []
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i]
    if (b.skyscraper) {
      buildSkyscraper(scene, colliders, solidMeshes, b, towerChestSpots)
      buildFireEscape(scene, colliders, solidMeshes, b, towerChestSpots)
      skyscraperShortcuts.push({ x: b.x, z: b.z, topY: (SKYSCRAPER_FLOORS - 1) * SKYSCRAPER_FLOOR_H })
    } else if (!EXCLUDED_BUILDING_IDXS.has(i)) {
      // Every other building is now a real walkable skyscraper too (the
      // decorative, unenterable "tall building" GLB models were removed
      // entirely at the user's request 2026-08-20 - they looked tall but
      // were solid boxes with no interior). Floor count comes from this
      // building's own randomized height (see buildSkyscraper's h->floors
      // math), so the skyline keeps its size variety even though every
      // building is hollow with real floors/stairs now. No fire escape for
      // these (unlike EXTRA_FIRE_ESCAPE_IDXS below) since their footprints
      // were never hand-verified against a fire escape's 0.9-unit exterior
      // protrusion into a neighboring lot the way skyscraperIdxs' 3 were -
      // see that set's own comment for why that specifically mattered. The
      // base shell itself carries no new collision risk though: it's built
      // at exactly the w x d footprint the decorative box already safely
      // occupied, never larger, so no equivalent verification is needed
      // for the shell/interior/stairs, only for an exterior add-on like
      // the fire escape.
      b.broken = false
      const floors = buildSkyscraper(scene, colliders, solidMeshes, b, towerChestSpots)
      if (EXTRA_FIRE_ESCAPE_IDXS.has(i)) {
        buildFireEscape(scene, colliders, solidMeshes, b, towerChestSpots)
      }
      skyscraperShortcuts.push({ x: b.x, z: b.z, topY: (floors - 1) * SKYSCRAPER_FLOOR_H })
    }
  }

  // Pure decoration, zero gameplay purpose, no collider either - skipped
  // entirely under LOW_QUALITY_MODE (bare-bones mode) rather than just
  // simplifying their materials, since not creating the objects at all
  // cuts their draw calls too, not just their shading cost.
  let ambientWildlife = []
  if (!LOW_QUALITY_MODE) {
    scatterDebris(scene)
    scatterCityProps(scene, colliders, solidMeshes)
    ambientWildlife = spawnAmbientWildlife(scene)
  }
  addStreetlights(scene, register, flickerLights)
  for (const spot of buildTowers(scene, colliders, solidMeshes)) towerChestSpots.push(spot)

  // Points down the open central avenue (x ~ 0) and cross streets, clear of
  // buildings/cars/rubble, usable for pickup and zombie spawn placement.
  for (let z = -40; z <= 40; z += 8) {
    spawnPoints.push({ x: (Math.random() - 0.5) * 4, z })
  }

  // Fixed spot for the one-off floating minigun pickup: inside the lookout
  // room at cluster {x:-3, z:44}, offset from that room's own chest spot
  // (3, FLOOR_Y, 44) and floating above floor height.
  const minigunSpot = { x: 1.7, y: FLOOR_Y + 1.0, z: 45.3 }

  const generator = buildGenerator(scene, register)
  const trader = buildTraderStall(scene, register)
  const ammoStation = buildAmmoStation(scene, register)
  const sewer = buildSewer(scene, colliders, solidMeshes, flickerLights)
  towerChestSpots.push(sewer.chestSpot)
  spawnPoints.push({ x: sewer.chestSpot.x, z: sewer.chestSpot.z })
  const subway = buildSubway(scene, colliders, solidMeshes, flickerLights)
  towerChestSpots.push(subway.chestSpot)
  // Built after the subway - it's a straight continuation of that same
  // corridor now (see buildVireoFacility), not a separate tunnel branch.
  const vireoFacility = buildVireoFacility(scene, colliders, solidMeshes, flickerLights)
  spawnPoints.push({ x: vireoFacility.exitSpot.x, z: vireoFacility.exitSpot.z })
  const safeZone = buildSafeZone(scene, colliders, solidMeshes)
  const practiceTargets = buildPracticeRange(scene, colliders, solidMeshes, safeZone)
  const adjustableDummy = buildAdjustableDummy(scene, colliders, solidMeshes, safeZone)
  const trophyWall = buildTrophyWall(scene, colliders, solidMeshes, safeZone, trophyCount)
  const upgradeMachine = buildWeaponUpgradeMachine(scene, register, -15, 60)
  registerZone({ id: 'upgrademachine', x: -15, z: 60, radius: 8, densityMult: 1.0 })
  const mysteryBox = buildMysteryBox(scene, register, 15, 60)
  // Interactive World batch - positioned as an offset from SAFE_ZONE_X/Z
  // per this project's own convention for anything meant to live near the
  // safe zone (see the Vault/practice range/trophy wall precedent), clear
  // of the upgrade machine/mystery box at x=+-15 above.
  const payphone = buildPayphone(scene, register, SAFE_ZONE_X, SAFE_ZONE_Z + 23)
  const jukebox = buildJukebox(scene, register, SAFE_ZONE_X - 3, SAFE_ZONE_Z + 6)
  const workbench = buildWorkbench(scene, register, SAFE_ZONE_X + 3, SAFE_ZONE_Z + 6)
  const bulletinBoard = buildBulletinBoard(scene, register, SAFE_ZONE_X - 5, SAFE_ZONE_Z - 5)
  const hallOfFame = buildHallOfFame(scene, register, SAFE_ZONE_X + 5, SAFE_ZONE_Z - 5)
  const pet = buildPet(scene, SAFE_ZONE_X - 3, SAFE_ZONE_Z + 3)

  // Climbable Drainpipes (batch feature) - 2 fixed spots next to 2 of the
  // 3 real downtown skyscrapers, at their known-safe hand-verified
  // coordinates (see skyscraperIdxs's own comment above for how those were
  // picked), offset 5.5 units out from center to clear the 10-wide shell.
  // topY (7.8) matches (SKYSCRAPER_FLOORS-1)*SKYSCRAPER_FLOOR_H exactly -
  // same top-floor height the elevator shortcuts already use.
  const drainpipeSpots = [
    { x: -31.2 + 5.5, z: 16, topY: 7.8 },
    { x: 17.2 + 5.5, z: -44, topY: 7.8 },
  ]
  for (const d of drainpipeSpots) buildDrainpipe(scene, d.x, d.z, d.topY)

  // Jump Pad (batch 3 feature) - one, in the park, clear open ground.
  const jumpPadSpot = { x: 8, z: 62 }
  buildJumpPad(scene, jumpPadSpot.x, jumpPadSpot.z)
  registerZone({ id: 'mysterybox', x: 15, z: 60, radius: 8, densityMult: 1.0 })

  // Second area: a small park beyond the north end of the street, in the
  // space freed up by pushing the perimeter barricade out to groundSize/2.
  const park = buildPark(scene, colliders, solidMeshes)
  for (const spot of park.chestSpots) towerChestSpots.push(spot)
  for (const spot of park.spawnPoints) spawnPoints.push(spot)

  // Shootable explosive barrels - a handful of scattered spots clear of the
  // park's trees/benches/chests, so a horde funneling past one is a free
  // area-damage opportunity for a player who notices it in time.
  buildExplosiveBarrels(scene, colliders, solidMeshes, [
    [-8, 58], [8, 60], [0, 68], [-4, 64],
  ])

  // The subway's real entrance - see buildSubwayParkEntrance/
  // buildSubwayConnector's comments for why it's all the way out here now
  // instead of street-side next to the platform it leads to.
  //
  // Routed as three straight (never diagonal) legs rather than one direct
  // shot at the platform's corner - a diagonal path from the park toward
  // (SUBWAY_X, SUBWAY_Z_START) necessarily sweeps close past the platform's
  // own pre-existing, full-length side wall (it runs the entire
  // SUBWAY_Z_START..SUBWAY_Z_END span at a fixed X) well before reaching the
  // actual opening, so the connector's own wall ends up overlapping/
  // crowding that independent wall instead of cleanly meeting it - two
  // separate wall systems pinched together with no clean gap for the player.
  // Going south first at the entrance's own X, then east once clear of the
  // platform's Z-range entirely, then north into its open south end head-on
  // avoids ever running near that wall until the final leg matches its
  // orientation exactly.
  const subwayEntrance = buildSubwayParkEntrance(scene, colliders, solidMeshes, flickerLights)
  // Stage 10 (Extended Metropolitan Grid) - the new underground network's
  // own entrance, distinct from the existing subway above. Just the stairs
  // + a landing for now, per the user's own request to check this piece
  // before the tunnel behind it gets built.
  const newUndergroundEntrance = buildNewUndergroundEntrance(scene, colliders, solidMeshes, flickerLights)
  // Stage 10 continuation - the tunnel content behind that entrance, now
  // that the stairs themselves have been confirmed in-game (see
  // buildMaintenanceTunnelNetwork's own comment for the full layout).
  const maintenanceTunnel = buildMaintenanceTunnelNetwork(scene, colliders, solidMeshes, flickerLights, towerChestSpots)
  const connectorWaypointZ = SUBWAY_Z_START - 6
  const JUNCTION_HALF = 3.2
  // openSides names each junction's real connector attachments - anything
  // NOT listed gets a solid wall (see buildSubwayJunctionRoom's own
  // comment). Junction 1 connects north (entrance) + east (junction 2);
  // junction 2 connects west (junction 1) + north (platform) + south
  // (station below). Before this, a player walking straight through either
  // junction's genuinely unused side (e.g. continuing straight south past
  // junction 1 instead of turning east) hit nothing at all - no wall, no
  // floor beyond - and fell into unbuilt void space, which is exactly what
  // produced "walk to the end of the tunnel and get teleported to the
  // surface" and "can see a black void" bug reports.
  buildSubwayJunctionRoom(scene, colliders, solidMeshes, subwayEntrance.landingX, connectorWaypointZ, JUNCTION_HALF, ['north', 'east'])
  buildSubwayJunctionRoom(scene, colliders, solidMeshes, SUBWAY_X, connectorWaypointZ, JUNCTION_HALF, ['west', 'north', 'south'])
  buildSubwayConnector(scene, colliders, solidMeshes, flickerLights, subwayEntrance.landingX, subwayEntrance.landingZ, subwayEntrance.landingX, connectorWaypointZ + JUNCTION_HALF)
  buildSubwayConnector(scene, colliders, solidMeshes, flickerLights, subwayEntrance.landingX + JUNCTION_HALF, connectorWaypointZ, SUBWAY_X - JUNCTION_HALF, connectorWaypointZ)
  buildSubwayConnector(scene, colliders, solidMeshes, flickerLights, SUBWAY_X, connectorWaypointZ + JUNCTION_HALF, SUBWAY_X, SUBWAY_Z_START)

  // Underground station: a third branch off the same junction room the
  // platform connector uses, heading further south into open space no
  // other underground system occupies (the sewer sits at x=-5, z=[34,50] -
  // nowhere near this).
  buildSubwayConnector(scene, colliders, solidMeshes, flickerLights, SUBWAY_X, connectorWaypointZ - JUNCTION_HALF, STATION_X, STATION_Z_END)
  const undergroundStation = buildUndergroundStation(scene, colliders, solidMeshes, flickerLights, towerChestSpots)
  // Stage 11 - Level -2 sewers, continuing straight through the breach left
  // in the station's LEVEL2 dead end (see buildToxicSewerLevel's own comment).
  const toxicSewerLevel = buildToxicSewerLevel(scene, colliders, solidMeshes, flickerLights, towerChestSpots)
  // Stage 12 - Level -3 mines, continuing straight through the breach left
  // in the sewer level's own dead end (see buildMineLevel's own comment).
  const mineLevel = buildMineLevel(scene, colliders, solidMeshes, flickerLights, towerChestSpots)

  // Perf test concluded (2026-07-21): skipping these 4 outer zones (64
  // buildings/houses) made fps WORSE, not better - map size confirmed NOT
  // to be the bottleneck. Restored.
  buildOuterZones(scene, register, cullables, towerChestSpots, colliders, solidMeshes, skyscraperShortcuts)

  // Phase 1 of the Extended Metropolitan Grid plan - the first real
  // blueprint location. Placed well clear of the commercial zone's own
  // decorative building grid (roughly x=[130,190] z=[-27,27], see
  // outerZoneBuildingSpecs/OUTER_ZONES above) so neither overlaps.
  // "Med/high loot complexity" per the blueprint's own legend - consumables
  // boosted rather than a flat re-roll of every entry.
  const RETAIL_LOOT_WEIGHTS = { ...LOOT_WEIGHTS, health: 2, ammo: 1.5, fuelcan: 1 }

  const supermarket = buildRetailStore(scene, register, {
    x: 160, z: 60, w: 20, d: 14, aisleRows: 3, shelfLen: 4, rearDoor: true,
  })
  registerZone({ id: 'supermarket', x: 160, z: 60, radius: 14, densityMult: 1.4 })
  towerChestSpots.push({ x: 160, y: 0, z: 60 + 3, lootWeights: RETAIL_LOOT_WEIGHTS })

  const groceryStore = buildRetailStore(scene, register, {
    x: 160, z: -60, w: 13, d: 10, aisleRows: 2, shelfLen: 2.8,
  })
  registerZone({ id: 'grocery', x: 160, z: -60, radius: 10, densityMult: 1.3 })
  towerChestSpots.push({ x: 160, y: 0, z: -60 - 2, lootWeights: RETAIL_LOOT_WEIGHTS })

  // Stage 2: Hospital + Pharmacy, north of the supermarket along the same
  // x=160 line (clear gap of 30+ units), well clear of the suburbs zone's
  // own building grid (x=[-30,30]) since this sits at x=160/145. "High"
  // density/loot per the blueprint's legend - medical loot skews health
  // items specifically rather than the retail stores' broader consumables mix.
  const MEDICAL_LOOT_WEIGHTS = { ...LOOT_WEIGHTS, health: 3, extended_mag: 0.1, rare_weapon: 0.1, legendary_weapon: 0.03 }

  const hospital = buildHospital(scene, register, 160, 100)
  registerZone({ id: 'hospital', x: 160, z: 112, radius: 16, densityMult: 1.5 })
  towerChestSpots.push({ x: 160, y: 0, z: 116, lootWeights: MEDICAL_LOOT_WEIGHTS })

  const pharmacy = buildPharmacy(scene, register, 145, 100)
  registerZone({ id: 'pharmacy', x: 145, z: 100, radius: 8, densityMult: 1.3 })
  towerChestSpots.push({ x: 145, y: 0, z: 100, lootWeights: MEDICAL_LOOT_WEIGHTS })

  // Stage 3: Hardware Store + Gun Shop, south of the grocery store along the
  // same x=160 commercial strip - 35+ units of clearance from grocery
  // (160,-60) and no x-overlap with the industrial zone (0,-160). Hardware
  // Store gets a rear loading-dock door per the blueprint's own callout.
  // Gun Shop's chest is weapon-only weights (bypasses health/ammo/misc
  // entirely) - the Vault's "this location = guaranteed good reward" idea,
  // just via the loot-override mechanism instead of a hardcoded drop.
  const TOOL_DRESSING_FILES = ['tool-hammer.glb', 'tool-crowbar.glb', 'tool-tireiron.glb']
  const WEAPON_ONLY_LOOT_WEIGHTS = { rare_weapon: 10, legendary_weapon: 3, extended_mag: 4, scope: 3 }

  const hardwareStore = buildRetailStore(scene, register, {
    x: 160, z: -100, w: 16, d: 11, aisleRows: 3, shelfLen: 3.4,
    rearDoor: true, dressingFiles: TOOL_DRESSING_FILES,
  })
  registerZone({ id: 'hardware', x: 160, z: -100, radius: 12, densityMult: 1.3 })
  towerChestSpots.push({ x: 160, y: 0, z: -100 + 4, lootWeights: WEAPON_ONLY_LOOT_WEIGHTS })

  const gunShop = buildGunShop(scene, register, 145, -100)
  registerZone({ id: 'gunshop', x: 145, z: -100, radius: 8, densityMult: 1.4 })
  towerChestSpots.push({ x: 145, y: 0, z: -100, lootWeights: WEAPON_ONLY_LOOT_WEIGHTS })

  // Stage 4: Police Station + Military Checkpoint, one more block south
  // along the x=160 strip. "Fortresses" per the blueprint's own zone name -
  // highest density so far, and the first "reinforced entry" (a real
  // lockable door, not just dressing - see Game.js's lockedCells wiring
  // right after buildWorld() returns).
  const policeStation = buildPoliceStation(scene, register, 160, -115)
  registerZone({ id: 'police', x: 160, z: -121, radius: 16, densityMult: 1.6 })
  towerChestSpots.push({ x: 160, y: 0, z: -116, lootWeights: WEAPON_ONLY_LOOT_WEIGHTS })

  const militaryCheckpoint = buildMilitaryCheckpoint(scene, register, 140, -115)
  registerZone({ id: 'checkpoint', x: 140, z: -115, radius: 8, densityMult: 1.4 })
  towerChestSpots.push({ x: 140, y: 0, z: -112, lootWeights: WEAPON_ONLY_LOOT_WEIGHTS })

  // Stage 5: Prison Complex, another block south of the police station -
  // 30+ units of clearance from its cell (z=[-130,-112]), and no x-overlap
  // with the industrial zone (x=[-30,30]) despite similar z-range.
  const prison = buildPrison(scene, register, 160, -170)
  registerZone({ id: 'prison', x: 160, z: -180, radius: 20, densityMult: 1.6 })
  towerChestSpots.push({ x: 160, y: 0, z: -170, lootWeights: WEAPON_ONLY_LOOT_WEIGHTS })

  // Stage 6: Abandoned University Campus, north of the residential zone's
  // own building grid (x=[-190,-130] z=[-27,27]) - 40+ units of z-clearance.
  // Per-room loot override (the plan's own callout for this stage): each
  // of the 3 sub-rooms gets its own chest with different weighting instead
  // of one flat chest for the whole building, exercising Stage 0's
  // per-chest override on 3 different tables in one place for the first
  // time (not just one override per whole location like every stage so far).
  const university = buildUniversity(scene, register, -160, 70)
  registerZone({ id: 'university', x: -160, z: 80, radius: 20, densityMult: 1.3 })
  const LAB_LOOT_WEIGHTS = { ...LOOT_WEIGHTS, health: 2.5, extended_mag: 0.6 }
  towerChestSpots.push({ x: -165.5, y: 0, z: 76, lootWeights: LAB_LOOT_WEIGHTS })
  towerChestSpots.push({ x: -154.5, y: 0, z: 80.5 }) // library - default weights, not every room needs an override
  towerChestSpots.push({ x: -166, y: 0, z: 85, lootWeights: RETAIL_LOOT_WEIGHTS })

  // Stage 8: Skyscraper, far out at x=250 - 60+ units clear of the
  // commercial zone's own grid (x=[130,190]) and everything built onto its
  // own column since. facingSign puts the open facade toward x=0 (the
  // direction a player would actually approach from).
  const skyscraper = buildOfficeSkyscraper(scene, colliders, solidMeshes, register, 250, 0, towerChestSpots, flickerLights)
  registerZone({ id: 'skyscraper', x: 250, z: 0, radius: 20, densityMult: 1.3 })
  // Stage 13's speakeasy, hidden at the far end of the bunker's own hidden
  // complex - same "set the guaranteed reward directly on the door object"
  // pattern as bank.vaultDoor above.
  skyscraper.hiddenComplex.speakeasyDoor.lootWeights = { legendary_weapon: 8, rare_weapon: 8, extended_mag: 3 }

  // Stage 9: Mega-Mall, south of the skyscraper along the same x=250
  // column - 90+ units of z-clearance.
  const megaMall = buildMegaMall(scene, register, 250, -100)
  registerZone({ id: 'megamall', x: 250, z: -100, radius: 25, densityMult: 1.5 })
  for (const spot of megaMall.chestSpots) {
    const lootWeights = spot.loot === 'weapon' ? WEAPON_ONLY_LOOT_WEIGHTS : spot.loot === 'retail' ? RETAIL_LOOT_WEIGHTS : undefined
    towerChestSpots.push({ x: spot.x, y: 0, z: spot.z, lootWeights })
  }
  buildWalkway(scene, register, skyscraper.x, skyscraper.z - 7, megaMall.x, megaMall.z + 10)

  // Cosmetic "Emergency Hatch" markers near a handful of the new locations,
  // hinting at the underground network to come (Stages 10-12) - see
  // buildManholeCover's own comment for why these are purely decorative.
  buildDirectionalSignpost(scene, SAFE_ZONE_X - 2, SAFE_ZONE_Z - 9)
  // Interactive World batch - the promised payoff finally lands: each cover
  // is now a real interact point (see Game.js's _updateManholeCovers),
  // dropping the player straight down into the underground network instead
  // of staying purely cosmetic. Same (x,z) spots chosen above, just
  // collected into an array buildWorld can return.
  const manholeCovers = [
    { x: SAFE_ZONE_X + 3, z: SAFE_ZONE_Z - 8 },
    { x: hardwareStore.x + 3, z: hardwareStore.z - 3 },
    { x: policeStation.x - 3, z: policeStation.z + 2 },
    { x: skyscraper.x - 2, z: skyscraper.z - 9 },
    { x: megaMall.x, z: megaMall.z + 8 },
  ]
  for (const m of manholeCovers) buildManholeCover(scene, m.x, m.z)

  // "Finish the set" additions, requested after Stage 9 wrapped up all the
  // blueprint's own named locations - these 4 are beyond the blueprint.
  const warehouse = buildWarehouse(scene, register, 0, -215)
  registerZone({ id: 'warehouse', x: 0, z: -215, radius: 18, densityMult: 1.3 })
  towerChestSpots.push({ x: 0, y: 0, z: -215, lootWeights: WEAPON_ONLY_LOOT_WEIGHTS })

  // Interactive World batch - clustered around the Warehouse's clear
  // exterior (its own footprint is x:[-10,10] z:[-223,-207], w=20 d=16) so
  // none of these overlap the room, its door, or each other.
  const containerStaircase = buildContainerStaircase(scene, colliders, solidMeshes, -14, -218)
  towerChestSpots.push({ x: containerStaircase.lootSpot.x, y: containerStaircase.lootSpot.y, z: containerStaircase.lootSpot.z })
  const industrialSiren = buildIndustrialSiren(scene, 14, -215)
  const wreckingPendulum = buildWreckingPendulum(scene, -5, -202)
  const scaffolding = buildScaffolding(scene, register, 5, -202)
  const tacticalStreetlightA = buildTacticalStreetlight(scene, register, -14, -212)
  const tacticalStreetlightB = buildTacticalStreetlight(scene, register, -14, -224)

  // Elevator Tower - standalone lookout structure, well clear of everything
  // else (confirmed empty via a live collider-overlap check against the
  // real running game before picking this spot, not just eyeballed against
  // the registerZone list) and safely inside the perimeter wall (+/-375 on
  // each axis, see addPerimeterBarricade's groundSize=750).
  const elevatorTower = buildElevatorTower(scene, colliders, solidMeshes, register, 300, 300)
  registerZone({ id: 'elevatortower', x: 300, z: 300, radius: 8, densityMult: 0.9 })

  const gasStation = buildGasStation(scene, register, 0, 200)
  registerZone({ id: 'gasstation', x: 0, z: 200, radius: 10, densityMult: 1.1 })
  const FUEL_LOOT_WEIGHTS = { ...LOOT_WEIGHTS, fuelcan: 3, health: 1.5 }
  towerChestSpots.push({ x: 0, y: 0, z: 197, lootWeights: FUEL_LOOT_WEIGHTS })

  const bank = buildBank(scene, register, -250, 0)
  registerZone({ id: 'bank', x: -250, z: 0, radius: 14, densityMult: 1.4 })
  towerChestSpots.push({ x: -250, y: 0, z: -3, lootWeights: RETAIL_LOOT_WEIGHTS })
  // The vault's own guaranteed reward on unlock (see Game.js's
  // lockedCells/_tryOpenLockedCell) is the best of any location so far -
  // set directly on the door object since _tryOpenLockedCell already
  // checks for a per-door override before falling back to its default
  // weapon-tier table.
  bank.vaultDoor.lootWeights = { legendary_weapon: 10, rare_weapon: 5 }

  // Second "finish the set" round: Diner/Radio Station (the alternatives
  // skipped when Gas Station/Bank were picked) plus Fire Station and Motel.
  const diner = buildDiner(scene, register, 100, 150)
  registerZone({ id: 'diner', x: 100, z: 150, radius: 10, densityMult: 1.1 })
  towerChestSpots.push({ x: 100, y: 0, z: 147, lootWeights: RETAIL_LOOT_WEIGHTS })

  const radioStation = buildRadioStation(scene, register, -100, 150)
  registerZone({ id: 'radiostation', x: -100, z: 150, radius: 10, densityMult: 1.2 })
  towerChestSpots.push({ x: -100, y: 0, z: 147 })
  radioStation.broadcastDoor.lootWeights = { legendary_weapon: 6, rare_weapon: 8, extended_mag: 2 }

  const fireStation = buildFireStation(scene, register, 100, -150)
  registerZone({ id: 'firestation', x: 100, z: -150, radius: 10, densityMult: 1.2 })
  towerChestSpots.push({ x: 100, y: 0, z: -147, lootWeights: WEAPON_ONLY_LOOT_WEIGHTS })

  const motel = buildMotel(scene, register, 100, 100)
  registerZone({ id: 'motel', x: 100, z: 100, radius: 14, densityMult: 1.2 })
  towerChestSpots.push({ x: 100, y: 0, z: 97 })

  // "Fill the empty map" round - 20 more locations spread across the outer
  // ring and diagonal quadrants of the 750x750 map that every zone/location
  // above left completely open (checked by hand against every rect/circle
  // above, each placed with 25+ units of clearance from its nearest
  // neighbor). Same "finish the set" level of detail as warehouse/gas
  // station/bank/diner above - single-room shells via buildFillerLocation,
  // not another full multi-stage blueprint location.
  buildFillerLocation(scene, register, {
    x: 320, z: 160, w: 16, d: 20, floorColor: 0x6b5a42,
    dressing: [
      { file: 'campus-bookcase.glb', dx: -6, dz: -8 }, { file: 'campus-bookcase.glb', dx: -6, dz: -3 },
      { file: 'campus-bookcase.glb', dx: 6, dz: -8 }, { file: 'campus-bookcase.glb', dx: 6, dz: -3 },
      { file: 'campus-table.glb', dx: -2, dz: 2 }, { file: 'campus-table.glb', dx: 2, dz: 2 },
      { file: 'campus-books.glb', dx: 0, dz: 6 },
    ],
  })
  registerZone({ id: 'library', x: 320, z: 160, radius: 14, densityMult: 1.1 })
  towerChestSpots.push({ x: 320, y: 0, z: 156 })

  buildFillerLocation(scene, register, {
    x: 330, z: 70, w: 14, d: 24, wallHeight: 5, doorWidth: 2.6, floorColor: 0x4a4438,
    dressing: [
      { file: 'waiting-chair.glb', dx: -2, dz: -6 }, { file: 'waiting-chair.glb', dx: 2, dz: -6 },
      { file: 'waiting-chair.glb', dx: -2, dz: -2 }, { file: 'waiting-chair.glb', dx: 2, dz: -2 },
      { file: 'waiting-chair.glb', dx: -2, dz: 2 }, { file: 'waiting-chair.glb', dx: 2, dz: 2 },
      { file: 'waiting-chair.glb', dx: -2, dz: 6 }, { file: 'waiting-chair.glb', dx: 2, dz: 6 },
    ],
  })
  registerZone({ id: 'church', x: 330, z: 70, radius: 14, densityMult: 1.1 })
  towerChestSpots.push({ x: 330, y: 0, z: 78 })

  buildFillerLocation(scene, register, {
    x: -320, z: 150, w: 18, d: 16, doorWidth: 2.6, floorColor: 0xb8a888,
    dressing: [
      { file: 'campus-table.glb', dx: -5, dz: -3 }, { file: 'campus-table.glb', dx: 0, dz: -3 }, { file: 'campus-table.glb', dx: 5, dz: -3 },
      { file: 'campus-bookcase.glb', dx: -7, dz: 5 }, { file: 'campus-bookcase.glb', dx: 7, dz: 5 },
      { file: 'campus-books.glb', dx: 0, dz: 5 },
    ],
  })
  registerZone({ id: 'school', x: -320, z: 150, radius: 14, densityMult: 1.1 })
  towerChestSpots.push({ x: -320, y: 0, z: 154 })

  buildFillerLocation(scene, register, {
    x: 280, z: 260, w: 20, d: 16, doorWidth: 3, floorColor: 0x2a2622,
    dressing: [
      { file: 'waiting-chair.glb', dx: -3, dz: -6 }, { file: 'waiting-chair.glb', dx: 3, dz: -6 },
      { file: 'waiting-chair.glb', dx: -3, dz: -3 }, { file: 'waiting-chair.glb', dx: 3, dz: -3 },
      { file: 'waiting-chair.glb', dx: -3, dz: 0 }, { file: 'waiting-chair.glb', dx: 3, dz: 0 },
      { file: 'waiting-chair.glb', dx: -3, dz: 3 }, { file: 'waiting-chair.glb', dx: 3, dz: 3 },
      { file: 'waiting-chair.glb', dx: -3, dz: 6 }, { file: 'waiting-chair.glb', dx: 3, dz: 6 },
      { file: 'counter.glb', dx: 0, dz: -7 },
    ],
  })
  registerZone({ id: 'theater', x: 280, z: 260, radius: 14, densityMult: 1.2 })
  towerChestSpots.push({ x: 280, y: 0, z: 266 })

  buildFillerLocation(scene, register, {
    x: -280, z: 260, w: 16, d: 14, floorColor: 0x5a5650,
    dressing: [
      { file: 'bench.glb', dx: -4, dz: -3 }, { file: 'bench.glb', dx: 4, dz: -3 },
      { file: 'bench.glb', dx: -4, dz: 3, rot: Math.PI }, { file: 'waterbarrel.glb', dx: 5, dz: 4 },
    ],
  })
  registerZone({ id: 'gym', x: -280, z: 260, radius: 12, densityMult: 1.1 })
  towerChestSpots.push({ x: -280, y: 0, z: 264, lootWeights: { ...LOOT_WEIGHTS, health: 1.8 } })

  buildFillerLocation(scene, register, {
    x: 65, z: -95, w: 8, d: 7, doorWidth: 2, floorColor: 0xc4c0b0,
    dressing: [{ file: 'counter.glb', dx: -2, dz: -1 }, { file: 'trashbin.glb', dx: 2.5, dz: 2 }],
  })
  registerZone({ id: 'laundromat', x: 65, z: -95, radius: 8, densityMult: 1.0 })
  towerChestSpots.push({ x: 65, y: 0, z: -93 })

  buildFillerLocation(scene, register, {
    x: -65, z: -95, w: 9, d: 7, doorWidth: 2.2, floorColor: 0xa8a498,
    dressing: [{ file: 'counter.glb', dx: -2, dz: -1 }, { file: 'mailbox.glb', dx: 3, dz: -2.5 }, { file: 'shelf.glb', dx: 3, dz: 1.5 }],
  })
  registerZone({ id: 'postoffice', x: -65, z: -95, radius: 8, densityMult: 1.0 })
  towerChestSpots.push({ x: -65, y: 0, z: -93 })

  buildFillerLocation(scene, register, {
    x: 320, z: -75, w: 10, d: 8, floorColor: 0xc9a860,
    dressing: [
      { file: 'counter.glb', dx: -3, dz: -2, rot: Math.PI / 2 },
      { file: 'food-bag.glb', dx: -2, dz: -2.5, scale: 0.3 }, { file: 'food-bottle.glb', dx: -1.5, dz: -2.5, scale: 0.3 },
      { file: 'waiting-chair.glb', dx: 2, dz: 2 }, { file: 'waiting-chair.glb', dx: -2, dz: 2 },
    ],
  })
  registerZone({ id: 'burgerjoint', x: 320, z: -75, radius: 9, densityMult: 1.1 })
  towerChestSpots.push({ x: 320, y: 0, z: -72, lootWeights: RETAIL_LOOT_WEIGHTS })

  buildFillerLocation(scene, register, {
    x: -320, z: -60, w: 10, d: 8, wallColor: 0x33373a, floorColor: 0x33373a,
    dressing: [
      { file: 'shelf.glb', dx: -3, dz: -2 }, { file: 'shelf.glb', dx: 3, dz: -2 },
      { file: 'atm.glb', dx: 0, dz: -3 }, { file: 'payphone.glb', dx: 3.5, dz: 2 },
    ],
  })
  registerZone({ id: 'electronics', x: -320, z: -60, radius: 9, densityMult: 1.1 })
  towerChestSpots.push({ x: -320, y: 0, z: -57, lootWeights: { ...LOOT_WEIGHTS, extended_mag: 1.5, scope: 1.5 } })

  buildFillerLocation(scene, register, {
    x: -320, z: 260, w: 10, d: 8, floorColor: 0x8a7868,
    dressing: [
      { file: 'shelf.glb', dx: -3, dz: -2 }, { file: 'shelf.glb', dx: 0, dz: -2 }, { file: 'shelf.glb', dx: 3, dz: -2 },
      { file: 'counter.glb', dx: 0, dz: 2 },
    ],
  })
  registerZone({ id: 'clothingstore', x: -320, z: 260, radius: 9, densityMult: 1.0 })
  towerChestSpots.push({ x: -320, y: 0, z: 263 })

  buildFillerLocation(scene, register, {
    x: 320, z: -150, w: 7, d: 6, doorWidth: 1.8, floorColor: 0xc4c0b0,
    dressing: [{ file: 'waiting-chair.glb', dx: -1.5, dz: -1 }, { file: 'waiting-chair.glb', dx: 1.5, dz: -1 }, { file: 'counter.glb', dx: 0, dz: 1.5 }],
  })
  registerZone({ id: 'barbershop', x: 320, z: -150, radius: 7, densityMult: 1.0 })
  towerChestSpots.push({ x: 320, y: 0, z: -147 })

  buildFillerLocation(scene, register, {
    x: -320, z: -150, w: 14, d: 12, wallHeight: 4.2, doorWidth: 3, floorColor: 0x3a3a34,
    dressing: [
      { file: 'barrel.glb', dx: -5, dz: -4 }, { file: 'barrel.glb', dx: -5, dz: -2 },
      { file: 'cabledrum.glb', dx: 5, dz: -4 },
      { file: 'tool-hammer.glb', dx: 5, dz: 2 }, { file: 'tool-crowbar.glb', dx: 5.5, dz: 3 }, { file: 'tool-tireiron.glb', dx: 6, dz: 4 },
      { file: 'roadblock.glb', dx: 0, dz: 5 },
    ],
  })
  registerZone({ id: 'garage', x: -320, z: -150, radius: 11, densityMult: 1.1 })
  towerChestSpots.push({ x: -320, y: 0, z: -146, lootWeights: FUEL_LOOT_WEIGHTS })

  buildFillerLocation(scene, register, {
    x: 200, z: 300, w: 14, d: 10, fenceOnly: true,
    dressing: [
      { file: 'traderstall.glb', dx: -4, dz: 0 }, { file: 'traderstall.glb', dx: 0, dz: 0 }, { file: 'traderstall.glb', dx: 4, dz: 0 },
      { file: 'food-carton.glb', dx: -4, dz: 1, scale: 0.3 }, { file: 'food-can.glb', dx: 0, dz: 1, scale: 0.3 },
    ],
  })
  registerZone({ id: 'farmersmarket', x: 200, z: 300, radius: 10, densityMult: 1.0 })
  towerChestSpots.push({ x: 200, y: 0, z: 296, lootWeights: RETAIL_LOOT_WEIGHTS })

  // Strip Mall - 3 small shopfronts side by side, each its own door bay
  // (buildRoom only supports one door gap per wall, so 3 adjacent rooms
  // reads as "one strip mall" the same way buildMotel already builds N
  // adjacent single rooms for its row of units).
  const stripMallCenters = [-208.5, -200, -191.5]
  for (let i = 0; i < stripMallCenters.length; i++) {
    buildRoom(scene, register, { x: stripMallCenters[i], z: 300, w: 8, d: 10, doorSides: [{ side: 'south', width: 2.2 }] })
    const floorMat = cachedFlatMaterial({ color: 0x8a7868, roughness: 0.85 })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 9.4), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(stripMallCenters[i], 0.02, 300)
    floor.receiveShadow = true
    scene.add(floor)
    placePropSimple(scene, register, i === 1 ? 'counter.glb' : 'shelf.glb', stripMallCenters[i], 297, 0)
  }
  registerZone({ id: 'stripmall', x: -200, z: 300, radius: 14, densityMult: 1.1 })
  towerChestSpots.push({ x: -200, y: 0, z: 296, lootWeights: RETAIL_LOOT_WEIGHTS })

  buildFillerLocation(scene, register, {
    x: 200, z: -280, w: 22, d: 10, doorWidth: 3, floorColor: 0x8a6840,
    dressing: [
      { file: 'waiting-chair.glb', dx: -8, dz: -3 }, { file: 'waiting-chair.glb', dx: -8, dz: 0 },
      { file: 'waiting-chair.glb', dx: 8, dz: -3 }, { file: 'waiting-chair.glb', dx: 8, dz: 0 },
      { file: 'trashbin.glb', dx: 0, dz: 4 },
    ],
  })
  registerZone({ id: 'bowling', x: 200, z: -280, radius: 13, densityMult: 1.0 })
  towerChestSpots.push({ x: 200, y: 0, z: -276 })

  // Cemetery - fenced open-air plot, no headstone prop on disk so these are
  // simple procedural slabs (same "plain primitive, not every prop needs a
  // sourced model" precedent as the gas station's pumps/canopy above).
  buildFillerLocation(scene, register, { x: -200, z: -280, w: 26, d: 20, fenceOnly: true })
  {
    const stoneMat = cachedFlatMaterial({ color: 0x8a887c, roughness: 0.95 })
    let hs = 0
    for (const row of [-6, 0, 6]) {
      for (const col of [-9, -3, 3, 9]) {
        hs++
        const headstone = new THREE.Mesh(new THREE.BoxGeometry(1, 1.1, 0.25), stoneMat)
        headstone.position.set(-200 + col, 0.55, -280 + row + (hs % 2) * 0.6)
        headstone.castShadow = true
        scene.add(headstone)
        register(headstone)
      }
    }
  }
  registerZone({ id: 'cemetery', x: -200, z: -280, radius: 15, densityMult: 1.3 })
  towerChestSpots.push({ x: -200, y: 0, z: -284 })

  // Trailer Park - freestanding low boxes, not a single walled building, so
  // built directly rather than through buildFillerLocation.
  {
    const trailerMat = cachedFlatMaterial({ color: 0xa89c86, roughness: 0.85 })
    const roofMat = cachedFlatMaterial({ color: 0x5a5044, roughness: 0.7 })
    const trailerSpots = [[-8, -4, 0], [8, -3, Math.PI], [-6, 6, Math.PI / 2], [6, 5, -Math.PI / 2]]
    for (const [dx, dz, rot] of trailerSpots) {
      const body = new THREE.Mesh(new THREE.BoxGeometry(6, 2, 2.6), trailerMat)
      body.position.set(dx, 1, 300 + dz)
      body.rotation.y = rot
      body.castShadow = true
      scene.add(body)
      register(body)
      const roof = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.2, 2.8), roofMat)
      roof.position.set(dx, 2.1, 300 + dz)
      roof.rotation.y = rot
      roof.castShadow = true
      scene.add(roof)
      register(roof)
    }
  }
  registerZone({ id: 'trailerpark', x: 0, z: 300, radius: 14, densityMult: 1.1 })
  towerChestSpots.push({ x: 0, y: 0, z: 296 })

  buildFillerLocation(scene, register, {
    x: 0, z: -300, w: 24, d: 20, fenceOnly: true,
    dressing: [
      { file: 'dumpster.glb', dx: -7, dz: -5 }, { file: 'dumpster.glb', dx: -7, dz: 2 }, { file: 'dumpster.glb', dx: 7, dz: -3 },
      { file: 'barrel.glb', dx: 3, dz: 5 }, { file: 'barrel.glb', dx: 4, dz: 6 }, { file: 'cabledrum.glb', dx: -3, dz: 6 },
      { file: 'roadblock.glb', dx: 0, dz: -7 }, { file: 'trafficcone.glb', dx: 1, dz: -7 }, { file: 'trafficcone.glb', dx: -1, dz: -7 },
    ],
  })
  registerZone({ id: 'junkyard', x: 0, z: -300, radius: 14, densityMult: 1.2 })
  towerChestSpots.push({ x: 0, y: 0, z: -296, lootWeights: FUEL_LOOT_WEIGHTS })

  // Power Substation - purely atmospheric/hazardous-looking, deliberately no
  // chest (not every new location needs to be a loot stop).
  buildFillerLocation(scene, register, { x: 100, z: 260, w: 14, d: 14, wallColor: 0xb0331a, fenceOnly: true })
  {
    const transformerMat = cachedFlatMaterial({ color: 0x4a4a48, roughness: 0.6, metalness: 0.6 })
    const warnMat = cachedFlatMaterial({ color: 0xd9a520, roughness: 0.5 })
    for (const [dx, dz] of [[-3, -3], [3, -3], [0, 3]]) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2.4, 2), transformerMat)
      box.position.set(100 + dx, 1.2, 260 + dz)
      box.castShadow = true
      scene.add(box)
      register(box)
      const cap = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.15, 2.1), warnMat)
      cap.position.set(100 + dx, 2.48, 260 + dz)
      scene.add(cap)
    }
  }
  registerZone({ id: 'substation', x: 100, z: 260, radius: 10, densityMult: 1.0 })

  buildFillerLocation(scene, register, {
    x: -100, z: 260, w: 16, d: 14, wallHeight: 3.2, doorWidth: 3, floorColor: 0x4a4a3c, wallColor: 0x3a3a2c,
    dressing: [
      { file: 'roadblock.glb', dx: -3, dz: -6 }, { file: 'roadblock.glb', dx: 3, dz: -6 },
      { file: 'trafficcone.glb', dx: -2, dz: -6.5 }, { file: 'trafficcone.glb', dx: 2, dz: -6.5 },
      { file: 'cabledrum.glb', dx: 0, dz: 4 },
    ],
  })
  registerZone({ id: 'outpost', x: -100, z: 260, radius: 12, densityMult: 1.3 })
  towerChestSpots.push({ x: -100, y: 0, z: 256, lootWeights: WEAPON_ONLY_LOOT_WEIGHTS })

  // "Fill the empty map", round 2 - 10 more locations, same "finish the
  // set" level of detail as round 1 above. A few reuse a one-off
  // centerpiece (Ferris wheel, water+dock, tanks, a truck) built directly
  // rather than through buildFillerLocation, same precedent as the
  // trailer park/cemetery headstones above.
  buildFillerLocation(scene, register, { x: 160, z: 220, w: 32, d: 28, fenceOnly: true })
  {
    const fenceMat = cachedFlatMaterial({ color: 0x2a2a26, roughness: 0.8, metalness: 0.4 })
    for (const dx of [-8, 8]) {
      const divider = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.4, 28), fenceMat)
      divider.position.set(160 + dx, 0.7, 220)
      scene.add(divider)
      register(divider)
    }
    placePropSimple(scene, register, 'trashbin.glb', 147, 208, 0)
    placePropSimple(scene, register, 'barrel.glb', 147, 210, 0)
  }
  registerZone({ id: 'zoo', x: 160, z: 220, radius: 16, densityMult: 1.2 })
  towerChestSpots.push({ x: 160, y: 0, z: 216 })

  buildFillerLocation(scene, register, {
    x: -160, z: 220, w: 32, d: 28, fenceOnly: true,
    dressing: [
      { file: 'traderstall.glb', dx: -10, dz: 10 }, { file: 'traderstall.glb', dx: 10, dz: 10 },
      { file: 'food-carton.glb', dx: -10, dz: 11, scale: 0.3 },
    ],
  })
  {
    const wheelMat = cachedFlatMaterial({ color: 0xb0331a, roughness: 0.5, metalness: 0.3 })
    const poleMat = cachedFlatMaterial({ color: 0x2a2a26, roughness: 0.7, metalness: 0.5 })
    const wheelR = 8
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(wheelR, 0.35, 8, 24), wheelMat)
    wheel.position.set(-160, wheelR + 0.5, 214)
    wheel.castShadow = true
    scene.add(wheel)
    register(wheel)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, wheelR + 0.5, 8), poleMat)
    pole.position.set(-160, (wheelR + 0.5) / 2, 214)
    scene.add(pole)
    register(pole)
  }
  registerZone({ id: 'amusementpark', x: -160, z: 220, radius: 17, densityMult: 1.2 })
  towerChestSpots.push({ x: -160, y: 0, z: 214, lootWeights: RETAIL_LOOT_WEIGHTS })

  buildFillerLocation(scene, register, {
    x: 250, z: 180, w: 16, d: 12, floorColor: 0x2e1a1a,
    dressing: [
      { file: 'counter.glb', dx: -3, dz: -3 }, { file: 'counter.glb', dx: 3, dz: -3 },
      { file: 'waiting-chair.glb', dx: -1, dz: 4 }, { file: 'waiting-chair.glb', dx: 1, dz: 4 },
    ],
  })
  for (const dx of [-5, 5]) {
    const slotShelf = placePropSimple(scene, register, 'shelf.glb', 250 + dx, 182, 0)
    if (slotShelf) slotShelf.traverse((c) => { if (c.isMesh) c.material.color.setHex(0xc9b34a) })
  }
  // Vault room, same pattern as buildBank's vault above - guaranteed
  // best-tier loot set directly on the door object.
  {
    const vaultW = 5
    const vaultD = 4
    const vaultZ = 180 + 12 / 2 - vaultD / 2 - 0.5
    buildRoom(scene, register, { x: 250, z: vaultZ, w: vaultW, d: vaultD, wallHeight: 2.8, doorSides: [{ side: 'south', width: 1.8 }] })
    const vaultDoor = buildLockableDoor(scene, 250, vaultZ - vaultD / 2, 1.8, 'x')
    vaultDoor.lootWeights = { legendary_weapon: 10, rare_weapon: 6, extended_mag: 3 }
  }
  registerZone({ id: 'casino', x: 250, z: 180, radius: 14, densityMult: 1.3 })
  towerChestSpots.push({ x: 250, y: 0, z: 177, lootWeights: RETAIL_LOOT_WEIGHTS })

  buildFillerLocation(scene, register, {
    x: -250, z: 180, w: 14, d: 11, floorColor: 0x3a1a3d,
    dressing: [
      { file: 'counter.glb', dx: -4, dz: -3, rot: Math.PI / 2 },
      { file: 'waiting-chair.glb', dx: 3, dz: 2 }, { file: 'waiting-chair.glb', dx: 4, dz: 3 }, { file: 'waiting-chair.glb', dx: 2, dz: 3.5 },
    ],
  })
  {
    const discoMat = cachedFlatMaterial({ color: 0xd0d0d0, roughness: 0.2, metalness: 0.8, emissive: 0x8844cc, emissiveIntensity: 0.6 })
    const disco = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 12), discoMat)
    disco.position.set(-250, 3.6, 180)
    scene.add(disco)
  }
  registerZone({ id: 'nightclub', x: -250, z: 180, radius: 11, densityMult: 1.2 })
  towerChestSpots.push({ x: -250, y: 0, z: 177 })

  // Marina/Docks - the one location here that needed a genuinely new
  // environmental feature (open water) rather than just another shell.
  // No real collider (the player still walks/swims at the same flat ground
  // height everywhere, same simplification the sewer's "toxic water" makes -
  // that one ticks damage, this one now slows movement and dips the camera
  // instead, see Game.js's isSwimming/waterBounds). Was purely cosmetic
  // with no swim mechanic at all until that was added.
  // Water bounds computed here (not inline literals down in the block
  // below, and not re-derived at buildWorld()'s own return statement far
  // away) so the visual water plane and the swim-zone check PlayerController
  // uses (see Game.js's isSwimming) can never drift apart - same reasoning
  // buildPark's own grassBounds already established for footstep sounds.
  const WATER_CENTER_X = 160
  const WATER_CENTER_Z = -256
  const WATER_HALF_W = 12
  const WATER_HALF_D = 8
  const waterBounds = { xMin: WATER_CENTER_X - WATER_HALF_W, xMax: WATER_CENTER_X + WATER_HALF_W, zMin: WATER_CENTER_Z - WATER_HALF_D, zMax: WATER_CENTER_Z + WATER_HALF_D }
  {
    buildRoom(scene, register, { x: 160, z: -268, w: 6, d: 5, doorSides: [{ side: 'north', width: 2 }] })
    const dockFloorMat = cachedFlatMaterial({ color: 0x6b5a42, roughness: 0.85 })
    const dockFloor = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 4.4), dockFloorMat)
    dockFloor.rotation.x = -Math.PI / 2
    dockFloor.position.set(160, 0.02, -268)
    dockFloor.receiveShadow = true
    scene.add(dockFloor)
    placePropSimple(scene, register, 'counter.glb', 160, -269.5, 0)

    const waterMat = cachedFlatMaterial({ color: 0x1c4a52, roughness: 0.3, metalness: 0.1 })
    const water = new THREE.Mesh(new THREE.PlaneGeometry(WATER_HALF_W * 2, WATER_HALF_D * 2), waterMat)
    water.rotation.x = -Math.PI / 2
    water.position.set(WATER_CENTER_X, -0.15, WATER_CENTER_Z)
    scene.add(water)

    const dockMat = cachedFlatMaterial({ color: 0x7a6248, roughness: 0.9 })
    const walkway = new THREE.Mesh(new THREE.BoxGeometry(3, 0.15, 14), dockMat)
    walkway.position.set(160, 0.05, -258)
    scene.add(walkway)
    register(walkway)

    const hullMat = cachedFlatMaterial({ color: 0x3a3a34, roughness: 0.7 })
    // Salvage boat - real collider, low enough (0.5, under the player's own
    // step-up height) to climb onto directly from the "water" the same way
    // the dock itself is reached, no gangplank needed. The second hull
    // stays purely decorative (background clutter, matching how it read
    // before this pass).
    const salvageHull = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 5.5), hullMat)
    salvageHull.position.set(155, 0.25, -260)
    salvageHull.castShadow = true
    scene.add(salvageHull)
    register(salvageHull)
    const deckMat = cachedFlatMaterial({ color: 0x5a4a38, roughness: 0.85 })
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 5.2), deckMat)
    deck.rotation.x = -Math.PI / 2
    deck.position.set(155, 0.51, -260)
    deck.receiveShadow = true
    scene.add(deck)
    placePropSimple(scene, register, 'cabledrum.glb', 155, -262, 0, 1, false, 0.51)
    placePropSimple(scene, register, 'waterbarrel.glb', 155.5, -258.5, 0, 1, false, 0.51)

    const hull2 = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 5), hullMat)
    hull2.position.set(165, 0.1, -264)
    hull2.castShadow = true
    scene.add(hull2)

    placePropSimple(scene, register, 'barrel.glb', 156, -266, 0)
    placePropSimple(scene, register, 'cabledrum.glb', 164, -266, 0)
  }
  registerZone({ id: 'marina', x: 160, z: -260, radius: 15, densityMult: 1.0 })
  towerChestSpots.push({ x: 160, y: 0, z: -267 })
  // Salvaged cargo on the boat deck above - better odds than the dockhouse
  // chest, the payoff for actually walking out onto the water instead of
  // just visiting the dockhouse.
  towerChestSpots.push({ x: 155, y: 0.51, z: -260, lootWeights: { ...LOOT_WEIGHTS, rare_weapon: 2, extended_mag: 2 } })

  buildFillerLocation(scene, register, {
    x: -160, z: -260, w: 26, d: 20, fenceOnly: true,
    dressing: [{ file: 'waterbarrel.glb', dx: -8, dz: 6 }, { file: 'waterbarrel.glb', dx: -6, dz: 6 }],
  })
  {
    const tankMat = cachedFlatMaterial({ color: 0x4a4a48, roughness: 0.6, metalness: 0.5 })
    const capMat = cachedFlatMaterial({ color: 0xd9a520, roughness: 0.5 })
    for (const dx of [-7, 0, 7]) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 4.5, 16), tankMat)
      tank.position.set(-160 + dx, 2.25, -264)
      tank.castShadow = true
      scene.add(tank)
      register(tank)
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.2, 16), capMat)
      cap.position.set(-160 + dx, 4.6, -264)
      scene.add(cap)
    }
  }
  registerZone({ id: 'watertreatment', x: -160, z: -260, radius: 14, densityMult: 1.0 })
  towerChestSpots.push({ x: -160, y: 0, z: -256 })

  buildFillerLocation(scene, register, {
    x: -260, z: -260, w: 14, d: 12, floorColor: 0x2e1f1f,
    dressing: [
      { file: 'waiting-chair.glb', dx: -4, dz: -3 }, { file: 'waiting-chair.glb', dx: -1.5, dz: -3 },
      { file: 'waiting-chair.glb', dx: 1.5, dz: -3 }, { file: 'waiting-chair.glb', dx: 4, dz: -3 },
      { file: 'waiting-chair.glb', dx: -1.5, dz: -1 }, { file: 'waiting-chair.glb', dx: 1.5, dz: -1 },
    ],
  })
  {
    const casketMat = cachedFlatMaterial({ color: 0x2a1c14, roughness: 0.4, metalness: 0.2 })
    const casket = new THREE.Mesh(new THREE.BoxGeometry(2, 0.9, 0.8), casketMat)
    casket.position.set(-260, 0.45, -256)
    casket.castShadow = true
    scene.add(casket)
    register(casket)
  }
  registerZone({ id: 'funeralhome', x: -260, z: -260, radius: 10, densityMult: 1.2 })
  towerChestSpots.push({ x: -260, y: 0, z: -256 })

  buildFillerLocation(scene, register, {
    x: 250, z: -260, w: 14, d: 11, floorColor: 0x2a2e33,
    dressing: [
      { file: 'counter.glb', dx: 0, dz: -3, rot: Math.PI },
      { file: 'waiting-chair.glb', dx: -2, dz: 2 }, { file: 'waiting-chair.glb', dx: 2, dz: 2 },
    ],
  })
  {
    const camMat = cachedFlatMaterial({ color: 0x2a2a26, roughness: 0.6, metalness: 0.5 })
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.6, 8), camMat)
    pole.position.set(255, 0.8, -257)
    scene.add(pole)
    register(pole)
    const camHead = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.7), camMat)
    camHead.position.set(255, 1.65, -257)
    scene.add(camHead)
    register(camHead)
  }
  registerZone({ id: 'newsstation', x: 250, z: -260, radius: 10, densityMult: 1.1 })
  towerChestSpots.push({ x: 250, y: 0, z: -256, lootWeights: { ...LOOT_WEIGHTS, extended_mag: 1.5, scope: 1.5 } })

  {
    const tx = 0
    const tz = 250
    buildRoom(scene, register, { x: tx, z: tz, w: 10, d: 7, doorSides: [{ side: 'south', width: 2.2 }] })
    const floorMat = cachedFlatMaterial({ color: 0xc4c0b0, roughness: 0.8 })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 6.4), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(tx, 0.02, tz)
    floor.receiveShadow = true
    scene.add(floor)
    placePropSimple(scene, register, 'counter.glb', tx - 3, tz - 1.5, 0)

    const canopyMat = cachedFlatMaterial({ color: 0xb0331a, roughness: 0.6, metalness: 0.2 })
    const postMat = cachedFlatMaterial({ color: 0x2a2a26, roughness: 0.7, metalness: 0.5 })
    const forecourtZ = tz - 3.5 - 6
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(13, 0.3, 8), canopyMat)
    canopy.position.set(tx, 4, forecourtZ)
    canopy.castShadow = true
    scene.add(canopy)
    register(canopy)
    for (const [px, pz] of [[-5.5, 3.2], [5.5, 3.2], [-5.5, -3.2], [5.5, -3.2]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 4, 8), postMat)
      post.position.set(tx + px, 2, forecourtZ + pz)
      post.castShadow = true
      scene.add(post)
      register(post)
    }
    const pumpMat = cachedFlatMaterial({ color: 0xdedad0, roughness: 0.5 })
    for (const px of [-2, 2]) {
      const pump = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.4, 0.6), pumpMat)
      pump.position.set(tx + px, 0.7, forecourtZ)
      pump.castShadow = true
      scene.add(pump)
      register(pump)
    }

    // Single parked rig, tucked beside the store (not further out past the
    // forecourt) so it stays clear of the Gas Station's own footprint
    // further south along the same x=0 column.
    const truckMat = cachedFlatMaterial({ color: 0x3a4048, roughness: 0.6, metalness: 0.3 })
    const trailerMat = cachedFlatMaterial({ color: 0x8a8478, roughness: 0.7 })
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 2.4), truckMat)
    cab.position.set(tx + 7, 1.1, tz - 3)
    cab.castShadow = true
    scene.add(cab)
    register(cab)
    const trailer = new THREE.Mesh(new THREE.BoxGeometry(8, 2.6, 2.6), trailerMat)
    trailer.position.set(tx + 13, 1.3, tz - 3)
    trailer.castShadow = true
    scene.add(trailer)
    register(trailer)
  }
  registerZone({ id: 'truckstop', x: 0, z: 250, radius: 13, densityMult: 1.1 })
  towerChestSpots.push({ x: 0, y: 0, z: 246, lootWeights: FUEL_LOOT_WEIGHTS })

  buildFillerLocation(scene, register, {
    x: 100, z: -260, w: 10, d: 9, floorColor: 0x9ec9d9,
    dressing: [
      { file: 'campus-table.glb', dx: -2, dz: -1, scale: 0.7 }, { file: 'campus-table.glb', dx: 2, dz: -1, scale: 0.7 },
      { file: 'campus-bookcase.glb', dx: 0, dz: 3, scale: 0.8 },
    ],
  })
  registerZone({ id: 'daycare', x: 100, z: -260, radius: 8, densityMult: 1.1 })
  towerChestSpots.push({ x: 100, y: 0, z: -257 })

  // 30 more locations, user-requested batch, 2026-07-27. Every coordinate
  // below was verified by script (not by eye) against every existing
  // location, the 4 Phase 6 outer zones, the core street grid, and the
  // safe zone - minimum 36-42 units of center-to-center clearance from
  // anything else, same clearance bar every earlier stage used. All use
  // the same buildFillerLocation() helper every other flavor location
  // (library, church, theater, etc.) already uses - no new build pattern
  // needed. None get a Game.js-level this.x reference or a special
  // mechanic (lock, hazard, puzzle) - matching the majority of existing
  // named locations, which are pure loot/flavor stops, not mechanic-gated
  // ones like the police station/prison/sewer are.
  buildFillerLocation(scene, register, {
    x: -173, z: -100, w: 14, d: 12, floorColor: 0x4a4438, openSide: 'north',
    dressing: [
      { file: 'waiting-chair.glb', dx: -3, dz: -3 }, { file: 'waiting-chair.glb', dx: 3, dz: -3 },
      { file: 'campus-table.glb', dx: -3, dz: 2 }, { file: 'campus-table.glb', dx: 3, dz: 2 },
    ],
  })
  const communitycenterRooms = buildRoomExtension(scene, register, {
    x: -173, startZ: -100 + 6, w: 14, roomDepths: [6, 5], floorColor: 0x4a4438,
    dressingSets: [EXTRA_ROOM_DRESSING[0], EXTRA_ROOM_DRESSING[2]],
  })
  registerZone({ id: 'communitycenter', x: -173, z: -100, radius: 18, densityMult: 1.0 })
  towerChestSpots.push({ x: -173, y: 0, z: -95 })
  for (const room of communitycenterRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -122, z: -159, w: 9, d: 8, floorColor: 0x3a3630, openSide: 'north',
    dressing: [
      { file: 'shelf.glb', dx: -3, dz: -2 }, { file: 'shelf.glb', dx: 3, dz: -2 },
      { file: 'campus-books.glb', dx: 0, dz: -2.5 }, { file: 'counter.glb', dx: 0, dz: 2.8, rot: Math.PI },
    ],
  })
  const printshopRooms = buildRoomExtension(scene, register, {
    x: -122, startZ: -159 + 4, w: 9, roomDepths: [6, 5], floorColor: 0x3a3630,
    dressingSets: [EXTRA_ROOM_DRESSING[3], EXTRA_ROOM_DRESSING[1]],
  })
  registerZone({ id: 'printshop', x: -122, z: -159, radius: 14, densityMult: 1.0 })
  towerChestSpots.push({ x: -122, y: 0, z: -156 })
  for (const room of printshopRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -82, z: -199, w: 8, d: 7, floorColor: 0xd8d8d0, openSide: 'north',
    dressing: [
      { file: 'hospital-bed.glb', dx: -1.5, dz: -1.5 }, { file: 'medical-cabinet.glb', dx: 3, dz: -2, rot: -Math.PI / 2 },
      { file: 'medical-cabinet.glb', dx: -3, dz: -2, rot: Math.PI / 2 },
    ],
  })
  const bloodbankRooms = buildRoomExtension(scene, register, {
    x: -82, startZ: -199 + 3.5, w: 8, roomDepths: [6, 5], floorColor: 0xd8d8d0,
    dressingSets: [EXTRA_ROOM_DRESSING[0], EXTRA_ROOM_DRESSING[2]],
  })
  registerZone({ id: 'bloodbank', x: -82, z: -199, radius: 14, densityMult: 1.3 })
  towerChestSpots.push({ x: -82, y: 0, z: -196, lootWeights: MEDICAL_LOOT_WEIGHTS })
  for (const room of bloodbankRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z, lootWeights: MEDICAL_LOOT_WEIGHTS })

  buildFillerLocation(scene, register, {
    x: 226, z: 94, w: 10, d: 10, wallHeight: 6, floorColor: 0x232838, openSide: 'north',
    dressing: [
      { file: 'campus-table.glb', dx: 0, dz: -2 }, { file: 'shelf.glb', dx: -3.5, dz: 2 }, { file: 'shelf.glb', dx: 3.5, dz: 2 },
    ],
  })
  const observatoryRooms = buildRoomExtension(scene, register, {
    x: 226, startZ: 94 + 5, w: 10, roomDepths: [6, 5], floorColor: 0x232838,
    dressingSets: [EXTRA_ROOM_DRESSING[3], EXTRA_ROOM_DRESSING[2]],
  })
  registerZone({ id: 'observatory', x: 226, z: 94, radius: 15, densityMult: 1.1 })
  towerChestSpots.push({ x: 226, y: 0, z: 98 })
  for (const room of observatoryRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -194, z: 149, w: 11, d: 9, floorColor: 0x5c5648, openSide: 'north',
    dressing: [
      { file: 'waiting-chair.glb', dx: -3, dz: -2 }, { file: 'waiting-chair.glb', dx: 3, dz: -2 },
      { file: 'medical-cabinet.glb', dx: 0, dz: 3, rot: Math.PI }, { file: 'counter.glb', dx: 0, dz: -3.5, rot: 0 },
    ],
  })
  const animalshelterRooms = buildRoomExtension(scene, register, {
    x: -194, startZ: 149 + 4.5, w: 11, roomDepths: [6, 5], floorColor: 0x5c5648,
    dressingSets: [EXTRA_ROOM_DRESSING[0], EXTRA_ROOM_DRESSING[1]],
  })
  registerZone({ id: 'animalshelter', x: -194, z: 149, radius: 15, densityMult: 1.0 })
  towerChestSpots.push({ x: -194, y: 0, z: 152 })
  for (const room of animalshelterRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -237, z: 63, w: 22, d: 20, fenceOnly: true,
    dressing: [
      { file: 'barrel.glb', dx: -5, dz: -4 }, { file: 'barrel.glb', dx: -5, dz: 4 }, { file: 'barrel.glb', dx: 5, dz: 0 },
      { file: 'waterbarrel.glb', dx: 3, dz: -4 }, { file: 'waterbarrel.glb', dx: -2, dz: 5 },
      { file: 'roadblock.glb', dx: 0, dz: -6 }, { file: 'trafficcone.glb', dx: 2, dz: -6 },
      { file: 'medical-cabinet.glb', dx: -8, dz: 8, rot: Math.PI }, { file: 'hospital-bed.glb', dx: 8, dz: 8 },
      { file: 'waterbarrel.glb', dx: 0, dz: 9 },
    ],
  })
  registerZone({ id: 'quarantinecamp', x: -237, z: 63, radius: 18, densityMult: 1.4 })
  towerChestSpots.push({ x: -237, y: 0, z: 67, lootWeights: MEDICAL_LOOT_WEIGHTS })
  towerChestSpots.push({ x: -237, y: 0, z: 71, lootWeights: MEDICAL_LOOT_WEIGHTS })

  buildFillerLocation(scene, register, {
    x: -237, z: -63, w: 9, d: 8, floorColor: 0x3a362c, openSide: 'north',
    dressing: [
      { file: 'counter.glb', dx: 0, dz: 2.8, rot: Math.PI }, { file: 'shelf.glb', dx: -3, dz: -2 }, { file: 'shelf.glb', dx: 3, dz: -2 },
      { file: 'tool-crowbar.glb', dx: -3, dz: -2.4 },
    ],
  })
  const pawnshopRooms = buildRoomExtension(scene, register, {
    x: -237, startZ: -63 + 4, w: 9, roomDepths: [7], floorColor: 0x3a362c,
    dressingSets: [EXTRA_ROOM_DRESSING[1]],
  })
  registerZone({ id: 'pawnshop', x: -237, z: -63, radius: 12, densityMult: 1.4 })
  towerChestSpots.push({ x: -237, y: 0, z: -60, lootWeights: WEAPON_ONLY_LOOT_WEIGHTS })
  for (const room of pawnshopRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z, lootWeights: WEAPON_ONLY_LOOT_WEIGHTS })

  buildFillerLocation(scene, register, {
    x: -225, z: -130, w: 28, d: 22, fenceOnly: true,
    dressing: [
      { file: 'roadblock.glb', dx: -6, dz: -5 }, { file: 'roadblock.glb', dx: 6, dz: -5 },
      { file: 'trafficcone.glb', dx: -3, dz: 5 }, { file: 'trafficcone.glb', dx: 3, dz: 5 }, { file: 'trafficcone.glb', dx: 0, dz: 6 },
      { file: 'cabledrum.glb', dx: -7, dz: 4 }, { file: 'cabledrum.glb', dx: 7, dz: 4 },
      { file: 'roadblock.glb', dx: -10, dz: 8 }, { file: 'roadblock.glb', dx: 10, dz: 8 }, { file: 'cabledrum.glb', dx: 0, dz: 9 },
    ],
  })
  registerZone({ id: 'autodealership', x: -225, z: -130, radius: 20, densityMult: 1.1 })
  towerChestSpots.push({ x: -225, y: 0, z: -125 })
  towerChestSpots.push({ x: -225, y: 0, z: -122 })

  buildFillerLocation(scene, register, {
    x: -184, z: -184, w: 9, d: 8, floorColor: 0xd9c9a8, openSide: 'north',
    dressing: [
      { file: 'counter.glb', dx: 0, dz: 2.8, rot: Math.PI }, { file: 'food-bread.glb', dx: -2, dz: -2 },
      { file: 'food-bag.glb', dx: 2, dz: -2 }, { file: 'food-carton.glb', dx: 0, dz: -2.5 },
    ],
  })
  const bakeryRooms = buildRoomExtension(scene, register, {
    x: -184, startZ: -184 + 4, w: 9, roomDepths: [6, 5], floorColor: 0xd9c9a8,
    dressingSets: [EXTRA_ROOM_DRESSING[4], EXTRA_ROOM_DRESSING[0]],
  })
  registerZone({ id: 'bakery', x: -184, z: -184, radius: 14, densityMult: 1.1 })
  towerChestSpots.push({ x: -184, y: 0, z: -181 })
  for (const room of bakeryRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -67, z: -251, w: 9, d: 8, floorColor: 0x3a3630, openSide: 'north',
    dressing: [
      { file: 'campus-bookcase.glb', dx: -3, dz: -2 }, { file: 'campus-bookcase.glb', dx: 3, dz: -2 },
      { file: 'campus-books.glb', dx: 0, dz: -2.5 }, { file: 'counter.glb', dx: 0, dz: 2.8, rot: Math.PI },
    ],
  })
  const comicbookshopRooms = buildRoomExtension(scene, register, {
    x: -67, startZ: -251 + 4, w: 9, roomDepths: [6, 5], floorColor: 0x3a3630,
    dressingSets: [EXTRA_ROOM_DRESSING[3], EXTRA_ROOM_DRESSING[1]],
  })
  registerZone({ id: 'comicbookshop', x: -67, z: -251, radius: 14, densityMult: 1.0 })
  towerChestSpots.push({ x: -67, y: 0, z: -248 })
  for (const room of comicbookshopRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -268, z: 111, w: 9, d: 8, floorColor: 0x2e2a24, openSide: 'north',
    dressing: [
      { file: 'shelf.glb', dx: -3, dz: -2 }, { file: 'shelf.glb', dx: 0, dz: -2 }, { file: 'shelf.glb', dx: 3, dz: -2 },
      { file: 'counter.glb', dx: 0, dz: 2.8, rot: Math.PI },
    ],
  })
  const musicstoreRooms = buildRoomExtension(scene, register, {
    x: -268, startZ: 111 + 4, w: 9, roomDepths: [6, 5], floorColor: 0x2e2a24,
    dressingSets: [EXTRA_ROOM_DRESSING[0], EXTRA_ROOM_DRESSING[2]],
  })
  registerZone({ id: 'musicstore', x: -268, z: 111, radius: 14, densityMult: 1.0 })
  towerChestSpots.push({ x: -268, y: 0, z: 114 })
  for (const room of musicstoreRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: 230, z: -177, w: 7, d: 6, floorColor: 0x3a362c, openSide: 'north',
    dressing: [
      { file: 'counter.glb', dx: 0, dz: 2, rot: Math.PI }, { file: 'tool-hammer.glb', dx: -1.5, dz: -1.5 },
      { file: 'tool-crowbar.glb', dx: 1.5, dz: -1.5 },
    ],
  })
  const locksmithRooms = buildRoomExtension(scene, register, {
    x: 230, startZ: -177 + 3, w: 7, roomDepths: [5, 4], floorColor: 0x3a362c,
    dressingSets: [EXTRA_ROOM_DRESSING[1], EXTRA_ROOM_DRESSING[3]],
  })
  registerZone({ id: 'locksmith', x: 230, z: -177, radius: 11, densityMult: 1.0 })
  towerChestSpots.push({ x: 230, y: 0, z: -174 })
  for (const room of locksmithRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -302, z: 40, w: 26, d: 20, fenceOnly: true,
    dressing: [
      { file: 'dumpster.glb', dx: -5, dz: -3 }, { file: 'dumpster.glb', dx: 5, dz: -3 }, { file: 'dumpster.glb', dx: 0, dz: 4 },
      { file: 'trashbin.glb', dx: -6, dz: 3 }, { file: 'trashbin.glb', dx: 6, dz: 3 },
      { file: 'cabledrum.glb', dx: -3, dz: 5 }, { file: 'cabledrum.glb', dx: 3, dz: 5 },
      { file: 'dumpster.glb', dx: -8, dz: 8 }, { file: 'cabledrum.glb', dx: 8, dz: 8 },
    ],
  })
  registerZone({ id: 'recyclingcenter', x: -302, z: 40, radius: 18, densityMult: 1.1 })
  towerChestSpots.push({ x: -302, y: 0, z: 44 })
  towerChestSpots.push({ x: -302, y: 0, z: 48 })

  // Storage Unit Facility - a small fenced yard of "container" shapes
  // (cabledrum/dumpster stand in for storage containers - no dedicated
  // container model exists) rather than the lockedCells mechanism (would
  // need a Game.js-side array entry per unit, a bigger scope increase than
  // this batch's other 29 pure loot/flavor stops).
  buildFillerLocation(scene, register, {
    x: -242, z: -186, w: 22, d: 14, fenceOnly: true,
    dressing: [
      { file: 'dumpster.glb', dx: -6, dz: -2 }, { file: 'dumpster.glb', dx: -2, dz: -2 }, { file: 'dumpster.glb', dx: 2, dz: -2 }, { file: 'dumpster.glb', dx: 6, dz: -2 },
      { file: 'cabledrum.glb', dx: -4, dz: 2 }, { file: 'cabledrum.glb', dx: 4, dz: 2 },
      { file: 'dumpster.glb', dx: -8, dz: 4 }, { file: 'dumpster.glb', dx: 8, dz: 4 }, { file: 'cabledrum.glb', dx: 0, dz: 5 },
    ],
  })
  registerZone({ id: 'storageunits', x: -242, z: -186, radius: 15, densityMult: 1.0 })
  towerChestSpots.push({ x: -242, y: 0, z: -183 })
  towerChestSpots.push({ x: -242, y: 0, z: -180 })

  // Water Tower + Grain Silo - visual landmarks (tall cylinder, not
  // climbable - the existing fire-escape/watchtower climbing pattern would
  // need its own ground-height verification pass per structure, out of
  // scope for this batch of 30 pure loot/flavor stops) with a small fenced
  // dressing yard at the base.
  buildFillerLocation(scene, register, {
    x: 320, z: 0, w: 16, d: 16, fenceOnly: true,
    dressing: [
      { file: 'waterbarrel.glb', dx: -3, dz: 3 }, { file: 'waterbarrel.glb', dx: 3, dz: 3 },
      { file: 'barrel.glb', dx: -6, dz: -5 }, { file: 'barrel.glb', dx: 6, dz: -5 }, { file: 'cabledrum.glb', dx: 0, dz: -6 },
    ],
  })
  {
    const towerMat = cachedFlatMaterial({ color: 0x8a9098, roughness: 0.8, metalness: 0.3 })
    const legMat = cachedFlatMaterial({ color: 0x3a3a38, roughness: 0.7, metalness: 0.5 })
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 5, 16), towerMat)
    tank.position.set(320, 11, 0)
    tank.castShadow = true
    scene.add(tank)
    register(tank)
    for (const [lx, lz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 8.5, 8), legMat)
      leg.position.set(320 + lx, 4.25, lz)
      leg.castShadow = true
      scene.add(leg)
      register(leg)
    }
  }
  registerZone({ id: 'watertower', x: 320, z: 0, radius: 12, densityMult: 1.0 })
  towerChestSpots.push({ x: 320, y: 0, z: 4 })
  towerChestSpots.push({ x: 320, y: 0, z: -6 })
  // Interactive World batch - clear of the tower's 4 legs (at +-3,+-3) and
  // both chest spots above.
  const waterTowerValve = buildWaterTowerValve(scene, 320 + 3.6, 0)

  buildFillerLocation(scene, register, {
    x: -83, z: -309, w: 16, d: 16, fenceOnly: true,
    dressing: [
      { file: 'barrel.glb', dx: -3, dz: 3 }, { file: 'barrel.glb', dx: 3, dz: 3 },
      { file: 'cabledrum.glb', dx: -6, dz: -5 }, { file: 'cabledrum.glb', dx: 6, dz: -5 },
    ],
  })
  {
    const siloMat = cachedFlatMaterial({ color: 0xc9c3b0, roughness: 0.85, metalness: 0.15 })
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 12, 16), siloMat)
    silo.position.set(-83, 6, -309)
    silo.castShadow = true
    scene.add(silo)
    register(silo)
    const capMat = cachedFlatMaterial({ color: 0x6b5a48, roughness: 0.9 })
    const cap = new THREE.Mesh(new THREE.ConeGeometry(3.1, 2, 16), capMat)
    cap.position.set(-83, 13, -309)
    cap.castShadow = true
    scene.add(cap)
    register(cap)
  }
  registerZone({ id: 'grainsilo', x: -83, z: -309, radius: 12, densityMult: 1.0 })
  towerChestSpots.push({ x: -83, y: 0, z: -305 })
  towerChestSpots.push({ x: -83, y: 0, z: -315 })

  buildFillerLocation(scene, register, {
    x: 87, z: 324, w: 26, d: 22, fenceOnly: true,
    dressing: [
      { file: 'roadblock.glb', dx: -6, dz: -5 }, { file: 'roadblock.glb', dx: 6, dz: -5 },
      { file: 'trafficcone.glb', dx: -3, dz: 4 }, { file: 'trafficcone.glb', dx: 0, dz: 5 }, { file: 'trafficcone.glb', dx: 3, dz: 4 },
      { file: 'cabledrum.glb', dx: -7, dz: 4 }, { file: 'cabledrum.glb', dx: 7, dz: 4 },
      { file: 'roadblock.glb', dx: -10, dz: 8 }, { file: 'cabledrum.glb', dx: 10, dz: 8 },
    ],
  })
  registerZone({ id: 'constructionsite', x: 87, z: 324, radius: 18, densityMult: 1.1 })
  towerChestSpots.push({ x: 87, y: 0, z: 328 })
  towerChestSpots.push({ x: 87, y: 0, z: 332 })

  buildFillerLocation(scene, register, {
    x: -87, z: 324, w: 28, d: 20, fenceOnly: true,
    dressing: [
      { file: 'cabledrum.glb', dx: -7, dz: -3 }, { file: 'cabledrum.glb', dx: 0, dz: -3 }, { file: 'cabledrum.glb', dx: 7, dz: -3 },
      { file: 'dumpster.glb', dx: -5, dz: 4 }, { file: 'dumpster.glb', dx: 5, dz: 4 },
      { file: 'barrel.glb', dx: 0, dz: 5 }, { file: 'dumpster.glb', dx: -10, dz: 7 }, { file: 'cabledrum.glb', dx: 10, dz: 7 },
    ],
  })
  registerZone({ id: 'railyard', x: -87, z: 324, radius: 18, densityMult: 1.1 })
  towerChestSpots.push({ x: -87, y: 0, z: 328 })
  towerChestSpots.push({ x: -87, y: 0, z: 332 })

  buildFillerLocation(scene, register, {
    x: 87, z: -324, w: 8, d: 7, floorColor: 0xf0d8e0, openSide: 'north',
    dressing: [
      { file: 'counter.glb', dx: 0, dz: 2, rot: Math.PI }, { file: 'waiting-chair.glb', dx: -2, dz: -1.5 }, { file: 'waiting-chair.glb', dx: 2, dz: -1.5 },
    ],
  })
  const icecreamparlorRooms = buildRoomExtension(scene, register, {
    x: 87, startZ: -324 + 3.5, w: 8, roomDepths: [5, 5, 4], floorColor: 0xf0d8e0,
    dressingSets: [EXTRA_ROOM_DRESSING[2], EXTRA_ROOM_DRESSING[0], EXTRA_ROOM_DRESSING[4]],
  })
  registerZone({ id: 'icecreamparlor', x: 87, z: -324, radius: 16, densityMult: 1.0 })
  towerChestSpots.push({ x: 87, y: 0, z: -321 })
  for (const room of icecreamparlorRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -350, z: 0, w: 22, d: 22, fenceOnly: true,
    dressing: [
      { file: 'trafficcone.glb', dx: -5, dz: -5 }, { file: 'trafficcone.glb', dx: 5, dz: -5 },
      { file: 'trafficcone.glb', dx: -5, dz: 5 }, { file: 'trafficcone.glb', dx: 5, dz: 5 },
      { file: 'roadblock.glb', dx: 0, dz: 0 }, { file: 'trafficcone.glb', dx: 0, dz: -8 }, { file: 'trafficcone.glb', dx: 0, dz: 8 },
    ],
  })
  registerZone({ id: 'skatepark', x: -350, z: 0, radius: 16, densityMult: 1.0 })
  towerChestSpots.push({ x: -350, y: 0, z: 4 })
  towerChestSpots.push({ x: -350, y: 0, z: -8 })

  buildFillerLocation(scene, register, {
    x: 140, z: 337, w: 26, d: 20, fenceOnly: true,
    dressing: [
      { file: 'bench.glb', dx: -6, dz: -5 }, { file: 'bench.glb', dx: 6, dz: -5 }, { file: 'bench.glb', dx: 0, dz: 5 },
      { file: 'waterbarrel.glb', dx: -6, dz: 5 }, { file: 'waterbarrel.glb', dx: 6, dz: 5 },
      { file: 'bench.glb', dx: -9, dz: 7 }, { file: 'bench.glb', dx: 9, dz: 7 },
    ],
  })
  registerZone({ id: 'communitypool', x: 140, z: 337, radius: 18, densityMult: 1.0 })
  towerChestSpots.push({ x: 140, y: 0, z: 341 })
  towerChestSpots.push({ x: 140, y: 0, z: 345 })

  buildFillerLocation(scene, register, {
    x: 48, z: 362, w: 14, d: 12, floorColor: 0xcfe8f0, openSide: 'north',
    dressing: [
      { file: 'bench.glb', dx: -4, dz: -3 }, { file: 'bench.glb', dx: 4, dz: -3 },
      { file: 'waiting-chair.glb', dx: 0, dz: 3 },
    ],
  })
  const icerinkRooms = buildRoomExtension(scene, register, {
    x: 48, startZ: 362 + 6, w: 14, roomDepths: [6, 5], floorColor: 0xcfe8f0,
    dressingSets: [EXTRA_ROOM_DRESSING[2], EXTRA_ROOM_DRESSING[3]],
  })
  registerZone({ id: 'icerink', x: 48, z: 362, radius: 18, densityMult: 1.0 })
  towerChestSpots.push({ x: 48, y: 0, z: 366 })
  for (const room of icerinkRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -48, z: 362, w: 30, d: 22, fenceOnly: true,
    dressing: [
      { file: 'bench.glb', dx: -6, dz: 4 }, { file: 'bench.glb', dx: 0, dz: 4 }, { file: 'bench.glb', dx: 6, dz: 4 },
      { file: 'trafficcone.glb', dx: -8, dz: -6 }, { file: 'trafficcone.glb', dx: 8, dz: -6 },
      { file: 'bench.glb', dx: -10, dz: 8 }, { file: 'bench.glb', dx: 10, dz: 8 },
    ],
  })
  {
    const screenMat = cachedFlatMaterial({ color: 0x1e2226, roughness: 0.9 })
    const screen = new THREE.Mesh(new THREE.BoxGeometry(9, 6, 0.3), screenMat)
    screen.position.set(-48, 3, 362 - 7)
    screen.castShadow = true
    scene.add(screen)
    register(screen)
  }
  registerZone({ id: 'driveintheater', x: -48, z: 362, radius: 19, densityMult: 1.1 })
  towerChestSpots.push({ x: -48, y: 0, z: 366 })
  towerChestSpots.push({ x: -48, y: 0, z: 370 })

  buildFillerLocation(scene, register, {
    x: -140, z: 337, w: 14, d: 10, floorColor: 0x6b5540, openSide: 'north',
    dressing: [
      { file: 'waterbarrel.glb', dx: -4, dz: -2 }, { file: 'waterbarrel.glb', dx: 4, dz: -2 },
      { file: 'barrel.glb', dx: -4, dz: 2 }, { file: 'barrel.glb', dx: 4, dz: 2 },
    ],
  })
  const horsestablesRooms = buildRoomExtension(scene, register, {
    x: -140, startZ: 337 + 5, w: 14, roomDepths: [6, 5], floorColor: 0x6b5540,
    dressingSets: [EXTRA_ROOM_DRESSING[4], EXTRA_ROOM_DRESSING[0]],
  })
  registerZone({ id: 'horsestables', x: -140, z: 337, radius: 16, densityMult: 1.0 })
  towerChestSpots.push({ x: -140, y: 0, z: 340 })
  for (const room of horsestablesRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -353, z: 94, w: 8, d: 7, floorColor: 0xd8d8d0, openSide: 'north',
    dressing: [
      { file: 'hospital-bed.glb', dx: -1.5, dz: -1.5 }, { file: 'medical-cabinet.glb', dx: 3, dz: -2, rot: -Math.PI / 2 },
      { file: 'counter.glb', dx: 0, dz: 2, rot: Math.PI },
    ],
  })
  const veterinaryclinicRooms = buildRoomExtension(scene, register, {
    x: -353, startZ: 94 + 3.5, w: 8, roomDepths: [6], floorColor: 0xd8d8d0,
    dressingSets: [EXTRA_ROOM_DRESSING[0]],
  })
  registerZone({ id: 'veterinaryclinic', x: -353, z: 94, radius: 10, densityMult: 1.2 })
  towerChestSpots.push({ x: -353, y: 0, z: 97, lootWeights: MEDICAL_LOOT_WEIGHTS })
  for (const room of veterinaryclinicRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z, lootWeights: MEDICAL_LOOT_WEIGHTS })

  buildFillerLocation(scene, register, {
    x: -140, z: -337, w: 8, d: 7, floorColor: 0x2a2624, openSide: 'north',
    dressing: [
      { file: 'counter.glb', dx: 0, dz: 2, rot: Math.PI }, { file: 'waiting-chair.glb', dx: -2, dz: -1 }, { file: 'waiting-chair.glb', dx: 2, dz: -1 },
    ],
  })
  const tattooparlorRooms = buildRoomExtension(scene, register, {
    x: -140, startZ: -337 + 3.5, w: 8, roomDepths: [6, 5], floorColor: 0x2a2624,
    dressingSets: [EXTRA_ROOM_DRESSING[2], EXTRA_ROOM_DRESSING[3]],
  })
  registerZone({ id: 'tattooparlor', x: -140, z: -337, radius: 12, densityMult: 1.0 })
  towerChestSpots.push({ x: -140, y: 0, z: -334 })
  for (const room of tattooparlorRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -48, z: -362, w: 8, d: 7, floorColor: 0x3a3630, openSide: 'north',
    dressing: [
      { file: 'shelf.glb', dx: -3, dz: -1.5 }, { file: 'shelf.glb', dx: 3, dz: -1.5 }, { file: 'counter.glb', dx: 0, dz: 2, rot: Math.PI },
    ],
  })
  const fitnessstoreRooms = buildRoomExtension(scene, register, {
    x: -48, startZ: -362 + 3.5, w: 8, roomDepths: [5, 5, 4], floorColor: 0x3a3630,
    dressingSets: [EXTRA_ROOM_DRESSING[3], EXTRA_ROOM_DRESSING[2], EXTRA_ROOM_DRESSING[1]],
  })
  registerZone({ id: 'fitnessstore', x: -48, z: -362, radius: 15, densityMult: 1.0 })
  towerChestSpots.push({ x: -48, y: 0, z: -359 })
  for (const room of fitnessstoreRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: 48, z: -362, w: 20, d: 18, fenceOnly: true,
    dressing: [
      { file: 'waterbarrel.glb', dx: -4, dz: -3 }, { file: 'waterbarrel.glb', dx: 4, dz: -3 },
      { file: 'barrel.glb', dx: -4, dz: 3 }, { file: 'barrel.glb', dx: 4, dz: 3 },
      { file: 'waterbarrel.glb', dx: -7, dz: 6 }, { file: 'barrel.glb', dx: 7, dz: 6 },
    ],
  })
  registerZone({ id: 'communitygarden', x: 48, z: -362, radius: 15, densityMult: 1.0 })
  towerChestSpots.push({ x: 48, y: 0, z: -358 })
  towerChestSpots.push({ x: 48, y: 0, z: -354 })

  buildFillerLocation(scene, register, {
    x: 140, z: -337, w: 9, d: 8, floorColor: 0x4a3a3e, openSide: 'north',
    dressing: [
      { file: 'waiting-chair.glb', dx: -3, dz: -2 }, { file: 'waiting-chair.glb', dx: 0, dz: -2 }, { file: 'waiting-chair.glb', dx: 3, dz: -2 },
      { file: 'counter.glb', dx: 0, dz: 2.8, rot: Math.PI },
    ],
  })
  const beautyschoolRooms = buildRoomExtension(scene, register, {
    x: 140, startZ: -337 + 4, w: 9, roomDepths: [6, 5], floorColor: 0x4a3a3e,
    dressingSets: [EXTRA_ROOM_DRESSING[2], EXTRA_ROOM_DRESSING[0]],
  })
  registerZone({ id: 'beautyschool', x: 140, z: -337, radius: 14, densityMult: 1.0 })
  towerChestSpots.push({ x: 140, y: 0, z: -333 })
  for (const room of beautyschoolRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -130, z: -90, w: 8, d: 7, floorColor: 0x2e2a3a, openSide: 'north',
    dressing: [
      { file: 'shelf.glb', dx: -3, dz: -1.5 }, { file: 'shelf.glb', dx: 0, dz: -1.5 }, { file: 'shelf.glb', dx: 3, dz: -1.5 },
      { file: 'counter.glb', dx: 0, dz: 2, rot: Math.PI },
    ],
  })
  const movierentalRooms = buildRoomExtension(scene, register, {
    x: -130, startZ: -90 + 3.5, w: 8, roomDepths: [6, 5], floorColor: 0x2e2a3a,
    dressingSets: [EXTRA_ROOM_DRESSING[3], EXTRA_ROOM_DRESSING[1]],
  })
  registerZone({ id: 'movierental', x: -130, z: -90, radius: 12, densityMult: 1.0 })
  towerChestSpots.push({ x: -130, y: 0, z: -87 })
  for (const room of movierentalRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  // 20 small atmosphere/utility additions filling the empty ring around
  // the safe zone + core street grid, user-flagged from the map atlas,
  // 2026-07-27. Deliberately smaller-scale than the 30-location batch
  // above (prop clusters and small landmarks, not walk-in rooms) - this is
  // "home base surroundings" dressing, not new named destinations. Only
  // about a third get a chest; the rest are pure atmosphere, matching how
  // they were originally described.
  const sandbagMat = cachedFlatMaterial({ color: 0x5a5138, roughness: 1 })

  // Campfire Rest Area (42,66) - stacked-log campfire + a flickering light,
  // matching the flicker-light pattern already used for streetlamps.
  {
    const logMat = cachedFlatMaterial({ color: 0x3a2a1c, roughness: 0.9 })
    for (const rot of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.6, 8), logMat)
      log.rotation.z = Math.PI / 2
      log.rotation.y = rot
      log.position.set(42, 0.2, 66)
      log.castShadow = true
      scene.add(log)
    }
    const fireLight = new THREE.PointLight(0xff8a3a, 1.2, 8, 2)
    fireLight.position.set(42, 0.6, 66)
    scene.add(fireLight)
    placePropSimple(scene, register, 'bench.glb', 42 - 2.5, 66, Math.PI / 2)
    placePropSimple(scene, register, 'bench.glb', 42 + 2.5, 66, -Math.PI / 2)
  }
  registerZone({ id: 'campfirerest', x: 42, z: 66, radius: 6, densityMult: 0.8 })

  // Survivor Memorial Wall - relocated to flank the core street grid
  // (was 24,84, too clustered south of the safe zone - see the
  // north-of-core-grid rebalance note below).
  {
    const wallMat = cachedFlatMaterial({ color: 0x4a4842, roughness: 1 })
    const wall = new THREE.Mesh(new THREE.BoxGeometry(5, 1.6, 0.3), wallMat)
    wall.position.set(-58, 0.8, -56)
    wall.castShadow = true
    scene.add(wall)
    register(wall)
  }
  registerZone({ id: 'memorialwall', x: -58, z: -56, radius: 5, densityMult: 0.8 })

  // Notice Board (0,90) - board on two posts, pure lore, no chest.
  {
    const postMat = cachedFlatMaterial({ color: 0x3a3226, roughness: 0.9 })
    const boardMat = cachedFlatMaterial({ color: 0x6b5a42, roughness: 0.85 })
    for (const dx of [-0.9, 0.9]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.9, 0.15), postMat)
      post.position.set(dx, 0.95, 90)
      post.castShadow = true
      scene.add(post)
      register(post)
    }
    const board = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 0.08), boardMat)
    board.position.set(0, 1.5, 90)
    board.castShadow = true
    scene.add(board)
    register(board)
  }
  registerZone({ id: 'noticeboard', x: 0, z: 90, radius: 4, densityMult: 0.8 })

  // Water Well (-24,84) - stone rim + small roof, utility flavor, no chest.
  {
    const stoneMat = cachedFlatMaterial({ color: 0x6a6a62, roughness: 0.9 })
    const roofMat = cachedFlatMaterial({ color: 0x4a3a2c, roughness: 0.85 })
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1, 16), stoneMat)
    rim.position.set(-24, 0.5, 84)
    rim.castShadow = true
    scene.add(rim)
    register(rim)
    for (const dx of [-0.9, 0.9]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.8, 8), roofMat)
      post.position.set(-24 + dx, 1.9, 84)
      post.castShadow = true
      scene.add(post)
      register(post)
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.8, 4), roofMat)
    roof.position.set(-24, 3, 84)
    roof.rotation.y = Math.PI / 4
    roof.castShadow = true
    scene.add(roof)
    register(roof)
  }
  registerZone({ id: 'waterwell', x: -24, z: 84, radius: 4, densityMult: 0.8 })

  // Supply Cache Tent (-42,66) - canvas-look tent + crates, gets a chest.
  buildFillerLocation(scene, register, {
    x: -42, z: 66, w: 8, d: 7, fenceOnly: true,
    dressing: [
      { file: 'barrel.glb', dx: -2.5, dz: -2 }, { file: 'cabledrum.glb', dx: 2.5, dz: -2 },
    ],
  })
  {
    const tentMat = cachedFlatMaterial({ color: 0x4a5238, roughness: 0.9 })
    const tent = new THREE.Mesh(new THREE.ConeGeometry(2.6, 2.2, 4), tentMat)
    tent.position.set(-42, 1.1, 66 + 1.5)
    tent.rotation.y = Math.PI / 4
    tent.castShadow = true
    scene.add(tent)
    register(tent)
  }
  registerZone({ id: 'supplycache', x: -42, z: 66, radius: 5, densityMult: 1.0 })
  towerChestSpots.push({ x: -42, y: 0, z: 63 })

  // Chicken Coop (60,42) - small wooden pen, homestead flavor, no chest.
  buildFillerLocation(scene, register, {
    x: 60, z: 42, w: 5, d: 4, wallHeight: 1.4, floorColor: 0x8a7a5c, doorWidth: 1,
    wallColor: 0x5a4a34,
  })
  registerZone({ id: 'chickencoop', x: 60, z: 42, radius: 4, densityMult: 0.8 })

  // Perimeter Checkpoint Gate (-60,47) - sandbag barrier, atmosphere, no chest.
  {
    for (const dx of [-2.5, 2.5]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.9), sandbagMat)
      wall.position.set(-60 + dx, 0.45, 47)
      wall.castShadow = true
      scene.add(wall)
      register(wall)
    }
    placePropSimple(scene, register, 'roadblock.glb', -60, 47 - 1.5, 0)
  }
  registerZone({ id: 'checkpointgate', x: -60, z: 47, radius: 5, densityMult: 1.0 })

  // Burial Mounds - relocated to flank the core street grid (was 47,89).
  {
    const moundMat = cachedFlatMaterial({ color: 0x4a3a2a, roughness: 1 })
    const crossMat = cachedFlatMaterial({ color: 0x6b5a42, roughness: 0.9 })
    for (let i = 0; i < 4; i++) {
      const mx = 58 + (i - 1.5) * 1.8
      const mound = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 0.35, 10), moundMat)
      mound.position.set(mx, 0.18, -17)
      mound.castShadow = true
      scene.add(mound)
      register(mound)
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), crossMat)
      cross.position.set(mx, 0.55, -17 - 0.9)
      scene.add(cross)
      const crossBar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.08), crossMat)
      crossBar.position.set(mx, 0.7, -17 - 0.9)
      scene.add(crossBar)
    }
  }
  registerZone({ id: 'burialmounds', x: 58, z: -17, radius: 5, densityMult: 0.7 })

  // Rainwater Collection Tank - relocated to flank the core street grid
  // (was 17,106).
  {
    const tankMat = cachedFlatMaterial({ color: 0x7a8288, roughness: 0.7, metalness: 0.4 })
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 2.4, 16), tankMat)
    tank.position.set(-57, 1.2, -31)
    tank.castShadow = true
    scene.add(tank)
    register(tank)
  }
  registerZone({ id: 'rainwatertank', x: -57, z: -31, radius: 4, densityMult: 0.8 })

  // Motorpool - relocated to flank the core street grid (was -17,106). A
  // few abandoned civilian cars, gets a small salvage chest. Box
  // proportions match Vehicle.js's own body, same precedent as the
  // parking garage's static "abandoned car" props.
  {
    const carMat = cachedFlatMaterial({ color: 0x5a3a3a, roughness: 0.6, metalness: 0.3 })
    const carMat2 = cachedFlatMaterial({ color: 0x3a4a5a, roughness: 0.6, metalness: 0.3 })
    const car1 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 3.6), carMat)
    car1.position.set(-2 - 2.5, 0.6, -65)
    car1.castShadow = true
    scene.add(car1)
    register(car1)
    const car2 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 3.6), carMat2)
    car2.position.set(-2 + 2.5, 0.6, -65 + 1)
    car2.rotation.y = 0.2
    car2.castShadow = true
    scene.add(car2)
    register(car2)
    placePropSimple(scene, register, 'roadblock.glb', -2, -65 - 3, 0)
  }
  registerZone({ id: 'motorpool', x: -2, z: -65, radius: 6, densityMult: 1.0 })
  towerChestSpots.push({ x: -2, y: 0, z: -62 })

  // Picnic Area - relocated to flank the core street grid (was -47,89).
  {
    placePropSimple(scene, register, 'campus-table.glb', -75, 5, 0, 0.9)
    placePropSimple(scene, register, 'bench.glb', -75 - 2, 5, Math.PI / 2)
    placePropSimple(scene, register, 'bench.glb', -75 + 2, 5, -Math.PI / 2)
  }
  registerZone({ id: 'picnicarea', x: -75, z: 5, radius: 4, densityMult: 0.7 })

  // Lookout Post (-62,19) - small raised platform, gets a small chest.
  {
    const legMat = cachedFlatMaterial({ color: 0x4a3a2a, roughness: 0.9 })
    const deckMat = cachedFlatMaterial({ color: 0x5a4632, roughness: 0.85 })
    for (const [lx, lz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.2, 0.25), legMat)
      leg.position.set(-62 + lx, 1.6, 19 + lz)
      leg.castShadow = true
      scene.add(leg)
      register(leg)
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.2, 3.2), deckMat)
    deck.position.set(-62, 3.2, 19)
    deck.castShadow = true
    scene.add(deck)
    register(deck)
  }
  registerZone({ id: 'lookoutpost', x: -62, z: 19, radius: 4, densityMult: 1.0 })
  towerChestSpots.push({ x: -62, y: 3.3, z: 19 })

  // Outdoor Shooting Range (60,14) - sandbag firing line + simple target
  // props, gets a small ammo-flavored chest.
  {
    for (const dx of [-2, 2]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 0.7), sandbagMat)
      wall.position.set(60 + dx, 0.35, 14 - 3)
      wall.castShadow = true
      scene.add(wall)
      register(wall)
    }
    const targetMat = cachedFlatMaterial({ color: 0xc9c3b0, roughness: 0.8 })
    for (const dx of [-3, 0, 3]) {
      const target = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.08), targetMat)
      target.position.set(60 + dx, 0.9, 14 + 4)
      scene.add(target)
      register(target)
    }
  }
  registerZone({ id: 'shootingrange', x: 60, z: 14, radius: 6, densityMult: 1.0 })
  towerChestSpots.push({ x: 60, y: 0, z: 10 })

  // Laundry Line (68,67) - simple post-and-line detail, pure atmosphere, no chest.
  {
    const postMat = cachedFlatMaterial({ color: 0x4a4a48, roughness: 0.8, metalness: 0.3 })
    const clothMat = cachedFlatMaterial({ color: 0xd8d0c0, roughness: 0.95 })
    for (const dx of [-2.5, 2.5]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2, 6), postMat)
      post.position.set(68 + dx, 1, 67)
      post.castShadow = true
      scene.add(post)
      register(post)
    }
    for (let i = 0; i < 3; i++) {
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), clothMat)
      cloth.position.set(68 - 1.5 + i * 1.5, 1.6, 67)
      scene.add(cloth)
    }
  }
  registerZone({ id: 'laundryline', x: 68, z: 67, radius: 4, densityMult: 0.7 })

  // Toolshed - relocated to flank the core street grid (was -65,72). Tiny
  // room, gets a small chest.
  buildFillerLocation(scene, register, {
    x: 80, z: 0, w: 6, d: 5, wallHeight: 2.2, floorColor: 0x5a4a38, doorWidth: 1.4,
    dressing: [
      { file: 'tool-hammer.glb', dx: -1.5, dz: -1 }, { file: 'tool-crowbar.glb', dx: 1.5, dz: -1 },
    ],
  })
  registerZone({ id: 'toolshed', x: 80, z: 0, radius: 5, densityMult: 1.0 })
  towerChestSpots.push({ x: 80, y: 0, z: 3 })

  // Radio Relay Mast (-60,-8) - thin utility antenna, no chest.
  {
    const baseMat = cachedFlatMaterial({ color: 0x3a3a38, roughness: 0.8, metalness: 0.4 })
    const mastMat = cachedFlatMaterial({ color: 0x8a8a86, roughness: 0.6, metalness: 0.6 })
    const base = new THREE.Mesh(new THREE.BoxGeometry(1, 0.6, 1), baseMat)
    base.position.set(-60, 0.3, -8)
    base.castShadow = true
    scene.add(base)
    register(base)
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 7, 8), mastMat)
    mast.position.set(-60, 4.1, -8)
    mast.castShadow = true
    scene.add(mast)
    register(mast)
  }
  registerZone({ id: 'radiomast', x: -60, z: -8, radius: 4, densityMult: 0.7 })

  // Prayer Shrine (84,42) - small quiet altar, pure atmosphere, no chest.
  {
    const baseMat = cachedFlatMaterial({ color: 0x8a8278, roughness: 0.9 })
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 1), baseMat)
    base.position.set(84, 0.3, 42)
    base.castShadow = true
    scene.add(base)
    register(base)
    const marker = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), baseMat)
    marker.position.set(84, 1, 42)
    scene.add(marker)
    const markerBar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.1), baseMat)
    markerBar.position.set(84, 1.2, 42)
    scene.add(markerBar)
  }
  registerZone({ id: 'prayershrine', x: 84, z: 42, radius: 4, densityMult: 0.7 })

  // Rubble Barricade - relocated to flank the core street grid (was 42,115).
  {
    const rubbleMat = cachedFlatMaterial({ color: 0x4a4642, roughness: 1 })
    for (const [dx, dz, w, h, d] of [[-1.5, 0, 1.4, 1, 1.2], [0.5, 0.3, 1.8, 1.3, 1], [2, -0.4, 1.2, 0.8, 1.4]]) {
      const chunk = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rubbleMat)
      chunk.position.set(-28 + dx, h / 2, -70 + dz)
      chunk.rotation.y = Math.random() * 0.5
      chunk.castShadow = true
      scene.add(chunk)
      register(chunk)
    }
    placePropSimple(scene, register, 'roadblock.glb', -28 - 3, -70, Math.PI / 2)
  }
  registerZone({ id: 'rubblebarricade', x: -28, z: -70, radius: 5, densityMult: 1.0 })

  // Scavenger's Trade Post - relocated to flank the core street grid (was
  // 0,126). A second, smaller trader stall, reusing the existing
  // traderstall.glb prop directly (purely decorative here, not wired to
  // the real trader mechanic - that stays the safe zone's own single
  // trader). Gets a small chest.
  buildFillerLocation(scene, register, {
    x: 23, z: -71, w: 6, d: 5, fenceOnly: true,
    dressing: [{ file: 'traderstall.glb', dx: 0, dz: 0 }, { file: 'barrel.glb', dx: 2, dz: 1.5 }],
  })
  registerZone({ id: 'scavengertradepost', x: 23, z: -71, radius: 5, densityMult: 1.0 })
  towerChestSpots.push({ x: 23, y: 0, z: -74 })

  // Sandbag Sniper Nest - relocated to flank the core street grid (was
  // -42,115). Stacked sandbag semi-circle + small platform, gets a small
  // ammo chest.
  {
    for (const [dx, dz] of [[-1.4, 0.6], [0, 0.9], [1.4, 0.6], [-0.8, -0.6], [0.8, -0.6]]) {
      const bag = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.5, 0.55), sandbagMat)
      bag.position.set(61 + dx, 0.25, -44 + dz)
      bag.castShadow = true
      scene.add(bag)
      register(bag)
    }
  }
  registerZone({ id: 'snipernest', x: 61, z: -44, radius: 4, densityMult: 1.0 })
  towerChestSpots.push({ x: 61, y: 0, z: -41 })

  // 50 more locations, user-requested batch, 2026-07-27 - deliberately
  // spread across the full compass (each one placed along its own target
  // angle before searching outward for real clearance) rather than
  // clustering in whichever direction happened to have the most room,
  // per explicit feedback on the two previous rounds. Same
  // buildFillerLocation() pattern as every other flavor location; a
  // handful of unique landmarks (lighthouse, windmill, wind turbines,
  // wreckage) get their own simple custom geometry, same treatment as
  // Water Tower/Grain Silo earlier this session.
  buildFillerLocation(scene, register, {
    x: 158, z: 0, w: 8, d: 7, floorColor: 0xc94a3a, openSide: 'north',
    dressing: [{ file: 'counter.glb', dx: 0, dz: 2, rot: Math.PI }, { file: 'food-bag.glb', dx: -2, dz: -1.5 }, { file: 'food-bottle.glb', dx: 2, dz: -1.5 }],
  })
  const pizzaparlorRooms = buildRoomExtension(scene, register, {
    x: 158, startZ: 3.5, w: 8, roomDepths: [6, 5], floorColor: 0xc94a3a,
    dressingSets: [EXTRA_ROOM_DRESSING[4], EXTRA_ROOM_DRESSING[0]],
  })
  registerZone({ id: 'pizzaparlor', x: 158, z: 0, radius: 12, densityMult: 1.0 })
  towerChestSpots.push({ x: 158, y: 0, z: 3 })
  for (const room of pizzaparlorRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: 3, z: -158, w: 8, d: 7, floorColor: 0x4a3428, openSide: 'north',
    dressing: [{ file: 'counter.glb', dx: 0, dz: 2, rot: Math.PI }, { file: 'waiting-chair.glb', dx: -2, dz: -1 }, { file: 'food-bottle.glb', dx: 2, dz: -1.5 }],
  })
  const coffeeshopRooms = buildRoomExtension(scene, register, {
    x: 3, startZ: -158 + 3.5, w: 8, roomDepths: [6, 5], floorColor: 0x4a3428,
    dressingSets: [EXTRA_ROOM_DRESSING[2], EXTRA_ROOM_DRESSING[3]],
  })
  registerZone({ id: 'coffeeshop', x: 3, z: -158, radius: 12, densityMult: 1.0 })
  towerChestSpots.push({ x: 3, y: 0, z: -155 })
  for (const room of coffeeshopRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -61, z: -154, w: 8, d: 7, floorColor: 0x2a3a3a, openSide: 'north',
    dressing: [{ file: 'counter.glb', dx: 0, dz: 2, rot: Math.PI }, { file: 'food-can.glb', dx: -2, dz: -1.5 }],
  })
  const sushirestaurantRooms = buildRoomExtension(scene, register, {
    x: -61, startZ: -154 + 3.5, w: 8, roomDepths: [6, 5], floorColor: 0x2a3a3a,
    dressingSets: [EXTRA_ROOM_DRESSING[0], EXTRA_ROOM_DRESSING[4]],
  })
  registerZone({ id: 'sushirestaurant', x: -61, z: -154, radius: 12, densityMult: 1.0 })
  towerChestSpots.push({ x: -61, y: 0, z: -151 })
  for (const room of sushirestaurantRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: 72, z: 193, w: 9, d: 8, floorColor: 0x5a3a28, openSide: 'north',
    dressing: [{ file: 'counter.glb', dx: 0, dz: 2.5, rot: Math.PI }, { file: 'food-bag.glb', dx: -2, dz: -1.5 }, { file: 'barrel.glb', dx: 2.5, dz: -1.5 }],
  })
  const bbqsmokehouseRooms = buildRoomExtension(scene, register, {
    x: 72, startZ: 193 + 4, w: 9, roomDepths: [6, 5], floorColor: 0x5a3a28,
    dressingSets: [EXTRA_ROOM_DRESSING[1], EXTRA_ROOM_DRESSING[4]],
  })
  registerZone({ id: 'bbqsmokehouse', x: 72, z: 193, radius: 12, densityMult: 1.0 })
  towerChestSpots.push({ x: 72, y: 0, z: 197 })
  for (const room of bbqsmokehouseRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -158, z: 3, w: 16, d: 14, fenceOnly: true,
    dressing: [
      { file: 'counter.glb', dx: 0, dz: 0 }, { file: 'trashbin.glb', dx: -3, dz: 2 }, { file: 'trafficcone.glb', dx: 3, dz: 2 },
      { file: 'counter.glb', dx: -6, dz: -4, rot: Math.PI / 2 }, { file: 'trafficcone.glb', dx: 6, dz: -4 },
    ],
  })
  registerZone({ id: 'foodtrucklot', x: -158, z: 3, radius: 12, densityMult: 1.0 })
  towerChestSpots.push({ x: -158, y: 0, z: 7 })
  towerChestSpots.push({ x: -158, y: 0, z: -4 })

  buildFillerLocation(scene, register, {
    x: -106, z: -117, w: 10, d: 9, floorColor: 0x4a3a28, openSide: 'north',
    dressing: [{ file: 'cabledrum.glb', dx: -3, dz: -2 }, { file: 'cabledrum.glb', dx: 3, dz: -2 }, { file: 'counter.glb', dx: 0, dz: 3, rot: Math.PI }],
  })
  const breweryRooms = buildRoomExtension(scene, register, {
    x: -106, startZ: -117 + 4.5, w: 10, roomDepths: [6, 5], floorColor: 0x4a3a28,
    dressingSets: [EXTRA_ROOM_DRESSING[1], EXTRA_ROOM_DRESSING[4]],
  })
  registerZone({ id: 'brewery', x: -106, z: -117, radius: 13, densityMult: 1.0 })
  towerChestSpots.push({ x: -106, y: 0, z: -113 })
  for (const room of breweryRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -68, z: 195, w: 8, d: 7, floorColor: 0x3a4a6a, openSide: 'north',
    dressing: [{ file: 'shelf.glb', dx: -3, dz: -1.5 }, { file: 'shelf.glb', dx: 3, dz: -1.5 }, { file: 'counter.glb', dx: 0, dz: 2, rot: Math.PI }],
  })
  const toystoreRooms = buildRoomExtension(scene, register, {
    x: -68, startZ: 195 + 3.5, w: 8, roomDepths: [6, 5], floorColor: 0x3a4a6a,
    dressingSets: [EXTRA_ROOM_DRESSING[3], EXTRA_ROOM_DRESSING[2]],
  })
  registerZone({ id: 'toystore', x: -68, z: 195, radius: 12, densityMult: 1.0 })
  towerChestSpots.push({ x: -68, y: 0, z: 198 })
  for (const room of toystoreRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: 72, z: -193, w: 9, d: 8, floorColor: 0x3a4a3a, openSide: 'north',
    dressing: [{ file: 'shelf.glb', dx: -3, dz: -1.5 }, { file: 'shelf.glb', dx: 3, dz: -1.5 }, { file: 'counter.glb', dx: 0, dz: 2.5, rot: Math.PI }],
  })
  const sportinggoodsstoreRooms = buildRoomExtension(scene, register, {
    x: 72, startZ: -193 + 4, w: 9, roomDepths: [6, 5], floorColor: 0x3a4a3a,
    dressingSets: [EXTRA_ROOM_DRESSING[0], EXTRA_ROOM_DRESSING[3]],
  })
  registerZone({ id: 'sportinggoodsstore', x: 72, z: -193, radius: 12, densityMult: 1.0 })
  towerChestSpots.push({ x: 72, y: 0, z: -190 })
  for (const room of sportinggoodsstoreRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -153, z: 150, w: 7, d: 6, floorColor: 0x2a2a30, openSide: 'north',
    dressing: [{ file: 'counter.glb', dx: 0, dz: 2, rot: Math.PI }, { file: 'shelf.glb', dx: -2, dz: -1 }],
  })
  const jewelrystoreRooms = buildRoomExtension(scene, register, {
    x: -153, startZ: 150 + 3, w: 7, roomDepths: [5, 4], floorColor: 0x2a2a30,
    dressingSets: [EXTRA_ROOM_DRESSING[1], EXTRA_ROOM_DRESSING[3]],
  })
  registerZone({ id: 'jewelrystore', x: -153, z: 150, radius: 11, densityMult: 1.1 })
  towerChestSpots.push({ x: -153, y: 0, z: 153 })
  for (const room of jewelrystoreRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: 152, z: 162, w: 10, d: 9, floorColor: 0x5a4838, openSide: 'north',
    dressing: [{ file: 'campus-table.glb', dx: -2.5, dz: -2 }, { file: 'campus-table.glb', dx: 2.5, dz: -2 }, { file: 'shelf.glb', dx: 0, dz: 3, rot: Math.PI }],
  })
  const furniturestoreRooms = buildRoomExtension(scene, register, {
    x: 152, startZ: 162 + 4.5, w: 10, roomDepths: [6, 5], floorColor: 0x5a4838,
    dressingSets: [EXTRA_ROOM_DRESSING[2], EXTRA_ROOM_DRESSING[0]],
  })
  registerZone({ id: 'furniturestore', x: 152, z: 162, radius: 13, densityMult: 1.0 })
  towerChestSpots.push({ x: 152, y: 0, z: 166 })
  for (const room of furniturestoreRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -159, z: -143, w: 8, d: 7, floorColor: 0x4a4030, openSide: 'north',
    dressing: [{ file: 'shelf.glb', dx: -3, dz: -1.5 }, { file: 'campus-books.glb', dx: 3, dz: -1.5 }],
  })
  const antiqueshopRooms = buildRoomExtension(scene, register, {
    x: -159, startZ: -143 + 3.5, w: 8, roomDepths: [6, 5], floorColor: 0x4a4030,
    dressingSets: [EXTRA_ROOM_DRESSING[3], EXTRA_ROOM_DRESSING[1]],
  })
  registerZone({ id: 'antiqueshop', x: -159, z: -143, radius: 12, densityMult: 1.0 })
  towerChestSpots.push({ x: -159, y: 0, z: -140 })
  for (const room of antiqueshopRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: 224, z: 53, w: 9, d: 8, floorColor: 0x3a3630, openSide: 'north',
    dressing: [
      { file: 'campus-bookcase.glb', dx: -3, dz: -2 }, { file: 'campus-bookcase.glb', dx: 3, dz: -2 },
      { file: 'campus-books.glb', dx: 0, dz: -2.5 }, { file: 'counter.glb', dx: 0, dz: 2.8, rot: Math.PI },
    ],
  })
  const bookstoreRooms = buildRoomExtension(scene, register, {
    x: 224, startZ: 53 + 4, w: 9, roomDepths: [6, 5], floorColor: 0x3a3630,
    dressingSets: [EXTRA_ROOM_DRESSING[0], EXTRA_ROOM_DRESSING[2]],
  })
  registerZone({ id: 'bookstore', x: 224, z: 53, radius: 12, densityMult: 1.0 })
  towerChestSpots.push({ x: 224, y: 0, z: 57 })
  for (const room of bookstoreRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -211, z: 110, w: 8, d: 7, floorColor: 0x4a3a4a, openSide: 'north',
    dressing: [{ file: 'shelf.glb', dx: -3, dz: -1.5 }, { file: 'shelf.glb', dx: 3, dz: -1.5 }, { file: 'counter.glb', dx: 0, dz: 2, rot: Math.PI }],
  })
  const hobbycraftstoreRooms = buildRoomExtension(scene, register, {
    x: -211, startZ: 110 + 3.5, w: 8, roomDepths: [6, 5], floorColor: 0x4a3a4a,
    dressingSets: [EXTRA_ROOM_DRESSING[4], EXTRA_ROOM_DRESSING[2]],
  })
  registerZone({ id: 'hobbycraftstore', x: -211, z: 110, radius: 12, densityMult: 1.0 })
  towerChestSpots.push({ x: -211, y: 0, z: 113 })
  for (const room of hobbycraftstoreRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -107, z: 204, w: 9, d: 8, floorColor: 0x5a4a3a, openSide: 'north',
    dressing: [{ file: 'shelf.glb', dx: -3, dz: -1.5 }, { file: 'shelf.glb', dx: 3, dz: -1.5 }, { file: 'counter.glb', dx: 0, dz: 2.5, rot: Math.PI }],
  })
  const thriftstoreRooms = buildRoomExtension(scene, register, {
    x: -107, startZ: 204 + 4, w: 9, roomDepths: [6, 5], floorColor: 0x5a4a3a,
    dressingSets: [EXTRA_ROOM_DRESSING[0], EXTRA_ROOM_DRESSING[1]],
  })
  registerZone({ id: 'thriftstore', x: -107, z: 204, radius: 12, densityMult: 1.0 })
  towerChestSpots.push({ x: -107, y: 0, z: 208 })
  for (const room of thriftstoreRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: 111, z: -202, w: 12, d: 10, wallHeight: 5, floorColor: 0x6a6258, openSide: 'north',
    dressing: [{ file: 'counter.glb', dx: 0, dz: 3.5, rot: Math.PI }, { file: 'waiting-chair.glb', dx: -3, dz: -2 }, { file: 'waiting-chair.glb', dx: 3, dz: -2 }],
  })
  const cityhallRooms = buildRoomExtension(scene, register, {
    x: 111, startZ: -202 + 5, w: 12, roomDepths: [6, 5], floorColor: 0x6a6258,
    dressingSets: [EXTRA_ROOM_DRESSING[2], EXTRA_ROOM_DRESSING[3]],
  })
  registerZone({ id: 'cityhall', x: 111, z: -202, radius: 15, densityMult: 1.0 })
  towerChestSpots.push({ x: 111, y: 0, z: -197 })
  for (const room of cityhallRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: 48, z: 225, w: 12, d: 10, wallHeight: 6, floorColor: 0x5a5850, openSide: 'north',
    dressing: [
      { file: 'waiting-chair.glb', dx: -3, dz: -3 }, { file: 'waiting-chair.glb', dx: 0, dz: -3 }, { file: 'waiting-chair.glb', dx: 3, dz: -3 }, { file: 'waiting-chair.glb', dx: 0, dz: 0 },
      { file: 'counter.glb', dx: 0, dz: 3.5, rot: Math.PI },
    ],
  })
  const courthouseRooms = buildRoomExtension(scene, register, {
    x: 48, startZ: 225 + 5, w: 12, roomDepths: [6, 5], floorColor: 0x5a5850,
    dressingSets: [EXTRA_ROOM_DRESSING[0], EXTRA_ROOM_DRESSING[2]],
  })
  registerZone({ id: 'courthouse', x: 48, z: 225, radius: 15, densityMult: 1.0 })
  towerChestSpots.push({ x: 48, y: 0, z: 230 })
  for (const room of courthouseRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -136, z: -195, w: 10, d: 9, floorColor: 0x8a8478, openSide: 'north',
    dressing: [
      { file: 'waiting-chair.glb', dx: -3, dz: -2 }, { file: 'waiting-chair.glb', dx: 0, dz: -2 }, { file: 'waiting-chair.glb', dx: 3, dz: -2 },
      { file: 'counter.glb', dx: 0, dz: 3, rot: Math.PI },
    ],
  })
  const dmvofficeRooms = buildRoomExtension(scene, register, {
    x: -136, startZ: -195 + 4.5, w: 10, roomDepths: [6, 5], floorColor: 0x8a8478,
    dressingSets: [EXTRA_ROOM_DRESSING[3], EXTRA_ROOM_DRESSING[1]],
  })
  registerZone({ id: 'dmvoffice', x: -136, z: -195, radius: 13, densityMult: 1.0 })
  towerChestSpots.push({ x: -136, y: 0, z: -191 })
  for (const room of dmvofficeRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: 59, z: -231, w: 12, d: 10, floorColor: 0x4a4438, openSide: 'north',
    dressing: [{ file: 'campus-table.glb', dx: -3, dz: -2 }, { file: 'campus-table.glb', dx: 3, dz: -2 }, { file: 'campus-bookcase.glb', dx: 0, dz: 3.5 }],
  })
  const communitycollegeRooms = buildRoomExtension(scene, register, {
    x: 59, startZ: -231 + 5, w: 12, roomDepths: [6, 5], floorColor: 0x4a4438,
    dressingSets: [EXTRA_ROOM_DRESSING[2], EXTRA_ROOM_DRESSING[0]],
  })
  registerZone({ id: 'communitycollege', x: 59, z: -231, radius: 15, densityMult: 1.0 })
  towerChestSpots.push({ x: 59, y: 0, z: -226 })
  for (const room of communitycollegeRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: 205, z: 136, w: 12, d: 10, wallHeight: 6, floorColor: 0x3a3830, openSide: 'north',
    dressing: [{ file: 'campus-table.glb', dx: 0, dz: -2 }, { file: 'campus-books.glb', dx: -3, dz: 2 }, { file: 'campus-books.glb', dx: 3, dz: 2 }],
  })
  const museumRooms = buildRoomExtension(scene, register, {
    x: 205, startZ: 136 + 5, w: 12, roomDepths: [6], floorColor: 0x3a3830,
    dressingSets: [EXTRA_ROOM_DRESSING[0]],
  })
  registerZone({ id: 'museum', x: 205, z: 136, radius: 12, densityMult: 1.0 })
  towerChestSpots.push({ x: 205, y: 0, z: 141 })
  for (const room of museumRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -108, z: -230, w: 10, d: 9, floorColor: 0xe8e4d8, openSide: 'north',
    dressing: [{ file: 'campus-table.glb', dx: 0, dz: 0 }],
  })
  const artgalleryRooms = buildRoomExtension(scene, register, {
    x: -108, startZ: -230 + 4.5, w: 10, roomDepths: [6, 5], floorColor: 0xe8e4d8,
    dressingSets: [EXTRA_ROOM_DRESSING[2], EXTRA_ROOM_DRESSING[0]],
  })
  registerZone({ id: 'artgallery', x: -108, z: -230, radius: 13, densityMult: 1.0 })
  towerChestSpots.push({ x: -108, y: 0, z: -226 })
  for (const room of artgalleryRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  // Power Plant (-49,233) - reuses the water tower's tank/leg silhouette
  // for a squat cooling-tower look, wider and shorter.
  buildFillerLocation(scene, register, {
    x: -49, z: 233, w: 24, d: 20, fenceOnly: true,
    dressing: [
      { file: 'cabledrum.glb', dx: -5, dz: -4 }, { file: 'cabledrum.glb', dx: 5, dz: -4 },
      { file: 'cabledrum.glb', dx: -9, dz: 7 }, { file: 'cabledrum.glb', dx: 9, dz: 7 }, { file: 'barrel.glb', dx: 0, dz: 8 },
    ],
  })
  {
    const towerMat = cachedFlatMaterial({ color: 0x6a6a68, roughness: 0.85, metalness: 0.2 })
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.2, 8, 16), towerMat)
    tower.position.set(-49, 4, 233)
    tower.castShadow = true
    scene.add(tower)
    register(tower)
  }
  registerZone({ id: 'powerplant', x: -49, z: 233, radius: 16, densityMult: 1.1 })
  towerChestSpots.push({ x: -49, y: 0, z: 238 })
  towerChestSpots.push({ x: -49, y: 0, z: 242 })

  buildFillerLocation(scene, register, {
    x: 51, z: 265, w: 20, d: 18, fenceOnly: true,
    dressing: [
      { file: 'cabledrum.glb', dx: -4, dz: -3 }, { file: 'cabledrum.glb', dx: 4, dz: -3 }, { file: 'barrel.glb', dx: 0, dz: 3 },
      { file: 'cabledrum.glb', dx: -7, dz: 6 }, { file: 'barrel.glb', dx: 7, dz: 6 },
    ],
  })
  registerZone({ id: 'sawmill', x: 51, z: 265, radius: 14, densityMult: 1.1 })
  towerChestSpots.push({ x: 51, y: 0, z: 269 })
  towerChestSpots.push({ x: 51, y: 0, z: 273 })

  buildFillerLocation(scene, register, {
    x: 262, z: 67, w: 12, d: 10, floorColor: 0x4a4038, openSide: 'north',
    dressing: [{ file: 'shelf.glb', dx: -3, dz: -2 }, { file: 'shelf.glb', dx: 0, dz: -2 }, { file: 'shelf.glb', dx: 3, dz: -2 }],
  })
  const textilemillRooms = buildRoomExtension(scene, register, {
    x: 262, startZ: 67 + 5, w: 12, roomDepths: [6, 5], floorColor: 0x4a4038,
    dressingSets: [EXTRA_ROOM_DRESSING[3], EXTRA_ROOM_DRESSING[1]],
  })
  registerZone({ id: 'textilemill', x: 262, z: 67, radius: 15, densityMult: 1.1 })
  towerChestSpots.push({ x: 262, y: 0, z: 71 })
  for (const room of textilemillRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -46, z: 274, w: 22, d: 18, fenceOnly: true,
    dressing: [
      { file: 'dumpster.glb', dx: -5, dz: -3 }, { file: 'dumpster.glb', dx: 5, dz: -3 }, { file: 'cabledrum.glb', dx: 0, dz: 3 },
      { file: 'dumpster.glb', dx: -8, dz: 6 }, { file: 'dumpster.glb', dx: 8, dz: 6 },
    ],
  })
  registerZone({ id: 'coldstoragewarehouse', x: -46, z: 274, radius: 14, densityMult: 1.1 })
  towerChestSpots.push({ x: -46, y: 0, z: 278 })
  towerChestSpots.push({ x: -46, y: 0, z: 282 })

  // Shipping Container Yard (52,-273) - simple stacked box "containers"
  // (no dedicated container model), matching the Motorpool car precedent.
  buildFillerLocation(scene, register, {
    x: 52, z: -273, w: 26, d: 20, fenceOnly: true,
  })
  {
    const c1Mat = cachedFlatMaterial({ color: 0x8a3a3a, roughness: 0.7, metalness: 0.3 })
    const c2Mat = cachedFlatMaterial({ color: 0x3a6a8a, roughness: 0.7, metalness: 0.3 })
    const c3Mat = cachedFlatMaterial({ color: 0x8a7a3a, roughness: 0.7, metalness: 0.3 })
    const c4Mat = cachedFlatMaterial({ color: 0x4a7a4a, roughness: 0.7, metalness: 0.3 })
    const box1 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 6), c1Mat)
    box1.position.set(52 - 5, 1.2, -273)
    box1.castShadow = true
    scene.add(box1)
    register(box1)
    const box2 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 6), c2Mat)
    box2.position.set(52, 1.2, -273 + 1)
    box2.castShadow = true
    scene.add(box2)
    register(box2)
    const box3 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 6), c3Mat)
    box3.position.set(52, 3.7, -273 + 1)
    box3.castShadow = true
    scene.add(box3)
    register(box3)
    const box4 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 6), c4Mat)
    box4.position.set(52 + 8, 1.2, -273 - 2)
    box4.castShadow = true
    scene.add(box4)
    register(box4)
  }
  registerZone({ id: 'shippingcontaineryard', x: 52, z: -273, radius: 16, densityMult: 1.1 })
  towerChestSpots.push({ x: 52, y: 0, z: -268 })
  towerChestSpots.push({ x: 52, y: 0, z: -264 })

  buildFillerLocation(scene, register, {
    x: 195, z: 175, w: 26, d: 24, fenceOnly: true,
  })
  {
    const rockMat = cachedFlatMaterial({ color: 0x6a655c, roughness: 1 })
    for (const [dx, dz, s] of [[-5, -4, 2.2], [4, -3, 1.8], [-2, 4, 2.6], [5, 3, 1.6], [-9, 7, 2], [9, -7, 2.4], [0, 9, 1.7]]) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat)
      rock.position.set(195 + dx, s * 0.5, 175 + dz)
      rock.rotation.set(Math.random(), Math.random(), Math.random())
      rock.castShadow = true
      scene.add(rock)
      register(rock)
    }
  }
  registerZone({ id: 'quarry', x: 195, z: 175, radius: 16, densityMult: 1.1 })
  towerChestSpots.push({ x: 195, y: 0, z: 180 })
  towerChestSpots.push({ x: 195, y: 0, z: 184 })

  // Wind Farm (-263,-91) - 2 simple turbines (thin mast + 3 flat blade planes each).
  buildFillerLocation(scene, register, {
    x: -263, z: -91, w: 20, d: 16, fenceOnly: true,
  })
  {
    const mastMat = cachedFlatMaterial({ color: 0xd8d8d4, roughness: 0.6 })
    const bladeMat = cachedFlatMaterial({ color: 0xe8e8e4, roughness: 0.5 })
    for (const [tx, tz] of [[-263 - 6, -91 - 3], [-263 + 6, -91 + 3]]) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 9, 8), mastMat)
      mast.position.set(tx, 4.5, tz)
      mast.castShadow = true
      scene.add(mast)
      register(mast)
      for (const rot of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.6, 0.4), bladeMat)
        blade.position.set(tx, 9, tz)
        blade.rotation.z = rot
        blade.translateY(1.3)
        scene.add(blade)
      }
    }
  }
  registerZone({ id: 'windfarm', x: -263, z: -91, radius: 13, densityMult: 0.9 })
  towerChestSpots.push({ x: -263, y: 0, z: -95 })

  // Cell Tower (256,127) - same thin-mast pattern as the Radio Relay Mast.
  buildFillerLocation(scene, register, {
    x: 256, z: 127, w: 10, d: 10, fenceOnly: true,
    dressing: [{ file: 'cabledrum.glb', dx: -3, dz: 3 }],
  })
  {
    const baseMat = cachedFlatMaterial({ color: 0x3a3a38, roughness: 0.8, metalness: 0.4 })
    const mastMat = cachedFlatMaterial({ color: 0x8a8a86, roughness: 0.6, metalness: 0.6 })
    const base = new THREE.Mesh(new THREE.BoxGeometry(1, 0.6, 1), baseMat)
    base.position.set(256, 0.3, 127)
    base.castShadow = true
    scene.add(base)
    register(base)
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 9, 8), mastMat)
    mast.position.set(256, 5.1, 127)
    mast.castShadow = true
    scene.add(mast)
    register(mast)
  }
  registerZone({ id: 'celltower', x: 256, z: 127, radius: 7, densityMult: 0.9 })
  towerChestSpots.push({ x: 256, y: 0, z: 131 })

  buildFillerLocation(scene, register, {
    x: -102, z: -276, w: 10, d: 9, floorColor: 0x2a1a3a, openSide: 'north',
    dressing: [{ file: 'counter.glb', dx: 0, dz: 2.5, rot: Math.PI }, { file: 'shelf.glb', dx: -3, dz: -2 }],
  })
  const arcadeRooms = buildRoomExtension(scene, register, {
    x: -102, startZ: -276 + 4.5, w: 10, roomDepths: [6, 5], floorColor: 0x2a1a3a,
    dressingSets: [EXTRA_ROOM_DRESSING[0], EXTRA_ROOM_DRESSING[2]],
  })
  registerZone({ id: 'arcade', x: -102, z: -276, radius: 13, densityMult: 1.0 })
  towerChestSpots.push({ x: -102, y: 0, z: -272 })
  for (const room of arcadeRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -207, z: -220, w: 22, d: 20, fenceOnly: true,
    dressing: [
      { file: 'bench.glb', dx: -5, dz: -4 }, { file: 'bench.glb', dx: 5, dz: -4 },
      { file: 'bench.glb', dx: -8, dz: 7 }, { file: 'trafficcone.glb', dx: 8, dz: 7 },
    ],
  })
  registerZone({ id: 'minigolfcourse', x: -207, z: -220, radius: 15, densityMult: 1.0 })
  towerChestSpots.push({ x: -207, y: 0, z: -216 })
  towerChestSpots.push({ x: -207, y: 0, z: -212 })

  buildFillerLocation(scene, register, {
    x: 197, z: -218, w: 28, d: 22, fenceOnly: true,
    dressing: [
      { file: 'trafficcone.glb', dx: -6, dz: -5 }, { file: 'trafficcone.glb', dx: 6, dz: -5 }, { file: 'roadblock.glb', dx: 0, dz: 5 },
      { file: 'trafficcone.glb', dx: -10, dz: 8 }, { file: 'trafficcone.glb', dx: 10, dz: 8 },
    ],
  })
  registerZone({ id: 'gokarttrack', x: 197, z: -218, radius: 19, densityMult: 1.0 })
  towerChestSpots.push({ x: 197, y: 0, z: -213 })
  towerChestSpots.push({ x: 197, y: 0, z: -209 })

  buildFillerLocation(scene, register, {
    x: -302, z: -6, w: 24, d: 18, fenceOnly: true,
    dressing: [
      { file: 'barrel.glb', dx: -5, dz: -3 }, { file: 'barrel.glb', dx: 5, dz: -3 }, { file: 'barrel.glb', dx: 0, dz: 4 },
      { file: 'barrel.glb', dx: -8, dz: 6 }, { file: 'barrel.glb', dx: 8, dz: 6 },
    ],
  })
  registerZone({ id: 'paintballfield', x: -302, z: -6, radius: 16, densityMult: 1.0 })
  towerChestSpots.push({ x: -302, y: 0, z: -1 })
  towerChestSpots.push({ x: -302, y: 0, z: 3 })

  buildFillerLocation(scene, register, {
    x: -271, z: -134, w: 14, d: 12, wallHeight: 6, floorColor: 0x2a2028, openSide: 'north',
    dressing: [{ file: 'bench.glb', dx: -3, dz: -3 }, { file: 'bench.glb', dx: 3, dz: -3 }, { file: 'bench.glb', dx: 0, dz: 0 }],
  })
  const concerthallRooms = buildRoomExtension(scene, register, {
    x: -271, startZ: -134 + 6, w: 14, roomDepths: [6], floorColor: 0x2a2028,
    dressingSets: [EXTRA_ROOM_DRESSING[2]],
  })
  registerZone({ id: 'concerthall', x: -271, z: -134, radius: 14, densityMult: 1.0 })
  towerChestSpots.push({ x: -271, y: 0, z: -128 })
  for (const room of concerthallRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: 217, z: 221, w: 12, d: 10, floorColor: 0x3a5a8a, openSide: 'north',
    dressing: [{ file: 'bench.glb', dx: -3, dz: -3 }, { file: 'bench.glb', dx: 3, dz: -3 }],
  })
  const trampolineparkRooms = buildRoomExtension(scene, register, {
    x: 217, startZ: 221 + 5, w: 12, roomDepths: [5, 5, 4], floorColor: 0x3a5a8a,
    dressingSets: [EXTRA_ROOM_DRESSING[3], EXTRA_ROOM_DRESSING[2], EXTRA_ROOM_DRESSING[0]],
  })
  registerZone({ id: 'trampolinepark', x: 217, z: 221, radius: 18, densityMult: 1.0 })
  towerChestSpots.push({ x: 217, y: 0, z: 225 })
  for (const room of trampolineparkRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: 272, z: -165, w: 22, d: 18, fenceOnly: true,
    dressing: [
      { file: 'waterbarrel.glb', dx: -5, dz: -4 }, { file: 'waterbarrel.glb', dx: 5, dz: -4 }, { file: 'bench.glb', dx: 0, dz: 4 },
      { file: 'bench.glb', dx: -8, dz: 6 }, { file: 'waterbarrel.glb', dx: 8, dz: 6 },
    ],
  })
  registerZone({ id: 'botanicalgarden', x: 272, z: -165, radius: 14, densityMult: 0.9 })
  towerChestSpots.push({ x: 272, y: 0, z: -160 })
  towerChestSpots.push({ x: 272, y: 0, z: -156 })

  buildFillerLocation(scene, register, {
    x: -213, z: 236, w: 14, d: 10, wallHeight: 8, floorColor: 0x6a6258, openSide: 'north',
    dressing: [{ file: 'waiting-chair.glb', dx: -3, dz: -2 }, { file: 'waiting-chair.glb', dx: 3, dz: -2 }],
  })
  const apartmentcomplexRooms = buildRoomExtension(scene, register, {
    x: -213, startZ: 236 + 5, w: 14, roomDepths: [6], floorColor: 0x6a6258,
    dressingSets: [EXTRA_ROOM_DRESSING[3]],
  })
  registerZone({ id: 'apartmentcomplex', x: -213, z: 236, radius: 13, densityMult: 1.0 })
  towerChestSpots.push({ x: -213, y: 0, z: 240 })
  for (const room of apartmentcomplexRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: -304, z: 92, w: 12, d: 10, floorColor: 0x8a8070, openSide: 'north',
    dressing: [
      { file: 'waiting-chair.glb', dx: -3, dz: -2 }, { file: 'waiting-chair.glb', dx: 3, dz: -2 },
      { file: 'medical-cabinet.glb', dx: 0, dz: 3.5, rot: Math.PI },
    ],
  })
  const retirementhomeRooms = buildRoomExtension(scene, register, {
    x: -304, startZ: 92 + 5, w: 12, roomDepths: [6, 5], floorColor: 0x8a8070,
    dressingSets: [EXTRA_ROOM_DRESSING[2], EXTRA_ROOM_DRESSING[4]],
  })
  registerZone({ id: 'retirementhome', x: -304, z: 92, radius: 15, densityMult: 1.1 })
  towerChestSpots.push({ x: -304, y: 0, z: 96 })
  for (const room of retirementhomeRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: 298, z: 111, w: 10, d: 9, floorColor: 0x5a5040, openSide: 'north',
    dressing: [{ file: 'hospital-bed.glb', dx: -2, dz: -1.5 }, { file: 'waiting-chair.glb', dx: 2.5, dz: -1.5 }],
  })
  const hostelRooms = buildRoomExtension(scene, register, {
    x: 298, startZ: 111 + 4.5, w: 10, roomDepths: [5, 5, 4], floorColor: 0x5a5040,
    dressingSets: [EXTRA_ROOM_DRESSING[0], EXTRA_ROOM_DRESSING[2], EXTRA_ROOM_DRESSING[3]],
  })
  registerZone({ id: 'hostel', x: 298, z: 111, radius: 16, densityMult: 1.0 })
  towerChestSpots.push({ x: 298, y: 0, z: 115 })
  for (const room of hostelRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: 141, z: 285, w: 8, d: 7, floorColor: 0x4a3828, openSide: 'north',
    dressing: [{ file: 'campus-table.glb', dx: 0, dz: -1, scale: 0.8 }, { file: 'barrel.glb', dx: 2.5, dz: 1.5 }],
  })
  const cabinretreatRooms = buildRoomExtension(scene, register, {
    x: 141, startZ: 285 + 3.5, w: 8, roomDepths: [6, 5], floorColor: 0x4a3828,
    dressingSets: [EXTRA_ROOM_DRESSING[4], EXTRA_ROOM_DRESSING[1]],
  })
  registerZone({ id: 'cabinretreat', x: 141, z: 285, radius: 12, densityMult: 0.9 })
  towerChestSpots.push({ x: 141, y: 0, z: 288 })
  for (const room of cabinretreatRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z })

  buildFillerLocation(scene, register, {
    x: 126, z: -301, w: 7, d: 6, floorColor: 0xd8d8d0, openSide: 'north',
    dressing: [{ file: 'hospital-bed.glb', dx: -1.5, dz: -1.5 }, { file: 'medical-cabinet.glb', dx: 2, dz: -1.5, rot: -Math.PI / 2 }],
  })
  const dentalclinicRooms = buildRoomExtension(scene, register, {
    x: 126, startZ: -301 + 3, w: 7, roomDepths: [5, 4], floorColor: 0xd8d8d0,
    dressingSets: [EXTRA_ROOM_DRESSING[0], EXTRA_ROOM_DRESSING[1]],
  })
  registerZone({ id: 'dentalclinic', x: 126, z: -301, radius: 11, densityMult: 1.2 })
  towerChestSpots.push({ x: 126, y: 0, z: -298, lootWeights: MEDICAL_LOOT_WEIGHTS })
  for (const room of dentalclinicRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z, lootWeights: MEDICAL_LOOT_WEIGHTS })

  buildFillerLocation(scene, register, {
    x: 283, z: -206, w: 9, d: 8, floorColor: 0xd0d8d8, openSide: 'north',
    dressing: [{ file: 'waiting-chair.glb', dx: -2.5, dz: -1.5 }, { file: 'waiting-chair.glb', dx: 2.5, dz: -1.5 }, { file: 'medical-cabinet.glb', dx: 0, dz: 3, rot: Math.PI }],
  })
  const physicaltherapycenterRooms = buildRoomExtension(scene, register, {
    x: 283, startZ: -206 + 4, w: 9, roomDepths: [6, 5], floorColor: 0xd0d8d8,
    dressingSets: [EXTRA_ROOM_DRESSING[2], EXTRA_ROOM_DRESSING[0]],
  })
  registerZone({ id: 'physicaltherapycenter', x: 283, z: -206, radius: 12, densityMult: 1.1 })
  towerChestSpots.push({ x: 283, y: 0, z: -202, lootWeights: MEDICAL_LOOT_WEIGHTS })
  for (const room of physicaltherapycenterRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z, lootWeights: MEDICAL_LOOT_WEIGHTS })

  buildFillerLocation(scene, register, {
    x: -139, z: 295, w: 8, d: 7, floorColor: 0xc8d0d8, openSide: 'north',
    dressing: [{ file: 'waiting-chair.glb', dx: -2, dz: -1.5 }, { file: 'waiting-chair.glb', dx: 2, dz: -1.5 }, { file: 'counter.glb', dx: 0, dz: 2, rot: Math.PI }],
  })
  const mentalhealthclinicRooms = buildRoomExtension(scene, register, {
    x: -139, startZ: 295 + 3.5, w: 8, roomDepths: [6, 5], floorColor: 0xc8d0d8,
    dressingSets: [EXTRA_ROOM_DRESSING[3], EXTRA_ROOM_DRESSING[2]],
  })
  registerZone({ id: 'mentalhealthclinic', x: -139, z: 295, radius: 12, densityMult: 1.1 })
  towerChestSpots.push({ x: -139, y: 0, z: 298, lootWeights: MEDICAL_LOOT_WEIGHTS })
  for (const room of mentalhealthclinicRooms) towerChestSpots.push({ x: room.x, y: 0, z: room.z, lootWeights: MEDICAL_LOOT_WEIGHTS })

  // Abandoned Circus (-345,58) - striped tent (reuse the supply-cache tent
  // cone shape, wider) + scattered barrels.
  buildFillerLocation(scene, register, {
    x: -345, z: 58, w: 24, d: 20, fenceOnly: true,
    dressing: [
      { file: 'barrel.glb', dx: -5, dz: -4 }, { file: 'barrel.glb', dx: 5, dz: -4 },
      { file: 'barrel.glb', dx: -9, dz: 6 }, { file: 'trafficcone.glb', dx: 9, dz: 6 },
    ],
  })
  {
    const tentMat = cachedFlatMaterial({ color: 0x8a2a2a, roughness: 0.85 })
    const tent = new THREE.Mesh(new THREE.ConeGeometry(5.5, 5, 8), tentMat)
    tent.position.set(-345, 2.5, 58)
    tent.castShadow = true
    scene.add(tent)
    register(tent)
  }
  registerZone({ id: 'abandonedcircus', x: -345, z: 58, radius: 16, densityMult: 1.1 })
  towerChestSpots.push({ x: -345, y: 0, z: 63 })
  towerChestSpots.push({ x: -345, y: 0, z: 67 })

  // Shipwreck (-285,-189) - a large tilted hull shape, beached.
  buildFillerLocation(scene, register, {
    x: -285, z: -189, w: 18, d: 26, fenceOnly: true,
    dressing: [{ file: 'barrel.glb', dx: -6, dz: 8 }, { file: 'cabledrum.glb', dx: 6, dz: 8 }],
  })
  {
    const hullMat = cachedFlatMaterial({ color: 0x3a4a48, roughness: 0.9, metalness: 0.2 })
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 14, 8, 1, false, 0, Math.PI), hullMat)
    hull.rotation.z = Math.PI / 2
    hull.rotation.y = Math.PI / 2
    hull.position.set(-285, 1.2, -189)
    hull.rotation.x = 0.15
    hull.castShadow = true
    scene.add(hull)
    register(hull)
  }
  registerZone({ id: 'shipwreck', x: -285, z: -189, radius: 17, densityMult: 1.0 })
  towerChestSpots.push({ x: -285, y: 0, z: -184 })
  towerChestSpots.push({ x: -285, y: 0, z: -180 })

  // Crashed Plane Wreck (358,-7) - tilted fuselage cylinder + wing boxes.
  buildFillerLocation(scene, register, {
    x: 358, z: -7, w: 20, d: 16, fenceOnly: true,
    dressing: [{ file: 'barrel.glb', dx: -8, dz: 6 }, { file: 'roadblock.glb', dx: 8, dz: 6 }],
  })
  {
    const fuselageMat = cachedFlatMaterial({ color: 0x8a8a86, roughness: 0.6, metalness: 0.4 })
    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.6, 12, 12), fuselageMat)
    fuselage.rotation.z = Math.PI / 2
    fuselage.rotation.y = 0.3
    fuselage.position.set(358, 1.3, -7)
    fuselage.castShadow = true
    scene.add(fuselage)
    register(fuselage)
    const wing = new THREE.Mesh(new THREE.BoxGeometry(9, 0.3, 1.6), fuselageMat)
    wing.position.set(358, 1.1, -7)
    wing.rotation.y = 0.3
    wing.castShadow = true
    scene.add(wing)
    register(wing)
  }
  registerZone({ id: 'crashedplanewreck', x: 358, z: -7, radius: 15, densityMult: 1.1 })
  towerChestSpots.push({ x: 358, y: 0, z: -2 })
  towerChestSpots.push({ x: 358, y: 0, z: 2 })

  buildFillerLocation(scene, register, {
    x: 0, z: -358, w: 20, d: 18, fenceOnly: true,
    dressing: [
      { file: 'tool-hammer.glb', dx: -2, dz: -2 }, { file: 'tool-crowbar.glb', dx: 2, dz: -2 },
      { file: 'barrel.glb', dx: -3, dz: 3 }, { file: 'barrel.glb', dx: 3, dz: 3 },
      { file: 'tool-fireaxe.glb', dx: -7, dz: 6 }, { file: 'barrel.glb', dx: 7, dz: 6 },
    ],
  })
  registerZone({ id: 'oldminingcamp', x: 0, z: -358, radius: 14, densityMult: 1.1 })
  towerChestSpots.push({ x: 0, y: 0, z: -354 })
  towerChestSpots.push({ x: 0, y: 0, z: -350 })

  // Lighthouse (-103,-343) - tall tapered tower + a small light at the top.
  buildFillerLocation(scene, register, {
    x: -103, z: -343, w: 14, d: 14, fenceOnly: true,
    dressing: [{ file: 'waterbarrel.glb', dx: -5, dz: -5 }, { file: 'barrel.glb', dx: 5, dz: -5 }],
  })
  {
    const towerMat = cachedFlatMaterial({ color: 0xd8d4c8, roughness: 0.8 })
    const stripeMat = cachedFlatMaterial({ color: 0x8a2a2a, roughness: 0.8 })
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 11, 12), towerMat)
    tower.position.set(-103, 5.5, -343)
    tower.castShadow = true
    scene.add(tower)
    register(tower)
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.9, 2.5, 12), stripeMat)
    stripe.position.set(-103, 6, -343)
    scene.add(stripe)
    const lightMat = cachedFlatMaterial({ color: 0xfff2c0, emissive: 0xfff2c0, emissiveIntensity: 1 })
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 10), lightMat)
    light.position.set(-103, 11.3, -343)
    scene.add(light)
    const beaconLight = new THREE.PointLight(0xfff2c0, 1.5, 20, 2)
    beaconLight.position.set(-103, 11.3, -343)
    scene.add(beaconLight)
  }
  registerZone({ id: 'lighthouse', x: -103, z: -343, radius: 11, densityMult: 1.0 })
  towerChestSpots.push({ x: -103, y: 0, z: -339 })
  towerChestSpots.push({ x: -103, y: 0, z: -335 })

  // Windmill (-298,198) - tower + 4 crossed blades.
  buildFillerLocation(scene, register, {
    x: -298, z: 198, w: 14, d: 14, fenceOnly: true,
    dressing: [{ file: 'barrel.glb', dx: -5, dz: -5 }, { file: 'cabledrum.glb', dx: 5, dz: -5 }],
  })
  {
    const towerMat = cachedFlatMaterial({ color: 0xc9c0a8, roughness: 0.85 })
    const bladeMat = cachedFlatMaterial({ color: 0x6a5838, roughness: 0.8 })
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 8, 10), towerMat)
    tower.position.set(-298, 4, 198)
    tower.castShadow = true
    scene.add(tower)
    register(tower)
    for (const rot of [0, Math.PI / 2]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.25, 5, 0.6), bladeMat)
      blade.position.set(-298, 8.2, 198)
      blade.rotation.z = rot
      blade.castShadow = true
      scene.add(blade)
    }
  }
  registerZone({ id: 'windmill', x: -298, z: 198, radius: 11, densityMult: 0.9 })
  towerChestSpots.push({ x: -298, y: 0, z: 202 })
  towerChestSpots.push({ x: -298, y: 0, z: 206 })

  // Survivor SOS Camp (362,-53) - a lone camp with a ground-painted SOS
  // marker, matching the lore-flavor "someone was here and gave up"
  // reads other underground-network lore beats already use.
  buildFillerLocation(scene, register, {
    x: 362, z: -53, w: 16, d: 14, fenceOnly: true,
    dressing: [
      { file: 'barrel.glb', dx: -3, dz: -2 }, { file: 'waterbarrel.glb', dx: 3, dz: -2 },
      { file: 'barrel.glb', dx: -6, dz: 5 }, { file: 'waterbarrel.glb', dx: 6, dz: 5 },
    ],
  })
  {
    const markMat = cachedFlatMaterial({ color: 0xc9412e, roughness: 0.9 })
    for (const [dx, rot] of [[-1.2, Math.PI / 4], [1.2, -Math.PI / 4]]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 2.4), markMat)
      bar.position.set(362 + dx, 0.03, -53 + 2)
      bar.rotation.y = rot
      scene.add(bar)
    }
  }
  registerZone({ id: 'survivorsoscamp', x: 362, z: -53, radius: 12, densityMult: 1.1 })
  towerChestSpots.push({ x: 362, y: 0, z: -49 })
  towerChestSpots.push({ x: 362, y: 0, z: -45 })

  // Meteorite Crater Site (-343,-103) - shallow scorched depression + a
  // dark rock at its center.
  buildFillerLocation(scene, register, {
    x: -343, z: -103, w: 20, d: 20, fenceOnly: true,
    dressing: [{ file: 'barrel.glb', dx: -8, dz: -7 }, { file: 'barrel.glb', dx: 8, dz: -7 }],
  })
  {
    const scorchMat = cachedFlatMaterial({ color: 0x2a2622, roughness: 1 })
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(5, 24), scorchMat)
    scorch.rotation.x = -Math.PI / 2
    scorch.position.set(-343, 0.03, -103)
    scene.add(scorch)
    const rockMat = cachedFlatMaterial({ color: 0x1c1a24, roughness: 0.7, metalness: 0.3 })
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.6, 0), rockMat)
    rock.position.set(-343, 0.9, -103)
    rock.rotation.set(0.4, 0.7, 0.2)
    rock.castShadow = true
    scene.add(rock)
    register(rock)
    const rock2 = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), rockMat)
    rock2.position.set(-343 + 3, 0.5, -103 + 2)
    rock2.rotation.set(0.2, 0.5, 0.6)
    rock2.castShadow = true
    scene.add(rock2)
    register(rock2)
  }
  registerZone({ id: 'meteoritecratersite', x: -343, z: -103, radius: 14, densityMult: 1.0 })
  towerChestSpots.push({ x: -343, y: 0, z: -99 })
  towerChestSpots.push({ x: -343, y: 0, z: -95 })

  // Identifier signs for all 80 locations added this session (the 30 +
  // 50 batches) - one data-driven pass instead of 80 scattered call
  // sites, since every sign needs the exact same treatment (mounted just
  // south of the entrance/yard, facing the approach direction). Offset
  // is each location's own half-depth + ~1 unit clearance, using the
  // CURRENT (post-expansion) footprint for the fenceOnly/landmark ones
  // and the original first-room depth for the room-chain ones (the sign
  // belongs at the real building, not at the end of the extension).
  const LOCATION_SIGNS = [
    ['Community Center', -173, -100, -7], ['Print Shop', -122, -159, -5], ['Blood Bank', -82, -199, -4.5],
    ['Observatory', 226, 94, -6], ['Animal Shelter', -194, 149, -5.5], ['Quarantine Camp', -237, 63, -11],
    ['Pawn Shop', -237, -63, -5], ['Auto Dealership', -225, -130, -12], ['Bakery', -184, -184, -5],
    ['Comic Book Shop', -67, -251, -5], ['Music Store', -268, 111, -5], ['Locksmith', 230, -177, -4],
    ['Recycling Center', -302, 40, -11], ['Storage Units', -242, -186, -8], ['Water Tower', 320, 0, -9],
    ['Grain Silo', -83, -309, -9], ['Construction Site', 87, 324, -12], ['Rail Yard', -87, 324, -11],
    ['Ice Cream Parlor', 87, -324, -4.5], ['Skate Park', -350, 0, -12], ['Community Pool', 140, 337, -11],
    ['Ice Rink', 48, 362, -7], ['Drive-in Theater', -48, 362, -12], ['Horse Stables', -140, 337, -6],
    ['Veterinary Clinic', -353, 94, -4.5], ['Tattoo Parlor', -140, -337, -4.5], ['Fitness Store', -48, -362, -4.5],
    ['Community Garden', 48, -362, -10], ['Beauty School', 140, -337, -5], ['Movie Rental', -130, -90, -4.5],
    ['Pizza Parlor', 158, 0, -4.5], ['Coffee Shop', 3, -158, -4.5], ['Sushi Restaurant', -61, -154, -4.5],
    ['BBQ Smokehouse', 72, 193, -5], ['Food Truck Lot', -158, 3, -8], ['Brewery', -106, -117, -5.5],
    ['Toy Store', -68, 195, -4.5], ['Sporting Goods', 72, -193, -5], ['Jewelry Store', -153, 150, -4],
    ['Furniture Store', 152, 162, -5.5], ['Antique Shop', -159, -143, -4.5], ['Bookstore', 224, 53, -5],
    ['Hobby Craft Store', -211, 110, -4.5], ['Thrift Store', -107, 204, -5], ['City Hall', 111, -202, -6],
    ['Courthouse', 48, 225, -6], ['DMV Office', -136, -195, -5.5], ['Community College', 59, -231, -6],
    ['Museum', 205, 136, -6], ['Art Gallery', -108, -230, -5.5], ['Power Plant', -49, 233, -11],
    ['Sawmill', 51, 265, -10], ['Textile Mill', 262, 67, -6], ['Cold Storage', -46, 274, -10],
    ['Shipping Yard', 52, -273, -11], ['Quarry', 195, 175, -13], ['Wind Farm', -263, -91, -9],
    ['Cell Tower', 256, 127, -6], ['Arcade', -102, -276, -5.5], ['Mini Golf', -207, -220, -11],
    ['Go-Kart Track', 197, -218, -12], ['Paintball Field', -302, -6, -10], ['Concert Hall', -271, -134, -7],
    ['Trampoline Park', 217, 221, -6], ['Botanical Garden', 272, -165, -10], ['Apartment Complex', -213, 236, -6],
    ['Retirement Home', -304, 92, -6], ['Hostel', 298, 111, -5.5], ['Cabin Retreat', 141, 285, -4.5],
    ['Dental Clinic', 126, -301, -4], ['Physical Therapy', 283, -206, -5], ['Mental Health Clinic', -139, 295, -4.5],
    ['Abandoned Circus', -345, 58, -11], ['Shipwreck', -285, -189, -14], ['Crashed Plane', 358, -7, -9],
    ['Old Mining Camp', 0, -358, -10], ['Lighthouse', -103, -343, -8], ['Windmill', -298, 198, -8],
    ['Survivor SOS Camp', 362, -53, -8], ['Meteorite Crater', -343, -103, -11],
  ]
  for (const [label, sx, sz, offset] of LOCATION_SIGNS) {
    buildLocationSign(scene, sx, sz, offset, label)
  }

  // Performance fix - only 2 call sites in this whole file ever went through
  // register() (which is what actually adds something to cullables), out of
  // 140+ raw colliders.push/solidMeshes.push calls across every stage. That
  // meant nearly the entire map - every wall, floor, prop from Stage 1
  // through Stage 13 - rendered every frame regardless of camera distance,
  // real-user-reported lag (a MacBook M4) once the world grew to 14 stages'
  // worth of content. Folding solidMeshes into cullables here fixes that in
  // one place instead of touching 140+ individual call sites.
  //
  // Verified separately (a standalone `three` package script, not a guess):
  // THREE.Raycaster completely ignores `.visible` - hits register on
  // invisible meshes exactly the same as visible ones - so distance-culling
  // solidMeshes here cannot break PlayerController._sampleGroundHeight's
  // floor-detection raycasts anywhere on the map, even for now-invisible
  // ground far from the player.
  //
  // `ground` (the single 750x750 street plane) is the one deliberate
  // exception: every other cullable object has a footprint small relative
  // to WORLD_CULL_DISTANCE, so a player standing inside it is never far
  // enough from ITS OWN position to trigger culling of itself - but ground's
  // own position is always (0,0), so culling it by distance-from-origin
  // would make the entire plane vanish under the player's feet as soon as
  // they're WORLD_CULL_DISTANCE away from map center (most of the map).
  const cullableSet = new Set(cullables)
  for (const mesh of solidMeshes) {
    if (mesh !== ground) cullableSet.add(mesh)
  }
  const allCullables = [...cullableSet]

  // Freeze every object the map just built. Everything above this line is
  // static (buildings, roads, decoration) and never moves again after
  // placement, but three.js still recomputes a fresh local matrix for
  // matrixAutoUpdate:true objects every single frame regardless - pure
  // wasted cost at ~15k objects. See docs/PERFORMANCE.md Option A2 (this
  // is more thorough than that doc's own suggested register()-only edit:
  // register() only covers objects that also need a collider, which
  // turned out to be a small minority - most of the object count is
  // register()-skipping decoration like railings/helipads/rooftops, see
  // e.g. buildOfficeSkyscraper). Safe to blanket-freeze the whole scene
  // here specifically because nothing else has been added to it yet at
  // this point in construction - zombies/companions/seasonal
  // banners/lore markers/the wrecking pendulum/mine-hazard rubble are all
  // built later, by Game.js, after buildWorld() has already returned.
  scene.traverse((obj) => {
    obj.updateMatrix()
    obj.matrixAutoUpdate = false
  })

  // See docs/PERFORMANCE.md Option A1: _updateCulling (Game.js) detaches
  // out-of-range cullables from the scene graph instead of just hiding
  // them (a hidden object is still walked and matrix-updated every frame -
  // hiding isn't removing). Captured once here, before anything is ever
  // detached, rather than re-derived dynamically at detach time, so
  // reattachment always targets the object's real original parent (never
  // the scene root - several cullables are children of building groups and
  // depend on that group's transform).
  for (const obj of allCullables) obj.__parkedParent = obj.parent

  return {
    colliders,
    solidMeshes,
    flickerLights,
    spawnPoints,
    ambientWildlife,
    jukebox,
    workbench,
    bulletinBoard,
    hallOfFame,
    skyscraperShortcuts,
    adjustableDummy,
    pet,
    drainpipeSpots,
    jumpPadSpot,
    hemiLight: hemi,
    sunLight: moon,
    towerChestSpots,
    minigunSpot,
    generator,
    trader,
    ammoStation,
    upgradeMachine,
    mysteryBox,
    vireoFacility,
    undergroundStation,
    subwayEntrance,
    safeZone,
    practiceTargets,
    trophyWall,
    cullables: allCullables,
    supermarket,
    groceryStore,
    hospital,
    pharmacy,
    hardwareStore,
    gunShop,
    policeStation,
    militaryCheckpoint,
    prison,
    university,
    skyscraper,
    megaMall,
    warehouse,
    gasStation,
    bank,
    diner,
    radioStation,
    fireStation,
    motel,
    newUndergroundEntrance,
    maintenanceTunnel,
    toxicSewerLevel,
    mineLevel,
    manholeCovers,
    waterTowerValve,
    containerStaircase,
    industrialSiren,
    wreckingPendulum,
    scaffolding,
    elevatorTower,
    payphone,
    tacticalStreetlights: [tacticalStreetlightA, tacticalStreetlightB],
    grassBounds: park.grassBounds,
    waterBounds,
  }
}

// A small park connected to the north end of the main avenue - open grass,
// scattered trees, a couple of benches, and its own chest/spawn points, so
// exploring past the city block is rewarded with a change of scenery.
const PARK_Z_START = 52
const PARK_Z_END = 72
const PARK_HALF_WIDTH = 22

// Generic ground plane with 0+ rectangular holes actually cut out of the
// mesh (a THREE.Shape + Path holes, not just another opaque layer stacked on
// top) - the only way for a camera above to see, and a player to walk,
// straight down into whatever sits below. px/pz is the plane's own center
// (same convention as PlaneGeometry + position.set); holeRectsWorld are
// rectangles in WORLD x/z, converted to the shape's local (pre-rotation) x/y
// via localX = worldX - px, localY = pz - worldZ (verified against the
// mesh's real matrixWorld with a standalone three.js script before use, both
// by forward-transforming these corners back to the expected world rect and
// by raycasting through a known hole center vs. known solid ground).
function buildGroundPlaneWithHoles(scene, material, px, pz, width, depth, holeRectsWorld, meshY) {
  const shape = new THREE.Shape()
  shape.moveTo(-width / 2, -depth / 2)
  shape.lineTo(width / 2, -depth / 2)
  shape.lineTo(width / 2, depth / 2)
  shape.lineTo(-width / 2, depth / 2)
  shape.closePath()
  for (const r of holeRectsWorld) {
    const xMin = r.xMin - px
    const xMax = r.xMax - px
    const yMin = pz - r.zMax
    const yMax = pz - r.zMin
    const hole = new THREE.Path()
    hole.moveTo(xMin, yMin)
    hole.lineTo(xMax, yMin)
    hole.lineTo(xMax, yMax)
    hole.lineTo(xMin, yMax)
    hole.closePath()
    shape.holes.push(hole)
  }
  const geo = new THREE.ShapeGeometry(shape)
  // ShapeGeometry's own UVs are just the shape's raw local coordinates
  // (here, -width/2..width/2 and -depth/2..depth/2) - NOT normalized to
  // 0-1 like PlaneGeometry's UVs are. Every texture-repeat value in this
  // file (groundTex, plazaTex, ...) was tuned assuming standard 0-1 UVs,
  // so left as-is this made the texture tile roughly `width`x too densely
  // (confirmed directly against the real `three` package: PlaneGeometry's
  // UV range is [0,1], ShapeGeometry's is [-375,375] for a 750-wide shape)
  // - a real, visible regression from when the ground first switched from
  // PlaneGeometry to this hole-supporting ShapeGeometry back in Stage 10.
  // Remapped here to match PlaneGeometry's convention exactly, so `repeat`
  // continues to mean the same thing it always did.
  const uv = geo.attributes.uv
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) + width / 2) / width, (uv.getY(i) + depth / 2) / depth)
  }
  uv.needsUpdate = true
  const mesh = new THREE.Mesh(geo, material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(px, meshY, pz)
  mesh.receiveShadow = true
  scene.add(mesh)
  return mesh
}

function buildPark(scene, colliders, solidMeshes) {
  const centerZ = (PARK_Z_START + PARK_Z_END) / 2
  const depth = PARK_Z_END - PARK_Z_START
  const undergroundHoles = [UNDERGROUND_HOLE_SUBWAY, UNDERGROUND_HOLE_NEW_ENTRANCE]

  const grassMat = cachedFlatMaterial({ color: 0x2c3a24, roughness: 1 })
  buildGroundPlaneWithHoles(scene, grassMat, 0, centerZ, PARK_HALF_WIDTH * 2, depth, undergroundHoles, 0.01)

  // Path is narrower than the grass (4 wide, x -2..2) - only the subway hole
  // (centered on the path's own x=0) actually falls inside it, clamped a
  // little short of the path's own edges so the hole never touches (let
  // alone exceeds) the outer boundary it's cut from.
  const pathMat = cachedFlatMaterial({ color: 0x4a463c, roughness: 1 })
  const pathHole = { xMin: -1.9, xMax: 1.9, zMin: UNDERGROUND_HOLE_SUBWAY.zMin, zMax: UNDERGROUND_HOLE_SUBWAY.zMax }
  buildGroundPlaneWithHoles(scene, pathMat, 0, centerZ, 4, depth, [pathHole], 0.015)

  // Paved plaza (regular street asphalt, not park grass) covering both
  // underground entrances - per direct user feedback that a small patch
  // still read as "part of the park", this clears a proper stretch of
  // regular ground around both stairwells instead.
  const plazaTex = new THREE.TextureLoader().load('/textures/ground-asphalt.png')
  plazaTex.wrapS = THREE.RepeatWrapping
  plazaTex.wrapT = THREE.RepeatWrapping
  plazaTex.colorSpace = THREE.SRGBColorSpace
  plazaTex.repeat.set(UNDERGROUND_PLAZA.w / 12, UNDERGROUND_PLAZA.d / 12)
  const plazaMat = cachedFlatMaterial({ map: plazaTex, roughness: 1 })
  buildGroundPlaneWithHoles(
    scene, plazaMat, UNDERGROUND_PLAZA.x, UNDERGROUND_PLAZA.z, UNDERGROUND_PLAZA.w, UNDERGROUND_PLAZA.d,
    undergroundHoles, 0.02
  )

  // Already flat colors, already shared across every tree instance - only
  // the lighting-model cost changes under LOW_QUALITY_MODE.
  const trunkMat = LOW_QUALITY_MODE ? new THREE.MeshLambertMaterial({ color: 0x2a1f16 }) : cachedFlatMaterial({ color: 0x2a1f16, roughness: 1 })
  const leafMat = LOW_QUALITY_MODE ? new THREE.MeshLambertMaterial({ color: 0x3a4d2a }) : cachedFlatMaterial({ color: 0x3a4d2a, roughness: 0.9 })
  // Excludes any tree that used to crowd right up against either stairwell
  // (see the reference-photo feedback that trees/grass right next to the
  // kiosks still read as "the park", not a real stairwell plaza).
  const treeSpots = [
    [-14, 56], [14, 58], [-9, 63], [10, 66], [-16, 69], [16, 61], [-5, 70], [6, 54],
  ].filter(([x, z]) => {
    const nearSubway = Math.hypot(x - SUBWAY_PARK_ENTRANCE_X, z - 58.75) < 10
    const nearNewEntrance = Math.hypot(x - NEW_UNDERGROUND_ENTRANCE_X, z - 55.85) < 10
    return !nearSubway && !nearNewEntrance
  })
  for (const [x, z] of treeSpots) {
    const tree = new THREE.Group()
    tree.position.set(x, 0, z)

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.4, 12), trunkMat)
    trunk.position.y = 1.2
    trunk.castShadow = true
    tree.add(trunk)

    const leaves = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3, 12), leafMat)
    leaves.position.y = 3.4
    leaves.castShadow = true
    tree.add(leaves)

    scene.add(tree)
    solidMeshes.push(trunk)
    // See buildWorld's register() for why this updateWorldMatrix call is
    // required: trunk is a child of the just-positioned tree group, and
    // Box3.setFromObject alone won't pick up the parent's transform yet.
    trunk.updateWorldMatrix(true, false)
    const box = new THREE.Box3().setFromObject(trunk)
    colliders.push(box)
  }

  const benchMat = cachedFlatMaterial({ color: 0x3a3226, roughness: 0.85 })
  const benchModel = _propModelCache.get('bench.glb')
  const benchSpots = [[-3, 58, 0], [3, 65, Math.PI]]
  for (const [x, z, rot] of benchSpots) {
    const bench = new THREE.Group()
    bench.position.set(x, 0, z)

    if (benchModel) {
      const clone = benchModel.clone(true)
      // Real model's long seat axis exports along Z, not X (see
      // build-props2.py's note) - the extra 90 degrees here swings it to
      // match the procedural version's facing convention before applying
      // each spot's own rot.
      bench.rotation.y = rot + Math.PI / 2
      clone.traverse((child) => {
        if (!child.isMesh) return
        child.castShadow = true
        child.material = flattenedClone(child.material)
      })
      bench.add(clone)
      scene.add(bench)
      solidMeshes.push(clone)
      // Explicit axis-aligned collider from the model's own known
      // dimensions rather than Box3.setFromObject() on this rotated group -
      // that inflates well past the real footprint (see CLAUDE.md's
      // rotated-mesh AABB gotcha). Half-extents swap between local X/Z
      // depending on which way this particular bench faces.
      const long = 0.7 // half of the ~1.83 seat length + a little clearance
      const deep = 0.25 // half of the ~0.7 depth (seat + backrest)
      const facingSideways = Math.abs(Math.sin(rot)) > 0.5
      const halfX = facingSideways ? deep : long
      const halfZ = facingSideways ? long : deep
      colliders.push(new THREE.Box3(
        new THREE.Vector3(x - halfX, 0, z - halfZ),
        new THREE.Vector3(x + halfX, 0.95, z + halfZ)
      ))
      continue
    }

    bench.rotation.y = rot
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.4), benchMat)
    seat.position.y = 0.45
    seat.castShadow = true
    bench.add(seat)
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.06), benchMat)
    back.position.set(0, 0.7, -0.17)
    bench.add(back)
    for (const lx of [-0.55, 0.55]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.35), benchMat)
      leg.position.set(lx, 0.22, 0)
      bench.add(leg)
    }

    scene.add(bench)
    solidMeshes.push(seat)
    // Same fix as the tree trunk above - seat is a child of the positioned
    // bench group.
    seat.updateWorldMatrix(true, false)
    colliders.push(new THREE.Box3().setFromObject(seat))
  }

  const chestSpots = [
    { x: -12, y: 0, z: 60 },
    { x: 12, y: 0, z: 68 },
  ]

  const spawnPoints = []
  for (let z = PARK_Z_START + 4; z <= PARK_Z_END - 4; z += 8) {
    spawnPoints.push({ x: (Math.random() - 0.5) * 10, z })
  }

  // Footstep surface variety (see PlayerController's groundSurfaceType) -
  // the grass/path/plaza floors here are decorative overlays on top of
  // the single real ground plane, same as the marina's water (neither is
  // actually raycast-hittable for ground detection), so a simple position
  // bounds check is used instead of trying to tag a mesh that's never
  // actually the one the ground-height raycast lands on. Approximate
  // (doesn't carve out the narrow path/plaza strips also inside this
  // rectangle) - an occasional wrong footstep sound right at the path's
  // edge is a fine tradeoff for staying simple.
  const grassBounds = { xMin: -PARK_HALF_WIDTH, xMax: PARK_HALF_WIDTH, zMin: PARK_Z_START, zMax: PARK_Z_END }

  return { chestSpots, spawnPoints, grassBounds }
}

// Shootable explosive barrels - the world-prop half of WeaponSystem._fire's
// hit.object.userData.explosive check, which already knows how to detonate
// one (calls ZombieManager.explodeAt) but had nothing in the world tagging
// itself as explosive until this. Each barrel gets its own cloned material -
// not a shared module-level one - since _fire mutates color/emissive
// in-place on detonation, and a shared material would blacken every barrel
// on the map the instant any single one was shot (same class of bug as the
// Molotov fire zone material sharing one instance earlier).
const barrelBodyMat = cachedFlatMaterial({
  color: 0xb3311f,
  emissive: 0x4a0f06,
  emissiveIntensity: 0.5,
  roughness: 0.55,
  metalness: 0.25,
})
const barrelCapMat = cachedFlatMaterial({ color: 0x1c1a16, roughness: 0.6, metalness: 0.4 })

function buildExplosiveBarrels(scene, colliders, solidMeshes, spots) {
  const model = _propModelCache.get('barrel.glb')
  for (const [x, z] of spots) {
    const barrel = new THREE.Group()
    barrel.position.set(x, 0, z)

    if (model) {
      const clone = model.clone(true)
      let body = null
      clone.traverse((child) => {
        if (!child.isMesh) return
        child.castShadow = true
        child.receiveShadow = true
        child.material = flattenedClone(child.material)
        body = child // single mesh/material in this model
      })
      barrel.add(clone)
      scene.add(barrel)
      body.updateWorldMatrix(true, false)
      const explosive = { x, z, mat: body.material, exploded: false }
      body.userData.explosive = explosive
      solidMeshes.push(body)
      colliders.push(new THREE.Box3().setFromObject(body))
      continue
    }

    const bodyMat = barrelBodyMat.clone()
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.9, 12), bodyMat)
    body.position.y = 0.45
    body.castShadow = true
    body.receiveShadow = true
    barrel.add(body)

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.08, 12), barrelCapMat)
    cap.position.y = 0.94
    barrel.add(cap)

    scene.add(barrel)
    body.updateWorldMatrix(true, false)
    const explosive = { x, z, mat: bodyMat, exploded: false }
    // Cap shares the same explosive record (not a second one) so a shot
    // that lands on the thin top disc instead of the body still detonates
    // it - both meshes need to be raycast-hittable (solidMeshes) for that
    // to even be possible, but only the body needs a movement collider.
    body.userData.explosive = explosive
    cap.userData.explosive = explosive
    solidMeshes.push(body, cap)
    colliders.push(new THREE.Box3().setFromObject(body))
  }
}

// Small utility generator near spawn, powering the street's flicker lights.
// Its indicator light is driven live from Game.js based on fuel level.
function buildGenerator(scene, register) {
  const x = 1.5
  const z = 5

  const group = new THREE.Group()
  group.position.set(x, 0, z)

  const bodyMat = cachedFlatMaterial({ color: 0x3a4530, roughness: 0.8 })
  const trimMat = cachedFlatMaterial({ color: 0x1c1c1a, roughness: 0.5, metalness: 0.5 })
  // NOT cachedFlatMaterial - Game.js's _updateGenerator mutates this
  // per-instance based on fuel level. See docs/PERFORMANCE.md Option B1's
  // own warning about exactly this bug class.
  const indicatorMat = flatMaterial({ color: 0x0a2a0a, emissive: 0x2aff3e, emissiveIntensity: 1 })

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 0.7), bodyMat)
  body.position.y = 0.45
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), trimMat)
  pipe.position.set(0.35, 1.05, -0.2)
  group.add(pipe)

  for (const dx of [-0.4, 0.4]) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.05), trimMat)
    vent.position.set(dx, 0.55, 0.36)
    group.add(vent)
  }

  const indicator = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.04), indicatorMat)
  indicator.position.set(0, 0.75, 0.36)
  group.add(indicator)

  scene.add(group)
  register(body)

  return { x, z, indicatorMat }
}

// A scavenger's trade stall near spawn - counter, slanted awning, and a lit
// sign - where scrap earned from kills can be spent on supplies (see
// Game.js's trader panel).
function buildTraderStall(scene, register) {
  // Inside the safe zone compound (see SAFE_ZONE_X/Z, buildSafeZone) instead
  // of out on the open avenue, so both "spend points" stops sit behind the
  // guarded wall together. Placed in the south interior near the entrance
  // (which now opens on -z, see buildSafeZone's 180-degree flip) since the
  // Vault/practice range/trophy wall all live in the north half. Pushed out
  // to x=-5.5 (was -4) - the entrance guard NPCs actually stand at
  // (x=+-2.1, z~36.9), not just their sandbag post props, and -4 read as
  // "on top of the guard" in practice; -5.5 gives real separation while
  // staying inside the x=-7 wall.
  const x = SAFE_ZONE_X - 5.5
  const z = SAFE_ZONE_Z - 3

  const group = new THREE.Group()
  group.position.set(x, 0, z)
  group.rotation.y = Math.PI * 0.15

  const signMat = cachedFlatMaterial({ color: 0x1a1410, emissive: 0xffb347, emissiveIntensity: 1.1 })

  // Real GLB model (Quaternius "Market Stand", CC0, poly.pizza) in place of
  // the procedural counter+posts+awning. Raw bounds ~0.95w x 1.05h x 1.19d;
  // scaled up to roughly the old counter's footprint.
  const STALL_SCALE = 1.65
  const stallModel = _propModelCache.get('traderstall.glb')
  let raycastTarget
  const COUNTER_H = 0.9

  if (stallModel) {
    const clone = stallModel.clone(true)
    clone.scale.setScalar(STALL_SCALE)
    clone.traverse((child) => {
      if (!child.isMesh) return
      child.castShadow = true
      child.receiveShadow = true
      child.material = flattenedClone(child.material)
    })
    group.add(clone)
    raycastTarget = clone

    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.04), signMat)
    sign.position.set(0, 1.7, -0.16)
    group.add(sign)

    const lantern = new THREE.PointLight(0xffb347, 1.4, 6, 2)
    lantern.position.set(0, 1.6, 0.3)
    group.add(lantern)
  } else {
    const woodMat = cachedFlatMaterial({ color: 0x4a3624, roughness: 0.9 })
    const tarpMat = cachedFlatMaterial({ color: 0x5a2e2a, roughness: 0.85 })

    const COUNTER_W = 1.6
    const COUNTER_D = 0.6
    const counter = new THREE.Mesh(new THREE.BoxGeometry(COUNTER_W, COUNTER_H, COUNTER_D), woodMat)
    counter.position.y = 0.45
    counter.castShadow = true
    counter.receiveShadow = true
    group.add(counter)
    raycastTarget = counter

    for (const dx of [-0.7, 0.7]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.1, 10), woodMat)
      post.position.set(dx, 1.05, -0.15)
      post.castShadow = true
      group.add(post)
    }

    const awning = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 1.1), tarpMat)
    awning.position.set(0, 2.05, 0.15)
    awning.rotation.x = -0.12
    awning.castShadow = true
    group.add(awning)

    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.04), signMat)
    sign.position.set(0, 1.7, -0.16)
    group.add(sign)

    const lantern = new THREE.PointLight(0xffb347, 1.4, 6, 2)
    lantern.position.set(0, 1.6, 0.3)
    group.add(lantern)
  }

  scene.add(group)
  // The stall sits on the group's own rotation axis (no local x/z offset),
  // so its true world footprint is just its unrotated half-extents
  // re-centered at the group's world x/z - no need to let setFromObject
  // inflate it for the 27deg tilt (see register()'s explicitBox comment).
  const halfW = (stallModel ? 0.95 * STALL_SCALE : 1.6) / 2
  const halfD = (stallModel ? 1.19 * STALL_SCALE : 0.6) / 2
  const counterBox = new THREE.Box3(
    new THREE.Vector3(x - halfW, 0, z - halfD),
    new THREE.Vector3(x + halfW, COUNTER_H, z + halfD)
  )
  register(raycastTarget, counterBox)

  // A couple of "goods" props scattered beside the stall (not on the
  // group's own rotated axis, so plain world-space offsets clear of the
  // counter's footprint above) - the stall alone read as a lone counter in
  // an empty patch of ground with nothing suggesting an actual market.
  placePropSimple(scene, register, 'cabledrum.glb', x - 1.3, z + 0.9, 0.4)
  placePropSimple(scene, register, 'waterbarrel.glb', x + 1.4, z + 0.7, -0.3)

  return { x, z, signMat, mesh: raycastTarget }
}

// Ammo refill kiosk near spawn - hold the interact key here for a few
// seconds (without firing) to top off reserve ammo instead of relying on
// pickups alone (see Game.js's _updateAmmoStation). Kept well clear of the
// generator/trader stall so all three street props read as distinct spots.
function buildAmmoStation(scene, register) {
  // Also inside the safe zone, mirrored across the entrance from the trader
  // stall (see buildTraderStall) - both spend-points-here stops behind the
  // same guarded wall, pushed out to x=5.5 for the same guard-clearance
  // reason as the trader.
  const x = SAFE_ZONE_X + 5.5
  const z = SAFE_ZONE_Z - 3

  const group = new THREE.Group()
  group.position.set(x, 0, z)

  // Real GLB model (see asset-source/build-interactables.py - bespoke
  // Blender build, no free pack matched this shape) in place of the
  // procedural body+trim boxes. Authored directly in Three-scale units, no
  // correction factor needed.
  const stationModel = _propModelCache.get('ammostation.glb')
  let raycastTarget
  let buttonMat

  if (stationModel) {
    const clone = stationModel.clone(true)
    clone.traverse((child) => {
      if (!child.isMesh) return
      child.castShadow = true
      child.receiveShadow = true
      child.material = flattenedClone(child.material)
    })
    group.add(clone)
    raycastTarget = clone
    const buttonMesh = clone.getObjectByName('Button')
    buttonMat = buttonMesh.material
  } else {
    const bodyMat = cachedFlatMaterial({ color: 0x5a2a1e, roughness: 0.7, metalness: 0.2 })
    const trimMat = cachedFlatMaterial({ color: 0x1c1c1a, roughness: 0.5, metalness: 0.5 })
    // NOT cachedFlatMaterial - Game.js's _updateAmmoStation mutates this
    // per-instance while charging. Confirmed this collides with
    // buildBreakerBox's indicatorMat below (identical opts) if both ever
    // hit this fallback branch.
    buttonMat = flatMaterial({ color: 0x2a0808, emissive: 0xff2a1e, emissiveIntensity: 1.1 })

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.5), bodyMat)
    body.position.y = 0.55
    body.castShadow = true
    body.receiveShadow = true
    group.add(body)
    raycastTarget = body

    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.06, 0.54), trimMat)
    trim.position.y = 1.06
    group.add(trim)
  }

  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 96
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#0a0a0a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#e3a63c'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 20px sans-serif'
  ctx.fillText('AMMO', canvas.width / 2, canvas.height / 2 - 16)
  ctx.font = 'bold 14px sans-serif'
  ctx.fillText('REFILL', canvas.width / 2, canvas.height / 2 + 4)
  ctx.font = '11px sans-serif'
  ctx.fillStyle = '#c9b8a0'
  ctx.fillText('HOLD TO CHARGE', canvas.width / 2, canvas.height / 2 + 26)

  const screenMat = cachedFlatMaterial({
    map: new THREE.CanvasTexture(canvas),
    emissive: 0xffffff,
    emissiveMap: new THREE.CanvasTexture(canvas),
    emissiveIntensity: 0.9,
  })
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.38), screenMat)
  screen.position.set(0, 0.65, 0.255)
  group.add(screen)

  if (!stationModel) {
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 16), buttonMat)
    button.rotation.x = Math.PI / 2
    button.position.set(0, 0.28, 0.26)
    group.add(button)
  }

  scene.add(group)
  register(raycastTarget)

  return { x, z, buttonMat, mesh: raycastTarget }
}

// Weapon Upgrade Machine - a physical console (see Game.js's
// _tryUpgradeWeapon), not a menu, so spending points on it means actually
// walking up to a specific spot mid-run. Placed in the park's open west
// side, well clear of both underground entrance holes (x=[-3,12]ish, see
// UNDERGROUND_HOLE_SUBWAY/UNDERGROUND_HOLE_NEW_ENTRANCE) and the safe
// zone's own internal layout (Vault/practice range/trophy wall already
// pack its north half - this avoids that entirely by living outside the
// walls).
function buildWeaponUpgradeMachine(scene, register, x, z) {
  const group = new THREE.Group()
  group.position.set(x, 0, z)

  const bodyMat = cachedFlatMaterial({ color: 0x2a3a6a, roughness: 0.5, metalness: 0.5, emissive: 0x1a2a5a, emissiveIntensity: 0.5 })
  const trimMat = cachedFlatMaterial({ color: 0x1c1c1a, roughness: 0.5, metalness: 0.6 })

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.8, 0.8), bodyMat)
  body.position.y = 0.9
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  const trim = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.1, 0.86), trimMat)
  trim.position.y = 1.8
  group.add(trim)

  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 96
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#0a0a14'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#4a6aff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 16px sans-serif'
  ctx.fillText('WEAPON', canvas.width / 2, canvas.height / 2 - 20)
  ctx.fillText('UPGRADE', canvas.width / 2, canvas.height / 2)
  ctx.font = '11px sans-serif'
  ctx.fillStyle = '#c9b8a0'
  ctx.fillText('E TO USE', canvas.width / 2, canvas.height / 2 + 24)

  const screenMat = cachedFlatMaterial({ map: new THREE.CanvasTexture(canvas), emissive: 0xffffff, emissiveMap: new THREE.CanvasTexture(canvas), emissiveIntensity: 0.9 })
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.6), screenMat)
  screen.position.set(0, 1.1, 0.41)
  group.add(screen)

  const glowLight = new THREE.PointLight(0x4a6aff, 1.2, 6, 2)
  glowLight.position.set(0, 1.5, 0.5)
  group.add(glowLight)

  scene.add(group)
  register(body)
  return { x, z }
}

// Mystery Box - same "physical spot, not a menu" idea as the upgrade
// machine above, placed on the park's east side to mirror it.
function buildMysteryBox(scene, register, x, z) {
  const group = new THREE.Group()
  group.position.set(x, 0, z)

  const crateMat = cachedFlatMaterial({ color: 0x5a2a6a, roughness: 0.6, metalness: 0.3, emissive: 0x3a1a4a, emissiveIntensity: 0.4 })
  const trimMat = cachedFlatMaterial({ color: 0x2a1a2a, roughness: 0.6, metalness: 0.4 })

  const crate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), crateMat)
  crate.position.y = 0.55
  crate.castShadow = true
  crate.receiveShadow = true
  group.add(crate)

  for (const dy of [0.15, 1.0]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.12, 1.16), trimMat)
    band.position.y = dy
    group.add(band)
  }

  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 96
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#140a1a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#c98fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 16px sans-serif'
  ctx.fillText('MYSTERY', canvas.width / 2, canvas.height / 2 - 20)
  ctx.fillText('BOX', canvas.width / 2, canvas.height / 2)
  ctx.font = '11px sans-serif'
  ctx.fillStyle = '#c9b8a0'
  ctx.fillText('E TO GAMBLE', canvas.width / 2, canvas.height / 2 + 24)

  const screenMat = cachedFlatMaterial({ map: new THREE.CanvasTexture(canvas), emissive: 0xffffff, emissiveMap: new THREE.CanvasTexture(canvas), emissiveIntensity: 0.9 })
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.6), screenMat)
  screen.position.set(0, 1.4, 0)
  screen.rotation.x = -0.3
  group.add(screen)

  const glowLight = new THREE.PointLight(0xc98fff, 1.2, 6, 2)
  glowLight.position.set(0, 1.6, 0)
  group.add(glowLight)

  scene.add(group)
  register(crate)
  return { x, z }
}

// Module-level (not just local to buildSafeZone) so buildTraderStall and
// buildAmmoStation can position themselves relative to it without an
// execution-order dependency - both stalls are meant to sit inside this
// compound (see their own comments), and hardcoding their own absolute
// coordinates instead of referencing this is exactly what left them behind
// at the old (-13, -10) location the last time this moved.
// Moved to the north end of the map, just south of the park entrance - was
// at (-13, -10) near the middle of the street grid. z=42 leaves 3 clear
// units before the park's grass starts at z=52 (see PARK_Z_START); x=0
// centers it on the avenue, replacing the scavenger lookout cluster that
// used to sit at (-3, 44) - see CLUSTER_SPECS, now down to just the one
// cluster at the south end.
export const SAFE_ZONE_X = 0
export const SAFE_ZONE_Z = 42

// A walled compound with a single entrance gap - guard NPCs (see Game.js,
// which spawns Companion instances at guardSpots) stand watch just inside
// the gap and shoot anything that wanders close, so the gap reads as a
// defended chokepoint instead of an unguarded hole in the wall. Game.js also
// slowly heals the player while they're within `radius` of the center.
function buildSafeZone(scene, colliders, solidMeshes) {
  const x = SAFE_ZONE_X
  const z = SAFE_ZONE_Z
  // Widened from a uniform half=7 square to a wider-than-deep rectangle -
  // halfX grew (7 -> 10) since there's a lot of clear avenue on the east/
  // west sides before buildingLayout's rows start at x=+-18; halfZ stayed
  // at 7 since the park starts just 3 units past the old north wall
  // (PARK_Z_START=52 vs the old wall at z=49) and growing north would have
  // walked straight into it. halfZ is also still what safeZone.radius (see
  // the return below) is derived from - Game.js's _updateSafeZoneHeal uses
  // it as a circular heal radius, and keeping it tied to the SMALLER
  // dimension means the heal effect never leaks past the actual walls.
  const halfX = 10
  const halfZ = 7
  const gapHalfWidth = 1.6
  const wallHeight = 3.2

  // Grime-textured (same getFacadeTexture/getSharedBumpTexture pass every
  // outer-zone building already uses) instead of a single flat color - this
  // wall is the very first thing a new player stands next to, and a flat
  // MeshStandardMaterial box read as noticeably cleaner/newer than every
  // other worn surface on the map.
  const wallColor = 0x3a3a34
  const wallMat = LOW_QUALITY_MODE
    ? new THREE.MeshLambertMaterial({ color: wallColor })
    : (() => {
        const facadeTex = getFacadeTexture(wallColor).clone()
        facadeTex.needsUpdate = true
        facadeTex.repeat.set(Math.max(1, (halfX * 2) / 4), Math.max(1, wallHeight / 4))
        const bumpTex = getSharedBumpTexture().clone()
        bumpTex.needsUpdate = true
        bumpTex.repeat.copy(facadeTex.repeat)
        return cachedFlatMaterial({ map: facadeTex, bumpMap: bumpTex, bumpScale: 0.035, roughness: 0.95 })
      })()
  const postMat = cachedFlatMaterial({ color: 0x1c1a16, roughness: 0.8 })
  const sandbagMat = cachedFlatMaterial({ color: 0x5a5138, roughness: 1 })
  const lightMat = cachedFlatMaterial({ color: 0x1a1408, emissive: 0x6fe08a, emissiveIntensity: 1.3 })

  const addWall = (wx, wz, w, d) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallHeight, d), wallMat)
    wall.position.set(x + wx, wallHeight / 2, z + wz)
    wall.castShadow = true
    wall.receiveShadow = true
    scene.add(wall)
    solidMeshes.push(wall)
    colliders.push(new THREE.Box3().setFromObject(wall))
  }

  // Sandbag piles stacked along the base of a wall segment, purely cosmetic
  // (the wall itself is the collider) - breaks up the long flat run and
  // reads as a fortified perimeter rather than a bare box. axisIsX picks
  // which direction the segment's own length runs in.
  const addSandbagRow = (wx, wz, w, d, axisIsX) => {
    const len = axisIsX ? w : d
    const count = Math.max(2, Math.round(len / 1.4))
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1)
      const offset = (t - 0.5) * (len - 0.8)
      const bagX = x + wx + (axisIsX ? offset : 0)
      const bagZ = z + wz + (axisIsX ? 0 : offset)
      const bag = new THREE.Mesh(new THREE.BoxGeometry(axisIsX ? 0.75 : 0.55, 0.5, axisIsX ? 0.55 : 0.75), sandbagMat)
      bag.position.set(bagX, 0.25, bagZ)
      bag.rotation.y = ((i * 37) % 9) * 0.03 - 0.12
      bag.castShadow = true
      bag.receiveShadow = true
      scene.add(bag)
    }
  }

  // Four sides, with a gap left in the -z (south-facing) wall for an
  // entrance - flipped 180 degrees from the original +z (park-facing) gap
  // now that the safe zone sits at the north end: the player approaches
  // from the south (the main street/city), so the entrance should face
  // back the way they came, not toward the park behind it.
  addWall(0, halfZ, halfX * 2, 0.6)
  addSandbagRow(0, halfZ - 0.6, halfX * 2, 0.6, true)
  addWall(-halfX, 0, 0.6, halfZ * 2)
  addSandbagRow(-halfX + 0.6, 0, 0.6, halfZ * 2, false)
  addWall(halfX, 0, 0.6, halfZ * 2)
  addSandbagRow(halfX - 0.6, 0, 0.6, halfZ * 2, false)
  const sideWallLen = halfX - gapHalfWidth
  addWall(-(gapHalfWidth + sideWallLen / 2), -halfZ, sideWallLen, 0.6)
  addWall(gapHalfWidth + sideWallLen / 2, -halfZ, sideWallLen, 0.6)

  // Sandbag-topped watchtower posts flanking the entrance, doubling as the
  // first two guardSpots so the gap is covered from the moment it's built.
  const guardSpots = []
  for (const side of [-1, 1]) {
    const postX = x + side * (gapHalfWidth + 0.5)
    const postZ = z - halfZ + 1.2
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.9), sandbagMat)
    post.position.set(postX, 0.55, postZ)
    post.castShadow = true
    post.receiveShadow = true
    scene.add(post)
    solidMeshes.push(post)
    colliders.push(new THREE.Box3().setFromObject(post))
    guardSpots.push({ x: postX, z: postZ + 0.7 })
  }
  // Third guard further back inside the compound, covering anything that
  // makes it past the gap.
  guardSpots.push({ x: x, z: z + halfZ - 2 })

  // A green glow post at the center - the visual "this spot is safe" tell,
  // matching the heal-while-inside radius Game.js applies around {x, z}.
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.6, 8), postMat)
  beacon.position.set(x, 0.8, z)
  scene.add(beacon)
  const beaconLamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), lightMat)
  beaconLamp.position.set(x, 1.7, z)
  scene.add(beaconLamp)
  const beaconLight = new THREE.PointLight(0x6fe08a, 1.6, 10, 2)
  beaconLight.position.set(x, 1.9, z)
  scene.add(beaconLight)

  // Exit platform + staircase (see World.js's own comment on why the west
  // wall, north half was picked - clear of the Vault at safeZone.x-4).
  // Sits astride the west wall: the platform's own bottom face (y=wallHeight
  // + 0.05) is above the wall's own collider box (0 to wallHeight), so the
  // two never overlap despite occupying the same x - a player walks up the
  // stairs, across the platform, and off its outer edge steps them down
  // outside the wall instead of back inside.
  const platformY = wallHeight + 0.2
  const platformCenterX = x - halfX
  const platformCenterZ = z + 5
  const stepMat = cachedFlatMaterial({ color: 0x4a4438, roughness: 0.85 })
  const platformMat = cachedFlatMaterial({ color: 0x4a4438, roughness: 0.8 })
  const railMat = cachedFlatMaterial({ color: 0x2a2620, roughness: 0.7, metalness: 0.3 })

  const STEP_COUNT = 8
  const stepRise = platformY / STEP_COUNT
  const stepDepth = 0.55
  // Steps run from the interior (a couple units in front of the wall,
  // ground-level) toward the wall, growing taller with each step so the
  // last one is flush with the platform's own height right where it meets
  // it - i=0 is furthest from the wall/shortest, i=STEP_COUNT-1 is closest
  // to the wall/tallest.
  const stepsStartX = platformCenterX + 1.4 + (STEP_COUNT - 1) * stepDepth
  for (let i = 0; i < STEP_COUNT; i++) {
    const stepHeight = stepRise * (i + 1)
    // stepDepth (spacing direction, X) first, 1.6 (the stair's own width,
    // Z) last - each step's own X footprint has to match its X spacing or
    // consecutive steps overlap/clip through each other.
    const step = new THREE.Mesh(new THREE.BoxGeometry(stepDepth, stepHeight, 1.6), stepMat)
    step.position.set(stepsStartX - i * stepDepth, stepHeight / 2, platformCenterZ)
    step.castShadow = true
    step.receiveShadow = true
    scene.add(step)
    solidMeshes.push(step)
    colliders.push(new THREE.Box3().setFromObject(step))
  }

  // Platform's X extent (2.4) is what straddles the wall (the wall's own
  // length runs along Z, at fixed x=-halfX) - centered on the wall, so
  // roughly half sits over the interior side (east, where the stairs meet
  // it) and half extends past the outer wall face (west), making the west
  // edge genuinely outside the compound to step off of.
  const platform = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, 2.6), platformMat)
  platform.position.set(platformCenterX, platformY, platformCenterZ)
  platform.castShadow = true
  platform.receiveShadow = true
  scene.add(platform)
  solidMeshes.push(platform)
  colliders.push(new THREE.Box3().setFromObject(platform))

  // Waist-high rails on the two Z-extremes (the sides running along the
  // direction of travel) - guards against falling off sideways while
  // crossing, but deliberately leaves both X-ends open: the east end is
  // where the stairs connect, the west end is the actual exit edge.
  for (const railZ of [platformCenterZ - 1.2, platformCenterZ + 1.2]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 0.1), railMat)
    rail.position.set(platformCenterX, platformY + 0.55, railZ)
    rail.castShadow = true
    scene.add(rail)
    solidMeshes.push(rail)
    colliders.push(new THREE.Box3().setFromObject(rail))
  }

  // Extra decoration filling the wider footprint (see the widened halfX
  // above) - a handful of crates and a couple of extra lights, echoing the
  // sandbag-and-post language the rest of the compound already uses rather
  // than introducing a new visual style.
  const crateMat = cachedFlatMaterial({ color: 0x5a4a30, roughness: 0.9 })
  const decorLightMat = cachedFlatMaterial({ color: 0x1a1408, emissive: 0x6fe08a, emissiveIntensity: 1.1 })
  const crateSpots = [
    { x: x - 8.5, z: z + 2 },
    { x: x - 8.5, z: z - 2 },
    { x: x + 8.5, z: z - 5 },
  ]
  for (const spot of crateSpots) {
    for (const [ox, oz, s] of [[0, 0, 0.7], [0.55, 0.1, 0.55]]) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat)
      crate.position.set(spot.x + ox, s / 2, spot.z + oz)
      crate.rotation.y = (spot.x * 13.7 + spot.z * 7.3) % 1
      crate.castShadow = true
      crate.receiveShadow = true
      scene.add(crate)
      solidMeshes.push(crate)
      colliders.push(new THREE.Box3().setFromObject(crate))
    }
  }
  for (const lx of [x - 8.5, x + 8.5]) {
    const lampPost = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.2, 8), postMat)
    lampPost.position.set(lx, 1.1, z + 6)
    lampPost.castShadow = true
    scene.add(lampPost)
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), decorLightMat)
    lamp.position.set(lx, 2.25, z + 6)
    scene.add(lamp)
    const lampLight = new THREE.PointLight(0x6fe08a, 1, 7, 2)
    lampLight.position.set(lx, 2.3, z + 6)
    scene.add(lampLight)
  }

  return { x, z, radius: halfZ - 0.5, halfX, halfZ, guardSpots }
}

// Blueprint-locations infrastructure (Phase 0 of the Extended Metropolitan
// Grid plan) - a generic rectangular room with configurable door gaps or
// fully-open sides, generalizing buildSafeZone's own wall-split-with-gap
// math above (see addWall/sideWallLen there) so every future named
// interior (hospital wing, cellblock, lab, retail aisle-room) can call this
// instead of hand-authoring walls from scratch. 'open' sides (no wall at
// all) mirror buildOffice/buildElevatedRoom's alcove pattern instead, for
// rooms that open directly onto a corridor rather than through a door.
const ROOM_WALL_THICKNESS = 0.3

function buildRoom(scene, register, spec) {
  const {
    x, z, w, d,
    wallHeight = 2.6,
    floorY = 0, // lets this same helper build an underground room (e.g. at SUBWAY_FLOOR_Y) instead of only ground-level ones
    doorSides = [], // [{ side: 'north'|'south'|'east'|'west', width }]
    openSides = [], // ['north', ...] - omit these walls entirely
    // LOW_QUALITY_MODE: cheaper Lambert instead of Standard - already flat-
    // colored either way (no texture map here), so this is purely about
    // the lighting-model cost, not appearance.
    wallMat = LOW_QUALITY_MODE
      ? new THREE.MeshLambertMaterial({ color: 0x3a3a34 })
      : cachedFlatMaterial({ color: 0x3a3a34, roughness: 0.95 }),
  } = spec

  const halfW = w / 2
  const halfD = d / 2
  const t = ROOM_WALL_THICKNESS
  const doorWidth = new Map(doorSides.map((ds) => [ds.side, ds.width]))
  const isOpen = (side) => openSides.includes(side)

  // Wall segments (up to 8 per room: 4 sides, up to 2 each around a door
  // gap) get merged into ONE mesh per room instead of one draw call each -
  // see docs/PERFORMANCE.md Option B3. This is the single most-reused
  // wall-building primitive in the game (nearly every building calls it),
  // so it's the highest-leverage merge target. Each segment's own Box3
  // collider is still pushed individually (via register.colliderOnly) so
  // doorway gaps stay walkable - a merged mesh's combined bounding box
  // would otherwise seal them. Geometries are translated relative to the
  // room's own center (x,z) rather than absolute world position, and the
  // merged mesh's own .position is set to that center afterward - same
  // reasoning as A1's InstancedMesh stair flights: _updateCulling reads
  // obj.position directly, and a merged mesh needs ONE sensible
  // representative point for per-object distance culling to still work.
  const wallGeoms = []
  const addWallSeg = (wx, wz, sw, sd) => {
    const geo = new THREE.BoxGeometry(sw, wallHeight, sd)
    geo.translate(wx, wallHeight / 2, wz)
    wallGeoms.push(geo)

    const cx = x + wx
    const cy = floorY + wallHeight / 2
    const cz = z + wz
    register.colliderOnly(new THREE.Box3(
      new THREE.Vector3(cx - sw / 2, cy - wallHeight / 2, cz - sd / 2),
      new THREE.Vector3(cx + sw / 2, cy + wallHeight / 2, cz + sd / 2)
    ))
  }

  if (!isOpen('north')) {
    const gap = doorWidth.get('north')
    if (!gap) {
      addWallSeg(0, halfD, w, t)
    } else {
      const segLen = (w - gap) / 2
      addWallSeg(-(gap / 2 + segLen / 2), halfD, segLen, t)
      addWallSeg(gap / 2 + segLen / 2, halfD, segLen, t)
    }
  }
  if (!isOpen('south')) {
    const gap = doorWidth.get('south')
    if (!gap) {
      addWallSeg(0, -halfD, w, t)
    } else {
      const segLen = (w - gap) / 2
      addWallSeg(-(gap / 2 + segLen / 2), -halfD, segLen, t)
      addWallSeg(gap / 2 + segLen / 2, -halfD, segLen, t)
    }
  }
  if (!isOpen('east')) {
    const gap = doorWidth.get('east')
    if (!gap) {
      addWallSeg(halfW, 0, t, d)
    } else {
      const segLen = (d - gap) / 2
      addWallSeg(halfW, -(gap / 2 + segLen / 2), t, segLen)
      addWallSeg(halfW, gap / 2 + segLen / 2, t, segLen)
    }
  }
  if (!isOpen('west')) {
    const gap = doorWidth.get('west')
    if (!gap) {
      addWallSeg(-halfW, 0, t, d)
    } else {
      const segLen = (d - gap) / 2
      addWallSeg(-halfW, -(gap / 2 + segLen / 2), t, segLen)
      addWallSeg(-halfW, gap / 2 + segLen / 2, t, segLen)
    }
  }

  if (wallGeoms.length > 0) {
    const mergedGeo = mergeGeometries(wallGeoms)
    const wallMesh = new THREE.Mesh(mergedGeo, wallMat)
    wallMesh.position.set(x, floorY, z)
    wallMesh.castShadow = true
    wallMesh.receiveShadow = true
    scene.add(wallMesh)
    register.meshOnly(wallMesh)
  }

  const doorSpots = doorSides.map((ds) => {
    if (ds.side === 'north') return { x, z: z + halfD }
    if (ds.side === 'south') return { x, z: z - halfD }
    if (ds.side === 'east') return { x: x + halfW, z }
    return { x: x - halfW, z }
  })

  return {
    x, z, w, d,
    bounds: new THREE.Box3(
      new THREE.Vector3(x - halfW, floorY, z - halfD),
      new THREE.Vector3(x + halfW, floorY + wallHeight, z + halfD)
    ),
    doorSpots,
  }
}

// Phase 1 of the Extended Metropolitan Grid plan - a real walkable retail
// interior (Supermarket + Grocery Store both call this, just with
// different w/d/aisleRows) built from buildRoom()'s shell plus rows of
// real shelf props the player has to walk around, not through - the first
// named blueprint location, and the first real exercise of Phase 0's
// buildRoom()/Zone infrastructure.
const FOOD_PROP_SCALE = 0.3
const SHELF_UNIT_W = 0.4

const DEFAULT_DRESSING_FILES = ['food-can.glb', 'food-carton.glb', 'food-bottle.glb', 'food-bread.glb', 'food-bag.glb']

function buildRetailStore(scene, register, spec) {
  const {
    x, z, w, d, wallHeight = 4,
    doorSide = 'south', doorWidth = 2.4, rearDoor = false,
    aisleRows = 3, shelfLen = 3.2,
    dressingFiles = DEFAULT_DRESSING_FILES,
  } = spec

  const doorSides = [{ side: doorSide, width: doorWidth }]
  const rearSide = doorSide === 'south' ? 'north' : 'south'
  if (rearDoor) doorSides.push({ side: rearSide, width: doorWidth })

  const room = buildRoom(scene, register, { x, z, w, d, wallHeight, doorSides })

  const floorMat = cachedFlatMaterial({ color: 0xcac6ba, roughness: 0.85 })
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.6, d - 0.6), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(x, 0.02, z)
  floor.receiveShadow = true
  scene.add(floor)

  const shelfModel = _propModelCache.get('shelf.glb')
  const unitsPerRow = Math.max(1, Math.round(shelfLen / SHELF_UNIT_W))
  const rowRunLen = unitsPerRow * SHELF_UNIT_W
  const rowSpacing = (d - 3) / (aisleRows + 1)

  for (let i = 1; i <= aisleRows; i++) {
    const rowZ = z - d / 2 + rowSpacing * i
    const rowGroup = new THREE.Group()

    if (shelfModel) {
      for (let u = 0; u < unitsPerRow; u++) {
        const clone = shelfModel.clone(true)
        clone.position.set(-rowRunLen / 2 + u * SHELF_UNIT_W, 0, 0.125)
        clone.traverse((child) => {
          if (!child.isMesh) return
          child.castShadow = true
          child.receiveShadow = true
          child.material = flattenedClone(child.material)
        })
        rowGroup.add(clone)
      }
    }
    rowGroup.position.set(x, 0, rowZ)
    scene.add(rowGroup)
    register(rowGroup, new THREE.Box3(
      new THREE.Vector3(x - rowRunLen / 2, 0, rowZ),
      new THREE.Vector3(x + rowRunLen / 2, 0.9, rowZ + 0.25)
    ))

    // Food dressing along the row's front face, not on every collider box.
    for (let u = 0; u < unitsPerRow; u += 2) {
      const foodModel = _propModelCache.get(dressingFiles[(i + u) % dressingFiles.length])
      if (!foodModel) continue
      const foodClone = foodModel.clone(true)
      foodClone.scale.setScalar(FOOD_PROP_SCALE)
      foodClone.position.set(x - rowRunLen / 2 + u * SHELF_UNIT_W + 0.2, 0.35, rowZ + 0.13)
      foodClone.traverse((child) => {
        if (!child.isMesh) return
        child.castShadow = true
        child.material = flattenedClone(child.material)
      })
      scene.add(foodClone)
    }
  }

  // Checkout counter just inside the main entrance.
  const counterModel = _propModelCache.get('counter.glb')
  if (counterModel) {
    const counterZ = doorSide === 'south' ? z - d / 2 + 1.3 : z + d / 2 - 1.3
    const counterX = x - w / 2 + 1.1
    const counter = counterModel.clone(true)
    counter.position.set(counterX - 0.36, 0, counterZ - 0.2)
    counter.traverse((child) => {
      if (!child.isMesh) return
      child.castShadow = true
      child.receiveShadow = true
      child.material = flattenedClone(child.material)
    })
    scene.add(counter)
    register(counter, new THREE.Box3(
      new THREE.Vector3(counterX - 0.4, 0, counterZ - 0.4),
      new THREE.Vector3(counterX + 0.4, 0.5, counterZ + 0.05)
    ))
  }

  return room
}

// Stage 2 of the Extended Metropolitan Grid plan - the first real composite
// building: three buildRoom() calls chained end to end (reception ->
// corridor -> ward) with the facing walls left fully open on both sides of
// each join, rather than a single big room - proves buildRoom's alcove
// (openSides) pattern can chain multiple rooms into one walkable interior,
// which every later multi-room location (police station, prison, campus)
// depends on.
function placePropSimple(scene, register, fileName, x, z, rotY = 0, scale = 1, collide = true, floorY = 0) {
  const model = _propModelCache.get(fileName)
  if (!model) return null
  const clone = model.clone(true)
  clone.position.set(x, floorY, z)
  clone.rotation.y = rotY
  if (scale !== 1) clone.scale.setScalar(scale)
  // LOW_QUALITY_MODE: one shared, cheap MeshLambertMaterial for this whole
  // prop instead of a cloned-per-mesh textured PBR material per part - this
  // one function places nearly every piece of furniture/clutter in the
  // game, so it's a very high-leverage single change. Tint comes from the
  // first real sub-mesh's own original color, so different prop types
  // still read as visually distinct, just flat. Callers that recolor the
  // returned clone afterward (e.g. a tinted bookcase) still work normally -
  // they're just setting this one shared material's color instead of many.
  let lowQualityMat = null
  if (LOW_QUALITY_MODE) {
    let firstColor = null
    clone.traverse((child) => {
      if (firstColor === null && child.isMesh && child.material && child.material.color) {
        firstColor = child.material.color.clone()
      }
    })
    lowQualityMat = new THREE.MeshLambertMaterial({ color: firstColor || 0x777770 })
  }
  clone.traverse((child) => {
    if (!child.isMesh) return
    child.castShadow = true
    child.receiveShadow = true
    child.material = lowQualityMat || child.material.clone()
  })
  scene.add(clone)
  if (collide) register(clone)
  return clone
}

function buildHospital(scene, register, x, z) {
  const w = 10
  const receptionD = 6
  const corridorD = 8
  const wardD = 10

  const receptionZ = z
  const corridorZ = receptionZ + receptionD / 2 + corridorD / 2
  const wardZ = corridorZ + corridorD / 2 + wardD / 2

  const reception = buildRoom(scene, register, {
    x, z: receptionZ, w, d: receptionD,
    doorSides: [{ side: 'south', width: 2.4 }],
    openSides: ['north'],
  })
  buildRoom(scene, register, {
    x, z: corridorZ, w, d: corridorD,
    openSides: ['south', 'north'],
  })
  buildRoom(scene, register, {
    x, z: wardZ, w, d: wardD,
    openSides: ['south'],
  })

  const floorMat = cachedFlatMaterial({ color: 0xd8d8d0, roughness: 0.7 })
  const totalD = receptionD + corridorD + wardD
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.6, totalD - 0.6), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(x, 0.02, receptionZ - receptionD / 2 + totalD / 2)
  floor.receiveShadow = true
  scene.add(floor)

  // Reception: a counter + a couple of waiting chairs.
  placePropSimple(scene, register, 'counter.glb', x - 2.5, receptionZ - 1.5, 0)
  placePropSimple(scene, register, 'waiting-chair.glb', x + 1.5, receptionZ + 1, Math.PI, 1, false)
  placePropSimple(scene, register, 'waiting-chair.glb', x + 2.2, receptionZ + 1, Math.PI, 1, false)

  // Corridor: a supply cabinet against the east wall.
  placePropSimple(scene, register, 'medical-cabinet.glb', x + w / 2 - 0.5, corridorZ, -Math.PI / 2)

  // Ward: two beds + a cabinet + a first aid kit on the cabinet.
  placePropSimple(scene, register, 'hospital-bed.glb', x - 3, wardZ - 3, 0)
  placePropSimple(scene, register, 'hospital-bed.glb', x + 1.5, wardZ - 3, 0)
  placePropSimple(scene, register, 'medical-cabinet.glb', x - 3.8, wardZ + 3, 0)
  placePropSimple(scene, register, 'firstaid.glb', x - 3.8, wardZ + 3.15, 0, 0.2, false)

  return { x, z: receptionZ, doorSpots: reception.doorSpots }
}

function buildPharmacy(scene, register, x, z) {
  const w = 8
  const d = 7
  const room = buildRoom(scene, register, {
    x, z, w, d,
    doorSides: [{ side: 'south', width: 2.2 }],
  })

  const floorMat = cachedFlatMaterial({ color: 0xd8d8d0, roughness: 0.7 })
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.6, d - 0.6), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(x, 0.02, z)
  floor.receiveShadow = true
  scene.add(floor)

  placePropSimple(scene, register, 'counter.glb', x, z - d / 2 + 1.4, 0)
  placePropSimple(scene, register, 'medical-cabinet.glb', x - w / 2 + 0.5, z + d / 2 - 1, Math.PI / 2)
  placePropSimple(scene, register, 'medical-cabinet.glb', x + w / 2 - 0.5, z + d / 2 - 1, -Math.PI / 2)
  placePropSimple(scene, register, 'firstaid.glb', x, z - d / 2 + 1.55, 0, 0.2, false)

  return room
}

// Stage 3 - the Gun Shop displays real weapon models (already-existing
// viewmodel GLBs from the Phase 4 weapons pass, not new assets) lying flat
// on its counter as pure decoration, no gameplay hookup - reusing what's
// already on disk instead of sourcing yet another props pack for guns
// specifically.
const GUN_SHOP_DISPLAY_FILES = ['pistol.glb', 'rifle.glb', 'shotgun.glb', 'glock18.glb', 'awp.glb']
let _gunShopModelCache = null

export async function preloadGunShopDisplayModels() {
  const loader = new GLTFLoader()
  _gunShopModelCache = new Map()
  await Promise.all(GUN_SHOP_DISPLAY_FILES.map(async (file) => {
    try {
      const gltf = await loader.loadAsync(`/models/weapons/${file}`)
      _gunShopModelCache.set(file, gltf.scene)
    } catch (err) {
      console.warn(`Gun shop display model failed to load: ${file}`, err)
    }
  }))
}

function buildGunShop(scene, register, x, z) {
  const w = 8
  const d = 7
  const room = buildRoom(scene, register, {
    x, z, w, d,
    doorSides: [{ side: 'south', width: 2.2 }],
  })

  const floorMat = cachedFlatMaterial({ color: 0x3a3630, roughness: 0.75 })
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.6, d - 0.6), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(x, 0.02, z)
  floor.receiveShadow = true
  scene.add(floor)

  placePropSimple(scene, register, 'counter.glb', x, z + d / 2 - 1.3, Math.PI)

  if (_gunShopModelCache) {
    const spots = [
      { file: 'pistol.glb', dx: -1.6, dz: 0 },
      { file: 'rifle.glb', dx: -0.4, dz: 0 },
      { file: 'shotgun.glb', dx: 0.8, dz: 0 },
      { file: 'glock18.glb', dx: 2, dz: 0 },
    ]
    for (const spot of spots) {
      const model = _gunShopModelCache.get(spot.file)
      if (!model) continue
      const clone = model.clone(true)
      clone.rotation.set(0, Math.random() * 0.4 - 0.2, Math.PI / 2)
      clone.position.set(x + spot.dx, 0.55, z + d / 2 - 1.5)
      clone.traverse((child) => {
        if (!child.isMesh) return
        child.castShadow = true
        child.material = flattenedClone(child.material)
      })
      scene.add(clone)
    }
  }

  // Locked display case - a small back room behind the counter with a
  // rarer weapon on display, matching the blueprint's "reinforced
  // structures" legend that Stage 3 originally skipped (the lockedCells
  // mechanism didn't exist yet at the time - see Stage 4/5's own notes).
  const caseW = 4
  const caseD = 3
  const caseZ = z - d / 2 - caseD / 2
  buildRoom(scene, register, {
    x, z: caseZ, w: caseW, d: caseD,
    doorSides: [{ side: 'south', width: 1.6 }],
  })
  const caseFloor = new THREE.Mesh(new THREE.PlaneGeometry(caseW - 0.6, caseD - 0.6), floorMat)
  caseFloor.rotation.x = -Math.PI / 2
  caseFloor.position.set(x, 0.02, caseZ)
  caseFloor.receiveShadow = true
  scene.add(caseFloor)
  if (_gunShopModelCache) {
    const awp = _gunShopModelCache.get('awp.glb')
    if (awp) {
      const clone = awp.clone(true)
      clone.rotation.set(0, 0, Math.PI / 2)
      clone.position.set(x, 0.55, caseZ)
      clone.traverse((child) => {
        if (!child.isMesh) return
        child.castShadow = true
        child.material = flattenedClone(child.material)
      })
      scene.add(clone)
    }
  }
  const caseDoorZ = caseZ + caseD / 2
  const caseDoor = buildLockableDoor(scene, x, caseDoorZ, 1.6, 'x')

  return { ...room, caseDoor }
}

// Shared by Stage 4 (police station, one cell) and Stage 5 (prison, several
// cells) - a solid slab filling a doorway gap, plus a status light matching
// the chest/vault red-locked/green-unlocked convention. 'axis' is which way
// the gap itself runs: 'x' for a door in a north/south-facing wall (gap
// spans the X axis), 'z' for a door in an east/west-facing wall (gap spans
// the Z axis) - prison cells branch off a corridor sideways, so their doors
// need the 'z' orientation the police station's own north-facing cell
// never needed.
function buildLockableDoor(scene, x, z, width, axis = 'x', floorY = 0) {
  const doorMat = cachedFlatMaterial({ color: 0x232320, roughness: 0.6, metalness: 0.5 })
  const dims = axis === 'x' ? [width, 2.6, 0.15] : [0.15, 2.6, width]
  const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(dims[0], dims[1], dims[2]), doorMat)
  doorMesh.position.set(x, floorY + 1.3, z)
  doorMesh.castShadow = true
  scene.add(doorMesh)
  doorMesh.updateWorldMatrix(true, false)
  const doorBox = new THREE.Box3().setFromObject(doorMesh)

  // NOT cachedFlatMaterial - this function is called once per locked door
  // (11+ across the map) and Game.js's _tryOpenLockedCell mutates this
  // per-instance on unlock. Confirmed bug: every locked door was sharing
  // ONE material, so unlocking any single one visually "unlocked" all of
  // them at once.
  const indicatorMat = flatMaterial({ color: 0x1a0505, emissive: 0xff2a1e, emissiveIntensity: 0.9 })
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), indicatorMat)
  const lightOffset = axis === 'x' ? [0, 0.1] : [0.1, 0]
  light.position.set(x + lightOffset[0], floorY + 2.3, z + lightOffset[1])
  scene.add(light)

  return { x, z, floorY, mesh: doorMesh, box: doorBox, indicatorMat }
}

// Stage 4 of the Extended Metropolitan Grid plan - the first real
// "reinforced entry" location. The holding cell's door starts locked (a
// real physical collider blocking the gap, not just a visual), and Game.js
// wires up the actual lock state (see Game.js's lockedCells array/
// _tryOpenLockedCell) reusing the exact same dynamic-collider-removal
// pattern already used for death obstacles (push a Box3 into colliders/
// solidMeshes while locked, splice it back out on unlock) rather than
// building a new removal mechanism from scratch.
function buildPoliceStation(scene, register, x, z) {
  const w = 8
  const receptionD = 6
  const corridorD = 6
  const cellD = 6
  const doorGap = 2.0

  // z is the reception's own center, and it's the NORTH-most (closest to
  // the rest of the map, at z=-100's hardware store) part of this building
  // - the corridor and cell extend further SOUTH into open ground, so the
  // reception's real door faces the direction a player actually arrives
  // from instead of making them walk around the whole building.
  const receptionZ = z
  const corridorZ = receptionZ - receptionD / 2 - corridorD / 2
  const cellZ = corridorZ - corridorD / 2 - cellD / 2

  buildRoom(scene, register, {
    x, z: receptionZ, w, d: receptionD,
    doorSides: [{ side: 'north', width: 2.4 }],
    openSides: ['south'],
  })
  buildRoom(scene, register, {
    x, z: corridorZ, w, d: corridorD,
    openSides: ['south', 'north'],
  })
  // The cell room's north side is deliberately NOT in openSides - it's
  // real solid wall on both sides of the gap the lockable door itself
  // fills, so the door is the only way through, matching a holding cell's
  // actual security feel (a corridor's usual full-open join would defeat
  // the point of "locked").
  buildRoom(scene, register, {
    x, z: cellZ, w, d: cellD,
    doorSides: [{ side: 'north', width: doorGap }],
  })

  const floorMat = cachedFlatMaterial({ color: 0x33342e, roughness: 0.8 })
  const totalD = receptionD + corridorD + cellD
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.6, totalD - 0.6), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(x, 0.02, receptionZ + receptionD / 2 - totalD / 2)
  floor.receiveShadow = true
  scene.add(floor)

  placePropSimple(scene, register, 'counter.glb', x - 2, receptionZ - 1, 0)
  placePropSimple(scene, register, 'waiting-chair.glb', x + 1.8, receptionZ + 1, Math.PI, 1, false)
  // Armor/evidence locker in the corridor - the medical cabinet model
  // re-tinted dark olive instead of medical white, cheaper than sourcing a
  // whole separate police-props pack for one locker shape.
  const lockerModel = placePropSimple(scene, register, 'medical-cabinet.glb', x + w / 2 - 0.5, corridorZ, -Math.PI / 2)
  if (lockerModel) {
    lockerModel.traverse((child) => {
      if (child.isMesh) child.material.color.setHex(0x3a3d2a)
    })
  }
  placePropSimple(scene, register, 'hospital-bed.glb', x - 1.5, cellZ - 1.5, 0)

  // The lockable cell door itself - a solid slab filling the gap in the
  // cell's north wall (facing the corridor), plus a small status light
  // matching the chest/vault red-locked/green-unlocked convention.
  const doorZ = cellZ + cellD / 2
  const cellDoor = buildLockableDoor(scene, x, doorZ, doorGap, 'x')

  return {
    x, z: receptionZ,
    cellDoor,
  }
}

// Open-air structure (no buildRoom shell needed) - sandbag walls flanking a
// barrier gate, same sandbagMat approach buildSafeZone already uses for its
// own watchtower posts, plus a couple of procedural tent shapes (flat-color
// primitives matching this game's established "no texture needed for small
// set-dressing" style, same as the trader stall's tarp awning).
function buildMilitaryCheckpoint(scene, register, x, z) {
  const sandbagMat = cachedFlatMaterial({ color: 0x5a5138, roughness: 1 })
  const tentMat = cachedFlatMaterial({ color: 0x3a4a34, roughness: 0.9 })
  const barrierMat = cachedFlatMaterial({ color: 0xb0331a, roughness: 0.7, metalness: 0.2 })

  for (const side of [-1, 1]) {
    const wallX = x + side * 2.2
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.9), sandbagMat)
    wall.position.set(wallX, 0.45, z)
    wall.castShadow = true
    wall.receiveShadow = true
    scene.add(wall)
    register(wall)
  }

  const barrier = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.12), barrierMat)
  barrier.position.set(x, 0.85, z)
  barrier.castShadow = true
  scene.add(barrier)

  for (const [dx, dz] of [[-3, 2.5], [3, 2.2]]) {
    const tent = new THREE.Group()
    tent.position.set(x + dx, 0, z + dz)
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 2.2), tentMat)
    base.position.y = 0.55
    base.castShadow = true
    base.receiveShadow = true
    tent.add(base)
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.8, 4), tentMat)
    roof.position.y = 1.5
    roof.rotation.y = Math.PI / 4
    roof.castShadow = true
    tent.add(roof)
    scene.add(tent)
    register(base)
  }

  return { x, z }
}

// Stage 5 of the Extended Metropolitan Grid plan - "Prison Complex", the
// stress test for Stage 4's lockable-door mechanic at scale: a narrow
// central corridor with cells branching off alternating sides, each with
// its own real lockable door (via the shared buildLockableDoor helper
// above), instead of one-off single-cell code. Game.js's lockedCells array
// already iterates over N doors and picks whichever is nearest (built that
// way for exactly this kind of reuse), so no Game.js changes are needed to
// support multiple cells - just concatenate this building's cellDoors array
// onto the one from the police station.
function buildPrison(scene, register, x, z) {
  const adminW = 10
  const adminD = 6
  const corridorW = 4
  const corridorD = 14
  const cellSize = 4
  const cellDoorGap = 1.6

  const adminZ = z
  const corridorZ = adminZ - adminD / 2 - corridorD / 2

  buildRoom(scene, register, {
    x, z: adminZ, w: adminW, d: adminD,
    doorSides: [{ side: 'north', width: 2.6 }],
    openSides: ['south'],
  })
  buildRoom(scene, register, {
    x, z: corridorZ, w: corridorW, d: corridorD,
    openSides: ['north'],
  })

  const adminFloorMat = cachedFlatMaterial({ color: 0x33342e, roughness: 0.8 })
  const adminFloor = new THREE.Mesh(new THREE.PlaneGeometry(adminW - 0.6, adminD - 0.6), adminFloorMat)
  adminFloor.rotation.x = -Math.PI / 2
  adminFloor.position.set(x, 0.02, adminZ)
  adminFloor.receiveShadow = true
  scene.add(adminFloor)

  const corridorFloor = new THREE.Mesh(new THREE.PlaneGeometry(corridorW - 0.4, corridorD - 0.4), adminFloorMat)
  corridorFloor.rotation.x = -Math.PI / 2
  corridorFloor.position.set(x, 0.02, corridorZ)
  corridorFloor.receiveShadow = true
  scene.add(corridorFloor)

  placePropSimple(scene, register, 'counter.glb', x - 2.5, adminZ - 1, 0)

  // Watchtower at the entrance - a taller sandbag post than the safe zone's
  // own guard posts, same material/approach, no new asset needed.
  const sandbagMat = cachedFlatMaterial({ color: 0x5a5138, roughness: 1 })
  const tower = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.4, 1.1), sandbagMat)
  tower.position.set(x - adminW / 2 + 1, 1.2, adminZ + adminD / 2 + 1)
  tower.castShadow = true
  scene.add(tower)
  register(tower)

  // Three cells branching off alternating sides of the corridor, each with
  // its own lockable door facing the corridor.
  const cellDoors = []
  const cellSpots = [
    { dz: 4, side: -1 },
    { dz: 0, side: 1 },
    { dz: -4, side: -1 },
  ]
  const corridorHalfW = corridorW / 2
  for (const spot of cellSpots) {
    const cellZ = corridorZ + spot.dz
    const cellX = x + spot.side * (corridorHalfW + cellSize / 2)
    const doorSide = spot.side === -1 ? 'east' : 'west'
    buildRoom(scene, register, {
      x: cellX, z: cellZ, w: cellSize, d: cellSize,
      doorSides: [{ side: doorSide, width: cellDoorGap }],
    })
    const bunk = placePropSimple(scene, register, 'hospital-bed.glb', cellX + spot.side * -0.8, cellZ, spot.side === -1 ? Math.PI / 2 : -Math.PI / 2)
    if (bunk) {
      bunk.traverse((child) => {
        if (child.isMesh) child.material.color.setHex(0x5a5650)
      })
    }
    const doorX = spot.side === -1 ? cellX + cellSize / 2 : cellX - cellSize / 2
    cellDoors.push(buildLockableDoor(scene, doorX, cellZ, cellDoorGap, 'z'))
  }

  return { x, z: adminZ, cellDoors }
}

// Stage 6 of the Extended Metropolitan Grid plan - "Abandoned University
// Campus": entrance + hallway with three distinct sub-themed alcove rooms
// (Biology Lab, Library, Cafeteria) opening directly onto the hallway via
// buildRoom's openSides (the buildOffice/buildElevatedRoom alcove pattern),
// not through doors - three different dressings on the same composition
// pattern, no new gameplay mechanic needed this stage.
function buildUniversity(scene, register, x, z) {
  const entranceW = 8
  const entranceD = 5
  const hallwayW = 4
  const hallwayD = 16

  const entranceZ = z
  const hallwayZ = entranceZ + entranceD / 2 + hallwayD / 2

  buildRoom(scene, register, {
    x, z: entranceZ, w: entranceW, d: entranceD,
    doorSides: [{ side: 'south', width: 2.6 }],
    openSides: ['north'],
  })
  buildRoom(scene, register, {
    x, z: hallwayZ, w: hallwayW, d: hallwayD,
    openSides: ['south'],
  })

  const floorMat = cachedFlatMaterial({ color: 0xc8c4b8, roughness: 0.8 })
  const entranceFloor = new THREE.Mesh(new THREE.PlaneGeometry(entranceW - 0.6, entranceD - 0.6), floorMat)
  entranceFloor.rotation.x = -Math.PI / 2
  entranceFloor.position.set(x, 0.02, entranceZ)
  entranceFloor.receiveShadow = true
  scene.add(entranceFloor)
  const hallwayFloor = new THREE.Mesh(new THREE.PlaneGeometry(hallwayW - 0.4, hallwayD - 0.4), floorMat)
  hallwayFloor.rotation.x = -Math.PI / 2
  hallwayFloor.position.set(x, 0.02, hallwayZ)
  hallwayFloor.receiveShadow = true
  scene.add(hallwayFloor)

  const hallwayHalfW = hallwayW / 2
  const roomFloorMat = cachedFlatMaterial({ color: 0xd0ccc0, roughness: 0.75 })
  const buildAlcove = (roomZ, side, w, d, dressing) => {
    const roomX = x + side * (hallwayHalfW + w / 2)
    buildRoom(scene, register, {
      x: roomX, z: roomZ, w, d,
      openSides: [side === -1 ? 'east' : 'west'],
    })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.6, d - 0.6), roomFloorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(roomX, 0.02, roomZ)
    floor.receiveShadow = true
    scene.add(floor)
    dressing(roomX, roomZ)
  }

  // Biology Lab - west side, lab benches (reusing the counter prop) + an
  // equipment cabinet re-tinted lab-blue instead of medical white.
  buildAlcove(hallwayZ - 4.5, -1, 7, 6, (rx, rz) => {
    placePropSimple(scene, register, 'counter.glb', rx - 1.5, rz - 1.5, 0)
    placePropSimple(scene, register, 'counter.glb', rx - 1.5, rz + 1, 0)
    const cabinet = placePropSimple(scene, register, 'medical-cabinet.glb', rx + 2.5, rz, -Math.PI / 2)
    if (cabinet) cabinet.traverse((c) => { if (c.isMesh) c.material.color.setHex(0x2a4a5a) })
  })

  // Library - east side, bookcases along the back wall + books on a table.
  buildAlcove(hallwayZ, 1, 7, 7, (rx, rz) => {
    placePropSimple(scene, register, 'campus-bookcase.glb', rx + 2.7, rz - 2, -Math.PI / 2)
    placePropSimple(scene, register, 'campus-bookcase.glb', rx + 2.7, rz + 1, -Math.PI / 2)
    placePropSimple(scene, register, 'campus-table.glb', rx - 1, rz, 0)
    placePropSimple(scene, register, 'campus-books.glb', rx - 1, rz + 0.33, 0, 1, false)
  })

  // Cafeteria - west side, tables + chairs.
  buildAlcove(hallwayZ + 4.5, -1, 8, 7, (rx, rz) => {
    for (const [tx, tz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) {
      placePropSimple(scene, register, 'campus-table.glb', rx + tx, rz + tz, 0)
      placePropSimple(scene, register, 'waiting-chair.glb', rx + tx, rz + tz - 0.8, 0, 1, false)
    }
  })

  return { x, z: entranceZ }
}

function buildHelipadTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#2a2a26'
  ctx.fillRect(0, 0, 256, 256)
  ctx.strokeStyle = '#e3c23c'
  ctx.lineWidth = 10
  ctx.beginPath()
  ctx.arc(128, 128, 110, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#e3c23c'
  ctx.font = 'bold 140px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('H', 128, 138)
  return new THREE.CanvasTexture(canvas)
}

// Stage 8 of the Extended Metropolitan Grid plan - "Skyscraper (helipad +
// civil defense bunker)". Reuses the core map's own buildSkyscraper (3
// floors + interior stairwell) unmodified, adding one more stair flight up
// to a rooftop (same flat-slab + 3-side-guardrail pattern buildFireEscape
// already uses for its own roof) with a helipad marking, plus a small
// ground-floor bunker room with a real lockable door - the same
// buildLockableDoor/Game.js lockedCells mechanism from Stage 4/5, just its
// third use rather than a new mechanism.
function buildOfficeSkyscraper(scene, colliders, solidMeshes, register, x, z, towerChestSpots, flickerLights) {
  const w = 14
  const d = 14
  const h = SKYSCRAPER_FLOOR_H * SKYSCRAPER_FLOORS
  const spec = { x, z, w, d, h }
  buildSkyscraper(scene, colliders, solidMeshes, spec, towerChestSpots)

  // Rooftop - one more flight up from floor 2's landing, same stripCenterX
  // convention buildSkyscraper's own interior stairs use.
  const facingSign = x < 0 ? 1 : -1
  const faceX = x + facingSign * (w / 2)
  const stripInnerX = faceX - facingSign * SKYSCRAPER_STRIP_WIDTH
  const stripCenterX = (faceX + stripInnerX) / 2
  const floor2Y = (SKYSCRAPER_FLOORS - 1) * SKYSCRAPER_FLOOR_H

  buildStairFlight(scene, solidMeshes, stripCenterX, z - d / 2 + 0.6, floor2Y, stripCenterX, z + d / 2 - 0.6, h, 14)

  const roofMat = cachedFlatMaterial({ color: 0x2e2a24, roughness: 0.9 })
  const railMat = cachedFlatMaterial({ color: 0x1c1a16, roughness: 0.7, metalness: 0.5 })
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), roofMat)
  roof.position.set(x, h - 0.15, z)
  roof.castShadow = true
  roof.receiveShadow = true
  scene.add(roof)
  solidMeshes.push(roof) // walkable, intentionally not a horizontal collider

  const railSpecs = [
    { rw: w, rd: 0.15, rx: x, rz: z - d / 2 },
    { rw: w, rd: 0.15, rx: x, rz: z + d / 2 },
    { rw: 0.15, rd: d, rx: x - facingSign * (w / 2), rz: z },
  ]
  for (const s of railSpecs) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(s.rw, 0.9, s.rd), railMat)
    rail.position.set(s.rx, h + 0.45, s.rz)
    rail.castShadow = true
    scene.add(rail)
    colliders.push(new THREE.Box3().setFromObject(rail))
    solidMeshes.push(rail)
  }

  const helipadMat = cachedFlatMaterial({ map: buildHelipadTexture(), roughness: 0.8 })
  const helipad = new THREE.Mesh(new THREE.CircleGeometry(3.2, 24), helipadMat)
  helipad.rotation.x = -Math.PI / 2
  helipad.position.set(x, h + 0.01, z)
  scene.add(helipad)

  // Civil defense bunker - a small reinforced room attached to the ground
  // floor's blind side, with a real lockable door.
  const bunkerW = 5
  const bunkerD = 5
  const bunkerX = x - facingSign * (w / 2 + bunkerW / 2)
  // Bunker sits on the blind side (opposite the entrance facade), so its
  // door needs to face back toward the skyscraper, not away from it -
  // that's the +facingSign direction from the bunker's own position.
  const bunkerDoorSide = facingSign === 1 ? 'east' : 'west'
  // Stage 13 ties back to this bunker with a second, unlocked doorway on the
  // FAR side (away from the skyscraper) - reaching the bunker at all was
  // already gated by bunkerDoor below, so this doesn't need its own lock too.
  const hiddenDoorSide = bunkerDoorSide === 'west' ? 'east' : 'west'
  buildRoom(scene, register, {
    x: bunkerX, z, w: bunkerW, d: bunkerD,
    doorSides: [{ side: bunkerDoorSide, width: 1.8 }, { side: hiddenDoorSide, width: 1.6 }],
  })
  const bunkerFloorMat = cachedFlatMaterial({ color: 0x2a2c28, roughness: 0.85 })
  const bunkerFloor = new THREE.Mesh(new THREE.PlaneGeometry(bunkerW - 0.6, bunkerD - 0.6), bunkerFloorMat)
  bunkerFloor.rotation.x = -Math.PI / 2
  bunkerFloor.position.set(bunkerX, 0.02, z)
  bunkerFloor.receiveShadow = true
  scene.add(bunkerFloor)
  const cabinet = placePropSimple(scene, register, 'medical-cabinet.glb', bunkerX, z - bunkerD / 2 + 0.5, 0)
  if (cabinet) cabinet.traverse((c) => { if (c.isMesh) c.material.color.setHex(0x4a4a2a) })

  const bunkerDoorX = bunkerDoorSide === 'west' ? bunkerX - bunkerW / 2 : bunkerX + bunkerW / 2
  const bunkerDoor = buildLockableDoor(scene, bunkerDoorX, z, 1.8, 'z')

  const hiddenDoorX = hiddenDoorSide === 'west' ? bunkerX - bunkerW / 2 : bunkerX + bunkerW / 2
  const hiddenComplex = buildHiddenComplex(scene, colliders, solidMeshes, register, flickerLights, hiddenDoorX, z, hiddenDoorSide, towerChestSpots)

  return { x, z, bunkerDoor, hiddenComplex }
}

// Stage 13 of the Extended Metropolitan Grid plan - a separate hidden
// complex (parking garage + catacombs + speakeasy), reached only through
// Stage 8's civil defense bunker rather than its own surface entrance -
// "ties back to the bunker" per the plan. Genuinely the least new plumbing
// of any stage so far (as the plan itself predicted): buildRoom (with the
// floorY param added for Stage 10's breaker alcove) for every room,
// buildStairFlight for the descent, buildLockableDoor/Game.js's lockedCells
// for the speakeasy's locked entry (its guaranteed-good lootWeights mirrors
// the Bank vault's). Runs along X instead of Z (every other underground
// stage's convention) since the bunker's hidden door already faces
// east/west - dirSign lets this work regardless of which side that door
// ends up on rather than hardcoding a direction.
function buildHiddenComplex(scene, colliders, solidMeshes, register, flickerLights, doorX, z, doorSide, chestSpots) {
  const dirSign = doorSide === 'east' ? 1 : -1
  const floorY = -4.6 // "Level -1" depth convention, though otherwise unconnected to the actual subway network
  const wallHeight = 2.6 // matches buildRoom's own default

  const shaftMat = cachedFlatMaterial({ color: 0x2c2c2a, roughness: 0.95 })
  const SHAFT_RUN = 16
  const STAIR_RUN = 8
  const shaftX0 = doorX
  const shaftX1 = doorX + dirSign * SHAFT_RUN
  const stairX1 = doorX + dirSign * STAIR_RUN
  const shaftHalfDepth = 1.6
  const shaftCenterY = (wallHeight + floorY) / 2
  const shaftHeight = wallHeight - floorY
  const shaftCenterX = (shaftX0 + shaftX1) / 2

  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(SHAFT_RUN + 0.4, shaftHeight, 0.2), shaftMat)
    wall.position.set(shaftCenterX, shaftCenterY, z + side * shaftHalfDepth)
    wall.castShadow = true
    wall.receiveShadow = true
    scene.add(wall)
    solidMeshes.push(wall)
    colliders.push(new THREE.Box3().setFromObject(wall)) // axis-aligned, not rotated - safe
  }
  const shaftCeiling = new THREE.Mesh(new THREE.BoxGeometry(SHAFT_RUN + 0.4, 0.2, shaftHalfDepth * 2 + 0.4), shaftMat)
  shaftCeiling.position.set(shaftCenterX, wallHeight, z)
  scene.add(shaftCeiling)
  solidMeshes.push(shaftCeiling)
  colliders.push(new THREE.Box3().setFromObject(shaftCeiling))

  buildStairFlight(scene, solidMeshes, shaftX0, z, 0, stairX1, z, floorY, 10)
  // Flat landing floor for the remainder of the shaft, past the last step.
  const flatFloor = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(shaftX1 - stairX1), 0.08, shaftHalfDepth * 2), shaftMat)
  flatFloor.position.set((stairX1 + shaftX1) / 2, floorY, z)
  flatFloor.receiveShadow = true
  scene.add(flatFloor)
  solidMeshes.push(flatFloor)

  const stairLight = new THREE.PointLight(0xd9c48a, 0.7, 8, 2)
  stairLight.position.set(shaftCenterX, shaftCenterY + 1, z)
  scene.add(stairLight)
  flickerLights.push({ light: stairLight, base: 0.7, seed: Math.random() * 100 })

  // Parking garage - reuses buildRoom's own wall/door-gap machinery, just
  // underground (its floorY param), like every other retail/office interior
  // this session, rather than a bespoke shell.
  const garageMat = cachedFlatMaterial({ color: 0x35342f, roughness: 0.9 })
  const garageW = 24
  const garageD = 18
  const garageX = shaftX1 + dirSign * (garageW / 2)
  const garageNearSide = dirSign === 1 ? 'west' : 'east'
  const garageFarSide = dirSign === 1 ? 'east' : 'west'
  buildRoom(scene, register, {
    x: garageX, z, w: garageW, d: garageD, floorY, wallMat: garageMat,
    doorSides: [{ side: garageNearSide, width: 3.4 }, { side: garageFarSide, width: 2.6 }],
  })
  const garageFloorMat = cachedFlatMaterial({ color: 0x28271f, roughness: 1 })
  const garageFloor = new THREE.Mesh(new THREE.PlaneGeometry(garageW - 0.6, garageD - 0.6), garageFloorMat)
  garageFloor.rotation.x = -Math.PI / 2
  garageFloor.position.set(garageX, floorY + 0.02, z)
  garageFloor.receiveShadow = true
  scene.add(garageFloor)
  // Ground-level floors elsewhere in this file skip this push and still
  // work, because _sampleGroundHeight's "nothing found" fallback (0)
  // happens to equal their real height anyway - that coincidence doesn't
  // hold underground (floorY=-4.6 here), so this one actually needs it.
  solidMeshes.push(garageFloor)
  const garageCeiling = new THREE.Mesh(new THREE.BoxGeometry(garageW, 0.2, garageD), garageMat)
  garageCeiling.position.set(garageX, floorY + wallHeight, z)
  scene.add(garageCeiling)
  solidMeshes.push(garageCeiling)
  colliders.push(new THREE.Box3().setFromObject(garageCeiling))

  // Support pillars, painted parking-space lines, and a few abandoned cars
  // (simple box shapes matching Vehicle.js's own chassis/cabin proportions,
  // just duller/rustier - not the actual drivable Vehicle class, this is
  // static dressing only) so the room reads as a real garage, not an empty
  // box underground.
  const pillarMat = cachedFlatMaterial({ color: 0x2a2924, roughness: 0.95 })
  for (const [px, pz] of [[-7, -5], [-7, 5], [7, -5], [7, 5]]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, wallHeight, 0.6), pillarMat)
    pillar.position.set(garageX + px, floorY + wallHeight / 2, z + pz)
    pillar.castShadow = true
    scene.add(pillar)
    solidMeshes.push(pillar)
    colliders.push(new THREE.Box3().setFromObject(pillar))
  }
  const lineMat = cachedFlatMaterial({ color: 0xd9d4c4, roughness: 0.8, emissive: 0xd9d4c4, emissiveIntensity: 0.05 })
  for (const lx of [-9, -3, 3, 9]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.15, garageD - 3), lineMat)
    line.rotation.x = -Math.PI / 2
    line.position.set(garageX + lx, floorY + 0.03, z)
    scene.add(line)
  }
  const carBodyMat = cachedFlatMaterial({ color: 0x5a4a3a, roughness: 0.7, metalness: 0.2 })
  const carCabinMat = cachedFlatMaterial({ color: 0x2a2624, roughness: 0.6 })
  for (const [cx, cz, rot] of [[-6, -2, 0], [6, 3, Math.PI]]) {
    const car = new THREE.Group()
    car.position.set(garageX + cx, floorY, z + cz)
    car.rotation.y = rot
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 4), carBodyMat)
    body.position.y = 0.55
    body.castShadow = true
    car.add(body)
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2), carCabinMat)
    cabin.position.set(0, 1.05, -0.3)
    cabin.castShadow = true
    car.add(cabin)
    scene.add(car)
    // Explicit axis-aligned collider from the known chassis footprint
    // rather than Box3().setFromObject() on this rotated group - the
    // rotated-mesh AABB gotcha, same reasoning as the park bench earlier
    // this session.
    const facingSideways = Math.abs(Math.sin(rot)) > 0.5
    const halfX = facingSideways ? 2 : 0.9
    const halfZ = facingSideways ? 0.9 : 2
    colliders.push(new THREE.Box3(
      new THREE.Vector3(garageX + cx - halfX, floorY, z + cz - halfZ),
      new THREE.Vector3(garageX + cx + halfX, floorY + 1.3, z + cz + halfZ)
    ))
    solidMeshes.push(body)
  }
  const garageLight1 = new THREE.PointLight(0xd9c48a, 0.7, 10, 2)
  garageLight1.position.set(garageX - 6, floorY + wallHeight - 0.3, z)
  scene.add(garageLight1)
  flickerLights.push({ light: garageLight1, base: 0.7, seed: Math.random() * 100 })
  const garageLight2 = new THREE.PointLight(0xd9c48a, 0.7, 10, 2)
  garageLight2.position.set(garageX + 6, floorY + wallHeight - 0.3, z)
  scene.add(garageLight2)
  flickerLights.push({ light: garageLight2, base: 0.7, seed: Math.random() * 100 })

  // A findable-but-not-gated chest, clear of the pillars/cars - the
  // speakeasy's locked door further in is the complex's real payoff.
  chestSpots.push({ x: garageX - 10, y: floorY, z: z + 3 })

  // Catacombs - a narrower, older, colder corridor (stone instead of the
  // garage's concrete) with a couple of alcove niches, leading to the
  // locked speakeasy door at the far end.
  const catacombX0 = garageX + dirSign * (garageW / 2)
  const CATACOMB_RUN = 24
  const catacombX1 = catacombX0 + dirSign * CATACOMB_RUN
  const catacombWidth = 3.2
  const catacombHeight = 2.4
  const stoneMat = cachedFlatMaterial({ color: 0x4a463e, roughness: 1 })
  const catacombFloorMat = cachedFlatMaterial({ color: 0x38352e, roughness: 1 })
  const catacombCenterX = (catacombX0 + catacombX1) / 2

  const catacombFloor = new THREE.Mesh(new THREE.BoxGeometry(CATACOMB_RUN, 0.08, catacombWidth), catacombFloorMat)
  catacombFloor.position.set(catacombCenterX, floorY, z)
  catacombFloor.receiveShadow = true
  scene.add(catacombFloor)
  solidMeshes.push(catacombFloor)

  const catacombCeiling = new THREE.Mesh(new THREE.BoxGeometry(CATACOMB_RUN, 0.2, catacombWidth + 0.4), stoneMat)
  catacombCeiling.position.set(catacombCenterX, floorY + catacombHeight, z)
  catacombCeiling.castShadow = true
  scene.add(catacombCeiling)
  solidMeshes.push(catacombCeiling)
  colliders.push(new THREE.Box3().setFromObject(catacombCeiling))

  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(CATACOMB_RUN, catacombHeight, 0.2), stoneMat)
    wall.position.set(catacombCenterX, floorY + catacombHeight / 2, z + side * (catacombWidth / 2 + 0.1))
    wall.castShadow = true
    wall.receiveShadow = true
    scene.add(wall)
    solidMeshes.push(wall)
    colliders.push(new THREE.Box3().setFromObject(wall))
  }

  // Alcove niches (small recessed urn/skull dressing, purely visual - not
  // colliders, they sit flush against the wall out of the walkable path).
  const urnMat = cachedFlatMaterial({ color: 0x5a5648, roughness: 0.9 })
  for (const [t, side] of [[0.3, -1], [0.65, 1]]) {
    const nicheX = catacombX0 + dirSign * (CATACOMB_RUN * t)
    const urn = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.4, 10), urnMat)
    urn.position.set(nicheX, floorY + 0.5, z + side * (catacombWidth / 2 - 0.15))
    urn.castShadow = true
    scene.add(urn)
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), urnMat)
    skull.position.set(nicheX + 0.35, floorY + 0.35, z + side * (catacombWidth / 2 - 0.15))
    scene.add(skull)
  }

  const catacombLight = new THREE.PointLight(0x8a7a5a, 0.55, 8, 2)
  catacombLight.position.set(catacombCenterX, floorY + catacombHeight - 0.3, z)
  scene.add(catacombLight)
  flickerLights.push({ light: catacombLight, base: 0.55, seed: Math.random() * 100 })

  // Speakeasy - the hidden reward room, warm amber lighting instead of the
  // catacombs' cold stone tone, gated by the complex's one lock (reaching
  // the bunker at all was already gated, so nothing else in this complex
  // needed its own lock too - see buildOfficeSkyscraper's own comment).
  const speakeasyDoorX = catacombX1
  const speakeasyDoor = buildLockableDoor(scene, speakeasyDoorX, z, catacombWidth - 0.6, 'z', floorY)

  const speakeasyW = 12
  const speakeasyD = 10
  const speakeasyX = catacombX1 + dirSign * (speakeasyW / 2)
  const speakeasyMat = cachedFlatMaterial({ color: 0x3a2a1e, roughness: 0.85 })
  buildRoom(scene, register, {
    x: speakeasyX, z, w: speakeasyW, d: speakeasyD, floorY, wallMat: speakeasyMat,
    doorSides: [], openSides: [dirSign === 1 ? 'west' : 'east'], // the lockable door slab above already covers this gap
  })
  const speakeasyFloorMat = cachedFlatMaterial({ color: 0x2e2116, roughness: 0.8 })
  const speakeasyFloor = new THREE.Mesh(new THREE.PlaneGeometry(speakeasyW - 0.6, speakeasyD - 0.6), speakeasyFloorMat)
  speakeasyFloor.rotation.x = -Math.PI / 2
  speakeasyFloor.position.set(speakeasyX, floorY + 0.02, z)
  speakeasyFloor.receiveShadow = true
  scene.add(speakeasyFloor)
  solidMeshes.push(speakeasyFloor) // see garageFloor's own comment above - underground floors need this explicitly
  const speakeasyCeiling = new THREE.Mesh(new THREE.BoxGeometry(speakeasyW, 0.2, speakeasyD), speakeasyMat)
  speakeasyCeiling.position.set(speakeasyX, floorY + wallHeight, z)
  scene.add(speakeasyCeiling)
  solidMeshes.push(speakeasyCeiling)
  colliders.push(new THREE.Box3().setFromObject(speakeasyCeiling))

  // Bar counter (reuses Stage 1's counter.glb) + a back shelf lined with
  // "bottles" (simple colored cylinders - no new asset needed for these).
  const barX = speakeasyX + dirSign * (speakeasyW / 2 - 1.6)
  placePropSimple(scene, register, 'counter.glb', barX, z, dirSign === 1 ? -Math.PI / 2 : Math.PI / 2, 1, true, floorY)
  const bottleMat = cachedFlatMaterial({ color: 0x2a5a3a, roughness: 0.3, metalness: 0.1 })
  for (let i = 0; i < 5; i++) {
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.32, 8), bottleMat)
    bottle.position.set(barX + dirSign * 0.6, floorY + 1.05, z - 1.5 + i * 0.7)
    scene.add(bottle)
  }
  const speakeasyLight = new THREE.PointLight(0xffb347, 1, 9, 2)
  speakeasyLight.position.set(speakeasyX, floorY + wallHeight - 0.4, z)
  scene.add(speakeasyLight)
  flickerLights.push({ light: speakeasyLight, base: 1, seed: Math.random() * 100 })

  // No separate towerChestSpots entry here - unlike a plain room, this one
  // is gated by speakeasyDoor, whose own guaranteed-good lootWeights
  // (set in buildWorld's main body, matching bank.vaultDoor's own pattern)
  // spawns the reward chest via Game.js's _tryOpenLockedCell on unlock.

  return {
    garageSpot: { x: garageX, z },
    catacombSpot: { x: catacombCenterX, z },
    speakeasyDoor,
    speakeasySpot: { x: speakeasyX, z },
    floorY,
  }
}

// Stage 9 of the Extended Metropolitan Grid plan - "Mega-Mall": Stage 1's
// retail-store pattern rerun at bigger scale, three separate anchor stores
// sharing one open plaza instead of one flat re-roll of a single store.
// Composition/scale exercise only, per the plan's own framing - no new
// system, just buildRetailStore called 3 times with different dressing.
function buildMegaMall(scene, register, x, z) {
  const plazaZ = z
  const storesZ = z - 15

  const stores = [
    { dx: -20, w: 14, d: 11, aisleRows: 3, shelfLen: 3.6, dressingFiles: DEFAULT_DRESSING_FILES, loot: null, id: 'mall-food' },
    { dx: 0, w: 12, d: 10, aisleRows: 2, shelfLen: 3, dressingFiles: ['tool-hammer.glb', 'tool-crowbar.glb', 'tool-tireiron.glb'], loot: 'weapon', id: 'mall-hardware' },
    { dx: 20, w: 12, d: 10, aisleRows: 2, shelfLen: 3, dressingFiles: DEFAULT_DRESSING_FILES, loot: 'retail', id: 'mall-general' },
  ]

  const chestSpots = []
  for (const store of stores) {
    const sx = x + store.dx
    buildRetailStore(scene, register, {
      x: sx, z: storesZ, w: store.w, d: store.d,
      aisleRows: store.aisleRows, shelfLen: store.shelfLen,
      dressingFiles: store.dressingFiles,
    })
    chestSpots.push({ x: sx, z: storesZ + 3, id: store.id, loot: store.loot })
  }

  // Shared open plaza south of the stores - paved ground, benches, and a
  // couple of streetlights, no walls at all (it's the mall's own "common
  // area", not another enclosed room).
  const plazaMat = cachedFlatMaterial({ color: 0xb8b0a0, roughness: 0.75 })
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(52, 20), plazaMat)
  plaza.rotation.x = -Math.PI / 2
  plaza.position.set(x, 0.015, plazaZ)
  plaza.receiveShadow = true
  scene.add(plaza)

  const benchModel = _propModelCache.get('bench.glb')
  for (const bx of [-10, 10]) {
    if (!benchModel) break
    const clone = benchModel.clone(true)
    clone.position.set(x + bx, 0, plazaZ + 5)
    clone.rotation.y = Math.PI
    clone.traverse((child) => {
      if (!child.isMesh) return
      child.castShadow = true
      child.material = flattenedClone(child.material)
    })
    scene.add(clone)
  }

  return { x, z: plazaZ, chestSpots }
}

// A paved connecting path between two nearby locations, plus a couple of
// streetlights along it - the blueprint draws the Skyscraper and Mega-Mall
// as one combined complex sharing a spot; they were built as two separate
// standalone buildings, so this closes that visual gap without needing to
// rebuild either one. Straight-line only (both current uses share an x),
// same "paved strip + streetlights" idea buildPark's own path already uses.
// Cosmetic-only "Emergency Hatch" marker (a manhole-style disc set flush
// into the ground) hinting at the coming underground network (subway/
// sewer/mine tunnels, Stages 10-12 of the plan) before it actually exists -
// purely decorative, not registered as a collider or interactable, so
// there's nothing to accidentally imply is functional yet.
function buildSignPlankTexture(lines) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#3a3226'
  ctx.fillRect(0, 0, 256, 64)
  ctx.strokeStyle = '#1c1a16'
  ctx.lineWidth = 4
  ctx.strokeRect(2, 2, 252, 60)
  ctx.fillStyle = '#e8dcc0'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 22px sans-serif'
  ctx.fillText(lines[0], 128, lines[1] ? 22 : 32)
  if (lines[1]) {
    ctx.font = '15px sans-serif'
    ctx.fillText(lines[1], 128, 46)
  }
  return new THREE.CanvasTexture(canvas)
}

// A single signpost near the safe zone entrance with one plank per
// direction, naming the new locations that way and roughly how far -
// wayfinding for a map that's now 750x750 with named locations 100-250
// units apart, without needing the compass fix above to be the only cue.
function buildDirectionalSignpost(scene, x, z) {
  const postMat = cachedFlatMaterial({ color: 0x2a1f16, roughness: 0.9 })
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.6, 8), postMat)
  post.position.set(x, 1.3, z)
  post.castShadow = true
  scene.add(post)

  const arms = [
    { rotY: 0, lines: ['N: Campus, Suburbs'] },
    { rotY: Math.PI / 2, lines: ['E: Hospital, Mall,', 'Skyscraper, Shops'] },
    { rotY: Math.PI, lines: ['S: Prison, Checkpoint'] },
    { rotY: -Math.PI / 2, lines: ['W: Residential'] },
  ]
  let y = 2.2
  for (const arm of arms) {
    const plankMat = cachedFlatMaterial({ map: buildSignPlankTexture(arm.lines), roughness: 0.8 })
    const plank = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.33), plankMat)
    plank.position.set(x + Math.sin(arm.rotY) * 0.66, y, z + Math.cos(arm.rotY) * 0.66)
    plank.rotation.y = arm.rotY
    scene.add(plank)
    y -= 0.4
  }
}

// "Finish the set" additions requested after Stage 9 - Warehouse gives the
// industrial zone the same real-content treatment commercial/residential/
// suburbs already got (it was the one outer zone left as pure decorative
// shells). One big open room + scattered industrial props already on disk
// (barrel/cabledrum/waterbarrel from Phase 5, tools from Stage 3) rather
// than sourcing anything new, plus a locked storage cage - the 7th use of
// the buildLockableDoor/lockedCells mechanism.
function buildWarehouse(scene, register, x, z) {
  const w = 20
  const d = 16
  buildRoom(scene, register, {
    x, z, w, d,
    doorSides: [{ side: 'north', width: 3.2 }],
    wallHeight: 4.5,
  })

  const floorMat = cachedFlatMaterial({ color: 0x3a3a34, roughness: 0.9 })
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.6, d - 0.6), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(x, 0.02, z)
  floor.receiveShadow = true
  scene.add(floor)

  const dressingSpots = [
    ['barrel.glb', -7, -5], ['barrel.glb', -6, -5.8], ['cabledrum.glb', -7, 2],
    ['waterbarrel.glb', -6, 4], ['barrel.glb', 6, -5], ['cabledrum.glb', 7, -4],
  ]
  for (const [file, dx, dz] of dressingSpots) {
    const model = _propModelCache.get(file)
    if (!model) continue
    const clone = model.clone(true)
    clone.position.set(x + dx, 0, z + dz)
    clone.traverse((child) => {
      if (!child.isMesh) return
      child.castShadow = true
      child.receiveShadow = true
      child.material = flattenedClone(child.material)
    })
    scene.add(clone)
  }
  for (const [dx, dz, rot] of [[8, 4, 0], [8, 5.4, 0], [8, 6.8, 0]]) {
    const toolFile = ['tool-hammer.glb', 'tool-crowbar.glb', 'tool-tireiron.glb'][Math.floor(dz) % 3]
    placePropSimple(scene, register, toolFile, x + dx, z + dz, rot, 1, false)
  }

  // Locked storage cage in the back corner.
  const cageW = 5
  const cageD = 5
  const cageX = x + w / 2 - cageW / 2 - 1
  const cageZ = z + d / 2 - cageD / 2 - 1
  buildRoom(scene, register, {
    x: cageX, z: cageZ, w: cageW, d: cageD, wallHeight: 2.6,
    doorSides: [{ side: 'west', width: 1.8 }],
  })
  const cageDoorX = cageX - cageW / 2
  const cageDoor = buildLockableDoor(scene, cageDoorX, cageZ, 1.8, 'z')

  return { x, z, cageDoor }
}

// Gas Station - not in the blueprint, added as a classic small zombie-game
// staple. Tiny convenience-store room + two procedural fuel pumps out
// front, reusing fuelcan.glb/barrel.glb for dressing rather than sourcing
// anything new.
function buildGasStation(scene, register, x, z) {
  const w = 8
  const d = 6
  buildRoom(scene, register, {
    x, z, w, d,
    doorSides: [{ side: 'south', width: 2.2 }],
  })
  const floorMat = cachedFlatMaterial({ color: 0xc4c0b0, roughness: 0.8 })
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.6, d - 0.6), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(x, 0.02, z)
  floor.receiveShadow = true
  scene.add(floor)
  placePropSimple(scene, register, 'counter.glb', x - 2.5, z - 1.5, 0)

  // Canopy + pumps on the forecourt south of the store.
  const canopyMat = cachedFlatMaterial({ color: 0xb0331a, roughness: 0.6, metalness: 0.2 })
  const postMat = cachedFlatMaterial({ color: 0x2a2a26, roughness: 0.7, metalness: 0.5 })
  const forecourtZ = z - d / 2 - 5
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(9, 0.3, 6), canopyMat)
  canopy.position.set(x, 3.2, forecourtZ)
  canopy.castShadow = true
  scene.add(canopy)
  register(canopy)
  for (const [px, pz] of [[-3.8, 2.5], [3.8, 2.5], [-3.8, -2.5], [3.8, -2.5]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 3.2, 8), postMat)
    post.position.set(x + px, 1.6, forecourtZ + pz)
    post.castShadow = true
    scene.add(post)
    register(post)
  }
  const pumpMat = cachedFlatMaterial({ color: 0xdedad0, roughness: 0.5 })
  for (const px of [-1.5, 1.5]) {
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.2, 0.5), pumpMat)
    pump.position.set(x + px, 0.6, forecourtZ)
    pump.castShadow = true
    scene.add(pump)
    register(pump)
  }
  placePropSimple(scene, register, 'barrel.glb', x - 3.6, z + d / 2 - 1, 0)
  placePropSimple(scene, register, 'food-can.glb', x - 2.5, z - 1.15, 0, 0.3, false)

  return { x, z, forecourtZ }
}

// Bank - not in the blueprint, bigger/more bespoke per the user's own
// framing. Teller counter up front + a locked vault room in back (the 8th
// use of buildLockableDoor/lockedCells) holding the best guaranteed loot
// of any location so far.
function buildBank(scene, register, x, z) {
  const w = 12
  const d = 9
  buildRoom(scene, register, {
    x, z, w, d,
    doorSides: [{ side: 'south', width: 2.6 }],
  })
  const floorMat = cachedFlatMaterial({ color: 0xa8a498, roughness: 0.6 })
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.6, d - 0.6), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(x, 0.02, z)
  floor.receiveShadow = true
  scene.add(floor)

  placePropSimple(scene, register, 'counter.glb', x - 2, z, 0)
  placePropSimple(scene, register, 'counter.glb', x + 1, z, 0)
  placePropSimple(scene, register, 'waiting-chair.glb', x - 4, z - 2, Math.PI / 2, 1, false)

  // Vault sits at the north (higher-z) end of the bank, away from the
  // south-facing entrance - its own door needs to face south, back toward
  // the main room, not north/away from it.
  const vaultW = 5
  const vaultD = 4
  const vaultZ = z + d / 2 - vaultD / 2 - 0.5
  buildRoom(scene, register, {
    x, z: vaultZ, w: vaultW, d: vaultD, wallHeight: 2.8,
    doorSides: [{ side: 'south', width: 1.8 }],
  })
  const vaultDoorZ = vaultZ - vaultD / 2
  const vaultDoor = buildLockableDoor(scene, x, vaultDoorZ, 1.8, 'x')
  const cabinet = placePropSimple(scene, register, 'medical-cabinet.glb', x, vaultZ + vaultD / 2 - 0.6, Math.PI)
  if (cabinet) cabinet.traverse((c) => { if (c.isMesh) c.material.color.setHex(0xc9b34a) })

  return { x, z, vaultDoor }
}

// Diner - the alternative to the Gas Station, built afterward once the
// user wanted both. Small dining room, reusing the campus table/chair
// props already on disk plus a serving counter.
function buildDiner(scene, register, x, z) {
  const w = 10
  const d = 8
  buildRoom(scene, register, {
    x, z, w, d,
    doorSides: [{ side: 'south', width: 2.4 }],
  })
  const floorMat = cachedFlatMaterial({ color: 0xc9a860, roughness: 0.7 })
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.6, d - 0.6), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(x, 0.02, z)
  floor.receiveShadow = true
  scene.add(floor)

  placePropSimple(scene, register, 'counter.glb', x - w / 2 + 1, z, Math.PI / 2)
  for (const [tx, tz] of [[-1.5, -2], [1.5, -2], [-1.5, 1.5], [1.5, 1.5]]) {
    placePropSimple(scene, register, 'campus-table.glb', x + tx, z + tz, 0)
    placePropSimple(scene, register, 'waiting-chair.glb', x + tx, z + tz - 0.8, 0, 1, false)
    placePropSimple(scene, register, 'waiting-chair.glb', x + tx, z + tz + 0.8, Math.PI, 1, false)
  }

  return { x, z }
}

// Radio Station - the alternative to the Bank, built afterward once the
// user wanted both. Small building + a procedural antenna tower, and a
// locked broadcast room (9th use of buildLockableDoor/lockedCells) instead
// of tying into the existing lore-terminal system (that has its own
// specific story content already; a new location shouldn't graft onto it
// without understanding what that content assumes).
function buildRadioStation(scene, register, x, z) {
  const w = 8
  const d = 7
  buildRoom(scene, register, {
    x, z, w, d,
    doorSides: [{ side: 'south', width: 2.2 }],
  })
  const floorMat = cachedFlatMaterial({ color: 0x2e2e2a, roughness: 0.8 })
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.6, d - 0.6), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(x, 0.02, z)
  floor.receiveShadow = true
  scene.add(floor)
  placePropSimple(scene, register, 'counter.glb', x, z - d / 2 + 1.3, 0)

  // Antenna tower on the roof.
  const towerMat = cachedFlatMaterial({ color: 0x8a8478, roughness: 0.5, metalness: 0.7 })
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 6, 8), towerMat)
  tower.position.set(x, 3 + 3, z)
  tower.castShadow = true
  scene.add(tower)
  register(tower)
  const beaconMat = cachedFlatMaterial({ color: 0x2a0505, emissive: 0xff2a1e, emissiveIntensity: 1.2 })
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), beaconMat)
  beacon.position.set(x, 6 + 3, z)
  scene.add(beacon)
  const beaconLight = new THREE.PointLight(0xff2a1e, 1.2, 8, 2)
  beaconLight.position.copy(beacon.position)
  scene.add(beaconLight)

  const broadcastW = 4
  const broadcastD = 4
  const broadcastZ = z + d / 2 + broadcastD / 2
  buildRoom(scene, register, {
    x, z: broadcastZ, w: broadcastW, d: broadcastD, wallHeight: 2.6,
    doorSides: [{ side: 'south', width: 1.8 }],
  })
  const broadcastDoorZ = broadcastZ - broadcastD / 2
  const broadcastDoor = buildLockableDoor(scene, x, broadcastDoorZ, 1.8, 'x')

  return { x, z, broadcastDoor }
}

// Fire Station - the third "emergency services" building alongside Police
// and Hospital, and the first real use for the FireAxe model (already
// downloaded for Stage 3's hardware store tools, never actually used until
// now). Locked equipment room instead of an open display, matching the
// gun shop's own locked-case precedent for "the good stuff is behind a door."
function buildFireStation(scene, register, x, z) {
  const w = 10
  const d = 8
  buildRoom(scene, register, {
    x, z, w, d,
    doorSides: [{ side: 'south', width: 3 }],
    wallHeight: 3.6,
  })
  const floorMat = cachedFlatMaterial({ color: 0x3a3630, roughness: 0.85 })
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.6, d - 0.6), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(x, 0.02, z)
  floor.receiveShadow = true
  scene.add(floor)
  placePropSimple(scene, register, 'counter.glb', x - w / 2 + 1, z - d / 2 + 1.5, Math.PI / 2)

  const equipW = 4
  const equipD = 3
  const equipX = x + w / 2 - equipW / 2 - 1
  const equipZ = z + d / 2 - equipD / 2 - 1
  buildRoom(scene, register, {
    x: equipX, z: equipZ, w: equipW, d: equipD, wallHeight: 2.6,
    doorSides: [{ side: 'west', width: 1.6 }],
  })
  const equipDoorX = equipX - equipW / 2
  const equipDoor = buildLockableDoor(scene, equipDoorX, equipZ, 1.6, 'z')
  placePropSimple(scene, register, 'tool-fireaxe.glb', equipX + 1, equipZ, Math.PI / 2, 1, false)

  return { x, z, equipDoor }
}

// Motel - a row of small repeated rooms off one exterior walkway, matching
// the blueprint's own "urban mazes" theme (same repeated-unit idea as the
// prison's cellblock, just unlocked - a motel room isn't a jail cell).
function buildMotel(scene, register, x, z) {
  const roomW = 4
  const roomD = 5
  const roomCount = 5
  const spacing = roomW + 0.6
  const startX = x - ((roomCount - 1) * spacing) / 2

  for (let i = 0; i < roomCount; i++) {
    const roomX = startX + i * spacing
    buildRoom(scene, register, {
      x: roomX, z, w: roomW, d: roomD,
      doorSides: [{ side: 'south', width: 1.6 }],
    })
    const floorMat = cachedFlatMaterial({ color: 0xa89870, roughness: 0.8 })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomW - 0.5, roomD - 0.5), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(roomX, 0.02, z)
    floor.receiveShadow = true
    scene.add(floor)
    const bed = placePropSimple(scene, register, 'hospital-bed.glb', roomX, z + roomD / 2 - 1.3, 0)
    if (bed) bed.traverse((c) => { if (c.isMesh) c.material.color.setHex(0x8a7050) })
    placePropSimple(scene, register, 'medical-cabinet.glb', roomX - roomW / 2 + 0.4, z + roomD / 2 - 0.5, Math.PI / 2)
  }

  return { x, z, roomCount }
}

// "Fill the empty map" round - the 4 outer zones plus the ~19 named
// locations above still left most of the 750x750 map's outer ring and
// diagonal quadrants completely empty (checked by hand against every
// coordinate above - downtown core, safe zone, park, all 4 outer zones,
// and every named location's own footprint). These 20 are single-room
// shells built at the same "finish the set" level of detail as
// buildWarehouse/buildGasStation/buildBank above, not another full
// multi-stage blueprint location - real colliders + zone + (mostly) a
// chest, just simpler dressing. `fenceOnly` swaps the walled room for a
// low fence outline for the handful that read better as an open-air lot
// (junkyard, farmers market, substation) than an interior.
// openSide (singular, distinct from doorSide): omits a wall entirely
// rather than gapping it, so a second buildRoom can chain onto it with a
// real open connection - same "leave both facing walls open" pattern
// buildHospital/buildPoliceStation/buildPrison already use to chain
// multiple rooms into one walkable interior. Used by the room-expansion
// pass (see the many buildRoomExtension calls below) rather than
// reworking every original single-room call - each one just gained this
// one field pointing at whichever side the extra rooms attach to.
function buildFillerLocation(scene, register, spec) {
  const {
    x, z, w, d, wallHeight = 4, doorSide = 'south', doorWidth = 2.4,
    floorColor = 0x38342e, wallColor, fenceOnly = false, dressing = [], openSide,
  } = spec

  if (fenceOnly) {
    const fenceMat = cachedFlatMaterial({ color: wallColor || 0x2a2a26, roughness: 0.8, metalness: 0.4 })
    const fenceH = 1.4
    const halfW = w / 2
    const halfD = d / 2
    for (const cz of [z - halfD, z + halfD]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(w, fenceH, 0.15), fenceMat)
      f.position.set(x, fenceH / 2, cz)
      f.castShadow = true
      scene.add(f)
      register(f)
    }
    for (const cx of [x - halfW, x + halfW]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.15, fenceH, d), fenceMat)
      f.position.set(cx, fenceH / 2, z)
      f.castShadow = true
      scene.add(f)
      register(f)
    }
  } else {
    buildRoom(scene, register, {
      x, z, w, d, wallHeight,
      doorSides: [{ side: doorSide, width: doorWidth }],
      ...(openSide ? { openSides: [openSide] } : {}),
      ...(wallColor ? { wallMat: cachedFlatMaterial({ color: wallColor, roughness: 0.9 }) } : {}),
    })
    const floorMat = cachedFlatMaterial({ color: floorColor, roughness: 0.85 })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.6, d - 0.6), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(x, 0.02, z)
    floor.receiveShadow = true
    scene.add(floor)
  }

  for (const p of dressing) {
    placePropSimple(scene, register, p.file, x + p.dx, z + p.dz, p.rot || 0, p.scale || 1, p.collide !== false)
  }

  return { x, z }
}

// Chains 1-3 more rooms onto the north side of an existing
// buildFillerLocation room (whose own north wall must already be open -
// see openSide:'north' on that call). Same "leave both facing walls
// open" pattern buildHospital/buildPoliceStation/buildPrison use to
// chain rooms into one walkable interior, generalized so the dozens of
// small flavor locations built this session can get real depth without
// each needing a bespoke composite-building function. Returns each new
// room's center so callers can place a chest inside.
function buildRoomExtension(scene, register, { x, startZ, w, roomDepths, floorColor, dressingSets = [] }) {
  const rooms = []
  let z = startZ
  for (let i = 0; i < roomDepths.length; i++) {
    const d = roomDepths[i]
    const roomZ = z + d / 2
    const isLast = i === roomDepths.length - 1
    buildRoom(scene, register, {
      x, z: roomZ, w, d, wallHeight: 3,
      openSides: isLast ? ['south'] : ['south', 'north'],
    })
    const floorMat = cachedFlatMaterial({ color: floorColor, roughness: 0.85 })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.6, d - 0.6), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(x, 0.02, roomZ)
    floor.receiveShadow = true
    scene.add(floor)
    for (const p of (dressingSets[i] || [])) {
      placePropSimple(scene, register, p.file, x + p.dx, roomZ + p.dz, p.rot || 0, p.scale || 1, p.collide !== false)
    }
    rooms.push({ x, z: roomZ })
    z += d
  }
  return rooms
}

// Small rotation of generic "extra room" dressing, reused across every
// expanded location below rather than hand-authoring bespoke dressing
// for 80+ new rooms - the ORIGINAL room each building already had keeps
// its own bespoke dressing untouched; only the new depth added behind it
// draws from this set.
const EXTRA_ROOM_DRESSING = [
  [
    { file: 'shelf.glb', dx: -2, dz: -1 }, { file: 'barrel.glb', dx: 2, dz: -1 },
    { file: 'cabledrum.glb', dx: 0, dz: 1.3 }, { file: 'trashbin.glb', dx: -2.2, dz: 1.3 },
  ],
  [
    { file: 'cabledrum.glb', dx: -2, dz: -1 }, { file: 'counter.glb', dx: 2, dz: -1, rot: Math.PI },
    { file: 'shelf.glb', dx: 2, dz: 1.3, rot: Math.PI }, { file: 'barrel.glb', dx: -2, dz: 1.3 },
  ],
  [
    { file: 'campus-table.glb', dx: 0, dz: -1, scale: 0.8 }, { file: 'waiting-chair.glb', dx: 2, dz: -0.5 },
    { file: 'waiting-chair.glb', dx: -2, dz: -0.5 }, { file: 'campus-books.glb', dx: 0, dz: 1.3 },
  ],
  [
    { file: 'shelf.glb', dx: -2, dz: -1.5 }, { file: 'shelf.glb', dx: 2, dz: -1.5 },
    { file: 'campus-books.glb', dx: -2, dz: 1 }, { file: 'firstaid.glb', dx: 2, dz: 1, scale: 0.3, collide: false },
  ],
  [
    { file: 'dumpster.glb', dx: -2, dz: -1 }, { file: 'trashbin.glb', dx: 2, dz: -1 },
    { file: 'cabledrum.glb', dx: 0, dz: 1.3 }, { file: 'barrel.glb', dx: -2.2, dz: 1.3 },
  ],
]

// Static building-identifier sign, mounted above the entrance so a player
// can tell what a building is on sight instead of only reading it off the
// compass strip at the top of the screen - same canvas-texture-sprite
// trick Companion.js/Zombie.js already use for name tags/health bars,
// just planted in the world (not attached to a moving group), and always
// facing the camera like every THREE.Sprite does, so it reads correctly
// approached from any angle.
function buildLocationSign(scene, x, z, approachOffsetZ, text) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 96
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'rgba(20, 18, 14, 0.85)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = '#c9a24a'
  ctx.lineWidth = 5
  ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#f0e6c8'
  let fontSize = 40
  ctx.font = `bold ${fontSize}px sans-serif`
  const maxWidth = canvas.width - 32
  const label = text.toUpperCase()
  while (ctx.measureText(label).width > maxWidth && fontSize > 16) {
    fontSize -= 2
    ctx.font = `bold ${fontSize}px sans-serif`
  }
  ctx.fillText(label, canvas.width / 2, canvas.height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: true, fog: false })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(4.2, 0.79, 1)
  sprite.position.set(x, 3, z + approachOffsetZ)
  sprite.renderOrder = 5
  scene.add(sprite)
  return sprite
}

function buildManholeCover(scene, x, z) {
  const mat = cachedFlatMaterial({ color: 0x2a2a26, roughness: 0.6, metalness: 0.6 })
  const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.05, 16), mat)
  cover.position.set(x, 0.03, z)
  cover.receiveShadow = true
  scene.add(cover)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.03, 8, 20), mat)
  rim.rotation.x = -Math.PI / 2
  rim.position.set(x, 0.06, z)
  scene.add(rim)
}

// Interactive World batch - the props below. Each keeps geometry simple
// (axis-aligned boxes/cylinders/spheres, no rotated meshes) so any collider
// built from it - explicit or via register()'s setFromObject - stays a
// tight fit, per this project's own documented rotated-mesh AABB gotcha.
const SCAFFOLDING_HEALTH = 40

// Water Tower Valve - a ground-level interact point at the existing Water
// Tower's base (see the "Water Tower + Grain Silo" landmark, explicitly
// marked not climbable/out of scope) giving that decoration a real payoff
// without needing the per-structure climb-verification pass its own
// comment flagged as out of scope. No register() - purely a small
// walk-through interact prop, same as buildManholeCover above.
function buildWaterTowerValve(scene, x, z) {
  const wheelMat = cachedFlatMaterial({ color: 0x8a3a2a, roughness: 0.6, metalness: 0.5 })
  const pipeMat = cachedFlatMaterial({ color: 0x4a4a48, roughness: 0.5, metalness: 0.7 })
  const group = new THREE.Group()
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 10), pipeMat)
  pipe.position.set(0, 0.7, 0)
  group.add(pipe)
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.05, 8, 16), wheelMat)
  wheel.position.set(0, 1.4, 0)
  group.add(wheel)
  group.position.set(x, 0, z)
  group.castShadow = true
  scene.add(group)
  return { x, z }
}

// Lightable Campfire interact anchor - the campfire itself already exists
// (see "Campfire Rest Area" above, same 42,66 coordinate); exported so
// Game.js can run a proximity check against it without hardcoding the
// coordinate a second time (see this project's own hardcoded-position
// gotcha - buildTraderStall/buildAmmoStation once fell out of sync this way).
export const CAMPFIRE_X = 42
export const CAMPFIRE_Z = 66

// Container Staircase - 2 stacked shipping containers just outside the
// Warehouse, each riser sized within PlayerController's MANTLE_MIN/MAX
// height (0.7-1.4m) with generous footprint overlap between steps, so the
// EXISTING mantle mechanic carries the player up both in sequence with no
// new traversal code - just correctly-sized, correctly-placed geometry.
function buildContainerStaircase(scene, colliders, solidMeshes, x, z) {
  const containerMat = cachedFlatMaterial({ color: 0x2e5a4a, roughness: 0.75, metalness: 0.3 })
  const steps = [
    { dx: 0, dz: 0, h: 1.2, w: 2.6, d: 2.2 },
    { dx: 0, dz: -1.0, h: 2.3, w: 2.6, d: 2.2 },
  ]
  let topSpot = null
  for (const s of steps) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), containerMat)
    box.position.set(x + s.dx, s.h / 2, z + s.dz)
    box.castShadow = true
    box.receiveShadow = true
    scene.add(box)
    solidMeshes.push(box)
    colliders.push(new THREE.Box3(
      new THREE.Vector3(x + s.dx - s.w / 2, 0, z + s.dz - s.d / 2),
      new THREE.Vector3(x + s.dx + s.w / 2, s.h, z + s.dz + s.d / 2)
    ))
    topSpot = { x: x + s.dx, y: s.h, z: z + s.dz }
  }
  return { lootSpot: topSpot }
}

// Industrial Siren Lever - risk/reward: pulling it (see Game.js's
// _pullSirenLever) briefly spikes zombie spawn/aggression in exchange for a
// bonus loot multiplier during that window, a deliberate OPT-IN difficulty
// spike distinct from every other hazard in this game (all of which just
// happen TO the player, never chosen).
function buildIndustrialSiren(scene, x, z) {
  const poleMat = cachedFlatMaterial({ color: 0x3a3a38, roughness: 0.7, metalness: 0.5 })
  const hornMat = cachedFlatMaterial({ color: 0xb8402a, roughness: 0.6, metalness: 0.4 })
  const group = new THREE.Group()
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.4, 8), poleMat)
  pole.position.set(0, 1.2, 0)
  group.add(pole)
  const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.15, 0.5, 12), hornMat)
  horn.position.set(0, 2.5, 0)
  group.add(horn)
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.06), poleMat)
  lever.position.set(0.15, 0.9, 0)
  lever.rotation.z = Math.PI / 6
  group.add(lever)
  group.position.set(x, 0, z)
  group.castShadow = true
  scene.add(group)
  return { x, z }
}

// Wrecking Pendulum - a suspended wrecking ball the player can trigger to
// swing through a fixed arc, damaging/knocking back any zombie caught in
// its path (see Game.js's _triggerWreckingPendulum). Pivot/chain length
// returned explicitly so Game.js can animate the swing from this exact
// anchor without re-deriving the geometry above.
function buildWreckingPendulum(scene, x, z) {
  const frameMat = cachedFlatMaterial({ color: 0x4a4640, roughness: 0.7, metalness: 0.4 })
  const chainMat = cachedFlatMaterial({ color: 0x2a2a28, roughness: 0.6, metalness: 0.6 })
  const ballMat = cachedFlatMaterial({ color: 0x1c1c1a, roughness: 0.5, metalness: 0.6 })
  const group = new THREE.Group()
  const beamHeight = 4.5
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.3, beamHeight, 0.3), frameMat)
  beam.position.set(0, beamHeight / 2, 0)
  group.add(beam)
  const crossbeam = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, 0.25), frameMat)
  crossbeam.position.set(0.9, beamHeight, 0)
  group.add(crossbeam)
  const chainLength = 2.2
  const ballRadius = 0.5
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, chainLength, 6), chainMat)
  chain.position.set(1.7, beamHeight - chainLength / 2, 0)
  group.add(chain)
  const ball = new THREE.Mesh(new THREE.SphereGeometry(ballRadius, 14, 12), ballMat)
  ball.position.set(1.7, beamHeight - chainLength - ballRadius, 0)
  group.add(ball)
  group.position.set(x, 0, z)
  group.castShadow = true
  scene.add(group)
  // ball is returned (not just built) so Game.js's _updateWreckingPendulum
  // can reposition it during the swing animation - pivot.x already bakes
  // in the +1.7 local offset from the group's own origin, so Game.js's
  // math never needs to re-derive or re-add it.
  return { x, z, pivot: { x: x + 1.7, y: beamHeight, z }, ropeLength: chainLength + ballRadius, ball, localPivotX: 1.7 }
}

// Elevator Tower - a standalone lookout structure with a working elevator
// (see Game.js's _updateElevatorTower/_rideElevator). Deliberately its own
// freestanding structure in open ground rather than retrofitted into one
// of the "real" enterable skyscrapers (buildSkyscraper) - that building's
// interior stairwell already fills the full shaft depth at every floor
// height, so a moving platform in there risks colliding with the stairs.
// The permanent top deck sits BESIDE the car's shaft (not directly above
// it) with a slight footprint overlap for a seamless step-across - the car
// rising straight up through the same footprint the deck occupies would
// otherwise end with the two meshes clipping through each other at the
// top. A separate permanent deck also means the player still has solid
// ground up top even after the car's been ridden back down to fetch
// someone else - it can't just BE the car.
const ELEVATOR_STOP_HEIGHT = 4
const ELEVATOR_CAR_HALF = 1.1
const ELEVATOR_DECK_HALF = 1.4
// Deck center X offset from the car/tower origin - car's right edge is at
// +CAR_HALF, deck's left edge needs to sit a little inside that (not right
// at it) so there's no sliver gap to fall through when stepping across.
const ELEVATOR_DECK_OFFSET_X = ELEVATOR_CAR_HALF + ELEVATOR_DECK_HALF - 0.2

function buildElevatorTower(scene, colliders, solidMeshes, register, x, z) {
  const postMat = cachedFlatMaterial({ color: 0x4a4640, roughness: 0.7, metalness: 0.4 })
  const deckMat = cachedFlatMaterial({ color: 0x5a5648, roughness: 0.8 })
  const railMat = cachedFlatMaterial({ color: 0xd8c840, roughness: 0.5, metalness: 0.3 })
  const carMat = cachedFlatMaterial({ color: 0x3a3830, roughness: 0.6, metalness: 0.5 })
  const postHeight = ELEVATOR_STOP_HEIGHT + 0.6

  // Four corner posts framing the car's own vertical shaft.
  const shaftSpan = ELEVATOR_CAR_HALF + 0.3
  for (const [px, pz] of [[-shaftSpan, -shaftSpan], [shaftSpan, -shaftSpan], [-shaftSpan, shaftSpan], [shaftSpan, shaftSpan]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, postHeight, 8), postMat)
    post.position.set(x + px, postHeight / 2, z + pz)
    post.castShadow = true
    scene.add(post)
    register(post)
  }

  const deckCenterX = x + ELEVATOR_DECK_OFFSET_X
  // Two support posts under the deck's own outer (far) corners.
  for (const pz of [-ELEVATOR_DECK_HALF + 0.2, ELEVATOR_DECK_HALF - 0.2]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, postHeight, 8), postMat)
    post.position.set(deckCenterX + ELEVATOR_DECK_HALF - 0.2, postHeight / 2, z + pz)
    post.castShadow = true
    scene.add(post)
    register(post)
  }

  // Climbable ladder (see Game.js's isOnLadder) - mounted near the same
  // far-corner support post used above (the pz=+DECK_HALF-0.2 one, at
  // deckCenterX+DECK_HALF-0.2), so the climb's own landing spot lands ON
  // the deck's own walkable footprint rather than needing separately-
  // verified clearance the way the tower's own location did. Offset an
  // extra 0.3 further in from that post's exact x (not co-located with
  // it) - climbing to a spot dead-center on the post's own thin 0.1-radius
  // top cap instead of the broad deck slab was caught via a live ground-
  // height sample during testing (returned the post's height, 4.6, not
  // the deck's, 4.15) - offsetting clear of the post's footprint entirely
  // guarantees the landing spot resolves to the deck every time.
  const ladderX = deckCenterX + ELEVATOR_DECK_HALF - 0.5
  const ladderZ = z + ELEVATOR_DECK_HALF - 0.2
  const railMatLadder = cachedFlatMaterial({ color: 0x6a6458, roughness: 0.6, metalness: 0.4 })
  for (const rx of [-0.25, 0.25]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, ELEVATOR_STOP_HEIGHT, 6), railMatLadder)
    rail.position.set(ladderX + rx, ELEVATOR_STOP_HEIGHT / 2, ladderZ)
    scene.add(rail)
  }
  const rungCount = Math.round(ELEVATOR_STOP_HEIGHT / 0.35)
  for (let i = 0; i <= rungCount; i++) {
    const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), railMatLadder)
    rung.rotation.z = Math.PI / 2
    rung.position.set(ladderX, (i / rungCount) * ELEVATOR_STOP_HEIGHT, ladderZ)
    scene.add(rung)
  }

  // Permanent top deck, always there regardless of where the car currently
  // is - solidMeshes only, same "walkable floor, intentionally not a
  // horizontal collider" reasoning buildSkyscraper's own floor slabs use:
  // a thin slab pushed to colliders too would block the player's own
  // collision box from walking freely ACROSS its top surface, not just
  // stop them walking through its edge.
  const deck = new THREE.Mesh(new THREE.BoxGeometry(ELEVATOR_DECK_HALF * 2, 0.3, ELEVATOR_DECK_HALF * 2), deckMat)
  deck.position.set(deckCenterX, ELEVATOR_STOP_HEIGHT, z)
  deck.receiveShadow = true
  scene.add(deck)
  solidMeshes.push(deck)
  // Railings on the 3 outer sides, left open on the side facing the car
  // so the player can step straight across from one to the other.
  for (const [rx, rz, w, d] of [
    [ELEVATOR_DECK_HALF, 0, 0.1, ELEVATOR_DECK_HALF * 2],
    [0, ELEVATOR_DECK_HALF, ELEVATOR_DECK_HALF * 2, 0.1],
    [0, -ELEVATOR_DECK_HALF, ELEVATOR_DECK_HALF * 2, 0.1],
  ]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, d), railMat)
    rail.position.set(deckCenterX + rx, ELEVATOR_STOP_HEIGHT + 0.6, z + rz)
    scene.add(rail)
    register(rail)
  }

  // The moving car - solidMeshes only (walkable), deliberately NOT pushed
  // to colliders: colliders are static Box3 snapshots taken once, which
  // would go stale the instant this moves, while solidMeshes is raycast
  // against the mesh's live transform every time (see PlayerController's
  // ground-height sampling), so a live-updated position.y here just works.
  // Rests at ELEVATOR_STOP_HEIGHT when parked at the top (matching the
  // deck's own center height, close enough for a flush-feeling step across
  // given the two meshes' own half-thicknesses) and 0 when parked at the
  // bottom (flat ground - no thickness math needed there).
  const car = new THREE.Mesh(new THREE.BoxGeometry(ELEVATOR_CAR_HALF * 2, 0.25, ELEVATOR_CAR_HALF * 2), carMat)
  car.position.set(x, 0, z)
  car.castShadow = true
  car.receiveShadow = true
  scene.add(car)
  solidMeshes.push(car)

  return { x, z, car, stopHeight: ELEVATOR_STOP_HEIGHT, ladderX, ladderZ }
}

// Collapsible Scaffolding - shootable (see WeaponSystem._fire()'s hit loop
// and this project's own "New hittable-object categories" convention,
// userData.scaffolding) one-time environmental kill trap: collapses and
// damages any zombie underneath when triggered (see Game.js's
// _collapseScaffolding). register()'d as a real solid collider - it's a
// climbable-looking structure the player should visibly bump into, not
// walk through, until it's brought down.
function buildScaffolding(scene, register, x, z) {
  const poleMat = cachedFlatMaterial({ color: 0xb8862a, roughness: 0.6, metalness: 0.5 })
  const plankMat = cachedFlatMaterial({ color: 0x6a5230, roughness: 0.9 })
  const group = new THREE.Group()
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.5, 6), poleMat)
    leg.position.set(lx, 1.75, lz)
    group.add(leg)
  }
  for (const y of [1.2, 2.4, 3.4]) {
    for (const rz of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.06), poleMat)
      rail.position.set(0, y, rz)
      group.add(rail)
    }
  }
  const plank = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, 2.1), plankMat)
  plank.position.set(0, 3.45, 0)
  group.add(plank)
  group.position.set(x, 0, z)
  group.castShadow = true
  scene.add(group)
  // Hand-built axis-aligned box (register()'s explicitBox param) instead of
  // letting register() compute its own via setFromObject - this way the
  // exact same box reference is also returned below, so Game.js's
  // _collapseScaffolding can remove it from colliders later. Without this,
  // register()'s internally-created Box3 would have no reference anywhere
  // Game.js could reach to clean it up on collapse.
  const box = new THREE.Box3(
    new THREE.Vector3(x - 1.1, 0, z - 1.1),
    new THREE.Vector3(x + 1.1, 3.53, z + 1.1)
  )
  // The object reference itself (not just `true`) so Game.js can attach a
  // real onHit closure after construction and WeaponSystem's hit loop can
  // call it directly - same mesh.userData.destructibleWall = wall shape
  // _buildDestructibleWall already uses.
  const scaffolding = { x, z, group, box, health: SCAFFOLDING_HEALTH, destroyed: false, onHit: null }
  group.traverse((child) => {
    if (child.isMesh) child.userData.scaffolding = scaffolding
  })
  register(group, box)
  return scaffolding
}

// Payphone Distress Call - interact, wait, and a supply reward arrives at
// the payphone's own spot (see Game.js's _updatePayphoneCall). Deliberately
// independent of the existing random-timer Airdrop system (this.airdrop is
// a single shared slot; reusing it here risked one silently overwriting
// the other), once per run.
// Jukebox (batch feature) - a physical, walk-up-and-press-E interact prop
// for the existing audioEngine.toggleRadio() mute toggle (previously
// keybind-only, see Game.js's radio keybind handler), same "give a hidden
// system a real object in the world" reasoning as the Coin Shop's physical
// trader stall. Only one music track exists in this codebase (see Audio.js's
// own comment on MUSIC_URL) so this toggles it on/off rather than cycling
// between tracks that don't exist yet.
function buildJukebox(scene, register, x, z) {
  const caseMat = cachedFlatMaterial({ color: 0x6a2a2a, roughness: 0.5, metalness: 0.3 })
  const trimMat = cachedFlatMaterial({ color: 0xd8b840, roughness: 0.4, metalness: 0.6 })
  const glassMat = flatMaterial({ color: 0x2a1408, emissive: 0xffb646, emissiveIntensity: 0.9, roughness: 0.3 })
  const group = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 0.6), caseMat)
  body.position.set(0, 0.65, 0)
  group.add(body)
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.1, 12, 1, false, 0, Math.PI), trimMat)
  top.rotation.x = Math.PI / 2
  top.position.set(0, 1.3, 0)
  group.add(top)
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.04), glassMat)
  panel.position.set(0, 0.75, 0.32)
  group.add(panel)
  const trimBottom = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.08, 0.64), trimMat)
  trimBottom.position.set(0, 0.04, 0)
  group.add(trimBottom)
  group.position.set(x, 0, z)
  group.traverse((o) => { o.castShadow = true })
  scene.add(group)
  register(group)
  return { x, z, panelMat: glassMat }
}

// Adoptable Pet/Mascot (batch feature) - simple procedural dog shape (no
// dog/cat GLB in this project's asset pack, see BUILDING_MODEL_FILES/
// PROP_MODEL_FILES - low-poly boxes read fine at this size, same "build it
// from primitives" approach the practice range's own targets use). Sits at
// a fixed spot until adopted (see Game.js's settings.petAdopted), then
// Game.js's per-frame tick takes over its position to follow the player -
// this function only builds the geometry and returns the group to move.
function buildPet(scene, x, z) {
  const furMat = cachedFlatMaterial({ color: 0xb08050, roughness: 0.9 })
  const group = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.28), furMat)
  body.position.set(0, 0.22, 0)
  group.add(body)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), furMat)
  head.position.set(0.32, 0.28, 0)
  group.add(head)
  const earMat = cachedFlatMaterial({ color: 0x805030, roughness: 0.9 })
  for (const ez of [-0.08, 0.08]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.06), earMat)
    ear.position.set(0.36, 0.4, ez)
    group.add(ear)
  }
  for (const [lx, lz] of [[-0.16, -0.09], [-0.16, 0.09], [0.16, -0.09], [0.16, 0.09]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.07), furMat)
    leg.position.set(lx, 0.1, lz)
    group.add(leg)
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.22), furMat)
  tail.position.set(-0.3, 0.3, 0)
  group.add(tail)
  group.position.set(x, 0, z)
  group.traverse((o) => { o.castShadow = true })
  scene.add(group)
  return { group, x, z, wanderPhase: Math.random() * Math.PI * 2 }
}

// Workbench (batch 3 feature) - reduces weapon jam chance the same way
// Game.js's existing Cleaning Kit pickup does (jamChanceMult), just as a
// physical safe-zone interact instead of a run-only pickup.
function buildWorkbench(scene, register, x, z) {
  const benchMat = cachedFlatMaterial({ color: 0x4a3a28, roughness: 0.7 })
  const group = new THREE.Group()
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.7), benchMat)
  top.position.set(0, 0.85, 0)
  group.add(top)
  const legMat = cachedFlatMaterial({ color: 0x2a2018, roughness: 0.8 })
  for (const [lx, lz] of [[-0.6, -0.3], [-0.6, 0.3], [0.6, -0.3], [0.6, 0.3]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.85, 0.08), legMat)
    leg.position.set(lx, 0.425, lz)
    group.add(leg)
  }
  const toolMat = cachedFlatMaterial({ color: 0x8a8a80, roughness: 0.5, metalness: 0.6 })
  const wrench = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.08), toolMat)
  wrench.position.set(0.1, 0.92, 0)
  wrench.rotation.y = 0.4
  group.add(wrench)
  group.position.set(x, 0, z)
  group.traverse((o) => { o.castShadow = true })
  scene.add(group)
  register(group)
  return { x, z }
}

// Bulletin Board (batch 3 feature) - a corkboard prop; Game.js's interact
// reads your most-recently-unlocked achievement off the existing
// Achievements.unlocked Set (a Set iterates in insertion order, so its
// last entry IS the most recent unlock - no new tracking needed).
function buildBulletinBoard(scene, register, x, z) {
  const boardMat = cachedFlatMaterial({ color: 0x6a5030, roughness: 0.9 })
  const group = new THREE.Group()
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.06), boardMat)
  board.position.set(0, 1.3, 0)
  group.add(board)
  const frameMat = cachedFlatMaterial({ color: 0x3a2e1c, roughness: 0.8 })
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.32, 1.02, 0.04), frameMat)
  frame.position.set(0, 1.3, -0.02)
  group.add(frame)
  const noteMat = cachedFlatMaterial({ color: 0xe8dcb0, roughness: 0.7 })
  for (const [nx, ny] of [[-0.3, 1.45], [0.25, 1.4], [-0.1, 1.15], [0.3, 1.1]]) {
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.16), noteMat)
    note.position.set(nx, ny, 0.04)
    group.add(note)
  }
  group.position.set(x, 0, z)
  group.traverse((o) => { o.castShadow = true })
  scene.add(group)
  register(group)
  return { x, z }
}

// Hall-of-Fame Wall (batch 3 feature) - reuses the trophy wall's plain
// wood-panel look; Game.js's interact fetches the real top-3 global
// leaderboard (already-existing CloudSync.fetchTopLeaderboard) rather than
// this file inventing any new data source.
function buildHallOfFame(scene, register, x, z) {
  const panelMat = cachedFlatMaterial({ color: 0x5a4428, roughness: 0.85 })
  const group = new THREE.Group()
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 0.08), panelMat)
  panel.position.set(0, 1.4, 0)
  group.add(panel)
  const plaqueMat = cachedFlatMaterial({ color: 0xd8b840, roughness: 0.4, metalness: 0.6 })
  for (let i = 0; i < 3; i++) {
    const plaque = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.22, 0.03), plaqueMat)
    plaque.position.set(0, 1.75 - i * 0.32, 0.06)
    group.add(plaque)
  }
  group.position.set(x, 0, z)
  group.traverse((o) => { o.castShadow = true })
  scene.add(group)
  register(group)
  return { x, z }
}

function buildPayphone(scene, register, x, z) {
  const boothMat = cachedFlatMaterial({ color: 0x2a4a6a, roughness: 0.5, metalness: 0.4 })
  const glassMat = cachedFlatMaterial({ color: 0x8ac4d8, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.35 })
  const group = new THREE.Group()
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.2, 0.9), boothMat)
  frame.position.set(0, 1.1, 0)
  group.add(frame)
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.94, 1.6, 0.02), glassMat)
  glass.position.set(0, 1.3, 0.46)
  group.add(glass)
  group.position.set(x, 0, z)
  group.castShadow = true
  scene.add(group)
  register(group)
  return { x, z }
}

// Tactical Streetlight - shootable (see WeaponSystem._fire()'s hit loop,
// userData.tacticalLight), darkening the immediate area and reducing
// zombie detection range there once shot out (see Game.js's
// _shootOutStreetlight). Deliberately only a couple of these, not every
// streetlight on the map - this project's shared streetlight.glb placement
// is used dozens of times across World.js, and retrofitting all of them
// with hittable flags was out of scope for one batch item.
// Climbable Drainpipes (batch feature) - pure visual, no collider (same
// "decoration only" reasoning ambientWildlife/the pet use) - the actual
// climb behavior is driven by Game.js reusing PlayerController's existing
// ladder mechanic (see its own nearLadder comment), same primitive the
// Elevator Tower's ladder already uses. This just needs to look like a
// pipe at the matching x/z.
// Jump Pad (batch 3 feature) - pure visual, no collider (player walks onto
// it, not into it) - Game.js's own per-frame proximity check does the
// actual launch, same "geometry here, behavior in Game.js" split the
// drainpipes/pet/dummy above already use.
function buildJumpPad(scene, x, z) {
  const padMat = flatMaterial({ color: 0x1a3a2a, emissive: 0x4ee06f, emissiveIntensity: 0.7, roughness: 0.4 })
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.15, 16), padMat)
  pad.position.set(x, 0.08, z)
  scene.add(pad)
  const ringMat = cachedFlatMaterial({ color: 0x2a2a26, roughness: 0.6, metalness: 0.5 })
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 8, 20), ringMat)
  ring.rotation.x = Math.PI / 2
  ring.position.set(x, 0.16, z)
  scene.add(ring)
}

function buildDrainpipe(scene, x, z, height) {
  const pipeMat = cachedFlatMaterial({ color: 0x4a4438, roughness: 0.6, metalness: 0.5 })
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, height, 8), pipeMat)
  pipe.position.set(x, height / 2, z)
  pipe.castShadow = true
  scene.add(pipe)
  const bracketMat = cachedFlatMaterial({ color: 0x2a2620, roughness: 0.7, metalness: 0.4 })
  for (let y = 1; y < height; y += 2.4) {
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.08), bracketMat)
    bracket.position.set(x, y, z)
    scene.add(bracket)
  }
}

function buildTacticalStreetlight(scene, register, x, z) {
  const poleMat = cachedFlatMaterial({ color: 0x2a2a28, roughness: 0.6, metalness: 0.5 })
  const group = new THREE.Group()
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4, 8), poleMat)
  pole.position.set(0, 2, 0)
  group.add(pole)
  // NOT cachedFlatMaterial - Game.js darkens this per-light when its bulb
  // is shot out (light.shotOut). Both call sites of this function were
  // sharing one bulb material, so shooting either one out darkened both.
  const bulbMat = flatMaterial({ color: 0xfff2c0, emissive: 0xfff2c0, emissiveIntensity: 1.2 })
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), bulbMat)
  bulb.position.set(0, 4, 0)
  group.add(bulb)
  const light = new THREE.PointLight(0xfff2c0, 0.9, 10, 2)
  light.position.set(0, 4, 0)
  group.add(light)
  group.position.set(x, 0, z)
  scene.add(group)
  // Object reference (not just `true`) so Game.js can attach a real onHit
  // closure after construction - same shape buildScaffolding uses above.
  const streetlight = { x, z, bulb, light, litMat: bulbMat, shotOut: false, onHit: null }
  bulb.userData.tacticalLight = streetlight
  register(pole)
  register(bulb)
  return streetlight
}

function buildWalkway(scene, register, x0, z0, x1, z1) {
  const pathMat = cachedFlatMaterial({ color: 0x4a463c, roughness: 1 })
  const length = Math.hypot(x1 - x0, z1 - z0)
  const midX = (x0 + x1) / 2
  const midZ = (z0 + z1) / 2
  const angle = Math.atan2(x1 - x0, z1 - z0)
  const path = new THREE.Mesh(new THREE.PlaneGeometry(3, length), pathMat)
  path.rotation.x = -Math.PI / 2
  path.rotation.z = -angle
  path.position.set(midX, 0.015, midZ)
  scene.add(path)

  const lightModel = _propModelCache.get('streetlight.glb')
  for (const t of [0.25, 0.75]) {
    const lx = x0 + (x1 - x0) * t + 2
    const lz = z0 + (z1 - z0) * t
    if (lightModel) {
      const clone = lightModel.clone(true)
      clone.position.set(lx, 0, lz)
      clone.traverse((child) => {
        if (!child.isMesh) return
        child.castShadow = true
        child.material = flattenedClone(child.material)
      })
      scene.add(clone)
      register(clone)
    }
    const light = new THREE.PointLight(0xffbb55, 1.0, 12, 2)
    light.position.set(lx, 5.2, lz)
    scene.add(light)
  }
}

function buildTargetTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  const rings = [[62, '#e8ddc0'], [46, '#b03a2a'], [30, '#e8ddc0'], [14, '#b03a2a']]
  for (const [r, color] of rings) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(64, 64, r, 0, Math.PI * 2)
    ctx.fill()
  }
  return new THREE.CanvasTexture(canvas)
}

// Three no-consequence shooting targets in the back of the safe zone (the
// Vault - see Chests.js - occupies a different corner) so a player can feel
// out a weapon's spread/recoil/damage falloff without spending real ammo
// pressure or drawing zombie attention. Each target's hit response (flash +
// ding) is wired through WeaponSystem's userData.practiceTarget check; the
// actual flash decay is driven by Game.js's own per-frame update since this
// file only builds geometry.
function buildPracticeRange(scene, colliders, solidMeshes, safeZone) {
  const postMat = cachedFlatMaterial({ color: 0x3a3226, roughness: 0.85 })
  const targetTex = buildTargetTexture()
  const targets = []

  // z-offsets negated from their original -5/-2.5/0 (tucked away from the
  // entrance when it faced +z) to +5/+2.5/0, matching the safe zone's
  // 180-degree flip - the entrance now opens on -z, so "away from the
  // entrance" is +z instead.
  const spots = [
    { x: safeZone.x + 4, z: safeZone.z + 5 },
    { x: safeZone.x + 4, z: safeZone.z + 2.5 },
    { x: safeZone.x + 4, z: safeZone.z },
  ]

  for (const { x, z } of spots) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.6, 8), postMat)
    post.position.set(x, 0.8, z)
    post.castShadow = true
    scene.add(post)
    solidMeshes.push(post)
    post.updateWorldMatrix(true, false)
    colliders.push(new THREE.Box3().setFromObject(post))

    // NOT cachedFlatMaterial - onHit flashes emissiveIntensity per-
    // instance, and a shared material would flash every target at once
    // whenever any single one was hit (same bug class as the Molotov fire
    // zone material sharing one instance earlier this session). Confirmed
    // this was a real, live bug: all 3 targets were sharing one cached
    // material before this fix.
    const boardMat = flatMaterial({ map: targetTex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6 })
    const board = new THREE.Mesh(new THREE.CircleGeometry(0.4, 24), boardMat)
    board.position.set(x, 1.7, z)
    board.castShadow = true
    scene.add(board)
    solidMeshes.push(board)

    const target = { mat: boardMat, flashUntil: 0 }
    target.onHit = () => {
      target.flashUntil = performance.now() + 180
    }
    board.userData.practiceTarget = target
    targets.push(target)
  }

  return targets
}

// Adjustable HP/Armor Practice Dummy (batch feature) - unlike the 3 flash-
// only ding targets above (which have no real health at all), this one
// tracks actual HP/armor and reports real damage-per-hit, so a player can
// actually test how hard a weapon hits instead of just its spread/recoil.
// Presets (not a free-form slider) are cycled via the interact key rather
// than needing new settings UI for a single practice-range prop.
const DUMMY_PRESETS = [
  { labelKey: 'dummyPresetRookie', hp: 100, armor: 0 },
  { labelKey: 'dummyPresetVeteran', hp: 250, armor: 15 },
  { labelKey: 'dummyPresetElite', hp: 500, armor: 30 },
]

function buildAdjustableDummy(scene, colliders, solidMeshes, safeZone) {
  const x = safeZone.x + 4
  const z = safeZone.z - 2.5
  const postMat = cachedFlatMaterial({ color: 0x3a3226, roughness: 0.85 })
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.8, 8), postMat)
  post.position.set(x, 0.9, z)
  post.castShadow = true
  scene.add(post)
  solidMeshes.push(post)
  post.updateWorldMatrix(true, false)
  colliders.push(new THREE.Box3().setFromObject(post))

  // NOT cachedFlatMaterial - same per-instance flash reasoning as the
  // ding-only targets above.
  const boardMat = flatMaterial({ color: 0x8a3a2a, emissive: 0xff5030, emissiveIntensity: 0, roughness: 0.6 })
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.4, 0.15), boardMat)
  board.position.set(x, 1.6, z)
  board.castShadow = true
  scene.add(board)
  solidMeshes.push(board)

  const dummy = {
    mat: boardMat,
    flashUntil: 0,
    presetIndex: 0,
    hp: DUMMY_PRESETS[0].hp,
    maxHp: DUMMY_PRESETS[0].hp,
    armor: DUMMY_PRESETS[0].armor,
    x, z,
    // Practice dummy leaderboard (batch 3 feature) - runStartAt is set on
    // the first hit after a reset/preset-switch, so time-to-kill only ever
    // measures one continuous kill attempt, never a break-then-resume.
    runStartAt: null,
    onKill: null, // set by Game.js - (presetIndex, elapsedMs) => void
  }
  dummy.onHit = (rawDamage) => {
    dummy.flashUntil = performance.now() + 180
    if (dummy.runStartAt == null) dummy.runStartAt = performance.now()
    const dealt = Math.max(1, Math.round(rawDamage * (1 - dummy.armor / 100)))
    dummy.hp = Math.max(0, dummy.hp - dealt)
    if (dummy.hp === 0) {
      if (dummy.onKill) dummy.onKill(dummy.presetIndex, performance.now() - dummy.runStartAt)
      dummy.runStartAt = null
      dummy.hp = dummy.maxHp // auto-reset, endless practice
    }
    return dealt
  }
  dummy.cyclePreset = () => {
    dummy.presetIndex = (dummy.presetIndex + 1) % DUMMY_PRESETS.length
    const preset = DUMMY_PRESETS[dummy.presetIndex]
    dummy.maxHp = preset.hp
    dummy.hp = preset.hp
    dummy.armor = preset.armor
    dummy.runStartAt = null
    return preset
  }
  board.userData.adjustableDummy = dummy
  return dummy
}

// A wall-mounted grid of medallions, one per achievement - built dark/unlit
// by default, with the actual lit/unlit state driven live by Game.js's
// _updateTrophyWall (this file only builds the geometry, it has no idea
// which achievements exist or are unlocked). Deliberately generic - takes a
// count rather than importing Achievements.js, so World.js stays decoupled
// from game-progression data the same way it already is from loot tables.
function buildTrophyWall(scene, colliders, solidMeshes, safeZone, count) {
  // East wall, north corner - clear of the Vault (west side), the practice
  // range (mid-east, see buildPracticeRange), and the entrance guard posts
  // (south side, flanking the gap in the -z wall after the safe zone's
  // 180-degree flip - z-offset negated from the original -4 to +4 to match).
  const x = safeZone.x + safeZone.radius - 0.5
  const z = safeZone.z + 4
  const cols = 5
  const rows = Math.ceil(count / cols)
  const spacing = 0.4

  // Real wood PBR textures (reused from the StreetBench pack, already
  // downloaded for Phase 5's prop batch - no new asset needed) tiled onto
  // the backing board instead of a flat color. The board itself stays a
  // plain procedural box since its size depends on the achievement count
  // (cols/rows), which no fixed-size model could match.
  const woodColor = new THREE.TextureLoader().load('/textures/wood_color.png')
  woodColor.colorSpace = THREE.SRGBColorSpace
  const woodNormal = new THREE.TextureLoader().load('/textures/wood_normal.png')
  const woodRoughness = new THREE.TextureLoader().load('/textures/wood_roughness.png')
  const backingW = cols * spacing + 0.3
  const backingH = rows * spacing + 0.3
  for (const tex of [woodColor, woodNormal, woodRoughness]) {
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(backingW / 0.6, backingH / 0.6)
  }
  const backingMat = cachedFlatMaterial({
    map: woodColor,
    normalMap: woodNormal,
    roughnessMap: woodRoughness,
    roughness: 0.9,
  })
  const backing = new THREE.Mesh(new THREE.BoxGeometry(0.08, backingH, backingW), backingMat)
  backing.position.set(x, 1.6, z)
  backing.castShadow = true
  backing.receiveShadow = true
  scene.add(backing)
  solidMeshes.push(backing)
  backing.updateWorldMatrix(true, false)
  colliders.push(new THREE.Box3().setFromObject(backing))

  const medallions = []
  const medallionMeshes = []
  for (let i = 0; i < count; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const my = 1.6 + backingH / 2 - 0.3 - row * spacing
    const mz = z - backingW / 2 + 0.3 + col * spacing

    // Own material clone per medallion - each lights up independently as
    // its own achievement unlocks, not all at once (same shared-material
    // pitfall as the practice range targets/fire zones earlier).
    const mat = cachedFlatMaterial({ color: 0x1c1a16, emissive: 0x000000, emissiveIntensity: 0, roughness: 0.4, metalness: 0.5 })
    const medallion = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 16), mat)
    medallion.rotation.z = Math.PI / 2
    medallion.position.set(x - 0.06, my, mz)
    medallion.castShadow = true
    // Trophy wall hover tooltip (batch 9 feature) - achievementIndex lets
    // Game.js's crosshair raycast identify which achievement a hit medallion
    // represents, index-matched to ACHIEVEMENTS (this file stays decoupled
    // from that data, same reasoning as the medallion count param above).
    medallion.userData.achievementIndex = i
    scene.add(medallion)
    medallions.push(mat)
    medallionMeshes.push(medallion)
  }

  return { x, z, medallions, medallionMeshes }
}

// Second hidden biome - a grimy sewer corridor, home to the Sewer Dweller
// zombie type (see ZombieTypes.js). Same enclosed wall/ceiling/floor
// construction as the subway corridor, just re-themed.
// Z range moved from [34,50] to [-20,-4] - the safe zone's relocation (see
// buildSafeZone) now occupies x=[-7,7], z=[35,49], and the old z-band is
// wedged between the safe zone, the trader stall (-8,33), and two
// buildings (indices 9 and 14) on either side with no room left for the
// sewer's ~3.8-unit width at any x in that band. Systematically checked
// every x/z combination against every building, the safe zone, trader,
// barricade windows, generator, and ammo station - keeping the original
// x=-5 and 16-unit length, this z-band is the nearest fully clear spot.
const SEWER_X = -5
const SEWER_Z_START = -20
const SEWER_Z_END = -4
// Widened enough that the 0.4-unit player radius has real room to walk in
// with no funnel at the mouth - too tight a corridor bounces the player off
// a side wall on approach and reads as the entrance not letting them in.
const SEWER_WIDTH = 3.4
const SEWER_HEIGHT = 2.4

function buildSewer(scene, colliders, solidMeshes, flickerLights) {
  const length = SEWER_Z_END - SEWER_Z_START
  const centerZ = (SEWER_Z_START + SEWER_Z_END) / 2

  const wallMat = cachedFlatMaterial({ color: 0x2a3324, roughness: 1 })
  const floorMat = cachedFlatMaterial({ color: 0x1c2418, roughness: 1 })
  const pipeMat = cachedFlatMaterial({ color: 0x3a4a30, roughness: 0.7, metalness: 0.4 })

  const floor = new THREE.Mesh(new THREE.BoxGeometry(SEWER_WIDTH, 0.08, length), floorMat)
  floor.position.set(SEWER_X, 0.04, centerZ)
  floor.receiveShadow = true
  scene.add(floor)
  solidMeshes.push(floor)

  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(SEWER_WIDTH + 0.4, 0.2, length), wallMat)
  ceiling.position.set(SEWER_X, SEWER_HEIGHT, centerZ)
  ceiling.castShadow = true
  scene.add(ceiling)
  solidMeshes.push(ceiling)
  colliders.push(new THREE.Box3().setFromObject(ceiling))

  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, SEWER_HEIGHT, length), wallMat)
    wall.position.set(SEWER_X + side * (SEWER_WIDTH / 2 + 0.1), SEWER_HEIGHT / 2, centerZ)
    wall.castShadow = true
    wall.receiveShadow = true
    scene.add(wall)
    solidMeshes.push(wall)
    colliders.push(new THREE.Box3().setFromObject(wall))

    // Pipe running along each wall, just decorative.
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, length, 12), pipeMat)
    pipe.rotation.x = Math.PI / 2
    pipe.position.set(SEWER_X + side * (SEWER_WIDTH / 2 - 0.15), SEWER_HEIGHT - 0.4, centerZ)
    scene.add(pipe)
  }

  const endWall = new THREE.Mesh(new THREE.BoxGeometry(SEWER_WIDTH + 0.4, SEWER_HEIGHT, 0.2), wallMat)
  endWall.position.set(SEWER_X, SEWER_HEIGHT / 2, SEWER_Z_END)
  endWall.castShadow = true
  scene.add(endWall)
  solidMeshes.push(endWall)
  colliders.push(new THREE.Box3().setFromObject(endWall))

  // Widened from 5 to 8 - fewer simultaneous lights (every scene light gets
  // evaluated in every visible fragment's shader in this game's classic
  // forward-rendering setup, so total light count is a real, constant cost)
  // while still keeping consecutive lights' own falloff radii overlapping.
  const lightSpacing = 8
  const lightCount = Math.floor(length / lightSpacing)
  for (let i = 1; i < lightCount; i++) {
    const z = SEWER_Z_START + lightSpacing * i
    const light = new THREE.PointLight(0x7ee08a, 0.7, 5, 2)
    light.position.set(SEWER_X, SEWER_HEIGHT - 0.3, z)
    scene.add(light)
    flickerLights.push({ light, base: 0.7, seed: Math.random() * 100 })
  }

  return { chestSpot: { x: SEWER_X, y: 0, z: SEWER_Z_START + length / 2 } }
}

// A genuine below-ground level (unlike the sewer above, which sits at
// street floor height inside a walled corridor) - a street-level entrance
// kiosk with a descending staircase (see buildStairFlight, the same
// primitive the lookout-tower platforms use, just run downward instead of
// up) into a subway platform at SUBWAY_FLOOR_Y, dressed with a platform
// edge, rails, and a stalled train car.
const SUBWAY_X = 13
const SUBWAY_Z_START = -9
const SUBWAY_Z_END = 11
const SUBWAY_WIDTH = 5.5
const SUBWAY_HEIGHT = 3.2
const SUBWAY_FLOOR_Y = -4.6

// The street-level entrance used to sit right here (SUBWAY_X, just south of
// SUBWAY_Z_START) - moved into the park instead (see
// buildSubwayParkEntrance/buildSubwayConnector), so this platform now opens
// at BOTH ends: the park connector plugs in at SUBWAY_Z_START (no
// endWallStart anymore, mirroring the endWallFar removal below), and the
// VIREO facility continues past SUBWAY_Z_END like before.

function buildSubway(scene, colliders, solidMeshes, flickerLights) {
  const length = SUBWAY_Z_END - SUBWAY_Z_START
  const centerZ = (SUBWAY_Z_START + SUBWAY_Z_END) / 2

  const wallMat = cachedFlatMaterial({ color: 0x2c2e30, roughness: 0.95 })
  const floorMat = cachedFlatMaterial({ color: 0x201f1c, roughness: 1 })
  const tileMat = cachedFlatMaterial({ color: 0x3a3f42, roughness: 0.7 })
  const platformMat = cachedFlatMaterial({ color: 0x4a4238, roughness: 0.9 })
  const railMat = cachedFlatMaterial({ color: 0x1a1a18, roughness: 0.4, metalness: 0.7 })

  const floor = new THREE.Mesh(new THREE.BoxGeometry(SUBWAY_WIDTH, 0.08, length), floorMat)
  floor.position.set(SUBWAY_X, SUBWAY_FLOOR_Y, centerZ)
  floor.receiveShadow = true
  scene.add(floor)
  solidMeshes.push(floor)

  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(SUBWAY_WIDTH + 0.4, 0.2, length), wallMat)
  ceiling.position.set(SUBWAY_X, SUBWAY_FLOOR_Y + SUBWAY_HEIGHT, centerZ)
  ceiling.castShadow = true
  scene.add(ceiling)
  solidMeshes.push(ceiling)
  colliders.push(new THREE.Box3().setFromObject(ceiling))

  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, SUBWAY_HEIGHT, length), wallMat)
    wall.position.set(SUBWAY_X + side * (SUBWAY_WIDTH / 2 + 0.1), SUBWAY_FLOOR_Y + SUBWAY_HEIGHT / 2, centerZ)
    wall.castShadow = true
    wall.receiveShadow = true
    scene.add(wall)
    solidMeshes.push(wall)
    colliders.push(new THREE.Box3().setFromObject(wall))

    // Tile band along the wall, purely decorative.
    const tileBand = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.8, length), tileMat)
    tileBand.position.set(SUBWAY_X + side * (SUBWAY_WIDTH / 2), SUBWAY_FLOOR_Y + 1.4, centerZ)
    scene.add(tileBand)
  }

  // No wall at either end anymore - SUBWAY_Z_START now opens into the park
  // connector (see buildSubwayConnector) and SUBWAY_Z_END continues
  // straight into the VIREO facility extension instead of dead-ending, see
  // buildVireoFacility, which now attaches right at SUBWAY_Z_END and is
  // this subway's second exit (surfacing further down the line) as well as
  // where the terminal now lives, replacing its old standalone-tunnel
  // entrance.

  // Raised platform running down one side, with rails + a stalled train car
  // in the trackbed on the other side - the two details that actually read
  // as "subway" rather than a generic underground corridor like the sewer.
  const platformWidth = 1.6
  const platform = new THREE.Mesh(new THREE.BoxGeometry(platformWidth, 0.35, length - 1), platformMat)
  platform.position.set(SUBWAY_X - SUBWAY_WIDTH / 2 + platformWidth / 2 + 0.15, SUBWAY_FLOOR_Y + 0.175, centerZ)
  platform.castShadow = true
  platform.receiveShadow = true
  scene.add(platform)
  solidMeshes.push(platform)

  const trackCenterX = SUBWAY_X + 0.6
  for (const railOffset of [-0.5, 0.5]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, length - 1), railMat)
    rail.position.set(trackCenterX + railOffset, SUBWAY_FLOOR_Y + 0.03, centerZ)
    scene.add(rail)
  }
  for (let z = SUBWAY_Z_START + 1; z < SUBWAY_Z_END - 1; z += 1) {
    const tie = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 0.15), cachedFlatMaterial({ color: 0x2a2018, roughness: 1 }))
    tie.position.set(trackCenterX, SUBWAY_FLOOR_Y + 0.02, z)
    scene.add(tie)
  }

  const trainMat = cachedFlatMaterial({ color: 0x5a4a1c, roughness: 0.6, metalness: 0.3 })
  const trainCar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 6.5), trainMat)
  trainCar.position.set(trackCenterX, SUBWAY_FLOOR_Y + 1.3, SUBWAY_Z_END - 5)
  trainCar.castShadow = true
  trainCar.receiveShadow = true
  scene.add(trainCar)
  solidMeshes.push(trainCar)
  colliders.push(new THREE.Box3().setFromObject(trainCar))
  const trainStripeMat = cachedFlatMaterial({ color: 0xe3a63c, roughness: 0.5, emissive: 0xe3a63c, emissiveIntensity: 0.15 })
  const trainStripe = new THREE.Mesh(new THREE.BoxGeometry(2.22, 0.2, 6.5), trainStripeMat)
  trainStripe.position.set(trackCenterX, SUBWAY_FLOOR_Y + 1.1, SUBWAY_Z_END - 5)
  scene.add(trainStripe)

  const lightSpacing = 8 // see buildSewer's own comment on this same change
  const lightCount = Math.floor(length / lightSpacing)
  for (let i = 1; i < lightCount; i++) {
    const z = SUBWAY_Z_START + lightSpacing * i
    const light = new THREE.PointLight(0xbcd4ff, 0.8, 6, 2)
    light.position.set(SUBWAY_X - 1, SUBWAY_FLOOR_Y + SUBWAY_HEIGHT - 0.3, z)
    scene.add(light)
    flickerLights.push({ light, base: 0.8, seed: Math.random() * 100 })
  }

  return { chestSpot: { x: SUBWAY_X, y: SUBWAY_FLOOR_Y, z: SUBWAY_Z_START + 3 } }
}

// A real-looking staircase (concrete side walls, handrails, wide light-
// colored steps with a darker front-edge line per step) rather than the
// bare dark boxes buildStairFlight produces on its own - built specifically
// for the two park entrances rather than changing buildStairFlight itself,
// which many other places (skyscrapers, fire escapes, lookout towers) still
// rely on unchanged. Side walls/rails are deliberately NOT registered as
// colliders: they're tilted to match the slope, and Box3.setFromObject on a
// rotated mesh inflates well past its real footprint (see CLAUDE.md's
// rotated-mesh AABB gotcha) - a naive collider here would risk sealing off
// the stairwell it's supposed to flank. The steps themselves (axis-aligned,
// not rotated) still go through solidMeshes exactly like buildStairFlight's
// own steps do.
function buildRealStaircase(scene, solidMeshes, flickerLights, x, z0, y0, z1, y1, steps, stairWidth = 3.2) {
  const wallMat = cachedFlatMaterial({ color: 0xaaa392, roughness: 0.9 })
  const stepMat = cachedFlatMaterial({ color: 0x8a8478, roughness: 0.85 })
  const stepEdgeMat = cachedFlatMaterial({ color: 0x46423a, roughness: 0.9 })
  const railMat = cachedFlatMaterial({ color: 0x201f1c, roughness: 0.4, metalness: 0.6 })

  const dz = z1 - z0
  const dy = y1 - y0
  const runLength = Math.hypot(dz, dy)
  // Negated dy here, not the more obvious atan2(dy,dz) - verified
  // numerically (a rotation.x on a box uses y'=-sin*z locally), the
  // un-negated version produces a wall/rail tilted to the mirrored slope
  // instead of following the actual staircase.
  const tiltAngle = Math.atan2(-dy, dz)
  const midZ = (z0 + z1) / 2
  const midY = (y0 + y1) / 2
  const wallHeight = 2.4

  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.15, wallHeight, runLength + 0.6), wallMat)
    wall.position.set(x + side * (stairWidth / 2), midY + wallHeight / 2 - 0.4, midZ)
    wall.rotation.x = tiltAngle
    wall.castShadow = true
    wall.receiveShadow = true
    scene.add(wall)

    // Cylinder's default long axis is Y, not Z like the wall's box - a
    // quarter turn (Math.PI/2) around the same X axis first swings it into
    // the wall's Z-aligned convention, then the tiltAngle on top of that
    // applies the same slope. Both are rotations around X, so they just
    // add - no second rotation axis needed (a combined x+z rotation here
    // doesn't compose the way "first one, then the other" intuition
    // suggests).
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, runLength, 8), railMat)
    rail.rotation.x = Math.PI / 2 + tiltAngle
    rail.position.set(x + side * (stairWidth / 2 - 0.18), midY + 1.0, midZ)
    scene.add(rail)
  }

  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const py = THREE.MathUtils.lerp(y0, y1, t)
    const pz = THREE.MathUtils.lerp(z0, z1, t)
    const step = new THREE.Mesh(new THREE.BoxGeometry(stairWidth - 0.35, 0.22, 1.05), stepMat)
    step.position.set(x, py, pz)
    step.castShadow = true
    step.receiveShadow = true
    scene.add(step)
    solidMeshes.push(step) // walkable, intentionally not a horizontal collider

    const edge = new THREE.Mesh(new THREE.BoxGeometry(stairWidth - 0.35, 0.04, 0.06), stepEdgeMat)
    edge.position.set(x, py + 0.11, pz - Math.sign(dz) * 0.5)
    scene.add(edge)
  }

  // Brighter light right at the top of the run (matches daylight spilling
  // in from the surface) fading toward the bottom, instead of the whole
  // shaft being uniformly dim.
  for (const [t, intensity] of [[0.15, 1.6], [0.5, 1.1], [0.85, 0.9]]) {
    const lightZ = THREE.MathUtils.lerp(z0, z1, t)
    const lightY = THREE.MathUtils.lerp(y0, y1, t) + 1.3
    const stairLight = new THREE.PointLight(0xffd9a0, intensity, 8, 2)
    stairLight.position.set(x, lightY, lightZ)
    scene.add(stairLight)
    flickerLights.push({ light: stairLight, base: intensity, seed: Math.random() * 100 })
  }
}

// The subway's real-world entrance - moved into the park (see
// buildPark's PARK_Z_START/END/HALF_WIDTH) instead of a street-side kiosk,
// so walking into the park and taking the stairs down is how the whole
// underground loop (platform -> VIREO facility -> street exit) is reached.
// Sits on the park's central path (x=0), clear of the tree/bench/chest
// spots defined in buildPark.
const SUBWAY_PARK_ENTRANCE_X = 0
const SUBWAY_PARK_ENTRANCE_Z = 61
const SUBWAY_PARK_LANDING_Z = 56.5

function buildSubwayParkEntrance(scene, colliders, solidMeshes, flickerLights) {
  const kioskMat = cachedFlatMaterial({ color: 0x1c1a16, roughness: 0.85 })
  const kioskHalfW = SUBWAY_WIDTH / 2 + 0.3

  const kioskRoof = new THREE.Mesh(new THREE.BoxGeometry(kioskHalfW * 2, 0.25, 3), kioskMat)
  kioskRoof.position.set(SUBWAY_PARK_ENTRANCE_X, 2.6, SUBWAY_PARK_ENTRANCE_Z)
  kioskRoof.castShadow = true
  scene.add(kioskRoof)
  solidMeshes.push(kioskRoof)
  colliders.push(new THREE.Box3().setFromObject(kioskRoof))
  for (const [ox, oz] of [[-kioskHalfW, -1.5], [-kioskHalfW, 1.5], [kioskHalfW, -1.5], [kioskHalfW, 1.5]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.6, 0.2), kioskMat)
    post.position.set(SUBWAY_PARK_ENTRANCE_X + ox, 1.3, SUBWAY_PARK_ENTRANCE_Z + oz)
    post.castShadow = true
    scene.add(post)
  }
  // Paved plaza + the actual hole in the ground are built once, centrally,
  // in buildPark (see UNDERGROUND_PLAZA/UNDERGROUND_HOLE_SUBWAY) - a patch
  // dropped on top here would just re-cover the opening like the last two
  // fix attempts did.
  // Readable "SUBWAY" + down-arrow text via a canvas texture, same technique
  // as the VIREO terminal screen (see buildVireoFacility) - a plain emissive
  // box with no text on it doesn't actually tell a player what's down here.
  // Sized up substantially (was 2.2x0.4) and DoubleSide so it reads from
  // either direction across the park, not just the one the plane happens to
  // face - a player couldn't spot the original at any real distance.
  const signCanvas = document.createElement('canvas')
  signCanvas.width = 512
  signCanvas.height = 96
  const signCtx = signCanvas.getContext('2d')
  signCtx.fillStyle = '#1a1408'
  signCtx.fillRect(0, 0, signCanvas.width, signCanvas.height)
  signCtx.fillStyle = '#ffb347'
  signCtx.font = 'bold 52px sans-serif'
  signCtx.textAlign = 'center'
  signCtx.textBaseline = 'middle'
  signCtx.fillText('SUBWAY ↓', signCanvas.width / 2, signCanvas.height / 2)
  const signTexture = new THREE.CanvasTexture(signCanvas)
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 0.86),
    cachedFlatMaterial({ map: signTexture, emissive: 0xffb347, emissiveMap: signTexture, emissiveIntensity: 1.3, side: THREE.DoubleSide })
  )
  sign.position.set(SUBWAY_PARK_ENTRANCE_X, 3.6, SUBWAY_PARK_ENTRANCE_Z + 1.51)
  sign.rotation.y = Math.PI
  scene.add(sign)

  // Tall beacon pillar above the kiosk so the entrance itself is spottable
  // from across the whole park before the sign text is even legible -
  // matches the safe zone's own beacon-post pattern (see buildSafeZone).
  const beaconMat = cachedFlatMaterial({ color: 0x1a1408, emissive: 0xffb347, emissiveIntensity: 1.6 })
  const beaconPole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 4.2, 8), kioskMat)
  beaconPole.position.set(SUBWAY_PARK_ENTRANCE_X, 4.7, SUBWAY_PARK_ENTRANCE_Z)
  scene.add(beaconPole)
  const beaconLamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), beaconMat)
  beaconLamp.position.set(SUBWAY_PARK_ENTRANCE_X, 6.9, SUBWAY_PARK_ENTRANCE_Z)
  scene.add(beaconLamp)
  const beaconLight = new THREE.PointLight(0xffb347, 2.4, 30, 2)
  beaconLight.position.set(SUBWAY_PARK_ENTRANCE_X, 7, SUBWAY_PARK_ENTRANCE_Z)
  scene.add(beaconLight)

  // Real staircase (walls, handrails, wide lit steps) instead of bare dark
  // boxes - see buildRealStaircase's own comment for why this replaced
  // buildStairFlight here specifically rather than changing that shared
  // function everywhere it's used.
  buildRealStaircase(
    scene, solidMeshes, flickerLights,
    SUBWAY_PARK_ENTRANCE_X, SUBWAY_PARK_ENTRANCE_Z, 0,
    SUBWAY_PARK_LANDING_Z, SUBWAY_FLOOR_Y,
    18, kioskHalfW * 2 - 0.6
  )

  return { x: SUBWAY_PARK_ENTRANCE_X, z: SUBWAY_PARK_ENTRANCE_Z, landingX: SUBWAY_PARK_ENTRANCE_X, landingZ: SUBWAY_PARK_LANDING_Z }
}

// Stage 10 of the Extended Metropolitan Grid plan - "Underground Level -1:
// Subway Stations & Tunnels" (turnstile bottleneck, electricity puzzle,
// pitch-black sections, abandoned trains). First step only, per the user's
// own request: just the entrance stairs, placed beside the EXISTING subway
// kiosk (SUBWAY_PARK_ENTRANCE_X/Z above) rather than reusing it, so this
// reads as a second, distinct access point rather than a duplicate of the
// subway that already exists. Deliberately styled differently (rust/hazard
// orange vs the subway's amber) and labeled "MAINTENANCE ACCESS" so a
// player doesn't confuse the two systems. Ends on a small landing platform
// only - no tunnel content behind it yet, so there's something concrete to
// check before building further.
const NEW_UNDERGROUND_ENTRANCE_X = SUBWAY_PARK_ENTRANCE_X + 9
const NEW_UNDERGROUND_ENTRANCE_Z = 59
const NEW_UNDERGROUND_LANDING_Y = SUBWAY_FLOOR_Y // same depth convention as the existing subway, i.e. "Level -1"

// Real holes cut into the park's ground plane (see buildGroundPlaneWithHoles,
// used from buildPark) so these two stairwells actually look and play like a
// hole you walk down into, instead of a solid ground plane sitting on top of
// buried stair geometry - a flat dark patch and then a solid paved patch were
// both tried first and both still fully hid the stairs, since neither one
// was an actual gap in the mesh. Half-widths are kept a bit narrower than
// each kiosk's own corner-post spacing (2.85 < the subway kiosk's 3.05,
// 1.5 < the new entrance's 1.6) so the support posts still land on solid
// ground/pavement at the edges rather than hanging out over open air.
const UNDERGROUND_HOLE_SUBWAY = {
  xMin: SUBWAY_PARK_ENTRANCE_X - 2.85, xMax: SUBWAY_PARK_ENTRANCE_X + 2.85,
  zMin: SUBWAY_PARK_LANDING_Z - 2, zMax: SUBWAY_PARK_ENTRANCE_Z + 0.5,
}
const UNDERGROUND_HOLE_NEW_ENTRANCE = {
  xMin: NEW_UNDERGROUND_ENTRANCE_X - 1.5, xMax: NEW_UNDERGROUND_ENTRANCE_X + 1.5,
  zMin: 52.2, zMax: NEW_UNDERGROUND_ENTRANCE_Z + 0.5,
}
// One shared paved plaza (regular street-style ground instead of park grass)
// covering both entrances plus the trees that used to crowd right up against
// them, sized to comfortably contain both holes above.
const UNDERGROUND_PLAZA = { x: 3.75, z: 57, w: 18.5, d: 11 }
// Stage 13's hidden complex (bunker -> garage/catacombs/speakeasy) needs the
// exact same "real hole in the main ground plane" fix Stage 10 needed -
// otherwise the intact street-level ground above it wins every floor-height
// raycast no matter how the shaft/stairs below are built (confirmed via the
// same PlayerController._sampleGroundHeight profiling method used for the
// park stairwells). Generously sized by hand around the skyscraper's own
// x=250 (rather than symbolically derived from buildOfficeSkyscraper's own
// internal math) since the ground plane here is built long before the
// skyscraper/bunker's own coordinates exist at runtime - comfortably covers
// the bunker (~x=259.5) through the far end of the shaft (~x=278) with
// margin on both sides. Starts just past the bunker's own east wall
// (x=262, ground-level like the skyscraper itself - no hole needed under
// the bunker or skyscraper, only where the shaft actually descends).
const UNDERGROUND_HOLE_HIDDEN_COMPLEX = { xMin: 261, xMax: 279, zMin: -2, zMax: 2 }
// The Vireo Facility's own exit staircase (see buildVireoFacility) needs this
// same fix a third time - it climbs back up to y=0 on the far side of the
// underground loop from the two entrances above, and without a matching hole
// here the intact street ground plane wins the player's floor-height raycast
// a step or two before the real stairs finish, popping them onto solid
// ground mid-climb instead of walking out the actual exit kiosk (confirmed
// via the same _sampleGroundHeight stepping simulation used to root-cause
// the other two). Hand-computed like UNDERGROUND_HOLE_HIDDEN_COMPLEX above,
// for the same reason: buildVireoFacility's own FACILITY_X/FACILITY_STAIR_
// BOTTOM_Z/FACILITY_EXIT_Z constants (13, 25.5, 30) aren't defined yet at
// this point in the file, and this ground plane is built long before
// buildVireoFacility ever runs.
const UNDERGROUND_HOLE_VIREO_EXIT = { xMin: 13 - 2.85, xMax: 13 + 2.85, zMin: 25.5 - 2, zMax: 30 + 0.5 }

function buildNewUndergroundEntrance(scene, colliders, solidMeshes, flickerLights) {
  const x = NEW_UNDERGROUND_ENTRANCE_X
  const z = NEW_UNDERGROUND_ENTRANCE_Z
  const kioskMat = cachedFlatMaterial({ color: 0x241a14, roughness: 0.9 })
  const hazardMat = cachedFlatMaterial({ color: 0xb0331a, roughness: 0.6, metalness: 0.3 })
  const shaftHalfW = 1.6

  const roof = new THREE.Mesh(new THREE.BoxGeometry(shaftHalfW * 2 + 0.4, 0.2, 3), kioskMat)
  roof.position.set(x, 2.4, z)
  roof.castShadow = true
  scene.add(roof)
  solidMeshes.push(roof)
  colliders.push(new THREE.Box3().setFromObject(roof))
  for (const [ox, oz] of [[-shaftHalfW, -1.4], [-shaftHalfW, 1.4], [shaftHalfW, -1.4], [shaftHalfW, 1.4]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.4, 0.16), hazardMat)
    post.position.set(x + ox, 1.2, z + oz)
    post.castShadow = true
    scene.add(post)
  }

  // Paved plaza + the actual hole in the ground are built once, centrally,
  // in buildPark (see UNDERGROUND_PLAZA/UNDERGROUND_HOLE_NEW_ENTRANCE).

  const signCanvas = document.createElement('canvas')
  signCanvas.width = 512
  signCanvas.height = 96
  const signCtx = signCanvas.getContext('2d')
  signCtx.fillStyle = '#1a0f08'
  signCtx.fillRect(0, 0, signCanvas.width, signCanvas.height)
  signCtx.fillStyle = '#ff7a3c'
  signCtx.font = 'bold 42px sans-serif'
  signCtx.textAlign = 'center'
  signCtx.textBaseline = 'middle'
  signCtx.fillText('MAINTENANCE ACCESS ↓', signCanvas.width / 2, signCanvas.height / 2)
  const signTexture = new THREE.CanvasTexture(signCanvas)
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 0.75),
    cachedFlatMaterial({ map: signTexture, emissive: 0xff7a3c, emissiveMap: signTexture, emissiveIntensity: 1.3, side: THREE.DoubleSide })
  )
  sign.position.set(x, 3.2, z + 1.51)
  sign.rotation.y = Math.PI
  scene.add(sign)

  const beaconLight = new THREE.PointLight(0xff7a3c, 1.8, 20, 2)
  beaconLight.position.set(x, 3.6, z)
  scene.add(beaconLight)

  const landingZ = z - 4
  // Real staircase (walls, handrails, wide lit steps) instead of bare dark
  // boxes - same fix and same reasoning as buildSubwayParkEntrance's own
  // stairs.
  buildRealStaircase(scene, solidMeshes, flickerLights, x, z, 0, landingZ, NEW_UNDERGROUND_LANDING_Y, 16, shaftHalfW * 2 - 0.4)

  // Small landing platform at the bottom - just enough to stand on, no
  // tunnel behind it yet.
  const landingMat = cachedFlatMaterial({ color: 0x2a2620, roughness: 0.9 })
  const landing = new THREE.Mesh(new THREE.BoxGeometry(shaftHalfW * 2 + 1, 0.3, 4), landingMat)
  landing.position.set(x, NEW_UNDERGROUND_LANDING_Y - 0.15, landingZ - 1)
  landing.receiveShadow = true
  scene.add(landing)
  solidMeshes.push(landing)
  colliders.push(new THREE.Box3(
    new THREE.Vector3(x - shaftHalfW - 0.5, NEW_UNDERGROUND_LANDING_Y - 0.3, landingZ - 3),
    new THREE.Vector3(x + shaftHalfW + 0.5, NEW_UNDERGROUND_LANDING_Y, landingZ + 1)
  ))

  // buildRealStaircase already lights the run itself; this one just covers
  // the landing platform specifically.
  const landingLight = new THREE.PointLight(0xff9a5c, 1.2, 8, 2)
  landingLight.position.set(x, NEW_UNDERGROUND_LANDING_Y + 1.5, landingZ - 1)
  scene.add(landingLight)
  flickerLights.push({ light: landingLight, base: 1.2, seed: Math.random() * 100 })

  return { x, z, landingX: x, landingZ: landingZ - 1, landingY: NEW_UNDERGROUND_LANDING_Y }
}

// Long diagonal corridor joining the park entrance's landing point to the
// subway platform's now-open near end (SUBWAY_X, SUBWAY_Z_START) - purely
// underground pieces don't need to respect the surface's groundSize/
// perimeter-barricade bounds the way a surface exit does (see
// addPerimeterBarricade), so this can run however far it needs to between
// two points that are nowhere near each other on the surface. Reuses the
// subway's own width/height/floor-Y for a seamless join at both ends, and
// dresses the long run with the same rib-light spacing the old standalone
// tunnel used, so 65+ units of corridor doesn't read as one dark box.
function buildSubwayConnector(scene, colliders, solidMeshes, flickerLights, x0, z0, x1, z1) {
  const dx = x1 - x0
  const dz = z1 - z0
  const length = Math.hypot(dx, dz)
  const angle = Math.atan2(dx, dz)
  const ux = dx / length
  const uz = dz / length

  const wallMat = cachedFlatMaterial({ color: 0x2c2e30, roughness: 0.95 })
  const floorMat = cachedFlatMaterial({ color: 0x201f1c, roughness: 1 })

  // One long floor piece is fine - floors are never added to `colliders` in
  // this game (see every other corridor builder), so there's no AABB risk
  // from it being a single rotated box.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(SUBWAY_WIDTH, 0.08, length), floorMat)
  floor.position.set((x0 + x1) / 2, SUBWAY_FLOOR_Y, (z0 + z1) / 2)
  floor.rotation.y = angle
  floor.receiveShadow = true
  scene.add(floor)
  solidMeshes.push(floor)

  // Ceiling and walls DO get colliders, and Box3().setFromObject() on one
  // long rotated box would inflate its AABB to cover nearly the entire
  // diagonal span between the two endpoints instead of a slim corridor -
  // the exact rotated-mesh-inflates-its-AABB bug already found and fixed
  // once this session for the trader stall, just at a much bigger scale
  // here (a 65+-unit box turns into a giant slab that blocks almost the
  // whole walk from the park down to the platform). Building short segments
  // keeps each one's own rotation-inflation small instead of spanning the
  // whole run.
  const SEGMENT_LEN = 2
  const segmentCount = Math.ceil(length / SEGMENT_LEN)
  for (let i = 0; i < segmentCount; i++) {
    const segStart = i * SEGMENT_LEN
    const segEnd = Math.min(length, segStart + SEGMENT_LEN)
    const segLen = segEnd - segStart
    const segMidT = (segStart + segEnd) / 2
    const segX = x0 + ux * segMidT
    const segZ = z0 + uz * segMidT

    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(SUBWAY_WIDTH + 0.4, 0.2, segLen), wallMat)
    ceiling.position.set(segX, SUBWAY_FLOOR_Y + SUBWAY_HEIGHT, segZ)
    ceiling.rotation.y = angle
    ceiling.castShadow = true
    scene.add(ceiling)
    solidMeshes.push(ceiling)
    ceiling.updateWorldMatrix(true, false)
    colliders.push(new THREE.Box3().setFromObject(ceiling))

    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, SUBWAY_HEIGHT, segLen), wallMat)
      const perpX = Math.cos(angle) * side * (SUBWAY_WIDTH / 2 + 0.1)
      const perpZ = -Math.sin(angle) * side * (SUBWAY_WIDTH / 2 + 0.1)
      wall.position.set(segX + perpX, SUBWAY_FLOOR_Y + SUBWAY_HEIGHT / 2, segZ + perpZ)
      wall.rotation.y = angle
      wall.castShadow = true
      wall.receiveShadow = true
      scene.add(wall)
      solidMeshes.push(wall)
      wall.updateWorldMatrix(true, false)
      colliders.push(new THREE.Box3().setFromObject(wall))
    }
  }

  const ribSpacing = 9 // see buildSewer's own comment on this same change
  const ribCount = Math.floor(length / ribSpacing)
  for (let i = 1; i < ribCount; i++) {
    const t = (i * ribSpacing) / length
    const rx = x0 + dx * t
    const rz = z0 + dz * t
    const light = new THREE.PointLight(0xbcd4ff, 0.7, 6, 2)
    light.position.set(rx, SUBWAY_FLOOR_Y + SUBWAY_HEIGHT - 0.3, rz)
    scene.add(light)
    flickerLights.push({ light, base: 0.7, seed: Math.random() * 100 })
  }
}

// Stage 10 continuation - the actual Level -1 tunnel content behind the new
// "maintenance access" entrance, whose landing was left as a deliberate dead
// end (see buildNewUndergroundEntrance's own comment) until the user could
// confirm the stairs themselves worked. Four elements from the original
// stage plan, in order along one straight corridor south of the landing:
// a pitch-black stretch (buildDarkSubwayConnector - identical to
// buildSubwayConnector but with no automatic lights), a breaker box the
// player must hold-to-charge in the dark to restore power (mirrors Game.js's
// existing ammo-station hold-to-charge pattern exactly), a turnstile gate
// that only opens once power is restored (not a free-interact unlock like
// the lockedCells doors elsewhere - see Game.js's _restoreTunnelPower), and
// a normal lit stretch (plain buildSubwayConnector reuse) ending at a
// wrecked-train dead end with a reward chest.
const MAINT_TUNNEL_X = NEW_UNDERGROUND_ENTRANCE_X // 9 - straight south of the landing, same X the stairs already used
const MAINT_DARK_Z_START = 52 // the landing's own open south edge
const MAINT_BREAKER_Z = 47
const MAINT_GATE_Z = 42
const MAINT_WRECK_Z = 20

function buildDarkSubwayConnector(scene, colliders, solidMeshes, x0, z0, x1, z1) {
  const dx = x1 - x0
  const dz = z1 - z0
  const length = Math.hypot(dx, dz)
  const angle = Math.atan2(dx, dz)
  const ux = dx / length
  const uz = dz / length

  const wallMat = cachedFlatMaterial({ color: 0x232426, roughness: 0.95 })
  const floorMat = cachedFlatMaterial({ color: 0x1a1916, roughness: 1 })

  const floor = new THREE.Mesh(new THREE.BoxGeometry(SUBWAY_WIDTH, 0.08, length), floorMat)
  floor.position.set((x0 + x1) / 2, SUBWAY_FLOOR_Y, (z0 + z1) / 2)
  floor.rotation.y = angle
  floor.receiveShadow = true
  scene.add(floor)
  solidMeshes.push(floor)

  // Same short-segment approach as buildSubwayConnector, for the same
  // rotated-mesh-AABB reason (see that function's own comment).
  const SEGMENT_LEN = 2
  const segmentCount = Math.ceil(length / SEGMENT_LEN)
  for (let i = 0; i < segmentCount; i++) {
    const segStart = i * SEGMENT_LEN
    const segEnd = Math.min(length, segStart + SEGMENT_LEN)
    const segLen = segEnd - segStart
    const segMidT = (segStart + segEnd) / 2
    const segX = x0 + ux * segMidT
    const segZ = z0 + uz * segMidT

    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(SUBWAY_WIDTH + 0.4, 0.2, segLen), wallMat)
    ceiling.position.set(segX, SUBWAY_FLOOR_Y + SUBWAY_HEIGHT, segZ)
    ceiling.rotation.y = angle
    scene.add(ceiling)
    solidMeshes.push(ceiling)
    ceiling.updateWorldMatrix(true, false)
    colliders.push(new THREE.Box3().setFromObject(ceiling))

    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, SUBWAY_HEIGHT, segLen), wallMat)
      const perpX = Math.cos(angle) * side * (SUBWAY_WIDTH / 2 + 0.1)
      const perpZ = -Math.sin(angle) * side * (SUBWAY_WIDTH / 2 + 0.1)
      wall.position.set(segX + perpX, SUBWAY_FLOOR_Y + SUBWAY_HEIGHT / 2, segZ + perpZ)
      wall.rotation.y = angle
      wall.receiveShadow = true
      scene.add(wall)
      solidMeshes.push(wall)
      wall.updateWorldMatrix(true, false)
      colliders.push(new THREE.Box3().setFromObject(wall))
    }
  }
  // Deliberately no rib-light loop here (unlike buildSubwayConnector) - this
  // stretch starts genuinely unlit. buildMaintenanceTunnelNetwork adds its
  // own lights at intensity 0, turned on by Game.js's _restoreTunnelPower.
}

// A small wall-mounted electrical panel - the "electricity puzzle" the
// player has to find in the dark and hold-to-charge (see Game.js's
// _updateBreakerBox, which mirrors _updateAmmoStation's exact hold pattern).
// buttonMat is swapped red/amber/green the same way the ammo station and
// lockedCells doors already do, for the same locked/charging/done reading.
function buildBreakerBox(scene, x, z) {
  const panelMat = cachedFlatMaterial({ color: 0x2a2a26, roughness: 0.7, metalness: 0.3 })
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.15), panelMat)
  panel.position.set(x, SUBWAY_FLOOR_Y + 1.4, z)
  panel.castShadow = true
  scene.add(panel)

  // NOT cachedFlatMaterial - Game.js's _updateBreakerBox mutates this
  // per-instance while charging. Confirmed this collides with
  // buildAmmoStation's buttonMat fallback (identical opts).
  const indicatorMat = flatMaterial({ color: 0x2a0808, emissive: 0xff2a1e, emissiveIntensity: 1.1 })
  const indicator = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.02), indicatorMat)
  indicator.position.set(x, SUBWAY_FLOOR_Y + 1.7, z + 0.08)
  scene.add(indicator)

  const pipeMat = cachedFlatMaterial({ color: 0x1c1c1a, roughness: 0.6, metalness: 0.5 })
  const pipeHeight = SUBWAY_HEIGHT - 1.9
  for (const ox of [-0.3, 0.3]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, pipeHeight, 8), pipeMat)
    pipe.position.set(x + ox, SUBWAY_FLOOR_Y + 1.95 + pipeHeight / 2, z)
    scene.add(pipe)
  }

  return { x, z, buttonMat: indicatorMat }
}

// A physical gate blocking the corridor - unlike buildLockableDoor's
// doors elsewhere (which unlock for free on interact), this one only opens
// once the breaker box's power-restore puzzle succeeds (see Game.js's
// _restoreTunnelPower), so it's built by hand here rather than reusing that
// helper. mesh/sign are hidden together on unlock.
function buildMaintTurnstileGate(scene, x, z) {
  const gateMat = cachedFlatMaterial({ color: 0x2a2a26, roughness: 0.6, metalness: 0.5 })
  const gateMesh = new THREE.Mesh(new THREE.BoxGeometry(SUBWAY_WIDTH - 0.4, SUBWAY_HEIGHT - 0.4, 0.2), gateMat)
  gateMesh.position.set(x, SUBWAY_FLOOR_Y + (SUBWAY_HEIGHT - 0.4) / 2 + 0.2, z)
  gateMesh.castShadow = true
  scene.add(gateMesh)
  gateMesh.updateWorldMatrix(true, false)
  const gateBox = new THREE.Box3().setFromObject(gateMesh) // axis-aligned, not rotated - setFromObject is safe here

  // NOT cachedFlatMaterial - Game.js mutates this on unlock. Confirmed
  // this collides with buildLockableDoor's indicatorMat (identical opts).
  const indicatorMat = flatMaterial({ color: 0x1a0505, emissive: 0xff2a1e, emissiveIntensity: 0.9 })
  const indicator = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), indicatorMat)
  indicator.position.set(x, SUBWAY_FLOOR_Y + SUBWAY_HEIGHT - 0.3, z)
  scene.add(indicator)

  const signCanvas = document.createElement('canvas')
  signCanvas.width = 512
  signCanvas.height = 128
  const ctx = signCanvas.getContext('2d')
  ctx.fillStyle = '#1a0f08'
  ctx.fillRect(0, 0, signCanvas.width, signCanvas.height)
  ctx.fillStyle = '#ff5a3c'
  ctx.font = 'bold 44px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('GATE LOCKED - NO POWER', signCanvas.width / 2, signCanvas.height / 2)
  const signTex = new THREE.CanvasTexture(signCanvas)
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 0.6),
    cachedFlatMaterial({ map: signTex, emissive: 0xff5a3c, emissiveMap: signTex, emissiveIntensity: 1.1, side: THREE.DoubleSide })
  )
  sign.position.set(x, SUBWAY_FLOOR_Y + 1.9, z + 0.12)
  scene.add(sign)

  return { x, z, mesh: gateMesh, box: gateBox, indicatorMat, sign }
}

// The "abandoned train" dead end - a visibly different derelict (tipped
// over, rust-brown, crashed against the end wall) from buildSubway's own
// upright, parked train car, so it doesn't feel like reused content. Wreck
// and rubble are deliberately not colliders/solidMeshes (rotated-mesh AABB
// gotcha for the tipped wreck; the rubble is just loose dressing the
// player can walk past, not through a real obstacle).
function buildWreckedTrainChamber(scene, colliders, solidMeshes, x, z, chestSpots) {
  const wallMat = cachedFlatMaterial({ color: 0x232426, roughness: 0.95 })

  // The lit connector leading here (buildSubwayConnector, x, MAINT_GATE_Z, x,
  // MAINT_WRECK_Z) only lays its own floor down to z - this chamber is a
  // separate room past that point (out to the end wall at z-4) and needs its
  // own floor slab, or _sampleGroundHeight finds nothing underfoot the moment
  // the player steps past z and snaps them back up to street level.
  const floorMat = cachedFlatMaterial({ color: 0x1a1916, roughness: 1 })
  const floor = new THREE.Mesh(new THREE.BoxGeometry(SUBWAY_WIDTH, 0.08, 4.4), floorMat)
  floor.position.set(x, SUBWAY_FLOOR_Y, z - 2)
  floor.receiveShadow = true
  scene.add(floor)
  solidMeshes.push(floor)

  const endWall = new THREE.Mesh(new THREE.BoxGeometry(SUBWAY_WIDTH + 0.4, SUBWAY_HEIGHT, 0.2), wallMat)
  endWall.position.set(x, SUBWAY_FLOOR_Y + SUBWAY_HEIGHT / 2, z - 4)
  scene.add(endWall)
  solidMeshes.push(endWall)
  colliders.push(new THREE.Box3().setFromObject(endWall))

  // The connector leading here has its own side walls, but they stop at z
  // (its own end) - this chamber never had any of its own, so there was
  // nothing at all stopping lateral drift once past z. The floor slab
  // above is only as wide as the corridor, so any sideways drift inside
  // this room (very plausible mid-fight, not just from walking dead
  // straight) eventually walks the player right off its edge into open
  // space, with the same "nothing underfoot, snap to street level" result
  // as the missing floor itself used to cause.
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, SUBWAY_HEIGHT, 4.4), wallMat)
    wall.position.set(x + side * (SUBWAY_WIDTH / 2 + 0.1), SUBWAY_FLOOR_Y + SUBWAY_HEIGHT / 2, z - 2)
    wall.castShadow = true
    wall.receiveShadow = true
    scene.add(wall)
    solidMeshes.push(wall)
    colliders.push(new THREE.Box3().setFromObject(wall))
  }

  const bodyMat = cachedFlatMaterial({ color: 0x4a2e1e, roughness: 0.9, metalness: 0.1 })
  const wreck = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3, 6), bodyMat)
  wreck.position.set(x - 0.6, SUBWAY_FLOOR_Y + 1.3, z - 1)
  wreck.rotation.z = -Math.PI / 2.6
  wreck.castShadow = true
  scene.add(wreck)

  const rubbleMat = cachedFlatMaterial({ color: 0x3a352e, roughness: 1 })
  for (const [rx, rz, s] of [[1.4, -2.5, 0.5], [1.8, -1, 0.35], [1.2, 0.5, 0.45]]) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s), rubbleMat)
    rock.position.set(x + rx, SUBWAY_FLOOR_Y + s * 0.6, z + rz)
    rock.castShadow = true
    scene.add(rock)
  }

  const emergencyLight = new THREE.PointLight(0xff3a1a, 1.3, 10, 2)
  emergencyLight.position.set(x, SUBWAY_FLOOR_Y + SUBWAY_HEIGHT - 0.4, z - 2)
  scene.add(emergencyLight)

  chestSpots.push({ x, y: SUBWAY_FLOOR_Y, z: z + 1.5 })

  return { x, z, emergencyLight }
}

function buildMaintenanceTunnelNetwork(scene, colliders, solidMeshes, flickerLights, chestSpots) {
  const x = MAINT_TUNNEL_X

  buildDarkSubwayConnector(scene, colliders, solidMeshes, x, MAINT_DARK_Z_START, x, MAINT_GATE_Z)
  const tunnelDarkLights = []
  for (const lz of [MAINT_DARK_Z_START - 2, MAINT_BREAKER_Z, MAINT_GATE_Z + 2]) {
    const light = new THREE.PointLight(0xbcd4ff, 0, 6, 2) // intensity 0 - see Game.js's _restoreTunnelPower
    light.position.set(x, SUBWAY_FLOOR_Y + SUBWAY_HEIGHT - 0.3, lz)
    scene.add(light)
    tunnelDarkLights.push(light)
  }

  // Mounted flush against the corridor's own west wall (wall inner face
  // sits at x - SUBWAY_WIDTH/2 - 0.1 + 0.1 = x - SUBWAY_WIDTH/2, see
  // buildSubwayConnector's own wall placement math) plus half the panel's
  // own depth so it doesn't clip into the wall.
  const breakerBox = buildBreakerBox(scene, x - SUBWAY_WIDTH / 2 + 0.075, MAINT_BREAKER_Z)
  const turnstile = buildMaintTurnstileGate(scene, x, MAINT_GATE_Z)

  // Lit stretch beyond the gate - a normal, always-lit tunnel like every
  // other subway segment, since only the breaker-box approach needs the
  // "pitch black until powered" effect.
  buildSubwayConnector(scene, colliders, solidMeshes, flickerLights, x, MAINT_GATE_Z, x, MAINT_WRECK_Z)
  const trainWreck = buildWreckedTrainChamber(scene, colliders, solidMeshes, x, MAINT_WRECK_Z, chestSpots)

  return { breakerBox, turnstile, tunnelDarkLights, trainWreck }
}

// An open square room - floor and ceiling only, deliberately no side walls
// at all - joining two perpendicular buildSubwayConnector legs at a corner.
// Two straight tunnels can't just be abutted end-to-end at a 90-degree turn:
// the corridor running east-west has its own north/south walls the full
// length of its run, and that same wall is exactly what a north-south
// corridor would need to cross to reach it - there's no doorway unless one
// is deliberately built in. Each connecting leg should stop `halfSize`
// short of this room's center (see buildWorld's call site) so neither leg's
// own walls intrude into the shared open space.
function buildSubwayJunctionRoom(scene, colliders, solidMeshes, cx, cz, halfSize, openSides = []) {
  const floorMat = cachedFlatMaterial({ color: 0x201f1c, roughness: 1 })
  const wallMat = cachedFlatMaterial({ color: 0x2c2e30, roughness: 0.95 })

  // Slightly larger than the room's nominal halfSize*2 footprint (matching
  // the +0.4 margin the walls below already use for their own width) so
  // the floor fully backs every wall's own footprint with no gap between
  // the floor's true edge and the wall's outer face - found via a walk-sim
  // that showed _sampleGroundHeight breaking exactly at the floor's old,
  // unpadded edge, one step before the wall's own outer face.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(halfSize * 2 + 0.4, 0.08, halfSize * 2 + 0.4), floorMat)
  floor.position.set(cx, SUBWAY_FLOOR_Y, cz)
  floor.receiveShadow = true
  scene.add(floor)
  solidMeshes.push(floor)

  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(halfSize * 2, 0.2, halfSize * 2), wallMat)
  ceiling.position.set(cx, SUBWAY_FLOOR_Y + SUBWAY_HEIGHT, cz)
  ceiling.castShadow = true
  scene.add(ceiling)
  solidMeshes.push(ceiling)
  colliders.push(new THREE.Box3().setFromObject(ceiling))

  // Any side without a real connector attached used to be a bare gap
  // straight into unbuilt void space beyond - both a visual leak (you could
  // see straight through into empty space) and a walkable one (nothing
  // stopped the player from walking right off the floor's edge into an
  // unfloored area, which reads as "teleported to the surface" once
  // _sampleGroundHeight finds nothing underfoot out there). Wall off every
  // side except whichever ones openSides names as a real connector's own
  // attachment point.
  const sides = {
    north: { x: cx, z: cz + halfSize, w: halfSize * 2 + 0.4, d: 0.2 },
    south: { x: cx, z: cz - halfSize, w: halfSize * 2 + 0.4, d: 0.2 },
    east: { x: cx + halfSize, z: cz, w: 0.2, d: halfSize * 2 + 0.4 },
    west: { x: cx - halfSize, z: cz, w: 0.2, d: halfSize * 2 + 0.4 },
  }
  for (const [side, spec] of Object.entries(sides)) {
    if (openSides.includes(side)) continue
    const wall = new THREE.Mesh(new THREE.BoxGeometry(spec.w, SUBWAY_HEIGHT, spec.d), wallMat)
    wall.position.set(spec.x, SUBWAY_FLOOR_Y + SUBWAY_HEIGHT / 2, spec.z)
    wall.castShadow = true
    wall.receiveShadow = true
    scene.add(wall)
    solidMeshes.push(wall)
    colliders.push(new THREE.Box3().setFromObject(wall))
  }
}

// A genuinely new underground floor, not just another station stop - the
// hall is nearly double the standard tunnel width, with two office alcoves
// cut into its west wall and a dead-end maintenance stub off its south end.
// Branches off the existing subway loop's second junction room (see
// buildWorld's SUBWAY_X/connectorWaypointZ junction) via a standard
// buildSubwayConnector run, so reaching it means walking further down the
// existing park -> platform loop, not finding a separate entrance.
const STATION_X = SUBWAY_X
const STATION_WIDTH = 9
const STATION_HEIGHT = 3.6
const STATION_Z_START = -55
const STATION_Z_END = -33
const STATION_OFFICE_SIZE = 4
// z-ranges the west wall leaves open for the two office doorways, matching
// each office room's own footprint exactly - see buildOffice below.
const STATION_OFFICE_A_Z = [-42, -38]
const STATION_OFFICE_B_Z = [-52, -48]
const STATION_STUB_Z_END = STATION_Z_START - 6
// A genuine second underground level, one floor below the station itself -
// stairs down from the maintenance stub's former dead end (see below) drop
// 6 units to LEVEL2_FLOOR_Y, opening into its own platform/tracks hall, the
// same scale as the original subway (see buildSubway) rather than the
// widened station above it. Far enough south (z<=-69) that nothing else
// underground has ever been placed anywhere near it.
const LEVEL2_FLOOR_Y = SUBWAY_FLOOR_Y - 6
const LEVEL2_STAIR_RUN = 8
const LEVEL2_Z_NEAR = STATION_STUB_Z_END - LEVEL2_STAIR_RUN
const LEVEL2_Z_FAR = LEVEL2_Z_NEAR - 20

function buildUndergroundStation(scene, colliders, solidMeshes, flickerLights, chestSpots) {
  const length = STATION_Z_END - STATION_Z_START
  const centerZ = (STATION_Z_START + STATION_Z_END) / 2

  const wallMat = cachedFlatMaterial({ color: 0x24272a, roughness: 0.95 })
  const floorMat = cachedFlatMaterial({ color: 0x1c1b18, roughness: 1 })
  const platformMat = cachedFlatMaterial({ color: 0x4a4238, roughness: 0.9 })
  const railMat = cachedFlatMaterial({ color: 0x1a1a18, roughness: 0.4, metalness: 0.7 })

  const floor = new THREE.Mesh(new THREE.BoxGeometry(STATION_WIDTH, 0.08, length), floorMat)
  floor.position.set(STATION_X, SUBWAY_FLOOR_Y, centerZ)
  floor.receiveShadow = true
  scene.add(floor)
  solidMeshes.push(floor)

  // No north/south end walls - the north end (STATION_Z_END) is where the
  // connector from the existing junction room opens in, and the south end
  // (STATION_Z_START) is where the maintenance stub opens off, same "open
  // ends, no cap" pattern buildSubway itself uses.
  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(STATION_WIDTH + 0.4, 0.2, length), wallMat)
  ceiling.position.set(STATION_X, SUBWAY_FLOOR_Y + STATION_HEIGHT, centerZ)
  ceiling.castShadow = true
  scene.add(ceiling)
  solidMeshes.push(ceiling)
  colliders.push(new THREE.Box3().setFromObject(ceiling))

  const eastWall = new THREE.Mesh(new THREE.BoxGeometry(0.2, STATION_HEIGHT, length), wallMat)
  eastWall.position.set(STATION_X + STATION_WIDTH / 2 + 0.1, SUBWAY_FLOOR_Y + STATION_HEIGHT / 2, centerZ)
  eastWall.castShadow = true
  eastWall.receiveShadow = true
  scene.add(eastWall)
  solidMeshes.push(eastWall)
  colliders.push(new THREE.Box3().setFromObject(eastWall))

  // West wall: three solid segments, leaving the two office z-ranges open -
  // same "build the solid pieces, skip the doorway" approach buildSkyscraper
  // uses for its open facade, just with two gaps instead of one whole side.
  const westX = STATION_X - STATION_WIDTH / 2 - 0.1
  const westSegments = [
    [STATION_Z_START, STATION_OFFICE_B_Z[0]],
    [STATION_OFFICE_B_Z[1], STATION_OFFICE_A_Z[0]],
    [STATION_OFFICE_A_Z[1], STATION_Z_END],
  ]
  for (const [segStart, segEnd] of westSegments) {
    const segLen = segEnd - segStart
    const segZ = (segStart + segEnd) / 2
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, STATION_HEIGHT, segLen), wallMat)
    wall.position.set(westX, SUBWAY_FLOOR_Y + STATION_HEIGHT / 2, segZ)
    wall.castShadow = true
    wall.receiveShadow = true
    scene.add(wall)
    solidMeshes.push(wall)
    colliders.push(new THREE.Box3().setFromObject(wall))
  }

  // Platform + tracks down the middle, same visual language as the existing
  // subway (see buildSubway) - wider hall, so a wider platform too.
  const platformWidth = 2.4
  const platform = new THREE.Mesh(new THREE.BoxGeometry(platformWidth, 0.35, length - 1), platformMat)
  platform.position.set(STATION_X - STATION_WIDTH / 2 + platformWidth / 2 + 0.15, SUBWAY_FLOOR_Y + 0.175, centerZ)
  platform.castShadow = true
  platform.receiveShadow = true
  scene.add(platform)
  solidMeshes.push(platform)

  const trackCenterX = STATION_X + 1.5
  for (const railOffset of [-0.5, 0.5]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, length - 1), railMat)
    rail.position.set(trackCenterX + railOffset, SUBWAY_FLOOR_Y + 0.03, centerZ)
    scene.add(rail)
  }
  for (let z = STATION_Z_START + 1; z < STATION_Z_END - 1; z += 1) {
    const tie = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 0.15), cachedFlatMaterial({ color: 0x2a2018, roughness: 1 }))
    tie.position.set(trackCenterX, SUBWAY_FLOOR_Y + 0.02, z)
    scene.add(tie)
  }

  const lightSpacing = 8 // see buildSewer's own comment on this same change
  const lightCount = Math.floor(length / lightSpacing)
  for (let i = 1; i < lightCount; i++) {
    const z = STATION_Z_START + lightSpacing * i
    const light = new THREE.PointLight(0xbcd4ff, 0.9, 7, 2)
    light.position.set(STATION_X, SUBWAY_FLOOR_Y + STATION_HEIGHT - 0.3, z)
    scene.add(light)
    flickerLights.push({ light, base: 0.9, seed: Math.random() * 100 })
  }

  // Two office alcoves, each a small enclosed room flush against a west-wall
  // gap - walled on far/north/south, open on the east side where the gap is.
  const buildOffice = (zRange) => {
    const [z0, z1] = zRange
    const cz = (z0 + z1) / 2
    const officeCenterX = westX - STATION_OFFICE_SIZE / 2
    const officeFarX = westX - STATION_OFFICE_SIZE

    const officeFloor = new THREE.Mesh(new THREE.BoxGeometry(STATION_OFFICE_SIZE, 0.08, z1 - z0), floorMat)
    officeFloor.position.set(officeCenterX, SUBWAY_FLOOR_Y, cz)
    officeFloor.receiveShadow = true
    scene.add(officeFloor)
    solidMeshes.push(officeFloor)

    const officeCeiling = new THREE.Mesh(new THREE.BoxGeometry(STATION_OFFICE_SIZE, 0.2, z1 - z0), wallMat)
    officeCeiling.position.set(officeCenterX, SUBWAY_FLOOR_Y + STATION_HEIGHT, cz)
    officeCeiling.castShadow = true
    scene.add(officeCeiling)
    solidMeshes.push(officeCeiling)
    colliders.push(new THREE.Box3().setFromObject(officeCeiling))

    const officeWallSpecs = [
      { bw: 0.2, bd: z1 - z0, x: officeFarX, z: cz },
      { bw: STATION_OFFICE_SIZE, bd: 0.2, x: officeCenterX, z: z0 },
      { bw: STATION_OFFICE_SIZE, bd: 0.2, x: officeCenterX, z: z1 },
    ]
    for (const s of officeWallSpecs) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(s.bw, STATION_HEIGHT, s.bd), wallMat)
      wall.position.set(s.x, SUBWAY_FLOOR_Y + STATION_HEIGHT / 2, s.z)
      wall.castShadow = true
      wall.receiveShadow = true
      scene.add(wall)
      solidMeshes.push(wall)
      colliders.push(new THREE.Box3().setFromObject(wall))
    }
    return { x: officeCenterX, z: cz }
  }

  const officeASpot = buildOffice(STATION_OFFICE_A_Z)
  const officeBSpot = buildOffice(STATION_OFFICE_B_Z)

  // Dead-end maintenance stub off the hall's open south end - same
  // standard-width connector primitive as the rest of the underground loop
  // (narrower than the hall itself, so its walls start clean at the
  // boundary rather than needing to cut into anything) - no longer a dead
  // end (see the stairs-down section further below), so it's left open at
  // this end instead of getting a cap wall.
  buildSubwayConnector(scene, colliders, solidMeshes, flickerLights, STATION_X, STATION_Z_START, STATION_X, STATION_STUB_Z_END)

  const maintenanceSignMat = cachedFlatMaterial({ color: 0x1a1408, roughness: 0.7, emissive: 0xffcc44, emissiveIntensity: 0.6 })
  const maintenanceSign = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 0.05), maintenanceSignMat)
  maintenanceSign.position.set(STATION_X, SUBWAY_FLOOR_Y + 2.2, STATION_STUB_Z_END - 0.12)
  scene.add(maintenanceSign)

  // Lore terminal, same screen-texture technique as the VIREO terminal - set
  // into the east wall near the platform, screen facing into the hall.
  const terminalZ = STATION_Z_END - 3
  const terminalX = STATION_X + STATION_WIDTH / 2 - 0.6
  const terminalMat = cachedFlatMaterial({ color: 0x1a1a1a, roughness: 0.6 })
  const terminalBody = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.4), terminalMat)
  terminalBody.position.set(terminalX, SUBWAY_FLOOR_Y + 0.55, terminalZ)
  terminalBody.castShadow = true
  scene.add(terminalBody)
  solidMeshes.push(terminalBody)
  colliders.push(new THREE.Box3().setFromObject(terminalBody))

  const screenCanvas = document.createElement('canvas')
  screenCanvas.width = 128
  screenCanvas.height = 96
  const screenCtx = screenCanvas.getContext('2d')
  screenCtx.fillStyle = '#050a05'
  screenCtx.fillRect(0, 0, screenCanvas.width, screenCanvas.height)
  screenCtx.fillStyle = '#3fff6a'
  screenCtx.font = '10px monospace'
  screenCtx.fillText('TRANSIT AUTH', 4, 16)
  screenCtx.fillText('LINE STATUS:', 4, 32)
  screenCtx.fillText('OFFLINE', 4, 46)
  screenCtx.fillText('[ACCESS]', 4, 72)
  const screenTexture = new THREE.CanvasTexture(screenCanvas)
  const screenMat = cachedFlatMaterial({
    map: screenTexture,
    emissive: 0xffffff,
    emissiveMap: screenTexture,
    emissiveIntensity: 0.8,
  })
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.38), screenMat)
  screen.position.set(terminalX - 0.36, SUBWAY_FLOOR_Y + 0.85, terminalZ)
  screen.rotation.y = -Math.PI / 2
  scene.add(screen)

  chestSpots.push({ x: officeASpot.x, y: SUBWAY_FLOOR_Y, z: officeASpot.z })
  chestSpots.push({ x: officeBSpot.x, y: SUBWAY_FLOOR_Y, z: officeBSpot.z })

  // Stairs down from the maintenance stub's open south end to a genuine
  // second level below (see LEVEL2_FLOOR_Y et al above) - the station
  // above is one full floor, this is another, not just more corridor at
  // the same depth.
  buildStairFlight(
    scene, solidMeshes,
    STATION_X, STATION_STUB_Z_END, SUBWAY_FLOOR_Y,
    STATION_X, LEVEL2_Z_NEAR, LEVEL2_FLOOR_Y,
    18
  )

  // Same unlit-void problem as the park entrance stairs (see
  // buildSubwayParkEntrance) - the maintenance stub connector is exactly
  // its own ribSpacing (6 units) long, so its light loop's `i < ribCount`
  // never runs a single iteration, and buildStairFlight itself never adds
  // lights either. Two lights bracket the stub-to-level2 drop.
  for (const t of [0.3, 0.8]) {
    const lightZ = THREE.MathUtils.lerp(STATION_STUB_Z_END, LEVEL2_Z_NEAR, t)
    const lightY = THREE.MathUtils.lerp(SUBWAY_FLOOR_Y, LEVEL2_FLOOR_Y, t) + 1.2
    const stairLight = new THREE.PointLight(0x8ab4ff, 1.1, 8, 2)
    stairLight.position.set(STATION_X, lightY, lightZ)
    scene.add(stairLight)
    flickerLights.push({ light: stairLight, base: 1.1, seed: Math.random() * 100 })
  }

  const level2SignCanvas = document.createElement('canvas')
  level2SignCanvas.width = 512
  level2SignCanvas.height = 96
  const level2SignCtx = level2SignCanvas.getContext('2d')
  level2SignCtx.fillStyle = '#0a0e14'
  level2SignCtx.fillRect(0, 0, level2SignCanvas.width, level2SignCanvas.height)
  level2SignCtx.fillStyle = '#8ab4ff'
  level2SignCtx.font = 'bold 44px sans-serif'
  level2SignCtx.textAlign = 'center'
  level2SignCtx.textBaseline = 'middle'
  level2SignCtx.fillText('OLD LINE - LOWER LEVEL', level2SignCanvas.width / 2, level2SignCanvas.height / 2)
  const level2SignTexture = new THREE.CanvasTexture(level2SignCanvas)
  const level2Sign = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 0.5),
    cachedFlatMaterial({ map: level2SignTexture, emissive: 0x8ab4ff, emissiveMap: level2SignTexture, emissiveIntensity: 0.9 })
  )
  level2Sign.position.set(STATION_X, LEVEL2_FLOOR_Y + 2.3, LEVEL2_Z_NEAR + 1.5)
  level2Sign.rotation.y = Math.PI
  scene.add(level2Sign)

  // Second level: same scale/materials as the original subway platform (see
  // buildSubway), not the widened station above it - reads as an older,
  // deeper line rather than more of the same hall.
  const level2Length = LEVEL2_Z_NEAR - LEVEL2_Z_FAR
  const level2CenterZ = (LEVEL2_Z_NEAR + LEVEL2_Z_FAR) / 2

  const level2Floor = new THREE.Mesh(new THREE.BoxGeometry(SUBWAY_WIDTH, 0.08, level2Length), floorMat)
  level2Floor.position.set(STATION_X, LEVEL2_FLOOR_Y, level2CenterZ)
  level2Floor.receiveShadow = true
  scene.add(level2Floor)
  solidMeshes.push(level2Floor)

  const level2Ceiling = new THREE.Mesh(new THREE.BoxGeometry(SUBWAY_WIDTH + 0.4, 0.2, level2Length), wallMat)
  level2Ceiling.position.set(STATION_X, LEVEL2_FLOOR_Y + SUBWAY_HEIGHT, level2CenterZ)
  level2Ceiling.castShadow = true
  scene.add(level2Ceiling)
  solidMeshes.push(level2Ceiling)
  colliders.push(new THREE.Box3().setFromObject(level2Ceiling))

  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, SUBWAY_HEIGHT, level2Length), wallMat)
    wall.position.set(STATION_X + side * (SUBWAY_WIDTH / 2 + 0.1), LEVEL2_FLOOR_Y + SUBWAY_HEIGHT / 2, level2CenterZ)
    wall.castShadow = true
    wall.receiveShadow = true
    scene.add(wall)
    solidMeshes.push(wall)
    colliders.push(new THREE.Box3().setFromObject(wall))
  }

  // No end wall here anymore - Stage 11 (buildToxicSewerLevel, called from
  // buildWorld right after this function) breaches straight through and
  // continues the corridor further south into the sewer level, instead of
  // this being a true dead end like it originally was.

  const level2PlatformWidth = 1.6
  const level2Platform = new THREE.Mesh(new THREE.BoxGeometry(level2PlatformWidth, 0.35, level2Length - 1), platformMat)
  level2Platform.position.set(STATION_X - SUBWAY_WIDTH / 2 + level2PlatformWidth / 2 + 0.15, LEVEL2_FLOOR_Y + 0.175, level2CenterZ)
  level2Platform.castShadow = true
  level2Platform.receiveShadow = true
  scene.add(level2Platform)
  solidMeshes.push(level2Platform)

  const level2TrackX = STATION_X + 0.6
  for (const railOffset of [-0.5, 0.5]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, level2Length - 1), railMat)
    rail.position.set(level2TrackX + railOffset, LEVEL2_FLOOR_Y + 0.03, level2CenterZ)
    scene.add(rail)
  }

  const level2LightSpacing = 5
  const level2LightCount = Math.floor(level2Length / level2LightSpacing)
  for (let i = 1; i < level2LightCount; i++) {
    const z = LEVEL2_Z_NEAR - level2LightSpacing * i
    const light = new THREE.PointLight(0x8ab4ff, 0.7, 6, 2)
    light.position.set(STATION_X, LEVEL2_FLOOR_Y + SUBWAY_HEIGHT - 0.3, z)
    scene.add(light)
    flickerLights.push({ light, base: 0.7, seed: Math.random() * 100 })
  }

  chestSpots.push({ x: STATION_X, y: LEVEL2_FLOOR_Y, z: LEVEL2_Z_FAR + 3 })

  return {
    terminalSpot: { x: terminalX, z: terminalZ },
    encounterCenter: { x: STATION_X, z: centerZ },
    floorY: SUBWAY_FLOOR_Y,
    officeASpot,
    officeBSpot,
  }
}

// Hidden VIREO sub-level - used to branch off a standalone surface tunnel,
// now instead a straight continuation of the subway corridor past
// SUBWAY_Z_END (no wall between them, see buildSubway's endWallFar removal)
// so reaching it means riding the subway stairs down rather than finding a
// separate tunnel entrance. Hazard lighting, lab clutter, and a terminal
// (see Game.js's nearVireoTerminal handling) that pays off the audio log
// arc. Past the terminal, a second staircase climbs back to street level -
// the subway's exit, so the whole underground loop doesn't dead-end back
// the way you came.
// Stage 11 of the Extended Metropolitan Grid plan - "Underground Level -2:
// Sewers" (toxic water + slippery walkways). Continues straight through the
// breach left in buildUndergroundStation's LEVEL2 dead end (same X, same
// depth) rather than needing its own separate stairwell down - "the old
// abandoned line dead-ends into a breach that leads into the sewers" reads
// as a natural transition between two differently-themed areas. Recolors
// buildSewer's own green/grime palette instead of inventing a new one.
//
// The toxic pool and the raised walkway are the same rectangle, laid over
// each other: the walkway is a narrow raised plank (in solidMeshes, so
// PlayerController's floor-height sampling finds it as the higher/nearer
// surface and the player stands ON it, safe and dry) running down the pool's
// west edge; stepping off it into the open water (still walkable, just
// lower) is what triggers toxic tick damage in Game.js's _updateToxicWater.
// The walkway is also where Game.js sets PlayerController.slipFactor > 0 -
// wet planks over a sewer, not solid ground, so momentum carries you a bit
// once moving instead of stopping the instant input releases (see
// PlayerController.update's slipFactor branch).
const SEWER2_X = STATION_X
const SEWER2_Z_START = LEVEL2_Z_FAR // the breach - same point LEVEL2's wall used to seal
const SEWER2_POOL_Z_START = SEWER2_Z_START - 6
const SEWER2_POOL_Z_END = SEWER2_POOL_Z_START - 18
const SEWER2_Z_END = SEWER2_POOL_Z_END - 6
const SEWER2_WALKWAY_WIDTH = 1.4

function buildToxicSewerLevel(scene, colliders, solidMeshes, flickerLights, chestSpots) {
  const x = SEWER2_X
  const floorY = LEVEL2_FLOOR_Y
  const wallMat = cachedFlatMaterial({ color: 0x2a3324, roughness: 1 })
  const floorMat = cachedFlatMaterial({ color: 0x1c2418, roughness: 1 })
  const pipeMat = cachedFlatMaterial({ color: 0x3a4a30, roughness: 0.7, metalness: 0.4 })

  const buildStraightSegment = (z0, z1) => {
    const length = z0 - z1
    const centerZ = (z0 + z1) / 2
    const floor = new THREE.Mesh(new THREE.BoxGeometry(SUBWAY_WIDTH, 0.08, length), floorMat)
    floor.position.set(x, floorY, centerZ)
    floor.receiveShadow = true
    scene.add(floor)
    solidMeshes.push(floor)

    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(SUBWAY_WIDTH + 0.4, 0.2, length), wallMat)
    ceiling.position.set(x, floorY + SUBWAY_HEIGHT, centerZ)
    ceiling.castShadow = true
    scene.add(ceiling)
    solidMeshes.push(ceiling)
    colliders.push(new THREE.Box3().setFromObject(ceiling))

    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, SUBWAY_HEIGHT, length), wallMat)
      wall.position.set(x + side * (SUBWAY_WIDTH / 2 + 0.1), floorY + SUBWAY_HEIGHT / 2, centerZ)
      wall.castShadow = true
      wall.receiveShadow = true
      scene.add(wall)
      solidMeshes.push(wall)
      colliders.push(new THREE.Box3().setFromObject(wall))

      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, length, 12), pipeMat)
      pipe.rotation.x = Math.PI / 2
      pipe.position.set(x + side * (SUBWAY_WIDTH / 2 - 0.15), floorY + SUBWAY_HEIGHT - 0.4, centerZ)
      scene.add(pipe)
    }

    const lightSpacing = 8 // see buildSewer's own comment on this same change
    const lightCount = Math.floor(length / lightSpacing)
    for (let i = 1; i < lightCount; i++) {
      const z = z0 - lightSpacing * i
      const light = new THREE.PointLight(0x7ee08a, 0.7, 5, 2)
      light.position.set(x, floorY + SUBWAY_HEIGHT - 0.3, z)
      scene.add(light)
      flickerLights.push({ light, base: 0.7, seed: Math.random() * 100 })
    }
  }

  // Breach approach - plain sewer corridor, no hazard yet.
  buildStraightSegment(SEWER2_Z_START, SEWER2_POOL_Z_START)

  // The toxic pool room - walls/ceiling continue at the same width, but the
  // floor is replaced by a murky glowing pool instead of the plain sewer
  // floor, plus the raised safe walkway along the west edge.
  const poolLength = SEWER2_POOL_Z_START - SEWER2_POOL_Z_END
  const poolCenterZ = (SEWER2_POOL_Z_START + SEWER2_POOL_Z_END) / 2

  const poolMat = cachedFlatMaterial({
    color: 0x3a5a1a, emissive: 0x5a8a1a, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.1, transparent: true, opacity: 0.9,
  })
  const pool = new THREE.Mesh(new THREE.BoxGeometry(SUBWAY_WIDTH, 0.1, poolLength), poolMat)
  pool.position.set(x, floorY + 0.05, poolCenterZ)
  scene.add(pool)
  solidMeshes.push(pool) // walkable (with tick damage - see Game.js) not a void

  const poolCeiling = new THREE.Mesh(new THREE.BoxGeometry(SUBWAY_WIDTH + 0.4, 0.2, poolLength), wallMat)
  poolCeiling.position.set(x, floorY + SUBWAY_HEIGHT, poolCenterZ)
  poolCeiling.castShadow = true
  scene.add(poolCeiling)
  solidMeshes.push(poolCeiling)
  colliders.push(new THREE.Box3().setFromObject(poolCeiling))

  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, SUBWAY_HEIGHT, poolLength), wallMat)
    wall.position.set(x + side * (SUBWAY_WIDTH / 2 + 0.1), floorY + SUBWAY_HEIGHT / 2, poolCenterZ)
    wall.castShadow = true
    wall.receiveShadow = true
    scene.add(wall)
    solidMeshes.push(wall)
    colliders.push(new THREE.Box3().setFromObject(wall))
  }

  const walkwayMat = cachedFlatMaterial({ color: 0x4a4438, roughness: 0.9 })
  const walkwayX = x - SUBWAY_WIDTH / 2 + SEWER2_WALKWAY_WIDTH / 2 + 0.15
  const walkway = new THREE.Mesh(new THREE.BoxGeometry(SEWER2_WALKWAY_WIDTH, 0.18, poolLength - 0.6), walkwayMat)
  walkway.position.set(walkwayX, floorY + 0.15, poolCenterZ)
  walkway.castShadow = true
  walkway.receiveShadow = true
  scene.add(walkway)
  solidMeshes.push(walkway) // higher than the pool floor beside it - the safe (but slippery) path

  // A handful of sickly-green glow points over the pool instead of the
  // corridor's usual amber/blue rib lights, so the room reads as distinctly
  // hazardous rather than just more tunnel.
  const glowSpacing = 9 // see buildSewer's own comment on this same change
  const glowCount = Math.floor(poolLength / glowSpacing)
  for (let i = 0; i <= glowCount; i++) {
    const z = SEWER2_POOL_Z_START - glowSpacing * i
    const light = new THREE.PointLight(0x8ade3a, 0.9, 7, 2)
    light.position.set(x + 1, floorY + 1.2, z)
    scene.add(light)
    flickerLights.push({ light, base: 0.9, seed: Math.random() * 100 })
  }

  // Plain corridor beyond the pool, with a reward chest for having crossed
  // it - no end wall here anymore, Stage 12 (buildMineLevel, called from
  // buildWorld right after this function) breaches straight through and
  // continues down into the mines, same "old line dead-ends into the next
  // themed area" transition Stage 11 itself used against LEVEL2.
  buildStraightSegment(SEWER2_POOL_Z_END, SEWER2_Z_END)

  chestSpots.push({ x, y: floorY, z: SEWER2_Z_END + 3 })

  return {
    poolBounds: { xMin: x - SUBWAY_WIDTH / 2, xMax: x + SUBWAY_WIDTH / 2, zMin: SEWER2_POOL_Z_END, zMax: SEWER2_POOL_Z_START },
    walkwayBounds: { xMin: walkwayX - SEWER2_WALKWAY_WIDTH / 2, xMax: walkwayX + SEWER2_WALKWAY_WIDTH / 2, zMin: SEWER2_POOL_Z_END, zMax: SEWER2_POOL_Z_START },
    floorY,
  }
}

// Stage 12 of the Extended Metropolitan Grid plan - "Underground Level -3:
// Mines" (rockfall + unstable beams). Continues straight through the breach
// left in buildToxicSewerLevel's own dead end, down a vertical mine shaft
// (buildStairFlight's bare steps, reused as-is - a rough-hewn mine doesn't
// need the polished walls/rails/lighting Stage 10's park entrances got) to
// a new, narrower level one floor below the sewers, matching the established
// "-6 units per level" depth convention (SUBWAY_FLOOR_Y -> LEVEL2_FLOOR_Y ->
// MINE_FLOOR_Y).
//
// "Rockfall" and "unstable beam" are the same mechanic, not two separate
// systems: each beam prop is a one-time proximity trigger (buildUnstableBeam
// returns a plain data handle; Game.js's _updateMineHazards/_triggerRockfall
// own the runtime behavior) that deals a single burst of damage - not the
// continuous per-tick damage the sewer's toxic pool uses - and permanently
// drops a rubble pile that narrows (not seals) the shaft at that point,
// so the hazard leaves a lasting physical trace instead of just a damage
// flash. Reuses buildSewer/buildToxicSewerLevel's own straight-corridor
// pattern with mine-appropriate materials/width instead of a new one.
const MINE_X = SEWER2_X
const MINE_STAIR_Z_TOP = SEWER2_Z_END // the breach - same point the sewer's old end wall used to seal
const MINE_STAIR_RUN = 8
const MINE_STAIR_Z_BOTTOM = MINE_STAIR_Z_TOP - MINE_STAIR_RUN
const MINE_FLOOR_Y = LEVEL2_FLOOR_Y - 6
const MINE_WIDTH = 3.6
const MINE_HEIGHT = 2.6
const MINE_BEAM_1_Z = MINE_STAIR_Z_BOTTOM - 14
const MINE_BEAM_2_Z = MINE_STAIR_Z_BOTTOM - 30
const MINE_Z_END = MINE_STAIR_Z_BOTTOM - 44

function buildUnstableBeam(scene, x, z, floorY) {
  // Deliberately NOT cachedFlatMaterial - _triggerRockfall (Game.js)
  // recolors ONE beam's material when it collapses, and this function is
  // called twice with identical opts (beam1/beam2) - sharing a cached
  // instance here would recolor both beams the moment either one
  // triggers. See docs/PERFORMANCE.md Option B1.
  const beamMat = flatMaterial({ color: 0x4a3624, roughness: 0.95 })
  const beam = new THREE.Mesh(new THREE.BoxGeometry(MINE_WIDTH + 0.2, 0.22, 0.22), beamMat)
  beam.position.set(x, floorY + MINE_HEIGHT - 0.15, z)
  beam.castShadow = true
  scene.add(beam)

  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, MINE_HEIGHT - 0.2, 0.18), beamMat)
    post.position.set(x + side * (MINE_WIDTH / 2 - 0.1), floorY + (MINE_HEIGHT - 0.2) / 2, z)
    post.castShadow = true
    scene.add(post)
  }

  // A small warning marker (cracked/discolored patch) so an attentive player
  // has a fair visual cue before triggering it, not a total surprise.
  const warnMat = cachedFlatMaterial({ color: 0x2a1c10, roughness: 1, emissive: 0x3a1a0a, emissiveIntensity: 0.4 })
  const warnMark = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.08), warnMat)
  warnMark.position.set(x, floorY + MINE_HEIGHT - 0.3, z + 0.12)
  scene.add(warnMark)

  return { x, z, floorY, triggered: false, beam, posts: null, warnMark }
}

function buildMineLevel(scene, colliders, solidMeshes, flickerLights, chestSpots) {
  const x = MINE_X
  const rockWallMat = cachedFlatMaterial({ color: 0x3a3128, roughness: 1 })
  const dirtFloorMat = cachedFlatMaterial({ color: 0x261f16, roughness: 1 })
  const beamDressMat = cachedFlatMaterial({ color: 0x3a2a1a, roughness: 0.95 })

  // Vertical shaft around the stair run - a straight (not tilted) enclosure
  // is simplest and safest here (axis-aligned Box3().setFromObject is fine,
  // no rotated-mesh AABB gotcha to work around), tall enough to cover both
  // the sewer's own ceiling height above and the mine's ceiling below.
  const shaftHalfWidth = 2
  const shaftTop = LEVEL2_FLOOR_Y + SUBWAY_HEIGHT
  const shaftBottom = MINE_FLOOR_Y
  const shaftHeight = shaftTop - shaftBottom
  const shaftCenterY = (shaftTop + shaftBottom) / 2
  const shaftCenterZ = (MINE_STAIR_Z_TOP + MINE_STAIR_Z_BOTTOM) / 2
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, shaftHeight, MINE_STAIR_RUN + 0.4), rockWallMat)
    wall.position.set(x + side * shaftHalfWidth, shaftCenterY, shaftCenterZ)
    wall.castShadow = true
    wall.receiveShadow = true
    scene.add(wall)
    solidMeshes.push(wall)
    colliders.push(new THREE.Box3().setFromObject(wall))
  }
  buildStairFlight(scene, solidMeshes, x, MINE_STAIR_Z_TOP, LEVEL2_FLOOR_Y, x, MINE_STAIR_Z_BOTTOM, MINE_FLOOR_Y, 14)
  const stairLight = new THREE.PointLight(0xd9a86c, 0.8, 8, 2)
  stairLight.position.set(x, shaftCenterY + 1, shaftCenterZ)
  scene.add(stairLight)
  flickerLights.push({ light: stairLight, base: 0.8, seed: Math.random() * 100 })

  const buildMineSegment = (z0, z1) => {
    const length = z0 - z1
    const centerZ = (z0 + z1) / 2
    const floor = new THREE.Mesh(new THREE.BoxGeometry(MINE_WIDTH, 0.08, length), dirtFloorMat)
    floor.position.set(x, MINE_FLOOR_Y, centerZ)
    floor.receiveShadow = true
    scene.add(floor)
    solidMeshes.push(floor)

    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(MINE_WIDTH + 0.4, 0.2, length), rockWallMat)
    ceiling.position.set(x, MINE_FLOOR_Y + MINE_HEIGHT, centerZ)
    ceiling.castShadow = true
    scene.add(ceiling)
    solidMeshes.push(ceiling)
    colliders.push(new THREE.Box3().setFromObject(ceiling))

    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, MINE_HEIGHT, length), rockWallMat)
      wall.position.set(x + side * (MINE_WIDTH / 2 + 0.1), MINE_FLOOR_Y + MINE_HEIGHT / 2, centerZ)
      wall.castShadow = true
      wall.receiveShadow = true
      scene.add(wall)
      solidMeshes.push(wall)
      colliders.push(new THREE.Box3().setFromObject(wall))
    }

    const lightSpacing = 9 // see buildSewer's own comment on this same change
    const lightCount = Math.floor(length / lightSpacing)
    for (let i = 1; i < lightCount; i++) {
      const z = z0 - lightSpacing * i
      const light = new THREE.PointLight(0xd9a86c, 0.6, 5, 2)
      light.position.set(x, MINE_FLOOR_Y + MINE_HEIGHT - 0.3, z)
      scene.add(light)
      flickerLights.push({ light, base: 0.6, seed: Math.random() * 100 })
    }
  }

  buildMineSegment(MINE_STAIR_Z_BOTTOM, MINE_Z_END)

  // Decorative (non-triggering) support beams, just dressing, at points
  // between the two real hazard beams so the corridor doesn't read as
  // empty rock between them.
  for (const z of [MINE_STAIR_Z_BOTTOM - 6, MINE_STAIR_Z_BOTTOM - 22, MINE_STAIR_Z_BOTTOM - 38]) {
    const deco = new THREE.Mesh(new THREE.BoxGeometry(MINE_WIDTH + 0.2, 0.2, 0.2), beamDressMat)
    deco.position.set(x, MINE_FLOOR_Y + MINE_HEIGHT - 0.15, z)
    deco.castShadow = true
    scene.add(deco)
  }

  const beam1 = buildUnstableBeam(scene, x, MINE_BEAM_1_Z, MINE_FLOOR_Y)
  const beam2 = buildUnstableBeam(scene, x, MINE_BEAM_2_Z, MINE_FLOOR_Y)

  const endWall = new THREE.Mesh(new THREE.BoxGeometry(MINE_WIDTH + 0.4, MINE_HEIGHT, 0.2), rockWallMat)
  endWall.position.set(x, MINE_FLOOR_Y + MINE_HEIGHT / 2, MINE_Z_END)
  endWall.castShadow = true
  scene.add(endWall)
  solidMeshes.push(endWall)
  colliders.push(new THREE.Box3().setFromObject(endWall))

  // A small ore vein in the end wall - amber glow, purely visual payoff for
  // reaching the deepest point of the network so far.
  const oreMat = cachedFlatMaterial({ color: 0x8a6a1a, emissive: 0xffb347, emissiveIntensity: 0.6, roughness: 0.5, metalness: 0.3 })
  for (const [ox, oy] of [[-0.6, 0.3], [0.5, -0.2], [0, 0.6]]) {
    const ore = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22), oreMat)
    ore.position.set(x + ox, MINE_FLOOR_Y + MINE_HEIGHT / 2 + oy, MINE_Z_END + 0.15)
    scene.add(ore)
  }

  chestSpots.push({ x, y: MINE_FLOOR_Y, z: MINE_Z_END + 3 })

  return { beams: [beam1, beam2], floorY: MINE_FLOOR_Y, mineWidth: MINE_WIDTH, deadEndSpot: { x, z: MINE_Z_END + 3 } }
}

const FACILITY_X = SUBWAY_X
const FACILITY_Z_START = SUBWAY_Z_END
const FACILITY_Z_END = SUBWAY_Z_END + 16
const FACILITY_WIDTH = SUBWAY_WIDTH
const FACILITY_HEIGHT = SUBWAY_HEIGHT
const FACILITY_STAIR_BOTTOM_Z = FACILITY_Z_END - 1.5
const FACILITY_EXIT_Z = FACILITY_Z_END + 3

function buildVireoFacility(scene, colliders, solidMeshes, flickerLights) {
  const length = FACILITY_STAIR_BOTTOM_Z - FACILITY_Z_START
  const centerZ = FACILITY_Z_START + length / 2

  const wallMat = cachedFlatMaterial({ color: 0x2a1418, roughness: 0.9 })

  const stripeCanvas = document.createElement('canvas')
  stripeCanvas.width = 64
  stripeCanvas.height = 64
  const stripeCtx = stripeCanvas.getContext('2d')
  stripeCtx.fillStyle = '#1c1614'
  stripeCtx.fillRect(0, 0, 64, 64)
  stripeCtx.fillStyle = '#d4a017'
  for (let i = -64; i < 64; i += 16) {
    stripeCtx.save()
    stripeCtx.beginPath()
    stripeCtx.moveTo(i, 64)
    stripeCtx.lineTo(i + 8, 64)
    stripeCtx.lineTo(i + 8 + 64, 0)
    stripeCtx.lineTo(i + 64, 0)
    stripeCtx.closePath()
    stripeCtx.fill()
    stripeCtx.restore()
  }
  const stripeTexture = new THREE.CanvasTexture(stripeCanvas)
  stripeTexture.wrapS = THREE.RepeatWrapping
  stripeTexture.wrapT = THREE.RepeatWrapping
  stripeTexture.repeat.set(1, length / 2)
  const floorMat = cachedFlatMaterial({ map: stripeTexture, roughness: 1 })

  const floor = new THREE.Mesh(new THREE.BoxGeometry(FACILITY_WIDTH, 0.08, length), floorMat)
  // Same Y as buildSubway's own floor (no extra offset) - this corridor is a
  // flush continuation of the subway floor at their shared boundary
  // (FACILITY_Z_START === SUBWAY_Z_END), so any offset here creates a small
  // step right at the transition instead of one continuous floor level.
  floor.position.set(FACILITY_X, SUBWAY_FLOOR_Y, centerZ)
  floor.receiveShadow = true
  scene.add(floor)
  solidMeshes.push(floor)

  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(FACILITY_WIDTH + 0.4, 0.2, length), wallMat)
  ceiling.position.set(FACILITY_X, SUBWAY_FLOOR_Y + FACILITY_HEIGHT, centerZ)
  ceiling.castShadow = true
  scene.add(ceiling)
  solidMeshes.push(ceiling)
  colliders.push(new THREE.Box3().setFromObject(ceiling))

  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, FACILITY_HEIGHT, length), wallMat)
    wall.position.set(FACILITY_X + side * (FACILITY_WIDTH / 2 + 0.1), SUBWAY_FLOOR_Y + FACILITY_HEIGHT / 2, centerZ)
    wall.castShadow = true
    wall.receiveShadow = true
    scene.add(wall)
    solidMeshes.push(wall)
    colliders.push(new THREE.Box3().setFromObject(wall))
  }

  const lightSpacing = 8 // see buildSewer's own comment on this same change
  const lightCount = Math.floor(length / lightSpacing)
  for (let i = 1; i < lightCount; i++) {
    const z = FACILITY_Z_START + lightSpacing * i
    const light = new THREE.PointLight(0xff2222, 1.0, 6, 2)
    light.position.set(FACILITY_X, SUBWAY_FLOOR_Y + FACILITY_HEIGHT - 0.3, z)
    scene.add(light)
    flickerLights.push({ light, base: 1.0, seed: Math.random() * 100 })
  }

  const propMat = cachedFlatMaterial({ color: 0x3a3a3a, roughness: 0.8 })
  const propSpots = [
    { x: FACILITY_X - 0.7, z: FACILITY_Z_START + 4, w: 0.5, h: 0.9, d: 0.5 },
    { x: FACILITY_X + 0.7, z: FACILITY_Z_START + 8, w: 0.6, h: 0.6, d: 0.6 },
  ]
  for (const p of propSpots) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), propMat)
    box.position.set(p.x, SUBWAY_FLOOR_Y + p.h / 2, p.z)
    box.castShadow = true
    scene.add(box)
    solidMeshes.push(box)
    colliders.push(new THREE.Box3().setFromObject(box))
  }

  const terminalZ = FACILITY_STAIR_BOTTOM_Z - 3
  const terminalMat = cachedFlatMaterial({ color: 0x1a1a1a, roughness: 0.6 })
  const terminalBody = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.4), terminalMat)
  terminalBody.position.set(FACILITY_X, SUBWAY_FLOOR_Y + 0.55, terminalZ)
  terminalBody.castShadow = true
  scene.add(terminalBody)
  solidMeshes.push(terminalBody)
  colliders.push(new THREE.Box3().setFromObject(terminalBody))

  const screenCanvas = document.createElement('canvas')
  screenCanvas.width = 128
  screenCanvas.height = 96
  const screenCtx = screenCanvas.getContext('2d')
  screenCtx.fillStyle = '#050a05'
  screenCtx.fillRect(0, 0, screenCanvas.width, screenCanvas.height)
  screenCtx.fillStyle = '#3fff6a'
  screenCtx.font = '10px monospace'
  screenCtx.fillText('VIREO OS', 8, 16)
  screenCtx.fillText('SUBJECT LOG', 8, 32)
  screenCtx.fillText('...', 8, 48)
  screenCtx.fillText('[ACCESS]', 8, 72)
  const screenTexture = new THREE.CanvasTexture(screenCanvas)
  const screenMat = cachedFlatMaterial({
    map: screenTexture,
    emissive: 0xffffff,
    emissiveMap: screenTexture,
    emissiveIntensity: 0.8,
  })
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.38), screenMat)
  screen.position.set(FACILITY_X, SUBWAY_FLOOR_Y + 0.85, terminalZ + 0.21)
  scene.add(screen)

  // Second staircase back up to street level - the subway's exit, on the
  // opposite side of the loop from the entrance kiosk (see buildSubway).
  buildStairFlight(
    scene, solidMeshes,
    FACILITY_X, FACILITY_STAIR_BOTTOM_Z, SUBWAY_FLOOR_Y,
    FACILITY_X, FACILITY_EXIT_Z, 0,
    18
  )

  const exitKioskMat = cachedFlatMaterial({ color: 0x1c1a16, roughness: 0.85 })
  const exitKioskHalfW = FACILITY_WIDTH / 2 + 0.3
  const exitKioskRoof = new THREE.Mesh(new THREE.BoxGeometry(exitKioskHalfW * 2, 0.25, 3), exitKioskMat)
  exitKioskRoof.position.set(FACILITY_X, 2.6, FACILITY_EXIT_Z)
  exitKioskRoof.castShadow = true
  scene.add(exitKioskRoof)
  solidMeshes.push(exitKioskRoof)
  colliders.push(new THREE.Box3().setFromObject(exitKioskRoof))
  for (const [ox, oz] of [[-exitKioskHalfW, -1.5], [-exitKioskHalfW, 1.5], [exitKioskHalfW, -1.5], [exitKioskHalfW, 1.5]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.6, 0.2), exitKioskMat)
    post.position.set(FACILITY_X + ox, 1.3, FACILITY_EXIT_Z + oz)
    post.castShadow = true
    scene.add(post)
  }
  const exitSign = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.4, 0.06), cachedFlatMaterial({ color: 0x0a1408, emissive: 0x4ee06f, emissiveIntensity: 1 }))
  exitSign.position.set(FACILITY_X, 2.3, FACILITY_EXIT_Z + 1.51)
  scene.add(exitSign)

  return {
    terminalSpot: { x: FACILITY_X, z: terminalZ },
    // Kept as a generic corridor landmark - was the UV Lamp pickup's spot
    // before that weapon was removed; audiolog4 and one vault key spawn
    // still anchor off it (see Game.js).
    corridorMarkerSpot: { x: FACILITY_X, z: FACILITY_Z_START + 6 },
    floorY: SUBWAY_FLOOR_Y,
    exitSpot: { x: FACILITY_X, z: FACILITY_EXIT_Z },
  }
}

function addPerimeterBarricade(scene, register, groundSize) {
  const wallHeight = 5
  const wallMat = cachedFlatMaterial({ color: 0x23211d, roughness: 1 })
  const half = groundSize / 2

  const specs = [
    { w: groundSize, h: wallHeight, d: 1, x: 0, z: -half },
    { w: groundSize, h: wallHeight, d: 1, x: 0, z: half },
    { w: 1, h: wallHeight, d: groundSize, x: -half, z: 0 },
    { w: 1, h: wallHeight, d: groundSize, x: half, z: 0 },
  ]

  for (const s of specs) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), wallMat)
    mesh.position.set(s.x, s.h / 2, s.z)
    mesh.receiveShadow = true
    scene.add(mesh)
    register(mesh)
  }
}

// Phase 5 of the 3D asset overhaul - real props (3dmodelscc0's CC0
// Industrial/City Environment packs, asset-source/build-props.py) in
// place of procedural primitives, same "load once, cache, fall back to
// procedural on failure" pattern as the buildings above.
const PROP_MODEL_FILES = [
  'barrel.glb', 'streetlight.glb', 'bench.glb', 'dumpster.glb', 'trafficcone.glb',
  'roadblock.glb', 'atm.glb', 'mailbox.glb', 'payphone.glb', 'busstop.glb',
  'trashbin.glb', 'waterbarrel.glb', 'cabledrum.glb', 'traderstall.glb', 'ammostation.glb',
  'shelf.glb', 'counter.glb', 'food-can.glb', 'food-carton.glb', 'food-bottle.glb', 'food-bread.glb', 'food-bag.glb',
  'hospital-bed.glb', 'medical-cabinet.glb', 'waiting-chair.glb', 'firstaid.glb',
  'tool-hammer.glb', 'tool-crowbar.glb', 'tool-tireiron.glb', 'tool-fireaxe.glb',
  'campus-table.glb', 'campus-bookcase.glb', 'campus-books.glb',
]
const _propModelCache = new Map()

export async function preloadPropModels() {
  const loader = new GLTFLoader()
  await Promise.all(PROP_MODEL_FILES.map(async (file) => {
    try {
      const gltf = await loader.loadAsync(`/models/props/${file}`)
      _propModelCache.set(file, gltf.scene)
    } catch (err) {
      console.warn(`Prop model failed to load, falling back to procedural: ${file}`, err)
    }
  }))
}

// Two rows of buildings flanking a central street (+z is the main avenue),
// plus a couple set further back to break up the skyline.
function buildingLayout() {
  const list = []
  const rows = [-32, -18, 18, 32]
  let seed = 0
  for (const x of rows) {
    for (let z = -42; z <= 42; z += 20) {
      seed++
      const jitter = ((seed * 37) % 7) - 3
      list.push({
        x: x + (x < 0 ? -jitter : jitter) * 0.4,
        z: z + jitter,
        w: 11 + (seed % 4) * 1.6,
        d: 11 + ((seed * 3) % 4) * 1.6,
        h: 9 + ((seed * 5) % 6) * 2.6,
        broken: seed % 3 === 0,
      })
    }
  }
  return list
}

// Phase 6 of the 3D asset overhaul - four outer zones extending buildingLayout's
// same "rows flanking a street" formula out into the open space of the
// 750x750 map (the core only ever used ~80x80 of it - see the commit at
// HEAD this ties into). Centers are chosen well clear of the full occupied
// envelope measured by hand against every existing feature (buildings,
// safe zone, park, subway/sewer/station, underground level 2): that
// envelope tops out at x=+-33.2, z=[-89,72], so +-150 in any direction has
// 60+ units of clearance on every side - no collision risk with anything
// that already exists.
//
// 'axis' controls which way the zone's buildings flank their own street:
// 'z' mirrors the core (rows are X positions, buildings step along Z, for
// the north/south zones); 'x' rotates that 90 degrees (rows are Z
// positions, buildings step along X, for the east/west zones) - otherwise
// an east/west zone's "street" would run perpendicular to the direction
// the player actually walks to reach it.
function outerZoneBuildingSpecs(centerX, centerZ, axis, seedBase) {
  const list = []
  let seed = seedBase
  const rowOffsets = [-26, -12, 12, 26]
  const steps = [-30, -10, 10, 30]
  for (const rowOffset of rowOffsets) {
    for (const step of steps) {
      seed++
      const jitter = ((seed * 37) % 7) - 3
      const spec = {
        w: 11 + (seed % 4) * 1.6,
        d: 11 + ((seed * 3) % 4) * 1.6,
        h: 8 + ((seed * 5) % 6) * 2.2,
        broken: seed % 4 === 0,
      }
      if (axis === 'z') {
        spec.x = centerX + rowOffset + jitter * 0.4
        spec.z = centerZ + step + jitter
      } else {
        spec.x = centerX + step + jitter
        spec.z = centerZ + rowOffset + jitter * 0.4
      }
      list.push(spec)
    }
  }
  return { list, nextSeed: seed }
}

// Pulled in from the original +-140/160 placement (2026-08-19, at the
// user's request to shrink the overall map) - still clear of the core's
// occupied envelope (x=+-33.2, z=[-89,72], see the comment above
// outerZoneBuildingSpecs()) by a comfortable margin on every side, just a
// smaller one than the original "+-150 anywhere is safe" heuristic used.
const OUTER_ZONES = [
  { name: 'suburbs', centerX: 0, centerZ: 125, axis: 'z' },
  { name: 'industrial', centerX: 0, centerZ: -140, axis: 'z' },
  { name: 'commercial', centerX: 85, centerZ: 0, axis: 'x' },
  { name: 'residential', centerX: -85, centerZ: 0, axis: 'x' },
]

// Stage 7 of the Extended Metropolitan Grid plan - "upgrade N existing
// shells to real walkable interiors" rather than sourcing/placing new
// content from scratch. Started with just 2 of the suburbs zone's 16
// decorative building slots as a proof of the pattern (a cheap breather
// stage between the two biggest-lift stages, Campus and Skyscraper), then
// widened to all 16 once that held up. Also applied to the residential
// zone's own 16 slots afterward - same index set, since both zones'
// outerZoneBuildingSpecs lists are the same length/shape.
const WALKABLE_HOUSE_IDXS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])

function buildWalkableHouse(scene, register, spec) {
  const w = Math.min(spec.w, 9)
  const d = Math.min(spec.d, 8)
  const wallHeight = 2.8
  buildRoom(scene, register, {
    x: spec.x, z: spec.z, w, d, wallHeight,
    doorSides: [{ side: 'south', width: 2.2 }],
  })

  const floorMat = cachedFlatMaterial({ color: 0xb8a888, roughness: 0.8 })
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.6, d - 0.6), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(spec.x, 0.02, spec.z)
  floor.receiveShadow = true
  scene.add(floor)

  placePropSimple(scene, register, 'campus-table.glb', spec.x - w / 2 + 1.4, spec.z - d / 2 + 1.4, Math.PI / 4)
  placePropSimple(scene, register, 'waiting-chair.glb', spec.x - w / 2 + 1.4, spec.z - d / 2 + 2.2, Math.PI, 1, false)
  placePropSimple(scene, register, 'hospital-bed.glb', spec.x + w / 2 - 2, spec.z + d / 2 - 2, Math.PI / 2)
  const shelf = placePropSimple(scene, register, 'campus-bookcase.glb', spec.x + w / 2 - 0.5, spec.z - d / 2 + 1, -Math.PI / 2)
  if (shelf) shelf.traverse((c) => { if (c.isMesh) c.material.color.setHex(0x5a4530) })

  return { x: spec.x, z: spec.z }
}

// One real walkable skyscraper per district that doesn't already get the
// walkable-house treatment (suburbs/residential are all houses via
// WALKABLE_HOUSE_IDXS - see below), added at the user's request after
// they described the far-out commercial/industrial buildings as "just
// boxes, no real building". Reuses the exact same buildSkyscraper/
// buildFireEscape functions the 3 downtown skyscrapers already use, at
// the outer corner (rowOffset=+-26, step=+-30) of each district's 4x4
// grid, chosen the same way the original downtown picks were: the corner
// spot's "blind" side (away from the district center) faces open
// perimeter with no neighbor, not another building, and the skyscraper's
// 10x10 footprint override is smaller than the original spec at every
// one of these indices, so it only improves neighbor clearance versus
// what was already safely standing there.
const OUTER_SKYSCRAPER_PICKS = { commercial: 3, industrial: 0 }

function buildOuterZones(scene, register, cullables, towerChestSpots, colliders, solidMeshes, skyscraperShortcuts) {
  let seed = 1000 // offset clear of buildingLayout()'s own 0-20 range
  const lightModel = _propModelCache.get('streetlight.glb')
  const poleMat = LOW_QUALITY_MODE ? new THREE.MeshLambertMaterial({ color: 0x1c1c1c }) : cachedFlatMaterial({ color: 0x1c1c1c, roughness: 0.8 })

  // LOW_QUALITY_MODE: same "one shared flat material per instance" trick
  // as placePropSimple, tinted from the model's own first-mesh color.
  const _lowQualityMatFor = (clone) => {
    let firstColor = null
    clone.traverse((child) => {
      if (firstColor === null && child.isMesh && child.material && child.material.color) {
        firstColor = child.material.color.clone()
      }
    })
    return new THREE.MeshLambertMaterial({ color: firstColor || 0x777770 })
  }

  const placeProp = (fileName, x, z, rotY = 0) => {
    const model = _propModelCache.get(fileName)
    if (!model) return
    const clone = model.clone(true)
    clone.position.set(x, 0, z)
    clone.rotation.y = rotY
    const lowQualityMat = LOW_QUALITY_MODE ? _lowQualityMatFor(clone) : null
    clone.traverse((child) => {
      if (!child.isMesh) return
      child.castShadow = true
      child.receiveShadow = true
      child.material = lowQualityMat || child.material.clone()
    })
    scene.add(clone)
    cullables.push(clone)
  }

  const placeStreetlight = (x, z) => {
    if (lightModel) {
      const clone = lightModel.clone(true)
      clone.position.set(x, 0, z)
      const lowQualityMat = LOW_QUALITY_MODE ? _lowQualityMatFor(clone) : null
      clone.traverse((child) => {
        if (!child.isMesh) return
        child.castShadow = true
        child.material = lowQualityMat || child.material.clone()
      })
      scene.add(clone)
      register(clone)
    } else {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5.5, 12), poleMat)
      pole.position.set(x, 2.75, z)
      pole.castShadow = true
      scene.add(pole)
      register(pole)
    }
    const light = new THREE.PointLight(0xffbb55, 1.0, 12, 2)
    light.position.set(x, 5.2, z)
    scene.add(light)
  }

  for (const zone of OUTER_ZONES) {
    const { list, nextSeed } = outerZoneBuildingSpecs(zone.centerX, zone.centerZ, zone.axis, seed)
    seed = nextSeed
    for (let i = 0; i < list.length; i++) {
      const spec = list[i]
      if ((zone.name === 'suburbs' || zone.name === 'residential') && WALKABLE_HOUSE_IDXS.has(i)) {
        const house = buildWalkableHouse(scene, register, spec)
        registerZone({ id: `${zone.name}house${i}`, x: house.x, z: house.z, radius: 8, densityMult: 1.0 })
        // Deliberately no lootWeights override - "residential = common
        // salvage" per the blueprint's own legend, the plain default table.
        towerChestSpots.push({ x: house.x, y: 0, z: house.z })
      } else if (OUTER_SKYSCRAPER_PICKS[zone.name] === i) {
        spec.w = 10
        spec.d = 10
        spec.h = SKYSCRAPER_FLOOR_H * SKYSCRAPER_FLOORS
        buildSkyscraper(scene, colliders, solidMeshes, spec, towerChestSpots)
        buildFireEscape(scene, colliders, solidMeshes, spec, towerChestSpots)
        registerZone({ id: `${zone.name}skyscraper`, x: spec.x, z: spec.z, radius: 10, densityMult: 1.1 })
        skyscraperShortcuts.push({ x: spec.x, z: spec.z, topY: (SKYSCRAPER_FLOORS - 1) * SKYSCRAPER_FLOOR_H })
      } else {
        // Same conversion as the core downtown loop in buildWorld - every
        // remaining decorative "tall building" model is now a real walkable
        // skyscraper instead, floor count derived from its own height. No
        // fire escape (unverified footprint clearance, same reasoning as
        // the core loop's comment on this).
        spec.broken = false
        const floors = buildSkyscraper(scene, colliders, solidMeshes, spec, towerChestSpots)
        skyscraperShortcuts.push({ x: spec.x, z: spec.z, topY: (floors - 1) * SKYSCRAPER_FLOOR_H })
      }
    }

    // A few streetlights down the zone's own central street, same axis
    // convention as the buildings above.
    if (zone.axis === 'z') {
      for (const dz of [-24, 0, 24]) placeStreetlight(zone.centerX + 3.5, zone.centerZ + dz)
    } else {
      for (const dx of [-24, 0, 24]) placeStreetlight(zone.centerX + dx, zone.centerZ + 3.5)
    }

    // Light scattering of already-downloaded props for street-level detail
    // - reusing the same files scatterCityProps uses for the core, just at
    // this zone's own coordinates.
    const p1 = zone.axis === 'z' ? { x: zone.centerX - 4, z: zone.centerZ - 14 } : { x: zone.centerX - 14, z: zone.centerZ - 4 }
    const p2 = zone.axis === 'z' ? { x: zone.centerX + 5, z: zone.centerZ + 10 } : { x: zone.centerX + 10, z: zone.centerZ + 5 }
    placeProp('dumpster.glb', p1.x, p1.z)
    placeProp('waterbarrel.glb', p2.x, p2.z)
    placeProp('trafficcone.glb', zone.centerX, zone.centerZ)
  }
}


// Small piles of splintered planks/bricks scattered around the street -
// purely decorative clutter, no collider.
const DEBRIS_CLUSTERS = [
  [8, -14], [-9, 8], [12, 12], [-5, -28], [5, 28], [-13, -20], [14, -28],
  [2, -8], [-2, 14], [9, -4], [-8, -10], [3, 18], [-14, 4], [11, -18], [-4, 24],
]
// Phase 5 decorative pass - real props (3dmodelscc0's CC0 city/industrial
// packs) scattered as pure street dressing, same "no collider" treatment
// scatterDebris already uses for its own clutter (these aren't gameplay-
// interactive, so a movement collider would just be extra cost for
// nothing). ATM/mailbox/payphone/busstop are single "landmark" placements
// rather than repeated clutter - one of each is enough to read as city
// detail without needing many instances.
function scatterCityProps(scene, colliders, solidMeshes) {
  const place = (fileName, x, z, rotY = 0) => {
    const model = _propModelCache.get(fileName)
    if (!model) return
    const clone = model.clone(true)
    clone.position.set(x, 0, z)
    clone.rotation.y = rotY
    let lowQualityMat = null
    if (LOW_QUALITY_MODE) {
      let firstColor = null
      clone.traverse((child) => {
        if (firstColor === null && child.isMesh && child.material && child.material.color) {
          firstColor = child.material.color.clone()
        }
      })
      lowQualityMat = new THREE.MeshLambertMaterial({ color: firstColor || 0x777770 })
    }
    clone.traverse((child) => {
      if (!child.isMesh) return
      child.castShadow = true
      child.receiveShadow = true
      child.material = lowQualityMat || child.material.clone()
    })
    scene.add(clone)
  }

  place('dumpster.glb', 10, -16, 0.4)
  place('dumpster.glb', -11, 10, -0.6)
  place('waterbarrel.glb', 13, 10)
  place('waterbarrel.glb', -15, 2, 1.1)
  place('cabledrum.glb', 1, -6)
  place('trashbin.glb', -3, 16)
  place('trashbin.glb', 10, -2)
  place('trashbin.glb', -9, -8)
  place('roadblock.glb', 6, 26, Math.PI / 2)
  place('roadblock.glb', -6, -30, Math.PI / 2)
  for (const [ox, oz] of [[0, 0], [0.5, 0.3], [-0.4, 0.6]]) {
    place('trafficcone.glb', 4 + ox, -10 + oz)
  }

  place('atm.glb', 8, 22, Math.PI)
  place('mailbox.glb', -7, 30)
  place('payphone.glb', 7, -20, Math.PI / 2)
  place('busstop.glb', -12, -24, Math.PI / 2)
}

// Ambient Wildlife (batch feature) - purely decorative birds circling and
// rats scurrying for atmosphere, distinct from the insect/rat SWARM hazard
// (see Game.js's insect-swarm bite damage) which is a real gameplay threat.
// No collider, no gameplay effect at all - Game.js's per-frame tick just
// orbits/scurries these for visual life. Returned as plain {mesh, ...orbit
// params} objects rather than THREE.Group subclasses, since Game.js only
// ever needs to read/write a handful of numbers on them each frame.
function spawnAmbientWildlife(scene) {
  const wildlife = []
  const birdMat = cachedFlatMaterial({ color: 0x1c1a18, roughness: 0.8 })
  const birdSpots = [
    { x: 0, z: 62, y: 14 }, // over the park
    { x: 0, z: 30, y: 16 }, // over the safe zone
    { x: -10, z: 0, y: 15 }, // downtown
  ]
  for (const spot of birdSpots) {
    for (let i = 0; i < 3; i++) {
      const bird = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.6, 3), birdMat)
      bird.rotation.x = Math.PI / 2
      scene.add(bird)
      wildlife.push({
        mesh: bird,
        type: 'bird',
        cx: spot.x,
        cz: spot.z,
        baseY: spot.y + i * 0.6,
        radius: 5 + i * 1.5,
        speed: 0.4 + i * 0.08,
        phase: Math.random() * Math.PI * 2,
      })
    }
  }

  const ratMat = cachedFlatMaterial({ color: 0x2a241e, roughness: 0.9 })
  const ratSpots = [
    { x: 6, z: 45 },
    { x: -30, z: -10 },
  ]
  for (const spot of ratSpots) {
    const rat = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.22), ratMat)
    rat.position.set(spot.x, 0.05, spot.z)
    scene.add(rat)
    wildlife.push({
      mesh: rat,
      type: 'rat',
      cx: spot.x,
      cz: spot.z,
      baseY: 0.05,
      radius: 1.2,
      speed: 1.1,
      phase: Math.random() * Math.PI * 2,
    })
  }

  return wildlife
}

function scatterDebris(scene) {
  const brickMat = cachedFlatMaterial({ color: 0x4a4438, roughness: 1 })
  const plankMat = cachedFlatMaterial({ color: 0x2c2418, roughness: 0.9 })

  for (const [x, z] of DEBRIS_CLUSTERS) {
    const count = 1 + Math.floor(Math.random() * 3)
    for (let i = 0; i < count; i++) {
      const isPlank = Math.random() < 0.5
      const mesh = isPlank
        ? new THREE.Mesh(new THREE.BoxGeometry(1.3 + Math.random() * 0.9, 0.08, 0.22), plankMat)
        : new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.42 + Math.random() * 0.3), brickMat)
      mesh.position.set(x + (Math.random() - 0.5) * 3, mesh.geometry.parameters.height / 2, z + (Math.random() - 0.5) * 3)
      mesh.rotation.y = Math.random() * Math.PI
      if (isPlank) mesh.rotation.x = (Math.random() - 0.5) * 0.15
      mesh.castShadow = true
      mesh.receiveShadow = true
      scene.add(mesh)
    }
  }
}

function addStreetlights(scene, register, flickerLights) {
  const poleMat = LOW_QUALITY_MODE ? new THREE.MeshLambertMaterial({ color: 0x1c1c1c }) : cachedFlatMaterial({ color: 0x1c1c1c, roughness: 0.8 })
  const positions = [
    { x: -3.5, z: -14, flicker: true },
    { x: 3.5, z: 6, flicker: false },
    { x: -3.5, z: 26, flicker: true },
    { x: 3.5, z: -34, flicker: false },
  ]

  const model = _propModelCache.get('streetlight.glb')

  for (const p of positions) {
    if (model) {
      const clone = model.clone(true)
      clone.position.set(p.x, 0, p.z)
      const lowQualityMat = LOW_QUALITY_MODE ? new THREE.MeshLambertMaterial({ color: poleMat.color }) : null
      clone.traverse((child) => {
        if (!child.isMesh) return
        child.castShadow = true
        child.material = lowQualityMat || child.material.clone()
      })
      scene.add(clone)
      register(clone)
    } else {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5.5, 12), poleMat)
      pole.position.set(p.x, 2.75, p.z)
      pole.castShadow = true
      scene.add(pole)
      register(pole)

      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 12, 12),
        cachedFlatMaterial({ color: 0x332200, emissive: 0xffbb55, emissiveIntensity: 1.6 })
      )
      lamp.position.set(p.x, 5.4, p.z)
      scene.add(lamp)
    }

    // Real PointLight (gameplay light source) - kept separate from the
    // model either way, same as the old sphere-lamp version, so the
    // model's own baked emissive texture just reads as "the lit part
    // of the fixture" while this is what actually lights the street.
    const light = new THREE.PointLight(0xffbb66, p.flicker ? 1.6 : 1.1, 14, 2)
    light.position.set(p.x, 5.2, p.z)
    scene.add(light)

    if (p.flicker) flickerLights.push({ light, base: 1.6, seed: Math.random() * 100 })
  }
}

// Real enterable skyscrapers: a full-height open facade facing the avenue
// leads into a stairwell strip that runs the depth of the building, with a
// straight flight per floor. Each upper floor is a walkable slab covering
// the far portion of the footprint (loot chest inside), left open on the
// stairwell side so the shaft stays a continuous open atrium to the top.
const SKYSCRAPER_FLOOR_H = 3.9
const SKYSCRAPER_SLAB_THICKNESS = 0.3
const SKYSCRAPER_STRIP_WIDTH = 3.4
const SKYSCRAPER_FLOORS = 3 // ground + 2 upper

function buildSkyscraper(scene, colliders, solidMeshes, spec, chestSpots) {
  const { x: cx, z: cz, w, d, h } = spec
  const half = w / 2
  // spec.facingSign is an explicit override for callers whose "which side
  // faces the street" axis isn't simply cx's sign relative to x=0 (e.g. the
  // 'x'-axis outer zones, where rows run along z instead) - see
  // buildOuterZones' own conversion of that axis. Falls back to the
  // original x=0-relative auto-detect for every existing call site, which
  // never set this field, so behavior there is unchanged.
  const facingSign = spec.facingSign !== undefined ? spec.facingSign : (cx < 0 ? 1 : -1)
  // Floor count derived from this building's own height rather than the
  // fixed SKYSCRAPER_FLOORS constant, so callers converting buildings of
  // varying height (see the tall-building-to-skyscraper conversion in
  // buildWorld/buildOuterZones) get a proportionate number of floors
  // instead of every building becoming identically tall. The 5 original
  // call sites all pass h = SKYSCRAPER_FLOOR_H * SKYSCRAPER_FLOORS exactly,
  // so this recomputes to exactly SKYSCRAPER_FLOORS for them - no change.
  const floors = Math.max(2, Math.round(h / SKYSCRAPER_FLOOR_H))

  const shellTex = getSharedWallDecayTexture().clone()
  shellTex.needsUpdate = true
  // No Math.round here (unlike an earlier version of this line) - rounding
  // the repeat count to a whole number forces a fixed texel density onto
  // whatever height happens to round down to, which visibly stretches the
  // image on shorter buildings (h=7.8, the shortest a 2-floor conversion
  // gets, rounds to a single full-height tile - the classic symptom a user
  // reported: one wall looking oddly smeared/distorted vertically compared
  // to its neighbors). groundTex/plazaTex elsewhere in this file never
  // round their repeat either, for the same reason - keep the raw division
  // so texel density stays consistent across every building size.
  shellTex.repeat.set(Math.max(1, w / 7), Math.max(1, h / 7))
  const shellMat = cachedFlatMaterial({ map: shellTex, roughness: 0.95 })
  const floorMat = cachedFlatMaterial({ color: 0x3a352c, roughness: 0.9 })

  const faceX = cx + facingSign * half
  const stripInnerX = faceX - facingSign * SKYSCRAPER_STRIP_WIDTH
  const farX = cx - facingSign * half
  const mainRoomCenterX = (stripInnerX + farX) / 2
  const mainRoomWidth = Math.abs(stripInnerX - farX)
  const stripCenterX = (faceX + stripInnerX) / 2

  // Exterior shell: full-height far wall + two side walls. The avenue-facing
  // side is left completely open as the entrance/atrium facade.
  const shellSpecs = [
    { bw: 0.3, bd: d, x: farX, z: cz },
    { bw: w, bd: 0.3, x: cx, z: cz - d / 2 },
    { bw: w, bd: 0.3, x: cx, z: cz + d / 2 },
  ]
  for (const s of shellSpecs) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(s.bw, h, s.bd), shellMat)
    wall.position.set(s.x, h / 2, s.z)
    wall.castShadow = true
    wall.receiveShadow = true
    scene.add(wall)
    colliders.push(new THREE.Box3().setFromObject(wall))
    solidMeshes.push(wall)
  }

  for (let floor = 1; floor < floors; floor++) {
    const y = floor * SKYSCRAPER_FLOOR_H

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(mainRoomWidth, SKYSCRAPER_SLAB_THICKNESS, d),
      floorMat
    )
    slab.position.set(mainRoomCenterX, y - SKYSCRAPER_SLAB_THICKNESS / 2, cz)
    slab.castShadow = true
    slab.receiveShadow = true
    scene.add(slab)
    solidMeshes.push(slab) // walkable floor, intentionally not a horizontal collider

    buildStairFlight(
      scene, solidMeshes,
      stripCenterX, cz - d / 2 + 0.6, y - SKYSCRAPER_FLOOR_H,
      stripCenterX, cz + d / 2 - 0.6, y,
      14
    )

    // Landing bridges - buildStairFlight's steps are only 1.6 wide and
    // centered on stripCenterX, which sits ~1.7 units short of stripInnerX
    // (where the slab above actually starts), leaving a real ~0.9-unit gap
    // you can fall through right where the stairwell strip meets the main
    // room - at both ends of every flight, on every floor. Present in the
    // original hand-built skyscraper design too (this code is unchanged
    // there), just never reported until there were many more of these to
    // walk through. One short bridge at each end (near-z, where the next
    // flight up starts, and far-z, where this flight lands) closes it,
    // generously overlapping both the end step and the slab's own edge.
    const landingCenterX = (stripCenterX + stripInnerX) / 2
    const landingWidth = Math.abs(stripCenterX - stripInnerX) + 2.0
    for (const landingZ of [cz - d / 2 + 0.6, cz + d / 2 - 0.6]) {
      const landing = new THREE.Mesh(
        new THREE.BoxGeometry(landingWidth, SKYSCRAPER_SLAB_THICKNESS, 1.6),
        floorMat
      )
      landing.position.set(landingCenterX, y - SKYSCRAPER_SLAB_THICKNESS / 2, landingZ)
      landing.receiveShadow = true
      scene.add(landing)
      solidMeshes.push(landing)
    }

    chestSpots.push({ x: mainRoomCenterX, y, z: cz })
  }

  return floors
}

// Exterior fire escape granting a low-rooftop vantage on the two "real"
// skyscrapers above - a switchback metal stair up the building's blind
// (non-entrance) side, entirely outside the shell, ending on a flat railed
// roof with its own loot chest. Independent of the interior stairwell (see
// buildSkyscraper) - reaching the roof never requires stepping inside.
const FIRE_ESCAPE_OFFSET = 0.9
const FIRE_ESCAPE_LANDING_SIZE = 1.8
const FIRE_ESCAPE_LANDING_THICKNESS = 0.2
const ROOF_SLAB_THICKNESS = 0.3
const ROOF_RAIL_HEIGHT = 0.9
const ROOF_RAIL_THICKNESS = 0.15

function buildFireEscape(scene, colliders, solidMeshes, spec, chestSpots) {
  const { x: cx, z: cz, w, d, h } = spec
  const half = w / 2
  const facingSign = cx < 0 ? 1 : -1
  const faceX = cx + facingSign * half // avenue-facing (entrance) side
  const farX = cx - facingSign * half // blind side - the wall the escape climbs
  // Offset out from the wall face, clear of the shell wall's own collider
  // (0.3 thick, centered on farX) so the stair isn't blocked by the very
  // wall it's climbing.
  const escapeX = farX - facingSign * FIRE_ESCAPE_OFFSET

  const stepMat = cachedFlatMaterial({ color: 0x4a4038, roughness: 0.6, metalness: 0.6 })
  const roofMat = cachedFlatMaterial({ color: 0x2e2a24, roughness: 0.9 })
  const railMat = cachedFlatMaterial({ color: 0x1c1a16, roughness: 0.7, metalness: 0.5 })

  const nearZ = cz - d / 2 + 1.4
  const farZ = cz + d / 2 - 1.4
  const flightCount = 3
  const flightHeight = h / flightCount

  const addLanding = (z, y) => {
    const landing = new THREE.Mesh(
      new THREE.BoxGeometry(FIRE_ESCAPE_LANDING_SIZE, FIRE_ESCAPE_LANDING_THICKNESS, FIRE_ESCAPE_LANDING_SIZE),
      stepMat
    )
    landing.position.set(escapeX, y - FIRE_ESCAPE_LANDING_THICKNESS / 2, z)
    landing.castShadow = true
    landing.receiveShadow = true
    landing.userData.fireEscapePart = 'landing'
    scene.add(landing)
    solidMeshes.push(landing) // walkable, intentionally not a horizontal collider
  }

  let fromZ = nearZ
  let fromY = 0
  for (let i = 0; i < flightCount; i++) {
    const toZ = i % 2 === 0 ? farZ : nearZ
    const toY = (i + 1) * flightHeight
    buildStairFlight(scene, solidMeshes, escapeX, fromZ, fromY, escapeX, toZ, toY, 10)
    addLanding(toZ, toY)
    fromZ = toZ
    fromY = toY
  }

  // Roof extends past the building's actual blind wall out to escapeX, so
  // it meets the top landing with no gap to cross.
  const roofX0 = faceX
  const roofX1 = escapeX
  const roofCenterX = (roofX0 + roofX1) / 2
  const roofWidth = Math.abs(roofX0 - roofX1)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(roofWidth, ROOF_SLAB_THICKNESS, d), roofMat)
  roof.position.set(roofCenterX, h - ROOF_SLAB_THICKNESS / 2, cz)
  roof.castShadow = true
  roof.receiveShadow = true
  roof.userData.fireEscapePart = 'roof'
  scene.add(roof)
  solidMeshes.push(roof) // walkable, intentionally not a horizontal collider

  // Guardrail on 3 sides - left open on the escapeX edge where the fire
  // escape actually arrives, same "skip the entrance wall" pattern as
  // buildElevatedRoom.
  const railSpecs = [
    { w: roofWidth, d: ROOF_RAIL_THICKNESS, x: roofCenterX, z: cz - d / 2 },
    { w: roofWidth, d: ROOF_RAIL_THICKNESS, x: roofCenterX, z: cz + d / 2 },
    { w: ROOF_RAIL_THICKNESS, d, x: roofX0, z: cz },
  ]
  for (const s of railSpecs) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(s.w, ROOF_RAIL_HEIGHT, s.d), railMat)
    rail.position.set(s.x, h + ROOF_RAIL_HEIGHT / 2, s.z)
    rail.castShadow = true
    scene.add(rail)
    colliders.push(new THREE.Box3().setFromObject(rail))
    solidMeshes.push(rail)
  }

  chestSpots.push({ x: roofCenterX, y: h, z: cz })
}

// Small scavenger-built lookout platforms: an elevated one-room structure
// reached by an exterior staircase from the ground, each holding a chest.
// Placed on the open central avenue (x within ~±10) so they never collide
// with the building rows further out, well clear of the perimeter wall.
const ROOM_SIZE = 5.5
const FLOOR_Y = 4.0
const WALL_HEIGHT = 2.3
const SLAB_THICKNESS = 0.3
// The north cluster (formerly at x:-3, z:44) was removed - that spot is now
// the relocated safe zone (see buildSafeZone).
const CLUSTER_SPECS = [
  { x: 3, z: -44 },
]

function buildTowers(scene, colliders, solidMeshes) {
  const floorMat = cachedFlatMaterial({ color: 0x3a352c, roughness: 0.9 })
  const wallMat = cachedFlatMaterial({ color: 0x2c2a22, roughness: 0.95 })
  const chestSpots = []

  for (const c of CLUSTER_SPECS) {
    for (const offsetX of [-6, 6]) {
      const rx = c.x + offsetX
      const rz = c.z
      const stairDir = Math.sign(c.z) || 1 // stairs always approach from further out on the same side as the cluster

      buildElevatedRoom(scene, colliders, solidMeshes, rx, rz, floorMat, wallMat, stairDir)
      buildStairFlight(
        scene,
        solidMeshes,
        rx, rz - stairDir * 6, 0,
        rx, rz - stairDir * 2.5, FLOOR_Y,
        16
      )
      chestSpots.push({ x: rx, y: FLOOR_Y, z: rz })
    }
  }

  return chestSpots
}

// stairDir > 0 means the room is entered from its -Z side (stairs approach
// from further -Z); stairDir < 0 means entered from its +Z side.
function buildElevatedRoom(scene, colliders, solidMeshes, cx, cz, floorMat, wallMat, stairDir) {
  const half = ROOM_SIZE / 2

  const slab = new THREE.Mesh(new THREE.BoxGeometry(ROOM_SIZE, SLAB_THICKNESS, ROOM_SIZE), floorMat)
  slab.position.set(cx, FLOOR_Y - SLAB_THICKNESS / 2, cz)
  slab.castShadow = true
  slab.receiveShadow = true
  scene.add(slab)
  solidMeshes.push(slab) // walkable floor, intentionally not a horizontal collider

  // Purely decorative support struts so the platform doesn't look like it's
  // floating — not registered as colliders or raycast targets.
  const beamMat = cachedFlatMaterial({ color: 0x1c1a15, roughness: 0.9 })
  for (const [ox, oz] of [[-half + 0.3, -half + 0.3], [half - 0.3, -half + 0.3], [-half + 0.3, half - 0.3], [half - 0.3, half - 0.3]]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.25, FLOOR_Y, 0.25), beamMat)
    beam.position.set(cx + ox, FLOOR_Y / 2, cz + oz)
    beam.castShadow = true
    scene.add(beam)
  }

  const openZ = cz - stairDir * half
  const wallSpecs = [
    { w: ROOM_SIZE, d: 0.3, x: cx, z: cz - half },
    { w: ROOM_SIZE, d: 0.3, x: cx, z: cz + half },
    { w: 0.3, d: ROOM_SIZE, x: cx + half, z: cz },
    { w: 0.3, d: ROOM_SIZE, x: cx - half, z: cz },
  ]

  for (const s of wallSpecs) {
    if (Math.abs(s.z - openZ) < 0.01 && s.w === ROOM_SIZE) continue // skip the open (entrance) wall
    const wall = new THREE.Mesh(new THREE.BoxGeometry(s.w, WALL_HEIGHT, s.d), wallMat)
    wall.position.set(s.x, FLOOR_Y + WALL_HEIGHT / 2, s.z)
    wall.castShadow = true
    wall.receiveShadow = true
    scene.add(wall)
    colliders.push(new THREE.Box3().setFromObject(wall))
    solidMeshes.push(wall)
  }
}

// Was `steps + 1` separate Mesh objects (474 of them summed across the
// map's 9 staircases) - one InstancedMesh per flight instead, per
// docs/PERFORMANCE.md Option B2. Deliberately one InstancedMesh PER CALL
// (per staircase), not one shared across all 9: the doc's own pitfall
// note ("instance within a chunk, cull the whole InstancedMesh as a
// unit") applies here because A1's _updateCulling culls/detaches whole
// cullable objects based on a single obj.position - a flight-local
// InstancedMesh has a sensible one, a single map-wide one covering all 9
// scattered staircases would not (there's no one point that's "near" all
// of them at once). Confirmed via three.js's own InstancedMesh source
// that Box3.setFromObject (used by World.js's register()/A1's parking and
// PlayerController's ground-detection grid) already computes a correct
// per-instance-aware bounding box for InstancedMesh automatically - no
// changes needed elsewhere for either system to keep working.
function buildStairFlight(scene, solidMeshes, x0, z0, y0, x1, z1, y1, steps) {
  const stepMat = cachedFlatMaterial({ color: 0x332e26, roughness: 0.9 })
  const geo = new THREE.BoxGeometry(1.6, 0.25, 1.0)

  const count = steps + 1
  const mesh = new THREE.InstancedMesh(geo, stepMat, count)
  mesh.castShadow = true
  mesh.receiveShadow = true
  // A1/register() read obj.position directly for distance culling/parking
  // - an InstancedMesh has no single "true" position the way a normally-
  // placed Mesh does, so this uses the flight's own midpoint and each
  // instance's matrix is built relative to it below.
  const midX = (x0 + x1) / 2
  const midY = (y0 + y1) / 2
  const midZ = (z0 + z1) / 2
  mesh.position.set(midX, midY, midZ)
  const m = new THREE.Matrix4()
  for (let i = 0; i < count; i++) {
    const t = i / steps
    m.makeTranslation(
      THREE.MathUtils.lerp(x0, x1, t) - midX,
      THREE.MathUtils.lerp(y0, y1, t) - midY,
      THREE.MathUtils.lerp(z0, z1, t) - midZ
    )
    mesh.setMatrixAt(i, m)
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingBox()
  mesh.computeBoundingSphere()
  scene.add(mesh)
  solidMeshes.push(mesh) // walkable, intentionally not a horizontal collider
}
