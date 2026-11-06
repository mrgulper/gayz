// Graveyard Midnight (2026-11-06, Gaymi's idea list 7: "a spooky graveyard
// on the maps where zombies climb out of the graves at midnight"). Owned by
// BuildSurvival (`s.graveyard`); a world event (WorldEvents 'graveyard')
// that only comes at night (possible()), on every map.
//
// A fenced patch of dark earth (real blocks, SIZE x SIZE) appears NEAR..FAR
// blocks away, with GRAVES gravestones in rows, a bare dead tree, carved
// pumpkins and a pale mist over it so you can find it. When it's fully
// night (MIDNIGHT) - or the moment you step through the gate - the graves
// rumble and one zombie (or, every other grave, a skeleton) claws its way
// out of each, one after another every
// RISE_GAP seconds, frozen while they climb (not part of the wave; only
// where the game runs). Clear every one of them and a coffin-chest rises in
// the middle: a loot chest that also holds GRAVE_COINS coins. At dawn (or
// after LIFE seconds) it all sinks away again (TempBlocks.js).
// Meshes only, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { TempBlocks } from './TempBlocks.js'
import { SKELETON_KINDS } from './SkeletonModels.js'

export const SIZE = 11
export const GRAVES = 8
export const RISE_GAP = 1.2
export const RISE_S = 1.6
export const GRAVE_COINS = 90
export const LIFE = 300
const NEAR = 18
const FAR = 30
const NIGHT = 0.5
const MIDNIGHT = 0.97

export class Graveyard {
  constructor(survival) {
    this.s = survival
    this.cells = new TempBlocks(survival)
    this.yard = null
    this.chest = ''
  }

  get B() {
    return this.s.B
  }

  possible() {
    const s = this.s
    if (this.yard || s.td || s.escape || s.party || s.moon?.on) return false
    return (s.bm.sky?.nightAmount?.() ?? 0) > NIGHT
  }

  // The world event: the graveyard appears. -> a run, or null.
  event(me) {
    if (this.yard) return null
    const s = this.s
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2
      const d = NEAR + Math.random() * (FAR - NEAR)
      const x0 = Math.floor(me.x + Math.cos(a) * d)
      const z0 = Math.floor(me.z + Math.sin(a) * d)
      const y0 = this._flat(x0, z0, me.y)
      if (y0 === null) continue
      this.build(x0, y0, z0)
      s._message(t('graveAppears'), 5)
      try { audioEngine.playSpecial?.('bell') } catch { /* no audio */ }
      return { update: (dt) => this._update(dt), dispose: () => this.clear() }
    }
    return null
  }

  // The top of the ground if it's roughly flat and dry, else null.
  _flat(x0, z0, nearY) {
    const s = this.s
    let lo = Infinity
    let hi = -Infinity
    for (let x = x0; x < x0 + SIZE; x += 2) {
      for (let z = z0; z < z0 + SIZE; z += 2) {
        if (s.camp?.inside?.(x + 0.5, z + 0.5, 3)) return null
        const g = s._groundUnder(x + 0.5, nearY + 15, z + 0.5)
        if (g === nearY + 15) return null
        const top = s.bm.getBlockAt(x, g - 1, z)
        if (top === 'water' || top === 'lava') return null
        lo = Math.min(lo, g)
        hi = Math.max(hi, g)
      }
    }
    return hi - lo <= 2 ? hi : null
  }

  // y0: the first air cell over the ground.
  build(x0, y0, z0) {
    const N = SIZE - 1
    const put = (x, y, z, type) => this.cells.put(x0 + x, y0 + y, z0 + z, type)
    const hole = (x, y, z) => this.cells.clear(x0 + x, y0 + y, z0 + z)
    for (let x = 0; x <= N; x++) for (let z = 0; z <= N; z++) {
      // Level dark earth, cleared above.
      for (let y = -2; y <= -1; y++) put(x, y, z, y === -1 ? ((x * 7 + z * 3) % 5 === 0 ? 'coarsedirt' : 'podzol') : 'dirt')
      for (let y = 0; y <= 5; y++) hole(x, y, z)
      // The fence round it, with a gate in the middle of the near side.
      const edge = x === 0 || z === 0 || x === N || z === N
      if (edge && !(z === 0 && (x === 5 || x === 4))) put(x, 0, z, 'stonefence')
    }
    // Gravestones in two rows: [x, z].
    this.graves = []
    const spots = [[2, 3], [4, 3], [6, 3], [8, 3], [2, 7], [4, 7], [6, 7], [8, 7]].slice(0, GRAVES)
    for (const [gx, gz] of spots) {
      put(gx, 0, gz + 1, 'stonebricks')
      put(gx, 1, gz + 1, 'chiseledstonebricks')
      put(gx, -1, gz, 'coarsedirt')
      this.graves.push({ x: x0 + gx + 0.5, y: y0, z: z0 + gz + 0.5, risen: false })
    }
    // A bare dead tree in a corner, carved pumpkins by the gate.
    for (let y = 0; y < 5; y++) put(N - 1, y, N - 1, 'oaklog')
    put(N - 2, 3, N - 1, 'oaklog')
    put(N - 1, 4, N - 2, 'oaklog')
    put(3, 0, 1, 'jackolantern')
    put(6, 0, 1, 'jackolantern')
    this.yard = { x0, y0, z0, left: LIFE, rising: false, next: 0, risen: [], cleared: false }
    this._meshes()
  }

  // A pale mist over the yard.
  _meshes() {
    const B = this.B
    const y = this.yard
    const g = new THREE.Group()
    const mist = new THREE.Mesh(new THREE.BoxGeometry(SIZE * B, 1.2 * B, SIZE * B), new THREE.MeshBasicMaterial({ color: 0xd8e4f0, transparent: true, opacity: 0.18, depthWrite: false }))
    mist.position.set((y.x0 + SIZE / 2) * B, (y.y0 + 0.6) * B, (y.z0 + SIZE / 2) * B)
    const glow = new THREE.Mesh(new THREE.BoxGeometry(SIZE * B, 30 * B, SIZE * B), new THREE.MeshBasicMaterial({ color: 0x9ad0ff, transparent: true, opacity: 0.06, depthWrite: false }))
    glow.position.set((y.x0 + SIZE / 2) * B, (y.y0 + 16) * B, (y.z0 + SIZE / 2) * B)
    g.add(mist, glow)
    this._mist = mist
    this._group = g
    this.s.bm.scene.add(g)
  }

  // Inside the fence?
  inside(p) {
    const y = this.yard
    return !!y && p.x > y.x0 && p.x < y.x0 + SIZE && p.z > y.z0 && p.z < y.z0 + SIZE && Math.abs(p.y - y.y0) < 4
  }

  _update(dt) {
    const yd = this.yard
    if (!yd) return false
    const s = this.s
    yd.left -= dt
    if (this._mist) this._mist.material.opacity = 0.14 + Math.sin(performance.now() / 900) * 0.05
    const night = s.bm.sky?.nightAmount?.() ?? 1
    if (!yd.rising && (night >= MIDNIGHT || this.inside(s.bodyPos()))) {
      yd.rising = true
      yd.next = 0.5
      s._message(t('graveMidnight'), 4)
      try { audioEngine.playSpecial?.('echo') } catch { /* no audio */ }
    }
    if (yd.rising) {
      yd.next -= dt
      const g = this.graves.find((q) => !q.risen)
      if (g && yd.next <= 0) {
        yd.next = RISE_GAP
        g.risen = true
        this._rise(g)
      }
      // Every one of them down: the coffin-chest.
      if (!g && !yd.cleared && yd.risen.length && yd.risen.every((zb) => !s.zombies.includes(zb))) {
        yd.cleared = true
        const cx = yd.x0 + 5
        const cz = yd.z0 + 5
        this.cells.put(cx, yd.y0, cz, 'lootchest')
        this.chest = s.bm._key(cx, yd.y0, cz)
        s._message(t('graveCleared'), 5)
        try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
      }
    }
    const day = night < 0.15
    if (yd.left <= 0 || day) {
      s._message(t('graveFades'), 4)
      return false
    }
    return true
  }

  // A zombie claws its way out of a grave: dirt flies, and it can't move
  // until it's out.
  _rise(g) {
    const s = this.s
    const B = this.B
    s._fx?.paint?.(g.x * B, (g.y + 0.2) * B, g.z * B, 0x5a3a1e)
    s._fx?.smoke?.(g.x * B, (g.y + 0.3) * B, g.z * B)
    try { audioEngine.playSpecial?.('crumble') } catch { /* no audio */ }
    if (s.net && !s.net.isHost) return
    // Every other grave holds a skeleton, which rises with its own climb.
    const kinds = Object.keys(SKELETON_KINDS)
    const n = this.graves.indexOf(g)
    const zb = s._extraZombie?.(g.x, g.y, g.z, n % 2 && kinds.length ? kinds[n % kinds.length] : null)
    if (!zb) return
    zb.frozen = RISE_S
    this.yard.risen.push(zb)
  }

  // A loot chest was opened (BuildSurvival.useChest): the coffin has more.
  onChest(key) {
    const yd = this.yard
    if (!yd || !yd.cleared || yd.looted || key !== this.chest) return
    yd.looted = true
    const s = this.s
    s.coins = (s.coins || 0) + GRAVE_COINS
    s._renderHud?.()
    s._message(t('graveLoot', { n: GRAVE_COINS }), 5)
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
    this._mist = null
    this.yard = null
    this.graves = []
    this.chest = ''
  }
}
