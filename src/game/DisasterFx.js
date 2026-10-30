// The pieces natural disasters are drawn with (Disasters.js, 2026-10-30,
// Gaymi: "Must make them look very realistic as they were in real life").
// Everything here works in blocks (x, y, z of the world grid) and scales
// to world units itself (B = one block).
//
// - Emitter: soft particles - billowing smoke and ash, dust, gas, steam,
//   snow powder, flames, embers, sparks. One THREE.Points each, moved on
//   the CPU (a few thousand at most), drawn with a soft cloud picture so a
//   crowd of them reads as one rolling cloud. Smoke is drawn normally,
//   fire and sparks glow (additive).
// - Debris: rocks, clods, snow lumps and burning bombs that fly, fall,
//   bounce and roll over the real blocks, then come to rest (onRest - the
//   disaster may leave a block there). One InstancedMesh.
// - WaterSheet: flood water at a height round a spot - moving ripples, a
//   muddy colour, foam streaks running with the current, fading out at
//   its rim. Blocks poke through it where they're higher.
// - Wave: a tsunami's wall of water - a steep face curling over at a foamy
//   crest, many blocks wide, that rolls in.
// - Aurora: curtains of green light with red-purple tops, waving and
//   rippling high in the night sky.
// - Fireball: a meteor's glowing head with a flaming trail and smoke.
import * as THREE from 'three'

// --- Pictures (drawn once) ---

let puffTex = null
let flameTex = null
function puffTexture() {
  if (puffTex) return puffTex
  const N = 128
  const c = document.createElement('canvas')
  c.width = c.height = N
  const g = c.getContext('2d')
  // A lumpy cloud: lots of soft blobs, thicker in the middle.
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2
    const r = Math.random() * N * 0.2
    const x = N / 2 + Math.cos(a) * r
    const y = N / 2 + Math.sin(a) * r
    const s = N * (0.14 + Math.random() * 0.18)
    const grad = g.createRadialGradient(x, y, 0, x, y, s)
    grad.addColorStop(0, 'rgba(255,255,255,0.32)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, N, N)
  }
  puffTex = new THREE.CanvasTexture(c)
  return puffTex
}
function flameTexture() {
  if (flameTex) return flameTex
  const N = 64
  const c = document.createElement('canvas')
  c.width = c.height = N
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(N / 2, N * 0.6, 0, N / 2, N * 0.55, N * 0.5)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.6)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.beginPath()
  // A teardrop, pointed at the top.
  g.moveTo(N / 2, 0)
  g.quadraticCurveTo(N * 0.95, N * 0.6, N / 2, N)
  g.quadraticCurveTo(N * 0.05, N * 0.6, N / 2, 0)
  g.fill()
  flameTex = new THREE.CanvasTexture(c)
  return flameTex
}

const PARTICLE_VERT = /* glsl */ `
attribute vec4 color;
attribute vec2 sizeSpin;
uniform float uScale;
uniform float uB;
varying vec4 vColor;
varying float vSpin;
void main() {
  vColor = color;
  vSpin = sizeSpin.y;
  vec4 mv = modelViewMatrix * vec4(position * uB, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(sizeSpin.x * uB * uScale / max(0.05, -mv.z), 600.0);
}
`
const PARTICLE_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec4 vColor;
varying float vSpin;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float s = sin(vSpin), co = cos(vSpin);
  vec2 uv = vec2(c.x * co - c.y * s, c.x * s + c.y * co) + 0.5;
  vec4 tex = texture2D(uMap, clamp(uv, 0.0, 1.0));
  float a = tex.a * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}
`

// --- Emitter ---

export class Emitter {
  // opts: max, glow (additive, for fire), flame (teardrop picture).
  constructor(scene, B, opts = {}) {
    this.scene = scene
    this.B = B
    this.max = opts.max || 600
    this.glow = !!opts.glow
    this.list = []
    const geo = new THREE.BufferGeometry()
    this._pos = new Float32Array(this.max * 3)
    this._col = new Float32Array(this.max * 4)
    this._size = new Float32Array(this.max * 2)
    geo.setAttribute('position', new THREE.BufferAttribute(this._pos, 3).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute('color', new THREE.BufferAttribute(this._col, 4).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute('sizeSpin', new THREE.BufferAttribute(this._size, 2).setUsage(THREE.DynamicDrawUsage))
    geo.setDrawRange(0, 0)
    this.uniforms = { uScale: { value: 800 }, uB: { value: B }, uMap: { value: opts.flame ? flameTexture() : puffTexture() } }
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: this.glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: false,
    }))
    this.points.frustumCulled = false
    this.points.renderOrder = this.glow ? 4 : 3
    scene.add(this.points)
  }

  // p: { x, y, z, vx, vy, vz, life, size, grow, color: [r, g, b], alpha,
  //      fadeIn, drag, lift (+ up / - down per s^2), spin, heat }
  // heat: fire - starts white-yellow, goes orange, red, then dark.
  add(p) {
    if (this.list.length >= this.max) this.list.shift()
    p.age = 0
    p.vx ??= 0
    p.vy ??= 0
    p.vz ??= 0
    p.grow ??= 0
    p.drag ??= 0.4
    p.lift ??= 0
    p.alpha ??= 1
    p.fadeIn ??= 0.15
    p.spin = p.spin ?? (Math.random() - 0.5) * 0.6
    p.rot = Math.random() * Math.PI * 2
    p.color ??= [1, 1, 1]
    this.list.push(p)
  }

  update(dt, camera, renderer, wind) {
    const list = this.list
    let n = 0
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      p.age += dt
      if (p.age >= p.life) continue
      const k = Math.exp(-p.drag * dt)
      p.vx = p.vx * k + (wind ? wind.x * (1 - k) : 0)
      p.vz = p.vz * k + (wind ? wind.y * (1 - k) : 0)
      p.vy = p.vy * k + p.lift * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      p.rot += p.spin * dt
      list[n++] = p
      const life = p.age / p.life
      const fade = Math.min(1, p.age / Math.max(0.01, p.fadeIn * p.life)) * (1 - THREE.MathUtils.smoothstep(life, 0.55, 1))
      let r = p.color[0]
      let g = p.color[1]
      let b = p.color[2]
      if (p.heat) {
        // White-hot to yellow to orange to deep red, then smoky.
        const h = life
        r = 1
        g = h < 0.2 ? 0.95 - h * 1.5 : Math.max(0.15, 0.65 - (h - 0.2) * 1.1)
        b = h < 0.12 ? 0.75 - h * 5 : 0.05
        if (h > 0.7) {
          const s = (h - 0.7) / 0.3
          r *= 1 - s * 0.85
          g *= 1 - s * 0.85
        }
      }
      const j = n - 1
      this._pos[j * 3] = p.x
      this._pos[j * 3 + 1] = p.y
      this._pos[j * 3 + 2] = p.z
      this._col[j * 4] = r
      this._col[j * 4 + 1] = g
      this._col[j * 4 + 2] = b
      this._col[j * 4 + 3] = p.alpha * fade
      this._size[j * 2] = p.size + p.grow * p.age
      this._size[j * 2 + 1] = p.rot
    }
    list.length = n
    const geo = this.points.geometry
    geo.setDrawRange(0, n)
    if (n) {
      geo.attributes.position.needsUpdate = true
      geo.attributes.color.needsUpdate = true
      geo.attributes.sizeSpin.needsUpdate = true
      const h = renderer.getDrawingBufferSize(this._v2 || (this._v2 = new THREE.Vector2())).y
      this.uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
    }
    this.points.visible = n > 0
  }

  dispose() {
    this.scene.remove(this.points)
    this.points.geometry.dispose()
    this.points.material.dispose()
  }
}

// --- Debris ---

const ROCK_GEO = new THREE.DodecahedronGeometry(0.5, 0)
const BOX_GEO = new THREE.BoxGeometry(1, 1, 1)

export class Debris {
  // opts: max, shape ('rock' | 'box'), glow (hot - lit from inside).
  constructor(scene, B, opts = {}) {
    this.scene = scene
    this.B = B
    this.list = []
    this.max = opts.max || 80
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: opts.glow ? 0xff5a10 : 0x000000, emissiveIntensity: opts.glow ? 0.9 : 0 })
    this.mesh = new THREE.InstancedMesh(opts.shape === 'box' ? BOX_GEO : ROCK_GEO, mat, this.max)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.setColorAt(0, new THREE.Color())
    scene.add(this.mesh)
    this._m = new THREE.Matrix4()
    this._q = new THREE.Quaternion()
    this._e = new THREE.Euler()
    this._s = new THREE.Vector3()
    this._p = new THREE.Vector3()
    this._c = new THREE.Color()
  }

  // p: { x, y, z, vx, vy, vz, size, color (hex), onRest, roll (slides
  //      on downhill), life }
  add(p) {
    if (this.list.length >= this.max) return
    p.rx = Math.random() * 6
    p.ry = Math.random() * 6
    p.age = 0
    p.life ??= 30
    this.list.push(p)
  }

  // groundAt(x, z, y) -> the top of the ground under (x, y, z), in blocks.
  update(dt, groundAt, hit) {
    let n = 0
    for (const p of this.list) {
      p.age += dt
      if (p.age > p.life || p.resting) {
        if (!p.done) {
          p.done = true
          p.onRest?.(p)
        }
        continue
      }
      p.vy -= 22 * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      const floor = groundAt(p.x, p.z, p.y + 1) + p.size * 0.5
      if (p.y < floor) {
        p.y = floor
        const speed = Math.hypot(p.vx, p.vz)
        if (p.vy < -3) {
          p.vy = -p.vy * 0.35
          p.bounced?.(p)
        } else p.vy = 0
        // Rolling on: lose a little speed each bump, stop when slow.
        const f = Math.exp(-(p.roll ? 0.6 : 2.5) * dt)
        p.vx *= f
        p.vz *= f
        if (speed < 0.6 && Math.abs(p.vy) < 0.5) p.resting = true
      }
      hit?.(p)
      const spin = Math.hypot(p.vx, p.vz) * dt / Math.max(0.2, p.size)
      p.rx += spin
      p.ry += spin * 0.6
      this._e.set(p.rx, p.ry, 0)
      this._q.setFromEuler(this._e)
      this._s.setScalar(p.size * this.B)
      this._p.set(p.x * this.B, p.y * this.B, p.z * this.B)
      this._m.compose(this._p, this._q, this._s)
      this.mesh.setMatrixAt(n, this._m)
      this.mesh.setColorAt(n, this._c.setHex(p.color ?? 0x777777))
      n++
    }
    this.list = this.list.filter((p) => !p.done)
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    return n
  }

  dispose() {
    this.scene.remove(this.mesh)
    this.mesh.material.dispose()
    this.mesh.dispose()
  }
}

// --- Water ---

const WATER_VERT = /* glsl */ `
uniform float uTime;
uniform float uB;
varying vec2 vXZ;
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vXZ = w.xz / uB;
  // Gentle swell.
  w.y += (sin(vXZ.x * 0.6 + uTime * 1.3) * 0.05 + sin(vXZ.y * 0.5 - uTime) * 0.05) * uB;
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uSky;
uniform vec2 uFlow;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uFoam;
uniform float uLight;
varying vec2 vXZ;
varying vec3 vWorld;
float n2(vec2 p) { return sin(p.x) * sin(p.y); }
void main() {
  vec2 q = vXZ - uFlow * uTime;
  // Ripples running with the current, crossing each other.
  float r = n2(q * 1.3) * 0.5 + n2(q * 2.7 + 3.1) * 0.3 + n2(q * 5.3 - 1.7) * 0.2;
  vec3 nrm = normalize(vec3(cos(q.x * 1.3) * 0.25 + r * 0.2, 1.0, cos(q.y * 2.7) * 0.25 - r * 0.2));
  vec3 view = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(0.0, dot(nrm, view)), 3.0);
  vec3 col = mix(uColor, uSky, 0.15 + fres * 0.6);
  // Foam streaks where the water rushes.
  float foam = smoothstep(0.55, 0.85, n2(q * vec2(0.9, 3.5)) * 0.5 + n2(q * 4.1 + 7.0) * 0.5 + 0.3) * uFoam;
  col = mix(col, vec3(0.88, 0.9, 0.86), foam * 0.7);
  float d = length(vXZ - uCenter) / uRadius;
  float a = (0.82 + fres * 0.15) * (1.0 - smoothstep(0.75, 1.0, d));
  gl_FragColor = vec4(col * uLight, a);
}
`

export class WaterSheet {
  constructor(scene, B, color = 0x5d5236) {
    this.B = B
    this.scene = scene
    this.uniforms = {
      uTime: { value: 0 },
      uB: { value: B },
      uColor: { value: new THREE.Color(color) },
      uSky: { value: new THREE.Color(0x8899aa) },
      uFlow: { value: new THREE.Vector2(0, 0) },
      uCenter: { value: new THREE.Vector2() },
      uRadius: { value: 40 },
      uFoam: { value: 0.3 },
      uLight: { value: 1 },
    }
    const geo = new THREE.PlaneGeometry(1, 1, 48, 48)
    geo.rotateX(-Math.PI / 2)
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
      transparent: true, depthWrite: false, fog: false,
    }))
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
    this.mesh.visible = false
    scene.add(this.mesh)
  }

  // At level y (blocks), round (x, z), radius blocks across.
  place(x, z, y, radius) {
    const B = this.B
    this.mesh.position.set(x * B, y * B, z * B)
    this.mesh.scale.set(radius * 2 * B, 1, radius * 2 * B)
    this.uniforms.uCenter.value.set(x, z)
    this.uniforms.uRadius.value = radius
    this.mesh.visible = true
  }

  update(dt, sky, light) {
    this.uniforms.uTime.value += dt
    if (sky) this.uniforms.uSky.value.copy(sky)
    this.uniforms.uLight.value = 0.35 + 0.65 * light
  }

  dispose() {
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}

// A tsunami: a wall of water `width` blocks across, `height` tall, its
// face toward -z of its own frame (turned to face where it's going).
const WAVE_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uLight;
varying vec2 vUv;
varying float vCrest;
float n2(vec2 p) { return sin(p.x) * sin(p.y); }
void main() {
  // Streaks of water running down the face; white water at the crest.
  float streak = n2(vec2(vUv.x * 160.0, vUv.y * 8.0 + uTime * 3.0)) * 0.5 + 0.5;
  vec3 deep = uColor * (0.55 + 0.45 * vUv.y);
  vec3 col = mix(deep, deep * 1.25, streak * 0.4);
  float foam = smoothstep(0.55, 0.95, vCrest + n2(vec2(vUv.x * 90.0 + uTime, uTime * 2.0)) * 0.15);
  col = mix(col, vec3(0.92, 0.95, 0.96), foam);
  float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
  gl_FragColor = vec4(col * uLight, 0.93 * edge);
}
`
const WAVE_VERT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vCrest;
void main() {
  vUv = uv;
  vec3 p = position;
  // The profile: a long back slope up to the crest that hangs forward
  // over a steep face (the curl), wobbling along its length.
  // uv.y runs up the back, over the curling crest and down the face.
  float t = uv.y;
  float wob = 1.0 + sin(uv.x * 40.0 + uTime * 2.0) * 0.03;
  if (t < 0.6) {
    float s = t / 0.6;
    p.y = sin(s * 1.5708);
    p.z = -0.8 * s;
  } else if (t < 0.8) {
    float s = (t - 0.6) / 0.2;
    p.y = 1.0 - 0.15 * s * s;
    p.z = -0.8 - 0.3 * sin(s * 1.5708);
  } else {
    float s = (t - 0.8) / 0.2;
    p.y = 0.85 * (1.0 - s);
    p.z = -1.1 + 0.25 * s;
  }
  p.y *= wob;
  vCrest = smoothstep(0.45, 0.62, t) * (1.0 - smoothstep(0.82, 0.95, t));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`
export class Wave {
  constructor(scene, B, color = 0x2f5560) {
    this.B = B
    this.scene = scene
    const geo = new THREE.PlaneGeometry(1, 1, 120, 24)
    // x across 0..1 -> -0.5..0.5; uv.y is the profile parameter.
    this.uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uLight: { value: 1 } }
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: WAVE_VERT, fragmentShader: WAVE_FRAG,
      transparent: true, side: THREE.DoubleSide, depthWrite: true, fog: false,
    }))
    this.mesh.frustumCulled = false
    this.mesh.visible = false
    scene.add(this.mesh)
  }

  // Its foot at (x, y, z) in blocks, heading along (dx, dz).
  place(x, y, z, dx, dz, width, height) {
    const B = this.B
    this.mesh.position.set(x * B, y * B, z * B)
    this.mesh.rotation.set(0, Math.atan2(dx, dz) + Math.PI, 0)
    this.mesh.scale.set(width * B, height * B, height * B)
    this.mesh.visible = true
  }

  update(dt, sky, light) {
    this.uniforms.uTime.value += dt
    this.uniforms.uLight.value = 0.35 + 0.65 * light
  }

  dispose() {
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}

// --- Aurora ---

const AURORA_VERT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  // The curtain folds and sways.
  p.z += sin(uv.x * 9.0 + uTime * 0.25) * 6.0 + sin(uv.x * 23.0 - uTime * 0.4) * 2.0;
  p.x += sin(uv.x * 5.0 + uTime * 0.15) * 3.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`
const AURORA_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uHue;
varying vec2 vUv;
float h(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float noise(float x) { float i = floor(x); float f = fract(x); return mix(h(i), h(i + 1.0), f * f * (3.0 - 2.0 * f)); }
void main() {
  // Fine vertical rays drifting along, brightest along the lower edge,
  // green below and red-purple at the top, like the real thing.
  float rays = noise(vUv.x * 140.0 + uTime * 0.6) * 0.6 + noise(vUv.x * 37.0 - uTime * 0.3) * 0.6;
  float y = vUv.y;
  float base = smoothstep(0.0, 0.08, y) * (1.0 - smoothstep(0.15, 1.0, y));
  float lower = exp(-pow((y - 0.12) * 9.0, 2.0)) * 0.8;
  vec3 green = mix(vec3(0.15, 1.0, 0.45), vec3(0.2, 0.9, 0.8), uHue);
  vec3 col = mix(green, vec3(0.75, 0.2, 0.75), smoothstep(0.35, 0.9, y));
  float ends = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
  float a = (base * rays + lower * rays) * ends * uAlpha;
  gl_FragColor = vec4(col * a, a);
}
`
export class Aurora {
  constructor(scene) {
    this.scene = scene
    this.group = new THREE.Group()
    this.uniforms = { uTime: { value: 0 }, uAlpha: { value: 0 }, uHue: { value: 0 } }
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: AURORA_VERT, fragmentShader: AURORA_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    })
    // A few curtains, far and high (world units, round the camera).
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.PlaneGeometry(260, 46, 160, 1)
      const m = new THREE.Mesh(geo, mat)
      m.position.set((i - 1) * 30, 62 + i * 8, -90 + i * 35)
      m.rotation.y = (i - 1) * 0.35
      m.rotation.x = -0.25
      this.group.add(m)
    }
    this.group.visible = false
    this.group.renderOrder = -1
    for (const m of this.group.children) {
      m.frustumCulled = false
      m.renderOrder = -1
    }
    scene.add(this.group)
  }

  update(dt, camera, alpha) {
    this.uniforms.uTime.value += dt
    this.uniforms.uAlpha.value = alpha
    this.uniforms.uHue.value = 0.5 + 0.5 * Math.sin(this.uniforms.uTime.value * 0.05)
    this.group.visible = alpha > 0.005
    this.group.position.copy(camera.position)
  }

  dispose() {
    this.scene.remove(this.group)
    for (const m of this.group.children) m.geometry.dispose()
    this.group.children[0]?.material.dispose()
  }
}

// --- Fireball (meteor head) ---

export class Fireball {
  constructor(scene, B, size = 1) {
    this.B = B
    this.scene = scene
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const g = c.getContext('2d')
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.2, 'rgba(255,240,200,0.95)')
    grad.addColorStop(0.45, 'rgba(255,150,60,0.5)')
    grad.addColorStop(1, 'rgba(255,80,20,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
    this.tex = new THREE.CanvasTexture(c)
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }))
    this.sprite.scale.setScalar(size * B * 4)
    this.sprite.renderOrder = 5
    scene.add(this.sprite)
  }

  at(x, y, z, size) {
    this.sprite.position.set(x * this.B, y * this.B, z * this.B)
    if (size) this.sprite.scale.setScalar(size * this.B * 4)
  }

  dispose() {
    this.scene.remove(this.sprite)
    this.sprite.material.dispose()
    this.tex.dispose()
  }
}

// A seeded random (the same disaster looks the same for everyone on a server).
export function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
