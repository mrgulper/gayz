// Shrinking Zone mode (2026-11-01, Gaymi's idea list 2, big batch:
// "shrinking-zone mode"). Owned by BuildSurvival (`survival.zone`), only
// in the shrinkingZone mode. The zombie waves go on as usual.
//
// - A glowing green wall rings the safe zone. It waits (ZONE_STAGES' hold),
//   then shrinks over ZONE_SHRINK_S to the next, smaller circle - always
//   inside the one before, its middle drifting a little each time.
// - Outside it is toxic fog (Gaymi picked "toxic fog + fast zombies", no
//   direct damage): a green haze on the screen, and every zombie out there
//   runs ZONE_ZOMBIE_SPEED times as fast (zombieMult).
// - Survive the last, tiny circle's hold and you win.
// - On a server the host's zone goes to everyone (snapshot / applySnapshot,
//   `zone` in api/_lib/servers.js): its first middle, the seed that moves
//   it, and how far along it is - the circles come out the same everywhere.
import * as THREE from 'three'
import { t } from './i18n.js'
import { ZONE_STAGES, ZONE_SHRINK_S, ZONE_ZOMBIE_SPEED } from './PlayRules.js'

// The wall: this tall, starting this far under where the zone began.
const WALL_H = 120
const WALL_DOWN = 40

// The whole game, in seconds: every hold, plus a shrink between each pair.
export const ZONE_TOTAL_S = ZONE_STAGES.reduce((a, st) => a + st.hold, 0) + (ZONE_STAGES.length - 1) * ZONE_SHRINK_S

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = a
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

export class ShrinkZone {
  constructor(survival) {
    this.s = survival
    this.t = 0
    this.started = false
    this.centers = []
    this._outside = false
    this._stageSeen = -1
    this._shrinkSeen = -1
    this._won = false
  }

  get B() {
    return this.s.B
  }

  // The zone begins round where you are (or where the host's began).
  _start(x, z, y, seed) {
    // Rounded like snapshot() sends it, so guests work out the same circles.
    x = Math.round(x * 100) / 100
    z = Math.round(z * 100) / 100
    this.seed = seed >>> 0
    this.x0 = x
    this.z0 = z
    this.y0 = Math.round(y)
    // Each circle's middle: somewhere the next one fits inside the last.
    const r = rng(this.seed)
    this.centers = [{ x, z }]
    for (let i = 1; i < ZONE_STAGES.length; i++) {
      const prev = this.centers[i - 1]
      const room = Math.max(0, ZONE_STAGES[i - 1].r - ZONE_STAGES[i].r)
      const a = r() * Math.PI * 2
      const d = Math.sqrt(r()) * room * 0.8
      this.centers.push({ x: prev.x + Math.cos(a) * d, z: prev.z + Math.sin(a) * d })
    }
    this.started = true
    this._makeWall()
  }

  // Where the zone is now: { x, z, r, stage, shrinking, left (seconds
  // until the next change), next ({ x, z, r } it's heading to, or null) }.
  now() {
    let left = this.t
    for (let i = 0; i < ZONE_STAGES.length; i++) {
      const st = ZONE_STAGES[i]
      const c = this.centers[i]
      const next = i + 1 < ZONE_STAGES.length ? { ...this.centers[i + 1], r: ZONE_STAGES[i + 1].r } : null
      if (left < st.hold || !next) return { x: c.x, z: c.z, r: st.r, stage: i, shrinking: false, left: Math.max(0, st.hold - left), next }
      left -= st.hold
      if (left < ZONE_SHRINK_S) {
        const f = left / ZONE_SHRINK_S
        return { x: c.x + (next.x - c.x) * f, z: c.z + (next.z - c.z) * f, r: st.r + (next.r - st.r) * f, stage: i, shrinking: true, left: ZONE_SHRINK_S - left, next }
      }
      left -= ZONE_SHRINK_S
    }
    const i = ZONE_STAGES.length - 1
    return { x: this.centers[i].x, z: this.centers[i].z, r: ZONE_STAGES[i].r, stage: i, shrinking: false, left: 0, next: null }
  }

  inside(x, z) {
    if (!this.started) return true
    const n = this._now || this.now()
    return Math.hypot(x - n.x, z - n.z) <= n.r
  }

  // How much faster a zombie runs (BuildSurvival._updateZombie).
  zombieMult(zb) {
    return this.inside(zb.x, zb.z) ? 1 : ZONE_ZOMBIE_SPEED
  }

  // Every frame (BuildSurvival.update). The host (or a solo game) runs the
  // clock; the others run it on between the host's updates.
  update(dt) {
    const s = this.s
    const host = !s.net || s.net.closed || s.net.isHost
    if (!this.started) {
      if (!host || s._picking) return
      const p = s.bodyPos()
      const a = Math.random() * Math.PI * 2
      const d = Math.random() * 20
      this._start(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, p.y, Math.floor(Math.random() * 2 ** 31))
    }
    this.t = Math.min(ZONE_TOTAL_S, this.t + dt)
    const n = (this._now = this.now())
    this._placeWall(n)
    const me = s.bodyPos()
    const out = !s.dead && !s.spectating && !this.inside(me.x, me.z)
    if (out !== this._outside) {
      this._outside = out
      if (out) s._message(t('zoneOutsideMsg'), 3)
    }
    this._renderFog(n)
    // What's happening, once each time it changes.
    if (n.stage !== this._stageSeen && !n.shrinking) {
      this._stageSeen = n.stage
      if (n.stage > 0) s._message(n.next ? t('zoneStageMsg', { n: n.stage + 1, m: ZONE_STAGES.length }) : t('zoneFinalMsg', { s: Math.ceil(n.left) }), 4)
    }
    if (n.shrinking && this._shrinkSeen !== n.stage) {
      this._shrinkSeen = n.stage
      s._message(t('zoneShrinkingMsg'), 3)
    }
    // Lasted out the last circle: a win (each player decides their own).
    if (this.t >= ZONE_TOTAL_S && !this._won && !s.dead && !s.spectating) {
      this._won = true
      s._win()
    }
  }

  // The HUD line's part (BuildSurvival._renderHud).
  hudText() {
    if (!this.started) return t('zoneStarting')
    const n = this._now || this.now()
    const time = `${Math.floor(n.left / 60)}:${String(Math.floor(n.left % 60)).padStart(2, '0')}`
    if (!n.next) return t('zoneHudFinal', { t: time })
    if (n.shrinking) return t('zoneHudShrinking', { t: time })
    return t('zoneHud', { n: n.stage + 1, m: ZONE_STAGES.length, t: time })
  }

  _makeWall() {
    if (this.wall) return
    const B = this.B
    const mat = new THREE.MeshBasicMaterial({ color: 0x7dff4a, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
    this.wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 96, 1, true), mat)
    // Bright bands so it reads as a wall from far away.
    const bandMat = new THREE.MeshBasicMaterial({ color: 0xc8ff8a, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
    this.bands = new THREE.Group()
    for (const y of [0.32, 0.36]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.012, 96, 1, true), bandMat.clone())
      band.position.y = y
      this.bands.add(band)
    }
    this.wall.add(this.bands)
    this.wall.renderOrder = 2
    this.wall.scale.set(B, WALL_H * B, B)
    this.s.bm.scene.add(this.wall)
  }

  _placeWall(n) {
    if (!this.wall) return
    const B = this.B
    this.wall.position.set(n.x * B, (this.y0 - WALL_DOWN + WALL_H / 2) * B, n.z * B)
    this.wall.scale.set(n.r * B, WALL_H * B, n.r * B)
    // A slow shimmer.
    this.wall.material.opacity = 0.18 + Math.sin(performance.now() / 500) * 0.05
  }

  // The toxic haze over the screen while you're out of the zone.
  _renderFog(n) {
    if (!this._fog) {
      this._fog = document.createElement('div')
      this._fog.id = 'zone-fog'
      this._fog.innerHTML = '<span></span>'
      document.body.appendChild(this._fog)
    }
    this._fog.classList.toggle('on', this._outside)
    if (this._outside) {
      const me = this.s.bodyPos()
      const d = Math.max(0, Math.round(Math.hypot(me.x - n.x, me.z - n.z) - n.r))
      const text = t('zoneOutsideHud', { n: d })
      if (this._fog.firstChild.textContent !== text) this._fog.firstChild.textContent = text
    }
  }

  // For the minimap (BuildTryMode._drawMap): the zone now and the next one.
  mapRings() {
    if (!this.started) return []
    const n = this._now || this.now()
    const out = [{ x: n.x, z: n.z, r: n.r, next: false }]
    if (n.next) out.push({ x: n.next.x, z: n.next.z, r: n.next.r, next: true })
    return out
  }

  snapshot() {
    if (!this.started) return null
    return { x: +this.x0.toFixed(2), z: +this.z0.toFixed(2), y: Math.round(this.y0), s: this.seed, t: +this.t.toFixed(1) }
  }

  applySnapshot(d) {
    if (!d || typeof d !== 'object') return
    if (!this.started || d.s !== this.seed) {
      this.started = false
      this._start(Number(d.x) || 0, Number(d.z) || 0, Number(d.y) || 0, Number(d.s) || 1)
    }
    // Only big jumps snap; small ones are just sync timing.
    const ht = Number(d.t) || 0
    if (Math.abs(ht - this.t) > 1.5) this.t = ht
  }

  dispose() {
    if (this.wall) {
      this.wall.removeFromParent()
      this.wall.traverse((o) => {
        if (!o.isMesh) return
        o.geometry.dispose()
        o.material.dispose()
      })
      this.wall = null
    }
    this._fog?.remove()
    this._fog = null
  }
}
