// A character holding a weapon in third person - other players on a server
// (PlayNet.js) and your own body in the third-person views (BuildTryMode's
// camera key). Split out of PlayNet.js on 2026-10-13 so both look the same.
import * as THREE from 'three'
import { cloneViewmodel } from './Viewmodels.js'

// Held weapons: character units (the body is 32 tall) per viewmodel
// length unit, so a rifle is a little under a block long in their hands.
const GUN_SCALE = 15
// ...but never shorter than this many viewmodel units.
const HELD_MIN_LEN = 0.55
// Weapons drawn with the world's own light (the guns' metal materials
// render black without an environment map) - one plain material per
// source material, shared by every holder, never disposed.
const HELD_MATERIALS = new WeakMap()
function heldMaterial(m) {
  let out = HELD_MATERIALS.get(m)
  if (!out) {
    out = new THREE.MeshLambertMaterial({ map: m.map || null, color: m.color ? m.color.clone() : 0x777777, transparent: !!m.transparent, opacity: m.opacity ?? 1, alphaTest: m.alphaTest || 0, side: m.side ?? THREE.FrontSide, vertexColors: !!m.vertexColors })
    // The glow keeps its own picture: a white glow colour without its
    // map lit the whole flamethrower/crossbow pure white (2026-10-17).
    if (m.emissive) {
      out.emissive = m.emissive.clone()
      out.emissiveMap = m.emissiveMap || null
      out.emissiveIntensity = m.emissiveIntensity ?? 1
    }
    HELD_MATERIALS.set(m, out)
  }
  return out
}
// Turns a viewmodel (muzzle along -z, top +y) to lie along the arm: the
// muzzle down the arm towards the hand (-y), its top facing the arm's
// front (+z), so a raised arm points the gun where the player looks.
const HELD_TURN = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)))

// Holding a gun: arms turned in (radians, right arm in on the grip, left
// arm across to the barrel) and lowered a little until firing.
export const HOLD_RIGHT_YAW = -0.3
const HOLD_LEFT_YAW = 0.75
const HOLD_LOWER = 0.12

export function isMeleeWeapon(id) {
  return /melee|knife|tomahawk/i.test(id || '')
}

// Puts a copy of the game's own model of weaponId in the body's right hand
// (replacing `old`, the group a previous call returned). Returns
// { gun, melee }; gun is null when there's no such model.
export function holdWeapon(game, body, weaponId, old = null) {
  const armR = body?.limbPivots?.armR
  if (old) old.parent?.remove(old)
  const melee = isMeleeWeapon(weaponId)
  const source = armR && game?.weapons?.viewmodels?.[weaponId || '']
  if (!source) return { gun: null, melee }
  const gun = cloneViewmodel(source)
  gun.visible = true
  gun.traverse((o) => {
    if (!o.isMesh) return
    o.material = Array.isArray(o.material) ? o.material.map(heldMaterial) : heldMaterial(o.material)
    o.castShadow = false
  })
  const held = new THREE.Group()
  held.add(gun)
  // A gun turns back by the arm's own inward turn, so it points straight
  // ahead (the arm's local z is the body's up once the arm is raised).
  held.quaternion.copy(HELD_TURN)
  if (!melee) held.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -HOLD_RIGHT_YAW))
  // Small guns get a minimum size, or a pistol hides inside the hand.
  const len = new THREE.Box3().setFromObject(gun).getSize(new THREE.Vector3()).z || 0.5
  held.scale.setScalar(GUN_SCALE * Math.max(1, HELD_MIN_LEN / len))
  // In the hand at the end of the arm (the arm is 12 long), a gun resting
  // a little under it.
  held.position.set(0, -11, melee ? 0 : -1.5)
  held.userData.heldWeapon = true
  armR.add(held)
  return { gun: held, melee }
}

// The arms for this frame: a gun up in front with both hands (Minecraft-
// crossbow style), a blade at the side raised to strike, or empty hands
// swinging with the walk.
export function poseArms(lp, { holding, melee, firing, swing }) {
  if (holding && !melee) {
    lp.armR.rotation.order = 'YXZ'
    lp.armL.rotation.order = 'YXZ'
    const raise = firing ? 0 : HOLD_LOWER
    lp.armR.rotation.set(-Math.PI / 2 + raise, HOLD_RIGHT_YAW, 0)
    lp.armL.rotation.set(-Math.PI / 2 + raise, HOLD_LEFT_YAW, 0)
  } else if (holding) {
    lp.armR.rotation.set(firing ? -Math.PI / 2 : -swing * 0.6, 0, 0)
    lp.armL.rotation.set(swing, 0, 0)
  } else {
    lp.armR.rotation.set(firing ? -Math.PI / 2 : -swing, 0, 0)
    lp.armL.rotation.set(firing ? -Math.PI / 2.3 : swing, 0, 0)
  }
}
