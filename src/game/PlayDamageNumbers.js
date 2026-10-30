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
    this._layer().appendChild(el)
    // A little sideways scatter, so hits in a row don't stack exactly.
    const item = { el, x: x + (Math.random() - 0.5) * 0.5, y, z: z + (Math.random() - 0.5) * 0.5, t: 0 }
    this.list.push(item)
    while (this.list.length > MAX_UP) this._drop(this.list[0])
    this._place(item)
  }

  // At a zombie (its upper body) - the spot most hits land on.
  atZombie(zb, amount, weaponId, height) {
    this.show(zb.x, zb.y + height * (zb.size || 1) * (zb.tall || 1) * 0.85, zb.z, amount, weaponId)
  }

  update(dt) {
    for (const item of [...this.list]) {
      item.t += dt
      if (item.t >= NUMBER_S) this._drop(item)
      else this._place(item)
    }
  }

  _place(item) {
    const bm = this.s.bm
    const B = this.s.B
    const k = item.t / NUMBER_S
    const v = this._v.set(item.x * B, (item.y + RISE * (1 - (1 - k) * (1 - k))) * B, item.z * B).project(bm.camera)
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
