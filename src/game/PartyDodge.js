// Dodgeball (2026-11-06, Gaymi's idea list 8: "two teams throwing balls.
// GayZ already has throwing (Snowballs, PlayThrow)"). A party mode,
// servers + bots. Plugs into PartyMode (PartyModes.js) as its `ext`.
//
// Red against Blue on a court in the sky (DB_Y), split down the middle by
// a white line nobody can cross. Fire (click / the fire button) to throw a
// big soft ball where you look - it flies in an arc (BALL_SPEED) and can
// be dodged. A ball that hits someone on the other team knocks them out
// for OUT_S seconds (they sit frozen, their vest blinking) and scores a
// point for the thrower's team. One throw every THROW_S. The team with
// the most hits when the clock runs out wins.
// Each thrower flies their own ball; whoever's ball it is says what it
// hit (a guest's hit travels like Laser Tag's, `s<who>`). The host's and
// bots' balls show for everyone (the ext snapshot). Real blocks for the
// court (BuildSurvival `_placed`), meshes for the balls. Never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { MOB_HEIGHT } from './PlayRules.js'

export const DB_Y = 180
export const OUT_S = 5
export const THROW_S = 1.2
export const BALL_SPEED = 20
export const DB_W = 30 // along x (red on -x, blue on +x)
export const DB_D = 18
const BALL_R = 0.35
const GRAV = 14
const LIFE = 3
const TEAM_COLORS = { r: 0xe8443a, b: 0x3a7be8 }
const BOT_THROW = [1.6, 3.2]

export class PartyDodge {
  constructor(pm) {
    this.pm = pm
    this.s = pm.s
    this.teams = true
    this.stunS = OUT_S
    this.balls = [] // { x, y, z, vx, vy, vz, team, by, life, mine }
    this.shown = [] // the host's balls, on a guest's screen
    this._meshes = []
    this._vests = new Map()
    this._builtFor = ''
    this._nextAt = 0
  }

  get B() {
    return this.s.B
  }

  home(me) {
    return { x: Math.round(me.x), y: DB_Y + 1, z: Math.round(me.z) }
  }

  // A team's half: { lo, hi } in x.
  half(tm) {
    const h = this.pm.home
    return tm === 'r' ? { lo: h.x - DB_W / 2 + 1, hi: h.x - 0.6 } : { lo: h.x + 0.6, hi: h.x + DB_W / 2 - 1 }
  }

  placeBot(b) {
    const tm = this.pm.teams.get(b.id) || 'r'
    const hf = this.half(tm)
    b.x = b.tx = hf.lo + Math.random() * (hf.hi - hf.lo)
    b.z = b.tz = this.pm.home.z + (Math.random() - 0.5) * (DB_D - 4)
    b.y = b.ty = DB_Y + 1
    b.vy = 0
    b.throwIn = BOT_THROW[0] + Math.random() * (BOT_THROW[1] - BOT_THROW[0])
  }

  begin() {
    this.balls = []
  }

  // A hit (where the round runs): out for a while, a point for the thrower's team.
  onStun(id, by) {
    const pm = this.pm
    const tm = pm.teams.get(by)
    if (!tm || pm.teams.get(id) === tm || pm.phase !== 'play') return
    pm.score[tm] = (pm.score[tm] || 0) + 1
    pm._say = { k: 'dodgeHit', name: id, team: tm }
  }

  _throw(from, dir, team, by, mine) {
    this.balls.push({ x: from.x, y: from.y, z: from.z, vx: dir.x * BALL_SPEED, vy: dir.y * BALL_SPEED + 3, vz: dir.z * BALL_SPEED, team, by, life: 0, mine })
    try { audioEngine.playSpecial?.('whoosh') } catch { /* no audio */ }
  }

  run(people, dt) {
    const pm = this.pm
    if (pm.phase !== 'play') return
    // Bots throw at someone on the other side.
    for (const p of people) {
      const b = p.bot
      if (!b || pm.stunned.has(b.id)) continue
      b.throwIn = (b.throwIn ?? 2) - dt
      if (b.throwIn > 0) continue
      b.throwIn = BOT_THROW[0] + Math.random() * (BOT_THROW[1] - BOT_THROW[0])
      const tm = pm.teams.get(b.id)
      const foes = people.filter((q) => pm.teams.get(q.id) && pm.teams.get(q.id) !== tm && !pm.stunned.has(q.id))
      const foe = foes[Math.floor(Math.random() * foes.length)]
      if (!foe) continue
      // Aim a little off, and lead the target a bit.
      const tx = foe.x + (Math.random() - 0.5) * 2.5
      const tz = foe.z + (Math.random() - 0.5) * 2.5
      const d = Math.hypot(tx - b.x, tz - b.z) || 1
      const flat = new THREE.Vector3((tx - b.x) / d, 0, (tz - b.z) / d)
      // Enough loft to get there.
      const lift = Math.min(0.5, (d * GRAV) / (2 * BALL_SPEED * BALL_SPEED))
      flat.multiplyScalar(Math.cos(lift)).setY(Math.sin(lift) - 0.15)
      this._throw({ x: b.x, y: b.y + 1.4, z: b.z }, flat.normalize(), tm, b.id, false)
    }
  }

  // Every frame on every screen: my balls (and, where it runs, the bots').
  _fly(dt) {
    const pm = this.pm
    const s = this.s
    const people = pm._people()
    for (const ball of [...this.balls]) {
      ball.life += dt
      ball.vy -= GRAV * dt
      ball.x += ball.vx * dt
      ball.y += ball.vy * dt
      ball.z += ball.vz * dt
      let gone = ball.life > LIFE || ball.y < DB_Y + 0.4
      if (!gone) {
        for (const p of people) {
          if (pm.teams.get(p.id) === ball.team || pm.stunned.has(p.id)) continue
          if (Math.hypot(p.x - ball.x, p.z - ball.z) > 0.4 + BALL_R || ball.y < p.y - BALL_R || ball.y > p.y + MOB_HEIGHT + BALL_R) continue
          gone = true
          try { audioEngine.playSpecial?.('thud') } catch { /* no audio */ }
          if (pm.runs) pm.stun(p.id, ball.by)
          else if (ball.mine) {
            s.net?.queueHit(`s${p.id}`, 0)
            pm.stunned.set(p.id, OUT_S)
          }
          break
        }
      }
      if (gone) this.balls.splice(this.balls.indexOf(ball), 1)
    }
  }

  // Fire: throw a ball (if you're not out and it's been long enough).
  shoot(ray) {
    const pm = this.pm
    if (pm.phase !== 'play' || pm.stunned.has(pm.myId) || !pm.myTeam) return true
    const now = performance.now()
    if (now < this._nextAt) return true
    this._nextAt = now + THROW_S * 1000
    const B = this.B
    const o = ray.origin
    this._throw({ x: o.x / B + ray.direction.x * 0.6, y: o.y / B - 0.2, z: o.z / B + ray.direction.z * 0.6 }, ray.direction, pm.myTeam, pm.myId, true)
    return true
  }

  botGoal(b) {
    const pm = this.pm
    if (pm.stunned.has(b.id)) return { x: b.x, z: b.z, stay: true }
    const hf = this.half(pm.teams.get(b.id) || 'r')
    if (!b.wander || Math.hypot(b.wander.x - b.x, b.wander.z - b.z) < 0.8 || Math.random() < 0.01) {
      b.wander = { x: hf.lo + Math.random() * (hf.hi - hf.lo), z: pm.home.z + (Math.random() - 0.5) * (DB_D - 3) }
    }
    return b.wander
  }

  speed() {
    return this.pm.stunned.has(this.pm.myId) ? 0 : 1
  }

  // A guest's ball hit someone (s<who>).
  remoteHit(h) {
    this.pm.stun(String(h.id).slice(1), String(h.by || ''))
  }

  markColor() {
    return null
  }

  events(was) {
    const pm = this.pm
    const s = this.s
    const tm = s.bm.tryMode
    if (pm.phase === 'play' && (was.phase !== 'play' || was.round !== pm.round)) {
      const hf = this.half(pm.myTeam || 'r')
      tm.pos.set((hf.lo + hf.hi) / 2, DB_Y + 1, pm.home.z + 0.5)
      tm.vel?.set(0, 0, 0)
      s.bm._yaw = pm.myTeam === 'b' ? Math.PI / 2 : -Math.PI / 2
    }
    // Your own half only (the middle line).
    if (pm.phase === 'play' && pm.myTeam && Math.abs(tm.pos.y - (DB_Y + 1)) < 4) {
      const hf = this.half(pm.myTeam)
      if (tm.pos.x < hf.lo || tm.pos.x > hf.hi) {
        tm.pos.x = Math.max(hf.lo, Math.min(hf.hi, tm.pos.x))
        if (tm.vel) tm.vel.x = 0
      }
    }
    if (pm.phase === 'play' && pm.stunned.has(pm.myId) && !this._out) s._message(t('dodgeYouOut', { n: OUT_S }), 2.5)
    this._out = pm.stunned.has(pm.myId)
  }

  draw(dt = 1 / 60) {
    const pm = this.pm
    if (!pm.home) return
    const key = `${pm.home.x},${pm.home.z}`
    if (this._builtFor !== key) {
      this._builtFor = key
      this._blocks()
    }
    this._fly(Math.min(dt, 0.05))
    const B = this.B
    const list = [...this.balls, ...(pm.runs ? [] : this.shown)]
    while (this._meshes.length < list.length) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * B, 12, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }))
      pm.arena.add(m)
      this._meshes.push(m)
    }
    this._meshes.forEach((m, i) => {
      const b = list[i]
      m.visible = !!b
      if (!b) return
      m.position.set(b.x * B, b.y * B, b.z * B)
      m.material.color.set(TEAM_COLORS[b.team] || 0xffffff)
    })
    for (const b of pm.bots.values()) this._vest(b.id, b.group)
    for (const [pid, p] of this.s.net?.players || []) if (p.group) this._vest(pid, p.group)
  }

  _vest(id, group) {
    const tm = this.pm.teams.get(id)
    let v = this._vests.get(id)
    if (!v || v.parent !== group) {
      v?.removeFromParent()
      const B = this.B
      v = new THREE.Mesh(new THREE.BoxGeometry(0.62 * B, 0.55 * B, 0.4 * B), new THREE.MeshLambertMaterial({ color: 0xffffff }))
      v.position.y = MOB_HEIGHT * 0.62 * B
      group.add(v)
      this._vests.set(id, v)
    }
    v.visible = !!tm && this.pm.phase !== 'wait'
    if (!tm) return
    const out = this.pm.stunned.has(id) && Math.floor(performance.now() / 150) % 2
    v.material.color.set(out ? 0x222222 : TEAM_COLORS[tm])
  }

  _blocks() {
    const s = this.s
    const bm = s.bm
    const h = this.pm.home
    const x0 = h.x - DB_W / 2
    const z0 = h.z - DB_D / 2
    const put = (x, y, z, type) => {
      if (bm.getBlockAt(x, y, z) === type) return
      if (bm.getBlockAt(x, y, z)) bm.removeBlock(x, y, z)
      bm.placeBlock(x, y, z, type, true)
      s._placed.set(bm._key(x, y, z), type)
    }
    bm._suppressUndoRecording = true
    for (let x = x0 - 1; x <= x0 + DB_W; x++) {
      for (let z = z0 - 1; z <= z0 + DB_D; z++) {
        const edge = x === x0 - 1 || x === x0 + DB_W || z === z0 - 1 || z === z0 + DB_D
        const floor = x === h.x || x === h.x - 1 ? 'whiteconcrete' : x < h.x ? 'redconcrete' : 'blueconcrete'
        put(x, DB_Y, z, edge ? 'oakplanks' : floor)
        if (edge) for (let y = DB_Y + 1; y <= DB_Y + 2; y++) put(x, y, z, 'glass')
      }
    }
    bm._suppressUndoRecording = false
  }

  startText() {
    const tm = this.pm.myTeam
    return t('dodgeStart', { team: t(tm === 'b' ? 'partyBlue' : 'partyRed'), n: OUT_S })
  }

  hud() {
    const pm = this.pm
    let mid = `${t('partyRed')} ${pm.score.r || 0} - ${pm.score.b || 0} ${t('partyBlue')}`
    if (pm.myTeam) mid += ` · ${t('partyYourTeam', { team: t(pm.myTeam === 'r' ? 'partyRed' : 'partyBlue') })}`
    if (pm.stunned.has(pm.myId)) mid += ` · ${t('dodgeOutTag')}`
    return mid
  }

  protects(x, y, z) {
    const h = this.pm.home
    if (!h || y < DB_Y - 1 || y > DB_Y + 3) return false
    return Math.abs(x - h.x) <= DB_W / 2 + 2 && Math.abs(z - h.z) <= DB_D / 2 + 2
  }

  // The host's balls (and its bots'), for the others to see.
  snap() {
    return { db: this.balls.slice(0, 24).map((b) => [+b.x.toFixed(1), +b.y.toFixed(1), +b.z.toFixed(1), b.team === 'b' ? 1 : 0]) }
  }

  apply(d) {
    this.shown = (Array.isArray(d.db) ? d.db : []).slice(0, 24).filter((v) => Array.isArray(v) && v.slice(0, 3).every(Number.isFinite)).map((v) => ({ x: v[0], y: v[1], z: v[2], team: v[3] ? 'b' : 'r' }))
  }

  dispose() {
    for (const m of this._meshes) {
      m.removeFromParent()
      m.geometry.dispose()
      m.material.dispose()
    }
    this._meshes = []
    for (const v of this._vests.values()) {
      v.removeFromParent()
      v.geometry.dispose()
      v.material.dispose()
    }
    this._vests.clear()
    this.balls = []
  }
}
