import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { flatMaterial, flattenedClone } from './QualitySettings.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// Phase 4 of the 3D asset overhaul (see 3D_ASSET_OVERHAUL.md) - real rigged
// GLB weapon viewmodels (Quaternius "Ultimate Guns Pack" for firearms,
// 3dmodelscc0's CC0 melee pack for melee) behind a flag per weapon, same
// pattern as Zombie.js's USE_GLB_ZOMBIES. Started with just the pistol as
// the plan's own "quality gate" before committing to the other 10 - now
// extended to the rest of the firearms lane (rifle/shotgun/awp/glock18).
// Every gun below is a plain static mesh (no skeleton), same pack, same
// build-time rotate+scale correction (asset-source/build-guns.py) - so one
// generic preload/build pair covers all of them instead of repeating the
// pattern per gun.
const GUN_MODEL_CACHE = {}

function preloadGunModel(id, url) {
  return async () => {
    try {
      const loader = new GLTFLoader()
      // Needed for any GLB run through gltf-transform's meshopt geometry
      // compression (see asset-source's build scripts + 3D_ASSET_OVERHAUL.md
      // §2.6) - harmless no-op for GLBs that were never meshopt-compressed,
      // so this is safe to set unconditionally for every gun.
      loader.setMeshoptDecoder(MeshoptDecoder)
      const gltf = await loader.loadAsync(url)
      GUN_MODEL_CACHE[id] = gltf.scene
    } catch (err) {
      console.warn(`GLB ${id} viewmodel failed to load, falling back to procedural ${id}`, err)
    }
  }
}

export const USE_GLB_PISTOL = true
export const preloadPistolViewmodel = preloadGunModel('pistol', '/models/weapons/pistol.glb')
export const USE_GLB_RIFLE = true
export const preloadRifleViewmodel = preloadGunModel('rifle', '/models/weapons/rifle.glb')
export const USE_GLB_SHOTGUN = true
export const preloadShotgunViewmodel = preloadGunModel('shotgun', '/models/weapons/shotgun.glb')
export const USE_GLB_AWP = true
export const preloadAwpViewmodel = preloadGunModel('awp', '/models/weapons/awp.glb')
export const USE_GLB_GLOCK18 = true
export const preloadGlock18Viewmodel = preloadGunModel('glock18', '/models/weapons/glock18.glb')
export const USE_GLB_SUPPRESSEDSMG = true
export const preloadSuppressedSmgViewmodel = preloadGunModel('suppressedsmg', '/models/weapons/suppressedsmg.glb')
// First of the "never had real geometry at all" lane (see
// asset-source/build-grenadelauncher.py) - built from scratch in Blender
// at the exact same dimensions as buildGrenadeLauncherProcedural below
// (not sourced from the Quaternius pack, which is modern firearms only
// and has nothing shaped like this), with the same wear-texture bake
// pass proven on the firearms lane.
export const USE_GLB_GRENADELAUNCHER = true
// No longer loaded (2026-10-01): the Grenade Launcher is now the detailed
// procedural six-shot build below, which replaced this boxy GLB.
export const preloadGrenadeLauncherViewmodel = async () => {}

// Melee lane (3dmodelscc0's CC0 pack, asset-source/build-melee.py) - reuses
// the same generic cache/loader as the guns even though the function name
// says "gun" (it's just "load a GLB into a keyed cache", not gun-specific).
// Unlike the guns, these ship real PBR textures (baked into the GLB at
// build time), not flat colors.
// Switched off (was true) so the redesigned procedural knife
// (buildQuickMeleeKnifeModelProcedural) actually renders - the GLB asset's
// own mesh geometry can't be reshaped from code, and "make it sharper" is
// a real shape redesign, not just a re-tint.
export const USE_GLB_KNIFE = false
export const preloadKnifeViewmodel = preloadGunModel('knife', '/models/weapons/knife.glb')
export const USE_GLB_BAT = true
export const preloadBatViewmodel = preloadGunModel('bat', '/models/weapons/bat.glb')
export const USE_GLB_MACHETE = true
export const preloadMacheteViewmodel = preloadGunModel('machete', '/models/weapons/machete.glb')
// The 4th melee variant is a "uvbaton" (glowing UV-lens tip, not a plain
// police baton - see buildUvBatonModel) - this pack's real PoliceBaton
// model replaces the shaft/handle, but the emissive lens tip stays a
// small procedural attachment at the model's own "Tip" empty, since no
// realistic pack has a sci-fi lit baton.
export const USE_GLB_BATON = true
export const preloadUvBatonViewmodel = preloadGunModel('baton', '/models/weapons/baton.glb')

// Shared builder for any single-mesh GLB gun (no hands attached here - the
// caller adds those via attachHandToGrip, since a couple of guns need a
// second off-hand grip the generic helper doesn't know about). tintMatName
// is that gun's main body material slot, cloned per gun.
function buildGunFromGLB(cache, tintMatName) {
  const g = new THREE.Group()
  const cloned = cache.clone(true)
  cloned.traverse((child) => {
    if (!child.isMesh) return
    child.castShadow = false
    // Every material in this pack's source GLBs except the one designated
    // tint slot exports at opacity 0 (asset-source/build-guns.py's Blender
    // export step, not something this code ever set) - most of every gun
    // was rendering invisible, leaving only the tinted part (usually
    // "Metal") visible. Force full opacity on every material here rather
    // than just the one this function already touches for tinting.
    child.material.opacity = 1
    child.material.transparent = false
    // Every GLB gun material ships completely flat/untextured from the
    // source pack - same shared brushed-metal/scratch detail texture the
    // procedural guns' METAL/DARK_METAL/GRIP/WOOD materials use (see
    // getGunDetailTexture's own comment), applied here so it covers every
    // material slot on every real gun model, not just the tinted one.
    // Guarded so a material shared across multiple spawned instances of
    // the same gun (every slot except tintMatName isn't cloned per-spawn)
    // only gets this set once rather than redundantly on every spawn.
    if (!child.material.map) child.material.map = getGunDetailTexture()
    if (child.material.name === tintMatName) {
      child.material = flattenedClone(child.material)
    }
  })
  g.add(cloned)
  return g
}

// Shared gun-surface detail texture - every weapon material in this file
// (GLB and procedural alike) is flat/untextured out of the box, same
// situation Zombie.js's skin was in before its own detail-texture pass
// (see that file's getZombieSkinTexture comment for the full reasoning).
// Drawn near-white so it multiplies against whatever color/tint a given
// material already has rather than replacing it - brushed-metal streaks
// plus scattered scratches, both lightened (not darkened) for contrast,
// since a plain negative delta crushes toward black in this rendering
// pipeline (confirmed the hard way on the ladder texture in Build Mode).
function _buildGunDetailTexture() {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#e9e9e6'
  ctx.fillRect(0, 0, size, size)
  // Brushed-metal streaks - fine horizontal lines, low opacity.
  for (let y = 0; y < size; y += 2) {
    const shade = 200 + Math.random() * 55
    ctx.strokeStyle = `rgba(${shade},${shade},${shade},${0.04 + Math.random() * 0.05})`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, y + (Math.random() - 0.5) * 2)
    ctx.lineTo(size, y + (Math.random() - 0.5) * 2)
    ctx.stroke()
  }
  // Scratches - short, angled, lighter than the base so they catch like
  // real scuffed metal instead of reading as dirt.
  for (let i = 0; i < 45; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.08 + Math.random() * 0.14})`
    ctx.lineWidth = 0.8 + Math.random() * 0.8
    const x = Math.random() * size
    const y = Math.random() * size
    const len = 8 + Math.random() * 22
    const ang = Math.random() * Math.PI
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len)
    ctx.stroke()
  }
  // Sparse edge/panel wear - soft, very low-opacity dark patches, blended
  // rather than solid-filled so nothing crushes to black.
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = `rgba(40,38,34,${0.05 + Math.random() * 0.07})`
    const r = size * (0.015 + Math.random() * 0.03)
    ctx.beginPath()
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2)
    ctx.fill()
  }
  const imgData = ctx.getImageData(0, 0, size, size)
  const d = imgData.data
  for (let i = 0; i < d.length; i += 4) {
    const jitter = (Math.random() - 0.5) * 10
    d[i] = Math.max(0, Math.min(255, d[i] + jitter))
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + jitter))
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + jitter))
  }
  ctx.putImageData(imgData, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(2, 2)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

let _gunDetailTexture = null
function getGunDetailTexture() {
  if (!_gunDetailTexture) _gunDetailTexture = _buildGunDetailTexture()
  return _gunDetailTexture
}

const METAL = flatMaterial({ color: 0x2b2b2d, roughness: 0.4, metalness: 0.7, map: getGunDetailTexture() })
const DARK_METAL = flatMaterial({ color: 0x1a1a1c, roughness: 0.5, metalness: 0.6, map: getGunDetailTexture() })
const GRIP = flatMaterial({ color: 0x2a1e14, roughness: 0.9, map: getGunDetailTexture() })
const WOOD = flatMaterial({ color: 0x4a3018, roughness: 0.8, map: getGunDetailTexture() })

const SKIN = flatMaterial({ color: 0xc99a72, roughness: 0.88 })
const SKIN_SHADE = flatMaterial({ color: 0xb0805a, roughness: 0.88 })
const NAIL = flatMaterial({ color: 0xe8d9c6, roughness: 0.5 })

// A single curling finger: a proximal segment plus a hinged distal segment,
// so it can wrap over a grip rather than reading as a flat mitten stub.
function buildFinger(length1, length2, thickness, curl1, curl2) {
  const root = new THREE.Group()

  const proximal = new THREE.Mesh(new THREE.BoxGeometry(thickness, length1, thickness), SKIN)
  proximal.position.y = -length1 / 2
  root.add(proximal)
  root.rotation.x = curl1

  const knuckle = new THREE.Group()
  knuckle.position.y = -length1
  root.add(knuckle)
  knuckle.rotation.x = curl2

  const distal = new THREE.Mesh(new THREE.BoxGeometry(thickness * 0.85, length2, thickness * 0.85), SKIN_SHADE)
  distal.position.y = -length2 / 2
  knuckle.add(distal)

  const nail = new THREE.Mesh(new THREE.BoxGeometry(thickness * 0.6, length2 * 0.4, thickness * 0.15), NAIL)
  nail.position.set(0, -length2 * 0.65, thickness * 0.42)
  knuckle.add(nail)

  return root
}

// Low-poly right hand gripping a vertical handle: a palm block against the
// back of the grip, four fingers curling over the front, thumb wrapping the
// side. Built with its own "grip axis" running through local Y so it can be
// dropped onto any weapon's grip mesh by copying that mesh's transform.
function buildHand() {
  const hand = new THREE.Group()

  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.095, 0.045), SKIN)
  hand.add(palm)

  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.07, 12), SKIN_SHADE)
  wrist.rotation.x = Math.PI / 2
  wrist.position.set(0, 0.075, 0.012)
  hand.add(wrist)

  const knuckleRow = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.03), SKIN)
  knuckleRow.position.set(0, -0.045, 0.028)
  hand.add(knuckleRow)

  const fingerXs = [-0.027, -0.009, 0.009, 0.027]
  const fingerLens = [0.044, 0.05, 0.048, 0.04]
  for (let i = 0; i < fingerXs.length; i++) {
    const finger = buildFinger(fingerLens[i], 0.032, 0.016, -1.4, 1.7)
    finger.position.set(fingerXs[i], -0.052, 0.035)
    hand.add(finger)
  }

  const thumb = buildFinger(0.045, 0.03, 0.018, -0.5, 1.1)
  thumb.position.set(-0.045, -0.005, 0.01)
  thumb.rotation.z = 0.9
  hand.add(thumb)

  hand.traverse((o) => { if (o.isMesh) o.castShadow = false })
  // Lets the Inventory > Weapons pictures leave the hands out.
  hand.userData.isHand = true
  return hand
}

// Copies a grip mesh's own transform so the hand lands right on top of it,
// with a small inward nudge so the palm reads as pressed against the grip
// rather than floating just in front of it.
function attachHandToGrip(parent, grip, nudge = 0.01) {
  const hand = buildHand()
  hand.position.copy(grip.position)
  hand.rotation.copy(grip.rotation)
  hand.translateY(nudge)
  parent.add(hand)
  // Hidden outright, all the time - not just during ADS. This prop was the
  // "big thing" blocking the view while aiming (see WeaponSystem's earlier
  // fix comment, now removed since it's redundant with this), and at the
  // hip it read as an oversized, distractingly pale/yellow-tan fist rather
  // than a convincing hand - direct user feedback after seeing it in-game
  // both ways. Left in the scene graph (not skipped) rather than removed
  // from each build function, so re-enabling it later is a one-line flip.
  hand.visible = false
  parent.userData.hand = hand
  return hand
}

function buildPistol() {
  if (USE_GLB_PISTOL && GUN_MODEL_CACHE.pistol) {
    const g = buildGunFromGLB(GUN_MODEL_CACHE.pistol, 'Metal')
    const grip = g.children[0].getObjectByName('Grip')
    if (grip) attachHandToGrip(g, grip)
    return g
  }
  return buildPistolProcedural()
}

function buildPistolProcedural() {
  const g = new THREE.Group()

  const slideMat = METAL
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.09, 0.26), slideMat)
  slide.position.set(0, 0.04, 0)
  g.add(slide)

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.08, 12), DARK_METAL)
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(0, 0.045, -0.17)
  g.add(barrel)

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.16, 0.09), GRIP)
  grip.position.set(0, -0.07, 0.07)
  grip.rotation.x = -0.18
  g.add(grip)

  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), DARK_METAL)
  trigger.position.set(0, -0.01, 0.02)
  g.add(trigger)

  attachHandToGrip(g, grip)

  return g
}

const UV_LENS = flatMaterial({ color: 0x2a0a44, emissive: 0x8b2fe0, emissiveIntensity: 2.4 })

function buildRifle() {
  if (USE_GLB_RIFLE && GUN_MODEL_CACHE.rifle) {
    const g = buildGunFromGLB(GUN_MODEL_CACHE.rifle, 'Metal')
    const root = g.children[0]
    const grip = root.getObjectByName('Grip')
    if (grip) attachHandToGrip(g, grip)
    const foregrip = root.getObjectByName('Foregrip')
    if (foregrip) {
      const foreHand = buildHand()
      foreHand.position.copy(foregrip.position)
      foreHand.rotation.x = -0.15
      foreHand.rotation.z = Math.PI
      g.add(foreHand)
    }
    return g
  }
  return buildRifleProcedural()
}

function buildRifleProcedural() {
  const g = new THREE.Group()

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.1, 0.48), METAL)
  body.position.set(0, 0.02, -0.05)
  g.add(body)

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.3, 12), DARK_METAL)
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(0, 0.03, -0.5)
  g.add(barrel)

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.22), WOOD)
  stock.position.set(0, -0.01, 0.28)
  g.add(stock)

  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.07), DARK_METAL)
  mag.position.set(0, -0.13, -0.08)
  mag.rotation.x = 0.22
  g.add(mag)

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.14, 0.07), GRIP)
  grip.position.set(0, -0.09, 0.1)
  grip.rotation.x = -0.25
  g.add(grip)

  const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.06), GRIP)
  foregrip.position.set(0, -0.08, -0.32)
  g.add(foregrip)

  attachHandToGrip(g, grip)

  const foreHand = buildHand()
  foreHand.position.copy(foregrip.position)
  foreHand.rotation.x = -0.15
  foreHand.rotation.z = Math.PI
  g.add(foreHand)

  return g
}

// Shared builder for any single-mesh GLB melee weapon - clone +
// castShadow off + hand attached at the model's own Grip empty.
function buildMeleeFromGLB(cache) {
  const g = new THREE.Group()
  const cloned = cache.clone(true)
  cloned.traverse((child) => {
    if (!child.isMesh) return
    child.castShadow = false
    // Same opacity-0-on-export quirk buildGunFromGLB works around - force
    // full opacity on every material here.
    child.material.opacity = 1
    child.material.transparent = false
  })
  g.add(cloned)
  const grip = cloned.getObjectByName('Grip')
  if (grip) {
    const hand = buildHand()
    hand.position.copy(grip.position)
    hand.rotation.copy(grip.rotation)
    hand.rotation.x += Math.PI / 2
    g.add(hand)
  }
  return g
}

// The one knife model in the game - used both for the melee slot's knife
// variant and for quick-melee (see WeaponSystem._quickMelee), so equipping
// "knife" and panic-stabbing with it are the same weapon, not two different
// knives with different stats/looks. Sharper/more angular than a plain
// kitchen knife on purpose: a tanto-style tip and a serrated spine.
export function buildQuickMeleeKnifeModel() {
  if (USE_GLB_KNIFE && GUN_MODEL_CACHE.knife) {
    return buildMeleeFromGLB(GUN_MODEL_CACHE.knife)
  }
  return buildQuickMeleeKnifeModelProcedural()
}

// Redesigned for a genuinely sharp, tapered profile (a flat box + a cone
// tip, the previous version, read as blunt/toy-like up close) - the blade
// is one continuous extruded 2D outline (drop-point silhouette: a slight
// concave swage near the spine, straight taper down to a real point)
// instead of two separate primitives glued together.
function buildQuickMeleeKnifeModelProcedural() {
  const g = new THREE.Group()

  const bladeMat = flatMaterial({ color: 0x9aa0a6, roughness: 0.1, metalness: 1 })
  const tacticalGrip = flatMaterial({ color: 0x14140f, roughness: 0.85 })

  const bladeShape = new THREE.Shape()
  bladeShape.moveTo(-0.017, 0) // spine, base
  bladeShape.lineTo(0.018, -0.01) // edge, base (slightly forward of the spine - a real cutting edge starts just ahead of the guard)
  bladeShape.lineTo(0.015, -0.2) // edge taper
  bladeShape.lineTo(0, -0.3) // point
  bladeShape.lineTo(-0.013, -0.21) // spine taper (swage) back toward the point
  bladeShape.lineTo(-0.017, 0)
  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.005, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 2 })
  bladeGeo.translate(0, 0, -0.0025) // center the thin extrusion on its own axis instead of offset to one side
  const blade = new THREE.Mesh(bladeGeo, bladeMat)
  blade.rotation.x = Math.PI / 2
  g.add(blade)

  // Serrated spine - a row of small teeth along the back (non-cutting)
  // edge, the main visual tell that this isn't the plain melee-slot knife.
  const toothCount = 5
  for (let i = 0; i < toothCount; i++) {
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.02, 3), bladeMat)
    tooth.rotation.x = Math.PI / 2
    tooth.rotation.z = Math.PI / 2
    tooth.position.set(-0.015, 0, -0.04 - i * 0.034)
    g.add(tooth)
  }

  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.022, 0.018), DARK_METAL)
  guard.rotation.z = Math.PI / 4
  guard.position.set(0, 0, -0.005)
  g.add(guard)

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.16, 8), tacticalGrip)
  handle.rotation.x = Math.PI / 2
  handle.position.set(0, 0, 0.08)
  g.add(handle)

  const knifeHand = buildHand()
  knifeHand.position.copy(handle.position)
  knifeHand.rotation.x = Math.PI / 2
  g.add(knifeHand)

  return g
}

function buildBatModel() {
  if (USE_GLB_BAT && GUN_MODEL_CACHE.bat) {
    return buildMeleeFromGLB(GUN_MODEL_CACHE.bat)
  }
  return buildBatModelProcedural()
}

function buildBatModelProcedural() {
  const g = new THREE.Group()
  const woodMat = flatMaterial({ color: 0x8a6a3a, roughness: 0.7 })

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.022, 0.42, 10), woodMat)
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(0, 0, -0.18)
  g.add(barrel)

  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.14, 12), DARK_METAL)
  wrap.rotation.x = Math.PI / 2
  wrap.position.set(0, 0, 0.1)
  g.add(wrap)

  const batHand = buildHand()
  batHand.position.set(0, 0, 0.1)
  batHand.rotation.x = Math.PI / 2
  g.add(batHand)

  return g
}

function buildMacheteModel() {
  if (USE_GLB_MACHETE && GUN_MODEL_CACHE.machete) {
    return buildMeleeFromGLB(GUN_MODEL_CACHE.machete)
  }
  return buildMacheteModelProcedural()
}

function buildMacheteModelProcedural() {
  const g = new THREE.Group()
  const bladeMat = flatMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.8 })

  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.014, 0.34), bladeMat)
  blade.position.set(0, 0, -0.2)
  g.add(blade)

  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.08, 3), bladeMat)
  tip.rotation.x = -Math.PI / 2
  tip.rotation.z = Math.PI / 2
  tip.position.set(0, 0, -0.37)
  g.add(tip)

  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.025, 0.02), DARK_METAL)
  guard.position.set(0, 0, -0.03)
  g.add(guard)

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.16, 12), GRIP)
  handle.rotation.x = Math.PI / 2
  handle.position.set(0, 0, 0.06)
  g.add(handle)

  const macheteHand = buildHand()
  macheteHand.position.copy(handle.position)
  macheteHand.rotation.x = Math.PI / 2
  g.add(macheteHand)

  return g
}

// Real PoliceBaton model for the shaft/handle, but the glowing UV lens tip
// stays a small procedural attachment at the model's own "Tip" empty - no
// realistic pack has a sci-fi lit baton, and this is the one visual detail
// that actually matters for this weapon (see the module doc comment near
// preloadUvBatonViewmodel).
function buildUvBatonModel() {
  if (USE_GLB_BATON && GUN_MODEL_CACHE.baton) {
    const g = buildMeleeFromGLB(GUN_MODEL_CACHE.baton)
    const root = g.children[0]
    const tipAnchor = root.getObjectByName('Tip')
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.12, 10), UV_LENS)
    tip.rotation.x = Math.PI / 2
    if (tipAnchor) {
      tip.position.copy(tipAnchor.position)
    } else {
      tip.position.set(0, 0, -0.32)
    }
    g.add(tip)
    return g
  }
  return buildUvBatonModelProcedural()
}

function buildUvBatonModelProcedural() {
  const g = new THREE.Group()
  const shaftMat = flatMaterial({ color: 0x2b2b2d, roughness: 0.5, metalness: 0.5 })

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.3, 10), shaftMat)
  shaft.rotation.x = Math.PI / 2
  shaft.position.set(0, 0, -0.14)
  g.add(shaft)

  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.12, 10), UV_LENS)
  tip.rotation.x = Math.PI / 2
  tip.position.set(0, 0, -0.32)
  g.add(tip)

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.16, 12), GRIP)
  handle.rotation.x = Math.PI / 2
  handle.position.set(0, 0, 0.06)
  g.add(handle)

  const batonHand = buildHand()
  batonHand.position.copy(handle.position)
  batonHand.rotation.x = Math.PI / 2
  g.add(batonHand)

  return g
}

function buildFireAxeModelProcedural() {
  const g = new THREE.Group()
  const woodMat = flatMaterial({ color: 0x7a5230, roughness: 0.7 })
  const headMat = flatMaterial({ color: 0x8a8f96, roughness: 0.35, metalness: 0.8 })

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.42, 10), woodMat)
  handle.rotation.x = Math.PI / 2
  handle.position.set(0, 0, -0.08)
  g.add(handle)

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.1), headMat)
  head.position.set(0, 0.06, -0.28)
  g.add(head)

  const edge = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.05, 4), headMat)
  edge.rotation.z = Math.PI / 2
  edge.rotation.y = Math.PI / 4
  edge.position.set(0, 0.06, -0.34)
  g.add(edge)

  const axeHand = buildHand()
  axeHand.position.set(0, 0, 0.12)
  axeHand.rotation.x = Math.PI / 2
  g.add(axeHand)

  return g
}

function buildSledgehammerModelProcedural() {
  const g = new THREE.Group()
  const woodMat = flatMaterial({ color: 0x6b4a28, roughness: 0.7 })
  const headMat = flatMaterial({ color: 0x4a4d52, roughness: 0.5, metalness: 0.6 })

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.028, 0.4, 10), woodMat)
  handle.rotation.x = Math.PI / 2
  handle.position.set(0, 0, -0.05)
  g.add(handle)

  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.22, 12), headMat)
  head.rotation.z = Math.PI / 2
  head.position.set(0, 0, -0.26)
  g.add(head)

  const hammerHand = buildHand()
  hammerHand.position.set(0, 0, 0.14)
  hammerHand.rotation.x = Math.PI / 2
  g.add(hammerHand)

  return g
}

// All melee variants are pre-built inside one group, toggling visibility
// instead of adding new weapon slots/keys.
function buildMelee() {
  const g = new THREE.Group()

  const knife = buildQuickMeleeKnifeModel()
  const bat = buildBatModel()
  const machete = buildMacheteModel()
  const uvbaton = buildUvBatonModel()
  const fireaxe = buildFireAxeModelProcedural()
  const sledgehammer = buildSledgehammerModelProcedural()
  bat.visible = false
  machete.visible = false
  uvbaton.visible = false
  fireaxe.visible = false
  sledgehammer.visible = false

  g.add(knife, bat, machete, uvbaton, fireaxe, sledgehammer)
  g.userData.meleeVariants = { knife, bat, machete, uvbaton, fireaxe, sledgehammer }

  // Right hand now (was the left, offset to roughly -0.36 world x) - per
  // request, matching every gun's own convention of no group-level offset
  // at all and relying on the shared VIEWMODEL_BASE (WeaponSystem.js) for
  // right-hand placement. A small residual local offset/lean, not zero,
  // so it doesn't sit dead-center of the screen like a gun's barrel would -
  // a knife held for a stab reads more natural slightly off-axis.
  g.position.set(0.03, 0.01, -0.05)
  g.rotation.set(-0.05, -0.15, 0.08)

  return g
}

// Bare gun geometry only, no hands - reused for both the FPS viewmodel and
// the world-space floating pickup, which shouldn't carry disembodied hands.
function buildMinigun() {
  const g = buildMinigunModel()
  const { grip, handleBar, barrelCluster } = g.userData

  attachHandToGrip(g, grip)

  // Support hand wraps the horizontal handle bar, so its grip axis (local Y)
  // needs to run along world X instead of world Y.
  const barHand = buildHand()
  barHand.position.set(-0.06, handleBar.position.y, handleBar.position.z)
  barHand.rotation.z = Math.PI / 2
  barHand.visible = false // see addForeHand
  g.add(barHand)

  g.userData.barrelCluster = barrelCluster
  return g
}

// Glock 18 - a chunkier M1911 with an extended mag and a vented compensator
// at the muzzle, reading as a machine pistol rather than a duplicate pistol.
function buildGlock18() {
  if (USE_GLB_GLOCK18 && GUN_MODEL_CACHE.glock18) {
    const g = buildGunFromGLB(GUN_MODEL_CACHE.glock18, 'Metal')
    const grip = g.children[0].getObjectByName('Grip')
    if (grip) attachHandToGrip(g, grip)
    return g
  }
  return buildGlock18Procedural()
}

function buildGlock18Procedural() {
  const g = new THREE.Group()

  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.095, 0.24), METAL)
  slide.position.set(0, 0.04, 0)
  g.add(slide)

  const compensator = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.05), DARK_METAL)
  compensator.position.set(0, 0.045, -0.15)
  g.add(compensator)

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.05, 12), DARK_METAL)
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(0, 0.045, -0.19)
  g.add(barrel)

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.17, 0.09), GRIP)
  grip.position.set(0, -0.075, 0.07)
  grip.rotation.x = -0.18
  g.add(grip)

  // Extended magazine sticking out below the grip - the "this is a machine
  // pistol, not a sidearm" tell.
  const extMag = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.05), DARK_METAL)
  extMag.position.set(0, -0.18, 0.09)
  extMag.rotation.x = -0.18
  g.add(extMag)

  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), DARK_METAL)
  trigger.position.set(0, -0.01, 0.02)
  g.add(trigger)

  attachHandToGrip(g, grip)

  return g
}

// Weatie - pump-action shotgun: wide barrel, a tube magazine slung under it,
// and a cylindrical pump foregrip instead of the rifle's boxy one.
function buildShotgun() {
  if (USE_GLB_SHOTGUN && GUN_MODEL_CACHE.shotgun) {
    const g = buildGunFromGLB(GUN_MODEL_CACHE.shotgun, 'DarkMetal')
    const root = g.children[0]
    const grip = root.getObjectByName('Grip')
    if (grip) attachHandToGrip(g, grip)
    const foregrip = root.getObjectByName('Foregrip')
    if (foregrip) {
      const pumpHand = buildHand()
      pumpHand.position.copy(foregrip.position)
      pumpHand.rotation.x = -0.15
      pumpHand.rotation.z = Math.PI
      g.add(pumpHand)
    }
    return g
  }
  return buildShotgunProcedural()
}

function buildShotgunProcedural() {
  const g = new THREE.Group()

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.1, 0.22), DARK_METAL)
  receiver.position.set(0, 0.02, 0.06)
  g.add(receiver)

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.42, 12), METAL)
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(0, 0.035, -0.24)
  g.add(barrel)

  const tubeMag = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.34, 10), DARK_METAL)
  tubeMag.rotation.x = Math.PI / 2
  tubeMag.position.set(0, -0.01, -0.2)
  g.add(tubeMag)

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.2), WOOD)
  stock.position.set(0, -0.01, 0.28)
  g.add(stock)

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.14, 0.07), GRIP)
  grip.position.set(0, -0.09, 0.11)
  grip.rotation.x = -0.25
  g.add(grip)

  // Pump foregrip - a cylinder wrapping the tube mag rather than a boxy
  // foregrip, the main silhouette cue that reads as "pump shotgun".
  const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.09, 10), WOOD)
  pump.rotation.x = Math.PI / 2
  pump.position.set(0, -0.01, -0.14)
  g.add(pump)

  attachHandToGrip(g, grip)

  const pumpHand = buildHand()
  pumpHand.position.copy(pump.position)
  pumpHand.rotation.x = -0.15
  pumpHand.rotation.z = Math.PI
  g.add(pumpHand)

  return g
}

// AWP - long thin bolt-action barrel, a raised scope tube on top (the main
// visual tell versus the rifle/other long guns), and a boxy stock.
function buildAwp() {
  if (USE_GLB_AWP && GUN_MODEL_CACHE.awp) {
    // This particular gun model has no "Metal" slot (materials are Green/
    // Black/DarkMetal/Glass/Grey) - "Green" is the main body, confirmed via
    // Playwright (the generic 'Metal' guess silently tinted nothing).
    const g = buildGunFromGLB(GUN_MODEL_CACHE.awp, 'Green')
    const root = g.children[0]
    const grip = root.getObjectByName('Grip')
    if (grip) attachHandToGrip(g, grip)
    const foregrip = root.getObjectByName('Foregrip')
    if (foregrip) {
      const foreHand = buildHand()
      foreHand.position.copy(foregrip.position)
      g.add(foreHand)
    }
    return g
  }
  return buildAwpProcedural()
}

function buildAwpProcedural() {
  const g = new THREE.Group()

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.5), METAL)
  body.position.set(0, 0.02, -0.02)
  g.add(body)

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.38, 12), DARK_METAL)
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(0, 0.025, -0.55)
  g.add(barrel)

  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.28, 12), DARK_METAL)
  scope.rotation.x = Math.PI / 2
  scope.position.set(0, 0.1, -0.1)
  g.add(scope)
  const scopeLensFront = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.012, 12), UV_LENS)
  scopeLensFront.rotation.x = Math.PI / 2
  scopeLensFront.position.set(0, 0.1, -0.24)
  g.add(scopeLensFront)

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.11, 0.24), WOOD)
  stock.position.set(0, -0.01, 0.32)
  g.add(stock)

  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.16, 0.06), DARK_METAL)
  mag.position.set(0, -0.11, -0.03)
  mag.rotation.x = 0.18
  g.add(mag)

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.14, 0.07), GRIP)
  grip.position.set(0, -0.09, 0.14)
  grip.rotation.x = -0.25
  g.add(grip)

  const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.06), GRIP)
  foregrip.position.set(0, -0.075, -0.34)
  g.add(foregrip)

  attachHandToGrip(g, grip)

  const foreHand = buildHand()
  foreHand.position.copy(foregrip.position)
  foreHand.rotation.x = -0.15
  foreHand.rotation.z = Math.PI
  g.add(foreHand)

  return g
}

const FLAME_GLOW = flatMaterial({ color: 0x3a1a0a, emissive: 0xff7a1a, emissiveIntensity: 2.2 })
const TOOL_ORANGE = flatMaterial({ color: 0xd8600f, roughness: 0.6 })
const VOID_GLOW = flatMaterial({ color: 0x2a0a44, emissive: 0x9b5cff, emissiveIntensity: 2.4 })

// ---- Detailed procedural guns (2026-10-01) --------------------------------
// The 8 weapons with no real model (Rocket Launcher, Minigun, Flamethrower,
// Crossbow, Grenade Launcher, Nail Gun, Harpoon Gun, Void Ripper) used to be
// a handful of plain boxes each. They're now built from real side-profile
// cut-outs (ExtrudeGeometry with bevelled edges) plus lathed/tubed details,
// and every part sharing a material is merged into ONE mesh (PartSet), so a
// gun is ~4-8 draw calls no matter how many parts it has - see
// docs/PERFORMANCE.md on why object count is what costs frames here.
// Grips are invisible anchors (Object3D) at the grip's position/tilt, since
// attachHandToGrip only reads position/rotation.
const OLIVE = flatMaterial({ color: 0x4b5a2c, roughness: 0.75, metalness: 0.2, map: getGunDetailTexture() })
const RUBBER = flatMaterial({ color: 0x141414, roughness: 0.95 })
const BRASS = flatMaterial({ color: 0xb08a3a, roughness: 0.35, metalness: 0.85 })
const CHROME = flatMaterial({ color: 0xa8adb3, roughness: 0.22, metalness: 0.9 })
const GLASS = flatMaterial({ color: 0x1d3346, roughness: 0.08, metalness: 0.4, emissive: 0x0b3a5c, emissiveIntensity: 0.5 })
const RED_PAINT = flatMaterial({ color: 0x9a1c18, roughness: 0.55, metalness: 0.2 })
const STEEL = flatMaterial({ color: 0x55595f, roughness: 0.35, metalness: 0.85, map: getGunDetailTexture() })
const VOID_TRIM = flatMaterial({ color: 0x1a0f2a, roughness: 0.3, metalness: 0.8, emissive: 0x6a2cff, emissiveIntensity: 0.9 })

const _tmpMatrix = new THREE.Matrix4()
const _tmpQuat = new THREE.Quaternion()
const _tmpEuler = new THREE.Euler()
const _tmpPos = new THREE.Vector3()
const _tmpScale = new THREE.Vector3()

class PartSet {
  constructor() { this.byMat = new Map() }

  add(mat, geo, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
    const g = geo.index ? geo.toNonIndexed() : geo
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name)
    _tmpMatrix.compose(_tmpPos.set(...pos), _tmpQuat.setFromEuler(_tmpEuler.set(...rot)), _tmpScale.set(...scale))
    g.applyMatrix4(_tmpMatrix)
    if (!this.byMat.has(mat)) this.byMat.set(mat, [])
    this.byMat.get(mat).push(g)
    return this
  }

  build(group = new THREE.Group()) {
    for (const [mat, list] of this.byMat) {
      const merged = mergeGeometries(list, false)
      for (const g of list) g.dispose()
      merged.computeBoundingSphere()
      group.add(new THREE.Mesh(merged, mat))
    }
    return group
  }
}

// Side-profile cut-out: points are [z, y] in gun space (-Z = muzzle), or
// ['q', cz, cy, z, y] for a curved corner. Extruded `width` across X and
// centred, with a small bevel so edges catch light.
function profileGeo(points, width, opts = {}) {
  const toShape = (pts, shape) => {
    pts.forEach((p, i) => {
      if (p[0] === 'q') shape.quadraticCurveTo(-p[1], p[2], -p[3], p[4])
      else if (i === 0) shape.moveTo(-p[0], p[1])
      else shape.lineTo(-p[0], p[1])
    })
    return shape
  }
  const shape = toShape(points, new THREE.Shape())
  for (const hole of opts.holes || []) shape.holes.push(toShape(hole, new THREE.Path()))
  const bevel = opts.bevel ?? 0.004
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, width - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 2,
    curveSegments: opts.curveSegments || 8,
  })
  geo.rotateY(Math.PI / 2)
  geo.translate(-(width - bevel * 2) / 2, 0, 0)
  return geo
}

// Cylinder along Z: rFront at the muzzle side (-Z), rBack toward the stock.
function cylZ(rFront, rBack, len, seg = 16) {
  const geo = new THREE.CylinderGeometry(rBack, rFront, len, seg)
  geo.rotateX(Math.PI / 2)
  return geo
}

function tubeGeo(points, radius, seg = 24) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)))
  return new THREE.TubeGeometry(curve, seg, radius, 8, false)
}

// Pistol grip + trigger guard, shared by most of these. (z, y) = top-front
// corner of the grip where it meets the receiver.
function addPistolGrip(parts, mat, z, y, opts = {}) {
  const h = opts.height || 0.13
  const w = opts.width || 0.034
  parts.add(mat, profileGeo([
    [z, y], [z - 0.012, y - h * 0.5], ['q', z - 0.016, y - h, z + 0.01, y - h],
    [z + 0.045, y - h], ['q', z + 0.06, y - h * 0.5, z + 0.058, y], [z, y],
  ], w, { bevel: 0.006 }))
  // Finger grooves
  for (let i = 1; i <= 3; i++) parts.add(RUBBER, new THREE.BoxGeometry(w + 0.004, 0.004, 0.01), [0, y - h * 0.22 * i, z - 0.01 - i * 0.001])
  // Trigger guard (a loop) + trigger
  if (opts.guard !== false) {
    parts.add(opts.guardMat || DARK_METAL, profileGeo([
      [z - 0.07, y], [z - 0.07, y - 0.035], ['q', z - 0.07, y - 0.05, z - 0.05, y - 0.05], [z, y - 0.05], [z, y - 0.042],
      [z - 0.048, y - 0.042], ['q', z - 0.062, y - 0.042, z - 0.062, y - 0.03], [z - 0.062, y], [z - 0.07, y],
    ], 0.012, { bevel: 0.002 }))
    parts.add(DARK_METAL, profileGeo([[z - 0.03, y], [z - 0.036, y - 0.03], [z - 0.026, y - 0.034], [z - 0.022, y]], 0.008, { bevel: 0.001 }))
  }
  const anchor = new THREE.Object3D()
  anchor.position.set(0, y - h * 0.5, z + 0.02)
  anchor.rotation.x = -0.2
  return anchor
}

// Off-hand, hidden like the main hand (see attachHandToGrip) - on these
// detailed shapes a visible floating fist read worse than no hand at all.
function addForeHand(g, anchor) {
  const foreHand = buildHand()
  foreHand.position.copy(anchor.position)
  foreHand.rotation.x = -0.15
  foreHand.rotation.z = Math.PI
  foreHand.visible = false
  g.add(foreHand)
}

// Rocket Launcher - RPG-7 style: steel tube with wooden heat guards, a
// flared rear venturi, a loaded olive warhead with its fuse, an optic.
function buildRocketLauncher() {
  const g = new THREE.Group()
  const p = new PartSet()
  const body = STEEL
  p.add(body, cylZ(0.04, 0.04, 0.62, 20), [0, 0.02, -0.03])
  p.add(DARK_METAL, cylZ(0.046, 0.078, 0.14, 20), [0, 0.02, 0.34])
  p.add(DARK_METAL, cylZ(0.08, 0.08, 0.012, 20), [0, 0.02, 0.41])
  for (const z of [-0.14, 0.06]) {
    p.add(WOOD, cylZ(0.052, 0.052, 0.13, 20), [0, 0.02, z])
    p.add(STEEL, cylZ(0.055, 0.055, 0.008, 20), [0, 0.02, z - 0.066])
    p.add(STEEL, cylZ(0.055, 0.055, 0.008, 20), [0, 0.02, z + 0.066])
  }
  // Warhead
  p.add(OLIVE, cylZ(0.03, 0.04, 0.04, 20), [0, 0.02, -0.355])
  p.add(OLIVE, cylZ(0.072, 0.03, 0.05, 20), [0, 0.02, -0.4])
  p.add(OLIVE, cylZ(0.072, 0.072, 0.08, 20), [0, 0.02, -0.465])
  p.add(OLIVE, cylZ(0.012, 0.072, 0.12, 20), [0, 0.02, -0.565])
  p.add(BRASS, cylZ(0.006, 0.012, 0.03, 12), [0, 0.02, -0.64])
  p.add(RED_PAINT, cylZ(0.073, 0.073, 0.01, 20), [0, 0.02, -0.44])
  // Optic on the left + iron sights
  p.add(DARK_METAL, profileGeo([[-0.09, 0.0], [-0.09, 0.035], [0.03, 0.035], [0.03, 0.0]], 0.03), [-0.055, 0.06, 0])
  p.add(DARK_METAL, new THREE.BoxGeometry(0.02, 0.03, 0.03), [-0.04, 0.05, -0.03])
  p.add(GLASS, cylZ(0.014, 0.014, 0.006, 16), [-0.055, 0.0775, -0.093])
  p.add(RUBBER, cylZ(0.016, 0.016, 0.03, 16), [-0.055, 0.0775, 0.045])
  p.add(DARK_METAL, new THREE.BoxGeometry(0.006, 0.03, 0.01), [0, 0.07, -0.27])
  p.add(DARK_METAL, new THREE.BoxGeometry(0.02, 0.025, 0.008), [0, 0.07, 0.12])
  // Trigger grip + rear grip
  const grip = addPistolGrip(p, GRIP, -0.04, -0.02, { height: 0.12 })
  addPistolGrip(p, GRIP, 0.14, -0.02, { height: 0.1, guard: false })
  p.add(DARK_METAL, new THREE.BoxGeometry(0.04, 0.012, 0.24), [0, -0.022, 0.06])
  p.build(g)
  g.add(grip)
  attachHandToGrip(g, grip)
  const fore = new THREE.Object3D()
  fore.position.set(0, -0.07, 0.18)
  addForeHand(g, fore)
  return g
}

// Minigun - motor housing, carry handle, a 6-barrel cluster with front and
// middle clamps (the cluster stays its own spinning group), an ammo box
// with a curved feed chute.
export function buildMinigunModel() {
  const g = new THREE.Group()
  const p = new PartSet()
  const body = STEEL
  // Receiver: rounded side profile
  p.add(body, profileGeo([
    [-0.1, -0.06], [-0.1, 0.05], ['q', -0.1, 0.075, -0.075, 0.075], [0.1, 0.075], ['q', 0.13, 0.075, 0.13, 0.045],
    [0.13, -0.04], ['q', 0.13, -0.065, 0.1, -0.065], [-0.1, -0.06],
  ], 0.12, { bevel: 0.01 }))
  p.add(DARK_METAL, cylZ(0.05, 0.05, 0.08, 20), [0, 0.005, 0.16])
  p.add(DARK_METAL, cylZ(0.035, 0.05, 0.02, 20), [0, 0.005, 0.21])
  for (let i = 0; i < 6; i++) p.add(STEEL, new THREE.BoxGeometry(0.004, 0.012, 0.15), [0.062, -0.03 + i * 0.016, 0.02])
  // Carry handle + bar
  p.add(DARK_METAL, profileGeo([[-0.07, 0.07], [-0.06, 0.12], [0.08, 0.12], [0.09, 0.07], [0.075, 0.07], [0.066, 0.106], [-0.046, 0.106], [-0.055, 0.07]], 0.02, { bevel: 0.003 }))
  // Ammo box + feed chute
  p.add(OLIVE, new THREE.BoxGeometry(0.1, 0.13, 0.14), [0.12, -0.11, 0.08])
  p.add(DARK_METAL, new THREE.BoxGeometry(0.104, 0.02, 0.144), [0.12, -0.035, 0.08])
  p.add(BRASS, new THREE.BoxGeometry(0.08, 0.01, 0.12), [0.12, -0.022, 0.08])
  p.add(DARK_METAL, tubeGeo([[0.12, -0.03, 0.05], [0.12, 0.02, 0.0], [0.075, 0.02, -0.03], [0.06, 0.0, -0.05]], 0.016, 20))
  p.add(DARK_METAL, new THREE.BoxGeometry(0.004, 0.06, 0.06), [0.172, -0.11, 0.08])
  const grip = addPistolGrip(p, GRIP, 0.06, -0.06, { height: 0.12 })
  p.build(g)
  g.add(grip)

  const barrelCluster = new THREE.Group()
  barrelCluster.position.set(0, 0.005, -0.1)
  const bp = new PartSet()
  bp.add(DARK_METAL, cylZ(0.022, 0.022, 0.46, 12), [0, 0, -0.23])
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    const x = Math.cos(a) * 0.045
    const y = Math.sin(a) * 0.045
    bp.add(STEEL, cylZ(0.0125, 0.0125, 0.46, 12), [x, y, -0.23])
    bp.add(DARK_METAL, cylZ(0.0145, 0.0145, 0.02, 12), [x, y, -0.455])
  }
  for (const [z, len] of [[-0.03, 0.05], [-0.25, 0.025], [-0.44, 0.03]]) {
    bp.add(DARK_METAL, cylZ(0.064, 0.064, len, 24), [0, 0, z])
  }
  bp.build(barrelCluster)
  g.add(barrelCluster)

  const handleBar = new THREE.Object3D()
  handleBar.position.set(0, 0.115, 0.01)
  g.add(handleBar)
  g.userData.barrelCluster = barrelCluster
  g.userData.grip = grip
  g.userData.handleBar = handleBar
  return g
}

// Flamethrower - a twin fuel-tank pack slung on top with a pressure
// gauge and valves, a braided hose into a perforated heat-shield wand,
// pilot-light igniter and a glowing nozzle.
function buildFlamethrower() {
  const g = new THREE.Group()
  const p = new PartSet()
  const body = OLIVE
  // Twin tanks: capsules
  for (const x of [-0.038, 0.038]) {
    p.add(body, cylZ(0.036, 0.036, 0.22, 20), [x, 0.11, 0.06])
    p.add(body, new THREE.SphereGeometry(0.036, 20, 10), [x, 0.11, -0.05])
    p.add(body, new THREE.SphereGeometry(0.036, 20, 10), [x, 0.11, 0.17])
    p.add(BRASS, cylZ(0.012, 0.012, 0.02, 12), [x, 0.11, -0.092])
  }
  p.add(DARK_METAL, new THREE.BoxGeometry(0.1, 0.012, 0.03), [0, 0.07, 0.0])
  p.add(DARK_METAL, new THREE.BoxGeometry(0.1, 0.012, 0.03), [0, 0.07, 0.13])
  // Gauge
  p.add(CHROME, new THREE.CylinderGeometry(0.018, 0.018, 0.012, 20), [0, 0.158, 0.06])
  p.add(GLASS, new THREE.CylinderGeometry(0.015, 0.015, 0.002, 20), [0, 0.165, 0.06])
  p.add(RED_PAINT, new THREE.BoxGeometry(0.002, 0.003, 0.012), [0, 0.167, 0.056])
  // Hose from tank to wand
  p.add(RUBBER, tubeGeo([[0, 0.08, -0.08], [0.02, 0.04, -0.1], [0.02, -0.005, -0.06], [0, -0.01, -0.02]], 0.011, 24))
  // Wand: receiver + heat shield with holes + nozzle
  p.add(DARK_METAL, profileGeo([[-0.06, -0.035], [-0.06, 0.02], [0.12, 0.02], [0.12, -0.03], [0.04, -0.035]], 0.05, { bevel: 0.006 }))
  p.add(STEEL, cylZ(0.016, 0.016, 0.42, 14), [0, -0.005, -0.25])
  p.add(DARK_METAL, cylZ(0.03, 0.03, 0.2, 20), [0, -0.005, -0.25])
  for (let i = 0; i < 8; i++) p.add(RUBBER, cylZ(0.031, 0.031, 0.008, 20), [0, -0.005, -0.17 - i * 0.022])
  p.add(STEEL, cylZ(0.026, 0.018, 0.05, 16), [0, -0.005, -0.47])
  p.add(DARK_METAL, cylZ(0.006, 0.006, 0.08, 8), [0, -0.035, -0.42])
  p.add(FLAME_GLOW, new THREE.SphereGeometry(0.008, 8, 8), [0, -0.035, -0.462])
  p.add(FLAME_GLOW, cylZ(0.012, 0.012, 0.006, 16), [0, -0.005, -0.497])
  p.add(RED_PAINT, cylZ(0.014, 0.014, 0.012, 12), [0.03, 0.02, 0.06])
  // Grips
  const grip = addPistolGrip(p, GRIP, 0.06, -0.035, { height: 0.12 })
  p.add(GRIP, profileGeo([[-0.14, -0.035], [-0.15, -0.1], [-0.1, -0.1], [-0.11, -0.035]], 0.032, { bevel: 0.006 }))
  p.build(g)
  g.add(grip)
  attachHandToGrip(g, grip)
  const fore = new THREE.Object3D()
  fore.position.set(0, -0.07, -0.13)
  addForeHand(g, fore)
  return g
}

// Crossbow - a wooden stock with thumbhole cut, a top rail with a scope,
// swept recurve limbs ending in cams, a two-strand string drawn back to the
// latch, a loaded bolt with fletching and broadhead, and a foot stirrup.
function buildCrossbow() {
  const g = new THREE.Group()
  const p = new PartSet()
  const wood = WOOD
  p.add(wood, profileGeo([
    [-0.3, 0.0], [-0.3, 0.035], [0.05, 0.035], [0.09, 0.02], [0.24, 0.03], [0.32, 0.03], [0.33, -0.08], [0.29, -0.09],
    ['q', 0.2, -0.04, 0.12, -0.03], [0.06, -0.03], [-0.02, -0.01], [-0.3, 0.0],
  ], 0.045, { bevel: 0.006, holes: [[[0.16, -0.005], ['q', 0.2, 0.012, 0.25, 0.005], [0.27, -0.04], ['q', 0.22, -0.05, 0.16, -0.02]]] }))
  p.add(RUBBER, new THREE.BoxGeometry(0.05, 0.12, 0.012), [0, -0.025, 0.333])
  // Barrel/rail
  p.add(DARK_METAL, new THREE.BoxGeometry(0.03, 0.012, 0.44), [0, 0.043, -0.1])
  p.add(STEEL, new THREE.BoxGeometry(0.012, 0.004, 0.42), [0, 0.051, -0.1])
  // Scope
  p.add(DARK_METAL, cylZ(0.016, 0.016, 0.16, 16), [0, 0.095, 0.0])
  p.add(DARK_METAL, cylZ(0.022, 0.016, 0.03, 16), [0, 0.095, -0.095])
  p.add(DARK_METAL, cylZ(0.016, 0.02, 0.025, 16), [0, 0.095, 0.09])
  p.add(GLASS, cylZ(0.02, 0.02, 0.003, 16), [0, 0.095, -0.111])
  p.add(DARK_METAL, new THREE.BoxGeometry(0.012, 0.04, 0.012), [0, 0.07, -0.04])
  p.add(DARK_METAL, new THREE.BoxGeometry(0.012, 0.04, 0.012), [0, 0.07, 0.05])
  // Limbs: swept back from the riser at the front
  p.add(DARK_METAL, new THREE.BoxGeometry(0.09, 0.05, 0.04), [0, 0.03, -0.31])
  for (const s of [-1, 1]) {
    p.add(DARK_METAL, tubeGeo([[s * 0.04, 0.03, -0.31], [s * 0.14, 0.035, -0.29], [s * 0.22, 0.04, -0.24], [s * 0.27, 0.04, -0.2]], 0.01, 20), [0, 0, 0], [0, 0, 0], [1, 1, 1])
    p.add(STEEL, new THREE.CylinderGeometry(0.018, 0.018, 0.012, 16), [s * 0.275, 0.04, -0.2])
    // String from cam to the latch
    p.add(RUBBER, tubeGeo([[s * 0.275, 0.044, -0.2], [s * 0.12, 0.05, -0.05], [0, 0.052, 0.06]], 0.002, 12))
  }
  // Bolt
  p.add(CHROME, cylZ(0.004, 0.004, 0.36, 8), [0, 0.06, -0.12])
  p.add(STEEL, cylZ(0.0, 0.01, 0.035, 8), [0, 0.06, -0.317])
  for (let i = 0; i < 3; i++) p.add(RED_PAINT, new THREE.BoxGeometry(0.002, 0.012, 0.04), [0, 0.06, 0.04], [0, 0, (i / 3) * Math.PI * 2])
  // Stirrup
  p.add(DARK_METAL, tubeGeo([[-0.04, 0.02, -0.33], [-0.035, 0.0, -0.4], [0, -0.005, -0.42], [0.035, 0.0, -0.4], [0.04, 0.02, -0.33]], 0.006, 20))
  const grip = addPistolGrip(p, GRIP, 0.05, -0.01, { height: 0.12 })
  p.add(GRIP, new THREE.BoxGeometry(0.04, 0.03, 0.12), [0, -0.005, -0.16])
  p.build(g)
  g.add(grip)
  attachHandToGrip(g, grip)
  const fore = new THREE.Object3D()
  fore.position.set(0, -0.03, -0.16)
  addForeHand(g, fore)
  return g
}

// Grenade Launcher - a six-shot revolver launcher (M32 style): a big
// fluted cylinder with visible shells, a ribbed barrel with a top rail and
// reflex sight, a folding foregrip and a collapsible tube stock.
function buildGrenadeLauncher() {
  const g = new THREE.Group()
  const p = new PartSet()
  const body = DARK_METAL
  // Frame
  p.add(body, profileGeo([[-0.12, -0.03], [-0.12, 0.06], [0.1, 0.06], [0.12, 0.03], [0.12, -0.05], [0.05, -0.05], [0.02, -0.03]], 0.06, { bevel: 0.006 }))
  // Cylinder with 6 chambers
  p.add(DARK_METAL, cylZ(0.072, 0.072, 0.13, 6), [0, -0.005, -0.03])
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6
    p.add(BRASS, cylZ(0.022, 0.022, 0.006, 14), [Math.cos(a) * 0.045, -0.005 + Math.sin(a) * 0.045, 0.037])
    p.add(OLIVE, cylZ(0.024, 0.024, 0.004, 14), [Math.cos(a) * 0.045, -0.005 + Math.sin(a) * 0.045, -0.097])
  }
  p.add(STEEL, cylZ(0.016, 0.016, 0.15, 12), [0, -0.005, -0.03])
  // Barrel
  p.add(STEEL, cylZ(0.036, 0.036, 0.22, 20), [0, 0.02, -0.21])
  for (let i = 0; i < 6; i++) p.add(DARK_METAL, cylZ(0.039, 0.039, 0.012, 20), [0, 0.02, -0.13 - i * 0.03])
  p.add(DARK_METAL, cylZ(0.042, 0.042, 0.03, 20), [0, 0.02, -0.32])
  // Top rail + reflex sight
  p.add(DARK_METAL, new THREE.BoxGeometry(0.03, 0.012, 0.3), [0, 0.068, -0.08])
  for (let i = 0; i < 10; i++) p.add(STEEL, new THREE.BoxGeometry(0.032, 0.004, 0.012), [0, 0.076, -0.21 + i * 0.028])
  p.add(DARK_METAL, profileGeo([[-0.04, 0.0], [-0.04, 0.05], [-0.032, 0.05], [0.01, 0.012], [0.03, 0.012], [0.03, 0.0]], 0.036), [0, 0.074, -0.05])
  p.add(GLASS, new THREE.BoxGeometry(0.03, 0.035, 0.003), [0, 0.1, -0.087])
  // Stock: two tubes + butt pad
  for (const y of [0.04, -0.01]) p.add(STEEL, cylZ(0.009, 0.009, 0.2, 10), [0, y, 0.21])
  p.add(RUBBER, profileGeo([[0.3, -0.06], [0.3, 0.07], [0.33, 0.07], [0.33, -0.06]], 0.045, { bevel: 0.008 }))
  const grip = addPistolGrip(p, GRIP, 0.09, -0.04, { height: 0.12 })
  p.add(GRIP, profileGeo([[-0.18, -0.02], [-0.19, -0.11], [-0.15, -0.11], [-0.155, -0.02]], 0.03, { bevel: 0.006 }))
  p.build(g)
  g.add(grip)
  attachHandToGrip(g, grip)
  const fore = new THREE.Object3D()
  fore.position.set(0, -0.06, -0.17)
  addForeHand(g, fore)
  return g
}

// Nail Gun - framing-nailer shape: an orange body with a motor dome and
// black rubber overmould, a long nose with the contact tip, an angled
// strip magazine with visible nails and an air fitting.
function buildNailgun() {
  const g = new THREE.Group()
  const p = new PartSet()
  const body = TOOL_ORANGE
  p.add(body, profileGeo([
    [-0.06, -0.05], [-0.06, 0.04], ['q', -0.04, 0.09, 0.02, 0.09], ['q', 0.1, 0.09, 0.11, 0.03], [0.1, -0.03], [0.05, -0.04], [0.0, -0.05],
  ], 0.07, { bevel: 0.01 }))
  p.add(RUBBER, new THREE.BoxGeometry(0.072, 0.02, 0.1), [0, 0.07, 0.02])
  p.add(DARK_METAL, new THREE.BoxGeometry(0.074, 0.03, 0.006), [0, 0.03, 0.106])
  // Nose + contact tip
  p.add(DARK_METAL, profileGeo([[-0.17, -0.07], [-0.17, -0.02], [-0.05, 0.0], [-0.05, -0.05]], 0.03, { bevel: 0.004 }))
  p.add(STEEL, new THREE.BoxGeometry(0.02, 0.07, 0.012), [0, -0.06, -0.175])
  p.add(RED_PAINT, cylZ(0.008, 0.008, 0.02, 10), [0.025, -0.01, -0.09])
  // Magazine with nails
  const mag = new PartSet()
  mag.add(DARK_METAL, new THREE.BoxGeometry(0.024, 0.04, 0.2), [0, 0, 0])
  for (let i = 0; i < 14; i++) mag.add(CHROME, new THREE.CylinderGeometry(0.002, 0.002, 0.03, 6), [0, 0.032, -0.09 + i * 0.013], [0.35, 0, 0])
  mag.add(BRASS, new THREE.BoxGeometry(0.026, 0.006, 0.2), [0, 0.02, 0])
  const magGroup = mag.build()
  magGroup.position.set(0, -0.12, -0.01)
  magGroup.rotation.x = 0.43
  g.add(magGroup)
  // Grip with overmould + air fitting
  const grip = addPistolGrip(p, RUBBER, 0.07, -0.04, { height: 0.12, guardMat: DARK_METAL })
  p.add(BRASS, cylZ(0.008, 0.008, 0.03, 10), [0, -0.175, 0.11], [0.3, 0, 0])
  p.add(STEEL, cylZ(0.011, 0.011, 0.012, 12), [0, -0.163, 0.105], [0.3, 0, 0])
  p.build(g)
  g.add(grip)
  attachHandToGrip(g, grip)
  return g
}

// Harpoon Gun - a speargun: slim aluminium-and-wood barrel, a muzzle head
// holding two thick rubber bands stretched back to the shaft notches, the
// loaded spear with its barbed tip, and a line reel under the barrel.
function buildHarpoonGun() {
  const g = new THREE.Group()
  const p = new PartSet()
  const body = WOOD
  p.add(body, profileGeo([[-0.34, -0.005], [-0.34, 0.03], [0.1, 0.035], [0.2, 0.02], [0.24, -0.02], [0.2, -0.04], [0.06, -0.03], [-0.34, -0.005]], 0.04, { bevel: 0.006 }))
  p.add(STEEL, new THREE.BoxGeometry(0.012, 0.006, 0.5), [0, 0.038, -0.08])
  // Muzzle head + band anchors
  p.add(DARK_METAL, profileGeo([[-0.38, -0.01], [-0.38, 0.05], [-0.34, 0.05], [-0.34, -0.01]], 0.06, { bevel: 0.006 }))
  for (const s of [-1, 1]) {
    // Rubber band: from the muzzle head back to the shaft notch
    p.add(RUBBER, tubeGeo([[s * 0.03, 0.025, -0.36], [s * 0.035, 0.04, -0.2], [s * 0.012, 0.055, -0.04]], 0.008, 16))
  }
  p.add(STEEL, tubeGeo([[-0.012, 0.055, -0.04], [0, 0.058, -0.03], [0.012, 0.055, -0.04]], 0.003, 8))
  // Spear + barbed tip + flopper
  p.add(CHROME, cylZ(0.004, 0.004, 0.62, 8), [0, 0.052, -0.3])
  p.add(STEEL, cylZ(0.0, 0.008, 0.05, 8), [0, 0.052, -0.635])
  p.add(STEEL, new THREE.BoxGeometry(0.002, 0.016, 0.03), [0, 0.06, -0.58], [0.4, 0, 0])
  // Line reel under the barrel
  p.add(DARK_METAL, new THREE.CylinderGeometry(0.035, 0.035, 0.03, 20), [0, -0.035, -0.12], [0, 0, Math.PI / 2])
  p.add(BRASS, new THREE.CylinderGeometry(0.02, 0.02, 0.032, 20), [0, -0.035, -0.12], [0, 0, Math.PI / 2])
  p.add(STEEL, new THREE.BoxGeometry(0.006, 0.02, 0.012), [0.02, -0.035, -0.12])
  const grip = addPistolGrip(p, GRIP, 0.13, -0.03, { height: 0.12 })
  p.build(g)
  g.add(grip)
  attachHandToGrip(g, grip)
  const fore = new THREE.Object3D()
  fore.position.set(0, -0.03, -0.1)
  addForeHand(g, fore)
  return g
}

// Void Ripper - Mystery Box exclusive: a sleek angular alien body with
// glowing seams, twin forward prongs cradling a floating core inside three
// thin rings, and a skeletal stock.
function buildVoidRipper() {
  const g = new THREE.Group()
  const p = new PartSet()
  const body = DARK_METAL
  p.add(body, profileGeo([
    [-0.12, -0.02], [-0.08, 0.05], [0.1, 0.06], [0.16, 0.03], [0.16, -0.02], [0.08, -0.05], [0.02, -0.04], [-0.06, -0.04],
  ], 0.065, { bevel: 0.008 }))
  // Glowing seams
  p.add(VOID_GLOW, new THREE.BoxGeometry(0.067, 0.004, 0.2), [0, 0.02, 0.02])
  p.add(VOID_GLOW, new THREE.BoxGeometry(0.067, 0.004, 0.14), [0, -0.015, 0.05])
  // Prongs
  for (const s of [-1, 1]) {
    p.add(VOID_TRIM, profileGeo([[-0.34, 0.04], [-0.3, 0.07], [-0.14, 0.05], [-0.1, 0.03], [-0.14, 0.03], [-0.29, 0.05]], 0.016, { bevel: 0.003 }), [s * 0.022, 0, 0], [0, 0, s * -0.12])
    p.add(VOID_TRIM, profileGeo([[-0.32, -0.005], [-0.28, -0.03], [-0.13, -0.025], [-0.1, -0.005], [-0.13, -0.008], [-0.28, -0.015]], 0.014, { bevel: 0.003 }), [s * 0.02, 0, 0])
  }
  // Skeletal stock
  p.add(body, profileGeo([[0.15, 0.03], [0.3, 0.04], [0.32, -0.08], [0.28, -0.08], [0.27, 0.0], [0.17, -0.01]], 0.045, { bevel: 0.006 }))
  p.add(VOID_GLOW, new THREE.BoxGeometry(0.047, 0.004, 0.11), [0, 0.03, 0.23], [-0.06, 0, 0])
  const grip = addPistolGrip(p, GRIP, 0.06, -0.04, { height: 0.12 })
  p.build(g)
  // Floating core + rings (separate, like before)
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.032, 20, 16), VOID_GLOW)
  core.position.set(0, 0.02, -0.22)
  g.add(core)
  const ringGeo = new THREE.TorusGeometry(0.05, 0.004, 8, 32)
  for (const rot of [[Math.PI / 2.3, 0, 0], [0, Math.PI / 2.6, 0], [0.4, 0.9, 0]]) {
    const ring = new THREE.Mesh(ringGeo, VOID_TRIM)
    ring.position.copy(core.position)
    ring.rotation.set(...rot)
    g.add(ring)
  }
  g.add(grip)
  attachHandToGrip(g, grip)
  const fore = new THREE.Object3D()
  fore.position.set(0, -0.03, -0.06)
  addForeHand(g, fore)
  return g
}

// MP5-SD - a fat integrated-suppressor sleeve running the front half of the
// barrel is the "SD" model's real-world signature, distinct from Glock 18's
// handgun shape and every other rifle-length gun's bare thin barrel.
function buildSuppressedSmg() {
  if (USE_GLB_SUPPRESSEDSMG && GUN_MODEL_CACHE.suppressedsmg) {
    const g = buildGunFromGLB(GUN_MODEL_CACHE.suppressedsmg, 'Metal')
    const root = g.children[0]
    const grip = root.getObjectByName('Grip')
    if (grip) attachHandToGrip(g, grip)
    const foregrip = root.getObjectByName('Foregrip')
    if (foregrip) {
      const foreHand = buildHand()
      foreHand.position.copy(foregrip.position)
      foreHand.rotation.x = -0.15
      foreHand.rotation.z = Math.PI
      g.add(foreHand)
    }
    return g
  }
  return buildSuppressedSmgProcedural()
}

function buildSuppressedSmgProcedural() {
  const g = new THREE.Group()

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.24), METAL)
  body.position.set(0, 0.02, 0.02)
  g.add(body)

  const suppressor = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.28, 12), DARK_METAL)
  suppressor.rotation.x = Math.PI / 2
  suppressor.position.set(0, 0.025, -0.24)
  g.add(suppressor)

  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.16, 0.05), DARK_METAL)
  mag.position.set(0, -0.12, -0.02)
  mag.rotation.x = 0.15
  g.add(mag)

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.16), DARK_METAL)
  stock.position.set(0, 0.02, 0.22)
  g.add(stock)

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.13, 0.07), GRIP)
  grip.position.set(0, -0.08, 0.08)
  grip.rotation.x = -0.2
  g.add(grip)

  const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.05), GRIP)
  foregrip.position.set(0, -0.02, -0.12)
  g.add(foregrip)

  attachHandToGrip(g, grip)

  const foreHand = buildHand()
  foreHand.position.copy(foregrip.position)
  foreHand.rotation.x = -0.15
  foreHand.rotation.z = Math.PI
  g.add(foreHand)

  return g
}

const BUILDERS = {
  pistol: buildPistol,
  rifle: buildRifle,
  melee: buildMelee,
  minigun: buildMinigun,
  shotgun: buildShotgun,
  awp: buildAwp,
  glock18: buildGlock18,
  flamethrower: buildFlamethrower,
  rocket: buildRocketLauncher,
  crossbow: buildCrossbow,
  launcher: buildGrenadeLauncher,
  nailgun: buildNailgun,
  harpoon: buildHarpoonGun,
  voidripper: buildVoidRipper,
  suppressedsmg: buildSuppressedSmg,
}

export function buildViewmodel(weaponId) {
  const build = BUILDERS[weaponId] || buildPistol
  const group = build()
  group.traverse((o) => { if (o.isMesh) o.castShadow = false })
  return group
}
