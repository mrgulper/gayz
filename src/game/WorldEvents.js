// Random world events in Zombie Survival (2026-10-31, Gaymi's idea list:
// "a supply plane drop, a zombie horde migrating across the map, a meteor
// that turns zombies into mutants"). Run by BuildSurvival (alone, or as a
// server's host) from wave EVENT_FROM_WAVE: the first comes EVENT_FIRST
// seconds in, then one every EVENT_GAP seconds (a random pick, never the
// same one twice in a row). `start(kind)` starts one now (tests).
//
// - supply: a blocky cargo plane flies over and drops a crate on a
//   parachute DROP_NEAR..DROP_FAR blocks from you. A light beam marks
//   where it lands; walk up to it for ammo, health packs, a trap and coins.
//   It's gone after CRATE_LIFE seconds.
// - horde: HORDE_BASE + the wave number zombies appear together off to one
//   side and walk straight across, past you. They leave you alone unless
//   you come within HORDE_NOTICE blocks or shoot one - then that one comes
//   for you. They don't count toward the wave.
// - meteor: a glowing rock streaks down METEOR_NEAR..METEOR_FAR blocks
//   away and blows up. Every zombie within MUTATE_R blocks turns into a
//   mutant (bigger, purple sparks, MUTANT_HP x health, faster, harder
//   hitting, MUTANT_COINS extra coins), and METEOR_SPAWN mutants climb out
//   of the crater.
//
// On a server the others see the zombies (mutants too, zombieSnapshot
// `mu`) but not the plane, crate or meteor - those are the host's, like
// the bloater's slime.
import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

const EVENT_FROM_WAVE = 2
const EVENT_FIRST = 90
const EVENT_GAP = [150, 240]
const KINDS = ['supply', 'horde', 'meteor']
const PLANE_HEIGHT = 32
const PLANE_SPEED = 14
const DROP_NEAR = 14
const DROP_FAR = 28
const FALL_SPEED = 3
const CRATE_LIFE = 90
const CRATE_REACH = 1.8
const CRATE_COINS = 25
const HORDE_BASE = 6
const HORDE_MAX = 16
const HORDE_SIDE = 30
const HORDE_NOTICE = 10
const METEOR_NEAR = 14
const METEOR_FAR = 24
const METEOR_FALL = 2.2
const METEOR_BLAST = 4
const MUTATE_R = 14
const METEOR_SPAWN = 3
export const MUTANT_HP = 2
const MUTANT_SPEED = 1.3
const MUTANT_DAMAGE = 1.5
export const MUTANT_SIZE = 1.3
export const MUTANT_COINS = 15

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra })
const boxMesh = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)

export class WorldEvents {
  constructor(survival) {
    this.s = survival
    this._group = null
    this.reset()
  }

  // A new run: the clock starts over.
  reset() {
    this.clear()
    this._next = EVENT_FIRST
    this._last = null
  }

  get B() {
    return this.s.B
  }

  // The scene things this run made (plane, crate, meteor) live in one group.
  _scene() {
    if (!this._group) {
      this._group = new THREE.Group()
      this.s.bm.scene.add(this._group)
    }
    return this._group
  }

  // Every frame (alone or the host).
  update(dt) {
    const s = this.s
    if (!s.cfg.noZombies && s.wave >= EVENT_FROM_WAVE && !this._run) {
      this._next -= dt
      if (this._next <= 0) {
        const pick = KINDS.filter((k) => k !== this._last)
        this.start(pick[Math.floor(Math.random() * pick.length)])
      }
    }
    if (this._run?.update(dt) === false) this._endRun()
    if (this._crate) this._updateCrate(dt)
    this._mutantSparks(dt)
  }

  start(kind) {
    if (this._run) this._endRun()
    const me = this.s.bodyPos()
    this._last = kind
    this._next = EVENT_GAP[0] + Math.random() * (EVENT_GAP[1] - EVENT_GAP[0])
    if (kind === 'supply') this._run = this._supply(me)
    else if (kind === 'horde') this._run = this._horde(me)
    else if (kind === 'meteor') this._run = this._meteor(me)
    return !!this._run
  }

  _endRun() {
    this._run?.dispose?.()
    this._run = null
  }

  // A spot `near`..`far` blocks from me, on the ground (null if none).
  _spotNear(me, near, far) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2
      const d = near + Math.random() * (far - near)
      const x = Math.floor(me.x + Math.cos(a) * d) + 0.5
      const z = Math.floor(me.z + Math.sin(a) * d) + 0.5
      if (this.s.camp?.inside(x, z, 2)) continue
      const y = this._ground(x, me.y, z)
      if (y !== null) return { x, y, z }
    }
    return null
  }

  // The ground's top under (x, z), looking from a little above `fromY`.
  _ground(x, fromY, z) {
    const top = this.s._groundUnder(x, fromY + 20, z)
    return top === fromY + 20 ? null : top
  }

  // ---- supply drop ----

  _supply(me) {
    const spot = this._spotNear(me, DROP_NEAR, DROP_FAR)
    if (!spot) return null
    const B = this.B
    const plane = makePlane(B)
    // In one side, over the drop spot, out the other.
    const a = Math.random() * Math.PI * 2
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
    const span = 60
    const y = Math.max(spot.y, me.y) + PLANE_HEIGHT
    const from = new THREE.Vector3(spot.x, y, spot.z).addScaledVector(dir, -span)
    plane.position.copy(from).multiplyScalar(B)
    plane.rotation.y = Math.atan2(dir.x, dir.z)
    this._scene().add(plane)
    this.s._message(t('buildPlayEventSupply'), 4)
    audioEngine.playPlaneFlyby?.()
    let dist = 0
    let dropped = false
    return {
      update: (dt) => {
        dist += PLANE_SPEED * dt
        plane.position.copy(from).addScaledVector(dir, dist).multiplyScalar(B)
        if (!dropped && dist >= span) {
          dropped = true
          this._dropCrate(spot, y - 2)
        }
        return dist < span * 2
      },
      dispose: () => drop(plane),
    }
  }

  _dropCrate(spot, fromY) {
    if (this._crate) this._removeCrate()
    const B = this.B
    const g = new THREE.Group()
    const crate = boxMesh(1 * B, 1 * B, 1 * B, lambert(0x8a6238))
    crate.position.y = 0.5 * B
    const band = boxMesh(1.04 * B, 0.18 * B, 1.04 * B, lambert(0x3a5a2a))
    band.position.y = 0.5 * B
    // A parachute: a wide flat canopy on four strings.
    const chute = new THREE.Group()
    const canopy = boxMesh(2.4 * B, 0.3 * B, 2.4 * B, lambert(0xe8e0d0))
    canopy.position.y = 3 * B
    chute.add(canopy)
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const str = boxMesh(0.04 * B, 2 * B, 0.04 * B, lambert(0x444444))
      str.position.set(sx * 0.6 * B, 2 * B, sz * 0.6 * B)
      chute.add(str)
    }
    // A tall light beam marks it from far away (unlit, see-through).
    const beam = boxMesh(0.35 * B, 40 * B, 0.35 * B, new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.35, depthWrite: false }))
    beam.position.y = 20 * B
    g.add(crate, band, chute, beam)
    g.position.set(spot.x * B, fromY * B, spot.z * B)
    this._scene().add(g)
    this._crate = { x: spot.x, y: fromY, z: spot.z, ground: spot.y, group: g, chute, beam, left: CRATE_LIFE, landed: false }
  }

  _updateCrate(dt) {
    const c = this._crate
    const B = this.B
    if (!c.landed) {
      c.y = Math.max(c.ground, c.y - FALL_SPEED * dt)
      c.group.rotation.y += dt * 0.5
      if (c.y <= c.ground) {
        c.landed = true
        c.chute.visible = false
        audioEngine.playFootstep?.(false, 'default')
      }
    }
    c.group.position.y = c.y * B
    c.beam.material.opacity = 0.25 + Math.sin(performance.now() / 300) * 0.1
    c.left -= dt
    if (c.left <= 0) return this._removeCrate()
    const me = this.s.bodyPos()
    if (c.landed && !this.s.dead && Math.hypot(me.x - c.x, me.z - c.z) < CRATE_REACH && Math.abs(me.y - c.y) < 2) this._openCrate()
  }

  // Ammo, health packs, a trap and coins.
  _openCrate() {
    const s = this.s
    s.reserve += s._chestAmmo() * 2
    s.inv.add({ kind: 'item', id: 'healthpack', n: 2 })
    s.inv.add({ kind: 'item', id: 'ammobox', n: 1 })
    const trap = s._trapSupplies()
    s._earn(CRATE_COINS)
    s._message(`${t('buildPlayEventSupplyGot', { n: CRATE_COINS })} ${trap}`, 4)
    s._renderHud()
    this._removeCrate()
  }

  _removeCrate() {
    if (!this._crate) return
    drop(this._crate.group)
    this._crate = null
  }

  // ---- horde ----

  _horde(me) {
    const s = this.s
    // Off to one side, walking across past me.
    const a = Math.random() * Math.PI * 2
    const side = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
    const walk = new THREE.Vector3(-side.z, 0, side.x)
    const n = Math.min(HORDE_MAX, HORDE_BASE + s.wave)
    let made = 0
    for (let i = 0; i < n * 3 && made < n; i++) {
      // A loose blob, starting behind the line so they walk past.
      const x = Math.floor(me.x + side.x * HORDE_SIDE - walk.x * 25 + (Math.random() - 0.5) * 8) + 0.5
      const z = Math.floor(me.z + side.z * HORDE_SIDE - walk.z * 25 + (Math.random() - 0.5) * 8) + 0.5
      if (s.camp?.inside(x, z, 2)) continue
      const y = this._ground(x, me.y, z)
      if (y === null) continue
      const zb = s._extraZombie(x, y, z)
      if (!zb) continue
      zb.migrate = { x: walk.x, z: walk.z }
      made++
    }
    if (!made) return null
    s._message(t('buildPlayEventHorde'), 4)
    return { update: () => s.zombies.some((zb) => zb.migrate) }
  }

  // Where a migrating zombie heads (BuildSurvival._updateWorld) - null once
  // it's after you.
  target(zb, player) {
    const m = zb.migrate
    if (!m) return null
    const near = player && !player.idle && Math.hypot(player.x - zb.x, player.z - zb.z) < HORDE_NOTICE
    if (zb.hit || near) {
      zb.migrate = null
      return null
    }
    return { x: zb.x + m.x * 20, y: zb.y, z: zb.z + m.z * 20, idle: true, lure: true }
  }

  // ---- meteor ----

  _meteor(me) {
    const spot = this._spotNear(me, METEOR_NEAR, METEOR_FAR)
    if (!spot) return null
    const B = this.B
    const rock = new THREE.Group()
    const core = boxMesh(1.2 * B, 1.2 * B, 1.2 * B, new THREE.MeshBasicMaterial({ color: 0xb050ff }))
    const shell = boxMesh(1.5 * B, 1.5 * B, 1.5 * B, new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.45, depthWrite: false }))
    rock.add(core, shell)
    const a = Math.random() * Math.PI * 2
    const from = new THREE.Vector3(spot.x + Math.cos(a) * 30, spot.y + 60, spot.z + Math.sin(a) * 30)
    const to = new THREE.Vector3(spot.x, spot.y + 0.5, spot.z)
    rock.position.copy(from).multiplyScalar(B)
    this._scene().add(rock)
    this.s._message(t('buildPlayEventMeteorComing'), 3)
    let time = 0
    const at = new THREE.Vector3()
    return {
      update: (dt) => {
        time += dt
        const k = Math.min(1, time / METEOR_FALL)
        at.lerpVectors(from, to, k * k)
        rock.position.copy(at).multiplyScalar(B)
        rock.rotation.x += dt * 4
        rock.rotation.z += dt * 3
        this.s._fx?.flame(at.x * B, at.y * B, at.z * B)
        if (k < 1) return true
        this._impact(spot)
        return false
      },
      dispose: () => drop(rock),
    }
  }

  _impact(spot) {
    const s = this.s
    const B = this.B
    try { audioEngine.playExplosion?.() } catch { /* no audio */ }
    s._fx?.explode(new THREE.Vector3(spot.x * B, (spot.y + 0.5) * B, spot.z * B), METEOR_BLAST * 0.8)
    const me = s.bodyPos()
    const d = Math.hypot(me.x - spot.x, me.y - spot.y, me.z - spot.z)
    if (d < METEOR_BLAST) s._hurtPlayer(40 * (1 - d / METEOR_BLAST))
    for (const zb of [...s.zombies]) {
      if (Math.hypot(zb.x - spot.x, zb.z - spot.z) < MUTATE_R && Math.abs(zb.y - spot.y) < 8) this.mutate(zb)
    }
    for (let i = 0; i < METEOR_SPAWN; i++) {
      const zb = s._extraZombie(spot.x + (Math.random() - 0.5) * 3, spot.y, spot.z + (Math.random() - 0.5) * 3)
      if (zb) this.mutate(zb)
    }
    s._message(t('buildPlayEventMeteor'), 4)
  }

  // A zombie turns mutant: bigger, tougher, faster, worth more. `look`
  // only: just its size (other players' copies, from the host's snapshot).
  mutate(zb, look = false) {
    if (zb.mutant) return
    zb.mutant = true
    zb.size = (zb.size || 1) * MUTANT_SIZE
    zb.group.scale.setScalar(MUTANT_SIZE)
    if (look) return
    zb.health *= MUTANT_HP
    zb.maxHealth *= MUTANT_HP
    zb.speedMult = (zb.speedMult || 1) * MUTANT_SPEED
    zb.damageMult = (zb.damageMult || 1) * MUTANT_DAMAGE
  }

  // Purple sparks drift off every mutant.
  _mutantSparks(dt) {
    if ((this._sparkIn = (this._sparkIn || 0) - dt) > 0) return
    this._sparkIn = 0.25
    const B = this.B
    for (const zb of this.s.zombies) {
      if (!zb.mutant) continue
      this.s._fx?.spark((zb.x + (Math.random() - 0.5) * 0.8) * B, (zb.y + 0.5 + Math.random() * 2) * B, (zb.z + (Math.random() - 0.5) * 0.8) * B, { life: 0.7, from: 0.25, to: 0.05, color: 0xb050ff, vel: new THREE.Vector3(0, 0.8 * B, 0) })
    }
  }

  clear() {
    this._endRun()
    this._removeCrate()
    if (this._group) {
      drop(this._group)
      this._group = null
    }
  }
}

// A plane made of boxes: body, wings, tail, propellers.
function makePlane(B) {
  const g = new THREE.Group()
  const body = lambert(0x5a6a4a)
  const dark = lambert(0x3a4430)
  const parts = [
    [1.6, 1.6, 9, body, 0, 0, 0],
    [12, 0.3, 2.2, body, 0, 0.2, 0.5],
    [4, 0.25, 1.2, body, 0, 0.6, -4],
    [0.25, 1.8, 1.2, dark, 0, 1.4, -4],
    [1.2, 1.2, 0.4, dark, 0, 0, 4.6],
    [0.9, 0.9, 1.6, dark, -3, -0.2, 1],
    [0.9, 0.9, 1.6, dark, 3, -0.2, 1],
  ]
  for (const [w, h, d, mat, x, y, z] of parts) {
    const m = boxMesh(w * B, h * B, d * B, mat)
    m.position.set(x * B, y * B, z * B)
    g.add(m)
  }
  return g
}

// Off the scene, geometry and materials freed.
function drop(obj) {
  obj.removeFromParent()
  obj.traverse((o) => {
    if (!o.isMesh) return
    o.geometry.dispose()
    o.material.dispose()
  })
}
