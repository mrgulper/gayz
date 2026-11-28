// Quiz Show (2026-11-28, from the unbuilt-ideas list; Gaymi picked: run to
// answer pads, a mix of general and GayZ questions, a points race, no
// custom questions yet). A party mode, servers + bots. Plugs into
// PartyMode (PartyModes.js) as its `ext`.
//
// A square floor in the sky (QZ_Y) with a coloured pad in each corner
// (red A, blue B, green C, yellow D) and a floating sign over each pad
// with its answer. ROUNDS questions, picked at random from the
// QUESTIONS in quiz-*.js. Each one: ASK_S seconds to stand on the pad
// you think is right, then REVEAL_S seconds showing the answer.
// Everyone plays every question (nobody is out): right = RIGHT_PTS, plus
// up to SPEED_PTS for getting onto that pad early (and staying). Not on a
// pad = nothing. Most points after the last question wins.
// A card at the top of the screen shows the question and the 4 answers.
// Everything is judged from where people stand, so it works the same for
// bots and for players on a server. Bots know the answer BOT_SMART of
// the time. Real blocks (BuildSurvival `_placed`). Never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'

export const QZ_Y = 205
export const ROUNDS = 10
export const ASK_S = 14
export const REVEAL_S = 4
export const READY_S = 6
export const RIGHT_PTS = 100
export const SPEED_PTS = 50
export const BOT_SMART = 0.6
// How many quizQ_<n> lines quiz-*.js has (each "Question|Right|Wrong|Wrong|Wrong").
export const QUESTIONS = 40
export const ROUND = READY_S + ROUNDS * (ASK_S + REVEAL_S) + 10
const HALF = 9
const PAD = 2 // pads are PAD x 2 + 1 wide
export const PADS = ['red', 'blue', 'green', 'yellow']
const PAD_AT = { red: [-1, -1, 'redwool', '#d8452a'], blue: [1, -1, 'bluewool', '#3b6fe0'], green: [-1, 1, 'greenwool', '#3fa83f'], yellow: [1, 1, 'yellowwool', '#e8c02a'] }
const LETTERS = ['A', 'B', 'C', 'D']

// One question in the current language: { q, answers: [right, wrong x3] }.
export function question(i) {
  const parts = String(t(`quizQ_${i + 1}`)).split('|')
  return { q: parts[0] || '?', answers: [1, 2, 3, 4].map((n) => parts[n] || '?') }
}

function shuffle(list) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export class PartyQuiz {
  constructor(pm) {
    this.pm = pm
    this.s = pm.s
    this.sub = 'ready' // ready | ask | reveal | done
    this.subLeft = READY_S
    this.n = 0 // question number (1..ROUNDS)
    this.picks = [] // question indexes for this round
    this.order = [0, 1, 2, 3] // order[pad] = answer index (0 = the right one)
    this.track = new Map() // id -> { pad, at }
    this.gain = {} // id -> points from the last question
    this._builtFor = ''
    this._signs = []
    this._signKey = ''
    this._card = null
    this._cardKey = ''
  }

  home(me) {
    return { x: Math.round(me.x), y: QZ_Y + 1, z: Math.round(me.z) }
  }

  begin(people, shuffled) {
    this.sub = 'ready'
    this.subLeft = READY_S
    this.n = 0
    this.picks = shuffle([...Array(QUESTIONS).keys()]).slice(0, ROUNDS)
    this.track.clear()
    this.gain = {}
    for (const id of shuffled) this.pm.score[id] = 0
  }

  placeBot(b) {
    const h = this.pm.home
    b.x = b.tx = h.x + 0.5 + (Math.random() - 0.5) * 6
    b.z = b.tz = h.z + 0.5 + (Math.random() - 0.5) * 6
    b.y = b.ty = QZ_Y + 1
    b.vy = 0
  }

  // Which pad a spot is on ('' for none).
  padAt(x, z) {
    const h = this.pm.home
    if (!h) return ''
    for (const c of PADS) {
      const [sx, sz] = PAD_AT[c]
      const cx = h.x + sx * (HALF - PAD - 1)
      const cz = h.z + sz * (HALF - PAD - 1)
      if (Math.abs(Math.floor(x) - cx) <= PAD && Math.abs(Math.floor(z) - cz) <= PAD) return c
    }
    return ''
  }

  padMiddle(c) {
    const h = this.pm.home
    const [sx, sz] = PAD_AT[c]
    return { x: h.x + sx * (HALF - PAD - 1) + 0.5, z: h.z + sz * (HALF - PAD - 1) + 0.5 }
  }

  // The pad with the right answer.
  get rightPad() {
    return PADS[this.order.indexOf(0)]
  }

  get current() {
    return this.n ? question(this.picks[this.n - 1] ?? 0) : null
  }

  // The answer shown on a pad.
  answerOn(c) {
    const q = this.current
    return q ? q.answers[this.order[PADS.indexOf(c)]] : ''
  }

  _ask(people) {
    this.n++
    this.order = shuffle([0, 1, 2, 3])
    this.sub = 'ask'
    this.subLeft = ASK_S
    this.gain = {}
    this.track.clear()
    for (const p of people) {
      this.track.set(p.id, { pad: this.padAt(p.x, p.z), at: ASK_S })
      if (p.bot) {
        p.bot.qPick = Math.random() < BOT_SMART ? this.rightPad : PADS[Math.floor(Math.random() * 4)]
        p.bot.qWait = 1 + Math.random() * (ASK_S - 5)
      }
    }
  }

  // Points for standing on `pad`, having got there with `at` seconds left.
  points(pad, at) {
    if (!pad || pad !== this.rightPad) return 0
    return RIGHT_PTS + Math.round(SPEED_PTS * Math.max(0, Math.min(1, at / ASK_S)))
  }

  run(people, dt) {
    const pm = this.pm
    if (pm.phase !== 'play') return
    this.subLeft -= dt
    if (this.sub === 'ready') {
      if (this.subLeft <= 0) this._ask(people)
      return
    }
    if (this.sub === 'ask') {
      for (const p of people) {
        const pad = this.padAt(p.x, p.z)
        const tr = this.track.get(p.id)
        if (!tr) this.track.set(p.id, { pad, at: Math.max(0, this.subLeft) })
        else if (tr.pad !== pad) {
          tr.pad = pad
          tr.at = Math.max(0, this.subLeft)
        }
      }
      if (this.subLeft > 0) return
      // Time's up: points for everyone on the right pad.
      for (const p of people) {
        const tr = this.track.get(p.id)
        const n = this.points(tr?.pad, tr?.at ?? 0)
        this.gain[p.id] = n
        pm.score[p.id] = (pm.score[p.id] || 0) + n
      }
      this.sub = 'reveal'
      this.subLeft = REVEAL_S
      return
    }
    if (this.sub === 'reveal' && this.subLeft <= 0) {
      if (this.n >= ROUNDS) {
        this.sub = 'done'
        return pm._timeUp()
      }
      this._ask(people)
    }
  }

  botGoal(b) {
    const h = this.pm.home
    const wander = () => {
      if (!b.wander || Math.hypot(b.wander.x - b.x, b.wander.z - b.z) < 1) b.wander = { x: h.x + 0.5 + (Math.random() - 0.5) * 6, z: h.z + 0.5 + (Math.random() - 0.5) * 6 }
      return b.wander
    }
    if (this.sub === 'ask' && b.qPick && ASK_S - this.subLeft >= (b.qWait || 0)) return this.padMiddle(b.qPick)
    if (this.sub === 'reveal' && b.qPick) return { x: b.x, z: b.z, stay: true }
    return wander()
  }

  speed() {
    return 1
  }

  markColor() {
    return null
  }

  shoot() {
    return false
  }

  // The middle of the floor.
  enter() {
    const h = this.pm.home
    this.s.bm.tryMode.pos.set(h.x + 0.5, QZ_Y + 1, h.z + 0.5)
    this.s.bm.tryMode.vel?.set(0, 0, 0)
  }

  events(was) {
    const pm = this.pm
    if (pm.phase === 'play' && (was.phase !== 'play' || was.round !== pm.round)) this.enter()
    const key = pm.phase === 'play' ? `${this.n}:${this.sub}` : ''
    if (key && key !== this._heard) {
      let sound = ''
      if (this.sub === 'ask') sound = 'dingdong'
      else if (this.sub === 'reveal') sound = (this.gain[pm.myId] || 0) > 0 ? 'cheer' : 'pop'
      if (sound) try { audioEngine.playSpecial?.(sound) } catch { /* no audio */ }
    }
    this._heard = key
  }

  // The floor (once per arena), the answer signs and the question card.
  draw() {
    const pm = this.pm
    if (!pm.home) return
    this._floor()
    this._drawSigns()
    this._drawCard()
  }

  _floor() {
    const pm = this.pm
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
        put(h.x + x, QZ_Y, h.z + z, pad ? PAD_AT[pad][2] : (x + z) % 2 ? 'whiteconcrete' : 'lightgrayconcrete')
        if (edge) put(h.x + x, QZ_Y + 1, h.z + z, 'oakfence')
      }
    }
    bm._suppressUndoRecording = false
  }

  // A floating sign over each pad: its letter and answer.
  _drawSigns() {
    const pm = this.pm
    const B = this.s.B
    if (!this._signs.length) {
      for (const c of PADS) {
        const canvas = document.createElement('canvas')
        canvas.width = 512
        canvas.height = 160
        const tex = new THREE.CanvasTexture(canvas)
        tex.colorSpace = THREE.SRGBColorSpace
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
        sprite.scale.set(4.2 * B, 1.3 * B, 1)
        sprite.userData.pad = c
        pm.arena.add(sprite)
        this._signs.push(sprite)
      }
    }
    const show = pm.phase === 'play' && (this.sub === 'ask' || this.sub === 'reveal')
    const key = show ? `${this.n}:${this.sub}:${this.order.join('')}:${pm.home.x},${pm.home.z}` : ''
    for (const sp of this._signs) sp.visible = show
    if (!show || key === this._signKey) return
    this._signKey = key
    const reveal = this.sub === 'reveal'
    for (const sp of this._signs) {
      const c = sp.userData.pad
      const m = this.padMiddle(c)
      sp.position.set(m.x * B, (QZ_Y + 4.2) * B, m.z * B)
      const canvas = sp.material.map.image
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const dim = reveal && c !== this.rightPad
      ctx.globalAlpha = dim ? 0.35 : 1
      ctx.fillStyle = PAD_AT[c][3]
      ctx.beginPath()
      ctx.roundRect(6, 6, canvas.width - 12, canvas.height - 12, 28)
      ctx.fill()
      ctx.lineWidth = 8
      ctx.strokeStyle = reveal && !dim ? '#ffffff' : 'rgba(0,0,0,0.45)'
      ctx.stroke()
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const text = `${LETTERS[PADS.indexOf(c)]}  ${this.answerOn(c)}${reveal && !dim ? ' ✓' : ''}`
      let size = 64
      do {
        ctx.font = `bold ${size}px sans-serif`
        size -= 4
      } while (size > 24 && ctx.measureText(text).width > canvas.width - 40)
      ctx.shadowColor = 'rgba(0,0,0,0.6)'
      ctx.shadowBlur = 6
      ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2)
      ctx.shadowBlur = 0
      ctx.globalAlpha = 1
      sp.material.map.needsUpdate = true
    }
  }

  // The card at the top: question, 4 answers, the clock, how I did.
  _drawCard() {
    const pm = this.pm
    const show = pm.phase === 'play' && (this.sub === 'ask' || this.sub === 'reveal')
    if (!this._card) {
      const hud = document.getElementById('build-play-hud')
      if (!hud) return
      const el = document.createElement('div')
      el.id = 'quiz-card'
      el.innerHTML = '<div class="quiz-top"><span class="quiz-num"></span><span class="quiz-clock"></span></div><div class="quiz-q"></div><div class="quiz-answers"></div><div class="quiz-result"></div>'
      hud.appendChild(el)
      this._card = el
    }
    const el = this._card
    el.style.display = show ? '' : 'none'
    if (!show) {
      this._cardKey = ''
      return
    }
    el.querySelector('.quiz-clock').textContent = this.sub === 'ask' ? `${Math.max(0, Math.ceil(this.subLeft))}s` : ''
    this._place(el)
    const key = `${this.n}:${this.sub}:${this.order.join('')}`
    if (key === this._cardKey) return
    this._cardKey = key
    const q = this.current
    const reveal = this.sub === 'reveal'
    el.querySelector('.quiz-num').textContent = t('quizQuestionOf', { i: this.n, n: ROUNDS })
    el.querySelector('.quiz-q').textContent = q?.q || ''
    const box = el.querySelector('.quiz-answers')
    box.textContent = ''
    for (const c of PADS) {
      const a = document.createElement('div')
      a.className = `quiz-a quiz-a-${c}${reveal ? (c === this.rightPad ? ' right' : ' dim') : ''}`
      const letter = document.createElement('b')
      letter.textContent = LETTERS[PADS.indexOf(c)]
      const span = document.createElement('span')
      span.textContent = this.answerOn(c)
      a.append(letter, span)
      box.appendChild(a)
    }
    const res = el.querySelector('.quiz-result')
    const right = this.answerOn(this.rightPad)
    const got = this.gain[pm.myId] || 0
    if (!reveal) res.textContent = t('quizStandOn')
    else if (got > 0) res.textContent = t('quizRight', { n: got })
    else res.textContent = t('quizWrong', { a: right })
    res.className = `quiz-result${reveal ? (got > 0 ? ' good' : ' bad') : ''}`
  }

  // Just under the top bars, and under the corner map, ammo and the
  // phone's top row of buttons too when the screen is narrow enough for
  // them to meet (phones). Checked twice a second.
  _place(el) {
    const now = performance.now()
    if (now - (this._placedAt || 0) < 500) return
    this._placedAt = now
    const card = el.getBoundingClientRect()
    let top = 56
    const near = ['top-bar', 'build-play-wave', 'build-try-map', 'build-play-ammo'].map((id) => document.getElementById(id))
    for (const b of document.querySelectorAll('#touch-play .tp-btn')) if (b.getBoundingClientRect().top < innerHeight / 3) near.push(b)
    for (const e of near) {
      const r = e?.getBoundingClientRect()
      if (!r || !r.width || !r.height) continue
      if (r.right > card.left && r.left < card.right) top = Math.max(top, r.bottom + 8)
    }
    el.style.top = `${Math.round(top)}px`
  }

  startText() {
    return t('quizStart', { n: ROUNDS })
  }

  // Who's top (name and points).
  _top() {
    let best = ''
    let top = -1
    for (const [id, n] of Object.entries(this.pm.score)) {
      if (n > top) {
        top = n
        best = id
      }
    }
    return best ? { name: this.pm._name(best), n: top } : null
  }

  hud() {
    const pm = this.pm
    const me = pm.score[pm.myId] || 0
    const top = this._top()
    let mid = this.sub === 'ready' || !this.n ? t('quizGetReady') : t('quizHudQ', { i: this.n, n: ROUNDS })
    mid += ` · ${t('quizHudYou', { n: me })}`
    if (top && top.n > 0) mid += ` · ${t('quizHudTop', { name: top.name, n: top.n })}`
    return mid
  }

  protects(x, y, z) {
    const h = this.pm.home
    if (!h || y < QZ_Y - 1 || y > QZ_Y + 3) return false
    return Math.abs(x - h.x) <= HALF + 2 && Math.abs(z - h.z) <= HALF + 2
  }

  snap() {
    const out = (id) => this.pm._out(id)
    return {
      qs: this.sub,
      qn: this.n,
      qp: this.picks,
      qo: this.order.join(''),
      ql: +this.subLeft.toFixed(1),
      qg: Object.fromEntries(Object.entries(this.gain).map(([id, n]) => [out(id), n])),
    }
  }

  apply(d) {
    this.sub = ['ready', 'ask', 'reveal', 'done'].includes(d.qs) ? d.qs : 'ready'
    this.n = Math.max(0, Math.min(ROUNDS, Math.floor(Number(d.qn) || 0)))
    if (Array.isArray(d.qp)) this.picks = d.qp.slice(0, ROUNDS).map((i) => Math.max(0, Math.min(QUESTIONS - 1, Math.floor(Number(i) || 0))))
    const o = String(d.qo || '').split('').map(Number)
    this.order = o.length === 4 && [0, 1, 2, 3].every((i) => o.includes(i)) ? o : [0, 1, 2, 3]
    this.subLeft = Number(d.ql) || 0
    this.gain = {}
    for (const [id, n] of Object.entries(d.qg || {})) if (typeof id === 'string' && id.length <= 64 && Number.isFinite(n)) this.gain[id] = n
  }

  dispose() {
    for (const sp of this._signs) {
      sp.removeFromParent()
      sp.material.map?.dispose()
      sp.material.dispose()
    }
    this._signs = []
    this._card?.remove()
    this._card = null
  }
}
