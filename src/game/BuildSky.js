// Time of day and weather in the Map Editor and Try Map (2026-10-04).
// Owned by BuildMode (`buildMode.sky`), changed from the pause screen's
// Time and Weather buttons, remembered per device.
//
// Day, Sunset and Night each set the sky color and the two lights the
// editor already has (no lights are ever added - see CLAUDE.md); Cycle
// runs through all of them in CYCLE_SECONDS. At night the sun turns into a
// dim blue moonlight and stars come out, and glowing blocks stand out
// since their light is baked into the blocks around them.
//
// Rain and snow are particles falling around the camera. A drop that
// lands in a block starts again at the top, so it doesn't rain indoors.
import * as THREE from 'three'
import { t } from './i18n.js'

export const SKY_TIMES = ['day', 'sunset', 'night', 'cycle']
export const SKY_WEATHERS = ['clear', 'rain', 'snow']
const CYCLE_SECONDS = 600
const PREF_KEY = 'buildmode-sky'
const PARTICLES = 1400
const AREA = 10 // world units around the camera (a block is 0.35)
const HEIGHT = 9
const STREAK = 0.3 // how long a raindrop looks
// [sky color, hemisphere color, hemisphere intensity, sun color, sun
// intensity, sun height (0-1)]
const LOOKS = {
  day: [0x87ceeb, 0xffffff, 2.0, 0xfff4e0, 1.5, 1],
  sunset: [0xf0956a, 0xffd6b0, 1.35, 0xff9850, 1.05, 0.25],
  night: [0x0a1028, 0x8a9fd6, 0.6, 0x9fb4ff, 0.28, 0.8],
}

export class BuildSky {
  constructor(buildMode, blockSize) {
    this.bm = buildMode
    this.B = blockSize
    this.time = 'day'
    this.weather = 'clear'
    this._clock = 0
    try {
      const saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}')
      if (SKY_TIMES.includes(saved.time)) this.time = saved.time
      if (SKY_WEATHERS.includes(saved.weather)) this.weather = saved.weather
    } catch {
      // Nothing saved yet.
    }
    this._sky = new THREE.Color()
    this._a = new THREE.Color()
    this._b = new THREE.Color()
    this._lastShadowAt = 0
    this._buildStars()
    this._buildParticles()
    document.getElementById('build-mode-time-btn')?.addEventListener('click', () => this.cycleTime())
    document.getElementById('build-mode-weather-btn')?.addEventListener('click', () => this.cycleWeather())
    this.apply()
  }

  cycleTime() {
    this.time = SKY_TIMES[(SKY_TIMES.indexOf(this.time) + 1) % SKY_TIMES.length]
    this._clock = 0
    this._save()
    this.apply()
  }

  cycleWeather() {
    this.weather = SKY_WEATHERS[(SKY_WEATHERS.indexOf(this.weather) + 1) % SKY_WEATHERS.length]
    this._save()
    this.apply()
  }

  _save() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ time: this.time, weather: this.weather }))
    } catch {
      // Storage full - it just won't be remembered.
    }
  }

  // The button labels on the pause screen.
  refreshButtons() {
    const set = (id, text) => {
      const el = document.getElementById(id)
      if (el) el.textContent = text
    }
    set('build-mode-time-btn-label', t('buildTimeBtn', { time: t(`buildTime_${this.time}`) }))
    set('build-mode-weather-btn-label', t('buildWeatherBtn', { weather: t(`buildWeather_${this.weather}`) }))
  }

  // 0 = noon ... 0.5 = midnight, for Cycle; fixed for the others.
  _phase() {
    if (this.time === 'cycle') return (this._clock / CYCLE_SECONDS) % 1
    return this.time === 'night' ? 0.5 : this.time === 'sunset' ? 0.25 : 0
  }

  // How the sky looks at a phase: a mix of two of the LOOKS.
  _lookAt(phase) {
    // noon -> sunset (0.25) -> midnight (0.5) -> sunrise (0.75) -> noon
    const p = phase * 4
    const seg = Math.floor(p) % 4
    const f = p - Math.floor(p)
    const order = [['day', 'sunset'], ['sunset', 'night'], ['night', 'sunset'], ['sunset', 'day']][seg]
    // Hold each look a little before blending into the next.
    const s = THREE.MathUtils.smoothstep(f, 0.35, 1)
    return [LOOKS[order[0]], LOOKS[order[1]], s]
  }

  apply() {
    const bm = this.bm
    const [from, to, s] = this._lookAt(this._phase())
    const mix = (i) => from[i] + (to[i] - from[i]) * s
    const wet = this.weather === 'clear' ? 1 : 0.72
    this._sky.setHex(from[0]).lerp(this._b.setHex(to[0]), s)
    if (this.weather !== 'clear') this._sky.lerp(this._a.setHex(this.weather === 'snow' ? 0xc8ccd4 : 0x6c7480), 0.45 * (1 - this.nightAmount() * 0.6))
    bm.scene.background = this._sky
    const hemi = bm._hemiLight
    const sun = bm._sunLight
    if (hemi) {
      hemi.color.setHex(from[1]).lerp(this._a.setHex(to[1]), s)
      hemi.intensity = mix(2) * wet
    }
    if (sun) {
      sun.color.setHex(from[3]).lerp(this._a.setHex(to[3]), s)
      sun.intensity = mix(4) * wet
      // Low sun at sunset; the moon sits high. Same direction otherwise.
      const h = mix(5)
      sun.position.set(20, 4 + 26 * h, 10)
    }
    const night = this.nightAmount()
    this._stars.material.opacity = night * (this.weather === 'clear' ? 0.9 : 0.25)
    this._stars.visible = this._stars.material.opacity > 0.01
    this._rain.visible = this.weather === 'snow'
    this._streaks.visible = this.weather === 'rain'
    bm._shadowsDirty = true
    this.refreshButtons()
  }

  // 0 in daylight ... 1 at night.
  nightAmount() {
    const [from, to, s] = this._lookAt(this._phase())
    const n = (look) => (look === LOOKS.night ? 1 : look === LOOKS.sunset ? 0.35 : 0)
    return n(from) + (n(to) - n(from)) * s
  }

  _buildStars() {
    const count = 700
    const pos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      // Points on the upper part of a big sphere.
      const u = Math.random() * Math.PI * 2
      const v = Math.random() * 0.9 + 0.08
      const r = 150
      pos[i * 3] = Math.cos(u) * Math.cos(v * Math.PI / 2) * r
      pos[i * 3 + 1] = Math.sin(v * Math.PI / 2) * r
      pos[i * 3 + 2] = Math.sin(u) * Math.cos(v * Math.PI / 2) * r
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this._stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }))
    this._stars.frustumCulled = false
    this._stars.visible = false
    this.bm.scene.add(this._stars)
  }

  _buildParticles() {
    const pos = new Float32Array(PARTICLES * 3)
    this._drift = new Float32Array(PARTICLES)
    const cam = this.bm.camera.position
    for (let i = 0; i < PARTICLES; i++) {
      pos[i * 3] = cam.x + (Math.random() * 2 - 1) * AREA
      pos[i * 3 + 1] = cam.y + Math.random() * HEIGHT - HEIGHT / 3
      pos[i * 3 + 2] = cam.z + (Math.random() * 2 - 1) * AREA
      this._drift[i] = Math.random() * Math.PI * 2
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this._rain = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, transparent: true, opacity: 0.9, depthWrite: false }))
    this._rain.frustumCulled = false
    this._rain.visible = false
    this.bm.scene.add(this._rain)
    // Rain is drawn as short streaks from the same drops (snow as flakes).
    const streaks = new THREE.BufferGeometry()
    streaks.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PARTICLES * 6), 3))
    this._streaks = new THREE.LineSegments(streaks, new THREE.LineBasicMaterial({ color: 0xb8cce6, transparent: true, opacity: 0.6, depthWrite: false }))
    this._streaks.frustumCulled = false
    this._streaks.visible = false
    this.bm.scene.add(this._streaks)
  }

  update(dt) {
    const bm = this.bm
    if (this.time === 'cycle') {
      this._clock += dt
      const now = performance.now()
      // Recolor every frame is cheap; moving the sun redraws shadows, so
      // the whole look updates a few times a second.
      if (now - this._lastShadowAt > 250) {
        this._lastShadowAt = now
        this.apply()
      }
    }
    this._stars.position.copy(bm.camera.position)
    if (this.weather === 'clear') return
    const snow = this.weather === 'snow'
    const fall = (snow ? 1.1 : 9) * dt
    const cam = bm.camera.position
    const attr = this._rain.geometry.attributes.position
    const a = attr.array
    const B = this.B
    const span = AREA * 2
    const s = this._streaks.geometry.attributes.position.array
    for (let i = 0; i < PARTICLES; i++) {
      const j = i * 3
      let x = a[j]
      let y = a[j + 1] - fall
      let z = a[j + 2]
      if (snow) {
        this._drift[i] += dt
        x += Math.sin(this._drift[i]) * 0.25 * dt
        z += Math.cos(this._drift[i] * 0.7) * 0.25 * dt
      }
      // Keep every drop within AREA of the camera, wrapping around.
      x = cam.x + ((((x - cam.x + AREA) % span) + span) % span) - AREA
      z = cam.z + ((((z - cam.z + AREA) % span) + span) % span) - AREA
      if (y < cam.y - HEIGHT / 3 || y > cam.y + HEIGHT || bm.getBlockAt(Math.floor(x / B), Math.floor(y / B), Math.floor(z / B))) {
        y = cam.y + HEIGHT * (0.6 + Math.random() * 0.4)
      }
      a[j] = x
      a[j + 1] = y
      a[j + 2] = z
      if (!snow) {
        const k = i * 6
        s[k] = s[k + 3] = x
        s[k + 1] = y
        s[k + 4] = y + STREAK
        s[k + 2] = s[k + 5] = z
      }
    }
    attr.needsUpdate = true
    if (!snow) this._streaks.geometry.attributes.position.needsUpdate = true
  }
}
