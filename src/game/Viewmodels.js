import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

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
  rifle: { rot: [0, H, 0], len: 0.95 },
  pistol: { rot: [0, Math.PI, 0], len: 0.3 },
  revolver: { rot: [H, -H, 0], len: 0.36 },
  minigun: { rot: [0, H, 0], len: 0.8 },
  shotgun: { rot: [0, H, 0], len: 0.95 },
  awp: { rot: [0, -H, 0], len: 1.2 },
  flamethrower: { rot: [0, Math.PI, 0], len: 0.9 },
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

// Loads every weapon model (main.js waits for this before building the
// game). A model that fails to load just leaves its weapon as a plain
// stand-in box (buildViewmodel) instead of stopping the game.
export function preloadWeaponModels() {
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  return Promise.all(Object.keys(WEAPON_MODELS).map(async (id) => {
    try {
      MODEL_CACHE[id] = await loader.loadAsync(`/models/weapons/${id}.glb`)
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

export function buildViewmodel(weaponId) {
  const cfg = WEAPON_MODELS[weaponId]
  const source = MODEL_CACHE[weaponId]
  if (!cfg || !source) return placeholder()
  // SkeletonUtils' clone keeps skinned parts (the crossbow's limbs and
  // string) bound to their own bones - a plain clone(true) leaves them
  // floating where the bones' rest pose was.
  const model = cloneSkinned(source.scene)
  if (cfg.pose !== undefined && source.animations[0]) {
    const mixer = new THREE.AnimationMixer(model)
    mixer.clipAction(source.animations[0]).play()
    // Left posed: stopping the action would put the bones back.
    mixer.setTime(cfg.pose)
  }
  model.rotation.set(cfg.rot[0], cfg.rot[1], cfg.rot[2], cfg.order || 'YXZ')
  model.traverse((o) => {
    if (!o.isMesh) return
    o.castShadow = false
    o.frustumCulled = false
    if (cfg.paint) o.material = new THREE.MeshStandardMaterial(cfg.paint)
  })
  const group = new THREE.Group()
  group.add(model)
  group.updateMatrixWorld(true)
  // Turns are quarter turns, so the box around the turned model is exact.
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
