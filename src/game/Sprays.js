// Spray tags (2026-11-01, Gaymi's idea list: "players spray their own
// doodle or sticker on walls"; Gaymi picked "draw your own"). Draw a
// 16 x 16 picture in the pause screen's Spray Paint (PlayPauseMenu.js,
// kept in localStorage SPRAY_KEY), then press the Spray key (Y, Settings >
// Controls) - or the spray-can touch button on a phone - looking at a block
// up to REACH blocks away: your picture goes on that side of it. You keep
// your last MAX_SPRAYS; a new one takes the oldest one's place. They go
// when the block under them is broken, and when the game ends.
//
// On a server everyone sees them: your picture (`p`, SPRAY_SIZE^2 hex
// digits, 0 = see-through) and where they are (`s`, cell + side) ride
// along with your position (PlayNet state `spray`, cleaned by
// api/_lib/servers.js cleanSpray). Others' sprays hide with Settings >
// Controls > Show Other Players' Sprays off, and a muted player's
// (Settings > Social > Muted Players) never show.
//
// Owned by BuildSurvival (`s.sprays`). Meshes only, never a light; each
// spray's texture and material are its own (freed when it goes).
import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

export const SPRAY_KEY = 'gayz-spray-v1'
export const SPRAY_SIZE = 16
export const MAX_SPRAYS = 3
const REACH = 6
const COOLDOWN_S = 1
const CHECK_S = 1 // how often sprays look for their block being gone
// Index 0 is see-through; the rest are the paint colours.
export const SPRAY_COLORS = ['', '#111111', '#ffffff', '#e8483a', '#ff9f1c', '#ffd23f', '#6fc23a', '#2bb3a3', '#3a8ee8', '#3a3ab8', '#a35ce8', '#ff6fb5', '#8a5a2a', '#9aa0a8', '#4a4a4a', '#b8f06a']
// The sides of a block: +x, -x, +y, -y, +z, -z.
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
const SPRAY_RE = new RegExp(`^[0-9a-f]{${SPRAY_SIZE * SPRAY_SIZE}}$`)

export const validSpray = (p) => typeof p === 'string' && SPRAY_RE.test(p)

// A yellow smiley, until you draw your own.
const DEFAULT_ROWS = [
  '................',
  '.....555555.....',
  '...5555555555...',
  '..555555555555..',
  '.55555555555555.',
  '.55511555511555.',
  '5555115555115555',
  '5555555555555555',
  '5555555555555555',
  '5551555555551555',
  '.55511555511555.',
  '.55551111115555.',
  '..555555555555..',
  '...5555555555...',
  '.....555555.....',
  '................',
]
export const DEFAULT_SPRAY = DEFAULT_ROWS.join('').replace(/\./g, '0')

export function loadSpray() {
  try {
    const p = localStorage.getItem(SPRAY_KEY)
    return validSpray(p) ? p : DEFAULT_SPRAY
  } catch {
    return DEFAULT_SPRAY
  }
}

export function saveSpray(p) {
  if (!validSpray(p)) return
  try {
    localStorage.setItem(SPRAY_KEY, p)
  } catch {
    // Storage blocked - it lasts for this visit only.
  }
}

// The picture on a canvas, one pixel per square (scale: pixels per square).
export function sprayCanvas(p, scale = 1, canvas = document.createElement('canvas')) {
  canvas.width = canvas.height = SPRAY_SIZE * scale
  const g = canvas.getContext('2d')
  g.clearRect(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < SPRAY_SIZE * SPRAY_SIZE; i++) {
    const c = SPRAY_COLORS[parseInt(p[i], 16)]
    if (!c) continue
    g.fillStyle = c
    g.fillRect((i % SPRAY_SIZE) * scale, Math.floor(i / SPRAY_SIZE) * scale, scale, scale)
  }
  return canvas
}

// Where sprays are, from the network: up to MAX_SPRAYS { x, y, z, f }.
export function cleanSpots(list) {
  if (!Array.isArray(list)) return []
  return list.slice(0, MAX_SPRAYS).filter((d) => d && [d.x, d.y, d.z].every(Number.isInteger) && Number.isInteger(d.f) && d.f >= 0 && d.f < SIDES.length).map((d) => ({ x: d.x, y: d.y, z: d.z, f: d.f }))
}

export class Sprays {
  constructor(survival) {
    this.s = survival
    this.mine = [] // { x, y, z, f, mesh }
    this.remote = new Map() // pid -> { key, list: [{ x, y, z, f, mesh }] }
    this._cool = 0
    this._check = CHECK_S
    this._pic = loadSpray()
  }

  get B() {
    return this.s.B
  }

  // The picture changed in Spray Paint: my sprays repaint.
  setPicture(p) {
    if (!validSpray(p)) return
    this._pic = p
    for (const sp of this.mine) this._paint(sp.mesh, p)
  }

  // The Spray key: my picture on the block I'm looking at.
  spray() {
    const s = this.s
    if (!s.active || s.dead || this._cool > 0) return false
    const bm = s.bm
    bm.camera.updateMatrixWorld()
    bm._raycaster.setFromCamera({ x: 0, y: 0 }, bm.camera)
    const hit = bm._raycastGridAligned()
    if (!hit?.placeAt || hit.t > REACH * this.B) {
      s._message(t('sprayNeedWall'))
      return false
    }
    const [x, y, z] = hit.existingBlock
    const n = hit.placeAt.map((v, i) => v - hit.existingBlock[i])
    const f = SIDES.findIndex((d) => d[0] === n[0] && d[1] === n[1] && d[2] === n[2])
    if (f < 0) return false
    // Spraying the same spot again just repaints it.
    const same = this.mine.findIndex((sp) => sp.x === x && sp.y === y && sp.z === z && sp.f === f)
    if (same >= 0) this._drop(this.mine.splice(same, 1)[0])
    while (this.mine.length >= MAX_SPRAYS) this._drop(this.mine.shift())
    this.mine.push({ x, y, z, f, mesh: this._mesh(x, y, z, f, this._pic) })
    this._cool = COOLDOWN_S
    try { audioEngine.playSpecial?.('whoosh') } catch { /* no audio */ }
    return true
  }

  // For PlayNet's state: my picture and where my sprays are (null: none).
  snapshot() {
    if (!this.mine.length) return null
    return { p: this._pic, s: this.mine.map(({ x, y, z, f }) => ({ x, y, z, f })) }
  }

  // After each server sync: everyone else's sprays (players: PlayNet's
  // Map of pid -> { nick, spray }).
  syncRemote(players) {
    const settings = this.s.bm.game?.settings
    const showAll = settings?.showOtherSprays !== false
    const muted = settings?.mutedChatPlayers || []
    for (const [pid, p] of players) {
      const data = showAll && !muted.includes(p.nick) && p.spray && validSpray(p.spray.p) ? p.spray : null
      const list = data ? cleanSpots(data.s) : []
      const key = data ? `${data.p}|${list.map((d) => `${d.x},${d.y},${d.z},${d.f}`).join(';')}` : ''
      const had = this.remote.get(pid)
      if ((had?.key || '') === key) continue
      if (had) for (const sp of had.list) this._drop(sp)
      if (!key) {
        this.remote.delete(pid)
        continue
      }
      this.remote.set(pid, { key, list: list.map((d) => ({ ...d, mesh: this._mesh(d.x, d.y, d.z, d.f, data.p) })) })
    }
    for (const pid of [...this.remote.keys()]) if (!players.has(pid)) this.dropRemote(pid)
  }

  // A player left the server.
  dropRemote(pid) {
    const had = this.remote.get(pid)
    if (!had) return
    for (const sp of had.list) this._drop(sp)
    this.remote.delete(pid)
  }

  update(dt) {
    if (this._cool > 0) this._cool -= dt
    this._check -= dt
    if (this._check > 0) return
    this._check = CHECK_S
    // The block under a spray is gone: so is the spray.
    const bm = this.s.bm
    const gone = (sp) => !bm.getBlockAt(sp.x, sp.y, sp.z)
    for (const sp of this.mine.filter(gone)) this._drop(sp)
    this.mine = this.mine.filter((sp) => sp.mesh)
    for (const r of this.remote.values()) {
      for (const sp of r.list.filter(gone)) this._drop(sp)
      r.list = r.list.filter((sp) => sp.mesh)
    }
  }

  _mesh(x, y, z, f, p) {
    const B = this.B
    const tex = new THREE.CanvasTexture(sprayCanvas(p))
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.colorSpace = THREE.SRGBColorSpace
    const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.92 * B, 0.92 * B), mat)
    const [nx, ny, nz] = SIDES[f]
    mesh.position.set((x + 0.5 + nx * 0.505) * B, (y + 0.5 + ny * 0.505) * B, (z + 0.5 + nz * 0.505) * B)
    if (ny) {
      // On a floor or ceiling: upright for whoever looks down at it from the south.
      mesh.rotation.x = -ny * Math.PI / 2
    } else {
      mesh.lookAt(mesh.position.x + nx, mesh.position.y, mesh.position.z + nz)
    }
    this.s.bm.scene.add(mesh)
    return mesh
  }

  _paint(mesh, p) {
    if (!mesh) return
    const old = mesh.material.map
    const tex = new THREE.CanvasTexture(sprayCanvas(p))
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.colorSpace = THREE.SRGBColorSpace
    mesh.material.map = tex
    mesh.material.needsUpdate = true
    old?.dispose()
  }

  _drop(sp) {
    const m = sp?.mesh
    if (!m) return
    sp.mesh = null
    m.removeFromParent()
    m.geometry.dispose()
    m.material.map?.dispose()
    m.material.dispose()
  }

  clear() {
    for (const sp of this.mine) this._drop(sp)
    this.mine = []
    for (const pid of [...this.remote.keys()]) this.dropRemote(pid)
    this._cool = 0
  }
}
