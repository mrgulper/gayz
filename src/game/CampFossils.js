// The Museum's Fossil Hall (2026-11-27, Gaymi's six ideas, batch 3).
// Owned by BuildCamp (`camp.fossils`), solo Play only. The bones and the
// digging are Fossils.js.
//
// Gaymi picked small skeletons that fit in the museum, one for every
// dinosaur (the famous six on the front row). The camp has no free ground
// left (the Pet Races found the same), so the hall is the museum's upper
// wing up in the sky over the camp (HALL_Y), like the race track: real
// blocks (TempBlocks, all put back when you leave) with a glass rim. The
// Museum's screen has a "Visit the Fossil Hall" button; in the hall, Use
// takes you back down to where you were.
//
// Each skeleton is built from its dinosaur's own boxes (DinoKinds.js, the
// same ones PlayAnimals draws), in bone white: skull (head + horns /
// crests), ribs (slats where the body was), spine (a backbone, the neck
// and the body's other bits - plates, wings), legs and tail. A bone not
// found yet is a faint ghost, so you see what's missing. A finished one
// stands on a gold plinth. Meshes only (plus the TempBlocks), never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { makeLabel } from './CampTrophies.js'
import { TempBlocks } from './TempBlocks.js'
import { DINO_KINDS } from './DinoKinds.js'
import { loadFossils, DINO_IDS, FAMOUS, PARTS, isDone, dinoName, digForBone, addBone } from './Fossils.js'

export const HALL_Y = 130 // the hall's floor (the race track is at 160)
const W = 15 // the hall's inside, side to side
const FRONT_STEP = 2.3 // the famous six, this far apart
const BACK_COLS = 7 // the rest: rows of this many
const BACK_STEP = 1.9
const ROW_STEP = 2.4
const FIT_FRONT = 2.1 // a skeleton's longest side, in blocks
const FIT_BACK = 1.5
const BONE = 0xe8e0c8
const sfx = (id) => { try { audioEngine.playSpecial?.(id) } catch { /* no audio */ } }

// One dinosaur's skeleton as boxes: { part, size: [w, h, l], at: [x, y, z],
// rx } (rx tilts the neck), the dinosaur facing +z, feet at y 0.
export function skeletonBoxes(k) {
  const out = []
  const add = (part, size, at, rx = 0) => out.push({ part, size, at, rx })
  const [bw, bh, bl] = k.body
  const [hw, hh, hl] = k.head
  const leg = k.leg
  const [hy, hz] = k.headAt || [leg + bh * 0.75, bl / 2 + hl * 0.35]
  // Skull: the head, a little smaller, with two dark eye holes (added by
  // the hall), and its horns / frills / crests.
  add('skull', [hw * 0.85, hh * 0.85, hl * 0.9], [0, hy, hz])
  // Ribs: slats where the body was.
  const ribs = 5
  for (let i = 0; i < ribs; i++) add('ribs', [bw * 0.9, bh * 0.8, Math.max(0.04, bl * 0.06)], [0, leg + bh * 0.5, -bl * 0.36 + (i * bl * 0.72) / (ribs - 1)])
  // Spine: a backbone along the top, and the neck up to the head.
  add('spine', [Math.max(0.05, bw * 0.15), Math.max(0.05, bh * 0.12), bl * 1.02], [0, leg + bh * 0.94, 0])
  const n0 = [leg + bh * 0.85, bl * 0.45]
  const n1 = [hy - hh * 0.2, hz - hl * 0.35]
  const dy = n1[0] - n0[0]
  const dz = n1[1] - n0[1]
  const nl = Math.hypot(dy, dz)
  if (nl > 0.05) add('spine', [Math.max(0.05, bw * 0.14), Math.max(0.05, bw * 0.14), nl], [0, (n0[0] + n1[0]) / 2, (n0[1] + n1[1]) / 2], -Math.atan2(dy, dz))
  // Legs: thin bones.
  const legs = k.legs ?? 4
  const legW = Math.max(0.04, (k.legW || 0.1) * 0.55)
  const xs = [-(bw / 2) * 0.7, (bw / 2) * 0.7]
  const zs = legs === 2 ? [0] : [-bl / 2 + legW * 2, bl / 2 - legW * 2]
  if (leg > 0.02) for (const z of zs) for (const x of xs) add('legs', [legW, leg, legW], [x, leg / 2, z])
  // The rest of the boxes: head ones on the skull, the ones behind the
  // body are the tail, the ones sticking out elsewhere the spine's (plates,
  // a long neck, wings). Ones inside the body (thick thighs, chests) are
  // flesh, not bone.
  let tail = false
  const bodyMidY = leg + bh / 2
  for (const e of k.extras || []) {
    const sz = e.size.map((n) => Math.max(0.04, n * 0.7))
    if (e.on === 'head') {
      add('skull', sz, [e.at[0], hy + e.at[1], hz + e.at[2]])
      continue
    }
    const [x, y, z] = e.at
    if (Math.abs(x) < bw / 2 && Math.abs(y - bodyMidY) < bh / 2 && Math.abs(z) < bl / 2) continue
    if (z < -bl * 0.3 && Math.abs(x) < bw * 0.4) {
      tail = true
      add('tail', [Math.max(0.04, e.size[0] * 0.35), Math.max(0.04, e.size[1] * 0.35), e.size[2]], [x, y, z])
    } else add('spine', sz, [x, y, z])
  }
  if (!tail) add('tail', [bw * 0.2, bh * 0.2, bl * 0.5], [0, leg + bh * 0.7, -bl * 0.7])
  return out
}

export class CampFossils {
  constructor(camp) {
    this.camp = camp
    this.hall = null // while you're in it
  }

  get B() {
    return this.camp.B
  }

  get s() {
    return this.camp.s
  }

  get inside() {
    return !!this.hall
  }

  // Only in a normal solo game (the hall is each player's own blocks).
  canVisit() {
    const s = this.s
    return !!s?.active && !s.dead && !s.net && !s.party && !s.td && !s.escape && !this.camp.race?.active
  }

  // Where you go back to (BuildSurvival.saveRun keeps this instead of the sky).
  home() {
    return this.hall ? { ...this.hall.home } : null
  }

  // The hall's size and where every skeleton stands (x, z from the
  // hall's front-left corner).
  layout() {
    const back = DINO_IDS.filter((id) => !FAMOUS.includes(id))
    const front = DINO_IDS.filter((id) => FAMOUS.includes(id))
    const spots = []
    front.forEach((id, i) => spots.push({ id, big: true, x: W / 2 + (i - (front.length - 1) / 2) * FRONT_STEP, z: 3.8 }))
    back.forEach((id, i) => {
      const row = Math.floor(i / BACK_COLS)
      const col = i % BACK_COLS
      const inRow = Math.min(BACK_COLS, back.length - row * BACK_COLS)
      spots.push({ id, big: false, x: W / 2 + (col - (inRow - 1) / 2) * BACK_STEP, z: 6.8 + row * ROW_STEP })
    })
    const rows = Math.ceil(back.length / BACK_COLS)
    return { spots, deep: Math.ceil(6.8 + rows * ROW_STEP + 0.5) }
  }

  visit() {
    if (this.hall || !this.canVisit()) return false
    const bm = this.camp.bm
    const tm = bm.tryMode
    const zn = this.camp.zone
    const { spots, deep } = this.layout()
    const ox = Math.floor((zn.x0 + zn.x1) / 2) - Math.floor(W / 2)
    const oz = Math.floor((zn.z0 + zn.z1) / 2) - Math.floor(deep / 2)
    const hall = { ox, oz, deep, home: { x: tm.pos.x, y: tm.pos.y, z: tm.pos.z, yaw: bm._yaw } }
    this.hall = hall
    this._buildRoom(hall)
    this._buildSkeletons(hall, spots)
    this._toEntry()
    this.s._message(t('fossilHallHello'), 3)
    sfx('chime')
    return true
  }

  _toEntry() {
    const { ox, oz } = this.hall
    const bm = this.camp.bm
    bm.tryMode.pos.set(ox + W / 2, HALL_Y + 1, oz + 1.2)
    bm.tryMode.vel?.set(0, 0, 0)
    bm._yaw = Math.PI // looking into the hall (+z)
  }

  // A floor with a walkway, and a glass rim two high so you can't fall off.
  _buildRoom(hall) {
    const cells = (this.cells = new TempBlocks(this.s))
    const { ox, oz, deep } = hall
    const y = HALL_Y
    for (let x = ox; x < ox + W; x++) {
      for (let z = oz; z < oz + deep; z++) cells.put(x, y, z, z < oz + 2 ? 'darkoakplanks' : (x + z) % 2 ? 'smoothquartz' : 'polishedandesite')
    }
    for (let h = 1; h <= 2; h++) {
      for (let x = ox - 1; x <= ox + W; x++) {
        cells.put(x, y + h, oz - 1, 'glass')
        cells.put(x, y + h, oz + deep, 'glass')
      }
      for (let z = oz; z < oz + deep; z++) {
        cells.put(ox - 1, y + h, z, 'glass')
        cells.put(ox + W, y + h, z, 'glass')
      }
    }
  }

  _buildSkeletons(hall, spots) {
    const B = this.B
    const found = loadFossils()
    const g = new THREE.Group()
    const mats = {
      bone: new THREE.MeshLambertMaterial({ color: BONE }),
      ghost: new THREE.MeshLambertMaterial({ color: BONE, transparent: true, opacity: 0.13, depthWrite: false }),
      hole: new THREE.MeshLambertMaterial({ color: 0x2a2420 }),
      plinth: new THREE.MeshLambertMaterial({ color: 0x5a4632 }),
      gold: new THREE.MeshLambertMaterial({ color: 0xffcf3a, emissive: 0x3a2a00 }),
    }
    this._mats = mats
    const box = (parent, [w, h, d], [x, y, z], mat, rx = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
      m.position.set(x, y, z)
      m.rotation.x = rx
      parent.add(m)
      return m
    }
    // The hall's sign over the entrance.
    const sign = makeLabel(t('fossilHallSign'), 512, 44, '#ffe9a8')
    sign.scale.set(4 * B, 0.7 * B, 1)
    sign.position.set((hall.ox + W / 2) * B, (HALL_Y + 4.2) * B, (hall.oz + hall.deep - 0.5) * B)
    g.add(sign)
    for (const sp of spots) {
      const k = DINO_KINDS[sp.id]
      if (!k) continue
      const have = found[sp.id] || []
      const done = isDone(found, sp.id)
      const pw = sp.big ? 1.2 : 0.9
      const ph = 0.2
      const cx = (hall.ox + sp.x) * B
      const cz = (hall.oz + sp.z) * B
      const base = (HALL_Y + 1) * B
      box(g, [pw * B, ph * B, pw * B], [cx, base + (ph / 2) * B, cz], done ? mats.gold : mats.plinth)
      // The skeleton, scaled to fit and turned side-on (head to the right).
      const parts = skeletonBoxes(k)
      let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity; let z0 = Infinity; let z1 = -Infinity
      for (const b of parts) {
        x0 = Math.min(x0, b.at[0] - b.size[0] / 2); x1 = Math.max(x1, b.at[0] + b.size[0] / 2)
        y0 = Math.min(y0, b.at[1] - b.size[1] / 2); y1 = Math.max(y1, b.at[1] + b.size[1] / 2)
        z0 = Math.min(z0, b.at[2] - b.size[2] / 2); z1 = Math.max(z1, b.at[2] + b.size[2] / 2)
      }
      const fit = (sp.big ? FIT_FRONT : FIT_BACK) / Math.max(z1 - z0, y1 - y0, (x1 - x0) * 1.4, 0.01)
      const sk = new THREE.Group()
      for (const b of parts) {
        const on = have.includes(b.part)
        box(sk, b.size, b.at, on ? mats.bone : mats.ghost, b.rx)
      }
      // Eye holes on a found skull.
      if (have.includes('skull')) {
        const [hw, hh, hl] = k.head
        const [hy, hz] = k.headAt || [k.leg + k.body[1] * 0.75, k.body[2] / 2 + hl * 0.35]
        const e = Math.max(0.04, hh * 0.2)
        for (const sx of [-1, 1]) box(sk, [e * 0.4, e, e], [sx * hw * 0.43, hy + hh * 0.12, hz + hl * 0.2], mats.hole)
      }
      sk.scale.setScalar(fit * B)
      sk.rotation.y = Math.PI / 2
      sk.position.set(cx - ((z0 + z1) / 2) * fit * B, base + ph * B - y0 * fit * B, cz + ((x0 + x1) / 2) * fit * B)
      g.add(sk)
      // Its name (??? until a bone is found) and how many bones.
      const label = have.length ? `${dinoName(sp.id)} ${have.length}/${PARTS.length}` : `??? 0/${PARTS.length}`
      const lab = makeLabel(label, 384, 34, done ? '#ffd23f' : '#ffffff')
      lab.scale.set((sp.big ? 1.9 : 1.6) * B, (sp.big ? 0.26 : 0.22) * B, 1)
      lab.position.set(cx, base + (ph + (sp.big ? FIT_FRONT : FIT_BACK) + 0.35) * B, cz)
      g.add(lab)
    }
    this.camp.bm.scene.add(g)
    this.group = g
  }

  // Use while in the hall: back down.
  use() {
    if (!this.hall) return false
    this.leave()
    return true
  }

  update() {
    if (!this.hall) return
    const s = this.s
    if (!s.active || s.dead) {
      this.leave(false)
      return
    }
    // Fell off somehow (broke the floor): back to the entrance.
    if (this.camp.bm.tryMode.pos.y < HALL_Y - 2) this._toEntry()
  }

  leave(goHome = true) {
    const hall = this.hall
    if (!hall) return
    this.hall = null
    this._disposeGroup()
    this.cells?.restore()
    this.cells = null
    if (goHome) {
      const bm = this.camp.bm
      bm.tryMode.pos.set(hall.home.x, hall.home.y, hall.home.z)
      bm.tryMode.vel?.set(0, 0, 0)
      bm._yaw = hall.home.yaw
    }
  }

  _disposeGroup() {
    if (!this.group) return
    this.group.removeFromParent()
    this.group.traverse((o) => {
      if (o.isMesh) o.geometry.dispose()
      if (o.isSprite) {
        o.material.map?.dispose()
        o.material.dispose()
      }
    })
    for (const m of Object.values(this._mats || {})) m.dispose()
    this._mats = null
    this.group = null
  }

  dispose() {
    this.leave(false)
  }
}

// The digging, for tests driving the built game (`camp.fossils.lib`).
CampFossils.prototype.lib = { digForBone, addBone, loadFossils, DINO_IDS }
