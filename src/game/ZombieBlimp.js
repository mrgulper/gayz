// The Zombie Blimp (2026-11-09, Gaymi's idea list 10: "a huge, slow
// airship floats over the city while a loudspeaker on it makes fun of you,
// and it drops zombies on parachutes. If you shoot its balloon until it
// crashes, it spills loot"). A world event (WorldEvents 'blimp'), owned by
// BuildSurvival (`s.blimp`).
//
// A big blocky airship circles CIRCLE_R blocks round where you were,
// ALTITUDE blocks up. Every TAUNT_EVERY seconds its loudspeaker makes fun
// of you (one of TAUNTS lines), and every DROP_EVERY seconds it drops a
// zombie on a parachute (DROPS_MAX in all) that lands and comes for you.
// Shoot the balloon: BLIMP_HP health, shown in a pill. Down to nothing, it
// tips nose-first and crashes, spilling LOOT and BLIMP_COINS coins where
// it hits. After BLIMP_LIFE seconds an unbeaten blimp floats away.
//
// Only alone or as a server's host (the others see the zombies it drops,
// not the blimp - like the UFO). Meshes only, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { showPill, hidePill } from './PlayPills.js'
import { makeLabel } from './CampTrophies.js'

export const BLIMP_HP = 900
export const BLIMP_LIFE = 150
export const BLIMP_COINS = 200
export const DROP_EVERY = 7
export const DROPS_MAX = 10
export const TAUNT_EVERY = 9
export const TAUNTS = 8
export const ALTITUDE = 26
const CIRCLE_R = 18
const TURN_SPEED = 0.07 // radians a second round the circle
const CHUTE_FALL = 2.6
const HIT_R = 2.6
const LEAVE_SPEED = 6
export const LOOT = ['healthpack', 'healthpack', 'ammobox', 'ammobox', 'zombieGoo', 'zombieGoo', 'mapPiece']

export class ZombieBlimp {
  constructor(survival) {
    this.s = survival
    this.b = null // { cx, cz, y, a, hp, left, dropIn, tauntIn, drops, falling, vy, x, z, leaving }
    this.chutes = []
  }

  get B() {
    return this.s.B
  }

  possible() {
    const s = this.s
    return !this.b && !s.td && !s.escape && !s.party && !s.moon?.on
  }

  // The world event. -> a run, or null.
  event(me) {
    if (!this.possible()) return null
    const s = this.s
    const ground = s._groundUnder(me.x, me.y + 30, me.z)
    const y = Math.max(Number.isFinite(ground) ? ground : me.y, me.y) + ALTITUDE
    this.b = { cx: me.x, cz: me.z, y, a: Math.random() * Math.PI * 2, hp: BLIMP_HP, left: BLIMP_LIFE, dropIn: 3, tauntIn: 1.5, drops: 0, falling: false, vy: 0, x: me.x, z: me.z, leaving: false, flash: 0, taunt: -1 }
    this._build()
    s._message(t('blimpComing'), 4)
    try { audioEngine.playSpecial?.('siren') } catch { /* no audio */ }
    // When the event ends, zombies still in the air land at once.
    return { update: (dt) => this.update(dt), dispose: () => this.clear(true) }
  }

  _build() {
    const B = this.B
    const g = new THREE.Group()
    const skin = new THREE.MeshLambertMaterial({ color: 0x7d8a6a })
    this._skin = skin
    const box = (w, h, d, mat, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), mat)
      m.position.set(x * B, y * B, z * B)
      g.add(m)
      return m
    }
    // The balloon: a long body with rounded-off ends, and red stripes.
    box(4.4, 4.4, 12, skin, 0, 0, 0)
    box(3.4, 3.4, 1.6, skin, 0, 0, 6.8)
    box(2.2, 2.2, 1, skin, 0, 0, 8)
    box(3.4, 3.4, 1.6, skin, 0, 0, -6.8)
    box(2, 2, 1, skin, 0, 0, -8)
    const red = new THREE.MeshLambertMaterial({ color: 0xa8382a })
    for (const z of [-3.5, 3.5]) box(4.5, 4.5, 0.6, red, 0, 0, z)
    // Patches sewn on.
    const patch = new THREE.MeshLambertMaterial({ color: 0x5c6650 })
    box(1.2, 1, 0.1, patch, 1, 1, 6.05).rotation.z = 0.2
    box(0.1, 1.1, 1.4, patch, 2.25, -0.6, -1)
    // Tail fins.
    const fin = new THREE.MeshLambertMaterial({ color: 0x4a523f })
    box(0.25, 2.6, 2, fin, 0, 2.2, -7.4)
    box(0.25, 2.6, 2, fin, 0, -2.2, -7.4)
    box(2.6, 0.25, 2, fin, 2.2, 0, -7.4)
    box(2.6, 0.25, 2, fin, -2.2, 0, -7.4)
    // The gondola underneath, with the loudspeaker on its front.
    const dark = new THREE.MeshLambertMaterial({ color: 0x3a3a3a })
    box(1.8, 1.2, 4, dark, 0, -2.9, 0.5)
    box(1.9, 0.4, 3, new THREE.MeshLambertMaterial({ color: 0x9fd0e0 }), 0, -2.7, 0.5)
    const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.6 * B, 0.18 * B, 1.1 * B, 10, 1, true), new THREE.MeshLambertMaterial({ color: 0xb8b8b8, side: THREE.DoubleSide }))
    horn.rotation.x = Math.PI / 2
    horn.position.set(0, -2.9 * B, 3 * B)
    g.add(horn)
    // A painted name on both sides.
    for (const side of [-1, 1]) {
      const label = makeLabel(t('blimpSign'), 512, 64, '#e8f5c8')
      label.scale.set(6 * B, 0.9 * B, 1)
      label.position.set(side * 2.3 * B, 0.6 * B, 0)
      g.add(label)
    }
    this.s.bm.scene.add(g)
    this.group = g
  }

  update(dt) {
    const b = this.b
    if (!b) return false
    const s = this.s
    const B = this.B
    b.flash = Math.max(0, b.flash - dt)
    if (this._skin) this._skin.emissive.setHex(b.flash > 0 ? 0x662222 : 0x000000)
    this._updateChutes(dt)
    if (b.falling) return this._fall(dt)
    b.left -= dt
    if (b.left <= 0 && !b.leaving) {
      b.leaving = true
      s._message(t('blimpLeaves'), 3)
    }
    let heading
    if (b.leaving) {
      // Off it goes, the way it was facing.
      heading = this.group.rotation.y
      b.x += Math.sin(heading) * LEAVE_SPEED * dt
      b.z += Math.cos(heading) * LEAVE_SPEED * dt
      b.y += dt * 1.5
      if (Math.hypot(b.x - b.cx, b.z - b.cz) > 120) {
        this.clear()
        return false
      }
    } else {
      b.a += TURN_SPEED * dt
      b.x = b.cx + Math.cos(b.a) * CIRCLE_R
      b.z = b.cz + Math.sin(b.a) * CIRCLE_R
      // Facing along the circle.
      heading = Math.atan2(-Math.sin(b.a), Math.cos(b.a))
      b.tauntIn -= dt
      if (b.tauntIn <= 0) {
        b.tauntIn = TAUNT_EVERY
        let i = Math.floor(Math.random() * TAUNTS)
        if (i === b.taunt) i = (i + 1) % TAUNTS
        b.taunt = i
        s._message(t('blimpSays', { line: t(`blimpTaunt${i}`) }), 4)
        try { audioEngine.playSpecial?.('shout') } catch { /* no audio */ }
      }
      b.dropIn -= dt
      if (b.dropIn <= 0 && b.drops < DROPS_MAX) {
        b.dropIn = DROP_EVERY
        b.drops++
        this._dropChute(b.x, b.y - 3.5, b.z)
      }
    }
    this.group.position.set(b.x * B, (b.y + Math.sin(performance.now() / 900) * 0.3) * B, b.z * B)
    this.group.rotation.set(0, heading, Math.sin(performance.now() / 1300) * 0.04)
    showPill('blimp', t('blimpPill', { n: Math.max(0, Math.ceil((b.hp / BLIMP_HP) * 100)) }), b.hp < BLIMP_HP * 0.3)
    return true
  }

  // A shot (BuildSurvival.shoot): did it hit the balloon? -> true if so.
  shoot(ray, reach, damage) {
    const b = this.b
    if (!b || b.falling || !this.group) return false
    const B = this.B
    const heading = this.group.rotation.y
    let best = Infinity
    // The long balloon, as three balls along it.
    for (const along of [-5, 0, 5]) {
      const c = new THREE.Vector3((b.x + Math.sin(heading) * along) * B, b.y * B, (b.z + Math.cos(heading) * along) * B)
      const p = ray.intersectSphere(new THREE.Sphere(c, HIT_R * B), new THREE.Vector3())
      if (p) best = Math.min(best, p.distanceTo(ray.origin))
    }
    if (best > reach) return false
    b.hp -= damage
    b.flash = 0.1
    this.s.damageNumbers?.show(b.x, b.y + 2.5, b.z, damage)
    if (b.hp <= 0) this._down()
    return true
  }

  _down() {
    const b = this.b
    b.falling = true
    b.vy = 0
    hidePill('blimp')
    this.s._message(t('blimpDown'), 4)
    try { audioEngine.playSpecial?.('whoosh') } catch { /* no audio */ }
  }

  // Tipping nose-first and dropping until it hits the ground.
  _fall(dt) {
    const s = this.s
    const b = this.b
    const B = this.B
    b.vy = Math.min(b.vy + 9 * dt, 22)
    b.y -= b.vy * dt
    const heading = this.group.rotation.y
    b.x += Math.sin(heading) * 3 * dt
    b.z += Math.cos(heading) * 3 * dt
    this.group.rotation.x = Math.min(0.9, this.group.rotation.x + dt * 0.5)
    this.group.position.set(b.x * B, b.y * B, b.z * B)
    const ground = s._groundUnder(b.x, b.y + 4, b.z)
    if (b.y - 2 > ground) return true
    this._crash(b.x, Number.isFinite(ground) ? ground : b.y, b.z)
    return false
  }

  _crash(x, y, z) {
    const s = this.s
    const B = this.B
    try { audioEngine.playExplosion?.() } catch { /* no audio */ }
    s._fx?.explode?.(new THREE.Vector3(x * B, (y + 1) * B, z * B), 5)
    s._fx?.confetti?.(x * B, (y + 2) * B, z * B)
    for (const id of LOOT) s._drops?.spawnItem(id, x + (Math.random() - 0.5) * 4, y + 1.2, z + (Math.random() - 0.5) * 4)
    const find = s.finds?.pick?.()
    if (find) s._drops?.spawnItem(find, x, y + 1.4, z)
    s._earn(BLIMP_COINS)
    s._renderHud?.()
    s._message(t('blimpCrashed', { n: Math.round(BLIMP_COINS * (s.cfg?.coinMult ?? 1)) }), 5)
    s.bingo?.note('blimp')
    this._removeBlimp()
  }

  // A zombie on a parachute from (x, y, z).
  _dropChute(x, y, z) {
    const B = this.B
    const g = new THREE.Group()
    const colors = [0xd8352a, 0xf2f0ea, 0xffd23f, 0x5aa7d8]
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.4 * B, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: colors[Math.floor(Math.random() * colors.length)], side: THREE.DoubleSide }))
    canopy.position.y = 3.3 * B
    g.add(canopy)
    const line = new THREE.MeshLambertMaterial({ color: 0xdddddd })
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.03 * B, 1.6 * B, 0.03 * B), line)
      l.position.set(sx * 0.6 * B, 2.6 * B, sz * 0.6 * B)
      l.rotation.set(sz * 0.4, 0, -sx * 0.4)
      g.add(l)
    }
    // A blocky zombie hanging under it, 2 blocks tall, arms up.
    const green = new THREE.MeshLambertMaterial({ color: 0x4f8a3a })
    const shirt = new THREE.MeshLambertMaterial({ color: 0x3d6f8f })
    const legs = new THREE.MeshLambertMaterial({ color: 0x3b3550 })
    const part = (w, h, d, mat, px, py, pz) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), mat)
      m.position.set(px * B, py * B, pz * B)
      g.add(m)
      return m
    }
    part(0.5, 0.75, 0.25, legs, 0, 0.375, 0)
    part(0.5, 0.75, 0.25, shirt, 0, 1.125, 0)
    part(0.5, 0.5, 0.5, green, 0, 1.75, 0)
    part(0.22, 0.75, 0.22, green, -0.36, 1.7, 0)
    part(0.22, 0.75, 0.22, green, 0.36, 1.7, 0)
    this.s.bm.scene.add(g)
    this.chutes.push({ x, y, z, g, sway: Math.random() * 6 })
  }

  _updateChutes(dt) {
    const s = this.s
    const B = this.B
    for (const c of this.chutes) {
      c.y -= CHUTE_FALL * dt
      c.sway += dt
      const ground = s._groundUnder(c.x, c.y + 1, c.z)
      if (c.y <= ground) {
        c.landed = true
        s._extraZombie(c.x, Number.isFinite(ground) ? ground : c.y, c.z)
        continue
      }
      c.g.position.set((c.x + Math.sin(c.sway) * 0.4) * B, c.y * B, c.z * B)
      c.g.rotation.z = Math.sin(c.sway * 1.3) * 0.12
    }
    for (const c of this.chutes.filter((o) => o.landed)) disposeGroup(c.g)
    this.chutes = this.chutes.filter((o) => !o.landed)
  }

  _removeBlimp() {
    disposeGroup(this.group)
    this.group = null
    this.b = null
    hidePill('blimp')
  }

  // land: zombies still in the air come down now (the event ended).
  clear(land = false) {
    this._removeBlimp()
    for (const c of this.chutes) {
      if (land && this.s.active) this.s._extraZombie(c.x, this.s._groundUnder(c.x, c.y + 1, c.z), c.z)
      disposeGroup(c.g)
    }
    this.chutes = []
  }
}

function disposeGroup(g) {
  if (!g) return
  g.removeFromParent()
  g.traverse((o) => {
    if (!o.isMesh && !o.isSprite) return
    o.geometry?.dispose?.()
    o.material.map?.dispose?.()
    o.material.dispose()
  })
}
