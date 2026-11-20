// Share codes (2026-11-20, social six plan Batch 2): a short line of text
// for a spin-ring loadout (the Ring & Bag window) or a custom lobby's
// rules (the Create Custom Lobby form). Copy it, send it to a friend any
// way you like, they paste it in and press Use. No server, works offline.
//
//   Ring:  GZR1-<items>   e.g. GZR1-brick.3_sawblade.0__   (rarity as 0-5, '_' = empty)
//   Lobby: GZL1-<base64url of { m: mode, r: rules }>
//
// Pasting a ring code only puts in items you own (RingItems.fitLoadout);
// the rest stay empty. A lobby code goes through cleanLobbyRules, so a
// hand-made code can't set anything the form couldn't.
import { parseKey, RARITIES, MAX_SLOTS } from './RingItems.js'
import { cleanLobbyRules, LOBBY_ZOMBIE_MODES, LOBBY_PARTY_MODES } from './LobbyRules.js'

const RING_PREFIX = 'GZR1-'
const LOBBY_PREFIX = 'GZL1-'

export function ringCode(keys) {
  const parts = (Array.isArray(keys) ? keys : []).slice(0, MAX_SLOTS).map((k) => {
    const p = typeof k === 'string' && k ? parseKey(k) : null
    return p ? `${p.id}.${RARITIES.indexOf(p.rarity)}` : ''
  })
  return RING_PREFIX + parts.join('_')
}

// A ring code -> the list of "id:rarity" keys ('' = empty), or null.
export function readRingCode(code) {
  const s = String(code || '').trim()
  if (!s.toUpperCase().startsWith(RING_PREFIX)) return null
  const body = s.slice(RING_PREFIX.length)
  if (body.length > 400) return null
  const out = body.split('_').slice(0, MAX_SLOTS).map((part) => {
    const m = /^([a-zA-Z0-9]+)\.([0-9])$/.exec(part)
    if (!m || !RARITIES[Number(m[2])]) return ''
    const key = `${m[1]}:${RARITIES[Number(m[2])]}`
    return parseKey(key) ? key : ''
  })
  return out.some(Boolean) ? out : null
}

function toB64url(str) {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromB64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

export function lobbyCode(mode, rules) {
  return LOBBY_PREFIX + toB64url(JSON.stringify({ m: mode, r: cleanLobbyRules(rules) }))
}

// A lobby code -> { mode, rules }, or null.
export function readLobbyCode(code) {
  const s = String(code || '').trim()
  if (!s.toUpperCase().startsWith(LOBBY_PREFIX) || s.length > 600) return null
  try {
    const d = JSON.parse(fromB64url(s.slice(LOBBY_PREFIX.length)))
    const rules = cleanLobbyRules(d?.r)
    if (!rules) return null
    const mode = [...LOBBY_ZOMBIE_MODES, ...LOBBY_PARTY_MODES].includes(d.m) ? d.m : 'main'
    return { mode, rules }
  } catch {
    return null
  }
}

// Copies text; false when the browser said no (the caller shows it to copy by hand).
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
