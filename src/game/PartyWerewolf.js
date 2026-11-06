// Werewolf Night (2026-11-06, Gaymi's idea list 7: "on servers, one player
// is secretly the werewolf on full-moon nights, and everyone else has to
// work out who" - Gaymi picked "hunt and guess"). A party mode, servers +
// bots. Plugs into PartyMode (PartyModes.js) as its `ext`.
//
// One player is secretly the Werewolf (PartyMode `seekers`; only they are
// told). The round goes Night, Day, Night, Day...:
// - Night (NIGHT_S): the screen goes dark under a full moon. The Werewolf
//   runs faster and can knock out one villager a night - shoot them from
//   up to CLAW_R blocks away. Knocked-out players are out (PartyMode
//   `out`) and watch as ghosts.
// - Day (DAY_S): everyone still in votes for who they think the Werewolf
//   is - keys 1-9 or the name buttons. Whoever gets the most votes is out
//   (a tie: nobody). If that was the Werewolf, the villagers win.
// The Werewolf wins once only one villager is left, or if the clock runs
// out. Bots vote for whoever was standing closest to the last knock-out,
// more often than not.
// A guest's knock-out or vote travels as a hit `w<who>` (dmg 1 / 2).
// Meshes only (none here), never a light.
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'

export const NIGHT_S = 30
export const DAY_S = 25
export const CLAW_R = 3
export const WOLF_SPEED = 1.3
const BOT_GUESS = 0.65 // how often a bot votes for its best suspect
const KEY_RE = /^(?:Digit|Numpad)([1-9])$/

export class PartyWerewolf {
  constructor(pm) {
    this.pm = pm
    this.s = pm.s
    this.sub = 'night'
    this.subLeft = NIGHT_S
    this.clawed = false // the Werewolf used tonight's knock-out
    this.votes = new Map() // voter -> target
    this.suspect = new Map() // id -> how suspicious (bots' guess)
    this._last = ''
  }

  get wolf() {
    return [...this.pm.seekers][0] || ''
  }

  begin(people, shuffled) {
    const pm = this.pm
    pm.seekers.clear()
    pm.seekers.add(shuffled[0])
    this.sub = 'night'
    this.subLeft = NIGHT_S
    this.clawed = false
    this.votes.clear()
    this.suspect.clear()
  }

  // Players still in.
  _alive(people) {
    return people.filter((p) => !this.pm.out.has(p.id))
  }

  run(people, dt) {
    const pm = this.pm
    if (pm.phase !== 'play') return
    this.subLeft -= dt
    const alive = this._alive(people)
    const wolf = this.wolf
    // The Werewolf left the game: the villagers win.
    if (!alive.some((p) => p.id === wolf)) return pm._end('h')
    if (alive.filter((p) => p.id !== wolf).length <= 1) return pm._end('s')
    if (this.sub === 'night') {
      // A Werewolf bot hunts the nearest villager.
      const wb = pm.bots.get(wolf)
      if (wb && !this.clawed) {
        const prey = alive.filter((p) => p.id !== wolf).sort((a, b) => Math.hypot(a.x - wb.x, a.z - wb.z) - Math.hypot(b.x - wb.x, b.z - wb.z))[0]
        if (prey && Math.hypot(prey.x - wb.x, prey.z - wb.z) < CLAW_R * 0.6) this.claw(wolf, prey.id)
      }
      if (this.subLeft <= 0) {
        this.sub = 'day'
        this.subLeft = DAY_S
        this.votes.clear()
        pm._say = { k: 'wolfDawn' }
      }
      return
    }
    // Day: bots vote once each.
    for (const p of alive) {
      if (!p.bot || this.votes.has(p.id)) continue
      if (Math.random() > dt * 0.6) continue
      const others = alive.filter((q) => q.id !== p.id)
      if (!others.length) continue
      let pick = others[Math.floor(Math.random() * others.length)]
      if (p.id !== wolf && Math.random() < BOT_GUESS) {
        const best = others.reduce((a, q) => ((this.suspect.get(q.id) || 0) > (this.suspect.get(a.id) || 0) ? q : a), others[0])
        if ((this.suspect.get(best.id) || 0) > 0) pick = best
      }
      this.votes.set(p.id, pick.id)
    }
    const allIn = alive.every((p) => this.votes.has(p.id))
    if (this.subLeft <= 0 || allIn) this._count(alive)
  }

  // The day's votes: the most is out (a tie: nobody).
  _count(alive) {
    const pm = this.pm
    const n = new Map()
    for (const [voter, who] of this.votes) {
      if (!alive.some((p) => p.id === voter) || !alive.some((p) => p.id === who)) continue
      n.set(who, (n.get(who) || 0) + 1)
    }
    let top = ''
    let most = 0
    let tie = false
    for (const [who, c] of n) {
      if (c > most) {
        most = c
        top = who
        tie = false
      } else if (c === most) tie = true
    }
    this.votes.clear()
    if (top && !tie) {
      pm.out.add(top)
      if (top === this.wolf) {
        pm._say = { k: 'wolfCaught', name: top }
        return pm._end('h')
      }
      pm._say = { k: 'wolfWrong', name: top }
    } else pm._say = { k: 'wolfNoVote' }
    this.sub = 'night'
    this.subLeft = NIGHT_S
    this.clawed = false
    const left = this._alive(pm._people())
    if (left.filter((p) => p.id !== this.wolf).length <= 1) pm._end('s')
  }

  // The Werewolf knocks someone out (where the round runs).
  claw(by, id) {
    const pm = this.pm
    if (pm.phase !== 'play' || this.sub !== 'night' || this.clawed || by !== this.wolf || id === by || pm.out.has(id)) return false
    const people = pm._people()
    const a = people.find((p) => p.id === by)
    const b = people.find((p) => p.id === id)
    if (!a || !b || Math.hypot(a.x - b.x, a.z - b.z) > CLAW_R + 0.5) return false
    this.clawed = true
    pm.out.add(id)
    pm._say = { k: 'wolfStruck', name: id }
    // Whoever stood closest to it (but the victim) looks guilty - to bots.
    for (const p of people) {
      if (p.id === id || pm.out.has(p.id)) continue
      const d = Math.hypot(p.x - b.x, p.z - b.z)
      this.suspect.set(p.id, (this.suspect.get(p.id) || 0) + Math.max(0, 12 - d))
    }
    return true
  }

  vote(by, who) {
    const pm = this.pm
    if (pm.phase !== 'play' || this.sub !== 'day' || pm.out.has(by) || pm.out.has(who) || by === who) return false
    this.votes.set(by, who)
    return true
  }

  timeUp() {
    this.pm._end('s')
  }

  won() {
    const pm = this.pm
    const me = pm.seekers.has(pm.myId)
    return (pm.winner === 's' && me) || (pm.winner === 'h' && !me)
  }

  winText(w) {
    return t(w === 's' ? 'wolfWins' : 'wolfVillagersWin', { name: this.pm._name(this.wolf) })
  }

  botGoal(b, people) {
    const pm = this.pm
    if (pm.out.has(b.id)) return { x: b.x, z: b.z, stay: true }
    const alive = this._alive(people).filter((p) => p.id !== b.id)
    if (this.sub === 'night' && b.id === this.wolf && !this.clawed) {
      const prey = alive.sort((p, q) => Math.hypot(p.x - b.x, p.z - b.z) - Math.hypot(q.x - b.x, q.z - b.z))[0]
      return prey || null
    }
    // Villagers mill about near the middle.
    if (!b.wander || Math.hypot(b.wander.x - b.x, b.wander.z - b.z) < 1 || Math.random() < 0.003) {
      const a = Math.random() * Math.PI * 2
      const r = 3 + Math.random() * 12
      b.wander = { x: pm.home.x + Math.cos(a) * r, z: pm.home.z + Math.sin(a) * r }
    }
    return b.wander
  }

  speed() {
    const pm = this.pm
    if (pm.phase !== 'play') return 1
    if (pm.out.has(pm.myId)) return 0
    return this.sub === 'night' && pm.seekers.has(pm.myId) ? WOLF_SPEED : 1
  }

  // Nobody's marked: the Werewolf is a secret.
  markColor() {
    return null
  }

  // My shot: the Werewolf's knock-out at night; nothing for anyone else.
  shoot(ray) {
    const pm = this.pm
    if (pm.phase !== 'play' || this.sub !== 'night' || !pm.seekers.has(pm.myId) || this.clawed || pm.out.has(pm.myId)) return false
    const B = this.s.B
    let best = null
    let bestD = CLAW_R * B
    for (const p of pm._people()) {
      if (p.id === pm.myId || pm.out.has(p.id)) continue
      // The closest one roughly in the line of the shot.
      const dx = p.x * B - ray.origin.x
      const dy = (p.y + 1) * B - ray.origin.y
      const dz = p.z * B - ray.origin.z
      const along = dx * ray.direction.x + dy * ray.direction.y + dz * ray.direction.z
      if (along <= 0) continue
      const off = Math.hypot(dx - ray.direction.x * along, dy - ray.direction.y * along, dz - ray.direction.z * along)
      if (off > 0.9 * B || along > bestD) continue
      bestD = along
      best = p
    }
    if (!best) return false
    try { audioEngine.playSpecial?.('shout') } catch { /* no audio */ }
    if (pm.runs) return this.claw(pm.myId, best.id)
    this.s.net.queueHit(`w${best.id}`, 1)
    return true
  }

  // A guest's knock-out or vote.
  remoteHit(h) {
    const id = String(h.id).slice(1)
    const by = String(h.by || '')
    if (!by) return
    if (Number(h.dmg) === 2) this.vote(by, id)
    else this.claw(by, id)
  }

  _myVote(i) {
    const pm = this.pm
    const list = this._voteList()
    const who = list[i - 1]
    if (!who) return
    this._voted = who.id
    if (pm.runs) this.vote(pm.myId, who.id)
    else this.s.net.queueHit(`w${who.id}`, 2)
    this._renderVote(true)
  }

  // Who I can vote for: everyone still in but me.
  _voteList() {
    const pm = this.pm
    return this._alive(pm._people()).filter((p) => p.id !== pm.myId)
  }

  events(was) {
    const pm = this.pm
    const s = this.s
    if (pm.phase === 'play' && (was.phase !== 'play' || was.round !== pm.round)) this._last = ''
    const key = pm.phase === 'play' ? this.sub : ''
    if (key !== this._last) {
      if (key === 'night') {
        s._message(t(pm.seekers.has(pm.myId) ? 'wolfNightYou' : 'wolfNight', { r: CLAW_R }), 4)
        try { audioEngine.playSpecial?.('echo') } catch { /* no audio */ }
      } else if (key === 'day') {
        this._voted = ''
        s._message(t('wolfDay'), 4)
      }
      this._last = key
    }
    if (pm.phase === 'play' && pm.out.has(pm.myId) && !this._wasOut) s._message(t('wolfYouOut'), 4)
    this._wasOut = pm.phase === 'play' && pm.out.has(pm.myId)
    this._dark(pm.phase === 'play' && this.sub === 'night')
    this._renderVote(false)
  }

  // The night: dark round the edges, a full moon.
  _dark(on) {
    let el = this._darkEl
    if (!el && on) {
      el = this._darkEl = document.createElement('div')
      el.id = 'ww-night'
      el.appendChild(document.createElement('i'))
      document.body.appendChild(el)
    }
    if (el) el.classList.toggle('on', on)
  }

  _renderVote(force) {
    const pm = this.pm
    const on = pm.phase === 'play' && this.sub === 'day' && !pm.out.has(pm.myId)
    if (!on) {
      if (this._voteEl) {
        this._voteEl.remove()
        this._voteEl = null
        window.removeEventListener('keydown', this._voteKey, true)
      }
      return
    }
    const list = this._voteList()
    const sig = `${list.map((p) => p.id).join(',')}|${this._voted || ''}`
    if (this._voteEl && this._sig === sig && !force) return
    this._sig = sig
    if (!this._voteEl) {
      const el = document.createElement('div')
      el.id = 'ww-vote'
      document.body.appendChild(el)
      this._voteEl = el
      this._voteKey = (e) => {
        const m = KEY_RE.exec(e.code)
        if (!m) return
        e.preventDefault()
        e.stopPropagation()
        this._myVote(Number(m[1]))
      }
      window.addEventListener('keydown', this._voteKey, true)
    }
    const el = this._voteEl
    el.textContent = ''
    const title = document.createElement('div')
    title.className = 'ww-vote-title'
    title.textContent = t(this._voted ? 'wolfVoted' : 'wolfVoteTitle')
    el.appendChild(title)
    const row = document.createElement('div')
    row.className = 'ww-vote-names'
    list.slice(0, 9).forEach((p, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = `${i + 1} ${pm._name(p.id)}`
      b.classList.toggle('on', this._voted === p.id)
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        this._myVote(i + 1)
      })
      row.appendChild(b)
    })
    el.appendChild(row)
  }

  startText() {
    return t(this.pm.seekers.has(this.pm.myId) ? 'wolfStartYou' : 'wolfStart', { r: CLAW_R })
  }

  hud() {
    const pm = this.pm
    const left = this._alive(pm._people()).length
    let mid = t(this.sub === 'night' ? 'wolfHudNight' : 'wolfHudDay', { n: Math.max(0, Math.ceil(this.subLeft)), p: left })
    if (pm.seekers.has(pm.myId)) mid += ` · ${t(this.clawed && this.sub === 'night' ? 'wolfYouFed' : 'wolfYouAre')}`
    if (pm.out.has(pm.myId)) mid += ` · ${t('wolfOutTag')}`
    return mid
  }

  snap() {
    return {
      su: this.sub === 'day' ? 1 : 0,
      sl: Math.round(this.subLeft * 10),
      cl: this.clawed ? 1 : 0,
      vs: [...this.votes].map(([a, b]) => `${this.pm._out(a)}:${this.pm._out(b)}`).join(';').slice(0, 1200),
    }
  }

  apply(d) {
    this.sub = d.su === 1 ? 'day' : 'night'
    this.subLeft = (Number(d.sl) || 0) / 10
    this.clawed = d.cl === 1
    this.votes = new Map()
    for (const pair of String(d.vs || '').split(';')) {
      const [a, b] = pair.split(':')
      if (a && b) this.votes.set(a, b)
    }
  }

  dispose() {
    this._darkEl?.remove()
    this._darkEl = null
    if (this._voteEl) {
      this._voteEl.remove()
      this._voteEl = null
      window.removeEventListener('keydown', this._voteKey, true)
    }
  }
}
