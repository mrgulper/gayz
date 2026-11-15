// Custom lobbies (2026-11-15, spin ring plan Batch 4): a server whose host
// sets the rules - the mode, how many players, a password, ring or guns,
// friendly fire for the ring, and how strong the zombies and players are.
// Made from the Global panel's Custom tab (ServerBrowser.js / CustomLobbyUI.js);
// the server keeps the rules (api/_lib/servers.js cleanRules uses
// cleanLobbyRules below) and hands them to everyone who joins, and
// BuildSurvival.applyLobbyRules puts them into the game.
//
// Easy rules earn less (Gaymi: "less when rules are easy"): rewardMult()
// scales coins, Legacy Points and ring-item drops down - never up.
//
// Plain data, no page or i18n imports: the server code imports it too.

// The value pickers in the Create Custom Lobby form. Every one also has a
// Custom choice where you type your own number (kept inside min/max).
export const LOBBY_PICKS = {
  max: { def: 8, min: 2, max: 8, step: 1, choices: [2, 4, 6, 8] },
  zh: { def: 1, min: 0.25, max: 5, step: 0.05, choices: [0.5, 1, 1.5, 2, 3] },
  zc: { def: 1, min: 0.25, max: 4, step: 0.05, choices: [0.5, 1, 1.5, 2, 3] },
  boss: { def: 0, min: 0, max: 20, step: 1, choices: [0, 3, 5, 10] },
  hp: { def: 100, min: 25, max: 500, step: 5, choices: [50, 100, 150, 200, 300] },
  dmg: { def: 1, min: 0.25, max: 5, step: 0.05, choices: [0.5, 1, 1.5, 2, 3] },
  spd: { def: 1, min: 0.5, max: 2, step: 0.05, choices: [0.75, 1, 1.25, 1.5] },
}

// The modes a custom lobby can be (the server's own mode ids). Zombie
// modes first, then the party games.
export const LOBBY_ZOMBIE_MODES = ['main', 'zone', 'td', 'infection']
export const LOBBY_PARTY_MODES = ['hide', 'ctf', 'koth', 'soccer', 'potato', 'bowling', 'paint', 'build', 'lava', 'laser', 'kart', 'parkour', 'duel', 'golf', 'freeze', 'bomb', 'werewolf', 'dodge', 'chairs', 'simon', 'prop', 'tug']
// Modes where the ring (instead of guns) is a choice: the ones with waves.
export const LOBBY_RING_MODES = ['main', 'zone', 'td']

export const PASSWORD_MAX = 24

export function defaultLobbyRules() {
  const out = { ring: true, ff: false }
  for (const [k, p] of Object.entries(LOBBY_PICKS)) out[k] = p.def
  return out
}

function clampPick(k, v) {
  const p = LOBBY_PICKS[k]
  const n = Number(v)
  if (!Number.isFinite(n)) return p.def
  const c = Math.max(p.min, Math.min(p.max, n))
  return Number((Math.round(c / p.step) * p.step).toFixed(2))
}

// Anything sent in (the form, the server, a stored lobby) -> safe rules.
export function cleanLobbyRules(r) {
  if (!r || typeof r !== 'object') return null
  const out = { ring: r.ring !== false, ff: r.ring !== false && r.ff === true }
  for (const k of Object.keys(LOBBY_PICKS)) out[k] = clampPick(k, r[k])
  return out
}

// How much of the normal rewards these rules earn: 1 for normal or harder
// rules, less the easier they are (never under 0.1).
export function rewardMult(r) {
  if (!r) return 1
  const easy = (r.dmg * (r.hp / 100) * Math.sqrt(r.spd)) / (r.zh * Math.sqrt(r.zc))
  if (!(easy > 1)) return 1
  return Math.max(0.1, Math.round((1 / easy) * 20) / 20)
}

// The rules that differ from normal, as [key, value] pairs (the row's
// little chips and the "Custom rules" message in game).
export function changedRules(r) {
  if (!r) return []
  const d = defaultLobbyRules()
  const out = []
  if (!r.ring) out.push(['ring', false])
  if (r.ff) out.push(['ff', true])
  for (const k of ['zh', 'zc', 'boss', 'hp', 'dmg', 'spd']) if (r[k] !== d[k]) out.push([k, r[k]])
  return out
}
