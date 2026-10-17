import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { cleanPixels } from './PixelClean.js'

// Every weapon's 3D model (2026-10-10, Gaymi picked each one: "for all the
// guns can we go on sketchfab and find high quality gun models that are
// free"). Real models from Sketchfab/CC Attribution makers, credited in
// public/models/weapons/CREDITS.txt and the Credits page. They replaced
// the Quaternius pack guns and the procedural box-built ones.
//
// The files were run through a pipeline before committing (Sketchfab GLB
// -> dedup/join -> base color textures 512px, every other texture 256px,
// webp -> meshopt): ~5 MB on disk and ~57 MB of texture memory for all of
// them (the old pack was ~133 MB - see the "GLB texture resolution" note in
// CLAUDE.md). Two files had extra parts cut there: the AK file carries three
// stacked versions (normal, gold, worn - only normal is kept) and the M1911
// came with a loose magazine lying beside it.
//
// Each model arrives in its own maker's units and facing. `rot` turns it so
// the muzzle points along -z with the top up (Euler, `order`), `len` is its
// length along z in game units (matched to the old guns' sizes so Try Map's
// arms and the camera still fit), and the gun's back sits a fifth of its
// length behind the origin - the same layout every old gun had, which
// BuildTryMode._findHandSpots and the Inventory pictures expect.
const H = Math.PI / 2
const WEAPON_MODELS = {
  // Blades are tipped up (`tilt`, radians) so they read as held, not
  // poking straight away from the camera.
  melee: { rot: [H, H, 0], len: 0.34, tilt: 0.75 },
  // The AK model's barrel is turned ~7 degrees off its stock - `yaw`
  // straightens it so it points where you aim.
  rifle: { rot: [0, H, 0], len: 0.95, yaw: 0.12 },
  pistol: { rot: [0, Math.PI, 0], len: 0.3 },
  revolver: { rot: [H, -H, 0], len: 0.36 },
  minigun: { rot: [0, H, 0], len: 0.8 },
  shotgun: { rot: [0, H, 0], len: 0.95 },
  awp: { rot: [0, -H, 0], len: 1.2 },
  // `drop`: small loose pieces left out, by where they sit in the model's
  // own coordinates. The flamethrower's little sight on top (a dark, shiny
  // glass pane in a solid frame on a base) covered the crosshair when aiming
  // (2026-10-12, "there's something on it when aiming but I really like
  // this model") - its three pieces go, the rest of the model stays.
  flamethrower: { rot: [0, Math.PI, 0], len: 0.9, drop: [[0, 0.294, -0.519], [0, 0.292, -0.516], [0, 0.273, -0.517]] },
  rocket: { rot: [0, -H, 0], len: 1.1 },
  // Its limbs and string are skinned to bones that only sit right once
  // its own animation has posed them (frame 0 = loaded and ready).
  crossbow: { rot: [0, H, 0], len: 0.8, pose: 0 },
  launcher: { rot: [0, Math.PI, 0], len: 0.75 },
  suppressedsmg: { rot: [0, Math.PI, 0], len: 0.7 },
  // The rail-gun model ships with no colors at all (one white material) -
  // painted gunmetal with a violet glow, the Void Ripper's look.
  voidripper: { rot: [0, 0, 0], len: 0.95, paint: { color: 0x2a2633, metalness: 0.75, roughness: 0.35, emissive: 0x5b2a99, emissiveIntensity: 0.12 } },
  gpmg: { rot: [0, -H, 0], len: 1.1 },
  tomahawk: { rot: [-H, 0, H], order: 'ZXY', len: 0.45, tilt: 0.9 },
}

const MODEL_CACHE = {}

// Clean, simple guns (2026-10-17, Gaymi: "same with the weapon can you make
// like that low ploy but stilll clean, clear and not blurry and simple with
// low lag"): each material's colour picture is shrunk to GUN_TEX_SIZE, cut
// down to GUN_COLORS flat colours (PixelClean.js) and drawn crisp (nearest
// filtering) - a 512px photo-like texture stretched over a gun filling half
// the screen is what looked blurry. Its bump, shine and metal pictures go
// too (flat values instead), so each gun is cheaper to draw.
const GUN_TEX_SIZE = 128
const GUN_COLORS = 8
function simplifyMaterials(scene) {
  const done = new Map()
  const textures = new Map()
  const draw = (img) => {
    const c = document.createElement('canvas')
    c.width = c.height = GUN_TEX_SIZE
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, GUN_TEX_SIZE, GUN_TEX_SIZE)
    return c
  }
  // Metal was lit by reflections (a light grey colour that reads dark and
  // shiny); without them it's darkened here instead, by how metal each
  // pixel is (glTF keeps that in the metal/rough picture's blue channel).
  const flat = (m) => {
    const tex = m.map
    if (!tex?.image) return tex
    const key = `${tex.uuid}:${m.metalnessMap?.uuid || ''}:${m.metalness}`
    if (textures.has(key)) return textures.get(key)
    const c = draw(tex.image)
    const ctx = c.getContext('2d', { willReadFrequently: true })
    const img = ctx.getImageData(0, 0, GUN_TEX_SIZE, GUN_TEX_SIZE)
    const metal = m.metalnessMap?.image && m.metalnessMap.channel === tex.channel ? draw(m.metalnessMap.image).getContext('2d', { willReadFrequently: true }).getImageData(0, 0, GUN_TEX_SIZE, GUN_TEX_SIZE).data : null
    for (let i = 0; i < img.data.length; i += 4) {
      const k = 1 - 0.55 * (metal ? metal[i + 2] / 255 : 1) * (m.metalness ?? 0)
      img.data[i] *= k
      img.data[i + 1] *= k
      img.data[i + 2] *= k
    }
    ctx.putImageData(img, 0, 0)
    cleanPixels(c, GUN_COLORS)
    const next = new THREE.CanvasTexture(c)
    for (const k of ['flipY', 'wrapS', 'wrapT', 'channel']) next[k] = tex[k]
    next.offset.copy(tex.offset)
    next.repeat.copy(tex.repeat)
    next.colorSpace = THREE.SRGBColorSpace
    next.magFilter = THREE.NearestFilter
    next.minFilter = THREE.LinearMipmapLinearFilter
    textures.set(key, next)
    return next
  }
  const one = (m) => {
    if (!m) return m
    if (done.has(m)) return done.get(m)
    const n = m.clone()
    n.map = flat(m)
    // A flat colour with no picture: darkened the same way.
    if (!m.map && n.color && m.metalness) n.color.multiplyScalar(1 - 0.55 * m.metalness)
    for (const key of ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap']) if (key in n) n[key] = null
    if ('roughness' in n) n.roughness = 0.65
    if ('metalness' in n) n.metalness = 0.1
    done.set(m, n)
    return n
  }
  scene.traverse((o) => {
    if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material)
  })
  // The big originals are never drawn now - let their memory go.
  for (const m of done.keys()) {
    for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap']) {
      m[key]?.image?.close?.()
      m[key]?.dispose()
    }
  }
}

// Loads every weapon model (main.js waits for this before building the
// game). A model that fails to load just leaves its weapon as a plain
// stand-in box (buildViewmodel) instead of stopping the game.
export function preloadWeaponModels() {
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  return Promise.all(Object.keys(WEAPON_MODELS).map(async (id) => {
    try {
      const gltf = await loader.loadAsync(`/models/weapons/${id}.glb`)
      if (!WEAPON_MODELS[id].paint) simplifyMaterials(gltf.scene)
      MODEL_CACHE[id] = gltf
    } catch (err) {
      console.warn(`Weapon model ${id} failed to load`, err)
    }
  }))
}

function placeholder() {
  const g = new THREE.Group()
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.6), new THREE.MeshStandardMaterial({ color: 0x333333 })))
  return g
}

// A copy of a built weapon to show somewhere else (Try Map's hands, the
// Inventory pictures, Inspect) - geometry and materials shared, skinned
// parts kept on their bones.
export function cloneViewmodel(vm) {
  return cloneSkinned(vm)
}

// Leaves out each small loose piece of a mesh (one not joined to anything
// else, a few triangles) whose middle is at one of `points` - changes the
// loaded model itself, so every copy of it goes without.
const DROP_NEAR = 0.02
const DROP_MAX_TRIANGLES = 24
function dropPieces(geometry, points) {
  const pos = geometry.attributes.position
  const index = geometry.index
  if (!pos || !index) return
  // Triangles touching the same spot (same position) belong together.
  const parent = new Int32Array(pos.count).map((_, i) => i)
  const find = (a) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]]
    return a
  }
  const at = new Map()
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`
    if (at.has(k)) parent[find(i)] = find(at.get(k))
    else at.set(k, i)
  }
  for (let t = 0; t < index.count; t += 3) {
    const a = find(index.getX(t))
    parent[find(index.getX(t + 1))] = a
    parent[find(index.getX(t + 2))] = a
  }
  const pieces = new Map()
  for (let t = 0; t < index.count; t += 3) {
    const root = find(index.getX(t))
    const piece = pieces.get(root) || { tris: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
    piece.tris++
    for (let k = 0; k < 3; k++) {
      const v = index.getX(t + k)
      const p = [pos.getX(v), pos.getY(v), pos.getZ(v)]
      for (let d = 0; d < 3; d++) {
        piece.min[d] = Math.min(piece.min[d], p[d])
        piece.max[d] = Math.max(piece.max[d], p[d])
      }
    }
    pieces.set(root, piece)
  }
  const drop = new Set()
  for (const [root, piece] of pieces) {
    if (piece.tris > DROP_MAX_TRIANGLES) continue
    const mid = piece.min.map((v, d) => (v + piece.max[d]) / 2)
    if (points.some((p) => Math.hypot(p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]) < DROP_NEAR)) drop.add(root)
  }
  if (!drop.size) return
  const kept = []
  for (let t = 0; t < index.count; t += 3) {
    if (drop.has(find(index.getX(t)))) continue
    kept.push(index.getX(t), index.getX(t + 1), index.getX(t + 2))
  }
  geometry.setIndex(kept)
  geometry.userData.droppedPieces = drop.size
}

export function buildViewmodel(weaponId) {
  const cfg = WEAPON_MODELS[weaponId]
  const source = MODEL_CACHE[weaponId]
  if (!cfg || !source) return placeholder()
  // SkeletonUtils' clone keeps skinned parts (the crossbow's limbs and
  // string) bound to their own bones - a plain clone(true) leaves them
  // floating where the bones' rest pose was.
  if (cfg.drop && !source.dropped) {
    source.dropped = true
    source.scene.traverse((o) => { if (o.isMesh) dropPieces(o.geometry, cfg.drop) })
  }
  const model = cloneSkinned(source.scene)
  if (cfg.pose !== undefined && source.animations[0]) {
    const mixer = new THREE.AnimationMixer(model)
    mixer.clipAction(source.animations[0]).play()
    // Left posed: stopping the action would put the bones back.
    mixer.setTime(cfg.pose)
  }
  model.rotation.set(cfg.rot[0], cfg.rot[1], cfg.rot[2], cfg.order || 'YXZ')
  if (cfg.yaw) model.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), cfg.yaw))
  model.traverse((o) => {
    if (!o.isMesh) return
    o.castShadow = false
    o.frustumCulled = false
    if (cfg.paint) o.material = new THREE.MeshStandardMaterial(cfg.paint)
  })
  const group = new THREE.Group()
  group.add(model)
  group.updateMatrixWorld(true)
  // Turns are quarter turns (plus a small `yaw`), so the box around the
  // turned model is (close to) exact.
  const box = new THREE.Box3().setFromObject(group)
  const size = box.getSize(new THREE.Vector3())
  const scale = cfg.len / Math.max(size.z, 1e-6)
  model.scale.setScalar(scale)
  const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale)
  model.position.set(-center.x, -center.y, -center.z - cfg.len * 0.3)
  if (cfg.tilt) {
    const tilted = new THREE.Group()
    tilted.rotation.x = cfg.tilt
    tilted.add(model)
    group.add(tilted)
  }
  return group
}
