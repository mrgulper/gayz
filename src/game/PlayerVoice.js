// Feedback, polls and error reports (2026-11-13). Server side:
// api/_lib/inbox.js through /api/live.
//
// - Feedback: the homepage's bottom "Feedback" link opens a full page
//   (Idea / Bug / Report a Player / Other + a message and pictures). A bug also sends this device's
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
export const FEEDBACK_MAX = 10000
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

// --- Feedback page ---
// A full page like the other panels (2026-11-22, was a small popup):
// Idea / Bug / Report a Player / Other, up to FEEDBACK_MAX letters and
// PICS_MAX pictures. Pictures are shrunk here to a JPEG and go only to the
// team's Discord (api/_lib/inbox.js). Report a Player searches names like
// Add a Friend (game._searchPlayerNames) and sends a normal player report
// (where: 'feedback').

const PICS_MAX = 3
const PIC_SIDE = 1600
// Data-URL length; the server takes up to 700 KB of picture each.
const PIC_DATA_MAX = 900000
const ID_RE = /^[A-Za-z0-9]{4,40}$/

let pics = []
let reportTarget = null
let reportResults = []

const $ = (id) => document.getElementById(id)

function feedbackEl() {
  const el = $('feedback-panel')
  if (!el || el.dataset.bound) return el
  el.dataset.bound = '1'
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('.panel-close-btn')) return closeFeedback()
    const kind = e.target.closest?.('.voice-kind')
    if (kind) setKind(kind.dataset.kind)
    const rm = e.target.closest?.('.feedback-pic-remove')
    if (rm) {
      pics.splice(Number(rm.dataset.index), 1)
      renderPics()
    }
    const row = e.target.closest?.('.friend-suggest-row')
    if (row && reportResults[Number(row.dataset.index)]) pickTarget(reportResults[Number(row.dataset.index)])
    if (!e.target.closest('#feedback-report-search')) showResults([])
  })
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && feedbackOpen()) closeFeedback()
  })
  $('feedback-cancel').addEventListener('click', closeFeedback)
  $('feedback-send').addEventListener('click', sendFeedback)
  $('feedback-text').addEventListener('input', fillNote)
  $('feedback-text').addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'))
    if (files.length) {
      e.preventDefault()
      addPics(files)
    }
  })
  $('feedback-pic-btn').addEventListener('click', () => $('feedback-pic-input').click())
  $('feedback-pic-input').addEventListener('change', (e) => {
    addPics([...e.target.files])
    e.target.value = ''
  })
  let timer = null
  $('feedback-report-input').addEventListener('input', () => {
    reportTarget = null
    fillPicked()
    clearTimeout(timer)
    timer = setTimeout(searchNames, 300)
  })
  $('feedback-report-input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      showResults([])
    }
  })
  return el
}

function feedbackOpen() {
  const el = $('feedback-panel')
  return !!el && el.style.display === 'flex'
}

function setKind(kind) {
  const el = feedbackEl()
  el.dataset.kind = [...FEEDBACK_KIND_IDS, 'report'].includes(kind) ? kind : 'idea'
  for (const b of el.querySelectorAll('.voice-kind')) b.setAttribute('aria-checked', String(b.dataset.kind === el.dataset.kind))
  $('feedback-text').placeholder = t(`feedbackPlaceholder_${el.dataset.kind}`)
  $('feedback-report-row').hidden = el.dataset.kind !== 'report'
  fillNote()
}

function fillNote() {
  const el = feedbackEl()
  const n = $('feedback-text').value.length
  const bug = el.dataset.kind === 'bug' ? `${t('feedbackBugNote')} ` : ''
  $('feedback-note').textContent = `${bug}${n} / ${FEEDBACK_MAX}`
}

// --- Report a Player: who ---

async function searchNames() {
  const text = $('feedback-report-input').value.trim()
  if (!game?._cloudUid) {
    showResults([])
    fillPicked()
    return
  }
  const found = await game._searchPlayerNames(text, 'report')
  if (found !== null) showResults(found.filter((m) => typeof m.playerId === 'string'))
}

function showResults(list) {
  reportResults = list
  const box = $('feedback-report-suggestions')
  if (!box) return
  box.textContent = ''
  list.forEach((m, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'friend-suggest-row'
    b.dataset.index = String(i)
    b.setAttribute('role', 'option')
    const name = document.createElement('span')
    name.className = 'friend-suggest-name'
    name.textContent = m.name
    const id = document.createElement('span')
    id.className = 'friend-id'
    id.textContent = `#${m.playerId}`
    b.append(name, id)
    box.appendChild(b)
  })
  box.classList.toggle('open', list.length > 0)
}

function pickTarget(m) {
  reportTarget = { playerId: m.playerId, name: m.name || '' }
  $('feedback-report-input').value = `${m.name} #${m.playerId}`
  showResults([])
  fillPicked()
}

// Picked from the list, or a #ID typed straight in.
function currentTarget() {
  if (reportTarget) return reportTarget
  const typed = $('feedback-report-input').value.trim().replace(/^#/, '')
  return ID_RE.test(typed) && $('feedback-report-input').value.trim().startsWith('#') ? { playerId: typed.toUpperCase(), name: '' } : null
}

function fillPicked() {
  const p = $('feedback-report-picked')
  if (!p) return
  const tg = currentTarget()
  if (tg) p.textContent = t('feedbackReportPicked', { name: tg.name ? `${tg.name} #${tg.playerId}` : `#${tg.playerId}` })
  else p.textContent = game?._cloudUid ? t('feedbackReportHint') : t('feedbackReportSignIn')
}

// --- Pictures ---

function shrinkPicture(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const scale = Math.min(1, PIC_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
        const c = document.createElement('canvas')
        c.width = Math.max(1, Math.round(img.naturalWidth * scale))
        c.height = Math.max(1, Math.round(img.naturalHeight * scale))
        const ctx = c.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, c.width, c.height)
        ctx.drawImage(img, 0, 0, c.width, c.height)
        for (const q of [0.85, 0.7, 0.55, 0.4]) {
          const d = c.toDataURL('image/jpeg', q)
          if (d.length <= PIC_DATA_MAX) return resolve(d)
        }
        resolve(null)
      } catch {
        resolve(null)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

async function addPics(files) {
  const imgs = files.filter((f) => f && /^image\//.test(f.type))
  if (pics.length + imgs.length > PICS_MAX) game?._showHomepageToast?.(t('feedbackPicTooMany', { n: PICS_MAX }))
  for (const f of imgs.slice(0, PICS_MAX - pics.length)) {
    const d = await shrinkPicture(f)
    if (d && pics.length < PICS_MAX) pics.push(d)
    else if (!d) game?._showHomepageToast?.(t('feedbackPicBad'))
  }
  renderPics()
}

function renderPics() {
  const box = $('feedback-pics')
  if (!box) return
  box.textContent = ''
  pics.forEach((d, i) => {
    const wrap = document.createElement('div')
    wrap.className = 'feedback-pic'
    const img = document.createElement('img')
    img.src = d
    img.alt = ''
    const rm = document.createElement('button')
    rm.type = 'button'
    rm.className = 'feedback-pic-remove'
    rm.dataset.index = String(i)
    rm.setAttribute('aria-label', t('feedbackPicRemove'))
    rm.textContent = '×'
    wrap.append(img, rm)
    box.appendChild(wrap)
  })
  $('feedback-pic-btn').disabled = pics.length >= PICS_MAX
  $('feedback-pics-note').textContent = t('feedbackPicHelp', { n: pics.length, max: PICS_MAX })
}

export function openFeedback(kind = 'idea') {
  game?._closeAllMenuPanels?.()
  const el = feedbackEl()
  if (!el) return
  $('feedback-title').textContent = t('feedbackTitle')
  $('feedback-help').textContent = t('feedbackHelp')
  for (const b of el.querySelectorAll('.voice-kind')) b.textContent = t(`feedbackKind_${b.dataset.kind}`)
  $('feedback-report-label').textContent = t('feedbackReportLabel')
  $('feedback-report-input').placeholder = t('feedbackReportSearch')
  $('feedback-pic-btn').textContent = t('feedbackPicAdd')
  $('feedback-cancel').textContent = t('feedbackCancel')
  $('feedback-send').textContent = t('feedbackSend')
  $('feedback-send').disabled = false
  setKind(kind)
  fillPicked()
  renderPics()
  el.style.display = 'flex'
  $('feedback-text').focus()
}

export function closeFeedback() {
  const el = $('feedback-panel')
  if (el) el.style.display = 'none'
  showResults([])
}

const FEEDBACK_ERRORS = { 'too-many': 'feedbackTooMany', 'bad-request': 'feedbackTooShort' }

function resetForm() {
  $('feedback-text').value = ''
  $('feedback-report-input').value = ''
  reportTarget = null
  pics = []
  renderPics()
}

async function sendFeedback() {
  const el = feedbackEl()
  const box = $('feedback-text')
  const btn = $('feedback-send')
  const text = box.value.trim()
  const kind = el.dataset.kind
  const target = kind === 'report' ? currentTarget() : null
  if (kind === 'report' && !target) {
    game?._showHomepageToast?.(t('feedbackReportNone'))
    $('feedback-report-input').focus()
    return
  }
  if (target && target.playerId === game?.settings?.playerId) {
    game?._showHomepageToast?.(t('feedbackReportSelf'))
    return
  }
  if (text.length < 3) {
    game?._showHomepageToast?.(t('feedbackTooShort'))
    box.focus()
    return
  }
  if (btn.disabled) return
  btn.disabled = true
  const images = pics.slice()
  try {
    if (kind === 'report') {
      const r = await api({ action: 'report', target: target.playerId, targetName: target.name, where: 'feedback', text, by: game?.settings?.playerId, byName: game?.settings?.nickname || '', images })
      resetForm()
      closeFeedback()
      game?._showHomepageToast?.(t(r?.already ? 'feedbackReportAlready' : 'feedbackReportThanks'))
    } else {
      await api({ action: 'feedback', kind, text, pid: game?.settings?.playerId, nick: game?.settings?.nickname || '', info: kind === 'bug' ? deviceInfo() : null, images })
      resetForm()
      closeFeedback()
      game?._showHomepageToast?.(t('feedbackThanks'))
    }
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
  const blocked = overlayUp('maintenance-screen') || overlayUp('warning-screen') || feedbackOpen()
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
