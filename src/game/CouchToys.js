// Couch Co-op's equal Player 2 drinks potions, flies and rides (2026-11-14,
// Batch 5a; Gaymi: "player 2 should be able to do everything player 1
// can"). Made by CouchCoop.js next to CouchGear.js (only when Player 2 is
// Equal). Before this they were "Player 1 only - drop it for them".
//
// - Potions (Potions.js POTIONS): Speed, Invisibility (zombies leave
//   Player 2 alone - CouchCoop.target), Giant (bigger, hits GROW_DAMAGE x
//   harder) and Tiny (half size, fits one-block gaps), POTION_S seconds
//   each. Player 2's own, never Player 1's buffs.
// - Jetpack + Jetpack Fuel, Wingsuit: work from Player 2's backpack, like
//   Player 1's. A = Jump, B (crouch) closes the wingsuit.
// - Kite, Skateboard (tricks on A in the air, ramps), Sled, Bike and
//   Hoverboard (quiet: far-off zombies lose Player 2 - BuildSpecials.
//   zombieTarget): hold one and press RT, like Player 1.
//
// How: each is Player 1's own code (Kites.js, Skateboards.js...) run a
// second time with a "Player 2 view" of the game (_view): the same game,
// but its body, look direction, backpack, coins and message line are
// Player 2's. CouchCoop._physics asks these the same things BuildTryMode
// asks Player 1's. Coins earned (tricks, sled runs, wingsuit rings) are
// Player 2's.
//
// Batch 5b (2026-11-14) added, the same way: Snowballs, Water Gun, Catch
// Trap, Brain Snack, Metal Detector, Treasure Map, Bungee Cord and the
// Boombox Dance-Off (hold one, RT uses it), the Goo Disguise (Player 2's
// own, zombies ignore Player 2) and The Cure (Y at Dr. Goo's lab). What
// Player 2 tames or catches is Player 1's to keep (Gaymi: like their fish
// in the Aquarium), and so are a Treasure Map's gems; The Cure finishes
// Player 1's story. Player 2 dances with the D-pad, arrows on their half;
// both can dance at once. Winter / summer: snowballs every wave and a
// water gun, like Player 1.
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { ITEMS, itemName } from './PlayInventory.js'
import { POTIONS, POTION_S, POTION_IDS } from './Potions.js'
import { GROW_DAMAGE } from './BuildSpecials.js'
import { Jetpack } from './Jetpack.js'
import { Kites } from './Kites.js'
import { Skateboards } from './Skateboards.js'
import { Sleds } from './Sleds.js'
import { Rides } from './Rides.js'
import { Wingsuit, OPEN_H as WING_OPEN_H } from './Wingsuit.js'
import { Snowballs, START_SNOWBALLS, WAVE_SNOWBALLS } from './Snowballs.js'
import { WaterGun, summerOn } from './WaterGun.js'
import { PlayCatch } from './PlayCatch.js'
import { MetalDetector } from './MetalDetector.js'
import { TreasureMaps } from './TreasureMaps.js'
import { Bungee } from './Bungee.js'
import { DanceOff } from './DanceOff.js'
import { CHAPTERS } from './Campaign.js'

const B_A = 0
// Items held and used with RT (the rest work from the backpack).
const HELD = ['kite', 'skate', 'sled', 'ride', 'snowball', 'water', 'trap', 'petTreat', 'detector', 'treasure', 'bungee', 'boombox']
const KINDS = ['potion', 'jet', 'refill', 'wing', 'disguise', 'cure', ...HELD]
// D-pad (standard controller): the Dance-Off's four lanes.
const DPAD_LANE = { 14: 0, 13: 1, 12: 2, 15: 3 }

// Which of these an item is ('potion', 'kite'...), or ''.
export function toyKind(id) {
  const def = ITEMS[id]
  return (def && KINDS.find((k) => def[k])) || ''
}

export class CouchToys {
  constructor(couch) {
    this.c = couch
    this.s = couch.s
    // Player 2's potions: buff -> { mult, until } (seconds of game time).
    this.buffs = {}
    this._time = 0
    this.body = this._body()
    this.view = this._view()
    const v = this.view
    this.jet = new Jetpack(v)
    this.kite = new Kites(v)
    this.skate = new Skateboards(v)
    this.sled = new Sleds(v)
    this.rides = new Rides(v)
    this.wing = new Wingsuit(v)
    // Batch 5b.
    this.snow = new Snowballs(v)
    this.water = new WaterGun(v)
    this.catcher = new PlayCatch(v)
    this.detector = new MetalDetector(v)
    this.treasure = new TreasureMaps(v)
    this.bungee = new Bungee(v)
    this.dance = new DanceOff(v)
    this.dance.keys = false
    this.dance.uiHost = () => couch.hud?.querySelector('#couch-p2')
    // Pills (the water tank, the detector's signal): Player 2's status line.
    this._pills = {}
    const pill = {
      show: (id, text) => { this._pills[id] = text },
      hide: (id) => { delete this._pills[id] },
    }
    this.water.pill = pill
    this.detector.pill = pill
    // The Goo Disguise: seconds left (zombies leave Player 2 alone).
    this.goo = 0
    this._seasonWave = 0
  }

  get gear() {
    return this.c.gear
  }

  // Player 2 as BuildTryMode looks to these: pos, vel, onGround, Jump held.
  _body() {
    const c = this.c
    const p = () => c.p2
    const link = (map) => {
      const o = {}
      for (const [k, f] of Object.entries(map)) {
        Object.defineProperty(o, k, { get: () => p()[f], set: (v) => { p()[f] = v }, enumerable: true })
      }
      return o
    }
    const pos = link({ x: 'x', y: 'y', z: 'z' })
    const vel = link({ x: 'vx', y: 'vy', z: 'vz' })
    // Bungee.js moves the body with set().
    pos.set = (x, y, z) => Object.assign(p(), { x, y, z })
    vel.set = (x, y, z) => Object.assign(p(), { vx: x, vy: y, vz: z })
    return {
      pos,
      vel,
      // The Dance-Off stands Player 2 still (0) - toys.speedMult().
      speedMult: 1,
      get onGround() { return p().onGround },
      set onGround(v) { p().onGround = v },
      get _spaceWasDown() { return c.down.has(B_A) },
    }
  }

  // The game as Player 2's copies of the items see it. Anything not
  // listed here is the real game's (functions still run on the real one).
  _view() {
    const c = this.c
    const s = this.s
    const bm = s.bm
    const body = this.body
    const toys = this
    const bound = new Map()
    const real = (target, key) => {
      const v = Reflect.get(target, key)
      if (typeof v !== 'function') return v
      let f = bound.get(v)
      if (!f) bound.set(v, (f = v.bind(target)))
      return f
    }
    const bmOver = {
      tryMode: () => body,
      _yaw: () => c.p2.yaw,
      _pitch: () => c.p2.pitch,
      // Thrown and squirted from Player 2's eyes (Snowballs, WaterGun...).
      camera: () => c.camera,
    }
    const bmView = new Proxy(bm, {
      get: (target, key) => (key in bmOver ? bmOver[key]() : real(target, key)),
    })
    const inv = {
      selected: () => toys.gear?.held() || null,
      has: (id) => !!toys.gear?.has(id),
      takeItem: (id) => !!toys.gear?.takeItem(id),
      add: (item) => toys.gear?.add(item) ?? item.n ?? 1,
    }
    const over = {
      bm: () => bmView,
      inv: () => inv,
      coins: () => toys.gear?.coins || 0,
      dead: () => s.dead || !c.joined || c.p2.isDown,
      spectating: () => false,
      kart: () => null,
      vehicles: () => ({ riding: !!c.hands?.ride }),
      bingo: () => null,
      jetpack: () => toys.jet,
      skate: () => toys.skate,
      _earn: () => (n) => toys.gear?.earn(n),
      // Coins found (detector, treasure): counted on Player 2's purse.
      _coinsEarned: () => toys.gear?.coins || 0,
      // Player 2 is a guest: their counts are only for this game.
      stats: () => toys.gear?.stats || {},
      holding: () => toys.gear?.held() || null,
      // A snowball's freeze damage: a kill is Player 2's (coins, quests).
      damageZombie: () => (...args) => {
        s._p2Shot = !!toys.gear
        try {
          return s.damageZombie(...args)
        } finally {
          s._p2Shot = false
        }
      },
      _message: () => (text, secs) => c.p2Message(text, secs),
      _renderHud: () => () => {},
      bodyPos: () => () => ({ x: c.p2.x, y: c.p2.y, z: c.p2.z }),
    }
    return new Proxy(s, {
      get: (target, key) => (key in over ? over[key]() : real(target, key)),
      set: (target, key, value) => {
        if (key === 'coins') {
          if (toys.gear) toys.gear.coins = value
          return true
        }
        return Reflect.set(target, key, value)
      },
    })
  }

  // ---------- Using them (CouchGear._useAt) ----------

  // Held and used with RT (a kite, a board...), not from the backpack.
  heldKind(id) {
    return HELD.includes(toyKind(id))
  }

  // Works by itself from the backpack (Jetpack, Wingsuit): nothing to use.
  passive(id) {
    const k = toyKind(id)
    return k === 'jet' || k === 'wing'
  }

  canUse(id) {
    const k = toyKind(id)
    if (k === 'refill') return this.jet.fuel < 1
    if (k === 'potion') return true
    if (k === 'disguise') return this.goo <= 0
    return HELD.includes(k)
  }

  // Uses one. -> 'take' (one used up), true (used, kept), false (not used).
  use(id) {
    const k = toyKind(id)
    const p = this.c.p2
    if (!k || p.isDown || this.s.dead) return false
    if (k === 'potion') return this.drink(id) ? 'take' : false
    if (k === 'jet') {
      this.c.p2Message(t('jetpackHint'), 3)
      return false
    }
    if (k === 'wing') {
      this.c.p2Message(t('wingHint', { n: WING_OPEN_H }), 3)
      return false
    }
    if (k === 'refill') {
      if (this.jet.fuel >= 1) {
        this.c.p2Message(t('jetpackFull'), 2)
        return false
      }
      this.jet.fuel = 1
      this.c.p2Message(t('jetpackRefuel'), 2)
      return 'take'
    }
    if (k === 'disguise') return this.putGoo(ITEMS[id].disguise) ? 'take' : false
    if (k === 'cure') {
      this.c.p2Message(t('couchCureHint'), 3)
      return false
    }
    if (k === 'snowball') return this.snow.throw() ? 'take' : false
    if (k === 'trap') return this.catcher.throw() ? 'take' : false
    if (k === 'petTreat') return this.tame() ? 'take' : false
    if (k === 'water') return !!this.water.squirt()
    if (k === 'detector') return !!this.detector.use()
    // Only digging the chest up uses the map.
    if (k === 'treasure') return this.treasure.use() ? 'take' : true
    if (k === 'boombox') return !!this.dance.useBoombox()
    if (k === 'kite') this.kite.use()
    else if (k === 'skate') this.skate.use()
    else if (k === 'sled') this.sled.use()
    else if (k === 'ride') this.rides.use()
    else if (k === 'bungee') this.bungee.use()
    return true
  }

  // ---------- Batch 5b ----------

  // A Brain Snack: Player 1's pet code (PetZombie.js) looks through Player
  // 2's eyes and talks on their half for the call. The pet is Player 1's.
  tame() {
    const pet = this.s.pet
    if (!pet) return false
    const was = pet.s
    pet.s = this.view
    try {
      return !!pet.tame()
    } finally {
      pet.s = was
    }
  }

  // The Goo Disguise, Player 2's own. -> true if put on.
  putGoo(seconds) {
    if (this.goo > 0) {
      this.c.p2Message(t('gooAlreadyOn'), 2)
      return false
    }
    this.goo = seconds
    this.c.p2Message(t('gooOn', { s: seconds }), 3)
    return true
  }

  // Player 2 attacked something: the goo washes off.
  breakGoo() {
    if (this.goo <= 0) return
    this.goo = 0
    this.c.p2Message(t('gooBroken'), 2.5)
  }

  get disguised() {
    return this.goo > 0
  }

  // Y at Dr. Goo's lab with The Cure: Player 1's story is finished
  // (Campaign.js). true if handed in.
  handInCure() {
    const lab = this.s.camp?.lab
    const st = lab?.story
    const p = this.c.p2
    if (!lab || !st || !this.gear?.has('theCure') || !lab.near(p)) return false
    if (CHAPTERS[st.ch] !== 'cure' || !st.started) return false
    this.gear.takeItem('theCure')
    if (!lab._finish(st.ch)) {
      this.gear.add({ kind: 'item', id: 'theCure', n: 1 })
      return false
    }
    this.c.p2Message(t('couchCureGiven'), 4)
    return true
  }

  // A D-pad press while dancing: a lane. true if it was one.
  dancePress(i) {
    if (!this.dance.on || !(i in DPAD_LANE)) return false
    this.dance.press(DPAD_LANE[i])
    return true
  }

  // A new wave (CouchCoop.update): winter snowballs and a summer water gun
  // for Player 2 too.
  onWave(n) {
    const g = this.gear
    if (!g || n <= this._seasonWave) return
    const first = !this._seasonWave
    this._seasonWave = n
    if (this.snow.on) {
      g.add({ kind: 'item', id: 'snowball', n: first ? START_SNOWBALLS : WAVE_SNOWBALLS })
      if (first) this.c.p2Message(t('snowballSeason'), 4)
    }
    if (first && summerOn() && !g.has('waterGun')) g.add({ kind: 'item', id: 'waterGun', n: 1 })
  }

  // ---------- Potions ----------

  drink(id) {
    const def = POTIONS[id]
    if (!def) return false
    if (def.buff === 'grow') delete this.buffs.shrink
    if (def.buff === 'shrink') delete this.buffs.grow
    this.buffs[def.buff] = { mult: def.mult, until: this._time + POTION_S }
    this.c.p2Message(t('potionDrunk', { name: itemName(id), s: POTION_S }), 3)
    try { audioEngine.playSpecial?.('potionGulp') } catch { /* no audio */ }
    return true
  }

  _buff(name) {
    const b = this.buffs[name]
    return b && b.until > this._time ? b.mult : 0
  }

  get invisible() {
    return !!this._buff('invisible')
  }

  // Bike or hoverboard: zombies far off lose Player 2.
  get quiet() {
    return !!this.rides.on
  }

  speedMult() {
    return (this._buff('speed') || 1) * (this.body.speedMult ?? 1)
  }

  damageMult() {
    return this._buff('grow') ? GROW_DAMAGE : 1
  }

  // Player 2's size (Giant / Tiny), 1 normally.
  get size() {
    return this._buff('grow') || this._buff('shrink') || 1
  }

  // ---------- CouchCoop._physics, every frame ----------

  // Walking speed and grip on a sled / bike / hoverboard / skateboard (or ice).
  glide(onGround) {
    const p = this.body.pos
    return this.sled.mods(onGround, p) || this.rides.mods(onGround) || this.skate.mods(onGround, p)
  }

  // In the air (not swimming): jetpack, kite, wingsuit.
  air(dt, jumpHeld, crouch) {
    const p = this.c.p2
    p.vy = this.jet.thrust(dt, jumpHeld, p.onGround, p.vy)
    p.vy = this.kite.fall(p.vy)
    this.wing.fly(this.body.vel, dt, p.onGround, crouch)
  }

  update(dt) {
    this._time += dt
    for (const [k, b] of Object.entries(this.buffs)) if (b.until <= this._time) delete this.buffs[k]
    this.kite.update(dt)
    this.skate.update(dt)
    this.sled.update(dt)
    this.rides.update(dt)
    this.wing.update(dt)
    const step = Math.min(dt, 0.1)
    this.snow.update(step)
    this.water.update(step)
    this.catcher.update(step)
    this.detector.update(dt)
    this.bungee.update(step)
    this.dance.update(dt)
    if (this.goo > 0) {
      this.goo = Math.max(0, this.goo - dt)
      if (!this.goo) this.c.p2Message(t('gooWoreOff'), 2.5)
    }
  }

  // Player 2's half: the jetpack's tank and potions still going.
  statusText() {
    const out = []
    if (this.jet.worn && (this.jet.flying || this.jet.fuel < 1)) out.push(`${t('invJetpack')} ${Math.round(this.jet.fuel * 100)}%`)
    for (const id of POTION_IDS) {
      const b = this.buffs[POTIONS[id].buff]
      if (b && b.mult === POTIONS[id].mult && b.until > this._time) out.push(`${itemName(id)} ${Math.ceil(b.until - this._time)}s`)
    }
    if (this.goo > 0) out.push(t('gooHud', { s: Math.ceil(this.goo) }))
    out.push(...Object.values(this._pills))
    if (this.treasure.spot) {
      const p = this.c.p2
      out.push(t('couchTreasureX', { n: Math.round(Math.hypot(this.treasure.spot.x - p.x, this.treasure.spot.z - p.z)) }))
    }
    return out.join(' · ')
  }

  // Off everything (Player 2 went down, the game ended).
  stop() {
    this.kite.reel()
    this.skate.off()
    this.sled.off()
    this.rides.off()
    this.wing.land()
    this.dance.stop(false)
    this.bungee._unclip()
    this.goo = 0
  }

  dispose() {
    this.kite.clear()
    this.skate.clear()
    this.sled.clear()
    this.rides.clear()
    this.wing.clear()
    for (const it of [this.snow, this.water, this.catcher, this.detector, this.treasure, this.bungee, this.dance]) it.clear()
    this._pills = {}
    this.goo = 0
    this.buffs = {}
  }
}
