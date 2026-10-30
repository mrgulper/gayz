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
// old Map 1's nights did, re-rolling every few
// minutes. The game's overlays are switched on only while the editor is
// open (onEnter/onExit).
//
// Real weather (2026-10-17, Gaymi: "it should actually be raining ... the
// sky should change too", and picked "random + fits the biome"): rain and
// snow fall through the 3D world (BuildWeather.js) instead of the old
// screen overlays (only the sandstorm haze is still an overlay); the sky
// goes properly grey, the light dims and the fog closes in, all easing in
// over a few seconds (SKY_EASE) instead of switching at once. Random is
// the default now and follows where you are: snow only in cold biomes,
// sandstorms only in dry ones, more rain in jungles and swamps
// (_climateAt / CLIMATES) - walk into a biome whose climate can't have
// the current weather and it changes.
//
// Games from the homepage (2026-10-17, Gaymi: "not sunny all day long, add
// nights"): forGame(true) runs the full day-night Cycle (CYCLE_SECONDS, 24
// minutes, starting in the morning) with Random weather whatever the
// Map Editor's buttons are set to, without touching that saved choice.
// The sun, moon and clouds are SkyBodies.js.
//
// Even more real weather (2026-10-30, Gaymi: "make the weather even more
// realistic"): every change eases over about half a minute (the sky here,
// the drops in BuildWeather, the rain's sound) instead of popping; drizzle,
// sleet (sometimes, as snow ends), freezing rain, ice storms,
// thunderstorms, heavy snowstorms, blizzards, frost, dust storms,
// heatwaves and cold snaps; a wind for every weather (soft when it's
// clear, a gale in a blizzard) that turns slowly and pushes you a little
// when you're out in it (windPush); lightning that forks down from the
// clouds or flickers inside them (SkyLightning.js); frost growing in from
// the screen's edges in bitter cold and a heat haze in a heatwave
// (WeatherScreen.js); and natural disasters (Disasters.js) with 10x luck
// after an impact (Luck.js).
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { BuildWeather } from './BuildWeather.js'
import { SkyBodies, MOON_PHASES } from './SkyBodies.js'
import { sampleLand, inCity } from './OpenWorld.js'
import { SkyLightning } from './SkyLightning.js'
import { WeatherScreen } from './WeatherScreen.js'
import { Disasters, DISASTERS, IMPACTS } from './Disasters.js'
import { luck } from './Luck.js'

export const SKY_TIMES = ['day', 'sunset', 'night', 'cycle']
export const SKY_WEATHERS = ['clear', 'drizzle', 'veryLightRain', 'lightRain', 'mediumRain', 'hardRain', 'thunderstorm', 'freezingRain', 'iceStorm', 'veryLightSnow', 'lightSnow', 'mediumSnow', 'hardSnow', 'snowstorm', 'blizzard', 'sleet', 'hail', 'frost', 'coldSnap', 'fog', 'heatwave', 'duststorm', 'sandstorm', 'eclipse', 'random']
// Clear skies (sun out, stars at night), whatever the temperature.
export const CLEAR_SKIES = new Set(['clear', 'frost', 'heatwave', 'coldSnap'])
// Weather changes a step at a time (2026-10-25, Gaymi: "hard rain slightly
// hard rain light rain very light rain the clear needs something like that
// not just instant weather switch", picked about 1 minute a step): Random
// walks down the old weather's ladder to clear and up the new one's,
// STEP_S per step. A ladder's first step is the one next to clear.
// Rain starts and ends as drizzle; the worst rain is a thunderstorm and
// the worst snow a blizzard (2026-10-30).
const LADDERS = {
  rain: ['drizzle', 'veryLightRain', 'lightRain', 'mediumRain', 'hardRain', 'thunderstorm'],
  snow: ['veryLightSnow', 'lightSnow', 'mediumSnow', 'hardSnow', 'snowstorm', 'blizzard'],
  hail: ['drizzle', 'veryLightRain', 'lightRain', 'hail'],
  freezing: ['drizzle', 'freezingRain', 'iceStorm'],
  sleet: ['sleet'],
}
const LADDER_OF = {
  drizzle: 'rain', veryLightRain: 'rain', lightRain: 'rain', mediumRain: 'rain', hardRain: 'rain', thunderstorm: 'rain',
  veryLightSnow: 'snow', lightSnow: 'snow', mediumSnow: 'snow', hardSnow: 'snow', snowstorm: 'snow', blizzard: 'snow',
  hail: 'hail', freezingRain: 'freezing', iceStorm: 'freezing', sleet: 'sleet',
}
// Sleet (2026-10-30, Gaymi: "sleet(after snowing)"): this chance, as snow
// ends, of a spell of sleet before it clears.
const SLEET_CHANCE = 0.4
const STEP_S = 60
// A solar eclipse (2026-10-25, Gaymi: "something rare eclipse has a 0.01
// chance" - 0.01%): rolled first on every Random weather change, daytime
// only. The editor's Weather button can still pick it to look at.
const ECLIPSE_CHANCE = 0.0001
// A rainbow (2026-10-26, Gaymi: "make a 10% chance of seeing a rainbow
// after raining"): when rain or hail clears in the daytime, this chance
// of one in the sky opposite the sun (SkyBodies) for RAINBOW_S seconds,
// fading in and out over a few seconds.
export const RAINBOW_CHANCE = 0.1
const RAINBOW_S = 150
const RAINBOW_FADE = 0.25
// Saved before Map 1's weather was used here.
const OLD_WEATHERS = { rain: 'lightRain', snow: 'lightSnow' }
// A whole day: 1440 seconds, so one game minute is one real second
// (2026-10-18, Gaymi: "make it go 1 minute but each minute=1 second").
const CYCLE_SECONDS = 1440
// Games start mid-morning: a little after sunrise (0.75) on the way to noon.
const GAME_START_PHASE = 0.85
const PREF_KEY = 'buildmode-sky'
const RANDOM_REROLL_S = 240
// Bumped to switch every saved Weather choice to Random once (2026-10-17).
const PREF_VERSION = 2
const SKY_EASE = 0.6 // how fast the sky, light and fog follow the weather
// ...and in Random, where each step gets about a minute to settle in.
const SKY_EASE_SLOW = 0.045
const CLIMATE_CHECK_S = 2
// Which weather each climate can have, with its chance (the rest is clear).
// Snow, hail and fog can turn up in the city too now (2026-10-25, Gaymi:
// "add more weathers ... snowing hard snowing light snowing and also add
// hail") - just less often than where it's cold.
// Heatwaves and cold snaps are rare - only the worst weather (2026-10-30);
// frost only forms at night and in the early morning (FROST_NIGHT).
const CLIMATES = {
  mild: [['drizzle', 0.06], ['veryLightRain', 0.07], ['lightRain', 0.12], ['mediumRain', 0.06], ['hardRain', 0.05], ['thunderstorm', 0.02], ['fog', 0.08], ['lightSnow', 0.04], ['hardSnow', 0.02], ['hail', 0.025], ['freezingRain', 0.01], ['frost', 0.04], ['heatwave', 0.015]],
  wet: [['drizzle', 0.06], ['veryLightRain', 0.07], ['lightRain', 0.17], ['mediumRain', 0.12], ['hardRain', 0.13], ['thunderstorm', 0.06], ['fog', 0.12], ['hail', 0.035], ['heatwave', 0.015]],
  cold: [['veryLightSnow', 0.08], ['lightSnow', 0.16], ['mediumSnow', 0.11], ['hardSnow', 0.1], ['snowstorm', 0.05], ['blizzard', 0.03], ['freezingRain', 0.03], ['iceStorm', 0.02], ['fog', 0.07], ['hail', 0.03], ['frost', 0.06], ['coldSnap', 0.025]],
  dry: [['sandstorm', 0.2], ['duststorm', 0.1], ['heatwave', 0.08]],
  savanna: [['drizzle', 0.05], ['veryLightRain', 0.05], ['lightRain', 0.08], ['thunderstorm', 0.02], ['fog', 0.03], ['duststorm', 0.05], ['heatwave', 0.04]],
  mountain: [['veryLightSnow', 0.06], ['lightSnow', 0.12], ['mediumSnow', 0.04], ['hardSnow', 0.04], ['snowstorm', 0.03], ['blizzard', 0.015], ['lightRain', 0.1], ['freezingRain', 0.03], ['fog', 0.12], ['hail', 0.04], ['frost', 0.05], ['coldSnap', 0.015]],
}
const FROST_NIGHT = 0.3
// The wind for each weather (blocks/second): very soft when it's clear,
// a gale in a blizzard. It pushes you a little (WIND_PUSH of it) when
// there's nothing over your head (windPush).
const WIND = {
  clear: 0.25, drizzle: 0.5, veryLightRain: 0.6, lightRain: 0.9, mediumRain: 1.5, hardRain: 2.4, thunderstorm: 3.4,
  freezingRain: 1.1, iceStorm: 2.6, veryLightSnow: 0.5, lightSnow: 0.7, mediumSnow: 1.2, hardSnow: 2, snowstorm: 3.4,
  blizzard: 5.5, sleet: 1.4, hail: 1.8, frost: 0.15, coldSnap: 3.2, fog: 0.1, heatwave: 0.35, duststorm: 4, sandstorm: 5,
  eclipse: 0.3,
}
const WIND_PUSH = 0.22
const WIND_GRIP = 1.8
// How hard it's raining / snowing, for the sound (0..1+).
const RAIN_SOUND = { drizzle: 0.2, veryLightRain: 0.3, lightRain: 0.5, mediumRain: 0.7, hardRain: 0.9, thunderstorm: 1, freezingRain: 0.5, iceStorm: 0.8, sleet: 0.5, hail: 0.8 }
const SNOW_SOUND = { veryLightSnow: 0.3, lightSnow: 0.5, mediumSnow: 0.7, hardSnow: 1, snowstorm: 1.3, blizzard: 1.6, coldSnap: 0.9, sandstorm: 1.3, duststorm: 1.1 }
// Lightning: [seconds between (min, range), share of hard strikes].
const LIGHTNING = {
  mediumRain: [24, 30, 0], hardRain: [7, 14, 0.4], thunderstorm: [3.5, 8, 0.6], hail: [14, 18, 0.2],
  iceStorm: [30, 40, 0], snowstorm: [45, 60, 0], blizzard: [40, 60, 0],
}
// The screen in the worst weather (WeatherScreen): frost or heat.
const SCREEN = { coldSnap: { frost: 0.85 }, blizzard: { frost: 0.6 }, iceStorm: { frost: 0.4 }, snowstorm: { frost: 0.25 }, heatwave: { heat: 0.7 } }
const BIOME_CLIMATE = {
  snowyBeach: 'cold', snowyTaiga: 'cold', snowyPlains: 'cold', iceSpikes: 'cold', snowyPeaks: 'cold', frozenOcean: 'cold',
  desert: 'dry', badlands: 'dry', savanna: 'savanna',
  jungle: 'wet', bambooJungle: 'wet', swamp: 'wet', mangroveSwamp: 'wet',
  mountains: 'mountain', taiga: 'mountain',
}
// A clean, bright, flat blue by day and near black at night (2026-10-23,
// Gaymi's reference pictures), with real-looking stars (_buildStars).
const DAY_SKY = 0x6cb4f4
const STAR_COUNT = 4000
// Extra faint stars that only come out while zoomed in (hold V).
const DEEP_STARS = 36000
// How each weather looks: sky tint color and how far toward it, how much
// of the daylight is left, and how much nearer the fog comes (x view).
// Only Fog, a sandstorm and a blizzard close the view in (2026-10-25,
// Gaymi: "it should only be foggy if its like foggy weather") - rain and
// light snow keep it clear to the edge.
const WEATHER_LOOK = {
  clear: [DAY_SKY, 0, 1, 1],
  // Rain darkens the sky more (2026-10-25, Gaymi: "the sky change to
  // raining too").
  veryLightRain: [0x6e747c, 0.6, 0.8, 1],
  lightRain: [0x5c6168, 0.78, 0.66, 1],
  mediumRain: [0x4c5057, 0.88, 0.55, 1],
  hardRain: [0x3e4248, 0.95, 0.46, 0.95],
  veryLightSnow: [0xbcc1c9, 0.4, 0.88, 1],
  lightSnow: [0xc2c7cf, 0.55, 0.8, 1],
  mediumSnow: [0xc9cdd4, 0.7, 0.73, 0.92],
  hardSnow: [0xd0d4da, 0.85, 0.66, 0.8],
  hail: [0x4d5259, 0.9, 0.55, 1],
  drizzle: [0x7a8088, 0.5, 0.86, 1],
  thunderstorm: [0x2c3036, 0.97, 0.36, 0.9],
  freezingRain: [0x7f8790, 0.8, 0.66, 1],
  iceStorm: [0x6a717a, 0.9, 0.55, 0.85],
  sleet: [0x899098, 0.75, 0.68, 1],
  snowstorm: [0xd3d7dc, 0.9, 0.6, 0.6],
  // A whiteout: you can hardly see.
  blizzard: [0xdde1e6, 0.97, 0.55, 0.28],
  frost: [0xcfe0f0, 0.12, 1, 1],
  coldSnap: [0xb8d0ea, 0.22, 0.97, 1],
  heatwave: [0xf2d7a0, 0.3, 1.1, 0.8],
  duststorm: [0x9c8668, 0.72, 0.72, 0.45],
  fog: [0xb7bcc3, 0.8, 0.78, 0.22],
  sandstorm: [0xc49a5c, 0.75, 0.7, 0.35],
  eclipse: [0x0b0d18, 0.9, 0.2, 1],
}
// [sky color, hemisphere color, hemisphere intensity, sun color, sun
// intensity, sun height (0-1)]
const LOOKS = {
  day: [DAY_SKY, 0xffffff, 2.0, 0xfff4e0, 1.5, 1],
  sunset: [0xf0956a, 0xffd6b0, 1.35, 0xff9850, 1.05, 0.25],
  night: [0x020306, 0x8a9fd6, 0.6, 0x9fb4ff, 0.28, 0.8],
}

export class BuildSky {
  constructor(buildMode, blockSize) {
    this.bm = buildMode
    this.B = blockSize
    this.time = 'day'
    this.weather = 'random'
    this._clock = 0
    try {
      const saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}')
      if (SKY_TIMES.includes(saved.time)) this.time = saved.time
      const w = OLD_WEATHERS[saved.weather] || saved.weather
      if (saved.v >= PREF_VERSION && SKY_WEATHERS.includes(w)) this.weather = w
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
    this._goal = 'clear' // where Random is stepping to (_step)
    this._stepIn = 0
    this._rerollIn = 0
    this._lightningIn = 0
    this._climate = 'mild'
    this._climateIn = 0
    // The sky's weather look right now, easing toward the target (apply()).
    this._tint = new THREE.Color(DAY_SKY)
    this._tintGoal = new THREE.Color(DAY_SKY)
    this._mix = 0
    this._mixGoal = 0
    this._light = 1
    this._lightGoal = 1
    this.fogFactor = 1
    this.clearness = 1
    this._eclipse = 0
    this._rainbowIn = 0 // seconds of rainbow left
    this.rainbow = 0 // how much is showing (0..1)
    // On a server and not the host: the host's sky is shown (follow) and
    // nothing is rolled here.
    this._following = false
    this._fogGoal = 1
    this._base = new THREE.Color()
    this._hemiBase = 0
    this._sunBase = 0
    this.weather3d = new BuildWeather(buildMode, blockSize)
    this.bodies = new SkyBodies(buildMode.scene)
    this.lightning = new SkyLightning(buildMode.scene)
    this.screen = new WeatherScreen()
    this.disasters = new Disasters(this, buildMode, blockSize)
    this.luck = luck
    // The wind (blocks/s), turning slowly; and the thunder still to come.
    this.wind = new THREE.Vector2(WIND.clear, 0)
    this._windAng = Math.random() * Math.PI * 2
    this._windTime = 0
    this._sheltered = false
    this._shelterIn = 0
    this._thunder = []
    this._flashColor = new THREE.Color(0xe6e4ff)
    this._disasterPick = 'none'
    this._editorChoice = null
    document.getElementById('build-mode-time-btn')?.addEventListener('click', () => this.cycleTime())
    document.getElementById('build-mode-weather-btn')?.addEventListener('click', () => this.cycleWeather())
    document.getElementById('build-mode-disaster-btn')?.addEventListener('click', () => this.cycleDisaster())
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

  // The pause screen's Disaster button: the next one starts right away
  // (to look at), and once round it's back to none.
  cycleDisaster() {
    const list = ['none', ...DISASTERS]
    this._disasterPick = list[(list.indexOf(this._disasterPick) + 1) % list.length]
    if (this._disasterPick === 'none') this.disasters.end()
    else this.disasters.start(this._disasterPick)
    this.refreshButtons()
  }

  // Random: a roll from where you are's climate (CLIMATES).
  // jump: show it straight away (a new game, the editor's own pick)
  // instead of stepping there (_step).
  _pickWeather(jump = true) {
    if (this.weather !== 'random') {
      this._now = this._goal = this.weather
      return
    }
    this._climate = this._climateAt()
    this._rerollIn = RANDOM_REROLL_S
    this._stepIn = STEP_S
    let goal = 'clear'
    // An impact (2026-10-30, Gaymi: "make them very rare the impact
    // events like 0.01 make it same as the eclipse"): rolled alongside it,
    // any time of day, only in a game.
    if (this._inGame && !this._following && !this.disasters.active && Math.random() < ECLIPSE_CHANCE) this.disasters.start(IMPACTS[Math.floor(Math.random() * IMPACTS.length)])
    if (this.nightAmount() < 0.3 && Math.random() < ECLIPSE_CHANCE) goal = 'eclipse'
    else {
      let roll = Math.random()
      for (const [kind, chance] of CLIMATES[this._climate]) {
        if (roll < chance) {
          goal = kind
          break
        }
        roll -= chance
      }
    }
    if (goal === 'frost' && this.nightAmount() < FROST_NIGHT) goal = 'clear'
    // A drought: no rain, often a heatwave.
    if (this.disasters.blocksRain() && goal !== 'clear' && goal !== 'eclipse') goal = goal === 'heatwave' || Math.random() < 0.5 ? 'heatwave' : 'clear'
    this._goal = goal
    if (jump) this._now = goal
  }

  // One step from what's showing toward the goal: along the goal's own
  // ladder if we're on it, else down the current one toward clear, and
  // from clear onto the goal's first step. Fog, sandstorms and eclipses
  // have no steps - their look eases in slowly instead.
  _step() {
    const now = this._now
    const goal = this._goal
    if (now === goal) return now
    const want = LADDERS[LADDER_OF[goal]]
    if (want?.includes(now)) {
      const i = want.indexOf(now)
      return want[i + Math.sign(want.indexOf(goal) - i)]
    }
    const mine = LADDERS[LADDER_OF[now]]
    if (mine) return mine[mine.indexOf(now) - 1] || 'clear'
    if (now !== 'clear' && goal !== 'clear' && want) return 'clear'
    return want ? want[0] : goal
  }

  // A drought set in: the sky clears (walking down from any rain).
  forceClear() {
    if (this.weather !== 'random') return
    this._goal = 'heatwave'
    this._rerollIn = RANDOM_REROLL_S
  }

  // Lightning lit the sky (amount ~0..1.5); also a meteor's flash.
  addFlash(amount) {
    const reduce = this.bm.game?.settings?.reduceFlashing
    this.lightning.addFlash(amount * (reduce ? 0.35 : 1))
  }

  // The whole screen flashes white (a close strike, a big impact).
  screenFlash() {
    if (this.bm.game?.settings?.reduceFlashing) return
    const flash = this.bm.game?.lightningFlashEl
    if (!flash) return
    flash.classList.remove('flash')
    void flash.offsetWidth
    flash.classList.add('flash')
  }

  // A bolt to the ground at a spot (blocks) - a wildfire's start.
  strikeAt(x, z) {
    const B = this.B
    const cam = this.bm.camera.position
    this.lightning.strike(cam, true, (wx, wz) => this.disasters.topAt(wx / B, wz / B) * B, Math.random, { x: x * B, z: z * B })
    this.addFlash(0.6)
    this._thunder.push([1.2, { gain: 0.8 }])
  }

  // How the wind pushes you (blocks/s), out in the open; and whatever a
  // disaster is doing to you (a flood's current, an avalanche).
  // On the ground a breeze doesn't slide you along - only wind past
  // WIND_GRIP does (storms, gales, blizzards); in the air any wind does.
  windPush(out, onGround = false) {
    const len = this.wind.length()
    let k = this._active && !this._sheltered ? WIND_PUSH : 0
    if (onGround) k *= len > WIND_GRIP ? (len - WIND_GRIP) / len : 0
    return out.set(this.wind.x * k + this.disasters.push.x, this.wind.y * k + this.disasters.push.y)
  }

  // The climate where you are: the open world's biome, or mild in the city
  // and on maps that aren't the open world.
  _climateAt() {
    const bm = this.bm
    if (!bm.world?.active) return 'mild'
    const B = this.B
    const p = bm.tryMode?.active ? bm.tryMode.pos : { x: bm.camera.position.x / B, z: bm.camera.position.z / B }
    const x = Math.floor(p.x)
    const z = Math.floor(p.z)
    if (inCity(x, z)) return 'mild'
    return BIOME_CLIMATE[sampleLand(x, z).biome] || 'mild'
  }

  // On a server everyone sees the host's sky (2026-10-26, Gaymi: "they
  // didn't see the same thing I had on my screen"): the host sends this
  // with each sync (PlayNet) and the others follow() it.
  skyState() {
    return { c: +this._clock.toFixed(1), n: this._now, g: this._goal, r: +Math.max(0, this._rainbowIn).toFixed(1), d: this.disasters.state() }
  }

  // The host's sky (null: back to rolling our own, e.g. we became the host).
  follow(state) {
    if (!state) {
      this._following = false
      return
    }
    const ok = (k) => k === 'clear' || k === 'eclipse' || (SKY_WEATHERS.includes(k) && k !== 'random')
    this._following = true
    // The clock runs here between syncs; only a real gap jumps it.
    if (this.time === 'cycle' && Number.isFinite(state.c) && Math.abs(state.c - this._clock) > 3) this._clock = state.c
    if (ok(state.g)) this._goal = state.g
    this._rainbowIn = Number(state.r) || 0
    this.disasters.follow(state.d || null)
    if (ok(state.n) && state.n !== this._now) {
      this._now = state.n
      this.apply()
    }
  }

  // A game from the homepage starts / ends: the day-night cycle and
  // random weather, then back to the editor's own choice.
  forGame(on) {
    this._following = false
    this._inGame = !!on
    this.disasters.end()
    luck.stop()
    if (on) {
      if (!this._editorChoice) this._editorChoice = { time: this.time, weather: this.weather }
      this.time = 'cycle'
      this.weather = 'random'
      this._clock = CYCLE_SECONDS * GAME_START_PHASE
      this._pickWeather()
    } else if (this._editorChoice) {
      this.time = this._editorChoice.time
      this.weather = this._editorChoice.weather
      this._editorChoice = null
      this._clock = 0
      this._pickWeather()
    }
    this.apply()
  }

  // The editor opened / closed: Map 1's overlays and sound on or off.
  onEnter() {
    this.bodies.show(true)
    this._active = true
    this._shownKind = null
    this._pickWeather()
    this.apply()
  }

  onExit() {
    this.bodies.show(false)
    this._active = false
    this._shownKind = null
    this._showOverlays('clear')
    this.weather3d.clear()
    this.lightning.clear()
    this.screen.clear()
    this.disasters.end()
    this._thunder = []
    this.bm.grassTufts?.clear()
    const game = this.bm.game
    audioEngine.setWeatherAudio(!!game?.raining && !!game?.gameStarted, !!game?.snowing && !!game?.gameStarted)
  }

  _showOverlays(kind) {
    const game = this.bm.game
    game?._ensureAllWeatherParticles?.()
    const show = (el, on) => {
      if (el) el.style.display = on ? 'block' : 'none'
    }
    // Rain and snow fall in the world now (BuildWeather) - the old screen
    // layers stay off; only the sandstorm's haze is still one.
    for (const el of [game?.rainOverlayEl, game?.rainOverlayHardEl, game?.snowOverlayEl, game?.snowOverlayHardEl]) show(el, false)
    show(game?.sandstormOverlayEl, kind === 'sandstorm')
    this.weather3d.set(kind)
  }

  _save() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ time: this.time, weather: this.weather, v: PREF_VERSION }))
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
    set('build-mode-disaster-btn-label', t('buildDisasterBtn', { name: this._disasterPick === 'none' ? t('disasterNone') : t(`disaster_${this._disasterPick}`) }))
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
    // (tighter since 2026-10-23, so mornings turn clean blue sooner).
    const s = THREE.MathUtils.smoothstep(f, 0.35, 0.8)
    return [LOOKS[order[0]], LOOKS[order[1]], s]
  }

  apply() {
    const bm = this.bm
    const [from, to, s] = this._lookAt(this._phase())
    const mix = (i) => from[i] + (to[i] - from[i]) * s
    const w = this._now
    // The weather's look is a goal the sky eases toward (_easeLook, every
    // frame) - here only the time of day's own look is set.
    const look = WEATHER_LOOK[w] || WEATHER_LOOK.clear
    this._tintGoal.setHex(look[0])
    this._mixGoal = look[1] * (1 - this.nightAmount() * 0.6)
    this._lightGoal = look[2]
    this._fogGoal = look[3]
    this._base.setHex(from[0]).lerp(this._b.setHex(to[0]), s)
    bm.scene.background = this._sky
    const hemi = bm._hemiLight
    const sun = bm._sunLight
    this._hemiBase = mix(2)
    this._sunBase = mix(4)
    if (hemi) this._hemiColor = (this._hemiColor || new THREE.Color()).setHex(from[1]).lerp(this._a.setHex(to[1]), s)
    if (sun) {
      this._sunColor = (this._sunColor || new THREE.Color()).setHex(from[3]).lerp(this._a.setHex(to[3]), s)
      // Low sun at sunset; the moon sits high. Same direction otherwise.
      const h = mix(5)
      bm._sunOffset = [20, 4 + 26 * h, 10]
    }
    const night = this.nightAmount()
    const stars = this._stars.material.uniforms.opacity
    // Only once it's really dark - not in a morning or evening sky.
    stars.value = w === 'eclipse' ? 0.8 : THREE.MathUtils.smoothstep(night, 0.4, 0.9) * (CLEAR_SKIES.has(w) ? 1 : 0.25)
    this._stars.visible = stars.value > 0.01
    // (apply() runs a few times a second in Cycle - only touch the
    // overlays, sound and lightning when the weather itself changes.)
    if (this._active && this._shownKind !== w) {
      this._shownKind = w
      this._showOverlays(w)
      // Random eases the sound over the step too.
      audioEngine.setWeatherAudio(RAIN_SOUND[w] || 0, SNOW_SOUND[w] || 0, this.weather === 'random' ? 25 : 2)
      const l = LIGHTNING[w]
      this._lightningIn = l ? l[0] * 0.5 + Math.random() * l[1] : 0
      this.screen.set(SCREEN[w] || {})
    }
    this._easeLook(0)
    bm._shadowsDirty = true
    this.refreshButtons()
  }

  // The sky color, daylight and fog follow the weather's goal look
  // smoothly (k: 0 = jump straight there).
  _easeLook(dt) {
    const k = dt > 0 ? 1 - Math.exp(-(this.weather === 'random' ? SKY_EASE_SLOW : SKY_EASE) * dt) : 1
    if (!this._active) {
      // Outside the editor/Play nothing is showing - no easing needed.
      this._tint.copy(this._tintGoal)
      this._mix = this._mixGoal
      this._light = this._lightGoal
      this.fogFactor = this._fogGoal
    } else {
      this._tint.lerp(this._tintGoal, k)
      this._mix += (this._mixGoal - this._mix) * k
      this._light += (this._lightGoal - this._light) * k
      this.fogFactor += (this._fogGoal - this.fogFactor) * k
    }
    this._sky.copy(this._base).lerp(this._tint, this._mix)
    // A disaster's own sky (smoke, ash, a fire's glow), then lightning.
    const d = this.disasters.look
    if (d.mix > 0.001) this._sky.lerp(d.tint, d.mix)
    const flash = this.lightning.flash
    if (flash > 0.001) this._sky.lerp(this._flashColor, Math.min(0.75, flash * 0.55))
    const lightMult = d.light * (1 + flash * 1.6)
    const bm = this.bm
    // Puddles, water and far haze mirror this colour (BlockChunks).
    bm._chunks?.fx.sky.value.copy(this._sky)
    // Clear days are clear to the edge (2026-10-25, Gaymi: far buildings
    // looked see-through and foggy one way, picked "clear in clear
    // weather"): the graphics level's far haze only comes in with the
    // weather (BuildMode._applyGraphicsLook) and the fog's last stretch
    // shrinks (_applyViewDistance).
    this.clearness = 1 - Math.min(1, this._mix * 1.5)
    this.bodies?.setLite(!!bm.look?.lite)
    // Realistic light (graphics levels): a stronger, warmer sun and a
    // softer, bluer sky light, so shade looks cool and sunlit faces warm,
    // like outdoors.
    const real = bm.look?.realLight
    if (bm._hemiLight) bm._hemiLight.intensity = this._hemiBase * this._light * lightMult * (real ? 0.78 : 1)
    if (bm._sunLight) {
      bm._sunLight.intensity = this._sunBase * this._light * d.light * (real ? 1.35 : 1)
      if (this._sunColor) bm._sunLight.color.copy(this._sunColor)
      if (real) bm._sunLight.color.multiply(this._a.setRGB(1, 0.95, 0.86))
    }
    if (bm._hemiLight && this._hemiColor) {
      bm._hemiLight.color.copy(this._hemiColor)
      if (real) bm._hemiLight.color.lerp(this._a.setRGB(0.78, 0.86, 1), 0.35)
    }
  }

  // A rainbow in the sky now (the after-rain roll; also handy for tests).
  showRainbow() {
    if (this.nightAmount() < 0.35) this._rainbowIn = RAINBOW_S
  }

  // For the top bar (TopBar.js, 2026-10-18): the weather showing now, how
  // strong its look is (0-1), how dark it is (0-1) and the time of day as
  // hours (0-24; noon at phase 0, midnight at 0.5).
  topBarLook() {
    const w = this._now || 'clear'
    const d = this.disasters.active
    return { weather: w, strength: WEATHER_LOOK[w]?.[1] ?? 0, night: this.nightAmount(), hours: (12 + this._phase() * 24) % 24, disaster: d && !d.done ? d.kind : null }
  }

  // 0 in daylight ... 1 at night.
  nightAmount() {
    const [from, to, s] = this._lookAt(this._phase())
    const n = (look) => (look === LOOKS.night ? 1 : look === LOOKS.sunset ? 0.35 : 0)
    return n(from) + (n(to) - n(from)) * s
  }

  // Stars like the real night sky (2026-10-24, Gaymi: "should just look
  // like how it looks irl"): tiny round points, mostly faint, a few bright,
  // slightly blue or warm, gently twinkling. The faintest ones only show
  // while zoomed in (`zoom`, hold V) - like looking through binoculars - so
  // zooming doesn't leave an empty sky.
  _buildStars() {
    const count = STAR_COUNT + DEEP_STARS
    const pos = new Float32Array(count * 3)
    const look = new Float32Array(count * 4) // size (px), brightness, tint (-1 blue .. 1 warm), twinkle speed
    // 0 for the everyday stars; for the faint extra ones, how far zoomed in
    // (normal FOV / FOV) they need to be to show.
    const deep = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      // Points on a big sphere, mostly above the horizon.
      const u = Math.random() * Math.PI * 2
      const v = Math.asin(Math.random() * 1.08 - 0.08)
      const r = 150
      pos[i * 3] = Math.cos(u) * Math.cos(v) * r
      pos[i * 3 + 1] = Math.sin(v) * r
      pos[i * 3 + 2] = Math.sin(u) * Math.cos(v) * r
      // Real brightness: lots of faint stars, very few bright ones.
      const b = Math.pow(Math.random(), 3.2)
      look[i * 4] = 2.2 + b * 3.4
      look[i * 4 + 1] = 0.16 + b * 0.84
      look[i * 4 + 2] = Math.random() < 0.6 ? 0 : Math.random() * 2 - 1
      look[i * 4 + 3] = 1.5 + Math.random() * 3
      if (i >= STAR_COUNT) {
        deep[i] = 1.3 + Math.random() * 2.2
        look[i * 4 + 1] = 0.3 + Math.random() * 0.4
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('look', new THREE.BufferAttribute(look, 4))
    geo.setAttribute('deep', new THREE.BufferAttribute(deep, 1))
    const mat = new THREE.ShaderMaterial({
      uniforms: { opacity: { value: 0 }, time: { value: 0 }, ratio: { value: 1 }, zoom: { value: 1 } },
      vertexShader: `attribute vec4 look; attribute float deep; uniform float time; uniform float ratio; uniform float zoom; varying float vLight; varying vec3 vTint;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          // Zoomed in, faint stars come out and every star looks a bit bigger.
          float seen = deep > 0.0 ? smoothstep(deep, deep + 0.5, zoom) : smoothstep(0.1, 0.32, look.y * sqrt(zoom));
          if (seen < 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vLight = 0.0; vTint = vec3(0.0); return; }
          gl_PointSize = look.x * ratio * (0.85 + 0.15 * sqrt(zoom));
          float twinkle = 0.78 + 0.22 * sin(time * look.w + position.x * 3.1 + position.z);
          vLight = min(1.0, look.y * 1.15) * seen * twinkle;
          vTint = look.z > 0.0 ? mix(vec3(1.0), vec3(1.0, 0.86, 0.7), look.z) : mix(vec3(1.0), vec3(0.75, 0.85, 1.0), -look.z);
        }`,
      fragmentShader: `uniform float opacity; varying float vLight; varying vec3 vTint;
        void main() {
          // A soft round dot, brightest in the middle.
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = pow(max(0.0, 1.0 - d), 1.8) * vLight * opacity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vTint, a);
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    })
    this._stars = new THREE.Points(geo, mat)
    this._stars.frustumCulled = false
    this._stars.visible = false
    this._stars.renderOrder = -2
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
    if (this._stars.visible) {
      const u = this._stars.material.uniforms
      u.time.value += dt
      u.ratio.value = bm.renderer?.getPixelRatio?.() || 1
      u.zoom.value = (this.bm._normalFov?.() || 75) / bm.camera.fov
    }
    luck.update(dt, this._active && !!bm.survival?.active)
    if (!this._active) return
    this._updateWind(dt)
    this.lightning.update(dt)
    this._easeLook(dt)
    this.weather3d.setSlow(this.weather === 'random')
    // Thunder still on its way.
    for (let i = this._thunder.length - 1; i >= 0; i--) {
      if ((this._thunder[i][0] -= dt) <= 0) {
        audioEngine.playThunder?.(this._thunder[i][1])
        this._thunder.splice(i, 1)
      }
    }
    this.disasters.update(dt, bm.camera)
    if (!this._following && this.weather === 'random') this.disasters.roll(dt)
    // The worst weather on your view, or a disaster's.
    const ds = this.disasters.screen
    const ws = SCREEN[this._now] || {}
    this.screen.set({ frost: Math.max(ws.frost || 0, ds.frost), heat: Math.max(ws.heat || 0, ds.heat), gas: ds.gas, smoke: ds.smoke })
    this.screen.update(dt, true)
    this._eclipse += ((this._now === 'eclipse' ? 1 : 0) - this._eclipse) * Math.min(1, dt * SKY_EASE)
    // How overcast it is, before night dims the tint (rain clouds stay at
    // night), and the moon's phase - a new one each game day, changing at
    // noon while the moon is down.
    const cover = this._now === 'eclipse' ? 0 : this._mix / Math.max(0.4, 1 - this.nightAmount() * 0.6)
    const day = this.time === 'cycle' ? Math.floor(this._clock / CYCLE_SECONDS + 0.5) : 1
    // The rainbow lasts while it stays clear; new rain or nightfall ends it.
    this._rainbowIn = this._now === 'clear' && this.nightAmount() < 0.35 ? this._rainbowIn - dt : 0
    // Following the host: its weather comes with each sync, nothing rolls here.
    if (this._following) {
      this.rainbow += ((this._rainbowIn > 0 ? 1 : 0) - this.rainbow) * Math.min(1, dt * RAINBOW_FADE)
      if (this.rainbow < 0.001 && this._rainbowIn <= 0) this.rainbow = 0
      this.bodies.update(dt, bm.camera, this._phase(), cover, 1 - this.nightAmount(), this._sky, this._eclipse, MOON_PHASES[(day + 3) % MOON_PHASES.length], this.rainbow)
      this.weather3d.update(dt)
      this._lightning(dt)
      return
    }
    this.rainbow += ((this._rainbowIn > 0 ? 1 : 0) - this.rainbow) * Math.min(1, dt * RAINBOW_FADE)
    if (this.rainbow < 0.001 && this._rainbowIn <= 0) this.rainbow = 0
    this.bodies.update(dt, bm.camera, this._phase(), cover, 1 - this.nightAmount(), this._sky, this._eclipse, MOON_PHASES[(day + 3) % MOON_PHASES.length], this.rainbow)
    this.weather3d.update(dt)
    if (this.weather === 'random') {
      // Walked into a different climate: re-roll if what's falling can't
      // happen here (no snow in the desert).
      this._climateIn -= dt
      if (this._climateIn <= 0) {
        this._climateIn = CLIMATE_CHECK_S
        const climate = this._climateAt()
        if (climate !== this._climate) {
          this._climate = climate
          if (this._goal !== 'clear' && this._goal !== 'eclipse' && !CLIMATES[climate].some(([kind]) => kind === this._goal)) this._rerollIn = 0
        }
      }
      // The next roll only counts down once the last one has arrived.
      if (this._now === this._goal) this._rerollIn -= dt
      else if ((this._stepIn -= dt) <= 0) {
        this._stepIn = STEP_S
        const was = this._now
        this._now = this._step()
        // As snow ends, now and then a spell of sleet first.
        if (this._now === 'clear' && LADDER_OF[was] === 'snow' && Math.random() < SLEET_CHANCE) this._now = 'sleet'
        if (this._now === 'clear' && (LADDER_OF[was] === 'rain' || LADDER_OF[was] === 'hail' || LADDER_OF[was] === 'freezing') && Math.random() < RAINBOW_CHANCE) this.showRainbow()
        this.apply()
      }
      if (this._rerollIn <= 0) this._pickWeather(false)
    }
    this._lightning(dt)
  }

  // The wind: each weather's strength, gusting, its direction turning
  // slowly; the drops and dust blow with it. Under a roof you're out of it.
  _updateWind(dt) {
    this._windTime += dt
    this._windAng += Math.sin(this._windTime * 0.013) * 0.004 + (Math.random() - 0.5) * 0.002
    const base = WIND[this._now] ?? WIND.clear
    const gust = 1 + 0.35 * Math.sin(this._windTime * 0.7) * Math.sin(this._windTime * 1.9 + 1)
    const k = 1 - Math.exp(-dt * (this.weather === 'random' ? 0.05 : 0.8))
    this.wind.x += (Math.cos(this._windAng) * base * gust - this.wind.x) * k
    this.wind.y += (Math.sin(this._windAng) * base * gust - this.wind.y) * k
    const len = this.wind.length()
    if (len > 0.01) this.weather3d.windDir.set(this.wind.x / len, this.wind.y / len)
    if ((this._shelterIn -= dt) <= 0) {
      this._shelterIn = 0.5
      const p = this.disasters.me()
      let roof = false
      for (let y = Math.floor(p.y) + 2; y < Math.floor(p.y) + 14 && !roof; y++) roof = !!this.bm.getBlockAt(Math.floor(p.x), y, Math.floor(p.z))
      this._sheltered = roof
    }
  }

  // Lightning in storms (LIGHTNING): hard strikes fork down to the ground
  // round you, soft ones flash inside the clouds; the thunder follows,
  // later and duller from farther away.
  _lightning(dt) {
    const l = LIGHTNING[this._now]
    if (!l || this._lightningIn <= 0) {
      if (l) this._lightningIn = l[0] + Math.random() * l[1]
      return
    }
    this._lightningIn -= dt
    if (this._lightningIn > 0) return
    this._lightningIn = l[0] + Math.random() * l[1]
    const B = this.B
    const hard = Math.random() < l[2]
    const { dist } = this.lightning.strike(this.bm.camera.position, hard, (x, z) => this.disasters.topAt(x / B, z / B) * B)
    const blocks = dist / B
    this.addFlash(1)
    if (hard && blocks < 70) this.screenFlash()
    const gain = Math.max(0.15, 1 - blocks / 360)
    this._thunder.push([hard ? 0.3 + blocks / 140 : 1.5 + Math.random() * 3, { gain, soft: !hard }])
  }
}
