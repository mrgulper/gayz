// Zombies that learn (2026-11-09, Gaymi's idea list 10: "if you use the
// same weapon too much, zombies start wearing helmets or carrying shields
// against it, so you have to switch things up"). Owned by BuildSurvival
// (`s.learn`).
//
// Your last WINDOW kills are remembered by what did them: guns, melee,
// fire (the Flamethrower) or blasts (rockets, grenades). Once one kind is
// SHARE or more of them (and GAP seconds since the last lesson), the
// zombies learn: that kind's level goes up (MAX_LEVEL at most) and new
// zombies come wearing gear against it - LEVEL_CHANCE x level of them:
//   guns  -> helmets      melee -> wooden shields
//   fire  -> wet suits    blast -> metal armour
// Hitting a zombie with what its gear is for does GEAR_MULT of the damage.
// Every FORGET_S seconds, a kind you've hardly used lately (under
// FORGET_SHARE of your last kills) drops a level. Only your own hits count
// and only alone or as a server's host (it dresses the host's zombies).
// The gear is meshes shared by every zombie (never disposed), never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { showPill, hidePill } from './PlayPills.js'
import { MOB_HEIGHT } from './PlayRules.js'

export const KINDS = ['gun', 'melee', 'fire', 'blast']
export const WINDOW = 20
export const SHARE = 0.7
export const GAP = 30
export const MAX_LEVEL = 3
export const LEVEL_CHANCE = 0.3
export const GEAR_MULT = 0.5
export const FORGET_S = 45
export const FORGET_SHARE = 0.3

// What a weapon counts as.
export function weaponKind(w) {
  if (!w) return 'gun'
  if (w.melee) return 'melee'
  if (w.burn) return 'fire'
  if (w.blast) return 'blast'
  return 'gun'
}

let shared = null
function mats() {
  if (shared) return shared
  shared = {
    helmet: new THREE.MeshLambertMaterial({ color: 0x5a6b4a }),
    strap: new THREE.MeshLambertMaterial({ color: 0x2b2b2b }),
    wood: new THREE.MeshLambertMaterial({ color: 0x8a5a32 }),
    rim: new THREE.MeshLambertMaterial({ color: 0x9aa0a6 }),
    suit: new THREE.MeshLambertMaterial({ color: 0x2f6fa8 }),
    metal: new THREE.MeshLambertMaterial({ color: 0x8a9096 }),
    geo: new Map(),
  }
  return shared
}
function geo(w, h, d) {
  const m = mats().geo
  const k = `${w},${h},${d}`
  if (!m.has(k)) m.set(k, new THREE.BoxGeometry(w, h, d))
  return m.get(k)
}

export class ZombieLearning {
  constructor(survival) {
    this.s = survival
    this.clear()
  }

  get allowed() {
    const s = this.s
    return s.active && !s.party && !s.td && !s.escape && !s.cfg?.noZombies && (!s.net || s.net.isHost)
  }

  clear() {
    this.recent = []
    this.level = { gun: 0, melee: 0, fire: 0, blast: 0 }
    this.since = GAP
    this.forgetIn = FORGET_S
    hidePill('learn')
  }

  // A kill of mine (BuildSurvival._countKill).
  onKill() {
    if (!this.allowed) return
    this.recent.push(weaponKind(this.s.weapon))
    if (this.recent.length > WINDOW) this.recent.shift()
    if (this.recent.length < WINDOW || this.since < GAP) return
    for (const k of KINDS) {
      if (this._share(k) < SHARE || this.level[k] >= MAX_LEVEL) continue
      this.level[k]++
      this.since = 0
      this.recent = []
      this.s._message(t(`learn_${k}`, { n: this.level[k] }), 5)
      try { audioEngine.playZombieScream?.() } catch { /* no audio */ }
      this._pill()
      return
    }
  }

  _share(k) {
    if (!this.recent.length) return 0
    return this.recent.filter((x) => x === k).length / this.recent.length
  }

  update(dt) {
    if (!this.allowed) return
    this.since += dt
    this.forgetIn -= dt
    if (this.forgetIn > 0) return
    this.forgetIn = FORGET_S
    for (const k of KINDS) {
      if (this.level[k] <= 0 || this._share(k) >= FORGET_SHARE) continue
      this.level[k]--
      this.s._message(t('learnForgot', { gear: t(`learnGear_${k}`) }), 3)
      this._pill()
    }
  }

  _pill() {
    const on = KINDS.filter((k) => this.level[k] > 0)
    if (!on.length) return hidePill('learn')
    showPill('learn', `${t('learnPill')}: ${on.map((k) => `${t(`learnGear_${k}`)} ${this.level[k]}`).join(' · ')}`)
  }

  // A new zombie (BuildSurvival._spawnZombie / _extraZombie): maybe gear.
  dress(z) {
    if (!z || !this.allowed || z.gear) return
    const order = KINDS.filter((k) => this.level[k] > 0).sort((a, b) => this.level[b] - this.level[a])
    for (const k of order) {
      if (Math.random() >= Math.min(0.9, this.level[k] * LEVEL_CHANCE)) continue
      z.gear = k
      this._wear(z, k)
      return
    }
  }

  // How much of a hit of mine gets through (BuildSurvival.damageZombie).
  mult(z) {
    if (!z?.gear) return 1
    return z.gear === weaponKind(this.s.weapon) ? GEAR_MULT : 1
  }

  _wear(z, k) {
    const B = this.s.B
    const m = mats()
    const h = MOB_HEIGHT * (z.size || 1) * (z.tall || 1)
    const w = z.wide || 1
    const add = (gw, gh, gd, mat, x, y, zz) => {
      const mesh = new THREE.Mesh(geo(gw * w * B, gh * B, gd * w * B), mat)
      mesh.position.set(x * B, y * B, zz * B)
      z.group.add(mesh)
      return mesh
    }
    if (k === 'gun') {
      // A helmet with a strap.
      add(0.62, 0.22, 0.62, m.helmet, 0, h * 0.97, 0)
      add(0.66, 0.06, 0.66, m.helmet, 0, h * 0.9, 0)
      add(0.04, 0.3, 0.04, m.strap, 0.26, h * 0.8, 0.2)
    } else if (k === 'melee') {
      // A round-ish wooden shield held in front.
      add(0.7, 0.8, 0.08, m.wood, 0, h * 0.58, 0.42)
      add(0.74, 0.06, 0.1, m.rim, 0, h * 0.58 + 0.4, 0.42)
      add(0.74, 0.06, 0.1, m.rim, 0, h * 0.58 - 0.4, 0.42)
    } else if (k === 'fire') {
      // A dripping-wet blue suit over the body.
      add(0.56, h * 0.4, 0.32, m.suit, 0, h * 0.56, 0)
      add(0.56, h * 0.36, 0.3, m.suit, 0, h * 0.18, 0)
    } else {
      // Metal plates on the chest and shoulders.
      add(0.58, h * 0.3, 0.34, m.metal, 0, h * 0.6, 0)
      for (const side of [-1, 1]) add(0.26, 0.14, 0.34, m.metal, side * 0.36, h * 0.74, 0)
    }
  }
}
