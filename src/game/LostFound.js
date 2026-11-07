// The Lost & Found box (2026-11-06, Gaymi's idea list 8: "anything you
// drop by accident shows up here later"). A box at the camp's plaza
// (CampPlaza.js).
//
// Anything you threw out with the Drop key (Q) and never picked up again -
// it lay there until it faded (PlayDrops' DROP_LIFE_S), or the game ended
// with it still on the ground - goes into the box instead of being gone.
// It's kept between games on this device (KEY, up to MAX_STACKS stacks).
// Press Use at the box to see what's in it and take it all back (as much
// as fits in your bag; the rest stays in the box). Guns are never dropped,
// so they never end up here.
import { t } from './i18n.js'
import { ITEMS, itemName } from './PlayInventory.js'
import { openScreen, closeScreen } from './CampScreen.js'

export const KEY = 'gayz-lost-found'
export const MAX_STACKS = 40
const MAX_N = 999

// [{ kind, id, n }] - untrusted: only items and block-looking ids.
export function loadLost() {
  let raw
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    raw = []
  }
  if (!Array.isArray(raw)) return []
  const out = []
  for (const v of raw) {
    if (!Array.isArray(v)) continue
    const [kind, id, n] = v
    const count = Math.max(1, Math.min(MAX_N, Math.floor(Number(n) || 1)))
    if (kind === 'item' && ITEMS[id]) out.push({ kind, id, n: count })
    else if (kind === 'block' && typeof id === 'string' && /^[a-z0-9]{1,40}$/.test(id)) out.push({ kind, id, n: count })
    if (out.length >= MAX_STACKS) break
  }
  return out
}

function saveLost(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.map((it) => [it.kind, it.id, it.n])))
  } catch {
    // Full storage: not remembered.
  }
}

// Something lost (a faded drop, or one left behind). Not per frame - only
// when a drop goes.
export function addLost(kind, id, n = 1) {
  if (kind !== 'item' && kind !== 'block') return
  const list = loadLost()
  const old = list.find((it) => it.kind === kind && it.id === id)
  if (old) old.n = Math.min(MAX_N, old.n + n)
  else {
    if (list.length >= MAX_STACKS) list.shift()
    list.push({ kind, id, n })
  }
  saveLost(list)
}

function label(s, it) {
  if (it.kind === 'item') return itemName(it.id)
  return s.bm.blockName?.(it.id) || it.id
}

// Everything that fits goes back in the bag. -> how many came back.
export function takeAllLost(s) {
  const inv = s.inv
  if (!inv) return 0
  const left = []
  let got = 0
  for (const it of loadLost()) {
    if (it.kind === 'block' && !s.bm.isBlockType?.(it.id)) continue
    const rest = inv.add({ kind: it.kind, id: it.id, n: it.n })
    got += it.n - rest
    if (rest > 0) left.push({ ...it, n: rest })
  }
  saveLost(left)
  return got
}

export function openLostFound(s) {
  return openScreen(s, {
    title: t('lostTitle'),
    build(body) {
      const list = loadLost()
      const p = document.createElement('p')
      p.className = 'camp-screen-note'
      p.textContent = list.length ? t('lostHas', { n: list.reduce((a, it) => a + it.n, 0) }) : t('lostEmpty')
      body.appendChild(p)
      if (!list.length) return
      const ul = document.createElement('ul')
      ul.className = 'lost-list'
      for (const it of list) {
        const li = document.createElement('li')
        li.textContent = `${label(s, it)} × ${it.n}`
        ul.appendChild(li)
      }
      body.appendChild(ul)
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'camp-screen-btn'
      b.textContent = t('lostTakeAll')
      b.addEventListener('click', () => {
        const got = takeAllLost(s)
        closeScreen()
        s._message(got ? t('lostGotBack', { n: got }) : t('invFull'), 3)
      })
      body.appendChild(b)
    },
  })
}
