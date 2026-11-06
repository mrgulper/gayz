// The Vault Heist (2026-11-06, Gaymi's idea list 7: "sneak into a bank
// vault past sleeping zombie guards and grab the gold. If you're too loud,
// they wake up"). Owned by BuildSurvival (`s.heist`); a world event
// (WorldEvents 'heist') on every map, in your own games.
//
// - A stone bank with quartz pillars and a BANK sign appears NEAR..FAR
//   blocks away (real blocks, put back afterwards - TempBlocks.js). At the
//   back, behind iron walls, is the vault: gold blocks and a loot chest.
// - GUARDS zombie guards sleep inside (frozen, with a floating Zzz). Near
//   the bank a Noise meter shows how loud you are: running fills it fast,
//   walking slowly, crouching not at all; every shot adds SHOT_NOISE; it
//   drains when you're quiet. Fill it and the alarm goes off: the guards
//   wake up and ALARM_EXTRA more come running in.
// - The vault's chest holds HEIST_COINS coins on top of the usual loot -
//   STEALTH_X times as much if every guard is still asleep when you open it.
// - After LIFE seconds the bank fades away.
// Meshes and a little HUD bar, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { TempBlocks } from './TempBlocks.js'
import { makeLabel } from './CampTrophies.js'

export const GUARDS = 4
export const HEIST_COINS = 120
export const STEALTH_X = 2
export const SHOT_NOISE = 40
export const ALARM_EXTRA = 3
export const LIFE = 300
const RUN_NOISE = 22 // per second
const WALK_NOISE = 7
const QUIET = 14 // drained per second when still or crouching
const W = 13 // along x
const D = 11 // along z (the door at z0, the vault at the back)
const H = 5
const NEAR = 18
const FAR = 30
const NOISE_R = 9 // how close to the bank your noise counts

export class Heist {
  constructor(survival) {
    this.s = survival
    this.cells = new TempBlocks(survival)
    this.bank = null
    this.chest = ''
    this.noiseLevel = 0
  }

  get B() {
    return this.s.B
  }

  possible() {
    const s = this.s
    return !this.bank && !s.td && !s.escape && !s.party && !s.moon?.on && !(s.net && !s.net.isHost)
  }

  event(me) {
    if (this.bank) return null
    const s = this.s
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2
      const d = NEAR + Math.random() * (FAR - NEAR)
      const x0 = Math.floor(me.x + Math.cos(a) * d)
      const z0 = Math.floor(me.z + Math.sin(a) * d)
      const y0 = this._flat(x0, z0, me.y)
      if (y0 === null) continue
      this.build(x0, y0, z0)
      s._message(t('heistAppears'), 5)
      try { audioEngine.playSpecial?.('dingdong') } catch { /* no audio */ }
      return { update: (dt) => this._update(dt), dispose: () => this.clear() }
    }
    return null
  }

  _flat(x0, z0, nearY) {
    const s = this.s
    let lo = Infinity
    let hi = -Infinity
    for (let x = x0; x < x0 + W; x += 2) {
      for (let z = z0; z < z0 + D; z += 2) {
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

  // y0: the floor (the first air cell over the ground).
  build(x0, y0, z0) {
    const put = (x, y, z, type) => this.cells.put(x0 + x, y0 + y, z0 + z, type)
    const hole = (x, y, z) => this.cells.clear(x0 + x, y0 + y, z0 + z)
    const NX = W - 1
    const NZ = D - 1
    for (let x = 0; x <= NX; x++) for (let z = 0; z <= NZ; z++) {
      for (let y = -2; y <= -1; y++) put(x, y, z, 'stonebricks')
      for (let y = 0; y <= H + 2; y++) hole(x, y, z)
      put(x, -1, z, (x + z) % 2 ? 'polishedandesite' : 'quartz')
      put(x, H, z, 'stonebricks')
      const edge = x === 0 || z === 0 || x === NX || z === NZ
      if (!edge) continue
      for (let y = 0; y < H; y++) {
        // The door: two wide in the middle of the front.
        if (z === 0 && (x === 6 || x === 5) && y < 3) continue
        const win = y === 2 && (x === 2 || x === NX - 2) && z === 0
        put(x, y, z, win ? 'glass' : y === H - 1 ? 'chiseledstonebricks' : 'stonebricks')
      }
    }
    // Quartz pillars by the door.
    for (const x of [3, NX - 3]) for (let y = 0; y < H; y++) put(x, y, -1, 'quartz')
    // The vault: iron walls round the back, an opening in the middle.
    const vz = NZ - 4
    for (let x = 3; x <= NX - 3; x++) for (let y = 0; y < H; y++) {
      if ((x === 6 || x === 5) && y < 2) continue
      put(x, y, vz, 'iron')
    }
    for (let z = vz; z < NZ; z++) for (let y = 0; y < H; y++) {
      put(3, y, z, 'iron')
      put(NX - 3, y, z, 'iron')
    }
    // Gold stacked inside, and the chest.
    for (const [x, z] of [[4, NZ - 1], [8, NZ - 1], [4, NZ - 2]]) put(x, 0, z, 'gold')
    put(8, 1, NZ - 1, 'gold')
    put(6, 0, NZ - 1, 'lootchest')
    this.chest = this.s.bm._key(x0 + 6, y0, z0 + NZ - 1)
    // Desks in the hall.
    for (const x of [2, NX - 2]) put(x, 0, 4, 'spruceplanks')
    this.bank = { x0, y0, z0, left: LIFE, alarm: false, guards: [], looted: false }
    this.noiseLevel = 0
    this._meshes()
    const s = this.s
    const spots = [[2.5, 2.5], [NX - 1.5, 2.5], [2.5, 6.5], [NX - 1.5, 6.5]]
    for (const [x, z] of spots.slice(0, GUARDS)) {
      const zb = s._extraZombie?.(x0 + x, y0, z0 + z, null)
      if (!zb) continue
      zb.frozen = 1e6
      zb.asleep = true
      this.bank.guards.push(zb)
    }
  }

  _meshes() {
    const B = this.B
    const b = this.bank
    const g = new THREE.Group()
    const sign = makeLabel(t('heistSign'), 512, 60, '#ffd23f')
    sign.scale.set(4 * B, 0.7 * B, 1)
    sign.position.set((b.x0 + W / 2) * B, (b.y0 + H + 1.2) * B, (b.z0 - 0.6) * B)
    g.add(sign)
    this._zzz = []
    this._group = g
    this.s.bm.scene.add(g)
  }

  inside(p) {
    const b = this.bank
    return !!b && p.x > b.x0 - NOISE_R && p.x < b.x0 + W + NOISE_R && p.z > b.z0 - NOISE_R && p.z < b.z0 + D + NOISE_R && Math.abs(p.y - b.y0) < 6
  }

  // A loud thing happened (BuildSurvival.shoot).
  noise(n) {
    const b = this.bank
    if (!b || b.alarm || !this.inside(this.s.bodyPos())) return
    this.noiseLevel = Math.min(100, this.noiseLevel + n)
    if (this.noiseLevel >= 100) this._alarm()
  }

  _update(dt) {
    const b = this.bank
    if (!b) return false
    const s = this.s
    b.left -= dt
    const me = s.bodyPos()
    const near = this.inside(me)
    if (!b.alarm && near && !s.dead) {
      const tm = s.bm.tryMode
      // Walking is 4 blocks a second, running 7, crouching 2.
      const speed = Math.hypot(tm.vel?.x || 0, tm.vel?.z || 0)
      const loud = tm._crouch || speed < 0.6 ? 0 : speed > 5.5 ? RUN_NOISE : WALK_NOISE
      this.noiseLevel = loud ? Math.min(100, this.noiseLevel + loud * dt) : Math.max(0, this.noiseLevel - QUIET * dt)
      if (!this._toldNoise) {
        this._toldNoise = true
        s._message(t('heistQuiet'), 5)
      }
    } else if (!b.alarm) this.noiseLevel = Math.max(0, this.noiseLevel - QUIET * dt)
    if (!b.alarm && this.noiseLevel >= 100) this._alarm()
    this._drawZzz()
    this._hud(near && !b.alarm)
    if (b.left <= 0) {
      s._message(t('heistFades'), 4)
      return false
    }
    return true
  }

  _alarm() {
    const b = this.bank
    const s = this.s
    b.alarm = true
    for (const zb of b.guards) {
      zb.frozen = 0
      zb.asleep = false
    }
    for (let i = 0; i < ALARM_EXTRA; i++) {
      const zb = s._extraZombie?.(b.x0 + 5.5 + i * 0.6, b.y0, b.z0 - 2.5, null)
      if (zb) b.guards.push(zb)
    }
    s._message(t('heistAlarm'), 4)
    try {
      audioEngine.playSpecial?.('siren')
      audioEngine.playSpecial?.('warn')
    } catch { /* no audio */ }
  }

  // A floating Zzz over each sleeping guard.
  _drawZzz() {
    const B = this.B
    const s = this.s
    const asleep = (this.bank?.guards || []).filter((zb) => zb.asleep && zb.health > 0 && s.zombies.includes(zb))
    while (this._zzz.length < asleep.length) {
      const sp = makeLabel('Zzz', 128, 40, '#bcd8ff')
      sp.scale.set(0.9 * B, 0.3 * B, 1)
      this._group.add(sp)
      this._zzz.push(sp)
    }
    const now = performance.now() / 1000
    this._zzz.forEach((sp, i) => {
      const zb = asleep[i]
      sp.visible = !!zb
      if (zb) sp.position.set(zb.x * B, (zb.y + 2.4 + Math.sin(now * 2 + i) * 0.12) * B, zb.z * B)
    })
  }

  _hud(on) {
    let el = this._el
    if (!el && on) {
      el = this._el = document.createElement('div')
      el.id = 'heist-noise'
      el.innerHTML = '<span></span><div class="heist-track"><i></i></div>'
      document.body.appendChild(el)
    }
    if (!el) return
    el.style.display = on ? 'flex' : 'none'
    if (!on) return
    el.firstChild.textContent = t('heistNoise')
    const bar = el.querySelector('i')
    bar.style.width = `${Math.round(this.noiseLevel)}%`
    bar.classList.toggle('loud', this.noiseLevel > 70)
  }

  // A loot chest was opened (BuildSurvival.useChest): the vault's.
  onChest(key) {
    const b = this.bank
    if (!b || b.looted || key !== this.chest) return
    b.looted = true
    const s = this.s
    const sneaky = !b.alarm && b.guards.every((zb) => zb.asleep || !s.zombies.includes(zb))
    const n = HEIST_COINS * (sneaky ? STEALTH_X : 1)
    s.coins = (s.coins || 0) + n
    s._renderHud?.()
    s._message(t(sneaky ? 'heistLootSneaky' : 'heistLoot', { n }), 5)
    try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
  }

  clear() {
    this.cells.restore()
    for (const zb of this.bank?.guards || []) {
      if (zb.asleep) zb.frozen = 0
      zb.asleep = false
    }
    this._group?.removeFromParent()
    this._group?.traverse((o) => {
      if (!o.isMesh && !o.isSprite) return
      o.geometry?.dispose?.()
      o.material.map?.dispose?.()
      o.material.dispose()
    })
    this._group = null
    this._zzz = []
    this.bank = null
    this.chest = ''
    this.noiseLevel = 0
    this._toldNoise = false
    if (this._el) this._el.style.display = 'none'
  }
}
