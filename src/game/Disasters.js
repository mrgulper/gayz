// Natural disasters (2026-10-30, Gaymi: "Now i wanna add some nature
// disasters ... Must make them look very realistic as they were in real
// life"). Owned by BuildSky (`sky.disasters`); drawn with DisasterFx.js.
//
// Gaymi's picks: they hurt you and make small world changes by default
// (only natural ground - your builds are safe), and Settings > General >
// "Disasters Can Break Anything" lets them wreck builds too; they're rare
// (about one every few game days, only where they make sense); impact
// events (asteroids, meteoroids, comets) are as rare as the eclipse and
// give 10x luck for 24 game hours (Luck.js).
//
// How it runs: in a game, every game hour (ROLL_S) there's a small chance
// (CHANCE) of one of the disasters that fit where you are and the weather
// (`fits`); the impacts are rolled with the eclipse (BuildSky._pickWeather).
// Each disaster is a little script (RUN) that spawns its effects round an
// anchor spot, shakes the camera, hurts you if you're caught, changes a few
// blocks and ends after its own time. The pause screen's Disaster button
// starts any of them to look at. On a server the host's disaster (kind,
// seed, spot, time) goes out with the sky (BuildSky.skyState) and everyone
// runs the same one from the same seed.
//
// World changes only happen in a game (never to a map in the editor), a
// limited number of blocks each, and never inside the camp.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { sampleLand, inCity } from './OpenWorld.js'
import { luck } from './Luck.js'
import { Emitter, Debris, WaterSheet, Wave, Aurora, Fireball, seeded } from './DisasterFx.js'

export const DISASTERS = ['flood', 'flashFlood', 'drought', 'wildfire', 'forestFire', 'avalanche', 'limnicEruption', 'earthquake', 'tsunami', 'volcanicEruption', 'landslide', 'mudslide', 'rockfall', 'sinkhole', 'subsidence', 'solarFlare', 'geomagneticStorm', 'meteoroid', 'asteroid', 'comet']
export const IMPACTS = ['meteoroid', 'asteroid', 'comet']
const ROLL_S = 60 // one game hour
// Rare: about one in three game days.
const CHANCE = 1 / 72
const MAX_BLOCK_CHANGES = 400
const RAINY = /Rain$|^drizzle$|^thunderstorm$|^hail$|^sleet$|^iceStorm$/
const HARD_RAIN = /^(hardRain|thunderstorm|iceStorm)$/
const SNOWY_BIOMES = new Set(['snowyPeaks', 'snowyTaiga', 'snowyPlains', 'iceSpikes', 'snowyBeach'])
const FOREST_BIOMES = new Set(['forest', 'birchForest', 'darkForest', 'taiga', 'snowyTaiga', 'jungle', 'bambooJungle', 'cherryGrove', 'mangroveSwamp', 'swamp'])
const GRASS_BIOMES = new Set(['plains', 'savanna', 'badlands', 'desert', 'mushroomFields', 'cherryGrove', 'birchForest', 'forest'])
const SLOPE_BIOMES = new Set(['mountains', 'snowyPeaks', 'taiga', 'badlands', 'snowyTaiga'])
const OCEANS = /cean$/

const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]

export class Disasters {
  constructor(sky, buildMode, blockSize) {
    this.sky = sky
    this.bm = buildMode
    this.B = blockSize
    this.scene = buildMode.scene
    this.kinds = DISASTERS
    this.active = null
    this.shake = 0
    // What the running disaster does to the sky (BuildSky blends it in):
    // a tint colour and how far toward it, and the daylight left.
    this.look = { tint: new THREE.Color(), mix: 0, light: 1 }
    this.screen = { frost: 0, heat: 0, gas: 0, smoke: 0 }
    this.push = new THREE.Vector2() // blocks/s, pushes you along (BuildTryMode)
    this.slow = 1 // walking speed in flood water
    this._rollIn = ROLL_S
    this._tops = new Map()
    this._topsAge = 0
    this._changes = 0
    this._shakeOff = new THREE.Vector3()
    this._auroraNext = false
    this.aurora = null
    this._auroraAlpha = 0
  }

  // --- helpers the scripts use ---

  // Where you are (blocks, feet).
  me() {
    const tm = this.bm.tryMode
    if (tm?.active || this.bm.spectate?.active) return tm.pos
    const p = this.bm.camera.position
    return { x: p.x / this.B, y: p.y / this.B - 1.6, z: p.z / this.B }
  }

  inGame() {
    return !!this.bm.survival?.active
  }

  breakAll() {
    return !!this.bm.game?.settings?.disasterBreakAll
  }

  // The top of the ground in a column (the y you'd stand at): real blocks
  // near `from` where they're loaded, else the land's height.
  topAt(x, z, from) {
    const fx = Math.floor(x)
    const fz = Math.floor(z)
    const key = `${fx},${fz}`
    const cached = this._tops.get(key)
    if (cached !== undefined && from === undefined) return cached
    const bm = this.bm
    const start = Math.floor(from ?? this.me().y + 24)
    for (let y = start; y > start - 48; y--) {
      const b = bm.getBlockAt(fx, y, fz)
      if (b && b !== 'water' && b !== 'lava' && !bm.isPlantBlock?.(b)) {
        if (from === undefined) this._tops.set(key, y + 1)
        return y + 1
      }
    }
    const h = bm.world?.active && !inCity(fx, fz) ? sampleLand(fx, fz).h + 1 : Math.floor(this.me().y)
    if (from === undefined) this._tops.set(key, h)
    return h
  }

  land(x, z) {
    return this.bm.world?.active && !inCity(Math.floor(x), Math.floor(z)) ? sampleLand(Math.floor(x), Math.floor(z)) : null
  }

  hurt(amount) {
    const s = this.bm.survival
    if (s?.active && !s.dead) s._hurtPlayer(amount)
  }

  // Hurt at most once every `every` seconds from one source.
  hurtOver(src, amount, every = 1) {
    const now = performance.now()
    this._hurtAt ||= {}
    if (now - (this._hurtAt[src] || 0) < every * 1000) return
    this._hurtAt[src] = now
    this.hurt(amount)
  }

  // May a disaster change this block? Only in a game, never in the camp;
  // only natural ground unless "Disasters Can Break Anything" is on.
  canChange(x, y, z) {
    if (!this.inGame() || this._changes >= MAX_BLOCK_CHANGES) return false
    const bm = this.bm
    if (bm.survival.camp?.inside?.(x + 0.5, z + 0.5)) return false
    const type = bm.getBlockAt(x, y, z)
    if (!type || type === 'water' || type === 'lava' || type === 'bedrock') return false
    if (this.breakAll()) return true
    return !!bm.world?.active && bm.world.isTerrain(bm._key(x, y, z))
  }

  removeAt(x, y, z) {
    if (!this.canChange(x, y, z)) return null
    const type = this.bm.getBlockAt(x, y, z)
    const was = this.bm._suppressUndoRecording
    this.bm._suppressUndoRecording = true
    try {
      this.bm.removeBlock(x, y, z)
    } finally {
      this.bm._suppressUndoRecording = was
    }
    this._changes++
    this._tops.clear()
    return type
  }

  replaceAt(x, y, z, type) {
    if (!this.canChange(x, y, z)) return false
    const was = this.bm._suppressUndoRecording
    this.bm._suppressUndoRecording = true
    try {
      this.bm.removeBlock(x, y, z)
      this.bm.placeBlock(x, y, z, type)
    } finally {
      this.bm._suppressUndoRecording = was
    }
    this._changes++
    return true
  }

  // A natural block left behind (fallen rock, mud, snow) in an empty cell.
  placeAt(x, y, z, type) {
    if (!this.inGame() || this._changes >= MAX_BLOCK_CHANGES || this.bm.getBlockAt(x, y, z)) return false
    if (this.bm.survival.camp?.inside?.(x + 0.5, z + 0.5)) return false
    const p = this.me()
    // Never inside you.
    if (Math.floor(p.x) === x && Math.floor(p.z) === z && y >= Math.floor(p.y) - 0 && y <= Math.floor(p.y) + 1) return false
    const was = this.bm._suppressUndoRecording
    this.bm._suppressUndoRecording = true
    try {
      this.bm.placeBlock(x, y, z, type)
    } finally {
      this.bm._suppressUndoRecording = was
    }
    this._changes++
    this._tops.clear()
    return true
  }

  colorOf(type) {
    const c = this.bm._blockColor?.(type)
    return typeof c === 'number' ? c : 0x777777
  }

  // Water round here: the way to the nearest ocean (unit vector or null)
  // and a nearby lake/river spot (or null).
  water(x, z) {
    let ocean = null
    let oceanD = Infinity
    let fresh = null
    let freshD = Infinity
    let count = 0
    const sea = this.bm.world?.sea ?? -4
    for (const r of [12, 24, 40, 60, 90]) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        const px = x + Math.cos(a) * r
        const pz = z + Math.sin(a) * r
        const s = this.land(px, pz)
        if (!s) continue
        const wet = s.h < sea || s.river || s.biome === 'river' || OCEANS.test(s.biome)
        if (!wet) continue
        count++
        if (OCEANS.test(s.biome)) {
          if (r < oceanD) {
            oceanD = r
            ocean = { x: Math.cos(a), z: Math.sin(a), d: r }
          }
        } else if (r < freshD) {
          freshD = r
          fresh = { x: px, z: pz, d: r }
        }
      }
    }
    return { ocean, fresh, count }
  }

  // The highest ground in a ring round (x, z), radius r0..r1.
  highest(x, z, r0, r1, rand) {
    let best = null
    for (let i = 0; i < 28; i++) {
      const a = rand() * Math.PI * 2
      const r = r0 + rand() * (r1 - r0)
      const px = x + Math.cos(a) * r
      const pz = z + Math.sin(a) * r
      const h = this.topAt(px, pz)
      if (!best || h > best.y) best = { x: px, y: h, z: pz }
    }
    return best
  }

  message(kind) {
    this.bm.survival?.active && this.bm.survival._message?.(t('disasterWarn', { name: t(`disaster_${kind}`) }), 4)
  }

  emitter(run, opts) {
    const e = new Emitter(this.scene, this.B, opts)
    run.fx.push(e)
    return e
  }

  debris(run, opts) {
    const d = new Debris(this.scene, this.B, opts)
    run.fx.push(d)
    return d
  }

  // --- which disasters fit here ---

  fits(kind, p) {
    const s = this.land(p.x, p.z)
    const sky = this.sky
    const weather = sky._now || 'clear'
    const night = sky.nightAmount()
    const biome = s?.biome || 'plains'
    const raining = RAINY.test(weather)
    switch (kind) {
      case 'flood': return raining && (HARD_RAIN.test(weather) || this.water(p.x, p.z).count >= 6)
      // Only in very hard rain, or right by big water.
      case 'flashFlood': return HARD_RAIN.test(weather) || (raining && this.water(p.x, p.z).count >= 14)
      case 'drought': return !raining && ['desert', 'savanna', 'badlands', 'plains'].includes(biome)
      case 'wildfire': return !raining && GRASS_BIOMES.has(biome)
      case 'forestFire': return !raining && FOREST_BIOMES.has(biome) && biome !== 'swamp' && biome !== 'mangroveSwamp'
      case 'avalanche': return SNOWY_BIOMES.has(biome) || (biome === 'mountains' && /Snow|blizzard|snowstorm/.test(weather))
      case 'limnicEruption': return !!this.water(p.x, p.z).fresh
      // Only with lots of water near.
      case 'tsunami': return !!this.water(p.x, p.z).ocean
      case 'volcanicEruption': return SLOPE_BIOMES.has(biome) || biome === 'badlands'
      case 'landslide': return SLOPE_BIOMES.has(biome)
      case 'mudslide': return (raining || this.bm.sky.weather3d.ground.wet.value > 0.5) && (SLOPE_BIOMES.has(biome) || FOREST_BIOMES.has(biome))
      case 'rockfall': return SLOPE_BIOMES.has(biome)
      case 'sinkhole': case 'subsidence': return !OCEANS.test(biome)
      case 'solarFlare': return night < 0.3 && weather === 'clear'
      case 'geomagneticStorm': return night > 0.6
      case 'earthquake': return true
      default: return false
    }
  }

  // --- running ---

  start(kind, opts = {}) {
    if (!RUN[kind]) return
    this.end()
    const p = this.me()
    const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31)
    const rand = seeded(seed)
    const run = { kind, seed, t: 0, fx: [], x: opts.x ?? p.x, z: opts.z ?? p.z, rand, done: false, tail: 0 }
    this.active = run
    this._changes = 0
    RUN[kind].start?.(this, run)
    if (opts.t) this._fastForward(run, opts.t)
    if (!opts.quiet) this.message(kind)
    if (IMPACTS.includes(kind)) luck.start()
    if (kind === 'solarFlare' && rand() < 0.6) this._auroraNext = true
  }

  _fastForward(run, t) {
    // Joining late on a server: skip ahead without the noise.
    run.t = Math.max(0, t - 0.5)
  }

  end() {
    const run = this.active
    if (!run) return
    RUN[run.kind].end?.(this, run)
    for (const f of run.fx) f.dispose()
    this.active = null
    this.shake = 0
    this.look.mix = 0
    this.look.light = 1
    for (const k in this.screen) this.screen[k] = 0
    this.push.set(0, 0)
    this.slow = 1
    audioEngine.disasterBed?.(0)
  }

  // On a server: what's running, for the others to copy.
  state() {
    const r = this.active
    return r && !r.done ? { k: r.kind, s: r.seed, x: +r.x.toFixed(1), z: +r.z.toFixed(1), t: +r.t.toFixed(1) } : null
  }

  follow(d) {
    if (!d) {
      if (this.active) this.end()
      return
    }
    if (!RUN[d.k] || !Number.isFinite(d.s) || !Number.isFinite(d.x) || !Number.isFinite(d.z)) return
    if (this.active?.seed === d.s) return
    this.start(d.k, { seed: d.s, x: d.x, z: d.z, t: Number(d.t) || 0 })
  }

  // A game hour went by: maybe a disaster (not while one's running).
  roll(dt) {
    if (this.active || !this.inGame()) return
    this._rollIn -= dt
    if (this._rollIn > 0) return
    this._rollIn = ROLL_S
    const p = this.me()
    if (this._auroraNext && this.sky.nightAmount() > 0.6) {
      this._auroraNext = false
      this.start('geomagneticStorm')
      return
    }
    if (Math.random() >= CHANCE) return
    const kinds = DISASTERS.filter((k) => !IMPACTS.includes(k) && this.fits(k, p))
    if (kinds.length) this.start(kinds[Math.floor(Math.random() * kinds.length)])
  }

  update(dt, camera) {
    this._topsAge += dt
    if (this._topsAge > 1) {
      this._topsAge = 0
      this._tops.clear()
    }
    const run = this.active
    // The aurora fades slowly on its own.
    const auroraGoal = run?.kind === 'geomagneticStorm' && !run.done ? Math.min(1, this.sky.nightAmount() * 1.2) * 0.9 : 0
    this._auroraAlpha += (auroraGoal - this._auroraAlpha) * Math.min(1, dt * 0.15)
    if (this._auroraAlpha > 0.003 && !this.aurora) this.aurora = new Aurora(this.scene)
    this.aurora?.update(dt, camera, this._auroraAlpha)
    if (!run) return
    run.t += dt
    const R = RUN[run.kind]
    // What the disaster does to the sky and your view fades unless it's
    // kept up (the scripts set it each frame).
    const fade = Math.exp(-dt * 0.5)
    this.look.mix *= fade
    this.look.light = 1 + (this.look.light - 1) * fade
    for (const k in this.screen) this.screen[k] *= fade
    if (!run.done) {
      R.update(this, run, dt)
      if (run.t >= run.dur) {
        run.done = true
        this.shake = 0
        audioEngine.disasterBed?.(0)
      }
    } else {
      run.tail += dt
      // Let the effects settle (smoke drifting off, rocks coming to rest).
      R.after?.(this, run, dt)
    }
    const wind = this.sky.wind
    let alive = 0
    const groundAt = (x, z, y) => this.topAt(x, z, y)
    for (const f of run.fx) {
      if (f instanceof Emitter) {
        f.update(dt, camera, this.bm.renderer, wind)
        alive += f.list.length
      } else if (f instanceof Debris) alive += f.update(dt, groundAt, (p) => this._debrisHit(p))
      else if (f.update) f.update(dt, this.sky._sky, this.sky._light)
    }
    if (run.done && (run.tail > 25 || (alive === 0 && run.tail > 2))) this.end()
  }

  // A rock (or bomb, or block) flying into you.
  _debrisHit(p) {
    if (!p.hurts || p.hit) return
    const me = this.me()
    const speed = Math.hypot(p.vx, p.vy, p.vz)
    if (speed < 3) return
    if (Math.abs(p.x - me.x) < 0.6 + p.size * 0.5 && Math.abs(p.z - me.z) < 0.6 + p.size * 0.5 && p.y > me.y - 0.3 && p.y < me.y + 2 + p.size * 0.5) {
      p.hit = true
      this.hurt(p.hurts)
      this.shake = Math.max(this.shake, 0.12)
    }
  }

  // The camera shake, for this frame's drawing only (BuildMode._render).
  beforeRender(camera) {
    if (this.shake <= 0.001) return null
    const s = this.shake * this.B
    const now = performance.now() / 1000
    // Rough, uneven shaking (several sines), heavier side to side.
    this._shakeOff.set(
      (Math.sin(now * 31) + Math.sin(now * 17.3) * 0.6) * s,
      Math.sin(now * 23.7 + 1) * s * 0.5,
      (Math.sin(now * 27.1 + 2) + Math.sin(now * 13.9) * 0.6) * s,
    )
    camera.position.add(this._shakeOff)
    return () => camera.position.sub(this._shakeOff)
  }

  // Forced weather while a drought lasts (no rain).
  blocksRain() {
    return this.active?.kind === 'drought' && !this.active.done
  }

  dispose() {
    this.end()
  }
}

// --- the disasters ---

// Ground dust kicked up somewhere (a puff of brownish grey).
function dust(D, e, x, y, z, n = 4, color = 0x8c7f6c, size = 2.4, rand = Math.random) {
  for (let i = 0; i < n; i++) {
    e.add({
      x: x + (rand() - 0.5) * 1.5, y: y + rand() * 0.5, z: z + (rand() - 0.5) * 1.5,
      vx: (rand() - 0.5) * 2, vy: 0.6 + rand() * 1.4, vz: (rand() - 0.5) * 2,
      life: 4 + rand() * 4, size: size * (0.6 + rand() * 0.6), grow: 0.9, color: rgb(color), alpha: 0.55, drag: 0.8, lift: -0.05,
    })
  }
}

// Fire: flames and embers that glow, smoke that billows up.
function flames(fire, smoke, embers, x, y, z, big = 1, rand = Math.random) {
  fire.add({
    x: x + (rand() - 0.5) * 0.8, y: y + rand() * 0.3, z: z + (rand() - 0.5) * 0.8,
    vx: (rand() - 0.5) * 0.4, vy: 1.6 + rand() * 1.6 * big, vz: (rand() - 0.5) * 0.4,
    life: 0.6 + rand() * 0.6, size: (0.9 + rand() * 0.9) * big, grow: -0.3, heat: true, alpha: 0.9, drag: 1.2, lift: 1.5, fadeIn: 0.05,
  })
  if (rand() < 0.18 * big) {
    smoke.add({
      x: x + (rand() - 0.5), y: y + 1.5 * big, z: z + (rand() - 0.5),
      vx: 0, vy: 2 + rand() * 2, vz: 0,
      life: 9 + rand() * 6, size: 2.5 * big, grow: 1.6, color: rgb(0x2e2925), alpha: 0.55, drag: 0.35, lift: 0.4,
    })
  }
  if (rand() < 0.25) {
    embers.add({
      x, y: y + 0.6, z,
      vx: (rand() - 0.5) * 2, vy: 2 + rand() * 4, vz: (rand() - 0.5) * 2,
      life: 1.5 + rand() * 2.5, size: 0.12, heat: true, alpha: 1, drag: 0.5, lift: 0.8, fadeIn: 0.02,
    })
  }
}

// A crater: a bowl of radius r carved out (only what may change), its
// floor lined with glowing magma and rough basalt.
function crater(D, run, cx, cz, r) {
  const top = D.topAt(cx, cz)
  const cy = top - 1 + r * 0.35
  for (let x = Math.floor(cx - r); x <= cx + r; x++) {
    for (let z = Math.floor(cz - r); z <= cz + r; z++) {
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz)
      if (d > r) continue
      const depth = Math.sqrt(Math.max(0, r * r - d * d)) * 0.55
      for (let y = Math.floor(cy + r * 0.6); y > cy - depth; y--) D.removeAt(x, y, z)
      const floor = Math.floor(cy - depth)
      if (d < r * 0.5 && run.rand() < 0.5) D.replaceAt(x, floor, z, run.rand() < 0.5 ? 'magmablock' : 'basalt')
    }
  }
}

// An impact: the flash, the boom (late, if far), shaking, a dust column,
// glowing rocks thrown out, and the crater.
function impact(D, run, x, z, size) {
  const me = D.me()
  const dist = Math.hypot(x - me.x, z - me.z)
  const y = D.topAt(x, z)
  D.sky.addFlash(Math.min(1.8, size * 0.5 + 0.6 * Math.max(0, 1 - dist / 200)))
  if (size >= 2 && !D.bm.game?.settings?.reduceFlashing) D.sky.screenFlash()
  run.booms ||= []
  run.booms.push([run.t + Math.min(4, dist / 120), Math.min(1, size * 0.35 + Math.max(0, 1 - dist / 220) * 0.6)])
  run.quakes ||= []
  run.quakes.push([run.t + Math.min(4, dist / 120) * 0.7, Math.min(0.45, size * 0.08 + Math.max(0, 1 - dist / 160) * 0.25)])
  const e = run.impactSmoke
  for (let i = 0; i < 40 * size; i++) {
    const a = run.rand() * Math.PI * 2
    const sp = run.rand()
    e.add({
      x: x + Math.cos(a) * sp * 2, y: y + run.rand() * 2, z: z + Math.sin(a) * sp * 2,
      vx: Math.cos(a) * sp * 8 * size, vy: 4 + run.rand() * 14 * Math.sqrt(size), vz: Math.sin(a) * sp * 8 * size,
      life: 14 + run.rand() * 12, size: 3 * size, grow: 1.6 * size, color: rgb(run.rand() < 0.5 ? 0x5a514a : 0x7a6e60), alpha: 0.7, drag: 0.6, lift: 0.3,
    })
  }
  for (let i = 0; i < 18 * size; i++) {
    const a = run.rand() * Math.PI * 2
    run.impactFire.add({
      x, y: y + 0.5, z,
      vx: Math.cos(a) * (3 + run.rand() * 8) * size, vy: 6 + run.rand() * 10, vz: Math.sin(a) * (3 + run.rand() * 8) * size,
      life: 0.8 + run.rand() * 0.8, size: 1.6 * size, grow: 1, heat: true, alpha: 1, drag: 1.4, lift: -4, fadeIn: 0.02,
    })
  }
  for (let i = 0; i < 6 + 4 * size; i++) {
    const a = run.rand() * Math.PI * 2
    const sp = 6 + run.rand() * 10
    run.rocks.add({
      x, y: y + 1, z, vx: Math.cos(a) * sp, vy: 8 + run.rand() * 12, vz: Math.sin(a) * sp,
      size: 0.4 + run.rand() * 0.8, color: run.rand() < 0.5 ? 0x3a3330 : 0x5a4a40, hurts: 18, life: 12,
    })
  }
  if (dist < 260) crater(D, run, x, z, Math.min(7, 1.5 + size * 1.5))
}

// Rocks / clods / snow rolling down from a high spot toward (and past) you.
function slideStart(D, run, opts) {
  const me = D.me()
  const src = D.highest(run.x, run.z, 14, 40, run.rand)
  run.src = src && src.y > me.y + 5 ? src : { x: run.x + 20, y: me.y + 16, z: run.z }
  run.dir = new THREE.Vector2(me.x - run.src.x, me.z - run.src.z).normalize()
  run.dur = opts.dur
  run.debris = D.debris(run, { max: opts.max, shape: opts.shape })
  run.dust = D.emitter(run, { max: 900 })
  run.spawned = 0
  run.left = 0
  if (opts.scar) {
    // The slope gives way: the top layer at the source slides off.
    for (let i = 0; i < 18; i++) {
      const x = Math.floor(run.src.x + (run.rand() - 0.5) * 6)
      const z = Math.floor(run.src.z + (run.rand() - 0.5) * 6)
      D.removeAt(x, D.topAt(x, z) - 1, z)
    }
  }
}

function slideUpdate(D, run, dt, opts) {
  const spawnFor = opts.spawnFor
  if (run.t < spawnFor && run.spawned < opts.count) {
    run.left += dt * (opts.count / spawnFor)
    while (run.left >= 1 && run.spawned < opts.count) {
      run.left--
      run.spawned++
      const across = (run.rand() - 0.5) * opts.width
      const x = run.src.x - run.dir.y * across + (run.rand() - 0.5) * 3
      const z = run.src.z + run.dir.x * across + (run.rand() - 0.5) * 3
      const sp = opts.speed * (0.7 + run.rand() * 0.6)
      const size = opts.size[0] + run.rand() * (opts.size[1] - opts.size[0])
      const type = opts.types[Math.floor(run.rand() * opts.types.length)]
      run.debris.add({
        x, y: run.src.y + 1 + run.rand() * 2, z,
        vx: run.dir.x * sp, vy: -1, vz: run.dir.y * sp, size, roll: opts.roll,
        color: opts.colors ? opts.colors[Math.floor(run.rand() * opts.colors.length)] : D.colorOf(type),
        hurts: Math.round(opts.hurt * size), life: 20,
        bounced: (p) => dust(D, run.dust, p.x, p.y - p.size * 0.5, p.z, 2, opts.dustColor, 1.6 + p.size, run.rand),
        onRest: (p) => {
          if (p.size >= opts.leave && run.rand() < 0.7) D.placeAt(Math.floor(p.x), Math.floor(p.y - p.size * 0.4), Math.floor(p.z), type)
        },
      })
    }
  }
  // A dust cloud rolling along with the front.
  for (const p of run.debris.list) {
    if (run.rand() < dt * 3) dust(D, run.dust, p.x, p.y, p.z, 1, opts.dustColor, 2 + p.size, run.rand)
  }
  D.shake = run.t < spawnFor ? opts.shake : D.shake * 0.95
  audioEngine.disasterBed?.(run.t < spawnFor + 3 ? opts.loud : 0, 'roar')
}

const RUN = {
  earthquake: {
    start(D, run) {
      run.dur = 34
      run.dust = D.emitter(run, { max: 900 })
      run.debris = D.debris(run, { max: 60, shape: 'box' })
      const a = run.rand() * Math.PI * 2
      run.crack = { a, i: 0, len: 8 + Math.floor(run.rand() * 8), x: run.x + Math.cos(a + 1.5) * 8, z: run.z + Math.sin(a + 1.5) * 8 }
      run.next = 0
    },
    update(D, run, dt) {
      const t = run.t
      // The first waves are a quick rattle; the strong ones come a few
      // seconds later, peak and die away with aftershocks.
      const p = t < 4 ? 0.04 * (t / 4) : 0
      const s = t >= 4 ? 0.32 * Math.exp(-Math.pow((t - 10) / 6, 2)) + 0.05 * Math.max(0, 1 - (t - 4) / 30) : 0
      const after = t > 22 ? 0.06 * Math.max(0, Math.sin((t - 22) * 1.3)) * Math.max(0, 1 - (t - 22) / 12) : 0
      D.shake = p + s + after
      audioEngine.disasterBed?.(Math.min(1, D.shake * 4), 'rumble')
      const me = D.me()
      if (D.shake > 0.08 && run.rand() < dt * 14) {
        const a = run.rand() * Math.PI * 2
        const r = 3 + run.rand() * 22
        const x = me.x + Math.cos(a) * r
        const z = me.z + Math.sin(a) * r
        dust(D, run.dust, x, D.topAt(x, z), z, 2, 0x8c7f6c, 2, run.rand)
      }
      // The ground cracks open, a cell at a time.
      const c = run.crack
      if (t > 8 && c.i < c.len && (run.next -= dt) <= 0) {
        run.next = 0.09
        const x = Math.floor(c.x + Math.cos(c.a) * c.i + (run.rand() - 0.5))
        const z = Math.floor(c.z + Math.sin(c.a) * c.i + (run.rand() - 0.5))
        const top = D.topAt(x, z)
        const deep = 2 + Math.floor(run.rand() * 3)
        for (let y = top - 1; y >= top - deep; y--) D.removeAt(x, y, z)
        dust(D, run.dust, x + 0.5, top, z + 0.5, 5, 0x7d705e, 2.2, run.rand)
        c.i++
      }
      // Anything may come down: loose blocks of builds fall.
      if (D.breakAll() && D.shake > 0.15 && run.rand() < dt * 3) {
        for (let tries = 0; tries < 12; tries++) {
          const x = Math.floor(me.x + (run.rand() - 0.5) * 28)
          const y = Math.floor(me.y + run.rand() * 10)
          const z = Math.floor(me.z + (run.rand() - 0.5) * 28)
          const type = D.bm.getBlockAt(x, y, z)
          if (!type || D.bm.world?.isTerrain(D.bm._key(x, y, z))) continue
          if (D.removeAt(x, y, z)) {
            run.debris.add({ x: x + 0.5, y: y + 0.5, z: z + 0.5, vx: (run.rand() - 0.5) * 2, vy: 1, vz: (run.rand() - 0.5) * 2, size: 0.9, color: D.colorOf(type), hurts: 12, life: 6 })
            break
          }
        }
      }
    },
  },

  sinkhole: {
    start(D, run) {
      run.dur = 22
      const a = run.rand() * Math.PI * 2
      run.cx = run.x + Math.cos(a) * (6 + run.rand() * 10)
      run.cz = run.z + Math.sin(a) * (6 + run.rand() * 10)
      run.r = 2 + run.rand() * 2.5
      run.depth = 6 + Math.floor(run.rand() * 5)
      run.dust = D.emitter(run, { max: 900 })
      run.debris = D.debris(run, { max: 70, shape: 'box' })
      run.layer = 0
      run.next = 0
    },
    update(D, run, dt) {
      const t = run.t
      if (t < 6) {
        // Cracks and wisps of dust round the edge first.
        D.shake = 0.03
        audioEngine.disasterBed?.(0.35, 'rumble')
        if (run.rand() < dt * 6) {
          const a = run.rand() * Math.PI * 2
          const x = run.cx + Math.cos(a) * run.r
          const z = run.cz + Math.sin(a) * run.r
          dust(D, run.dust, x, D.topAt(x, z), z, 1, 0x8a7d6a, 1.4, run.rand)
        }
        return
      }
      // Then it drops: a layer at a time, quickly.
      D.shake = t < 10 ? 0.12 : D.shake * 0.97
      audioEngine.disasterBed?.(t < 10 ? 0.8 : 0.1, 'rumble')
      if (run.layer < run.depth && (run.next -= dt) <= 0) {
        run.next = 0.35
        run.top ??= Math.floor(D.topAt(run.cx, run.cz, D.me().y + 20)) - 1
        const top = run.top
        const r = run.r * (1 - run.layer / (run.depth * 2.2))
        for (let x = Math.floor(run.cx - r); x <= run.cx + r; x++) {
          for (let z = Math.floor(run.cz - r); z <= run.cz + r; z++) {
            if (Math.hypot(x + 0.5 - run.cx, z + 0.5 - run.cz) > r) continue
            // The first layer takes anything growing on top too.
            for (let y = run.layer ? top - run.layer : top + 2; y >= top - run.layer; y--) {
              const type = D.removeAt(x, y, z)
              if (type && run.rand() < 0.3) run.debris.add({ x: x + 0.5, y: y + 0.5, z: z + 0.5, vx: (run.rand() - 0.5), vy: 0, vz: (run.rand() - 0.5), size: 0.7, color: D.colorOf(type), life: 5 })
            }
          }
        }
        dust(D, run.dust, run.cx, top + 1, run.cz, 14, 0x7d705e, 3, run.rand)
        run.layer++
      }
    },
  },

  subsidence: {
    start(D, run) {
      run.dur = 40
      run.cx = run.x + (run.rand() - 0.5) * 10
      run.cz = run.z + (run.rand() - 0.5) * 10
      run.r = 6 + run.rand() * 3
      run.dust = D.emitter(run, { max: 500 })
      run.cells = []
      for (let x = Math.floor(run.cx - run.r); x <= run.cx + run.r; x++) {
        for (let z = Math.floor(run.cz - run.r); z <= run.cz + run.r; z++) {
          const d = Math.hypot(x + 0.5 - run.cx, z + 0.5 - run.cz)
          if (d <= run.r) run.cells.push([x, z, d + run.rand() * 1.5])
        }
      }
      // The middle sinks first, the rim last.
      run.cells.sort((a, b) => a[2] - b[2])
      run.i = 0
    },
    update(D, run) {
      D.shake = 0.018
      audioEngine.disasterBed?.(0.2, 'rumble')
      const want = Math.floor((run.t / 32) * run.cells.length)
      while (run.i < Math.min(want, run.cells.length)) {
        const [x, z] = run.cells[run.i++]
        const top = D.topAt(x, z) - 1
        const type = D.bm.getBlockAt(x, top, z)
        // The ground drops a block: the top stays the same kind.
        if (D.removeAt(x, top - 1, z) && type) {
          D.removeAt(x, top, z)
          D.placeAt(x, top - 1, z, type)
        }
        if (run.rand() < 0.3) dust(D, run.dust, x + 0.5, top, z + 0.5, 1, 0x8a7d6a, 1.4, run.rand)
      }
    },
  },

  rockfall: {
    start(D, run) {
      slideStart(D, run, { dur: 22, max: 40, shape: 'rock' })
    },
    update(D, run, dt) {
      slideUpdate(D, run, dt, { spawnFor: 9, count: 16, width: 10, speed: 7, size: [0.6, 1.9], types: ['stone', 'cobblestone'], colors: [0x7a7a78, 0x6a6863, 0x8a857c], roll: true, hurt: 16, leave: 1.1, dustColor: 0x8d8a84, shake: 0.05, loud: 0.5 })
    },
  },

  landslide: {
    start(D, run) {
      slideStart(D, run, { dur: 24, max: 90, shape: 'box', scar: true })
    },
    update(D, run, dt) {
      slideUpdate(D, run, dt, { spawnFor: 10, count: 60, width: 14, speed: 8, size: [0.55, 1.1], types: ['dirt', 'dirt', 'grass', 'stone'], roll: false, hurt: 14, leave: 0.8, dustColor: 0x7d6a52, shake: 0.08, loud: 0.7 })
    },
  },

  mudslide: {
    start(D, run) {
      slideStart(D, run, { dur: 26, max: 90, shape: 'box', scar: true })
    },
    update(D, run, dt) {
      slideUpdate(D, run, dt, { spawnFor: 12, count: 60, width: 12, speed: 9, size: [0.55, 1], types: ['mud', 'mud', 'dirt'], colors: [0x4a3728, 0x3d2e22, 0x5a4532], roll: true, hurt: 12, leave: 0.7, dustColor: 0x5a4a3a, shake: 0.05, loud: 0.75 })
    },
  },

  avalanche: {
    start(D, run) {
      slideStart(D, run, { dur: 28, max: 80, shape: 'box' })
      run.front = 0
      run.cloud = D.emitter(run, { max: 1400 })
    },
    update(D, run, dt) {
      slideUpdate(D, run, dt, { spawnFor: 12, count: 50, width: 18, speed: 11, size: [0.6, 1.2], types: ['snow'], colors: [0xf4f7fa, 0xe8eef4], roll: true, hurt: 10, leave: 0.7, dustColor: 0xf0f4f8, shake: 0.06, loud: 0.9 })
      // The powder cloud: a white wall racing down the slope.
      if (run.t < 14) {
        run.front += dt * 12
        for (let i = 0; i < 10; i++) {
          const across = (run.rand() - 0.5) * 26
          const x = run.src.x + run.dir.x * run.front - run.dir.y * across
          const z = run.src.z + run.dir.y * run.front + run.dir.x * across
          run.cloud.add({
            x, y: D.topAt(x, z) + run.rand() * 2, z,
            vx: run.dir.x * 10, vy: 1 + run.rand() * 3, vz: run.dir.y * 10,
            life: 5 + run.rand() * 4, size: 3 + run.rand() * 3, grow: 2.2, color: [0.96, 0.97, 0.99], alpha: 0.75, drag: 0.5, lift: 0.1,
          })
        }
        // Caught in it: knocked over and buried in snow.
        const me = D.me()
        const along = (me.x - run.src.x) * run.dir.x + (me.z - run.src.z) * run.dir.y
        const side = Math.abs(-(me.x - run.src.x) * run.dir.y + (me.z - run.src.z) * run.dir.x)
        if (side < 14 && Math.abs(along - run.front) < 3 && !run.caught) {
          run.caught = true
          D.hurt(25)
          D.push.set(run.dir.x * 9, run.dir.y * 9)
        }
        if (run.caught) D.screen.frost = 0.6
      }
      D.push.multiplyScalar(Math.exp(-dt * 1.5))
      D.sky.weather3d.ground.snow.value = Math.max(D.sky.weather3d.ground.snow.value, Math.min(1, run.t / 8))
    },
  },

  flood: {
    start(D, run) {
      run.dur = 150
      run.base = D.topAt(run.x, run.z)
      run.water = new WaterSheet(D.scene, D.B, 0x6b5a3a)
      run.fx.push(run.water)
      const a = run.rand() * Math.PI * 2
      run.water.uniforms.uFlow.value.set(Math.cos(a) * 0.4, Math.sin(a) * 0.4)
      run.water.uniforms.uFoam.value = 0.15
    },
    update(D, run, dt) {
      const t = run.t
      const rise = t < 55 ? t / 55 : t < 100 ? 1 : 1 - (t - 100) / 50
      floodWater(D, run, dt, run.base - 1 + 2.6 * THREE.MathUtils.smootherstep(rise, 0, 1), 48, 0.15, 0.25)
    },
  },

  flashFlood: {
    start(D, run) {
      run.dur = 75
      run.base = D.topAt(run.x, run.z)
      const w = D.water(run.x, run.z)
      const from = w.fresh ? new THREE.Vector2(run.x - w.fresh.x, run.z - w.fresh.z) : new THREE.Vector2(Math.cos(run.rand() * 6.3), Math.sin(run.rand() * 6.3))
      run.flow = from.lengthSq() ? from.normalize() : new THREE.Vector2(1, 0)
      run.water = new WaterSheet(D.scene, D.B, 0x7a6440)
      run.fx.push(run.water)
      run.water.uniforms.uFlow.value.set(run.flow.x * 3, run.flow.y * 3)
      run.water.uniforms.uFoam.value = 0.9
      run.spray = D.emitter(run, { max: 700 })
      run.logs = D.debris(run, { max: 14, shape: 'box' })
    },
    update(D, run, dt) {
      const t = run.t
      // A roar first, then the water comes all at once and drains slowly.
      audioEngine.disasterBed?.(t < 6 ? t / 8 : t < 35 ? 0.95 : Math.max(0, 0.95 - (t - 35) / 40), 'roar')
      const rise = t < 6 ? 0 : t < 14 ? (t - 6) / 8 : t < 35 ? 1 : 1 - (t - 35) / 40
      const level = run.base - 1 + 3.4 * THREE.MathUtils.smoothstep(rise, 0, 1)
      floodWater(D, run, dt, level, 40, 0.3, 0.5, run.flow)
      if (rise > 0.2 && run.rand() < dt * 18) {
        const me = D.me()
        const x = me.x + (run.rand() - 0.5) * 30
        const z = me.z + (run.rand() - 0.5) * 30
        run.spray.add({ x, y: level, z, vx: run.flow.x * 6, vy: 1.5 + run.rand() * 2, vz: run.flow.y * 6, life: 1.5 + run.rand(), size: 1.2, grow: 1.2, color: [0.85, 0.83, 0.75], alpha: 0.5, drag: 0.6, lift: -3 })
      }
      if (rise > 0.5 && run.logs.list.length < 8 && run.rand() < dt * 0.8) {
        const me = D.me()
        const x = me.x - run.flow.x * 25 + (run.rand() - 0.5) * 20
        const z = me.z - run.flow.y * 25 + (run.rand() - 0.5) * 20
        run.logs.add({ x, y: level + 0.2, z, vx: run.flow.x * 7, vy: 0, vz: run.flow.y * 7, size: 0.7, color: 0x5a3e24, hurts: 10, life: 8, roll: true })
      }
      // Logs float: held at the surface.
      for (const p of run.logs.list) {
        p.vy = 0
        p.y = level + 0.15 + Math.sin(run.t * 2 + p.x) * 0.1
      }
    },
  },

  tsunami: {
    start(D, run) {
      run.dur = 130
      const w = D.water(run.x, run.z)
      run.dir = w.ocean ? new THREE.Vector2(-w.ocean.x, -w.ocean.z) : new THREE.Vector2(1, 0)
      run.sea = D.bm.world?.sea ?? -4
      run.base = D.topAt(run.x, run.z)
      run.wave = new Wave(D.scene, D.B)
      run.fx.push(run.wave)
      run.water = new WaterSheet(D.scene, D.B, 0x3f5a5c)
      run.fx.push(run.water)
      run.water.uniforms.uFoam.value = 0.7
      run.spray = D.emitter(run, { max: 1200 })
      run.height = 10 + run.rand() * 4
      run.dist = 150
    },
    update(D, run, dt) {
      const t = run.t
      const me = D.me()
      // The sea draws back first (a deep rumble, an odd quiet), then the
      // wall of water comes in.
      if (t < 18) {
        audioEngine.disasterBed?.(0.25 + t / 40, 'rumble')
        D.shake = 0.02
        return
      }
      if (run.dist > -40) {
        run.dist -= dt * 14
        const fx = me.x - run.dir.x * run.dist
        const fz = me.z - run.dir.y * run.dist
        const h = run.height * (run.dist < 0 ? Math.max(0.1, 1 + run.dist / 40) : 1)
        run.wave.place(fx, Math.min(run.sea, D.topAt(fx, fz)) - 0.5, fz, run.dir.x, run.dir.y, 220, h)
        audioEngine.disasterBed?.(Math.min(1, 1.2 - run.dist / 160), 'roar')
        // Spray blowing off the crest.
        for (let i = 0; i < 6; i++) {
          const across = (run.rand() - 0.5) * 200
          run.spray.add({
            x: fx - run.dir.y * across + run.dir.x * run.height * 1.1, y: run.sea + h * 0.95, z: fz + run.dir.x * across + run.dir.y * run.height * 1.1,
            vx: run.dir.x * 14, vy: 2 + run.rand() * 3, vz: run.dir.y * 14,
            life: 2 + run.rand() * 2, size: 3, grow: 2, color: [0.9, 0.93, 0.95], alpha: 0.5, drag: 0.5, lift: -2,
          })
        }
        if (run.dist < 1 && !run.hit) {
          run.hit = true
          run.hitAt = t
          D.hurt(30)
          D.push.set(run.dir.x * 12, run.dir.y * 12)
          D.shake = 0.25
        }
      } else run.wave.mesh.visible = false
      D.shake *= Math.exp(-dt)
      D.push.multiplyScalar(Math.exp(-dt * 0.8))
      if (run.hit) {
        const s = t - run.hitAt
        const level = run.base - 1 + 4 * (s < 4 ? s / 4 : Math.max(0, 1 - (s - 20) / 70))
        floodWater(D, run, dt, level, 60, 0.35, 0.6, run.dir)
      }
    },
  },

  limnicEruption: {
    start(D, run) {
      run.dur = 95
      const w = D.water(run.x, run.z)
      run.lake = w.fresh || { x: run.x + 30, z: run.z }
      run.lake.y = Math.max(D.bm.world?.sea ?? -4, D.topAt(run.lake.x, run.lake.z))
      run.gas = D.emitter(run, { max: 1600 })
      run.spray = D.emitter(run, { max: 600 })
    },
    update(D, run, dt) {
      const t = run.t
      const L = run.lake
      // The lake churns and bursts - a fountain of water and spray.
      if (t < 16) {
        audioEngine.disasterBed?.(0.5, 'roar')
        for (let i = 0; i < (t > 6 ? 10 : 3); i++) {
          run.spray.add({
            x: L.x + (run.rand() - 0.5) * 10, y: L.y, z: L.z + (run.rand() - 0.5) * 10,
            vx: (run.rand() - 0.5) * 2, vy: t > 6 ? 8 + run.rand() * 14 : 1 + run.rand() * 2, vz: (run.rand() - 0.5) * 2,
            life: 2 + run.rand() * 2, size: 1.2, grow: 1.5, color: [0.82, 0.86, 0.85], alpha: 0.6, drag: 0.3, lift: -6,
          })
        }
      } else audioEngine.disasterBed?.(0.15, 'roar')
      // The gas: a pale, heavy cloud spilling out low over the ground.
      const r = Math.min(60, Math.max(0, t - 4) * 1.3)
      if (t < run.dur - 15) {
        for (let i = 0; i < 6; i++) {
          const a = run.rand() * Math.PI * 2
          const d = run.rand() * r
          const x = L.x + Math.cos(a) * d
          const z = L.z + Math.sin(a) * d
          run.gas.add({
            x, y: D.topAt(x, z) + run.rand() * 1.5, z,
            vx: Math.cos(a) * 1.5, vy: 0.05, vz: Math.sin(a) * 1.5,
            life: 10 + run.rand() * 8, size: 3.5 + run.rand() * 3, grow: 0.6, color: [0.82, 0.86, 0.8], alpha: 0.28, drag: 0.8, lift: -0.02,
          })
        }
      }
      // In it and low down: you can't breathe.
      const me = D.me()
      const inside = Math.hypot(me.x - L.x, me.z - L.z) < r && me.y < D.topAt(me.x, me.z) + 3.5 && t < run.dur - 10
      D.screen.gas = inside ? 0.85 : 0
      if (inside) {
        run.inFor = (run.inFor || 0) + dt
        if (run.inFor > 2) D.hurtOver('gas', 3, 1)
      } else run.inFor = 0
    },
  },

  wildfire: {
    start(D, run) {
      fireStart(D, run, false)
    },
    update(D, run, dt) {
      fireUpdate(D, run, dt, false)
    },
  },

  forestFire: {
    start(D, run) {
      fireStart(D, run, true)
    },
    update(D, run, dt) {
      fireUpdate(D, run, dt, true)
    },
  },

  drought: {
    start(D, run) {
      run.dur = 1440 // a whole game day
      run.motes = D.emitter(run, { max: 300 })
      D.sky.forceClear?.()
    },
    update(D, run, dt) {
      D.screen.heat = 0.45
      D.look.tint.setHex(0xe8c890)
      D.look.mix = 0.18
      D.look.light = 1.06
      D.sky.weather3d.dryMult = 4
      const me = D.me()
      // Dust devils and dusty air.
      if (run.rand() < dt * 8) {
        const x = me.x + (run.rand() - 0.5) * 40
        const z = me.z + (run.rand() - 0.5) * 40
        dust(D, run.motes, x, D.topAt(x, z), z, 1, 0xb89a70, 1.5, run.rand)
      }
    },
    end(D) {
      D.sky.weather3d.dryMult = 1
    },
  },

  volcanicEruption: {
    start(D, run) {
      run.dur = 130
      const v = D.highest(run.x, run.z, 70, 140, run.rand)
      run.vent = v || { x: run.x + 100, y: D.me().y + 30, z: run.z }
      run.vent.y = Math.max(run.vent.y, D.me().y + 18)
      run.ash = D.emitter(run, { max: 2200 })
      run.lava = D.emitter(run, { max: 900, glow: true, flame: true })
      run.fall = D.emitter(run, { max: 700 })
      run.trail = D.emitter(run, { max: 600 })
      run.bombs = D.debris(run, { max: 20, shape: 'rock', glow: true })
      // The lava's orange glow in the vent.
      run.glow = new Fireball(D.scene, D.B, 3.5)
      run.glow.sprite.material.color.setHex(0xff6a24)
      run.fx.push({ dispose: () => run.glow.dispose() })
      run.glow.at(run.vent.x, run.vent.y + 2, run.vent.z)
      run.nextBomb = 6
      const me = D.me()
      const dist = Math.hypot(run.vent.x - me.x, run.vent.z - me.z)
      run.booms = [[1 + dist / 120, 1]]
      run.quakes = [[0.7 + dist / 160, 0.3]]
    },
    update(D, run, dt) {
      const V = run.vent
      const t = run.t
      const strong = Math.min(1, t / 3) * (t > run.dur - 20 ? (run.dur - t) / 20 : 1)
      timed(D, run)
      audioEngine.disasterBed?.(0.4 * strong, 'rumble')
      D.shake = Math.max(D.shake * Math.exp(-dt * 2), 0.025 * strong)
      // The ash column: billowing up, spreading out with the wind at the top.
      for (let i = 0; i < 9 * strong; i++) {
        run.ash.add({
          x: V.x + (run.rand() - 0.5) * 4, y: V.y + run.rand() * 3, z: V.z + (run.rand() - 0.5) * 4,
          vx: (run.rand() - 0.5) * 3, vy: 14 + run.rand() * 14, vz: (run.rand() - 0.5) * 3,
          life: 22 + run.rand() * 14, size: 7 + run.rand() * 6, grow: 2.4, color: rgb(run.rand() < 0.5 ? 0x3a3532 : 0x544c46), alpha: 0.72, drag: 0.22, lift: -0.25,
        })
      }
      // Lava fountaining out of the vent, glowing.
      for (let i = 0; i < 14 * strong; i++) {
        run.lava.add({
          x: V.x + (run.rand() - 0.5) * 3, y: V.y + 1, z: V.z + (run.rand() - 0.5) * 3,
          vx: (run.rand() - 0.5) * 8, vy: 10 + run.rand() * 18, vz: (run.rand() - 0.5) * 8,
          life: 1.8 + run.rand(), size: 3 + run.rand() * 2, grow: -0.6, heat: true, alpha: 1, drag: 0.1, lift: -20, fadeIn: 0.02,
        })
      }
      run.glow.sprite.material.opacity = (0.45 + 0.2 * Math.sin(t * 7)) * strong
      // Ash falling round you.
      const me = D.me()
      if (t > 20) {
        for (let i = 0; i < 3; i++) {
          run.fall.add({
            x: me.x + (run.rand() - 0.5) * 50, y: me.y + 18 + run.rand() * 8, z: me.z + (run.rand() - 0.5) * 50,
            vx: 0, vy: -2.2, vz: 0, life: 12, size: 0.25 + run.rand() * 0.3, color: [0.35, 0.33, 0.32], alpha: 0.85, drag: 0.1, lift: 0,
          })
        }
      }
      // Glowing volcanic bombs arcing out and landing round you.
      if ((run.nextBomb -= dt) <= 0 && t < run.dur - 15) {
        run.nextBomb = 2 + run.rand() * 4
        const tx = me.x + (run.rand() - 0.5) * 50
        const tz = me.z + (run.rand() - 0.5) * 50
        const fly = 5
        run.bombs.add({
          x: V.x, y: V.y + 4, z: V.z,
          vx: (tx - V.x) / fly, vy: (D.topAt(tx, tz) - V.y - 4) / fly + 11 * fly, vz: (tz - V.z) / fly,
          size: 0.9 + run.rand() * 0.9, color: 0x6a2a14, hurts: 25, life: 14,
          onRest: (p) => {
            dust(D, run.ash, p.x, p.y, p.z, 8, 0x4a4440, 2.5, run.rand)
            audioEngine.playBoom?.(0.35)
            crater(D, run, p.x, p.z, 1.6)
          },
        })
      }
      for (const p of run.bombs.list) if (run.rand() < 0.7) run.trail.add({ x: p.x, y: p.y, z: p.z, life: 3, size: 1.4, grow: 1, color: [0.3, 0.28, 0.27], alpha: 0.6, drag: 1 })
      // Volcanic lightning flickering in the plume.
      if (run.rand() < dt * 0.6 * strong) D.sky.addFlash(0.25)
      D.look.tint.setHex(0x5a4436)
      D.look.mix = Math.min(0.55, t / 40) * strong
      D.look.light = 1 - 0.35 * Math.min(1, t / 40) * strong
      D.screen.heat = Math.max(0, 0.3 - Math.hypot(V.x - me.x, V.z - me.z) / 400)
    },
  },

  solarFlare: {
    start(D, run) {
      run.dur = 45
      D.sky.addFlash(1.4)
    },
    update(D, run) {
      const t = run.t
      // A burst of light, then the sun burns bright for a while; radios
      // and maps glitch.
      D.look.tint.setHex(0xfff6e0)
      D.look.mix = 0.3 * Math.exp(-t / 12)
      D.look.light = 1 + 0.4 * Math.exp(-t / 10)
      D.screen.heat = 0.25 * Math.exp(-t / 15)
      document.body.classList.toggle('solar-glitch', t > 3 && t < 30 && Math.sin(t * 9) > 0.2)
    },
    end() {
      document.body.classList.remove('solar-glitch')
    },
  },

  geomagneticStorm: {
    start(D, run) {
      run.dur = 300 // five game hours
    },
    update(D, run) {
      document.body.classList.toggle('solar-glitch', Math.sin(run.t * 0.7) > 0.97)
    },
    end() {
      document.body.classList.remove('solar-glitch')
    },
  },

  meteoroid: {
    start(D, run) {
      impactStart(D, run, 1, 40 + run.rand() * 40, 3.2)
    },
    update(D, run, dt) {
      impactUpdate(D, run, dt)
    },
  },

  asteroid: {
    start(D, run) {
      impactStart(D, run, 3, 100 + run.rand() * 50, 5)
      run.dur = 100
    },
    update(D, run, dt) {
      impactUpdate(D, run, dt)
      // The shockwave: a ring of dust racing out; when it reaches you it
      // knocks you back.
      if (run.hitAt !== undefined) {
        const s = run.t - run.hitAt
        const r = s * 28
        if (s < 7) {
          for (let i = 0; i < 16; i++) {
            const a = run.rand() * Math.PI * 2
            const x = run.ix + Math.cos(a) * r
            const z = run.iz + Math.sin(a) * r
            run.impactSmoke.add({ x, y: D.topAt(x, z) + run.rand() * 2, z, vx: Math.cos(a) * 20, vy: 1, vz: Math.sin(a) * 20, life: 3 + run.rand() * 2, size: 4, grow: 2.5, color: [0.55, 0.5, 0.45], alpha: 0.6, drag: 0.9 })
          }
        }
        const me = D.me()
        const d = Math.hypot(me.x - run.ix, me.z - run.iz)
        if (!run.blasted && r >= d) {
          run.blasted = true
          D.hurt(12)
          D.push.set((me.x - run.ix) / d * 8, (me.z - run.iz) / d * 8)
          D.shake = Math.max(D.shake, 0.4)
          D.screen.smoke = 0.6
        }
        D.push.multiplyScalar(Math.exp(-dt * 1.2))
        // Dust in the sky for a long while after.
        D.look.tint.setHex(0x8a7058)
        D.look.mix = Math.min(0.45, s / 30)
        D.look.light = 1 - Math.min(0.3, s / 60)
        D.screen.smoke = Math.max(0, D.screen.smoke - dt * 0.05)
      }
    },
  },

  comet: {
    start(D, run) {
      run.dur = 85
      // Crossing the sky first, slowly brighter, then it breaks up and the
      // pieces come down far away.
      const a = run.rand() * Math.PI * 2
      run.ca = a
      run.head = new Fireball(D.scene, D.B, 3)
      run.head.sprite.material.color.setHex(0xcfe6ff)
      run.fx.push({ dispose: () => run.head.dispose() })
      run.tailE = D.emitter(run, { max: 1600, glow: true })
      impactStart(D, run, 1.6, 120 + run.rand() * 60, 4, true)
      run.pieces = 0
    },
    update(D, run, dt) {
      const t = run.t
      const me = D.me()
      if (t < 40) {
        // High in the sky, drifting, its tail pointing away from the sun.
        const k = t / 40
        const x = me.x + Math.cos(run.ca) * 420 + Math.cos(run.ca + 1.6) * (k - 0.5) * 300
        const z = me.z + Math.sin(run.ca) * 420 + Math.sin(run.ca + 1.6) * (k - 0.5) * 300
        const y = me.y + 220 - k * 60
        run.head.at(x, y, z, 6 + k * 10)
        const sun = D.sky.bodies?._dir
        for (let i = 0; i < 8; i++) {
          const along = run.rand() * (40 + k * 80)
          const sx = sun ? -sun.x : 0.3
          const sy = sun ? -sun.y : 0.5
          const sz = sun ? -sun.z : 0.2
          // The blue gas tail straight away from the sun, the white dust
          // tail curving a little.
          const curve = i % 2 ? along * along * 0.004 : 0
          run.tailE.add({
            x: x + sx * along + curve, y: y + sy * along, z: z + sz * along + curve,
            life: 0.8, size: (8 - along / 25) * (1 + k), color: i % 2 ? [0.95, 0.95, 0.9] : [0.55, 0.75, 1], alpha: 0.18 * (1 - along / 130), drag: 0, fadeIn: 0.3,
          })
        }
        return
      }
      run.head.sprite.visible = false
      // The fragments, a few seconds apart.
      if (run.pieces < 3 && t > 40 + run.pieces * 6) {
        run.pieces++
        const a = run.rand() * Math.PI * 2
        run.ix = me.x + Math.cos(a) * (110 + run.rand() * 90)
        run.iz = me.z + Math.sin(a) * (110 + run.rand() * 90)
        run.fly = { t0: t, len: 3, from: new THREE.Vector3(run.ix - Math.cos(a) * 300, me.y + 200, run.iz - Math.sin(a) * 300) }
        run.flying = true
      }
      impactUpdate(D, run, dt)
    },
  },
}

// Fire: a spreading front of burning blocks.
function fireStart(D, run, forest) {
  run.dur = 120
  const me = D.me()
  // It starts upwind of you (a dry lightning strike sets it off).
  const w = D.sky.wind
  const up = w && w.lengthSq() > 0.01 ? w.clone().normalize().negate() : new THREE.Vector2(1, 0)
  run.fx0 = me.x + up.x * (14 + run.rand() * 10)
  run.fz0 = me.z + up.y * (14 + run.rand() * 10)
  run.burning = new Map()
  run.burnt = 0
  run.fire = D.emitter(run, { max: 1400, glow: true, flame: true })
  run.embers = D.emitter(run, { max: 500, glow: true })
  run.smoke = D.emitter(run, { max: 1600 })
  run.forest = forest
  run.tick = 0
  D.sky.strikeAt?.(run.fx0, run.fz0)
  const ignite = () => {
    for (let i = 0; i < 40 && run.burning.size < 6; i++) {
      const x = Math.floor(run.fx0 + (run.rand() - 0.5) * 8)
      const z = Math.floor(run.fz0 + (run.rand() - 0.5) * 8)
      const top = D.topAt(x, z, me.y + 30) - 1
      for (let y = top; y > top - 8; y--) {
        if (burnable(D, D.bm.getBlockAt(x, y, z), forest)) {
          run.burning.set(`${x},${y},${z}`, { x, y, z, life: 6 + run.rand() * 6 })
          break
        }
      }
    }
  }
  ignite()
  // Nothing to burn found (bare ground): it burns on the grass anyway.
  if (!run.burning.size) run.burning.set('0', { x: Math.floor(run.fx0), y: D.topAt(run.fx0, run.fz0) - 1, z: Math.floor(run.fz0), life: 30, ghost: true })
}

function burnable(D, type, forest) {
  if (!type) return false
  if (type === 'grass' || D.bm.isPlantBlock?.(type) || /leaves|hay|dry/.test(type)) return true
  if (forest && D.bm.isTreeBlock?.(type)) return true
  // Wooden builds only when disasters can break anything.
  return D.breakAll() && /plank|wood|log/.test(type)
}

function fireUpdate(D, run, dt, forest) {
  const wet = RAINY.test(D.sky._now || '')
  const wind = D.sky.wind || new THREE.Vector2()
  const me = D.me()
  run.tick += dt
  const spread = run.tick >= 0.3
  if (spread) run.tick = 0
  let near = Infinity
  let n = 0
  const list = [...run.burning.values()]
  for (const c of list) {
    c.life -= dt * (wet ? 3 : 1)
    if (c.life <= 0) {
      run.burning.delete(`${c.x},${c.y},${c.z}`)
      if (c.ghost) continue
      // Burnt: grass to bare earth, leaves and plants gone, logs charred.
      const type = D.bm.getBlockAt(c.x, c.y, c.z)
      if (type === 'grass') D.replaceAt(c.x, c.y, c.z, 'coarsedirt')
      else if (D.bm.isTreeBlock?.(type) && /log|wood/.test(type)) D.replaceAt(c.x, c.y, c.z, 'blackstone')
      else D.removeAt(c.x, c.y, c.z)
      run.burnt++
      continue
    }
    near = Math.min(near, Math.hypot(c.x + 0.5 - me.x, c.z + 0.5 - me.z) + Math.max(0, Math.abs(c.y + 1 - me.y) - 1.5))
    // Flames from a share of the burning blocks each frame.
    if (n++ < 70 && Math.random() < 0.6) flames(run.fire, run.smoke, run.embers, c.x + 0.5, c.y + 1, c.z + 0.5, D.bm.isTreeBlock?.(D.bm.getBlockAt(c.x, c.y, c.z)) ? 1.6 : 1)
    // Spreading - faster downwind, never in the rain.
    if (spread && !wet && run.t < run.dur - 20 && run.burnt + run.burning.size < 420) {
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1], [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1]]) {
        const x = c.x + dx
        const y = c.y + dy
        const z = c.z + dz
        const key = `${x},${y},${z}`
        if (run.burning.has(key)) continue
        const down = 1 + 1.6 * Math.max(0, (dx * wind.x + dz * wind.y) / Math.max(0.5, wind.length())) + (dy > 0 ? 1.5 : 0)
        if (Math.random() < 0.045 * down && burnable(D, D.bm.getBlockAt(x, y, z), forest)) {
          // Something on top of grass burns, not the grass under it.
          run.burning.set(key, { x, y, z, life: (D.bm.isTreeBlock?.(D.bm.getBlockAt(x, y, z)) ? 9 : 5) + Math.random() * 5 })
        }
      }
    }
  }
  if (!run.burning.size && run.t > 5) run.dur = Math.min(run.dur, run.t)
  // Too close: it burns you, the heat and smoke get in your eyes.
  if (near < 1.4) D.hurtOver('fire', 4, 0.8)
  D.screen.heat = near < 12 ? 0.6 * (1 - near / 12) : 0
  D.screen.smoke = near < 20 ? 0.45 * (1 - near / 20) : 0.05
  D.look.tint.setHex(0xb06a35)
  D.look.mix = Math.min(0.32, run.burning.size / 200)
  D.look.light = 1 - Math.min(0.2, run.burning.size / 500)
  audioEngine.disasterBed?.(Math.min(1, run.burning.size / 60 + (near < 30 ? 0.3 : 0)), 'crackle')
}

// Flood water at `level`: the sheet, slowing and pushing you, drowning
// you if it's over your head too long.
function floodWater(D, run, dt, level, radius, foam, current, flow) {
  const me = D.me()
  run.water.place(run.x, run.z, level, radius)
  run.water.uniforms.uFoam.value = foam
  const depth = level - me.y
  const inside = Math.hypot(me.x - run.x, me.z - run.z) < radius * 0.8
  D.slow = inside && depth > 0.4 ? Math.max(0.45, 1 - depth * 0.3) : 1
  if (flow && inside && depth > 0.5) D.push.set(flow.x * current * 6 * Math.min(1, depth), flow.y * current * 6 * Math.min(1, depth))
  else if (flow) D.push.multiplyScalar(0.9)
  if (inside && depth > 1.9) {
    run.under = (run.under || 0) + dt
    if (run.under > 6) D.hurtOver('drown', 2, 1)
  } else run.under = 0
  if (flow && inside && depth > 1.2) D.hurtOver('flood', 2, 1)
  D.sky.weather3d.ground.wet.value = Math.max(D.sky.weather3d.ground.wet.value, 0.9)
}

// Impacts: a fireball streaking in from the sky to (ix, iz).
function impactStart(D, run, size, dist, fly, later) {
  run.dur ||= 40
  const me = D.me()
  const a = run.rand() * Math.PI * 2
  run.ix = me.x + Math.cos(a) * dist
  run.iz = me.z + Math.sin(a) * dist
  run.size = size
  run.impactSmoke = D.emitter(run, { max: 2400 })
  run.impactFire = D.emitter(run, { max: 600, glow: true, flame: true })
  run.trailFire = D.emitter(run, { max: 900, glow: true })
  run.trailSmoke = D.emitter(run, { max: 1200 })
  run.rocks = D.debris(run, { max: 40, shape: 'rock', glow: true })
  run.ball = new Fireball(D.scene, D.B, size * 2)
  run.fx.push({ dispose: () => run.ball.dispose() })
  run.ball.sprite.visible = false
  run.booms = []
  run.quakes = []
  if (!later) {
    run.fly = { t0: 0, len: fly, from: new THREE.Vector3(run.ix - Math.cos(a + 0.4) * 500, me.y + 260, run.iz - Math.sin(a + 0.4) * 500) }
    run.flying = true
  }
}

function impactUpdate(D, run, dt) {
  timed(D, run)
  D.shake *= Math.exp(-dt * 0.8)
  if (!run.flying) return
  const f = run.fly
  const k = Math.min(1, (run.t - f.t0) / f.len)
  const to = { x: run.ix, y: D.topAt(run.ix, run.iz), z: run.iz }
  // Speeding up a little as it comes in.
  const e = k * k * 0.4 + k * 0.6
  const x = f.from.x + (to.x - f.from.x) * e
  const y = f.from.y + (to.y - f.from.y) * e
  const z = f.from.z + (to.z - f.from.z) * e
  run.ball.sprite.visible = true
  run.ball.at(x, y, z, run.size * (3 + k * 3))
  // The burning trail and the smoke left hanging behind it.
  for (let i = 0; i < 6; i++) {
    run.trailFire.add({ x: x + (Math.random() - 0.5) * run.size, y: y + (Math.random() - 0.5) * run.size, z: z + (Math.random() - 0.5) * run.size, life: 0.5 + Math.random() * 0.5, size: run.size * 3, grow: -2, heat: true, alpha: 0.9, drag: 2, fadeIn: 0.02 })
  }
  run.trailSmoke.add({ x, y, z, life: 14 + Math.random() * 8, size: run.size * 2.5, grow: 0.8, color: [0.45, 0.42, 0.4], alpha: 0.5, drag: 0.3 })
  // The sky lights up as it comes in.
  D.look.tint.setHex(0xffb070)
  D.look.mix = Math.max(D.look.mix, 0.25 * k * run.size / 3)
  if (k >= 1) {
    run.flying = false
    run.ball.sprite.visible = false
    run.hitAt = run.t
    impact(D, run, run.ix, run.iz, run.size)
  }
}

// Booms and shaking that arrive late from far away.
function timed(D, run) {
  for (const b of run.booms || []) {
    if (!b.done && run.t >= b[0]) {
      b.done = true
      audioEngine.playBoom?.(b[1])
    }
  }
  for (const q of run.quakes || []) {
    if (!q.done && run.t >= q[0]) {
      q.done = true
      D.shake = Math.max(D.shake, q[1])
    }
  }
}
