// Zombies with personalities (2026-10-31, Gaymi's "zombie types with
// personalities" idea: "a sneaky one that hides in bushes, one that
// screams and calls the others, and a fat one that bursts into slime").
// The kinds themselves (looks, hp, speed) are in ZombieKinds.js; this is
// what they do, run by BuildSurvival for each zombie every frame:
//
// - screamer (`scream`): when it spots you within SCREAM_SEE blocks it
//   stops, tips its head back and screams for SCREAM_TIME seconds. Every
//   zombie within SCREAM_CALL blocks is "called": it rushes straight at
//   you (no flanking) CALLED_MULT times faster for CALLED_TIME seconds.
//   It screams again every SCREAM_EVERY seconds while it lives - kill it
//   first.
// - lurker (`hides`): creeps up crouched and slow, almost invisible -
//   fainter still in cover (on grass, or by leaves). Now and then a few
//   leaves rustle off it (the hint that it's there). Within POUNCE_RANGE
//   blocks, or when hit, it leaps out: fully seen, POUNCE_MULT times
//   faster for POUNCE_TIME seconds, then an ordinary quick zombie.
// - bloater (`slime`): its burst leaves a slime puddle SLIME_RADIUS blocks
//   round for SLIME_TIME seconds; standing in one slows you to SLIME_SLOW.
//
// On a server the host runs all of this; the others are sent each
// zombie's hidden / screaming state (zombieSnapshot `hd` / `ys`) and only
// draw it (look()). The puddles, like the burst itself, are the host's.
import * as THREE from 'three'
import { MONSTER_KINDS } from './ZombieKinds.js'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

const SCREAM_SEE = 18
const SCREAM_CALL = 30
const SCREAM_TIME = 1.4
const SCREAM_EVERY = 12
const CALLED_TIME = 6
const CALLED_MULT = 1.4
const POUNCE_RANGE = 4
const POUNCE_TIME = 0.7
const POUNCE_MULT = 2.6
const POUNCE_JUMP = 7
const HIDE_PACE = 0.55
// How see-through a hidden lurker is: in cover, out of it.
const HIDE_COVER = 0.1
const HIDE_OPEN = 0.3
// A crouched lurker's height (times standing).
const CROUCH = 0.6
const SLIME_RADIUS = 2
const SLIME_TIME = 8
const SLIME_FADE = 2
const SLIME_SLOW = 0.5
const COVER_BLOCKS = /grass|leaves/

let slimeTex = null
// The puddle's picture: a round blob of greens, see-through round the edge.
function slimePicture() {
  if (slimeTex) return slimeTex
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const g = c.getContext('2d')
  const greens = ['#7aa84a', '#6b9a3e', '#8bbf55', '#5a8a35', '#9ccf66']
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5)
      // A wobbly edge so it isn't a perfect circle.
      if (d > 7 + Math.sin(Math.atan2(y - 7.5, x - 7.5) * 5) * 0.8) continue
      g.fillStyle = greens[(x * 7 + y * 13) % greens.length]
      g.fillRect(x, y, 1, 1)
    }
  }
  slimeTex = new THREE.CanvasTexture(c)
  slimeTex.magFilter = THREE.NearestFilter
  slimeTex.minFilter = THREE.NearestFilter
  slimeTex.generateMipmaps = false
  slimeTex.colorSpace = THREE.SRGBColorSpace
  return slimeTex
}

export class ZombieTricks {
  constructor(survival) {
    this.s = survival
    this._puddles = []
    // My walking speed, times this (a slime puddle underfoot) - read by
    // BuildTryMode.
    this.slow = 1
  }

  // One zombie's trick for this frame (the host / alone). player: who
  // it's after. -> its speed multiplier.
  tick(zb, dt, player) {
    const kind = MONSTER_KINDS[zb.kind]
    let pace = 1
    if (zb.called > 0) {
      zb.called -= dt
      zb.flank = 0
      pace *= CALLED_MULT
    }
    if (kind?.scream) pace *= this._screamer(zb, dt, player)
    if (kind?.hides) pace *= this._lurker(zb, dt, player)
    this.look(zb, dt)
    return pace
  }

  _screamer(zb, dt, player) {
    zb.screamCd = (zb.screamCd ?? 1.5) - dt
    if (zb.yell > 0) {
      zb.yell -= dt
      // It stands still to scream.
      return 0
    }
    const d = Math.hypot(player.x - zb.x, player.z - zb.z)
    if (player.idle || zb.screamCd > 0 || d > SCREAM_SEE || Math.abs(player.y - zb.y) > 6) return 1
    zb.yell = SCREAM_TIME
    zb.screamCd = SCREAM_EVERY
    audioEngine.playZombieScream?.(this.s._panTo(zb.x, zb.z))
    for (const o of this.s.zombies) {
      if (o === zb || o.health <= 0) continue
      if (Math.hypot(o.x - zb.x, o.z - zb.z) < SCREAM_CALL) o.called = CALLED_TIME
    }
    if (!player.remote) this.s._message(t('buildPlayScreamerCalled'))
    return 0
  }

  _lurker(zb, dt, player) {
    if (zb.hidden === undefined) zb.hidden = true
    if (zb.hidden) {
      const d = Math.hypot(player.x - zb.x, player.z - zb.z)
      // Hit by something (a shot, a blast - BuildSurvival.damageZombie;
      // not sunburn, or every lurker would leap out by day).
      if (zb.hit || (!player.idle && d < POUNCE_RANGE && Math.abs(player.y - zb.y) < 2)) {
        zb.hidden = false
        zb.pounce = POUNCE_TIME
        if (zb.onGround) {
          zb.vy = POUNCE_JUMP
          zb.onGround = false
        }
        audioEngine.playZombieMoan?.(1.3, this.s._panTo(zb.x, zb.z))
        return POUNCE_MULT
      }
      // Is it in cover? (Checked twice a second - reading blocks.)
      if ((zb._coverIn = (zb._coverIn || 0) - dt) <= 0) {
        zb._coverIn = 0.5
        zb.cover = this._inCover(zb)
      }
      // The hint: now and then a few leaves rustle off it.
      if ((zb._rustle = (zb._rustle ?? 1 + Math.random() * 3) - dt) <= 0) {
        zb._rustle = 2.5 + Math.random() * 2
        this._rustle(zb)
      }
      return HIDE_PACE
    }
    if (zb.pounce > 0) {
      zb.pounce -= dt
      return POUNCE_MULT
    }
    return 1
  }

  // Grass underfoot, or leaves round its body.
  _inCover(zb) {
    const bm = this.s.bm
    const x = Math.floor(zb.x)
    const y = Math.floor(zb.y + 0.01)
    const z = Math.floor(zb.z)
    if (COVER_BLOCKS.test(bm.getBlockAt(x, y - 1, z) || '')) return true
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const dy of [0, 1]) if (/leaves/.test(bm.getBlockAt(x + dx, y + dy, z + dz) || '')) return true
    }
    return false
  }

  _rustle(zb) {
    const B = this.s.B
    for (let i = 0; i < 4; i++) {
      this.s._fx?.leaf((zb.x + (Math.random() - 0.5) * 0.6) * B, (zb.y + 0.6 + Math.random() * 0.5) * B, (zb.z + (Math.random() - 0.5) * 0.6) * B)
    }
  }

  // Draw a zombie's trick (everyone, from zb.hidden / zb.yell or the
  // host's snapshot): a lurker's fade and crouch, a screamer's yell.
  look(zb, dt) {
    const m = zb.monster
    if (!m) return
    if (MONSTER_KINDS[zb.kind]?.scream) m.screaming = zb.yell > 0
    if (!MONSTER_KINDS[zb.kind]?.hides) return
    const hidden = zb.hidden !== false
    const want = hidden ? (zb.cover ? HIDE_COVER : HIDE_OPEN) : 1
    const k = 1 - Math.exp(-(hidden ? 3 : 12) * dt)
    zb.fade = zb.fade === undefined ? want : zb.fade + (want - zb.fade) * k
    for (const mat of m.materials) mat.opacity = zb.fade
    const crouch = hidden ? CROUCH : 1
    m.body.scale.y += (crouch * m.body.scale.x - m.body.scale.y) * k
    // No name tag, glow or shine to give it away while it hides.
    if (zb.glow) zb.glow.visible = !hidden
    if (zb.shineFx) zb.shineFx.visible = !hidden
  }

  // A bloater burst (BuildSurvival._burst): a slime puddle under it.
  burst(z) {
    if (!MONSTER_KINDS[z.kind]?.slime) return
    const B = this.s.B
    const ground = this.s._groundUnder?.(z.x, z.y + 0.5, z.z) ?? z.y
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(SLIME_RADIUS * 2 * B, SLIME_RADIUS * 2 * B),
      new THREE.MeshLambertMaterial({ map: slimePicture(), transparent: true, opacity: 0.85, depthWrite: false, alphaTest: 0.05 }),
    )
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(z.x * B, (ground + 0.03) * B, z.z * B)
    mesh.renderOrder = 2
    this.s.bm.scene.add(mesh)
    this._puddles.push({ x: z.x, y: ground, z: z.z, left: SLIME_TIME, mesh })
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * SLIME_RADIUS
      this.s._fx?.slime((z.x + Math.cos(a) * r) * B, (ground + 0.4) * B, (z.z + Math.sin(a) * r) * B)
    }
  }

  // Puddles fade away; one under me slows me down.
  update(dt) {
    this.slow = 1
    if (!this._puddles.length) return
    const me = this.s.dead ? null : this.s.bodyPos()
    for (const p of this._puddles) {
      p.left -= dt
      p.mesh.material.opacity = 0.85 * Math.min(1, p.left / SLIME_FADE)
      if (me && Math.hypot(me.x - p.x, me.z - p.z) < SLIME_RADIUS && Math.abs(me.y - p.y) < 1) this.slow = SLIME_SLOW
    }
    for (const p of this._puddles.filter((o) => o.left <= 0)) this._drop(p)
    this._puddles = this._puddles.filter((o) => o.left > 0)
  }

  _drop(p) {
    p.mesh.removeFromParent()
    p.mesh.geometry.dispose()
    p.mesh.material.dispose()
  }

  clear() {
    for (const p of this._puddles) this._drop(p)
    this._puddles = []
    this.slow = 1
  }
}
