// Bungee Jump (2026-11-09, Gaymi's idea list 10: "you jump off bridges or
// the lighthouse, grab loot from the zombie-filled ground at the bottom,
// and spring back up before they catch you"). Owned by BuildSurvival
// (`s.bungee`).
//
// Craft a Bungee Cord (or find one), hold it at a high edge - a bridge,
// the lighthouse, a cliff, a rooftop: at least MIN_DROP blocks above the
// ground just in front of you - and use it to clip on. A glowing loot bag
// appears on the ground below with GUARDS zombies round it. Step off: the
// cord catches you just above the ground and you hang there for HANG_S
// seconds - get within GRAB_R blocks of the bag to grab it (BAG_COINS
// coins and BAG_ITEMS things) - then it springs you back up to where you
// jumped (UP_S seconds). Walk more than WANDER_R blocks off without
// jumping and it unclips. A spot already looted (within LOOTED_R) gives no
// bag again this run, but the zombies still come. Never used up.
//
// Each player's own. Meshes only, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { itemName } from './PlayInventory.js'

export const MIN_DROP = 10
export const HANG_S = 1.6
export const UP_S = 1.1
export const GRAB_R = 2.5
export const BAG_COINS = 60
export const BAG_ITEMS = 2
export const GUARDS = 3
const WANDER_R = 3
const LOOTED_R = 6
const LOOT = ['healthpack', 'ammobox', 'zombieGoo', 'mapPiece', 'potionSpeed']
const HANG_ABOVE = 0.4

export class Bungee {
  constructor(survival) {
    this.s = survival
    this.state = '' // '' | 'clipped' | 'fall' | 'hang' | 'up'
    this.anchor = null
    this.bag = null
    this.looted = []
  }

  get B() {
    return this.s.B
  }

  // The ground's top just in front of you, and how far down it is.
  _below() {
    const s = this.s
    const tm = s.bm.tryMode
    const p = tm.pos
    const yaw = s.bm._yaw
    let best = null
    for (const d of [1, 1.5, 2, 2.5]) {
      const x = p.x - Math.sin(yaw) * d
      const z = p.z - Math.cos(yaw) * d
      const g = s._groundUnder(x, p.y + 0.5, z)
      if (!Number.isFinite(g)) continue
      const drop = p.y - g
      if (!best || drop > best.drop) best = { x, y: g, z, drop }
    }
    return best
  }

  // Used (PlayInventory.useHeld): clip on, or unclip.
  use() {
    const s = this.s
    if (!s.active || s.dead || s.spectating) return
    if (this.state === 'clipped') return this._unclip('bungeeOff')
    if (this.state) return
    if (!s.bm.tryMode.onGround) return
    const below = this._below()
    if (!below || below.drop < MIN_DROP) {
      s._message(t('bungeeNeedEdge', { n: MIN_DROP }), 3)
      return
    }
    const p = s.bm.tryMode.pos
    this.anchor = { x: p.x, y: p.y, z: p.z }
    this.state = 'clipped'
    this.bottom = below
    const fresh = !this.looted.some((o) => Math.hypot(o.x - below.x, o.z - below.z) < LOOTED_R)
    if (fresh) this._bag(below)
    if (!s.cfg?.noZombies && (!s.net || s.net.isHost)) {
      for (let i = 0; i < GUARDS; i++) {
        const a = Math.random() * Math.PI * 2
        const d = 3 + Math.random() * 3
        const x = below.x + Math.cos(a) * d
        const z = below.z + Math.sin(a) * d
        const y = s._groundUnder(x, below.y + 3, z)
        if (Number.isFinite(y) && Math.abs(y - below.y) < 3) s._extraZombie(x, y, z)
      }
    }
    this._cord(true)
    s._message(t(fresh ? 'bungeeOn' : 'bungeeOnLooted'), 4)
    try { audioEngine.playSpecial?.('clank') } catch { /* no audio */ }
  }

  _bag(at) {
    const B = this.B
    const g = new THREE.Group()
    const sack = new THREE.Mesh(new THREE.BoxGeometry(0.7 * B, 0.7 * B, 0.7 * B), new THREE.MeshLambertMaterial({ color: 0xc9a46a, emissive: 0x6a4a10 }))
    sack.position.y = 0.35 * B
    g.add(sack)
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.3 * B, 0.2 * B, 0.3 * B), new THREE.MeshLambertMaterial({ color: 0x8a5a32 }))
    tie.position.y = 0.8 * B
    g.add(tie)
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * B, 0.3 * B, 8 * B, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }))
    beam.position.y = 4 * B
    g.add(beam)
    g.position.set(at.x * B, at.y * B, at.z * B)
    this.s.bm.scene.add(g)
    this.bag = { x: at.x, y: at.y, z: at.z, g }
  }

  _cord(on) {
    if (!on) {
      disposeGroup(this.cordMesh)
      this.cordMesh = null
      return
    }
    if (this.cordMesh) return
    const B = this.B
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.06 * B, 1, 0.06 * B), new THREE.MeshLambertMaterial({ color: 0x3fae5a }))
    this.s.bm.scene.add(m)
    this.cordMesh = m
  }

  update(dt) {
    const s = this.s
    if (!this.state) return
    if (!s.active || s.dead || s.spectating || s.vehicles?.riding) return this._unclip()
    const tm = s.bm.tryMode
    const p = tm.pos
    const a = this.anchor
    if (this.state === 'clipped') {
      // Walked off along the top instead of jumping.
      if (Math.hypot(p.x - a.x, p.z - a.z) > WANDER_R && p.y >= a.y - 1) return this._unclip('bungeeOff')
      if (p.y < a.y - 1.5) {
        this.state = 'fall'
        try { audioEngine.playSpecial?.('whoosh') } catch { /* no audio */ }
      }
    }
    if (this.state === 'fall') {
      const ground = s._groundUnder(p.x, p.y + 0.5, p.z)
      // The cord catches you just above the ground.
      if (!Number.isFinite(ground) || p.y - ground <= HANG_ABOVE + 1.2 || (tm.onGround && p.y - ground < 3)) {
        this.state = 'hang'
        this.t = HANG_S
        this.hangAt = { x: p.x, y: (Number.isFinite(ground) ? ground : p.y) + HANG_ABOVE, z: p.z }
        try { audioEngine.playSpecial?.('twang') } catch { /* no audio */ }
      }
    }
    if (this.state === 'hang') {
      this.t -= dt
      const bob = Math.sin((HANG_S - this.t) * 9) * 0.15 * (this.t / HANG_S)
      p.set(this.hangAt.x, this.hangAt.y + bob, this.hangAt.z)
      tm.vel?.set(0, 0, 0)
      this._grab()
      if (this.t <= 0) {
        this.state = 'up'
        this.t = 0
        this.from = { x: p.x, y: p.y, z: p.z }
      }
    }
    if (this.state === 'up') {
      this.t += dt
      const f = Math.min(1, this.t / UP_S)
      const e = 1 - Math.pow(1 - f, 3)
      p.set(this.from.x + (a.x - this.from.x) * e, this.from.y + (a.y + 0.3 - this.from.y) * e, this.from.z + (a.z - this.from.z) * e)
      tm.vel?.set(0, 0, 0)
      if (f >= 1) {
        p.set(a.x, a.y + 0.05, a.z)
        this._unclip('bungeeBack')
        return
      }
    }
    this._drawCord()
    if (this.bag) this.bag.g.rotation.y += dt * 1.5
  }

  _grab() {
    const s = this.s
    const bag = this.bag
    if (!bag) return
    const me = s.bodyPos()
    if (Math.hypot(me.x - bag.x, me.z - bag.z) > GRAB_R) return
    const got = []
    for (let i = 0; i < BAG_ITEMS; i++) {
      const id = LOOT[Math.floor(Math.random() * LOOT.length)]
      if (s.inv.add({ kind: 'item', id, n: 1 }) > 0) s._drops?.spawnItem(id, bag.x, bag.y + 1, bag.z)
      got.push(itemName(id))
    }
    s._earn(BAG_COINS)
    s._renderHud?.()
    s._message(t('bungeeGrab', { n: Math.round(BAG_COINS * (s.cfg?.coinMult ?? 1)), items: got.join(', ') }), 3)
    try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
    s.bingo?.note('bungee')
    this.looted.push({ x: bag.x, z: bag.z })
    disposeGroup(bag.g)
    this.bag = null
  }

  _drawCord() {
    const m = this.cordMesh
    if (!m) return
    const B = this.B
    const a = this.anchor
    const p = this.s.bm.tryMode.pos
    const top = new THREE.Vector3(a.x * B, (a.y + 0.2) * B, a.z * B)
    const end = new THREE.Vector3(p.x * B, (p.y + 1) * B, p.z * B)
    const len = Math.max(0.01, top.distanceTo(end))
    m.position.copy(top).add(end).multiplyScalar(0.5)
    m.scale.set(1, len, 1)
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(top).normalize())
  }

  _unclip(key = '') {
    if (key) this.s._message(t(key), 2.5)
    this.state = ''
    this.anchor = null
    this._cord(false)
    if (this.bag) {
      disposeGroup(this.bag.g)
      this.bag = null
    }
  }

  clear() {
    this._unclip()
    this.looted = []
  }
}

function disposeGroup(g) {
  if (!g) return
  g.removeFromParent()
  g.traverse((o) => {
    if (!o.isMesh) return
    o.geometry.dispose()
    o.material.dispose()
  })
}
