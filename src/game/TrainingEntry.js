// Ways into the Training Ground (TrainingGround.js), 2026-11-23:
// - a "Training Ground" button at the top of How to Play (always there),
// - a small "New here?" popup on a first visit (no games played yet), with
//   Let's go / Skip (Gaymi's pick: ask, don't force). It asks once.
// Kept apart from TrainingGround.js so the homepage never loads the 3D
// parts just to show a button.
import { t } from './i18n.js'
import { _safeStatNumber } from './Game.js'

const ASKED_KEY = 'gayz-training-asked'
// How long after the homepage is ready the popup waits (ms).
const ASK_DELAY_MS = 1500

function asked() {
  try { return localStorage.getItem(ASKED_KEY) === '1' } catch { return true }
}

function markAsked() {
  try { localStorage.setItem(ASKED_KEY, '1') } catch { /* storage blocked: it may ask again */ }
}

// Starts a Training Ground game (BuildSurvival.start reads _trainingNext).
export function startTraining(game) {
  markAsked()
  closeInvite()
  game._closeAllMenuPanels?.()
  game._couchNext = false
  game._trainingNext = true
  Promise.resolve(game._enterBuildMode({ map: 'map3', play: true })).catch(() => { game._trainingNext = false })
}

// The top of How to Play (InfoPagesUI._openHowToPlayPanel).
export function howToPlayTrainingHtml() {
  return `<div class="howtoplay-training"><p>${t('trainingAbout')}</p><button type="button" class="settings-reset-btn" id="howtoplay-training-btn">${t('trainingBtn')}</button></div>`
}

export function bindHowToPlayTraining(game, root) {
  root.querySelector('#howtoplay-training-btn')?.addEventListener('click', () => startTraining(game))
}

// From the homepage render (HomeExtras.renderPlayTags): a first visit gets
// the popup once. Automated tests keep it off unless they ask for it
// (__trainingInviteForTests).
export function maybeInviteToTraining(game, hasSavedRun) {
  if (game._trainingInviteTimer || asked() || hasSavedRun) return
  if (_safeStatNumber(game.careerStats?.totalRuns) !== 0) return
  if (typeof navigator !== 'undefined' && navigator.webdriver && !window.__trainingInviteForTests) return
  game._trainingInviteTimer = setTimeout(() => {
    game._trainingInviteTimer = null
    // Only on the homepage itself, with nothing open over it.
    const menu = document.getElementById('menu')
    if (!menu || getComputedStyle(menu).display === 'none' || document.body.classList.contains('build-mode-on')) return
    // A panel open (its address isn't "/"): ask on a later homepage visit.
    if (location.pathname !== '/' || document.querySelector('#reset-confirm-modal.open')) return
    openInvite(game)
  }, ASK_DELAY_MS)
}

function openInvite(game) {
  if (asked()) return
  let modal = document.getElementById('training-invite-modal')
  if (!modal) {
    modal = document.createElement('div')
    modal.id = 'training-invite-modal'
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    modal.setAttribute('aria-labelledby', 'training-invite-title')
    modal.innerHTML = `<div class="panel-box" id="training-invite-box">
        <h3 id="training-invite-title"></h3>
        <p id="training-invite-text"></p>
        <div id="training-invite-actions">
          <button type="button" id="training-invite-skip-btn" class="settings-reset-btn"></button>
          <button type="button" id="training-invite-yes-btn" class="settings-reset-btn"></button>
        </div>
      </div>`
    document.getElementById('app')?.appendChild(modal) || document.body.appendChild(modal)
    const skip = () => {
      markAsked()
      closeInvite()
    }
    modal.querySelector('#training-invite-skip-btn').addEventListener('click', skip)
    modal.querySelector('#training-invite-yes-btn').addEventListener('click', () => startTraining(game))
    // A click outside the card, or Escape, is a Skip.
    modal.addEventListener('click', (e) => { if (e.target === modal) skip() })
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') skip() })
  }
  modal.querySelector('#training-invite-title').textContent = t('trainingInviteTitle')
  modal.querySelector('#training-invite-text').textContent = t('trainingInviteText')
  modal.querySelector('#training-invite-skip-btn').textContent = t('trainingInviteSkip')
  modal.querySelector('#training-invite-yes-btn').textContent = t('trainingInviteYes')
  modal.classList.add('open')
  modal.querySelector('#training-invite-yes-btn').focus()
}

function closeInvite() {
  document.getElementById('training-invite-modal')?.classList.remove('open')
}
