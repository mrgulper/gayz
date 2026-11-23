// The Upgrades skill tree (2026-11-14, Batch 4b). Since 2026-11-22 it is
// ONE view (Gaymi: "make it like florr style"): a round map with your own
// character in the middle and every upgrade a round icon button with its
// price in a little badge. Point at one (mouse) to see what it does in a
// small card next to it; click / tap picks it and shows it under the map
// with its Buy button. Drag to move, wheel / pinch / +/- to zoom.
// The data (costs, what needs what, forks) is MetaProgress.js; ProgressUI's
// _renderUpgradesOptions calls renderSkillTree after every change.
import { META_UPGRADES, TREE_BRANCHES, upgradeState } from './MetaProgress.js'
import { t } from './i18n.js'
import { skinFrontIconURL } from './InventorySkins.js'
import { DEFAULT_SKIN_DATA_URL } from './MenuAvatar3D.js'

// Map sizes (stage pixels): the first ring's radius, the step between
// rings, the space between neighbours, and the round spots.
const MAP_R0 = 170
const MAP_RING = 112
const MAP_GAP = 14
const MAP_NODE_W = 68
const MAP_NODE_H = 68
// The zoom the Map opens at (on your character); the fit button shows it all.
const MAP_OPEN_ZOOM = 1
const MAP_OPEN_MIN = 0.72
const MAP_START = 150
const MAP_PAD = 40
const ZOOM_MIN = 0.12
const ZOOM_MAX = 1.6
const DRAG_PX = 6

const BRANCH_TITLE = { survival: 'skillBranchSurvival', combat: 'skillBranchCombat', speed: 'skillBranchSpeed', loot: 'skillBranchLoot', gear: 'skillBranchGear' }

// --- icons (white, drawn in a 24x24 box; currentColor) ---
const ICONS = {
  heart: '<path fill="currentColor" d="M12 21s-7.5-4.6-9.5-9.2C1.2 8.6 3.3 5 6.8 5c2 0 3.4 1.1 5.2 3 1.8-1.9 3.2-3 5.2-3 3.5 0 5.6 3.6 4.3 6.8C19.5 16.4 12 21 12 21z"/>',
  shield: '<path fill="currentColor" d="M12 2l8 3v6c0 5.2-3.4 9.4-8 11-4.6-1.6-8-5.8-8-11V5z"/>',
  plus: '<path fill="currentColor" d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  food: '<path fill="currentColor" d="M12 7.5c-2-2-7.5-1.6-8.2 3.4C3.1 16 6.5 21.5 9 21.5c1.3 0 2-.6 3-.6s1.7.6 3 .6c2.5 0 5.9-5.5 5.2-10.6-.7-5-6.2-5.4-8.2-3.4z"/><path d="M12 7.5c0-2.2 1-4 3-5.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  chest: '<path fill="currentColor" d="M3 10a5 5 0 015-5h8a5 5 0 015 5v1H3zM3 13h18v7H3z"/>',
  skull: '<path fill="currentColor" fill-rule="evenodd" d="M12 2C7 2 4 5.5 4 10c0 3 1.5 5 3 6v4h10v-4c1.5-1 3-3 3-6 0-4.5-3-8-8-8zM9 9a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4z"/>',
  crosshair: '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M12 1v6M12 17v6M1 12h6M17 12h6" stroke="currentColor" stroke-width="2.5"/>',
  sword: '<path fill="currentColor" d="M20.5 2H22v1.5L11 14.5 9.5 13z"/><path d="M5.5 12.5l6 6M3 21l4.2-4.2" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  star: '<path fill="currentColor" d="M12 2l3 7 7 .6-5.3 4.7 1.6 7.2L12 17.8 5.7 21.5l1.6-7.2L2 9.6 9 9z"/>',
  bullet: '<path fill="currentColor" d="M8.5 22V11c0-4.5 3.5-9 3.5-9s3.5 4.5 3.5 9v11z"/><path d="M8.5 17.5h7" stroke="rgba(0,0,0,.35)" stroke-width="1.6"/>',
  bolt: '<path fill="currentColor" d="M13.5 2L4 14h7l-1.5 8L20 10h-7z"/>',
  clock: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M12 7v5.5l3.5 2.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>',
  coin: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="12" cy="12" r="4.6" fill="currentColor"/>',
  tag: '<path fill="currentColor" fill-rule="evenodd" d="M2.5 12.5V3H12l9.5 9.5-9.5 9.5zM7.5 5.7a1.8 1.8 0 110 3.6 1.8 1.8 0 010-3.6z"/>',
}
const ICON_OF = {}
const iconGroups = {
  heart: 'vitality ironwill coin_health bigHeart lastStand',
  shield: 'plating kevlar armorRefill thickSkin hardenedHide shrugOff juggernaut tank',
  plus: 'regenerator secondWind patchUp fortifiedRest fieldMedic quickPatch',
  food: 'ironGut packedLunch',
  chest: 'cache_resolve cache_fortune starterPack luckyChest scrounger restock',
  skull: 'notToday giantKiller finisher bossBounty trapKit',
  crosshair: 'marksman deadeye headhunter sharpEye longShot',
  sword: 'berserker firstStrike closeQuarters coin_damage brawler',
  star: 'onARoll legacyBoost streakCash',
  bullet: 'quickhands speedLoader lastRounds extendedMags recycler ammoBelt bandolier ammoHoarder bottomless',
  bolt: 'swiftfoot sprinter fleetFoot hitAndRun adrenaline dodgeStep',
  clock: 'marathoner secondBreath breakRunner',
  coin: 'fortune warChest bankroll interest wavePay scavenger treasureHunter goldRush goldenTouch tipJar',
  tag: 'traderDiscount haggler bargainHunter',
}
for (const [icon, ids] of Object.entries(iconGroups)) for (const id of ids.split(' ')) ICON_OF[id] = icon
const BRANCH_ICON = { survival: 'heart', combat: 'sword', speed: 'bolt', loot: 'coin', gear: 'bullet' }
// An upgrade's icon (a new upgrade without one gets its branch's).
export function upgradeIcon(up) {
  return ICONS[ICON_OF[up.id] || BRANCH_ICON[up.branch] || 'star']
}

// Which upgrades this tree shows (Game.js passes PLAY_META_UPGRADES).
function childrenOf(list) {
  const kids = new Map()
  for (const up of list) {
    const key = up.requires || `root:${up.branch}`
    if (!kids.has(key)) kids.set(key, [])
    kids.get(key).push(up)
  }
  return kids
}

function rootsOf(list, branch) {
  return list.filter((u) => u.branch === branch && (!u.requires || !list.some((o) => o.id === u.requires)))
}

// The words under a spot's name: its price, or why it can't be bought.
function statusLine(game, up, state) {
  if (state === 'owned') return t('upgradesOwned')
  if (state === 'fork') return t('skillForkTaken')
  if (state === 'locked') return t('upgradesRequires', { name: t(META_UPGRADES.find((u) => u.id === up.requires)?.titleKey) })
  if (state === 'lifetime') return t('cacheLifetimeLocked', { have: Math.floor(Number(game.careerStats.lifetimeCoinsEarned) || 0), need: up.requiresLifetimeCoins })
  return t('perkCostLabel', { n: up.cost })
}

// --- the whole thing ---

// list: the upgrades to show; buy(up): buys one (ProgressUI checks it).
export function renderSkillTree(game, list, buy) {
  const lifetime = game.careerStats?.lifetimeCoinsEarned
  const stateOf = (up) => upgradeState(game.metaProgress, lifetime, up)
  renderNotes()
  renderMap(game, list, stateOf, buy)
}

function renderNotes() {
  const hint = document.getElementById('skill-tree-hint')
  if (hint) hint.textContent = t('skillTreeHint')
  // The one-time refund note (Game.js sets it; the first buy clears it).
  const note = document.getElementById('skill-refund-note')
  if (note) {
    let n = 0
    try { n = Math.floor(Number(localStorage.getItem('gayz-skill-tree-refund')) || 0) } catch { /* none */ }
    note.style.display = n > 0 ? '' : 'none'
    if (n > 0) note.textContent = t('skillTreeRefund', { n: n.toLocaleString() })
  }
}

// --- Map ---

// Where the map is looking: x/y in screen pixels, s = zoom.
// auto: nobody has moved it since it appeared, so keep it fitted.
const cam = { x: 0, y: 0, s: 0.5, auto: true }
let selected = null
let mapSize = { w: 0, h: 0 }
// The first ring's radius (stage px): the map opens with that ring in view.
let firstRing = MAP_R0

// Lays the tree out in a circle: Start in the middle, each branch a
// slice, every upgrade one ring further out than the one it needs. Leaves
// get the angle they need to fit at their own ring (inner rings are
// smaller, so their leaves get a wider slice); a parent sits in the
// middle of its children's angles.
function layoutMap(list) {
  const kids = childrenOf(list)
  const ring = (d) => MAP_R0 + (d - 1) * MAP_RING
  // Every leaf and its ring, in drawing order.
  const leaves = []
  const walk = (up, d) => {
    const c = kids.get(up.id) || []
    if (!c.length) leaves.push({ id: up.id, d })
    for (const k of c) walk(k, d + 1)
  }
  const roots = []
  for (const branch of TREE_BRANCHES) {
    for (const r of rootsOf(list, branch)) {
      roots.push(r)
      walk(r, 1)
    }
    // A gap between branches (a leaf-sized nothing).
    leaves.push({ gap: true, d: 2 })
  }
  // How much room a leaf needs along its ring: a spot's width at the top
  // and bottom of the circle, only its height at the sides.
  const room = (ang) => MAP_NODE_W * Math.abs(Math.sin(ang)) + MAP_NODE_H * Math.abs(Math.cos(ang)) + MAP_GAP
  // Hand out the angles at scale k; returns how much of the circle that used.
  const angle = new Map()
  const spread = (k, spare) => {
    let a = -Math.PI / 2
    for (const l of leaves) {
      const w = room(a) / (ring(l.d) * k) + spare
      if (!l.gap) angle.set(l.id, a + w / 2)
      a += w
    }
    return a + Math.PI / 2
  }
  // Scale the rings until it all just fits, then share out what's left.
  let k = 1
  for (let i = 0; i < 6; i++) k = Math.max(1, k * (spread(k, 0) / (Math.PI * 2)))
  spread(k, Math.max(0, (Math.PI * 2 - spread(k, 0)) / leaves.length))
  const pos = new Map()
  const place = (up, d) => {
    const c = kids.get(up.id) || []
    let ang
    if (!c.length) ang = angle.get(up.id)
    else {
      const as = c.map((x) => place(x, d + 1))
      ang = (as[0] + as[as.length - 1]) / 2
    }
    const r = ring(d) * k
    pos.set(up.id, { x: Math.cos(ang) * r, y: Math.sin(ang) * r, ang })
    return ang
  }
  for (const r of roots) place(r, 1)
  let reach = 0
  for (const p of pos.values()) reach = Math.max(reach, Math.abs(p.x), Math.abs(p.y))
  return { pos, reach, r1: ring(1) * k }
}

function renderMap(game, list, stateOf, buy) {
  const wrap = document.getElementById('skill-map')
  const stage = document.getElementById('skill-map-stage')
  if (!wrap || !stage) return
  const { pos, reach, r1 } = layoutMap(list)
  firstRing = r1
  const half = reach + MAP_NODE_W / 2 + MAP_PAD
  const w = half * 2
  const h = half * 2
  mapSize = { w, h }
  stage.style.width = `${w}px`
  stage.style.height = `${h}px`
  stage.innerHTML = ''
  // Centre of each spot, in stage pixels.
  const at = (id) => {
    const p = pos.get(id)
    return { x: half + p.x, y: half + p.y }
  }
  const centre = { x: half, y: half }
  // Lines first (under the spots), slightly bent around the middle.
  const svgNS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNS, 'svg')
  svg.setAttribute('class', 'skill-map-lines')
  svg.setAttribute('width', w)
  svg.setAttribute('height', h)
  for (const up of list) {
    const b = at(up.id)
    const a = up.requires && pos.has(up.requires) ? at(up.requires) : centre
    // Control point: the child's angle at the parent's distance, so lines
    // curve along the rings instead of cutting across them.
    const ra = Math.hypot(a.x - half, a.y - half)
    const ang = pos.get(up.id).ang
    const cx = half + Math.cos(ang) * ra
    const cy = half + Math.sin(ang) * ra
    const path = document.createElementNS(svgNS, 'path')
    path.setAttribute('d', `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`)
    path.setAttribute('class', game.metaProgress.purchased.has(up.id) ? 'skill-line owned' : 'skill-line')
    path.dataset.branch = up.branch
    svg.appendChild(path)
  }
  stage.appendChild(svg)
  // You, in the middle (florr-style): your skin's flat front picture, and
  // how much of the tree you own beside it.
  const start = document.createElement('div')
  start.className = 'skill-map-start'
  start.style.left = `${centre.x - MAP_START / 2}px`
  start.style.top = `${centre.y - MAP_START / 2}px`
  start.style.width = `${MAP_START}px`
  start.style.height = `${MAP_START}px`
  const me = document.createElement('img')
  me.className = 'skill-map-me'
  me.alt = ''
  me.draggable = false
  const skinUrl = game.settings?.customSkinDataUrl || DEFAULT_SKIN_DATA_URL
  skinFrontIconURL(skinUrl).then((src) => { if (src && me.isConnected) me.src = src }).catch(() => {})
  const owned = list.filter((up) => game.metaProgress.purchased.has(up.id)).length
  const stats = document.createElement('div')
  stats.className = 'skill-map-stats'
  stats.id = 'skill-map-owned'
  stats.textContent = `${t('upgradesOwned')}: ${owned} / ${list.length}`
  start.append(me, stats)
  stage.appendChild(start)
  for (const up of list) {
    const p = at(up.id)
    const state = stateOf(up)
    const node = document.createElement('button')
    node.type = 'button'
    const isRoot = !up.requires || !pos.has(up.requires)
    node.className = `skill-map-node is-${state}${up.fork ? ' is-forked' : ''}${isRoot ? ' is-root' : ''}${selected === up.id ? ' selected' : ''}`
    node.dataset.upgrade = up.id
    node.dataset.branch = up.branch
    node.style.left = `${p.x - MAP_NODE_W / 2}px`
    node.style.top = `${p.y - MAP_NODE_H / 2}px`
    node.style.width = `${MAP_NODE_W}px`
    node.style.height = `${MAP_NODE_H}px`
    node.setAttribute('aria-label', `${t(up.titleKey)} - ${statusLine(game, up, state)}`)
    // The roots carry their branch's name on top.
    if (isRoot) {
      const tag = document.createElement('span')
      tag.className = 'skill-map-branch'
      tag.textContent = t(BRANCH_TITLE[up.branch])
      node.appendChild(tag)
    }
    const icon = document.createElement('span')
    icon.className = 'skill-map-icon'
    icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${upgradeIcon(up)}</svg>`
    // The price badge (a tick once owned).
    const badge = document.createElement('span')
    badge.className = 'skill-map-cost'
    badge.textContent = state === 'owned' ? '✓' : up.cost >= 1000 ? `${+(up.cost / 1000).toFixed(1)}k` : String(up.cost)
    // Hidden name - keeps the upgrade's words in the button for search/tests.
    const name = document.createElement('span')
    name.className = 'skill-map-name'
    name.textContent = t(up.titleKey)
    node.append(icon, badge, name)
    node.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showTip(game, up, stateOf(up), node) })
    node.addEventListener('pointerleave', hideTip)
    node.addEventListener('click', () => {
      if (wrap._dragged) return
      selected = up.id
      for (const n of stage.querySelectorAll('.skill-map-node.selected')) n.classList.remove('selected')
      node.classList.add('selected')
      renderInfo(game, up, stateOf(up), buy)
    })
    stage.appendChild(node)
  }
  hideTip()
  const sel = list.find((u) => u.id === selected)
  if (sel) renderInfo(game, sel, stateOf(sel), buy)
  else renderInfo(game, null, null, buy)
  wireMap(wrap)
  if (cam.auto) openView()
  else applyCam()
}

// How the Map first looks: zoomed in on Start (or all of it, if that's
// bigger) so the first upgrades can be read straight away.
function openView() {
  const view = document.getElementById('skill-map-view')
  if (!view || !mapSize.w || !view.clientWidth) return
  fitMap()
  // Close enough to read the icons; on a tall window, zoomed out enough
  // that the whole first ring of upgrades fits too.
  const ringFit = Math.min(view.clientWidth, view.clientHeight) / (2 * (firstRing + MAP_NODE_H))
  const s = Math.max(cam.s, MAP_OPEN_MIN, Math.min(MAP_OPEN_ZOOM, ringFit))
  if (cam.s >= s) return
  cam.s = s
  cam.x = view.clientWidth / 2 - (mapSize.w / 2) * cam.s
  cam.y = view.clientHeight / 2 - (mapSize.h / 2) * cam.s
  applyCam()
}

// The little card shown while the mouse points at an upgrade: what it
// does (its words are the stats, e.g. "+50 Max Health"), its branch and
// price or why it's locked. It sits beside the spot, inside the map
// window, and never catches the mouse itself.
function tipBox() {
  const view = document.getElementById('skill-map-view')
  if (!view) return null
  let tip = document.getElementById('skill-map-tip')
  if (!tip) {
    tip = document.createElement('div')
    tip.id = 'skill-map-tip'
    tip.setAttribute('role', 'tooltip')
    view.appendChild(tip)
  }
  return tip
}
function showTip(game, up, state, node) {
  const tip = tipBox()
  const view = document.getElementById('skill-map-view')
  if (!tip || !view) return
  tip.dataset.branch = up.branch
  tip.innerHTML = ''
  const name = document.createElement('div')
  name.className = 'skill-tip-name'
  name.textContent = t(up.titleKey)
  const line = document.createElement('div')
  line.className = 'skill-tip-status'
  line.textContent = `${t(BRANCH_TITLE[up.branch])} · ${statusLine(game, up, state)}${up.fork ? ` · ${t('skillForkTag')}` : ''}`
  tip.append(name, line)
  tip.classList.add('show')
  const v = view.getBoundingClientRect()
  const n = node.getBoundingClientRect()
  const tw = tip.offsetWidth
  const th = tip.offsetHeight
  // Right of the spot if it fits, else left; kept inside the window.
  let x = n.right - v.left + 10
  if (x + tw > v.width - 6) x = n.left - v.left - tw - 10
  let y = n.top - v.top + n.height / 2 - th / 2
  x = Math.max(6, Math.min(v.width - tw - 6, x))
  y = Math.max(6, Math.min(v.height - th - 6, y))
  tip.style.left = `${x}px`
  tip.style.top = `${y}px`
}
function hideTip() {
  document.getElementById('skill-map-tip')?.classList.remove('show')
}

// The box under the map: the picked spot, its price and Buy.
function renderInfo(game, up, state, buy) {
  const box = document.getElementById('skill-map-info')
  if (!box) return
  box.innerHTML = ''
  if (!up) {
    box.textContent = t('skillMapPick')
    box.classList.add('empty')
    return
  }
  box.classList.remove('empty')
  box.dataset.branch = up.branch
  const name = document.createElement('span')
  name.className = 'skill-info-name'
  name.textContent = t(up.titleKey)
  const line = document.createElement('span')
  line.className = 'skill-info-status'
  line.textContent = `${t(BRANCH_TITLE[up.branch])} · ${statusLine(game, up, state)}${up.fork ? ` · ${t('skillForkTag')}` : ''}`
  box.append(name, line)
  if (state === 'buy' || state === 'poor') {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'skill-info-buy'
    btn.id = 'skill-map-buy'
    btn.textContent = t('skillMapBuy', { n: up.cost })
    btn.disabled = state !== 'buy'
    btn.addEventListener('click', () => buy(up))
    box.appendChild(btn)
  }
}

function applyCam() {
  hideTip()
  const stage = document.getElementById('skill-map-stage')
  if (stage) stage.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.s})`
}

// Whole tree in view (when the Map is first shown, and the reset button).
export function fitMap() {
  const wrap = document.getElementById('skill-map-view')
  if (!wrap || !mapSize.w) return
  const vw = wrap.clientWidth
  const vh = wrap.clientHeight
  if (!vw || !vh) return
  cam.s = Math.max(ZOOM_MIN, Math.min(1, Math.min(vw / mapSize.w, vh / mapSize.h)))
  cam.x = (vw - mapSize.w * cam.s) / 2
  cam.y = (vh - mapSize.h * cam.s) / 2
  applyCam()
}

// Zoom by `f` keeping the point (ox, oy) of the view still.
function zoomAt(f, ox, oy) {
  cam.auto = false
  const s = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.s * f))
  const k = s / cam.s
  cam.x = ox - (ox - cam.x) * k
  cam.y = oy - (oy - cam.y) * k
  cam.s = s
  applyCam()
}

function wireMap(wrap) {
  const view = document.getElementById('skill-map-view')
  if (!view || view._wired) return
  view._wired = true
  // Each time the map appears (panel opened, Map picked) it starts with
  // the whole tree in view: hidden it measures 0, shown it doesn't.
  let shown = false
  new ResizeObserver(() => {
    const now = view.clientWidth > 0
    if (!now) cam.auto = true
    if (now && (!shown || cam.auto)) openView()
    shown = now
  }).observe(view)
  const pointers = new Map()
  let last = null
  let pinch = null
  let moved = 0
  view.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 1) {
      last = { x: e.clientX, y: e.clientY }
      moved = 0
      wrap._dragged = false
    }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      pinch = Math.hypot(a.x - b.x, a.y - b.y)
    }
  })
  view.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      const r = view.getBoundingClientRect()
      zoomAt(d / pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top)
      pinch = d
      wrap._dragged = true
      return
    }
    if (!last) return
    const dx = e.clientX - last.x
    const dy = e.clientY - last.y
    moved += Math.abs(dx) + Math.abs(dy)
    if (moved > DRAG_PX) {
      wrap._dragged = true
      // Captured only once it's really a drag, so a tap still clicks.
      if (!view.hasPointerCapture(e.pointerId)) view.setPointerCapture(e.pointerId)
      cam.auto = false
      cam.x += dx
      cam.y += dy
      applyCam()
    }
    last = { x: e.clientX, y: e.clientY }
  })
  const end = (e) => {
    pointers.delete(e.pointerId)
    if (pointers.size < 2) pinch = null
    if (!pointers.size) last = null
    // A drag's own click comes right after pointerup - let it pass first.
    if (wrap._dragged) setTimeout(() => { wrap._dragged = false }, 0)
  }
  view.addEventListener('pointerup', end)
  view.addEventListener('pointercancel', end)
  view.addEventListener('wheel', (e) => {
    e.preventDefault()
    const r = view.getBoundingClientRect()
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top)
  }, { passive: false })
  const centerZoom = (f) => zoomAt(f, view.clientWidth / 2, view.clientHeight / 2)
  document.getElementById('skill-map-in')?.addEventListener('click', () => centerZoom(1.25))
  document.getElementById('skill-map-out')?.addEventListener('click', () => centerZoom(1 / 1.25))
  document.getElementById('skill-map-fit')?.addEventListener('click', () => {
    fitMap()
    cam.auto = false
  })
}
