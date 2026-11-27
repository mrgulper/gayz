// Nemesis Zombie (2026-11-19, Gaymi picked "any zombie"): the zombie that
// kills you becomes your Nemesis. It keeps its name and rarity, and from
// wave FROM_WAVE of your next run it comes back for you - once a run,
// tougher every time it gets you again (level 1..MAX_LEVEL). Beat it
// yourself for NEMESIS_COINS x its level; then the next zombie to kill you
// takes its place. Killed by anyone or anything else, it just gets away.
// Owned by BuildSurvival (`s.nemesis`). Alone or as a server's host, in
// zombie modes only (same rule as ZombieLearning.allowed).
//
// Saved in localStorage STORE_KEY: { name, tier, level, kills } (untrusted -
// cleaned on every read). Cloud Save carries it (every gayz- key), and
// LOG_KEY too: { beaten, best } - how many Nemeses I've beaten and the
// highest level among them (CloudMerge adds two devices' `beaten`).
//
// Batch 2 (2026-11-19): it looks the part - wider per level (never taller:
// mobs stay 2 blocks tall) with one red scar per level - says a taunt in a
// speech bubble when it arrives, a red arrow at the screen edge points to
// it while it's off-screen, and it has its own card at the top of the
// Zombie Book (ZombieBook.renderNemesisCard).
import * as THREE from 'three'
import { t } from './i18n.js'
import { NAME_COUNT, ZOMBIE_TIERS, zombieName, TAG_W, TAG_H } from './ZombieNames.js'
import { speechBubble, disposeBubble, bubbleSeconds, fadeBubble } from './SpeechBubble.js'

export const STORE_KEY = 'gayz-nemesis'
export const FROM_WAVE = 2
export const MAX_LEVEL = 5
// Times a normal zombie of its wave: health, bite, walking speed.
export const HP_BASE = 2
export const HP_PER_LEVEL = 0.5
export const DAMAGE_PER_LEVEL = 0.15
export const SPEED = 1.08
export const NEMESIS_COINS = 100
export const LOG_KEY = 'gayz-nemesis-log'
// Body width per level: x1.08 at level 1 .. x1.4 at level 5.
export const WIDEN_PER_LEVEL = 0.08
export const TAUNT_COUNT = 6

export function loadNemesis() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
    if (!v || !Number.isInteger(v.name) || v.name < 0 || v.name >= NAME_COUNT) return null
    const tier = ZOMBIE_TIERS[v.tier] ? v.tier : 'common'
    const level = Math.min(MAX_LEVEL, Math.max(1, Math.floor(Number(v.level) || 1)))
    const kills = Math.min(9999, Math.max(level, Math.floor(Number(v.kills) || 0)))
    return { name: v.name, tier, level, kills }
  } catch {
    return null
  }
}

function saveNemesis(v) {
  try {
    if (v) localStorage.setItem(STORE_KEY, JSON.stringify(v))
    else localStorage.removeItem(STORE_KEY)
  } catch { /* storage off */ }
}

// { beaten, best }: Nemeses I've beaten, and the highest level of them.
export function loadNemesisLog() {
  try {
    const v = JSON.parse(localStorage.getItem(LOG_KEY) || 'null') || {}
    const num = (n, max) => Math.min(max, Math.max(0, Math.floor(Number(n) || 0)))
    return { beaten: num(v.beaten, 99999), best: num(v.best, MAX_LEVEL) }
  } catch {
    return { beaten: 0, best: 0 }
  }
}

function logBeaten(level) {
  const log = loadNemesisLog()
  log.beaten += 1
  log.best = Math.max(log.best, level)
  try { localStorage.setItem(LOG_KEY, JSON.stringify(log)) } catch { /* storage off */ }
}

// Scars: thin dark-red boxes on the face and chest, one per level, in the
// zombie body's own units (32 tall, facing +z; head 22..30, chest 10..22).
// [x, y, z, width, height, tilt]
const SCARS = [
  [1.6, 26.5, 4.6, 0.7, 4.2, 0.5],
  [-1.2, 17, 2.45, 0.8, 6, -0.6],
  [-2, 27.5, 4.6, 0.6, 3, -0.4],
  [1.5, 14, 2.45, 0.8, 5, 0.7],
  [0.2, 23.4, 4.6, 3.6, 0.6, 0.15],
]
let scarGeo = null
let scarMat = null
// Never disposed: shared by every Nemesis and by its falling corpse (the
// corpse clones the body and frees only its own material copies).
function scarParts() {
  if (!scarGeo) {
    scarGeo = new THREE.BoxGeometry(1, 1, 0.3)
    scarMat = new THREE.MeshLambertMaterial({ color: 0x7a0a0a })
  }
  return [scarGeo, scarMat]
}

// Wider body and scars for its level. A normal (batched) zombie body only;
// a shiny one gets the scars too. Returns the scar group (tests look).
export function dressNemesis(zb, level) {
  const body = zb.body
  if (!body) return null
  const w = 1 + WIDEN_PER_LEVEL * level
  body.scale.x *= w
  body.scale.z *= w
  zb.wide = (zb.wide || 1) * w
  const [geo, mat] = scarParts()
  const scars = new THREE.Group()
  scars.name = 'nemesisScars'
  for (const [x, y, z, sw, sh, tilt] of SCARS.slice(0, level)) {
    const m = new THREE.Mesh(geo, mat)
    m.userData.shared = true
    m.position.set(x, y, z)
    m.scale.set(sw, sh, 1)
    m.rotation.z = tilt
    scars.add(m)
  }
  body.add(scars)
  return scars
}

// Its own red name tag: skull + NEMESIS, its name, its level.
function nemesisTag(v) {
  const c = document.createElement('canvas')
  c.width = TAG_W
  c.height = TAG_H
  const g = c.getContext('2d')
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = 'rgba(90, 0, 0, 0.7)'
  g.beginPath()
  g.roundRect(4, 2, TAG_W - 8, TAG_H - 4, 16)
  g.fill()
  g.lineWidth = 5
  g.strokeStyle = 'rgba(0, 0, 0, 0.8)'
  const line = (text, y, size, color) => {
    g.font = `bold ${size}px sans-serif`
    g.fillStyle = color
    g.strokeText(text, TAG_W / 2, y, TAG_W - 16)
    g.fillText(text, TAG_W / 2, y, TAG_W - 16)
  }
  line(zombieName(v.name), 27, 34, '#ffffff')
  line(t('nemesisTag', { n: v.level }), 60, 26, '#ff5a5a')
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false })
}

export class NemesisZombie {
  constructor(s) {
    this.s = s
    this.clear()
  }

  get allowed() {
    const s = this.s
    return s.active && !s.party && !s.td && !s.escape && !s.cfg?.noZombies && (!s.net || s.net.isHost)
  }

  // A new run: it may come back once.
  clear() {
    this.came = false
    this.zombie = null
    this._dropBubble()
    if (this._arrow) this._arrow.style.display = 'none'
    this._tagMat?.map?.dispose()
    this._tagMat?.dispose()
    this._tagMat = null
  }

  _dropBubble() {
    if (this.bubble) disposeBubble(this.bubble)
    this.bubble = null
  }

  // dt: seconds since the last frame.
  update(dt = 0) {
    this._tickBubble(dt)
    this._pointAt()
    const s = this.s
    if (this.came || s.dead || !this.allowed || (s.wave || 0) < FROM_WAVE) return
    const v = loadNemesis()
    if (!v) {
      this.came = true
      return
    }
    const spots = s._spawnSpots?.() || []
    const open = s.camp ? spots.filter(([x, , z]) => !s.camp.inside(x + 0.5, z + 0.5, 1)) : spots
    if (!open.length) return
    this.came = true
    const [x, y, z] = open[Math.floor(Math.random() * open.length)]
    this.spawnAt(v, x + 0.5, y, z + 0.5)
  }

  // Brings it in (tests call this directly).
  spawnAt(v, x, y, z) {
    const s = this.s
    const health = s._nemesisBaseHealth() * (HP_BASE + HP_PER_LEVEL * v.level) * ZOMBIE_TIERS[v.tier].hp
    const zb = s._makeZombie(++s._zid, x, y, z, health, false, null, { tier: v.tier, name: v.name })
    zb.extra = true
    zb.nemesis = v.level
    zb.damageMult = (zb.damageMult || 1) * (1 + DAMAGE_PER_LEVEL * v.level)
    zb.speedMult = (zb.speedMult || 1) * SPEED
    this._tagMat = nemesisTag(v)
    if (zb.tag) zb.tag.material = this._tagMat
    dressNemesis(zb, v.level)
    this.zombie = zb
    this.came = true
    s._message(t('nemesisBack', { name: zombieName(v.name), n: v.level }), 4)
    this.taunt(zb, v)
    return zb
  }

  // A line in a speech bubble beside its head as it arrives.
  taunt(zb, v) {
    this._dropBubble()
    const text = t(`nemesisTaunt${Math.floor(Math.random() * TAUNT_COUNT) + 1}`, { n: v.kills || v.level })
    this.bubble = speechBubble(text, this.s.B)
    this.bubbleLeft = bubbleSeconds(text) + 1.5
    zb.group.add(this.bubble)
  }

  _tickBubble(dt) {
    if (!this.bubble) return
    this.bubbleLeft -= dt
    if (this.bubbleLeft <= 0 || !this.zombie) this._dropBubble()
    else fadeBubble(this.bubble, this.bubbleLeft)
  }

  // The red arrow at the screen edge, pointing to it while it's off-screen
  // (or behind me). Lives in the play HUD, so it hides with it.
  _pointAt() {
    const s = this.s
    const zb = this.zombie
    const hud = s._hud
    const cam = s.bm?.camera
    let show = false
    if (zb && hud && cam && !s.dead && s.zombies.includes(zb)) {
      const B = s.B
      const v = (this._v ||= new THREE.Vector3()).set(zb.x * B, (zb.y + 1.4) * B, zb.z * B).project(cam)
      const behind = v.z > 1
      let dx = behind ? -v.x : v.x
      let dy = behind ? -v.y : v.y
      if (behind || Math.abs(dx) > 0.95 || Math.abs(dy) > 0.95) {
        if (!dx && !dy) dy = -1
        const k = Math.max(Math.abs(dx) / 0.86, Math.abs(dy) / 0.8)
        dx /= k
        dy /= k
        const W = hud.clientWidth || window.innerWidth
        const H = hud.clientHeight || window.innerHeight
        const a = this._ensureArrow(hud)
        const deg = (Math.atan2(-dy, dx) * 180) / Math.PI
        a.style.transform = `translate(${Math.round(((dx + 1) / 2) * W)}px, ${Math.round(((1 - dy) / 2) * H)}px) translate(-50%, -50%)`
        a.firstChild.style.transform = `rotate(${Math.round(deg)}deg)`
        show = true
      }
    }
    if (this._arrow) this._arrow.style.display = show ? '' : 'none'
  }

  _ensureArrow(hud) {
    if (this._arrow && this._arrow.parentNode === hud) return this._arrow
    const a = document.createElement('div')
    a.id = 'nemesis-arrow'
    a.innerHTML = '<span class="nemesis-arrow-head">&#10148;</span><span class="nemesis-arrow-skull">&#9760;</span>'
    hud.appendChild(a)
    this._arrow = a
    return a
  }

  // It went down. mine: my own hit (not a teammate, the sun or Player 2).
  onKilled(z, mine) {
    if (!z?.nemesis) return
    this.zombie = null
    this._dropBubble()
    const s = this.s
    const name = zombieName(z.nameIdx)
    if (mine) {
      const coins = NEMESIS_COINS * z.nemesis
      s._earn(coins, 'bosses')
      saveNemesis(null)
      logBeaten(z.nemesis)
      s._message(t('nemesisBeaten', { name, n: Math.round(coins * (s.cfg?.coinMult ?? 1)) }), 5)
    } else {
      s._message(t('nemesisEscaped', { name }), 4)
    }
  }

  // I died. biter: who bit me last (BuildSurvival._lastBiter, already
  // checked as recent) or null. -> a line for the You Died card, or ''.
  onDeath(biter) {
    if (!biter || !this.allowed) return ''
    const now = loadNemesis()
    if (biter.nemesis || (now && now.name === biter.nameIdx)) {
      const level = Math.min(MAX_LEVEL, (now?.level || biter.nemesis || 1) + 1)
      const kills = (now?.kills || now?.level || biter.nemesis || 1) + 1
      saveNemesis({ name: biter.nameIdx, tier: now?.tier || biter.tier || 'common', level, kills })
      return t('nemesisLevelUp', { name: zombieName(biter.nameIdx), n: level })
    }
    if (now) return ''
    saveNemesis({ name: biter.nameIdx, tier: ZOMBIE_TIERS[biter.tier] ? biter.tier : 'common', level: 1, kills: 1 })
    return t('nemesisNew', { name: zombieName(biter.nameIdx) })
  }
}
