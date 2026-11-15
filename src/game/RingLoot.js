// Ring item drops (2026-11-15, Batch 2 of the spin ring plan): in a spin
// ring game every zombie you take down drops one ring item (Gaymi: "each
// zombie must drop something, it can be bad or common but must drop").
// Which rarity: RingItems.rollDrop - mostly Common, bosses Rare or better.
//
// The item hops out, lands, spins over a band in its rarity colour, and
// flies into you when you walk near (further with a Magnet in your ring);
// then it's in your bag (RingItems.js) for the ring editor. Gone after
// LIFE_S if nobody picks it up; never more than MAX on the ground.
// Meshes only, never a light.
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { rollDrop, parseKey, makeItemMesh, rarityBand, addToBag, rarityIndex } from './RingItems.js'
import { itemLabel } from './SpinRing.js'
import { getKeyFor, keyLabel } from './Keybinds.js'

const LIFE_S = 90
const MAX = 60
const PICKUP_R = 2.2
const COLLECT_R = 0.5
const GRAVITY = 22
const WAIT_S = 0.5
const SCALE = 0.85

export class RingLoot {
  constructor(survival) {
    this.s = survival
    this.list = []
  }

  get bm() {
    return this.s.bm
  }

  // A zombie went down: its drop.
  dropFrom(z) {
    // A custom lobby with easy rules drops less often (LobbyRules.rewardMult).
    if (Math.random() >= (this.s.rewardMult ?? 1)) return null
    return this.spawn(rollDrop(!!z.boss, z.tier || 'common'), z.x, (z.y || 0) + 1, z.z)
  }

  spawn(key, x, y, z) {
    const p = parseKey(key)
    if (!p) return null
    const B = this.s.B
    const mesh = makeItemMesh(p.id, B)
    mesh.scale.setScalar(SCALE)
    const band = rarityBand(p.rarity, B, 0.36)
    band.position.y = -0.22 * B
    mesh.add(band)
    mesh.name = 'ring-loot'
    this.bm.scene.add(mesh)
    const a = Math.random() * Math.PI * 2
    const d = { key, mesh, x, y, z, vx: Math.cos(a) * 1.4, vy: 5, vz: Math.sin(a) * 1.4, age: 0, spin: a, onGround: false }
    this.list.push(d)
    while (this.list.length > MAX) this._remove(this.list[0])
    return d
  }

  _remove(d) {
    this.bm.scene.remove(d.mesh)
    d.mesh.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose()
        o.material.dispose()
      }
    })
    this.list = this.list.filter((o) => o !== d)
  }

  update(dt) {
    if (!this.list.length) return
    const s = this.s
    const B = s.B
    // Your body (in Spectate the camera flies, but your body picks up).
    const p = s.bodyPos()
    const reach = s.ring ? s.ring.pullRange(PICKUP_R) : PICKUP_R
    for (const d of [...this.list]) {
      d.age += dt
      if (d.age > LIFE_S) {
        this._remove(d)
        continue
      }
      const py = p.y + 0.8
      const dist = Math.hypot(p.x - d.x, py - d.y, p.z - d.z)
      if (dist < reach && d.age > WAIT_S && !s.dead) {
        const k = Math.min(1, dt * (dist > PICKUP_R ? 6 : 10))
        d.x += (p.x - d.x) * k
        d.y += (py - d.y) * k
        d.z += (p.z - d.z) * k
        if (dist < COLLECT_R) {
          this._collect(d)
          continue
        }
      } else {
        d.vy -= GRAVITY * dt
        d.x += d.vx * dt
        d.z += d.vz * dt
        d.y += d.vy * dt
        d.vx *= Math.max(0, 1 - dt * 3)
        d.vz *= Math.max(0, 1 - dt * 3)
        const ground = s._groundUnder ? s._groundUnder(d.x, d.y + 0.5, d.z) : 0
        if (d.y <= ground + 0.3) {
          d.y = ground + 0.3
          d.vy = 0
          d.vx = 0
          d.vz = 0
          d.onGround = true
        }
      }
      d.spin += dt * 1.8
      const bob = d.onGround ? 0.1 + Math.sin(d.age * 2.6) * 0.06 : 0
      d.mesh.position.set(d.x * B, (d.y + bob) * B, d.z * B)
      d.mesh.rotation.y = d.spin
    }
  }

  _collect(d) {
    this._remove(d)
    addToBag(d.key)
    const rare = rarityIndex(parseKey(d.key).rarity) >= 2
    if (!this._told) {
      // The first pick-up of a game: how to use what you find.
      this._told = true
      const touch = this.bm.touch?.enabled
      this.s._message(touch ? t('ringLootFirstTouch') : t('ringLootFirst', { key: keyLabel(getKeyFor('ringBag')) }), 5)
    } else {
      // Common ones only get a short note; Rare and up get the big one.
      this.s._message(t(rare ? 'ringLootRare' : 'ringLootGot', { name: itemLabel(d.key) }), rare ? 3 : 1.5)
    }
    try { audioEngine.playUi?.(rare ? 'unbox' : 'tab') } catch { /* no audio */ }
    this.s.ringEditor?.refresh()
  }

  clear() {
    for (const d of [...this.list]) this._remove(d)
    this.list = []
  }
}
