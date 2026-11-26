// Going Public (2026-11-26): the owner's launch checklist - everything to
// do before strangers play (the CrazyGames build, a domain, the legal
// pages...) - and the day the game went public, which the owner's Charts
// can count from so the owner's own test logins before it stay out.
//
// Saved in the Realtime Database at
//   launch/items     [{ id, group: 'cg'|'pub'|'own', text, done }, ...]
//   launch/publicAt  ms, or missing while the game isn't public yet
// Nothing here reaches players.
import { ServerError } from './servers.js'

export const LAUNCH_ITEMS_MAX = 60
export const LAUNCH_TEXT_MAX = 120
const GROUPS = ['cg', 'pub', 'own']

// The ready-made list (from the CrazyGames checklist and the open notes).
// Shown until the owner saves their own copy.
export const LAUNCH_DEFAULTS = [
  ['cg', 'Game finds its files from any web address (CrazyGames build)'],
  ['cg', 'Online servers work from the CrazyGames site'],
  ['cg', 'Hide Google, Discord and Steam sign-in'],
  ['cg', 'Hide the Fullscreen option (CrazyGames adds its own)'],
  ['cg', 'Discord link small, not a main homepage button'],
  ['cg', 'Chat filter for Chinese, Hindi and Spanish'],
  ['cg', 'Loads in 20 seconds, first download under 50 MB'],
  ['cg', 'Works in Chrome, Edge and Safari'],
  ['cg', 'Description, controls list, cover pictures and a short video'],
  ['cg', 'CrazyGames toolkit: ads, accounts, multiplayer (Full Launch)'],
  ['pub', 'Buy a domain (optional)'],
  ['pub', 'Re-read the Terms of Use and Privacy Policy'],
  ['pub', 'Fill in Terms section 13 (your country or state)'],
  ['pub', "Turn What's New back on"],
  ['pub', 'Database limits ready for more players'],
  ['pub', 'Full test run all green'],
  ['pub', 'Play it once on a phone'],
].map(([group, text], i) => ({ id: `d${i + 1}`, group, text, done: false }))

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const cleanText = (v) => String(v ?? '').replace(/[<>]/g, '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LAUNCH_TEXT_MAX)

export function cleanItems(list) {
  if (!Array.isArray(list)) return null
  const out = []
  const seen = new Set()
  for (const v of list) {
    if (out.length >= LAUNCH_ITEMS_MAX) break
    if (!v || typeof v !== 'object') continue
    const text = cleanText(v.text)
    const id = String(v.id ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20)
    if (!text || !id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, group: GROUPS.includes(v.group) ? v.group : 'own', text, done: v.done === true })
  }
  return out
}

export async function launchState(db) {
  const saved = await db.get('launch')
  const items = cleanItems(saved?.items) || LAUNCH_DEFAULTS
  return { items, publicAt: Number(saved?.publicAt) || 0, defaults: LAUNCH_DEFAULTS, max: LAUNCH_ITEMS_MAX }
}

export async function saveLaunchItems(db, { items } = {}) {
  const clean = cleanItems(items)
  if (!clean) throw new ServerError(400, 'bad-request')
  await db.update({ 'launch/items': clean })
  return { ok: true, items: clean }
}

// on: true marks today (or `at`, for a launch that already happened) as
// launch day; on: false undoes it.
export async function setLaunchPublic(db, { on, at } = {}, now = Date.now()) {
  if (on !== true && on !== false) throw new ServerError(400, 'bad-request')
  const when = Number(at) > 0 && Number(at) <= now ? Number(at) : now
  await db.update({ 'launch/publicAt': on ? when : null })
  return { ok: true, publicAt: on ? when : 0 }
}
