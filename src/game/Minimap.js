// Canvas-drawn radar: north-up, player-centered. Landmarks are supplied
// fresh each call so opened/collected state (chests, the one-off minigun
// pickup) always reads live without the minimap owning any game state.

const RANGE = 55 // world units from center to the edge of the radar

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.size = canvas.width
  }

  update(playerPos, facingRad, zombies, chestLandmarks, minigunLandmark, traderLandmark, ammoLandmark, airdropLandmark, hordeLandmark) {
    const ctx = this.ctx
    const s = this.size
    const cx = s / 2
    const cy = s / 2
    const scale = (s / 2) / RANGE

    ctx.clearRect(0, 0, s, s)

    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, s / 2 - 1, 0, Math.PI * 2)
    ctx.clip()

    ctx.fillStyle = 'rgba(8, 12, 8, 0.55)'
    ctx.fillRect(0, 0, s, s)

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

    ctx.fillStyle = '#e04b4b'
    for (const z of zombies) {
      const dx = (z.x - playerPos.x) * scale
      const dz = (z.z - playerPos.z) * scale
      if (Math.hypot(dx, dz) > s / 2) continue
      ctx.beginPath()
      ctx.arc(cx + dx, cy + dz, 2.6, 0, Math.PI * 2)
      ctx.fill()
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
