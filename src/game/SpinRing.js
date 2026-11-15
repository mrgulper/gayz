// The spin ring (2026-11-15, Batch 1 of the spin ring plan): in the zombie
// modes there are no guns any more - instead a few items spin in a circle
// around you and hurt zombies (or heal you) when they touch.
//
//   - RING_SLOTS (3) items, shown on their own little bar (#play-ring-bar),
//     separate from the 10-slot hotbar.
//   - Hold attack (left click / the phone's attack button) = the ring
//     spreads out wide; hold defend (right click / the phone's shield
//     button) = it pulls in tight. Let go and it drifts back to the middle.
//   - A Brick breaks on the zombie it hits and grows back after a moment;
//     the Saw Blade never breaks but only bites each zombie now and then;
//     the Bandage flies into you to heal when you're hurt, then grows back.
//
// Owned by BuildSurvival (`survival.ring`, only in RING_MODES games from the
// homepage or a server - the Map Editor's own Play keeps its gun). Hits go
// through BuildSurvival.hitZombieWith, so on a server they reach the host
// like shots do. It spins round bodyPos(), so in Spectate it keeps
// guarding your body while the camera flies.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'

// The Game Modes with the ring and no guns (Gaymi: "zombie modes"); party
// games keep their guns, and so do PvP modes.
export const RING_MODES = ['classic', 'zombieDefense', 'bossHunt', 'zombieRush', 'zombieExtraction', 'shrinkingZone', 'speedrun', 'towerDefense']
export const RING_SLOTS = 3

// How far out (blocks) the ring sits: pulled in, normal, spread out; how
// fast it gets there (per second), and how fast it turns (radians/second).
const R_PULL = 1.0
const R_NORMAL = 1.8
const R_SPREAD = 3.4
const R_EASE = 7
const SPIN = 3.4
// Height of the ring above your feet (blocks), and each item's touch size.
const RING_Y = 1.0
const ITEM_R = 0.28
// How tall a zombie is (blocks; mobs are 2 blocks tall).
const ZOMBIE_TALL = 2
const ZOMBIE_HALF = 0.3
// A grown-back item pops in over this long (seconds).
const POP_S = 0.18

// The starter items. damage = per touch; reload = seconds to grow back
// (or, for the Saw Blade, seconds between bites on the same zombie);
// heal = health per Bandage.
export const RING_ITEMS = {
  brick: { nameKey: 'ringItemBrick', aboutKey: 'ringItemBrickAbout', damage: 25, reload: 0.8, breaks: true },
  sawblade: { nameKey: 'ringItemSaw', aboutKey: 'ringItemSawAbout', damage: 12, reload: 0.35, breaks: false },
  bandage: { nameKey: 'ringItemBandage', aboutKey: 'ringItemBandageAbout', heal: 15, reload: 5 },
}
export const STARTER_RING = ['brick', 'sawblade', 'bandage']

// Little pictures for the ring bar (drawn, not copied from anywhere).
const ICONS = {
  brick: '<svg viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="9" rx="1" fill="#b5523b" stroke="#5a2418" stroke-width="1.4"/><path d="M3 12.5h18M9 8v4.5M15 12.5V17" stroke="#7a3322" stroke-width="1.2"/></svg>',
  sawblade: '<svg viewBox="0 0 24 24"><path d="M12 2l2 3 3.5-.8.5 3.5 3.2 1.6-1.6 3.2 1.6 3.2-3.2 1.6-.5 3.5-3.5-.8-2 3-2-3-3.5.8-.5-3.5L2.8 16.2l1.6-3.2-1.6-3.2L6 8.2l.5-3.5L10 5.5z" fill="#c7ccd2" stroke="#4d545c" stroke-width="1"/><circle cx="12" cy="12" r="2.6" fill="#4d545c"/></svg>',
  bandage: '<svg viewBox="0 0 24 24"><rect x="2.5" y="8" width="19" height="8" rx="4" fill="#f4ead8" stroke="#8c7a5c" stroke-width="1.2"/><rect x="9" y="8" width="6" height="8" fill="#e9d6b4"/><path d="M12 9.6v4.8M9.6 12h4.8" stroke="#d63b3b" stroke-width="1.8"/></svg>',
}

function makeMesh(id, B) {
  const g = new THREE.Group()
  const lam = (color) => new THREE.MeshLambertMaterial({ color })
  if (id === 'brick') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.46 * B, 0.22 * B, 0.24 * B), lam(0xb5523b)))
  } else if (id === 'sawblade') {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.26 * B, 0.26 * B, 0.05 * B, 12), lam(0xc7ccd2))
    g.add(disc)
    // Teeth round the edge.
    const toothGeo = new THREE.BoxGeometry(0.08 * B, 0.05 * B, 0.08 * B)
    const toothMat = lam(0x8d949c)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const tooth = new THREE.Mesh(toothGeo, toothMat)
      tooth.position.set(Math.cos(a) * 0.29 * B, 0, Math.sin(a) * 0.29 * B)
      tooth.rotation.y = -a + Math.PI / 4
      g.add(tooth)
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * B, 0.07 * B, 0.07 * B, 8), lam(0x4d545c))
    g.add(hub)
  } else {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.42 * B, 0.16 * B, 0.2 * B), lam(0xf4ead8)))
    const red = lam(0xd63b3b)
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.03 * B, 0.17 * B, 0.12 * B), red)
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.12 * B, 0.17 * B, 0.03 * B), red)
    a.position.y = b.position.y = 0.005 * B
    g.add(a, b)
  }
  return g
}

export class SpinRing {
  constructor(survival, ids = STARTER_RING) {
    this.s = survival
    this.bm = survival.bm
    this.B = survival.B
    this.spin = 0
    this.radius = R_NORMAL
    this.group = new THREE.Group()
    this.group.name = 'spin-ring'
    this.bm.scene.add(this.group)
    this.items = ids.slice(0, RING_SLOTS).map((id, slot) => {
      const mesh = makeMesh(id, this.B)
      this.group.add(mesh)
      return { id, def: RING_ITEMS[id], slot, mesh, cd: 0, pop: 1, r: R_NORMAL, flying: false, bitAt: new Map(), wx: 0, wy: 0, wz: 0 }
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
    if (!shown) return
    // Alone, the pause menu (and Photo Mode's freeze) stops the ring too.
    const frozen = (!net && bm.menuOpen) || bm.spectate?.frozen || s._picking
    if (!frozen) {
      this.spin = (this.spin + SPIN * dt) % (Math.PI * 2)
      this.radius += (this.target - this.radius) * Math.min(1, R_EASE * dt)
    }
    const body = s.bodyPos()
    const n = this.items.length
    for (const it of this.items) {
      if (!frozen) this._tick(it, dt)
      const a = this.spin + (it.slot / n) * Math.PI * 2
      if (!it.flying) it.r += (this.radius - it.r) * Math.min(1, R_EASE * dt)
      it.wx = body.x + Math.cos(a) * it.r
      it.wy = body.y + RING_Y
      it.wz = body.z + Math.sin(a) * it.r
      const m = it.mesh
      m.visible = it.cd <= 0
      m.position.set(it.wx * this.B, it.wy * this.B, it.wz * this.B)
      const scale = Math.min(1, it.pop)
      m.scale.setScalar(Math.max(0.01, scale))
      // Facing along the circle; the saw blade also spins on its own.
      m.rotation.y = -a
      if (it.id === 'sawblade') m.rotation.y = this.spin * 6
      if (!frozen && it.cd <= 0) this._touch(it)
    }
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

  // A damaging item touching a zombie hits it.
  _touch(it) {
    const def = it.def
    if (!def.damage) return
    const s = this.s
    const now = performance.now() / 1000
    for (const z of s.zombies) {
      if (z.dead || z.health <= 0) continue
      const size = z.size || 1
      const half = ZOMBIE_HALF * size * (z.wide || 1) + ITEM_R
      const dx = z.x - it.wx
      const dz = z.z - it.wz
      if (dx * dx + dz * dz > half * half) continue
      if (it.wy < z.y - ITEM_R || it.wy > z.y + ZOMBIE_TALL * size * (z.tall || 1) + ITEM_R) continue
      if (!def.breaks) {
        const last = it.bitAt.get(z) || 0
        if (now - last < def.reload) continue
        it.bitAt.set(z, now)
      }
      const body = s.bodyPos()
      const dir = new THREE.Vector3(z.x - body.x, 0, z.z - body.z)
      if (dir.lengthSq() > 0) dir.normalize()
      const amount = def.damage * (s.cfg?.damageMult ?? 1)
      s.hitZombieWith(z, amount, dir)
      if (def.breaks) {
        it.cd = def.reload
        return
      }
    }
    // Forget zombies that are gone (the Saw Blade's bite times).
    if (it.bitAt.size > 20) for (const z of it.bitAt.keys()) if (!s.zombies.includes(z)) it.bitAt.delete(z)
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
    el.setAttribute('role', 'group')
    el.setAttribute('aria-label', t('ringBarLabel'))
    this._cdEls = []
    for (let i = 0; i < RING_SLOTS; i++) {
      const it = this.items[i]
      const slot = document.createElement('div')
      slot.className = 'build-hotbar-slot ring-slot'
      if (it) {
        slot.innerHTML = ICONS[it.id] || ''
        slot.title = `${t(it.def.nameKey)} - ${t(it.def.aboutKey)}`
        slot.setAttribute('aria-label', slot.title)
      }
      const cd = document.createElement('span')
      cd.className = 'ring-cd'
      slot.appendChild(cd)
      el.appendChild(slot)
      this._cdEls.push(cd)
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
    this.items.forEach((it, i) => {
      const el = this._cdEls?.[i]
      if (!el) return
      const pct = it.cd > 0 ? Math.round((it.cd / it.def.reload) * 100) : 0
      if (el._pct !== pct) {
        el._pct = pct
        el.style.height = `${pct}%`
      }
    })
  }

  dispose() {
    this.bm.scene.remove(this.group)
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose()
        o.material.dispose()
      }
    })
    this._bar?.remove()
    this._bar = null
    document.body.classList.remove('play-ring-on')
    this.bm._ringPull = false
    this.bm._ringSpreadTouch = false
  }
}
