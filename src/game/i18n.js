// Central translation store. Keys are grouped by feature area; values may
// contain {placeholders} for interpolation and **word** markup for the
// literal keyboard-key labels embedded in control-hint sentences (rendered
// as <b> via tHtml). Keyboard key names themselves (WASD, Tab, Esc, F...)
// stay in Latin script across every language, matching how most localized
// games present keybinds.

import en from './i18n/en.js'
import zh from './i18n/zh.js'
import hi from './i18n/hi.js'
import es from './i18n/es.js'
import fr from './i18n/fr.js'
import ru from './i18n/ru.js'
import id from './i18n/id.js'
import de from './i18n/de.js'
import ja from './i18n/ja.js'
import vi from './i18n/vi.js'

// nameKey points at a languageName* string (see each language's own
// STRINGS block below) - the Settings > Language grid's bold label reads
// through t(nameKey) instead of the plain `name` field below, so the
// whole list re-labels into whichever language is currently active
// (native already did this on its own, being the language's own
// self-name in its own script either way - see Game.js's _bindSettings).
// `name` itself stays as a plain English fallback/reference label, not
// rendered directly anywhere anymore.
export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English', nameKey: 'languageNameEn' },
  { code: 'zh', name: 'Mandarin Chinese', native: '中文', nameKey: 'languageNameZh' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', nameKey: 'languageNameHi' },
  { code: 'es', name: 'Spanish', native: 'Español', nameKey: 'languageNameEs' },
  { code: 'fr', name: 'French', native: 'Français', nameKey: 'languageNameFr' },
  { code: 'ru', name: 'Russian', native: 'Русский', nameKey: 'languageNameRu' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia', nameKey: 'languageNameId' },
  { code: 'de', name: 'German', native: 'Deutsch', nameKey: 'languageNameDe' },
  { code: 'ja', name: 'Japanese', native: '日本語', nameKey: 'languageNameJa' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', nameKey: 'languageNameVi' },
  // Names added 2026-09-13 at Gaymi's request - neither has a STRINGS
  // block yet (falls back to English everywhere, same as any other
  // language would with zero keys), added when someone actually
  // translates them.
  { code: 'it', name: 'Italian', native: 'Italiano', nameKey: 'languageNameIt' },
  { code: 'pt-BR', name: 'Brazilian Portuguese', native: 'Português (Brasil)', nameKey: 'languageNamePtBr' },
]

const STRINGS = { en, zh, hi, es, fr, ru, id, de, ja, vi }

// Read by scripts/check-docs.mjs (typed key letters) - not used at runtime.
export { STRINGS }

let currentLang = 'en'

export function setLanguage(code) {
  currentLang = STRINGS[code] ? code : 'en'
}

// Text never types a key letter: it says {key:interact}, {key:healthPack}...
// and the player's real key fills in here (Keybinds.js registers the
// lookup), so a message can't go stale when a key moves or is rebound -
// "press H to use" outlived the hotbar move to slot 4 for days (2026-10-04).
// scripts/check-docs.mjs fails on a typed key letter in en/zh/hi/es.
let keyNameFor = () => undefined
export function setKeyNameLookup(fn) {
  keyNameFor = fn
}

function interpolate(str, params) {
  if (str.includes('{key:')) {
    str = str.replace(/\{key:(\w+)\}/g, (m, id) => keyNameFor(id) ?? m)
  }
  if (!params) return str
  return str.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? params[k] : `{${k}}`))
}

export function t(key, params) {
  const dict = STRINGS[currentLang] || STRINGS.en
  const raw = dict[key] ?? STRINGS.en[key] ?? key
  return interpolate(raw, params)
}

// Converts **token** markup to <b>token</b> for innerHTML rendering of
// control-hint strings that embed literal keyboard-key labels.
export function tHtml(key, params) {
  return t(key, params).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
}
