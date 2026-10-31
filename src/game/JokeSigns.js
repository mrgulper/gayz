// Joke signs out in the open world (2026-10-31, Gaymi's funny update:
// "Zombie-free zone" with tiny print: "not really"). Now and then a little
// wooden signpost stands on dry land a short walk ahead of you, facing
// you, with a big line and a small-print punchline. At most MAX_SIGNS at
// a time; ones left far behind go, so new ones keep turning up.
//
// Owned by BuildSurvival (`s.signs`), stepped from its update(). Each
// player sees their own (they're scenery, nothing to sync). Meshes only,
// never a light; the post and board shapes are shared, each sign's
// picture and materials are its own (freed when it goes).
//
// i18n: jokeSign1..N (the big line) and jokeSignSmall1..N (the small print).
import * as THREE from 'three'
import { t } from './i18n.js'

export const JOKE_SIGN_COUNT = 12
const MAX_SIGNS = 3
const LOOK_EVERY_S = 4
const PLACE_CHANCE = 0.35 // per look, when there's room for one more
const NEAR = 22 // blocks from you
const FAR = 40
const DESPAWN = 120
const FONT = '"Luckiest Guy", "Bebas Neue", sans-serif'

let postGeo = null
let boardGeo = null
let woodMat = null

function signPicture(big, small) {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const g = c.getContext('2d')
  // Planks.
  g.fillStyle = '#c4935a'
  g.fillRect(0, 0, 256, 128)
  g.fillStyle = '#b07f48'
  for (const y of [42, 86]) g.fillRect(0, y, 256, 3)
  g.strokeStyle = '#7a5530'
  g.lineWidth = 8
  g.strokeRect(4, 4, 248, 120)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#3a2412'
  g.font = `34px ${FONT}`
  g.fillText(big, 128, 54, 228)
  g.font = `20px ${FONT}`
  g.fillText(small, 128, 98, 228)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

export class JokeSigns {
  constructor(survival) {
    this.s = survival
    this.list = []
    this._lookIn = 2
    // The cartoony font for the pictures (fonts.css); plain bold until it
    // has loaded.
    try { document.fonts?.load(`34px ${FONT}`) } catch { /* no font api */ }
  }

  clear() {
    for (const sign of [...this.list]) this._remove(sign)
  }

  update(dt) {
    const s = this.s
    if (!s.bm.world?.active) return
    this._lookIn -= dt
    if (this._lookIn > 0) return
    this._lookIn = LOOK_EVERY_S
    const me = s.bodyPos()
    for (const sign of [...this.list]) {
      if (Math.hypot(sign.x - me.x, sign.z - me.z) > DESPAWN) this._remove(sign)
    }
    if (this.list.length < MAX_SIGNS && Math.random() < PLACE_CHANCE) this._place(me)
  }

  _place(me) {
    const s = this.s
    const ang = Math.random() * Math.PI * 2
    const d = NEAR + Math.random() * (FAR - NEAR)
    const x = me.x + Math.cos(ang) * d
    const z = me.z + Math.sin(ang) * d
    const y = s._groundUnder(x, me.y + 24, z)
    if (!Number.isFinite(y) || Math.abs(y - me.y) > 16) return
    if (s.bm._cellIsLiquid(Math.floor(x), Math.floor(y - 0.5), Math.floor(z))) return
    // Not in someone's camp.
    if (s.camp?.inside?.(x, z, 2)) return
    const n = 1 + Math.floor(Math.random() * JOKE_SIGN_COUNT)
    this.list.push(this._build(x, y, z, Math.atan2(me.x - x, me.z - z), t(`jokeSign${n}`), t(`jokeSignSmall${n}`)))
  }

  _build(x, y, z, facing, big, small) {
    const B = this.s.B
    if (!postGeo) {
      postGeo = new THREE.BoxGeometry(0.14, 1.2, 0.14)
      postGeo.translate(0, 0.6, 0)
      boardGeo = new THREE.BoxGeometry(1.6, 0.8, 0.08)
      woodMat = new THREE.MeshLambertMaterial({ color: 0x8a6034 })
    }
    const tex = signPicture(big, small)
    const face = new THREE.MeshLambertMaterial({ map: tex })
    const group = new THREE.Group()
    const post = new THREE.Mesh(postGeo, woodMat)
    const board = new THREE.Mesh(boardGeo, [woodMat, woodMat, woodMat, woodMat, face, face])
    board.position.y = 1.35
    // A little crooked, like someone put it up in a hurry.
    board.rotation.z = (Math.random() - 0.5) * 0.16
    group.add(post, board)
    group.scale.setScalar(B)
    group.position.set(x * B, y * B, z * B)
    group.rotation.y = facing
    this.s.bm.scene.add(group)
    return { group, x, z, tex, face }
  }

  _remove(sign) {
    this.s.bm.scene.remove(sign.group)
    sign.tex.dispose()
    sign.face.dispose()
    this.list = this.list.filter((o) => o !== sign)
  }
}
