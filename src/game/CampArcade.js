// The Camp Arcade (2026-11-06, Gaymi's idea list 8: "real playable
// machines in camp for a break from zombies"). Two stations at the camp's
// Plaza (CampPlaza.js), each opened with Use as a pop-up (CampScreen.js):
//
// Pinball - a zombie-themed table: Launch a ball, keep it up with the two
// flippers, hit the zombie-head bumpers (BUMPER_PTS each) and the side
// slings. BALLS balls a game. Your best score is kept on this device
// (PINBALL_BEST_KEY); every PTS_PER_COIN points pays a coin, up to
// MAX_PIN_COINS a game. Keys: Left / A / Z and Right / D / M for the
// flippers, Space or Down to launch. On a phone tap the left or right half
// of the table, and the Launch button.
//
// Chess - you're White against the camp's chess zombie. Every rule: check,
// checkmate, stalemate, castling, en passant, and a pawn that reaches the
// far side becomes a Queen. Tap a piece, then where it goes (its moves
// light up). The zombie thinks CHESS_DEPTH moves ahead. Beating it pays
// CHESS_WIN_COINS, once a game of chess.
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { openScreen } from './CampScreen.js'

export const BALLS = 3
export const BUMPER_PTS = 100
export const PTS_PER_COIN = 1000
export const MAX_PIN_COINS = 30
export const PINBALL_BEST_KEY = 'gayz-pinball-best'
export const CHESS_WIN_COINS = 100
export const CHESS_DEPTH = 2

const sfx = (k) => {
  try { audioEngine.playSpecial?.(k) } catch { /* no audio */ }
}

// ---------------------------------------------------------------- pinball

const W = 300
const H = 480
const R = 7 // ball radius
const G = 900 // gravity, px/s^2
const FLIP_LEN = 48
const FLIP_DOWN = 0.5 // radians below flat
const FLIP_UP = -0.45
const FLIP_SPEED = 18 // radians / s
// Walls: [x1, y1, x2, y2, bounce].
const WALLS = [
  [10, 470, 10, 60, 0.5], [290, 470, 290, 60, 0.5], [10, 60, 60, 12, 0.5], [60, 12, 240, 12, 0.5], [240, 12, 290, 60, 0.5],
  // The outlanes down to the flippers.
  [10, 360, 84, 418, 0.5], [290, 360, 216, 418, 0.5],
  // Slings (bouncy) above them.
  [44, 300, 74, 360, 1.4], [256, 300, 226, 360, 1.4],
]
const BUMPERS = [[100, 140, 20], [200, 140, 20], [150, 210, 22], [70, 240, 14], [230, 240, 14]]

function hitSegment(ball, x1, y1, x2, y2, rad) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy || 1
  const k = Math.max(0, Math.min(1, ((ball.x - x1) * dx + (ball.y - y1) * dy) / len2))
  const cx = x1 + dx * k
  const cy = y1 + dy * k
  const nx = ball.x - cx
  const ny = ball.y - cy
  const d = Math.hypot(nx, ny)
  if (d >= R + rad || d === 0) return null
  return { nx: nx / d, ny: ny / d, push: R + rad - d, cx, cy, k }
}

export function newPinball() {
  return {
    score: 0, balls: BALLS, ball: null, over: false, coins: 0,
    left: { on: false, a: FLIP_DOWN, x: 90, y: 425, dir: 1 },
    right: { on: false, a: FLIP_DOWN, x: 210, y: 425, dir: -1 },
    lit: new Map(),
  }
}

// One table step (dt seconds).
export function stepPinball(P, dt) {
  for (const f of [P.left, P.right]) {
    const want = f.on ? FLIP_UP : FLIP_DOWN
    const was = f.a
    f.a += Math.sign(want - f.a) * Math.min(Math.abs(want - f.a), FLIP_SPEED * dt)
    f.w = (f.a - was) / dt
  }
  for (const [k, v] of P.lit) {
    if (v - dt <= 0) P.lit.delete(k)
    else P.lit.set(k, v - dt)
  }
  const b = P.ball
  if (!b) return
  b.vy += G * dt
  b.x += b.vx * dt
  b.y += b.vy * dt
  for (const [x1, y1, x2, y2, e] of WALLS) {
    const h = hitSegment(b, x1, y1, x2, y2, 0)
    if (!h) continue
    b.x += h.nx * h.push
    b.y += h.ny * h.push
    const vn = b.vx * h.nx + b.vy * h.ny
    if (vn < 0) {
      b.vx -= (1 + e) * vn * h.nx
      b.vy -= (1 + e) * vn * h.ny
      if (e > 1) {
        P.score += 10
        sfx('bumper')
      }
    }
  }
  BUMPERS.forEach(([x, y, r], i) => {
    const dx = b.x - x
    const dy = b.y - y
    const d = Math.hypot(dx, dy)
    if (d >= r + R || d === 0) return
    const nx = dx / d
    const ny = dy / d
    b.x = x + nx * (r + R)
    b.y = y + ny * (r + R)
    const vn = b.vx * nx + b.vy * ny
    b.vx -= 2 * vn * nx
    b.vy -= 2 * vn * ny
    b.vx += nx * 260
    b.vy += ny * 260
    P.score += BUMPER_PTS
    P.lit.set(i, 0.15)
    sfx('bumper')
  })
  for (const f of [P.left, P.right]) {
    const ex = f.x + Math.cos(f.a) * FLIP_LEN * f.dir
    const ey = f.y + Math.sin(f.a) * FLIP_LEN
    const h = hitSegment(b, f.x, f.y, ex, ey, 6)
    if (!h) continue
    b.x += h.nx * h.push
    b.y += h.ny * h.push
    // The flipper's own speed where the ball touched it.
    const r = h.k * FLIP_LEN
    const sx = -Math.sin(f.a) * f.w * r * f.dir
    const sy = Math.cos(f.a) * f.w * r
    const rvx = b.vx - sx
    const rvy = b.vy - sy
    const vn = rvx * h.nx + rvy * h.ny
    if (vn < 0) {
      b.vx -= 1.3 * vn * h.nx
      b.vy -= 1.3 * vn * h.ny
    }
  }
  const sp = Math.hypot(b.vx, b.vy)
  if (sp > 1400) {
    b.vx *= 1400 / sp
    b.vy *= 1400 / sp
  }
  // Down the drain.
  if (b.y > H + 20) {
    P.ball = null
    P.balls--
    if (P.balls <= 0) P.over = true
  }
}

export function launch(P) {
  if (P.ball || P.over) return false
  P.ball = { x: 150 + (Math.random() - 0.5) * 60, y: 40, vx: (Math.random() - 0.5) * 300, vy: 50 }
  sfx('pop')
  return true
}

function drawPinball(ctx, P) {
  ctx.fillStyle = '#1a0f2a'
  ctx.fillRect(0, 0, W, H)
  ctx.lineCap = 'round'
  ctx.lineWidth = 4
  for (const [x1, y1, x2, y2, e] of WALLS) {
    ctx.strokeStyle = e > 1 ? '#ff6fd0' : '#8a7ab0'
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
  BUMPERS.forEach(([x, y, r], i) => {
    ctx.fillStyle = P.lit.has(i) ? '#d6ff7a' : '#5fae3a'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    // A zombie face.
    ctx.fillStyle = '#1a2a10'
    ctx.fillRect(x - r * 0.45, y - r * 0.25, r * 0.3, r * 0.3)
    ctx.fillRect(x + r * 0.15, y - r * 0.25, r * 0.3, r * 0.3)
    ctx.fillRect(x - r * 0.4, y + r * 0.25, r * 0.8, r * 0.15)
  })
  ctx.lineWidth = 12
  ctx.strokeStyle = '#ffd23f'
  for (const f of [P.left, P.right]) {
    ctx.beginPath()
    ctx.moveTo(f.x, f.y)
    ctx.lineTo(f.x + Math.cos(f.a) * FLIP_LEN * f.dir, f.y + Math.sin(f.a) * FLIP_LEN)
    ctx.stroke()
  }
  if (P.ball) {
    ctx.fillStyle = '#e8eef4'
    ctx.beginPath()
    ctx.arc(P.ball.x, P.ball.y, R, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 16px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(t('pinScore', { n: P.score.toLocaleString() }), 16, 36)
  ctx.textAlign = 'right'
  ctx.fillText(t('pinBalls', { n: Math.max(0, P.balls) }), 284, 36)
}

function loadBest() {
  try {
    return Math.max(0, Math.floor(Number(localStorage.getItem(PINBALL_BEST_KEY)) || 0))
  } catch {
    return 0
  }
}

export function openPinball(s) {
  const P = newPinball()
  // The table's own controls, for a test to drive it.
  P.step = (dt) => stepPinball(P, dt)
  P.launch = () => launch(P)
  let raf = 0
  let last = 0
  let info = null
  let launchBtn = null
  let best = loadBest()
  const finish = () => {
    if (P._paid) return
    P._paid = true
    const coins = Math.min(MAX_PIN_COINS, Math.floor(P.score / PTS_PER_COIN))
    if (coins > 0) s._earn(coins)
    P.coins = coins
    if (P.score > best) {
      best = P.score
      try { localStorage.setItem(PINBALL_BEST_KEY, String(best)) } catch { /* not kept */ }
    }
    s._renderHud?.()
  }
  const showInfo = () => {
    if (!info) return
    if (P.over) info.textContent = t('pinOver', { n: P.score.toLocaleString(), c: P.coins, best: best.toLocaleString() })
    else info.textContent = t('pinBest', { n: best.toLocaleString() })
    launchBtn.textContent = P.over ? t('pinAgain') : t('pinLaunch')
  }
  const go = () => {
    if (P.over) {
      Object.assign(P, newPinball())
      P._paid = false
    }
    launch(P)
    showInfo()
  }
  const key = (e, down) => {
    const c = e.code
    if (c === 'ArrowLeft' || c === 'KeyA' || c === 'KeyZ' || c === 'ShiftLeft') P.left.on = down
    else if (c === 'ArrowRight' || c === 'KeyD' || c === 'KeyM' || c === 'ShiftRight' || c === 'Slash') P.right.on = down
    else if (down && (c === 'Space' || c === 'ArrowDown' || c === 'Enter')) go()
  }
  openScreen(s, {
    title: t('pinTitle'),
    onKey: key,
    onClose: () => {
      cancelAnimationFrame(raf)
      if (P.score > 0) finish()
    },
    build(body) {
      const cv = document.createElement('canvas')
      cv.width = W
      cv.height = H
      cv.className = 'arcade-canvas'
      const ctx = cv.getContext('2d')
      const press = (e, on) => {
        const r = cv.getBoundingClientRect()
        const side = e.clientX - r.left < r.width / 2 ? 'left' : 'right'
        P[side].on = on
        e.preventDefault()
      }
      cv.addEventListener('pointerdown', (e) => press(e, true))
      cv.addEventListener('pointerup', (e) => press(e, false))
      cv.addEventListener('pointercancel', () => { P.left.on = false; P.right.on = false })
      cv.addEventListener('pointerleave', () => { P.left.on = false; P.right.on = false })
      launchBtn = document.createElement('button')
      launchBtn.type = 'button'
      launchBtn.className = 'camp-screen-btn'
      launchBtn.addEventListener('click', go)
      info = document.createElement('p')
      info.className = 'camp-screen-note'
      const help = document.createElement('p')
      help.className = 'camp-screen-note'
      help.textContent = t('pinHelp')
      body.append(cv, launchBtn, info, help)
      showInfo()
      const frame = (now) => {
        const dt = Math.min(0.033, last ? (now - last) / 1000 : 0.016)
        last = now
        const wasOver = P.over
        for (let i = 0; i < 4; i++) stepPinball(P, dt / 4)
        if (P.over && !wasOver) {
          finish()
          showInfo()
          sfx('scratch')
        }
        drawPinball(ctx, P)
        raf = requestAnimationFrame(frame)
      }
      raf = requestAnimationFrame(frame)
    },
  })
  return P
}

// ------------------------------------------------------------------ chess

const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
const white = (p) => !!p && p === p.toUpperCase()
const sideOf = (p) => (p ? (white(p) ? 'w' : 'b') : null)

export function newChess() {
  const back = 'rnbqkbnr'
  const b = []
  for (let i = 0; i < 64; i++) b.push('')
  for (let c = 0; c < 8; c++) {
    b[c] = back[c]
    b[8 + c] = 'p'
    b[48 + c] = 'P'
    b[56 + c] = back[c].toUpperCase()
  }
  return { b, turn: 'w', castle: { K: true, Q: true, k: true, q: true }, ep: -1 }
}

// Is square i attacked by side `by`?
export function attacked(b, i, by) {
  const r = Math.floor(i / 8)
  const c = i % 8
  const at = (rr, cc) => (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 ? b[rr * 8 + cc] : null)
  const mine = (p, type) => p && sideOf(p) === by && p.toLowerCase() === type
  const pr = by === 'w' ? r + 1 : r - 1
  if (mine(at(pr, c - 1), 'p') || mine(at(pr, c + 1), 'p')) return true
  for (const [dr, dc] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) if (mine(at(r + dr, c + dc), 'n')) return true
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if ((dr || dc) && mine(at(r + dr, c + dc), 'k')) return true
  for (const [dr, dc, a, z] of [[1, 0, 'r', 'q'], [-1, 0, 'r', 'q'], [0, 1, 'r', 'q'], [0, -1, 'r', 'q'], [1, 1, 'b', 'q'], [1, -1, 'b', 'q'], [-1, 1, 'b', 'q'], [-1, -1, 'b', 'q']]) {
    for (let k = 1; k < 8; k++) {
      const p = at(r + dr * k, c + dc * k)
      if (p === null) break
      if (!p) continue
      if (mine(p, a) || mine(p, z)) return true
      break
    }
  }
  return false
}

// Moves that might leave your own king in check: { from, to, promo, ep, castle }.
function pseudo(S) {
  const { b, turn } = S
  const out = []
  const enemy = turn === 'w' ? 'b' : 'w'
  for (let i = 0; i < 64; i++) {
    const p = b[i]
    if (!p || sideOf(p) !== turn) continue
    const r = Math.floor(i / 8)
    const c = i % 8
    const type = p.toLowerCase()
    const add = (to, extra = {}) => out.push({ from: i, to, ...extra })
    const ok = (rr, cc) => rr >= 0 && rr < 8 && cc >= 0 && cc < 8
    if (type === 'p') {
      const dir = turn === 'w' ? -1 : 1
      const start = turn === 'w' ? 6 : 1
      const last = turn === 'w' ? 0 : 7
      const one = (r + dir) * 8 + c
      if (ok(r + dir, c) && !b[one]) {
        add(one, r + dir === last ? { promo: true } : {})
        const two = (r + 2 * dir) * 8 + c
        if (r === start && !b[two]) add(two, { double: true })
      }
      for (const dc of [-1, 1]) {
        if (!ok(r + dir, c + dc)) continue
        const to = (r + dir) * 8 + c + dc
        if (b[to] && sideOf(b[to]) === enemy) add(to, r + dir === last ? { promo: true } : {})
        else if (to === S.ep) add(to, { ep: true })
      }
    } else if (type === 'n' || type === 'k') {
      const steps = type === 'n' ? [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
      for (const [dr, dc] of steps) {
        if (!ok(r + dr, c + dc)) continue
        const to = (r + dr) * 8 + c + dc
        if (!b[to] || sideOf(b[to]) === enemy) add(to)
      }
      if (type === 'k') {
        const row = turn === 'w' ? 7 : 0
        const K = turn === 'w' ? 'K' : 'k'
        const Q = turn === 'w' ? 'Q' : 'q'
        const rook = turn === 'w' ? 'R' : 'r'
        if (i === row * 8 + 4 && !attacked(b, i, enemy)) {
          if (S.castle[K] && b[row * 8 + 7] === rook && !b[row * 8 + 5] && !b[row * 8 + 6] && !attacked(b, row * 8 + 5, enemy)) add(row * 8 + 6, { castle: 'k' })
          if (S.castle[Q] && b[row * 8] === rook && !b[row * 8 + 1] && !b[row * 8 + 2] && !b[row * 8 + 3] && !attacked(b, row * 8 + 3, enemy)) add(row * 8 + 2, { castle: 'q' })
        }
      }
    } else {
      const dirs = type === 'r' ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : type === 'b' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
      for (const [dr, dc] of dirs) {
        for (let k = 1; k < 8; k++) {
          if (!ok(r + dr * k, c + dc * k)) break
          const to = (r + dr * k) * 8 + c + dc * k
          if (!b[to]) add(to)
          else {
            if (sideOf(b[to]) === enemy) add(to)
            break
          }
        }
      }
    }
  }
  return out
}

export function play(S, m) {
  const b = S.b.slice()
  const p = b[m.from]
  const castle = { ...S.castle }
  b[m.to] = m.promo ? (white(p) ? 'Q' : 'q') : p
  b[m.from] = ''
  if (m.ep) b[m.to + (white(p) ? 8 : -8)] = ''
  if (m.castle) {
    const row = Math.floor(m.from / 8) * 8
    if (m.castle === 'k') {
      b[row + 5] = b[row + 7]
      b[row + 7] = ''
    } else {
      b[row + 3] = b[row]
      b[row] = ''
    }
  }
  if (p === 'K') castle.K = castle.Q = false
  if (p === 'k') castle.k = castle.q = false
  for (const [sq, key] of [[63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']]) if (m.from === sq || m.to === sq) castle[key] = false
  return { b, turn: S.turn === 'w' ? 'b' : 'w', castle, ep: m.double ? (m.from + m.to) / 2 : -1 }
}

export function legal(S) {
  return pseudo(S).filter((m) => {
    const n = play(S, m)
    const k = n.b.indexOf(S.turn === 'w' ? 'K' : 'k')
    return !attacked(n.b, k, n.turn)
  })
}

export function inCheck(S) {
  return attacked(S.b, S.b.indexOf(S.turn === 'w' ? 'K' : 'k'), S.turn === 'w' ? 'b' : 'w')
}

// 'mate' (the side to move lost), 'stale' or null.
export function chessResult(S) {
  if (legal(S).length) return null
  return inCheck(S) ? 'mate' : 'stale'
}

function evaluate(b) {
  let v = 0
  for (let i = 0; i < 64; i++) {
    const p = b[i]
    if (!p) continue
    const r = Math.floor(i / 8)
    const c = i % 8
    const centre = 3.5 - Math.max(Math.abs(r - 3.5), Math.abs(c - 3.5))
    const val = VAL[p.toLowerCase()] + (p.toLowerCase() === 'k' ? 0 : centre * 6)
    v += white(p) ? val : -val
  }
  return v
}

function search(S, depth, alpha, beta) {
  const moves = legal(S)
  if (!moves.length) return inCheck(S) ? (S.turn === 'w' ? -100000 - depth : 100000 + depth) : 0
  if (depth === 0) return evaluate(S.b)
  // Captures first: more cut-offs.
  moves.sort((a, z) => (S.b[z.to] ? VAL[S.b[z.to].toLowerCase()] : 0) - (S.b[a.to] ? VAL[S.b[a.to].toLowerCase()] : 0))
  if (S.turn === 'w') {
    let best = -Infinity
    for (const m of moves) {
      best = Math.max(best, search(play(S, m), depth - 1, alpha, beta))
      alpha = Math.max(alpha, best)
      if (alpha >= beta) break
    }
    return best
  }
  let best = Infinity
  for (const m of moves) {
    best = Math.min(best, search(play(S, m), depth - 1, alpha, beta))
    beta = Math.min(beta, best)
    if (alpha >= beta) break
  }
  return best
}

// The zombie's move (it plays Black).
export function aiMove(S, depth = CHESS_DEPTH) {
  const moves = legal(S)
  if (!moves.length) return null
  let best = null
  let bestV = Infinity
  for (const m of moves) {
    const v = search(play(S, m), depth - 1, -Infinity, Infinity) + Math.random() * 8
    if (v < bestV) {
      bestV = v
      best = m
    }
  }
  return best
}

export function openChess(s) {
  const G = { S: newChess(), pick: -1, done: null, paid: false }
  let grid = null
  let note = null
  const render = () => {
    const moves = G.pick >= 0 ? legal(G.S).filter((m) => m.from === G.pick) : []
    grid.textContent = ''
    for (let i = 0; i < 64; i++) {
      const sq = document.createElement('button')
      sq.type = 'button'
      const r = Math.floor(i / 8)
      const c = i % 8
      sq.className = `chess-sq ${(r + c) % 2 ? 'dark' : 'light'}${i === G.pick ? ' pick' : ''}${moves.some((m) => m.to === i) ? ' to' : ''}`
      const p = G.S.b[i]
      if (p) {
        const span = document.createElement('span')
        span.className = white(p) ? 'w' : 'b'
        span.textContent = `${GLYPH[p.toLowerCase()]}︎`
        sq.appendChild(span)
      }
      sq.addEventListener('click', () => tap(i))
      grid.appendChild(sq)
    }
    if (G.done === 'win') note.textContent = t('chessWin', { n: CHESS_WIN_COINS })
    else if (G.done === 'lose') note.textContent = t('chessLose')
    else if (G.done === 'stale') note.textContent = t('chessStale')
    else note.textContent = inCheck(G.S) ? t('chessCheck') : t(G.S.turn === 'w' ? 'chessYourMove' : 'chessThinking')
  }
  const settle = () => {
    const res = chessResult(G.S)
    if (!res) return false
    G.done = res === 'stale' ? 'stale' : G.S.turn === 'b' ? 'win' : 'lose'
    if (G.done === 'win' && !G.paid) {
      G.paid = true
      s._earn(CHESS_WIN_COINS)
      s._renderHud?.()
      sfx('chime')
    }
    return true
  }
  const tap = (i) => {
    if (G.done || G.S.turn !== 'w') return
    const p = G.S.b[i]
    if (G.pick >= 0) {
      const m = legal(G.S).find((mv) => mv.from === G.pick && mv.to === i)
      if (m) {
        G.S = play(G.S, m)
        G.pick = -1
        sfx('thud')
        if (!settle()) {
          render()
          setTimeout(() => {
            if (G.done) return
            const reply = aiMove(G.S)
            if (reply) G.S = play(G.S, reply)
            sfx('thud')
            settle()
            if (grid.isConnected) render()
          }, 250)
          return
        }
        render()
        return
      }
    }
    G.pick = p && white(p) ? i : -1
    render()
  }
  G.tap = (i) => tap(i)
  G.legal = () => legal(G.S)
  G.result = () => chessResult(G.S)
  G.play = (from, to) => {
    const m = legal(G.S).find((mv) => mv.from === from && mv.to === to)
    if (m) G.S = play(G.S, m)
    return !!m
  }
  G.ai = () => aiMove(G.S)
  openScreen(s, {
    title: t('chessTitle'),
    build(body) {
      grid = document.createElement('div')
      grid.className = 'chess-board'
      note = document.createElement('p')
      note.className = 'camp-screen-note'
      const again = document.createElement('button')
      again.type = 'button'
      again.className = 'camp-screen-btn'
      again.textContent = t('chessNew')
      again.addEventListener('click', () => {
        G.S = newChess()
        G.pick = -1
        G.done = null
        G.paid = false
        render()
      })
      body.append(note, grid, again)
      render()
    },
  })
  return G
}
