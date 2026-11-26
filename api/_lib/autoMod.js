// Auto-mod (2026-11-26): spots rude words in what players send the team
// (feedback, player reports, reported map/build/clip names), so the
// owner's tools can cover them until the owner asks to read them, and the
// private Discord alerts leave the words out. Nothing is changed or
// deleted - it only adds a `rude` flag when a list is read.
//
// Words: the game's chat swear list (src/game/RudeWords.js) plus the
// owner's own, saved in the Realtime Database at
//   autoMod/words   ['word', 'short phrase', ...]  (at most AUTOMOD_WORDS_MAX)
import { PROFANITY_WORDS, rudeWordPattern } from '../../src/game/RudeWords.js'
import { ServerError } from './servers.js'

export const AUTOMOD_WORDS_MAX = 200
export const AUTOMOD_WORD_MAX = 40

// Letters (any language), numbers, spaces, ' and -. 2-40 characters.
export function cleanWords(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const v of list) {
    if (typeof v !== 'string') continue
    const w = v.toLowerCase().replace(/\s+/g, ' ').trim()
    if (w.length < 2 || w.length > AUTOMOD_WORD_MAX || !/^[\p{L}\p{N}' -]+$/u.test(w) || out.includes(w)) continue
    out.push(w)
    if (out.length >= AUTOMOD_WORDS_MAX) break
  }
  return out
}

// The strongest words also count inside a longer word ("shithead",
// "fuckface"). Only here, not in game chat: a wrong cover costs the owner
// one tap on Show, while chat would mangle a player's real word.
export const GLUED_ROOTS = ['fuck', 'shit', 'cunt', 'bitch', 'whore', 'nigg']
const LOOSE = (pattern) => pattern.replace(/^\(\?<!\[[^\]]*\]\)/, '').replace(/\(\?!\[[^\]]*\]\)$/, '')

// (...texts) => true if any of them holds a rude word.
export function rudeChecker(extra) {
  const words = [...new Set([...PROFANITY_WORDS, ...cleanWords(extra)])]
  const re = new RegExp([...words.map(rudeWordPattern), ...GLUED_ROOTS.map((w) => LOOSE(rudeWordPattern(w)))].join('|'), 'iu')
  return (...texts) => texts.some((t) => typeof t === 'string' && t && re.test(t))
}

export async function loadRudeChecker(db) {
  try {
    return rudeChecker(await db.get('autoMod/words'))
  } catch {
    return rudeChecker([])
  }
}

export async function autoModWords(db) {
  return cleanWords(await db.get('autoMod/words'))
}

export async function setAutoModWords(db, { words } = {}) {
  if (!Array.isArray(words)) throw new ServerError(400, 'bad-request')
  const clean = cleanWords(words)
  await db.update({ 'autoMod/words': clean.length ? clean : null })
  return { ok: true, words: clean }
}

// Adds `rude: true` to the rows that need covering.
export const flagReport = (isRude) => (r) => (isRude(r.text, r.targetName, r.byName) ? { ...r, rude: true } : r)
export const flagContent = (isRude) => (r) => (isRude(r.name, r.by) ? { ...r, rude: true } : r)
