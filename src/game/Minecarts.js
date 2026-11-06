// Minecarts (2026-11-02, Gaymi's idea list 6: "rails through caves and
// underground cities that you ride at speed, with zombies hopping on").
// Owned by BuildSurvival (`s.carts`), on every map.
//
// While you're underground (land over your head), every CHECK_S seconds,
// if there's no track within GAP blocks, an old mine line is found running
// straight ahead of you, LEN_MIN..LEN blocks through the rock, caves and
// underground cities: a tunnel three wide and three high, a stone-brick bed
// and rails, with a minecart at the near end. At most MAX_TRACKS a game.
//
// Walk into the cart to hop in: it rolls to the other end at CART_SPEED
// (you can look round and shoot, nothing else) and you hop out there;
// walk in again to ride back. Every HOP_EVERY seconds of a ride a zombie
// jumps onto the back of the cart (not part of the wave; only where the
// game runs) and bites (BITE) every BITE_EVERY until you shoot it off.
// Reach the end for CART_COINS coins. The tunnels go back to rock when the
// game ends (TempBlocks.js). Meshes only (rails, cart), never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { TempBlocks } from './TempBlocks.js'

export const MAX_TRACKS = 4
const CHECK_S = 3
export const GAP = 50
export const LEN = 60
const LEN_MIN = 18
export const CART_SPEED = 13
export const HOP_EVERY = 3
export const BITE = 5
const BITE_EVERY = 1.3
export const CART_COINS = 12
const ROOF = 4 // land this many blocks over your head = underground

export class Minecarts {
  constructor(survival) {
    this.s = survival
    this.cells = new TempBlocks(survival)
    this.tracks = []
    this.riding = null
    this.riders = []
    this._in = 1
    this._group = null
  }

  get B() {
    return this.s.B
  }

  _scene() {
    if (!this._group) {
      this._group = new THREE.Group()
      this.s.bm.scene.add(this._group)
    }
    return this._group
  }

  // Land well over (x, y, z)'s head: underground.
  _roofed(x, y, z) {
    const top = this.s._groundUnder(x, y + 60, z)
    return top > y + ROOF
  }

  // Before the zombies move (BuildSurvival.update): find tracks, hop in.
  update(dt) {
    const s = this.s
    if (!s.active || s.td || s.escape || s.party || s.spectating) return
    if (this.riding) return
    const me = s.bodyPos()
    // Hop in: walk into a cart.
    if (!s.dead && !s._ride) {
      for (const tr of this.tracks) {
        const c = this._cartPos(tr)
        const d = Math.hypot(me.x - c.x, me.z - c.z)
        // A new track's cart is where you stand: step away first.
        if (d > 2) tr.armed = true
        if (tr.armed && d < 1.1 && Math.abs(me.y - c.y) < 1.5) return this._hopIn(tr)
      }
    }
    if (this.tracks.length >= MAX_TRACKS || s.dead) return
    this._in -= dt
    if (this._in > 0) return
    this._in = CHECK_S
    if (!this._roofed(me.x, me.y, me.z) || this.tracks.some((tr) => Math.hypot(tr.mid.x - me.x, tr.mid.z - me.z) < GAP)) return
    // Straight ahead, along x or z.
    const yaw = s.bm._yaw
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    const dir = Math.abs(fx) > Math.abs(fz) ? [Math.sign(fx), 0] : [0, Math.sign(fz)]
    this.lay(Math.floor(me.x), Math.floor(me.y + 0.01), Math.floor(me.z), dir)
  }

  // A track from (x0, y, z0) going `dir` ([dx, dz]). -> the track, or null.
  lay(x0, y, z0, [dx, dz]) {
    const s = this.s
    const bm = s.bm
    // How far it can go: through rock and caves, not into water, lava or the open air.
    let len = 0
    for (let k = 1; k <= LEN; k++) {
      const x = x0 + dx * k
      const z = z0 + dz * k
      let wet = false
      for (let h = -1; h <= 2; h++) for (let w = -1; w <= 1; w++) {
        const b = bm.getBlockAt(x + dz * w, y + h, z + dx * w)
        if (b === 'water' || b === 'lava') wet = true
      }
      if (wet || !this._roofed(x + 0.5, y, z + 0.5) || s.camp?.inside?.(x + 0.5, z + 0.5, 2)) break
      len = k
    }
    if (len < LEN_MIN) return null
    const sx = dz
    const sz = dx
    for (let k = 0; k <= len; k++) {
      const x = x0 + dx * k
      const z = z0 + dz * k
      for (let w = -1; w <= 1; w++) {
        const cx = x + sx * w
        const cz = z + sz * w
        this.cells.put(cx, y - 1, cz, w ? 'cobblestone' : 'stonebricks')
        for (let h = 0; h <= 2; h++) this.cells.clear(cx, y + h, cz)
      }
    }
    const tr = {
      x0: x0 + 0.5, z0: z0 + 0.5, y, dx, dz, len,
      at: 0, // the cart: 0 at the start, len at the far end
      mid: { x: x0 + 0.5 + (dx * len) / 2, z: z0 + 0.5 + (dz * len) / 2 },
    }
    this._meshes(tr)
    this.tracks.push(tr)
    s._message(t('cartFound'), 4)
    return tr
  }

  _cartPos(tr) {
    return { x: tr.x0 + tr.dx * tr.at, y: tr.y, z: tr.z0 + tr.dz * tr.at }
  }

  _meshes(tr) {
    const B = this.B
    const g = new THREE.Group()
    const metal = new THREE.MeshLambertMaterial({ color: 0x9a9aa2 })
    const wood = new THREE.MeshLambertMaterial({ color: 0x6b4423 })
    for (const side of [-0.32, 0.32]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry((tr.len + 1) * B, 0.06 * B, 0.08 * B), metal)
      r.position.set((tr.len / 2) * B, 0.05 * B, side * B)
      g.add(r)
    }
    const sleeper = new THREE.BoxGeometry(0.2 * B, 0.04 * B, 0.95 * B)
    for (let k = 0; k <= tr.len; k++) {
      const m = new THREE.Mesh(sleeper, wood)
      m.position.set(k * B, 0.02 * B, 0)
      g.add(m)
    }
    // Laid along +x, then turned to the track's way.
    g.position.set(tr.x0 * B, tr.y * B, tr.z0 * B)
    g.rotation.y = Math.atan2(-tr.dz, tr.dx)
    this._scene().add(g)
    tr.rails = g
    tr.cart = makeCart(B)
    this._scene().add(tr.cart)
    this._drawCart(tr)
  }

  _drawCart(tr) {
    const B = this.B
    const p = this._cartPos(tr)
    tr.cart.position.set(p.x * B, p.y * B, p.z * B)
    tr.cart.rotation.y = Math.atan2(tr.dx, tr.dz)
  }

  _hopIn(tr) {
    const s = this.s
    // From the near end it goes to the far one, and back again.
    this.riding = { tr, to: tr.at < tr.len / 2 ? tr.len : 0, v: 0, hop: HOP_EVERY }
    s._message(t('cartIn'), 2.5)
    try { audioEngine.playSpecial?.('clank') } catch { /* no audio */ }
  }

  // After the zombies move (BuildSurvival.update): the ride, and the
  // zombies on the cart stay on it.
  ride(dt) {
    const r = this.riding
    const s = this.s
    this.riders = this.riders.filter((zb) => zb.health > 0 && s.zombies.includes(zb))
    if (!r) return
    const tr = r.tr
    if (s.dead || !s.active) return this._hopOut(false)
    r.v = Math.min(CART_SPEED, r.v + 10 * dt)
    const sign = Math.sign(r.to - tr.at)
    tr.at += sign * Math.min(Math.abs(r.to - tr.at), r.v * dt)
    this._drawCart(tr)
    const p = this._cartPos(tr)
    s._ride = { x: p.x, y: p.y + 0.35, z: p.z, eye: 1.25 }
    // Zombies jump on the back.
    if (!s.net || s.net.isHost) {
      r.hop -= dt
      if (r.hop <= 0 && this.riders.length < 3) {
        r.hop = HOP_EVERY
        const zb = s._extraZombie?.(p.x - tr.dx * sign, p.y, p.z - tr.dz * sign)
        if (zb) this.riders.push(zb)
      }
    }
    this.riders.forEach((zb, i) => {
      const back = 0.9 + i * 0.5
      zb.x = p.x - tr.dx * sign * back
      zb.y = p.y + 0.35
      zb.z = p.z - tr.dz * sign * back
      zb.vx = zb.vy = zb.vz = 0
      zb.frozen = Math.max(zb.frozen || 0, 0.2)
      if (zb.group) {
        zb.group.position.set(zb.x * this.B, zb.y * this.B, zb.z * this.B)
        zb.group.rotation.y = Math.atan2(tr.dx * sign, tr.dz * sign)
      }
      zb.cartBite = (zb.cartBite ?? BITE_EVERY) - dt
      if (zb.cartBite <= 0) {
        zb.cartBite = BITE_EVERY
        // A ride keeps you safe from everything else - not from these.
        const seat = s._ride
        s._ride = null
        s._hurtPlayer(BITE)
        s._ride = seat
      }
    })
    if (tr.at === r.to) this._hopOut(true)
  }

  _hopOut(arrived) {
    const s = this.s
    const r = this.riding
    this.riding = null
    s._ride = null
    for (const zb of this.riders) zb.frozen = 0
    this.riders = []
    if (!r) return
    const p = this._cartPos(r.tr)
    // Off at the end, a step past the cart.
    const tm = s.bm.tryMode
    const ox = r.tr.dz ? 1 : 0
    const oz = r.tr.dx ? 1 : 0
    tm.pos.set(p.x + ox * 1, p.y, p.z + oz * 1)
    tm.vel?.set(0, 0, 0)
    if (!arrived) return
    s.coins = (s.coins || 0) + CART_COINS
    s._renderHud?.()
    s._message(t('cartEnd', { n: CART_COINS }), 3)
    try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
  }

  clear() {
    if (this.riding) this._hopOut(false)
    this.cells.restore()
    this._group?.removeFromParent()
    this._group?.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.dispose()
      o.material.dispose()
    })
    this._group = null
    this.tracks = []
    this.riders = []
    this._in = 1
  }
}

// A rusty iron tub on four little wheels, facing +z.
function makeCart(B) {
  const g = new THREE.Group()
  const box = (w, h, d, color, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), new THREE.MeshLambertMaterial({ color }))
    m.position.set(x * B, y * B, z * B)
    g.add(m)
  }
  box(0.9, 0.08, 1.1, 0x5a5a62, 0, 0.18, 0)
  for (const x of [-0.45, 0.45]) box(0.06, 0.5, 1.1, 0x7a4a2a, x, 0.45, 0)
  for (const z of [-0.55, 0.55]) box(0.9, 0.5, 0.06, 0x7a4a2a, 0, 0.45, z)
  for (const x of [-0.35, 0.35]) for (const z of [-0.35, 0.35]) box(0.1, 0.2, 0.2, 0x222222, x, 0.1, z)
  return g
}
