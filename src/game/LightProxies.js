import * as THREE from 'three'

// Fixed-size point-light pool that stands in for every PointLight in the
// scene at render time.
//
// Why: three.js forward rendering compiles the number of visible point
// lights into every lit material's shader, and every lit pixel then loops
// over ALL of them - including the ones at intensity 0. Measured
// 2026-09-28: 96 PointLights in the main scene (36 streetlamp/flicker
// lights, the 20-slot FX pool, ~40 static lamps/beacons/lanterns across
// World.js, the muzzle flash, companion beacons), so every pixel of every
// frame evaluated 96 lights even though only the handful nearest the
// player could visibly matter. That's pure GPU fill cost on the kind of
// laptop/integrated GPU this game actually gets played on.
//
// How: every "source" PointLight is moved to SOURCE_LAYER, which no camera
// renders - it stays in the scene graph, keeps its parent/transform, and
// every existing bit of code that animates it (flicker, FX pool acquire/
// release, muzzle flash, _restoreTunnelPower, pulsing beacons...) keeps
// writing to it exactly as before, it just never reaches the renderer's
// light list. Each frame, update() copies the nearest `count` lit sources'
// world position/color/intensity/distance/decay onto `count` proxy lights
// that ARE rendered. The proxies are added once and stay visible forever,
// so the compiled light count never changes (see CLAUDE.md's "never add/
// remove/toggle a Light" rule - this keeps it, and also means a light
// created mid-run, like a recruit's downed beacon, no longer triggers a
// shader recompile as long as it's put on SOURCE_LAYER at creation via
// markLightSource()).
export const LIGHT_SOURCE_LAYER = 30
const SOURCE_LAYER_MASK = (1 << LIGHT_SOURCE_LAYER) >>> 0

export function markLightSource(light) {
  light.layers.set(LIGHT_SOURCE_LAYER)
  return light
}

const RESCAN_INTERVAL_FRAMES = 60

export class LightProxyPool {
  constructor(scene, count) {
    this.scene = scene
    this.proxies = []
    this.sources = []
    this._candidates = []
    this._frame = 0
    for (let i = 0; i < count; i++) {
      const proxy = new THREE.PointLight(0xffffff, 0, 1, 2)
      proxy.__isLightProxy = true
      scene.add(proxy)
      this.proxies.push(proxy)
    }
    this.rescan()
  }

  // Rebuilds the source list from whatever PointLights are in the scene
  // right now. Periodic rather than event-driven so nothing that creates or
  // disposes a light has to know this pool exists; a culled (detached)
  // group's lights simply drop out until it's re-attached. Anything found
  // still on the default layer (created without markLightSource) gets moved
  // to SOURCE_LAYER here - correct, just with one recompile when it was
  // first added, same as before this pool existed.
  rescan() {
    const sources = this.sources
    sources.length = 0
    this.scene.traverse((obj) => {
      if (!obj.isPointLight || obj.__isLightProxy) return
      if (obj.layers.mask !== SOURCE_LAYER_MASK) obj.layers.set(LIGHT_SOURCE_LAYER)
      sources.push(obj)
    })
  }

  _inScene(obj) {
    let o = obj
    while (o) {
      if (!o.visible) return false
      if (o === this.scene) return true
      o = o.parent
    }
    return false
  }

  // viewPos: the camera's world position. maxDist: how far (from the light's
  // own edge of influence) a source may be and still get a proxy.
  update(viewPos, maxDist) {
    if (++this._frame % RESCAN_INTERVAL_FRAMES === 0) this.rescan()
    const candidates = this._candidates
    candidates.length = 0
    for (const light of this.sources) {
      if (!(light.intensity > 0) || !this._inScene(light)) continue
      const e = light.matrixWorld.elements
      const dx = e[12] - viewPos.x
      const dy = e[13] - viewPos.y
      const dz = e[14] - viewPos.z
      const distSq = dx * dx + dy * dy + dz * dz
      const reach = maxDist + (light.distance > 0 ? light.distance : maxDist)
      if (distSq > reach * reach) continue
      light.__proxyDistSq = distSq
      candidates.push(light)
    }
    if (candidates.length > this.proxies.length) candidates.sort((a, b) => a.__proxyDistSq - b.__proxyDistSq)
    for (let i = 0; i < this.proxies.length; i++) {
      const proxy = this.proxies[i]
      const src = candidates[i]
      if (!src) {
        proxy.intensity = 0
        continue
      }
      const e = src.matrixWorld.elements
      proxy.position.set(e[12], e[13], e[14])
      proxy.color.copy(src.color)
      proxy.intensity = src.intensity
      proxy.distance = src.distance
      proxy.decay = src.decay
    }
  }
}
