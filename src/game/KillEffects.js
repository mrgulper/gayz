// Kill effects (2026-11-25, shop plan batch 4; Gaymi: bought in the Shop,
// everyone online sees them). A zombie you take down bursts into confetti,
// snowflakes or pixels on top of its usual fall. Bought in Shop > Kill
// Effects for coins (prices a guess to start with), owned ones live in
// game.shopCosmetics (shop save, like the bundle hats), the one you use is
// settings.killEffect, picked in the Shop or Inventory > Hats & Capes.
//
// Online: my pick rides in my PlayNet state (`kfx`); the host tags each
// zombie with its last hitter's effect (z.kfx) and sends it in the zombie
// snapshot (`fx`), so every screen bursts it the same way when it dies.
import * as THREE from 'three'
import { ownsShopCosmetic } from './Cosmetics.js'
import { t } from './i18n.js'

export const KILL_EFFECTS = {
  confettiKill: { price: 1500, colors: [0xff5ca8, 0xffd23f, 0x5cc8ff, 0x7dff8a] },
  snowKill: { price: 1500, colors: [0xffffff, 0xcfe8ff, 0x9fd0ff] },
  pixelKill: { price: 2500, colors: [0x39ff88, 0x2a9dff, 0xff3b6b, 0xffe14d] },
}
export const KILL_EFFECT_IDS = Object.keys(KILL_EFFECTS)

export const cleanKillEffect = (id) => (KILL_EFFECTS[id] ? id : '')

// What I burst zombies with: my pick, if I really own it.
export function myKillEffect(game) {
  const id = cleanKillEffect(game?.settings?.killEffect)
  return id && ownsShopCosmetic(id) ? id : ''
}

export function killEffectName(id) {
  return t(`killFx${id.charAt(0).toUpperCase()}${id.slice(1)}`)
}

// The burst itself, on PlayFx (`fx`), at x, y, z in world units (the
// zombie's middle). B: one block in world units.
export function playKillEffect(fx, id, x, y, z, B) {
  if (!fx || !KILL_EFFECTS[id]) return
  if (id === 'confettiKill') fx.confetti(x, y, z)
  else if (id === 'snowKill') fx.snowBurst(x, y, z)
  else if (id === 'pixelKill') fx.pixelBurst(x, y, z, KILL_EFFECTS[id].colors)
  // A little sound-free pop of light so even a small burst reads.
  fx.spark(x, y, z, { life: 0.25, from: 0.6, to: 1.6, alpha: 0.7, color: KILL_EFFECTS[id].colors[0], vel: new THREE.Vector3(0, 0.5 * B, 0) })
}

// A small flat picture for the Shop and Inventory cards (data URL).
const icons = new Map()
export function killEffectIcon(id) {
  if (icons.has(id)) return icons.get(id)
  const c = document.createElement('canvas')
  c.width = c.height = 48
  const g = c.getContext('2d')
  const hex = (n) => `#${n.toString(16).padStart(6, '0')}`
  const colors = KILL_EFFECTS[id]?.colors || [0xffffff]
  // A zombie head in the middle...
  g.fillStyle = '#5f8f4a'
  g.fillRect(16, 16, 16, 16)
  g.fillStyle = '#1a1a1a'
  g.fillRect(19, 21, 3, 3)
  g.fillRect(26, 21, 3, 3)
  // ...with bits flying out of it.
  let seed = id.length * 7
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2
    const r = 15 + rnd() * 8
    const x = 24 + Math.cos(a) * r
    const y = 24 + Math.sin(a) * r
    g.fillStyle = hex(colors[i % colors.length])
    if (id === 'snowKill') {
      g.fillRect(x - 1, y - 3, 2, 6)
      g.fillRect(x - 3, y - 1, 6, 2)
    } else if (id === 'confettiKill') g.fillRect(x - 2, y - 1, 4, 2)
    else g.fillRect(x - 2, y - 2, 4, 4)
  }
  const url = c.toDataURL()
  icons.set(id, url)
  return url
}
