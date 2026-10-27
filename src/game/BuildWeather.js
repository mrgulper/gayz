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
//
// More real snow and hail (2026-10-26, Gaymi: "make the hail weather the
// snow look more realistic"): flakes come in different sizes, soft and
// fluffy with a brighter middle, drifting and fluttering both ways; hail
// is small hard ice pellets with a short streak behind them that bounce
// off the ground (the splash points jump instead of ringing), and lie
// about as little round stones (BlockChunks).
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
  veryLightRain: { density: 0.18, fall: 14, wind: 0.8, size: 0.5, snow: 0 },
  lightRain: { density: 0.42, fall: 16, wind: 1.2, size: 0.6, snow: 0 },
  mediumRain: { density: 0.7, fall: 19, wind: 2.2, size: 0.7, snow: 0 },
  hardRain: { density: 1, fall: 22, wind: 3.2, size: 0.8, snow: 0 },
  veryLightSnow: { density: 0.2, fall: 1.4, wind: 0.4, size: 0.14, snow: 1 },
  lightSnow: { density: 0.45, fall: 1.6, wind: 0.5, size: 0.16, snow: 1 },
  mediumSnow: { density: 0.72, fall: 2.1, wind: 1.4, size: 0.18, snow: 1 },
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
uniform float uIce;
uniform float uScale;
uniform float uB;
uniform vec3 uCam;
uniform sampler2D uRoof;
uniform vec2 uRoofOrigin;
uniform float uRoofBase;
attribute vec4 seed;
varying float vAlpha;
varying float vStrength;
varying float vSeed;
varying float vPx;
const float BOX = ${BOX.toFixed(1)};
const float DOWN = ${BOX_DOWN.toFixed(1)};
const float H = ${(BOX_DOWN + BOX_UP).toFixed(1)};
const float ROOF = ${ROOF.toFixed(1)};
void main() {
  vAlpha = 0.0;
  if (seed.w > uDensity) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec3 cam = uCam / uB; // in blocks
  // Snowflakes flutter both ways as they drift (hail drops straight);
  // big flakes fall a little faster than small ones.
  float flutter = uSnow * (1.0 - uIce);
  float sway = flutter * (sin(uTime * (0.6 + seed.w) + seed.x * 40.0) * 0.6 + sin(uTime * (1.9 + seed.y * 1.3) + seed.z * 25.0) * 0.18);
  float swayZ = flutter * cos(uTime * (0.5 + seed.y * 0.8) + seed.z * 31.0) * 0.45;
  float fall = uTime * uFall * (0.85 + seed.w * 0.3) * (1.0 + flutter * (seed.z - 0.5) * 0.5);
  vec3 p;
  p.x = cam.x + (fract(seed.x - (cam.x - uTime * uWind - sway) / BOX) - 0.5) * BOX;
  p.z = cam.z + (fract(seed.z - (cam.z - swayZ) / BOX) - 0.5) * BOX;
  p.y = cam.y - DOWN + fract(seed.y - (cam.y + fall) / H) * H;
  // Under a roof: hidden.
  vec2 cell = floor(p.xz) - uRoofOrigin;
  if (cell.x >= 0.0 && cell.y >= 0.0 && cell.x < ROOF && cell.y < ROOF) {
    float top = texture2D(uRoof, (cell + 0.5) / ROOF).r * 255.0;
    if (top > 0.5 && p.y < uRoofBase + top) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  }
  vec4 mv = modelViewMatrix * vec4(p * uB, 1.0);
  gl_Position = projectionMatrix * mv;
  // Flakes come in all sizes; hail pellets need room for their streak.
  float size = uSize * (1.0 + flutter * (seed.z * 1.1 - 0.45)) * (1.0 + uIce * 1.6);
  gl_PointSize = min(size * uB * uScale / -mv.z, uIce > 0.5 ? 34.0 : uSnow > 0.5 ? 40.0 : 160.0);
  vPx = gl_PointSize;
  vStrength = 0.55 + seed.x * 0.45;
  vSeed = seed.y;
  // Fade at the box's edges so it has no hard border, and very close up.
  vec3 d = abs(p - cam) / vec3(BOX * 0.5, H * 0.5, BOX * 0.5);
  float edge = 1.0 - smoothstep(0.7, 1.0, max(d.x, d.z));
  vAlpha = edge * smoothstep(0.4 + (1.0 - uSnow) * 0.8, 1.2 + (1.0 - uSnow) * 1.5, -mv.z / uB);
}
`

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uSnow;
uniform float uIce;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uLean;
varying float vAlpha;
varying float vStrength;
varying float vSeed;
varying float vPx;
// A real six-armed snowflake (2026-10-26, Gaymi: "make real tiny snow
// flake shape snow"): the picture is folded into one 60 degree slice, so
// one arm with two pairs of side branches makes all six; each flake turns
// slowly its own way and has its own branch spacing.
float flake(vec2 c, float seed) {
  float ang = seed * 6.2832 + uTime * (0.4 + seed * 0.8) * (seed > 0.5 ? 1.0 : -1.0);
  vec2 p = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * c;
  float r = length(p);
  float sec = 1.0472;
  float th = mod(atan(p.y, p.x) + sec * 0.5, sec) - sec * 0.5;
  vec2 q = vec2(cos(th), abs(sin(th))) * r;
  float arm = (1.0 - smoothstep(0.016, 0.036, q.y)) * (1.0 - smoothstep(0.42, 0.46, q.x));
  float br = 0.0;
  for (int i = 0; i < 2; i++) {
    float at = 0.17 + float(i) * 0.12 + seed * 0.04;
    float len = 0.13 - float(i) * 0.04;
    vec2 d = q - vec2(at, 0.0);
    float along = dot(d, vec2(0.5, 0.866));
    float off = abs(d.x * 0.866 - d.y * 0.5);
    br = max(br, (1.0 - smoothstep(0.012, 0.03, off)) * step(0.0, along) * (1.0 - smoothstep(len - 0.02, len, along)));
  }
  float core = 1.0 - smoothstep(0.045, 0.075, r);
  // Tiny ice-crystal tips at the arm ends.
  float tip = 1.0 - smoothstep(0.02, 0.04, length(q - vec2(0.42, 0.0)));
  return max(max(arm, br), max(core, tip));
}
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a;
  vec3 col = uColor;
  if (uIce > 0.5) {
    // A hard little ice pellet at the bottom with a faint streak above it
    // (it's falling fast), a bright glint on its top-left.
    vec2 h = c - vec2(c.y * uLean, 0.0) - vec2(0.0, 0.32);
    float head = 1.0 - smoothstep(0.07, 0.11, length(h));
    float tail = (1.0 - smoothstep(0.015, 0.05, abs(h.x))) * smoothstep(-0.5, 0.3, c.y) * step(c.y, 0.32) * 0.3;
    a = max(head, tail);
    col = mix(uColor * 0.85, vec3(1.0), (1.0 - smoothstep(0.0, 0.06, length(h + vec2(0.03, 0.03)))) * head);
  } else if (uSnow > 0.5) {
    // A soft fluffy flake: brighter in the middle, feathered edge, a bit
    // uneven so they don't all look like the same dot.
    float r = length(c * vec2(1.0 + (vSeed - 0.5) * 0.35, 1.0));
    float wob = 0.04 * sin(atan(c.y, c.x) * 5.0 + vSeed * 30.0);
    float soft = min(1.0, pow(1.0 - smoothstep(0.0, 0.47 + wob, r), 1.6) * 1.25);
    // Far flakes are a few pixels - a soft dot; close ones show their
    // six arms with a faint glow round them.
    float shape = max(flake(c, vSeed), soft * 0.22);
    a = mix(soft, shape, smoothstep(7.0, 15.0, vPx));
    col = mix(uColor, vec3(1.0), 0.25 * shape);
  } else {
    // A thin streak leaning with the wind: brightest at the falling head
    // (bottom), fading up its tail.
    // Each drop its own length and thickness, like real rain.
    float x = c.x + c.y * uLean;
    float w = 0.009 + 0.008 * vSeed;
    float len = 0.22 + 0.2 * vSeed;
    a = (1.0 - smoothstep(w, w * 3.2, abs(x))) * (1.0 - smoothstep(len, len + 0.12, abs(c.y)));
    a *= 0.35 + 0.65 * smoothstep(-0.5, 0.45, c.y);
    // Close drops (2026-10-26, Gaymi: "make it water drops way more
    // detailed"): a clear teardrop at the falling end - round at the
    // bottom, pointed on top - with a dark rim, a bright see-through
    // middle and a glint, trailing a fainter streak.
    float near = smoothstep(16.0, 40.0, vPx);
    if (near > 0.0) {
      float rr = 0.034 + 0.02 * vSeed;
      vec2 d = vec2(x, c.y - (len - rr));
      d.y *= d.y < 0.0 ? 0.45 : 1.0;
      float dist = length(d);
      float drop = 1.0 - smoothstep(rr * 0.75, rr, dist);
      float rim = smoothstep(rr * 0.35, rr * 0.85, dist);
      float glint = 1.0 - smoothstep(0.0, rr * 0.35, length(d + vec2(rr * 0.35, rr * 0.3)));
      vec3 dropCol = mix(mix(vec3(0.85, 0.93, 1.0), uColor * 0.55, rim), vec3(1.0), glint);
      float tail = a * mix(1.0, 0.45, near);
      a = max(tail, drop * near * 0.95);
      col = mix(uColor, dropCol, drop * near);
    }
  }
  a *= vAlpha * uAlpha * vStrength;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
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
uniform float uBounce;
varying float vLife;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (uBounce > 0.5) {
    // Hail: a pellet bouncing back up off the ground and dropping again.
    float hop = 4.0 * vLife * (1.0 - vLife);
    float b = 1.0 - smoothstep(0.05, 0.09, length(c - vec2(0.0, 0.42 - hop * 0.55)));
    float ba = b * vAlpha * 0.85 * step(vLife, 0.95);
    if (ba < 0.01) discard;
    gl_FragColor = vec4(uColor, ba);
    return;
  }
  // A flat ring (squashed, as if lying on the ground) and, at first, a
  // little jump of water in the middle.
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
      uIce: { value: 0 },
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
        uBounce: { value: 0 },
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
    // A step up or down the same weather (light rain -> slightly hard
    // rain, BuildSky's ladders): the drops change and the amount eases
    // over. A different weather fades the old one out first.
    if (this._want && this.kind && this._want !== this.kind && KINDS[this._want].snow === KINDS[this.kind].snow && !KINDS[this._want].ice === !KINDS[this.kind].ice) {
      this.kind = this._want
      this._useKind(KINDS[this.kind])
    }
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
    this.splash.visible = on && !this._lite && (this.kind.endsWith('Rain') || this.kind === 'hail')
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
    u.uIce.value = k.ice ? 1 : 0
    u.uColor.value.setHex(k.ice ? 0xd4e3f2 : k.snow ? 0xf7faff : 0xaebfd4)
    u.uAlpha.value = k.ice ? 0.95 : k.snow ? 0.85 : 0.6
    const sp = this.splash.material.uniforms
    sp.uBounce.value = k.ice ? 1 : 0
    sp.uColor.value.setHex(k.ice ? 0xe4eef8 : 0xc8d6e6)
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
