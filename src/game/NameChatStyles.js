// Name + chat style (2026-11-25, big shop plan batch 7). Three things to
// buy in the Shop for coins (10k / 25k / 50k / 100k each - Gaymi picked
// the Kill Effects ladder):
// - Name styles (Glowing, Gold, Fire, Rainbow): your name over your head
//   on a server, in chat (Global / Server / Clan), on the homepage
//   nameplate, at the top of Profile and on the leaderboard.
// - Chat bubbles (Pink, Comic, Neon, Rainbow): the bubble over your head
//   when you talk on a server (and your own body in third person).
// - Profile frames (Silver, Gold, Fire, Rainbow): around your face picture
//   on the homepage and in Profile, and a mini one before your name in
//   chat.
// Owned ones live in game.shopCosmetics; the ones used are
// settings.nameStyle / settings.chatBubble / settings.profileFrame, picked
// in the Shop or Inventory > Cosmetics (ShopEffects.js kinds).
//
// Online: my picks ride in my PlayNet state (`nst`, `cbub`), on my chat
// messages (`ns`, `fr`) and my leaderboard doc (`ns`). Anything else is
// thrown away (clean*), so a made-up id just shows a plain name.
import { ownsShopCosmetic } from './Cosmetics.js'
import { t } from './i18n.js'

const RAINBOW = ['#ff3b3b', '#ff9a2e', '#ffe14d', '#4dff7a', '#3bb8ff', '#8a5cff']

export const NAME_STYLES = {
  glowName: { price: 10000, colors: ['#bff4ff', '#3bd2ff'] },
  goldName: { price: 25000, colors: ['#fff3b0', '#ffc83d', '#b8860b'] },
  fireName: { price: 50000, colors: ['#ffe14d', '#ff7a1a', '#ff2e2e'] },
  rainbowName: { price: 100000, colors: RAINBOW },
}
export const NAME_STYLE_IDS = Object.keys(NAME_STYLES)

export const CHAT_BUBBLES = {
  pinkBubble: { price: 10000, fill: 'rgba(255, 92, 168, 0.9)', text: '#ffffff', edge: '#ffd0e6' },
  comicBubble: { price: 25000, fill: 'rgba(255, 255, 255, 0.96)', text: '#111111', edge: '#111111' },
  neonBubble: { price: 50000, fill: 'rgba(10, 12, 24, 0.88)', text: '#bff4ff', edge: '#3bd2ff', glow: true },
  rainbowBubble: { price: 100000, fill: 'rgba(16, 16, 20, 0.85)', text: '#ffffff', edge: 'rainbow' },
}
export const CHAT_BUBBLE_IDS = Object.keys(CHAT_BUBBLES)

export const PROFILE_FRAMES = {
  silverFrame: { price: 10000, colors: ['#f4f6f8', '#9aa3ad'] },
  goldFrame: { price: 25000, colors: ['#fff3b0', '#ffc83d', '#b8860b'] },
  fireFrame: { price: 50000, colors: ['#ffe14d', '#ff7a1a', '#ff2e2e'] },
  rainbowFrame: { price: 100000, colors: RAINBOW },
}
export const PROFILE_FRAME_IDS = Object.keys(PROFILE_FRAMES)

export const cleanNameStyle = (id) => (typeof id === 'string' && NAME_STYLES[id] ? id : '')
export const cleanChatBubble = (id) => (typeof id === 'string' && CHAT_BUBBLES[id] ? id : '')
export const cleanProfileFrame = (id) => (typeof id === 'string' && PROFILE_FRAMES[id] ? id : '')

// My picks, if I really own them.
function mine(game, setting, clean) {
  const id = clean(game?.settings?.[setting])
  return id && ownsShopCosmetic(id) ? id : ''
}
export const myNameStyle = (game) => mine(game, 'nameStyle', cleanNameStyle)
export const myChatBubble = (game) => mine(game, 'chatBubble', cleanChatBubble)
export const myProfileFrame = (game) => mine(game, 'profileFrame', cleanProfileFrame)

const cap = (id) => `${id.charAt(0).toUpperCase()}${id.slice(1)}`
export const nameStyleName = (id) => t(`nameStyle${cap(id)}`)
export const chatBubbleName = (id) => t(`chatBubble${cap(id)}`)
export const profileFrameName = (id) => t(`profileFrame${cap(id)}`)

// --- page names (CSS in shop.css: .nstyle-*, .pframe-*) ---

// Extra class for a name element ('' = plain).
export const nameStyleClass = (id) => (cleanNameStyle(id) ? ` nstyle nstyle-${id}` : '')

// A tiny frame before a chat name ('' = none).
export function miniFrameHtml(id) {
  const f = cleanProfileFrame(id)
  return f ? `<span class="pframe-mini pframe-${f}" aria-hidden="true"></span>` : ''
}

// Puts (or takes off) a name style on an element.
export function setNameStyleOn(el, id) {
  if (!el) return
  for (const k of NAME_STYLE_IDS) el.classList.remove(`nstyle-${k}`)
  const s = cleanNameStyle(id)
  el.classList.toggle('nstyle', !!s)
  if (s) el.classList.add(`nstyle-${s}`)
}

// Puts (or takes off) a frame on a face-picture box.
export function setFrameOn(el, id) {
  if (!el) return
  for (const k of PROFILE_FRAME_IDS) el.classList.remove(`pframe-${k}`)
  const f = cleanProfileFrame(id)
  el.classList.toggle('pframe', !!f)
  if (f) el.classList.add(`pframe-${f}`)
}

// Repaints every place my own name / frame shows on the page.
export function applyMyNameLook(game) {
  if (typeof document === 'undefined') return
  const ns = myNameStyle(game)
  document.querySelectorAll('.nameplate-name').forEach((el) => setNameStyleOn(el, ns))
  setNameStyleOn(document.getElementById('profile-public-name-value'), ns)
  const fr = myProfileFrame(game)
  setFrameOn(document.getElementById('menu-avatar-icon'), fr)
  const face = document.getElementById('profile-public-face')
  if (face) {
    setFrameOn(face, fr)
    const img = face.querySelector('img')
    const src = document.getElementById('menu-avatar-photo')?.src
    if (img && src && img.src !== src) img.src = src
  }
}

// What my chat messages carry (CloudSync adds it to each message).
export function myChatLook(game) {
  const out = {}
  const ns = myNameStyle(game)
  const fr = myProfileFrame(game)
  if (ns) out.ns = ns
  if (fr) out.fr = fr
  return out
}

// --- canvas names (the tag over a player's head) ---

function gradient(ctx, x0, x1, colors) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0)
  colors.forEach((c, i) => g.addColorStop(colors.length === 1 ? 0 : i / (colors.length - 1), c))
  return g
}

// Draws `text` centred at cx, cy (font + align already set) in style `id`.
export function paintStyledName(ctx, text, cx, cy, id) {
  const s = NAME_STYLES[cleanNameStyle(id)]
  ctx.lineJoin = 'round'
  ctx.lineWidth = 6
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)'
  ctx.strokeText(text, cx, cy)
  if (!s) {
    ctx.fillStyle = '#ffffff'
    ctx.fillText(text, cx, cy)
    return
  }
  const w = Math.max(20, ctx.measureText(text).width)
  ctx.save()
  ctx.shadowColor = s.colors[s.colors.length - 1]
  ctx.shadowBlur = 14
  ctx.fillStyle = s.colors.length > 2 ? gradient(ctx, cx - w / 2, cx + w / 2, s.colors) : s.colors[0]
  ctx.fillText(text, cx, cy)
  ctx.restore()
  ctx.fillStyle = s.colors.length > 2 ? gradient(ctx, cx - w / 2, cx + w / 2, s.colors) : s.colors[0]
  ctx.fillText(text, cx, cy)
}

// --- chat bubble look (SpeechBubble.js) ---
export function bubbleLook(id) {
  return CHAT_BUBBLES[cleanChatBubble(id)] || null
}
export function bubbleEdgeStyle(ctx, look, x0, x1) {
  return look.edge === 'rainbow' ? gradient(ctx, x0, x1, RAINBOW) : look.edge
}

// --- Shop card pictures ---
const icons = new Map()
function iconCanvas(key, draw) {
  if (icons.has(key)) return icons.get(key)
  if (typeof document === 'undefined') return ''
  const c = document.createElement('canvas')
  c.width = c.height = 48
  draw(c.getContext('2d'))
  const url = c.toDataURL()
  icons.set(key, url)
  return url
}

export function nameStyleIcon(id) {
  return iconCanvas(`n:${id}`, (g) => {
    g.font = 'bold 24px sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    paintStyledName(g, 'Aa', 24, 25, id)
  })
}

export function chatBubbleIcon(id) {
  return iconCanvas(`b:${id}`, (g) => {
    const look = bubbleLook(id)
    if (!look) return
    g.fillStyle = look.fill
    g.beginPath()
    g.roundRect?.(4, 8, 40, 26, 7) ?? g.rect(4, 8, 40, 26)
    g.fill()
    g.beginPath()
    g.moveTo(14, 33)
    g.lineTo(12, 42)
    g.lineTo(22, 33)
    g.fill()
    g.lineWidth = 2.5
    if (look.glow) {
      g.shadowColor = look.edge
      g.shadowBlur = 6
    }
    g.strokeStyle = bubbleEdgeStyle(g, look, 4, 44)
    g.beginPath()
    g.roundRect?.(4, 8, 40, 26, 7) ?? g.rect(4, 8, 40, 26)
    g.stroke()
    g.shadowBlur = 0
    g.fillStyle = look.text
    for (let i = 0; i < 3; i++) g.fillRect(13 + i * 9, 19, 5, 5)
  })
}

export function profileFrameIcon(id) {
  return iconCanvas(`f:${id}`, (g) => {
    const f = PROFILE_FRAMES[id]
    if (!f) return
    // A little face...
    g.fillStyle = '#e8b48a'
    g.fillRect(12, 12, 24, 24)
    g.fillStyle = '#5a3b22'
    g.fillRect(12, 12, 24, 6)
    g.fillStyle = '#ffffff'
    g.fillRect(16, 22, 5, 4)
    g.fillRect(27, 22, 5, 4)
    g.fillStyle = '#2a4fa0'
    g.fillRect(18, 23, 3, 3)
    g.fillRect(29, 23, 3, 3)
    // ...in its frame.
    g.lineWidth = 6
    g.strokeStyle = f.colors.length > 2 ? gradient(g, 6, 42, f.colors) : gradient(g, 6, 42, [f.colors[0], f.colors[1], f.colors[0]])
    g.strokeRect(7, 7, 34, 34)
  })
}
