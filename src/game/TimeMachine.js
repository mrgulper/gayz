// The Time Machine (2026-11-06, Gaymi's idea list 7: "craft one and travel
// to another era for a while, each with its own zombies" - Gaymi wanted
// "a bit of all of it": five eras, smaller each, and a Time Pass to go).
// Owned by BuildSurvival (`s.time`), every Zombie Survival game.
//
// - Craft a Time Machine, hold it and use it: it stands on open ground in
//   front of you. Each trip uses up one Time Pass (crafted too).
// - Press Use beside the machine: pick an era (keys 1-5 or a tap). A flash,
//   and you're there for ERA_S seconds - a little world of its own (real
//   blocks on a disc ERA_R round, high over everything at ERA_Y, put back
//   as they were afterwards - TempBlocks.js) under that era's sky:
//   - Dino Past: jungle, ferns and dinosaurs, with cavemen zombies.
//   - Medieval: a stone courtyard inside castle walls, knight zombies.
//   - Wild West: desert sand, cactus and a saloon, cowboy zombies.
//   - Ice Age: snow and ice, zombies frozen in ice that break free.
//   - Robot Future: neon streets, robot zombies.
//   The waves go on there with that era's zombies (spawnSpots()).
// - Time runs out (or press Use on the machine in the middle of the era)
//   and you're back by your machine with ERA_COINS coins. The eras you've
//   seen are kept (ERAS_KEY): see all five for a bonus.
// - Couch Co-op (Batch 5c): only whoever climbs in goes, each paying their
//   own Time Pass. Each era has its own spot (eraCenter), so Player 1 and
//   Player 2 can be in two different eras at once (Gaymi's pick), each with
//   its own clock, zombies and sky; picking the era the other one is in
//   joins them with the time it has left. Player 2 picks on their half
//   (CouchGear 'time' screen) and is paid ERA_COINS; only Player 1's
//   eras-seen are saved (Player 2 is a guest).
// Meshes and one picker panel, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { TempBlocks } from './TempBlocks.js'
import { traveller } from './Travellers.js'

export const ERAS = ['dino', 'medieval', 'west', 'ice', 'future']
export const ERA_S = 90
export const ERA_R = 20
export const ERA_Y = 420
export const ERA_COINS = 60
export const ALL_ERAS_COINS = 300
export const ERAS_KEY = 'gayz-time-eras'
const ERA_ZOMBIES = 5
const SPAWN_EVERY = 7
const MAX_ALIVE = 8
const ICE_S = 3.5
const USE_R = 3
// Blocks between two eras' middles (well past each one's sky and fog).
const ERA_GAP = 400
const SKY = { dino: 0xf0a878, medieval: 0x8a9ab8, west: 0xf0d090, ice: 0xd8ecf8, future: 0x1c0c34 }
// Each era's zombies: a tint for their skin and what they wear.
const LOOK = {
  dino: { skin: 0x8a6a3a, hat: 'club' },
  medieval: { skin: null, hat: 'helmet' },
  west: { skin: null, hat: 'cowboy' },
  ice: { skin: 0x9ac8e0, hat: null },
  future: { skin: 0x9aa4b0, hat: 'visor' },
}

// The eras you've been to (untrusted when read back: only known ids).
export function loadEras() {
  try {
    const v = JSON.parse(localStorage.getItem(ERAS_KEY) || '[]')
    return Array.isArray(v) ? [...new Set(v.filter((e) => ERAS.includes(e)))] : []
  } catch {
    return []
  }
}

function saveEras(list) {
  try { localStorage.setItem(ERAS_KEY, JSON.stringify(list)) } catch { /* storage full or blocked */ }
}

export class TimeMachine {
  constructor(survival) {
    this.s = survival
    this.machine = null // { x, y, z, group } - the one put down
    // The eras open right now: era -> trip (_newTrip). Couch Co-op
    // (Batch 5c): two players can be in two eras at once.
    this.trips = new Map()
    this.where = { p1: '', p2: '' } // which era each player is in ('' = home)
    this.pickOpen = false
  }

  get B() {
    return this.s.B
  }

  // Where Player 1 is ('' = home) - the rest of the game asks this.
  get era() {
    return this.where.p1
  }

  // Player 1 off in another era right now?
  get away() {
    return !!this.where.p1
  }

  // Anyone (Player 1 or Couch Co-op's Player 2) off in an era?
  get anyAway() {
    return this.trips.size > 0
  }

  // Player 1's era's middle (or the first era's spot).
  get cx() {
    return eraCenter(this.where.p1 || ERAS[0]).x
  }

  get cz() {
    return eraCenter(this.where.p1 || ERAS[0]).z
  }

  // Seconds left in Player 1's era.
  get left() {
    return this.trips.get(this.where.p1)?.left || 0
  }

  // Which era a body at p is in, or ''.
  eraAt(p) {
    if (!p) return ''
    for (const [era] of this.trips) {
      const c = eraCenter(era)
      if (Math.hypot(p.x - c.x, p.z - c.z) < ERA_R + 16 && Math.abs(p.y - ERA_Y) < 30) return era
    }
    return ''
  }

  // Holding the Time Machine and using it (PlayInventory.useHeld, or
  // Couch Co-op's Player 2 - CouchGear). -> true if it went down (then
  // it's used up).
  place(who = 'p1') {
    const s = this.s
    const me = traveller(s, who)
    if (!me || s.dead || this.where[who]) return false
    const spot = s.vehicles?._groundAhead('balloon', me.pos(), me.yaw())
    if (!spot) {
      me.say(t('vehicleNeedRoom'), 3)
      return false
    }
    this._dropMachine()
    const g = makeMachine(this.B)
    g.position.set(spot.x * this.B, spot.y * this.B, spot.z * this.B)
    s.bm.scene.add(g)
    this.machine = { ...spot, group: g }
    me.say(t('timePlaced'), 4)
    try { audioEngine.playPlace?.() } catch { /* no audio */ }
    return true
  }

  _dropMachine() {
    const m = this.machine
    if (!m) return
    m.group.removeFromParent()
    disposeTree(m.group)
    this.machine = null
  }

  _nearHome(p, era) {
    const c = eraCenter(era)
    return Math.hypot(p.x - c.x, p.z - c.z) < USE_R && Math.abs(p.y - (ERA_Y + 1)) < 3
  }

  _nearMachine(p) {
    const m = this.machine
    return !!m && Math.hypot(p.x - m.x, p.z - m.z) < USE_R && Math.abs(p.y - m.y) < 3
  }

  // The Use key (BuildMode._tryUseFromCamera; Player 2: Y). -> true if it
  // was the machine.
  use(who = 'p1') {
    const s = this.s
    const me = traveller(s, who)
    if (!me || s.dead || (who === 'p1' && s.spectating)) return false
    if (who === 'p2' && s.couch?.p2.isDown) return false
    const at = me.pos()
    const era = this.where[who]
    if (era) {
      // The way home stands in the middle of the era.
      if (!this._nearHome(at, era)) return false
      this.goHome(who)
      return true
    }
    if (!this._nearMachine(at)) return false
    this.openPick(who)
    return true
  }

  // --- the era picker ---

  // The picker's choices for a player: { era, name, desc }. An era the
  // other player is in says so: picking it joins them (sharing their time).
  pickRows(who) {
    const seen = loadEras()
    const other = who === 'p1' ? 'p2' : 'p1'
    return ERAS.map((era, i) => ({
      era,
      name: `${i + 1}. ${t(`timeEra_${era}`)}${seen.includes(era) ? ' ✓' : ''}`,
      desc: this.where[other] === era ? t(other === 'p2' ? 'timeJoinP2' : 'timeJoinP1', { n: Math.ceil(this.trips.get(era)?.left || 0) }) : t(`timeEraDesc_${era}`),
    }))
  }

  openPick(who = 'p1') {
    const s = this.s
    // Player 2 picks on their own half with the controller (CouchGear).
    if (who === 'p2') {
      s.couch?.gear?.open('time')
      return
    }
    if (this.pickOpen) return
    this.pickOpen = true
    s.bm._keys?.clear?.()
    // The big message in the middle of the screen goes, so it isn't drawn
    // through the picker (2026-11-09 visual check).
    s._hideMessage?.()
    if (document.pointerLockElement) document.exitPointerLock()
    let el = this._pick
    if (!el) {
      el = this._pick = document.createElement('div')
      el.id = 'time-pick'
      document.body.appendChild(el)
      this._key = (e) => {
        if (!this.pickOpen) return
        const m = /^(?:Digit|Numpad)([1-5])$/.exec(e.code)
        if (m) {
          e.preventDefault()
          e.stopPropagation()
          this.go(ERAS[Number(m[1]) - 1])
        } else if (e.code === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          this.closePick()
        }
      }
      window.addEventListener('keydown', this._key, true)
    }
    el.textContent = ''
    const title = document.createElement('div')
    title.className = 'time-pick-title'
    title.textContent = t('timePickTitle', { n: this._passes('p1') })
    el.appendChild(title)
    for (const row of this.pickRows('p1')) {
      const b = document.createElement('button')
      b.type = 'button'
      const name = document.createElement('b')
      name.textContent = row.name
      const desc = document.createElement('span')
      desc.textContent = row.desc
      b.append(name, desc)
      b.addEventListener('click', () => this.go(row.era))
      el.appendChild(b)
    }
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'time-pick-close'
    close.textContent = t('timePickClose')
    close.addEventListener('click', () => this.closePick())
    el.appendChild(close)
    el.style.display = 'flex'
  }

  closePick(relock = true) {
    if (!this.pickOpen) return
    this.pickOpen = false
    if (this._pick) this._pick.style.display = 'none'
    if (relock) {
      try { this.s.bm.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available */ }
    }
  }

  // Time Passes a player has (each pays for their own trip).
  _passes(who = 'p1') {
    return traveller(this.s, who)?.count('timePass') || 0
  }

  // Off to an era (from the picker). An era already open (the other
  // player is there) is joined, with the time it has left.
  go(era, who = 'p1') {
    const s = this.s
    const me = traveller(s, who)
    if (!me || !ERAS.includes(era) || this.where[who] || s.dead) return false
    if (!me.take('timePass')) {
      me.say(t('timeNeedPass'), 3)
      return false
    }
    if (who === 'p1') this.closePick()
    else s.couch?.gear?.close()
    me.leaveRide()
    let trip = this.trips.get(era)
    const fresh = !trip
    if (fresh) trip = this._open(era)
    const m = this.machine
    const at = me.pos()
    trip.backs[who] = m ? { x: m.x + 1.5, y: m.y, z: m.z + (who === 'p2' ? 1.2 : 0) } : { x: at.x, y: at.y, z: at.z }
    trip.who.add(who)
    this.where[who] = era
    const c = eraCenter(era)
    const z = c.z + (trip.who.size > 1 ? 1.2 : 0)
    me.put(c.x + 3, ERA_Y + 1, z)
    if (who === 'p1') s.bm.camera.position.set((c.x + 3) * this.B, (ERA_Y + 2.62) * this.B, z * this.B)
    this._flash(who)
    me.say(t('timeArrive', { era: t(`timeEra_${era}`), n: Math.ceil(trip.left) }), 5)
    s._renderHud?.()
    return true
  }

  // A new era: its little world, its zombies, ERA_S seconds on the clock.
  _open(era) {
    const s = this.s
    // Heaven's islands share the era's height: gone first, so none mixes
    // into it (OpenWorld keeps them away while anyone's here).
    if (s.bm.world?.heaven?.cols?.size) s.bm.world.heaven.dropAll()
    const trip = { era, left: ERA_S, cells: new TempBlocks(s), zombies: [], dinos: [], ice: [], who: new Set(), backs: {}, spawnT: 0, shown: -1, sky: null, home: null }
    this.trips.set(era, trip)
    this._build(trip)
    if (!s.net || s.net.isHost) for (let i = 0; i < ERA_ZOMBIES; i++) this._eraZombie(trip)
    if (era === 'dino') this._dinos(trip)
    return trip
  }

  goHome(who = 'p1') {
    const s = this.s
    const era = this.where[who]
    const trip = this.trips.get(era)
    if (!era) return
    this.where[who] = ''
    trip?.who.delete(who)
    const me = traveller(s, who)
    if (me) {
      const b = trip?.backs[who] || { x: 0.5, y: 80, z: 0.5 }
      me.put(b.x, b.y, b.z)
      if (who === 'p1') s.bm.camera.position.set(b.x * this.B, (b.y + 1.62) * this.B, b.z * this.B)
      this._flash(who)
      // Coins, and (Player 1, whose eras are saved) a bonus once you've
      // seen every era. Player 2 is a guest: nothing of theirs is kept.
      if (who === 'p1') {
        const seen = loadEras()
        let coins = ERA_COINS
        if (!seen.includes(era)) {
          seen.push(era)
          saveEras(seen)
          if (seen.length === ERAS.length) coins += ALL_ERAS_COINS
        }
        me.pay(coins)
        me.say(t(seen.length === ERAS.length && coins > ERA_COINS ? 'timeHomeAll' : 'timeHome', { n: coins, seen: seen.length, max: ERAS.length }), 5)
      } else {
        me.pay(ERA_COINS)
        me.say(t('timeHomeP2', { n: ERA_COINS }), 5)
      }
    }
    // Nobody left there: the era goes.
    if (trip && !trip.who.size) this._close(trip)
  }

  _close(trip) {
    const s = this.s
    for (const zb of trip.zombies) {
      const i = s.zombies.indexOf(zb)
      if (i >= 0) {
        s.zombies.splice(i, 1)
        s._removeZombie?.(zb)
      }
    }
    for (const a of trip.dinos) s.animals?._remove?.(a)
    trip.cells.restore()
    for (const g of [trip.home, trip.sky]) {
      if (!g) continue
      g.removeFromParent()
      disposeTree(g)
    }
    this.trips.delete(trip.era)
  }

  update(dt) {
    const s = this.s
    if (!s.active) return
    // Player 2 gone (left the game): nobody of theirs is away.
    if (this.where.p2 && !traveller(s, 'p2')) {
      const trip = this.trips.get(this.where.p2)
      this.where.p2 = ''
      trip?.who.delete('p2')
      if (trip && !trip.who.size) this._close(trip)
    }
    this.viewSky('p1', s.bm.camera)
    this._prompt('p1')
    if (traveller(s, 'p2')) this._prompt('p2')
    for (const trip of [...this.trips.values()]) this._step(trip, dt)
  }

  _step(trip, dt) {
    const s = this.s
    trip.left -= dt
    const n = Math.floor(trip.left)
    const travellers = [...trip.who].map((id) => traveller(s, id)).filter(Boolean)
    if (n !== trip.shown && (n === 30 || n === 10)) for (const me of travellers) me.say(t('timeLeft', { n }), 3)
    trip.shown = n
    // Fell off the edge of time: back on the disc.
    const c = eraCenter(trip.era)
    for (const me of travellers) if (me.pos().y < ERA_Y - 12) me.put(c.x + 3, ERA_Y + 1, c.z)
    this._iceStep(trip, dt)
    if (!s.net || s.net.isHost) {
      trip.zombies = trip.zombies.filter((zb) => zb.health > 0 && s.zombies.includes(zb))
      trip.spawnT -= dt
      if (trip.spawnT <= 0 && trip.zombies.length < MAX_ALIVE && !s.cfg?.noZombies) {
        trip.spawnT = SPAWN_EVERY
        this._eraZombie(trip)
      }
    }
    if (trip.left <= 0) for (const id of [...trip.who]) this.goHome(id)
  }

  // An era's sky shows only for whoever is in it - on a split screen, on
  // their own half (CouchCoop.drawFrame).
  viewSky(who, camera) {
    const era = this.where[who]
    for (const trip of this.trips.values()) {
      if (!trip.sky) continue
      trip.sky.visible = trip.era === era
      if (trip.sky.visible) trip.sky.position.copy(camera.position)
    }
  }

  _prompt(who) {
    const me = traveller(this.s, who)
    if (!me) return
    const at = me.pos()
    const era = this.where[who]
    const near = era ? this._nearHome(at, era) : this._nearMachine(at)
    const key = near ? `${era ? 'timePromptHome' : 'timePromptGo'}${who === 'p2' ? 'P2' : ''}` : ''
    const last = (this._lastPrompt ||= {})
    const busy = who === 'p1' ? this.pickOpen : !!this.s.couch?.gear?.menuOpen
    if (key && key !== last[who] && !busy) me.say(t(key), 3)
    last[who] = key
  }

  // Where the waves' zombies come from in an era (BuildSurvival._spawnSpots).
  spawnSpots(era = this.where.p1) {
    const c = eraCenter(era || ERAS[0])
    const out = []
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      out.push([Math.floor(c.x + Math.cos(a) * (ERA_R - 3)), ERA_Y + 1, Math.floor(c.z + Math.sin(a) * (ERA_R - 3))])
    }
    return out
  }

  protects(x, y, z) {
    for (const trip of this.trips.values()) if (trip.cells.has(x, y, z)) return true
    return false
  }

  // An era zombie at the edge of the disc, dressed for its time.
  _eraZombie(trip) {
    const s = this.s
    const c = eraCenter(trip.era)
    const a = Math.random() * Math.PI * 2
    const r = ERA_R - 3 - Math.random() * 4
    const x = c.x + Math.cos(a) * r
    const z = c.z + Math.sin(a) * r
    const zb = s._extraZombie?.(x, ERA_Y + 1, z, null)
    if (!zb) return null
    trip.zombies.push(zb)
    this.dress(zb, trip.era)
    if (trip.era === 'ice') {
      // Frozen in a block of ice: it breaks free after a moment.
      zb.frozen = ICE_S
      const fx = Math.floor(zb.x)
      const fz = Math.floor(zb.z)
      const cells = []
      for (let y = ERA_Y + 1; y <= ERA_Y + 2; y++) if (!s.bm.getBlockAt(fx, y, fz)) {
        trip.cells.put(fx, y, fz, 'ice')
        cells.push(s.bm._key(fx, y, fz))
      }
      trip.ice.push({ left: ICE_S, cells })
    }
    return zb
  }

  _iceStep(trip, dt) {
    if (!trip.ice.length) return
    for (const c of trip.ice) {
      c.left -= dt
      if (c.left > 0) continue
      for (const key of c.cells) trip.cells.back(key)
      try { audioEngine.playSpecial?.('crumble') } catch { /* no audio */ }
    }
    trip.ice = trip.ice.filter((c) => c.left > 0)
  }

  // An era's look on a zombie: its skin tint and what it wears.
  dress(zb, era) {
    const look = LOOK[era]
    if (!look || !zb.group) return
    const B = this.B
    zb.era = era
    if (look.skin !== null) {
      const tint = new THREE.Color(look.skin)
      zb.group.traverse((o) => {
        if (!o.isMesh || !o.material?.color) return
        o.material = o.material.clone()
        o.material.color.lerp(tint, 0.6)
      })
    }
    const add = (geo, color, y, z = 0) => {
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }))
      m.position.set(0, y * B, z * B)
      zb.group.add(m)
      return m
    }
    if (look.hat === 'helmet') {
      add(new THREE.BoxGeometry(0.58 * B, 0.36 * B, 0.58 * B), 0xb8bcc4, 2.0)
      add(new THREE.BoxGeometry(0.06 * B, 0.3 * B, 0.08 * B), 0xd8352a, 2.28)
    } else if (look.hat === 'cowboy') {
      add(new THREE.CylinderGeometry(0.55 * B, 0.55 * B, 0.05 * B, 16), 0x7a4a22, 2.0)
      add(new THREE.CylinderGeometry(0.24 * B, 0.28 * B, 0.3 * B, 12), 0x7a4a22, 2.16)
    } else if (look.hat === 'visor') {
      add(new THREE.BoxGeometry(0.52 * B, 0.1 * B, 0.08 * B), 0x40f0ff, 1.8, 0.26)
      add(new THREE.BoxGeometry(0.04 * B, 0.3 * B, 0.04 * B), 0xcccccc, 2.1)
    } else if (look.hat === 'club') {
      add(new THREE.BoxGeometry(0.14 * B, 0.7 * B, 0.14 * B), 0x5a3a1e, 1.0, 0.4)
    }
  }

  _dinos(trip) {
    const s = this.s
    if (s.net && !s.net.isHost) return
    const c = eraCenter(trip.era)
    for (const [kind, a] of [['velociraptor', 0.5], ['triceratops', 2.6], ['stegosaurus', 4.4]]) {
      const x = c.x + Math.cos(a) * 12
      const z = c.z + Math.sin(a) * 12
      const dino = s.animals?.spawn?.(kind, x, ERA_Y + 1, z)
      if (dino) trip.dinos.push(dino)
    }
  }

  // --- the era's little world ---

  _build(trip) {
    const era = trip.era
    const c = eraCenter(era)
    const cx = Math.floor(c.x)
    const cz = Math.floor(c.z)
    const y = ERA_Y
    const put = (dx, dy, dz, type) => trip.cells.put(cx + dx, y + dy, cz + dz, type)
    const R = ERA_R
    const rnd = mulberry(ERAS.indexOf(era) + 7)
    const floor = { dino: ['grass', 'podzol'], medieval: ['stonebricks', 'cobblestone'], west: ['sand', 'redsand'], ice: ['snow', 'packedice'], future: ['blackconcrete', 'grayconcrete'] }[era]
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      const d = Math.hypot(dx, dz)
      if (d > R) continue
      put(dx, -1, dz, d > R - 1.2 ? 'stonebricks' : rnd() < 0.2 ? floor[1] : floor[0])
      put(dx, -2, dz, 'stone')
      if (era === 'future' && (dx % 6 === 0 || dz % 6 === 0) && d < R - 1) put(dx, -1, dz, 'cyanconcrete')
    }
    // What stands on it, out from the middle.
    const spotFree = (dx, dz) => Math.hypot(dx, dz) > 4 && Math.hypot(dx, dz) < R - 2
    if (era === 'dino') {
      for (let i = 0; i < 9; i++) {
        const a = rnd() * Math.PI * 2
        const r = 6 + rnd() * (R - 9)
        const dx = Math.round(Math.cos(a) * r)
        const dz = Math.round(Math.sin(a) * r)
        if (!spotFree(dx, dz)) continue
        for (let k = 0; k < 5; k++) put(dx, k, dz, 'junglelog')
        for (let ox = -2; ox <= 2; ox++) for (let oz = -2; oz <= 2; oz++) for (let k = 4; k <= 5; k++) if (Math.abs(ox) + Math.abs(oz) < 4 - (k - 4)) put(dx + ox, k, dz + oz, 'jungleleaves')
      }
    } else if (era === 'medieval') {
      // Castle walls round the edge with gaps on top, a tower.
      for (let i = 0; i < 160; i++) {
        const a = (i / 160) * Math.PI * 2
        const dx = Math.round(Math.cos(a) * (R - 1))
        const dz = Math.round(Math.sin(a) * (R - 1))
        for (let k = 0; k < 4; k++) put(dx, k, dz, 'stonebricks')
        if (i % 2 === 0) put(dx, 4, dz, 'stonebricks')
      }
      for (let ox = -2; ox <= 2; ox++) for (let oz = -2; oz <= 2; oz++) {
        const edge = Math.abs(ox) === 2 || Math.abs(oz) === 2
        for (let k = 0; k < 8; k++) if (edge && !(oz === 2 && !ox && k < 2)) put(9 + ox, k, -9 + oz, k > 6 ? 'chiseledstonebricks' : 'stonebricks')
      }
      put(-8, 0, 8, 'haybale')
      put(-7, 0, 8, 'haybale')
    } else if (era === 'west') {
      for (let i = 0; i < 10; i++) {
        const a = rnd() * Math.PI * 2
        const r = 6 + rnd() * (R - 9)
        const dx = Math.round(Math.cos(a) * r)
        const dz = Math.round(Math.sin(a) * r)
        if (!spotFree(dx, dz)) continue
        const h = 2 + Math.floor(rnd() * 2)
        for (let k = 0; k < h; k++) put(dx, k, dz, 'cactus')
      }
      // A saloon front.
      for (let ox = -4; ox <= 4; ox++) for (let k = 0; k < 6; k++) {
        if (Math.abs(ox) <= 1 && k < 3) continue
        put(ox, k, 12, k === 5 ? 'oakplanks' : 'spruceplanks')
      }
    } else if (era === 'ice') {
      for (let i = 0; i < 12; i++) {
        const a = rnd() * Math.PI * 2
        const r = 6 + rnd() * (R - 9)
        const dx = Math.round(Math.cos(a) * r)
        const dz = Math.round(Math.sin(a) * r)
        if (!spotFree(dx, dz)) continue
        const h = 2 + Math.floor(rnd() * 5)
        for (let k = 0; k < h; k++) put(dx, k, dz, k > h - 3 ? 'packedice' : 'blueice')
      }
    } else if (era === 'future') {
      for (const [dx, dz] of [[-12, -6], [12, 6], [-6, 12], [6, -12], [-12, 6], [12, -6]]) {
        for (let k = 0; k < 7; k++) put(dx, k, dz, k === 6 ? 'sealantern' : 'iron')
      }
      for (let ox = -3; ox <= 3; ox++) for (let oz = 8; oz <= 11; oz++) for (let k = 0; k < 5; k++) {
        const edge = Math.abs(ox) === 3 || oz === 8 || oz === 11
        if (edge && !(oz === 8 && Math.abs(ox) <= 1 && k < 3)) put(ox, k, oz, k === 4 ? 'cyanconcrete' : 'glass')
      }
    }
    trip.sky = makeSky(this.B, SKY[era], era === 'future')
    trip.sky.visible = false
    this.s.bm.scene.add(trip.sky)
    // The way home in the middle: a copy of the machine.
    trip.home = makeMachine(this.B)
    trip.home.position.set(c.x * this.B, ERA_Y * this.B, c.z * this.B)
    this.s.bm.scene.add(trip.home)
  }

  // A white flash: through time (only on the traveller's half of a split
  // screen).
  _flash(who = 'p1') {
    const couch = this.s.couch
    const split = !!couch?.active && couch.joined
    let el
    if (who === 'p2') {
      const host = couch?.hud?.querySelector('#couch-p2')
      if (!host) return
      el = host.querySelector('.couch-time-flash')
      if (!el) {
        el = document.createElement('div')
        el.className = 'couch-time-flash'
        host.appendChild(el)
      }
    } else {
      el = this._flashEl
      if (!el) {
        el = this._flashEl = document.createElement('div')
        el.id = 'time-flash'
        document.body.appendChild(el)
      }
      el.classList.toggle('couch-left', split)
    }
    el.classList.remove('on')
    void el.offsetWidth
    el.classList.add('on')
    try { audioEngine.playSpecial?.('whoosh') } catch { /* no audio */ }
  }

  clear() {
    for (const trip of [...this.trips.values()]) this._close(trip)
    this.where = { p1: '', p2: '' }
    this._lastPrompt = {}
    this._dropMachine()
    this.closePick(false)
  }
}

// Each era's own spot, far from the others, so two can be open at once.
export function eraCenter(era) {
  const i = Math.max(0, ERAS.indexOf(era))
  return { x: 2000.5 + i * ERA_GAP, z: 2000.5 }
}

// The machine: a round pod with a glass top, two brass rings spinning
// round it and a clock face on the front.
function makeMachine(B) {
  const g = new THREE.Group()
  const box = (geo, color, y, opts = {}) => {
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, ...opts }))
    m.position.y = y * B
    g.add(m)
    return m
  }
  box(new THREE.CylinderGeometry(0.9 * B, 1 * B, 0.3 * B, 16), 0x4a4a52, 0.15)
  box(new THREE.CylinderGeometry(0.7 * B, 0.7 * B, 1.6 * B, 16), 0x7a5a9a, 1.1)
  box(new THREE.SphereGeometry(0.7 * B, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0x9ad8ff, 1.9, { transparent: true, opacity: 0.55 })
  const clock = box(new THREE.CylinderGeometry(0.3 * B, 0.3 * B, 0.06 * B, 16), 0xf2f0ea, 1.2)
  clock.rotation.x = Math.PI / 2
  clock.position.z = 0.72 * B
  for (const tilt of [0.5, -0.5]) {
    const ring = box(new THREE.TorusGeometry(1.15 * B, 0.06 * B, 6, 32), 0xe8c14a, 1.2)
    ring.rotation.x = Math.PI / 2 + tilt
  }
  return g
}

// An era's sky: a big dome round the camera in its own colour (fog off),
// with stars over the future.
function makeSky(B, color, stars) {
  const g = new THREE.Group()
  const dome = new THREE.Mesh(new THREE.SphereGeometry(160 * B, 24, 16), new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: false, depthWrite: false }))
  dome.renderOrder = -10
  g.add(dome)
  if (stars) {
    const pos = []
    for (let i = 0; i < 400; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.1, Math.random() - 0.5).normalize().multiplyScalar(150 * B)
      pos.push(v.x, v.y, v.z)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xc0f0ff, size: 2, sizeAttenuation: false, fog: false, depthWrite: false })))
  }
  return g
}

function disposeTree(root) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isPoints) return
    o.geometry?.dispose?.()
    o.material?.dispose?.()
  })
}

// A small seeded random, so each era looks the same every visit.
function mulberry(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = a
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}
