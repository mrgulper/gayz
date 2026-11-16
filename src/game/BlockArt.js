// Block pattern drawing, block textures and block icons (moved out of
// BuildMode.js as-is, 2026-11-16).
import * as THREE from 'three'
import { blockFaceCanvases, blockIconURL, doorCanvas, doorIconURL, fenceIconURL, gadgetIconURL, ladderIconURL, plantIconURL, stairsIconURL, trackPartsCanvas } from './BlockTextures.js'
import { BLOCK_TYPES, BLOCK_BY_ID } from './BlockTypes.js'

// Flat MeshStandardMaterial colors read as plain painted planes rather than
// distinct blocks once several sit side by side - real Minecraft-style
// building games sell "3D block" via a per-face texture (grain/speckle/
// mortar lines) plus a darker edge border, not geometry. Baked once per
// type into a small canvas at construction time, not per-instance (all
// instances of a type share one InstancedMesh material/texture).
function _shade(base, delta) {
  return base.clone().offsetHSL(0, 0, delta)
}
// getHex() converts back to sRGB, which is what a canvas fillStyle wants.
// THREE.Color stores linear values (three's color management converts
// every hex on the way in), so writing c.r/c.g/c.b straight into a canvas
// - what this used to do - drew every block texture about 3x too dark in
// the midtones (grass 0x5fa84a came out as 0x1e6512).
function _rgb(c) {
  const h = c.getHex()
  return `${(h >> 16) & 255},${(h >> 8) & 255},${h & 255}`
}
// Two size classes - fine dust (most of the count) plus a handful of
// larger chunks - reads as real aggregate/rock texture rather than a
// uniform noise field, which is what a single speck size produced no
// matter how many were added. This is the most-reused pattern (roughly
// half of BLOCK_TYPES), so it carries most of the "does this look like a
// real material or a painted plane" impression.
function _drawSpeckle(ctx, base, size) {
  for (let i = 0; i < 150; i++) {
    const c = _shade(base, (Math.random() - 0.5) * 0.22)
    ctx.fillStyle = `rgb(${_rgb(c)})`
    const s = 1 + Math.random() * 2.4
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s)
  }
  for (let i = 0; i < 16; i++) {
    const c = _shade(base, (Math.random() - 0.5) * 0.32)
    ctx.fillStyle = `rgb(${_rgb(c)})`
    const s = 3 + Math.random() * 5
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s)
  }
}
function _drawBrick(ctx, base, size) {
  const mortar = _shade(base, 0.3)
  ctx.strokeStyle = `rgb(${_rgb(mortar)})`
  ctx.lineWidth = 2
  const rows = 4
  const rowH = size / rows
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * rowH); ctx.lineTo(size, r * rowH); ctx.stroke()
  }
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 0 ? 0 : size / 4
    for (let x = offset; x <= size; x += size / 2) {
      ctx.beginPath(); ctx.moveTo(x, r * rowH); ctx.lineTo(x, (r + 1) * rowH); ctx.stroke()
    }
  }
}
function _drawWood(ctx, base, size) {
  const planks = 4
  const plankW = size / planks
  for (let p = 0; p < planks; p++) {
    const shade = _shade(base, (Math.random() - 0.5) * 0.1)
    ctx.fillStyle = `rgb(${_rgb(shade)})`
    ctx.fillRect(p * plankW, 0, plankW, size)
  }
  const grain = _shade(base, -0.2)
  ctx.strokeStyle = `rgba(${_rgb(grain)},0.5)`
  ctx.lineWidth = 1
  for (let p = 1; p < planks; p++) {
    ctx.beginPath(); ctx.moveTo(p * plankW, 0); ctx.lineTo(p * plankW, size); ctx.stroke()
  }
  for (let i = 0; i < 10; i++) {
    const y = Math.random() * size
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y + (Math.random() - 0.5) * 4); ctx.stroke()
  }
}
function _drawMetal(ctx, base, size) {
  const line = _shade(base, -0.25)
  ctx.strokeStyle = `rgb(${_rgb(line)})`
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, size - 2, size - 2)
  ctx.beginPath(); ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size); ctx.stroke()
  const rivet = _shade(base, 0.35)
  ctx.fillStyle = `rgb(${_rgb(rivet)})`
  const pad = 4
  for (const [x, y] of [[pad, pad], [size - pad, pad], [pad, size - pad], [size - pad, size - pad]]) {
    ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill()
  }
}
function _drawGlass(ctx, base, size) {
  const line = _shade(base, -0.3)
  ctx.strokeStyle = `rgba(${_rgb(line)},0.8)`
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2); ctx.stroke()
  const shine = _shade(base, 0.4)
  ctx.fillStyle = `rgba(${_rgb(shine)},0.5)`
  ctx.beginPath(); ctx.moveTo(3, 3); ctx.lineTo(size / 2 - 2, 3); ctx.lineTo(3, size / 2 - 2); ctx.closePath(); ctx.fill()
}
// Concentric bark rings - the signature "log" tell (Oak Log etc.), distinct
// from the plank-strip look _drawWood already covers.
function _drawLog(ctx, base, size) {
  const dark = _shade(base, -0.28)
  ctx.strokeStyle = `rgba(${_rgb(dark)},0.55)`
  ctx.lineWidth = 1.5
  const cx = size / 2
  const cy = size / 2
  for (let r = size * 0.1; r < size * 0.55; r += size * 0.09) {
    ctx.beginPath()
    ctx.ellipse(cx, cy, r, r * (0.85 + Math.random() * 0.15), 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  const bark = _shade(base, -0.4)
  ctx.strokeStyle = `rgba(${_rgb(bark)},0.4)`
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, size - 2, size - 2)
}
// Fine woven cross-hatch - Wool's tell, distinct from every hard-surface
// pattern above.
function _drawWool(ctx, base, size) {
  const step = size / 8
  for (let i = 0; i <= 8; i++) {
    const shade = _shade(base, (Math.random() - 0.5) * 0.08)
    ctx.strokeStyle = `rgba(${_rgb(shade)},0.35)`
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, size); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(size, i * step); ctx.stroke()
  }
}
// Alternating bands - TNT's tell.
function _drawStripe(ctx, base, size) {
  const alt = _shade(base, base.getHSL({}).l > 0.5 ? -0.55 : 0.55)
  const bands = 3
  const bandH = size / bands
  for (let b = 0; b < bands; b++) {
    if (b % 2 === 1) {
      ctx.fillStyle = `rgb(${_rgb(alt)})`
      ctx.fillRect(0, b * bandH, size, bandH)
    }
  }
}
// Two side rails + evenly spaced rungs - Ladder's tell. Drawn on the wood
// base color same as planks, but the actual "ladder" read comes entirely
// from this silhouette, not the base color - readable even from the thin
// LADDER_GEO panel's edge-on faces where the pattern just repeats.
function _drawLadder(ctx, base, size) {
  // Lighter, not darker, for both accents - a negative shade delta here
  // crushes toward pure black (this pipeline's THREE.Color->rgb() string
  // conversion runs in linear space, so already-dark base colors like this
  // one darken much faster than the delta number suggests - _drawBrick's
  // mortar hits the same thing, which is why it lightens instead of
  // darkening too). Confirmed by direct pixel sampling: -0.3/-0.15 deltas
  // rendered as near-(0,0,0) bands instead of the intended subtle shading.
  const rail = _shade(base, 0.32)
  ctx.fillStyle = `rgb(${_rgb(rail)})`
  const railW = size * 0.14
  ctx.fillRect(size * 0.06, 0, railW, size)
  ctx.fillRect(size * 0.94 - railW, 0, railW, size)
  const rung = _shade(base, 0.18)
  ctx.fillStyle = `rgb(${_rgb(rung)})`
  const rungCount = 5
  const rungH = size * 0.09
  for (let i = 0; i < rungCount; i++) {
    const y = (size / rungCount) * (i + 0.5) - rungH / 2
    ctx.fillRect(size * 0.06, y, size * 0.88, rungH)
  }
}

// Texture quality pass - the 8 patterns above were shared across all 123
// blocks, so several very different real materials (ore vs plain stone,
// leaves vs solid green, bookshelf vs plain planks, ice vs glass) rendered
// almost identically, only differing by base color. These 8 give the most
// visually-distinct block categories their own real per-block detail
// instead of reusing a generic pattern. Every accent here lightens rather
// than darkens (or darkens only via low alpha over the base, never a
// full-opacity solid fill) - see _drawLadder's comment for why a plain
// negative _shade delta crushes toward black in this pipeline.

// Stone-speckle base plus a handful of raised, saturated vein clusters -
// Ore's tell. Reuses _drawSpeckle for the rock matrix rather than
// duplicating it, then layers clusters on top so it still reads as "stone
// with something valuable in it" rather than a totally different rock.
function _drawOre(ctx, base, size) {
  _drawSpeckle(ctx, base, size)
  const vein = base.clone().offsetHSL(0, 0.3, 0.22)
  ctx.fillStyle = `rgb(${_rgb(vein)})`
  const clusters = 6
  for (let c = 0; c < clusters; c++) {
    const cx = Math.random() * size
    const cy = Math.random() * size
    const blobs = 3 + Math.floor(Math.random() * 3)
    for (let b = 0; b < blobs; b++) {
      const r = size * (0.02 + Math.random() * 0.035)
      ctx.beginPath()
      ctx.arc(cx + (Math.random() - 0.5) * size * 0.08, cy + (Math.random() - 0.5) * size * 0.08, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

// Overlapping soft round clusters - Leaves' tell, distinct from every
// hard-surface/geometric pattern above. Faint dark gaps between clusters
// use low alpha rather than a solid fill so they read as depth, not holes.
function _drawLeaves(ctx, base, size) {
  for (let i = 0; i < 55; i++) {
    const shade = base.clone().offsetHSL((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.08, (Math.random() - 0.3) * 0.2)
    ctx.fillStyle = `rgb(${_rgb(shade)})`
    const r = size * (0.045 + Math.random() * 0.05)
    ctx.beginPath()
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2)
    ctx.fill()
  }
  const gap = _shade(base, -0.1)
  ctx.fillStyle = `rgba(${_rgb(gap)},0.4)`
  for (let i = 0; i < 12; i++) {
    const r = size * (0.015 + Math.random() * 0.02)
    ctx.beginPath()
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

// Wavy horizontal ripple bands - Water/Lava's tell, distinct from Glass's
// straight cross-mullion look despite both being "shiny and see-through
// or hot" materials.
function _drawLiquid(ctx, base, size) {
  const bands = 6
  for (let i = 0; i < bands; i++) {
    const y = (size / bands) * i + (size / bands) * 0.35
    const shade = base.clone().offsetHSL(0, 0.1, 0.14 + Math.random() * 0.1)
    ctx.strokeStyle = `rgba(${_rgb(shade)},0.55)`
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(0, y)
    for (let x = 0; x <= size; x += size / 8) {
      ctx.quadraticCurveTo(x + size / 16, y + Math.sin(x * 0.05 + i) * 6, x + size / 8, y)
    }
    ctx.stroke()
  }
}

// Jagged branching crack lines over the base - Ice's tell, distinct from
// Glass's clean geometric mullion cross.
function _drawCrack(ctx, base, size) {
  const line = base.clone().offsetHSL(0, 0.05, 0.22)
  ctx.strokeStyle = `rgba(${_rgb(line)},0.55)`
  ctx.lineWidth = 1.5
  for (let i = 0; i < 8; i++) {
    let x = Math.random() * size
    let y = Math.random() * size
    ctx.beginPath()
    ctx.moveTo(x, y)
    const segments = 3 + Math.floor(Math.random() * 3)
    for (let s = 0; s < segments; s++) {
      x += (Math.random() - 0.5) * size * 0.25
      y += (Math.random() - 0.5) * size * 0.25
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
}

// Rows of colored book spines on a wood-frame base - Bookshelf's tell.
// Spine hues are picked from a fixed palette (not derived from `base` at
// all) since real books come in varied colors independent of the shelf's
// own wood tone - the one deliberate exception to every other pattern
// here staying within `base`'s own hue.
const _SPINE_HUES = [0.02, 0.08, 0.33, 0.55, 0.62, 0.78, 0.95]
function _drawSpine(ctx, base, size) {
  const rows = 3
  const rowH = size / rows
  for (let r = 0; r < rows; r++) {
    let x = 0
    while (x < size - 4) {
      const w = size * (0.05 + Math.random() * 0.09)
      const hue = _SPINE_HUES[Math.floor(Math.random() * _SPINE_HUES.length)]
      const col = new THREE.Color().setHSL(hue, 0.35, 0.32 + Math.random() * 0.12)
      ctx.fillStyle = `rgb(${_rgb(col)})`
      ctx.fillRect(x, r * rowH + rowH * 0.08, w, rowH * 0.84)
      x += w + 2
    }
  }
  const shelfLine = _shade(base, 0.3)
  ctx.strokeStyle = `rgba(${_rgb(shelfLine)},0.5)`
  ctx.lineWidth = 2
  for (let r = 1; r < rows; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * rowH); ctx.lineTo(size, r * rowH); ctx.stroke()
  }
}

// Evenly spaced vertical ridge lines - Pumpkin/Jack o'Lantern's tell.
function _drawRidged(ctx, base, size) {
  const ridges = 7
  for (let i = 0; i <= ridges; i++) {
    const x = (size / ridges) * i
    const shade = base.clone().offsetHSL(0, 0, i % 2 === 0 ? 0.16 : -0.08)
    ctx.strokeStyle = `rgba(${_rgb(shade)},0.5)`
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke()
  }
}

// Faceted diamond-shaped shards - Amethyst's tell.
function _drawCrystal(ctx, base, size) {
  for (let i = 0; i < 10; i++) {
    const cx = Math.random() * size
    const cy = Math.random() * size
    const h = size * (0.12 + Math.random() * 0.18)
    const w = h * 0.35
    const shade = base.clone().offsetHSL(0, 0.15, 0.18 + Math.random() * 0.15)
    ctx.fillStyle = `rgb(${_rgb(shade)})`
    ctx.beginPath()
    ctx.moveTo(cx, cy - h / 2)
    ctx.lineTo(cx + w / 2, cy)
    ctx.lineTo(cx, cy + h / 2)
    ctx.lineTo(cx - w / 2, cy)
    ctx.closePath()
    ctx.fill()
    const edge = base.clone().offsetHSL(0, 0.1, 0.32)
    ctx.strokeStyle = `rgba(${_rgb(edge)},0.6)`
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

// Small scattered round holes - Sponge's tell.
function _drawPorous(ctx, base, size) {
  const hole = _shade(base, -0.1)
  ctx.fillStyle = `rgba(${_rgb(hole)},0.55)`
  for (let i = 0; i < 40; i++) {
    const r = size * (0.015 + Math.random() * 0.03)
    ctx.beginPath()
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

const PATTERN_DRAWERS = {
  speckle: _drawSpeckle, brick: _drawBrick, wood: _drawWood, metal: _drawMetal, glass: _drawGlass,
  log: _drawLog, wool: _drawWool, stripe: _drawStripe, ladder: _drawLadder, ore: _drawOre,
  leaves: _drawLeaves, liquid: _drawLiquid, crack: _drawCrack, spine: _drawSpine, ridged: _drawRidged,
  crystal: _drawCrystal, porous: _drawPorous,
}

// Fine per-pixel grain, applied over the finished pattern before the AO/
// sheen passes below - every pattern drawer above fills with flat solid
// colors (fillRect/stroke), which reads as an obviously computer-generated
// flat plane up close in first person. A subtle per-texel brightness jitter
// is the same cheap trick real material textures use to fake surface
// micro-detail without needing an actual bump/normal map. Skipped for
// glass-pattern blocks - grain on a transparent pane reads as dirty rather
// than textured, and blurs the sharp cross-mullion lines _drawGlass relies on.
function _addGrain(ctx, size, pattern) {
  if (pattern === 'glass') return
  const imgData = ctx.getImageData(0, 0, size, size)
  const d = imgData.data
  for (let i = 0; i < d.length; i += 4) {
    const jitter = (Math.random() - 0.5) * 14
    d[i] = Math.max(0, Math.min(255, d[i] + jitter))
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + jitter))
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + jitter))
  }
  ctx.putImageData(imgData, 0, 0)
}

function _makeBlockTexture(colorHex, pattern) {
  const tex = new THREE.CanvasTexture(_makeBlockCanvas(colorHex, pattern))
  tex.magFilter = THREE.NearestFilter
  // Mipmapped minification - crisp pixels up close, no shimmer far away
  // (see the same choice for the chunk atlas in BlockChunks.js).
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// The texture itself, as a canvas - cube blocks copy it into the shared
// chunk atlas (see BlockChunks.js), shaped blocks wrap it in their own
// texture (_makeBlockTexture above).
function _makeBlockCanvas(colorHex, pattern, size = 256) {
  // 256, up from 192 (128 before that, 96 before that, 64 before that, 32
  // originally) - NearestFilter magnification means every texel is a
  // visibly hard-edged square up close, so each bump buys back some
  // sharpness at the same viewing distance while still keeping the
  // intentional pixel-art look (not switching to LinearFilter, which would
  // blur the pattern edges away). The pattern drawers themselves
  // (_drawSpeckle etc.) work in proportional "size" units, not fixed pixel
  // counts, so they scale up automatically with this - no per-pattern
  // changes needed.
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  // willReadFrequently keeps the canvas in CPU memory - _addGrain's
  // getImageData on a GPU-backed canvas forced a GPU readback per block
  // type, ~5.8s of the editor's opening time in a 2026-09-29 profile.
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const base = new THREE.Color(colorHex)
  ctx.fillStyle = `rgb(${_rgb(base)})`
  ctx.fillRect(0, 0, size, size)
  const draw = PATTERN_DRAWERS[pattern]
  if (draw) draw(ctx, base, size)
  _addGrain(ctx, size, pattern)

  // Soft ambient-occlusion vignette - real surfaces catch less light right
  // at their own edges/corners than dead center; without this every
  // pattern above reads as a flat painted plane no matter how much detail
  // it has. Lightened from 0.28 to 0.18 (and pulled the inner radius out
  // to 0.35) - the stronger version was muddying the pattern detail
  // underneath it instead of just grounding the block's edges.
  const vignette = ctx.createRadialGradient(size / 2, size / 2, size * 0.35, size / 2, size / 2, size * 0.75)
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,0,0,0.18)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, size, size)

  // Faint directional sheen (upper-left, roughly matching the scene's own
  // sun position) instead of flat, uniform brightness across the whole face.
  const highlight = ctx.createLinearGradient(0, 0, size, size)
  highlight.addColorStop(0, 'rgba(255,255,255,0.14)')
  highlight.addColorStop(0.5, 'rgba(255,255,255,0)')
  ctx.fillStyle = highlight
  ctx.fillRect(0, 0, size, size)

  // Thin block outline - scaled with the texture so a small chunk-atlas
  // tile (64px) doesn't get a 2px border that reads as a black grid line
  // across the whole floor.
  const edge = _shade(base, -0.32)
  const edgeW = Math.max(1, size / 128)
  ctx.strokeStyle = `rgba(${_rgb(edge)},${size >= 128 ? 0.6 : 0.35})`
  ctx.lineWidth = edgeW
  ctx.strokeRect(edgeW / 2, edgeW / 2, size - edgeW, size - edgeW)
  return canvas
}

// Stairs/fences wear the same pixel-art texture as the full block they're
// made of (BlockTextures.js); the ladder keeps its own drawn pattern.
export const SHAPED_TEXTURE_FROM = {
  oakstairs: 'oakplanks', stonestairs: 'stonebricks', brickstairs: 'brick', cobblestonestairs: 'cobblestone',
  oakfence: 'oakplanks', stonefence: 'stonebricks', netherbrickfence: 'netherbrick',
  oakslab: 'oakplanks',
  spruceslab: 'spruceplanks',
  birchslab: 'birchplanks',
  darkoakslab: 'darkoakplanks',
  stoneslab: 'smoothstone',
  cobblestoneslab: 'cobblestone',
  brickslab: 'brick',
  stonebrickslab: 'stonebricks',
  sandstoneslab: 'sandstone',
  quartzslab: 'quartz',
  blackstoneslab: 'blackstone',
  prismarineslab: 'prismarine',
}
// The full block a shaped block (stairs/fence/slab) is made from, if any.
function _shapedSource(bt) {
  const sourceId = SHAPED_TEXTURE_FROM[bt.id] || bt.slabOf || bt.stairsOf
  return (sourceId && BLOCK_TYPES.find((b) => b.id === sourceId)) || null
}

export function _canvasTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas)
  // Crisp pixels up close, like the chunk atlas (BlockChunks).
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// -> { top, side, bottom } textures for a shaped block (all three the same
// texture unless its source block has different faces, e.g. a grass slab).
export function _shapedBlockTextures(bt) {
  if (bt.geo === 'track') {
    const tex = _canvasTexture(trackPartsCanvas())
    return { top: tex, side: tex, bottom: tex }
  }
  if (bt.game) {
    const faces = blockFaceCanvases(bt)
    const side = _canvasTexture(faces.side)
    const top = faces.top === faces.side ? side : _canvasTexture(faces.top)
    const bottom = faces.bottom === faces.side ? side : faces.bottom === faces.top ? top : _canvasTexture(faces.bottom)
    return { top, side, bottom, front: faces.front ? _canvasTexture(faces.front) : side }
  }
  if (bt.door) {
    const tex = _canvasTexture(doorCanvas(bt.door))
    return { top: tex, side: tex, bottom: tex }
  }
  const source = _shapedSource(bt)
  if (!source) {
    const tex = _makeBlockTexture(bt.color, bt.pattern)
    return { top: tex, side: tex, bottom: tex }
  }
  const faces = blockFaceCanvases(source)
  const side = _canvasTexture(faces.side)
  const top = faces.top === faces.side ? side : _canvasTexture(faces.top)
  const bottom = faces.bottom === faces.side ? side : faces.bottom === faces.top ? top : _canvasTexture(faces.bottom)
  return { top, side, bottom }
}

// Picker/hotbar icon: shaped blocks show the block they're made from, a
// slab at half height, stairs as stairs, a fence as a fence, a ladder flat.
export function _blockIcon(bt) {
  if (bt.plant) return plantIconURL(bt)
  if (bt.door) return doorIconURL(bt.door)
  if (bt.shape === 'lever' || bt.shape === 'sign') return gadgetIconURL(bt.shape)
  if (bt.geo === 'track') return gadgetIconURL('track')
  if (bt.game) return blockIconURL(bt, 64, bt.shape === 'pad' ? 0.25 : bt.shape === 'chest' ? 0.85 : 1)
  if (bt.shape === 'invisible') return _invisibleIconURL()
  const source = _shapedSource(bt)
  if (bt.shape === 'stairs') return stairsIconURL(source || bt)
  if (bt.shape === 'fence') return fenceIconURL(source || bt)
  if (bt.shape === 'ladder') return ladderIconURL(BLOCK_BY_ID.get('oakplanks') || bt)
  return blockIconURL(source || bt, 64, bt.shape === 'slab' ? 0.5 : 1)
}

// The Invisible Block's picker/hotbar icon: a dashed outline of a cube.
let _invisibleIcon = null
function _invisibleIconURL() {
  if (_invisibleIcon) return _invisibleIcon
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')
  ctx.strokeStyle = 'rgba(220, 240, 255, 0.9)'
  ctx.lineWidth = 2.5
  ctx.setLineDash([5, 4])
  ctx.lineJoin = 'round'
  const top = [[32, 8], [56, 20], [32, 32], [8, 20]]
  ctx.beginPath()
  top.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.closePath()
  ctx.moveTo(8, 20); ctx.lineTo(8, 46); ctx.lineTo(32, 58); ctx.lineTo(56, 46); ctx.lineTo(56, 20)
  ctx.moveTo(32, 32); ctx.lineTo(32, 58)
  ctx.stroke()
  _invisibleIcon = c.toDataURL()
  return _invisibleIcon
}
