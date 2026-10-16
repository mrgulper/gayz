// Skeleton enemies' bodies (2026-10-16, "use real 3D models ... for ingame
// sounds good too"): KayKit Character Pack: Skeletons by Kay Lousberg (CC0,
// public/models/skeletons/LICENSE.txt) - rigged, animated low-poly
// skeletons that join the zombie waves in Zombie Survival (BuildSurvival).
//
// The four bodies share one rig, so the animations live only in the
// Minion's file and every kind plays them. The files went through
// gltf-transform first: only the clips below kept, the 1024px colour
// gradient shrunk to 128px (87 KB of GPU memory instead of 5.6 MB) and
// meshopt compression - 868 KB for all four.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

// hp / speed / damage are multipliers on the wave's zombie numbers.
export const SKELETON_KINDS = {
  minion: { hp: 0.7, speed: 1.15, damage: 0.8 },
  rogue: { hp: 0.8, speed: 1.35, damage: 0.9 },
  warrior: { hp: 1.8, speed: 0.85, damage: 1.4 },
  mage: { hp: 1.1, speed: 1, damage: 1.2 },
}

export const CLIPS = {
  rise: 'Spawn_Ground_Skeletons',
  walk: 'Walking_D_Skeletons',
  run: 'Running_A',
  attack: 'Unarmed_Melee_Attack_Punch_A',
  hit: 'Hit_A',
  death: 'Death_C_Skeletons',
  idle: 'Idle',
}

// The models are this tall (model units) - scaled to the zombie's height.
const MODEL_HEIGHT = 2.17

const templates = {}
let clips = null
let loading = null

export function skeletonsReady() {
  return !!clips && Object.keys(SKELETON_KINDS).every((k) => templates[k])
}

// Loads all four (once). Resolves true when they can be made.
export function loadSkeletons() {
  if (loading) return loading
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  loading = Promise.all(Object.keys(SKELETON_KINDS).map((kind) => loader.loadAsync(`/models/skeletons/skeleton_${kind}.glb`).then((gltf) => {
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return
      // Lambert like the block world (no environment map here, and
      // cheaper); the glowing eyes stay bright.
      const old = o.material
      o.material = old.name === 'Glow'
        ? new THREE.MeshBasicMaterial({ color: old.emissive?.getHex?.() || 0x9fe8ff })
        : new THREE.MeshLambertMaterial({ map: old.map, color: old.color })
      old.dispose()
      o.frustumCulled = false
    })
    templates[kind] = gltf.scene
    if (gltf.animations.length) clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c]))
  }))).then(() => skeletonsReady()).catch(() => {
    loading = null
    return false
  })
  return loading
}

// A new animated skeleton, `height` world units tall, feet at y = 0, facing
// +z. play(name, { once, duration }) cross-fades to one of CLIPS; update(dt) steps it.
export function makeSkeleton(kind, height) {
  const template = templates[kind] || templates.minion
  const root = cloneSkinned(template)
  // Its own material copies (the hit flash tints them).
  const materials = []
  root.traverse((o) => {
    if (!o.isMesh) return
    o.material = o.material.clone()
    materials.push(o.material)
  })
  root.scale.setScalar(height / MODEL_HEIGHT)
  const holder = new THREE.Group()
  holder.add(root)
  const mixer = new THREE.AnimationMixer(root)
  let current = null
  let currentName = ''
  // duration: play the whole clip in this many seconds.
  const play = (name, { once = false, fade = 0.2, timeScale = 1, duration = 0 } = {}) => {
    const clip = clips?.[CLIPS[name] || name]
    if (!clip) return 0
    if (duration) timeScale = clip.duration / duration
    if (currentName === name && !once) {
      current.timeScale = timeScale
      return clip.duration
    }
    const action = mixer.clipAction(clip)
    action.reset()
    action.timeScale = timeScale
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity)
    action.clampWhenFinished = once
    if (current && current !== action) action.crossFadeFrom(current, fade, false)
    action.play()
    current = action
    currentName = name
    return clip.duration / timeScale
  }
  return {
    kind,
    root: holder,
    materials,
    play,
    get playing() { return currentName },
    update: (dt) => mixer.update(dt),
    dispose() {
      mixer.stopAllAction()
      mixer.uncacheRoot(root)
      // Geometry and the texture belong to the shared template.
      for (const m of materials) m.dispose()
    },
  }
}
