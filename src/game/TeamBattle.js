// Team battles (2026-10-31): your team (Creatures.js) against another
// player's saved "ghost team" - or a made-up one when none can be found -
// in a small fenced arena. Everyone fights by themselves (Gaymi, same day:
// "it auto battles for you"; it used to be "you control one creature"),
// going for the nearest enemy, and every creature has a special power
// (Creatures.powerOf: Horde, Bone Throw, Rage, Stomp, Pounce, Roar, Thick
// Hide, Heal Friends - the numbers are below). Last team standing wins;
// after ROUND_S the one with more health left wins. Speed x1/x2/x4 and
// Leave buttons; Esc leaves too.
//
// Shown in 3D (a WebGL scene seen from above at an angle) or 2D (the
// arena from straight above on a plain canvas, creature pictures as
// pieces) - Settings > Team Battle View picks, and the battle's own
// button flips it mid-fight (remembered through onView). The 3D scene is
// only built the first time it's shown.
//
// A screen of its own over the homepage (#team-battle), made when a battle
// starts and thrown away when it ends - the homepage keeps running
// underneath. Opened from Inventory's Pets tab (TeamUI.js).
import * as THREE from 'three'
import { PlayAnimals } from './PlayAnimals.js'
import { stats, creatureName, creatureIconURL, tierColor, powerOf, powerName, powerInfo } from './Creatures.js'
import { MONSTER_KINDS } from './ZombieKinds.js'
import { SKELETON_KINDS } from './SkeletonModels.js'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

export const ROUND_S = 120
const ARENA = 11 // half the arena's width, in blocks
const START_Z = 6
const SPREAD = 3
// Up to this many side by side; a bigger team stands in a second row behind.
const ROW = 5
const ROW_GAP = 2.2
const CRIT_CHANCE = 0.1
const CRIT_MULT = 1.5
const KNOCK = 0.7
const FALL_S = 0.6
const GAP = 0.9 // fighters push apart when closer than this
const CAM = { up: 11, back: 10 }
const MINE = 0x4aa3ff
const FOE = 0xff4d4d
const START_S = 2.2 // "3, 2, 1" before anyone moves
// Powers (Creatures.powerOf).
const HORDE_EACH = 0.06 // Horde: +6% attack per other plain zombie on the team
const BONE_REACH = 3.4 // Bone Throw: hits from this far...
const BONE_SPEED = 9 // ...with a bone flying this fast
const RAGE_MULT = 1.5 // Rage: under half health
const STOMP_EVERY = 3 // Stomp: every 3rd hit...
const STOMP_REACH = 2.5 // ...also hits everyone this close to the target...
const STOMP_MULT = 0.5 // ...this hard
const ROAR_MULT = 0.85 // Roar: the other team's attack at the start
const HIDE_CUT = 0.2 // Thick Hide: takes this much less
const HEAL_EVERY = 5 // Heal Friends: seconds between heals...
const HEAL_SHARE = 0.12 // ...each this share of the friend's health

// Escaped text for innerHTML (names come from other players' saves).
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

let _animalHelper = null
function animalModel(kind) {
  // PlayAnimals' own models, built with a block as 1 unit and no world.
  if (!_animalHelper) _animalHelper = new PlayAnimals({ B: 1, bm: null })
  const built = _animalHelper._build(kind)
  built.tag.visible = false
  return built
}

// A blocky zombie, 2 blocks tall (a skeleton in bone, a monster kind
// stretched to its shape). Its own materials, so a hit can light it up.
function zombieModel(c) {
  const skel = !!SKELETON_KINDS[c.k]
  const mon = MONSTER_KINDS[c.k]
  const skin = skel ? 0xe8e0c8 : mon ? 0x7a9a4a : 0x5f9a52
  const shirts = [0x3a5fa8, 0x8a3a3a, 0x4a6a3a, 0x6a4a8a, 0x8a6a2a]
  const shirt = skel ? 0xd8d0b8 : shirts[(c.n || 0) % shirts.length]
  const pants = skel ? 0xc8c0a8 : 0x2e3a5a
  const mats = [skin, shirt, pants].map((color) => new THREE.MeshLambertMaterial({ color }))
  const [skinM, shirtM, pantsM] = mats
  const group = new THREE.Group()
  const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
  const legs = []
  for (const side of [-1, 1]) {
    const hip = new THREE.Group()
    hip.position.set(side * 0.13, 0.75, 0)
    const leg = box(0.25, 0.75, 0.25, pantsM)
    leg.position.y = -0.375
    hip.add(leg)
    group.add(hip)
    legs.push(hip)
  }
  const body = box(0.5, 0.75, 0.28, shirtM)
  body.position.y = 1.125
  group.add(body)
  const arms = []
  for (const side of [-1, 1]) {
    const sh = new THREE.Group()
    sh.position.set(side * 0.36, 1.45, 0)
    const arm = box(0.22, 0.7, 0.22, skinM)
    arm.position.y = -0.3
    sh.add(arm)
    sh.rotation.x = -Math.PI / 2 + 0.15
    group.add(sh)
    arms.push(sh)
  }
  const head = new THREE.Group()
  head.position.y = 1.74
  head.add(box(0.48, 0.48, 0.48, skinM))
  const eyeM = new THREE.MeshBasicMaterial({ color: c.b ? 0xff2a1a : 0x111111 })
  mats.push(eyeM)
  for (const side of [-1, 1]) {
    const eye = box(0.09, 0.07, 0.01, eyeM)
    eye.position.set(side * 0.11, 0.04, 0.245)
    head.add(eye)
  }
  group.add(head)
  if (mon) group.scale.set(mon.wide || 1, Math.max(0.6, mon.tall || 1), mon.wide || 1)
  if (c.b) group.scale.multiplyScalar(1.25)
  return { group, head, legs, arms, mats }
}

// The fenced grass square.
function buildArena(scene) {
  const tex = (() => {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 16
    const g = cv.getContext('2d')
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const v = ((x * 7 + y * 13) % 5) / 5
        g.fillStyle = `rgb(${Math.round(84 + v * 22)},${Math.round(150 + v * 26)},${Math.round(62 + v * 14)})`
        g.fillRect(x, y, 1, 1)
      }
    }
    const tx = new THREE.CanvasTexture(cv)
    tx.magFilter = THREE.NearestFilter
    tx.minFilter = THREE.NearestFilter
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping
    tx.repeat.set(ARENA * 2, ARENA * 2)
    tx.colorSpace = THREE.SRGBColorSpace
    return tx
  })()
  const floor = new THREE.Mesh(new THREE.BoxGeometry(ARENA * 2, 1, ARENA * 2), new THREE.MeshLambertMaterial({ map: tex }))
  floor.position.y = -0.5
  scene.add(floor)
  const dirt = new THREE.Mesh(new THREE.BoxGeometry(ARENA * 2 + 6, 1, ARENA * 2 + 6), new THREE.MeshLambertMaterial({ color: 0x6a5238 }))
  dirt.position.y = -0.52
  scene.add(dirt)
  // Fence posts and rails all round (one mesh each).
  const n = ARENA * 2 + 1
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 1.1, 0.22), new THREE.MeshLambertMaterial({ color: 0x8a6438 }), n * 4)
  const m = new THREE.Matrix4()
  let i = 0
  for (let k = 0; k < n; k++) {
    const p = -ARENA + k
    for (const [x, z] of [[p, -ARENA], [p, ARENA], [-ARENA, p], [ARENA, p]]) {
      m.makeTranslation(x, 0.55, z)
      posts.setMatrixAt(i++, m)
    }
  }
  scene.add(posts)
  const railMat = new THREE.MeshLambertMaterial({ color: 0xa07a48 })
  for (const y of [0.45, 0.9]) {
    for (const [x, z, w, d] of [[0, -ARENA, ARENA * 2, 0.12], [0, ARENA, ARENA * 2, 0.12], [-ARENA, 0, 0.12, ARENA * 2], [ARENA, 0, 0.12, ARENA * 2]]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), railMat)
      rail.position.set(x, y, z)
      scene.add(rail)
    }
  }
}

export class TeamBattle {
  // mine, theirs: creatures (Creatures.js). foe: who the other team is.
  // onEnd(won | null): null when left before the end. view: '3d' | '2d';
  // onView(view) when the battle's own button changes it.
  constructor({ mine, theirs, foe, ghost, onEnd, onAgain, view = '3d', onView }) {
    this.mine = mine
    this.theirs = theirs
    this.foe = foe
    this.ghost = ghost
    this.onEnd = onEnd
    this.onAgain = onAgain
    this.view = view === '2d' ? '2d' : '3d'
    this.onView = onView
    this.speed = 1
    this.over = false
    this.time = 0
    this.shots = []
  }

  open() {
    const root = document.createElement('div')
    root.id = 'team-battle'
    root.innerHTML = `
      <canvas class="tb-canvas tb-canvas-3d"></canvas>
      <canvas class="tb-canvas tb-canvas-2d"></canvas>
      <div class="tb-labels"></div>
      <div class="tb-top">
        <div class="tb-side tb-mine"></div>
        <div class="tb-vs"><span class="tb-vs-word">${esc(t('teamBattleVs'))}</span><span class="tb-foe-name">${esc(this.foe)}</span><span class="tb-clock"></span></div>
        <div class="tb-side tb-foe"></div>
      </div>
      <div class="tb-msg" aria-live="polite"></div>
      <p class="tb-hint">${esc(t('teamBattleAutoHint'))}</p>
      <div class="tb-buttons">
        <button type="button" class="tb-btn tb-view"></button>
        <button type="button" class="tb-btn tb-speed"></button>
        <button type="button" class="tb-btn tb-leave">${esc(t('teamBattleLeave'))}</button>
      </div>
      <div class="tb-result" style="display: none">
        <div class="panel-box tb-result-box">
          <h2 class="tb-result-title"></h2>
          <p class="tb-result-text"></p>
          <div class="tb-result-btns">
            <button type="button" class="tb-again"></button>
            <button type="button" class="tb-back"></button>
          </div>
        </div>
      </div>`
    document.body.appendChild(root)
    this.root = root

    this.fighters = [
      ...this.mine.map((c, i) => this._fighter(c, 'mine', i, this.mine.length)),
      ...this.theirs.map((c, i) => this._fighter(c, 'foe', i, this.theirs.length)),
    ]
    // Horde: a little stronger for every other plain zombie on its team.
    for (const f of this.fighters) {
      if (f.power !== 'horde') continue
      const others = this.fighters.filter((o) => o !== f && o.side === f.side && o.power === 'horde').length
      f.atkMul *= 1 + HORDE_EACH * others
    }
    this._renderCards()

    this._resize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      this.w = w
      this.h = h
      if (this.renderer) {
        this.renderer.setSize(w, h, false)
        this.camera.aspect = w / h
        this.camera.updateProjectionMatrix()
      }
      const c2 = root.querySelector('.tb-canvas-2d')
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      c2.width = Math.round(w * ratio)
      c2.height = Math.round(h * ratio)
      this._ratio = ratio
    }
    this._bindInput()
    this._setView(this.view, false)
    this._resize()
    window.addEventListener('resize', this._resize)
    this._placeCamera(1)
    this._say(t('teamBattleReady'), START_S)
    this._last = performance.now()
    const loop = () => {
      if (!this.root) return
      this._raf = requestAnimationFrame(loop)
      const now = performance.now()
      const dt = Math.min(0.05, (now - this._last) / 1000)
      this._last = now
      for (let i = 0; i < this.speed; i++) this._step(dt)
      this._draw()
      this._placeLabels()
    }
    loop()
  }

  _fighter(c, side, i, n) {
    const s = stats(c)
    const row = Math.floor(i / ROW)
    const inRow = Math.min(ROW, n - row * ROW)
    const x = ((i % ROW) - (inRow - 1) / 2) * SPREAD
    const back = START_Z + row * ROW_GAP
    const z = side === 'mine' ? back : -back
    const heading = side === 'mine' ? Math.PI : 0
    const label = document.createElement('div')
    label.className = `tb-label ${side}`
    label.innerHTML = `<span class="tb-label-name" style="color: ${tierColor(c.r)}">${esc(creatureName(c))}</span><span class="tb-label-bar"><span></span></span>`
    this.root.querySelector('.tb-labels').appendChild(label)
    const power = powerOf(c)
    const icon = new Image()
    icon.src = creatureIconURL(c)
    return {
      c, s, side, x, z, heading, vx: 0, vz: 0, hp: s.hp, cd: 0.5 + Math.random() * 0.4, walk: 0, hop: 0, fall: 0, flash: 0,
      alive: true, label, icon, power, atkMul: 1, hits: 0, raged: false, pounced: false, healCd: HEAL_EVERY,
      reach: power === 'bones' ? BONE_REACH : s.reach,
      // The 3D model, ring and height are made by _build3d() when first needed.
      group: null, height: 2,
    }
  }

  // --- 3D: built the first time the battle is shown in 3D ---

  _build3d() {
    if (this.renderer) return
    const canvas = this.root.querySelector('.tb-canvas-3d')
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x8cc8f0)
    this.scene.fog = new THREE.Fog(0x8cc8f0, 40, 80)
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 140)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x4a5a3a, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun.position.set(6, 14, 8)
    this.scene.add(sun)
    buildArena(this.scene)
    for (const f of this.fighters) {
      const built = f.c.t === 'a' ? animalModel(f.c.k) : zombieModel(f.c)
      Object.assign(f, built)
      f.group.position.set(f.x, 0, f.z)
      f.group.rotation.y = f.heading
      this.scene.add(f.group)
      // A ring on the ground in the team's colour.
      f.ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 24), new THREE.MeshBasicMaterial({ color: f.side === 'mine' ? MINE : FOE, side: THREE.DoubleSide }))
      f.ring.rotation.x = -Math.PI / 2
      f.ring.position.set(f.x, 0.02, f.z)
      f.ring.visible = f.alive
      this.scene.add(f.ring)
      const k = f.c.t === 'a' ? PlayAnimals.KINDS[f.c.k] : null
      f.height = k ? Math.max(k.leg + k.body[1], (k.headAt ? k.headAt[0] : k.leg + k.body[1]) + k.head[1] / 2) : 2 * f.group.scale.y
      if (!f.alive) f.group.rotation.z = Math.PI / 2
    }
    this._boneGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22)
    this._boneMat = new THREE.MeshLambertMaterial({ color: 0xf2ecdc })
    this._resize?.()
    this.camera.position.set(0, CAM.up, CAM.back)
  }

  _setView(view, remember = true) {
    this.view = view
    if (view === '3d') this._build3d()
    this.root.querySelector('.tb-canvas-3d').style.display = view === '3d' ? '' : 'none'
    this.root.querySelector('.tb-canvas-2d').style.display = view === '2d' ? '' : 'none'
    this.root.classList.toggle('flat', view === '2d')
    // The button names the view it switches to.
    this.root.querySelector('.tb-view').textContent = t(view === '3d' ? 'teamBattleTo2d' : 'teamBattleTo3d')
    this.root.querySelector('.tb-speed').textContent = t('teamBattleSpeed', { n: this.speed })
    if (remember) this.onView?.(view)
  }

  _bindInput() {
    this._onKey = (e) => {
      if (!this.root) return
      // The homepage's own shortcuts stay quiet while a battle is up.
      e.stopPropagation()
      if (e.type === 'keydown' && e.code === 'Escape') {
        if (this.over) this.close()
        else this._leave()
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', this._onKey, true)
    window.addEventListener('keyup', this._onKey, true)
    this.root.querySelector('.tb-leave').addEventListener('click', () => this._leave())
    this.root.querySelector('.tb-view').addEventListener('click', () => this._setView(this.view === '3d' ? '2d' : '3d'))
    this.root.querySelector('.tb-speed').addEventListener('click', () => {
      this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1
      this.root.querySelector('.tb-speed').textContent = t('teamBattleSpeed', { n: this.speed })
    })
    this.root.querySelector('.tb-again').addEventListener('click', () => {
      this.close()
      this.onAgain?.()
    })
    this.root.querySelector('.tb-back').addEventListener('click', () => this.close())
  }

  _say(text, seconds = 1.6) {
    const el = this.root?.querySelector('.tb-msg')
    if (!el) return
    el.textContent = text
    el.classList.add('show')
    clearTimeout(this._sayTimer)
    this._sayTimer = setTimeout(() => el.classList.remove('show'), seconds * 1000)
  }

  _enemiesOf(f) {
    return this.fighters.filter((o) => o.alive && o.side !== f.side)
  }

  _nearest(f, list) {
    let best = null
    let bestD = Infinity
    for (const o of list) {
      const d = Math.hypot(o.x - f.x, o.z - f.z)
      if (d < bestD) {
        bestD = d
        best = o
      }
    }
    return best ? { o: best, d: bestD } : null
  }

  // A swing (or, for Bone Throw, a bone that lands a moment later).
  _attack(f, to) {
    f.cd = f.s.rate * (0.9 + Math.random() * 0.25)
    f.hop = 0.18
    if (f.power === 'bones') {
      const d = Math.hypot(to.x - f.x, to.z - f.z)
      const shot = { from: f, to, x: f.x, z: f.z, sx: f.x, sz: f.z, t: 0, dur: Math.max(0.15, d / BONE_SPEED), mesh: null }
      this.shots.push(shot)
      return
    }
    this._hit(f, to)
  }

  _hit(from, to, mult = 1) {
    if (!to.alive) return
    from.hits++
    let m = mult * from.atkMul
    // Pounce: its first hit lands twice as hard.
    if (from.power === 'pounce' && !from.pounced) {
      from.pounced = true
      m *= 2
      this._powerText(from)
    }
    const crit = Math.random() < CRIT_CHANCE
    let dmg = from.s.atk * (0.85 + Math.random() * 0.3) * (crit ? CRIT_MULT : 1) * m
    // Thick Hide takes less.
    if (to.power === 'hide') dmg *= 1 - HIDE_CUT
    dmg = Math.max(1, Math.round(dmg))
    to.hp = Math.max(0, to.hp - dmg)
    const dx = to.x - from.x
    const dz = to.z - from.z
    const len = Math.hypot(dx, dz) || 1
    to.vx += (dx / len) * KNOCK * 6
    to.vz += (dz / len) * KNOCK * 6
    to.hop = 0.15
    to.flash = 0.12
    if (to.mats) for (const mat of to.mats) if (mat.emissive) mat.emissive.setHex(0x661111)
    this._number(to, dmg, crit ? 'crit' : '')
    audioEngine.playMelee?.()
    // Rage: under half health it hits half as hard again.
    if (to.alive && to.power === 'rage' && !to.raged && to.hp > 0 && to.hp < to.s.hp / 2) {
      to.raged = true
      to.atkMul *= RAGE_MULT
      this._powerText(to)
    }
    if (to.hp <= 0) this._down(to)
    // Stomp: every few hits shakes everyone near the one it hit.
    if (from.power === 'stomp' && mult === 1 && from.hits % STOMP_EVERY === 0) {
      this._powerText(from)
      for (const o of this._enemiesOf(from)) if (o !== to && Math.hypot(o.x - to.x, o.z - to.z) < STOMP_REACH) this._hit(from, o, STOMP_MULT)
    }
    this._renderCards()
  }

  _down(f) {
    f.alive = false
    f.fall = FALL_S
    if (f.ring) f.ring.visible = false
    f.label.style.display = 'none'
    audioEngine.playZombieDeath?.(0.8, 0)
    const mineLeft = this.fighters.some((o) => o.alive && o.side === 'mine')
    const foesLeft = this.fighters.some((o) => o.alive && o.side === 'foe')
    if (!mineLeft || !foesLeft) setTimeout(() => this._finish(mineLeft), 700)
  }

  // Where (x, y, z) in the arena is on screen, in % of the screen.
  _screen(x, y, z) {
    if (this.view === '3d' && this.camera) {
      const p = new THREE.Vector3(x, y, z).project(this.camera)
      return { left: ((p.x + 1) / 2) * 100, top: ((1 - p.y) / 2) * 100 }
    }
    const b = this._board()
    return { left: ((b.x + (x + ARENA) * b.cell) / this.w) * 100, top: ((b.y + (z + ARENA) * b.cell - y * b.cell * 0.5) / this.h) * 100 }
  }

  _float(f, text, cls) {
    const el = document.createElement('span')
    el.className = `tb-number ${cls}`
    el.textContent = text
    this.root.querySelector('.tb-labels').appendChild(el)
    const at = this._screen(f.x, f.height + 0.3, f.z)
    el.style.left = `${at.left}%`
    el.style.top = `${at.top}%`
    setTimeout(() => el.remove(), cls === 'power' ? 1100 : 800)
  }

  _number(f, n, cls) {
    this._float(f, String(n), cls)
  }

  _powerText(f) {
    this._float(f, `${powerName(f.c)}!`, 'power')
  }

  _step(dt) {
    if (!this.over) this.time += dt
    const started = this.time >= START_S
    if (started && !this.over && this.time - dt < START_S) {
      this._say(t('teamBattleFight'), 1)
      // Roar: when the fight starts, the other team's hits get weaker.
      for (const f of this.fighters) {
        if (f.power !== 'roar' || !f.alive) continue
        this._powerText(f)
        for (const o of this._enemiesOf(f)) o.atkMul *= ROAR_MULT
      }
    }
    const clock = this.root.querySelector('.tb-clock')
    if (clock) clock.textContent = started ? `${Math.max(0, Math.ceil(ROUND_S - (this.time - START_S)))}` : `${Math.ceil(START_S - this.time)}`
    if (started && !this.over && this.time - START_S >= ROUND_S) this._timeUp()
    for (const f of this.fighters) {
      if (f.flash > 0) {
        f.flash -= dt
        if (f.flash <= 0 && f.mats) for (const m of f.mats) if (m.emissive) m.emissive.setHex(0x000000)
      }
      if (!f.alive) {
        if (f.fall > 0) f.fall = Math.max(0, f.fall - dt)
        continue
      }
      f.cd = Math.max(0, f.cd - dt)
      let mx = 0
      let mz = 0
      if (started && !this.over) {
        // Heal Friends: every few seconds patches up the most hurt friend.
        if (f.power === 'heal') {
          f.healCd -= dt
          if (f.healCd <= 0) {
            f.healCd = HEAL_EVERY
            const hurt = this.fighters.filter((o) => o.alive && o.side === f.side && o.hp < o.s.hp).sort((a, b) => a.hp / a.s.hp - b.hp / b.s.hp)[0]
            if (hurt) {
              const add = Math.max(1, Math.round(hurt.s.hp * HEAL_SHARE))
              hurt.hp = Math.min(hurt.s.hp, hurt.hp + add)
              this._number(hurt, `+${add}`, 'heal')
              this._renderCards()
            }
          }
        }
        const n = this._nearest(f, this._enemiesOf(f))
        if (n) {
          const dx = n.o.x - f.x
          const dz = n.o.z - f.z
          f.heading = Math.atan2(dx, dz)
          if (n.d > f.reach) {
            mx = dx / n.d
            mz = dz / n.d
          } else if (f.cd <= 0) this._attack(f, n.o)
        }
      }
      if (mx || mz) f.walk += dt * f.s.speed * 3
      f.x += (mx * f.s.speed + f.vx) * dt
      f.z += (mz * f.s.speed + f.vz) * dt
      f.vx *= Math.max(0, 1 - dt * 6)
      f.vz *= Math.max(0, 1 - dt * 6)
    }
    // Bones in the air.
    for (const s of this.shots) {
      s.t += dt
      const k = Math.min(1, s.t / s.dur)
      s.x = s.sx + (s.to.x - s.sx) * k
      s.z = s.sz + (s.to.z - s.sz) * k
      s.y = 1.2 + Math.sin(k * Math.PI) * 0.8
      if (k >= 1) {
        s.done = true
        if (!this.over) this._hit(s.from, s.to)
      }
    }
    for (const s of this.shots) if (s.done && s.mesh) s.mesh.removeFromParent()
    this.shots = this.shots.filter((s) => !s.done)
    // Nobody stands inside anybody else, or outside the fence.
    const alive = this.fighters.filter((f) => f.alive)
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i]
        const b = alive[j]
        const dx = b.x - a.x
        const dz = b.z - a.z
        const d = Math.hypot(dx, dz)
        if (d > 0 && d < GAP) {
          const push = (GAP - d) / 2
          a.x -= (dx / d) * push
          a.z -= (dz / d) * push
          b.x += (dx / d) * push
          b.z += (dz / d) * push
        }
      }
    }
    for (const f of this.fighters) {
      f.x = Math.max(-ARENA + 0.8, Math.min(ARENA - 0.8, f.x))
      f.z = Math.max(-ARENA + 0.8, Math.min(ARENA - 0.8, f.z))
      f.hop = Math.max(0, f.hop - dt)
    }
    this._placeCamera(dt)
  }

  _draw() {
    if (this.view === '2d') this._draw2d()
    else this._draw3d()
  }

  _draw3d() {
    for (const f of this.fighters) {
      f.group.position.set(f.x, f.hop > 0 ? Math.sin((f.hop / 0.18) * Math.PI) * 0.25 : 0, f.z)
      if (f.alive) {
        // Turn smoothly toward where it's heading.
        let d = f.heading - f.group.rotation.y
        d = Math.atan2(Math.sin(d), Math.cos(d))
        f.group.rotation.y += d * 0.2
        const swing = Math.sin(f.walk) * 0.6
        f.legs.forEach((leg, i) => { leg.rotation.x = i % 2 ? swing : -swing })
      } else f.group.rotation.z = (1 - f.fall / FALL_S) * (Math.PI / 2)
      f.ring.position.set(f.x, 0.02, f.z)
    }
    for (const s of this.shots) {
      if (!s.mesh) {
        s.mesh = new THREE.Mesh(this._boneGeo, this._boneMat)
        this.scene.add(s.mesh)
      }
      s.mesh.position.set(s.x, s.y, s.z)
      s.mesh.rotation.x += 0.3
    }
    this.renderer.render(this.scene, this.camera)
  }

  // The 2D board: the arena seen from straight above, fitted to the screen
  // under the team bar.
  _board() {
    const top = this.w < 600 ? 150 : 110
    const size = Math.max(120, Math.min(this.w - 24, this.h - top - 50))
    const cell = size / (ARENA * 2)
    return { x: (this.w - size) / 2, y: top + (this.h - top - 50 - size) / 2, size, cell }
  }

  _draw2d() {
    const cv = this.root.querySelector('.tb-canvas-2d')
    const g = cv.getContext('2d')
    const r = this._ratio || 1
    g.setTransform(r, 0, 0, r, 0, 0)
    g.imageSmoothingEnabled = false
    g.fillStyle = '#6a5238'
    g.fillRect(0, 0, this.w, this.h)
    const b = this._board()
    // Grass in two greens, like blocks seen from above.
    for (let i = 0; i < ARENA * 2; i++) {
      for (let j = 0; j < ARENA * 2; j++) {
        g.fillStyle = (i + j) % 2 ? '#5f9a46' : '#68a64e'
        g.fillRect(b.x + i * b.cell, b.y + j * b.cell, Math.ceil(b.cell), Math.ceil(b.cell))
      }
    }
    g.strokeStyle = '#a07a48'
    g.lineWidth = Math.max(3, b.cell * 0.25)
    g.strokeRect(b.x, b.y, b.size, b.size)
    const px = (x) => b.x + (x + ARENA) * b.cell
    // Fallen ones first, so the standing ones are drawn on top.
    const order = [...this.fighters].sort((a, c) => (a.alive - c.alive) || a.z - c.z)
    for (const f of order) {
      const cx = px(f.x)
      const cy = px(f.z)
      const lift = f.hop > 0 ? Math.sin((f.hop / 0.18) * Math.PI) * 0.35 : 0
      const sz = b.cell * (1.7 + lift) * (f.c.b ? 1.25 : 1)
      g.save()
      if (!f.alive) {
        g.globalAlpha = 0.25 + 0.75 * (f.fall / FALL_S)
        g.translate(cx, cy)
        g.rotate((1 - f.fall / FALL_S) * (Math.PI / 2))
        g.translate(-cx, -cy)
      } else {
        // The team's ring under it.
        g.strokeStyle = f.side === 'mine' ? '#4aa3ff' : '#ff4d4d'
        g.lineWidth = Math.max(2, b.cell * 0.14)
        g.beginPath()
        g.arc(cx, cy, sz * 0.55, 0, Math.PI * 2)
        g.stroke()
      }
      // Facing: the picture flips to look toward its target.
      const flip = Math.sin(f.heading) < -0.1 ? -1 : 1
      g.translate(cx, cy)
      g.scale(flip, 1)
      if (f.icon.complete && f.icon.naturalWidth) g.drawImage(f.icon, -sz / 2, -sz / 2, sz, sz)
      if (f.flash > 0) {
        g.globalAlpha = 0.5
        g.fillStyle = '#ff2a1a'
        g.fillRect(-sz / 2, -sz / 2, sz, sz)
      }
      g.restore()
    }
    g.fillStyle = '#f2ecdc'
    for (const s of this.shots) {
      const d = b.cell * 0.4
      g.fillRect(px(s.x) - d / 2, px(s.z) - d / 2 - s.y * b.cell * 0.5, d, d)
    }
  }

  // 3D: a view over the whole arena that drifts toward where the fight is.
  _placeCamera(dt) {
    if (!this.camera) return
    const alive = this.fighters.filter((f) => f.alive)
    const at = new THREE.Vector3()
    for (const f of alive) at.add(new THREE.Vector3(f.x, 0, f.z))
    if (alive.length) at.multiplyScalar(0.4 / alive.length)
    // Narrow (phone) screens step back so the arena still fits across.
    const far = Math.min(2.2, Math.max(1, 1.2 / (this.camera.aspect || 1)))
    const want = new THREE.Vector3(at.x, CAM.up * far, at.z + CAM.back * far)
    this.camera.position.lerp(want, Math.min(1, dt * 3))
    this.camera.lookAt(at.x, 0, at.z)
  }

  _placeLabels() {
    for (const f of this.fighters) {
      if (!f.alive) continue
      const at = this._screen(f.x, this.view === '3d' ? f.height * (f.group?.scale.y || 1) + 0.35 : 1.9, f.z)
      f.label.style.left = `${at.left}%`
      f.label.style.top = `${at.top}%`
      f.label.querySelector('.tb-label-bar span').style.width = `${(f.hp / f.s.hp) * 100}%`
    }
  }

  _renderCards() {
    for (const side of ['mine', 'foe']) {
      const el = this.root?.querySelector(side === 'mine' ? '.tb-mine' : '.tb-foe')
      if (!el) continue
      el.innerHTML = this.fighters.filter((f) => f.side === side).map((f) => `
        <div class="tb-card${f.alive ? '' : ' down'}" style="border-color: ${tierColor(f.c.r)}" title="${esc(`${powerName(f.c)}: ${powerInfo(f.c)}`)}">
          <img src="${creatureIconURL(f.c)}" alt="" draggable="false" />
          <span class="tb-card-bar"><span style="width: ${(f.hp / f.s.hp) * 100}%"></span></span>
        </div>`).join('')
    }
  }

  _timeUp() {
    const share = (side) => {
      const list = this.fighters.filter((f) => f.side === side)
      return list.reduce((sum, f) => sum + f.hp / f.s.hp, 0) / (list.length || 1)
    }
    this._finish(share('mine') >= share('foe'))
  }

  _finish(won) {
    if (this.over || !this.root) return
    this.over = true
    const reward = this.onEnd?.(won) || 0
    const box = this.root.querySelector('.tb-result')
    box.querySelector('.tb-result-title').textContent = t(won ? 'teamBattleWon' : 'teamBattleLost')
    box.querySelector('.tb-result-text').textContent = t('teamBattleReward', { n: reward })
    box.querySelector('.tb-again').textContent = t('teamBattleAgain')
    box.querySelector('.tb-back').textContent = t('teamBattleBack')
    box.style.display = 'flex'
    if (won) audioEngine.playLevelUp?.()
  }

  // Left before the end: no win, no loss.
  _leave() {
    if (!this.over) this.onEnd?.(null)
    this.over = true
    this.close()
  }

  close() {
    if (!this.root) return
    cancelAnimationFrame(this._raf)
    clearTimeout(this._sayTimer)
    window.removeEventListener('resize', this._resize)
    window.removeEventListener('keydown', this._onKey, true)
    window.removeEventListener('keyup', this._onKey, true)
    if (this.renderer) {
      // Zombie bodies are this battle's own; animal ones are shared, kept.
      this.scene.traverse((o) => {
        if (o.isMesh && !this.fighters.some((f) => f.c.t === 'a' && f.group && o.parent && isInside(o, f.group))) {
          o.geometry?.dispose?.()
        }
      })
      this.renderer.dispose()
      this.renderer.forceContextLoss?.()
    }
    this.root.remove()
    this.root = null
  }
}

function isInside(o, group) {
  for (let p = o; p; p = p.parent) if (p === group) return true
  return false
}
