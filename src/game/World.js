import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

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
export function buildWorld(scene) {
  const colliders = []
  const solidMeshes = []
  const flickerLights = []
  const spawnPoints = []

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
  }

  scene.background = new THREE.Color(0x12161b)
  scene.fog = new THREE.Fog(0x12161b, 15, 85)

  const hemi = new THREE.HemisphereLight(0x7f93ab, 0x20201a, 0.85)
  scene.add(hemi)

  const moon = new THREE.DirectionalLight(0xc3d2ec, 1.0)
  moon.position.set(30, 45, -15)
  moon.castShadow = true
  moon.shadow.mapSize.set(1536, 1536)
  moon.shadow.camera.left = -75
  moon.shadow.camera.right = 75
  moon.shadow.camera.top = 75
  moon.shadow.camera.bottom = -75
  scene.add(moon)

  const groundSize = 150
  const groundTex = new THREE.TextureLoader().load('/textures/ground-asphalt.png')
  groundTex.wrapS = THREE.RepeatWrapping
  groundTex.wrapT = THREE.RepeatWrapping
  groundTex.colorSpace = THREE.SRGBColorSpace
  groundTex.repeat.set(groundSize / 12, groundSize / 12)
  const groundBumpTex = getSharedBumpTexture().clone()
  groundBumpTex.needsUpdate = true
  groundBumpTex.repeat.set(groundSize / 3, groundSize / 3)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshStandardMaterial({ map: groundTex, bumpMap: groundBumpTex, bumpScale: 0.06, roughness: 1 })
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)
  solidMeshes.push(ground) // walkable ground for the player's floor-height raycast

  addStreetMarkings(scene)
  addPerimeterBarricade(scene, register, groundSize)
  const buildings = buildingLayout()

  // Two of the generated building slots become real enterable skyscrapers
  // (walkable interior floors + stairwell) instead of solid decorative boxes.
  const skyscraperIdxs = [7, 12]
  for (const i of skyscraperIdxs) {
    buildings[i].skyscraper = true
    buildings[i].broken = false
    buildings[i].w = 10
    buildings[i].d = 10
    buildings[i].h = SKYSCRAPER_FLOOR_H * SKYSCRAPER_FLOORS
  }

  const towerChestSpots = []
  for (const b of buildings) {
    if (b.skyscraper) buildSkyscraper(scene, colliders, solidMeshes, b, towerChestSpots)
    else addBuilding(scene, register, b)
  }

  scatterDebris(scene)
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

  // Second area: a small park beyond the north end of the street, in the
  // space freed up by pushing the perimeter barricade out to groundSize/2.
  const park = buildPark(scene, colliders, solidMeshes)
  for (const spot of park.chestSpots) towerChestSpots.push(spot)
  for (const spot of park.spawnPoints) spawnPoints.push(spot)

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
    safeZone,
  }
}

// A small park connected to the north end of the main avenue - open grass,
// scattered trees, a couple of benches, and its own chest/spawn points, so
// exploring past the city block is rewarded with a change of scenery.
const PARK_Z_START = 52
const PARK_Z_END = 72
const PARK_HALF_WIDTH = 22

function buildPark(scene, colliders, solidMeshes) {
  const centerZ = (PARK_Z_START + PARK_Z_END) / 2
  const depth = PARK_Z_END - PARK_Z_START

  const grassMat = new THREE.MeshStandardMaterial({ color: 0x2c3a24, roughness: 1 })
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(PARK_HALF_WIDTH * 2, depth), grassMat)
  grass.rotation.x = -Math.PI / 2
  grass.position.set(0, 0.01, centerZ)
  grass.receiveShadow = true
  scene.add(grass)

  const pathMat = new THREE.MeshStandardMaterial({ color: 0x4a463c, roughness: 1 })
  const path = new THREE.Mesh(new THREE.PlaneGeometry(4, depth), pathMat)
  path.rotation.x = -Math.PI / 2
  path.position.set(0, 0.015, centerZ)
  scene.add(path)

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2a1f16, roughness: 1 })
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3a4d2a, roughness: 0.9 })
  const treeSpots = [
    [-14, 56], [14, 58], [-9, 63], [10, 66], [-16, 69], [16, 61], [-5, 70], [6, 54],
  ]
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
  const benchSpots = [[-3, 58, 0], [3, 65, Math.PI]]
  for (const [x, z, rot] of benchSpots) {
    const bench = new THREE.Group()
    bench.position.set(x, 0, z)
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
  // Inside the safe zone compound (x:-13 z:-10, half:7 - see buildSafeZone)
  // instead of out on the open avenue, so both "spend points" stops sit
  // behind the guarded wall together.
  const x = -16
  const z = -12

  const group = new THREE.Group()
  group.position.set(x, 0, z)
  group.rotation.y = Math.PI * 0.15

  const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a3624, roughness: 0.9 })
  const tarpMat = new THREE.MeshStandardMaterial({ color: 0x5a2e2a, roughness: 0.85 })
  const signMat = new THREE.MeshStandardMaterial({ color: 0x1a1410, emissive: 0xffb347, emissiveIntensity: 1.1 })

  const COUNTER_W = 1.6
  const COUNTER_H = 0.9
  const COUNTER_D = 0.6
  const counter = new THREE.Mesh(new THREE.BoxGeometry(COUNTER_W, COUNTER_H, COUNTER_D), woodMat)
  counter.position.y = 0.45
  counter.castShadow = true
  counter.receiveShadow = true
  group.add(counter)

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

  scene.add(group)
  // The counter sits on the group's own rotation axis (no local x/z
  // offset), so its true world footprint is just its unrotated half-extents
  // re-centered at the group's world x/z - no need to let setFromObject
  // inflate it for the 27deg tilt (see register()'s explicitBox comment).
  const counterBox = new THREE.Box3(
    new THREE.Vector3(x - COUNTER_W / 2, 0, z - COUNTER_D / 2),
    new THREE.Vector3(x + COUNTER_W / 2, COUNTER_H, z + COUNTER_D / 2)
  )
  register(counter, counterBox)

  return { x, z, signMat, mesh: counter }
}

// Ammo refill kiosk near spawn - hold the interact key here for a few
// seconds (without firing) to top off reserve ammo instead of relying on
// pickups alone (see Game.js's _updateAmmoStation). Kept well clear of the
// generator/trader stall so all three street props read as distinct spots.
function buildAmmoStation(scene, register) {
  // Also inside the safe zone, next to the trader stall (see
  // buildTraderStall, x:-16 z:-12) - both spend-points-here stops behind
  // the same guarded wall.
  const x = -10
  const z = -12

  const group = new THREE.Group()
  group.position.set(x, 0, z)

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5a2a1e, roughness: 0.7, metalness: 0.2 })
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1a, roughness: 0.5, metalness: 0.5 })
  const buttonMat = new THREE.MeshStandardMaterial({ color: 0x2a0808, emissive: 0xff2a1e, emissiveIntensity: 1.1 })

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.5), bodyMat)
  body.position.y = 0.55
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.06, 0.54), trimMat)
  trim.position.y = 1.06
  group.add(trim)

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

  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 16), buttonMat)
  button.rotation.x = Math.PI / 2
  button.position.set(0, 0.28, 0.26)
  group.add(button)

  scene.add(group)
  register(body)

  return { x, z, buttonMat, mesh: body }
}

// A walled compound with a single entrance gap - guard NPCs (see Game.js,
// which spawns Companion instances at guardSpots) stand watch just inside
// the gap and shoot anything that wanders close, so the gap reads as a
// defended chokepoint instead of an unguarded hole in the wall. Game.js also
// slowly heals the player while they're within `radius` of the center.
function buildSafeZone(scene, colliders, solidMeshes) {
  const x = -13
  const z = -10
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

  // Four sides, with a gap left in the +z (avenue-facing) wall for an entrance.
  addWall(0, -half, half * 2, 0.6)
  addWall(-half, 0, 0.6, half * 2)
  addWall(half, 0, 0.6, half * 2)
  const sideWallLen = half - gapHalfWidth
  addWall(-(gapHalfWidth + sideWallLen / 2), half, sideWallLen, 0.6)
  addWall(gapHalfWidth + sideWallLen / 2, half, sideWallLen, 0.6)

  // Sandbag-topped watchtower posts flanking the entrance, doubling as the
  // first two guardSpots so the gap is covered from the moment it's built.
  const guardSpots = []
  for (const side of [-1, 1]) {
    const postX = x + side * (gapHalfWidth + 0.5)
    const postZ = z + half - 1.2
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.9), sandbagMat)
    post.position.set(postX, 0.55, postZ)
    post.castShadow = true
    post.receiveShadow = true
    scene.add(post)
    solidMeshes.push(post)
    colliders.push(new THREE.Box3().setFromObject(post))
    guardSpots.push({ x: postX, z: postZ - 0.7 })
  }
  // Third guard further back inside the compound, covering anything that
  // makes it past the gap.
  guardSpots.push({ x: x, z: z - half + 2 })

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


// Second hidden biome - a grimy sewer corridor, home to the Sewer Dweller
// zombie type (see ZombieTypes.js). Same enclosed wall/ceiling/floor
// construction as the subway corridor, just re-themed.
const SEWER_X = -5
const SEWER_Z_START = 34
const SEWER_Z_END = 50
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

  const lightSpacing = 5
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
const SUBWAY_ENTRANCE_Z = SUBWAY_Z_START - 3

function buildSubway(scene, colliders, solidMeshes, flickerLights) {
  const length = SUBWAY_Z_END - SUBWAY_Z_START
  const centerZ = (SUBWAY_Z_START + SUBWAY_Z_END) / 2

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2c2e30, roughness: 0.95 })
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x201f1c, roughness: 1 })
  const tileMat = new THREE.MeshStandardMaterial({ color: 0x3a3f42, roughness: 0.7 })
  const platformMat = new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 0.9 })
  const railMat = new THREE.MeshStandardMaterial({ color: 0x1a1a18, roughness: 0.4, metalness: 0.7 })
  const kioskMat = new THREE.MeshStandardMaterial({ color: 0x1c1a16, roughness: 0.85 })

  // Street-level entrance kiosk: a roofed frame around the top of the stairs
  // so the descent reads as "a subway entrance", not just stairs vanishing
  // into the ground.
  const kioskHalfW = SUBWAY_WIDTH / 2 + 0.3
  const kioskRoof = new THREE.Mesh(new THREE.BoxGeometry(kioskHalfW * 2, 0.25, 3), kioskMat)
  kioskRoof.position.set(SUBWAY_X, 2.6, SUBWAY_ENTRANCE_Z)
  kioskRoof.castShadow = true
  scene.add(kioskRoof)
  solidMeshes.push(kioskRoof)
  colliders.push(new THREE.Box3().setFromObject(kioskRoof))
  for (const [ox, oz] of [[-kioskHalfW, -1.5], [-kioskHalfW, 1.5], [kioskHalfW, -1.5], [kioskHalfW, 1.5]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.6, 0.2), kioskMat)
    post.position.set(SUBWAY_X + ox, 1.3, SUBWAY_ENTRANCE_Z + oz)
    post.castShadow = true
    scene.add(post)
  }
  const sign = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.4, 0.06), new THREE.MeshStandardMaterial({ color: 0x1a1408, emissive: 0xffb347, emissiveIntensity: 1 }))
  sign.position.set(SUBWAY_X, 2.3, SUBWAY_ENTRANCE_Z - 1.51)
  scene.add(sign)

  buildStairFlight(
    scene, solidMeshes,
    SUBWAY_X, SUBWAY_ENTRANCE_Z, 0,
    SUBWAY_X, SUBWAY_Z_START + 1.5, SUBWAY_FLOOR_Y,
    18
  )

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

  const endWallStart = new THREE.Mesh(new THREE.BoxGeometry(SUBWAY_WIDTH + 0.4, SUBWAY_HEIGHT, 0.2), wallMat)
  endWallStart.position.set(SUBWAY_X, SUBWAY_FLOOR_Y + SUBWAY_HEIGHT / 2, SUBWAY_Z_START)
  endWallStart.castShadow = true
  scene.add(endWallStart)
  solidMeshes.push(endWallStart)
  colliders.push(new THREE.Box3().setFromObject(endWallStart))

  // No far-end wall here (unlike endWallStart) - the corridor continues
  // straight into the VIREO facility extension instead of dead-ending, see
  // buildVireoFacility, which now attaches right at SUBWAY_Z_END and is
  // this subway's second exit (surfacing further down the line) as well as
  // where the UV Lamp pickup + terminal now live, replacing their old
  // standalone-tunnel entrance.

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

  const lightSpacing = 5
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

// Hidden VIREO sub-level - used to branch off a standalone surface tunnel,
// now instead a straight continuation of the subway corridor past
// SUBWAY_Z_END (no wall between them, see buildSubway's endWallFar removal)
// so reaching it means riding the subway stairs down rather than finding a
// separate tunnel entrance. Hazard lighting, lab clutter, and a terminal
// (see Game.js's nearVireoTerminal handling) that pays off the audio log
// arc, plus the UV Lamp weapon pickup (see Game.js's spawnUnique('uvlamp',
// ...)) right where the corridor opens up. Past the terminal, a second
// staircase climbs back to street level - the subway's exit, so the whole
// underground loop doesn't dead-end back the way you came.
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
  floor.position.set(FACILITY_X, SUBWAY_FLOOR_Y + 0.04, centerZ)
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

  const lightSpacing = 5
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
    uvLampSpot: { x: FACILITY_X, z: FACILITY_Z_START + 6 },
    floorY: SUBWAY_FLOOR_Y,
    exitSpot: { x: FACILITY_X, z: FACILITY_EXIT_Z },
  }
}

function addStreetMarkings(scene) {
  const lineMat = new THREE.MeshStandardMaterial({ color: 0x6b6b5a, roughness: 1, emissive: 0x1a1a12, emissiveIntensity: 0.15 })
  for (let z = -45; z <= 45; z += 6) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 3), lineMat)
    dash.rotation.x = -Math.PI / 2
    dash.position.set(0, 0.02, z)
    scene.add(dash)
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

  for (const p of positions) {
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

// Small scavenger-built lookout platforms: an elevated one-room structure
// reached by an exterior staircase from the ground, each holding a chest.
// Placed on the open central avenue (x within ~±10) so they never collide
// with the building rows further out, well clear of the perimeter wall.
const ROOM_SIZE = 5.5
const FLOOR_Y = 4.0
const WALL_HEIGHT = 2.3
const SLAB_THICKNESS = 0.3
const CLUSTER_SPECS = [
  { x: -3, z: 44 },
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
