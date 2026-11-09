// Skateboards and ice skating (2026-11-02, Gaymi's idea list 5: "do
// tricks on ramps, and frozen lakes in winter become slippery and fast").
//
// - Skateboard: crafted. Hold it and use it to hop on (use again, or put
//   it away, to step off). On it you roll BOARD_SPEED x faster and glide
//   (less grip). Rolling fast up a stair or slab (a ramp) launches you
//   into the air (RAMP_MIN speed). In the air, press Jump for a trick
//   (kickflip, heelflip, shove-it or a 360, TRICK_S each); land them all
//   for TRICK_COINS coins each. Land in the middle of one and you bail.
// - Ice: walking on ice or packed ice is slippery and fast (ICE_SPEED,
//   ICE_GRIP), with or without a board. In winter (Snowballs.winterOn,
//   Settings > Snowballs All Year too) still water round you freezes over
//   (FREEZE_R blocks): lakes, ponds and rivers (never the sea, so boats
//   still sail) with air on top turn to ice while you're near, and back
//   into water when the game ends.
//
// Each player's own (others don't see your board). Meshes only, never a
// light. Owned by BuildSurvival (`s.skate`); BuildTryMode asks mods() for
// speed and grip and calls ramp() when you step up while rolling.
import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'
import { winterOn } from './Snowballs.js'
import { sampleLand } from './OpenWorld.js'
import { TempBlocks } from './TempBlocks.js'

export const BOARD_SPEED = 1.7
const BOARD_GRIP = 0.35
export const ICE_SPEED = 1.35
const ICE_GRIP = 0.12
const RAMP_MIN = 6 // blocks/s
const RAMP_UP = 9
export const TRICK_S = 0.45
export const TRICK_COINS = 2
export const FREEZE_R = 12
const FREEZE_EVERY = 0.5
const FREEZE_MAX = 4000
const TRICKS = ['kickflip', 'heelflip', 'shuvit', 'spin360']
const ICE = new Set(['ice', 'packedice'])

export class Skateboards {
  constructor(survival) {
    this.s = survival
    this.on = false
    this.mesh = null
    this.trick = null
    this.landed = []
    this._air = false
    this._jumpWas = false
    this._freezeIn = 0
    this._frozen = new TempBlocks(survival)
  }

  get holding() {
    const it = this.s.inv?.selected()
    return it?.kind === 'item' && it.id === 'skateboard'
  }

  // Used (PlayInventory.useHeld): on or off. Never used up.
  use() {
    const s = this.s
    if (!s.active || s.dead) return
    if (this.on) return this.off()
    this.on = true
    this._build()
    s._message(t('skateOn'), 3)
    s.bingo?.note('ride')
    try { audioEngine.playSpecial?.('clank') } catch { /* no audio */ }
  }

  off() {
    if (!this.on) return
    this.on = false
    this.trick = null
    this.landed = []
    this.mesh?.removeFromParent()
    disposeGroup(this.mesh)
    this.mesh = null
  }

  // The block under your feet.
  _under(p) {
    return this.s.bm.getBlockAt(Math.floor(p.x), Math.floor(p.y - 0.05), Math.floor(p.z))
  }

  // BuildTryMode._walk: how much faster you go and how much grip you have.
  mods(onGround, p) {
    const ice = onGround && ICE.has(this._under(p))
    if (this.on && onGround) return ice ? { speed: BOARD_SPEED * 1.1, grip: ICE_GRIP } : { speed: BOARD_SPEED, grip: BOARD_GRIP }
    if (ice) return { speed: ICE_SPEED, grip: ICE_GRIP }
    return null
  }

  // BuildTryMode._walk: you just stepped up a stair or slab on the ground.
  ramp(tm) {
    if (!this.on) return
    const speed = Math.hypot(tm.vel.x, tm.vel.z)
    if (speed < RAMP_MIN) return
    tm.vel.y = Math.max(tm.vel.y, RAMP_UP + (speed - RAMP_MIN) * 0.4)
    tm.onGround = false
    try { audioEngine.playSpecial?.('whoosh') } catch { /* no audio */ }
  }

  update(dt) {
    const s = this.s
    if (!s.active) return
    if (this.on && (s.dead || s.spectating || !this.holding || s.vehicles?.riding || s.kart?.driving)) this.off()
    this._freeze(dt)
    if (!this.on) return
    const tm = s.bm.tryMode
    const jump = !!tm._spaceWasDown
    if (!tm.onGround) {
      this._air = true
      // Jump in the air: a trick (one at a time).
      if (jump && !this._jumpWas && !this.trick) {
        this.trick = { kind: TRICKS[Math.floor(Math.random() * TRICKS.length)], t: 0 }
        try { audioEngine.playSpecial?.('pop') } catch { /* no audio */ }
      }
      if (this.trick) {
        this.trick.t += dt
        if (this.trick.t >= TRICK_S) {
          this.landed.push(this.trick.kind)
          this.trick = null
        }
      }
    } else if (this._air) {
      this._air = false
      this._land()
    }
    this._jumpWas = jump
    this._draw()
  }

  _land() {
    const s = this.s
    if (this.trick) {
      s._message(t('skateBail'), 2)
      try { audioEngine.playSpecial?.('thud') } catch { /* no audio */ }
    } else if (this.landed.length) {
      const coins = this.landed.length * TRICK_COINS
      s.coins = (s.coins || 0) + coins
      s._renderHud?.()
      s._message(t('skateTricks', { tricks: this.landed.map((k) => t(`skateTrick_${k}`)).join(' + '), n: coins }), 2.5)
      try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
    }
    this.trick = null
    this.landed = []
  }

  // A wooden deck with a grip-tape top and four wheels.
  _build() {
    const B = this.s.B
    const g = new THREE.Group()
    const box = (w, h, d, color, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), new THREE.MeshLambertMaterial({ color }))
      m.position.set(x * B, y * B, z * B)
      g.add(m)
      return m
    }
    box(0.42, 0.05, 1.1, 0xc8743a, 0, 0.12, 0)
    box(0.4, 0.01, 1.0, 0x2a2a2a, 0, 0.15, 0)
    box(0.3, 0.04, 0.12, 0xb8b8c0, 0, 0.08, 0.35)
    box(0.3, 0.04, 0.12, 0xb8b8c0, 0, 0.08, -0.35)
    for (const x of [-0.17, 0.17]) for (const z of [-0.35, 0.35]) box(0.08, 0.1, 0.1, 0xf2e15a, x, 0.05, z)
    this.mesh = g
    this.s.bm.scene.add(g)
  }

  _draw() {
    const m = this.mesh
    if (!m) return
    const B = this.s.B
    const p = this.s.bm.tryMode.pos
    m.position.set(p.x * B, p.y * B, p.z * B)
    const yaw = this.s.bm._yaw
    m.rotation.set(0, yaw, 0)
    const tr = this.trick
    if (!tr) return
    const f = Math.min(1, tr.t / TRICK_S) * Math.PI * 2
    if (tr.kind === 'kickflip') m.rotateZ(f)
    else if (tr.kind === 'heelflip') m.rotateZ(-f)
    else if (tr.kind === 'shuvit') m.rotateY(f / 2)
    else m.rotateY(f)
  }

  // --- frozen lakes ---

  get winter() {
    return winterOn(this.s.bm.game?.settings)
  }

  _freeze(dt) {
    const s = this.s
    if (!this.winter || s.td || this._frozen.size >= FREEZE_MAX) return
    this._freezeIn -= dt
    if (this._freezeIn > 0) return
    this._freezeIn = FREEZE_EVERY
    const bm = s.bm
    const p = bm.tryMode.pos
    const y0 = Math.floor(p.y)
    for (let x = Math.floor(p.x) - FREEZE_R; x <= p.x + FREEZE_R; x++) {
      for (let z = Math.floor(p.z) - FREEZE_R; z <= p.z + FREEZE_R; z++) {
        if (Math.hypot(x - p.x, z - p.z) > FREEZE_R) continue
        if (bm.world?.active && /cean$/.test(sampleLand(x, z)?.biome || '')) continue
        for (let y = y0 + 1; y >= y0 - 4; y--) {
          if (bm.getBlockAt(x, y, z) !== 'water' || bm.getBlockAt(x, y + 1, z)) continue
          this._frozen.put(x, y, z, 'ice')
          break
        }
      }
    }
  }

  // The ice goes back to water (the saved map never changes).
  _thaw() {
    this._frozen.restore()
  }

  clear() {
    this.off()
    this._thaw()
    this._air = false
  }
}

function disposeGroup(g) {
  g?.traverse((o) => {
    if (!o.isMesh) return
    o.geometry.dispose()
    o.material.dispose()
  })
}
