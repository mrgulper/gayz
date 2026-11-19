// Nemesis Zombie (2026-11-19, Gaymi picked "any zombie"): the zombie that
// kills you becomes your Nemesis. It keeps its name and rarity, and from
// wave FROM_WAVE of your next run it comes back for you - once a run,
// tougher every time it gets you again (level 1..MAX_LEVEL). Beat it
// yourself for NEMESIS_COINS x its level; then the next zombie to kill you
// takes its place. Killed by anyone or anything else, it just gets away.
// Owned by BuildSurvival (`s.nemesis`). Alone or as a server's host, in
// zombie modes only (same rule as ZombieLearning.allowed).
//
// Saved in localStorage STORE_KEY: { name, tier, level } (untrusted -
// cleaned on every read).
import * as THREE from 'three'
import { t } from './i18n.js'
import { NAME_COUNT, ZOMBIE_TIERS, zombieName, TAG_W, TAG_H } from './ZombieNames.js'

export const STORE_KEY = 'gayz-nemesis'
export const FROM_WAVE = 2
export const MAX_LEVEL = 5
// Times a normal zombie of its wave: health, bite, walking speed.
export const HP_BASE = 2
export const HP_PER_LEVEL = 0.5
export const DAMAGE_PER_LEVEL = 0.15
export const SPEED = 1.08
export const NEMESIS_COINS = 100

export function loadNemesis() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
    if (!v || !Number.isInteger(v.name) || v.name < 0 || v.name >= NAME_COUNT) return null
    const tier = ZOMBIE_TIERS[v.tier] ? v.tier : 'common'
    const level = Math.min(MAX_LEVEL, Math.max(1, Math.floor(Number(v.level) || 1)))
    return { name: v.name, tier, level }
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
    this._tagMat?.map?.dispose()
    this._tagMat?.dispose()
    this._tagMat = null
  }

  update() {
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
    this.zombie = zb
    this.came = true
    s._message(t('nemesisBack', { name: zombieName(v.name), n: v.level }), 4)
    return zb
  }

  // It went down. mine: my own hit (not a teammate, the sun or Player 2).
  onKilled(z, mine) {
    if (!z?.nemesis) return
    this.zombie = null
    const s = this.s
    const name = zombieName(z.nameIdx)
    if (mine) {
      const coins = NEMESIS_COINS * z.nemesis
      s._earn(coins)
      saveNemesis(null)
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
      saveNemesis({ name: biter.nameIdx, tier: now?.tier || biter.tier || 'common', level })
      return t('nemesisLevelUp', { name: zombieName(biter.nameIdx), n: level })
    }
    if (now) return ''
    saveNemesis({ name: biter.nameIdx, tier: ZOMBIE_TIERS[biter.tier] ? biter.tier : 'common', level: 1 })
    return t('nemesisNew', { name: zombieName(biter.nameIdx) })
  }
}
