import * as THREE from 'three'
import { flatMaterial, flattenedClone } from './QualitySettings.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'

// Phase 3 of the 3D asset overhaul - real rigged GLB player body (Quaternius
// "Casual_Male", asset-source/build-humans.py). This *adds* a walk cycle
// the procedural body never had (see the old module doc comment below) -
// update() isn't passed a dt, so it's tracked internally via performance.now()
// deltas rather than changing every caller.
export const USE_GLB_PLAYERBODY = true
let _playerBodyModelCache = null

export async function preloadPlayerBodyModel() {
  try {
    const loader = new GLTFLoader()
    const gltf = await loader.loadAsync('/models/humans/playerbody.glb')
    _playerBodyModelCache = { scene: gltf.scene, animations: gltf.animations }
  } catch (err) {
    console.warn('GLB player body model failed to load, falling back to procedural player body', err)
  }
}

// Same rig/raw height as Companion.js's model (same pack, same bounds).
const GLB_SCALE_CORRECTION = 0.556

// Simple visible body for third-person view - the player has no body mesh
// at all in first person (only WeaponSystem's viewmodel hands+gun), so one
// is needed purely for the external third-person camera to look at.
export class PlayerBody {
  constructor(scene) {
    this.group = new THREE.Group()
    this._buildBody()
    this.group.visible = false
    scene.add(this.group)
    this._prevX = 0
    this._prevZ = 0
    this._lastUpdateAt = performance.now()
  }

  _buildBody() {
    if (USE_GLB_PLAYERBODY && _playerBodyModelCache) {
      this._buildBodyFromGLB()
      return
    }
    this._buildBodyProcedural()
  }

  _buildBodyFromGLB() {
    this.usingGLB = true
    const cloned = cloneSkeleton(_playerBodyModelCache.scene)
    this.group.scale.setScalar(GLB_SCALE_CORRECTION)

    cloned.traverse((child) => {
      if (!child.isMesh) return
      child.castShadow = true
      child.material = flattenedClone(child.material)
    })

    this.group.add(cloned)
    this._glbRoot = cloned
    this.mixer = new THREE.AnimationMixer(cloned)
    this._glbActions = {}
    for (const clip of _playerBodyModelCache.animations) {
      this._glbActions[clip.name] = this.mixer.clipAction(clip)
    }
    this._glbCurrentAction = null
    this._playGlbAction('idle', true)
  }

  // Outfit customization - tints the "Shirt" material slot. This model
  // (Quaternius "Casual_Male") is a different source model from
  // Companion.js's "Soldier_Male" (confirmed via a material-name dump: this
  // one ships Skin/Shirt/Pants/Belt/Face/Hair, not a single "Main" slot), so
  // it needs its own slot name rather than copying Companion's. null
  // restores the model's own original color instead of guessing a "default"
  // hex, so this stays correct even if the base model's own color ever
  // changes. No-ops on the procedural fallback body (no equivalent slot to
  // tint there, and that path only runs if the GLB failed to load anyway).
  setOutfit(colorHex) {
    const root = this._glbRoot
    if (!root) return
    root.traverse((child) => {
      if (!child.isMesh || child.material.name !== 'Shirt') return
      if (colorHex !== null) {
        if (!child.userData._origColor) child.userData._origColor = child.material.color.clone()
        child.material.color.setHex(colorHex)
      } else if (child.userData._origColor) {
        child.material.color.copy(child.userData._origColor)
      }
    })
    // Pants now tint alongside the shirt (a darker shade of the same
    // color, not a separate purchase) - the model has its own "Pants"
    // slot per this class's own doc comment, previously never touched.
    this._setPantsColor(colorHex === null ? null : (new THREE.Color(colorHex)).multiplyScalar(0.55).getHex())
  }

  _setPantsColor(colorHex) {
    const root = this._glbRoot
    if (!root) return
    root.traverse((child) => {
      if (!child.isMesh || child.material.name !== 'Pants') return
      if (colorHex !== null) {
        if (!child.userData._origColor) child.userData._origColor = child.material.color.clone()
        child.material.color.setHex(colorHex)
      } else if (child.userData._origColor) {
        child.material.color.copy(child.userData._origColor)
      }
    })
  }

  // Cosmetic hats (see CoinShop.js's hat_* items) - a small bone-parented
  // prop on the Head bone, same pattern as RivalScavenger.js/RescueSurvivor.js's
  // own head-bone props. null removes whatever hat is currently attached.
  setHat(hatId, colorHex) {
    const root = this._glbRoot
    if (!root) return
    if (this._hatMesh) {
      this._hatMesh.parent?.remove(this._hatMesh)
      this._hatMesh.geometry.dispose()
      this._hatMesh.material.dispose()
      this._hatMesh = null
    }
    if (!hatId) return
    const headBone = root.getObjectByName('Head')
    if (!headBone) return
    const mat = flatMaterial({ color: colorHex, roughness: 0.7 })
    let geo
    if (hatId === 'cap') geo = new THREE.SphereGeometry(0.1, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)
    else if (hatId === 'beanie') geo = new THREE.SphereGeometry(0.095, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6)
    else geo = new THREE.CylinderGeometry(0.11, 0.11, 0.09, 12) // helmet
    const hat = new THREE.Mesh(geo, mat)
    hat.position.set(0, 0.11, 0)
    hat.castShadow = true
    headBone.add(hat)
    this._hatMesh = hat
  }

  _playGlbAction(name, loop) {
    const action = this._glbActions[name]
    if (!action || this._glbCurrentAction === action) return
    action.reset()
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
    action.clampWhenFinished = !loop
    action.fadeIn(0.15)
    if (this._glbCurrentAction) this._glbCurrentAction.fadeOut(0.15)
    action.play()
    this._glbCurrentAction = action
  }

  _buildBodyProcedural() {
    const jacketMat = flatMaterial({ color: 0x2a2f3a, roughness: 0.85 })
    const skinMat = flatMaterial({ color: 0xd8ab7d, roughness: 0.9 })
    const pantsMat = flatMaterial({ color: 0x24241f, roughness: 0.9 })

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.6, 0.26), jacketMat)
    torso.position.y = 1.15
    torso.castShadow = true
    this.group.add(torso)

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 12), skinMat)
    head.position.y = 1.6
    head.castShadow = true
    this.group.add(head)

    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.6, 0.19), pantsMat)
      leg.position.set(side * 0.12, 0.5, 0)
      leg.castShadow = true
      this.group.add(leg)

      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.48, 0.15), jacketMat)
      arm.position.set(side * 0.3, 1.15, 0)
      arm.castShadow = true
      this.group.add(arm)
    }
  }

  // yaw is the horizontal look direction only - pitch is deliberately never
  // applied here so the body stays upright while aiming up/down.
  update(feetX, feetY, feetZ, yaw, visible) {
    this.group.visible = visible
    const now = performance.now()
    const dt = Math.min(0.1, (now - this._lastUpdateAt) / 1000)
    this._lastUpdateAt = now
    if (!visible) return
    this.group.position.set(feetX, feetY, feetZ)
    this.group.rotation.y = yaw

    if (this.usingGLB) {
      const moved = Math.hypot(feetX - this._prevX, feetZ - this._prevZ)
      this._playGlbAction(dt > 0 && moved / dt > 0.3 ? 'walk' : 'idle', true)
      this.mixer.update(dt)
    }
    this._prevX = feetX
    this._prevZ = feetZ
  }
}
