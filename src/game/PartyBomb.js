// Bomb Defuse (2026-11-06, Gaymi's idea list 7: "a team party mode: one
// team plants the bomb, the other team defuses it" - servers + bots, like
// the other party modes). Plugs into PartyMode (PartyModes.js) as its `ext`.
//
// Red attacks, Blue defends, in a walled stone arena high in the sky
// (BD_Y) with crates for cover. Blue's half has two bomb sites, A and B -
// glowing pads. A Red player standing on a site for PLANT_S seconds plants
// the bomb; it then ticks for BOMB_S seconds and blows up (Red wins) unless
// a Blue player stands on it for DEFUSE_S seconds to defuse it (Blue wins).
// If the clock runs out before anything's planted, Blue wins. A shot stuns
// an enemy for STUN_S seconds - stunned players can't plant or defuse (the
// progress drains away). Teams are shuffled every round.
//
// The arena is real blocks (BuildSurvival `_placed`, gone when the game
// ends), put in on every screen. Meshes only, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'

export const BD_Y = 275
export const PLANT_S = 4
export const BOMB_S = 40
export const DEFUSE_S = 5
export const STUN_S = 3
const W = 40 // along x: Red's end at -x
const D = 26
const H = 4
const SITE_R = 1.6
// The two sites, from the middle: [dx, dz].
const SITES = [[11, -7], [11, 7]]
// Crates: [dx, dz, w, d, h] from the middle.
const COVER = [
  [-8, -4, 2, 2, 2], [-8, 5, 2, 2, 2], [-2, 0, 1, 6, 2], [3, -9, 2, 2, 3], [3, 8, 2, 2, 3],
  [7, -2, 2, 1, 2], [7, 2, 2, 1, 2], [14, 0, 1, 4, 2], [-14, -8, 2, 1, 2], [-14, 8, 2, 1, 2],
]

export class PartyBomb {
  constructor(pm) {
    this.pm = pm
    this.s = pm.s
    this.teams = true
    this.botsStun = true
    this.stunS = STUN_S
    this.planted = -1 // which site, or -1
    this.plantT = 0
    this.bombT = 0
    this.defuseT = 0
    this.target = 0 // the site Red's bots go for this round
    this._builtFor = ''
  }

  get B() {
    return this.s.B
  }

  home(me) {
    return { x: Math.round(me.x), y: BD_Y + 1, z: Math.round(me.z) }
  }

  site(i) {
    const h = this.pm.home
    return { x: h.x + SITES[i][0], z: h.z + SITES[i][1] }
  }

  base(tm) {
    const h = this.pm.home
    return { x: h.x + (tm === 'r' ? -1 : 1) * (W / 2 - 3), z: h.z + (Math.random() - 0.5) * (D - 8) }
  }

  begin() {
    this.planted = -1
    this.plantT = 0
    this.bombT = 0
    this.defuseT = 0
    this.target = Math.random() < 0.5 ? 0 : 1
  }

  placeBot(b) {
    const at = this.base(this.pm.teams.get(b.id) || 'r')
    b.x = b.tx = at.x
    b.z = b.tz = at.z
    b.y = b.ty = BD_Y + 1
    b.vy = 0
  }

  _onSite(p, i) {
    const s = this.site(i)
    return Math.hypot(p.x - s.x, p.z - s.z) < SITE_R && Math.abs(p.y - (BD_Y + 1)) < 2
  }

  run(people, dt) {
    const pm = this.pm
    if (pm.phase !== 'play') return
    const team = (p) => pm.teams.get(p.id)
    const up = (p) => !pm.stunned.has(p.id)
    if (this.planted < 0) {
      // Planting: any Red player standing on a site, not stunned.
      const on = [0, 1].find((i) => people.some((p) => team(p) === 'r' && up(p) && this._onSite(p, i)))
      if (on !== undefined) {
        this.plantT += dt
        if (this.plantT >= PLANT_S) {
          this.planted = on
          this.bombT = BOMB_S
          this.plantT = 0
          pm._say = { k: 'bombPlanted', n: BOMB_S }
        }
      } else this.plantT = Math.max(0, this.plantT - dt * 2)
      return
    }
    this.bombT -= dt
    const defusing = people.some((p) => team(p) === 'b' && up(p) && this._onSite(p, this.planted))
    if (defusing) {
      this.defuseT += dt
      if (this.defuseT >= DEFUSE_S) {
        pm._say = { k: 'bombDefused' }
        return pm._end('b')
      }
    } else this.defuseT = Math.max(0, this.defuseT - dt * 2)
    if (this.bombT <= 0) {
      this._boom()
      return pm._end('r')
    }
  }

  _boom() {
    const s = this.s
    const at = this.site(this.planted)
    s._fx?.explode?.(new THREE.Vector3(at.x * s.B, (BD_Y + 1.5) * s.B, at.z * s.B), 4)
    try { audioEngine.playSpecial?.('firework') } catch { /* no audio */ }
  }

  // Out of time with nothing planted: the defenders held.
  timeUp() {
    if (this.planted >= 0) return this.pm._end('r')
    this.pm._end('b')
  }

  botGoal(b, people) {
    const pm = this.pm
    if (pm.stunned.has(b.id)) return { x: b.x, z: b.z, stay: true }
    const tm = pm.teams.get(b.id)
    const stay = { x: b.x, z: b.z, stay: true }
    if (tm === 'r') {
      // Go plant; once it's down, guard it.
      const i = this.planted >= 0 ? this.planted : this.target
      const s = this.site(i)
      if (this.planted < 0) return Math.hypot(s.x - b.x, s.z - b.z) > 0.6 ? s : stay
      const a = (b.n || 1) * 1.7
      return { x: s.x + Math.cos(a) * 4, z: s.z + Math.sin(a) * 4 }
    }
    // Blue: on the bomb once it's down, else watch a site each.
    if (this.planted >= 0) {
      const s = this.site(this.planted)
      return Math.hypot(s.x - b.x, s.z - b.z) > 0.6 ? s : stay
    }
    const s = this.site((b.n || 0) % 2)
    const a = (b.n || 1) * 2.3 + performance.now() / 4000
    void people
    return { x: s.x - 3 + Math.cos(a) * 2, z: s.z + Math.sin(a) * 2 }
  }

  speed() {
    return this.pm.stunned.has(this.pm.myId) ? 0.3 : 1
  }

  events(was) {
    const pm = this.pm
    if (pm.phase === 'play' && (was.phase !== 'play' || was.round !== pm.round)) {
      const at = this.base(pm.myTeam || 'r')
      const s = this.s
      const tm = s.bm.tryMode
      tm.pos.set(at.x, BD_Y + 1, at.z)
      tm.vel?.set(0, 0, 0)
      s.bm.camera.position.set(at.x * this.B, (BD_Y + 1 + 1.62) * this.B, at.z * this.B)
      s.bm._yaw = pm.myTeam === 'b' ? Math.PI / 2 : -Math.PI / 2
    }
    // A beep from the bomb, faster near the end.
    if (pm.phase === 'play' && this.planted >= 0) {
      const gap = this.bombT < 10 ? 0.35 : this.bombT < 20 ? 0.7 : 1.2
      this._beep = (this._beep ?? 0) - 1 / 60
      if (this._beep <= 0) {
        this._beep = gap
        try { audioEngine.playSpecial?.('warn') } catch { /* no audio */ }
      }
    }
    if (!pm.runs && pm.phase === 'end' && was.phase === 'play' && pm.winner === 'r' && this.planted >= 0) this._boom()
  }

  draw() {
    const pm = this.pm
    if (!pm.home) return
    const key = `${pm.home.x},${pm.home.z}`
    if (this._builtFor !== key) {
      this._builtFor = key
      this._blocks()
    }
    const B = this.B
    if (!this._bomb) {
      const g = new THREE.Group()
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.7 * B, 0.4 * B, 0.5 * B), new THREE.MeshLambertMaterial({ color: 0x3a3a3a }))
      body.position.y = 0.2 * B
      this._light = new THREE.Mesh(new THREE.BoxGeometry(0.16 * B, 0.1 * B, 0.16 * B), new THREE.MeshBasicMaterial({ color: 0xff2a1a }))
      this._light.position.y = 0.45 * B
      const tape = new THREE.Mesh(new THREE.BoxGeometry(0.72 * B, 0.12 * B, 0.52 * B), new THREE.MeshLambertMaterial({ color: 0xe8c14a }))
      tape.position.y = 0.2 * B
      g.add(body, tape, this._light)
      this._bomb = g
      pm.arena.add(g)
      // A letter over each site.
      this._labels = SITES.map((_, i) => {
        const c = document.createElement('canvas')
        c.width = c.height = 64
        const x = c.getContext('2d')
        x.font = 'bold 52px sans-serif'
        x.textAlign = 'center'
        x.textBaseline = 'middle'
        x.lineWidth = 6
        x.strokeStyle = '#000'
        x.strokeText(i ? 'B' : 'A', 32, 34)
        x.fillStyle = '#ffd23f'
        x.fillText(i ? 'B' : 'A', 32, 34)
        const tex = new THREE.CanvasTexture(c)
        tex.colorSpace = THREE.SRGBColorSpace
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
        sp.scale.set(1.2 * B, 1.2 * B, 1)
        pm.arena.add(sp)
        return sp
      })
    }
    this._labels.forEach((sp, i) => {
      const at = this.site(i)
      sp.position.set(at.x * B, (BD_Y + 4) * B, at.z * B)
    })
    const on = pm.phase !== 'wait' && this.planted >= 0
    this._bomb.visible = on
    if (on) {
      const at = this.site(this.planted)
      this._bomb.position.set(at.x * B, (BD_Y + 1) * B, at.z * B)
      this._light.visible = Math.floor(performance.now() / (this.bombT < 10 ? 120 : 300)) % 2 === 0
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
    const hx = Math.floor(this.pm.home.x)
    const hz = Math.floor(this.pm.home.z)
    const x0 = hx - W / 2
    const z0 = hz - D / 2
    bm._suppressUndoRecording = true
    for (let x = x0 - 1; x <= x0 + W; x++) {
      for (let z = z0 - 1; z <= z0 + D; z++) {
        const edge = x === x0 - 1 || x === x0 + W || z === z0 - 1 || z === z0 + D
        put(x, BD_Y, z, (x + z) % 2 ? 'stonebricks' : 'polishedandesite')
        if (!edge) continue
        for (let y = BD_Y + 1; y <= BD_Y + H; y++) put(x, y, z, 'stonebricks')
      }
    }
    for (let z = z0; z < z0 + D; z++) {
      put(x0, BD_Y, z, 'redconcrete')
      put(x0 + W - 1, BD_Y, z, 'blueconcrete')
    }
    for (const [dx, dz] of SITES) {
      for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) put(hx + dx + x, BD_Y, hz + dz + z, x || z ? 'yellowconcrete' : 'glowstone')
    }
    for (const [dx, dz, w, d, h] of COVER) {
      for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) for (let y = 1; y <= h; y++) put(hx + dx + x, BD_Y + y, hz + dz + z - Math.floor(d / 2), y === h ? 'oakplanks' : 'spruceplanks')
    }
    bm._suppressUndoRecording = false
  }

  startText() {
    const tm = this.pm.myTeam
    return t(tm === 'b' ? 'bombStartDefend' : 'bombStartAttack', { p: PLANT_S, d: DEFUSE_S, n: BOMB_S })
  }

  hud() {
    const pm = this.pm
    let mid = t(pm.myTeam === 'b' ? 'bombYouDefend' : 'bombYouAttack')
    if (this.planted >= 0) {
      mid += ` · ${t('bombTicking', { site: this.planted ? 'B' : 'A', n: Math.max(0, Math.ceil(this.bombT)) })}`
      if (this.defuseT > 0) mid += ` · ${t('bombDefusing', { n: Math.round((this.defuseT / DEFUSE_S) * 100) })}`
    } else if (this.plantT > 0) mid += ` · ${t('bombPlanting', { n: Math.round((this.plantT / PLANT_S) * 100) })}`
    if (pm.stunned.has(pm.myId)) mid += ` · ${t('laserKoTag')}`
    return mid
  }

  winText(w) {
    return t(w === 'r' ? 'bombRedWins' : 'bombBlueWins')
  }

  protects(x, y, z) {
    const pm = this.pm
    if (!pm.home || y < BD_Y - 1 || y > BD_Y + H + 2) return false
    const x0 = Math.floor(pm.home.x) - W / 2
    const z0 = Math.floor(pm.home.z) - D / 2
    return x >= x0 - 2 && x <= x0 + W + 1 && z >= z0 - 2 && z <= z0 + D + 1
  }

  snap() {
    return { pl: this.planted, pt: Math.round(this.plantT * 10), bt: Math.round(this.bombT * 10), df: Math.round(this.defuseT * 10) }
  }

  apply(d) {
    this.planted = d.pl === 0 || d.pl === 1 ? d.pl : -1
    this.plantT = (Number(d.pt) || 0) / 10
    this.bombT = (Number(d.bt) || 0) / 10
    this.defuseT = (Number(d.df) || 0) / 10
  }

  dispose() {
    this._bomb = null
    this._labels = null
  }
}
