// The sun, the moon and the clouds (2026-10-17, Gaymi: "the sky should
// have weather, not sunny all day long, add nights and stuff, also add
// clouds, sun and moon on the sky"). Owned by BuildSky, which tells it the
// time of day (phase: 0 noon, 0.25 sunset, 0.5 midnight, 0.75 sunrise),
// how much of the sky the weather covers and how dark it is.
//
// - Sun and moon: two flat sprites far out (SKY_R) on opposite sides of
//   one arc across the sky, following the camera so they never get closer.
//   Blocks in front hide them like any object; no fog, no lights.
// - Clouds: one big flat layer of blocky clouds high above the camera,
//   drifting with the wind. It follows the camera but the picture is
//   anchored to the world, so walking under them looks right. Its edge
//   fades out (shader) so you never see where it ends. In bad weather the
//   clouds thicken and turn grey; at night they go dark.
import * as THREE from 'three'

const SKY_R = 140 // world units: just inside the stars (150) and the camera's far plane
const SUN_SIZE = 30
const MOON_SIZE = 20
const CLOUD_HEIGHT = 24 // world units above the camera
const CLOUD_SIZE = 420 // world units across
const CLOUD_REPEAT = 3 // the picture repeats this many times across
const WIND = 0.6 // world units per second

function canvas(size, draw) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  draw(c.getContext('2d'), size)
  return c
}

function sunTexture() {
  const tex = new THREE.CanvasTexture(canvas(64, (g) => {
    const glow = g.createRadialGradient(32, 32, 6, 32, 32, 32)
    glow.addColorStop(0, 'rgba(255,240,190,0.9)')
    glow.addColorStop(1, 'rgba(255,200,120,0)')
    g.fillStyle = glow
    g.fillRect(0, 0, 64, 64)
    // A square, pixel-art sun in the middle of its glow.
    g.fillStyle = '#fff6c8'
    g.fillRect(20, 20, 24, 24)
    g.fillStyle = '#ffe680'
    g.fillRect(22, 22, 20, 20)
  }))
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function moonTexture() {
  const tex = new THREE.CanvasTexture(canvas(32, (g) => {
    g.fillStyle = '#e8ecf4'
    g.fillRect(6, 6, 20, 20)
    // A few darker craters.
    g.fillStyle = '#b8c0cf'
    for (const [x, y, w] of [[10, 10, 4], [18, 14, 5], [12, 19, 3], [20, 8, 2]]) g.fillRect(x, y, w, w)
  }))
  tex.magFilter = THREE.NearestFilter
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// Blocky clouds: a seeded random grid of cells grown into clumps.
function cloudTexture() {
  const N = 64
  let seed = 1234567
  const rnd = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const on = new Uint8Array(N * N)
  for (let i = 0; i < 26; i++) {
    const cx = Math.floor(rnd() * N)
    const cy = Math.floor(rnd() * N)
    const w = 3 + Math.floor(rnd() * 7)
    const h = 2 + Math.floor(rnd() * 4)
    for (let k = 0; k < 3; k++) {
      const ox = Math.floor((rnd() - 0.5) * w)
      const oy = Math.floor((rnd() - 0.5) * h)
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) on[((cy + oy + y + N) % N) * N + ((cx + ox + x + N) % N)] = 1
    }
  }
  const c = canvas(N, (g) => {
    const img = g.createImageData(N, N)
    for (let i = 0; i < N * N; i++) {
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255
      img.data[i * 4 + 3] = on[i] ? 230 : 0
    }
    g.putImageData(img, 0, 0)
  })
  const tex = new THREE.CanvasTexture(c)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

export class SkyBodies {
  constructor(scene) {
    this.scene = scene
    const mat = (map) => new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: false })
    this.sun = new THREE.Sprite(mat(sunTexture()))
    this.sun.scale.setScalar(SUN_SIZE)
    this.moon = new THREE.Sprite(mat(moonTexture()))
    this.moon.scale.setScalar(MOON_SIZE)
    this.sun.renderOrder = this.moon.renderOrder = -1
    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: cloudTexture() },
        offset: { value: new THREE.Vector2() },
        repeat: { value: CLOUD_REPEAT },
        color: { value: new THREE.Color(1, 1, 1) },
        opacity: { value: 0.85 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D map; uniform vec2 offset; uniform float repeat; uniform vec3 color; uniform float opacity; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(map, vUv * repeat + offset);
          float edge = 1.0 - smoothstep(0.38, 0.5, length(vUv - 0.5));
          float a = c.a * opacity * edge;
          if (a < 0.01) discard;
          gl_FragColor = vec4(color, a);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(CLOUD_SIZE, CLOUD_SIZE), this.cloudMat)
    this.clouds.rotation.x = -Math.PI / 2
    this.clouds.frustumCulled = false
    this.clouds.renderOrder = -1
    this._wind = 0
    for (const o of [this.sun, this.moon, this.clouds]) {
      o.visible = false
      scene.add(o)
    }
    this._dir = new THREE.Vector3()
  }

  show(on) {
    for (const o of [this.sun, this.moon, this.clouds]) o.visible = on
  }

  // phase: time of day; cover 0-1 how overcast; daylight 0-1 (night 0).
  update(dt, camera, phase, cover, daylight) {
    if (!this.clouds.visible) return
    const cam = camera.position
    // One arc: high overhead at noon (phase 0), down in the west at
    // sunset, under the ground at midnight - the moon opposite.
    const a = phase * Math.PI * 2
    this._dir.set(Math.sin(a) * 0.95, Math.cos(a), 0.3).normalize()
    this.sun.position.copy(cam).addScaledVector(this._dir, SKY_R)
    this.moon.position.copy(cam).addScaledVector(this._dir, -SKY_R)
    // Behind the clouds in bad weather; gone below the horizon.
    const sunUp = THREE.MathUtils.smoothstep(this._dir.y, -0.08, 0.08)
    const moonUp = THREE.MathUtils.smoothstep(-this._dir.y, -0.08, 0.08)
    this.sun.material.opacity = sunUp * (1 - cover * 0.85)
    this.moon.material.opacity = moonUp * (1 - cover * 0.85)
    // Clouds: anchored to the world, drifting with the wind.
    this._wind += dt * WIND
    this.clouds.position.set(cam.x, cam.y + CLOUD_HEIGHT, cam.z)
    const u = (cam.x + this._wind) / CLOUD_SIZE * CLOUD_REPEAT
    const v = -cam.z / CLOUD_SIZE * CLOUD_REPEAT
    this.cloudMat.uniforms.offset.value.set(u % 1, v % 1)
    const grey = 1 - cover * 0.45
    const light = 0.18 + 0.82 * daylight
    this.cloudMat.uniforms.color.value.setRGB(grey * light, grey * light, grey * light * (1.02 - 0.05 * daylight))
    this.cloudMat.uniforms.opacity.value = 0.9 + cover * 0.1
  }
}
