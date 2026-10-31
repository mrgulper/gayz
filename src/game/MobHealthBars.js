// Health bars over zombies and animals (2026-10-31, Gaymi: "add a health
// bar for everything zombies animals etc"; picked "only after it's hit"):
// a small bar just under the name tag that shows for SHOW_S seconds after
// its health drops, then fades. It watches health each frame instead of
// hooking every way of getting hurt (guns, fire, spikes, the host's hits on
// a server...), so any new mob only needs adding to mobs() below.
// Owned by BuildSurvival (`s.hpBars`), stepped from its update().
import * as THREE from 'three'
import { PlayAnimals } from './PlayAnimals.js'

const SHOW_S = 3
// The bar's picture, in pixels (a dark frame round the coloured part).
const PX_W = 64
const PX_H = 10
const FADE_S = 0.5
// The bar's width next to the name tag's, and its height next to its width.
const TAG_SHARE = 0.8
const THICK = PX_H / PX_W
// Without a name tag: this wide (blocks) and this far over the group.
const PLAIN_W = 0.9
const PLAIN_UP = 2.3
const GREEN = '#4ccf4c'
const YELLOW = '#e8c440'
const RED = '#e04a3a'

function colorFor(left) {
  if (left > 0.5) return GREEN
  return left > 0.25 ? YELLOW : RED
}

// Redrawn only when the filled width changes by a pixel.
function draw(bar, left) {
  const px = Math.round((PX_W - 4) * left)
  if (px === bar.px) return
  bar.px = px
  const g = bar.ctx
  g.clearRect(0, 0, PX_W, PX_H)
  g.fillStyle = 'rgba(10, 10, 10, 0.75)'
  g.fillRect(0, 0, PX_W, PX_H)
  g.fillStyle = colorFor(left)
  g.fillRect(2, 2, px, PX_H - 4)
  bar.tex.needsUpdate = true
}

export class MobHealthBars {
  constructor(survival) {
    this.s = survival
    // Mobs with a bar showing right now.
    this.shown = new Set()
  }

  // Every mob that can have a bar: { m, hp, max, group, tag, off }.
  *mobs() {
    const s = this.s
    for (const z of s.zombies || []) {
      yield { m: z, hp: z.health, max: z.maxHealth || z.health, group: z.group, tag: z.tag, off: z.hidden || z.health <= 0 }
    }
    for (const a of s.animals?.list || []) {
      const max = a.maxHealth || PlayAnimals.KINDS[a.kind]?.health || a.health
      yield { m: a, hp: a.health, max, group: a.group, tag: a.tag, off: a.tamed || a.dying || a.health <= 0 }
    }
  }

  update(dt) {
    const B = this.s.B
    const live = new Set()
    for (const o of this.mobs()) {
      const { m } = o
      if (!m || !o.group) continue
      live.add(m)
      const last = m._hpLast
      m._hpLast = o.hp
      if (last !== undefined && o.hp < last - 0.01 && !o.off) m._hpShow = SHOW_S
      if (!(m._hpShow > 0)) continue
      m._hpShow -= dt
      if (m._hpShow <= 0 || o.off) {
        this._hide(m)
        continue
      }
      const bar = m._hpBar || this._make(m, o.group)
      const left = Math.max(0, Math.min(1, o.hp / (o.max || 1)))
      const w = o.tag ? o.tag.scale.x * TAG_SHARE : PLAIN_W * B
      const h = w * THICK
      bar.sprite.position.set(0, o.tag ? o.tag.position.y - h * 0.15 : PLAIN_UP * B, 0)
      bar.sprite.scale.set(w, h, 1)
      bar.sprite.material.opacity = Math.min(1, m._hpShow / FADE_S)
      draw(bar, left)
    }
    // Gone from the game (caught, killed, despawned) with its bar up.
    for (const m of this.shown) if (!live.has(m)) this._hide(m)
  }

  _make(m, group) {
    const cv = document.createElement('canvas')
    cv.width = PX_W
    cv.height = PX_H
    const tex = new THREE.CanvasTexture(cv)
    tex.magFilter = THREE.NearestFilter
    tex.colorSpace = THREE.SRGBColorSpace
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
    // Hangs just under the name tag.
    sprite.center.set(0.5, 1)
    sprite.renderOrder = 6
    group.add(sprite)
    m._hpBar = { sprite, tex, ctx: cv.getContext('2d'), px: -1 }
    this.shown.add(m)
    return m._hpBar
  }

  _hide(m) {
    m._hpShow = 0
    const bar = m._hpBar
    if (bar) {
      bar.sprite.removeFromParent()
      bar.sprite.material.dispose()
      bar.tex.dispose()
      m._hpBar = null
    }
    this.shown.delete(m)
  }

  clear() {
    for (const m of [...this.shown]) this._hide(m)
  }
}
