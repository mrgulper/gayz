// The Dragon (2026-11-02, Gaymi's idea list 6: "a flying blocky dragon
// that circles a mountain lair and breathes fire, with a hoard to win").
// Owned by BuildSurvival (`s.dragon`); a world event (WorldEvents
// 'dragon') from wave FROM_WAVE, on every map.
//
// The highest ground LAIR_NEAR..LAIR_FAR blocks from you becomes its lair:
// a ring of dark rock and obsidian spikes round a pile of gold with a loot
// chest on top (real blocks, TempBlocks.js). A blocky dragon (meshes, never
// a light) circles above it, flapping. While you're within ATTACK_R
// blocks it breathes a fireball at you every FIRE_EVERY seconds (FIRE_DMG
// if it hits; dodge it). Shoot it down: DRAGON_HP health, shown in a boss
// bar. Slay it and its hoard is yours: HOARD_COINS coins and HOARD_GEMS
// gems, and the chest's loot. After DRAGON_LIFE seconds an unbeaten dragon
// flies away. On a server the host runs it and everyone sees it
// (2026-11-09): the others get a copy that follows the host's (snapshot()
// -> applySnapshot(), lair and all), it breathes fire at each of them
// too, their shots hurt the real one (a hit `x1` to the host,
// remoteHit()) and everyone there gets the hoard when it falls.
import { noteBoss } from './CampMuseum.js'
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { TempBlocks } from './TempBlocks.js'
import { saveShopProgress } from './Game.js'

export const FROM_WAVE = 3
export const DRAGON_HP = 1500
export const FIRE_EVERY = 2.6
export const FIRE_DMG = 14
export const ATTACK_R = 45
export const HOARD_COINS = 300
export const HOARD_GEMS = 3
export const DRAGON_LIFE = 360
const LAIR_NEAR = 30
const LAIR_FAR = 50
const LAIR_R = 5
const CIRCLE_R = 14
const FLY_UP = 12
const FIRE_SPEED = 16
const FIRE_HIT = 1.4
const HIT_R = 2.4

export class DragonBoss {
  constructor(survival) {
    this.s = survival
    this.cells = new TempBlocks(survival)
    this.d = null
    this.fireballs = []
  }

  get B() {
    return this.s.B
  }

  possible() {
    const s = this.s
    return !this.d && s.wave >= FROM_WAVE && !s.td && !s.escape && !s.party && !s.moon?.on
  }

  // The world event: the dragon comes. -> a run, or null. `at`: its lair
  // there (tests), not on the highest ground round you.
  event(me, at = null) {
    if (!this.possible()) return null
    const s = this.s
    // The highest ground of a few spots round you.
    // (Further out if the camp is in the way all round.)
    let lair = at
    for (let i = 0; i < 28 && !at && !(lair && i >= 14); i++) {
      const a = (i / 14) * Math.PI * 2
      const dist = (LAIR_NEAR + Math.random() * (LAIR_FAR - LAIR_NEAR)) * (i < 14 ? 1 : 1.8)
      const x = Math.floor(me.x + Math.cos(a) * dist)
      const z = Math.floor(me.z + Math.sin(a) * dist)
      if (s.camp?.inside?.(x + 0.5, z + 0.5, LAIR_R + 2)) continue
      const y = s._groundUnder(x + 0.5, me.y + 60, z + 0.5)
      if (y === me.y + 60) continue
      if (!lair || y > lair.y) lair = { x, y, z }
    }
    if (!lair) return null
    this._lair(lair)
    this.d = { lair, hp: DRAGON_HP, a: Math.random() * Math.PI * 2, x: lair.x, y: lair.y + FLY_UP, z: lair.z, fireIn: 3, left: DRAGON_LIFE, dying: 0, flash: 0, t: 0 }
    this._mesh()
    this._bar(true)
    s._message(t('dragonAppears'), 6)
    try { audioEngine.playSpecial?.('shout') } catch { /* no audio */ }
    return { update: (dt) => this._update(dt), dispose: () => this.clear() }
  }

  // --- on a server ---

  // The host's dragon for the others (PlayNet, `dragon`).
  snapshot() {
    const d = this.d
    if (!d || this.mirror) return null
    return { lx: d.lair.x, ly: d.lair.y, lz: d.lair.z, a: +d.a.toFixed(3), hp: Math.max(0, Math.round(d.hp)), dy: d.dying ? 1 : 0 }
  }

  // Everyone else: a copy of the host's (null: it's gone).
  applySnapshot(n) {
    if (!n) {
      if (this.mirror && this.d && !this.d.dying) this.clear()
      return
    }
    if (this.d && !this.mirror) return
    if (!this.d) {
      const lair = { x: n.lx, y: n.ly, z: n.lz }
      this._lair(lair)
      this.mirror = true
      this.d = { lair, hp: n.hp, a: n.a, x: lair.x, y: lair.y + FLY_UP, z: lair.z, fireIn: 3, left: DRAGON_LIFE, dying: 0, flash: 0, t: 0 }
      this._mesh()
      this._bar(true)
      this.s._message(t('dragonAppears'), 6)
      try { audioEngine.playSpecial?.('shout') } catch { /* no audio */ }
    }
    const d = this.d
    d.netA = n.a
    if (!d.dying) d.hp = Math.min(d.hp, n.hp)
    if (n.dy && !d.dying) this._slain()
  }

  // A mirror's frame (BuildSurvival.update - the host's runs as an event).
  mirrorUpdate(dt) {
    if (!this.mirror || !this.d) return
    // The host left and it's me now: this copy goes (the events start over).
    if (this.s.net?.isHost || !this._update(dt)) this.clear()
  }

  // Another player's shot (host only).
  remoteHit(h) {
    const d = this.d
    if (!d || d.dying || this.mirror) return
    d.hp -= Number(h.dmg) || 0
    d.flash = 0.12
    if (d.hp <= 0) this._slain()
  }

  // The lair: dark rock, obsidian spikes, a gold pile, the hoard chest.
  _lair({ x: cx, y: gy, z: cz }) {
    const put = (x, y, z, type) => this.cells.put(cx + x, gy + y, cz + z, type)
    for (let x = -LAIR_R; x <= LAIR_R; x++) {
      for (let z = -LAIR_R; z <= LAIR_R; z++) {
        const d = Math.hypot(x, z)
        if (d > LAIR_R + 0.5) continue
        put(x, 0, z, (x * 7 + z * 3) % 3 ? 'blackstone' : 'netherrack')
        if (d > LAIR_R - 0.6 && (x + z) % 3 === 0) for (let y = 1; y <= 2 + ((x * z) & 1); y++) put(x, y, z, 'obsidian')
        if (d < 2.2) put(x, 1, z, 'gold')
      }
    }
    put(0, 2, 0, 'lootchest')
  }

  _mesh() {
    const B = this.B
    const g = new THREE.Group()
    const scale = new THREE.Group()
    g.add(scale)
    this._mats = []
    const mat = (color) => {
      const m = new THREE.MeshLambertMaterial({ color })
      this._mats.push(m)
      return m
    }
    const red = mat(0x8a1e1a)
    const dark = mat(0x4a0f0c)
    const belly = mat(0xd8a050)
    const box = (w, h, d, m, x, y, z, parent = scale) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), m)
      mesh.position.set(x * B, y * B, z * B)
      parent.add(mesh)
      return mesh
    }
    // Facing +z: body, belly, neck, head with jaw and horns, tail.
    box(2, 1.6, 4, red, 0, 0, 0)
    box(1.6, 0.3, 3.4, belly, 0, -0.8, 0)
    box(1, 1, 1.6, red, 0, 0.6, 2.6)
    const head = box(1.4, 1.1, 1.8, red, 0, 1, 3.9)
    box(1.2, 0.35, 1.4, dark, 0, -0.55, 0.3, head)
    for (const x of [-0.45, 0.45]) {
      box(0.2, 0.2, 0.05, new THREE.MeshBasicMaterial({ color: 0xffd23f }), x, 0.2, 0.92, head)
      box(0.2, 0.7, 0.2, dark, x, 0.8, -0.6, head).rotation.x = -0.5
    }
    box(1.2, 1, 2, red, 0, -0.1, -3)
    box(0.7, 0.6, 2, red, 0, -0.2, -4.9)
    box(0.4, 0.4, 1.6, dark, 0, -0.3, -6.6)
    // Back spikes.
    for (let z = -1.5; z <= 1.5; z += 1) box(0.25, 0.6, 0.3, dark, 0, 1.05, z)
    // Wings on pivots, so they flap.
    this._wings = []
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group()
      pivot.position.set(side * 1 * B, 0.6 * B, 0.4 * B)
      box(4.5, 0.15, 3, dark, side * 2.25, 0, 0, pivot)
      box(0.3, 0.3, 3.2, red, side * 0.15, 0.1, 0, pivot)
      scale.add(pivot)
      this._wings.push({ pivot, side })
    }
    this._head = head
    this._group = g
    this.s.bm.scene.add(g)
  }

  // The boss bar at the top of the screen.
  _bar(on) {
    let el = this._barEl
    if (!el && on) {
      el = this._barEl = document.createElement('div')
      el.id = 'dragon-bar'
      const name = document.createElement('span')
      name.className = 'dragon-name'
      const track = document.createElement('div')
      track.className = 'dragon-track'
      track.appendChild(document.createElement('i'))
      el.append(name, track)
      document.body.appendChild(el)
    }
    if (!el) return
    el.style.display = on ? 'flex' : 'none'
    if (!on || !this.d) return
    el.firstChild.textContent = t('dragonName')
    el.querySelector('i').style.width = `${Math.max(0, (this.d.hp / DRAGON_HP) * 100)}%`
  }

  _update(dt) {
    const d = this.d
    if (!d) return false
    const s = this.s
    const B = this.B
    d.t += dt
    if (d.dying) {
      // Down it goes, spinning.
      d.dying += dt
      d.y -= dt * 9
      this._group.rotation.z += dt * 3
      this._group.position.set(d.x * B, d.y * B, d.z * B)
      this._fire(dt)
      if (d.dying > 2.4) {
        this._group.visible = false
        this._bar(false)
      }
      return d.dying < 30
    }
    if (!this.mirror) d.left -= dt
    // Round and round the lair (a copy eases after the host's).
    d.a += dt * 0.32
    if (this.mirror && d.netA !== undefined) {
      const gap = Math.atan2(Math.sin(d.netA - d.a), Math.cos(d.netA - d.a))
      d.a += gap * Math.min(1, dt * 3)
      d.netA += dt * 0.32
    }
    d.x = d.lair.x + 0.5 + Math.cos(d.a) * CIRCLE_R
    d.z = d.lair.z + 0.5 + Math.sin(d.a) * CIRCLE_R
    d.y = d.lair.y + FLY_UP + Math.sin(d.t * 0.8) * 1.5
    this._group.position.set(d.x * B, d.y * B, d.z * B)
    this._group.rotation.set(0, Math.atan2(-Math.sin(d.a), Math.cos(d.a)), 0)
    for (const w of this._wings) w.pivot.rotation.z = w.side * Math.sin(d.t * 4) * 0.5
    d.flash = Math.max(0, d.flash - dt)
    for (const m of this._mats) m.emissive?.setHex(d.flash > 0 ? 0x6a1a00 : 0)
    // Fire at you.
    const me = s.bodyPos()
    d.fireIn -= dt
    if (d.fireIn <= 0 && !s.dead && Math.hypot(me.x - d.x, me.z - d.z) < ATTACK_R) {
      d.fireIn = FIRE_EVERY
      this._breathe(me)
    }
    this._fire(dt)
    this._bar(true)
    if (d.left <= 0) {
      s._message(t('dragonLeaves'), 4)
      return false
    }
    return true
  }

  _breathe(me) {
    const B = this.B
    const head = this._head.getWorldPosition(new THREE.Vector3()).divideScalar(B)
    const to = new THREE.Vector3(me.x, me.y + 1, me.z).sub(head).normalize().multiplyScalar(FIRE_SPEED)
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8 * B, 0.8 * B, 0.8 * B), new THREE.MeshBasicMaterial({ color: 0xff7a1a }))
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.45 * B, 0.45 * B, 0.45 * B), new THREE.MeshBasicMaterial({ color: 0xffee55 }))
    mesh.add(core)
    this.s.bm.scene.add(mesh)
    this.fireballs.push({ p: head, v: to, mesh, left: 4 })
    try { audioEngine.playSpecial?.('whoosh') } catch { /* no audio */ }
  }

  _fire(dt) {
    const s = this.s
    const B = this.B
    const me = s.bodyPos()
    for (const f of this.fireballs) {
      f.left -= dt
      f.p.addScaledVector(f.v, dt)
      f.mesh.position.set(f.p.x * B, f.p.y * B, f.p.z * B)
      f.mesh.rotation.x += dt * 8
      f.mesh.rotation.y += dt * 6
      const hit = !s.dead && Math.hypot(f.p.x - me.x, f.p.z - me.z) < FIRE_HIT && f.p.y > me.y - 0.3 && f.p.y < me.y + 2.2
      const solid = s._solid(Math.floor(f.p.x), Math.floor(f.p.y), Math.floor(f.p.z))
      if (hit) s._hurtPlayer(FIRE_DMG)
      if (hit || solid) {
        f.left = 0
        s._fx?.confetti?.(f.p.x * B, f.p.y * B, f.p.z * B)
      }
    }
    for (const f of this.fireballs.filter((x) => x.left <= 0)) {
      f.mesh.removeFromParent()
      f.mesh.traverse((o) => {
        if (!o.isMesh) return
        o.geometry.dispose()
        o.material.dispose()
      })
    }
    this.fireballs = this.fireballs.filter((x) => x.left > 0)
  }

  // A shot (BuildSurvival.shoot): did it hit the dragon? -> true if so.
  shoot(ray, reach, damage) {
    const d = this.d
    if (!d || d.dying) return false
    const B = this.B
    // Its body and its head, as two balls.
    const head = this._head.getWorldPosition(new THREE.Vector3())
    const body = new THREE.Vector3(d.x * B, d.y * B, d.z * B)
    const hits = [body, head].map((c, i) => {
      const sphere = new THREE.Sphere(c, (i ? 1.2 : HIT_R) * B)
      const p = ray.intersectSphere(sphere, new THREE.Vector3())
      return p ? p.distanceTo(ray.origin) : Infinity
    })
    const dist = Math.min(...hits)
    if (dist > reach) return false
    // A head shot hurts twice as much.
    const amount = damage * (hits[1] <= hits[0] ? 2 : 1)
    d.hp -= amount
    d.flash = 0.12
    this.s.damageNumbers?.show(d.x, d.y + 2, d.z, amount)
    // A copy: the host's dragon takes the hit (it falls when the host's does).
    if (this.mirror) {
      this.s.net?.queueHit?.('x1', amount)
      return true
    }
    if (d.hp <= 0) this._slain()
    return true
  }

  _slain() {
    const s = this.s
    const d = this.d
    d.dying = 0.01
    s.coins = (s.coins || 0) + HOARD_COINS
    s._renderHud?.()
    const game = s.bm.game
    if (game) {
      game.gems = (game.gems || 0) + HOARD_GEMS
      saveShopProgress(game)
      game._renderCurrencyBar?.()
    }
    s.bosses = (s.bosses || 0) + 1
    // The Museum's Hall of Bosses (CampMuseum.js).
    noteBoss('dragon')
    s._message(t('dragonSlain', { c: HOARD_COINS, g: HOARD_GEMS }), 6)
    try { audioEngine.playSpecial?.('firework') } catch { /* no audio */ }
    s._fx?.confetti?.(d.x * this.B, d.y * this.B, d.z * this.B)
  }

  clear() {
    this.cells.restore()
    for (const f of this.fireballs) f.left = 0
    this._fire(0)
    this._group?.removeFromParent()
    this._group?.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.dispose()
      o.material.dispose()
    })
    this._group = null
    this._bar(false)
    this.d = null
    this.mirror = false
  }
}
