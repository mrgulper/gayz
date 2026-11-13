// Language check (2026-11-13): compares every language's text with
// English, the way the game itself uses it (src/game/i18n.js), so the
// owner can see what still needs translating.
//
// For each language:
//   missing - English has it, this language doesn't (players see English)
//   same    - exactly the English words (may be fine: "OK", "XP", names)
//   lines   - a different number of lines than English (can move the
//             homepage around - translations must keep English's shape)
//   params  - the {name} / {key:x} blanks don't match English's (a blank
//             left out shows nothing; an extra one shows "{name}")
//   extra   - text English no longer has (left over, safe to delete)
// "Full" languages (half or more done) list every line; the small ones
// only get their counts, so their thousands of missing lines don't flood
// the list.
import { STRINGS, LANGUAGES } from '../../src/game/i18n.js'

const MAX_SHOWN = 400
const short = (v) => (String(v).length > 140 ? `${String(v).slice(0, 140)}…` : String(v))
const blanks = (v) => (String(v).match(/\{[\w:]+\}/g) || []).sort().join(' ')
const lineCount = (v) => String(v).split('\n').length

export function languageReport() {
  const en = STRINGS.en
  const keys = Object.keys(en).filter((k) => typeof en[k] === 'string')
  const total = keys.length
  const languages = LANGUAGES.filter((l) => l.code !== 'en').map((l) => {
    const dict = STRINGS[l.code] || {}
    const missing = []
    const same = []
    const lines = []
    const params = []
    for (const k of keys) {
      const e = en[k]
      const v = dict[k]
      if (typeof v !== 'string') { missing.push(k); continue }
      if (v === e && /[a-z]{2}/i.test(e)) same.push(k)
      if (lineCount(v) !== lineCount(e)) lines.push(k)
      if (blanks(v) !== blanks(e)) params.push(k)
    }
    const extra = Object.keys(dict).filter((k) => !(k in en))
    const have = total - missing.length
    const full = have >= total / 2
    const row = (k) => ({ key: k, en: short(en[k]), text: typeof dict[k] === 'string' ? short(dict[k]) : '' })
    return {
      code: l.code,
      name: l.name,
      native: l.native,
      full,
      total,
      have,
      counts: { missing: missing.length, same: same.length, lines: lines.length, params: params.length, extra: extra.length },
      ...(full
        ? {
          missing: missing.slice(0, MAX_SHOWN).map(row),
          same: same.slice(0, MAX_SHOWN).map(row),
          lines: lines.slice(0, MAX_SHOWN).map(row),
          params: params.slice(0, MAX_SHOWN).map(row),
          extra: extra.slice(0, MAX_SHOWN).map((k) => ({ key: k, en: '', text: short(dict[k]) })),
        }
        : {}),
    }
  })
  return { total, languages }
}
