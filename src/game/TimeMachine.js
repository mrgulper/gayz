// The Time Machine (2026-11-06, Gaymi's idea list 7: "craft one and travel
// to another era for a while, each with its own zombies" - Gaymi wanted
// "a bit of all of it": five eras, smaller each, and a Time Pass to go).
// Owned by BuildSurvival (`s.time`), every Zombie Survival game.
//
// - Craft a Time Machine, hold it and use it: it stands on open ground in
//   front of you. Each trip uses up one Time Pass (crafted too).
// - Press Use beside the machine: pick an era (keys 1-5 or a tap). A flash,
//   and you're there for ERA_S seconds - a little world of its own (real
//   blocks on a disc ERA_R round, high over everything at ERA_Y, put back
//   as they were afterwards - TempBlocks.js) under that era's sky:
//   - Dino Past: jungle, ferns and dinosaurs, with cavemen zombies.
//   - Medieval: a stone courtyard inside castle walls, knight zombies.
//   - Wild West: desert sand, cactus and a saloon, cowboy zombies.
//   - Ice Age: snow and ice, zombies frozen in ice that break free.
//   - Robot Future: neon streets, robot zombies.
//   The waves go on there with that era's zombies (spawnSpots()).
// - Time runs out (or press Use on the machine in the middle of the era)
//   and you're back by your machine with ERA_COINS coins. The eras you've
//   seen are kept (ERAS_KEY): see all five for a bonus.
// Meshes and one picker panel, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { TempBlocks } from './TempBlocks.js'

export const ERAS = ['dino', 'medieval', 'west', 'ice', 'future']
export const ERA_S = 90
export const ERA_R = 20
export const ERA_Y = 420
export const ERA_COINS = 60
export const ALL_ERAS_COINS = 300
export const ERAS_KEY = 'gayz-time-eras'
const ERA_ZOMBIES = 5
const SPAWN_EVERY = 7
const MAX_ALIVE = 8
const ICE_S = 3.5
const USE_R = 3
const SKY = { dino: 0xf0a878, medieval: 0x8a9ab8, west: 0xf0d090, ice: 0xd8ecf8, future: 0x1c0c34 }
// Each era's zombies: a tint for their skin and what they wear.
const LOOK = {
  dino: { skin: 0x8a6a3a, hat: 'club' },
  medieval: { skin: null, hat: 'helmet' },
  west: { skin: null, hat: 'cowboy' },
  ice: { skin: 0x9ac8e0, hat: null },
  future: { skin: 0x9aa4b0, hat: 'visor' },
}

// The eras you've been to (untrusted when read back: only known ids).
export function loadEras() {
  try {
    const v = JSON.parse(localStorage.getItem(ERAS_KEY) || '[]')
    return Array.isArray(v) ? [...new Set(v.filter((e) => ERAS.includes(e)))] : []
  } catch {
    return []
  }
}

function saveEras(list) {
  try { localStorage.setItem(ERAS_KEY, JSON.stringify(list)) } catch { /* storage full or blocked */ }
}

export class TimeMachine {
  constructor(survival) {
    this.s = survival
    this.cells = new TempBlocks(survival)
    this.machine = null // { x, y, z, group } - the one you put down
    this.era = '' // where you are now ('' = home)
    this.left = 0
    this.back = null
    this.pickOpen = false
    this.zombies = []
    this._spawnT = 0
  }

  get B() {
    return this.s.B
  }

  // Off in another era right now?
  get away() {
    return !!this.era
  }

  get cx() {
    return 2000.5
  }

  get cz() {
    return 2000.5
  }

  // Holding the Time Machine and using it (PlayInventory.useHeld). -> true
  // if it went down (then it's used up).
  place() {
    const s = this.s
    if (s.dead || this.away) return false
    const spot = s.vehicles?._groundAhead('balloon')
    if (!spot) {
      s._message(t('vehicleNeedRoom'), 3)
      return false
    }
    this._dropMachine()
    const g = makeMachine(this.B)
    g.position.set(spot.x * this.B, spot.y * this.B, spot.z * this.B)
    s.bm.scene.add(g)
    this.machine = { ...spot, group: g }
    s._message(t('timePlaced'), 4)
    try { audioEngine.playPlace?.() } catch { /* no audio */ }
    return true
  }

  _dropMachine() {
    const m = this.machine
    if (!m) return
    m.group.removeFromParent()
    disposeTree(m.group)
    this.machine = null
  }

  // The Use key (BuildMode._tryUseFromCamera). -> true if it was the machine.
  use() {
    const s = this.s
    if (s.dead || s.spectating) return false
    const me = s.bodyPos()
    if (this.away) {
      // The way home stands in the middle of the era.
      if (Math.hypot(me.x - this.cx, me.z - this.cz) < USE_R && Math.abs(me.y - (ERA_Y + 1)) < 3) {
        this.goHome()
        return true
      }
      return false
    }
    const m = this.machine
    if (!m || Math.hypot(me.x - m.x, me.z - m.z) > USE_R || Math.abs(me.y - m.y) > 3) return false
    this.openPick()
    return true
  }

  // --- the era picker ---

  openPick() {
    const s = this.s
    if (this.pickOpen) return
    this.pickOpen = true
    s.bm._keys?.clear?.()
    if (document.pointerLockElement) document.exitPointerLock()
    let el = this._pick
    if (!el) {
      el = this._pick = document.createElement('div')
      el.id = 'time-pick'
      document.body.appendChild(el)
      this._key = (e) => {
        if (!this.pickOpen) return
        const m = /^(?:Digit|Numpad)([1-5])$/.exec(e.code)
        if (m) {
          e.preventDefault()
          e.stopPropagation()
          this.go(ERAS[Number(m[1]) - 1])
        } else if (e.code === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          this.closePick()
        }
      }
      window.addEventListener('keydown', this._key, true)
    }
    el.textContent = ''
    const seen = loadEras()
    const title = document.createElement('div')
    title.className = 'time-pick-title'
    title.textContent = t('timePickTitle', { n: this._passes() })
    el.appendChild(title)
    ERAS.forEach((era, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      const name = document.createElement('b')
      name.textContent = `${i + 1}. ${t(`timeEra_${era}`)}${seen.includes(era) ? ' ✓' : ''}`
      const desc = document.createElement('span')
      desc.textContent = t(`timeEraDesc_${era}`)
      b.append(name, desc)
      b.addEventListener('click', () => this.go(era))
      el.appendChild(b)
    })
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'time-pick-close'
    close.textContent = t('timePickClose')
    close.addEventListener('click', () => this.closePick())
    el.appendChild(close)
    el.style.display = 'flex'
  }

  closePick(relock = true) {
    if (!this.pickOpen) return
    this.pickOpen = false
    if (this._pick) this._pick.style.display = 'none'
    if (relock) {
      try { this.s.bm.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available */ }
    }
  }

  _passes() {
    const inv = this.s.inv
    let n = 0
    for (const list of [inv?.grid || [], inv?.hotbar || []]) for (const it of list) if (it?.kind === 'item' && it.id === 'timePass') n += it.n || 1
    return n
  }

  // Off to an era (from the picker).
  go(era) {
    const s = this.s
    if (!ERAS.includes(era) || this.away || s.dead) return false
    if (!s.inv?.takeItem('timePass')) {
      s._message(t('timeNeedPass'), 3)
      return false
    }
    this.closePick()
    s.kart?.leave?.()
    const m = this.machine
    this.back = m ? { x: m.x + 1.5, y: m.y, z: m.z } : { ...s.bodyPos() }
    this.era = era
    this.left = ERA_S
    this._build(era)
    this._flash()
    const tm = s.bm.tryMode
    tm.pos.set(this.cx + 3, ERA_Y + 1, this.cz)
    tm.vel?.set(0, 0, 0)
    s.bm.camera.position.set((this.cx + 3) * this.B, (ERA_Y + 2.62) * this.B, this.cz * this.B)
    this._spawnT = 0
    this.zombies = []
    if (!s.net || s.net.isHost) for (let i = 0; i < ERA_ZOMBIES; i++) this._eraZombie()
    if (era === 'dino') this._dinos()
    s._message(t('timeArrive', { era: t(`timeEra_${era}`), n: ERA_S }), 5)
    s._renderHud?.()
    return true
  }

  goHome() {
    const s = this.s
    if (!this.away) return
    const era = this.era
    this.era = ''
    for (const zb of this.zombies) {
      const i = s.zombies.indexOf(zb)
      if (i >= 0) {
        s.zombies.splice(i, 1)
        s._removeZombie?.(zb)
      }
    }
    this.zombies = []
    for (const a of this._dinoList || []) s.animals?._remove?.(a)
    this._dinoList = []
    this._clearEra()
    const b = this.back || { x: 0.5, y: 80, z: 0.5 }
    const tm = s.bm.tryMode
    tm.pos.set(b.x, b.y, b.z)
    tm.vel?.set(0, 0, 0)
    s.bm.camera.position.set(b.x * this.B, (b.y + 1.62) * this.B, b.z * this.B)
    this._flash()
    // Coins, and a bonus once you've seen every era.
    const seen = loadEras()
    let coins = ERA_COINS
    if (!seen.includes(era)) {
      seen.push(era)
      saveEras(seen)
      if (seen.length === ERAS.length) coins += ALL_ERAS_COINS
    }
    s.coins = (s.coins || 0) + coins
    s._renderHud?.()
    s._message(t(seen.length === ERAS.length && coins > ERA_COINS ? 'timeHomeAll' : 'timeHome', { n: coins, seen: seen.length, max: ERAS.length }), 5)
  }

  update(dt) {
    const s = this.s
    if (!s.active) return
    if (this._sky) {
      this._sky.visible = this.away
      if (this.away) this._sky.position.copy(s.bm.camera.position)
    }
    this._prompt()
    if (!this.away) return
    this.left -= dt
    if (Math.floor(this.left) !== this._shown && (Math.floor(this.left) === 30 || Math.floor(this.left) === 10)) s._message(t('timeLeft', { n: Math.floor(this.left) }), 3)
    this._shown = Math.floor(this.left)
    // Fell off the edge of time: back on the disc.
    const me = s.bodyPos()
    if (me.y < ERA_Y - 12) {
      s.bm.tryMode.pos.set(this.cx + 3, ERA_Y + 1, this.cz)
      s.bm.tryMode.vel?.set(0, 0, 0)
    }
    this._iceStep(dt)
    if (!s.net || s.net.isHost) {
      this.zombies = this.zombies.filter((zb) => zb.health > 0 && s.zombies.includes(zb))
      this._spawnT -= dt
      if (this._spawnT <= 0 && this.zombies.length < MAX_ALIVE && !s.cfg?.noZombies) {
        this._spawnT = SPAWN_EVERY
        this._eraZombie()
      }
    }
    if (this.left <= 0) this.goHome()
  }

  _prompt() {
    const s = this.s
    const me = s.bodyPos()
    const m = this.machine
    const near = this.away
      ? Math.hypot(me.x - this.cx, me.z - this.cz) < USE_R && Math.abs(me.y - (ERA_Y + 1)) < 3
      : !!m && Math.hypot(me.x - m.x, me.z - m.z) < USE_R && Math.abs(me.y - m.y) < 3
    const key = near ? (this.away ? 'timePromptHome' : 'timePromptGo') : ''
    if (key && key !== this._lastPrompt && !this.pickOpen) s._message(t(key), 3)
    this._lastPrompt = key
  }

  // Where the waves' zombies come from while you're away (BuildSurvival._spawnSpots).
  spawnSpots() {
    const out = []
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      out.push([Math.floor(this.cx + Math.cos(a) * (ERA_R - 3)), ERA_Y + 1, Math.floor(this.cz + Math.sin(a) * (ERA_R - 3))])
    }
    return out
  }

  protects(x, y, z) {
    return this.away && this.cells.has(x, y, z)
  }

  // An era zombie at the edge of the disc, dressed for its time.
  _eraZombie() {
    const s = this.s
    const a = Math.random() * Math.PI * 2
    const r = ERA_R - 3 - Math.random() * 4
    const x = this.cx + Math.cos(a) * r
    const z = this.cz + Math.sin(a) * r
    const zb = s._extraZombie?.(x, ERA_Y + 1, z, null)
    if (!zb) return null
    this.zombies.push(zb)
    this.dress(zb, this.era)
    if (this.era === 'ice') {
      // Frozen in a block of ice: it breaks free after a moment.
      zb.frozen = ICE_S
      const fx = Math.floor(zb.x)
      const fz = Math.floor(zb.z)
      const cells = []
      for (let y = ERA_Y + 1; y <= ERA_Y + 2; y++) if (!s.bm.getBlockAt(fx, y, fz)) {
        this.cells.put(fx, y, fz, 'ice')
        cells.push(s.bm._key(fx, y, fz))
      }
      ;(this._ice ||= []).push({ left: ICE_S, cells })
    }
    return zb
  }

  _iceStep(dt) {
    if (!this._ice?.length) return
    for (const c of this._ice) {
      c.left -= dt
      if (c.left > 0) continue
      for (const key of c.cells) this.cells.back(key)
      try { audioEngine.playSpecial?.('crumble') } catch { /* no audio */ }
    }
    this._ice = this._ice.filter((c) => c.left > 0)
  }

  // An era's look on a zombie: its skin tint and what it wears.
  dress(zb, era) {
    const look = LOOK[era]
    if (!look || !zb.group) return
    const B = this.B
    zb.era = era
    if (look.skin !== null) {
      const tint = new THREE.Color(look.skin)
      zb.group.traverse((o) => {
        if (!o.isMesh || !o.material?.color) return
        o.material = o.material.clone()
        o.material.color.lerp(tint, 0.6)
      })
    }
    const add = (geo, color, y, z = 0) => {
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }))
      m.position.set(0, y * B, z * B)
      zb.group.add(m)
      return m
    }
    if (look.hat === 'helmet') {
      add(new THREE.BoxGeometry(0.58 * B, 0.36 * B, 0.58 * B), 0xb8bcc4, 2.0)
      add(new THREE.BoxGeometry(0.06 * B, 0.3 * B, 0.08 * B), 0xd8352a, 2.28)
    } else if (look.hat === 'cowboy') {
      add(new THREE.CylinderGeometry(0.55 * B, 0.55 * B, 0.05 * B, 16), 0x7a4a22, 2.0)
      add(new THREE.CylinderGeometry(0.24 * B, 0.28 * B, 0.3 * B, 12), 0x7a4a22, 2.16)
    } else if (look.hat === 'visor') {
      add(new THREE.BoxGeometry(0.52 * B, 0.1 * B, 0.08 * B), 0x40f0ff, 1.8, 0.26)
      add(new THREE.BoxGeometry(0.04 * B, 0.3 * B, 0.04 * B), 0xcccccc, 2.1)
    } else if (look.hat === 'club') {
      add(new THREE.BoxGeometry(0.14 * B, 0.7 * B, 0.14 * B), 0x5a3a1e, 1.0, 0.4)
    }
  }

  _dinos() {
    const s = this.s
    this._dinoList = []
    if (s.net && !s.net.isHost) return
    for (const [kind, a] of [['velociraptor', 0.5], ['triceratops', 2.6], ['stegosaurus', 4.4]]) {
      const x = this.cx + Math.cos(a) * 12
      const z = this.cz + Math.sin(a) * 12
      const dino = s.animals?.spawn?.(kind, x, ERA_Y + 1, z)
      if (dino) this._dinoList.push(dino)
    }
  }

  // --- the era's little world ---

  _build(era) {
    const cx = Math.floor(this.cx)
    const cz = Math.floor(this.cz)
    const y = ERA_Y
    const put = (dx, dy, dz, type) => this.cells.put(cx + dx, y + dy, cz + dz, type)
    const R = ERA_R
    const rnd = mulberry(ERAS.indexOf(era) + 7)
    const floor = { dino: ['grass', 'podzol'], medieval: ['stonebricks', 'cobblestone'], west: ['sand', 'redsand'], ice: ['snow', 'packedice'], future: ['blackconcrete', 'grayconcrete'] }[era]
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      const d = Math.hypot(dx, dz)
      if (d > R) continue
      put(dx, -1, dz, d > R - 1.2 ? 'stonebricks' : rnd() < 0.2 ? floor[1] : floor[0])
      put(dx, -2, dz, 'stone')
      if (era === 'future' && (dx % 6 === 0 || dz % 6 === 0) && d < R - 1) put(dx, -1, dz, 'cyanconcrete')
    }
    // What stands on it, out from the middle.
    const spotFree = (dx, dz) => Math.hypot(dx, dz) > 4 && Math.hypot(dx, dz) < R - 2
    if (era === 'dino') {
      for (let i = 0; i < 9; i++) {
        const a = rnd() * Math.PI * 2
        const r = 6 + rnd() * (R - 9)
        const dx = Math.round(Math.cos(a) * r)
        const dz = Math.round(Math.sin(a) * r)
        if (!spotFree(dx, dz)) continue
        for (let k = 0; k < 5; k++) put(dx, k, dz, 'junglelog')
        for (let ox = -2; ox <= 2; ox++) for (let oz = -2; oz <= 2; oz++) for (let k = 4; k <= 5; k++) if (Math.abs(ox) + Math.abs(oz) < 4 - (k - 4)) put(dx + ox, k, dz + oz, 'jungleleaves')
      }
    } else if (era === 'medieval') {
      // Castle walls round the edge with gaps on top, a tower.
      for (let i = 0; i < 160; i++) {
        const a = (i / 160) * Math.PI * 2
        const dx = Math.round(Math.cos(a) * (R - 1))
        const dz = Math.round(Math.sin(a) * (R - 1))
        for (let k = 0; k < 4; k++) put(dx, k, dz, 'stonebricks')
        if (i % 2 === 0) put(dx, 4, dz, 'stonebricks')
      }
      for (let ox = -2; ox <= 2; ox++) for (let oz = -2; oz <= 2; oz++) {
        const edge = Math.abs(ox) === 2 || Math.abs(oz) === 2
        for (let k = 0; k < 8; k++) if (edge && !(oz === 2 && !ox && k < 2)) put(9 + ox, k, -9 + oz, k > 6 ? 'chiseledstonebricks' : 'stonebricks')
      }
      put(-8, 0, 8, 'haybale')
      put(-7, 0, 8, 'haybale')
    } else if (era === 'west') {
      for (let i = 0; i < 10; i++) {
        const a = rnd() * Math.PI * 2
        const r = 6 + rnd() * (R - 9)
        const dx = Math.round(Math.cos(a) * r)
        const dz = Math.round(Math.sin(a) * r)
        if (!spotFree(dx, dz)) continue
        const h = 2 + Math.floor(rnd() * 2)
        for (let k = 0; k < h; k++) put(dx, k, dz, 'cactus')
      }
      // A saloon front.
      for (let ox = -4; ox <= 4; ox++) for (let k = 0; k < 6; k++) {
        if (Math.abs(ox) <= 1 && k < 3) continue
        put(ox, k, 12, k === 5 ? 'oakplanks' : 'spruceplanks')
      }
    } else if (era === 'ice') {
      for (let i = 0; i < 12; i++) {
        const a = rnd() * Math.PI * 2
        const r = 6 + rnd() * (R - 9)
        const dx = Math.round(Math.cos(a) * r)
        const dz = Math.round(Math.sin(a) * r)
        if (!spotFree(dx, dz)) continue
        const h = 2 + Math.floor(rnd() * 5)
        for (let k = 0; k < h; k++) put(dx, k, dz, k > h - 3 ? 'packedice' : 'blueice')
      }
    } else if (era === 'future') {
      for (const [dx, dz] of [[-12, -6], [12, 6], [-6, 12], [6, -12], [-12, 6], [12, -6]]) {
        for (let k = 0; k < 7; k++) put(dx, k, dz, k === 6 ? 'sealantern' : 'iron')
      }
      for (let ox = -3; ox <= 3; ox++) for (let oz = 8; oz <= 11; oz++) for (let k = 0; k < 5; k++) {
        const edge = Math.abs(ox) === 3 || oz === 8 || oz === 11
        if (edge && !(oz === 8 && Math.abs(ox) <= 1 && k < 3)) put(ox, k, oz, k === 4 ? 'cyanconcrete' : 'glass')
      }
    }
    this._sky?.removeFromParent()
    this._sky = makeSky(this.B, SKY[era], era === 'future')
    this.s.bm.scene.add(this._sky)
    // The way home in the middle: a copy of the machine.
    this._home = makeMachine(this.B)
    this._home.position.set(this.cx * this.B, ERA_Y * this.B, this.cz * this.B)
    this.s.bm.scene.add(this._home)
  }

  _clearEra() {
    this.cells.restore()
    this._ice = []
    if (this._home) {
      this._home.removeFromParent()
      disposeTree(this._home)
      this._home = null
    }
    if (this._sky) {
      this._sky.removeFromParent()
      disposeTree(this._sky)
      this._sky = null
    }
  }

  // A white flash: through time.
  _flash() {
    let el = this._flashEl
    if (!el) {
      el = this._flashEl = document.createElement('div')
      el.id = 'time-flash'
      document.body.appendChild(el)
    }
    el.classList.remove('on')
    void el.offsetWidth
    el.classList.add('on')
    try { audioEngine.playSpecial?.('whoosh') } catch { /* no audio */ }
  }

  clear() {
    if (this.away) {
      this.era = ''
      this.zombies = []
    }
    this._clearEra()
    this._dropMachine()
    this.closePick(false)
    this.back = null
  }
}

// The machine: a round pod with a glass top, two brass rings spinning
// round it and a clock face on the front.
function makeMachine(B) {
  const g = new THREE.Group()
  const box = (geo, color, y, opts = {}) => {
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, ...opts }))
    m.position.y = y * B
    g.add(m)
    return m
  }
  box(new THREE.CylinderGeometry(0.9 * B, 1 * B, 0.3 * B, 16), 0x4a4a52, 0.15)
  box(new THREE.CylinderGeometry(0.7 * B, 0.7 * B, 1.6 * B, 16), 0x7a5a9a, 1.1)
  box(new THREE.SphereGeometry(0.7 * B, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0x9ad8ff, 1.9, { transparent: true, opacity: 0.55 })
  const clock = box(new THREE.CylinderGeometry(0.3 * B, 0.3 * B, 0.06 * B, 16), 0xf2f0ea, 1.2)
  clock.rotation.x = Math.PI / 2
  clock.position.z = 0.72 * B
  for (const tilt of [0.5, -0.5]) {
    const ring = box(new THREE.TorusGeometry(1.15 * B, 0.06 * B, 6, 32), 0xe8c14a, 1.2)
    ring.rotation.x = Math.PI / 2 + tilt
  }
  return g
}

// An era's sky: a big dome round the camera in its own colour (fog off),
// with stars over the future.
function makeSky(B, color, stars) {
  const g = new THREE.Group()
  const dome = new THREE.Mesh(new THREE.SphereGeometry(160 * B, 24, 16), new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: false, depthWrite: false }))
  dome.renderOrder = -10
  g.add(dome)
  if (stars) {
    const pos = []
    for (let i = 0; i < 400; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.1, Math.random() - 0.5).normalize().multiplyScalar(150 * B)
      pos.push(v.x, v.y, v.z)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xc0f0ff, size: 2, sizeAttenuation: false, fog: false, depthWrite: false })))
  }
  return g
}

function disposeTree(root) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isPoints) return
    o.geometry?.dispose?.()
    o.material?.dispose?.()
  })
}

// A small seeded random, so each era looks the same every visit.
function mulberry(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = a
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}
