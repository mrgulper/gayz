// Zombie Bingo (2026-11-09, Gaymi's idea list 10: "every run gives you a
// 5x5 card of small goals, like 'kill a golden zombie', 'ride a minecart'
// or 'catch a fish'. A full line gets a reward and a full card gets a big
// prize. It gives players a reason to try all the stuff GayZ already has").
// Owned by BuildSurvival (`s.bingo`).
//
// Each normal run (not party modes, Tower Defense, Escape Rooms or
// no-zombie modes) deals a new card: 24 of GOALS at random round a free
// middle square. Things around the game call note(event, n) (or reach()
// for "get to" goals like the wave); a goal is ticked once its count
// reaches its target. Every new full line (row, column or diagonal) pays
// LINE_COINS; the whole card pays FULL_COINS and FULL_GEMS. The Bingo key
// (J) or a tap on the Bingo pill shows the card. Each player's own, on a
// server too. Never kept between runs.
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { showPill, hidePill } from './PlayPills.js'
import { openScreen, closeScreen } from './CampScreen.js'
import { getKeyFor, keyLabel } from './Keybinds.js'
import { saveShopProgress } from './Game.js'

export const SIZE = 5
export const LINE_COINS = 100
export const FULL_COINS = 1000
export const FULL_GEMS = 10
// { id, ev: what counts, n: how many, max: a "get to" goal (reach()) }
export const GOALS = [
  { id: 'kill15', ev: 'kill', n: 15 },
  { id: 'kill40', ev: 'kill', n: 40 },
  { id: 'headshot5', ev: 'headshot', n: 5 },
  { id: 'melee3', ev: 'melee', n: 3 },
  { id: 'golden', ev: 'golden', n: 1 },
  { id: 'boss', ev: 'boss', n: 1 },
  { id: 'skeleton', ev: 'skeleton', n: 1 },
  { id: 'streak10', ev: 'streak', n: 10, max: true },
  { id: 'chest3', ev: 'chest', n: 3 },
  { id: 'wave3', ev: 'wave', n: 3, max: true },
  { id: 'wave5', ev: 'wave', n: 5, max: true },
  { id: 'coins300', ev: 'coins', n: 300 },
  { id: 'fish', ev: 'fish', n: 1 },
  { id: 'minecart', ev: 'minecart', n: 1 },
  { id: 'ride', ev: 'ride', n: 1 },
  { id: 'survivor', ev: 'survivor', n: 1 },
  { id: 'craft2', ev: 'craft', n: 2 },
  { id: 'eat2', ev: 'eat', n: 2 },
  { id: 'potion', ev: 'potion', n: 1 },
  { id: 'music', ev: 'music', n: 1 },
  { id: 'kite', ev: 'kite', n: 1 },
  { id: 'catch', ev: 'catch', n: 1 },
  { id: 'event', ev: 'event', n: 1 },
  { id: 'spray', ev: 'spray', n: 1 },
  { id: 'emote', ev: 'emote', n: 1 },
  { id: 'blimp', ev: 'blimp', n: 1 },
  { id: 'pizza', ev: 'pizza', n: 1 },
  { id: 'bungee', ev: 'bungee', n: 1 },
  { id: 'jetski', ev: 'jetski', n: 1 },
  { id: 'diner2', ev: 'diner', n: 2 },
]
const FREE = Math.floor((SIZE * SIZE) / 2)
// Every row, column and both diagonals, as square numbers.
export const LINES = (() => {
  const out = []
  for (let i = 0; i < SIZE; i++) {
    out.push([...Array(SIZE)].map((_, j) => i * SIZE + j))
    out.push([...Array(SIZE)].map((_, j) => j * SIZE + i))
  }
  out.push([...Array(SIZE)].map((_, j) => j * SIZE + j))
  out.push([...Array(SIZE)].map((_, j) => j * SIZE + (SIZE - 1 - j)))
  return out
})()

export class ZombieBingo {
  constructor(survival) {
    this.s = survival
    this.card = null // [25] goal or null (the free square)
    this.have = {} // event -> count
    this.lines = new Set() // line numbers already paid
    this.full = false
  }

  get allowed() {
    const s = this.s
    return s.active && !s.party && !s.td && !s.escape && !s.cfg?.noZombies
  }

  // A new run: a new card.
  deal() {
    const pool = GOALS.slice().sort(() => Math.random() - 0.5).slice(0, SIZE * SIZE - 1)
    this.card = []
    for (let i = 0; i < SIZE * SIZE; i++) this.card.push(i === FREE ? null : pool.shift())
    this.have = {}
    this.lines.clear()
    this.full = false
    this._pill()
  }

  done(i) {
    const g = this.card?.[i]
    if (g === null) return true
    return !!g && (this.have[g.ev] || 0) >= g.n
  }

  count() {
    if (!this.card) return 0
    let n = 0
    for (let i = 0; i < this.card.length; i++) if (this.card[i] && this.done(i)) n++
    return n
  }

  // Something happened n times (a kill, a fish...).
  note(ev, n = 1) {
    if (!this.card || !this.allowed) return
    if (!this.card.some((g) => g?.ev === ev)) return
    this.have[ev] = (this.have[ev] || 0) + n
    this._check()
  }

  // Got to `value` (the wave, the kill streak): counts the best so far.
  reach(ev, value) {
    if (!this.card || !this.allowed) return
    if (!this.card.some((g) => g?.ev === ev)) return
    if (value <= (this.have[ev] || 0)) return
    this.have[ev] = value
    this._check()
  }

  _check() {
    const s = this.s
    const before = this._ticked || 0
    const now = this.count()
    this._ticked = now
    if (now > before) {
      try { audioEngine.playSpecial?.('pop') } catch { /* no audio */ }
    }
    let newLines = 0
    LINES.forEach((line, n) => {
      if (this.lines.has(n) || !line.every((i) => this.done(i))) return
      this.lines.add(n)
      newLines++
    })
    if (newLines) {
      s._earn(LINE_COINS * newLines)
      s._message(t('bingoLine', { n: Math.round(LINE_COINS * newLines * (s.cfg?.coinMult ?? 1)) }), 4)
      try { audioEngine.playSpecial?.('dingdong') } catch { /* no audio */ }
    }
    if (!this.full && now === SIZE * SIZE - 1) {
      this.full = true
      s._earn(FULL_COINS)
      const game = s.bm.game
      if (game) {
        game.gems = (game.gems || 0) + FULL_GEMS
        saveShopProgress(game)
        game._renderCurrencyBar?.()
      }
      s._message(t('bingoFull', { c: Math.round(FULL_COINS * (s.cfg?.coinMult ?? 1)), g: FULL_GEMS }), 6)
      try { audioEngine.playSpecial?.('firework') } catch { /* no audio */ }
      const p = s.bodyPos()
      s._fx?.confetti?.(p.x * s.B, (p.y + 2) * s.B, p.z * s.B)
    }
    s._renderHud?.()
    this._pill()
    if (this._open) this._fill()
  }

  _pill() {
    if (!this.card || !this.allowed) return hidePill('bingo')
    // On a phone there's no key to name: just tap the pill.
    const touch = window.matchMedia?.('(pointer: coarse)').matches
    showPill('bingo', touch ? `${t('bingoTitle')} ${this.count()}/${SIZE * SIZE - 1}` : t('bingoPill', { n: this.count(), all: SIZE * SIZE - 1, key: keyLabel(getKeyFor('bingo')) }))
    const el = document.getElementById('pill-bingo')
    if (el && !el._bingoTap) {
      el._bingoTap = true
      el.classList.add('tappable')
      el.addEventListener('click', () => this.toggle())
    }
  }

  // The Bingo key or a tap on the pill: show / hide the card.
  toggle() {
    if (!this.card || !this.allowed) return
    if (this._open) {
      closeScreen()
      return
    }
    this._open = openScreen(this.s, {
      title: t('bingoTitle'),
      wide: true,
      build: (body) => {
        this._body = body
        this._fill()
      },
      onKey: (e, down) => {
        if (down && !e.repeat && e.code === getKeyFor('bingo')) closeScreen()
      },
      onClose: () => {
        this._open = null
        this._body = null
      },
    })
  }

  _fill() {
    const body = this._body
    if (!body) return
    body.textContent = ''
    const grid = document.createElement('div')
    grid.className = 'bingo-grid'
    this.card.forEach((g, i) => {
      const cell = document.createElement('div')
      cell.className = `bingo-cell${this.done(i) ? ' done' : ''}${g ? '' : ' free'}`
      const name = document.createElement('span')
      name.className = 'bingo-goal'
      name.textContent = g ? t(`bingoGoal_${g.id}`, { n: g.n }) : t('bingoFree')
      cell.appendChild(name)
      if (g && g.n > 1) {
        const prog = document.createElement('span')
        prog.className = 'bingo-prog'
        prog.textContent = `${Math.min(g.n, this.have[g.ev] || 0)}/${g.n}`
        cell.appendChild(prog)
      }
      grid.appendChild(cell)
    })
    const foot = document.createElement('p')
    foot.className = 'bingo-foot'
    foot.textContent = t('bingoRules', { line: LINE_COINS, full: FULL_COINS, gems: FULL_GEMS })
    body.append(grid, foot)
  }

  clear() {
    if (this._open) closeScreen(false)
    this.card = null
    this.have = {}
    this.lines.clear()
    this.full = false
    this._ticked = 0
    hidePill('bingo')
  }
}
