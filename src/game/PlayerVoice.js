// Feedback, polls and error reports (2026-11-13). Server side:
// api/_lib/inbox.js through /api/live.
//
// - Feedback: the homepage's bottom "Feedback" link opens a small box
//   (Idea / Bug / Other + a message). A bug also sends this device's
//   details (device, browser, screen, language, build) - what the old
//   Settings "Copy Bug Report" button used to copy. A few per hour.
// - Polls: a quick poll from the team pops up once on the homepage (vote
//   or "Not now"); LiveConfig's `poll`. Never over the maintenance screen
//   or a warning, never in a running game.
// - Errors: a crash in the game's own code is sent (message + file:line,
//   no player info), at most ERRORS_PER_PAGE a visit. Off with Settings >
//   Share Anonymous Usage Stats, like the play counts.
import { t } from './i18n.js'
import { currentPoll } from './LiveConfig.js'
import { deviceKind } from './PlayStats.js'

const POLLS_SEEN_KEY = 'gayz-polls-seen'
const FEEDBACK_KIND_IDS = ['idea', 'bug', 'other']
export const FEEDBACK_MAX = 1000
const ERRORS_PER_PAGE = 5

let game = null

function embedded() {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

function api(body) {
  if (window.__playerVoiceForTests) return window.__playerVoiceForTests(body)
  return fetch('/api/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (res) => {
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) throw new Error(data?.error || `http-${res.status}`)
      return data
    })
}

// The hashed bundle name changes with every update - enough to tell which
// version a bug or error came from.
function buildId() {
  const s = document.querySelector('script[type="module"][src*="/assets/"]')
  const m = s && s.getAttribute('src').match(/assets\/([^/]+)\.js/)
  return m ? m[1] : 'dev'
}

function browserName() {
  const ua = navigator.userAgent
  const pick = [['Edg/', 'Edge'], ['OPR/', 'Opera'], ['SamsungBrowser', 'Samsung'], ['CriOS', 'Chrome iOS'], ['FxiOS', 'Firefox iOS'], ['Firefox/', 'Firefox'], ['Chrome/', 'Chrome'], ['Safari/', 'Safari']].find(([k]) => ua.includes(k))
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /CrOS/.test(ua) ? 'ChromeOS' : /Mac/.test(ua) ? 'Mac' : /Win/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '?'
  return `${pick ? pick[1] : 'Other'} on ${os}`
}

export function deviceInfo() {
  let where = 'homepage'
  if (game?.buildMode?.active) where = 'map editor'
  return {
    device: deviceKind(),
    browser: browserName(),
    screen: `${window.innerWidth}x${window.innerHeight}`,
    lang: game?.settings?.language || document.documentElement.lang || '',
    build: buildId(),
    theme: game?.settings?.uiTheme || '',
    where,
  }
}

// --- Feedback box ---

function feedbackEl() {
  let el = document.getElementById('feedback-screen')
  if (el) return el
  el = document.createElement('div')
  el.id = 'feedback-screen'
  el.hidden = true
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-modal', 'true')
  el.setAttribute('aria-labelledby', 'feedback-title')
  el.innerHTML = `<div class="maintenance-card voice-card">
    <h2 class="maintenance-title" id="feedback-title"></h2>
    <p class="voice-help" id="feedback-help"></p>
    <div class="voice-kinds" role="radiogroup">${FEEDBACK_KIND_IDS.map((k) => `<button type="button" class="voice-kind" role="radio" data-kind="${k}"></button>`).join('')}</div>
    <textarea id="feedback-text" maxlength="${FEEDBACK_MAX}" rows="5"></textarea>
    <p class="voice-small" id="feedback-note"></p>
    <div class="voice-actions">
      <button type="button" class="voice-secondary" id="feedback-cancel"></button>
      <button type="button" class="voice-primary" id="feedback-send"></button>
    </div>
  </div>`
  document.body.appendChild(el)
  el.addEventListener('click', (e) => {
    if (e.target === el) closeFeedback()
    const kind = e.target.closest?.('.voice-kind')
    if (kind) setKind(kind.dataset.kind)
  })
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFeedback()
  })
  el.querySelector('#feedback-cancel').addEventListener('click', closeFeedback)
  el.querySelector('#feedback-send').addEventListener('click', sendFeedback)
  el.querySelector('#feedback-text').addEventListener('input', fillNote)
  return el
}

function setKind(kind) {
  const el = feedbackEl()
  el.dataset.kind = FEEDBACK_KIND_IDS.includes(kind) ? kind : 'idea'
  for (const b of el.querySelectorAll('.voice-kind')) b.setAttribute('aria-checked', String(b.dataset.kind === el.dataset.kind))
  el.querySelector('#feedback-text').placeholder = t(`feedbackPlaceholder_${el.dataset.kind}`)
  fillNote()
}

function fillNote() {
  const el = feedbackEl()
  const n = el.querySelector('#feedback-text').value.length
  const bug = el.dataset.kind === 'bug' ? `${t('feedbackBugNote')} ` : ''
  el.querySelector('#feedback-note').textContent = `${bug}${n} / ${FEEDBACK_MAX}`
}

export function openFeedback(kind = 'idea') {
  const el = feedbackEl()
  el.querySelector('#feedback-title').textContent = t('feedbackTitle')
  el.querySelector('#feedback-help').textContent = t('feedbackHelp')
  for (const b of el.querySelectorAll('.voice-kind')) b.textContent = t(`feedbackKind_${b.dataset.kind}`)
  el.querySelector('#feedback-cancel').textContent = t('feedbackCancel')
  el.querySelector('#feedback-send').textContent = t('feedbackSend')
  el.querySelector('#feedback-send').disabled = false
  setKind(kind)
  el.hidden = false
  el.querySelector('#feedback-text').focus()
}

export function closeFeedback() {
  const el = document.getElementById('feedback-screen')
  if (el) el.hidden = true
}

const FEEDBACK_ERRORS = { 'too-many': 'feedbackTooMany', 'bad-request': 'feedbackTooShort' }

async function sendFeedback() {
  const el = feedbackEl()
  const box = el.querySelector('#feedback-text')
  const btn = el.querySelector('#feedback-send')
  const text = box.value.trim()
  if (text.length < 3) {
    game?._showHomepageToast?.(t('feedbackTooShort'))
    box.focus()
    return
  }
  if (btn.disabled) return
  btn.disabled = true
  const kind = el.dataset.kind
  try {
    await api({ action: 'feedback', kind, text, pid: game?.settings?.playerId, nick: game?.settings?.nickname || '', info: kind === 'bug' ? deviceInfo() : null })
    box.value = ''
    closeFeedback()
    game?._showHomepageToast?.(t('feedbackThanks'))
  } catch (err) {
    game?._showHomepageToast?.(t(FEEDBACK_ERRORS[err?.message] || 'feedbackOffline'))
  } finally {
    btn.disabled = false
  }
}

// --- Polls ---

function seenPolls() {
  try {
    const list = JSON.parse(localStorage.getItem(POLLS_SEEN_KEY) || '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function markPollSeen(id) {
  try {
    localStorage.setItem(POLLS_SEEN_KEY, JSON.stringify([...seenPolls().filter((x) => x !== id), id].slice(-30)))
  } catch { /* blocked - may show once more next visit */ }
}

function overlayUp(id) {
  const el = document.getElementById(id)
  return !!el && !el.hidden
}

export function renderPoll() {
  const p = currentPoll()
  const onHome = !game?.menu || game.menu.style.display !== 'none'
  let el = document.getElementById('poll-screen')
  const blocked = overlayUp('maintenance-screen') || overlayUp('warning-screen') || overlayUp('feedback-screen')
  if (!p || seenPolls().includes(p.id) || !onHome || blocked || embedded()) {
    if (el && (!p || seenPolls().includes(p?.id) || embedded())) el.hidden = true
    return
  }
  if (!el) {
    el = document.createElement('div')
    el.id = 'poll-screen'
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-modal', 'true')
    el.innerHTML = '<div class="maintenance-card voice-card"><h2 class="maintenance-title"></h2><p class="maintenance-text"></p><div class="poll-options"></div><button type="button" class="voice-secondary poll-later"></button></div>'
    document.body.appendChild(el)
    el.querySelector('.poll-later').addEventListener('click', () => {
      markPollSeen(el.dataset.id)
      el.hidden = true
    })
  }
  if (el.dataset.id === p.id && !el.hidden) return
  el.dataset.id = p.id
  el.querySelector('.maintenance-title').textContent = t('pollTitle')
  el.querySelector('.maintenance-text').textContent = p.q
  el.querySelector('.poll-later').textContent = t('pollLater')
  const opts = el.querySelector('.poll-options')
  opts.textContent = ''
  p.options.forEach((label, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'voice-primary poll-option'
    b.textContent = label
    b.addEventListener('click', () => vote(p.id, i))
    opts.appendChild(b)
  })
  el.hidden = false
}

async function vote(id, choice) {
  markPollSeen(id)
  const el = document.getElementById('poll-screen')
  if (el) el.hidden = true
  try {
    await api({ action: 'vote', pid: game?.settings?.playerId, id, choice })
    game?._showHomepageToast?.(t('pollThanks'))
  } catch (err) {
    game?._showHomepageToast?.(t(err?.message === 'poll-ended' ? 'pollEnded' : 'pollOffline'))
  }
}

// --- Error reports ---

let errorsSent = 0
const errorsSeen = new Set()

function errorsAllowed() {
  if (!game || game.settings?.shareTelemetry === false) return false
  if (window.__playerVoiceForTests) return true
  return !navigator.webdriver && !embedded() && !/^(localhost|127\.)/.test(location.hostname)
}

export function reportError(message, filename, line) {
  if (!errorsAllowed() || errorsSent >= ERRORS_PER_PAGE) return
  const msg = String(message || '').slice(0, 300)
  if (!msg || /ResizeObserver loop|^Script error\.?$/i.test(msg)) return
  // Only our own code: browser add-ons and other sites' scripts are not ours to fix.
  const file = String(filename || '')
  if (file && !file.startsWith(location.origin)) return
  const where = file ? `${file.split('/').pop().split('?')[0]}:${line || 0}` : ''
  const key = `${msg}|${where}`
  if (errorsSeen.has(key)) return
  errorsSeen.add(key)
  errorsSent++
  api({ action: 'error', msg, where, build: buildId(), device: deviceKind() }).catch(() => {})
}

function stackPlace(err) {
  const m = String(err?.stack || '').match(/(https?:\/\/[^\s)]+):(\d+):\d+/)
  return m ? [m[1], m[2]] : ['', 0]
}

// --- Start ---

export function startPlayerVoice(g) {
  game = g
  document.getElementById('nav-feedback-link')?.addEventListener('click', () => openFeedback())
  window.addEventListener('error', (e) => {
    if (!e || !e.message) return
    reportError(e.message, e.filename, e.lineno)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e?.reason
    if (!(r instanceof Error)) return
    const [file, line] = stackPlace(r)
    reportError(`Unhandled: ${r.message}`, file, line)
  })
  window.addEventListener('gayz-live', renderPoll)
  // A poll waiting for the homepage (a game just ended, a warning was closed).
  setInterval(renderPoll, 4000)
  setTimeout(renderPoll, 2500)
  g.__openFeedback = openFeedback
  g.__renderPoll = renderPoll
  g.__reportError = reportError
}
