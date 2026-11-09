// The UFO abduction event (2026-11-02, Gaymi's idea list 6: "a flying
// saucer beams up zombies, animals or you, and you fight your way out of
// the alien ship"). Owned by BuildSurvival (`s.ufo`); a world event
// (WorldEvents 'ufo'), on every map.
//
// A flying saucer comes over and hovers HOVER blocks up near you for
// UFO_LIFE seconds, drifting about, with a green tractor beam under it.
// Every BEAM_EVERY seconds it lifts the nearest zombie or animal in the beam
// up into the ship (gone - no coins). Stand in the beam for GRAB_S seconds
// and it takes you: you're in the alien ship (real blocks high in the sky,
// SHIP_Y) with ALIENS alien zombies (only where the game runs). Beat them
// and the escape pad in the middle lights up - step on it to drop back
// down where you were taken, with UFO_COINS coins. Everything goes back as
// it was when it's over (TempBlocks.js). Meshes only, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { TempBlocks } from './TempBlocks.js'

export const UFO_LIFE = 70
export const HOVER = 16
export const BEAM_R = 2.5
export const BEAM_EVERY = 6
export const GRAB_S = 1.5
export const SHIP_Y = 340
export const ALIENS = 4
export const UFO_COINS = 90
const SHIP_R = 8
const LIFT_S = 1.6

export class Ufo {
  constructor(survival) {
    this.s = survival
    this.cells = new TempBlocks(survival)
    this.ufo = null
    this.aboard = null
    this._map = new Set()
  }

  get B() {
    return this.s.B
  }

  possible() {
    const s = this.s
    return !this.ufo && !this.aboard && !s.td && !s.escape && !s.party && !s.moon?.on
  }

  // --- on a server (2026-11-09) ---
  // The host runs it; everyone else sees a copy drifting the same way
  // with its beam (snapshot() -> applySnapshot()). Only the host can be
  // taken: the ship's fight runs where the zombies do.

  snapshot() {
    const u = this.ufo
    if (!u || this.mirror) return null
    return { gx: +u.gx.toFixed(2), gz: +u.gz.toFixed(2), y: +u.y.toFixed(2), t: +u.t.toFixed(2) }
  }

  applySnapshot(n) {
    if (!n) {
      if (this.mirror) this.clear()
      return
    }
    if (this.ufo && !this.mirror) return
    if (!this.ufo) {
      this.mirror = true
      this.ufo = { x: n.gx, z: n.gz, y: n.y, left: Infinity, beamIn: Infinity, grab: 0, lifting: [], t: n.t, gx: n.gx, gz: n.gz }
      this._mesh()
      this.s._message(t('ufoAppears'), 5)
      try { audioEngine.playSpecial?.('hum') } catch { /* no audio */ }
    }
    this.ufo.netT = n.t
  }

  // A copy's frame (BuildSurvival.update).
  mirrorUpdate(dt) {
    const u = this.ufo
    if (!this.mirror || !u) return
    if (this.s.net?.isHost) return this.clear()
    if (u.netT !== undefined) {
      u.netT += dt
      const gap = u.netT - u.t
      if (Math.abs(gap) > 5) u.t = u.netT - dt
      else u.t += gap * Math.min(1, dt * 2)
    }
    this._update(dt)
  }

  // The world event: here it comes. -> a run.
  event(me) {
    if (!this.possible()) return null
    const a = Math.random() * Math.PI * 2
    this.ufo = { x: me.x + Math.cos(a) * 10, z: me.z + Math.sin(a) * 10, y: me.y + HOVER, left: UFO_LIFE, beamIn: 2, grab: 0, lifting: [], t: 0, gx: me.x, gz: me.z }
    this._mesh()
    this.s._message(t('ufoAppears'), 5)
    try { audioEngine.playSpecial?.('hum') } catch { /* no audio */ }
    return { update: (dt) => this._update(dt), dispose: () => this.clear() }
  }

  _mesh() {
    const B = this.B
    const g = new THREE.Group()
    const metal = new THREE.MeshLambertMaterial({ color: 0xa8b0c0 })
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(4 * B, 4.6 * B, 0.7 * B, 24), metal)
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(5.2 * B, 5.2 * B, 0.25 * B, 24), new THREE.MeshLambertMaterial({ color: 0x6a7080 }))
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2 * B, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8affc0, transparent: true, opacity: 0.55 }))
    dome.position.y = 0.3 * B
    g.add(disc, rim, dome)
    this._lights = []
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.35 * B, 0.2 * B, 0.35 * B), new THREE.MeshBasicMaterial({ color: 0xffee55 }))
      l.position.set(Math.cos(a) * 4.9 * B, -0.15 * B, Math.sin(a) * 4.9 * B)
      g.add(l)
      this._lights.push(l)
    }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.8 * B, BEAM_R * B, HOVER * B, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0x6aff9a, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }))
    beam.position.y = (-HOVER / 2) * B
    g.add(beam)
    this._beam = beam
    this._group = g
    this.s.bm.scene.add(g)
  }

  _update(dt) {
    const u = this.ufo
    const s = this.s
    if (this.aboard) return this._aboard(dt)
    if (!u) return false
    u.left -= dt
    u.t += dt
    // Drifts about where you were when it came.
    u.x = u.gx + Math.cos(u.t * 0.25) * 9
    u.z = u.gz + Math.sin(u.t * 0.31) * 9
    const ground = s._groundUnder(u.x, u.y, u.z)
    const B = this.B
    this._group.position.set(u.x * B, u.y * B, u.z * B)
    this._group.rotation.y += dt * 0.8
    this._lights.forEach((l, i) => l.material.color.set((Math.floor(u.t * 6) + i) % 3 ? 0xffee55 : 0x55ffee))
    this._beam.scale.y = Math.max(0.2, (u.y - ground) / HOVER)
    this._beam.position.y = (-(u.y - ground) / 2) * B
    // Lifting what it took.
    for (const it of u.lifting) {
      it.t += dt
      const k = Math.min(1, it.t / LIFT_S)
      it.set(u.x, it.y0 + (u.y - it.y0) * k, u.z)
      if (k >= 1) it.gone()
    }
    u.lifting = u.lifting.filter((it) => it.t < LIFT_S)
    // You in the beam: taken.
    const me = s.bodyPos()
    const inBeam = !this.mirror && !s.dead && !s.spectating && Math.hypot(me.x - u.x, me.z - u.z) < BEAM_R && me.y < u.y
    u.grab = inBeam ? u.grab + dt : 0
    if (u.grab >= GRAB_S) {
      this._abduct(me)
      return true
    }
    if (!s.net || s.net.isHost) {
      u.beamIn -= dt
      if (u.beamIn <= 0) {
        u.beamIn = BEAM_EVERY
        this._beamUp()
      }
    }
    if (u.left <= 0) {
      s._message(t('ufoLeaves'), 3)
      return false
    }
    return true
  }

  // The nearest zombie or animal under the saucer goes up.
  _beamUp() {
    const s = this.s
    const u = this.ufo
    let best = null
    let bestD = BEAM_R + 4
    for (const zb of s.zombies) {
      if (zb.health <= 0 || zb.ufo) continue
      const d = Math.hypot(zb.x - u.x, zb.z - u.z)
      if (d < bestD) {
        bestD = d
        best = { zb }
      }
    }
    for (const a of s.animals?.list || []) {
      if (a.dying || a.tamed || a.ufo) continue
      const d = Math.hypot(a.x - u.x, a.z - u.z)
      if (d < bestD) {
        bestD = d
        best = { a }
      }
    }
    if (!best) return
    try { audioEngine.playSpecial?.('zap') } catch { /* no audio */ }
    if (best.zb) {
      const zb = best.zb
      zb.ufo = true
      u.lifting.push({
        t: 0, y0: zb.y,
        set: (x, y, z) => {
          zb.x = x
          zb.y = y
          zb.z = z
          zb.vx = zb.vy = zb.vz = 0
          zb.frozen = Math.max(zb.frozen || 0, 0.3)
          zb.group?.position.set(x * this.B, y * this.B, z * this.B)
        },
        gone: () => {
          const i = s.zombies.indexOf(zb)
          if (i >= 0) s.zombies.splice(i, 1)
          s._removeZombie(zb)
        },
      })
    } else {
      const a = best.a
      a.ufo = true
      u.lifting.push({
        t: 0, y0: a.y,
        set: (x, y, z) => {
          a.x = x
          a.y = y
          a.z = z
          a.group?.position.set(x * this.B, y * this.B, z * this.B)
        },
        gone: () => s.animals?._remove?.(a),
      })
    }
  }

  // --- aboard the ship ---

  _put(x, y, z, type) {
    this._map.add(this.s.bm._key(x, y, z))
    this.cells.put(x, y, z, type)
  }

  _abduct(me) {
    const s = this.s
    const cx = Math.floor(me.x)
    const cz = Math.floor(me.z)
    // A round room: a floor, glowing walls, a dome roof, the escape pad.
    for (let x = -SHIP_R - 1; x <= SHIP_R + 1; x++) {
      for (let z = -SHIP_R - 1; z <= SHIP_R + 1; z++) {
        const d = Math.hypot(x, z)
        if (d > SHIP_R + 0.8) continue
        this._put(cx + x, SHIP_Y, cz + z, d < 1.6 ? 'emeraldblock' : (x + z) % 2 ? 'quartz' : 'purpurblock')
        this._put(cx + x, SHIP_Y + 5, cz + z, 'quartz')
        if (d > SHIP_R - 0.2) for (let y = 1; y <= 4; y++) this._put(cx + x, SHIP_Y + y, cz + z, y === 2 ? 'sealantern' : 'quartz')
      }
    }
    this.aboard = { x: me.x, y: me.y, z: me.z, cx, cz, aliens: [], open: false }
    this.ufo.left = 0
    this._group.visible = false
    this._tp(cx + 4.5, SHIP_Y + 1, cz + 0.5)
    if (!s.net || s.net.isHost) {
      for (let i = 0; i < ALIENS; i++) {
        const a = (i / ALIENS) * Math.PI * 2 + 1
        const zb = s._extraZombie?.(cx + 0.5 + Math.cos(a) * 5, SHIP_Y + 1, cz + 0.5 + Math.sin(a) * 5)
        if (zb) {
          zb.alien = true
          this._alienLook(zb)
          this.aboard.aliens.push(zb)
        }
      }
    }
    s._message(t('ufoTaken', { n: this.aboard.aliens.length }), 5)
    try { audioEngine.playSpecial?.('siren') } catch { /* no audio */ }
  }

  // Alien zombies: bright green skin, big black eyes (their own materials).
  _alienLook(zb) {
    zb.group?.traverse((o) => {
      if (!o.isMesh || !o.material?.color) return
      o.material = o.material.clone()
      o.material.color.lerp(new THREE.Color(0x6aff7a), 0.6)
    })
  }

  _tp(x, y, z) {
    const s = this.s
    const tm = s.bm.tryMode
    tm.pos.set(x, y, z)
    tm.vel?.set(0, 0, 0)
    s.bm.camera.position.set(x * this.B, (y + 1.62) * this.B, z * this.B)
  }

  _aboard() {
    const s = this.s
    const ab = this.aboard
    ab.aliens = ab.aliens.filter((zb) => zb.health > 0 && s.zombies.includes(zb))
    const me = s.bodyPos()
    // Fell out somehow (or died): back down.
    if (s.dead) return this._home(false)
    if (me.y < SHIP_Y - 4) this._tp(ab.cx + 4.5, SHIP_Y + 1, ab.cz + 0.5)
    if (!ab.aliens.length && !ab.open) {
      ab.open = true
      s._message(t('ufoPadOpen'), 4)
      try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
    }
    if (ab.open && Math.hypot(me.x - (ab.cx + 0.5), me.z - (ab.cz + 0.5)) < 1.5 && Math.abs(me.y - (SHIP_Y + 1)) < 0.6) return this._home(true)
    return true
  }

  _home(won) {
    const s = this.s
    const ab = this.aboard
    this.aboard = null
    // Aliens still up there go with the ship.
    for (const zb of ab.aliens) {
      const i = s.zombies.indexOf(zb)
      if (i >= 0) s.zombies.splice(i, 1)
      s._removeZombie(zb)
    }
    this.cells.restore()
    this._map.clear()
    if (!s.dead) this._tp(ab.x, s._groundUnder(ab.x, ab.y + 3, ab.z), ab.z)
    if (won) {
      s.coins = (s.coins || 0) + UFO_COINS
      s._renderHud?.()
      s._message(t('ufoEscaped', { n: UFO_COINS }), 5)
    }
    return false
  }

  protects(x, y, z) {
    return this._map.has(this.s.bm._key(x, y, z))
  }

  clear() {
    if (this.aboard) this._home(false)
    this.cells.restore()
    this._map.clear()
    this._group?.removeFromParent()
    this._group?.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.dispose()
      o.material.dispose()
    })
    this._group = null
    this.ufo = null
    this.mirror = false
  }
}
