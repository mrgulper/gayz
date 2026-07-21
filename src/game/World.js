import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { registerZone, clearZones } from './Zones.js'
import { LOOT_WEIGHTS } from './Chests.js'

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

// Small alpha-cutout canvas texture of a hanging vine + leaf clusters, used
// as a cheap stand-in for ivy/moss overgrowth on building facades. A few
// cached variants (not just one) so repeated strips across a block don't all
// look identical.
const IVY_VARIANTS = 3
const _ivyTextures = []
function createIvyTexture(size = 128) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, size, size)

  ctx.strokeStyle = 'rgba(42, 58, 26, 0.9)'
  ctx.lineWidth = 2
  let x = size / 2
  ctx.beginPath()
  ctx.moveTo(x, size)
  for (let y = size; y > 0; y -= size / 12) {
    x += (Math.random() - 0.5) * size * 0.12
    ctx.lineTo(x, y)
  }
  ctx.stroke()

  const leafColors = ['rgba(58, 92, 40, 0.88)', 'rgba(74, 110, 48, 0.82)', 'rgba(45, 72, 34, 0.88)', 'rgba(90, 96, 40, 0.75)']
  const leafCount = Math.floor(size * 0.55)
  for (let i = 0; i < leafCount; i++) {
    const ly = size * (0.15 + Math.random() * 0.85)
    const spread = size * 0.32 * (ly / size)
    const lx = size / 2 + (Math.random() - 0.5) * spread
    const r = 3 + Math.random() * 5
    ctx.fillStyle = leafColors[Math.floor(Math.random() * leafColors.length)]
    ctx.beginPath()
    ctx.ellipse(lx, ly, r, r * 0.6, Math.random() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }

  return new THREE.CanvasTexture(canvas)
}
function getIvyTexture(i) {
  if (!_ivyTextures[i]) _ivyTextures[i] = createIvyTexture()
  return _ivyTextures[i]
}

// Scatters 0-2 ivy/moss strips across a building's street-facing wall. Purely
// decorative planes (no collider) laid over the existing facade mesh.
function addIvyOverlay(scene, spec) {
  if (Math.random() > 0.5) return
  const facingSign = spec.x < 0 ? 1 : -1
  const faceX = spec.x + facingSign * (spec.w / 2 + 0.03)
  const stripCount = 1 + Math.floor(Math.random() * 2)
  for (let i = 0; i < stripCount; i++) {
    const tex = getIvyTexture(Math.floor(Math.random() * IVY_VARIANTS))
    const height = Math.min(spec.h, spec.h * (0.4 + Math.random() * 0.45))
    const width = 1.6 + Math.random() * 1.4
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.3,
      roughness: 1,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat)
    mesh.rotation.y = facingSign > 0 ? Math.PI / 2 : -Math.PI / 2
    const z = spec.z - spec.d / 2 + width / 2 + Math.random() * Math.max(0.1, spec.d - width)
    mesh.position.set(faceX, height / 2, z)
    scene.add(mesh)
  }
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

// Builds a small broken-city block: cracked streets, damaged buildings with
// lit/dark windows, burnt-out cars, rubble, and a couple of dying streetlights.
// Also returns a list of open street-side spawn points for pickups/zombies.
// Phase 6 of the 3D asset overhaul - distance culling, added ahead of the
// new zones below specifically so their extra buildings/streetlights don't
// all render/shadow-cast at once across the full 750x750 map (see this
// function's own register() comment and Game.js's _updateCulling). Matches
// the fog far distance (140) plus a small buffer so nothing visibly pops
// out of existence before fog would have hidden it anyway.
export const WORLD_CULL_DISTANCE = 150
// Shadow casting is the expensive part, not the JS-side distance check, so
// it's turned off well before the object disappears entirely.
export const WORLD_SHADOW_CULL_DISTANCE = 70

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
  const groundTex = new THREE.TextureLoader().load('/textures/ground-asphalt.png')
  groundTex.wrapS = THREE.RepeatWrapping
  groundTex.wrapT = THREE.RepeatWrapping
  groundTex.colorSpace = THREE.SRGBColorSpace
  groundTex.repeat.set(groundSize / 12, groundSize / 12)
  const groundBumpTex = getSharedBumpTexture().clone()
  groundBumpTex.needsUpdate = true
  groundBumpTex.repeat.set(groundSize / 3, groundSize / 3)
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
    new THREE.MeshStandardMaterial({ map: groundTex, bumpMap: groundBumpTex, bumpScale: 0.06, roughness: 1 }),
    0, 0, groundSize, groundSize,
    [UNDERGROUND_HOLE_SUBWAY, UNDERGROUND_HOLE_NEW_ENTRANCE, UNDERGROUND_HOLE_HIDDEN_COMPLEX],
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
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i]
    if (b.skyscraper) {
      buildSkyscraper(scene, colliders, solidMeshes, b, towerChestSpots)
      buildFireEscape(scene, colliders, solidMeshes, b, towerChestSpots)
    } else if (!EXCLUDED_BUILDING_IDXS.has(i)) {
      addBuilding(scene, register, b)
      if (EXTRA_FIRE_ESCAPE_IDXS.has(i)) {
        // addBuilding's own register() call just pushed one solid collider
        // spanning the building's full height - fine for a decorative box
        // nobody reaches the top of, but standing on this building's own
        // new roof means the player's collision box sits right at that same
        // top face, so the building would block itself from ever being
        // steppable. Real skyscrapers don't hit this because they're hollow
        // shells, not one solid box for the whole volume. Cap the collider
        // (just-pushed, nothing registers between it and here) a bit below
        // roof height instead - confirmed empirically via a Playwright
        // _tryMove walk from the escape's top landing onto the roof, which
        // failed before this cap and passes cleanly after.
        colliders[colliders.length - 1].max.y = Math.min(colliders[colliders.length - 1].max.y, b.h - 1.2)
        buildFireEscape(scene, colliders, solidMeshes, b, towerChestSpots)
      }
    }
  }

  scatterDebris(scene)
  scatterCityProps(scene, colliders, solidMeshes)
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
  const trophyWall = buildTrophyWall(scene, colliders, solidMeshes, safeZone, trophyCount)

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
  buildSubwayJunctionRoom(scene, colliders, solidMeshes, subwayEntrance.landingX, connectorWaypointZ, JUNCTION_HALF)
  buildSubwayJunctionRoom(scene, colliders, solidMeshes, SUBWAY_X, connectorWaypointZ, JUNCTION_HALF)
  buildSubwayConnector(scene, colliders, solidMeshes, flickerLights, subwayEntrance.landingX, subwayEntrance.landingZ, subwayEntrance.landingX, connectorWaypointZ + JUNCTION_HALF)
  buildSubwayConnector(scene, colliders, solidMeshes, flickerLights, subwayEntrance.landingX + JUNCTION_HALF, connectorWaypointZ, SUBWAY_X - JUNCTION_HALF, connectorWaypointZ)
  buildSubwayConnector(scene, colliders, solidMeshes, flickerLights, SUBWAY_X, connectorWaypointZ + JUNCTION_HALF, SUBWAY_X, SUBWAY_Z_START)

  // Underground station: a third branch off the same junction room the
  // platform connector uses (junction rooms are open on every side by
  // design - see buildSubwayJunctionRoom - so this needed zero changes to
  // any existing tunnel piece), heading further south into open space no
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

  buildOuterZones(scene, register, cullables, towerChestSpots)

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
  buildManholeCover(scene, SAFE_ZONE_X + 3, SAFE_ZONE_Z - 8)
  buildManholeCover(scene, hardwareStore.x + 3, hardwareStore.z - 3)
  buildManholeCover(scene, policeStation.x - 3, policeStation.z + 2)
  buildManholeCover(scene, skyscraper.x - 2, skyscraper.z - 9)
  buildManholeCover(scene, megaMall.x, megaMall.z + 8)

  // "Finish the set" additions, requested after Stage 9 wrapped up all the
  // blueprint's own named locations - these 4 are beyond the blueprint.
  const warehouse = buildWarehouse(scene, register, 0, -215)
  registerZone({ id: 'warehouse', x: 0, z: -215, radius: 18, densityMult: 1.3 })
  towerChestSpots.push({ x: 0, y: 0, z: -215, lootWeights: WEAPON_ONLY_LOOT_WEIGHTS })

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

  return {
    colliders,
    solidMeshes,
    flickerLights,
    spawnPoints,
    hemiLight: hemi,
    sunLight: moon,
    towerChestSpots,
    minigunSpot,
    generator,
    trader,
    ammoStation,
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

  const grassMat = new THREE.MeshStandardMaterial({ color: 0x2c3a24, roughness: 1 })
  buildGroundPlaneWithHoles(scene, grassMat, 0, centerZ, PARK_HALF_WIDTH * 2, depth, undergroundHoles, 0.01)

  // Path is narrower than the grass (4 wide, x -2..2) - only the subway hole
  // (centered on the path's own x=0) actually falls inside it, clamped a
  // little short of the path's own edges so the hole never touches (let
  // alone exceeds) the outer boundary it's cut from.
  const pathMat = new THREE.MeshStandardMaterial({ color: 0x4a463c, roughness: 1 })
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
  const plazaMat = new THREE.MeshStandardMaterial({ map: plazaTex, roughness: 1 })
  buildGroundPlaneWithHoles(
    scene, plazaMat, UNDERGROUND_PLAZA.x, UNDERGROUND_PLAZA.z, UNDERGROUND_PLAZA.w, UNDERGROUND_PLAZA.d,
    undergroundHoles, 0.02
  )

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2a1f16, roughness: 1 })
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3a4d2a, roughness: 0.9 })
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

  const benchMat = new THREE.MeshStandardMaterial({ color: 0x3a3226, roughness: 0.85 })
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
        child.material = child.material.clone()
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

  return { chestSpots, spawnPoints }
}

// Shootable explosive barrels - the world-prop half of WeaponSystem._fire's
// hit.object.userData.explosive check, which already knows how to detonate
// one (calls ZombieManager.explodeAt) but had nothing in the world tagging
// itself as explosive until this. Each barrel gets its own cloned material -
// not a shared module-level one - since _fire mutates color/emissive
// in-place on detonation, and a shared material would blacken every barrel
// on the map the instant any single one was shot (same class of bug as the
// Molotov fire zone material sharing one instance earlier).
const barrelBodyMat = new THREE.MeshStandardMaterial({
  color: 0xb3311f,
  emissive: 0x4a0f06,
  emissiveIntensity: 0.5,
  roughness: 0.55,
  metalness: 0.25,
})
const barrelCapMat = new THREE.MeshStandardMaterial({ color: 0x1c1a16, roughness: 0.6, metalness: 0.4 })

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
        child.material = child.material.clone()
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

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a4530, roughness: 0.8 })
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1a, roughness: 0.5, metalness: 0.5 })
  const indicatorMat = new THREE.MeshStandardMaterial({ color: 0x0a2a0a, emissive: 0x2aff3e, emissiveIntensity: 1 })

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

  const signMat = new THREE.MeshStandardMaterial({ color: 0x1a1410, emissive: 0xffb347, emissiveIntensity: 1.1 })

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
      child.material = child.material.clone()
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
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a3624, roughness: 0.9 })
    const tarpMat = new THREE.MeshStandardMaterial({ color: 0x5a2e2a, roughness: 0.85 })

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
      child.material = child.material.clone()
    })
    group.add(clone)
    raycastTarget = clone
    const buttonMesh = clone.getObjectByName('Button')
    buttonMat = buttonMesh.material
  } else {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5a2a1e, roughness: 0.7, metalness: 0.2 })
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1a, roughness: 0.5, metalness: 0.5 })
    buttonMat = new THREE.MeshStandardMaterial({ color: 0x2a0808, emissive: 0xff2a1e, emissiveIntensity: 1.1 })

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

  const screenMat = new THREE.MeshStandardMaterial({
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
const SAFE_ZONE_X = 0
const SAFE_ZONE_Z = 42

// A walled compound with a single entrance gap - guard NPCs (see Game.js,
// which spawns Companion instances at guardSpots) stand watch just inside
// the gap and shoot anything that wanders close, so the gap reads as a
// defended chokepoint instead of an unguarded hole in the wall. Game.js also
// slowly heals the player while they're within `radius` of the center.
function buildSafeZone(scene, colliders, solidMeshes) {
  const x = SAFE_ZONE_X
  const z = SAFE_ZONE_Z
  const half = 7
  const gapHalfWidth = 1.6
  const wallHeight = 3.2

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a3a34, roughness: 0.95 })
  const postMat = new THREE.MeshStandardMaterial({ color: 0x1c1a16, roughness: 0.8 })
  const sandbagMat = new THREE.MeshStandardMaterial({ color: 0x5a5138, roughness: 1 })
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x1a1408, emissive: 0x6fe08a, emissiveIntensity: 1.3 })

  const addWall = (wx, wz, w, d) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallHeight, d), wallMat)
    wall.position.set(x + wx, wallHeight / 2, z + wz)
    wall.castShadow = true
    wall.receiveShadow = true
    scene.add(wall)
    solidMeshes.push(wall)
    colliders.push(new THREE.Box3().setFromObject(wall))
  }

  // Four sides, with a gap left in the -z (south-facing) wall for an
  // entrance - flipped 180 degrees from the original +z (park-facing) gap
  // now that the safe zone sits at the north end: the player approaches
  // from the south (the main street/city), so the entrance should face
  // back the way they came, not toward the park behind it.
  addWall(0, half, half * 2, 0.6)
  addWall(-half, 0, 0.6, half * 2)
  addWall(half, 0, 0.6, half * 2)
  const sideWallLen = half - gapHalfWidth
  addWall(-(gapHalfWidth + sideWallLen / 2), -half, sideWallLen, 0.6)
  addWall(gapHalfWidth + sideWallLen / 2, -half, sideWallLen, 0.6)

  // Sandbag-topped watchtower posts flanking the entrance, doubling as the
  // first two guardSpots so the gap is covered from the moment it's built.
  const guardSpots = []
  for (const side of [-1, 1]) {
    const postX = x + side * (gapHalfWidth + 0.5)
    const postZ = z - half + 1.2
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
  guardSpots.push({ x: x, z: z + half - 2 })

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

  return { x, z, radius: half - 0.5, guardSpots }
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
    wallMat = new THREE.MeshStandardMaterial({ color: 0x3a3a34, roughness: 0.95 }),
  } = spec

  const halfW = w / 2
  const halfD = d / 2
  const t = ROOM_WALL_THICKNESS
  const doorWidth = new Map(doorSides.map((ds) => [ds.side, ds.width]))
  const isOpen = (side) => openSides.includes(side)

  const addWallSeg = (wx, wz, sw, sd) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(sw, wallHeight, sd), wallMat)
    wall.position.set(x + wx, floorY + wallHeight / 2, z + wz)
    wall.castShadow = true
    wall.receiveShadow = true
    scene.add(wall)
    register(wall)
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

  const floorMat = new THREE.MeshStandardMaterial({ color: 0xcac6ba, roughness: 0.85 })
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
          child.material = child.material.clone()
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
        child.material = child.material.clone()
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
      child.material = child.material.clone()
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
  clone.traverse((child) => {
    if (!child.isMesh) return
    child.castShadow = true
    child.receiveShadow = true
    child.material = child.material.clone()
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

  const floorMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.7 })
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

  const floorMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.7 })
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

  const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 0.75 })
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
        child.material = child.material.clone()
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
        child.material = child.material.clone()
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
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x232320, roughness: 0.6, metalness: 0.5 })
  const dims = axis === 'x' ? [width, 2.6, 0.15] : [0.15, 2.6, width]
  const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(dims[0], dims[1], dims[2]), doorMat)
  doorMesh.position.set(x, floorY + 1.3, z)
  doorMesh.castShadow = true
  scene.add(doorMesh)
  doorMesh.updateWorldMatrix(true, false)
  const doorBox = new THREE.Box3().setFromObject(doorMesh)

  const indicatorMat = new THREE.MeshStandardMaterial({ color: 0x1a0505, emissive: 0xff2a1e, emissiveIntensity: 0.9 })
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

  const floorMat = new THREE.MeshStandardMaterial({ color: 0x33342e, roughness: 0.8 })
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
  const sandbagMat = new THREE.MeshStandardMaterial({ color: 0x5a5138, roughness: 1 })
  const tentMat = new THREE.MeshStandardMaterial({ color: 0x3a4a34, roughness: 0.9 })
  const barrierMat = new THREE.MeshStandardMaterial({ color: 0xb0331a, roughness: 0.7, metalness: 0.2 })

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

  const adminFloorMat = new THREE.MeshStandardMaterial({ color: 0x33342e, roughness: 0.8 })
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
  const sandbagMat = new THREE.MeshStandardMaterial({ color: 0x5a5138, roughness: 1 })
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

  const floorMat = new THREE.MeshStandardMaterial({ color: 0xc8c4b8, roughness: 0.8 })
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
  const roomFloorMat = new THREE.MeshStandardMaterial({ color: 0xd0ccc0, roughness: 0.75 })
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

  const roofMat = new THREE.MeshStandardMaterial({ color: 0x2e2a24, roughness: 0.9 })
  const railMat = new THREE.MeshStandardMaterial({ color: 0x1c1a16, roughness: 0.7, metalness: 0.5 })
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

  const helipadMat = new THREE.MeshStandardMaterial({ map: buildHelipadTexture(), roughness: 0.8 })
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
  const bunkerFloorMat = new THREE.MeshStandardMaterial({ color: 0x2a2c28, roughness: 0.85 })
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

  const shaftMat = new THREE.MeshStandardMaterial({ color: 0x2c2c2a, roughness: 0.95 })
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
  const garageMat = new THREE.MeshStandardMaterial({ color: 0x35342f, roughness: 0.9 })
  const garageW = 24
  const garageD = 18
  const garageX = shaftX1 + dirSign * (garageW / 2)
  const garageNearSide = dirSign === 1 ? 'west' : 'east'
  const garageFarSide = dirSign === 1 ? 'east' : 'west'
  buildRoom(scene, register, {
    x: garageX, z, w: garageW, d: garageD, floorY, wallMat: garageMat,
    doorSides: [{ side: garageNearSide, width: 3.4 }, { side: garageFarSide, width: 2.6 }],
  })
  const garageFloorMat = new THREE.MeshStandardMaterial({ color: 0x28271f, roughness: 1 })
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
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x2a2924, roughness: 0.95 })
  for (const [px, pz] of [[-7, -5], [-7, 5], [7, -5], [7, 5]]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, wallHeight, 0.6), pillarMat)
    pillar.position.set(garageX + px, floorY + wallHeight / 2, z + pz)
    pillar.castShadow = true
    scene.add(pillar)
    solidMeshes.push(pillar)
    colliders.push(new THREE.Box3().setFromObject(pillar))
  }
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xd9d4c4, roughness: 0.8, emissive: 0xd9d4c4, emissiveIntensity: 0.05 })
  for (const lx of [-9, -3, 3, 9]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.15, garageD - 3), lineMat)
    line.rotation.x = -Math.PI / 2
    line.position.set(garageX + lx, floorY + 0.03, z)
    scene.add(line)
  }
  const carBodyMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.7, metalness: 0.2 })
  const carCabinMat = new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 0.6 })
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
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a463e, roughness: 1 })
  const catacombFloorMat = new THREE.MeshStandardMaterial({ color: 0x38352e, roughness: 1 })
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
  const urnMat = new THREE.MeshStandardMaterial({ color: 0x5a5648, roughness: 0.9 })
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
  const speakeasyMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.85 })
  buildRoom(scene, register, {
    x: speakeasyX, z, w: speakeasyW, d: speakeasyD, floorY, wallMat: speakeasyMat,
    doorSides: [], openSides: [dirSign === 1 ? 'west' : 'east'], // the lockable door slab above already covers this gap
  })
  const speakeasyFloorMat = new THREE.MeshStandardMaterial({ color: 0x2e2116, roughness: 0.8 })
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
  const bottleMat = new THREE.MeshStandardMaterial({ color: 0x2a5a3a, roughness: 0.3, metalness: 0.1 })
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
  const plazaMat = new THREE.MeshStandardMaterial({ color: 0xb8b0a0, roughness: 0.75 })
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
      child.material = child.material.clone()
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
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2a1f16, roughness: 0.9 })
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
    const plankMat = new THREE.MeshStandardMaterial({ map: buildSignPlankTexture(arm.lines), roughness: 0.8 })
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

  const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a3a34, roughness: 0.9 })
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
      child.material = child.material.clone()
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
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xc4c0b0, roughness: 0.8 })
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.6, d - 0.6), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(x, 0.02, z)
  floor.receiveShadow = true
  scene.add(floor)
  placePropSimple(scene, register, 'counter.glb', x - 2.5, z - 1.5, 0)

  // Canopy + pumps on the forecourt south of the store.
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0xb0331a, roughness: 0.6, metalness: 0.2 })
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2a2a26, roughness: 0.7, metalness: 0.5 })
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
  const pumpMat = new THREE.MeshStandardMaterial({ color: 0xdedad0, roughness: 0.5 })
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
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xa8a498, roughness: 0.6 })
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
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xc9a860, roughness: 0.7 })
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
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2e2e2a, roughness: 0.8 })
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.6, d - 0.6), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(x, 0.02, z)
  floor.receiveShadow = true
  scene.add(floor)
  placePropSimple(scene, register, 'counter.glb', x, z - d / 2 + 1.3, 0)

  // Antenna tower on the roof.
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x8a8478, roughness: 0.5, metalness: 0.7 })
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 6, 8), towerMat)
  tower.position.set(x, 3 + 3, z)
  tower.castShadow = true
  scene.add(tower)
  register(tower)
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x2a0505, emissive: 0xff2a1e, emissiveIntensity: 1.2 })
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
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 0.85 })
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
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xa89870, roughness: 0.8 })
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

function buildManholeCover(scene, x, z) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a2a26, roughness: 0.6, metalness: 0.6 })
  const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.05, 16), mat)
  cover.position.set(x, 0.03, z)
  cover.receiveShadow = true
  scene.add(cover)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.03, 8, 20), mat)
  rim.rotation.x = -Math.PI / 2
  rim.position.set(x, 0.06, z)
  scene.add(rim)
}

function buildWalkway(scene, register, x0, z0, x1, z1) {
  const pathMat = new THREE.MeshStandardMaterial({ color: 0x4a463c, roughness: 1 })
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
        child.material = child.material.clone()
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
  const postMat = new THREE.MeshStandardMaterial({ color: 0x3a3226, roughness: 0.85 })
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

    // Own material clone (not a shared one) - onHit flashes emissiveIntensity
    // per-instance, and a shared material would flash every target at once
    // whenever any single one was hit (same bug class as the Molotov fire
    // zone material sharing one instance earlier this session).
    const boardMat = new THREE.MeshStandardMaterial({ map: targetTex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6 })
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
  const backingMat = new THREE.MeshStandardMaterial({
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
  for (let i = 0; i < count; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const my = 1.6 + backingH / 2 - 0.3 - row * spacing
    const mz = z - backingW / 2 + 0.3 + col * spacing

    // Own material clone per medallion - each lights up independently as
    // its own achievement unlocks, not all at once (same shared-material
    // pitfall as the practice range targets/fire zones earlier).
    const mat = new THREE.MeshStandardMaterial({ color: 0x1c1a16, emissive: 0x000000, emissiveIntensity: 0, roughness: 0.4, metalness: 0.5 })
    const medallion = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 16), mat)
    medallion.rotation.z = Math.PI / 2
    medallion.position.set(x - 0.06, my, mz)
    medallion.castShadow = true
    scene.add(medallion)
    medallions.push(mat)
  }

  return { x, z, medallions }
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

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a3324, roughness: 1 })
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1c2418, roughness: 1 })
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x3a4a30, roughness: 0.7, metalness: 0.4 })

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

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2c2e30, roughness: 0.95 })
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x201f1c, roughness: 1 })
  const tileMat = new THREE.MeshStandardMaterial({ color: 0x3a3f42, roughness: 0.7 })
  const platformMat = new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 0.9 })
  const railMat = new THREE.MeshStandardMaterial({ color: 0x1a1a18, roughness: 0.4, metalness: 0.7 })

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
    const tie = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 0.15), new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1 }))
    tie.position.set(trackCenterX, SUBWAY_FLOOR_Y + 0.02, z)
    scene.add(tie)
  }

  const trainMat = new THREE.MeshStandardMaterial({ color: 0x5a4a1c, roughness: 0.6, metalness: 0.3 })
  const trainCar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 6.5), trainMat)
  trainCar.position.set(trackCenterX, SUBWAY_FLOOR_Y + 1.3, SUBWAY_Z_END - 5)
  trainCar.castShadow = true
  trainCar.receiveShadow = true
  scene.add(trainCar)
  solidMeshes.push(trainCar)
  colliders.push(new THREE.Box3().setFromObject(trainCar))
  const trainStripeMat = new THREE.MeshStandardMaterial({ color: 0xe3a63c, roughness: 0.5, emissive: 0xe3a63c, emissiveIntensity: 0.15 })
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
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xaaa392, roughness: 0.9 })
  const stepMat = new THREE.MeshStandardMaterial({ color: 0x8a8478, roughness: 0.85 })
  const stepEdgeMat = new THREE.MeshStandardMaterial({ color: 0x46423a, roughness: 0.9 })
  const railMat = new THREE.MeshStandardMaterial({ color: 0x201f1c, roughness: 0.4, metalness: 0.6 })

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
  const kioskMat = new THREE.MeshStandardMaterial({ color: 0x1c1a16, roughness: 0.85 })
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
    new THREE.MeshStandardMaterial({ map: signTexture, emissive: 0xffb347, emissiveMap: signTexture, emissiveIntensity: 1.3, side: THREE.DoubleSide })
  )
  sign.position.set(SUBWAY_PARK_ENTRANCE_X, 3.6, SUBWAY_PARK_ENTRANCE_Z + 1.51)
  sign.rotation.y = Math.PI
  scene.add(sign)

  // Tall beacon pillar above the kiosk so the entrance itself is spottable
  // from across the whole park before the sign text is even legible -
  // matches the safe zone's own beacon-post pattern (see buildSafeZone).
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x1a1408, emissive: 0xffb347, emissiveIntensity: 1.6 })
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

function buildNewUndergroundEntrance(scene, colliders, solidMeshes, flickerLights) {
  const x = NEW_UNDERGROUND_ENTRANCE_X
  const z = NEW_UNDERGROUND_ENTRANCE_Z
  const kioskMat = new THREE.MeshStandardMaterial({ color: 0x241a14, roughness: 0.9 })
  const hazardMat = new THREE.MeshStandardMaterial({ color: 0xb0331a, roughness: 0.6, metalness: 0.3 })
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
    new THREE.MeshStandardMaterial({ map: signTexture, emissive: 0xff7a3c, emissiveMap: signTexture, emissiveIntensity: 1.3, side: THREE.DoubleSide })
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
  const landingMat = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.9 })
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

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2c2e30, roughness: 0.95 })
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x201f1c, roughness: 1 })

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

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x232426, roughness: 0.95 })
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1a1916, roughness: 1 })

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
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x2a2a26, roughness: 0.7, metalness: 0.3 })
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.15), panelMat)
  panel.position.set(x, SUBWAY_FLOOR_Y + 1.4, z)
  panel.castShadow = true
  scene.add(panel)

  const indicatorMat = new THREE.MeshStandardMaterial({ color: 0x2a0808, emissive: 0xff2a1e, emissiveIntensity: 1.1 })
  const indicator = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.02), indicatorMat)
  indicator.position.set(x, SUBWAY_FLOOR_Y + 1.7, z + 0.08)
  scene.add(indicator)

  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1a, roughness: 0.6, metalness: 0.5 })
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
  const gateMat = new THREE.MeshStandardMaterial({ color: 0x2a2a26, roughness: 0.6, metalness: 0.5 })
  const gateMesh = new THREE.Mesh(new THREE.BoxGeometry(SUBWAY_WIDTH - 0.4, SUBWAY_HEIGHT - 0.4, 0.2), gateMat)
  gateMesh.position.set(x, SUBWAY_FLOOR_Y + (SUBWAY_HEIGHT - 0.4) / 2 + 0.2, z)
  gateMesh.castShadow = true
  scene.add(gateMesh)
  gateMesh.updateWorldMatrix(true, false)
  const gateBox = new THREE.Box3().setFromObject(gateMesh) // axis-aligned, not rotated - setFromObject is safe here

  const indicatorMat = new THREE.MeshStandardMaterial({ color: 0x1a0505, emissive: 0xff2a1e, emissiveIntensity: 0.9 })
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
    new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xff5a3c, emissiveMap: signTex, emissiveIntensity: 1.1, side: THREE.DoubleSide })
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
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x232426, roughness: 0.95 })
  const endWall = new THREE.Mesh(new THREE.BoxGeometry(SUBWAY_WIDTH + 0.4, SUBWAY_HEIGHT, 0.2), wallMat)
  endWall.position.set(x, SUBWAY_FLOOR_Y + SUBWAY_HEIGHT / 2, z - 4)
  scene.add(endWall)
  solidMeshes.push(endWall)
  colliders.push(new THREE.Box3().setFromObject(endWall))

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4a2e1e, roughness: 0.9, metalness: 0.1 })
  const wreck = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3, 6), bodyMat)
  wreck.position.set(x - 0.6, SUBWAY_FLOOR_Y + 1.3, z - 1)
  wreck.rotation.z = -Math.PI / 2.6
  wreck.castShadow = true
  scene.add(wreck)

  const rubbleMat = new THREE.MeshStandardMaterial({ color: 0x3a352e, roughness: 1 })
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
function buildSubwayJunctionRoom(scene, colliders, solidMeshes, cx, cz, halfSize) {
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x201f1c, roughness: 1 })
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2c2e30, roughness: 0.95 })

  const floor = new THREE.Mesh(new THREE.BoxGeometry(halfSize * 2, 0.08, halfSize * 2), floorMat)
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

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x24272a, roughness: 0.95 })
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1c1b18, roughness: 1 })
  const platformMat = new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 0.9 })
  const railMat = new THREE.MeshStandardMaterial({ color: 0x1a1a18, roughness: 0.4, metalness: 0.7 })

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
    const tie = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 0.15), new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1 }))
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

  const maintenanceSignMat = new THREE.MeshStandardMaterial({ color: 0x1a1408, roughness: 0.7, emissive: 0xffcc44, emissiveIntensity: 0.6 })
  const maintenanceSign = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 0.05), maintenanceSignMat)
  maintenanceSign.position.set(STATION_X, SUBWAY_FLOOR_Y + 2.2, STATION_STUB_Z_END - 0.12)
  scene.add(maintenanceSign)

  // Lore terminal, same screen-texture technique as the VIREO terminal - set
  // into the east wall near the platform, screen facing into the hall.
  const terminalZ = STATION_Z_END - 3
  const terminalX = STATION_X + STATION_WIDTH / 2 - 0.6
  const terminalMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 })
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
  const screenMat = new THREE.MeshStandardMaterial({
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
    new THREE.MeshStandardMaterial({ map: level2SignTexture, emissive: 0x8ab4ff, emissiveMap: level2SignTexture, emissiveIntensity: 0.9 })
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
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a3324, roughness: 1 })
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1c2418, roughness: 1 })
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x3a4a30, roughness: 0.7, metalness: 0.4 })

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

  const poolMat = new THREE.MeshStandardMaterial({
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

  const walkwayMat = new THREE.MeshStandardMaterial({ color: 0x4a4438, roughness: 0.9 })
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
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x4a3624, roughness: 0.95 })
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
  const warnMat = new THREE.MeshStandardMaterial({ color: 0x2a1c10, roughness: 1, emissive: 0x3a1a0a, emissiveIntensity: 0.4 })
  const warnMark = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.08), warnMat)
  warnMark.position.set(x, floorY + MINE_HEIGHT - 0.3, z + 0.12)
  scene.add(warnMark)

  return { x, z, floorY, triggered: false, beam, posts: null, warnMark }
}

function buildMineLevel(scene, colliders, solidMeshes, flickerLights, chestSpots) {
  const x = MINE_X
  const rockWallMat = new THREE.MeshStandardMaterial({ color: 0x3a3128, roughness: 1 })
  const dirtFloorMat = new THREE.MeshStandardMaterial({ color: 0x261f16, roughness: 1 })
  const beamDressMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.95 })

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
  const oreMat = new THREE.MeshStandardMaterial({ color: 0x8a6a1a, emissive: 0xffb347, emissiveIntensity: 0.6, roughness: 0.5, metalness: 0.3 })
  for (const [ox, oy] of [[-0.6, 0.3], [0.5, -0.2], [0, 0.6]]) {
    const ore = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22), oreMat)
    ore.position.set(x + ox, MINE_FLOOR_Y + MINE_HEIGHT / 2 + oy, MINE_Z_END + 0.15)
    scene.add(ore)
  }

  chestSpots.push({ x, y: MINE_FLOOR_Y, z: MINE_Z_END + 3 })

  return { beams: [beam1, beam2], floorY: MINE_FLOOR_Y, mineWidth: MINE_WIDTH }
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

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a1418, roughness: 0.9 })

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
  const floorMat = new THREE.MeshStandardMaterial({ map: stripeTexture, roughness: 1 })

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

  const propMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.8 })
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
  const terminalMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 })
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
  const screenMat = new THREE.MeshStandardMaterial({
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

  const exitKioskMat = new THREE.MeshStandardMaterial({ color: 0x1c1a16, roughness: 0.85 })
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
  const exitSign = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.4, 0.06), new THREE.MeshStandardMaterial({ color: 0x0a1408, emissive: 0x4ee06f, emissiveIntensity: 1 }))
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
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x23211d, roughness: 1 })
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

// Real modeled buildings (Kenney City Kit - Commercial, CC0) used in place of
// flat procedural boxes wherever available. Loaded once up front via
// preloadBuildingModels() (awaited in main.js before the game starts, behind
// a loading screen) so buildWorld() itself can stay synchronous - it just
// reads whatever finished loading out of this cache. If a file failed to
// load (or preload was skipped), addBuilding falls back to the original
// box-with-canvas-texture look, so nothing can hard-crash on a bad network.
const BUILDING_MODEL_FILES = [
  'building-a.glb', 'building-b.glb', 'building-c.glb', 'building-d.glb',
  'building-e.glb', 'building-f.glb', 'building-g.glb', 'building-h.glb',
  'building-i.glb', 'building-k.glb', 'building-l.glb', 'building-m.glb',
  'building-n.glb',
]
const _modelCache = new Map()

export async function preloadBuildingModels() {
  const loader = new GLTFLoader()
  await Promise.all(BUILDING_MODEL_FILES.map(async (file) => {
    try {
      const gltf = await loader.loadAsync(`/models/buildings/${file}`)
      const box = new THREE.Box3().setFromObject(gltf.scene)
      const size = new THREE.Vector3()
      box.getSize(size)
      _modelCache.set(file, { scene: gltf.scene, size })
    } catch (err) {
      console.warn(`Building model failed to load, falling back to procedural box: ${file}`, err)
    }
  }))
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

// Weathering tint applied per building instance (on top of each model's own
// clean Kenney texture) so 20-odd buildings drawing from ~13 shared model
// files don't all look like identical copy-paste, and so they read as
// worn/abandoned rather than a bright modern city kit.
const MODEL_TINTS = [
  { mul: 0x554a3c, roughness: 0.95 },
  { mul: 0x3f4842, roughness: 1.0 },
  { mul: 0x4a4038, roughness: 0.9 },
  { mul: 0x454540, roughness: 1.0 },
]

function addModelBuilding(scene, register, spec, model) {
  const group = model.scene.clone(true)
  const tint = MODEL_TINTS[Math.abs(Math.floor(spec.x + spec.z)) % MODEL_TINTS.length]
  const tintColor = new THREE.Color(tint.mul)
  group.traverse((o) => {
    if (!o.isMesh) return
    o.castShadow = true
    o.receiveShadow = true
    o.material = o.material.clone()
    o.material.color.multiply(tintColor)
    o.material.roughness = tint.roughness
    o.material.metalness = 0
  })

  // Kenney models are pivoted at their own base footprint size, not the
  // procedural layout's target box - scale per axis to fit the same w/h/d
  // slot a box building would have occupied, so the rest of buildWorld
  // (spawn points, skyscraper picks, minimap) needs zero changes.
  group.scale.set(spec.w / model.size.x, spec.h / model.size.y, spec.d / model.size.z)
  group.position.set(spec.x, 0, spec.z)
  scene.add(group)
  register(group)

  if (spec.broken) {
    const rubbleCap = new THREE.Mesh(
      new THREE.BoxGeometry(spec.w * 0.7, spec.h * 0.15, spec.d * 0.7),
      new THREE.MeshStandardMaterial({ color: 0x1c1a16, roughness: 1 })
    )
    rubbleCap.position.set(spec.x + spec.w * 0.1, spec.h + spec.h * 0.05, spec.z)
    rubbleCap.rotation.z = 0.08
    rubbleCap.castShadow = true
    scene.add(rubbleCap)
  }

  addIvyOverlay(scene, spec)
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
        modelFile: BUILDING_MODEL_FILES[seed % BUILDING_MODEL_FILES.length],
      })
    }
  }
  return list
}

const BUILDING_COLORS = [0x38342e, 0x33373a, 0x3c302a, 0x2e3630]

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
        modelFile: BUILDING_MODEL_FILES[seed % BUILDING_MODEL_FILES.length],
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

const OUTER_ZONES = [
  { name: 'suburbs', centerX: 0, centerZ: 140, axis: 'z' },
  { name: 'industrial', centerX: 0, centerZ: -160, axis: 'z' },
  { name: 'commercial', centerX: 160, centerZ: 0, axis: 'x' },
  { name: 'residential', centerX: -160, centerZ: 0, axis: 'x' },
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

  const floorMat = new THREE.MeshStandardMaterial({ color: 0xb8a888, roughness: 0.8 })
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

function buildOuterZones(scene, register, cullables, towerChestSpots) {
  let seed = 1000 // offset clear of buildingLayout()'s own 0-20 range
  const lightModel = _propModelCache.get('streetlight.glb')
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.8 })

  const placeProp = (fileName, x, z, rotY = 0) => {
    const model = _propModelCache.get(fileName)
    if (!model) return
    const clone = model.clone(true)
    clone.position.set(x, 0, z)
    clone.rotation.y = rotY
    clone.traverse((child) => {
      if (!child.isMesh) return
      child.castShadow = true
      child.receiveShadow = true
      child.material = child.material.clone()
    })
    scene.add(clone)
    cullables.push(clone)
  }

  const placeStreetlight = (x, z) => {
    if (lightModel) {
      const clone = lightModel.clone(true)
      clone.position.set(x, 0, z)
      clone.traverse((child) => {
        if (!child.isMesh) return
        child.castShadow = true
        child.material = child.material.clone()
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
      } else {
        addBuilding(scene, register, spec)
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

function addBuilding(scene, register, spec) {
  const model = spec.modelFile && _modelCache.get(spec.modelFile)
  if (model) return addModelBuilding(scene, register, spec, model)

  const color = BUILDING_COLORS[Math.floor(Math.abs(spec.x + spec.z)) % BUILDING_COLORS.length]
  const facadeTex = getFacadeTexture(color).clone()
  facadeTex.needsUpdate = true
  facadeTex.repeat.set(Math.max(1, spec.w / 4), Math.max(1, spec.h / 4))
  const facadeBumpTex = getSharedBumpTexture().clone()
  facadeBumpTex.needsUpdate = true
  facadeBumpTex.repeat.copy(facadeTex.repeat)
  const mat = new THREE.MeshStandardMaterial({ map: facadeTex, bumpMap: facadeBumpTex, bumpScale: 0.035, roughness: 0.95 })
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(spec.w, spec.h, spec.d), mat)
  mesh.position.set(spec.x, spec.h / 2, spec.z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  scene.add(mesh)
  register(mesh)

  if (spec.broken) {
    const rubbleCap = new THREE.Mesh(
      new THREE.BoxGeometry(spec.w * 0.7, spec.h * 0.15, spec.d * 0.7),
      new THREE.MeshStandardMaterial({ color: 0x1c1a16, roughness: 1 })
    )
    rubbleCap.position.set(spec.x + spec.w * 0.1, spec.h + spec.h * 0.05, spec.z)
    rubbleCap.rotation.z = 0.08
    rubbleCap.castShadow = true
    scene.add(rubbleCap)
  }

  addWindows(scene, spec)
  addIvyOverlay(scene, spec)
}

function addWindows(scene, spec) {
  const litMat = new THREE.MeshStandardMaterial({
    color: 0x1a1508,
    emissive: 0xffb646,
    emissiveIntensity: 1.4,
  })
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x0c0f12,
    emissive: 0x0b1420,
    emissiveIntensity: 0.4,
  })

  const facingSign = spec.x < 0 ? 1 : -1
  const faceX = spec.x + facingSign * (spec.w / 2 + 0.02)
  const cols = Math.max(2, Math.floor(spec.d / 3))
  const rowsCount = Math.max(2, Math.floor(spec.h / 3))

  for (let r = 0; r < rowsCount; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = Math.random() < 0.22 && !spec.broken
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.2), lit ? litMat : darkMat)
      mesh.rotation.y = facingSign > 0 ? Math.PI / 2 : -Math.PI / 2
      const z = spec.z - spec.d / 2 + 1.5 + c * ((spec.d - 3) / Math.max(1, cols - 1))
      const y = 1.8 + r * 2.6
      mesh.position.set(faceX, Math.min(y, spec.h - 1), z)
      scene.add(mesh)
    }
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
    clone.traverse((child) => {
      if (!child.isMesh) return
      child.castShadow = true
      child.receiveShadow = true
      child.material = child.material.clone()
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

function scatterDebris(scene) {
  const brickMat = new THREE.MeshStandardMaterial({ color: 0x4a4438, roughness: 1 })
  const plankMat = new THREE.MeshStandardMaterial({ color: 0x2c2418, roughness: 0.9 })

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
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.8 })
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
      clone.traverse((child) => {
        if (!child.isMesh) return
        child.castShadow = true
        child.material = child.material.clone()
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
        new THREE.MeshStandardMaterial({ color: 0x332200, emissive: 0xffbb55, emissiveIntensity: 1.6 })
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
  const facingSign = cx < 0 ? 1 : -1 // open facade faces the central avenue

  const shellMat = new THREE.MeshStandardMaterial({ color: 0x2c2822, roughness: 0.95 })
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a352c, roughness: 0.9 })

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

  for (let floor = 1; floor < SKYSCRAPER_FLOORS; floor++) {
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

    chestSpots.push({ x: mainRoomCenterX, y, z: cz })
  }
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

  const stepMat = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.6, metalness: 0.6 })
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x2e2a24, roughness: 0.9 })
  const railMat = new THREE.MeshStandardMaterial({ color: 0x1c1a16, roughness: 0.7, metalness: 0.5 })

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
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a352c, roughness: 0.9 })
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2c2a22, roughness: 0.95 })
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
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x1c1a15, roughness: 0.9 })
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

function buildStairFlight(scene, solidMeshes, x0, z0, y0, x1, z1, y1, steps) {
  const stepMat = new THREE.MeshStandardMaterial({ color: 0x332e26, roughness: 0.9 })
  const geo = new THREE.BoxGeometry(1.6, 0.25, 1.0)

  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const step = new THREE.Mesh(geo, stepMat)
    step.position.set(
      THREE.MathUtils.lerp(x0, x1, t),
      THREE.MathUtils.lerp(y0, y1, t),
      THREE.MathUtils.lerp(z0, z1, t)
    )
    step.castShadow = true
    step.receiveShadow = true
    scene.add(step)
    solidMeshes.push(step) // walkable, intentionally not a horizontal collider
  }
}
