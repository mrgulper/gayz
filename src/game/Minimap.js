// Canvas-drawn radar: north-up, player-centered. Landmarks are supplied
// fresh each call so opened/collected state (chests, the one-off minigun
// pickup) always reads live without the minimap owning any game state.

// Zoom Levels - cycled via a keybind (see Game.js's _cycleMinimapZoom).
// Index into this array, not a raw multiplier, so "zoomed in" always means
// a smaller range (more detail, less coverage) rather than the inverted
// relationship a raw scale multiplier would need callers to remember.
// 55 (index 1) was the original fixed range, kept as the default.
export const MINIMAP_ZOOM_RANGES = [30, 55, 90]
export const MINIMAP_DEFAULT_ZOOM_INDEX = 1

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.size = canvas.width
    this.zoomIndex = MINIMAP_DEFAULT_ZOOM_INDEX
  }

  cycleZoom() {
    this.zoomIndex = (this.zoomIndex + 1) % MINIMAP_ZOOM_RANGES.length
    return MINIMAP_ZOOM_RANGES[this.zoomIndex]
  }

  update(playerPos, facingRad, zombies, chestLandmarks, minigunLandmark, traderLandmark, ammoLandmark, airdropLandmark, hordeLandmark, extraLandmarks = [], discoveredCells = null, cellSize = 20, ping = null) {
    const ctx = this.ctx
    const s = this.size
    const cx = s / 2
    const cy = s / 2
    const range = MINIMAP_ZOOM_RANGES[this.zoomIndex]
    const scale = (s / 2) / range

    ctx.clearRect(0, 0, s, s)

    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, s / 2 - 1, 0, Math.PI * 2)
    ctx.clip()

    ctx.fillStyle = 'rgba(8, 12, 8, 0.55)'
    ctx.fillRect(0, 0, s, s)

    // Stage 14's fog-of-war, at local radar scale: even within this small
    // always-shown bubble, ground the player hasn't actually walked through
    // yet stays solid black instead of the normal explored tint. Skipped
    // entirely if the caller doesn't pass discoveredCells (keeps this class
    // usable standalone/in tests without that dependency).
    if (discoveredCells) {
      const cellPx = cellSize * scale
      const worldMinX = playerPos.x - range
      const worldMaxX = playerPos.x + range
      const worldMinZ = playerPos.z - range
      const worldMaxZ = playerPos.z + range
      const cellMinX = Math.floor(worldMinX / cellSize)
      const cellMaxX = Math.floor(worldMaxX / cellSize)
      const cellMinZ = Math.floor(worldMinZ / cellSize)
      const cellMaxZ = Math.floor(worldMaxZ / cellSize)
      ctx.fillStyle = 'rgba(4, 5, 4, 0.92)'
      for (let cxi = cellMinX; cxi <= cellMaxX; cxi++) {
        for (let czi = cellMinZ; czi <= cellMaxZ; czi++) {
          if (discoveredCells.has(`${cxi},${czi}`)) continue
          const wx = cxi * cellSize
          const wz = czi * cellSize
          const px = cx + (wx - playerPos.x) * scale
          const py = cy + (wz - playerPos.z) * scale
          ctx.fillRect(px, py, cellPx + 0.5, cellPx + 0.5)
        }
      }
    }

    for (const c of chestLandmarks) {
      const px = cx + (c.x - playerPos.x) * scale
      const py = cy + (c.z - playerPos.z) * scale
      if (px < -6 || px > s + 6 || py < -6 || py > s + 6) continue
      ctx.fillStyle = c.opened ? 'rgba(150, 160, 140, 0.35)' : '#7fd88f'
      ctx.fillRect(px - 2.5, py - 2.5, 5, 5)
    }

    if (minigunLandmark) {
      const px = cx + (minigunLandmark.x - playerPos.x) * scale
      const py = cy + (minigunLandmark.z - playerPos.z) * scale
      ctx.fillStyle = '#ffcf5c'
      ctx.beginPath()
      ctx.moveTo(px, py - 6)
      ctx.lineTo(px + 5.5, py + 4.5)
      ctx.lineTo(px - 5.5, py + 4.5)
      ctx.closePath()
      ctx.fill()
    }

    if (traderLandmark) {
      const px = cx + (traderLandmark.x - playerPos.x) * scale
      const py = cy + (traderLandmark.z - playerPos.z) * scale
      ctx.fillStyle = '#e3a63c'
      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(Math.PI / 4)
      ctx.fillRect(-3.5, -3.5, 7, 7)
      ctx.restore()
    }

    if (ammoLandmark) {
      const px = cx + (ammoLandmark.x - playerPos.x) * scale
      const py = cy + (ammoLandmark.z - playerPos.z) * scale
      ctx.fillStyle = '#3fa9f5'
      ctx.fillRect(px - 3, py - 3, 6, 6)
    }

    if (airdropLandmark) {
      const px = cx + (airdropLandmark.x - playerPos.x) * scale
      const py = cy + (airdropLandmark.z - playerPos.z) * scale
      const pulse = 3.5 + Math.sin(performance.now() / 150) * 1.5
      ctx.strokeStyle = '#ffe680'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(px, py, pulse + 3, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = '#ffe680'
      ctx.beginPath()
      ctx.arc(px, py, pulse, 0, Math.PI * 2)
      ctx.fill()
    }

    // Wandering horde - a pulsing cluster of dots rather than a single
    // marker, so it reads distinctly from every other single-point landmark
    // (trader/ammo/airdrop/minigun) at a glance.
    if (hordeLandmark) {
      const px = cx + (hordeLandmark.x - playerPos.x) * scale
      const py = cy + (hordeLandmark.z - playerPos.z) * scale
      const pulse = 0.6 + Math.sin(performance.now() / 200) * 0.4
      ctx.fillStyle = `rgba(180, 40, 40, ${0.6 + pulse * 0.4})`
      for (const [ox, oy] of [[0, 0], [-3, -2], [3, -2], [-2, 3], [2, 3]]) {
        ctx.beginPath()
        ctx.arc(px + ox, py + oy, 2, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Threat Ping (on-demand keypress, see Game.js's _pingNearestThreat) -
    // an expanding ring rather than the airdrop's steady pulse, so it reads
    // as a one-off marker fading out, not an ongoing landmark.
    if (ping) {
      const px = cx + (ping.x - playerPos.x) * scale
      const py = cy + (ping.z - playerPos.z) * scale
      const remaining = Math.max(0, (ping.until - performance.now()) / 3000)
      const expand = (1 - remaining) * 10
      ctx.strokeStyle = `rgba(240, 90, 90, ${0.85 * remaining})`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(px, py, 3 + expand, 0, Math.PI * 2)
      ctx.stroke()
    }

    // Extended Metropolitan Grid locations - a small violet diamond, once
    // the player's close enough (this radar's RANGE is much smaller than
    // the distance between most of these) for the marker to actually help
    // rather than the compass strip being the only useful cue at range.
    ctx.fillStyle = '#b39cff'
    for (const lm of extraLandmarks) {
      const px = cx + (lm.x - playerPos.x) * scale
      const py = cy + (lm.z - playerPos.z) * scale
      if (px < -6 || px > s + 6 || py < -6 || py > s + 6) continue
      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(Math.PI / 4)
      ctx.fillRect(-3, -3, 6, 6)
      ctx.restore()
    }

    // Shape-based icons (batch feature) - shape carries the type info, not
    // just color, so it still reads for colorblind players. Plain zombies
    // keep the original dot; boss/ranged/exploder get a distinct outline on
    // top of the same red fill so the icon set stays a single family at a
    // glance rather than a rainbow of unrelated colors.
    ctx.fillStyle = '#e04b4b'
    ctx.strokeStyle = '#2a0808'
    ctx.lineWidth = 1
    for (const z of zombies) {
      const dx = (z.x - playerPos.x) * scale
      const dz = (z.z - playerPos.z) * scale
      if (Math.hypot(dx, dz) > s / 2) continue
      const ix = cx + dx
      const iy = cy + dz
      ctx.beginPath()
      if (z.shape === 'boss') {
        const r = 5
        ctx.moveTo(ix, iy - r)
        ctx.lineTo(ix + r, iy)
        ctx.lineTo(ix, iy + r)
        ctx.lineTo(ix - r, iy)
        ctx.closePath()
      } else if (z.shape === 'square') {
        const r = 2.4
        ctx.rect(ix - r, iy - r, r * 2, r * 2)
      } else if (z.shape === 'triangle') {
        const r = 3
        ctx.moveTo(ix, iy - r)
        ctx.lineTo(ix + r, iy + r)
        ctx.lineTo(ix - r, iy + r)
        ctx.closePath()
      } else {
        ctx.arc(ix, iy, 2.6, 0, Math.PI * 2)
      }
      ctx.fill()
      if (z.shape && z.shape !== 'dot') ctx.stroke()
    }

    ctx.restore()

    ctx.strokeStyle = 'rgba(182, 230, 161, 0.5)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(cx, cy, s / 2 - 1, 0, Math.PI * 2)
    ctx.stroke()

    // Player marker: fixed at center, rotated to current facing direction.
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(facingRad)
    ctx.fillStyle = '#eafbe0'
    ctx.beginPath()
    ctx.moveTo(0, -7)
    ctx.lineTo(5, 6)
    ctx.lineTo(-5, 6)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
}
