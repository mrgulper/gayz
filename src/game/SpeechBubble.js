// Chat speech bubbles (2026-10-26, Gaymi: "when talking make the words
// talk out"): what a player says in chat shows for a few seconds in a
// dark box with white text over their head - the other players on a
// server (PlayNet) and your own body in the third-person views
// (BuildSurvival.onChatSent). A sprite, so it always faces the camera.
// It sits beside the head, not above it where the name tag is, and a
// longer message stays up longer, then fades out softly (2026-10-26).
import * as THREE from 'three'
import { MOB_HEIGHT } from './PlayRules.js'

// Seconds a bubble stays up: longer messages stay longer.
export function bubbleSeconds(text) {
  return Math.min(10, 2.5 + String(text || '').length * 0.08)
}
// The last second it fades away.
const FADE_S = 1
const W = 512
const LINE_H = 40
const MAX_LINES = 3
const FONT = 'bold 30px sans-serif'

// Splits text into at most MAX_LINES lines that fit `width`.
function wrap(ctx, text, width) {
  const lines = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width <= width || !line) line = next
    else {
      lines.push(line)
      line = word
    }
    if (lines.length === MAX_LINES) break
  }
  if (line && lines.length < MAX_LINES) lines.push(line)
  // A single word too long for the box is cut short.
  return lines.map((l) => {
    let out = l
    while (ctx.measureText(out).width > width && out.length > 1) out = out.slice(0, -2) + '…'
    return out
  })
}

export function speechBubble(text, B) {
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')
  ctx.font = FONT
  const lines = wrap(ctx, text, W - 40)
  const boxW = Math.min(W, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 40)
  const boxH = lines.length * LINE_H + 24
  c.width = W
  c.height = boxH
  ctx.font = FONT
  // The box sits at the right of the picture, its little tail pointing
  // right at the speaker's head.
  const x0 = W - 16 - boxW
  ctx.fillStyle = 'rgba(16, 16, 20, 0.78)'
  ctx.beginPath()
  ctx.roundRect?.(x0, 0, boxW, boxH, 12) ?? ctx.rect(x0, 0, boxW, boxH)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(W - 16, boxH / 2 - 10)
  ctx.lineTo(W - 2, boxH / 2)
  ctx.lineTo(W - 16, boxH / 2 + 10)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  lines.forEach((l, i) => ctx.fillText(l, x0 + boxW / 2, 12 + LINE_H * (i + 0.5)))
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
  const w = 2.6 * B
  sprite.scale.set(w, (w * c.height) / W, 1)
  // Beside the head, a little gap to its left (on screen).
  sprite.center.set(1.12, 0.5)
  sprite.position.y = (MOB_HEIGHT - 0.25) * B
  sprite.renderOrder = 6
  return sprite
}

// Fades the bubble out over its last second (`left` = seconds still up).
export function fadeBubble(sprite, left) {
  sprite.material.opacity = Math.max(0, Math.min(1, left / FADE_S))
}

export function disposeBubble(sprite) {
  sprite.parent?.remove(sprite)
  sprite.material.map?.dispose()
  sprite.material.dispose()
}
