// The Ghost Pirate Ship (2026-11-02, Gaymi's idea list 5: "a random event
// at sea where a glowing ship with skeleton pirates shows up. Board it for
// treasure. It works with boats and Treasure Maps"). Owned by
// BuildSurvival (`s.pirate`); a world event (WorldEvents 'pirate') that
// only comes when the open sea is close (possible()).
//
// A dark wooden ship (real blocks, SHIP_L long) appears on the water
// SHIP_NEAR..SHIP_FAR blocks out, with two masts, glowing ghostly green
// sails and a green beam over it so you can find it. Sail out in a boat
// (or swim) and climb aboard by the steps on its sides. PIRATES skeleton
// pirates guard the deck (not part of the wave; only where the game runs).
// The captain's chest at the back is a loot chest that also holds
// PIRATE_COINS coins and a Treasure Map (TreasureMaps.js). After SHIP_LIFE
// seconds the ship fades away and the sea is as it was (TempBlocks.js).
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { sampleLand, inCity } from './OpenWorld.js'
import { SKELETON_KINDS } from './SkeletonModels.js'
import { TempBlocks } from './TempBlocks.js'

export const SHIP_L = 15
export const SHIP_NEAR = 26
export const SHIP_FAR = 40
export const SHIP_LIFE = 240
export const PIRATES = 4
export const PIRATE_COINS = 80
const SEA_LOOK = 40

const isOcean = (x, z) => !inCity(Math.floor(x), Math.floor(z)) && /cean$/.test(sampleLand(Math.floor(x), Math.floor(z))?.biome || '')

export class PirateShip {
  constructor(survival) {
    this.s = survival
    this.cells = new TempBlocks(survival)
    this.ship = null
  }

  get B() {
    return this.s.B
  }

  // Is the open sea close enough for the ship to come?
  possible() {
    const s = this.s
    if (!s.bm.world?.active || this.ship) return false
    const me = s.bodyPos()
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      if (isOcean(me.x + Math.cos(a) * SEA_LOOK, me.z + Math.sin(a) * SEA_LOOK)) return true
    }
    return isOcean(me.x, me.z)
  }

  // The water's top cell in a column near `nearY` (null: not open water).
  _sea(x, z, nearY) {
    const bm = this.s.bm
    for (let y = Math.floor(nearY) + 6; y >= nearY - 12; y--) {
      if (bm.getBlockAt(x, y, z) !== 'water') continue
      if (bm.getBlockAt(x, y + 1, z)) return null
      for (let k = 1; k <= 3; k++) if (bm.getBlockAt(x, y - k, z) !== 'water') return null
      return y
    }
    return null
  }

  // The world event: the ship comes. -> a run, or null.
  event(me) {
    if (this.ship) return null
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2
      const d = SHIP_NEAR + Math.random() * (SHIP_FAR - SHIP_NEAR)
      const x = Math.floor(me.x + Math.cos(a) * d)
      const z = Math.floor(me.z + Math.sin(a) * d)
      if (!isOcean(x, z) || !isOcean(x + SHIP_L, z)) continue
      const y = this._sea(x, z, me.y)
      if (y === null || this._sea(x + SHIP_L - 1, z, me.y) !== y || this._sea(x + 7, z + 3, me.y) !== y || this._sea(x + 7, z - 3, me.y) !== y) continue
      this._build(x, y, z)
      this.s._message(t('pirateAppears'), 5)
      try { audioEngine.playSpecial?.('bell') } catch { /* no audio */ }
      return {
        update: (dt) => this._update(dt),
        dispose: () => this.clear(),
      }
    }
    return null
  }

  // Half-width of the hull at x (0..SHIP_L-1): pointed at the bow.
  _w(x) {
    if (x >= SHIP_L - 1) return 0
    if (x >= SHIP_L - 3) return 1
    if (x >= SHIP_L - 5) return 2
    return 3
  }

  _build(x0, sy, z0) {
    const put = (x, y, z, type) => this.cells.put(x0 + x, sy + y, z0 + z, type)
    for (let x = 0; x < SHIP_L; x++) {
      const w = this._w(x)
      for (let z = -w; z <= w; z++) {
        put(x, -1, z, 'darkoakplanks')
        put(x, 0, z, 'darkoakplanks')
        put(x, 1, z, Math.abs(z) === w ? 'darkoaklog' : 'darkoakplanks')
        // Rails round the deck.
        if (Math.abs(z) === w || x === 0) put(x, 2, z, 'darkoakplanks')
      }
    }
    // Steps up the sides, in the middle.
    for (const side of [-1, 1]) {
      put(7, 0, side * 4, 'darkoakplanks')
      this.cells.back(this.s.bm._key(x0 + 7, sy + 2, z0 + side * 3))
    }
    // The captain's cabin at the back and the chest in it.
    for (let x = 1; x <= 3; x++) for (let z = -2; z <= 2; z++) {
      if (x === 3 && Math.abs(z) < 2) continue
      if (Math.abs(z) === 2 || x === 1) for (let y = 2; y <= 3; y++) put(x, y, z, y === 3 && z === 0 ? 'tintedglass' : 'darkoakplanks')
      put(x, 4, z, 'darkoakplanks')
    }
    put(2, 2, 0, 'lootchest')
    this.chest = this.s.bm._key(x0 + 2, sy + 2, z0)
    // Masts.
    for (const mx of [6, 10]) for (let y = 2; y <= 9; y++) put(mx, y, 0, 'darkoaklog')
    this.ship = { x: x0, y: sy, z: z0, left: SHIP_LIFE, looted: false }
    this._meshes(x0, sy, z0)
    // The pirates on deck.
    const s = this.s
    if (!s.net || s.net.isHost) {
      const kinds = Object.keys(SKELETON_KINDS)
      for (let i = 0; i < PIRATES; i++) {
        const zb = s._extraZombie?.(x0 + 5 + i * 1.8 + 0.5, sy + 2, z0 + (i % 2 ? 1.5 : -1.5) + 0.5, kinds.length ? kinds[i % kinds.length] : null)
        if (zb) zb.pirate = true
      }
    }
  }

  // Ghostly sails, a green glow on the water and a beam to find it by.
  _meshes(x0, sy, z0) {
    const B = this.B
    const g = new THREE.Group()
    const sail = new THREE.MeshBasicMaterial({ color: 0x8affc0, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
    for (const [mx, w, h] of [[6, 6, 5], [10, 5, 4]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.1 * B, h * B, w * B), sail)
      m.position.set((x0 + mx + 0.9) * B, (sy + 4.5 + h / 2) * B, (z0 + 0.5) * B)
      g.add(m)
    }
    const glow = new THREE.Mesh(new THREE.BoxGeometry((SHIP_L + 2) * B, 0.05 * B, 9 * B), new THREE.MeshBasicMaterial({ color: 0x4aff9a, transparent: true, opacity: 0.18, depthWrite: false }))
    glow.position.set((x0 + SHIP_L / 2) * B, (sy + 1.02) * B, (z0 + 0.5) * B)
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.5 * B, 40 * B, 1.5 * B), new THREE.MeshBasicMaterial({ color: 0x4aff9a, transparent: true, opacity: 0.14, depthWrite: false }))
    beam.position.set((x0 + 8) * B, (sy + 22) * B, (z0 + 0.5) * B)
    g.add(glow, beam)
    this._group = g
    this._sail = sail
    this.s.bm.scene.add(g)
  }

  _update(dt) {
    const sh = this.ship
    if (!sh) return false
    sh.left -= dt
    this._sail.opacity = 0.45 + Math.sin(performance.now() / 400) * 0.12
    if (sh.left < 10) this._sail.opacity *= Math.max(0, sh.left / 10)
    if (sh.left <= 0) {
      this.s._message(t('pirateFades'), 4)
      return false
    }
    return true
  }

  // A loot chest was opened (BuildSurvival.useChest): the captain's has more.
  onChest(key) {
    const sh = this.ship
    if (!sh || sh.looted || key !== this.chest) return
    sh.looted = true
    const s = this.s
    s.coins = (s.coins || 0) + PIRATE_COINS
    s.inv?.add({ kind: 'item', id: 'treasureMap', n: 1 })
    s._renderHud?.()
    s._message(t('pirateLoot', { n: PIRATE_COINS }), 5)
    try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
  }

  clear() {
    this.cells.restore()
    this._group?.removeFromParent()
    this._group?.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.dispose()
      o.material.dispose()
    })
    this._group = null
    this.ship = null
    this.chest = ''
  }
}
