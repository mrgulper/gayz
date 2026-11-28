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
import moreEn from './i18n/more-settings-en.js'
import moreZh from './i18n/more-settings-zh.js'
import moreHi from './i18n/more-settings-hi.js'
import moreEs from './i18n/more-settings-es.js'
import tradeEn from './i18n/trade-en.js'
import tradeZh from './i18n/trade-zh.js'
import tradeHi from './i18n/trade-hi.js'
import tradeEs from './i18n/trade-es.js'
import petDuelEn from './i18n/petduel-en.js'
import petDuelZh from './i18n/petduel-zh.js'
import petDuelHi from './i18n/petduel-hi.js'
import petDuelEs from './i18n/petduel-es.js'
import weeklyEn from './i18n/weekly-en.js'
import weeklyZh from './i18n/weekly-zh.js'
import weeklyHi from './i18n/weekly-hi.js'
import weeklyEs from './i18n/weekly-es.js'
import capsuleEn from './i18n/capsule-en.js'
import capsuleZh from './i18n/capsule-zh.js'
import capsuleHi from './i18n/capsule-hi.js'
import capsuleEs from './i18n/capsule-es.js'
import rankEn from './i18n/rank-en.js'
import rankZh from './i18n/rank-zh.js'
import rankHi from './i18n/rank-hi.js'
import rankEs from './i18n/rank-es.js'
import petTradeEn from './i18n/pettrade-en.js'
import petTradeZh from './i18n/pettrade-zh.js'
import petTradeHi from './i18n/pettrade-hi.js'
import petTradeEs from './i18n/pettrade-es.js'
import raidEn from './i18n/raid-en.js'
import raidZh from './i18n/raid-zh.js'
import raidHi from './i18n/raid-hi.js'
import raidEs from './i18n/raid-es.js'
import raceEn from './i18n/race-en.js'
import raceZh from './i18n/race-zh.js'
import raceHi from './i18n/race-hi.js'
import raceEs from './i18n/race-es.js'
import stepsEn from './i18n/steps-en.js'
import stepsZh from './i18n/steps-zh.js'
import stepsHi from './i18n/steps-hi.js'
import stepsEs from './i18n/steps-es.js'
import standEn from './i18n/stand-en.js'
import standZh from './i18n/stand-zh.js'
import standHi from './i18n/stand-hi.js'
import standEs from './i18n/stand-es.js'
import fossilEn from './i18n/fossil-en.js'
import fossilZh from './i18n/fossil-zh.js'
import fossilHi from './i18n/fossil-hi.js'
import fossilEs from './i18n/fossil-es.js'
import bugnetEn from './i18n/bugnet-en.js'
import bugnetZh from './i18n/bugnet-zh.js'
import bugnetHi from './i18n/bugnet-hi.js'
import bugnetEs from './i18n/bugnet-es.js'
import grappleEn from './i18n/grapple-en.js'
import grappleZh from './i18n/grapple-zh.js'
import grappleHi from './i18n/grapple-hi.js'
import grappleEs from './i18n/grapple-es.js'
import shrinkEn from './i18n/shrink-en.js'
import shrinkZh from './i18n/shrink-zh.js'
import shrinkHi from './i18n/shrink-hi.js'
import shrinkEs from './i18n/shrink-es.js'
import shopSkinsEn from './i18n/shopskins-en.js'
import shopSkinsZh from './i18n/shopskins-zh.js'
import shopSkinsHi from './i18n/shopskins-hi.js'
import shopSkinsEs from './i18n/shopskins-es.js'

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

// The 2026-11-11 settings keep their text in their own files.
Object.assign(en, moreEn)
Object.assign(zh, moreZh)
Object.assign(hi, moreHi)
Object.assign(es, moreEs)
// Skin Trades (SkinTrade.js, 2026-11-23).
Object.assign(en, tradeEn)
Object.assign(zh, tradeZh)
Object.assign(hi, tradeHi)
Object.assign(es, tradeEs)
// Friend pet battles (FriendBattle.js, 2026-11-23).
Object.assign(en, petDuelEn)
Object.assign(zh, petDuelZh)
Object.assign(hi, petDuelHi)
Object.assign(es, petDuelEs)
// Weekly Challenge (WeeklyChallenge.js, 2026-11-24).
Object.assign(en, weeklyEn)
Object.assign(zh, weeklyZh)
Object.assign(hi, weeklyHi)
Object.assign(es, weeklyEs)
// Time Capsule (TimeCapsule.js, 2026-11-27).
Object.assign(en, capsuleEn)
Object.assign(zh, capsuleZh)
Object.assign(hi, capsuleHi)
Object.assign(es, capsuleEs)
// Pet battle leaderboard (PetRank.js, 2026-11-24).
Object.assign(en, rankEn)
Object.assign(zh, rankZh)
Object.assign(hi, rankHi)
Object.assign(es, rankEs)
// Pet trading (PetTrade.js, 2026-11-24).
Object.assign(en, petTradeEn)
Object.assign(zh, petTradeZh)
Object.assign(hi, petTradeHi)
Object.assign(es, petTradeEs)
// Co-op Boss Raid (PetRaid.js, 2026-11-24).
Object.assign(en, raidEn)
Object.assign(zh, raidZh)
Object.assign(hi, raidHi)
Object.assign(es, raidEs)
// Pet Races (CampRace.js, 2026-11-27).
Object.assign(en, raceEn)
Object.assign(zh, raceZh)
Object.assign(hi, raceHi)
Object.assign(es, raceEs)
Object.assign(en, standEn)
Object.assign(zh, standZh)
Object.assign(hi, standHi)
Object.assign(es, standEs)
Object.assign(en, fossilEn)
Object.assign(zh, fossilZh)
Object.assign(hi, fossilHi)
Object.assign(es, fossilEs)
Object.assign(en, bugnetEn)
Object.assign(zh, bugnetZh)
Object.assign(hi, bugnetHi)
Object.assign(es, bugnetEs)
Object.assign(en, grappleEn)
Object.assign(zh, grappleZh)
Object.assign(hi, grappleHi)
Object.assign(es, grappleEs)
Object.assign(en, shrinkEn)
Object.assign(zh, shrinkZh)
Object.assign(hi, shrinkHi)
Object.assign(es, shrinkEs)
Object.assign(en, shopSkinsEn)
Object.assign(zh, shopSkinsZh)
Object.assign(hi, shopSkinsHi)
Object.assign(es, shopSkinsEs)
Object.assign(en, stepsEn)
Object.assign(zh, stepsZh)
Object.assign(hi, stepsHi)
Object.assign(es, stepsEs)
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
