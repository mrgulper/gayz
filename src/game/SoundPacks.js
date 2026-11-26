// Sound packs (2026-11-25, big shop plan batch 8; music was dropped -
// Gaymi deleted the homepage music on 2026-11-22). Four kinds of sound,
// each ON by default with a normal sound, and each with 4 packs to buy in
// the Shop (10k / 25k / 50k / 100k coins, the Kill Effects ladder) that
// swap the normal sound for yours:
// - Kill: when you take a zombie down (normal: the heavy crunch).
// - Hit: when your shot lands (normal: the thud, + a ping on a headshot).
// - Jump: when you jump (normal: a soft thump - new with this batch).
// - Footsteps: while you walk (normal: concrete / grass / snow / wood by
//   the block under you - walking had no steps since old Map 1 went).
// Settings > Audio has an on/off switch for each kind (killSounds,
// hitSounds, jumpSounds, stepSounds). Only you hear your packs.
// Recordings: Kenney.nl packs (CC0), public/audio/sfx/pk_*.mp3 and
// jump_soft-1.mp3 (SFX list in Audio.js).
import { ownsShopCosmetic } from './Cosmetics.js'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

// sfx: the SFX name in Audio.js; len: cut short (seconds) so fast fire
// doesn't pile up; gain: how loud.
export const KILL_SOUNDS = {
  chipsKill: { price: 10000, sfx: 'pk_chips', gain: 0.7, color: '#ffd23f' },
  popKill: { price: 25000, sfx: 'pk_pop', gain: 0.8, color: '#ff8fd0' },
  zapKill: { price: 50000, sfx: 'pk_zap', gain: 0.55, len: 0.5, color: '#7fd8ff' },
  powerKill: { price: 100000, sfx: 'pk_power', gain: 0.5, len: 0.7, color: '#7dff8a' },
}
export const HIT_SOUNDS = {
  tickHit: { price: 10000, sfx: 'pk_tick', gain: 0.7, color: '#f4f6f8' },
  punchHit: { price: 25000, sfx: 'pk_punch', gain: 0.6, color: '#ff7a1a' },
  clangHit: { price: 50000, sfx: 'pk_clang', gain: 0.5, color: '#c0c6ce' },
  laserHit: { price: 100000, sfx: 'pk_laser', gain: 0.35, len: 0.22, color: '#ff3b3b' },
}
export const JUMP_SOUNDS = {
  hopJump: { price: 10000, sfx: 'pk_hop', gain: 0.4, color: '#7dffb0' },
  springJump: { price: 25000, sfx: 'pk_spring', gain: 0.4, color: '#ffe14d' },
  whooshJump: { price: 50000, sfx: 'pk_whoosh', gain: 0.5, color: '#bff4ff' },
  powerJump: { price: 100000, sfx: 'pk_powerjump', gain: 0.4, color: '#8a5cff' },
}
export const STEP_SOUNDS = {
  clickStep: { price: 10000, sfx: 'pk_click', gain: 0.5, color: '#f4f6f8' },
  tinStep: { price: 25000, sfx: 'pk_tin', gain: 0.35, color: '#9aa3ad' },
  crystalStep: { price: 50000, sfx: 'pk_crystal', gain: 0.3, color: '#7fd8ff' },
  robotStep: { price: 100000, sfx: 'pk_robot', gain: 0.25, len: 0.25, color: '#ff5ca8' },
}
export const KILL_SOUND_IDS = Object.keys(KILL_SOUNDS)
export const HIT_SOUND_IDS = Object.keys(HIT_SOUNDS)
export const JUMP_SOUND_IDS = Object.keys(JUMP_SOUNDS)
export const STEP_SOUND_IDS = Object.keys(STEP_SOUNDS)
const ALL = { ...KILL_SOUNDS, ...HIT_SOUNDS, ...JUMP_SOUNDS, ...STEP_SOUNDS }

const cap = (id) => `${id.charAt(0).toUpperCase()}${id.slice(1)}`
export const soundPackName = (id) => t(`soundPack${cap(id)}`)

// The pack I use for a kind, if I really own it.
function mine(game, setting, list) {
  const id = game?.settings?.[setting]
  return typeof id === 'string' && list[id] && ownsShopCosmetic(id) ? id : ''
}
export const myKillSound = (game) => mine(game, 'killSound', KILL_SOUNDS)
export const myHitSound = (game) => mine(game, 'hitSound', HIT_SOUNDS)
export const myJumpSound = (game) => mine(game, 'jumpSound', JUMP_SOUNDS)
export const myStepSound = (game) => mine(game, 'stepSound', STEP_SOUNDS)

// Settings > Audio switches (MoreSettingsList.js), on unless turned off.
const on = (game, key) => game?.settings?.[key] !== false

function playPack(id, out) {
  const p = ALL[id]
  if (!p) return false
  return audioEngine._playSfx?.(p.sfx, { out, gain: p.gain, len: p.len || 0, jitter: 0.05 }) || false
}

// My shot landed: kind 'kill' | 'head' | 'body'.
export function playMyHitSound(game, kind) {
  try {
    if (kind === 'kill') {
      if (!on(game, 'killSounds')) return
      if (!playPack(myKillSound(game))) audioEngine.playHit?.('kill')
      return
    }
    if (!on(game, 'hitSounds')) return
    if (!playPack(myHitSound(game))) audioEngine.playHit?.(kind)
  } catch { /* no audio */ }
}

export function playMyJumpSound(game) {
  try {
    if (!on(game, 'jumpSounds')) return
    if (!playPack(myJumpSound(game))) audioEngine._playSfx?.('jump_soft', { gain: 0.35, jitter: 0.08 })
  } catch { /* no audio */ }
}

// surface: 'grass' | 'snow' | 'wood' | 'default'.
export function playMyStepSound(game, surface) {
  try {
    if (!on(game, 'stepSounds')) return
    if (!playPack(myStepSound(game), audioEngine.footGain)) audioEngine.playFootstep?.(false, surface)
  } catch { /* no audio */ }
}

// Which footstep a block makes.
export function stepSurface(blockId) {
  const b = String(blockId || '').toLowerCase()
  if (/snow|ice/.test(b)) return 'snow'
  if (/grass|dirt|leaf|leaves|moss|hay|farm|mud/.test(b)) return 'grass'
  if (/wood|plank|log|oak|birch|spruce|bamboo/.test(b)) return 'wood'
  return 'default'
}

// A short listen when a pack is bought or picked in the Shop / Inventory,
// and my picks fetched ahead so the first one isn't silent.
export function previewSoundPack(id) {
  try { playPack(id) } catch { /* no audio */ }
}
export function preloadMySoundPacks(game) {
  for (const id of [myKillSound(game), myHitSound(game), myJumpSound(game), myStepSound(game)]) {
    if (ALL[id]) try { audioEngine._loadSfx?.(ALL[id].sfx) } catch { /* no audio */ }
  }
}

// --- Shop card pictures: a speaker in the pack's colour, with a mark for the kind ---
const icons = new Map()
function iconFor(kind, id) {
  const key = `${kind}:${id}`
  if (icons.has(key)) return icons.get(key)
  if (typeof document === 'undefined') return ''
  const c = document.createElement('canvas')
  c.width = c.height = 48
  const g = c.getContext('2d')
  const col = ALL[id]?.color || '#ffffff'
  // Speaker.
  g.fillStyle = '#2a2d33'
  g.fillRect(8, 18, 8, 12)
  g.beginPath()
  g.moveTo(16, 18)
  g.lineTo(26, 10)
  g.lineTo(26, 38)
  g.lineTo(16, 30)
  g.fill()
  // Sound waves in the pack's colour.
  g.strokeStyle = col
  g.lineWidth = 3
  for (const r of [6, 11, 16]) {
    g.beginPath()
    g.arc(26, 24, r, -Math.PI / 4, Math.PI / 4)
    g.stroke()
  }
  // Kind mark, bottom-left.
  g.fillStyle = col
  if (kind === 'kill') { g.fillRect(4, 38, 3, 8); g.fillRect(1, 41, 9, 2) }
  else if (kind === 'hit') { g.beginPath(); g.arc(6, 42, 4, 0, Math.PI * 2); g.fill() }
  else if (kind === 'jump') { g.beginPath(); g.moveTo(1, 46); g.lineTo(6, 38); g.lineTo(11, 46); g.fill() }
  else { g.fillRect(1, 41, 4, 5); g.fillRect(7, 37, 4, 5) }
  const url = c.toDataURL()
  icons.set(key, url)
  return url
}
export const killSoundIcon = (id) => iconFor('kill', id)
export const hitSoundIcon = (id) => iconFor('hit', id)
export const jumpSoundIcon = (id) => iconFor('jump', id)
export const stepSoundIcon = (id) => iconFor('step', id)
