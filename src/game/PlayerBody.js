import * as THREE from 'three'
import { flatMaterial } from './QualitySettings.js'
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
      child.material = child.material.clone()
    })

    this.group.add(cloned)
    this.mixer = new THREE.AnimationMixer(cloned)
    this._glbActions = {}
    for (const clip of _playerBodyModelCache.animations) {
      this._glbActions[clip.name] = this.mixer.clipAction(clip)
    }
    this._glbCurrentAction = null
    this._playGlbAction('idle', true)
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
