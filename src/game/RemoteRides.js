// Riding along in someone else's vehicle on a server (2026-11-09, Gaymi:
// others should see the karts and "hop on as passenger"). Owned by
// BuildSurvival (`s.passenger`).
//
// Another player's go-kart, boat, helicopter, balloon or submarine (their
// `veh` list, drawn by Vehicles.drawRemote) can be boarded: walk up to it
// (within REACH blocks) and press Use / right-click. You sit in its
// passenger seat (SEATS) and go wherever its driver takes it - looking
// round and shooting still work. Use, Jump or Crouch hops off beside it;
// if it disappears (its driver left, or it was put away) you're dropped
// where it was. Only you move: nothing is sent to the driver, the others
// just see you sitting there (`sit` in your state).
import { t } from './i18n.js'

const REACH = 3
// Per vehicle kind: the passenger seat [sideways, up, back] from the
// model's middle (blocks), and the eye height above it.
const SEATS = {
  k: { off: [0, 0.35, -0.95], eye: 1.15 },
  b: { off: [0, 0.45, -1.2], eye: 1.3 },
  h: { off: [0.55, 0.6, 0], eye: 1.25 },
  a: { off: [0.5, 0.4, 0.3], eye: 1.4 },
  s: { off: [0, 0.6, -0.8], eye: 1.25 },
}

export class RemoteRides {
  constructor(survival) {
    this.s = survival
    this.on = null // { pid, i }
  }

  // Every vehicle model of the other players, with whose it is.
  _models() {
    const net = this.s.net
    if (!net || net.closed || net.lobby) return []
    const out = []
    for (const [pid, p] of net.players) (p.vehicles || []).forEach((m, i) => out.push({ pid, i, m, nick: p.nick }))
    return out
  }

  // The nearest one within reach of `me`, or null.
  nearest(me) {
    let best = null
    let bestD = REACH
    for (const r of this._models()) {
      if (!SEATS[r.m.k] || Math.abs(r.m.y - me.y) > 3) continue
      const d = Math.hypot(r.m.x - me.x, r.m.z - me.z)
      if (d < bestD) {
        bestD = d
        best = r
      }
    }
    return best
  }

  // Use: on board the nearest one, or off again. -> true if it did either.
  use() {
    const s = this.s
    if (this.on) {
      this.leave()
      return true
    }
    if (s.dead || s.spectating || s.kart?.driving || s.vehicles?.riding || s.train?.aboard) return false
    const r = this.nearest(s.bm.tryMode.pos)
    if (!r) return false
    this.on = { pid: r.pid, i: r.i }
    s._message(t('rideAlongOn', { name: r.nick || 'Survivor' }), 3)
    return true
  }

  _model() {
    if (!this.on) return null
    const m = this.s.net?.players?.get(this.on.pid)?.vehicles?.[this.on.i]
    return m && SEATS[m.k] ? m : null
  }

  // Where you sit: { x, y, z, eye }, or null (and you're off) once it's gone.
  seat() {
    const m = this._model()
    if (!m) {
      if (this.on) this.leave()
      return null
    }
    const seat = SEATS[m.k]
    const [sx, up, back] = seat.off
    // The model faces +z turned by its heading.
    const fx = Math.sin(m.h)
    const fz = Math.cos(m.h)
    return { x: m.x + fz * sx + fx * back, y: m.y + up, z: m.z - fx * sx + fz * back, eye: seat.eye }
  }

  // Off, beside it (or where you sat, if there's no room).
  leave() {
    const s = this.s
    const m = this._model()
    const seat = m ? this.seat() : null
    this.on = null
    const tm = s.bm.tryMode
    if (m && seat) {
      const sx = Math.cos(m.h)
      const sz = -Math.sin(m.h)
      let placed = false
      for (const side of [1.8, -1.8, 2.6, -2.6]) {
        const x = m.x + sx * side
        const z = m.z + sz * side
        const y = s._groundUnder(x, m.y + 2, z)
        if (!tm._hits(x, y + 0.01, z)) {
          tm.pos.set(x, y + 0.01, z)
          placed = true
          break
        }
      }
      if (!placed) tm.pos.set(seat.x, seat.y, seat.z)
    }
    tm.vel?.set(0, 0, 0)
    s._message(t('rideAlongOff'), 2)
  }

  clear() {
    this.on = null
  }
}
