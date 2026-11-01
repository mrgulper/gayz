// The bar along the very top of the screen in the Map Editor and Map 1
// (2026-10-17): GayZ | game mode | FPS | ms | x y z | chip + CPU cores |
// weather | time of day
// (2026-10-18, "write the cpu of the device after the coordinates"). It takes
// the place of the green debug line there - that line is still written
// (Game.js) and shows as this bar's FPS tooltip, but is hidden in-game.
import { t } from './i18n.js'
import { setBiomeTheme } from './CleanTheme.js'

const MODE_KEYS = {
  classic: 'topBarModeClassic',
  zombieDefense: 'topBarModeZombieDefense',
  bossHunt: 'topBarModeBossHunt',
  zombieRush: 'topBarModeZombieRush',
  zombieExtraction: 'topBarModeZombieExtraction',
  worldMap: 'topBarModeWorldMap',
  infection: 'topBarModeInfection',
  shrinkingZone: 'topBarModeShrinkingZone',
}
// The weather's sign before its name (clear shows a sun, or a moon at night).
const WEATHER_ICON = { drizzle: '☂', veryLightRain: '☂', lightRain: '☂', mediumRain: '☂', hardRain: '☂', thunderstorm: '⚡', freezingRain: '☂', iceStorm: '❄', veryLightSnow: '❄', lightSnow: '❄', mediumSnow: '❄', hardSnow: '❄', snowstorm: '❄', blizzard: '❄', sleet: '❄', hail: '☂', frost: '❄', coldSnap: '❄', fog: '≡', heatwave: '☀', duststorm: '≋', sandstorm: '≋', eclipse: '◐' }
const WEATHER_KIND = { drizzle: 'rain', veryLightRain: 'rain', lightRain: 'rain', mediumRain: 'rain', hardRain: 'rain', thunderstorm: 'rain', freezingRain: 'rain', iceStorm: 'snow', veryLightSnow: 'snow', lightSnow: 'snow', mediumSnow: 'snow', hardSnow: 'snow', snowstorm: 'snow', blizzard: 'snow', sleet: 'snow', hail: 'rain', frost: 'snow', coldSnap: 'snow', fog: 'snow', heatwave: 'sand', duststorm: 'sand', sandstorm: 'sand', eclipse: 'rain' }
// Coordinates and the mode are refreshed this often (ms), not every frame.
const REFRESH_MS = 100

// A short name for the graphics chip from WebGL's renderer string, e.g.
// "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)" ->
// "Apple M2", "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 ...)" ->
// "Intel UHD Graphics 620".
export function chipName(gpu) {
  if (!gpu || gpu === 'unknown') return ''
  let s = String(gpu)
  const angle = /^ANGLE \((.*)\)$/.exec(s)
  if (angle) {
    const parts = angle[1].split(', ')
    s = parts[1] || parts[0]
  }
  s = s.replace(/^ANGLE \S+ Renderer: /, '')
    .replace(/\((R|TM)\)/gi, '')
    .replace(/\s+(Direct3D|D3D|vs_|ps_|OpenGL|Metal|Vulkan|\(0x).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > 28 ? `${s.slice(0, 27)}…` : s
}

export class TopBar {
  constructor(game) {
    this.game = game
    const el = document.createElement('div')
    el.id = 'top-bar'
    el.innerHTML = `
      <span class="top-bar-ground" aria-hidden="true"></span><span class="top-bar-ground" aria-hidden="true"></span>
      <span class="top-bar-part top-bar-name">GayZ</span>
      <span class="top-bar-part" id="top-bar-mode"></span>
      <span class="top-bar-part" id="top-bar-fps"><span class="top-bar-label">FPS</span> <span id="top-bar-fps-n">--</span></span>
      <span class="top-bar-part" id="top-bar-ms"><span class="top-bar-label">MS</span> <span id="top-bar-ms-n">--</span></span>
      <span class="top-bar-part" id="top-bar-xyz"></span>
      <span class="top-bar-part" id="top-bar-chip"></span>
      <span class="top-bar-part" id="top-bar-weather"></span>
      <span class="top-bar-part" id="top-bar-time"></span>`
    document.body.appendChild(el)
    this.el = el
    this._mode = el.querySelector('#top-bar-mode')
    this._fpsPart = el.querySelector('#top-bar-fps')
    this._fps = el.querySelector('#top-bar-fps-n')
    this._ms = el.querySelector('#top-bar-ms-n')
    this._chip = el.querySelector('#top-bar-chip')
    this._chipFrom = null
    this._xyz = el.querySelector('#top-bar-xyz')
    this._weather = el.querySelector('#top-bar-weather')
    this._time = el.querySelector('#top-bar-time')
    // Two layers of the biome picture; the new one fades in over the old.
    this._grounds = [...el.querySelectorAll('.top-bar-ground')]
    this._groundKey = ''
    this._groundTop = 0
    this._at = 0
    this._text = { mode: '', xyz: '', weather: '', time: '', look: '' }
    this._lookVars = null
    this._waveEl = null
    this._waveKey = ''
  }

  // Every half second from Game.js's fps count: frames per second, how
  // long a frame takes (ms), and the device's graphics chip (2026-10-17,
  // Gaymi: "add the ms beside the fps also the cpu the device is using
  // like before" - the old green line showed the same chip name).
  setFps(fps, detail, ms, gpu) {
    this._fps.textContent = String(fps)
    this._fpsPart.title = detail || ''
    if (ms !== undefined) this._ms.textContent = String(ms)
    if (gpu !== this._chipFrom) {
      this._chipFrom = gpu
      // Browsers only tell a page the graphics chip's name and how many CPU
      // cores there are - never the CPU's own model. On Apple chips (M1-M4)
      // the CPU and graphics are the same chip, so the name is the CPU's too.
      const name = chipName(gpu)
      const cores = navigator.hardwareConcurrency
      const text = [name, cores ? t('topBarCores', { n: cores }) : ''].filter(Boolean).join(' · ')
      this._chip.textContent = text
      this._chip.style.display = text ? '' : 'none'
      this._chip.title = gpu || ''
    }
  }

  // Every frame in the Map Editor / Map 1 (cheap: only writes when a
  // shown value changed, at most every REFRESH_MS).
  update(now) {
    const game = this.game
    const bm = game.buildMode
    // Still shown behind the game's pause screen (2026-10-19, Gaymi: "when
    // clicking escape you should still see the gayz, fps, ms in the
    // background") - only the Map Editor's own menu hides it.
    const show = !!bm?.active && (!bm.menuOpen || !!bm.gameMenu?.forGame)
    this.el.style.display = show ? 'flex' : 'none'
    // A game's screens wear the biome too (CleanTheme.setBiomeTheme),
    // unless Settings > Theme says to keep the theme in games.
    setBiomeTheme(show && !!bm.survival?.active && game.settings?.playBiomeLook !== false, game.settings)
    if (!show || now - this._at < REFRESH_MS) return
    this._at = now
    const s = game.settings || {}
    const perf = s.hudFpsCounter === false || s.streamSafeMode ? 'none' : ''
    this._fpsPart.style.display = perf
    this._ms.parentElement.style.display = perf
    if (this._chip.textContent) this._chip.style.display = perf
    const play = bm.survival?.active
    const mode = play ? t(MODE_KEYS[bm.survival.cfg?.mode] || 'topBarModeClassic') : bm.tryMode?.active ? t('topBarModeTry') : t('topBarModeEditor')
    if (mode !== this._text.mode) this._mode.textContent = this._text.mode = mode
    const B = bm.tryMode?.B || 1
    const p = bm.tryMode?.active ? bm.tryMode.pos : bm.camera ? { x: bm.camera.position.x / B, y: bm.camera.position.y / B, z: bm.camera.position.z / B } : null
    // (+ 0 turns -0 into 0, so it never reads "-0.00".)
    const n = (v) => (Math.round(v * 100) / 100 + 0).toFixed(2)
    const xyz = p ? `${n(p.x)}  ${n(p.y)}  ${n(p.z)}` : ''
    if (xyz !== this._text.xyz) this._xyz.textContent = this._text.xyz = xyz
    this._updateGround(bm.biomeBarLook?.())
    this._updateSky(bm.sky)
    const bar = this.el.getBoundingClientRect()
    this._updateWave(bar)
    this._placeMap(bar)
  }

  // The wave line under the bar looks the same (2026-10-19, Gaymi: "make
  // the wave same style as the gayz fps ms etc style change as biome
  // change"): the same biome picture fading in, night and weather tint.
  _updateWave(bar) {
    const w = document.getElementById('build-play-wave')
    if (w !== this._waveEl) {
      this._waveEl = w
      this._waveKey = ''
      this._waveVars = null
    }
    if (!w) return
    // Just under the bar, however many rows it wraps onto (on phones it
    // used to cover the wave line).
    const top = `${Math.round(bar.bottom + 4)}px`
    if (bar.height && w.style.top !== top) w.style.top = top
    if (this._waveKey !== this._groundKey) {
      this._waveKey = this._groundKey
      w.classList.toggle('has-ground', this.el.classList.contains('has-ground'))
      const url = this._grounds[this._groundTop].style.backgroundImage
      const grounds = w.querySelectorAll('.top-bar-ground')
      if (grounds.length === 2 && url) {
        const next = grounds[0].classList.contains('on') ? grounds[1] : grounds[0]
        const prev = next === grounds[0] ? grounds[1] : grounds[0]
        next.style.backgroundImage = url
        next.classList.add('on')
        prev.classList.remove('on')
      }
    }
    if (this._waveVars !== this._lookVars && this._lookVars) {
      this._waveVars = this._lookVars
      w.style.setProperty('--tb-night', this._lookVars.night)
      w.style.setProperty('--tb-storm', this._lookVars.storm)
      w.dataset.weather = this._lookVars.weather
    }
  }

  // The small corner map sits level with the bar (2026-10-19, Gaymi: "move
  // the map ... a bit higher") - unless the bar is so long on a narrow
  // window that they'd overlap; then it stays under the bar.
  _placeMap(bar) {
    const map = document.getElementById('build-try-map')
    if (!map || map.style.display === 'none') return
    const clash = bar.width > 0 && bar.right + 10 > map.getBoundingClientRect().left
    if (clash !== map.classList.contains('below-top-bar')) map.classList.toggle('below-top-bar', clash)
  }

  // The weather and the game's time of day, and the bar's colors follow
  // them - darker at night, greyer in rain, paler in snow, sandier in a
  // sandstorm (2026-10-18, Gaymi: "make that thing adjust, as weather and
  // day cycle", picked both).
  _updateSky(sky) {
    const look = sky?.topBarLook?.()
    if (!look) return
    const night = look.night > 0.5
    // A natural disaster going on shows next to the weather (Disasters.js).
    const weather = `${WEATHER_ICON[look.weather] || (night ? '☾' : '☀')} ${t(`buildWeather_${look.weather}`)}${look.disaster ? ` · ⚠ ${t(`disaster_${look.disaster}`)}` : ''}`
    if (weather !== this._text.weather) this._weather.textContent = this._text.weather = weather
    // The game's clock, every minute (2026-10-18, Gaymi: "dont make it go
    // by 10 minutes make it go 1 minute"), in the player's own 12/24-hour
    // style.
    const mins = Math.floor(look.hours * 60)
    const time = new Date(2000, 0, 1, Math.floor(mins / 60), mins % 60).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    if (time !== this._text.time) this._time.textContent = this._text.time = time
    const key = `${look.night.toFixed(2)}|${look.weather}|${look.strength}`
    if (key === this._text.look) return
    this._text.look = key
    const st = this.el.style
    this._lookVars = { night: look.night.toFixed(2), storm: look.weather === 'clear' ? '0' : String(look.strength), weather: WEATHER_KIND[look.weather] || 'clear' }
    st.setProperty('--tb-night', this._lookVars.night)
    st.setProperty('--tb-storm', this._lookVars.storm)
    this.el.dataset.weather = this._lookVars.weather
  }

  // The bar is made of the biome you're in (BiomeBar.js); walking into
  // another one fades the new picture in over a couple of seconds.
  _updateGround(look) {
    const key = look?.key || ''
    if (key === this._groundKey) return
    this._groundKey = key
    this.el.classList.toggle('has-ground', !!look)
    // The same picture and its colour for every other game screen.
    const root = document.documentElement.style
    if (look) {
      root.setProperty('--biome-ground', `url(${look.url})`)
      root.setProperty('--biome-accent', look.accent)
      const n = parseInt(look.accent.slice(1), 16)
      root.setProperty('--biome-accent-rgb', `${n >> 16}, ${(n >> 8) & 255}, ${n & 255}`)
      root.setProperty('--biome-bg-rgb', look.bg)
      root.setProperty('--biome-ink-rgb', look.ink)
    } else {
      root.removeProperty('--biome-ground')
      root.removeProperty('--biome-accent')
      root.removeProperty('--biome-accent-rgb')
      root.removeProperty('--biome-bg-rgb')
      root.removeProperty('--biome-ink-rgb')
    }
    if (!look) return
    this._groundTop = 1 - this._groundTop
    const next = this._grounds[this._groundTop]
    const prev = this._grounds[1 - this._groundTop]
    next.style.backgroundImage = `url(${look.url})`
    next.classList.add('on')
    prev.classList.remove('on')
  }

  hide() {
    this.el.style.display = 'none'
  }
}
