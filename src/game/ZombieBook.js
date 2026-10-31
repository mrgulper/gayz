// The Zombie Book (2026-10-31, Gaymi: "a page with every zombie type. The
// ones you haven't met yet show as dark shadows"). Inventory > Zombie Book:
// every kind of zombie - the regular one, the boss, the four skeletons and
// every monster (ZombieKinds.js, not the spider - it's an animal now). A
// kind counts as met the first time one appears in your game
// (BuildSurvival._makeZombie), which pays BOOK_COINS; meeting the last one
// pays BOOK_DONE_COINS and puts a Complete badge on the page.
//
// Saved in localStorage (BOOK_KEY: { kind: first-met time }), so Cloud
// Save carries it like everything else. Never trusted when read back.
import * as THREE from 'three'
import { MONSTER_KINDS, makeMonster } from './ZombieKinds.js'
import { SKELETON_KINDS, loadSkeletons, makeSkeleton } from './SkeletonModels.js'
import { buildTexturedCharacter, loadSkinTexture } from './MenuAvatar3D.js'
import { saveShopProgress } from './Game.js'
import { t } from './i18n.js'

export const BOOK_KEY = 'gayz-zombie-book'
export const BOOK_COINS = 10
export const BOOK_DONE_COINS = 200
const ZOMBIE_SKIN_URL = '/images/npc/zombie.png'

// Book order: the everyday ones first, then where the rest live.
export const BOOK_IDS = [
  'zombie', 'boss',
  ...Object.keys(SKELETON_KINDS),
  ...Object.keys(MONSTER_KINDS).filter((k) => MONSTER_KINDS[k].waves !== false),
  ...Object.keys(MONSTER_KINDS).filter((k) => MONSTER_KINDS[k].realm),
]

// Which book entry a zombie is (its kind, or the plain zombie / boss).
export function bookIdFor(boss, kind) {
  if (kind && BOOK_IDS.includes(kind)) return kind
  return boss ? 'boss' : 'zombie'
}

export function loadBook() {
  let data
  try {
    data = JSON.parse(localStorage.getItem(BOOK_KEY) || 'null')
  } catch {
    data = null
  }
  const out = {}
  if (!data || typeof data !== 'object') return out
  for (const id of BOOK_IDS) {
    const v = Number(data[id])
    if (Number.isFinite(v) && v > 0) out[id] = v
  }
  return out
}

function saveBook(book) {
  try {
    localStorage.setItem(BOOK_KEY, JSON.stringify(book))
  } catch {
    // Full storage: it's just not remembered.
  }
}

export function bookName(id) {
  return t(`book_${id}`)
}

// A few words about it, from its numbers (ZombieKinds.js / SkeletonModels.js).
export function bookTraits(id) {
  if (id === 'zombie') return t('bookTraitPlain')
  if (id === 'boss') return t('bookTraitBoss')
  const k = MONSTER_KINDS[id] || SKELETON_KINDS[id] || {}
  const out = []
  if (SKELETON_KINDS[id]) out.push(t('bookTraitSkeleton'))
  if (k.hp >= 1.5) out.push(t('bookTraitTough'))
  else if (k.hp <= 0.7) out.push(t('bookTraitWeak'))
  if (k.speed >= 1.3) out.push(t('bookTraitFast'))
  else if (k.speed <= 0.75) out.push(t('bookTraitSlow'))
  if (k.damage >= 1.4) out.push(t('bookTraitHitsHard'))
  if (k.burst) out.push(t('bookTraitBursts'))
  if (k.scream) out.push(t('bookTraitScreams'))
  if (k.hides) out.push(t('bookTraitHides'))
  if (k.realm) out.push(t(`bookRealm_${k.realm}`))
  return out.join(' · ') || t('bookTraitPlain')
}

// A zombie appeared in my game. Returns true when it was a new one.
// game: the Game (for coins); say(text): shows a message.
export function meet(game, id, say) {
  if (!BOOK_IDS.includes(id)) return false
  const book = loadBook()
  if (book[id]) return false
  book[id] = Date.now()
  saveBook(book)
  const done = BOOK_IDS.every((k) => book[k])
  const coins = BOOK_COINS + (done ? BOOK_DONE_COINS : 0)
  if (game) {
    game.coins = (game.coins || 0) + coins
    saveShopProgress(game)
    game._renderCurrencyBar?.()
  }
  say?.(t(done ? 'bookDoneToast' : 'bookNewToast', { name: bookName(id), n: coins }))
  return true
}

// Pictures of every kind, drawn once with a small throwaway renderer (like
// InventoryUI._weaponThumbnails) and kept as blob URLs.
let _pics = null
let _drawing = null
export function bookPictures() {
  if (_pics) return Promise.resolve(_pics)
  if (_drawing) return _drawing
  _drawing = drawPictures().then((out) => {
    _pics = out
    _drawing = null
    return out
  })
  return _drawing
}

async function drawPictures() {
  const out = {}
  const W = 120
  const H = 140
  let renderer
  try {
    const [skin] = await Promise.all([
      loadSkinTexture(ZOMBIE_SKIN_URL).catch(() => null),
      loadSkeletons().catch(() => false),
    ])
    const canvas = document.createElement('canvas')
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(1)
    renderer.setSize(W, H, false)
    renderer.setClearColor(0x000000, 0)
    const scene = new THREE.Scene()
    scene.add(new THREE.AmbientLight(0xffffff, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.8)
    sun.position.set(2, 4, 5)
    scene.add(sun)
    const camera = new THREE.PerspectiveCamera(30, W / H, 0.01, 50)
    const box = new THREE.Box3()
    for (const id of BOOK_IDS) {
      let model = null
      if (MONSTER_KINDS[id]) model = makeMonster(id, 2).root
      else if (SKELETON_KINDS[id]) model = makeSkeleton(id, 2).root
      else if (skin) {
        model = buildTexturedCharacter(skin)
        // Built in skin pixels (32 tall); the same 2 tall as the others.
        model.scale.setScalar(2 / 32)
        if (id === 'boss') {
          // Bosses are bigger and angrier: a red tint here.
          model.traverse((o) => {
            if (!o.isMesh) return
            o.material = o.material.clone()
            o.material.color?.setHex(0xff8a80)
          })
        }
      }
      if (!model) continue
      const holder = new THREE.Group()
      holder.add(model)
      // A three-quarter view, like a trading card.
      holder.rotation.y = 0.5
      scene.add(holder)
      holder.updateMatrixWorld(true)
      box.setFromObject(holder)
      if (!box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3())
        const fit = Math.max(size.y, size.x / camera.aspect) * 1.12
        const dist = fit / 2 / Math.tan((camera.fov * Math.PI) / 360) + size.z / 2
        camera.position.set(center.x, center.y + dist * 0.1, center.z + dist)
        camera.lookAt(center)
        renderer.render(scene, camera)
        out[id] = await new Promise((resolve) => canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : null), 'image/png'))
        if (!out[id]) delete out[id]
      }
      scene.remove(holder)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  } catch (err) {
    console.warn('Zombie Book pictures failed', err)
  } finally {
    if (renderer) {
      renderer.dispose()
      renderer.forceContextLoss()
    }
  }
  return out
}

// Inventory > Zombie Book. Drawn each time the tab is looked at; the
// pictures fill in once they're ready.
const byId = (id) => document.getElementById(id)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export function renderBook() {
  const page = byId('zombie-book-page')
  if (!page) return
  const book = loadBook()
  const met = BOOK_IDS.filter((id) => book[id]).length
  const done = met === BOOK_IDS.length
  const head = byId('zombie-book-count')
  if (head) head.textContent = t('bookCount', { n: met, max: BOOK_IDS.length })
  const badge = byId('zombie-book-badge')
  if (badge) badge.style.display = done ? '' : 'none'
  const how = byId('zombie-book-how')
  if (how) how.textContent = t('bookHow', { n: BOOK_COINS, done: BOOK_DONE_COINS })
  const pics = _pics || {}
  const grid = byId('zombie-book-grid')
  if (grid) {
    grid.innerHTML = BOOK_IDS.map((id) => {
      const seen = !!book[id]
      const img = pics[id] ? `<img src="${pics[id]}" alt="" draggable="false" />` : '<span class="zombie-book-blank"></span>'
      return `<div class="perk-option team-card zombie-book-card${seen ? '' : ' unmet'}" data-book="${id}">
        ${img}
        <span class="team-card-name">${esc(seen ? bookName(id) : '???')}</span>
        <span class="team-card-type">${esc(seen ? bookTraits(id) : t('bookUnmet'))}</span>
      </div>`
    }).join('')
  }
  if (!_pics) bookPictures().then(() => { if (page.offsetParent) renderBook() })
}

export function bindBookUI() {
  byId('inventory-tab-zombiebook')?.addEventListener('click', () => renderBook())
}
