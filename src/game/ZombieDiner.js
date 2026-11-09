// The Zombie Diner (2026-11-09, Gaymi's idea list 10: "you run a
// restaurant in town and cook orders for survivor customers. Sometimes a
// zombie sneaks in dressed as a customer. It would go in town, because the
// camp is out of space"). Owned by BuildSurvival (`s.diner`).
//
// OPEN_AFTER seconds into a normal run a little diner opens: in the
// nearest town's middle if there's one close by, otherwise on flat ground
// near you (a beam marks it until you've been inside). Real blocks
// (TempBlocks.js), put back when the run ends.
//
// While you're near, customers come in (one every CUSTOMER_EVERY seconds,
// SEATS at once) and stand at the counter with their order over their
// head: one of DISHES. Use at the stove to cook something (a pick-a-dish
// screen), then Use on the customer facing you to serve it. The right dish
// pays DISH_COINS (+TIP_COINS if they waited under TIP_S seconds); the
// wrong one and they storm out. Out of patience (PATIENCE_S) they leave.
// Now and then (DISGUISE_CHANCE) a customer is a zombie in disguise - green
// hands and a groan give it away. Use on it with empty hands to throw it
// out (SPOT_COINS, and it turns back into a zombie you have to deal with);
// serve it, or leave it waiting REVEAL_S seconds, and it jumps you. Use on
// a real customer with empty hands and they leave offended.
// Each player's own; disguised zombies only alone or as a server's host.
// Meshes for the people, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { TempBlocks } from './TempBlocks.js'
import { makeLabel } from './CampTrophies.js'
import { openScreen, closeScreen } from './CampScreen.js'
import { showPill, hidePill } from './PlayPills.js'
import { makePerson, disposePerson, disposeGroup } from './NpcPeople.js'

export const DISHES = ['burger', 'pizza', 'soup', 'fries']
export const OPEN_AFTER = 20
export const CUSTOMER_EVERY = 12
export const SEATS = 3
export const PATIENCE_S = 60
export const DISH_COINS = 30
export const TIP_COINS = 15
export const TIP_S = 20
export const SPOT_COINS = 40
export const DISGUISE_CHANCE = 0.2
export const REVEAL_S = [15, 30]
const NEAR_R = 30
const TOWN_R = 140
const HALF = 4 // walls at +-HALF, inside -3..3
const STOVE_R = 2
const SERVE_R = 2.4
const TRY_EVERY = 5
// Where customers stand (local x, z): in front of the counter.
const SPOTS = [[0, 0], [1.5, 0], [3, 0]]

export class ZombieDiner {
  constructor(survival) {
    this.s = survival
    this.cells = new TempBlocks(survival)
    this.at = null // { x, y, z } its middle on the floor
    this.customers = []
    this.holding = ''
    this.wait = OPEN_AFTER
    this.visited = false
  }

  get B() {
    return this.s.B
  }

  get allowed() {
    const s = this.s
    return s.active && !s.party && !s.td && !s.escape && !s.moon?.on && !s.time?.away && !!s.bm.world?.active
  }

  update(dt) {
    const s = this.s
    if (!this.allowed) return
    if (!this.at) {
      this.wait -= dt
      if (this.wait > 0 || s.dead) return
      this.wait = TRY_EVERY
      this._open()
      return
    }
    const me = s.bodyPos()
    const near = Math.hypot(me.x - this.at.x, me.z - this.at.z) < NEAR_R
    if (this._beam) {
      this._beam.material.opacity = 0.22 + Math.sin(performance.now() / 300) * 0.08
      if (this._inside(me)) {
        this.visited = true
        disposeGroup(this._beam)
        this._beam = null
        s._message(t('dinerWelcome'), 4)
      }
    }
    // Customers come while you're about.
    if (near && !s.dead) {
      this.nextIn = (this.nextIn ?? 3) - dt
      if (this.nextIn <= 0 && this.customers.length < SEATS) {
        this.nextIn = CUSTOMER_EVERY
        this._customer()
      }
    }
    for (const c of this.customers) this._tickCustomer(c, dt, me)
    this.customers = this.customers.filter((c) => !c.gone)
    this._pill(me)
  }

  _inside(p) {
    const a = this.at
    return !!a && Math.abs(p.x - a.x) < HALF && Math.abs(p.z - a.z) < HALF && Math.abs(p.y - a.y) < 3
  }

  // --- the building ---

  _open() {
    const s = this.s
    const me = s.bodyPos()
    // The nearest town's middle, or somewhere near you.
    const towns = (s.bm.world?._landmarks || []).filter((p) => p.placeName && Number.isFinite(p.cx) && Math.hypot(p.cx - me.x, p.cz - me.z) < TOWN_R)
    towns.sort((a, b) => Math.hypot(a.cx - me.x, a.cz - me.z) - Math.hypot(b.cx - me.x, b.cz - me.z))
    const centres = towns.length ? [{ x: towns[0].cx, z: towns[0].cz, r: 26 }] : []
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2
      const d = 16 + Math.random() * 14
      centres.push({ x: me.x + Math.cos(a) * d, z: me.z + Math.sin(a) * d, r: 6 })
    }
    for (const c of centres) {
      const spot = this._flat(c.x, c.z, c.r, me.y)
      if (spot) {
        this._build(spot)
        s._message(t(towns.length ? 'dinerOpenTown' : 'dinerOpen'), 5)
        try { audioEngine.playSpecial?.('dingdong') } catch { /* no audio */ }
        return
      }
    }
  }

  // A flat, open patch for the diner within r blocks of (x, z).
  _flat(x0, z0, r, nearY) {
    const s = this.s
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2
      const d = Math.random() * r
      const cx = Math.floor(x0 + Math.cos(a) * d)
      const cz = Math.floor(z0 + Math.sin(a) * d)
      if (s.camp?.inside?.(cx, cz, HALF + 3)) continue
      const y = s._groundUnder(cx + 0.5, nearY + 24, cz + 0.5)
      if (!Number.isFinite(y) || Math.abs(y - nearY) > 20) continue
      let ok = true
      for (let x = -HALF; ok && x <= HALF; x++) {
        for (let z = -HALF; ok && z <= HALF + 1; z++) {
          const under = s.bm.getBlockAt(cx + x, y - 1, cz + z)
          if (!under || under === 'water' || under === 'lava') ok = false
          for (let k = 0; ok && k < 5; k++) if (s._solid(cx + x, y + k, cz + z)) ok = false
        }
      }
      if (ok) return { x: cx, y, z: cz }
    }
    return null
  }

  _build(at) {
    const B = this.B
    const put = (x, y, z, type) => this.cells.put(at.x + x, at.y + y, at.z + z, type)
    for (let x = -HALF; x <= HALF; x++) {
      for (let z = -HALF; z <= HALF; z++) {
        const wall = Math.abs(x) === HALF || Math.abs(z) === HALF
        put(x, -1, z, (x + z) % 2 ? 'whiteconcrete' : 'blackconcrete')
        put(x, 3, z, 'whiteconcrete')
        if (!wall) continue
        const door = z === HALF && x === 0
        for (let y = 0; y < 3; y++) {
          if (door && y < 2) continue
          const corner = Math.abs(x) === HALF && Math.abs(z) === HALF
          const window = y === 1 && !corner && (x + z) % 2 === 0
          put(x, y, z, window ? 'glass' : y === 2 ? 'whiteconcrete' : 'redconcrete')
        }
      }
    }
    // The counter, with a gap at the side to get round the back.
    for (let x = -1; x <= 3; x++) put(x, 0, -1, 'smoothstone')
    // The stove at the back.
    put(3, 0, -3, 'furnace')
    put(2, 0, -3, 'smoothstone')
    this.at = { x: at.x + 0.5, y: at.y, z: at.z + 0.5 }
    this.stove = { x: at.x + 3.5, z: at.z - 2.5 }
    // A sign on the roof, and a beam until you've been in.
    const g = new THREE.Group()
    const sign = makeLabel(t('dinerSign'), 512, 52, '#ffd6e0')
    sign.scale.set(4 * B, 0.7 * B, 1)
    sign.position.set(0, 1.2 * B, (HALF + 0.6) * B)
    g.add(sign)
    g.position.set(this.at.x * B, (at.y + 3) * B, this.at.z * B)
    this.s.bm.scene.add(g)
    this._sign = g
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4 * B, 0.6 * B, 24 * B, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7ab0, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }))
    beam.position.set(this.at.x * B, (at.y + 16) * B, this.at.z * B)
    this.s.bm.scene.add(beam)
    this._beam = this.visited ? null : beam
    if (this.visited) disposeGroup(beam)
  }

  // --- customers ---

  _customer() {
    const s = this.s
    const free = SPOTS.findIndex((_, i) => !this.customers.some((c) => c.seat === i))
    if (free < 0) return
    const [lx, lz] = SPOTS[free]
    const at = { x: this.at.x - 0.5 + lx + 0.5, y: this.at.y, z: this.at.z - 0.5 + lz + 0.5 }
    const zombieOk = !s.cfg?.noZombies && (!s.net || s.net.isHost)
    const zombie = zombieOk && Math.random() < DISGUISE_CHANCE
    const dish = DISHES[Math.floor(Math.random() * DISHES.length)]
    const person = makePerson(s, at, t('dinerCustomer'))
    // Green hands give a zombie away.
    if (zombie) {
      for (const side of [-1, 1]) {
        const hand = new THREE.Mesh(new THREE.BoxGeometry(0.2 * this.B, 0.2 * this.B, 0.2 * this.B), new THREE.MeshLambertMaterial({ color: 0x4f8a3a }))
        hand.position.set(side * 0.42 * this.B, 0.8 * this.B, 0)
        person.group.add(hand)
      }
    }
    // Facing the counter.
    person.group.rotation.y = Math.PI
    const label = makeLabel(t(`dinerDish_${dish}`), 256, 40, '#fff3c8')
    label.scale.set(1.6 * this.B, 0.45 * this.B, 1)
    label.position.y = 2.75 * this.B
    person.group.add(label)
    const c = { seat: free, x: at.x, z: at.z, person, dish, zombie, patience: PATIENCE_S, waited: 0, revealIn: REVEAL_S[0] + Math.random() * (REVEAL_S[1] - REVEAL_S[0]), groanIn: 3 + Math.random() * 4 }
    this.customers.push(c)
    try { audioEngine.playSpecial?.('bell') } catch { /* no audio */ }
  }

  _tickCustomer(c, dt, me) {
    const s = this.s
    c.waited += dt
    c.patience -= dt
    if (c.zombie) {
      c.revealIn -= dt
      c.groanIn -= dt
      if (c.groanIn <= 0) {
        c.groanIn = 5 + Math.random() * 5
        try { audioEngine.playZombieMoan?.(0.5) } catch { /* no audio */ }
      }
      if (c.revealIn <= 0) return this._reveal(c, 'dinerZombieJumps')
    }
    if (c.patience <= 0) {
      s._message(t('dinerLeft'), 2.5)
      return this._leave(c)
    }
    // A little fidget, and a look at you when you're close.
    if (c.person.body && Math.hypot(me.x - c.x, me.z - c.z) < 6) c.person.group.rotation.y = Math.atan2(me.x - c.x, me.z - c.z)
  }

  _leave(c) {
    c.gone = true
    disposePerson(c.person)
  }

  _reveal(c, key, vars = {}) {
    const s = this.s
    this._leave(c)
    s._message(t(key, vars), 3)
    try { audioEngine.playSpecial?.('warn') } catch { /* no audio */ }
    s._extraZombie(c.x, this.at.y, c.z)
  }

  // --- using things ---

  // The customer you're looking at, close enough.
  _facing() {
    const s = this.s
    const p = s.bm.tryMode.pos
    const yaw = s.bm._yaw
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    let best = null
    let bestD = SERVE_R
    for (const c of this.customers) {
      const dx = c.x - p.x
      const dz = c.z - p.z
      const d = Math.hypot(dx, dz)
      if (d > bestD || d < 0.01 || (dx * fx + dz * fz) / d < 0.5) continue
      best = c
      bestD = d
    }
    return best
  }

  _atStove() {
    const p = this.s.bodyPos()
    return !!this.stove && Math.hypot(p.x - this.stove.x, p.z - this.stove.z) < STOVE_R && Math.abs(p.y - this.at.y) < 2
  }

  // The Use key (BuildMode._tryUseFromCamera). -> true if it was ours.
  use() {
    const s = this.s
    if (!this.at || s.dead || !this._inside(s.bodyPos())) return false
    const c = this._facing()
    if (c) {
      this._serve(c)
      return true
    }
    if (this._atStove()) {
      this._cookMenu()
      return true
    }
    return false
  }

  _serve(c) {
    const s = this.s
    if (!this.holding) {
      // Empty hands: throw them out.
      if (c.zombie) {
        s._earn(SPOT_COINS)
        s._renderHud?.()
        this._reveal(c, 'dinerSpotted', { n: Math.round(SPOT_COINS * (s.cfg?.coinMult ?? 1)) })
      } else {
        s._message(t('dinerOffended'), 3)
        this._leave(c)
      }
      return
    }
    const dish = this.holding
    this.holding = ''
    if (c.zombie) return this._reveal(c, 'dinerZombieAte')
    if (dish !== c.dish) {
      s._message(t('dinerWrong', { dish: t(`dinerDish_${c.dish}`) }), 3)
      try { audioEngine.playSpecial?.('burp') } catch { /* no audio */ }
      return this._leave(c)
    }
    const paid = DISH_COINS + (c.waited <= TIP_S ? TIP_COINS : 0)
    s._earn(paid)
    s._renderHud?.()
    s._message(t(c.waited <= TIP_S ? 'dinerServedTip' : 'dinerServed', { n: Math.round(paid * (s.cfg?.coinMult ?? 1)) }), 3)
    try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
    s.bingo?.note('diner')
    this._leave(c)
  }

  _cookMenu() {
    this._screen = openScreen(this.s, {
      title: t('dinerCookTitle'),
      build: (body, close) => {
        const p = document.createElement('p')
        p.className = 'diner-hint'
        p.textContent = t('dinerCookHint')
        const row = document.createElement('div')
        row.className = 'diner-dishes'
        for (const d of DISHES) {
          const b = document.createElement('button')
          b.type = 'button'
          b.className = 'diner-dish'
          b.dataset.dish = d
          b.textContent = t(`dinerDish_${d}`)
          b.addEventListener('click', () => {
            this.cook(d)
            close()
          })
          row.appendChild(b)
        }
        body.append(p, row)
      },
      onKey: (e, down) => {
        const m = down && /^Digit([1-4])$/.exec(e.code)
        if (m) {
          this.cook(DISHES[Number(m[1]) - 1])
          closeScreen()
        }
      },
    })
  }

  // Cooked and in your hands.
  cook(dish) {
    if (!DISHES.includes(dish)) return
    this.holding = dish
    this.s._message(t('dinerCooked', { dish: t(`dinerDish_${dish}`) }), 2.5)
    try { audioEngine.playSpecial?.('pop') } catch { /* no audio */ }
  }

  _pill(me) {
    if (!this.at || !this._inside(me)) return hidePill('diner')
    let text = this.holding ? t('dinerHolding', { dish: t(`dinerDish_${this.holding}`) }) : t('dinerPillCook')
    if (this._atStove()) text = t('dinerAtStove')
    else if (this._facing()) text = this.holding ? t('dinerPillServe') : t('dinerPillKick')
    showPill('diner', text)
  }

  clear() {
    for (const c of this.customers) disposePerson(c.person)
    this.customers = []
    this.cells.restore()
    disposeGroup(this._sign)
    disposeGroup(this._beam)
    this._sign = null
    this._beam = null
    this.at = null
    this.stove = null
    this.holding = ''
    this.wait = OPEN_AFTER
    this.visited = false
    this.nextIn = undefined
    hidePill('diner')
  }
}
