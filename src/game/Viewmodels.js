import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { flatMaterial, flattenedClone } from './QualitySettings.js'

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
// is that gun's designated tintable material slot (mirrors the procedural
// version's own skinMaterial() call on its main body mesh).
function buildGunFromGLB(cache, tintMatName, skinId) {
  const g = new THREE.Group()
  const cloned = cache.clone(true)
  const tint = SKIN_TINTS[skinId]
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
    if (child.material.name === tintMatName) {
      child.material = flattenedClone(child.material)
      if (tint) {
        child.material.color.setHex(tint.color)
        child.material.emissive.setHex(tint.emissive)
        child.material.emissiveIntensity = 0.3
        child.material.roughness = 0.25
        child.material.metalness = 0.9
      }
    }
  })
  g.add(cloned)
  return g
}

const METAL = flatMaterial({ color: 0x2b2b2d, roughness: 0.4, metalness: 0.7 })
const DARK_METAL = flatMaterial({ color: 0x1a1a1c, roughness: 0.5, metalness: 0.6 })
const GRIP = flatMaterial({ color: 0x2a1e14, roughness: 0.9 })
const WOOD = flatMaterial({ color: 0x4a3018, roughness: 0.8 })

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

// Cosmetic pistol skins (see Game.js's Coin Shop and CoinShop.js) - each
// swaps just the slide's material for a dedicated tinted one, never
// mutating the shared METAL material other guns also use. 'gold' is also
// the Centurion achievement's free cosmetic reward, see
// WeaponSystem.setWeaponSkin().
const SKIN_TINTS = {
  gold: { color: 0xd4af37, emissive: 0x5c4a1a },
  crimson: { color: 0xb0202a, emissive: 0x4a0808 },
  cobalt: { color: 0x2a6fd0, emissive: 0x0c1c40 },
  // Free bestiary-completion reward, see Game.js's _onZombieKilled.
  obsidian: { color: 0x1a1a1a, emissive: 0x3a3a3a },
  // Coin Shop exclusive, see CoinShop.js - not purchasable with points.
  ember: { color: 0xd45a1a, emissive: 0xff7a1a },
  // Per-weapon challenge reward (see Game.js's _checkWeaponChallenge) -
  // earned by kill count with that specific gun, not purchasable.
  veteran: { color: 0x5a5a3a, emissive: 0x2a2a10 },
  // Weapon Upgrade Machine reward (see WeaponSystem.boostUpgradeMult) - an
  // energetic glow distinct from every other skin's flat metallic tint.
  packapunch: { color: 0x2a3a6a, emissive: 0x4a6aff },
  // Akimbo purchase (see WeaponSystem.setAkimbo) - bright chrome, reads as
  // "show gun" rather than "worn/tactical" like every other skin here.
  akimbo: { color: 0xd8d8d8, emissive: 0x8a8a8a },
  // Heirloom forge (see Game.js's _offerHeirloomForge) - Grandmaster-only,
  // player-opted-into via a confirm prompt at the moment a weapon crosses
  // GRANDMASTER_THRESHOLD. Deep antique bronze with a warm glow, deliberately
  // the richest-looking tint here since it marks the single highest-effort
  // per-weapon milestone in the game.
  heirloom: { color: 0x8a5a2a, emissive: 0xb87f2a },
}

// Shared skin-tint lookup - every gun builder tints its own main body/
// receiver/slide mesh with this instead of the plain METAL material when a
// skinId is equipped (see WeaponSystem.setWeaponSkin, called per-weapon so
// every owned gun reflects the equipped skin, not just the pistol).
function skinMaterial(skinId, base = METAL) {
  const tint = SKIN_TINTS[skinId]
  if (!tint) return base
  return flatMaterial({ color: tint.color, roughness: 0.25, metalness: 0.9, emissive: tint.emissive, emissiveIntensity: 0.3 })
}

function buildPistol(skinId = null) {
  if (USE_GLB_PISTOL && GUN_MODEL_CACHE.pistol) {
    const g = buildGunFromGLB(GUN_MODEL_CACHE.pistol, 'Metal', skinId)
    const grip = g.children[0].getObjectByName('Grip')
    if (grip) attachHandToGrip(g, grip)
    return g
  }
  return buildPistolProcedural(skinId)
}

function buildPistolProcedural(skinId = null) {
  const g = new THREE.Group()

  const slideMat = skinMaterial(skinId)
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

function buildRifle(skinId = null) {
  if (USE_GLB_RIFLE && GUN_MODEL_CACHE.rifle) {
    const g = buildGunFromGLB(GUN_MODEL_CACHE.rifle, 'Metal', skinId)
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
  return buildRifleProcedural(skinId)
}

function buildRifleProcedural(skinId = null) {
  const g = new THREE.Group()

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.1, 0.48), skinMaterial(skinId))
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

// Shared builder for any single-mesh GLB melee weapon - no skin tinting
// (the melee slot never had SKIN_TINTS), just clone + castShadow off +
// hand attached at the model's own Grip empty.
// skinId tinting mirrors buildGunFromGLB's "Metal"-named-slot convention
// (same asset pipeline, see build-guns.py) so Coin Shop skins can reskin
// the knife the same way they reskin every gun.
function buildMeleeFromGLB(cache, skinId = null) {
  const g = new THREE.Group()
  const cloned = cache.clone(true)
  const tint = SKIN_TINTS[skinId]
  cloned.traverse((child) => {
    if (!child.isMesh) return
    child.castShadow = false
    // Same opacity-0-on-export quirk buildGunFromGLB works around - force
    // full opacity on every material here, not just the tint slot below.
    child.material.opacity = 1
    child.material.transparent = false
    if (tint && child.material.name === 'Metal') {
      child.material = flattenedClone(child.material)
      child.material.color.setHex(tint.color)
      child.material.emissive.setHex(tint.emissive)
      child.material.emissiveIntensity = 0.3
      child.material.roughness = 0.25
      child.material.metalness = 0.9
    }
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
export function buildQuickMeleeKnifeModel(skinId = null) {
  if (USE_GLB_KNIFE && GUN_MODEL_CACHE.knife) {
    return buildMeleeFromGLB(GUN_MODEL_CACHE.knife, skinId)
  }
  return buildQuickMeleeKnifeModelProcedural(skinId)
}

// Redesigned for a genuinely sharp, tapered profile (a flat box + a cone
// tip, the previous version, read as blunt/toy-like up close) - the blade
// is one continuous extruded 2D outline (drop-point silhouette: a slight
// concave swage near the spine, straight taper down to a real point)
// instead of two separate primitives glued together.
function buildQuickMeleeKnifeModelProcedural(skinId = null) {
  const g = new THREE.Group()

  const bladeMat = skinMaterial(skinId, flatMaterial({ color: 0x9aa0a6, roughness: 0.1, metalness: 1 }))
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
// instead of adding new weapon slots/keys - see WeaponSystem.setMeleeVariant().
// skinId only reskins the knife variant (the default/most-used one, and
// the one Coin Shop skin previews show) - the found-loot variants
// (bat/machete/etc) keep their own distinct look regardless of skin.
function buildMelee(skinId = null) {
  const g = new THREE.Group()

  const knife = buildQuickMeleeKnifeModel(skinId)
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
export function buildMinigunModel(skinId = null) {
  const g = new THREE.Group()

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.22), skinMaterial(skinId))
  body.position.set(0, 0, 0.02)
  g.add(body)

  const barrelCluster = new THREE.Group()
  barrelCluster.position.set(0, 0, -0.28)
  g.add(barrelCluster)

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 12), DARK_METAL)
  hub.rotation.x = Math.PI / 2
  barrelCluster.add(hub)

  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.42, 12), DARK_METAL)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(Math.cos(angle) * 0.05, Math.sin(angle) * 0.05, -0.21)
    barrelCluster.add(barrel)
  }

  const ammoBox = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.14, 0.13), DARK_METAL)
  ammoBox.position.set(0.11, -0.09, 0.1)
  g.add(ammoBox)

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.15, 0.07), GRIP)
  grip.position.set(0, -0.1, 0.14)
  grip.rotation.x = -0.2
  g.add(grip)

  const handleBar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.03), DARK_METAL)
  handleBar.position.set(0, 0.09, 0.1)
  g.add(handleBar)

  g.userData.barrelCluster = barrelCluster
  g.userData.grip = grip
  g.userData.handleBar = handleBar
  return g
}

function buildMinigun(skinId = null) {
  const g = buildMinigunModel(skinId)
  const { grip, handleBar, barrelCluster } = g.userData

  attachHandToGrip(g, grip)

  // Support hand wraps the horizontal handle bar, so its grip axis (local Y)
  // needs to run along world X instead of world Y.
  const barHand = buildHand()
  barHand.position.set(-0.06, handleBar.position.y, handleBar.position.z)
  barHand.rotation.z = Math.PI / 2
  g.add(barHand)

  g.userData.barrelCluster = barrelCluster
  return g
}

// Glock 18 - a chunkier M1911 with an extended mag and a vented compensator
// at the muzzle, reading as a machine pistol rather than a duplicate pistol.
function buildGlock18(skinId = null) {
  if (USE_GLB_GLOCK18 && GUN_MODEL_CACHE.glock18) {
    const g = buildGunFromGLB(GUN_MODEL_CACHE.glock18, 'Metal', skinId)
    const grip = g.children[0].getObjectByName('Grip')
    if (grip) attachHandToGrip(g, grip)
    return g
  }
  return buildGlock18Procedural(skinId)
}

function buildGlock18Procedural(skinId = null) {
  const g = new THREE.Group()

  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.095, 0.24), skinMaterial(skinId))
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
function buildShotgun(skinId = null) {
  if (USE_GLB_SHOTGUN && GUN_MODEL_CACHE.shotgun) {
    const g = buildGunFromGLB(GUN_MODEL_CACHE.shotgun, 'DarkMetal', skinId)
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
  return buildShotgunProcedural(skinId)
}

function buildShotgunProcedural(skinId = null) {
  const g = new THREE.Group()

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.1, 0.22), skinMaterial(skinId, DARK_METAL))
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
function buildAwp(skinId = null) {
  if (USE_GLB_AWP && GUN_MODEL_CACHE.awp) {
    // This particular gun model has no "Metal" slot (materials are Green/
    // Black/DarkMetal/Glass/Grey) - "Green" is the main body, confirmed via
    // Playwright (the generic 'Metal' guess silently tinted nothing).
    const g = buildGunFromGLB(GUN_MODEL_CACHE.awp, 'Green', skinId)
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
  return buildAwpProcedural(skinId)
}

function buildAwpProcedural(skinId = null) {
  const g = new THREE.Group()

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.5), skinMaterial(skinId))
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

// Flamethrower - a slung fuel tank above a thin nozzle wand, the opposite
// silhouette of every barrel-forward gun here (the "barrel" reads as a
// completely different diameter/height than the tank feeding it).
function buildFlamethrower(skinId = null) {
  const g = new THREE.Group()

  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.34, 12), skinMaterial(skinId, DARK_METAL))
  tank.rotation.x = Math.PI / 2
  tank.position.set(0, 0.09, 0.02)
  g.add(tank)

  const tankCap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 10), METAL)
  tankCap.rotation.x = Math.PI / 2
  tankCap.position.set(0, 0.09, -0.16)
  g.add(tankCap)

  const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.13, 8), DARK_METAL)
  hose.position.set(0, 0.04, 0.02)
  hose.rotation.x = 1.15
  g.add(hose)

  const wand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.4, 10), METAL)
  wand.rotation.x = Math.PI / 2
  wand.position.set(0, -0.01, -0.14)
  g.add(wand)

  const nozzleTip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.02, 0.06, 10), DARK_METAL)
  nozzleTip.rotation.x = Math.PI / 2
  nozzleTip.position.set(0, -0.01, -0.35)
  g.add(nozzleTip)

  const pilotLight = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), FLAME_GLOW)
  pilotLight.position.set(0, -0.01, -0.39)
  g.add(pilotLight)

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.14, 0.08), GRIP)
  grip.position.set(0, -0.08, 0.12)
  grip.rotation.x = -0.2
  g.add(grip)

  const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.06, 0.06), GRIP)
  foregrip.position.set(0, -0.03, -0.1)
  g.add(foregrip)

  attachHandToGrip(g, grip)

  const foreHand = buildHand()
  foreHand.position.copy(foregrip.position)
  foreHand.rotation.x = -0.15
  foreHand.rotation.z = Math.PI
  g.add(foreHand)

  return g
}

// Rocket Launcher - a fat open-ended tube with a shoulder pad, the widest
// barrel diameter of any gun here by a wide margin.
function buildRocketLauncher(skinId = null) {
  const g = new THREE.Group()

  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.62, 14), skinMaterial(skinId, DARK_METAL))
  tube.rotation.x = Math.PI / 2
  tube.position.set(0, 0.02, -0.08)
  g.add(tube)

  const muzzleRing = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.03, 14), METAL)
  muzzleRing.rotation.x = Math.PI / 2
  muzzleRing.position.set(0, 0.02, -0.4)
  g.add(muzzleRing)

  const shoulderPad = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.05), GRIP)
  shoulderPad.position.set(0, 0.02, 0.25)
  g.add(shoulderPad)

  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.08), DARK_METAL)
  sight.position.set(0, 0.11, -0.05)
  g.add(sight)

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.14, 0.08), GRIP)
  grip.position.set(0, -0.08, 0.02)
  grip.rotation.x = -0.2
  g.add(grip)

  const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.06), GRIP)
  foregrip.position.set(0, -0.07, -0.22)
  g.add(foregrip)

  attachHandToGrip(g, grip)

  const foreHand = buildHand()
  foreHand.position.copy(foregrip.position)
  foreHand.rotation.x = -0.15
  foreHand.rotation.z = Math.PI
  g.add(foreHand)

  return g
}

// Crossbow - horizontal limbs + a string are the whole silhouette story;
// every other gun here reads front-to-back, this one reads side-to-side.
function buildCrossbow(skinId = null) {
  const g = new THREE.Group()

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.38), skinMaterial(skinId, WOOD))
  body.position.set(0, 0.01, -0.02)
  g.add(body)

  const limbs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.035), DARK_METAL)
  limbs.position.set(0, 0.02, -0.16)
  g.add(limbs)

  const limbTipL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.05), METAL)
  limbTipL.position.set(-0.26, 0.02, -0.16)
  g.add(limbTipL)
  const limbTipR = limbTipL.clone()
  limbTipR.position.x = 0.26
  g.add(limbTipR)

  const string = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.006, 0.006), NAIL)
  string.position.set(0, 0.02, -0.14)
  g.add(string)

  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.015, 0.3), METAL)
  rail.position.set(0, 0.05, -0.05)
  g.add(rail)

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.14, 0.07), GRIP)
  grip.position.set(0, -0.08, 0.14)
  grip.rotation.x = -0.25
  g.add(grip)

  const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.05), GRIP)
  foregrip.position.set(0, -0.02, -0.14)
  g.add(foregrip)

  attachHandToGrip(g, grip)

  const foreHand = buildHand()
  foreHand.position.copy(foregrip.position)
  foreHand.rotation.x = -0.15
  foreHand.rotation.z = Math.PI
  g.add(foreHand)

  return g
}

// Grenade Launcher - short and fat with a drum magazine, distinct from the
// Rocket Launcher's much longer open tube despite both being explosive.
function buildGrenadeLauncher(skinId = null) {
  const g = new THREE.Group()

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.22), skinMaterial(skinId, DARK_METAL))
  body.position.set(0, 0.02, 0.02)
  g.add(body)

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.24, 14), METAL)
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(0, 0.02, -0.22)
  g.add(barrel)

  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.07, 14), DARK_METAL)
  drum.rotation.x = Math.PI / 2
  drum.position.set(0, -0.09, 0.0)
  g.add(drum)

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.09, 0.16), WOOD)
  stock.position.set(0, -0.01, 0.22)
  g.add(stock)

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.14, 0.07), GRIP)
  grip.position.set(0, -0.09, 0.1)
  grip.rotation.x = -0.25
  g.add(grip)

  const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.06), GRIP)
  foregrip.position.set(0, -0.03, -0.16)
  g.add(foregrip)

  attachHandToGrip(g, grip)

  const foreHand = buildHand()
  foreHand.position.copy(foregrip.position)
  foreHand.rotation.x = -0.15
  foreHand.rotation.z = Math.PI
  g.add(foreHand)

  return g
}

// Nail Gun - boxy orange construction-tool colors and an angled nail-strip
// magazine, one-handed like the pistols rather than shouldered like the
// other automatics.
function buildNailgun(skinId = null) {
  const g = new THREE.Group()

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.2), skinMaterial(skinId, TOOL_ORANGE))
  body.position.set(0, 0.03, -0.02)
  g.add(body)

  const nozzle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.08), DARK_METAL)
  nozzle.position.set(0, 0.0, -0.16)
  g.add(nozzle)

  const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.05), DARK_METAL)
  magazine.position.set(0, -0.11, 0.06)
  magazine.rotation.x = 0.45
  g.add(magazine)

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.15, 0.08), TOOL_ORANGE)
  grip.position.set(0, -0.07, 0.08)
  grip.rotation.x = -0.2
  g.add(grip)

  attachHandToGrip(g, grip)

  return g
}

// Harpoon Gun - a barbed shaft protruding well past the muzzle plus an
// off-center rope spool, the only gun here whose "barrel" load is visible
// at rest rather than hidden inside.
function buildHarpoonGun(skinId = null) {
  const g = new THREE.Group()

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.22), skinMaterial(skinId, DARK_METAL))
  body.position.set(0, 0.02, 0.02)
  g.add(body)

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.3, 12), METAL)
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(0, 0.03, -0.24)
  g.add(barrel)

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 8), METAL)
  shaft.rotation.x = Math.PI / 2
  shaft.position.set(0, 0.03, -0.45)
  g.add(shaft)

  const barb = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.05, 8), METAL)
  barb.rotation.x = -Math.PI / 2
  barb.position.set(0, 0.03, -0.58)
  g.add(barb)

  const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 14), WOOD)
  spool.rotation.z = Math.PI / 2
  spool.position.set(0.06, 0.02, 0.08)
  g.add(spool)

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.16), WOOD)
  stock.position.set(0, -0.01, 0.22)
  g.add(stock)

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.14, 0.07), GRIP)
  grip.position.set(0, -0.09, 0.1)
  grip.rotation.x = -0.25
  g.add(grip)

  const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.05), GRIP)
  foregrip.position.set(0, -0.02, -0.1)
  g.add(foregrip)

  attachHandToGrip(g, grip)

  const foreHand = buildHand()
  foreHand.position.copy(foregrip.position)
  foreHand.rotation.x = -0.15
  foreHand.rotation.z = Math.PI
  g.add(foreHand)

  return g
}

// Void Ripper - Mystery Box exclusive (see WeaponSystem.js's own note on
// `rare`). A glowing floating core ringed by two thin orbiting torii
// instead of a barrel - the one weapon here with no real-world silhouette
// to read against, so it leans fully into "this doesn't belong."
function buildVoidRipper(skinId = null) {
  const g = new THREE.Group()

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.09, 0.3), skinMaterial(skinId, DARK_METAL))
  body.position.set(0, 0.02, 0.0)
  g.add(body)

  const core = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 14), VOID_GLOW)
  core.position.set(0, 0.025, -0.2)
  g.add(core)

  const ringGeo = new THREE.TorusGeometry(0.06, 0.006, 8, 20)
  const ring1 = new THREE.Mesh(ringGeo, DARK_METAL)
  ring1.position.copy(core.position)
  ring1.rotation.x = Math.PI / 2.3
  g.add(ring1)
  const ring2 = new THREE.Mesh(ringGeo, DARK_METAL)
  ring2.position.copy(core.position)
  ring2.rotation.y = Math.PI / 2.6
  g.add(ring2)

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.18), DARK_METAL)
  stock.position.set(0, -0.01, 0.22)
  g.add(stock)

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.14, 0.07), GRIP)
  grip.position.set(0, -0.09, 0.1)
  grip.rotation.x = -0.25
  g.add(grip)

  const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.06), GRIP)
  foregrip.position.set(0, -0.02, -0.05)
  g.add(foregrip)

  attachHandToGrip(g, grip)

  const foreHand = buildHand()
  foreHand.position.copy(foregrip.position)
  foreHand.rotation.x = -0.15
  foreHand.rotation.z = Math.PI
  g.add(foreHand)

  return g
}

// MP5-SD - a fat integrated-suppressor sleeve running the front half of the
// barrel is the "SD" model's real-world signature, distinct from Glock 18's
// handgun shape and every other rifle-length gun's bare thin barrel.
function buildSuppressedSmg(skinId = null) {
  const g = new THREE.Group()

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.24), skinMaterial(skinId))
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

export function buildViewmodel(weaponId, options = {}) {
  const build = BUILDERS[weaponId] || buildPistol
  const group = build(options.skinId)
  group.traverse((o) => { if (o.isMesh) o.castShadow = false })
  return group
}
