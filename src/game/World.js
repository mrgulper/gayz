import * as THREE from 'three'

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
  const register = (object) => {
    colliders.push(new THREE.Box3().setFromObject(object))
    solidMeshes.push(object)
  }

  scene.background = new THREE.Color(0x161c22)
  scene.fog = new THREE.Fog(0x161c22, 18, 100)

  const hemi = new THREE.HemisphereLight(0x7f93ab, 0x20201a, 0.85)
  scene.add(hemi)

  const moon = new THREE.DirectionalLight(0xc3d2ec, 1.0)
  moon.position.set(30, 45, -15)
  moon.castShadow = true
  moon.shadow.mapSize.set(2048, 2048)
  moon.shadow.camera.left = -75
  moon.shadow.camera.right = 75
  moon.shadow.camera.top = 75
  moon.shadow.camera.bottom = -75
  scene.add(moon)

  const groundSize = 150
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshStandardMaterial({ color: 0x2c2e30, roughness: 1 })
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

  scatterCars(scene, colliders, solidMeshes)
  scatterRubble(scene, colliders, solidMeshes)
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
  const tunnel = buildTunnel(scene, colliders, solidMeshes, flickerLights)
  addNeonSigns(scene)
  towerChestSpots.push(tunnel.chestSpot)
  spawnPoints.push({ x: tunnel.chestSpot.x, z: tunnel.chestSpot.z })

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

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.4, 8), trunkMat)
    trunk.position.y = 1.2
    trunk.castShadow = true
    tree.add(trunk)

    const leaves = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3, 8), leafMat)
    leaves.position.y = 3.4
    leaves.castShadow = true
    tree.add(leaves)

    scene.add(tree)
    solidMeshes.push(trunk)
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
  const x = -3
  const z = 11

  const group = new THREE.Group()
  group.position.set(x, 0, z)
  group.rotation.y = Math.PI * 0.15

  const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a3624, roughness: 0.9 })
  const tarpMat = new THREE.MeshStandardMaterial({ color: 0x5a2e2a, roughness: 0.85 })
  const signMat = new THREE.MeshStandardMaterial({ color: 0x1a1410, emissive: 0xffb347, emissiveIntensity: 1.1 })

  const counter = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.6), woodMat)
  counter.position.y = 0.45
  counter.castShadow = true
  counter.receiveShadow = true
  group.add(counter)

  for (const dx of [-0.7, 0.7]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.1, 6), woodMat)
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
  register(counter)

  return { x, z, signMat }
}

// Enclosed maintenance-tunnel shortcut off the avenue, between the two
// existing chest lanes. Note: it stays at the same walkable ground level as
// everywhere else - the player/zombie collision here is built on one
// continuous flat ground raycast (see PlayerController._sampleGroundHeight),
// so a true below-grade dig isn't practical without reworking that system.
// It reads as underground instead: low concrete ceiling, no sky, dim
// flickering lights, walled in on both sides.
const TUNNEL_X = 5
const TUNNEL_Z_START = 14
const TUNNEL_Z_END = 36
const TUNNEL_WIDTH = 2.6
const TUNNEL_HEIGHT = 2.3

function buildTunnel(scene, colliders, solidMeshes, flickerLights) {
  const length = TUNNEL_Z_END - TUNNEL_Z_START
  const centerZ = (TUNNEL_Z_START + TUNNEL_Z_END) / 2

  const concreteMat = new THREE.MeshStandardMaterial({ color: 0x3a3a38, roughness: 0.95 })
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x26261f, roughness: 1 })

  const floor = new THREE.Mesh(new THREE.BoxGeometry(TUNNEL_WIDTH, 0.08, length), floorMat)
  floor.position.set(TUNNEL_X, 0.04, centerZ)
  floor.receiveShadow = true
  scene.add(floor)
  solidMeshes.push(floor)

  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(TUNNEL_WIDTH + 0.4, 0.2, length), concreteMat)
  ceiling.position.set(TUNNEL_X, TUNNEL_HEIGHT, centerZ)
  ceiling.castShadow = true
  scene.add(ceiling)
  solidMeshes.push(ceiling)
  colliders.push(new THREE.Box3().setFromObject(ceiling))

  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, TUNNEL_HEIGHT, length), concreteMat)
    wall.position.set(TUNNEL_X + side * (TUNNEL_WIDTH / 2 + 0.1), TUNNEL_HEIGHT / 2, centerZ)
    wall.castShadow = true
    wall.receiveShadow = true
    scene.add(wall)
    solidMeshes.push(wall)
    colliders.push(new THREE.Box3().setFromObject(wall))
  }

  // Support ribs every few meters, each with its own dim flickering light -
  // reuses the same {light, base, seed} shape Game.js's _updateFlicker expects.
  const ribSpacing = 6
  const ribCount = Math.floor(length / ribSpacing)
  for (let i = 1; i < ribCount; i++) {
    const z = TUNNEL_Z_START + ribSpacing * i
    const rib = new THREE.Mesh(new THREE.BoxGeometry(TUNNEL_WIDTH + 0.4, 0.15, 0.15), concreteMat)
    rib.position.set(TUNNEL_X, TUNNEL_HEIGHT - 0.1, z)
    scene.add(rib)

    const light = new THREE.PointLight(0xffcf7a, 0.9, 5, 2)
    light.position.set(TUNNEL_X, TUNNEL_HEIGHT - 0.3, z)
    scene.add(light)
    flickerLights.push({ light, base: 0.9, seed: Math.random() * 100 })
  }

  return { chestSpot: { x: TUNNEL_X, y: 0, z: centerZ } }
}

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

  // Branded sign at the tunnel mouth - ties the neon signage to the audio
  // log lore (see Game.js's loreAudiolog4/5 text) without needing any extra
  // in-game UI to explain it.
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 96
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#0a0a0f'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#ff2bd6'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 46px sans-serif'
  ctx.fillText('VIREO', canvas.width / 2, canvas.height / 2 - 10)
  ctx.font = '16px sans-serif'
  ctx.fillStyle = '#2be6ff'
  ctx.fillText('wellness light program', canvas.width / 2, canvas.height / 2 + 28)

  const brandMat = new THREE.MeshStandardMaterial({
    map: new THREE.CanvasTexture(canvas),
    emissive: 0xffffff,
    emissiveMap: new THREE.CanvasTexture(canvas),
    emissiveIntensity: 1.4,
    side: THREE.DoubleSide,
  })
  const brandSign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.2), brandMat)
  brandSign.position.set(5, 6, 13)
  brandSign.rotation.y = Math.PI
  scene.add(brandSign)

  const brandLight = new THREE.PointLight(0xff2bd6, 1.1, 9, 2)
  brandLight.position.set(5, 6, 12.5)
  scene.add(brandLight)
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

const BUILDING_COLORS = [0x38342e, 0x33373a, 0x3c302a, 0x2e3630]

function addBuilding(scene, register, spec) {
  const color = BUILDING_COLORS[Math.floor(Math.abs(spec.x + spec.z)) % BUILDING_COLORS.length]
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95 })
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

const CAR_POSITIONS = [
  { x: -5, z: -6, rot: 0.15 },
  { x: 4.5, z: 4, rot: -0.4 },
  { x: -6, z: 22, rot: 1.6 },
  { x: 5, z: -24, rot: 0.3 },
]

function scatterCars(scene, colliders, solidMeshes) {
  for (const c of CAR_POSITIONS) {
    const group = new THREE.Group()
    group.position.set(c.x, 0, c.z)
    group.rotation.y = c.rot

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4a2018, roughness: 1, metalness: 0.1 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 4), bodyMat)
    body.position.y = 0.55
    body.castShadow = true
    group.add(body)

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2), bodyMat)
    cabin.position.set(0, 1.05, -0.3)
    cabin.castShadow = true
    group.add(cabin)

    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
    for (const [wx, wz] of [[-0.9, 1.3], [0.9, 1.3], [-0.9, -1.3], [0.9, -1.3]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 10), wheelMat)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(wx, 0.35, wz)
      group.add(wheel)
    }

    scene.add(group)
    solidMeshes.push(group)

    // Cap the collision height well below the cabin roof so a jump reliably
    // clears it, while bullets (solidMeshes) still hit the full visual car.
    const box = new THREE.Box3().setFromObject(group)
    box.max.y = Math.min(box.max.y, box.min.y + 0.75)
    colliders.push(box)
  }
}

function scatterRubble(scene, colliders, solidMeshes) {
  const rubbleMat = new THREE.MeshStandardMaterial({ color: 0x39362f, roughness: 1 })
  const positions = [
    [10, -12], [-11, 6], [14, 10], [-3, -30], [7, 30], [-15, -22], [16, -30],
  ]

  for (const [x, z] of positions) {
    const size = 1.1 + Math.random() * 1.3
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), rubbleMat)
    mesh.position.set(x, size * 0.4, z)
    mesh.rotation.set(Math.random(), Math.random(), Math.random())
    mesh.castShadow = true
    mesh.receiveShadow = true
    scene.add(mesh)

    if (size > 1.6) {
      solidMeshes.push(mesh)
      // Same low-collision-height trick as cars, so rubble is jumpable too.
      const box = new THREE.Box3().setFromObject(mesh)
      box.max.y = Math.min(box.max.y, box.min.y + 0.75)
      colliders.push(box)
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
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5.5, 8), poleMat)
    pole.position.set(p.x, 2.75, p.z)
    pole.castShadow = true
    scene.add(pole)
    register(pole)

    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 8, 8),
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
