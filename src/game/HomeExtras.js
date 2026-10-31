// Homepage extras (2026-10-31, Gaymi: "add everything you just said"):
// small cards with your last run, your level, the login streak and the
// daily/weekly countdowns, the top 3 players, a tip of the day and an
// Invite button. Two layouts to compare (Settings > General > Homepage >
// Homepage Extras Layout): "cards" puts them in the bottom corners,
// "panel" puts them all in a Today panel behind one button.
//
// Also here: the Continue / New here? tags on the Play button, a tap on
// your character plays an emote, a zombie that now and then peeks in from
// the side, and Halloween / winter decorations by date.
//
// Everything reads data the game already keeps (careerStats, runHistory,
// loginStreak, the saved run); only the top 3 goes online, once, a few
// seconds after the homepage is ready, so it never slows the first paint.
import { t } from './i18n.js'
import { levelFromXp } from './Xp.js'
import { _daysUntilWeekReset, _escapeHtml, _formatDurationShort, _safeStatNumber, saveSettings } from './Game.js'
import { EMOTES } from './Emotes.js'

const SAVED_RUN_KEY = 'gayz-play-saved-run' // BuildSurvival.SAVED_RUN_KEY
const TOP3_CACHE_KEY = 'gayz-home-top3'
const TOP3_CACHE_MS = 10 * 60 * 1000
const TOP3_DELAY_MS = 5000
export const TIP_COUNT = 12
export const TOP_PLAYERS = 3
const PEEK_MIN_MS = 45000
const PEEK_MAX_MS = 90000
const PEEK_SHOW_MS = 2600

// The card ids, in the order the Today panel lists them. In the cards
// layout the first three sit bottom-left, the rest bottom-right.
const LEFT_CARDS = ['level', 'lastrun', 'tip']
const RIGHT_CARDS = ['streak', 'top3', 'invite']

// The day's tip: same for everyone on the same date, a new one tomorrow.
export function tipOfDayKey(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 0)
  const day = Math.floor((date - start) / 86400000)
  return `tipOfDay${(day % TIP_COUNT) + 1}`
}

// Halloween (Oct 20-31) or winter (all of December), else null.
export function holidayFor(date = new Date()) {
  const m = date.getMonth()
  const d = date.getDate()
  if (m === 9 && d >= 20) return 'halloween'
  if (m === 11) return 'winter'
  return null
}

// The unfinished run Play would pick up again, checked over (it's from
// storage), or null.
function savedRun() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVED_RUN_KEY) || 'null')
    if (!d || typeof d !== 'object' || d.v !== 1) return null
    const wave = Math.round(Number(d.wave))
    if (!Number.isFinite(wave) || wave < 1) return null
    return { wave: Math.min(wave, 9999), mode: String(d.mode || '').slice(0, 40), difficulty: String(d.difficulty || 'normal').slice(0, 20) }
  } catch {
    return null
  }
}

function difficultyName(id) {
  const key = `difficulty${String(id).charAt(0).toUpperCase()}${String(id).slice(1)}`
  const name = t(key)
  return name === key ? '' : name
}

function cardHtml(game, id) {
  if (id === 'level') {
    const lv = levelFromXp(_safeStatNumber(game.careerStats?.xp))
    const pct = Math.round((lv.into / lv.need) * 100)
    return `<div class="home-x-card" data-card="level">
      <span class="home-x-tag">${_escapeHtml(t('homeExtrasLevel', { n: lv.level }))}</span>
      <span class="home-x-bar"><i style="width: ${pct}%"></i></span>
      <span class="home-x-line">${_escapeHtml(t('homeExtrasXpToGo', { n: (lv.need - lv.into).toLocaleString(), next: lv.level + 1 }))}</span>
    </div>`
  }
  if (id === 'lastrun') {
    const last = Array.isArray(game.runHistory) ? game.runHistory[0] : null
    const best = _safeStatNumber(game.bestStats?.bestWave)
    const line = last
      ? t('homeExtrasLastRunLine', { wave: _safeStatNumber(last.night), kills: _safeStatNumber(last.kills).toLocaleString() })
      : t('homeExtrasNoRuns')
    return `<div class="home-x-card" data-card="lastrun">
      <span class="home-x-tag">${_escapeHtml(t('homeExtrasLastRun'))}</span>
      <span class="home-x-line home-x-big">${_escapeHtml(line)}</span>
      ${best ? `<span class="home-x-line">${_escapeHtml(t('homeExtrasBest', { n: best }))}</span>` : ''}
    </div>`
  }
  if (id === 'tip') {
    return `<div class="home-x-card" data-card="tip">
      <span class="home-x-tag">${_escapeHtml(t('homeExtrasTip'))}</span>
      <span class="home-x-line">${_escapeHtml(t(tipOfDayKey()))}</span>
    </div>`
  }
  if (id === 'streak') {
    const streak = _safeStatNumber(game.loginStreak?.streak)
    const daily = game.dailyChallenge ? _formatDurationShort(Math.floor(game.dailyChallenge.msLeft() / 1000)) : ''
    const weekDays = _daysUntilWeekReset()
    return `<div class="home-x-card" data-card="streak">
      <span class="home-x-line home-x-big"><svg class="home-x-flame" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5.5.3 2 1.2 3 2.2 3.3C11 8 11 5 12 2z" fill="#f08a1c" stroke="#8a3a06" stroke-width="1.2" stroke-linejoin="round"/><path d="M12 13c1 1.4 2 2.3 2 3.6a2 2 0 0 1-4 0c0-1.2 1-2.2 2-3.6z" fill="#ffd34d"/></svg> ${_escapeHtml(streak > 0 ? t('homeExtrasStreak', { n: streak }) : t('homeExtrasStreakNone'))}</span>
      ${daily ? `<span class="home-x-line" data-timer="daily">${_escapeHtml(t('homeExtrasDailyIn', { time: daily }))}</span>` : ''}
      <span class="home-x-line">${_escapeHtml(t(weekDays === 1 ? 'homeExtrasWeeklyInOne' : 'homeExtrasWeeklyIn', { n: weekDays }))}</span>
    </div>`
  }
  if (id === 'top3') {
    return `<div class="home-x-card" data-card="top3">
      <span class="home-x-tag">${_escapeHtml(t('homeExtrasTop3'))}</span>
      <ol class="home-x-top3">${top3Rows(game)}</ol>
    </div>`
  }
  if (id === 'invite') {
    return `<button type="button" class="home-x-card home-x-invite" data-card="invite">${_escapeHtml(t('homeExtrasInvite'))}</button>`
  }
  return ''
}

function top3Rows(game) {
  const list = game._homeTop3
  if (!list) return `<li class="home-x-muted">${_escapeHtml(t(navigator.onLine === false ? 'homeExtrasTop3Offline' : 'homeExtrasTop3Loading'))}</li>`
  if (!list.length) return `<li class="home-x-muted">${_escapeHtml(t('homeExtrasTop3None'))}</li>`
  return list.map((e) => `<li><span class="home-x-name">${_escapeHtml(e.name)}</span><span>${_escapeHtml(t('homeExtrasTop3Row', { n: e.wave }))}</span></li>`).join('')
}

// Draws every card into the layout the player picked. Called with the
// Quests badge refresh (startup, back on the homepage, claims).
export function renderHomeExtras(game) {
  const left = document.getElementById('home-extras-left')
  const right = document.getElementById('home-extras-right')
  const list = document.getElementById('today-panel-list')
  if (!left || !right) return
  const panel = game.settings.homeExtrasLayout === 'panel'
  document.documentElement.classList.toggle('home-extras-panel', panel)
  if (panel) {
    left.innerHTML = ''
    right.innerHTML = `<button type="button" class="home-x-card home-x-today" id="home-today-btn"><svg class="home-x-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg> ${_escapeHtml(t('homeExtrasToday'))}</button>`
    if (list) list.innerHTML = [...LEFT_CARDS, ...RIGHT_CARDS].map((id) => cardHtml(game, id)).join('')
  } else {
    left.innerHTML = LEFT_CARDS.map((id) => cardHtml(game, id)).join('')
    right.innerHTML = RIGHT_CARDS.map((id) => cardHtml(game, id)).join('')
    if (list) list.innerHTML = ''
  }
  left.classList.remove('pending')
  right.classList.remove('pending')
  renderPlayTags(game)
  fitHomeExtras()
  loadTop3Later(game)
}

// Hides cards from the bottom of a corner stack up while it would run into
// what's above it (the character or the nav buttons) on a short screen.
export function fitHomeExtras() {
  placeStacks()
  const pairs = [['home-extras-left', 'menu-col-left'], ['home-extras-right', 'menu-nav-buttons']]
  for (const [stackId, aboveId] of pairs) {
    const stack = document.getElementById(stackId)
    const above = document.getElementById(aboveId)
    if (!stack || !above) continue
    const cards = [...stack.children]
    cards.forEach((c) => { c.style.display = '' })
    stack.style.bottom = ''
    if (getComputedStyle(stack).position !== 'absolute') continue
    liftAboveLinks(stack)
    const limit = stackId === 'home-extras-left' ? leftLimit(above) : above.getBoundingClientRect().bottom + 8
    for (let i = cards.length - 1; i > 0 && stack.getBoundingClientRect().top < limit; i--) cards[i].style.display = 'none'
    if (stack.getBoundingClientRect().top < limit) cards[0].style.display = 'none'
  }
}

// The stacked phone layout (index.html's STACKED_QUERY) scrolls as one
// column: there the stacks go under the daily card, in the flow; on wider
// screens they sit in #menu's bottom corners.
const STACKED_QUERY = '(max-width: 700px), (orientation: portrait) and (max-width: 1100px), (max-height: 500px)'
function placeStacks() {
  const left = document.getElementById('home-extras-left')
  const right = document.getElementById('home-extras-right')
  const daily = document.getElementById('home-daily')
  const menu = document.getElementById('menu')
  if (!left || !right || !daily || !menu) return
  if (matchMedia(STACKED_QUERY).matches) {
    if (left.parentElement !== daily.parentElement) daily.after(left, right)
  } else if (left.parentElement !== menu) {
    menu.prepend(left, right)
  }
}

// The footer links (How to Play, What's New...) run along the bottom and
// can reach a corner on narrower screens: then the stack sits just above them.
function liftAboveLinks(stack) {
  const links = document.getElementById('menu-links-row')
  const menu = document.getElementById('menu')
  if (!links || !menu || !links.getClientRects().length) return
  const l = links.getBoundingClientRect()
  const s = stack.getBoundingClientRect()
  if (l.left < s.right && s.left < l.right && l.top < s.bottom) {
    stack.style.bottom = `${Math.round(menu.getBoundingClientRect().bottom - l.top + 8)}px`
  }
}

// The left stack sits under the character: its limit is where the
// character's canvas ends.
function leftLimit(col) {
  const canvas = col.querySelector('#setup-avatar-wrap') || col
  return canvas.getBoundingClientRect().bottom + 8
}

// Continue (a run is saved: pick it up, on its own mode and difficulty)
// and New here? (no finished runs yet: opens How to Play) - small tags on
// the Play button's corners, so nothing else moves.
function renderPlayTags(game) {
  const play = document.getElementById('play-btn')
  if (!play) return
  const wrap = play.parentElement
  let cont = document.getElementById('home-continue-tag')
  let fresh = document.getElementById('home-newhere-tag')
  if (!cont) {
    cont = document.createElement('button')
    cont.type = 'button'
    cont.id = 'home-continue-tag'
    cont.className = 'home-play-tag'
    cont.addEventListener('click', (e) => {
      e.stopPropagation()
      continueRun(game)
    })
    wrap.appendChild(cont)
  }
  if (!fresh) {
    fresh = document.createElement('button')
    fresh.type = 'button'
    fresh.id = 'home-newhere-tag'
    fresh.className = 'home-play-tag'
    fresh.addEventListener('click', (e) => {
      e.stopPropagation()
      game._openHowToPlayPanel()
    })
    wrap.appendChild(fresh)
  }
  const run = savedRun()
  cont.style.display = run ? '' : 'none'
  if (run) {
    const diff = difficultyName(run.difficulty)
    cont.textContent = `▶ ${t('homeContinue', { n: run.wave })}${diff ? ` · ${diff}` : ''}`
  }
  const isNew = _safeStatNumber(game.careerStats?.totalRuns) === 0 && !run
  fresh.style.display = isNew ? '' : 'none'
  fresh.textContent = t('homeNewHere')
}

// Puts the saved run's mode and difficulty back, then presses Play (which
// picks the run up when those match).
function continueRun(game) {
  const run = savedRun()
  if (!run) return
  if (run.difficulty) game.settings.difficulty = run.difficulty
  if (run.mode) game.settings.selectedGameMode = run.mode
  saveSettings(game.settings)
  document.getElementById('play-btn')?.click()
}

// The top 3 by best wave, read once a few seconds after the homepage is
// ready (Firebase loads then, not at startup), and kept for 10 minutes.
function loadTop3Later(game) {
  if (game._homeTop3 || game._homeTop3Pending) return
  try {
    const cached = JSON.parse(sessionStorage.getItem(TOP3_CACHE_KEY) || 'null')
    if (cached && Date.now() - cached.at < TOP3_CACHE_MS && Array.isArray(cached.list)) {
      game._homeTop3 = cached.list
      refreshTop3(game)
      return
    }
  } catch { /* no cache - fetch below */ }
  if (navigator.onLine === false) return
  game._homeTop3Pending = true
  setTimeout(async () => {
    try {
      const CloudSync = await import('./CloudSync.js')
      if (!CloudSync.isConfigured()) return
      const rows = await CloudSync.fetchTopLeaderboard(TOP_PLAYERS)
      game._homeTop3 = rows.map((r) => ({ name: String(r.name || '?').slice(0, 24), wave: _safeStatNumber(r.bestNight) }))
      try { sessionStorage.setItem(TOP3_CACHE_KEY, JSON.stringify({ at: Date.now(), list: game._homeTop3 })) } catch { /* fine */ }
      refreshTop3(game)
    } catch {
      game._homeTop3 = null
    } finally {
      game._homeTop3Pending = false
    }
  }, TOP3_DELAY_MS)
}

function refreshTop3(game) {
  for (const ol of document.querySelectorAll('[data-card="top3"] .home-x-top3')) ol.innerHTML = top3Rows(game)
  fitHomeExtras()
}

export function openTodayPanel(game) {
  game._closeAllMenuPanels()
  const panel = document.getElementById('today-panel')
  if (!panel) return
  renderHomeExtras(game)
  panel.style.display = 'flex'
}

export function closeTodayPanel() {
  const panel = document.getElementById('today-panel')
  if (panel) panel.style.display = 'none'
}

async function invite(game) {
  const url = location.origin + '/'
  const text = t('homeExtrasInviteText')
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title: 'GayZ', text, url })
      return
    }
  } catch { /* closed the share sheet - copy instead */ }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`)
    game._showHomepageToast(t('homeExtrasInviteCopied'))
  } catch {
    game._showHomepageToast(url)
  }
}

// A blocky zombie face peeks in from the left or right edge now and then
// while you're on the homepage. Tap it and it ducks away.
function bindZombiePeek(game) {
  const el = document.createElement('button')
  el.type = 'button'
  el.id = 'home-zombie-peek'
  el.setAttribute('aria-label', t('homeZombiePeekLabel'))
  el.innerHTML = '<i class="zp-eye l"></i><i class="zp-eye r"></i><i class="zp-mouth"></i>'
  document.getElementById('menu')?.appendChild(el)
  let hideTimer = 0
  const hide = () => {
    el.classList.remove('show')
    clearTimeout(hideTimer)
  }
  el.addEventListener('click', () => {
    hide()
    game._showHomepageToast(t('homeZombiePeek'))
  })
  const schedule = () => setTimeout(() => {
    const menu = document.getElementById('menu')
    const onHome = menu && menu.style.display !== 'none' && !document.hidden && !game.settings.reduceBgEffects && !matchMedia('(prefers-reduced-motion: reduce)').matches
    if (onHome) {
      el.classList.toggle('right', Math.random() < 0.5)
      el.style.top = `${30 + Math.random() * 40}%`
      el.classList.add('show')
      hideTimer = setTimeout(hide, PEEK_SHOW_MS)
    }
    schedule()
  }, PEEK_MIN_MS + Math.random() * (PEEK_MAX_MS - PEEK_MIN_MS))
  schedule()
}

const BAT_SVG = '<svg viewBox="0 0 32 16"><path d="M16 5c1-2 2-2 2-2l1 2c3-2 7-2 12 1-3 0-5 2-5 5-2-2-4-2-6 0-1-1-3-2-4-2s-3 1-4 2c-2-2-4-2-6 0 0-3-2-5-5-5 5-3 9-3 12-1l1-2s1 0 2 2z" fill="#1d1426"/></svg>'
const SNOW_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10"/></svg>'

// Bats (Halloween) or snowflakes (December) drifting over the homepage,
// plus a little pumpkin or snow cap on the daily card. Pure decoration:
// never in the way of a click, and off with Reduce Background Effects.
function applyHoliday(game) {
  const kind = holidayFor()
  document.documentElement.dataset.holiday = kind || ''
  if (!kind || document.getElementById('home-holiday')) return
  const layer = document.createElement('div')
  layer.id = 'home-holiday'
  layer.setAttribute('aria-hidden', 'true')
  const n = kind === 'halloween' ? 4 : 14
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i')
    p.className = kind === 'halloween' ? 'hx-bat' : 'hx-snow'
    p.style.setProperty('--x', `${Math.round(Math.random() * 100)}%`)
    p.style.setProperty('--y', `${Math.round(6 + Math.random() * 30)}%`)
    p.style.setProperty('--d', `${(kind === 'halloween' ? 16 : 9) + Math.random() * 10}s`)
    p.style.setProperty('--delay', `${-Math.random() * 20}s`)
    p.innerHTML = kind === 'halloween' ? BAT_SVG : SNOW_SVG
    layer.appendChild(p)
  }
  // Right after the background, so the bats fly behind the logo and buttons.
  const bg = document.getElementById('menu-bg')
  if (bg) bg.after(layer)
  else document.getElementById('menu')?.prepend(layer)
  layer.classList.toggle('off', !!game.settings.reduceBgEffects)
}

// Tapping your character on the homepage plays an emote (a drag still
// just turns it).
function bindAvatarEmote(game) {
  const avatar = game._menuAvatar3D
  if (!avatar) return
  avatar.onTap = () => avatar.playEmote(EMOTES[Math.floor(Math.random() * EMOTES.length)])
}

// Once, at startup.
export function bindHomeExtras(game) {
  document.getElementById('home-extras-right')?.addEventListener('click', (e) => {
    if (e.target.closest('#home-today-btn')) openTodayPanel(game)
    else if (e.target.closest('[data-card="invite"]')) invite(game)
  })
  const panel = document.getElementById('today-panel')
  if (panel) {
    panel.addEventListener('click', (e) => {
      if (e.target === panel || e.target.closest('.panel-close-btn')) closeTodayPanel()
      else if (e.target.closest('[data-card="invite"]')) invite(game)
    })
  }
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTodayPanel() })
  window.addEventListener('resize', () => fitHomeExtras())
  window.addEventListener('online', () => { if (!game._homeTop3) loadTop3Later(game) })
  // The "new daily in" countdown ticks once a minute.
  setInterval(() => {
    if (!game.dailyChallenge) return
    const text = t('homeExtrasDailyIn', { time: _formatDurationShort(Math.floor(game.dailyChallenge.msLeft() / 1000)) })
    for (const el of document.querySelectorAll('[data-timer="daily"]')) el.textContent = text
  }, 60000)
  bindAvatarEmote(game)
  bindZombiePeek(game)
  applyHoliday(game)
}
