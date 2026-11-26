// Rude words (2026-11-26): the game's chat swear list, moved out of
// Game.js so the server's auto-mod (api/_lib/autoMod.js) checks the very
// same words. Game.js's _censorText still swaps them in chat.
export const PROFANITY_WORDS = [
  'bitch', 'bitches',
  'fuck', 'fucks', 'fucking', 'fucked', 'fucker', 'fuckers', 'fuckup', 'motherfucker',
  'shit', 'shits', 'shitty', 'bullshit',
  'cunt', 'cunts', 'dick', 'dicks', 'dickhead',
  'cock', 'cocks', 'pussy', 'pussies', 'whore', 'whores', 'slut', 'sluts',
  'twat', 'twats', 'prick', 'pricks', 'wanker', 'wankers',
  'nigga', 'niggas', 'nigger', 'niggers',
]

// Letter -> the character class matching every common stand-in for it,
// so "sh1t"/"$hit"/"sh*t" all still hit the same pattern as "shit". '*'
// is included on vowels specifically since that's the common
// self-censoring style ("f*ck", "sh*t"), not just a leetspeak swap.
export const PROFANITY_LEET_MAP = {
  a: 'a4@*', e: 'e3*', i: 'i1!*', o: 'o0*', u: 'u*',
  s: 's5$', t: 't7', b: 'b8', g: 'g9', l: 'l1',
}

const escapeRe = (ch) => ch.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')

// The regex source for one word (or short phrase): each letter also
// matches its stand-ins, spaces match any run of spaces, and the match
// can't sit inside a longer word ("class" never matches "ass").
export function rudeWordPattern(word) {
  const body = String(word).toLowerCase().split('').map((ch) => {
    if (/\s/.test(ch)) return '\\s+'
    const cls = PROFANITY_LEET_MAP[ch]
    return cls ? `[${escapeRe(cls)}]` : escapeRe(ch)
  }).join('')
  return `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`
}
