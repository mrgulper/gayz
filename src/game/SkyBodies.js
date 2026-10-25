// The sun, the moon and the clouds (2026-10-17, Gaymi: "the sky should
// have weather, not sunny all day long, add nights and stuff, also add
// clouds, sun and moon on the sky"). Owned by BuildSky, which tells it the
// time of day (phase: 0 noon, 0.25 sunset, 0.5 midnight, 0.75 sunrise),
// how much of the sky the weather covers and how dark it is.
//
// - Sun and moon: two flat sprites far out (SKY_R) on opposite sides of
//   one arc across the sky, following the camera so they never get closer.
//   Blocks in front hide them like any object; no fog, no lights.
// - Sky: a dome round the camera with a smooth blue fade and a glow
//   round the sun (2026-10-24), drawn behind everything.
// - Clouds: one big flat layer of soft clouds high above the camera,
//   drifting with the wind. It follows the camera but the picture is
//   anchored to the world, so walking under them looks right. Its edge
//   fades out (shader) so you never see where it ends. In bad weather the
//   clouds thicken and turn grey; at night they go dark.
import * as THREE from 'three'

const SKY_R = 140 // world units: just inside the stars (150) and the camera's far plane
const DOME_R = 120 // the sky dome (drawn first, behind everything)
const SUN_SIZE = 64 // the whole glow; the bright disc is about a sixth of it
const MOON_SIZE = 32
const CLOUD_HEIGHT = 24 // world units above the camera
const CLOUD_SIZE = 420 // world units across
const CLOUD_REPEAT = 3 // the picture repeats this many times across
const WIND = 0.6 // world units per second
// Low rain clouds (2026-10-25, Gaymi: "make more clouds and the sky change
// to raining too"): a second, lower, darker layer that rolls in under the
// main one when it's overcast and moves faster, like ragged storm cloud.
const LOW_CLOUD_HEIGHT = 15
const LOW_CLOUD_WIND = 2.2

function canvas(size, draw) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  draw(c.getContext('2d'), size)
  return c
}

// The sun and moon are round and soft (2026-10-24, Gaymi: "everything in
// the sky should not look blocky the sun too").
function sunTexture() {
  const tex = new THREE.CanvasTexture(canvas(256, (g, n) => {
    const c = n / 2
    // A wide faint haze, a brighter glow, then the bright disc.
    const glow = g.createRadialGradient(c, c, 0, c, c, c)
    glow.addColorStop(0, 'rgba(255,250,235,1)')
    glow.addColorStop(0.16, 'rgba(255,246,220,1)')
    glow.addColorStop(0.2, 'rgba(255,232,170,0.75)')
    glow.addColorStop(0.42, 'rgba(255,214,140,0.22)')
    glow.addColorStop(1, 'rgba(255,200,120,0)')
    g.fillStyle = glow
    g.fillRect(0, 0, n, n)
  }))
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// A solar eclipse (BuildSky's rare 'eclipse' weather): the moon's black
// disc over the sun with the thin white corona round it.
function eclipseTexture() {
  const tex = new THREE.CanvasTexture(canvas(256, (g, n) => {
    const c = n / 2
    const r = n * 0.16
    const corona = g.createRadialGradient(c, c, r * 0.95, c, c, c)
    corona.addColorStop(0, 'rgba(255,255,255,0.95)')
    corona.addColorStop(0.08, 'rgba(235,240,255,0.55)')
    corona.addColorStop(0.35, 'rgba(200,215,255,0.12)')
    corona.addColorStop(1, 'rgba(200,215,255,0)')
    g.fillStyle = corona
    g.fillRect(0, 0, n, n)
    g.fillStyle = '#05060a'
    g.beginPath()
    g.arc(c, c, r, 0, Math.PI * 2)
    g.fill()
  }))
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function moonTexture() {
  const tex = new THREE.CanvasTexture(canvas(256, (g, n) => {
    const c = n / 2
    const r = n * 0.2
    // Soft moonlight round it.
    const glow = g.createRadialGradient(c, c, r * 0.9, c, c, c)
    glow.addColorStop(0, 'rgba(210,225,255,0.35)')
    glow.addColorStop(1, 'rgba(210,225,255,0)')
    g.fillStyle = glow
    g.fillRect(0, 0, n, n)
    // The disc, a little darker towards its edge.
    const disc = g.createRadialGradient(c - r * 0.25, c - r * 0.25, r * 0.1, c, c, r)
    disc.addColorStop(0, '#f6f8fc')
    disc.addColorStop(1, '#cfd6e2')
    g.fillStyle = disc
    g.beginPath()
    g.arc(c, c, r, 0, Math.PI * 2)
    g.fill()
    // Soft grey seas and craters.
    g.save()
    g.clip()
    for (const [x, y, w, a] of [[-0.3, -0.25, 0.42, 0.28], [0.2, -0.05, 0.3, 0.22], [-0.05, 0.35, 0.25, 0.2], [0.35, 0.4, 0.14, 0.25], [-0.45, 0.15, 0.16, 0.2]]) {
      const sea = g.createRadialGradient(c + x * r, c + y * r, 0, c + x * r, c + y * r, w * r)
      sea.addColorStop(0, `rgba(120,130,150,${a})`)
      sea.addColorStop(1, 'rgba(120,130,150,0)')
      g.fillStyle = sea
      g.fillRect(0, 0, n, n)
    }
    g.restore()
  }))
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// Soft clouds (2026-10-24, Gaymi: "dont make it blocky ... looks like
// real"): tileable fractal noise - big puffs made of smaller ones - kept
// as a density picture; the shader turns density into fluffy clouds with
// soft edges and greyer, thicker middles (their shaded bellies from below).
function cloudTexture() {
  const N = 256
  let seed = 1234567
  const rnd = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const density = new Float32Array(N * N)
  let total = 0
  // Octaves of smooth value noise that wraps at the edges, so the picture
  // tiles across the sky with no seams.
  for (const [cells, weight] of [[4, 1], [8, 0.55], [16, 0.3], [32, 0.16], [64, 0.08]]) {
    const grid = new Float32Array(cells * cells)
    for (let i = 0; i < grid.length; i++) grid[i] = rnd()
    const at = (x, y) => grid[(y % cells) * cells + (x % cells)]
    for (let y = 0; y < N; y++) {
      const fy = (y / N) * cells
      const y0 = Math.floor(fy)
      const ty = fy - y0
      const sy = ty * ty * (3 - 2 * ty)
      for (let x = 0; x < N; x++) {
        const fx = (x / N) * cells
        const x0 = Math.floor(fx)
        const tx = fx - x0
        const sx = tx * tx * (3 - 2 * tx)
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx
        const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx
        density[y * N + x] += (top + (bottom - top) * sy) * weight
      }
    }
    total += weight
  }
  const c = canvas(N, (g) => {
    const img = g.createImageData(N, N)
    for (let i = 0; i < N * N; i++) {
      const v = Math.round((density[i] / total) * 255)
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
      img.data[i * 4 + 3] = 255
    }
    g.putImageData(img, 0, 0)
  })
  const tex = new THREE.CanvasTexture(c)
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
    this.eclipse = new THREE.Sprite(mat(eclipseTexture()))
    this.eclipse.scale.setScalar(SUN_SIZE * 0.75)
    this.eclipse.renderOrder = 0
    this.eclipse.visible = false
    scene.add(this.eclipse)
    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: cloudTexture() },
        offset: { value: new THREE.Vector2() },
        repeat: { value: CLOUD_REPEAT },
        color: { value: new THREE.Color(1, 1, 1) },
        belly: { value: new THREE.Color(0.75, 0.78, 0.84) },
        cover: { value: 0 },
        opacity: { value: 0.85 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      // Two layers of the same noise at different sizes, drifting apart, so
      // the shapes keep changing; more of the sky is cloud when it's
      // overcast (cover). Thin edges are see-through, thick middles greyer.
      fragmentShader: `uniform sampler2D map; uniform vec2 offset; uniform float repeat; uniform vec3 color; uniform vec3 belly; uniform float cover; uniform float opacity; varying vec2 vUv;
        void main() {
          vec2 p = vUv * repeat + offset;
          float d = texture2D(map, p).r * 0.65 + texture2D(map, p * 2.3 + vec2(0.37, 0.61) - offset * 0.4).r * 0.35;
          float start = 0.5 - cover * 0.4;
          float a = smoothstep(start, start + 0.16, d);
          float thick = smoothstep(start + 0.06, start + 0.3, d);
          float edge = 1.0 - smoothstep(0.15, 0.5, length(vUv - 0.5));
          a *= opacity * edge;
          if (a < 0.01) discard;
          gl_FragColor = vec4(mix(color, belly, thick * 0.8), a);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    // The sky itself: a dome round the camera, deeper blue overhead,
    // the fog's colour at the horizon (so far land fades into it) and a
    // warm glow round the sun - instead of one flat colour.
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: {
        horizon: { value: new THREE.Color() },
        zenith: { value: new THREE.Color() },
        glow: { value: new THREE.Color(1, 0.85, 0.6) },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        glowAmount: { value: 0 },
      },
      vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 horizon; uniform vec3 zenith; uniform vec3 glow; uniform vec3 sunDir; uniform float glowAmount; varying vec3 vDir;
        void main() {
          vec3 dir = normalize(vDir);
          float up = clamp(dir.y, 0.0, 1.0);
          vec3 c = mix(horizon, zenith, pow(up, 0.55));
          float s = max(dot(dir, sunDir), 0.0);
          c += glow * glowAmount * (pow(s, 48.0) * 0.6 + pow(s, 6.0) * 0.18);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    })
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 32, 16), this.domeMat)
    this.dome.frustumCulled = false
    this.dome.renderOrder = -3
    this._zenith = new THREE.Color()
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(CLOUD_SIZE, CLOUD_SIZE), this.cloudMat)
    this.clouds.rotation.x = -Math.PI / 2
    this.clouds.frustumCulled = false
    this.clouds.renderOrder = -1
    this._wind = 0
    this.lowCloudMat = this.cloudMat.clone()
    this.lowCloudMat.uniforms.map.value = this.cloudMat.uniforms.map.value
    this.lowCloudMat.uniforms.repeat.value = CLOUD_REPEAT * 1.6
    this.lowClouds = new THREE.Mesh(this.clouds.geometry, this.lowCloudMat)
    this.lowClouds.rotation.x = -Math.PI / 2
    this.lowClouds.frustumCulled = false
    this.lowClouds.renderOrder = -1
    this.lowClouds.visible = false
    scene.add(this.lowClouds)
    this._lowWind = 0
    this._lite = false
    for (const o of [this.dome, this.sun, this.moon, this.clouds]) {
      o.visible = false
      scene.add(o)
    }
    this._dir = new THREE.Vector3()
  }

  show(on) {
    for (const o of [this.dome, this.sun, this.moon, this.clouds]) o.visible = on
    if (!on) {
      this.eclipse.visible = false
      this.lowClouds.visible = false
    }
  }

  // Potato: no low rain clouds.
  setLite(on) {
    this._lite = on
  }

  // phase: time of day; cover 0-1 how overcast; daylight 0-1 (night 0);
  // sky: the sky/fog colour (BuildSky), the dome's horizon.
  // eclipse: 0-1, how far a solar eclipse has come in.
  update(dt, camera, phase, cover, daylight, sky, eclipse = 0) {
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
    this.eclipse.visible = eclipse > 0.01 && sunUp > 0
    if (this.eclipse.visible) {
      this.eclipse.position.copy(cam).addScaledVector(this._dir, SKY_R - 1)
      this.eclipse.material.opacity = eclipse * sunUp
      this.sun.material.opacity *= 1 - eclipse * 0.7
    }
    // The dome: the horizon is the fog's colour; overhead is a deeper,
    // bluer version of it on a clear day, about the same when overcast.
    if (sky) {
      this.dome.position.copy(cam)
      const u = this.domeMat.uniforms
      u.horizon.value.copy(sky)
      const deep = (1 - cover) * daylight
      u.zenith.value.setRGB(sky.r * (1 - 0.45 * deep), sky.g * (1 - 0.3 * deep), sky.b * (1 - 0.08 * deep))
      u.sunDir.value.copy(this._dir)
      u.glowAmount.value = sunUp * (1 - cover) * (0.35 + 0.65 * daylight) * (1 - eclipse)
    }
    // Clouds: anchored to the world, drifting with the wind.
    this._wind += dt * WIND
    this.clouds.position.set(cam.x, cam.y + CLOUD_HEIGHT, cam.z)
    const u = (cam.x + this._wind) / CLOUD_SIZE * CLOUD_REPEAT
    const v = -cam.z / CLOUD_SIZE * CLOUD_REPEAT
    this.cloudMat.uniforms.offset.value.set(u % 1, v % 1)
    const grey = 1 - cover * 0.55
    const light = 0.18 + 0.82 * daylight
    this.cloudMat.uniforms.color.value.setRGB(grey * light, grey * light, grey * light * (1.02 - 0.05 * daylight))
    this.cloudMat.uniforms.belly.value.setRGB(grey * light * 0.74, grey * light * 0.77, grey * light * 0.84)
    this.cloudMat.uniforms.cover.value = cover
    // Gone at night, so the night sky stays black behind the stars.
    const dayFade = THREE.MathUtils.smoothstep(daylight, 0.15, 0.7)
    this.cloudMat.uniforms.opacity.value = (0.85 + cover * 0.15) * dayFade
    // Low rain clouds: only when it's properly overcast.
    const low = this._lite ? 0 : THREE.MathUtils.smoothstep(cover, 0.5, 0.85)
    this.lowClouds.visible = low > 0.01
    if (this.lowClouds.visible) {
      this._lowWind += dt * LOW_CLOUD_WIND
      this.lowClouds.position.set(cam.x, cam.y + LOW_CLOUD_HEIGHT, cam.z)
      const r = CLOUD_REPEAT * 1.6
      const lu = this.lowCloudMat.uniforms
      lu.offset.value.set(((cam.x + this._lowWind) / CLOUD_SIZE * r + 0.5) % 1, (-cam.z / CLOUD_SIZE * r + 0.25) % 1)
      const dark = grey * light * 0.78
      lu.color.value.setRGB(dark, dark, dark * 1.03)
      lu.belly.value.setRGB(dark * 0.7, dark * 0.72, dark * 0.78)
      lu.cover.value = cover * 0.75
      lu.opacity.value = low * 0.9 * dayFade
    }
  }
}
