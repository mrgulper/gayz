// The reading pages: Patch Notes / What's New (gated to the player's own midnight, the
// digest, the new-version card), How to Play, Credits, Terms of Use and the
// Privacy Policy.
//
// Moved out of Game.js (2026-10-16, bit by bit - see CLAUDE.md). Plain functions
// taking `game`, all state on the Game instance; Game.js keeps a one-line
// stand-in for each, so callers are unchanged.
import { CHANGELOG_LAST_VIEWED_KEY, HOWTOPLAY_STEPS, UPDATE_BANNER_FADE_MS, UPDATE_BANNER_SHOW_MS, WHATS_NEW_SEEN_KEY, WHATS_NEW_VERSION, saveSettings } from './Game.js'
import { t, tHtml } from './i18n.js'

// Update-available check - only ever called from _exitBuildMode (back
// at the homepage), never mid-game, so a fresh deploy
// while someone's playing never interrupts them; they just find out the
// next time they're actually looking at the main menu again. version.json
// carries the exact same build timestamp __BUILD_ID__ was compiled from
// (see vite.config.js) - if they differ, a newer build than the one
// currently loaded exists. Deliberately a timestamp, not the git hash
// __BUILD_HASH__ already carries - confirmed via a real production
// deploy that `vercel --prod`'s upload doesn't include .git, so the git
// hash is always the literal fallback string 'dev' there, useless for
// telling two real deploys apart. The "what changed" content isn't
// duplicated anywhere - it re-fetches the live index.html and reads its
// #changelog-list directly, so there's exactly one place (that list) to
// keep updated, same as today.
export async function _checkForUpdate(game) {
  if (!game.updateAvailableBanner || game.updateAvailableBanner.style.display === 'flex') return
  try {
    const versionRes = await fetch('/version.json', { cache: 'no-store' })
    const { id } = await versionRes.json()
    if (!id || id === __BUILD_ID__ || id === game.settings.lastSeenBuildId) return
    const pageRes = await fetch('/index.html', { cache: 'no-store' })
    const freshDoc = new DOMParser().parseFromString(await pageRes.text(), 'text/html')
    const freshChangelogList = freshDoc.getElementById('changelog-list')
    if (!freshChangelogList) return
    // What's New on game page gets the new notes too, so the card never
    // shows a version the Patch Notes don't have yet (2026-10-12, Gaymi:
    // the card said v0.17 while What's New still said v0.16) - and both
    // only show entries whose day has started on the player's clock.
    const list = document.getElementById('changelog-list')
    if (list) {
      list.innerHTML = freshChangelogList.innerHTML
      game._gateChangelog()
    }
    // Only the newest entry - the card is small; the full list is one
    // click away in What's New.
    const entries = [...(list || freshChangelogList).querySelectorAll('.changelog-entry:not(.changelog-future)')].slice(0, 1)
    if (!entries.length) return
    game.updateAvailableChangelog.innerHTML = entries.map((entry) => entry.outerHTML).join('')
    game._pendingUpdateId = id
    if (game.updateAvailableTitleEl) game.updateAvailableTitleEl.textContent = t('navLinkWhatsNew')
    if (game.updateAvailableRefreshBtn) game.updateAvailableRefreshBtn.textContent = t('updateAvailableRefreshBtn')
    game.updateAvailableBanner.classList.remove('fading')
    game.updateAvailableBanner.style.display = 'flex'
    _fitUpdateBanner(game)
    game._scheduleUpdateBannerFade()
  } catch {
    // A failed check (offline, blocked request, etc.) just means no
    // banner game time - not a player-facing error worth surfacing.
  }
}

// Patch Notes go live at 12am on each player's own clock (2026-10-12,
// Gaymi: "each player sees a new v# at their time zone at 12am"): an
// entry dated later than the player's local today is hidden until their
// midnight, then shown without a reload.
export function _gateChangelog(game) {
  const list = document.getElementById('changelog-list')
  if (!list) return
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const now = Date.now()
  for (const el of list.querySelectorAll('.changelog-entry')) {
    const m = /([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/.exec(el.querySelector('.changelog-date')?.textContent || '')
    const month = m ? MONTHS.indexOf(m[1]) : -1
    // Local midnight of the entry's date.
    const startsAt = month >= 0 ? new Date(Number(m[3]), month, Number(m[2])).getTime() : 0
    el.classList.toggle('changelog-future', startsAt > now)
  }
  clearTimeout(game._changelogMidnightTimer)
  const next = new Date()
  next.setHours(24, 0, 1, 0)
  game._changelogMidnightTimer = setTimeout(() => game._gateChangelog(), next.getTime() - now)
}

// The What's New card reaches down to the bottom of the profile card it
// sits over, so that's fully covered (2026-10-18, Gaymi: "make it wider up
// to down until it fully covers the profile" - taller, same width).
// Without the profile card on screen (phones) it keeps its CSS size.
export function _fitUpdateBanner(game) {
  const banner = game.updateAvailableBanner
  if (!banner || banner.style.display === 'none') return
  const badge = document.getElementById('menu-player-badge')
  const r = badge && getComputedStyle(badge).display !== 'none' ? badge.getBoundingClientRect() : null
  if (!r?.height) {
    banner.style.height = ''
    banner.style.maxHeight = ''
    return
  }
  const top = banner.getBoundingClientRect().top
  banner.style.maxHeight = 'none'
  banner.style.height = `${Math.max(120, r.bottom - top)}px`
}

// Fades the What's New card out by itself after UPDATE_BANNER_SHOW_MS if
// the player leaves it alone - the timer waits while the mouse is over it.
export function _scheduleUpdateBannerFade(game) {
  const banner = game.updateAvailableBanner
  clearTimeout(game._updateBannerTimer)
  if (!banner._fadeBound) {
    banner._fadeBound = true
    banner.addEventListener('mouseenter', () => clearTimeout(game._updateBannerTimer))
    banner.addEventListener('mouseleave', () => game._scheduleUpdateBannerFade())
    // Clicking anywhere else fades it away too (2026-10-18).
    document.addEventListener('pointerdown', (e) => {
      if (banner.style.display !== 'none' && !banner.contains(e.target)) game._hideUpdateBanner()
    }, true)
    window.addEventListener('resize', () => _fitUpdateBanner(game))
  }
  game._updateBannerTimer = setTimeout(() => game._hideUpdateBanner(), UPDATE_BANNER_SHOW_MS)
}

// Closed with the X or faded away: remember this version was seen, so
// coming back to the homepage doesn't show the same card again (a newer
// deploy still gets its own).
export function _hideUpdateBanner(game) {
  const banner = game.updateAvailableBanner
  if (!banner || banner.style.display === 'none') return
  clearTimeout(game._updateBannerTimer)
  game.settings.lastSeenBuildId = game._pendingUpdateId
  saveSettings(game.settings)
  banner.classList.add('fading')
  setTimeout(() => {
    if (banner.classList.contains('fading')) banner.style.display = 'none'
  }, UPDATE_BANNER_FADE_MS)
}

// What's New badge dot - a small red dot on the Credits nav button until
// the player has actually opened Credits at least once since
// WHATS_NEW_VERSION last changed (bump that constant on future updates).
export function _updateWhatsNewDot(game) {
  if (!game.whatsNewDot) return
  game.whatsNewDot.style.display = localStorage.getItem(WHATS_NEW_SEEN_KEY) === WHATS_NEW_VERSION ? 'none' : ''
}

// How to Play - a replayable overlay. Renders every step as one
// static scrollable list rather than a Next/Back stepper.
export function _openHowToPlayPanel(game) {
  game._closeAllMenuPanels()
  game.howtoplayPanel.style.display = 'flex'
  game.howtoplayPanelTitle.textContent = t('howtoplayPanelTitle')
  game.howtoplayContent.innerHTML = HOWTOPLAY_STEPS.map((step) => `<h3>${t(step.headingKey)}</h3><p>${tHtml(step.key)}</p>`).join('')
}

export function _closeHowToPlayPanel(game) {
  game.howtoplayPanel.style.display = 'none'
}

// Credits panel - static prose (dev/asset credits only), not a
// data-driven list, so no render step needed beyond the title.
export function _openCreditsPanel(game) {
  game._closeAllMenuPanels()
  game.creditsPanel.style.display = 'flex'
  game.creditsPanelTitle.textContent = t('creditsPanelTitle')
}

export function _closeCreditsPanel(game) {
  game.creditsPanel.style.display = 'none'
}

// "Last updated" on Terms and Privacy is the day the live build was made,
// so it moves with every game update (2026-10-24, Gaymi: "make terms of use
// and privacy policy update as the game updates"). The date in index.html
// is only the fallback. New online features also get a line in the text
// itself (see CLAUDE.md).
export function fillLegalUpdatedDates(root = document) {
  const day = typeof __BUILD_DATE__ === 'string' ? new Date(`${__BUILD_DATE__}T12:00:00Z`) : null
  if (!day || Number.isNaN(day.getTime())) return
  const text = `Last updated: ${day.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}`
  for (const el of root.querySelectorAll('#terms-content .legal-updated, #privacy-content .legal-updated')) el.textContent = text
}

export function _openTermsPanel(game) {
  game._closeAllMenuPanels()
  fillLegalUpdatedDates()
  game.termsPanel.style.display = 'flex'
  game.termsPanelTitle.textContent = t('termsBtn')
}

export function _closeTermsPanel(game) {
  game.termsPanel.style.display = 'none'
}

export function _openPrivacyPanel(game) {
  game._closeAllMenuPanels()
  fillLegalUpdatedDates()
  game.privacyPanel.style.display = 'flex'
  game.privacyPanelTitle.textContent = t('creditsPrivacyLink')
}

export function _closePrivacyPanel(game) {
  game.privacyPanel.style.display = 'none'
}

// What's New panel - split out from Credits (used to be one combined
// panel/nav entry point for both) so the changelog/build info content
// has its own dedicated place, distinct from the static dev-credits
// prose.
export function _openWhatsNewPanel(game) {
  if (!game.whatsNewPanel) return
  game._closeAllMenuPanels()
  game.whatsNewPanel.style.display = 'flex'
  if (game.whatsNewPanelTitle) game.whatsNewPanelTitle.textContent = t('whatsNewPanelTitle')
  // Paused, with where the news goes instead (2026-10-30): Discord's
  // #updates channel, the word Discord a link to the server invite.
  const pausedTitle = document.getElementById('whatsnew-paused-title')
  const pausedDiscord = document.getElementById('whatsnew-paused-discord')
  if (pausedTitle) pausedTitle.textContent = t('whatsNewPaused')
  if (pausedDiscord) {
    pausedDiscord.innerHTML = t('whatsNewPausedDiscord', {
      discord: '<a href="https://discord.gg/kukR72Euj6" target="_blank" rel="noopener noreferrer">Discord</a>',
    })
  }
  if (game.buildVersionLine) game.buildVersionLine.textContent = t('buildVersionLine')
  // What's New badge dot - clears the moment the player actually reads
  // game panel, not just on page load, so it stays a genuine "have you
  // seen game" indicator rather than a permanent decoration.
  try { localStorage.setItem(WHATS_NEW_SEEN_KEY, WHATS_NEW_VERSION) } catch { /* storage unavailable */ }
  // Separate from WHATS_NEW_SEEN_KEY above (that's a single version
  // string gating the nav-button dot) - game is an actual timestamp, so
  // the What's New card can diff real changelog entry dates against it,
  // not just know "has the dot been cleared."
  try { localStorage.setItem(CHANGELOG_LAST_VIEWED_KEY, String(Date.now())) } catch { /* storage unavailable */ }
  game._updateWhatsNewDot()
}

export function _closeWhatsNewPanel(game) {
  if (game.whatsNewPanel) game.whatsNewPanel.style.display = 'none'
}

// What's New digest (see #whats-new-digest) - a fuller, more prominent
// one-time, dismissible card of the changelog entries since your last
// visit (same lastViewed gate).
// Closing it (or opening Credits, which already does this) marks it
// seen - reload before dismissing and it shows again, which is the
// correct behavior for "you still haven't caught up."
export function _maybeShowWhatsNewDigest(game) {
  if (!game.whatsNewDigest) return
  // Show What's New Every Launch (General tab) - bypasses the normal
  // "only entries newer than my last visit" gate below and just shows
  // the most recent entries unconditionally, for anyone who wants the
  // reminder every time rather than only once per real update.
  let newEntries
  if (game.settings.whatsNewEveryLaunch) {
    newEntries = Array.from(document.querySelectorAll('#changelog-list .changelog-entry:not(.changelog-future)')).slice(0, 3)
  } else {
    const lastViewed = Number(localStorage.getItem(CHANGELOG_LAST_VIEWED_KEY))
    if (!lastViewed) return
    newEntries = Array.from(document.querySelectorAll('#changelog-list .changelog-entry:not(.changelog-future)')).filter((el) => {
      const parsed = Date.parse(el.querySelector('.changelog-date')?.textContent || '')
      return !isNaN(parsed) && parsed > lastViewed
    })
  }
  if (!newEntries.length) return
  game.whatsNewDigestTitle.textContent = t('whatsNewDigestTitle', { n: newEntries.length })
  // Our own static patch notes (index.html), never player data - the
  // bullet lists are copied as they are.
  game.whatsNewDigestList.innerHTML = newEntries.map((el) => `<div class="changelog-text">${el.querySelector('.changelog-text')?.innerHTML || ''}</div>`).join('')
  game.whatsNewDigest.style.display = 'block'
  game.whatsNewDigest.classList.remove('fading')
  // Auto-fade after 10s if left untouched (2026-09-18) - it used to just
  // sit open indefinitely until the player noticed the X, which meant it
  // was still covering the corner of the screen in every homepage
  // screenshot from an entire play session. Cleared if the player closes
  // it manually first, and the Play button click handler below also
  // triggers game same fade immediately, so it never carries into an
  // actual run.
  game._whatsNewDigestFadeTimer = setTimeout(() => game._fadeOutWhatsNewDigest(), 10000)
}

// Shared by the 10s idle timer above and the Play button click handler -
// fades instead of vanishing instantly (see .fading in style.css), then
// actually hides it once the transition finishes so it's not sitting
// there invisible-but-still-in-the-DOM. Deliberately does NOT mark the
// digest as seen or touch the What's New dot, unlike the explicit X
// close button - the player never actually read it, so it should still
// show again next launch, same as if they'd never seen it at all.
export function _fadeOutWhatsNewDigest(game) {
  if (!game.whatsNewDigest || game.whatsNewDigest.style.display === 'none') return
  clearTimeout(game._whatsNewDigestFadeTimer)
  game.whatsNewDigest.classList.add('fading')
  setTimeout(() => { game.whatsNewDigest.style.display = 'none' }, 600)
}

