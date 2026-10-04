// Map Editor building tools that work on a whole area at once (2026-10-04):
// Fill, Replace and the shape tools (wall, floor, box, circle, ball), plus
// turning a copied selection before pasting it. Owned by BuildMode
// (`buildMode.tools`); a right-click goes to click() while one is on.
//
// Every tool is two right-clicks: the first marks a corner (or a circle's
// center), the second finishes it. A gold box shows the area in between
// while you aim. Each action is one Undo (BuildMode._undoGroupDo).
//
// - Fill puts the held block in every empty cell of the box.
// - Replace swaps every block of the kind you first clicked, inside the
//   box, for the held block.
// - Wall: a wall from the first corner to the second, as high as the gap
//   between them (works on a slant too).
// - Floor: a flat rectangle at the first corner's height.
// - Box: a hollow box, walls/floor/roof only.
// - Circle: a flat ring around the first click, out to the second.
// - Ball: a hollow ball around the first click, out to the second.
import * as THREE from 'three'
import { t } from './i18n.js'

export const SHAPE_TOOLS = ['wall', 'floor', 'box', 'circle', 'ball']
export const AREA_TOOLS = ['fill', 'replace', ...SHAPE_TOOLS]
// A bigger area would freeze the page for a while - asked to make it
// smaller instead.
export const MAX_TOOL_CELLS = 40000
const MAX_RADIUS = 40

export class BuildTools {
  constructor(buildMode, blockSize) {
    this.bm = buildMode
    this.B = blockSize
    this.mode = null // one of AREA_TOOLS, or null
    this._start = null
    this._replaceFrom = null
    const geo = new THREE.BoxGeometry(1, 1, 1)
    geo.translate(0.5, 0.5, 0.5)
    this._box = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffcf5c, depthTest: false, transparent: true }))
    this._box.renderOrder = 10
    this._box.visible = false
    buildMode.scene.add(this._box)
    this._hintEl = document.getElementById('build-tool-hint')
  }

  // Turns a tool on (or off, if it's already on). Line and Copy are
  // switched off, since right-click can only mean one thing at a time.
  setMode(mode) {
    this.mode = this.mode === mode ? null : mode
    this._start = null
    this._replaceFrom = null
    const bm = this.bm
    if (this.mode) {
      if (bm.lineToolMode) bm.toggleLineTool()
      if (bm.copyToolMode) bm.toggleCopyTool()
    }
    this._syncButtons()
    this.refreshHint()
  }

  // G: wall -> floor -> box -> circle -> ball -> off.
  cycleShape() {
    const i = SHAPE_TOOLS.indexOf(this.mode)
    if (i === SHAPE_TOOLS.length - 1) this.setMode(this.mode)
    else this.setMode(SHAPE_TOOLS[i + 1])
  }

  // Line/Copy turning on switch these off (BuildMode calls this).
  off() {
    if (this.mode) this.setMode(this.mode)
  }

  _syncButtons() {
    document.getElementById('build-mode-fill-btn')?.classList.toggle('active', this.mode === 'fill')
    document.getElementById('build-mode-replace-btn')?.classList.toggle('active', this.mode === 'replace')
    const shapeBtn = document.getElementById('build-mode-shape-btn')
    shapeBtn?.classList.toggle('active', SHAPE_TOOLS.includes(this.mode))
    const label = document.getElementById('build-mode-shape-btn-label')
    if (label) label.textContent = SHAPE_TOOLS.includes(this.mode) ? t('buildShapeBtnOn', { shape: t(`buildShape_${this.mode}`) }) : t('buildModeShapeBtn')
  }

  // The little line above the hotbar saying which tool is on and what the
  // next right-click does. Line and Copy use it too.
  refreshHint() {
    const el = this._hintEl || (this._hintEl = document.getElementById('build-tool-hint'))
    if (!el) return
    const bm = this.bm
    let text = ''
    if (this.mode) {
      const name = SHAPE_TOOLS.includes(this.mode) ? t(`buildShape_${this.mode}`) : t(this.mode === 'fill' ? 'buildModeFillBtn' : 'buildModeReplaceBtn')
      const step = !this._start ? (this.mode === 'circle' || this.mode === 'ball' ? 'buildToolStepCenter' : 'buildToolStepFirst') : (this.mode === 'circle' || this.mode === 'ball' ? 'buildToolStepRadius' : 'buildToolStepSecond')
      text = `${name}: ${t(step)}`
    } else if (bm.lineToolMode) {
      text = `${t('buildModeLineBtn')}: ${t(bm._lineStart ? 'buildToolStepSecond' : 'buildToolStepFirst')}`
    } else if (bm.copyToolMode) {
      text = `${t('buildModeCopyBtn')}: ${t(bm._copyStart ? 'buildToolStepSecond' : 'buildToolStepFirst')}`
    }
    el.textContent = text
    el.style.display = text && bm.active && !bm.tryMode.active ? 'block' : 'none'
  }

  // The cell a right-click would use right now: the block you aim at for
  // Replace, the empty cell in front of it for everything else.
  _aimCell() {
    const bm = this.bm
    bm.camera.updateMatrixWorld()
    bm._raycaster.setFromCamera({ x: 0, y: 0 }, bm.camera)
    const hit = bm._raycastGridAligned()
    if (!hit) return null
    return this.mode === 'replace' ? hit.existingBlock : hit.placeAt
  }

  click() {
    const cell = this._aimCell()
    if (!cell) return 0
    const bm = this.bm
    if (!this._start) {
      if (this.mode === 'replace') this._replaceFrom = bm.getBlockAt(...cell)
      this._start = cell
      this.refreshHint()
      return 0
    }
    const start = this._start
    this._start = null
    const count = this.apply(this.mode, start, cell, bm.selectedType, this._replaceFrom)
    this._replaceFrom = null
    this.refreshHint()
    return count
  }

  // Does one tool action from a to b. Returns how many cells changed, or
  // -1 if the area was too big. Used by click() and the tests.
  apply(mode, a, b, type, replaceFrom = null) {
    const bm = this.bm
    if (mode !== 'replace' && !type) return 0
    // Doors are two cells tall and face the camera - one at a time.
    if (type && /door$/.test(type)) {
      bm.game?._showHomepageToast?.(t('buildToolNoDoors'))
      return 0
    }
    const cells = this.cells(mode, a, b)
    if (!cells) {
      bm.game?._showHomepageToast?.(t('buildToolTooBig', { n: MAX_TOOL_CELLS.toLocaleString() }))
      return -1
    }
    let changed = 0
    bm._undoGroupDo(() => {
      for (const [x, y, z] of cells) {
        for (const cx of bm.mirrorMode ? [x, bm._mirrorX(x)] : [x]) {
          const here = bm.getBlockAt(cx, y, z)
          if (mode === 'replace') {
            if (!replaceFrom || here !== replaceFrom || here === type) continue
            bm.removeBlock(cx, y, z)
            if (type) bm.placeBlock(cx, y, z, type)
            changed++
          } else if (!here || bm.liquids.isFlow(bm._key(cx, y, z))) {
            bm.placeBlock(cx, y, z, type)
            if (bm.getBlockAt(cx, y, z) === type) changed++
          }
        }
      }
    })
    bm.tryMode.swingHand()
    return changed
  }

  // Every cell a tool touches between a and b, or null if too many.
  cells(mode, a, b) {
    const [ax, ay, az] = a
    const [bx, by, bz] = b
    const out = []
    const push = (x, y, z) => {
      out.push([x, y, z])
      return out.length <= MAX_TOOL_CELLS
    }
    const minX = Math.min(ax, bx), maxX = Math.max(ax, bx)
    const minY = Math.min(ay, by), maxY = Math.max(ay, by)
    const minZ = Math.min(az, bz), maxZ = Math.max(az, bz)
    if (mode === 'fill' || mode === 'replace' || mode === 'box') {
      if ((maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1) > MAX_TOOL_CELLS * (mode === 'box' ? 50 : 1)) return null
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          for (let z = minZ; z <= maxZ; z++) {
            if (mode === 'box' && x !== minX && x !== maxX && y !== minY && y !== maxY && z !== minZ && z !== maxZ) continue
            if (!push(x, y, z)) return null
          }
        }
      }
      return out
    }
    if (mode === 'floor') {
      if ((maxX - minX + 1) * (maxZ - minZ + 1) > MAX_TOOL_CELLS) return null
      for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) push(x, ay, z)
      return out
    }
    if (mode === 'wall') {
      const line = this.bm._lineCells(ax, 0, az, bx, 0, bz)
      if (line.length * (maxY - minY + 1) > MAX_TOOL_CELLS) return null
      for (const [x, , z] of line) for (let y = minY; y <= maxY; y++) push(x, y, z)
      return out
    }
    // circle / ball: a around b's distance. The ring/shell is one cell
    // thick and has no gaps (a cell is in it when its center sits within
    // half a cell of the radius).
    const r = Math.min(MAX_RADIUS, Math.round(mode === 'circle' ? Math.hypot(bx - ax, bz - az) : Math.hypot(bx - ax, by - ay, bz - az)))
    if (r < 1) return [[ax, ay, az]]
    const ry = mode === 'ball' ? r : 0
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -ry; dy <= ry; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          const d = Math.hypot(dx, dy, dz)
          if (d < r - 0.5 || d >= r + 0.5) continue
          if (!push(ax + dx, ay + dy, az + dz)) return null
        }
      }
    }
    return out
  }

  // Q: turns the copied selection a quarter turn (clockwise seen from
  // above), stairs and doors included, ready for the next paste.
  rotateClipboard() {
    const clip = this.bm._clipboard
    if (!clip || !clip.blocks.length) return false
    const { width, depth } = clip
    clip.blocks = clip.blocks.map((b) => ({
      ...b,
      dx: depth - 1 - b.dz,
      dz: b.dx,
      state: b.state && Number.isInteger(b.state.facing) ? { ...b.state, facing: (b.state.facing + 3) % 4 } : b.state,
    }))
    clip.width = depth
    clip.depth = width
    clip.turns = ((clip.turns || 0) + 1) % 4
    this.bm.game?._showHomepageToast?.(t('buildRotateToast', { n: clip.turns * 90 }))
    return true
  }

  // Each frame: the gold box from the first corner to where you aim.
  update() {
    const bm = this.bm
    const start = this.mode ? this._start : bm.copyToolMode ? bm._copyStart : null
    if (!start || bm.tryMode.active || bm.menuOpen || bm.pickerOpen) {
      this._box.visible = false
      return
    }
    const aim = (this.mode ? this._aimCell() : (() => {
      bm._raycaster.setFromCamera({ x: 0, y: 0 }, bm.camera)
      return bm._raycastGridAligned()?.existingBlock
    })()) || start
    let min, size
    if (this.mode === 'circle' || this.mode === 'ball') {
      const r = Math.min(MAX_RADIUS, Math.round(this.mode === 'circle' ? Math.hypot(aim[0] - start[0], aim[2] - start[2]) : Math.hypot(aim[0] - start[0], aim[1] - start[1], aim[2] - start[2])))
      const ry = this.mode === 'ball' ? r : 0
      min = [start[0] - r, start[1] - ry, start[2] - r]
      size = [2 * r + 1, 2 * ry + 1, 2 * r + 1]
    } else {
      const y1 = this.mode === 'floor' ? start[1] : aim[1]
      min = [Math.min(start[0], aim[0]), Math.min(start[1], y1), Math.min(start[2], aim[2])]
      size = [Math.abs(aim[0] - start[0]) + 1, Math.abs(y1 - start[1]) + 1, Math.abs(aim[2] - start[2]) + 1]
    }
    this._box.position.set(min[0] * this.B, min[1] * this.B, min[2] * this.B)
    this._box.scale.set(size[0] * this.B, size[1] * this.B, size[2] * this.B)
    this._box.visible = true
  }
}
