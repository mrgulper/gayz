// The spin ring (2026-11-15, Batch 1 of the spin ring plan): in the zombie
// modes there are no guns any more - instead a few items spin in a circle
// around you and hurt zombies (or heal you) when they touch.
//
//   - ringSlots() items (3, up to 10 bought in the Shop - Batch 3), shown on their own little bar (#play-ring-bar),
//     separate from the 10-slot hotbar. Tapping or clicking the bar (or the
//     Ring Bag key, I) opens the ring editor (RingEditor.js).
//   - Hold attack (left click / the phone's attack button) = the ring
//     spreads out wide; hold defend (right click / the phone's shield
//     button) = it pulls in tight. Let go and it drifts back to the middle.
//   - Items that break (Brick, Ice Cube, Battery, Firecracker) break on the
//     zombie they hit and grow back; the Saw Blade and Cactus never break
//     but only bite each zombie now and then; the Bandage flies into you
//     to heal when you're hurt; the Shield Plate soaks up a bite; the
//     Magnet pulls dropped ring items in from further away (RingLoot.js).
//   - Batch 2: every item comes in 6 rarities (RingItems.js) - rarer is
//     stronger, and its slot and the band under it wear the rarity colour.
//
// Owned by BuildSurvival (`survival.ring`, only in RING_MODES games from the
// homepage or a server - the Map Editor's own Play keeps its gun). Hits go
// through BuildSurvival.hitZombieWith, so on a server they reach the host
// like shots do. It spins round bodyPos(), so in Spectate it keeps
// guarding your body while the camera flies.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import * as RingItemsLib from './RingItems.js'
import { RING_SLOTS, ringSlots, ICONS, parseKey, itemStats, makeItemMesh, rarityBand, rarityColor, rarityNameKey, loadLoadout } from './RingItems.js'

export { RING_SLOTS }

// The Game Modes with the ring and no guns (Gaymi: "zombie modes"); party
// games keep their guns, and so do PvP modes.
export const RING_MODES = ['classic', 'zombieDefense', 'bossHunt', 'zombieRush', 'zombieExtraction', 'shrinkingZone', 'speedrun', 'towerDefense']

// How far out (blocks) the ring sits: pulled in, normal, spread out; how
// fast it gets there (per second), and how fast it turns (radians/second).
const R_PULL = 1.0
const R_NORMAL = 1.8
const R_SPREAD = 3.4
export const R_EASE = 7
export const SPIN = 3.4
// Height of the ring above your feet (blocks), and each item's touch size.
export const RING_Y = 1.0
const ITEM_R = 0.28
// Friendly fire (a custom lobby's rule): how often one item can hurt the
// same player, at most (seconds) - and how big a player is to touch.
const PVP_GAP_S = 0.5
const PLAYER_HALF = 0.3
const PLAYER_TALL = 2
// How tall a zombie is (blocks; mobs are 2 blocks tall).
const ZOMBIE_TALL = 2
const ZOMBIE_HALF = 0.3
// A grown-back item pops in over this long (seconds).
const POP_S = 0.18
// The Battery's jolt jumps this far (blocks) and does this share of its hit.
const ZAP_RANGE = 4
const ZAP_SHARE = 0.6
const ZAP_SHOW_S = 0.15

// The item's name with its rarity, for titles: "Rare Brick".
export function itemLabel(key) {
  const p = parseKey(key)
  if (!p) return ''
  return `${t(rarityNameKey(p.rarity))} ${t(itemStats(p.id, p.rarity).nameKey)}`
}

export class SpinRing {
  constructor(survival, keys = loadLoadout()) {
    this.s = survival
    this.bm = survival.bm
    this.B = survival.B
    this.spin = 0
    this.radius = R_NORMAL
    this.group = new THREE.Group()
    this.group.name = 'spin-ring'
    this.bm.scene.add(this.group)
    this._zaps = []
    this.setLoadout(keys)
  }

  // Puts a new set of items in the ring (the ring editor). keys: one
  // "id:rarity" (or '') per slot.
  setLoadout(keys) {
    for (const it of this.items || []) this._disposeMesh(it.mesh)
    this.keys = Array.from({ length: ringSlots() }, (_, i) => (parseKey(keys?.[i]) ? keys[i] : ''))
    this.items = []
    this.keys.forEach((key, slot) => {
      const p = parseKey(key)
      if (!p) return
      const mesh = makeItemMesh(p.id, this.B)
      const band = rarityBand(p.rarity, this.B)
      band.position.y = -0.2 * this.B
      mesh.add(band)
      this.group.add(mesh)
      this.items.push({ key, id: p.id, rarity: p.rarity, def: itemStats(p.id, p.rarity), slot, mesh, cd: 0, pop: 1, r: this.radius, flying: false, bitAt: new Map(), wx: 0, wy: 0, wz: 0 })
    })
    this._buildBar()
  }

  // Which way the ring is being pushed: 1 spread, -1 pulled in, 0 normal.
  // Attack = left click held (also digs) or the phone's attack button;
  // defend = right click held or the phone's shield button.
  _push() {
    const bm = this.bm
    if (bm._ringPull) return -1
    if (bm._fireHeld || bm._ringSpreadTouch) return 1
    return 0
  }

  get target() {
    const p = this._push()
    return p > 0 ? R_SPREAD : p < 0 ? R_PULL : R_NORMAL
  }

  update(dt) {
    const s = this.s
    const bm = this.bm
    const net = s.net && !s.net.closed
    const shown = s.active && !s.dead && !s.couch?.p1Down
    this.group.visible = shown
    this._showBar(shown)
    this._updateZaps(dt)
    if (!shown) return
    // Alone, the pause menu (and Photo Mode's freeze) stops the ring too.
    const frozen = (!net && bm.menuOpen) || bm.spectate?.frozen || s._picking
    if (!frozen) {
      this.spin = (this.spin + SPIN * dt) % (Math.PI * 2)
      this.radius += (this.target - this.radius) * Math.min(1, R_EASE * dt)
    }
    const body = s.bodyPos()
    const n = this.items.length
    this.items.forEach((it, idx) => {
      if (!frozen) this._tick(it, dt)
      const a = this.spin + (idx / n) * Math.PI * 2
      if (!it.flying) it.r += (this.radius - it.r) * Math.min(1, R_EASE * dt)
      it.wx = body.x + Math.cos(a) * it.r
      it.wy = body.y + RING_Y
      it.wz = body.z + Math.sin(a) * it.r
      const m = it.mesh
      m.visible = it.cd <= 0
      m.position.set(it.wx * this.B, it.wy * this.B, it.wz * this.B)
      m.scale.setScalar(Math.max(0.01, Math.min(1, it.pop)))
      // Facing along the circle; the saw blade also spins on its own.
      m.rotation.y = -a
      if (it.id === 'sawblade') m.rotation.y = this.spin * 6
      if (!frozen && it.cd <= 0) this._touch(it)
      if (!frozen && it.cd <= 0 && net && s.net.rules?.ff) this._touchPlayers(it)
    })
    this._renderBar()
  }

  // Cool-downs, grow-back pops and the Bandage's flight.
  _tick(it, dt) {
    const s = this.s
    if (it.cd > 0) {
      it.cd -= dt
      if (it.cd <= 0) {
        it.cd = 0
        it.pop = 0
        it.r = this.radius
      }
      return
    }
    if (it.pop < 1) it.pop += dt / POP_S
    if (it.def.heal) {
      const hurt = s.health < (s.maxHealth || 100) - 0.5
      if (hurt && !it.flying) it.flying = true
      if (it.flying) {
        it.r += (0 - it.r) * Math.min(1, 9 * dt)
        if (it.r < 0.35) this._heal(it)
      }
    }
  }

  _heal(it) {
    const s = this.s
    it.flying = false
    it.cd = it.def.reload
    s.health = Math.min(s.maxHealth || 100, s.health + it.def.heal)
    s._renderHud()
    try { audioEngine.playUi?.('confirm') } catch { /* no audio */ }
  }

  _touching(it, z) {
    const size = z.size || 1
    const half = ZOMBIE_HALF * size * (z.wide || 1) + ITEM_R
    const dx = z.x - it.wx
    const dz = z.z - it.wz
    if (dx * dx + dz * dz > half * half) return false
    return !(it.wy < z.y - ITEM_R || it.wy > z.y + ZOMBIE_TALL * size * (z.tall || 1) + ITEM_R)
  }

  _hit(z, amount) {
    const s = this.s
    const body = s.bodyPos()
    const dir = new THREE.Vector3(z.x - body.x, 0, z.z - body.z)
    if (dir.lengthSq() > 0) dir.normalize()
    s.hitZombieWith(z, amount * (s.cfg?.damageMult ?? 1), dir)
  }

  // A damaging item touching a zombie hits it.
  _touch(it) {
    const def = it.def
    if (!def.damage) return
    const s = this.s
    const now = performance.now() / 1000
    for (const z of [...s.zombies]) {
      if (z.dead || z.health <= 0) continue
      if (!this._touching(it, z)) continue
      if (!def.breaks) {
        const last = it.bitAt.get(z) || 0
        if (now - last < def.bite) continue
        it.bitAt.set(z, now)
      }
      // Ice Cube: slowed for a while (the same slow as the Void Ripper's).
      if (def.slow) z.slow = Math.max(z.slow || 0, def.slow)
      if (def.blast) this._blast(it, z)
      else this._hit(z, def.damage)
      if (def.zap) this._zap(z, def)
      if (def.breaks) {
        it.cd = def.reload
        return
      }
    }
    // Forget zombies that are gone (bite times).
    if (it.bitAt.size > 20) for (const z of it.bitAt.keys()) if (typeof z !== 'string' && !s.zombies.includes(z)) it.bitAt.delete(z)
  }

  // Friendly fire on (a custom lobby): a damaging item touching another
  // player hurts them - the hit goes through the server (PlayNet.queuePvp)
  // and lands like a zombie bite on their screen.
  _touchPlayers(it) {
    const def = it.def
    if (!def.damage) return
    const net = this.s.net
    const now = performance.now() / 1000
    for (const [pid, p] of net.players) {
      if (p.dead || !p.seen) continue
      const dx = p.x - it.wx
      const dz = p.z - it.wz
      const half = PLAYER_HALF + ITEM_R
      if (dx * dx + dz * dz > half * half || it.wy < p.y - ITEM_R || it.wy > p.y + PLAYER_TALL + ITEM_R) continue
      const key = `p:${pid}`
      if (now - (it.bitAt.get(key) || 0) < Math.max(PVP_GAP_S, def.bite || 0)) continue
      it.bitAt.set(key, now)
      net.queuePvp(pid, Math.round(def.damage * (this.s.cfg?.damageMult ?? 1)))
      if (def.breaks) {
        it.cd = def.reload
        return
      }
    }
  }

  // What the other players on a server need to draw my ring
  // (RemoteRings.js): the items, and how far out it sits.
  netState() {
    return { k: this.keys.slice(), r: Math.round(this.radius * 10) / 10 }
  }

  // Firecracker: every zombie close by is hurt.
  _blast(it, first) {
    const s = this.s
    const r = it.def.blast
    const near = s.zombies.filter((z) => z === first || (!z.dead && z.health > 0 && Math.hypot(z.x - it.wx, z.z - it.wz) < r))
    for (const z of near) this._hit(z, it.def.damage)
    s._fx?.explode(new THREE.Vector3(it.wx * this.B, (it.wy - 0.5) * this.B, it.wz * this.B), 0.6)
  }

  // Battery: the jolt jumps on to the nearest few zombies.
  _zap(from, def) {
    const s = this.s
    const done = new Set([from])
    let at = from
    for (let i = 0; i < def.zap; i++) {
      let best = null
      let bestD = ZAP_RANGE
      for (const z of s.zombies) {
        if (done.has(z) || z.dead || z.health <= 0) continue
        const d = Math.hypot(z.x - at.x, z.z - at.z)
        if (d < bestD) {
          bestD = d
          best = z
        }
      }
      if (!best) break
      this._showZap(at, best)
      done.add(best)
      this._hit(best, Math.round(def.damage * ZAP_SHARE))
      at = best
    }
  }

  _showZap(a, b) {
    const B = this.B
    const y = (z) => (z.y + 1.2) * B
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.x * B, y(a), a.z * B), new THREE.Vector3(b.x * B, y(b), b.z * B)])
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe873 }))
    this.bm.scene.add(line)
    this._zaps.push({ line, left: ZAP_SHOW_S })
  }

  _updateZaps(dt) {
    for (const zp of [...this._zaps]) {
      zp.left -= dt
      if (zp.left > 0) continue
      this.bm.scene.remove(zp.line)
      zp.line.geometry.dispose()
      zp.line.material.dispose()
      this._zaps = this._zaps.filter((o) => o !== zp)
    }
  }

  // BuildSurvival._hurtPlayer: a ready Shield Plate soaks up (part of) a
  // hit, then grows back. Returns what still gets through.
  absorb(amount) {
    for (const it of this.items) {
      if (amount <= 0) break
      if (!it.def.guard || it.cd > 0) continue
      amount = Math.max(0, amount - it.def.guard)
      it.cd = it.def.reload
      try { audioEngine.playUi?.('tab') } catch { /* no audio */ }
    }
    return amount
  }

  // A zombie bit you: the Cactus pricks it back.
  onBitten(z) {
    for (const it of this.items) if (it.def.thorns && it.cd <= 0 && this.s.zombies.includes(z)) this._hit(z, it.def.thorns)
  }

  // How far (blocks) dropped ring items fly to you: the best Magnet's.
  pullRange(normal) {
    let r = normal
    for (const it of this.items) if (it.def.pull && it.cd <= 0) r = Math.max(r, it.def.pull)
    return r
  }

  // --- the ring bar ---

  _buildBar() {
    let el = document.getElementById('play-ring-bar')
    if (!el) {
      el = document.createElement('div')
      el.id = 'play-ring-bar'
      document.body.appendChild(el)
    }
    el.innerHTML = ''
    el.setAttribute('role', 'button')
    el.setAttribute('aria-label', `${t('ringBarLabel')} - ${t('ringEditorOpen')}`)
    el.title = t('ringEditorOpen')
    // Click or tap: the ring editor (RingEditor.js).
    el.onclick = (e) => {
      e.stopPropagation()
      this.s.ringEditor?.open()
    }
    el.onpointerdown = (e) => e.stopPropagation()
    el.ontouchstart = (e) => e.stopPropagation()
    this._cdEls = []
    // More than 5 slots: the bar wraps into two rows (two columns on an
    // upright phone) so it never runs off the screen.
    el.classList.toggle('ring-many', this.keys.length > 5)
    for (let i = 0; i < this.keys.length; i++) {
      const it = this.items.find((o) => o.slot === i)
      const slot = document.createElement('div')
      slot.className = 'build-hotbar-slot ring-slot'
      if (it) {
        slot.innerHTML = ICONS[it.id] || ''
        slot.style.borderColor = rarityColor(it.rarity)
        slot.title = `${itemLabel(it.key)} - ${t(it.def.aboutKey)}`
        slot.setAttribute('aria-label', slot.title)
      } else slot.classList.add('ring-slot-empty')
      const cd = document.createElement('span')
      cd.className = 'ring-cd'
      slot.appendChild(cd)
      el.appendChild(slot)
      this._cdEls[i] = cd
    }
    this._bar = el
    this._barShown = null
  }

  _showBar(on) {
    if (on === this._barShown || !this._bar) return
    this._barShown = on
    this._bar.style.display = on ? 'flex' : 'none'
    document.body.classList.toggle('play-ring-on', on)
  }

  _renderBar() {
    for (const it of this.items) {
      const el = this._cdEls?.[it.slot]
      if (!el) continue
      const pct = it.cd > 0 ? Math.round((it.cd / it.def.reload) * 100) : 0
      if (el._pct !== pct) {
        el._pct = pct
        el.style.height = `${pct}%`
      }
    }
  }

  _disposeMesh(mesh) {
    this.group.remove(mesh)
    mesh.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose()
        o.material.dispose()
      }
    })
  }

  dispose() {
    for (const it of this.items) this._disposeMesh(it.mesh)
    this.items = []
    this._updateZaps(Infinity)
    this.bm.scene.remove(this.group)
    this._bar?.remove()
    this._bar = null
    document.body.classList.remove('play-ring-on')
    this.bm._ringPull = false
    this.bm._ringSpreadTouch = false
  }
}

// The item rules, reachable from a running game (automated checks).
SpinRing.lib = RingItemsLib
