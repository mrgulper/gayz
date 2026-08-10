// Homepage-only menu flourishes and easter eggs - Konami code, idle
// animation, background parallax, logo click counter, hidden-icon/typed
// secrets, changelog trivia, the shortcut cheat sheet, and the one-day
// April Fools flip. None of this touches gameplay state or the THREE.js
// scene: every listener here is guarded by `if (game.gameStarted) return`
// (or only wired up while still on the homepage), so the worst-case
// failure is a cosmetic easter egg not firing - never a broken run.
//
// Plain exported functions taking `game` as an explicit first parameter,
// matching this codebase's convention for UI-adjacent (non-simulation)
// modules like Keybinds.js/CloudSync.js - not an instantiated class like
// Companion/Vehicle, since this is one-shot event wiring with no per-frame
// update() lifecycle of its own.
import { t } from './i18n.js'
import { _escapeHtml } from './Game.js'

// Homepage-only Konami code (see bindKonamiCode) - the classic arrow-key
// version, unlike Game.js's own SECRET_SEQUENCE which deliberately avoided
// arrows because they're a movement fallback in-game. Arrows are unbound
// on the homepage, so there's no such conflict here.
export const KONAMI_CODE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA']

// Obviously-fake joke "tips" (hidden zombie icon, and the Joke Tip ticker
// mode in Game.js) - deliberately absurd, distinct from SPOTLIGHT_TIPS
// (genuinely actionable survival advice) so the two tones never blend.
export const JOKE_TIPS = ['jokeTip1', 'jokeTip2', 'jokeTip3', 'jokeTip4', 'jokeTip5', 'jokeTip6']

// Gross/funny variant of Game.js's TRIVIA_FACTS lore-trivia pool - same
// day-seeded pattern there, separate array so the two tones don't blend.
export const FUNNY_TRIVIA = ['funnyTrivia1', 'funnyTrivia2', 'funnyTrivia3', 'funnyTrivia4', 'funnyTrivia5', 'funnyTrivia6']

// Purely cosmetic (a toast + brief CSS flourish on #menu), no gameplay
// effect at all. Only listens while still on the menu (!gameStarted) -
// once a run starts, arrow keys are free to mean whatever gameplay
// already binds them to.
export function bindKonamiCode(game) {
  game._konamiBuffer = []
  window.addEventListener('keydown', (e) => {
    if (game.gameStarted) return
    game._konamiBuffer.push(e.code)
    if (game._konamiBuffer.length > KONAMI_CODE.length) game._konamiBuffer.shift()
    if (game._konamiBuffer.length === KONAMI_CODE.length && game._konamiBuffer.every((c, i) => c === KONAMI_CODE[i])) {
      game._konamiBuffer = []
      game._showHomepageToast(t('konamiActivated'))
      if (game.menu) {
        game.menu.classList.add('konami-flourish')
        setTimeout(() => game.menu.classList.remove('konami-flourish'), 2000)
      }
    }
  })
}

// Idle animation - a subtle Play-button pulse after 30s of no homepage
// interaction (mouse/keyboard/click, throttled to once per event type via
// the timer reset itself, no extra state needed). Only active while still
// on the menu - removed the instant a run starts or the player
// moves/clicks again.
export function bindIdleAnimation(game) {
  const IDLE_MS = 30000
  const resetTimer = () => {
    if (game.gameStarted) return
    if (game.menu) game.menu.classList.remove('menu-idle')
    clearTimeout(game._idleTimer)
    game._idleTimer = setTimeout(() => {
      if (!game.gameStarted && game.menu) game.menu.classList.add('menu-idle')
    }, IDLE_MS)
  }
  window.addEventListener('mousemove', resetTimer)
  window.addEventListener('keydown', resetTimer)
  window.addEventListener('click', resetTimer)
  resetTimer()
}

// Hidden logo click counter - 10 clicks on the title triggers a tiny,
// purely cosmetic easter egg (same konami-flourish CSS class the Konami
// code already uses, no second effect to build). Resets after firing or
// after a long pause between clicks so it can't be reached by accident.
export function bindLogoClickCounter(game) {
  if (!game.menuTitle) return
  game._logoClickCount = 0
  game.menuTitle.addEventListener('click', () => {
    const now = performance.now()
    if (game._lastLogoClickAt && now - game._lastLogoClickAt > 2000) game._logoClickCount = 0
    game._lastLogoClickAt = now
    game._logoClickCount += 1
    if (game._logoClickCount >= 10) {
      game._logoClickCount = 0
      game._showHomepageToast(t('logoClickEasterEgg'))
      if (game.menu) {
        game.menu.classList.add('konami-flourish')
        setTimeout(() => game.menu.classList.remove('konami-flourish'), 2000)
      }
    }
  })
}

// Homepage-only shortcut keys: "?" opens the cheat sheet below, Escape
// closes whichever homepage-reachable panel is currently open (a real gap
// this fills - previously the only way to close these was clicking the
// panel's own backdrop, so a keyboard-only user had no way to close one at
// all; now the cheat sheet's own Escape line is actually true).
export function bindHomepageShortcutKeys(game) {
  const panelCloseFns = [
    [game.settingsPanel, () => game._toggleSettings(false)],
    [game.cloudsavePanel, () => game._closeCloudSavePanel()],
    [game.upgradesPanel, () => game._closeUpgradesPanel()],
    [game.coinshopPanel, () => game._closeCoinShopPanel()],
    [game.questsPanel, () => game._closeQuestsPanel()],
    [game.sharePanel, () => game._closeSharePanel()],
    [game.achievementsPanel, () => game._closeAchievementsPanel()],
    [game.hubPanel, () => game._closeHubPanel()],
    [game.friendsPanel, () => game._closeFriendsPanel()],
    [game.menuInventoryPanel, () => game._closeMenuInventoryPanel()],
    [game.howtoplayPanel, () => game._closeHowToPlayPanel()],
    [game.creditsPanel, () => game._closeCreditsPanel()],
    [game.profilePanel, () => game._closeProfilePanel()],
  ]
  window.addEventListener('keydown', (e) => {
    if (game.gameStarted) return
    if (e.key === '?') {
      e.preventDefault()
      toggleShortcutCheatsheet(game)
      return
    }
    if (e.code === 'KeyR' && game._lastPanelOpener) {
      game._lastPanelOpener()
      return
    }
    if (e.code === 'Escape') {
      if (game.shortcutCheatsheet && game.shortcutCheatsheet.style.display !== 'none') {
        game.shortcutCheatsheet.style.display = 'none'
        return
      }
      // getComputedStyle, not panel.style.display - a panel that's never
      // been toggled at least once (fresh page load) is hidden via its own
      // CSS rule's default display:none, not an inline style, so checking
      // the inline property alone would misread it as "open" and swallow
      // the very first Escape press before it ever reaches a genuinely
      // open panel.
      for (const [panel, close] of panelCloseFns) {
        if (panel && getComputedStyle(panel).display !== 'none') { close(); return }
      }
    }
  })
}

export function toggleShortcutCheatsheet(game) {
  if (!game.shortcutCheatsheet) return
  const opening = game.shortcutCheatsheet.style.display === 'none'
  if (opening) {
    game.shortcutCheatsheetTitle.textContent = t('shortcutCheatsheetTitle')
    const rows = [
      ['?', t('shortcutRowHelp')],
      ['Tab', t('shortcutRowTab')],
      ['Enter / Space', t('shortcutRowActivate')],
      ['Escape', t('shortcutRowEscape')],
      ['R', t('shortcutRowReopen')],
    ]
    game.shortcutCheatsheetList.innerHTML = rows.map(([key, label]) => `<div class="shortcut-row"><kbd>${_escapeHtml(key)}</kbd><span>${_escapeHtml(label)}</span></div>`).join('')
  }
  game.shortcutCheatsheet.style.display = opening ? 'block' : 'none'
}

// Hidden zombie icon click (see #hidden-zombie-icon's own comment) -
// purely a joke toast, no gameplay effect.
export function bindHiddenZombieIcon(game) {
  const icon = document.getElementById('hidden-zombie-icon')
  if (!icon) return
  icon.addEventListener('click', () => {
    const key = JOKE_TIPS[Math.floor(Math.random() * JOKE_TIPS.length)]
    game._showHomepageToast(t(key))
  })
}

// Typing "zombie" anywhere on the homepage triggers the same cosmetic
// flourish the Konami code/logo-click secrets already use - a rolling
// letter buffer against the literal word, same shape as KONAMI_CODE's own
// check.
export function bindZombieTypedSecret(game) {
  game._zombieTypedBuffer = ''
  window.addEventListener('keydown', (e) => {
    if (game.gameStarted || !e.key || e.key.length !== 1) return
    game._zombieTypedBuffer = (game._zombieTypedBuffer + e.key).slice(-6).toLowerCase()
    if (game._zombieTypedBuffer === 'zombie') {
      game._zombieTypedBuffer = ''
      game._showHomepageToast(t('zombieTypedSecret'))
      if (game.menu) {
        game.menu.classList.add('konami-flourish')
        setTimeout(() => game.menu.classList.remove('konami-flourish'), 2000)
      }
    }
  })
}

// Clicking a Credits changelog entry shows a bonus flavor fact - reuses
// the existing FUNNY_TRIVIA pool (see its own comment) rather than
// authoring a unique fact per entry, which would need editing every time a
// new changelog line is added.
export function bindChangelogFactClicks(game) {
  const list = document.getElementById('changelog-list')
  if (!list) return
  list.addEventListener('click', (e) => {
    if (!e.target.closest('.changelog-entry')) return
    const key = FUNNY_TRIVIA[Math.floor(Math.random() * FUNNY_TRIVIA.length)]
    game._showHomepageToast(t(key))
  })
}

// April Fools - a single date-gated cosmetic flip (upside-down title),
// real UTC/local date check, not a random chance. Reverts itself
// naturally the next day since this just checks today's date on load.
export function applyAprilFools(game) {
  const now = new Date()
  if (now.getMonth() === 3 && now.getDate() === 1 && game.menuTitle) {
    game.menuTitle.classList.add('april-fools-flip')
  }
}

export function bindAll(game) {
  bindKonamiCode(game)
  bindIdleAnimation(game)
  bindLogoClickCounter(game)
  bindHiddenZombieIcon(game)
  bindZombieTypedSecret(game)
  bindChangelogFactClicks(game)
  applyAprilFools(game)
  bindHomepageShortcutKeys(game)
}
