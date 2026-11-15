// Homepage unlock ladder (2026-11-15). Brand-new players see a short
// homepage; finished games (careerStats.totalRuns) bring the rest back:
// 1 game = Store, Upgrades, Inventory, Quests (+ Features, Credits,
// Feedback); 3 = Global (chat), Friendship, Cloud Save, Hall of Fame;
// 5 = Market, Map Editor, Design a Skin, Gallery (= everything). Which
// tier an element belongs to is its `data-unlock` attribute in index.html;
// `html[data-home-tier]` + CSS (08-homepage.css) hides the locked ones.
// The "More..." nav button opens everything for good. Discord, Play,
// Settings and the legal links never lock.
//
// Who gets it: only a device with no saved settings and no finished game
// the first time it opens GayZ (LADDER_KEY = 'on'). Everyone else - any
// player who already had GayZ open before this shipped - keeps the full
// homepage. The same check runs in index.html's <head> anti-flash script
// so the first paint is already the final look; keep the two in step.
// Automated browsers (navigator.webdriver) are never enrolled, so tests
// see the full homepage unless they set LADDER_KEY themselves.
import { t } from './i18n.js'

export const LADDER_KEY = 'gayz-home-ladder'
export const TIERS = [1, 3, 5]

export function tierForRuns(runs) {
  const n = Number(runs) || 0
  if (n >= 5) return null
  if (n >= 3) return 3
  if (n >= 1) return 1
  return 0
}

function _ladderOn() {
  try { return localStorage.getItem(LADDER_KEY) === 'on' } catch { return false }
}

function _setLadderOff() {
  try { localStorage.setItem(LADDER_KEY, 'off') } catch { /* private mode */ }
}

// Current tier (0/1/3) or null for the full homepage.
export function currentTier(game) {
  if (!_ladderOn()) return null
  return tierForRuns(game.careerStats?.totalRuns)
}

function _apply(tier) {
  const root = document.documentElement
  if (tier === null) delete root.dataset.homeTier
  else root.dataset.homeTier = String(tier)
  window.__menuLayout?.fit?.()
}

// Re-reads the tier. With announce, a tier that just went up shows a
// toast naming what's new (called right after a game is counted).
export function refreshHomeUnlocks(game, { announce = false } = {}) {
  const before = game._homeTier === undefined ? currentTier(game) : game._homeTier
  const tier = currentTier(game)
  if (tier === null && _ladderOn()) _setLadderOff()
  game._homeTier = tier
  _apply(tier)
  if (!announce || before === null) return
  const from = before
  const to = tier === null ? 5 : tier
  const reached = TIERS.filter((n) => n > from && n <= to).pop()
  if (reached) game._showLoreToast(t(`homeUnlock${reached}`))
}

export function initHomeUnlocks(game) {
  const btn = document.getElementById('menu-more-btn')
  if (btn) {
    btn.querySelector('span').textContent = t('homeMoreBtn')
    btn.title = t('homeMoreTitle')
    btn.addEventListener('click', () => {
      _setLadderOff()
      game._homeTier = null
      _apply(null)
    })
  }
  refreshHomeUnlocks(game)
}

export function translateHomeUnlocks() {
  const btn = document.getElementById('menu-more-btn')
  if (!btn) return
  btn.querySelector('span').textContent = t('homeMoreBtn')
  btn.title = t('homeMoreTitle')
}
