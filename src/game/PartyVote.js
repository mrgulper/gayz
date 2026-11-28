// Mode voting (2026-11-27, docs/notes/six-ideas-batches.md batch 1, Gaymi:
// "Next mode"). Owned by PartyMode (`party.nextVote`). When a party round
// ends, three modes show up: the one just played and two random others
// from VOTE_MODES. Everyone taps one (or keys 1-3); bots vote at random
// times. When the end screen runs out, the most votes wins (a tie = a
// random pick among the tied) and, if it's another mode, BuildSurvival
// .switchPartyMode swaps the round over.
//
// Whoever runs the round (alone, or a server's host) keeps the votes. A
// guest's vote travels as a hit (`n` + the mode's PARTY_MODES index, like
// Build Battle's stars) and the options + counts go out in the host's sync
// (`nv`: three PARTY_MODES indexes, then three counts). Deathmatch, Team
// Deathmatch, Duel Arena and the Obstacle Course never vote: they have
// their own maps and their own server tabs.
import { t } from './i18n.js'

export const VOTE_S = 12
const NO_VOTE = new Set(['deathmatch', 'teamDeathmatch', 'duelArena', 'obstacleCourse'])

export function voteModes(all) {
  return all.filter((k) => !NO_VOTE.has(k))
}

export function modeName(kind) {
  return t(`topBarMode${kind[0].toUpperCase()}${kind.slice(1)}`)
}

export class PartyVote {
  constructor(party, modes) {
    this.p = party
    this.modes = modes // PARTY_MODES (the indexes the sync uses)
    this.pool = voteModes(modes)
    this.opts = [] // three kinds
    this.counts = [0, 0, 0]
    this.picks = new Map() // id -> option 0-2 (only where the round runs)
    this.mine = -1
    this._for = 0 // the round this vote is for
    this._botAt = new Map()
    this._t = 0
    this._el = null
    this._key = null
  }

  get on() {
    return this.p.phase === 'end' && this.opts.length === 3 && this.pool.includes(this.p.kind)
  }

  // Where the round runs: the round just ended - three options.
  start() {
    this._for = this.p.round
    this.picks.clear()
    this.mine = -1
    this._t = 0
    this.opts = []
    if (!this.pool.includes(this.p.kind)) return
    const others = this.pool.filter((k) => k !== this.p.kind).sort(() => Math.random() - 0.5).slice(0, 2)
    this.opts = [this.p.kind, ...others]
    this._botAt = new Map([...this.p.bots.keys()].map((id) => [id, 1 + Math.random() * (VOTE_S - 4)]))
    this._count()
  }

  // Where the round runs, every frame of the end screen.
  run(dt) {
    if (this._for !== this.p.round) this.start()
    if (!this.on) return
    this._t += dt
    for (const [id, at] of this._botAt) {
      if (this._t < at || this.picks.has(id)) continue
      this.picks.set(id, Math.floor(Math.random() * 3))
      this._count()
    }
  }

  pick(slot) {
    if (!this.on || slot < 0 || slot > 2) return
    this.mine = slot
    if (this.p.runs) {
      this.picks.set(this.p.myId, slot)
      this._count()
    } else this.p.s.net?.queueHit(`n${this.modes.indexOf(this.opts[slot])}`, 0)
    this.render()
  }

  // A guest's vote (BuildSurvival._applyRemoteHits -> PartyMode.remoteHit).
  remote(h) {
    if (!this.on || !this.p.runs || !h.by) return
    const slot = this.opts.indexOf(this.modes[Number(String(h.id).slice(1))])
    if (slot < 0) return
    this.picks.set(String(h.by), slot)
    this._count()
  }

  _count() {
    this.counts = [0, 0, 0]
    for (const slot of this.picks.values()) this.counts[slot]++
  }

  // The mode the next round plays.
  winner() {
    if (!this.on) return this.p.kind
    const most = Math.max(...this.counts)
    const tied = this.opts.filter((_, i) => this.counts[i] === most)
    return tied[Math.floor(Math.random() * tied.length)]
  }

  snap() {
    return this.on ? [...this.opts.map((k) => this.modes.indexOf(k)), ...this.counts] : []
  }

  apply(a) {
    if (this.p.runs) return
    const opts = Array.isArray(a) && a.length === 6 ? a.slice(0, 3).map((i) => this.modes[i]) : []
    if (opts.length !== 3 || !opts.every((k) => this.pool.includes(k))) {
      this.opts = []
      return
    }
    // A new vote: my old pick doesn't count.
    if (this._for !== this.p.round || opts.join() !== this.opts.join()) this.mine = -1
    this._for = this.p.round
    this.opts = opts
    this.counts = a.slice(3).map((n) => Math.max(0, Math.round(Number(n) || 0)))
  }

  // The three buttons on the end screen.
  render() {
    if (!this.on) {
      this._close()
      return
    }
    if (!this._el) {
      const el = document.createElement('div')
      el.id = 'party-vote'
      const title = document.createElement('div')
      title.className = 'party-vote-title'
      title.textContent = t('partyVoteTitle')
      el.appendChild(title)
      const row = document.createElement('div')
      row.className = 'party-vote-row'
      for (let i = 0; i < 3; i++) {
        const b = document.createElement('button')
        b.type = 'button'
        b.dataset.slot = String(i)
        b.innerHTML = '<span class="party-vote-key"></span><span class="party-vote-name"></span><span class="party-vote-count"></span>'
        b.querySelector('.party-vote-key').textContent = String(i + 1)
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault()
          this.pick(i)
        })
        row.appendChild(b)
      }
      el.appendChild(row)
      document.body.appendChild(el)
      this._el = el
      this._key = (e) => {
        const m = /^(?:Digit|Numpad)([1-3])$/.exec(e.code)
        if (!m) return
        e.preventDefault()
        e.stopPropagation()
        this.pick(Number(m[1]) - 1)
      }
      window.addEventListener('keydown', this._key, true)
    }
    const btns = this._el.querySelectorAll('button')
    btns.forEach((b, i) => {
      const name = i === 0 ? t('partyVoteAgain', { mode: modeName(this.opts[i]) }) : modeName(this.opts[i])
      const nameEl = b.querySelector('.party-vote-name')
      if (nameEl.textContent !== name) nameEl.textContent = name
      b.querySelector('.party-vote-count').textContent = t('partyVoteCount', { n: this.counts[i] || 0 })
      b.classList.toggle('on', this.mine === i)
    })
  }

  _close() {
    if (!this._el) return
    this._el.remove()
    this._el = null
    window.removeEventListener('keydown', this._key, true)
  }

  dispose() {
    this._close()
  }
}
