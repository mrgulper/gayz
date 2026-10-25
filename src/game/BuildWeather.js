// Real rain and snow in the world (2026-10-17, Gaymi: "it should actually
// be raining, not just raining on my screen"). Used to be flat CSS layers
// over the screen; now the drops and flakes fall through the 3D world
// around you - in front of and behind blocks, past you as you walk - and
// stop at roofs, so it doesn't rain indoors. Owned by BuildSky (which
// still picks the weather and colors the sky), drawn in BuildMode's scene.
//
// Cheap on purpose: one THREE.Points draw call. Every particle has a fixed
// random seed; the vertex shader places it in a box of BOX blocks around
// the camera, wrapped so it stays put in the world as you move, and lets it
// fall with `uTime` - the CPU only sets a few uniforms per frame.
// `uDensity` (0..1) hides particles whose seed is above it, so weather
// fades in and out instead of popping.
//
// Roofs: a ROOF x ROOF grid of the highest block in each column near you
// (a small texture, `uRoof`), rebuilt a few rows per frame (ROOF_ROWS) so
// the scan never stalls a frame; a particle under that height is hidden.
//
// More real (2026-10-25, Gaymi: "for the rain make it look more
// realistic"): drops are thin streaks leaning with the wind, bright at the
// head and fading up the tail, each a slightly different strength; rain
// splashes little rings on the ground (a second THREE.Points, `splash`,
// placed on the roof grid's tops); and the weather leaves the ground wet,
// snowy or covered in hail stones for a while after (`ground`, read by the
// block shader - BlockChunks.js). Potato (setLite) draws half the drops and
// no splashes.
import * as THREE from 'three'
import { ROOF_GRID } from './BlockChunks.js'

const BOX = 34 // blocks across the box of weather around the camera
const BOX_DOWN = 10 // blocks below the eyes it reaches
const BOX_UP = 18 // ...and above
const MAX_PARTICLES = 4800
const ROOF = ROOF_GRID // roof grid, cells across (centred on you)
const ROOF_ROWS = 4 // rows scanned per frame
const ROOF_SCAN_UP = 24 // how far above the eyes a roof can be
const ROOF_SCAN_DOWN = 12
const FADE_SPEED = 0.35 // density per second when weather changes
const SPLASHES = 700
const SPLASH_RATE = 2.4 // each splash ring's lives per second
// How fast the ground gets wet / snowy / hail-covered while it falls, and
// dries / melts afterwards (per second, 0..1).
const WET_IN = 1 / 25
const WET_OUT = 1 / 80
const SNOW_IN = 1 / 70
const SNOW_OUT = 1 / 140
const ICE_IN = 1 / 25
const ICE_OUT = 1 / 45
// Per weather: how many of the particles show, how fast they fall
// (blocks/s), wind drift (blocks/s), size (blocks) and look (0 rain, 1 snow).
const KINDS = {
  lightRain: { density: 0.42, fall: 16, wind: 1.2, size: 0.6, snow: 0 },
  hardRain: { density: 1, fall: 22, wind: 3.2, size: 0.8, snow: 0 },
  lightSnow: { density: 0.45, fall: 1.6, wind: 0.5, size: 0.16, snow: 1 },
  hardSnow: { density: 1, fall: 2.6, wind: 2.2, size: 0.2, snow: 1 },
  // Little ice balls coming down fast (2026-10-25); round like snow.
  hail: { density: 0.75, fall: 19, wind: 1.4, size: 0.13, snow: 1, ice: true },
}

const VERT = /* glsl */ `
uniform float uTime;
uniform float uDensity;
uniform float uFall;
uniform float uWind;
uniform float uSize;
uniform float uSnow;
uniform float uScale;
uniform float uB;
uniform vec3 uCam;
uniform sampler2D uRoof;
uniform vec2 uRoofOrigin;
uniform float uRoofBase;
attribute vec4 seed;
varying float vAlpha;
varying float vStrength;
const float BOX = ${BOX.toFixed(1)};
const float DOWN = ${BOX_DOWN.toFixed(1)};
const float H = ${(BOX_DOWN + BOX_UP).toFixed(1)};
const float ROOF = ${ROOF.toFixed(1)};
void main() {
  vAlpha = 0.0;
  if (seed.w > uDensity) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec3 cam = uCam / uB; // in blocks
  float sway = uSnow * sin(uTime * (0.6 + seed.w) + seed.x * 40.0) * 0.6;
  float fall = uTime * uFall * (0.85 + seed.w * 0.3);
  vec3 p;
  p.x = cam.x + (fract(seed.x - (cam.x - uTime * uWind - sway) / BOX) - 0.5) * BOX;
  p.z = cam.z + (fract(seed.z - cam.z / BOX) - 0.5) * BOX;
  p.y = cam.y - DOWN + fract(seed.y - (cam.y + fall) / H) * H;
  // Under a roof: hidden.
  vec2 cell = floor(p.xz) - uRoofOrigin;
  if (cell.x >= 0.0 && cell.y >= 0.0 && cell.x < ROOF && cell.y < ROOF) {
    float top = texture2D(uRoof, (cell + 0.5) / ROOF).r * 255.0;
    if (top > 0.5 && p.y < uRoofBase + top) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  }
  vec4 mv = modelViewMatrix * vec4(p * uB, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(uSize * uB * uScale / -mv.z, uSnow > 0.5 ? 22.0 : 160.0);
  vStrength = 0.55 + seed.x * 0.45;
  // Fade at the box's edges so it has no hard border, and very close up.
  vec3 d = abs(p - cam) / vec3(BOX * 0.5, H * 0.5, BOX * 0.5);
  float edge = 1.0 - smoothstep(0.7, 1.0, max(d.x, d.z));
  vAlpha = edge * smoothstep(0.4 + (1.0 - uSnow) * 0.8, 1.2 + (1.0 - uSnow) * 1.5, -mv.z / uB);
}
`

const FRAG = /* glsl */ `
uniform float uSnow;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uLean;
varying float vAlpha;
varying float vStrength;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a;
  if (uSnow > 0.5) {
    a = 1.0 - smoothstep(0.25, 0.5, length(c));
  } else {
    // A thin streak leaning with the wind: brightest at the falling head
    // (bottom), fading up its tail.
    float x = c.x + c.y * uLean;
    a = (1.0 - smoothstep(0.012, 0.04, abs(x))) * (1.0 - smoothstep(0.32, 0.5, abs(c.y)));
    a *= 0.35 + 0.65 * smoothstep(-0.5, 0.45, c.y);
  }
  a *= vAlpha * uAlpha * vStrength;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}
`

// Splash rings: each one picks a new random spot in the roof grid every
// life, sits on the top of whatever's there (ground or roof) and grows
// and fades in a fraction of a second.
const SPLASH_VERT = /* glsl */ `
uniform float uTime;
uniform float uDensity;
uniform float uScale;
uniform float uB;
uniform vec3 uCam;
uniform sampler2D uRoof;
uniform vec2 uRoofOrigin;
uniform float uRoofBase;
attribute vec4 seed;
varying float vLife;
varying float vAlpha;
const float ROOF = ${ROOF.toFixed(1)};
void main() {
  vAlpha = 0.0;
  vLife = 0.0;
  float t = uTime * ${SPLASH_RATE.toFixed(2)} + seed.w * 13.0;
  float life = fract(t);
  float n = floor(t);
  vec2 r = fract(seed.xy + vec2(n * 0.6180339, n * 0.3819661));
  float top = texture2D(uRoof, (floor(r * ROOF) + 0.5) / ROOF).r * 255.0;
  if (seed.z > uDensity || top < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec3 p = vec3(uRoofOrigin.x + r.x * ROOF, uRoofBase + top + 0.04, uRoofOrigin.y + r.y * ROOF);
  vec4 mv = modelViewMatrix * vec4(p * uB, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(0.45 * uB * uScale / -mv.z, 48.0);
  vLife = life;
  // Only round you, fading out towards the grid's edge.
  float d = length(p.xz - uCam.xz / uB) / (ROOF * 0.5);
  vAlpha = 1.0 - smoothstep(0.55, 0.95, d);
}
`
const SPLASH_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vLife;
varying float vAlpha;
void main() {
  // A flat ring (squashed, as if lying on the ground) and, at first, a
  // little jump of water in the middle.
  vec2 c = gl_PointCoord - 0.5;
  float d = length(vec2(c.x, c.y * 2.6));
  float ring = 1.0 - smoothstep(0.0, 0.05, abs(d - vLife * 0.45));
  float drop = (1.0 - smoothstep(0.0, 0.08, length(c - vec2(0.0, -0.08 - vLife * 0.25)))) * step(vLife, 0.35);
  float a = max(ring * (1.0 - vLife), drop) * vAlpha * 0.6;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}
`

export class BuildWeather {
  constructor(buildMode, blockSize) {
    this.bm = buildMode
    this.B = blockSize
    this.kind = null // what's falling (or fading out)
    this._target = 0
    this._density = 0
    this._time = 0
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    const count = Math.round(MAX_PARTICLES * (coarse ? 0.55 : 1))
    this._count = count
    // How wet / snowy / hail-covered the open ground is (0..1) - shared
    // with the block shader (BlockChunks fx), as is the roof grid.
    const fx = buildMode._chunks?.fx
    this.ground = fx ? { wet: fx.wet, snow: fx.snow, ice: fx.ice } : { wet: { value: 0 }, snow: { value: 0 }, ice: { value: 0 } }
    const seeds = new Float32Array(count * 4)
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random()
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 4))
    // Positions come from the shader; this only keeps three.js happy.
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    this._roofData = new Uint8Array(ROOF * ROOF)
    this._roofNext = new Uint8Array(ROOF * ROOF)
    this._roofTex = new THREE.DataTexture(this._roofData, ROOF, ROOF, THREE.RedFormat, THREE.UnsignedByteType)
    this._roofTex.needsUpdate = true
    const roof = fx ? fx.roof : { value: null }
    roof.value = this._roofTex
    this.uniforms = {
      uTime: { value: 0 },
      uDensity: { value: 0 },
      uFall: { value: 16 },
      uWind: { value: 1 },
      uSize: { value: 0.5 },
      uSnow: { value: 0 },
      uScale: { value: 800 },
      uB: { value: blockSize },
      uCam: { value: new THREE.Vector3() },
      uRoof: roof,
      uRoofOrigin: fx ? fx.roofOrigin : { value: new THREE.Vector2(1e6, 1e6) },
      uRoofBase: fx ? fx.roofBase : { value: 0 },
      uColor: { value: new THREE.Color(0xaebfd4) },
      uAlpha: { value: 0.5 },
      uLean: { value: 0 },
    }
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, fog: false,
    }))
    this.points.frustumCulled = false
    this.points.visible = false
    this.points.renderOrder = 2
    buildMode.scene.add(this.points)
    const splashSeeds = new Float32Array(SPLASHES * 4)
    for (let i = 0; i < splashSeeds.length; i++) splashSeeds[i] = Math.random()
    const splashGeo = new THREE.BufferGeometry()
    splashGeo.setAttribute('seed', new THREE.BufferAttribute(splashSeeds, 4))
    splashGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPLASHES * 3), 3))
    const u = this.uniforms
    this.splash = new THREE.Points(splashGeo, new THREE.ShaderMaterial({
      uniforms: {
        uTime: u.uTime, uDensity: u.uDensity, uScale: u.uScale, uB: u.uB, uCam: u.uCam,
        uRoof: u.uRoof, uRoofOrigin: u.uRoofOrigin, uRoofBase: u.uRoofBase,
        uColor: { value: new THREE.Color(0xc8d6e6) },
      },
      vertexShader: SPLASH_VERT, fragmentShader: SPLASH_FRAG,
      transparent: true, depthWrite: false, fog: false,
    }))
    this.splash.frustumCulled = false
    this.splash.visible = false
    this.splash.renderOrder = 2
    buildMode.scene.add(this.splash)
    this._lite = false
    this._scanRow = ROOF
    this._scanOrigin = { x: 0, z: 0, y: 0 }
  }

  // 'lightRain' | 'hardRain' | 'lightSnow' | 'hardSnow' | 'hail' | anything else (none).
  set(kind) {
    const k = KINDS[kind] ? kind : null
    if (k === this._want) return
    this._want = k
  }

  // Potato: half the drops, no splashes.
  setLite(on) {
    if (on === this._lite) return
    this._lite = on
    this.points.geometry.setDrawRange(0, on ? Math.round(this._count / 2) : this._count)
  }

  update(dt) {
    // Fade the old weather out before a different one comes in.
    if (this._want !== this.kind) {
      this._density = Math.max(0, this._density - FADE_SPEED * dt * 2)
      if (this._density === 0) {
        this.kind = this._want
        if (this.kind) this._useKind(KINDS[this.kind])
      }
    } else if (this.kind) {
      const goal = KINDS[this.kind].density
      this._density += Math.sign(goal - this._density) * Math.min(Math.abs(goal - this._density), FADE_SPEED * dt)
    }
    const on = !!this.kind && this._density > 0.002
    this.points.visible = on
    this.splash.visible = on && !this._lite && this.kind.endsWith('Rain')
    const groundLeft = this._updateGround(dt)
    if (!on && !groundLeft) {
      this._scanRow = ROOF
      return
    }
    // Still drying or melting: keep the roof grid following you.
    if (!on) {
      this._scanRoofs()
      return
    }
    this._time += dt
    const u = this.uniforms
    u.uTime.value = this._time
    u.uDensity.value = this._density
    const cam = this.bm.camera
    u.uCam.value.copy(cam.position)
    // Point size in pixels at 1 world unit away.
    const h = this.bm.renderer.getDrawingBufferSize(this._size || (this._size = new THREE.Vector2())).y
    u.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2))
    this._scanRoofs()
  }

  // The ground soaks up what's falling and slowly dries / melts after.
  // Returns whether any of it is left.
  _updateGround(dt) {
    const g = this.ground
    const k = this._want === this.kind ? this.kind : null
    const d = KINDS[k] ? this._density / KINDS[k].density : 0
    const rain = k && k.endsWith('Rain') ? d : 0
    const snow = k && k.endsWith('Snow') ? d : 0
    const hail = k === 'hail' ? d : 0
    // Melting snow leaves the ground wet.
    const melting = g.snow.value > 0 && !snow ? 0.5 : 0
    const step = (u, inRate, outRate, amount, goal = 1) => {
      const target = amount > 0 ? goal : 0
      u.value = u.value < target ? Math.min(target, u.value + inRate * amount * dt) : Math.max(target, u.value - outRate * dt)
    }
    step(g.wet, WET_IN, WET_OUT, rain + hail * 0.5 + melting, rain > 0 ? 1 : 0.6)
    step(g.snow, SNOW_IN, SNOW_OUT, snow, k === 'hardSnow' ? 1 : 0.75)
    step(g.ice, ICE_IN, ICE_OUT, hail)
    return g.wet.value + g.snow.value + g.ice.value > 0
  }

  _useKind(k) {
    const u = this.uniforms
    u.uFall.value = k.fall
    u.uWind.value = k.wind
    u.uSize.value = k.size
    u.uSnow.value = k.snow
    u.uColor.value.setHex(k.ice ? 0xdfeaf5 : k.snow ? 0xffffff : 0xaebfd4)
    u.uAlpha.value = k.snow ? 0.9 : 0.6
    // Rain leans with the wind (-: the head trails the tail sideways).
    u.uLean.value = k.snow ? 0 : -Math.min(0.5, k.wind / k.fall * 2)
  }

  // A few rows of the roof grid per frame; when a full pass ends, it goes
  // live and the next pass starts around wherever you are now.
  _scanRoofs() {
    const bm = this.bm
    const B = this.B
    const o = this._scanOrigin
    if (this._scanRow >= ROOF) {
      if (this._scanRow === ROOF && this._scanned) {
        this._roofData.set(this._roofNext)
        this._roofTex.needsUpdate = true
        this.uniforms.uRoofOrigin.value.set(o.x, o.z)
        this.uniforms.uRoofBase.value = o.y
      }
      const p = bm.camera.position
      o.x = Math.floor(p.x / B) - ROOF / 2
      o.z = Math.floor(p.z / B) - ROOF / 2
      // Heights are stored relative to this, below the lowest scanned cell.
      o.y = Math.floor(p.y / B) - ROOF_SCAN_DOWN - 1
      this._scanRow = 0
      this._scanned = true
    }
    const top = o.y + ROOF_SCAN_DOWN + 1 + ROOF_SCAN_UP
    const end = Math.min(ROOF, this._scanRow + ROOF_ROWS)
    for (let r = this._scanRow; r < end; r++) {
      const z = o.z + r
      for (let c = 0; c < ROOF; c++) {
        const x = o.x + c
        let h = 0
        for (let y = top; y > o.y; y--) {
          const type = bm.getBlockAt(x, y, z)
          if (type && type !== 'water' && type !== 'lava') {
            // The block's top face: particles below it are hidden.
            h = y + 1 - o.y
            break
          }
        }
        this._roofNext[r * ROOF + c] = Math.min(255, h)
      }
    }
    this._scanRow = end
  }

  // Leaving the editor: nothing falling next time until the weather says so.
  clear() {
    this._want = null
    this.kind = null
    this._density = 0
    this.points.visible = false
    this.splash.visible = false
    for (const u of Object.values(this.ground)) u.value = 0
    this._scanRow = ROOF
    this._scanned = false
    this.uniforms.uRoofOrigin.value.set(1e6, 1e6)
  }
}
