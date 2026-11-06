// Freeze Tag (2026-11-06, Gaymi's idea list 7: "tagged players freeze in a
// block of ice, and teammates thaw them by standing close" - servers +
// bots, like the other party modes). Plugs into PartyMode (PartyModes.js)
// as its `ext`.
//
// Played on the ground round where the round began. One Tagger (two from 6
// players) - a frosty blue diamond over their head - runs a little faster
// than everyone else. A Tagger touching a runner freezes them solid in a
// block of ice (they can't move). A runner standing next to a frozen one
// for THAW_S seconds thaws them out. Every runner frozen = the Taggers win;
// anyone still running when the clock runs out = the runners win. No
// shooting. Taggers are PartyMode's `seekers` (synced as `sk`).
// Meshes only, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { MOB_HEIGHT } from './PlayRules.js'

export const THAW_S = 3
export const THAW_R = 1.8
export const TAGGER_SPEED = 1.15
const TAG_DIST = 1.2
const FLEE_R = 9

export class PartyFreeze {
  constructor(pm) {
    this.pm = pm
    this.s = pm.s
    this.frozen = new Set()
    this.thaw = new Map() // frozen id -> seconds of thawing so far
    this._ice = new Map()
    this._wasFrozen = false
  }

  get B() {
    return this.s.B
  }

  begin(people, shuffled) {
    const pm = this.pm
    this.frozen.clear()
    this.thaw.clear()
    pm.seekers.clear()
    for (const id of shuffled.slice(0, people.length >= 6 ? 2 : 1)) pm.seekers.add(id)
  }

  run(people, dt) {
    const pm = this.pm
    if (pm.phase !== 'play') return
    for (const id of [...this.frozen]) if (!people.some((p) => p.id === id)) this.frozen.delete(id)
    const runners = people.filter((p) => !pm.seekers.has(p.id))
    // Tags.
    for (const tg of people.filter((p) => pm.seekers.has(p.id))) {
      for (const r of runners) {
        if (this.frozen.has(r.id)) continue
        if (Math.hypot(tg.x - r.x, tg.z - r.z) < TAG_DIST && Math.abs(tg.y - r.y) < 2) {
          this.frozen.add(r.id)
          this.thaw.delete(r.id)
          pm._say = { k: 'freezeTagged', name: r.id }
        }
      }
    }
    // Thawing: a free runner close by.
    for (const id of [...this.frozen]) {
      const f = people.find((p) => p.id === id)
      if (!f) continue
      const helper = runners.some((r) => r.id !== id && !this.frozen.has(r.id) && Math.hypot(r.x - f.x, r.z - f.z) < THAW_R)
      const n = helper ? (this.thaw.get(id) || 0) + dt : Math.max(0, (this.thaw.get(id) || 0) - dt * 0.5)
      if (n >= THAW_S) {
        this.frozen.delete(id)
        this.thaw.delete(id)
        pm._say = { k: 'freezeThawed', name: id }
      } else this.thaw.set(id, n)
    }
    if (runners.length && runners.every((r) => this.frozen.has(r.id))) pm._end('s')
  }

  timeUp() {
    this.pm._end('h')
  }

  won() {
    const pm = this.pm
    const tagger = pm.seekers.has(pm.myId)
    return (pm.winner === 's' && tagger) || (pm.winner === 'h' && !tagger)
  }

  winText(w) {
    return t(w === 's' ? 'freezeTaggersWin' : 'freezeRunnersWin')
  }

  botGoal(b, people) {
    const pm = this.pm
    const near = (list) => list.reduce((best, p) => (!best || Math.hypot(p.x - b.x, p.z - b.z) < Math.hypot(best.x - b.x, best.z - b.z) ? p : best), null)
    if (this.frozen.has(b.id)) return { x: b.x, z: b.z, stay: true }
    const others = people.filter((p) => p.id !== b.id)
    if (pm.seekers.has(b.id)) return near(others.filter((p) => !pm.seekers.has(p.id) && !this.frozen.has(p.id)))
    const tg = near(others.filter((p) => pm.seekers.has(p.id) && Math.hypot(p.x - b.x, p.z - b.z) < FLEE_R))
    if (tg) return { x: b.x * 2 - tg.x, z: b.z * 2 - tg.z }
    const f = near(others.filter((p) => this.frozen.has(p.id)))
    if (f) return Math.hypot(f.x - b.x, f.z - b.z) > 1 ? f : { x: b.x, z: b.z, stay: true }
    return null
  }

  // Frozen: no moving. Taggers: a bit faster.
  speed() {
    const pm = this.pm
    if (pm.phase !== 'play') return 1
    if (this.frozen.has(pm.myId)) return 0
    return pm.seekers.has(pm.myId) ? TAGGER_SPEED : 1
  }

  markColor(id) {
    return this.pm.seekers.has(id) ? 0x7fdcff : null
  }

  // No shooting in Freeze Tag.
  shoot() {
    return false
  }

  events(was) {
    const pm = this.pm
    const me = this.frozen.has(pm.myId)
    if (pm.phase === 'play' && me && !this._wasFrozen) {
      this.s._message(t('freezeYouFrozen', { n: THAW_S }), 3)
      try { audioEngine.playSpecial?.('clank') } catch { /* no audio */ }
    }
    if (pm.phase === 'play' && !me && this._wasFrozen) this.s._message(t('freezeYouThawed'), 2)
    this._wasFrozen = me && pm.phase === 'play'
    void was
  }

  // A block of ice round everyone frozen.
  draw() {
    const pm = this.pm
    const B = this.B
    const people = pm._people()
    const seen = new Set()
    if (pm.phase === 'play') {
      for (const p of people) {
        if (!this.frozen.has(p.id)) continue
        seen.add(p.id)
        let m = this._ice.get(p.id)
        if (!m) {
          m = new THREE.Mesh(new THREE.BoxGeometry(1 * B, (MOB_HEIGHT + 0.2) * B, 1 * B), new THREE.MeshBasicMaterial({ color: 0xa8e4ff, transparent: true, opacity: 0.45, depthWrite: false }))
          pm.arena.add(m)
          this._ice.set(p.id, m)
        }
        m.position.set(p.x * B, (p.y + (MOB_HEIGHT + 0.2) / 2) * B, p.z * B)
        // Thawing: the ice thins.
        m.material.opacity = 0.45 - ((this.thaw.get(p.id) || 0) / THAW_S) * 0.3
      }
    }
    for (const [id, m] of this._ice) {
      if (seen.has(id)) continue
      m.removeFromParent()
      m.geometry.dispose()
      m.material.dispose()
      this._ice.delete(id)
    }
  }

  startText() {
    const pm = this.pm
    return t(pm.seekers.has(pm.myId) ? 'freezeYouTag' : 'freezeYouRun', { n: THAW_S })
  }

  hud() {
    const pm = this.pm
    const people = pm._people()
    const runners = people.filter((p) => !pm.seekers.has(p.id))
    let mid = t('freezeHud', { n: runners.filter((p) => !this.frozen.has(p.id)).length, max: runners.length })
    if (pm.phase === 'play') mid += ` · ${t(pm.seekers.has(pm.myId) ? 'freezeTaggerTag' : this.frozen.has(pm.myId) ? 'freezeFrozenTag' : 'freezeRunnerTag')}`
    return mid
  }

  snap() {
    const fz = {}
    for (const id of this.frozen) fz[this.pm._out(id)] = Math.round((this.thaw.get(id) || 0) * 10)
    return { fz }
  }

  apply(d) {
    this.frozen = new Set()
    this.thaw = new Map()
    for (const [id, n] of Object.entries(d.fz || {})) {
      this.frozen.add(id)
      this.thaw.set(id, (Number(n) || 0) / 10)
    }
  }

  dispose() {
    for (const m of this._ice.values()) {
      m.geometry.dispose()
      m.material.dispose()
    }
    this._ice.clear()
  }
}
