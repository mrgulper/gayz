// The Map Editor's working blocks (2026-10-04): levers and pressure plates
// that open the doors around them, and signs you write on that glow in the
// dark. Owned by BuildMode (`buildMode.gadgets`), which calls onPlace/
// onRemove for every one of these blocks and asks matrixAt() how to draw
// it.
//
// - Lever: right-click it (or E while trying the map) to flip it. On opens
//   every door within LINK_RANGE blocks, off closes them. Saved on/off.
// - Pressure Plate: stepping on one while trying the map (or playing)
//   opens the doors within LINK_RANGE; they close again a moment after you
//   step off.
// - Glowing Sign: asks what to write when placed; right-click it while
//   building to change the words. The writing glows, so it reads at
//   night too.
//
// Every one of these also faces a way (like stairs), kept in BuildMode's
// _stairFacing map; this file keeps the rest of their state.
import * as THREE from 'three'
import { t } from './i18n.js'

export const LINK_RANGE = 8 // blocks from a lever/plate to the doors it opens
export const SIGN_MAX_CHARS = 40
const PLATE_RELEASE = 0.8 // seconds a plate stays down after you step off

export function cleanSignText(text) {
  return [...String(text ?? '')].map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c)).join('').trim().slice(0, SIGN_MAX_CHARS)
}

export class BuildGadgets {
  constructor(buildMode, blockSize) {
    this.bm = buildMode
    this.B = blockSize
    this.leverOn = new Set()
    this.signText = new Map()
    this._plateDown = new Map() // key -> seconds left before it pops back up
    this._signMeshes = new Map()
    this._signGroup = new THREE.Group()
    buildMode.worldRoot.add(this._signGroup)
    this._m = new THREE.Matrix4()
    this._q = new THREE.Quaternion()
    this._up = new THREE.Vector3(0, 1, 0)
  }

  _typeAt(key) {
    return this.bm._blocks.get(key)
  }

  // What gets saved / copied / put back by undo for a faced block.
  stateOf(key) {
    const state = { facing: this.bm._stairFacing.get(key) || 0 }
    if (this.leverOn.has(key)) state.open = true
    if (this.signText.has(key)) state.text = this.signText.get(key)
    return state
  }

  onPlace(key, x, y, z, type, state) {
    if (type === 'lever' && state?.open) this.leverOn.add(key)
    if (type === 'sign') {
      this.signText.set(key, cleanSignText(state?.text))
      this._buildSignText(key, x, y, z)
    }
  }

  onRemove(key) {
    this.leverOn.delete(key)
    this._plateDown.delete(key)
    this.signText.delete(key)
    this.onRemoveMeshOnly(key)
  }

  clear() {
    for (const key of [...this._signMeshes.keys()]) this.onRemove(key)
    this.leverOn.clear()
    this.signText.clear()
    this._plateDown.clear()
  }

  // Where and how a faced block is drawn: turned to its facing, a lever
  // that's on turned the other way (so its stick leans the other side), a
  // plate that's stood on pressed down.
  matrixAt(key, x, y, z, shape) {
    const B = this.B
    const f = this.bm._stairFacing.get(key) || 0
    const on = shape === 'lever' && this.leverOn.has(key)
    this._q.setFromAxisAngle(this._up, f * (Math.PI / 2) + (on ? Math.PI : 0))
    const down = shape === 'pad' && this._plateDown.has(key)
    const pos = new THREE.Vector3((x + 0.5) * B, (y + 0.5) * B - (down ? B / 64 : 0), (z + 0.5) * B)
    return new THREE.Matrix4().compose(pos, this._q, new THREE.Vector3(1, down ? 0.5 : 1, 1))
  }

  _refreshMatrix(key) {
    const bm = this.bm
    const type = this._typeAt(key)
    const mesh = type && bm._instancedMeshes[type]
    const index = mesh ? bm._instanceKeyByIndex[type].indexOf(key) : -1
    if (index < 0) return
    const [x, y, z] = key.split(',').map(Number)
    const shape = mesh && type && this.bm.constructor.blockShape(type)
    mesh.setMatrixAt(index, this.matrixAt(key, x, y, z, shape))
    mesh.instanceMatrix.needsUpdate = true
    bm._shadowsDirty = true
  }

  // Right-click (building) / E or right-click (trying) on a block: flips a
  // lever, or - while building - rewrites a sign. True if it was one.
  use(x, y, z, trying) {
    const key = this.bm._key(x, y, z)
    const type = this._typeAt(key)
    if (type === 'lever') {
      this.setLever(x, y, z, !this.leverOn.has(key))
      return true
    }
    if (type === 'sign' && !trying) {
      const text = window.prompt(t('buildSignPrompt'), this.signText.get(key) || '')
      if (text !== null) this.setSignText(x, y, z, text)
      return true
    }
    return false
  }

  setLever(x, y, z, on) {
    const key = this.bm._key(x, y, z)
    if (this._typeAt(key) !== 'lever') return
    if (on) this.leverOn.add(key)
    else this.leverOn.delete(key)
    this._refreshMatrix(key)
    this.bm.together?.record(['l', x, y, z, on])
    // Doors it opens are sent as their own changes (toggleDoor).
    this.setDoorsNear(x, y, z, on)
    this.bm._scheduleAutosave()
  }

  setSignText(x, y, z, text) {
    const key = this.bm._key(x, y, z)
    if (this._typeAt(key) !== 'sign') return
    this.signText.set(key, cleanSignText(text))
    this.bm.together?.record(['s', x, y, z, this.signText.get(key)])
    this.onRemoveMeshOnly(key)
    this._buildSignText(key, x, y, z)
    this.bm._scheduleAutosave()
  }

  onRemoveMeshOnly(key) {
    const mesh = this._signMeshes.get(key)
    if (!mesh) return
    this._signGroup.remove(mesh)
    mesh.material.map?.dispose()
    mesh.material.dispose()
    mesh.geometry.dispose()
    this._signMeshes.delete(key)
  }

  // Opens (or closes) every door whose bottom half is within LINK_RANGE.
  // A door that would shut on the player stays open.
  setDoorsNear(x, y, z, open) {
    const bm = this.bm
    let changed = 0
    for (const [key, state] of bm._doorState) {
      const [dx, dy, dz] = key.split(',').map(Number)
      if (bm.constructor.blockShape(bm._blocks.get(key)) !== 'door') continue
      if (Math.hypot(dx - x, dy - y, dz - z) > LINK_RANGE || state.open === open) continue
      bm.toggleDoor(dx, dy, dz)
      if (!open && bm.tryMode.active && bm.tryMode.overlapsSolid()) bm.toggleDoor(dx, dy, dz)
      else changed++
    }
    return changed
  }

  // Each frame while trying/playing: cells someone is standing in (the
  // player's feet, zombies' feet). A plate stepped on goes down and opens
  // its doors; one left alone pops back up and closes them.
  updatePlates(cells, dt) {
    const bm = this.bm
    const stood = new Set()
    for (const [x, y, z] of cells) {
      const key = bm._key(x, y, z)
      if (this._typeAt(key) === 'pressureplate') stood.add(key)
    }
    for (const key of stood) {
      const wasDown = this._plateDown.has(key)
      this._plateDown.set(key, PLATE_RELEASE)
      if (!wasDown) {
        this._refreshMatrix(key)
        const [x, y, z] = key.split(',').map(Number)
        this.setDoorsNear(x, y, z, true)
      }
    }
    for (const [key, left] of this._plateDown) {
      if (stood.has(key)) continue
      if (left - dt > 0) {
        this._plateDown.set(key, left - dt)
        continue
      }
      this._plateDown.delete(key)
      this._refreshMatrix(key)
      if (this._typeAt(key) !== 'pressureplate') continue
      const [x, y, z] = key.split(',').map(Number)
      this.setDoorsNear(x, y, z, false)
    }
  }

  // Leaving Try Map: plates pop back up and close their doors.
  releasePlates() {
    this.updatePlates([], Infinity)
  }

  // The writing on a sign's front: its own little glowing picture.
  _buildSignText(key, x, y, z) {
    const text = this.signText.get(key)
    if (!text) return
    const B = this.B
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffe9a8'
    ctx.shadowColor = 'rgba(255, 200, 90, 0.9)'
    ctx.shadowBlur = 10
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // Wrap into up to three lines, as big as fits.
    const words = text.split(/\s+/)
    let size = 44
    let lines
    for (; size >= 18; size -= 2) {
      ctx.font = `bold ${size}px sans-serif`
      lines = ['']
      for (const w of words) {
        const next = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${w}` : w
        if (ctx.measureText(next).width <= 236) lines[lines.length - 1] = next
        else lines.push(w)
      }
      if (lines.length <= 3 && lines.every((l) => ctx.measureText(l).width <= 236)) break
    }
    lines = lines.slice(0, 3)
    const lh = size * 1.1
    lines.forEach((line, i) => ctx.fillText(line, 128, 64 + (i - (lines.length - 1) / 2) * lh))
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })
    const u = B / 16
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(13 * u, 6.5 * u), mat)
    const f = this.bm._stairFacing.get(key) || 0
    const angle = f * (Math.PI / 2)
    // In front of the board's -z face, turned with the sign.
    const off = 0.76 * u + 0.002
    mesh.position.set((x + 0.5) * B - Math.sin(angle) * off, y * B + 12 * u, (z + 0.5) * B - Math.cos(angle) * off)
    mesh.rotation.y = angle + Math.PI
    this._signGroup.add(mesh)
    this._signMeshes.set(key, mesh)
  }
}
