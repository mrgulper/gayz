// Team battles (2026-10-31, Gaymi picked "you control one creature"): your
// team (Creatures.js) against another player's saved "ghost team" - or a
// made-up one when none can be found - in a small fenced arena. You steer
// your first creature (move keys or the stick on phones, click / Space /
// the Attack button to hit); the others fight by themselves, going for the
// nearest enemy. When yours falls you take over the next one. Last team
// standing wins; after ROUND_S the one with more health left wins.
//
// A screen of its own over the homepage (#team-battle) with its own small
// renderer, made when a battle starts and thrown away when it ends - the
// homepage keeps running underneath. Opened from Inventory's Pets tab (TeamUI.js).
import * as THREE from 'three'
import { PlayAnimals } from './PlayAnimals.js'
import { stats, creatureName, creatureIconURL, tierColor } from './Creatures.js'
import { MONSTER_KINDS } from './ZombieKinds.js'
import { SKELETON_KINDS } from './SkeletonModels.js'
import { getKeyFor } from './Keybinds.js'
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
const CAM = { up: 7.5, back: 8.5 }
const MINE = 0x4aa3ff
const FOE = 0xff4d4d
const START_S = 2.2 // "3, 2, 1" before anyone moves

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
  // onEnd(won | null): null when left before the end.
  constructor({ mine, theirs, foe, ghost, onEnd, onAgain }) {
    this.mine = mine
    this.theirs = theirs
    this.foe = foe
    this.ghost = ghost
    this.onEnd = onEnd
    this.onAgain = onAgain
    this.keys = new Set()
    this.stick = { x: 0, y: 0 }
    this.attackHeld = false
    this.over = false
    this.time = 0
  }

  open() {
    const root = document.createElement('div')
    root.id = 'team-battle'
    root.innerHTML = `
      <canvas class="tb-canvas"></canvas>
      <div class="tb-labels"></div>
      <div class="tb-top">
        <div class="tb-side tb-mine"></div>
        <div class="tb-vs"><span class="tb-vs-word">${esc(t('teamBattleVs'))}</span><span class="tb-foe-name">${esc(this.foe)}</span><span class="tb-clock"></span></div>
        <div class="tb-side tb-foe"></div>
      </div>
      <div class="tb-msg" aria-live="polite"></div>
      <p class="tb-hint"></p>
      <button type="button" class="tb-leave">${esc(t('teamBattleLeave'))}</button>
      <div class="tb-touch">
        <div class="tb-stick"><div class="tb-knob"></div></div>
        <button type="button" class="tb-attack">${esc(t('teamBattleAttack'))}</button>
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
    const key = (id) => (getKeyFor(id) || '').replace(/^Key/, '')
    root.querySelector('.tb-hint').textContent = t('teamBattleHint', { keys: `${key('moveForward')}${key('moveLeft')}${key('moveBack')}${key('moveRight')}` })

    const canvas = root.querySelector('.tb-canvas')
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x8cc8f0)
    this.scene.fog = new THREE.Fog(0x8cc8f0, 30, 60)
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 120)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x4a5a3a, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun.position.set(6, 14, 8)
    this.scene.add(sun)
    buildArena(this.scene)

    this.fighters = [
      ...this.mine.map((c, i) => this._fighter(c, 'mine', i, this.mine.length)),
      ...this.theirs.map((c, i) => this._fighter(c, 'foe', i, this.theirs.length)),
    ]
    this.me = this.fighters.find((f) => f.side === 'mine') || null
    if (this.me) this.me.controlled = true
    this._renderCards()

    this._resize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      this.renderer.setSize(w, h, false)
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
    }
    this._resize()
    window.addEventListener('resize', this._resize)
    this._bindInput()
    this._placeCamera(1)
    this._say(t('teamBattleReady'), START_S)
    this._last = performance.now()
    const loop = () => {
      if (!this.root) return
      this._raf = requestAnimationFrame(loop)
      const now = performance.now()
      const dt = Math.min(0.05, (now - this._last) / 1000)
      this._last = now
      this._step(dt)
      this.renderer.render(this.scene, this.camera)
      this._placeLabels()
    }
    loop()
  }

  _fighter(c, side, i, n) {
    const s = stats(c)
    const built = c.t === 'a' ? animalModel(c.k) : zombieModel(c)
    const row = Math.floor(i / ROW)
    const inRow = Math.min(ROW, n - row * ROW)
    const x = ((i % ROW) - (inRow - 1) / 2) * SPREAD
    const back = START_Z + row * ROW_GAP
    const z = side === 'mine' ? back : -back
    const heading = side === 'mine' ? Math.PI : 0
    built.group.position.set(x, 0, z)
    built.group.rotation.y = heading
    this.scene.add(built.group)
    // A ring on the ground in the team's colour.
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 24), new THREE.MeshBasicMaterial({ color: side === 'mine' ? MINE : FOE, side: THREE.DoubleSide }))
    ring.rotation.x = -Math.PI / 2
    ring.position.set(x, 0.02, z)
    this.scene.add(ring)
    const label = document.createElement('div')
    label.className = `tb-label ${side}`
    label.innerHTML = `<span class="tb-label-name" style="color: ${tierColor(c.r)}">${esc(creatureName(c))}</span><span class="tb-label-bar"><span></span></span>`
    this.root.querySelector('.tb-labels').appendChild(label)
    const k = c.t === 'a' ? PlayAnimals.KINDS[c.k] : null
    const height = k ? Math.max(k.leg + k.body[1], (k.headAt ? k.headAt[0] : k.leg + k.body[1]) + k.head[1] / 2) : 2 * built.group.scale.y
    return {
      c, s, side, x, z, heading, vx: 0, vz: 0, hp: s.hp, cd: 0.5 + Math.random() * 0.4, walk: 0, hop: 0, fall: 0,
      alive: true, controlled: false, ring, label, height, ...built,
    }
  }

  _bindInput() {
    const isKey = (e, id, extra) => e.code === getKeyFor(id) || e.code === extra
    this._dirOf = (e) => (isKey(e, 'moveForward', 'ArrowUp') ? 'f' : isKey(e, 'moveBack', 'ArrowDown') ? 'b' : isKey(e, 'moveLeft', 'ArrowLeft') ? 'l' : isKey(e, 'moveRight', 'ArrowRight') ? 'r' : null)
    this._onKey = (e) => {
      if (!this.root) return
      // The homepage's own shortcuts stay quiet while a battle is up.
      e.stopPropagation()
      if (e.type === 'keydown' && e.code === 'Escape') {
        if (this.over) this.close()
        else this._leave()
        e.preventDefault()
        return
      }
      const d = this._dirOf(e)
      if (d) {
        if (e.type === 'keydown') this.keys.add(d)
        else this.keys.delete(d)
        e.preventDefault()
      }
      if (e.code === 'Space' || e.code === 'KeyJ' || e.code === 'Enter') {
        if (e.type === 'keydown' && !e.repeat) this._attack()
        this.attackHeld = e.type === 'keydown'
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', this._onKey, true)
    window.addEventListener('keyup', this._onKey, true)
    this._onBlur = () => {
      this.keys.clear()
      this.attackHeld = false
    }
    window.addEventListener('blur', this._onBlur)
    const canvas = this.root.querySelector('.tb-canvas')
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') this._attack()
    })
    this.root.querySelector('.tb-leave').addEventListener('click', () => this._leave())
    const attackBtn = this.root.querySelector('.tb-attack')
    attackBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      this._attack()
      this.attackHeld = true
    })
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) attackBtn.addEventListener(ev, () => { this.attackHeld = false })
    // The stick: drag inside it to walk that way.
    const stick = this.root.querySelector('.tb-stick')
    const knob = this.root.querySelector('.tb-knob')
    let id = null
    const move = (e) => {
      const r = stick.getBoundingClientRect()
      const half = r.width / 2
      let x = (e.clientX - r.left - half) / half
      let y = (e.clientY - r.top - half) / half
      const len = Math.hypot(x, y)
      if (len > 1) {
        x /= len
        y /= len
      }
      this.stick.x = x
      this.stick.y = y
      knob.style.transform = `translate(${x * half * 0.6}px, ${y * half * 0.6}px)`
    }
    stick.addEventListener('pointerdown', (e) => {
      id = e.pointerId
      stick.setPointerCapture(id)
      move(e)
    })
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e) })
    const up = (e) => {
      if (e.pointerId !== id) return
      id = null
      this.stick.x = this.stick.y = 0
      knob.style.transform = ''
    }
    stick.addEventListener('pointerup', up)
    stick.addEventListener('pointercancel', up)
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

  // My creature's hit: the nearest enemy in reach (a swing at the air otherwise).
  _attack() {
    const f = this.me
    if (!f || !f.alive || this.over || this.time < START_S || f.cd > 0) return
    f.cd = f.s.rate
    f.hop = 0.18
    const n = this._nearest(f, this._enemiesOf(f))
    if (n && n.d <= f.s.reach + 0.8) {
      f.heading = Math.atan2(n.o.x - f.x, n.o.z - f.z)
      this._hit(f, n.o)
    } else audioEngine.playMelee?.()
  }

  _hit(from, to) {
    const crit = Math.random() < CRIT_CHANCE
    const dmg = Math.max(1, Math.round(from.s.atk * (0.85 + Math.random() * 0.3) * (crit ? CRIT_MULT : 1)))
    to.hp = Math.max(0, to.hp - dmg)
    const dx = to.x - from.x
    const dz = to.z - from.z
    const len = Math.hypot(dx, dz) || 1
    to.vx += (dx / len) * KNOCK * 6
    to.vz += (dz / len) * KNOCK * 6
    to.hop = 0.15
    if (to.mats) {
      for (const m of to.mats) if (m.emissive) m.emissive.setHex(0x661111)
      to.flash = 0.12
    }
    this._number(to, dmg, crit)
    audioEngine.playMelee?.()
    if (to.hp <= 0) this._down(to)
    this._renderCards()
  }

  _down(f) {
    f.alive = false
    f.fall = FALL_S
    f.ring.visible = false
    f.label.style.display = 'none'
    audioEngine.playZombieDeath?.(0.8, 0)
    if (f === this.me) {
      const next = this.fighters.find((o) => o.alive && o.side === 'mine')
      f.controlled = false
      this.me = next || f
      if (next) {
        next.controlled = true
        this._say(t('teamBattleNowYou', { name: creatureName(next.c) }))
      }
    }
    const mineLeft = this.fighters.some((o) => o.alive && o.side === 'mine')
    const foesLeft = this.fighters.some((o) => o.alive && o.side === 'foe')
    if (!mineLeft || !foesLeft) setTimeout(() => this._finish(mineLeft), 700)
  }

  _number(f, n, crit) {
    const el = document.createElement('span')
    el.className = `tb-number${crit ? ' crit' : ''}`
    el.textContent = String(n)
    this.root.querySelector('.tb-labels').appendChild(el)
    const p = new THREE.Vector3(f.x, f.height + 0.3, f.z).project(this.camera)
    el.style.left = `${((p.x + 1) / 2) * 100}%`
    el.style.top = `${((1 - p.y) / 2) * 100}%`
    setTimeout(() => el.remove(), 800)
  }

  _step(dt) {
    if (!this.over) this.time += dt
    const started = this.time >= START_S
    if (started && !this.over && this.time - dt < START_S) this._say(t('teamBattleFight'), 1)
    const clock = this.root.querySelector('.tb-clock')
    if (clock) clock.textContent = started ? `${Math.max(0, Math.ceil(ROUND_S - (this.time - START_S)))}` : `${Math.ceil(START_S - this.time)}`
    if (started && !this.over && this.time - START_S >= ROUND_S) this._timeUp()
    for (const f of this.fighters) {
      if (f.flash > 0) {
        f.flash -= dt
        if (f.flash <= 0) for (const m of f.mats) if (m.emissive) m.emissive.setHex(0x000000)
      }
      if (!f.alive) {
        if (f.fall > 0) {
          f.fall = Math.max(0, f.fall - dt)
          f.group.rotation.z = (1 - f.fall / FALL_S) * (Math.PI / 2)
        }
        continue
      }
      f.cd = Math.max(0, f.cd - dt)
      let mx = 0
      let mz = 0
      if (started && !this.over) {
        if (f.controlled) {
          mx = (this.keys.has('r') ? 1 : 0) - (this.keys.has('l') ? 1 : 0) + this.stick.x
          mz = (this.keys.has('b') ? 1 : 0) - (this.keys.has('f') ? 1 : 0) + this.stick.y
          if (this.attackHeld && f.cd <= 0) this._attack()
        } else {
          const n = this._nearest(f, this._enemiesOf(f))
          if (n) {
            const dx = n.o.x - f.x
            const dz = n.o.z - f.z
            f.heading = Math.atan2(dx, dz)
            if (n.d > f.s.reach) {
              mx = dx / n.d
              mz = dz / n.d
            } else if (f.cd <= 0) {
              f.cd = f.s.rate * (0.9 + Math.random() * 0.25)
              f.hop = 0.18
              this._hit(f, n.o)
            }
          }
        }
      }
      const len = Math.hypot(mx, mz)
      if (len > 1) {
        mx /= len
        mz /= len
      }
      if (len > 0.05) {
        if (f.controlled) f.heading = Math.atan2(mx, mz)
        f.walk += dt * f.s.speed * 3
      }
      f.x += (mx * f.s.speed + f.vx) * dt
      f.z += (mz * f.s.speed + f.vz) * dt
      f.vx *= Math.max(0, 1 - dt * 6)
      f.vz *= Math.max(0, 1 - dt * 6)
    }
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
      f.group.position.set(f.x, f.hop > 0 ? Math.sin((f.hop / 0.18) * Math.PI) * 0.25 : 0, f.z)
      if (f.alive) {
        // Turn smoothly toward where it's heading.
        let d = f.heading - f.group.rotation.y
        d = Math.atan2(Math.sin(d), Math.cos(d))
        f.group.rotation.y += d * Math.min(1, dt * 12)
        const swing = Math.sin(f.walk) * 0.6
        f.legs.forEach((leg, i) => { leg.rotation.x = i % 2 ? swing : -swing })
      }
      f.ring.position.set(f.x, 0.02, f.z)
      f.ring.scale.setScalar(f.controlled ? 1.25 : 1)
    }
    this._placeCamera(dt)
  }

  _placeCamera(dt) {
    const f = this.me
    const at = f ? new THREE.Vector3(f.x * 0.6, 0, f.z * 0.6 + 1) : new THREE.Vector3()
    const want = new THREE.Vector3(at.x, CAM.up, at.z + CAM.back)
    this.camera.position.lerp(want, Math.min(1, dt * 4))
    this.camera.lookAt(at.x, 0.6, at.z - 1.5)
  }

  _placeLabels() {
    const v = new THREE.Vector3()
    for (const f of this.fighters) {
      if (!f.alive) continue
      v.set(f.x, f.height * (f.group.scale.y || 1) + 0.35, f.z).project(this.camera)
      f.label.style.left = `${((v.x + 1) / 2) * 100}%`
      f.label.style.top = `${((1 - v.y) / 2) * 100}%`
      f.label.classList.toggle('me', f.controlled)
      f.label.querySelector('.tb-label-bar span').style.width = `${(f.hp / f.s.hp) * 100}%`
    }
  }

  _renderCards() {
    for (const side of ['mine', 'foe']) {
      const el = this.root?.querySelector(side === 'mine' ? '.tb-mine' : '.tb-foe')
      if (!el) continue
      el.innerHTML = this.fighters.filter((f) => f.side === side).map((f) => `
        <div class="tb-card${f.alive ? '' : ' down'}${f.controlled ? ' me' : ''}" style="border-color: ${tierColor(f.c.r)}">
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
    this.keys.clear()
    this.attackHeld = false
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
    window.removeEventListener('blur', this._onBlur)
    // Zombie bodies are this battle's own; animal ones are shared, kept.
    this.scene.traverse((o) => {
      if (o.isMesh && !this.fighters.some((f) => f.c.t === 'a' && o.parent && isInside(o, f.group))) {
        o.geometry?.dispose?.()
      }
    })
    this.renderer.dispose()
    this.renderer.forceContextLoss?.()
    this.root.remove()
    this.root = null
  }
}

function isInside(o, group) {
  for (let p = o; p; p = p.parent) if (p === group) return true
  return false
}
