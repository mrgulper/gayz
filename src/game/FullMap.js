// Stage 14 of the Extended Metropolitan Grid plan - a full top-down map
// screen, opened/closed on demand (see Game.js's mapOpen), showing the
// whole world with fog-of-war: cells the player hasn't actually walked
// through render as solid black, revealed cells get a lit ground tint plus
// any named-location landmark that falls inside them. Rendered once per
// toggle-open (not every frame) since Game.js freezes gameplay while the
// map is open, same as the inventory panel already does - nothing on the
// map can change while it's showing.
const WORLD_HALF_SIZE = 375 // matches World.js's own groundSize/2 (750/2)

export class FullMap {
  constructor(canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.size = canvas.width
  }

  // Inverse of the render()-local toScreen() - lets Game.js convert a click
  // on the map canvas back into world coordinates (see its custom-pin
  // right-click handler), using this class's own size/scale as the single
  // source of truth instead of duplicating the math.
  screenToWorld(px, py) {
    const scale = this.size / (WORLD_HALF_SIZE * 2)
    return { x: (px - this.size / 2) / scale, z: (py - this.size / 2) / scale }
  }

  render(playerPos, facingRad, discoveredCells, cellSize, landmarks, customPin = null) {
    const ctx = this.ctx
    const s = this.size
    const scale = s / (WORLD_HALF_SIZE * 2)
    const toScreen = (x, z) => [
      s / 2 + x * scale,
      s / 2 + z * scale,
    ]

    // Fast-travel click targets, rebuilt every render (the map is only ever
    // re-rendered on open, same cadence as everything else here) - Game.js
    // hit-tests clicks against this list rather than the fixed EXPLORE_CELL_SIZE
    // it recomputes for the fog reveal, keeping both here as the single
    // source of truth for what's actually shown on screen.
    this.hitTargets = [{ label: 'Safe Zone', x: 0, z: 42, px: null, py: null }]

    ctx.clearRect(0, 0, s, s)
    ctx.fillStyle = '#0a0d0a'
    ctx.fillRect(0, 0, s, s)

    // One quad per grid cell across the whole map - cheap enough done once
    // per toggle-open (roughly (750/cellSize)^2 cells, a few hundred to low
    // thousands depending on cellSize, not per-frame).
    const cellPx = cellSize * scale
    for (let wx = -WORLD_HALF_SIZE; wx < WORLD_HALF_SIZE; wx += cellSize) {
      for (let wz = -WORLD_HALF_SIZE; wz < WORLD_HALF_SIZE; wz += cellSize) {
        const cx = Math.floor(wx / cellSize)
        const cz = Math.floor(wz / cellSize)
        const discovered = discoveredCells.has(`${cx},${cz}`)
        const [px, py] = toScreen(wx, wz)
        ctx.fillStyle = discovered ? 'rgba(90, 110, 80, 0.35)' : '#0a0d0a'
        ctx.fillRect(px, py, cellPx + 0.5, cellPx + 0.5)
      }
    }

    // Landmarks only show once their own cell has actually been discovered
    // - finding them on the ground is what earns their spot on this map.
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'center'
    for (const lm of landmarks) {
      const cx = Math.floor(lm.x / cellSize)
      const cz = Math.floor(lm.z / cellSize)
      if (!discoveredCells.has(`${cx},${cz}`)) continue
      const [px, py] = toScreen(lm.x, lm.z)
      ctx.fillStyle = '#b39cff'
      ctx.beginPath()
      ctx.arc(px, py, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#e8e4f5'
      ctx.fillText(lm.label, px, py - 8)
      this.hitTargets.push({ label: lm.label, x: lm.x, z: lm.z, px, py })
    }

    // Safe zone is always known regardless of exploration - it's home base.
    ctx.fillStyle = '#7fd88f'
    const [safeX, safeY] = toScreen(0, 42)
    ctx.beginPath()
    ctx.arc(safeX, safeY, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#e8e4f5'
    ctx.fillText('Safe Zone', safeX, safeY - 10)
    this.hitTargets[0].px = safeX
    this.hitTargets[0].py = safeY

    // Custom pin (see Game.js's right-click handler) - always drawn
    // regardless of fog-of-war, unlike named landmarks above, since the
    // whole point is marking a destination the player hasn't reached yet.
    if (customPin) {
      const [pinX, pinY] = toScreen(customPin.x, customPin.z)
      ctx.fillStyle = '#ff5c5c'
      ctx.beginPath()
      ctx.moveTo(pinX, pinY - 9)
      ctx.lineTo(pinX + 5, pinY + 3)
      ctx.lineTo(pinX - 5, pinY + 3)
      ctx.closePath()
      ctx.fill()
      this.hitTargets.push({ label: 'Custom Pin', x: customPin.x, z: customPin.z, px: pinX, py: pinY })
    }

    // Player marker, rotated to current facing.
    const [ppx, ppy] = toScreen(playerPos.x, playerPos.z)
    ctx.save()
    ctx.translate(ppx, ppy)
    ctx.rotate(facingRad)
    ctx.fillStyle = '#eafbe0'
    ctx.beginPath()
    ctx.moveTo(0, -9)
    ctx.lineTo(6, 7)
    ctx.lineTo(-6, 7)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, s - 1, s - 1)
  }
}
