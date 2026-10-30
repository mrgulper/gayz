// Lightning up in the sky (2026-10-30, Gaymi: "for the thunderstorm i see
// in rain make them in sky not just in front of you also add softer
// lightning with hard lightning"). Owned by BuildSky, drawn in BuildMode's
// scene.
//
// - Hard lightning: a real forked bolt from the cloud base down to the
//   ground somewhere round you - a jagged main channel (midpoint
//   displacement) with a few thinner branches, a white-hot core inside a
//   violet glow. It flickers the way real strokes do (bright, dark, bright
//   again, fading), lights the whole sky up, and the thunder comes a
//   moment later - later and duller the farther away it hit.
// - Soft lightning: a flash inside the clouds - the sky glows for a
//   moment, sometimes with a faint "spider" streak crawling sideways
//   along the cloud base - and only a long low rumble follows.
//
// Each bolt is one mesh of flat ribbons turned to face you when it's made
// (it only lives half a second), with additive blending so it glows.
import * as THREE from 'three'

const LIFE = 0.75 // seconds a bolt shows
const MAX_BOLTS = 4
// Real strokes: the brightness over a bolt's life (time, brightness).
const PULSES = [[0, 1], [0.06, 1], [0.09, 0.12], [0.13, 0.95], [0.19, 0.25], [0.24, 0.75], [0.34, 0.5], [LIFE, 0]]

const VERT = /* glsl */ `
attribute float aSide;
attribute float aBright;
varying float vSide;
varying float vBright;
void main() {
  vSide = aSide;
  vBright = aBright;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const FRAG = /* glsl */ `
uniform float uBright;
uniform float uBranch;
varying float vSide;
varying float vBright;
void main() {
  float s = abs(vSide);
  // A thin white-hot core in a soft violet-blue glow.
  float core = 1.0 - smoothstep(0.1, 0.28, s);
  float glow = pow(1.0 - s, 2.5) * 0.6;
  float b = vBright < 0.99 ? vBright * uBranch : vBright;
  vec3 col = mix(vec3(0.62, 0.62, 1.0) * glow, vec3(1.0, 0.98, 1.0), core);
  float a = (core + glow) * b * uBright;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col * a, a);
}
`

function pulse(t) {
  for (let i = 1; i < PULSES.length; i++) {
    const [t1, b1] = PULSES[i]
    if (t <= t1) {
      const [t0, b0] = PULSES[i - 1]
      return b0 + (b1 - b0) * ((t - t0) / Math.max(1e-6, t1 - t0))
    }
  }
  return 0
}

// A jagged path from a to b: each segment's middle pushed sideways by up
// to `rough` of its length, `depth` times over.
function jag(a, b, depth, rough, rand) {
  let pts = [a.clone(), b.clone()]
  for (let d = 0; d < depth; d++) {
    const next = [pts[0]]
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1]
      const q = pts[i]
      const len = p.distanceTo(q)
      const mid = p.clone().lerp(q, 0.4 + rand() * 0.2)
      mid.x += (rand() - 0.5) * len * rough
      mid.z += (rand() - 0.5) * len * rough
      mid.y += (rand() - 0.5) * len * rough * 0.3
      next.push(mid, q)
    }
    pts = next
  }
  return pts
}

export class SkyLightning {
  constructor(scene) {
    this.scene = scene
    this.bolts = []
    this.flash = 0 // how lit up the sky is right now (0..)
    this._flashes = [] // [age, strength, length (s)] for each glow in the clouds
    this._tmp = new THREE.Vector3()
  }

  // A strike round the camera (world units). hard: a bolt to the ground,
  // else a flash in the clouds. groundAt(x, z) -> the ground's height
  // there. Returns { dist (world units), delay } for the thunder.
  // at: { x, z } to strike one spot.
  strike(cam, hard, groundAt, rand = Math.random, at = null) {
    const ang = rand() * Math.PI * 2
    const dist = at ? Math.hypot(at.x - cam.x, at.z - cam.z) : hard ? 18 + rand() * 90 : 30 + rand() * 110
    const x = at ? at.x : cam.x + Math.cos(ang) * dist
    const z = at ? at.z : cam.z + Math.sin(ang) * dist
    const cloud = cam.y + 13 + rand() * 6
    if (hard) {
      const ground = groundAt(x, z)
      this._addBolt(new THREE.Vector3(x + (rand() - 0.5) * 8, cloud, z + (rand() - 0.5) * 8), new THREE.Vector3(x, ground, z), cam, rand, 1)
      this._flashes.push([0, 1.15 - Math.min(0.6, dist / 200), LIFE])
    } else {
      // Now and then a faint streak crawls along the cloud base.
      if (rand() < 0.45) {
        const a2 = ang + (rand() - 0.5) * 1.2
        const len = 20 + rand() * 30
        this._addBolt(new THREE.Vector3(x, cloud, z), new THREE.Vector3(x + Math.cos(a2) * len, cloud - 1 - rand() * 2, z + Math.sin(a2) * len), cam, rand, 0.4)
      }
      this._flashes.push([0, 0.35 + rand() * 0.2, LIFE * 1.6])
    }
    return { dist }
  }

  // The sky lights up without a bolt (a meteor, a volcano's lightning).
  addFlash(strength) {
    this._flashes.push([0, strength, LIFE * 2])
  }

  _addBolt(top, bottom, cam, rand, bright) {
    if (this.bolts.length >= MAX_BOLTS) this._drop(this.bolts.shift())
    const pos = []
    const side = []
    const lum = []
    const height = top.distanceTo(bottom)
    const ribbon = (pts, width, b) => {
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1]
        const q = pts[i]
        const dir = this._tmp.subVectors(q, p)
        const toCam = new THREE.Vector3().subVectors(cam, p)
        const across = new THREE.Vector3().crossVectors(dir, toCam).normalize().multiplyScalar(width)
        const corners = [p.clone().sub(across), p.clone().add(across), q.clone().add(across), q.clone().sub(across)]
        for (const k of [0, 1, 2, 0, 2, 3]) {
          pos.push(corners[k].x, corners[k].y, corners[k].z)
          side.push(k === 0 || k === 3 ? -1 : 1)
          lum.push(b)
        }
      }
    }
    const main = jag(top, bottom, 6, 0.55, rand)
    // Sized by distance so a far bolt still shows a few pixels of white
    // core in its glow, like a real one does.
    const width = Math.max(0.15, top.distanceTo(cam) * 0.014)
    ribbon(main, width, bright)
    // Branches off the upper two thirds, thinner and fainter, angling down.
    const branches = 2 + Math.floor(rand() * 4)
    for (let i = 0; i < branches; i++) {
      const start = main[Math.floor(rand() * main.length * 0.66)]
      const len = height * (0.15 + rand() * 0.3)
      const a = rand() * Math.PI * 2
      const end = start.clone().add(new THREE.Vector3(Math.cos(a) * len * 0.6, -len, Math.sin(a) * len * 0.6))
      ribbon(jag(start, end, 4, 0.6, rand), width * 0.55, 0.6 * bright)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1))
    geo.setAttribute('aBright', new THREE.Float32BufferAttribute(lum, 1))
    const mat = new THREE.ShaderMaterial({
      uniforms: { uBright: { value: 1 }, uBranch: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.frustumCulled = false
    mesh.renderOrder = 1
    this.scene.add(mesh)
    this.bolts.push({ mesh, age: 0, bright })
  }

  _drop(bolt) {
    this.scene.remove(bolt.mesh)
    bolt.mesh.geometry.dispose()
    bolt.mesh.material.dispose()
  }

  update(dt) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]
      b.age += dt
      if (b.age >= LIFE) {
        this._drop(b)
        this.bolts.splice(i, 1)
        continue
      }
      const u = b.mesh.material.uniforms
      u.uBright.value = pulse(b.age) * (b.bright < 1 ? 0.6 : 1)
      // Branches die away before the main channel.
      u.uBranch.value = Math.max(0, 1 - b.age / 0.3)
    }
    let flash = 0
    for (let i = this._flashes.length - 1; i >= 0; i--) {
      const f = this._flashes[i]
      f[0] += dt
      if (f[0] >= f[2]) {
        this._flashes.splice(i, 1)
        continue
      }
      flash += pulse((f[0] / f[2]) * LIFE) * f[1]
    }
    this.flash = flash
  }

  clear() {
    for (const b of this.bolts) this._drop(b)
    this.bolts = []
    this._flashes = []
    this.flash = 0
  }
}
