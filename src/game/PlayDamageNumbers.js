// Damage numbers (2026-10-26, Gaymi: "when shooting or damaging anything
// make the damage number pop up"): a bold red number with a dark outline
// and a little picture of the weapon pops up where your hit landed - on a
// zombie, skeleton or animal - floats up and fades. Owned by BuildSurvival
// (`s.damageNumbers`), stepped every frame from its update(), so it keeps
// going while spectating (where everyone's hits show, PlaySpectate parity)
// and on phones. Plain HTML over the 3D view (#play-damage-numbers, styled
// in style.css), placed each frame by projecting the hit's spot.
import * as THREE from 'three'
import { WEAPON_THUMB_IDS, WEAPON_THUMBS_VERSION } from './weaponThumbs.js'

// Seconds a number stays up, how far it rises (in blocks) and how many can
// be up at once (the oldest goes first).
export const NUMBER_S = 0.9
const RISE = 0.9
const MAX_UP = 24
// Coins out of a kill: how long they show and how many little ones.
export const COIN_S = 1.1
const COIN_BITS = 3

const THUMBS = new Set(WEAPON_THUMB_IDS)
// The weapon's picture, for the ones that have one (melee weapons share
// one).
function thumbFor(weaponId) {
  const id = THUMBS.has(weaponId) ? weaponId : /knife|melee|sword|axe|bat/i.test(weaponId || '') ? 'melee' : null
  return id ? `/images/weapon-thumbs/${id}.png?v=${WEAPON_THUMBS_VERSION}` : ''
}

export class PlayDamageNumbers {
  constructor(survival) {
    this.s = survival
    this.list = []
    this._v = new THREE.Vector3()
    this._el = null
  }

  _layer() {
    if (this._el?.isConnected) return this._el
    let el = document.getElementById('play-damage-numbers')
    if (!el) {
      el = document.createElement('div')
      el.id = 'play-damage-numbers'
      el.setAttribute('aria-hidden', 'true')
      document.body.appendChild(el)
    }
    this._el = el
    return el
  }

  // amount at x, y, z (blocks: the spot that was hit). weaponId: the
  // picture beside it (none for hits that aren't yours).
  show(x, y, z, amount, weaponId = '') {
    const n = Math.round(amount)
    // Settings > Controls > Damage Numbers (2026-10-30).
    if (!(n >= 1) || this.s.bm?.game?.settings?.damageNumbers === false) return
    const el = document.createElement('div')
    el.className = 'play-dmg'
    const src = thumbFor(weaponId)
    if (src) {
      const img = document.createElement('img')
      img.src = src
      img.alt = ''
      img.draggable = false
      el.appendChild(img)
    }
    const num = document.createElement('span')
    num.textContent = String(n)
    el.appendChild(num)
    // A little sideways scatter, so hits in a row don't stack exactly.
    this._add({ el, x: x + (Math.random() - 0.5) * 0.5, y, z: z + (Math.random() - 0.5) * 0.5, t: 0 })
  }

  // At a zombie (its upper body) - the spot most hits land on.
  atZombie(zb, amount, weaponId, height) {
    this.show(zb.x, zb.y + height * (zb.size || 1) * (zb.tall || 1) * 0.85, zb.z, amount, weaponId)
  }

  // Coins popping out of a zombie you took down (2026-10-31, "juicy core"):
  // a gold "+n" and a few coins hopping out sideways and dropping.
  coinsAt(zb, n, height) {
    if (!(n >= 1)) return
    const y = zb.y + height * (zb.size || 1) * (zb.tall || 1) * 0.6
    const label = document.createElement('div')
    label.className = 'play-dmg play-coins'
    label.innerHTML = '<i class="play-coin"></i><span></span>'
    label.querySelector('span').textContent = `+${Math.round(n)}`
    this._add({ el: label, x: zb.x, y: y + 0.4, z: zb.z, t: 0, life: COIN_S })
    for (let i = 0; i < COIN_BITS; i++) {
      const el = document.createElement('div')
      el.className = 'play-dmg play-coin-bit'
      el.innerHTML = '<i class="play-coin"></i>'
      const a = Math.random() * Math.PI * 2
      const sp = 0.6 + Math.random() * 0.7
      this._add({ el, x: zb.x, y, z: zb.z, t: 0, life: COIN_S, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, hop: 0.9 + Math.random() * 0.5 })
    }
  }

  _add(item) {
    this._layer().appendChild(item.el)
    this.list.push(item)
    while (this.list.length > MAX_UP) this._drop(this.list[0])
    this._place(item)
  }

  update(dt) {
    for (const item of [...this.list]) {
      item.t += dt
      if (item.t >= (item.life || NUMBER_S)) this._drop(item)
      else this._place(item)
    }
  }

  _place(item) {
    const bm = this.s.bm
    const B = this.s.B
    const k = item.t / (item.life || NUMBER_S)
    // A coin bit flies out and arcs down; everything else rises.
    const v = item.hop
      ? this._v.set((item.x + item.vx * k) * B, (item.y + item.hop * 4 * k * (1 - k) - 0.6 * k) * B, (item.z + item.vz * k) * B).project(bm.camera)
      : this._v.set(item.x * B, (item.y + RISE * (1 - (1 - k) * (1 - k))) * B, item.z * B).project(bm.camera)
    // Behind the camera: hidden.
    if (v.z > 1) {
      item.el.style.opacity = '0'
      return
    }
    const w = window.innerWidth
    const h = window.innerHeight
    item.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%) scale(${k < 0.15 ? 0.6 + (k / 0.15) * 0.5 : 1.1 - Math.min(0.1, (k - 0.15))})`
    item.el.style.opacity = String(k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4)
  }

  _drop(item) {
    item.el.remove()
    const i = this.list.indexOf(item)
    if (i >= 0) this.list.splice(i, 1)
  }

  clear() {
    for (const item of [...this.list]) this._drop(item)
  }
}
