// Constellations and planets (2026-11-09, Gaymi picked both from the
// world/sky idea list). Owned by BuildSky, shown whenever its stars are:
//
// - Constellations: a few star pictures in fixed spots (a zombie head, a
//   sword, a heart, a crown), brighter than the everyday stars. Faint lines
//   join them up while you look up at the sky, and fade when you look
//   back down.
// - Planets: three bright, steady coloured dots (one with a ring) that
//   slowly travel round the sky, a full lap in about half an hour.
//
// Both sit on the stars' big sphere round the camera (just inside it).
import * as THREE from 'three'

const R = 148 // world units; the stars are at 150
const DEG = Math.PI / 180

// Each picture: where it sits (azimuth / elevation in degrees, size in
// degrees per grid step), its stars (grid x, y; 3rd value = brightness)
// and which stars the lines join.
const CONSTELLATIONS = [
  {
    id: 'zombieHead', az: 40, el: 52, step: 3.6,
    stars: [[0, 0, 0.8], [4, 0, 0.8], [4, 4.5, 0.9], [0, 4.5, 0.9], [1, 3, 1], [3, 3, 1], [1, 1, 0.6], [2, 1.4, 0.6], [3, 1, 0.6], [-1, 2, 0.5], [5, 2, 0.5]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [6, 7], [7, 8], [0, 9], [1, 10]],
  },
  {
    id: 'sword', az: 160, el: 38, step: 3.3,
    stars: [[0, 0, 0.7], [0, 1.5, 0.8], [0, 4, 0.8], [0, 7, 1], [-1.4, 1.5, 0.7], [1.4, 1.5, 0.7]],
    lines: [[0, 1], [1, 2], [2, 3], [4, 1], [1, 5]],
  },
  {
    id: 'heart', az: 255, el: 45, step: 3.1,
    stars: [[0, 0, 1], [-2, 2, 0.8], [-2.6, 3.8, 0.8], [-1.3, 4.6, 0.7], [0, 3.6, 0.9], [1.3, 4.6, 0.7], [2.6, 3.8, 0.8], [2, 2, 0.8]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0]],
  },
  {
    id: 'crown', az: 320, el: 28, step: 3.5,
    stars: [[0, 0, 0.7], [5, 0, 0.7], [0, 2.5, 0.9], [1.25, 1.2, 0.6], [2.5, 3, 1], [3.75, 1.2, 0.6], [5, 2.5, 0.9]],
    lines: [[0, 1], [0, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 1]],
  },
]

// The direction for an azimuth / elevation (degrees), on the sphere.
function dirOf(az, el, out = new THREE.Vector3()) {
  return out.set(Math.cos(el * DEG) * Math.cos(az * DEG), Math.sin(el * DEG), Math.cos(el * DEG) * Math.sin(az * DEG))
}

function planetTexture(color, ring) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  // A soft glow, a small bright disc, and maybe a tilted ring.
  const glow = g.createRadialGradient(32, 32, 2, 32, 32, 30)
  glow.addColorStop(0, color)
  glow.addColorStop(0.18, color)
  glow.addColorStop(0.3, 'rgba(255, 255, 255, 0.12)')
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)')
  g.fillStyle = glow
  g.fillRect(0, 0, 64, 64)
  if (ring) {
    g.save()
    g.translate(32, 32)
    g.rotate(-0.35)
    g.scale(1, 0.32)
    g.beginPath()
    g.arc(0, 0, 15, 0, Math.PI * 2)
    g.lineWidth = 3
    g.strokeStyle = 'rgba(255, 236, 190, 0.85)'
    g.stroke()
    g.restore()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// Colour, ring, size (world units), where on its lap it starts, how high
// its path climbs.
const PLANETS = [
  ['#ff8a6a', false, 2.6, 0.2, 34],
  ['#ffe2a0', true, 4.2, 2.3, 48],
  ['#b8d8ff', false, 2.2, 4.4, 26],
]
const PLANET_LAP_S = 1800

export class NightSky {
  constructor(scene) {
    this.group = new THREE.Group()
    this.group.visible = false
    this.group.renderOrder = -2
    scene.add(this.group)
    // Constellation stars and their lines.
    const pos = []
    const look = []
    const seg = []
    const v = new THREE.Vector3()
    for (const c of CONSTELLATIONS) {
      const pts = c.stars.map(([x, y, b]) => {
        const el = c.el + y * c.step
        const az = c.az + (x * c.step) / Math.cos(el * DEG)
        dirOf(az, el, v).multiplyScalar(R)
        pos.push(v.x, v.y, v.z)
        look.push(b, Math.random() * 6)
        return v.clone()
      })
      for (const [a, b] of c.lines) seg.push(pts[a].x, pts[a].y, pts[a].z, pts[b].x, pts[b].y, pts[b].z)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('look', new THREE.Float32BufferAttribute(look, 2))
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { opacity: { value: 0 }, time: { value: 0 }, ratio: { value: 1 } },
      vertexShader: `attribute vec2 look; uniform float time; uniform float ratio; varying float vLight;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (5.0 + look.x * 4.0) * ratio;
          vLight = look.x * (0.85 + 0.15 * sin(time * 2.0 + look.y));
        }`,
      fragmentShader: `uniform float opacity; varying float vLight;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = min(1.0, pow(max(0.0, 1.0 - d), 1.2) * vLight * 1.4) * opacity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(1.0, 0.97, 0.9, a);
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    })
    this.stars = new THREE.Points(geo, this.starMat)
    this.stars.frustumCulled = false
    this.group.add(this.stars)
    const lineGeo = new THREE.BufferGeometry()
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3))
    this.lineMat = new THREE.LineBasicMaterial({ color: 0xbcd4ff, transparent: true, opacity: 0, depthWrite: false, fog: false })
    this.lines = new THREE.LineSegments(lineGeo, this.lineMat)
    this.lines.frustumCulled = false
    this.group.add(this.lines)
    // Planets.
    this.planets = PLANETS.map(([color, ring, size, start, high]) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: planetTexture(color, ring), transparent: true, depthWrite: false, fog: false }))
      s.scale.setScalar(size * 2.4)
      s.userData = { start, high }
      this.group.add(s)
      return s
    })
    this._lap = Math.random()
    this._look = 0
    this._opacity = 0
    this._fwd = new THREE.Vector3()
  }

  // How bright the stars are right now (BuildSky), 0 hides it all.
  setOpacity(o) {
    this._opacity = o
    this.group.visible = o > 0.01
  }

  update(dt, camera, ratio) {
    this.group.position.copy(camera.position)
    if (!this.group.visible) return
    this.starMat.uniforms.time.value += dt
    this.starMat.uniforms.ratio.value = ratio
    this.starMat.uniforms.opacity.value = this._opacity
    // The lines show while you look up at the sky.
    camera.getWorldDirection(this._fwd)
    const goal = THREE.MathUtils.smoothstep(this._fwd.y, 0.2, 0.55)
    this._look += (goal - this._look) * Math.min(1, dt * 2)
    this.lineMat.opacity = this._look * this._opacity * 0.5
    this.lines.visible = this.lineMat.opacity > 0.01
    this._lap += dt / PLANET_LAP_S
    for (const p of this.planets) {
      const a = (this._lap * Math.PI * 2 + p.userData.start)
      // Rises, climbs to its highest, sets - then a stretch under the ground.
      const el = -10 + (p.userData.high + 10) * Math.sin(a)
      dirOf((a * 180) / Math.PI + 90, el, p.position).multiplyScalar(R - 1)
      p.material.opacity = this._opacity * THREE.MathUtils.smoothstep(el, -2, 6)
    }
  }
}

export const CONSTELLATION_COUNT = CONSTELLATIONS.length
