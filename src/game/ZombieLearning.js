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
//
// Two more habits (2026-11-14, Batch 4a), learned on top of the weapon
// gear (a zombie can have both):
//   headshots -> steel visors: HEAD_SHARE or more of your last WINDOW kills
//     were headshots. A headshot on a visored zombie does GEAR_MULT.
//   camping   -> ladders: you stayed within CAMP_R blocks (sideways) of one
//     spot for CAMP_S seconds with zombies about. Laddered zombies climb
//     straight up walls like zombie spiders (`climbs`), so towers aren't safe.
// They forget the same way: every FORGET_S seconds, if you've stopped.
// Nothing forgets before MIN_FORGET kills since the lesson (a level went
// away again 45s after it was learned if you hadn't killed much since).
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
export const MIN_FORGET = 5
export const HEAD_SHARE = 0.6
export const CAMP_R = 5
export const CAMP_S = 60
// The extra habits (not weapon kinds).
export const HABITS = ['head', 'camp']
const ALL = [...KINDS, ...HABITS]

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
    this.recentHead = []
    this.level = { gun: 0, melee: 0, fire: 0, blast: 0, head: 0, camp: 0 }
    this.campAt = null
    this.campT = 0
    this.since = GAP
    this.forgetIn = FORGET_S
    hidePill('learn')
  }

  // A kill of mine (BuildSurvival._countKill).
  onKill() {
    if (!this.allowed) return
    this.recent.push(weaponKind(this.s.weapon))
    // Was it a headshot? (BuildSurvival.hitZombieWith sets _hitHead.)
    this.recentHead.push(!!this.s._hitHead)
    if (this.recent.length > WINDOW) this.recent.shift()
    if (this.recentHead.length > WINDOW) this.recentHead.shift()
    if (this.recent.length < WINDOW || this.since < GAP) return
    for (const k of KINDS) {
      if (this._share(k) < SHARE || this.level[k] >= MAX_LEVEL) continue
      this.recent = []
      this._learn(k)
      return
    }
    if (this._headShare() >= HEAD_SHARE && this.level.head < MAX_LEVEL) {
      this.recentHead = []
      this._learn('head')
    }
  }

  _learn(k) {
    this.level[k]++
    this.since = 0
    this.s._message(t(`learn_${k}`, { n: this.level[k] }), 5)
    try { audioEngine.playZombieScream?.() } catch { /* no audio */ }
    this._pill()
  }

  _headShare() {
    if (!this.recentHead.length) return 0
    return this.recentHead.filter(Boolean).length / this.recentHead.length
  }

  // Camping: staying near one spot while zombies are about.
  _watchCamping(dt) {
    const s = this.s
    if (s.dead || s.spectating || !s.zombies?.length) return
    const p = s.bodyPos?.()
    if (!p) return
    if (!this.campAt || Math.hypot(p.x - this.campAt.x, p.z - this.campAt.z) > CAMP_R) {
      this.campAt = { x: p.x, z: p.z }
      this.campT = 0
      return
    }
    this.campT += dt
    if (this.campT < CAMP_S || this.since < GAP || this.level.camp >= MAX_LEVEL) return
    this.campT = 0
    this._learn('camp')
  }

  _share(k) {
    if (!this.recent.length) return 0
    return this.recent.filter((x) => x === k).length / this.recent.length
  }

  update(dt) {
    if (!this.allowed) return
    this.since += dt
    this._watchCamping(dt)
    this.forgetIn -= dt
    if (this.forgetIn > 0) return
    this.forgetIn = FORGET_S
    for (const k of ALL) {
      if (this.level[k] <= 0 || !this._stopped(k)) continue
      this.level[k]--
      this.s._message(t('learnForgot', { gear: t(`learnGear_${k}`) }), 3)
      this._pill()
    }
  }

  // Have you stopped doing what taught them `k`?
  _stopped(k) {
    if (k === 'camp') return this.campT < CAMP_S / 2
    if (k === 'head') return this.recentHead.length >= MIN_FORGET && this._headShare() < FORGET_SHARE
    return this.recent.length >= MIN_FORGET && this._share(k) < FORGET_SHARE
  }

  _pill() {
    const on = ALL.filter((k) => this.level[k] > 0)
    if (!on.length) return hidePill('learn')
    showPill('learn', `${t('learnPill')}: ${on.map((k) => `${t(`learnGear_${k}`)} ${this.level[k]}`).join(' · ')}`)
  }

  // A new zombie (BuildSurvival._spawnZombie / _extraZombie): maybe gear.
  dress(z) {
    if (!z || !this.allowed) return
    const roll = (k) => Math.random() < Math.min(0.9, this.level[k] * LEVEL_CHANCE)
    if (!z.gear) {
      const order = KINDS.filter((k) => this.level[k] > 0).sort((a, b) => this.level[b] - this.level[a])
      for (const k of order) {
        if (!roll(k)) continue
        z.gear = k
        this._wear(z, k)
        break
      }
    }
    if (!z.visor && this.level.head > 0 && roll('head')) {
      z.visor = true
      this._wear(z, 'head')
    }
    // (Not a boss: a giant climbing your tower is too much.)
    if (!z.climbs && !z.boss && this.level.camp > 0 && roll('camp')) {
      z.climbs = true
      z.ladder = true
      this._wear(z, 'camp')
    }
  }

  // How much of a hit of mine gets through (BuildSurvival.damageZombie).
  mult(z) {
    if (!z) return 1
    let m = 1
    if (z.gear && z.gear === weaponKind(this.s.weapon)) m *= GEAR_MULT
    if (z.visor && this.s._hitHead) m *= GEAR_MULT
    return m
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
    } else if (k === 'head') {
      // A steel visor over the face, with an eye slit.
      add(0.6, 0.36, 0.06, m.metal, 0, h * 0.86, 0.32)
      add(0.5, 0.05, 0.07, m.strap, 0, h * 0.89, 0.33)
    } else if (k === 'camp') {
      // A wooden ladder strapped to its back.
      for (const side of [-1, 1]) add(0.06, h * 0.8, 0.06, m.wood, side * 0.22, h * 0.55, -0.3)
      for (let i = 0; i < 4; i++) add(0.44, 0.05, 0.05, m.wood, 0, h * (0.25 + i * 0.2), -0.3)
    } else {
      // Metal plates on the chest and shoulders.
      add(0.58, h * 0.3, 0.34, m.metal, 0, h * 0.6, 0)
      for (const side of [-1, 1]) add(0.26, 0.14, 0.34, m.metal, side * 0.36, h * 0.74, 0)
    }
  }
}
