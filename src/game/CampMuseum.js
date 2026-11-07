// The Zombie Museum (2026-11-06, Gaymi's idea list 8: "rooms that fill up
// as you go: zombie statues from your Zombie Book, glass cases with rare
// drops, a golden plaque for each boss you beat. It shows off everything
// you've done"). Owned by BuildCamp (`camp.museum`), only in Play.
//
// A long hall along a camp wall, built from its own meshes:
// - the Statue Room: a stone statue on a plinth for every Zombie Book
//   entry you've met (ZombieBook.js) - an empty plinth for the rest;
// - the Glass Cases: one for each of the EXHIBITS rare finds - it fills
//   with the find (its own picture) the first time one goes in your bag;
// - the Hall of Bosses: a plaque for each of the BOSSES - gold once you've
//   beaten it (a wave boss, a dungeon's Boss Room boss, the dragon), dark
//   until then.
// Rare finds and bosses beaten are kept on this device (KEY). Press Use
// at the museum for a list of everything in it (easier to read, and on a
// phone). Never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { findCampSpot, makeLabel } from './CampTrophies.js'
import { loadBook, BOOK_IDS, bookName } from './ZombieBook.js'
import { itemIconCanvas, itemName } from './PlayInventory.js'
import { openScreen } from './CampScreen.js'

export const KEY = 'gayz-museum'
export const WIDE = 6
const DEEP = 2
const USE_R = 2.2
export const EXHIBITS = ['goldenFish', 'oldBoot', 'treasureMap', 'jetpack', 'metalDetector', 'potionGiant', 'potionInvis', 'candy']
export const BOSSES = ['waveBoss', 'dungeonBoss', 'dragon']
const STATUES_SHOWN = 10

export function loadMuseum() {
  let d
  try {
    d = JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    d = {}
  }
  const list = (v, ok) => (Array.isArray(v) ? [...new Set(v.filter((x) => ok.includes(x)))] : [])
  return { items: list(d?.items, EXHIBITS), bosses: list(d?.bosses, BOSSES) }
}

function save(d) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d))
  } catch { /* not kept */ }
}

// A rare find went in the bag (PlayInventory.add). -> true when it's new.
export function noteItem(id) {
  if (!EXHIBITS.includes(id)) return false
  const d = loadMuseum()
  if (d.items.includes(id)) return false
  d.items.push(id)
  save(d)
  return true
}

// A boss beaten (BuildSurvival, DragonBoss). -> true when it's new.
export function noteBoss(id) {
  if (!BOSSES.includes(id)) return false
  const d = loadMuseum()
  if (d.bosses.includes(id)) return false
  d.bosses.push(id)
  save(d)
  return true
}

export class CampMuseum {
  constructor(camp) {
    this.camp = camp
    this.group = null
    this.spot = null
    this._key = ''
  }

  get B() {
    return this.camp.B
  }

  build(avoid = []) {
    if (this.group) return
    this.spot = findCampSpot(this.camp, WIDE, DEEP, avoid)
    if (!this.spot) return
    this._build()
  }

  // Rebuilt when something new went in (checked now and then, update()).
  _build() {
    const B = this.B
    this.group?.removeFromParent()
    this._dispose()
    const g = new THREE.Group()
    const box = (w, h, d, color, x, y, z, opts = {}) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), new THREE.MeshLambertMaterial({ color, emissive: opts.emissive || 0, transparent: !!opts.opacity, opacity: opts.opacity ?? 1, depthWrite: !opts.opacity }))
      m.position.set(x * B, y * B, z * B)
      g.add(m)
      return m
    }
    const book = loadBook()
    const mus = loadMuseum()
    this._key = `${Object.keys(book).length}|${mus.items.join()}|${mus.bosses.join()}`
    // The hall: back wall, marble floor, columns, roof, sign.
    box(WIDE, 3.4, 0.2, 0xe8e2d4, 0, 1.7, 0.1)
    box(WIDE, 0.06, DEEP, 0xf4f0e8, 0, 0.03, DEEP / 2)
    for (const x of [-WIDE / 2 + 0.2, WIDE / 2 - 0.2]) box(0.3, 3.4, 0.3, 0xd8d0bc, x, 1.7, DEEP - 0.2)
    box(WIDE + 0.4, 0.25, DEEP + 0.4, 0xb8a888, 0, 3.5, DEEP / 2)
    const sign = makeLabel(t('museumSign'), 512, 44, '#ffe9a8')
    sign.scale.set(3.4 * B, 0.6 * B, 1)
    sign.position.set(0, 4.05 * B, (DEEP + 0.2) * B)
    g.add(sign)
    // Statue Room (left third): two rows of little statues.
    const ids = BOOK_IDS.slice(0, STATUES_SHOWN)
    const stone = 0x9a9a9a
    ids.forEach((id, i) => {
      const row = i % 2
      const col = Math.floor(i / 2)
      const x = -WIDE / 2 + 0.4 + col * 0.33
      const z = 0.5 + row * 0.8
      box(0.28, 0.3, 0.28, 0x6a6a6a, x, 0.15, z)
      if (!book[id]) return
      // A stone figure: legs, body, head, arms out.
      box(0.16, 0.22, 0.08, stone, x, 0.41, z)
      box(0.18, 0.22, 0.1, stone, x, 0.63, z)
      box(0.14, 0.14, 0.14, stone, x, 0.81, z)
      box(0.05, 0.05, 0.16, stone, x - 0.11, 0.7, z + 0.08)
      box(0.05, 0.05, 0.16, stone, x + 0.11, 0.7, z + 0.08)
    })
    // Glass Cases (middle): a plinth and a glass box each.
    EXHIBITS.forEach((id, i) => {
      const x = -0.75 + (i % 4) * 0.5
      const z = i < 4 ? 0.5 : 1.3
      box(0.36, 0.8, 0.36, 0x5a4632, x, 0.4, z)
      box(0.34, 0.34, 0.34, 0xbfe8ff, x, 0.97, z, { opacity: 0.25 })
      if (!mus.items.includes(id)) return
      const tex = new THREE.CanvasTexture(itemIconCanvas(id))
      tex.magFilter = THREE.NearestFilter
      tex.colorSpace = THREE.SRGBColorSpace
      const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, alphaTest: 0.5 }))
      icon.scale.setScalar(0.28 * B)
      icon.position.set(x * B, 0.97 * B, z * B)
      g.add(icon)
    })
    // Hall of Bosses (right): plaques on the back wall.
    BOSSES.forEach((id, i) => {
      const x = 1.45 + i * 0.55
      const won = mus.bosses.includes(id)
      box(0.5, 0.8, 0.08, won ? 0xffcf3a : 0x3a3a3a, x, 1.8, 0.25, { emissive: won ? 0x3a2a00 : 0 })
      const lab = makeLabel(won ? t(`museumBoss_${id}`) : '???', 256, 36, won ? '#3a2400' : '#bbbbbb')
      lab.scale.set(0.5 * B, 0.2 * B, 1)
      lab.position.set(x * B, 1.8 * B, 0.31 * B)
      g.add(lab)
    })
    g.position.set(this.spot.x * B, 0, this.spot.z * B)
    g.rotation.y = this.spot.rot
    this.camp.bm.scene.add(g)
    this.group = g
    // Where you stand to use it.
    const c = Math.cos(this.spot.rot)
    const sn = Math.sin(this.spot.rot)
    this.door = { x: this.spot.x + 2 * sn, z: this.spot.z + 2 * c }
  }

  // What's in it, as counts.
  counts() {
    const book = loadBook()
    const mus = loadMuseum()
    return {
      statues: BOOK_IDS.filter((id) => book[id]).length,
      statuesMax: BOOK_IDS.length,
      items: mus.items.length,
      itemsMax: EXHIBITS.length,
      bosses: mus.bosses.length,
      bossesMax: BOSSES.length,
    }
  }

  near() {
    if (!this.group || !this.door) return false
    const p = this.camp.bm.tryMode.pos
    return Math.hypot(p.x - this.door.x, p.z - this.door.z) < USE_R && p.y < 3
  }

  use() {
    if (!this.near()) return false
    const s = this.camp.s
    const book = loadBook()
    const mus = loadMuseum()
    const n = this.counts()
    this.last = openScreen(s, {
      title: t('museumTitle'),
      wide: true,
      build(body) {
        const section = (title, rows) => {
          const h = document.createElement('b')
          h.textContent = title
          const grid = document.createElement('div')
          grid.className = 'museum-list'
          for (const [label, on] of rows) {
            const d = document.createElement('div')
            d.textContent = on ? label : '???'
            if (!on) d.className = 'off'
            grid.appendChild(d)
          }
          body.append(h, grid)
        }
        section(t('museumStatues', { n: n.statues, max: n.statuesMax }), BOOK_IDS.map((id) => [bookName(id), !!book[id]]))
        section(t('museumCases', { n: n.items, max: n.itemsMax }), EXHIBITS.map((id) => [itemName(id), mus.items.includes(id)]))
        section(t('museumBosses', { n: n.bosses, max: n.bossesMax }), BOSSES.map((id) => [t(`museumBoss_${id}`), mus.bosses.includes(id)]))
      },
    })
    return true
  }

  update() {
    if (!this.group) return
    // Something new since it was built: put it in.
    this._checkIn = (this._checkIn || 0) - 1
    if (this._checkIn > 0) return
    this._checkIn = 120
    const book = loadBook()
    const mus = loadMuseum()
    if (`${Object.keys(book).length}|${mus.items.join()}|${mus.bosses.join()}` !== this._key) this._build()
  }

  _dispose() {
    this.group?.traverse((o) => {
      if (!o.isMesh && !o.isSprite) return
      o.geometry?.dispose?.()
      o.material.map?.dispose?.()
      o.material.dispose()
    })
  }

  dispose() {
    if (!this.group) return
    this.group.removeFromParent()
    this._dispose()
    this.group = null
    this.spot = null
    this.door = null
  }
}
