// Shrink Ray (2026-11-27, six-ideas batch 6: "a rare loot gun that makes
// zombies tiny and squeaky for a few seconds"). Owned by BuildSurvival
// (`s.shrinkRay`).
//
// A rare find: now and then in a Loot Chest (CHEST_CHANCE) or a supply
// crate (CRATE_CHANCE, WorldEvents.js), only when you don't have one yet.
// Never used up: hold it and use it (click / the use button) to zap a
// beam straight ahead. The first zombie it reaches (walls stop it) shrinks
// to SHRINK_SIZE for SHRINK_S seconds - a boss or a big one only to
// BOSS_SIZE for BOSS_S. While tiny it squeaks instead of moaning, bites
// for SHRUNK_BITE of its bite and takes SHRUNK_HURT x the damage
// (BuildSurvival._updateZombie / damageZombie). Zapping a tiny one again
// starts its time over. The battery holds BATTERY zaps and refills by
// itself, one zap every RECHARGE_S seconds.
//
// Servers: the host's game shrinks the zombie, so everyone sees it tiny
// (snapshot `sk`). A guest's zap travels like a shot (PlayNet.queueShrink).
//
// `s.shrinkRay.lib` holds the numbers for tests.
import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'
import { showPill, hidePill } from './PlayPills.js'

export const SHRINK_S = 6
export const BOSS_S = 3
export const SHRINK_SIZE = 0.35
export const BOSS_SIZE = 0.6
export const SHRUNK_BITE = 1 / 3
export const SHRUNK_HURT = 2
export const BATTERY = 8
export const RECHARGE_S = 4
export const RANGE = 24 // blocks
export const CHEST_CHANCE = 0.03
export const CRATE_CHANCE = 0.15
const COOLDOWN_S = 0.35
const BEAM_S = 0.22
const SQUEAK_NEAR = 16 // blocks
const LIB = { SHRINK_S, BOSS_S, SHRINK_SIZE, BOSS_SIZE, SHRUNK_BITE, SHRUNK_HURT, BATTERY, RECHARGE_S, RANGE, CHEST_CHANCE, CRATE_CHANCE }

// A zombie's bite / damage taken while it's tiny.
export function shrunkBite(z) {
  return z?.shrunk > 0 ? SHRUNK_BITE : 1
}
export function shrunkHurt(z) {
  return z?.shrunk > 0 ? SHRUNK_HURT : 1
}

export class ShrinkRay {
  constructor(survival) {
    this.s = survival
    this.lib = LIB
    this.battery = BATTERY
    this._nextAt = 0
    this._beams = []
    this._mat = null
    this.pill = { show: showPill, hide: hidePill }
  }

  // A rare find for a chest or crate's loot: true = put one in.
  roll(bag, chance) {
    return !!bag && !bag.has('shrinkRay') && Math.random() < chance
  }

  // Zap. -> true when the beam went off (the gun itself is kept).
  zap() {
    const s = this.s
    const bm = s.bm
    const B = s.B
    if (!s.active || s.dead || performance.now() < this._nextAt) return false
    if (this.battery < 1) {
      s._message(t('shrinkEmpty'), 2.5)
      return false
    }
    this._nextAt = performance.now() + COOLDOWN_S * 1000
    this.battery -= 1
    bm.camera.updateMatrixWorld()
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(bm.camera.quaternion)
    const eye = bm.camera.position.clone()
    const { zombie, dist } = this.target(eye, dir)
    const from = eye.clone().addScaledVector(dir, 0.5 * B).add(new THREE.Vector3(0, -0.12 * B, 0))
    const to = eye.clone().addScaledVector(dir, dist * B)
    this._beam(from, to)
    try { audioEngine.playSpecial?.('shrinkZap') } catch { /* no audio */ }
    if (zombie) {
      if (s.net && !s.net.isHost) s.net.queueShrink?.(`z${zombie.id}`)
      else this.shrink(zombie)
      this._sparkle(to)
    }
    return true
  }

  // The first zombie straight ahead within RANGE that no block hides.
  // eye in world units, dir a unit vector. -> { zombie, dist (blocks) }.
  target(eye, dir) {
    const s = this.s
    const B = s.B
    const bm = s.bm
    const box = new THREE.Box3()
    const ray = new THREE.Ray(eye, dir)
    const hit = new THREE.Vector3()
    let best = null
    let bestD = RANGE
    for (const z of s.zombies) {
      if (z.health <= 0 || z.hidden) continue
      const half = s.zombieHalf * (z.size || 1) * (z.wide || 1)
      box.min.set((z.x - half) * B, z.y * B, (z.z - half) * B)
      box.max.set((z.x + half) * B, (z.y + s.zombieHeight * (z.size || 1) * (z.tall || 1)) * B, (z.z + half) * B)
      if (!ray.intersectBox(box, hit)) continue
      const d = hit.distanceTo(eye) / B
      if (d < bestD) {
        bestD = d
        best = z
      }
    }
    // A wall in the way stops the beam there.
    const p = new THREE.Vector3()
    for (let d = 0.3; d < bestD; d += 0.25) {
      p.copy(eye).addScaledVector(dir, d * B).divideScalar(B)
      const type = bm.getBlockAt(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))
      if (type && !bm._chunks?.isLiquid?.(type) && !/leaves$|glass|pane|window/.test(type)) return { zombie: null, dist: d }
    }
    return { zombie: best, dist: bestD }
  }

  // Tiny for a while (look: only how it looks - another player's copy of
  // the host's zombie, which counts its own time).
  shrink(z, look = false) {
    if (!z?.group) return false
    const time = z.boss || (z.size || 1) > 1.3 ? BOSS_S : SHRINK_S
    if (z.shrinkBase !== undefined && z.shrunk > 0) {
      z.shrunk = time
      return true
    }
    if (z.shrinkBase === undefined) {
      z.shrinkBase = z.group.scale.x
      z.shrinkFrom = z.size || 1
      z.shrinkVis = 1
    }
    z.shrinkK = time === BOSS_S ? BOSS_SIZE : SHRINK_SIZE
    z.shrunk = time
    z.shrinkLook = look
    z.size = z.shrinkFrom * z.shrinkK
    z.squeakIn = 0.25
    return true
  }

  // Back to its own size (it pops back up over a moment, update()).
  grow(z) {
    if (z.shrinkBase === undefined) return
    z.shrunk = 0
    z.size = z.shrinkFrom
    try { audioEngine.playSpecial?.('pop', audioEngine.zombieGain, this.s._panTo?.(z.x, z.z) || 0) } catch { /* no audio */ }
  }

  // Another player: the host's snapshot says whether it's tiny now.
  fromSnapshot(z, tiny) {
    if (tiny && !(z.shrunk > 0)) this.shrink(z, true)
    else if (!tiny && z.shrunk > 0 && z.shrinkLook) this.grow(z)
  }

  update(dt) {
    const s = this.s
    if (s.active && this.battery < BATTERY) this.battery = Math.min(BATTERY, this.battery + dt / RECHARGE_S)
    const holding = s.active && s.holding?.kind === 'item' && s.holding.id === 'shrinkRay'
    if (holding) this.pill.show('shrinkRay', t('shrinkPill', { n: Math.floor(this.battery), max: BATTERY }), this.battery < 1)
    else this.pill.hide('shrinkRay')
    for (const b of [...this._beams]) {
      b.life += dt
      b.mesh.material.opacity = Math.max(0, 0.9 * (1 - b.life / BEAM_S))
      if (b.life >= BEAM_S) this._dropBeam(b)
    }
    const me = s.bm?.tryMode?.pos
    const k = 1 - Math.exp(-14 * dt)
    for (const z of s.zombies || []) {
      if (z.shrinkBase === undefined) continue
      if (z.shrunk > 0 && !z.shrinkLook) {
        z.shrunk -= dt
        if (z.shrunk <= 0) this.grow(z)
      }
      // Squeaks now and then while tiny (only near me).
      if (z.shrunk > 0) {
        z.squeakIn -= dt
        if (z.squeakIn <= 0) {
          z.squeakIn = 1.1 + Math.random() * 1.6
          if (!me || Math.hypot(me.x - z.x, me.z - z.z) < SQUEAK_NEAR) audioEngine.playZombieSqueak?.(s._panTo?.(z.x, z.z) || 0)
        }
      }
      const want = z.shrunk > 0 ? z.shrinkK : 1
      z.shrinkVis += (want - z.shrinkVis) * k
      if (want === 1 && Math.abs(1 - z.shrinkVis) < 0.02) {
        z.group.scale.setScalar(z.shrinkBase)
        for (const key of ['shrinkBase', 'shrinkFrom', 'shrinkVis', 'shrinkK', 'shrinkLook', 'squeakIn']) delete z[key]
        z.shrunk = 0
        continue
      }
      z.group.scale.setScalar(z.shrinkBase * z.shrinkVis)
    }
  }

  // A thin glowing pink beam from the gun to where it stopped.
  _beam(from, to) {
    const s = this.s
    const len = from.distanceTo(to)
    if (len < 0.01) return
    if (!this._geo) this._geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true)
    const mat = new THREE.MeshBasicMaterial({ color: 0xff6ad5, transparent: true, opacity: 0.9, depthWrite: false })
    const mesh = new THREE.Mesh(this._geo, mat)
    mesh.scale.set(0.035 * s.B, len, 0.035 * s.B)
    mesh.position.copy(from).add(to).multiplyScalar(0.5)
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
    s.bm.scene.add(mesh)
    this._beams.push({ mesh, life: 0 })
  }

  _sparkle(p) {
    const B = this.s.B
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2
      this.s._fx?.spark?.(p.x, p.y, p.z, { life: 0.5, from: 0.12, to: 0.03, gravity: 2, color: i % 2 ? 0xff6ad5 : 0xfff2fb, vel: new THREE.Vector3(Math.cos(a) * 1.6 * B, (1 + Math.random()) * B, Math.sin(a) * 1.6 * B) })
    }
  }

  _dropBeam(b) {
    b.mesh.removeFromParent()
    b.mesh.material.dispose()
    const i = this._beams.indexOf(b)
    if (i >= 0) this._beams.splice(i, 1)
  }

  clear() {
    for (const b of [...this._beams]) this._dropBeam(b)
    this.battery = BATTERY
    this.pill.hide('shrinkRay')
  }
}
