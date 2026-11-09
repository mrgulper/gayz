// Pizza Delivery (2026-11-09, Gaymi's idea list 10: "you grab pizzas at
// camp and deliver them to survivors' houses before they go cold. Zombies
// can smell the pizza and chase you"). Owned by BuildSurvival (`s.pizza`);
// the counter is one of the camp's small booths (BuildCamp builds it with
// findCampSpot). The camp is usually full by now, so when there's no room
// inside it stands just outside the camp's front, beside the way in.
//
// Press Use at the Pizza counter to take PIZZAS boxes. Each one has its
// own survivor waiting at a door HOUSE_MIN..HOUSE_MAX blocks from camp,
// marked with a tall orange beam. They stay hot for HOT_S seconds from
// when you take them (a pill counts down, with how far the nearest door
// is). Walk up to a door to hand one over: hot pays PIZZA_COINS (+TIP_COINS
// if you're quick - in the first TIP_S seconds), cold pays COLD_COINS and
// a grumble. While you carry pizza, zombies smell it: every SMELL_EVERY
// seconds one more comes after you from SMELL_MIN..SMELL_MAX blocks away
// (SMELL_MAX_N a job). Each player's own; meshes only, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { findCampSpot, makeLabel } from './CampTrophies.js'
import { showPill, hidePill } from './PlayPills.js'
import { makePerson, disposePerson, boxIn, disposeGroup } from './NpcPeople.js'

export const PIZZAS = 3
export const HOT_S = 150
export const TIP_S = 60
export const PIZZA_COINS = 40
export const TIP_COINS = 20
export const COLD_COINS = 5
export const SMELL_EVERY = 12
export const SMELL_MAX_N = 6
export const HOUSE_MIN = 20
export const HOUSE_MAX = 45
export const WIDE = 2
const DEEP = 1
const OUTSIDE = 3 // blocks out from the camp's front wall
const BESIDE_GATE = 5 // blocks along from the middle of it
const USE_R = 2.4
const HAND_R = 2.2
const SMELL_MIN = 16
const SMELL_MAX = 22
const BEAM_H = 22

export class PizzaDelivery {
  constructor(survival) {
    this.s = survival
    this.spot = null
    this.group = null
    this.job = null // { left, smellIn, smelled, drops: [{ x, y, z, person, mark }] }
  }

  get B() {
    return this.s.B
  }

  // The counter, against a camp wall or on open camp ground.
  buildCounter(camp, avoid = []) {
    if (this.group) return this.spot
    this.spot = findCampSpot(camp, WIDE, DEEP, avoid) || this._outside(camp)
    if (!this.spot) return null
    const B = this.B
    const g = new THREE.Group()
    // The oven at the back, glowing inside.
    boxIn(g, B, 1, 1.3, 0.6, 0x6b4a3a, -0.45, 0.65, 0.35)
    boxIn(g, B, 0.6, 0.4, 0.05, 0xff8a2a, -0.45, 0.7, 0.67, { emissive: 0xff6a1a, emissiveIntensity: 0.9 })
    // The counter with pizza boxes on it.
    boxIn(g, B, WIDE, 1, 0.4, 0xf2f0ea, 0, 0.5, 1)
    for (let i = 0; i < 4; i++) boxIn(g, B, 0.6, 0.12, 0.6, 0xd9b27c, 0.5, 1.06 + i * 0.13, 0.9)
    // A red-and-white striped awning.
    for (let i = 0; i < 6; i++) boxIn(g, B, WIDE / 6, 0.12, DEEP + 0.3, i % 2 ? 0xf2f0ea : 0xd8352a, -WIDE / 2 + (i + 0.5) * (WIDE / 6), 2.7, DEEP / 2)
    for (const x of [-WIDE / 2 + 0.1, WIDE / 2 - 0.1]) boxIn(g, B, 0.12, 2.7, 0.12, 0x8a5a32, x, 1.35, DEEP)
    const sign = makeLabel(t('pizzaSign'), 512, 48, '#ffe0b0')
    sign.scale.set(2.6 * B, 0.5 * B, 1)
    sign.position.set(0, 3.2 * B, (DEEP + 0.2) * B)
    g.add(sign)
    g.position.set(this.spot.x * B, (this.spot.y || 0) * B, this.spot.z * B)
    g.rotation.y = this.spot.rot
    camp.bm.scene.add(g)
    this.group = g
    // Where you stand to use it: in front of the counter.
    const c = Math.cos(this.spot.rot)
    const sn = Math.sin(this.spot.rot)
    this.front = { x: this.spot.x + 1.9 * sn, z: this.spot.z + 1.9 * c }
    return this.spot
  }

  // Just outside the camp's front wall, beside the way in, facing out.
  _outside(camp) {
    const s = this.s
    const zn = camp.zone
    if (!zn) return null
    const mx = (zn.x0 + zn.x1) / 2
    const mz = (zn.z0 + zn.z1) / 2
    const sides = {
      zmin: { x: mx + BESIDE_GATE, z: zn.z0 - OUTSIDE, rot: Math.PI },
      zmax: { x: mx + BESIDE_GATE, z: zn.z1 + OUTSIDE, rot: 0 },
      xmin: { x: zn.x0 - OUTSIDE, z: mz + BESIDE_GATE, rot: -Math.PI / 2 },
      xmax: { x: zn.x1 + OUTSIDE, z: mz + BESIDE_GATE, rot: Math.PI / 2 },
    }
    const order = [zn.facade, ...Object.keys(sides).filter((k) => k !== zn.facade)].filter((k) => sides[k])
    for (const k of order) {
      const at = sides[k]
      const y = s._groundUnder(at.x, 60, at.z)
      if (!Number.isFinite(y)) continue
      const under = s.bm.getBlockAt(Math.floor(at.x), Math.floor(y) - 1, Math.floor(at.z))
      if (!under || under === 'water' || under === 'lava') continue
      return { ...at, y }
    }
    return null
  }

  near() {
    if (!this.front) return false
    const p = this.s.bodyPos()
    return Math.hypot(p.x - this.front.x, p.z - this.front.z) < USE_R
  }

  prompt() {
    return t(this.job ? 'pizzaPromptBusy' : 'pizzaPrompt', { n: PIZZAS })
  }

  // Use at the counter. -> true if it was there.
  use() {
    if (!this.near()) return false
    const s = this.s
    if (s.dead) return true
    if (this.job) {
      s._message(t('pizzaStillGot', { n: this.job.drops.length }), 3)
      return true
    }
    const drops = []
    for (let i = 0; i < PIZZAS; i++) {
      const at = this._house(drops)
      if (at) drops.push(this._door(at))
    }
    if (!drops.length) {
      s._message(t('pizzaNoHouses'), 3)
      return true
    }
    this.job = { left: HOT_S, took: 0, smellIn: SMELL_EVERY, smelled: 0, drops }
    s._message(t('pizzaTaken', { n: drops.length, s: HOT_S }), 4)
    try { audioEngine.playSpecial?.('dingdong') } catch { /* no audio */ }
    return true
  }

  // A spot on dry ground HOUSE_MIN..HOUSE_MAX blocks from the counter,
  // not too close to another door.
  _house(taken) {
    const s = this.s
    const from = this.front || s.bodyPos()
    const y0 = s.bodyPos().y
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2
      const d = HOUSE_MIN + Math.random() * (HOUSE_MAX - HOUSE_MIN)
      const x = Math.floor(from.x + Math.cos(a) * d) + 0.5
      const z = Math.floor(from.z + Math.sin(a) * d) + 0.5
      if (s.camp?.inside?.(x, z, 3)) continue
      if (taken.some((o) => Math.hypot(o.x - x, o.z - z) < 10)) continue
      const y = s._groundUnder(x, y0 + 20, z)
      if (!Number.isFinite(y) || Math.abs(y - y0) > 14) continue
      const under = s.bm.getBlockAt(Math.floor(x), Math.floor(y) - 1, Math.floor(z))
      if (!under || under === 'water' || under === 'lava') continue
      return { x, y, z }
    }
    return null
  }

  // A survivor at a door frame, under a beam.
  _door(at) {
    const B = this.B
    const mark = new THREE.Group()
    mark.position.set(at.x * B, at.y * B, at.z * B)
    boxIn(mark, B, 1.2, 0.15, 0.25, 0x5e3b1f, 0, 2.35, 0)
    for (const x of [-0.6, 0.6]) boxIn(mark, B, 0.15, 2.4, 0.25, 0x5e3b1f, x, 1.2, 0)
    boxIn(mark, B, 1, 2.2, 0.1, 0x8a5a32, 0, 1.1, -0.05)
    boxIn(mark, B, 0.4, 0.3, 0.3, 0xd8352a, 1.2, 1, 0.3)
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * B, 0.35 * B, BEAM_H * B, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xff9a3a, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }))
    beam.position.y = (BEAM_H / 2) * B
    mark.add(beam)
    this.s.bm.scene.add(mark)
    const person = makePerson(this.s, { x: at.x + 0.9, y: at.y, z: at.z + 0.9 }, t('pizzaCustomer'))
    return { x: at.x, y: at.y, z: at.z, person, mark, beam }
  }

  update(dt) {
    const job = this.job
    const s = this.s
    if (!job) return
    if (!s.active || s.dead) return this._stop()
    job.left -= dt
    job.took += dt
    const me = s.bodyPos()
    for (const d of job.drops) {
      d.beam.material.opacity = 0.22 + Math.sin(performance.now() / 300) * 0.08
      if (d.person.body) d.person.group.rotation.y = Math.atan2(me.x - d.x, me.z - d.z)
      if (Math.hypot(me.x - d.x, me.z - d.z) < HAND_R && Math.abs(me.y - d.y) < 3) this._hand(d)
    }
    job.drops = job.drops.filter((d) => !d.done)
    if (!job.drops.length) {
      s._message(t('pizzaAllDone'), 3)
      this._stop()
      return
    }
    // The smell brings zombies.
    if (!s.cfg?.noZombies) {
      job.smellIn -= dt
      if (job.smellIn <= 0 && job.smelled < SMELL_MAX_N) {
        job.smellIn = SMELL_EVERY
        if (this._smellZombie(me)) {
          if (!job.smelled) s._message(t('pizzaSmell'), 3)
          job.smelled++
        }
      }
    }
    const near = Math.min(...job.drops.map((d) => Math.hypot(me.x - d.x, me.z - d.z)))
    const left = Math.max(0, Math.ceil(job.left))
    showPill('pizza', job.left > 0 ? t('pizzaPill', { n: job.drops.length, t: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, d: Math.round(near) }) : t('pizzaPillCold', { n: job.drops.length, d: Math.round(near) }), job.left < 30)
  }

  _hand(d) {
    const s = this.s
    const job = this.job
    d.done = true
    let paid = COLD_COINS
    if (job.left > 0) {
      paid = PIZZA_COINS + (job.took <= TIP_S ? TIP_COINS : 0)
      s._message(t(job.took <= TIP_S ? 'pizzaHotTip' : 'pizzaHot', { n: Math.round(paid * (s.cfg?.coinMult ?? 1)) }), 3)
      try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
    } else {
      s._message(t('pizzaCold', { n: Math.round(paid * (s.cfg?.coinMult ?? 1)) }), 3)
      try { audioEngine.playSpecial?.('burp') } catch { /* no audio */ }
    }
    s._earn(paid)
    s._renderHud?.()
    s.bingo?.note('pizza')
    disposeGroup(d.mark)
    disposePerson(d.person)
  }

  // One more zombie, off behind you, that follows the smell.
  _smellZombie(me) {
    const s = this.s
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2
      const d = SMELL_MIN + Math.random() * (SMELL_MAX - SMELL_MIN)
      const x = me.x + Math.cos(a) * d
      const z = me.z + Math.sin(a) * d
      if (s.camp?.inside?.(x, z, 2)) continue
      const y = s._groundUnder(x, me.y + 12, z)
      if (!Number.isFinite(y) || Math.abs(y - me.y) > 10) continue
      return !!s._extraZombie(x, y, z)
    }
    return false
  }

  _stop() {
    for (const d of this.job?.drops || []) {
      disposeGroup(d.mark)
      disposePerson(d.person)
    }
    this.job = null
    hidePill('pizza')
  }

  // A new run (the counter is the camp's, rebuilt with it).
  clear() {
    this._stop()
  }

  disposeCounter() {
    disposeGroup(this.group)
    this.group = null
    this.spot = null
    this.front = null
  }
}
