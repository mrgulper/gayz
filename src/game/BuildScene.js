import * as THREE from 'three'
import { BLOCK_SIZE } from './BlockShapes.js'

// Build Mode's scene: sky colour, fog, the sky + sun lights (with shadows)
// and the camera. Moved out of BuildMode's constructor (2026-11-16) as-is:
// setupBuildScene(bm, ...) sets the same bm.scene, bm.sunLight, bm.camera...
// it used to. groundSize is BuildMode's GROUND_SIZE (a cell count).

export function setupBuildScene(bm, game, groundSize) {
  bm.scene = new THREE.Scene()
  bm.scene.background = new THREE.Color(0x87ceeb)
  // Always present (adding/removing fog later would recompile every
  // material); render() keeps its color on the sky and its distance on
  // the view distance.
  bm.scene.fog = new THREE.Fog(0x87ceeb, 1e5, 1e6)

  // Bright, even daylight (2026-09-29, Kirka-style pass) - at 1.2/1.0
  // a flat-lit top face came out at about 60% of its texture color, so
  // every block read dark and muddy. Sides/bottoms get their darker
  // Minecraft-style shading from BlockChunks' per-face shade instead.
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xb8b0a0, 2.0)
  bm.scene.add(hemiLight)
  bm._hemiLight = hemiLight
  const sunLight = new THREE.DirectionalLight(0xfff4e0, 1.5)
  sunLight.position.set(20, 30, 10)
  // Real cast shadows (not just per-face lighting) are what actually
  // reads as "3D" from a distance - a flat-shaded cube and a shadowed
  // one look very different even with the same geometry.
  sunLight.castShadow = true
  // Graphics > Shadow Quality picks the shadow map size (Game.js
  // _applyShadowQuality changes it live).
  const shadowSize = { low: 512, medium: 1024, high: 2048 }[game?.settings?.shadowQuality] || 1024
  sunLight.shadow.mapSize.set(shadowSize, shadowSize)
  bm.sunLight = sunLight
  // groundSize is a cell count, not world units (see its own comment) -
  // the shadow frustum needs to cover the ground's actual physical size.
  const shadowSpan = (groundSize * BLOCK_SIZE) / 2 + 8
  sunLight.shadow.camera.left = -shadowSpan
  sunLight.shadow.camera.right = shadowSpan
  sunLight.shadow.camera.top = shadowSpan
  sunLight.shadow.camera.bottom = -shadowSpan
  sunLight.shadow.camera.near = 1
  sunLight.shadow.camera.far = 100
  // Without a bias, faces at a low angle to the sun shadowed themselves
  // (shadow acne) and read as near-black.
  sunLight.shadow.bias = -0.0005
  sunLight.shadow.normalBias = 0.03
  bm.scene.add(sunLight)
  bm._sunLight = sunLight

  bm.camera = new THREE.PerspectiveCamera(bm._normalFov(), window.innerWidth / window.innerHeight, 0.1, 500)
  // Standing eye height (1.7, matching PlayerController's real-game eye
  // height) rather than floating well above it - the old y=5 spawn made
  // 1-unit blocks read as small/distant the instant Build Mode opened,
  // since everything was seen from a bird's-eye vantage before the
  // player had a chance to fly down to a natural scale reference.
  bm.camera.position.set(0, 1.7, 10)
}
