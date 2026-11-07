// Simon Says (2026-11-06, Gaymi's idea list 8: "silly and great with
// friends. These use the party-mode system GayZ already has"). A party
// mode, servers + bots. Plugs into PartyMode (PartyModes.js) as its `ext`.
//
// A square floor in the sky (SS_Y) with a coloured pad in each corner.
// Simon calls out an order every few seconds - Jump!, Freeze!, Run!, or
// Go to Red/Blue/Green/Yellow! - and you have CMD_S seconds:
// - "Simon says ..." - do it, or you're out.
// - Without "Simon says" - DON'T do it, or you're out (Freeze! without
//   Simon means keep moving).
// Jump = get off the floor; Freeze = barely move; Run = cover RUN_DIST
// blocks; a colour = be standing on that pad when time's up.
// Whoever's out watches (PartyMode `out`). The orders come faster as it
// goes on. Last one in wins; if the clock runs out, it's a draw.
// Everything is judged from where people are, so it works the same for
// bots and for players on a server. Bots get it right BOT_SMART of the
// time. Real blocks (BuildSurvival `_placed`). Never a light.
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'

export const SS_Y = 200
export const CMD_S = 4
export const MIN_CMD_S = 2.5
export const GAP_S = 1.5
export const SIMON_CHANCE = 0.7
export const RUN_DIST = 4
export const FREEZE_DIST = 0.6
export const BOT_SMART = 0.85
const HALF = 9
const PAD = 2 // pads are PAD x 2 + 1 wide
export const COMMANDS = ['jump', 'freeze', 'run', 'red', 'blue', 'green', 'yellow']
const PADS = { red: [-1, -1, 'redwool'], blue: [1, -1, 'bluewool'], green: [-1, 1, 'greenwool'], yellow: [1, 1, 'yellowwool'] }

export class PartySimon {
  constructor(pm) {
    this.pm = pm
    this.s = pm.s
    this.sub = 'gap'
    this.subLeft = GAP_S
    this.cmd = ''
    this.simon = true
    this.count = 0
    this.track = new Map() // id -> { x, z, y0, moved, rose }
    this._builtFor = ''
  }

  home(me) {
    return { x: Math.round(me.x), y: SS_Y + 1, z: Math.round(me.z) }
  }

  _alive(people) {
    return people.filter((p) => !this.pm.out.has(p.id))
  }

  begin() {
    this.sub = 'gap'
    this.subLeft = GAP_S * 2
    this.cmd = ''
    this.count = 0
    this.track.clear()
  }

  placeBot(b) {
    const h = this.pm.home
    b.x = b.tx = h.x + 0.5 + (Math.random() - 0.5) * 8
    b.z = b.tz = h.z + 0.5 + (Math.random() - 0.5) * 8
    b.y = b.ty = SS_Y + 1
    b.vy = 0
  }

  // Which pad a spot is on ('' for none).
  padAt(x, z) {
    const h = this.pm.home
    for (const [c, [sx, sz]] of Object.entries(PADS)) {
      const cx = h.x + sx * (HALF - PAD - 1)
      const cz = h.z + sz * (HALF - PAD - 1)
      if (Math.abs(Math.floor(x) - cx) <= PAD && Math.abs(Math.floor(z) - cz) <= PAD) return c
    }
    return ''
  }

  _padMiddle(c) {
    const h = this.pm.home
    const [sx, sz] = PADS[c]
    return { x: h.x + sx * (HALF - PAD - 1) + 0.5, z: h.z + sz * (HALF - PAD - 1) + 0.5 }
  }

  // Did they do the order?
  did(id, cmd = this.cmd) {
    const tr = this.track.get(id)
    if (!tr) return false
    if (cmd === 'jump') return tr.rose
    if (cmd === 'freeze') return tr.moved < FREEZE_DIST
    if (cmd === 'run') return tr.moved >= RUN_DIST
    return this.padAt(tr.x, tr.z) === cmd
  }

  _say() {
    this.cmd = COMMANDS[Math.floor(Math.random() * COMMANDS.length)]
    this.simon = Math.random() < SIMON_CHANCE
    this.count++
    this.sub = 'cmd'
    this.subLeft = Math.max(MIN_CMD_S, CMD_S - this.count * 0.08)
    this.track.clear()
    for (const p of this._alive(this.pm._people())) {
      this.track.set(p.id, { x: p.x, z: p.z, y0: p.y, moved: 0, rose: false })
      if (p.bot) p.bot.smart = Math.random() < BOT_SMART
    }
  }

  run(people, dt) {
    const pm = this.pm
    if (pm.phase !== 'play') return
    const alive = this._alive(people)
    if (alive.length <= 1 && people.length > 1) return pm._end(alive[0]?.id || 'tie')
    this.subLeft -= dt
    if (this.sub === 'gap') {
      if (this.subLeft <= 0) this._say()
      return
    }
    for (const p of alive) {
      const tr = this.track.get(p.id)
      if (!tr) continue
      tr.moved += Math.hypot(p.x - tr.x, p.z - tr.z)
      tr.x = p.x
      tr.z = p.z
      if (p.y > tr.y0 + 0.5) tr.rose = true
    }
    if (this.subLeft > 0) return
    // Time's up: who got it wrong?
    const wrong = alive.filter((p) => this.track.has(p.id) && this.did(p.id) !== this.simon)
    // Everyone wrong at once: nobody's out (a do-over).
    if (wrong.length < alive.length) for (const p of wrong) pm.out.add(p.id)
    if (wrong.length === 1 && wrong.length < alive.length) pm._say = { k: 'simonOut', name: wrong[0].id }
    this.sub = 'gap'
    this.subLeft = GAP_S
    this.cmd = ''
  }

  timeUp() {
    this.pm._end('tie')
  }

  botGoal(b) {
    const pm = this.pm
    if (pm.out.has(b.id)) return { x: b.x, z: b.z, stay: true }
    const h = pm.home
    const wander = () => {
      if (!b.wander || Math.hypot(b.wander.x - b.x, b.wander.z - b.z) < 1) b.wander = { x: h.x + 0.5 + (Math.random() - 0.5) * 12, z: h.z + 0.5 + (Math.random() - 0.5) * 12 }
      return b.wander
    }
    if (this.sub !== 'cmd') return wander()
    // Do it (if Simon said and the bot's sharp), or don't.
    const doIt = this.simon === !!b.smart
    if (this.cmd === 'jump') {
      if (doIt && b.vy === 0) b.vy = 8.6
      return { x: b.x, z: b.z, stay: true }
    }
    if (this.cmd === 'freeze') return doIt ? { x: b.x, z: b.z, stay: true } : wander()
    if (this.cmd === 'run') return doIt ? wander() : { x: b.x, z: b.z, stay: true }
    if (doIt) return this._padMiddle(this.cmd)
    // Keep off that pad.
    return this.padAt(b.x, b.z) === this.cmd ? { x: h.x + 0.5, z: h.z + 0.5 } : { x: b.x, z: b.z, stay: true }
  }

  speed() {
    const pm = this.pm
    return pm.phase === 'play' && pm.out.has(pm.myId) ? 0 : 1
  }

  markColor() {
    return null
  }

  shoot() {
    return false
  }

  orderText() {
    if (!this.cmd) return ''
    const order = t(`simonCmd_${this.cmd}`)
    return this.simon ? t('simonSays', { order }) : order
  }

  events(was) {
    const pm = this.pm
    const s = this.s
    if (pm.phase === 'play' && (was.phase !== 'play' || was.round !== pm.round)) {
      const h = pm.home
      s.bm.tryMode.pos.set(h.x + 0.5, SS_Y + 1, h.z + 0.5)
      s.bm.tryMode.vel?.set(0, 0, 0)
      this._shown = ''
    }
    const key = pm.phase === 'play' && this.sub === 'cmd' ? `${this.count}` : ''
    if (key && key !== this._shown && !pm.out.has(pm.myId)) {
      s._message(this.orderText(), Math.max(2, this.subLeft))
      try { audioEngine.playSpecial?.(this.simon ? 'dingdong' : 'pop') } catch { /* no audio */ }
    }
    this._shown = key
    if (pm.phase === 'play' && pm.out.has(pm.myId) && !this._wasOut) s._message(t('simonYouOut'), 3)
    this._wasOut = pm.phase === 'play' && pm.out.has(pm.myId)
  }

  draw() {
    const pm = this.pm
    if (!pm.home) return
    const key = `${pm.home.x},${pm.home.z}`
    if (this._builtFor === key) return
    this._builtFor = key
    const s = this.s
    const bm = s.bm
    const h = pm.home
    const put = (x, y, z, type) => {
      if (bm.getBlockAt(x, y, z) === type) return
      if (bm.getBlockAt(x, y, z)) bm.removeBlock(x, y, z)
      bm.placeBlock(x, y, z, type, true)
      s._placed.set(bm._key(x, y, z), type)
    }
    bm._suppressUndoRecording = true
    for (let x = -HALF - 1; x <= HALF + 1; x++) {
      for (let z = -HALF - 1; z <= HALF + 1; z++) {
        const edge = Math.abs(x) === HALF + 1 || Math.abs(z) === HALF + 1
        const pad = this.padAt(h.x + x, h.z + z)
        put(h.x + x, SS_Y, h.z + z, pad ? PADS[pad][2] : (x + z) % 2 ? 'whiteconcrete' : 'lightgrayconcrete')
        if (edge) put(h.x + x, SS_Y + 1, h.z + z, 'oakfence')
      }
    }
    bm._suppressUndoRecording = false
  }

  startText() {
    return t('simonStart', { n: CMD_S })
  }

  hud() {
    const pm = this.pm
    const alive = this._alive(pm._people()).length
    let mid = this.sub === 'cmd' ? `${this.orderText()} · ${Math.ceil(this.subLeft)}s` : t('simonListen')
    mid += ` · ${t('simonLeft', { n: alive })}`
    if (pm.out.has(pm.myId)) mid += ` · ${t('simonOutTag')}`
    return mid
  }

  protects(x, y, z) {
    const h = this.pm.home
    if (!h || y < SS_Y - 1 || y > SS_Y + 3) return false
    return Math.abs(x - h.x) <= HALF + 2 && Math.abs(z - h.z) <= HALF + 2
  }

  snap() {
    return { ss: this.sub, sc: this.cmd, sy: this.simon ? 1 : 0, sn: this.count, sl: +this.subLeft.toFixed(1) }
  }

  apply(d) {
    this.sub = d.ss === 'cmd' ? 'cmd' : 'gap'
    this.cmd = COMMANDS.includes(d.sc) ? d.sc : ''
    this.simon = d.sy === 1
    this.count = Math.floor(Number(d.sn) || 0)
    this.subLeft = Number(d.sl) || 0
  }

  dispose() {}
}
