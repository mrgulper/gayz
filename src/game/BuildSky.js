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
// Weather is Map 1's own (2026-10-04, Gaymi: "just use it from map 1 i
// like it more"): the same falling rain/snow overlays in light and hard,
// the sandstorm haze, lightning with thunder in hard rain, and the real
// rain/wind sound (Game.js's #screen-overlays, _ensureWeatherParticles,
// #lightning-flash, audioEngine.setWeatherAudio). Random rolls them the way
// Map 1's nights do (Game.js's _rollWeather chances), re-rolling every few
// minutes. The game's overlays are switched on only while the editor is
// open (onEnter/onExit).
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'

export const SKY_TIMES = ['day', 'sunset', 'night', 'cycle']
export const SKY_WEATHERS = ['clear', 'lightRain', 'hardRain', 'lightSnow', 'hardSnow', 'sandstorm', 'random']
// Saved before Map 1's weather was used here.
const OLD_WEATHERS = { rain: 'lightRain', snow: 'lightSnow' }
const CYCLE_SECONDS = 600
const PREF_KEY = 'buildmode-sky'
const RANDOM_REROLL_S = 240
const LIGHTNING_MIN_S = 8
const LIGHTNING_RANGE_S = 14
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
      const w = OLD_WEATHERS[saved.weather] || saved.weather
      if (SKY_WEATHERS.includes(w)) this.weather = w
    } catch {
      // Nothing saved yet.
    }
    this._sky = new THREE.Color()
    this._a = new THREE.Color()
    this._b = new THREE.Color()
    this._lastShadowAt = 0
    this._buildStars()
    this._active = false
    this._now = 'clear' // what's actually showing (Random picks one)
    this._rerollIn = 0
    this._lightningIn = 0
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
    this._rerollIn = 0
    this._save()
    this._pickWeather()
    this.apply()
  }

  // Random: Map 1's odds - rain 30%, snow 15%, each hard 40% of the time,
  // sandstorm 10% of what's left, else clear.
  _pickWeather() {
    if (this.weather !== 'random') {
      this._now = this.weather
      return
    }
    const roll = Math.random()
    const hard = Math.random() < 0.4
    if (roll < 0.3) this._now = hard ? 'hardRain' : 'lightRain'
    else if (roll < 0.45) this._now = hard ? 'hardSnow' : 'lightSnow'
    else this._now = Math.random() < 0.1 ? 'sandstorm' : 'clear'
    this._rerollIn = RANDOM_REROLL_S
  }

  // The editor opened / closed: Map 1's overlays and sound on or off.
  onEnter() {
    this._active = true
    this._shownKind = null
    this._pickWeather()
    this.apply()
  }

  onExit() {
    this._active = false
    this._shownKind = null
    this._showOverlays('clear')
    const game = this.bm.game
    audioEngine.setWeatherAudio(!!game?.raining && !!game?.gameStarted, !!game?.snowing && !!game?.gameStarted)
  }

  _showOverlays(kind) {
    const game = this.bm.game
    game?._ensureAllWeatherParticles?.()
    const show = (el, on) => {
      if (el) el.style.display = on ? 'block' : 'none'
    }
    show(game?.rainOverlayEl, kind === 'lightRain')
    show(game?.rainOverlayHardEl, kind === 'hardRain')
    show(game?.snowOverlayEl, kind === 'lightSnow')
    show(game?.snowOverlayHardEl, kind === 'hardSnow')
    show(game?.sandstormOverlayEl, kind === 'sandstorm')
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
    const w = this._now
    const wet = w === 'clear' ? 1 : w.startsWith('hard') ? 0.6 : 0.78
    this._sky.setHex(from[0]).lerp(this._b.setHex(to[0]), s)
    const tint = w.endsWith('Snow') ? 0xc8ccd4 : w === 'sandstorm' ? 0xc49a5c : 0x6c7480
    if (w !== 'clear') this._sky.lerp(this._a.setHex(tint), (w.startsWith('hard') ? 0.6 : 0.4) * (1 - this.nightAmount() * 0.6))
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
    this._stars.material.opacity = night * (w === 'clear' ? 0.9 : 0.25)
    this._stars.visible = this._stars.material.opacity > 0.01
    // (apply() runs a few times a second in Cycle - only touch the
    // overlays, sound and lightning when the weather itself changes.)
    if (this._active && this._shownKind !== w) {
      this._shownKind = w
      this._showOverlays(w)
      audioEngine.setWeatherAudio(w.endsWith('Rain'), w.endsWith('Snow'))
      this._lightningIn = w === 'hardRain' ? LIGHTNING_MIN_S + Math.random() * LIGHTNING_RANGE_S : 0
    }
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
    if (!this._active) return
    if (this.weather === 'random') {
      this._rerollIn -= dt
      if (this._rerollIn <= 0) {
        this._pickWeather()
        this.apply()
      }
    }
    // Hard rain: lightning and thunder now and then, like Map 1.
    if (this._now === 'hardRain' && this._lightningIn > 0) {
      this._lightningIn -= dt
      if (this._lightningIn <= 0) {
        this._lightningIn = LIGHTNING_MIN_S + Math.random() * LIGHTNING_RANGE_S
        const flash = this.bm.game?.lightningFlashEl
        if (flash) {
          flash.classList.remove('flash')
          void flash.offsetWidth
          flash.classList.add('flash')
        }
        audioEngine.playThunder?.()
      }
    }
  }
}
