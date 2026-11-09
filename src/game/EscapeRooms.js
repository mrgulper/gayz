// Escape Rooms (2026-11-02, Gaymi's idea list 5: "ready-made puzzle rooms
// with levers, codes and buttons while zombies bang on the door. The map
// editor's logic blocks can run the puzzles" - Gaymi picked "a new Play
// mode"). Owned by BuildSurvival (`s.escape`) when cfg.mode is
// 'escapeRoom' or 'escapeRace' (no waves).
//
// On a server (2026-11-09, Gaymi: "make both gamemodes"):
// - Escape Rooms (server mode 'escape') is a team game: the host's puzzles
//   for everyone (snapshot() -> applySnapshot()), a room anyone solves
//   opens for all (a hit `es<room>` to the host), and the door clock runs
//   on the host for the furthest room anyone has reached.
// - Escape Race ('escapeSolo') gives each player their own copy of the
//   rooms side by side (LANE blocks apart, `lane` in their state) with
//   their own puzzles and door clocks - first out wins. A door bursting
//   on someone else's copy asks the host for its zombies (`eb<room>_<lane>`).
// Everyone but the host builds their rooms after the first sync (the
// team's puzzles, or a free lane).
//
// The map: ROOMS stone rooms in a row high in the sky (ESC_Y), put in when
// the game starts and gone again when it ends (BuildSurvival `_placed`),
// like Tower Defense's. Each has a boarded-up door the zombies are banging
// on: it holds ROOM_S[i] seconds (a bar on screen), then it bursts and
// BREAK_IN zombies pile in - you can still solve the room while you fight
// them. Solve the puzzle and the stone in the far wall slides away to the
// next room; out of the last one onto the balcony and you've escaped
// (ESC_COINS coins, plus ROOM_COINS for every room solved before its door
// broke).
//
// 1. Levers - real Map Editor levers, numbered 1-4 by signs. A sign says
//    which ones go on; flip them (Use / right-click) to match.
// 2. Code - four signs round the room each give one digit of a 4-digit
//    code. Use the keypad (the target block by the far wall) and type it.
// 3. Buttons - four coloured blocks. Use the note block and they light up
//    in an order (SIMON_LEN); use them in the same order. A wrong one plays
//    it again and costs the door WRONG_COST seconds.
//
// Meshes only, never a light. Blocks of the map can't be broken or built
// on (protects).
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { zombieHealth } from './BuildSurvival.js'

export const ESC_Y = 240
export const ROOMS = 3
export const ROOM_S = [180, 160, 140]
export const BREAK_IN = 3
export const ESC_COINS = 60
export const ROOM_COINS = 20
export const SIMON_LEN = 5
export const WRONG_COST = 10
export const LANE = 14 // Escape Race: blocks between two players' copies
const W = 10 // a room's step along x (9 inside + a wall)
const HALF = 4 // inside: z from -4 to 4
const H = 5 // inside height
const BANG_EVERY = [1.2, 2.4]
const SIMON_STEP = 0.6
const SIMON_BLOCKS = ['redsandstone', 'prismarinebricks', 'haybale', 'purpurblock']
const SIMON_COLORS = [0xff4a3a, 0x3affd8, 0xffe04a, 0xc06aff]

export class EscapeRooms {
  constructor(survival, { race = false } = {}) {
    this.s = survival
    this.race = race
    this.lane = 0
    this.ox = 0
    this.oz = 0
    this.room = 0 // the room you're in
    this.solved = new Array(ROOMS).fill(false)
    this.broke = new Array(ROOMS).fill(false)
    this.doorLeft = [...ROOM_S]
    this.started = new Array(ROOMS).fill(false)
    this.done = false
    this._map = new Set()
    this._exits = [] // per room: the cells of its far-wall opening
    this._group = new THREE.Group()
    survival.bm.scene.add(this._group)
    this._bangIn = 2
    // The puzzles: lever pattern, code digits, button order.
    this.pattern = [0, 0, 0, 0].map(() => Math.random() < 0.5)
    if (!this.pattern.some(Boolean)) this.pattern[Math.floor(Math.random() * 4)] = true
    this.code = Array.from({ length: 4 }, () => Math.floor(Math.random() * 10))
    this.simon = Array.from({ length: SIMON_LEN }, () => Math.floor(Math.random() * 4))
    this._simonAt = 0
    this._showing = null
    this.order = [0, 1, 2, 3].sort(() => Math.random() - 0.5)
    this._bar = document.createElement('div')
    this._bar.id = 'escape-bar'
    this._bar.innerHTML = '<span class="escape-label"></span><div class="escape-track"><i></i></div>'
    document.body.appendChild(this._bar)
    // Joining someone's server: wait for the first sync (applySnapshot /
    // pickLane), then build.
    if (this._guest()) {
      this.waiting = true
      this._bar.style.display = 'none'
      return
    }
    this._start()
  }

  _guest() {
    const net = this.s.net
    return !!(net && !net.closed && !net.lobby && !net.isHost)
  }

  _start() {
    this.waiting = false
    this._bar.style.display = ''
    this._build()
    this.placePlayer()
    this.s._message(t(this.race ? 'escapeRaceStart' : 'escapeStart'), 6)
  }

  // --- on a server ---

  // Team: the host's puzzles and progress, for everyone else.
  snapshot() {
    if (this.race || this.waiting) return null
    const bits = (a) => a.reduce((n, on, i) => n | (on ? 1 << i : 0), 0)
    return { p: bits(this.pattern), c: this.code.join(''), m: this.simon.join(''), o: this.order.join(''), s: bits(this.solved), b: bits(this.broke), d: this.doorLeft.map((n) => Math.max(0, Math.round(n))), r: this._teamRoom() }
  }

  applySnapshot(n) {
    if (this.race || !n) return
    const has = (bitsN, i) => !!(Number(bitsN) & (1 << i))
    if (this.waiting) {
      this.pattern = [0, 1, 2, 3].map((i) => has(n.p, i))
      this.code = String(n.c || '0000').split('').map(Number)
      this.simon = String(n.m || '').split('').map(Number).filter((k) => k >= 0 && k < 4)
      if (this.simon.length !== SIMON_LEN) this.simon = Array.from({ length: SIMON_LEN }, (_, i) => this.simon[i] ?? 0)
      const order = String(n.o || '0123').split('').map(Number)
      if (order.length === 4) this.order = order
      this.room = Math.max(0, Math.min(ROOMS - 1, Number(n.r) || 0))
      for (let i = 0; i < this.room; i++) this.started[i] = true
      this._start()
    }
    for (let i = 0; i < ROOMS; i++) {
      if (has(n.s, i) && !this.solved[i]) this._solve(i, true)
      if (has(n.b, i) && !this.broke[i]) this._breakIn(i, true)
      if (Array.isArray(n.d)) this.doorLeft[i] = Number(n.d[i]) || 0
    }
  }

  // Team: the furthest room anyone's in (the host's door clock runs there).
  _teamRoom() {
    let room = this.room
    for (const p of this.s.net?.players?.values?.() || []) {
      const x = p.tx ?? p.x
      const z = p.tz ?? p.z
      const y = p.ty ?? p.y
      if (y < ESC_Y - 3 || Math.abs(z - this.oz) > HALF + 1) continue
      room = Math.max(room, Math.min(ROOMS - 1, Math.floor((x - this._roomX(0)) / W)))
    }
    return room
  }

  // Race, on the host: the floor, walls and roof of everyone else's copy
  // (open where their doors and exits are), so the zombies the host runs
  // for them have somewhere to stand.
  _shells() {
    if (!this.race || this._guest() || !this.s.net) return
    if (!this._shelled) this._shelled = new Set([this.lane])
    for (const p of this.s.net.players.values()) {
      const lane = p.lane || 0
      if (this._shelled.has(lane)) continue
      this._shelled.add(lane)
      this._shell(lane * LANE)
    }
  }

  _shell(oz) {
    const bm = this.s.bm
    const Y = ESC_Y
    bm._suppressUndoRecording = true
    const x0 = this._roomX(0)
    const x1 = this._roomX(ROOMS)
    for (let x = x0; x <= x1; x++) {
      for (let z = oz - HALF - 1; z <= oz + HALF + 1; z++) {
        this._put(x, Y, z, 'oakplanks')
        this._put(x, Y + H + 1, z, 'glass')
        const wallX = (x - x0) % W === 0
        const wallZ = Math.abs(z - oz) === HALF + 1
        if (!wallX && !wallZ) continue
        for (let y = Y + 1; y <= Y + H; y++) {
          const exit = wallX && x > x0 && Math.abs(z - oz) <= 1 && y <= Y + 2
          const room = Math.floor((x - x0) / W)
          const door = z === oz - HALF - 1 && y <= Y + 3 && (x - this._roomX(room) === 4 || x - this._roomX(room) === 5)
          if (!exit && !door) this._put(x, y, z, 'stonebricks')
        }
      }
    }
    bm._suppressUndoRecording = false
  }

  // Race: my copy goes in the first lane nobody else is in.
  pickLane() {
    if (!this.race || !this.waiting) return
    const taken = new Set([...(this.s.net?.players?.values?.() || [])].map((p) => p.lane || 0))
    let lane = 1
    while (taken.has(lane) && lane < 15) lane++
    this.lane = lane
    this.oz = lane * LANE
    this._start()
  }

  // Another player's message (host only): `es<room>` a team room solved,
  // `ew<room>` a wrong button, `eb<room>_<lane>` a race door burst.
  remoteHit(h) {
    const m = /^e([swb])(\d)(?:_(\d{1,2}))?$/.exec(String(h.id))
    if (!m || this.waiting) return
    const room = Number(m[2])
    if (room >= ROOMS) return
    if (m[1] === 's' && !this.race) this._solve(room)
    else if (m[1] === 'w' && !this.race && !this.broke[room]) this.doorLeft[room] = Math.max(0.5, this.doorLeft[room] - WRONG_COST)
    else if (m[1] === 'b' && this.race) this._zombiesIn(room, Number(m[3]) * LANE)
  }

  // Room i's west wall (x) and its middle (z).
  _roomX(i) {
    return this.ox + i * W
  }

  // Blocks of the map (all `_placed`, so they go at the end).
  _put(x, y, z, type, state = null) {
    const s = this.s
    const bm = s.bm
    const key = bm._key(x, y, z)
    this._map.add(key)
    if (bm.getBlockAt(x, y, z) === type) return
    if (bm.getBlockAt(x, y, z)) bm.removeBlock(x, y, z)
    bm.placeBlock(x, y, z, type, true, state)
    s._placed.set(key, type)
  }

  _build() {
    const bm = this.s.bm
    const Y = ESC_Y
    bm._suppressUndoRecording = true
    const x0 = this._roomX(0)
    const x1 = this._roomX(ROOMS)
    for (let x = x0; x <= x1; x++) {
      for (let z = this.oz - HALF - 1; z <= this.oz + HALF + 1; z++) {
        this._put(x, Y, z, 'oakplanks')
        this._put(x, Y + H + 1, z, 'glass')
        const wallX = (x - x0) % W === 0
        const wallZ = Math.abs(z - this.oz) === HALF + 1
        if (!wallX && !wallZ) continue
        for (let y = Y + 1; y <= Y + H; y++) this._put(x, y, z, 'stonebricks')
      }
    }
    // The balcony past the last room.
    for (let x = x1 + 1; x <= x1 + 4; x++) for (let z = this.oz - 2; z <= this.oz + 2; z++) this._put(x, Y, z, 'grass')
    // The way out of each room: a 3 x 2 slab of reinforced stone in its
    // east wall (the first room's west wall stays shut).
    for (let i = 0; i < ROOMS; i++) {
      const x = this._roomX(i + 1)
      const cells = []
      for (let z = this.oz - 1; z <= this.oz + 1; z++) for (let y = Y + 1; y <= Y + 2; y++) {
        this._put(x, y, z, 'reinforceddeepslate')
        cells.push([x, y, z])
      }
      this._exits.push(cells)
      // The boarded door the zombies are behind: dark planks in the north wall.
      const dx = this._roomX(i) + 5
      for (let y = Y + 1; y <= Y + 3; y++) for (const ddx of [0, 1]) this._put(dx + ddx - 1, y, this.oz - HALF - 1, 'darkoakplanks')
    }
    // Room 1: four numbered levers along the south wall and the clue.
    const r0 = this._roomX(0)
    this._levers = []
    for (let i = 0; i < 4; i++) {
      const x = r0 + 2 + i * 2
      const z = this.oz + HALF - 1
      this._put(x, Y + 1, z, 'lever', { facing: 2 })
      this._put(x, Y + 2, z, 'sign', { facing: 2, text: String(i + 1) })
      this._levers.push([x, Y + 1, z])
    }
    this._put(r0 + 5, Y + 1, this.oz, 'sign', { facing: 0, text: this.pattern.map((on, i) => `${i + 1}:${on ? t('escapeOn') : t('escapeOff')}`).join(' ') })
    // Room 2: the digits on signs round the room (on bookshelves), and the
    // keypad by the far wall.
    const r1 = this._roomX(1)
    const corners = [[r1 + 1, this.oz - HALF], [r1 + 9, this.oz - HALF], [r1 + 1, this.oz + HALF], [r1 + 5, this.oz + HALF]]
    const order = this.order
    corners.forEach(([x, z], k) => {
      const i = order[k]
      this._put(x, Y + 1, z, 'bookshelf')
      this._put(x, Y + 2, z, 'sign', { facing: z < this.oz ? 0 : 2, text: t('escapeDigit', { n: i + 1, d: this.code[i] }) })
    })
    this._keypad = [r1 + 9, Y + 1, this.oz + 2]
    this._put(...this._keypad, 'target')
    // Room 3: the coloured blocks and the note block that plays the order.
    const r2 = this._roomX(2)
    this._simonCells = SIMON_BLOCKS.map((type, i) => {
      const cell = [r2 + 2 + i * 2, Y + 1, this.oz + 2]
      this._put(...cell, type)
      return cell
    })
    this._simonStart = [r2 + 5, Y + 1, this.oz - 2]
    this._put(...this._simonStart, 'noteblock')
    bm._suppressUndoRecording = false
    // A glow over a coloured block while it's lit.
    const B = this.s.B
    this._flash = new THREE.Mesh(new THREE.BoxGeometry(1.08 * B, 1.08 * B, 1.08 * B), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }))
    this._flash.visible = false
    this._group.add(this._flash)
    // A green beam on the balcony: the way out.
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * B, 20 * B, 2 * B), new THREE.MeshBasicMaterial({ color: 0x4aff7a, transparent: true, opacity: 0.18, depthWrite: false }))
    beam.position.set((x1 + 2.5) * B, (Y + 11) * B, (this.oz + 0.5) * B)
    this._group.add(beam)
  }

  // You start (and come back after dying) in the room you're up to.
  placePlayer() {
    const bm = this.s.bm
    const B = this.s.B
    const x = this._roomX(this.room) + 5.5
    const z = this.oz + 0.5 + 2
    bm.camera.position.set(x * B, (ESC_Y + 1 + 1.62) * B, z * B)
    bm._yaw = -Math.PI / 2
    bm._pitch = 0
    if (bm.tryMode.active) {
      bm.tryMode.pos.set(x, ESC_Y + 1, z)
      bm.tryMode.vel?.set(0, 0, 0)
    }
  }

  protects(x, y, z) {
    return this._map.has(this.s.bm._key(x, y, z))
  }

  // Using a block (BuildMode._tryUseFromCamera): the keypad, the note
  // block, a coloured block. -> true if it was one of them.
  useBlock(x, y, z) {
    if (this.done) return false
    const same = (c) => c && c[0] === x && c[1] === y && c[2] === z
    if (same(this._keypad)) {
      if (!this.solved[1]) this._openKeypad()
      return true
    }
    if (same(this._simonStart)) {
      if (!this.solved[2]) this._playSimon()
      return true
    }
    const i = this._simonCells?.findIndex(same) ?? -1
    if (i >= 0) {
      this._pressSimon(i)
      return true
    }
    return false
  }

  update(dt) {
    const s = this.s
    if (!s.active || this.done) return
    if (this.waiting) {
      // Race: as soon as the others' lanes are known (the first sync).
      if (this.race && this.s.net && !this.s.net._firstSync) this.pickLane()
      return
    }
    this._shells()
    const p = s.bm.tryMode.pos
    // Which room you're in; walking in starts its door's clock.
    const room = Math.max(0, Math.min(ROOMS, Math.floor((p.x - this._roomX(0)) / W)))
    if (room >= ROOMS) return this._escaped()
    this.room = room
    if (!this.started[room]) {
      this.started[room] = true
      s._message(t(`escapeRoom${room + 1}`), 6)
      if (room === 2) setTimeout(() => this._playSimon(), 1200)
    }
    // Fell out somehow: back in.
    if (p.y < ESC_Y - 8) this.placePlayer()
    // Team on a server: the host's clock (for the furthest room anyone's
    // in) - everyone else just shows it.
    const team = !this.race && s.net && !s.net.closed && !s.net.lobby
    const clock = team ? (this._guest() ? -1 : this._teamRoom()) : room
    if (clock >= 0 && !this.solved[clock] && !this.broke[clock] && !(s.dead && !team)) {
      this.doorLeft[clock] -= dt
      this._bangIn -= dt
      if (this._bangIn <= 0) {
        this._bangIn = BANG_EVERY[0] + Math.random() * (BANG_EVERY[1] - BANG_EVERY[0])
        try { audioEngine.playSpecial?.('thud') } catch { /* no audio */ }
        s.bm.sky?.disasters && (s.bm.sky.disasters.shake = Math.max(s.bm.sky.disasters.shake, 0.03))
      }
      if (this.doorLeft[clock] <= 0) this._breakIn(clock)
    }
    if (room === 0 && !this.solved[0] && this._leversRight()) this._solve(0)
    this._updateSimon(dt)
    this._renderBar()
  }

  _leversRight() {
    const on = this.s.bm.gadgets?.leverOn
    if (!on) return false
    return this._levers.every((c, i) => on.has(this.s.bm._key(...c)) === this.pattern[i])
  }

  // fromNet: the host said so (team) - nothing to send back.
  _solve(i, fromNet = false) {
    const s = this.s
    if (this.solved[i]) return
    this.solved[i] = true
    if (!fromNet && !this.race && this._guest()) s.net.queueHit('es' + i, 0)
    if (!this.broke[i]) s.coins = (s.coins || 0) + ROOM_COINS
    // The stone in the far wall slides away.
    const bm = s.bm
    bm._suppressUndoRecording = true
    for (const [x, y, z] of this._exits[i]) {
      bm.removeBlock(x, y, z)
      s._placed.delete(bm._key(x, y, z))
      this._map.delete(bm._key(x, y, z))
    }
    bm._suppressUndoRecording = false
    s._message(t(i === ROOMS - 1 ? 'escapeLastSolved' : 'escapeSolved'), 4)
    s._renderHud?.()
    try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
  }

  // The door bursts: zombies pile in (the host's zombies, on a server).
  _breakIn(room, fromNet = false) {
    const s = this.s
    this.broke[room] = true
    this.doorLeft[room] = 0
    const bm = s.bm
    const dx = this._roomX(room) + 5
    bm._suppressUndoRecording = true
    for (let y = ESC_Y + 1; y <= ESC_Y + 3; y++) for (const ddx of [-1, 0]) {
      const key = bm._key(dx + ddx, y, this.oz - HALF - 1)
      bm.removeBlock(dx + ddx, y, this.oz - HALF - 1)
      s._placed.delete(key)
      this._map.delete(key)
    }
    bm._suppressUndoRecording = false
    if (this._guest()) {
      if (this.race && !fromNet) s.net.queueHit(`eb${room}_${this.lane}`, 0)
    } else this._zombiesIn(room, this.oz)
    s._message(t('escapeBrokeIn'), 4)
    try { audioEngine.playSpecial?.('crumble') } catch { /* no audio */ }
  }

  // The zombies through room `room`'s door (of the copy at `oz`).
  _zombiesIn(room, oz) {
    const s = this.s
    const dx = this._roomX(room) + 5
    for (let k = 0; k < BREAK_IN + room; k++) {
      s._makeZombie(++s._zid, dx - 0.5 + (k % 2), ESC_Y + 1, oz - HALF + 0.5 + Math.floor(k / 2) * 0.6, zombieHealth(2 + room * 2), false)
    }
  }

  _escaped() {
    if (this.done) return
    this.done = true
    const s = this.s
    s.coins = (s.coins || 0) + ESC_COINS
    this._bar.remove()
    s._message(t('escapeWinMsg', { n: ESC_COINS }), 5)
    try { audioEngine.playSpecial?.('firework') } catch { /* no audio */ }
    s._win()
  }

  // --- the code (room 2) ---

  _openKeypad() {
    if (this._pad) return
    const el = document.createElement('div')
    el.id = 'escape-keypad'
    const title = document.createElement('div')
    title.className = 'escape-pad-title'
    title.textContent = t('escapeKeypad')
    const shown = document.createElement('div')
    shown.className = 'escape-pad-code'
    const keys = document.createElement('div')
    keys.className = 'escape-pad-keys'
    let typed = ''
    const show = () => { shown.textContent = typed.padEnd(4, '_').split('').join(' ') }
    const close = () => {
      el.remove()
      window.removeEventListener('keydown', onKey, true)
      this._pad = null
    }
    const enter = () => {
      if (typed === this.code.join('')) {
        close()
        this._solve(1)
      } else {
        typed = ''
        show()
        el.classList.remove('wrong')
        void el.offsetWidth
        el.classList.add('wrong')
        try { audioEngine.playSpecial?.('warn') } catch { /* no audio */ }
      }
    }
    const press = (k) => {
      if (k === 'ok') return enter()
      if (k === 'del') typed = typed.slice(0, -1)
      else if (typed.length < 4) typed += k
      show()
      if (typed.length === 4) enter()
    }
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok']) {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = k === 'del' ? '⌫' : k === 'ok' ? '✓' : k
      b.addEventListener('click', () => press(k))
      keys.appendChild(b)
    }
    const shut = document.createElement('button')
    shut.type = 'button'
    shut.className = 'escape-pad-close'
    shut.textContent = t('escapeKeypadClose')
    shut.addEventListener('click', close)
    el.append(title, shown, keys, shut)
    const onKey = (e) => {
      const d = /^(?:Digit|Numpad)(\d)$/.exec(e.code)
      if (d) press(d[1])
      else if (e.code === 'Backspace') press('del')
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') press('ok')
      else if (e.code === 'Escape') close()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    document.body.appendChild(el)
    if (document.pointerLockElement) document.exitPointerLock()
    show()
    this._pad = { close }
  }

  // --- the buttons (room 3) ---

  _playSimon() {
    if (this.solved[2]) return
    this._simonAt = 0
    this._showing = { i: 0, t: 0 }
  }

  _updateSimon(dt) {
    const sh = this._showing
    if (!sh) {
      if (this._lit > 0 && (this._lit -= dt) <= 0) this._flash.visible = false
      return
    }
    sh.t += dt
    const i = Math.floor(sh.t / SIMON_STEP)
    const on = sh.t % SIMON_STEP < SIMON_STEP * 0.65
    if (i >= this.simon.length) {
      this._showing = null
      this._flash.visible = false
      return
    }
    this._light(this.simon[i], on)
    if (on && i !== sh.i) {
      sh.i = i
      this._beep(this.simon[i])
    }
    if (i === 0 && !sh.beeped) {
      sh.beeped = true
      this._beep(this.simon[0])
    }
  }

  _light(n, on) {
    const B = this.s.B
    const [x, y, z] = this._simonCells[n]
    this._flash.position.set((x + 0.5) * B, (y + 0.5) * B, (z + 0.5) * B)
    this._flash.material.color.set(SIMON_COLORS[n])
    this._flash.visible = on
  }

  _beep(n) {
    try { audioEngine.playNote?.([262, 330, 392, 523][n]) } catch { /* no audio */ }
  }

  _pressSimon(n) {
    if (this.solved[2] || this._showing) return
    this._light(n, true)
    this._lit = 0.3
    this._beep(n)
    if (this.simon[this._simonAt] === n) {
      this._simonAt++
      if (this._simonAt >= this.simon.length) this._solve(2)
      return
    }
    // Wrong: the door takes a beating, and the order plays again.
    this.s._message(t('escapeWrong', { n: WRONG_COST }), 3)
    if (!this.race && this._guest()) this.s.net.queueHit('ew2', 0)
    else if (!this.broke[2]) this.doorLeft[2] = Math.max(0.5, this.doorLeft[2] - WRONG_COST)
    setTimeout(() => this._playSimon(), 700)
  }

  _renderBar() {
    const room = this.room
    const left = Math.max(0, this.doorLeft[room])
    const label = this._bar.querySelector('.escape-label')
    const text = this.solved[room] ? t('escapeGoOn') : this.broke[room] ? t('escapeDoorGone') : t('escapeDoorHolds', { n: Math.ceil(left) })
    const want = `${t('escapeRoomOf', { n: room + 1, max: ROOMS })} · ${text}`
    if (label.textContent !== want) label.textContent = want
    this._bar.querySelector('i').style.width = `${(this.solved[room] ? 1 : left / ROOM_S[room]) * 100}%`
    this._bar.classList.toggle('low', !this.solved[room] && !this.broke[room] && left < 30)
  }

  hudText() {
    if (this.waiting) return t('escapeJoining')
    return t('escapeRoomOf', { n: this.room + 1, max: ROOMS })
  }

  dispose() {
    this._pad?.close()
    this._bar.remove()
    this._group.removeFromParent()
    this._group.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.dispose()
      o.material.dispose()
    })
  }
}
