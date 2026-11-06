// Zombie Mini-Golf (2026-11-06, Gaymi's idea list 7: "a party mode where
// you putt a ball through holes, and zombies wander onto the course and
// knock it away" - servers + bots, like the other party modes). Plugs into
// PartyMode (PartyModes.js) as its `ext`.
//
// A course of HOLES lanes high in the sky (GOLF_Y), side by side, each with
// walls, a few bumpers and a cup with a flag at the far end. Everyone plays
// the same hole at once, each with their own ball. Shoot to putt: the ball
// rolls the way you're looking, harder the further back you stand from it
// (up to PUTT_REACH blocks). A stroke counts each putt. A ball that drops in
// the cup is done for that hole; when every ball is in (or HOLE_S runs out -
// then MISS_STROKES are added for a ball still out) everyone moves on. Two
// zombies shamble back and forth across the lane: a ball that rolls into
// one gets knocked away. Fewest strokes after the last hole wins.
//
// The course is real blocks (BuildSurvival `_placed`, gone when the game
// ends), put in on every screen. Balls, flags and zombies are meshes,
// never a light. Whoever runs the round rolls every ball; a guest's putt
// travels as a hit `g<angle in mrad>` with dmg = power x 10.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { zombieModel } from './TeamBattle.js'

export const GOLF_Y = 240
export const HOLES = 3
export const HOLE_S = 70
export const MISS_STROKES = 2
export const PUTT_REACH = 6
export const GOLF_ZOMBIES = 2
const LANE_W = 7 // inside the walls
const LANE_L = 26
const GAP = 3
const TEE = 2.5 // from the lane's start
const CUP_AT = 3 // from the lane's end
const CUP_R = 0.45
const CUP_MAX = 6 // faster than this rolls over the cup
const FRICTION = 1.6 // speed lost per second
const BALL_R = 0.18
const POWER = [3, 15]
const ZOMBIE_SPEED = 1.3
const ZOMBIE_KNOCK = 7
const BALL_COLORS = [0xffffff, 0xff5a5a, 0x5aa0ff, 0xffd23f, 0x6be06b, 0xd070ff, 0xff9a3a, 0x40e0d0]
// Bumpers on each hole: [dx from the lane middle, z from its start, w, d].
const BUMPERS = [
  [[0, 13, 1, 1]],
  [[-2, 9, 3, 1], [2, 16, 3, 1]],
  [[-1.5, 8, 2, 2], [1.5, 13, 2, 2], [0, 18, 4, 1]],
]

export class PartyGolf {
  constructor(pm) {
    this.pm = pm
    this.s = pm.s
    this.hole = 0
    this.holeLeft = HOLE_S
    this.balls = new Map() // id -> { x, z, vx, vz, cup }
    this.zombies = []
    this._builtFor = ''
    this._meshes = new Map()
    this._group = null
  }

  get B() {
    return this.s.B
  }

  home(me) {
    return { x: Math.round(me.x), y: GOLF_Y + 1, z: Math.round(me.z) }
  }

  // Lane `i`'s left edge (x, inside the wall) and start (z).
  _lane(i = this.hole) {
    const h = this.pm.home
    const all = HOLES * LANE_W + (HOLES - 1) * GAP
    return { x: Math.floor(h.x) - Math.floor(all / 2) + i * (LANE_W + GAP), z: Math.floor(h.z) - Math.floor(LANE_L / 2) }
  }

  tee(i = this.hole) {
    const l = this._lane(i)
    return { x: l.x + LANE_W / 2, z: l.z + TEE }
  }

  cup(i = this.hole) {
    const l = this._lane(i)
    return { x: l.x + LANE_W / 2, z: l.z + LANE_L - CUP_AT }
  }

  begin(people) {
    this.hole = 0
    this._startHole(people)
    for (const p of people) this.pm.score[p.id] = 0
  }

  _startHole(people) {
    this.holeLeft = HOLE_S
    this.balls.clear()
    const tee = this.tee()
    people.forEach((p, i) => this.balls.set(p.id, { x: tee.x + ((i % 4) - 1.5) * 0.8, z: tee.z + Math.floor(i / 4) * 0.8, vx: 0, vz: 0, cup: false }))
    const l = this._lane()
    this.zombies = Array.from({ length: GOLF_ZOMBIES }, (_, i) => ({ x: l.x + 1 + Math.random() * (LANE_W - 2), z: l.z + 8 + i * 8, dir: i % 2 ? 1 : -1 }))
    if (this.pm.phase === 'play') this._goTo(this.tee())
  }

  placeBot(b) {
    const at = this.tee()
    b.x = b.tx = at.x + (Math.random() - 0.5) * 3
    b.z = b.tz = at.z - 1
    b.y = b.ty = GOLF_Y + 1
    b.vy = 0
  }

  // Where it runs: roll the balls, walk the zombies, move on when done.
  run(people, dt) {
    const pm = this.pm
    if (pm.phase !== 'play') return
    for (const p of people) {
      if (!this.balls.has(p.id)) {
        const tee = this.tee()
        this.balls.set(p.id, { x: tee.x, z: tee.z, vx: 0, vz: 0, cup: false })
        if (!(p.id in pm.score)) pm.score[p.id] = 0
      }
    }
    for (const id of [...this.balls.keys()]) if (!people.some((p) => p.id === id)) this.balls.delete(id)
    this.holeLeft -= dt
    const l = this._lane()
    for (const zb of this.zombies) {
      zb.x += zb.dir * ZOMBIE_SPEED * dt
      if (zb.x < l.x + 0.6 || zb.x > l.x + LANE_W - 0.6) zb.dir = -zb.dir
    }
    const cup = this.cup()
    for (const [id, b] of this.balls) {
      if (b.cup) continue
      this._roll(b, dt, l)
      for (const zb of this.zombies) {
        const dx = b.x - zb.x
        const dz = b.z - zb.z
        const d = Math.hypot(dx, dz)
        if (d < 0.55 && d > 0.001) {
          b.vx = (dx / d) * ZOMBIE_KNOCK
          b.vz = (dz / d) * ZOMBIE_KNOCK
          pm._say = { k: 'golfKnocked', name: id }
        }
      }
      const sp = Math.hypot(b.vx, b.vz)
      if (Math.hypot(b.x - cup.x, b.z - cup.z) < CUP_R && sp < CUP_MAX) {
        b.cup = true
        b.vx = b.vz = 0
        pm._say = { k: 'golfSunk', name: id, n: pm.score[id] || 0 }
      }
    }
    // Bots putt once their ball has stopped.
    for (const p of people) {
      if (!p.bot) continue
      const b = this.balls.get(p.id)
      if (!b || b.cup || Math.hypot(b.vx, b.vz) > 0.05) continue
      p.bot.putt = (p.bot.putt ?? 1 + Math.random()) - dt
      if (p.bot.putt > 0) continue
      p.bot.putt = 1.2 + Math.random() * 1.5
      const d = Math.hypot(cup.x - b.x, cup.z - b.z)
      const a = Math.atan2(cup.z - b.z, cup.x - b.x) + (Math.random() - 0.5) * 0.35
      this._putt(p.id, a, Math.min(POWER[1], Math.sqrt(2 * FRICTION * d) * (0.85 + Math.random() * 0.35)))
    }
    const done = [...this.balls.values()].every((b) => b.cup)
    if (done || this.holeLeft <= 0) {
      for (const [id, b] of this.balls) if (!b.cup) pm.score[id] = (pm.score[id] || 0) + MISS_STROKES
      if (this.hole + 1 >= HOLES) return this.timeUp()
      this.hole++
      pm._say = { k: 'golfNextHole', n: this.hole + 1 }
      this._startHole(people)
    }
  }

  // A ball rolls, slows, and bounces off the walls and bumpers.
  _roll(b, dt, l) {
    const sp = Math.hypot(b.vx, b.vz)
    if (sp < 0.03) {
      b.vx = b.vz = 0
      return
    }
    const slow = Math.max(0, sp - FRICTION * dt) / sp
    b.vx *= slow
    b.vz *= slow
    const nx = b.x + b.vx * dt
    const nz = b.z + b.vz * dt
    if (nx < l.x + BALL_R || nx > l.x + LANE_W - BALL_R) b.vx = -b.vx * 0.8
    else b.x = nx
    if (nz < l.z + BALL_R || nz > l.z + LANE_L - BALL_R) b.vz = -b.vz * 0.8
    else b.z = nz
    const mid = l.x + LANE_W / 2
    for (const [dx, z0, w, d] of BUMPERS[this.hole] || []) {
      const x0 = mid + dx - w / 2
      if (b.x > x0 - BALL_R && b.x < x0 + w + BALL_R && b.z > l.z + z0 - BALL_R && b.z < l.z + z0 + d + BALL_R) {
        // Out the nearer side.
        const pushX = Math.min(b.x - (x0 - BALL_R), x0 + w + BALL_R - b.x)
        const pushZ = Math.min(b.z - (l.z + z0 - BALL_R), l.z + z0 + d + BALL_R - b.z)
        if (pushX < pushZ) {
          b.vx = -b.vx * 0.8
          b.x = b.x < x0 + w / 2 ? x0 - BALL_R : x0 + w + BALL_R
        } else {
          b.vz = -b.vz * 0.8
          b.z = b.z < l.z + z0 + d / 2 ? l.z + z0 - BALL_R : l.z + z0 + d + BALL_R
        }
      }
    }
  }

  _putt(id, angle, power) {
    const b = this.balls.get(id)
    if (!b || b.cup || Math.hypot(b.vx, b.vz) > 0.05) return false
    const p = Math.max(POWER[0], Math.min(POWER[1], power))
    b.vx = Math.cos(angle) * p
    b.vz = Math.sin(angle) * p
    this.pm.score[id] = (this.pm.score[id] || 0) + 1
    return true
  }

  timeUp() {
    // Fewest strokes wins.
    let best = ''
    let low = Infinity
    let tie = false
    for (const [id, n] of Object.entries(this.pm.score)) {
      if (n < low) {
        low = n
        best = id
        tie = false
      } else if (n === low) tie = true
    }
    this.pm._end(tie || !best ? 'tie' : best)
  }

  // A bot walks to just behind its ball.
  botGoal(b) {
    const ball = this.balls.get(b.id)
    if (!ball || ball.cup) return { x: b.x, z: b.z, stay: true }
    const cup = this.cup()
    const a = Math.atan2(cup.z - ball.z, cup.x - ball.x)
    const at = { x: ball.x - Math.cos(a) * 1.5, z: ball.z - Math.sin(a) * 1.5 }
    return Math.hypot(at.x - b.x, at.z - b.z) > 0.5 ? at : { x: b.x, z: b.z, stay: true }
  }

  // My shot: putt my ball the way I'm looking.
  shoot(ray) {
    const pm = this.pm
    if (pm.phase !== 'play') return false
    const me = this.s.bodyPos()
    const b = this.balls.get(pm.myId)
    if (!b || b.cup) return false
    const d = Math.hypot(b.x - me.x, b.z - me.z)
    if (d > PUTT_REACH) {
      this.s._message(t('golfTooFar', { n: PUTT_REACH }), 2)
      return false
    }
    if (Math.hypot(b.vx, b.vz) > 0.05) return false
    const a = Math.atan2(ray.direction.z, ray.direction.x)
    const power = POWER[0] + ((POWER[1] - POWER[0]) * Math.max(0, d - 0.5)) / (PUTT_REACH - 0.5)
    try { audioEngine.playSpecial?.('pop') } catch { /* no audio */ }
    if (pm.runs) return this._putt(pm.myId, a, power)
    this.s.net.queueHit(`g${Math.round(a * 1000)}`, Math.round(power * 10))
    return true
  }

  // A guest's putt.
  remoteHit(h) {
    const m = /^g(-?\d{1,5})$/.exec(String(h.id))
    if (!m || !h.by) return
    this._putt(String(h.by), Number(m[1]) / 1000, (Number(h.dmg) || 0) / 10)
  }

  speed() {
    return 1
  }

  // Teleport me to the tee when a hole starts.
  _goTo(at) {
    const s = this.s
    const tm = s.bm.tryMode
    tm.pos.set(at.x, GOLF_Y + 1, at.z - 1.2)
    tm.vel?.set(0, 0, 0)
    s.bm.camera.position.set(at.x * this.B, (GOLF_Y + 1 + 1.62) * this.B, (at.z - 1.2) * this.B)
    s.bm._yaw = Math.PI
  }

  events(was) {
    const pm = this.pm
    if (pm.phase === 'play' && (was.phase !== 'play' || was.round !== pm.round)) this._goTo(this.tee())
    if (pm.phase === 'play' && this._shownHole !== this.hole) {
      if (this._shownHole !== undefined && was.phase === 'play') this._goTo(this.tee())
      this._shownHole = this.hole
    }
    if (pm.phase !== 'play') this._shownHole = undefined
  }

  // The course, balls, flag and zombies.
  draw() {
    const pm = this.pm
    if (!pm.home) return
    const key = `${pm.home.x},${pm.home.z}`
    if (this._builtFor !== key) {
      this._builtFor = key
      this._blocks()
    }
    const B = this.B
    if (!this._group) {
      this._group = new THREE.Group()
      pm.arena.add(this._group)
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.06 * B, 2 * B, 0.06 * B), new THREE.MeshBasicMaterial({ color: 0xeeeeee }))
      pole.position.y = 1 * B
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.6 * B, 0.4 * B, 0.03 * B), new THREE.MeshBasicMaterial({ color: 0xff3a3a }))
      flag.position.set(0.32 * B, 1.75 * B, 0)
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(CUP_R * B, CUP_R * B, 0.02 * B, 16), new THREE.MeshBasicMaterial({ color: 0x111111 }))
      hole.position.y = 0.01 * B
      this._flag = new THREE.Group()
      this._flag.add(pole, flag, hole)
      this._group.add(this._flag)
      this._zMeshes = Array.from({ length: GOLF_ZOMBIES }, () => {
        const m = zombieModel({ k: '' })
        m.group.scale.multiplyScalar(B)
        this._group.add(m.group)
        return m
      })
    }
    const live = pm.phase !== 'wait'
    const cup = this.cup()
    this._flag.visible = live
    this._flag.position.set(cup.x * B, (GOLF_Y + 1) * B, cup.z * B)
    const now = performance.now() / 1000
    this._zMeshes.forEach((m, i) => {
      const zb = this.zombies[i]
      m.group.visible = live && !!zb
      if (!zb) return
      m.group.position.set(zb.x * B, (GOLF_Y + 1) * B, zb.z * B)
      m.group.rotation.y = zb.dir > 0 ? Math.PI / 2 : -Math.PI / 2
      const swing = Math.sin(now * 5 + i) * 0.5
      m.legs?.forEach((leg, k) => { leg.rotation.x = k % 2 ? swing : -swing })
    })
    const seen = new Set()
    let n = 0
    for (const [id, b] of this.balls) {
      seen.add(id)
      let mesh = this._meshes.get(id)
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * B, 12, 8), new THREE.MeshBasicMaterial({ color: id === pm.myId ? 0xffffff : BALL_COLORS[1 + (n % (BALL_COLORS.length - 1))] }))
        this._group.add(mesh)
        this._meshes.set(id, mesh)
      }
      n++
      mesh.visible = live && !b.cup
      mesh.position.set(b.x * B, (GOLF_Y + 1 + BALL_R) * B, b.z * B)
    }
    for (const [id, mesh] of this._meshes) {
      if (seen.has(id)) continue
      mesh.removeFromParent()
      mesh.geometry.dispose()
      mesh.material.dispose()
      this._meshes.delete(id)
    }
  }

  _blocks() {
    const s = this.s
    const bm = s.bm
    const put = (x, y, z, type) => {
      if (bm.getBlockAt(x, y, z) === type) return
      if (bm.getBlockAt(x, y, z)) bm.removeBlock(x, y, z)
      bm.placeBlock(x, y, z, type, true)
      s._placed.set(bm._key(x, y, z), type)
    }
    bm._suppressUndoRecording = true
    for (let i = 0; i < HOLES; i++) {
      const l = this._lane(i)
      for (let x = l.x - 1; x <= l.x + LANE_W; x++) {
        for (let z = l.z - 1; z <= l.z + LANE_L; z++) {
          const edge = x === l.x - 1 || x === l.x + LANE_W || z === l.z - 1 || z === l.z + LANE_L
          put(x, GOLF_Y, z, edge ? 'oakplanks' : (x + z) % 2 ? 'limeconcrete' : 'greenconcrete')
          if (edge) put(x, GOLF_Y + 1, z, 'oakplanks')
        }
      }
      // The tee: a white strip.
      for (let x = l.x; x < l.x + LANE_W; x++) put(x, GOLF_Y, l.z + 1, 'whiteconcrete')
      const mid = l.x + LANE_W / 2
      for (const [dx, z0, w, d] of BUMPERS[i]) {
        for (let x = Math.floor(mid + dx - w / 2); x < Math.ceil(mid + dx + w / 2); x++) for (let z = z0; z < z0 + d; z++) put(x, GOLF_Y + 1, l.z + z, 'redconcrete')
      }
    }
    bm._suppressUndoRecording = false
  }

  startText() {
    return t('golfStart', { n: HOLES, r: PUTT_REACH })
  }

  hud() {
    const pm = this.pm
    const b = this.balls.get(pm.myId)
    let mid = t('golfHud', { h: this.hole + 1, max: HOLES, n: pm.score[pm.myId] || 0, s: Math.max(0, Math.ceil(this.holeLeft)) })
    if (b?.cup) mid += ` · ${t('golfInTag')}`
    return mid
  }

  protects(x, y, z) {
    const pm = this.pm
    if (!pm.home || y < GOLF_Y - 1 || y > GOLF_Y + 3) return false
    const a = this._lane(0)
    const b = this._lane(HOLES - 1)
    return x >= a.x - 2 && x <= b.x + LANE_W + 1 && z >= a.z - 2 && z <= a.z + LANE_L + 1
  }

  snap() {
    const bx = {}
    const bz = {}
    const bc = {}
    for (const [id, b] of this.balls) {
      const k = this.pm._out(id)
      bx[k] = Math.round(b.x * 100)
      bz[k] = Math.round(b.z * 100)
      bc[k] = b.cup ? 1 : 0
    }
    return { ho: this.hole, hl: Math.round(this.holeLeft), bx, bz, bc, zx: this.zombies.map((z) => Math.round(z.x * 100)), zz: this.zombies.map((z) => Math.round(z.z * 100)), zd: this.zombies.map((z) => z.dir) }
  }

  apply(d) {
    this.hole = Math.max(0, Math.min(HOLES - 1, Number(d.ho) || 0))
    this.holeLeft = Number(d.hl) || 0
    const next = new Map()
    for (const [id, x] of Object.entries(d.bx || {})) {
      const z = d.bz?.[id]
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue
      next.set(id, { x: x / 100, z: z / 100, vx: 0, vz: 0, cup: d.bc?.[id] === 1 })
    }
    this.balls = next
    const zx = [].concat(d.zx || [])
    this.zombies = zx.map((x, i) => ({ x: x / 100, z: (Number(d.zz?.[i]) || 0) / 100, dir: d.zd?.[i] < 0 ? -1 : 1 }))
  }

  dispose() {
    for (const m of this._meshes.values()) {
      m.geometry.dispose()
      m.material.dispose()
    }
    this._meshes.clear()
    this._group = null
  }
}
