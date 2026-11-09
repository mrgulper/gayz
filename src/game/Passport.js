// The passport (2026-11-09, Gaymi's world-map list 2: "walk into a new
// country and a 'Welcome to Spain!' banner pops up. You also get a stamp
// in a passport book that lists every country you've visited").
//
// World Map mode only. Crossing into a country shows "Welcome to <it>!"
// (BuildTryMode._showPlaceTitle - the same title as big real places); the
// first time ever it's a stamp too, with STAMP_COINS. Stamps are kept on
// this device (localStorage, only when one is added). The book opens from
// the button under the big map (BuildTryMode) and lists every stamp with
// the day you got it and how much of that country you've seen.
import { t } from './i18n.js'
import { explored, countryAtBlock, pctText } from './ExploredMap.js'

const KEY = 'gayz-passport-v1'
export const STAMP_COINS = 15
// The same country's welcome isn't shown again for this long (walking
// along a border would flash it over and over).
const WELCOME_AGAIN_MS = 90000
const MAX_STAMPS = 400
// Country names come from the game's own list, but stored values are
// untrusted in HTML.
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// A stamp's ink colour, the same for a country every time.
function inkOf(name) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `hsl(${h % 360}, 62%, 42%)`
}

function initials(name) {
  const words = name.replace(/[^A-Za-z\s]/g, '').split(/\s+/).filter((w) => w && !/^(of|the|and)$/i.test(w))
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || name).slice(0, 2)).toUpperCase()
}

class PassportBook {
  constructor() {
    this.stamps = null
    this._here = null
    this._lastCell = null
    this._welcomed = new Map()
  }

  _load() {
    if (this.stamps) return
    this.stamps = {}
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
      if (raw && typeof raw.s === 'object' && raw.s) {
        for (const [name, v] of Object.entries(raw.s)) {
          if (typeof name === 'string' && name.length <= 60 && v && typeof v.d === 'string') this.stamps[name] = { d: v.d.slice(0, 10) }
        }
      }
    } catch {
      this.stamps = {}
    }
  }

  _save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 1, s: this.stamps }))
    } catch {
      // Storage full or blocked: the stamp still counts for this visit.
    }
  }

  get count() {
    this._load()
    return Object.keys(this.stamps).length
  }

  has(country) {
    this._load()
    return !!this.stamps[country]
  }

  // A new game: the first country you're in welcomes you again.
  reset() {
    this._here = null
    this._lastCell = null
  }

  // Each frame in World Map mode: where your body is (blocks). Only does
  // anything when you step onto another 16-block square. `tryMode` shows
  // the title; `survival` gets the coins.
  update(x, z, tryMode, survival) {
    const cell = `${Math.floor(x / 16)},${Math.floor(z / 16)}`
    if (cell === this._lastCell) return
    this._lastCell = cell
    const country = countryAtBlock(x, z)
    if (country === this._here) return
    this._here = country
    if (!country) return
    this._load()
    const fresh = !this.stamps[country] && Object.keys(this.stamps).length < MAX_STAMPS
    const now = performance.now()
    if (fresh) {
      this.stamps[country] = { d: new Date().toISOString().slice(0, 10) }
      this._save()
      survival?._earn?.(STAMP_COINS)
      survival?._renderHud?.()
    } else if (now - (this._welcomed.get(country) ?? -Infinity) < WELCOME_AGAIN_MS) return
    this._welcomed.set(country, now)
    tryMode?._showPlaceTitle(t('worldWelcome', { country }), fresh ? t('passportNewStamp', { n: STAMP_COINS }) : '', fresh)
  }

  get here() {
    return this._here || ''
  }

  // The book, inside the big map's box `el`.
  open(el) {
    this._load()
    let book = el.querySelector('#world-passport')
    if (!book) {
      book = document.createElement('div')
      book.id = 'world-passport'
      book.setAttribute('role', 'dialog')
      // Taps in the book never reach the map under it.
      for (const ev of ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel']) book.addEventListener(ev, (e) => e.stopPropagation(), { passive: ev !== 'wheel' })
      book.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]')) this.close(el)
      })
      el.appendChild(book)
    }
    const list = Object.entries(this.stamps).sort((a, b) => (a[1].d < b[1].d ? 1 : a[1].d > b[1].d ? -1 : a[0].localeCompare(b[0])))
    const earth = explored.stats('').earth
    const cards = list.map(([name, v], i) => {
      const seen = explored.stats(name).country
      const tilt = ((i * 37) % 13) - 6
      return `<li class="passport-stamp"><span class="passport-ink" style="--ink:${inkOf(name)};--tilt:${tilt}deg">${esc(initials(name))}</span><b>${esc(name)}</b><small>${esc(t('passportFirst', { date: v.d }))}</small><small>${esc(t('passportSeen', { pct: pctText(seen || 0) }))}</small></li>`
    }).join('')
    book.innerHTML = `<div class="passport-head"><strong>${esc(t('passportTitle'))}</strong><span>${esc(t(list.length === 1 ? 'passportSummaryOne' : 'passportSummary', { n: list.length, earth: pctText(earth) }))}</span><button type="button" data-close="1" aria-label="${esc(t('passportClose'))}">✕</button></div>${list.length ? `<ul class="passport-list">${cards}</ul>` : `<p class="passport-empty">${esc(t('passportEmpty'))}</p>`}<p class="passport-legend">${esc(t('journalLegend'))}</p>`
    book.classList.add('open')
  }

  close(el) {
    el?.querySelector('#world-passport')?.classList.remove('open')
  }

  isOpen(el) {
    return !!el?.querySelector('#world-passport.open')
  }
}

export const passport = new PassportBook()
