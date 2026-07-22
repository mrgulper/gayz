import * as THREE from 'three'
import { flatMaterial } from './QualitySettings.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'

// Phase 3 of the 3D asset overhaul - real rigged GLB survivor (Quaternius
// "Worker_Male", asset-source/build-humans.py). Same rig as Companion/
// Rival, but this NPC never moves or re-ticks its mixer after construction
// (see _buildBodyFromGLB) - it's a single frozen pose, not a looping
// animation, since RescueSurvivor.update() is never passed a dt.
export const USE_GLB_SURVIVOR = true
let _survivorModelCache = null

export async function preloadSurvivorModel() {
  try {
    const loader = new GLTFLoader()
    const gltf = await loader.loadAsync('/models/humans/survivor.glb')
    _survivorModelCache = { scene: gltf.scene, animations: gltf.animations }
  } catch (err) {
    console.warn('GLB survivor model failed to load, falling back to procedural survivor', err)
  }
}

// Same rig/raw height as Companion.js's model (same pack, same bounds).
const GLB_SCALE_CORRECTION = 0.556

// A trapped NPC that occasionally appears (see NightEvents.js's
// 'survivor_found' event) - walk up and press interact to rescue them for a
// reward. Purely a stationary interactable, not a companion/combatant.
export class RescueSurvivor {
  constructor(scene, x, z) {
    this.scene = scene
    this.x = x
    this.z = z
    this.group = new THREE.Group()
    this.group.position.set(x, 0, z)
    this._build()
    scene.add(this.group)
  }

  _build() {
    if (USE_GLB_SURVIVOR && _survivorModelCache) {
      this._buildFromGLB()
      return
    }
    this._buildProcedural()
  }

  // "SitDown" is the closest clip this pack has to a trapped/kneeling
  // pose (no literal "kneel" clip) - held frozen at its final frame rather
  // than looped, since this NPC is purely stationary and never re-ticks
  // its mixer (see the module doc comment).
  _buildFromGLB() {
    this.usingGLB = true
    const cloned = cloneSkeleton(_survivorModelCache.scene)
    this.group.scale.setScalar(GLB_SCALE_CORRECTION)

    cloned.traverse((child) => {
      if (!child.isMesh) return
      child.castShadow = true
      child.material = child.material.clone()
    })

    this.group.add(cloned)
    const mixer = new THREE.AnimationMixer(cloned)
    const clip = _survivorModelCache.animations.find((c) => c.name === 'sitdown')
    if (clip) {
      const action = mixer.clipAction(clip)
      action.play()
      mixer.update(clip.duration)
      action.paused = true
    }

    const headBone = cloned.getObjectByName('Head')
    const signalMat = flatMaterial({ color: 0x1a1a10, emissive: 0xffcf5c, emissiveIntensity: 1.2 })
    const signal = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), signalMat)
    signal.position.set(0, 0.35, 0)
    if (headBone) {
      headBone.add(signal)
    } else {
      signal.position.set(0, 1.1 / GLB_SCALE_CORRECTION, 0)
      this.group.add(signal)
    }
    this.signalMat = signalMat
  }

  _buildProcedural() {
    const clothMat = flatMaterial({ color: 0x6b6255, roughness: 0.9 })
    const skinMat = flatMaterial({ color: 0xc9a077, roughness: 0.9 })
    const signalMat = flatMaterial({ color: 0x1a1a10, emissive: 0xffcf5c, emissiveIntensity: 1.2 })

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.26), clothMat)
    torso.position.y = 0.55
    torso.rotation.x = 0.3
    torso.castShadow = true
    this.group.add(torso)

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 12), skinMat)
    head.position.set(0, 0.85, 0.08)
    head.castShadow = true
    this.group.add(head)

    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.4, 0.18), clothMat)
      leg.position.set(side * 0.1, 0.2, 0.15)
      leg.rotation.x = -0.9
      leg.castShadow = true
      this.group.add(leg)
    }

    const signal = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), signalMat)
    signal.position.set(0, 1.1, 0)
    this.group.add(signal)
    this.signalMat = signalMat
  }

  update(elapsed) {
    this.signalMat.emissiveIntensity = 0.8 + Math.sin(elapsed * 3) * 0.4
  }

  dispose() {
    this.scene.remove(this.group)
  }
}
