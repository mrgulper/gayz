// The Haunted House (2026-11-02, Gaymi's idea list 6: "a random spooky
// mansion that appears at night, with flickering ghosts, jump scares and
// loot in the attic"). Owned by BuildSurvival (`s.haunted`); a world event
// (WorldEvents 'haunted') that only comes at night (possible()), on every
// map.
//
// A dark wooden mansion (real blocks, SIZE x SIZE, two floors and an
// attic under a steep roof) appears NEAR..FAR blocks away, with a purple
// glow over it so you can find it. Stairs inside go up floor by floor.
// GHOSTS see-through ghosts drift about the rooms, flickering; come too
// close to one and it screams in your face (a jump scare) and vanishes, to
// turn up again somewhere else in the house. Skeletons wander the halls
// (not part of the wave; only where the game runs). The attic's chest is a
// loot chest that also holds HAUNT_COINS coins and a potion. At dawn (or
// after HOUSE_LIFE seconds) the house fades away (TempBlocks.js).
// Meshes only, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { TempBlocks } from './TempBlocks.js'
import { SKELETON_KINDS } from './SkeletonModels.js'

export const SIZE = 9
export const GHOSTS = 5
export const HOUSE_LIFE = 300
export const HAUNT_COINS = 100
export const SKELETONS = 2
const NEAR = 20
const FAR = 32
const SCARE_R = 2
const SCARE_CD = 5
const NIGHT = 0.5

export class HauntedHouse {
  constructor(survival) {
    this.s = survival
    this.cells = new TempBlocks(survival)
    this.house = null
    this.chest = ''
  }

  get B() {
    return this.s.B
  }

  // Night, and no house yet?
  possible() {
    const s = this.s
    if (this.house || s.td || s.escape || s.party || s.moon?.on) return false
    return (s.bm.sky?.nightAmount?.() ?? 0) > NIGHT
  }

  // The world event: the house appears. -> a run, or null.
  event(me) {
    if (this.house) return null
    const s = this.s
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2
      const d = NEAR + Math.random() * (FAR - NEAR)
      const x0 = Math.floor(me.x + Math.cos(a) * d)
      const z0 = Math.floor(me.z + Math.sin(a) * d)
      const y0 = this._flat(x0, z0, me.y)
      if (y0 === null) continue
      this.build(x0, y0, z0)
      s._message(t('hauntAppears'), 5)
      try { audioEngine.playSpecial?.('echo') } catch { /* no audio */ }
      return { update: (dt) => this._update(dt), dispose: () => this.clear() }
    }
    return null
  }

  // The floor's y if the ground under the house is roughly flat (within 2
  // blocks) and dry, else null.
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

  build(x0, y0, z0) {
    const N = SIZE - 1
    const put = (x, y, z, type) => this.cells.put(x0 + x, y0 + y, z0 + z, type)
    const hole = (x, y, z) => this.cells.clear(x0 + x, y0 + y, z0 + z)
    // A foundation down to the ground, then the floors.
    for (let x = 0; x <= N; x++) for (let z = 0; z <= N; z++) {
      for (let y = -1; y >= -3; y--) if (!this.s.bm.getBlockAt(x0 + x, y0 + y, z0 + z)) put(x, y, z, 'cobblestone')
      put(x, 0, z, 'darkoakplanks')
      for (let y = 1; y <= 12; y++) hole(x, y, z)
    }
    // Two storeys of walls (1-4 and 6-8), windows, a door.
    for (let x = 0; x <= N; x++) for (let z = 0; z <= N; z++) {
      const edge = x === 0 || z === 0 || x === N || z === N
      const corner = (x === 0 || x === N) && (z === 0 || z === N)
      if (!edge) continue
      for (let y = 1; y <= 8; y++) {
        if (y === 5) continue
        const along = x === 0 || x === N ? z : x
        const win = (y === 2 || y === 3 || y === 7) && along % 3 === 1 && !corner
        const door = z === 0 && x === 4 && y <= 2
        if (door) continue
        put(x, y, z, corner ? 'darkoaklog' : win ? 'tintedglass' : 'spruceplanks')
      }
    }
    // The upper floor (y 5) and the attic floor (y 9), with stairwells.
    for (let x = 0; x <= N; x++) for (let z = 0; z <= N; z++) {
      if (!(x >= 6 && x <= 7 && z >= 3 && z <= 5)) put(x, 5, z, 'darkoakplanks')
      if (!(x >= 1 && x <= 2 && z >= 4 && z <= 6)) put(x, 9, z, 'darkoakplanks')
    }
    // Stairs: up along x 7 to the upper floor, along x 1 to the attic.
    for (let k = 0; k < 4; k++) put(7, 1 + k, 2 + k, 'darkoakplanks')
    for (let k = 0; k < 3; k++) put(1, 6 + k, 7 - k, 'darkoakplanks')
    // The steep roof over the attic.
    for (let k = 0; k <= 4; k++) for (let x = k; x <= N - k; x++) for (let z = k; z <= N - k; z++) {
      if (x === k || z === k || x === N - k || z === N - k) put(x, 10 + k, z, 'deepslatetiles')
    }
    // Furniture: bookshelves downstairs, pumpkins, the attic chest.
    for (let x = 2; x <= 5; x++) put(x, 1, N - 1, 'bookshelf')
    put(1, 1, 1, 'jackolantern')
    put(N - 1, 6, N - 1, 'jackolantern')
    put(4, 10, 4, 'lootchest')
    put(5, 10, 5, 'jackolantern')
    this.chest = this.s.bm._key(x0 + 4, y0 + 10, z0 + 4)
    this.house = { x0, y0, z0, left: HOUSE_LIFE, looted: false, scareCd: 0 }
    this._meshes()
    // Skeletons in the halls.
    const s = this.s
    if (!s.net || s.net.isHost) {
      const kinds = Object.keys(SKELETON_KINDS)
      for (let i = 0; i < SKELETONS; i++) s._extraZombie?.(x0 + 2.5 + i * 3, y0 + (i ? 6 : 1), z0 + 3.5, kinds.length ? kinds[i % kinds.length] : null)
    }
  }

  // Ghosts and the purple glow over the roof.
  _meshes() {
    const B = this.B
    const h = this.house
    const g = new THREE.Group()
    this.ghosts = []
    for (let i = 0; i < GHOSTS; i++) {
      const ghost = new THREE.Group()
      const sheet = new THREE.MeshBasicMaterial({ color: 0xeef2ff, transparent: true, opacity: 0.5, depthWrite: false })
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.8 * B, 1.3 * B, 0.6 * B), sheet)
      body.position.y = 0.65 * B
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.7 * B, 0.6 * B, 0.6 * B), sheet)
      head.position.y = 1.6 * B
      const eyes = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.8 })
      for (const x of [-0.15, 0.15]) {
        const e = new THREE.Mesh(new THREE.BoxGeometry(0.12 * B, 0.18 * B, 0.02 * B), eyes)
        e.position.set(x * B, 1.65 * B, 0.31 * B)
        ghost.add(e)
      }
      ghost.add(body, head)
      g.add(ghost)
      this.ghosts.push({ mesh: ghost, sheet, eyes, ...this._ghostSpot(), t: Math.random() * 10 })
    }
    const glow = new THREE.Mesh(new THREE.BoxGeometry(SIZE * B, 30 * B, SIZE * B), new THREE.MeshBasicMaterial({ color: 0x9a4aff, transparent: true, opacity: 0.08, depthWrite: false }))
    glow.position.set((h.x0 + SIZE / 2) * B, (h.y0 + 30) * B, (h.z0 + SIZE / 2) * B)
    g.add(glow)
    this._group = g
    this.s.bm.scene.add(g)
  }

  // Somewhere inside: a floor (0, 5 or 9 up) and a spot on it.
  _ghostSpot() {
    const h = this.house
    const floor = [0, 5, 9][Math.floor(Math.random() * 3)]
    return { x: h.x0 + 1.5 + Math.random() * (SIZE - 3), y: h.y0 + floor + 1.3, z: h.z0 + 1.5 + Math.random() * (SIZE - 3) }
  }

  _update(dt) {
    const h = this.house
    if (!h) return false
    const s = this.s
    h.left -= dt
    h.scareCd -= dt
    const B = this.B
    const me = s.bodyPos()
    for (const gh of this.ghosts) {
      gh.t += dt
      gh.x += Math.sin(gh.t * 0.7) * dt * 0.6
      gh.z += Math.cos(gh.t * 0.5) * dt * 0.6
      // Flicker.
      const on = Math.sin(gh.t * 13) + Math.sin(gh.t * 3.1) > -0.4
      gh.sheet.opacity = on ? 0.35 + Math.sin(gh.t * 2) * 0.12 : 0.05
      gh.eyes.opacity = on ? 0.8 : 0.1
      gh.mesh.position.set(gh.x * B, (gh.y + Math.sin(gh.t * 2) * 0.15) * B, gh.z * B)
      gh.mesh.rotation.y = Math.atan2(me.x - gh.x, me.z - gh.z)
      if (h.scareCd <= 0 && !s.dead && Math.hypot(me.x - gh.x, me.z - gh.z) < SCARE_R && Math.abs(me.y + 1 - gh.y) < 1.6) {
        h.scareCd = SCARE_CD
        this._scare()
        Object.assign(gh, this._ghostSpot())
      }
    }
    const day = (s.bm.sky?.nightAmount?.() ?? 1) < 0.15
    if (h.left <= 0 || day) {
      s._message(t('hauntFades'), 4)
      return false
    }
    return true
  }

  // A ghost face fills the screen for a moment, with a scream.
  _scare() {
    const s = this.s
    let el = this._scareEl
    if (!el) {
      el = this._scareEl = document.createElement('div')
      el.id = 'haunt-scare'
      el.innerHTML = '<div class="haunt-face"><i></i><i></i><b></b></div>'
      document.body.appendChild(el)
    }
    el.classList.remove('on')
    void el.offsetWidth
    el.classList.add('on')
    clearTimeout(this._scareT)
    this._scareT = setTimeout(() => el.classList.remove('on'), 700)
    try {
      audioEngine.playSpecial?.('shout')
      audioEngine.playSpecial?.('warn')
    } catch { /* no audio */ }
    s._message(t('hauntBoo'), 2)
  }

  // A loot chest was opened (BuildSurvival.useChest): the attic's has more.
  onChest(key) {
    const h = this.house
    if (!h || h.looted || key !== this.chest) return
    h.looted = true
    const s = this.s
    s.coins = (s.coins || 0) + HAUNT_COINS
    s.inv?.add({ kind: 'item', id: Math.random() < 0.5 ? 'potionInvis' : 'potionSpeed', n: 1 })
    s._renderHud?.()
    s._message(t('hauntLoot', { n: HAUNT_COINS }), 5)
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
    this.ghosts = []
    this.house = null
    this.chest = ''
    this._scareEl?.classList.remove('on')
  }
}
