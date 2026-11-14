// The Upgrades skill tree (2026-11-14, Batch 4b), drawn two ways - Gaymi
// asked for both, as two sections to pick between:
// - Branches: five columns (Survival, Combat, Speed, Loot, Gear), each an
//   outline that grows down from its root, lines showing what unlocks
//   what. Click a card to buy it (like the old card list). The columns
//   wrap onto new rows when there's no room (one per row on a phone).
// - Map: one big tree from a Start spot, every branch fanning out to the
//   right. Drag to move, wheel / pinch / the +/- buttons to zoom. Tap a
//   spot to see it below the map, with its Buy button.
// The data (costs, what needs what, forks) is MetaProgress.js; ProgressUI's
// _renderUpgradesOptions calls renderSkillTree after every change.
import { META_UPGRADES, TREE_BRANCHES, upgradeState } from './MetaProgress.js'
import { t } from './i18n.js'

const VIEW_KEY = 'gayz-skill-tree-view'
// Map sizes (stage pixels): the first ring's radius, the step between
// rings, the space between neighbours, and the spots.
const MAP_R0 = 190
const MAP_RING = 150
const MAP_GAP = 10
const MAP_NODE_W = 120
const MAP_NODE_H = 50
// The zoom the Map opens at (on Start); the fit button shows it all.
const MAP_OPEN_ZOOM = 0.6
const MAP_START = 84
const MAP_PAD = 40
const ZOOM_MIN = 0.12
const ZOOM_MAX = 1.6
const DRAG_PX = 6

const BRANCH_TITLE = { survival: 'skillBranchSurvival', combat: 'skillBranchCombat', speed: 'skillBranchSpeed', loot: 'skillBranchLoot', gear: 'skillBranchGear' }

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

let view = null
function loadView() {
  if (view) return view
  try { view = localStorage.getItem(VIEW_KEY) === 'map' ? 'map' : 'columns' } catch { view = 'columns' }
  return view
}

// --- the whole thing ---

// list: the upgrades to show; buy(up): buys one (ProgressUI checks it).
export function renderSkillTree(game, list, buy) {
  const lifetime = game.careerStats?.lifetimeCoinsEarned
  const stateOf = (up) => upgradeState(game.metaProgress, lifetime, up)
  wireViewButtons(game)
  renderColumns(game, list, stateOf, buy)
  renderMap(game, list, stateOf, buy)
  showView(loadView())
}

function wireViewButtons(game) {
  for (const btn of document.querySelectorAll('.skill-view-btn')) {
    btn.textContent = t(btn.dataset.skillView === 'map' ? 'skillViewMap' : 'skillViewBranches')
    if (btn._wired) continue
    btn._wired = true
    btn.addEventListener('click', () => {
      view = btn.dataset.skillView === 'map' ? 'map' : 'columns'
      try { localStorage.setItem(VIEW_KEY, view) } catch { /* not kept */ }
      showView(view)
      if (view === 'map') openView()
    })
  }
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
  void game
}

function showView(v) {
  const cols = document.getElementById('upgrades-options')
  const map = document.getElementById('skill-map')
  if (cols) cols.style.display = v === 'map' ? 'none' : ''
  if (map) map.style.display = v === 'map' ? '' : 'none'
  for (const btn of document.querySelectorAll('.skill-view-btn')) {
    const on = btn.dataset.skillView === v
    btn.classList.toggle('active', on)
    btn.setAttribute('aria-pressed', on ? 'true' : 'false')
  }
}

// --- Branches (columns) ---

function renderColumns(game, list, stateOf, buy) {
  const root = game.upgradesOptions
  if (!root) return
  root.innerHTML = ''
  root.classList.add('skill-columns')
  const kids = childrenOf(list)
  for (const branch of TREE_BRANCHES) {
    const roots = rootsOf(list, branch)
    if (!roots.length) continue
    const col = document.createElement('section')
    col.className = 'skill-col'
    col.dataset.branch = branch
    const owned = list.filter((u) => u.branch === branch && game.metaProgress.purchased.has(u.id)).length
    const total = list.filter((u) => u.branch === branch).length
    const head = document.createElement('h3')
    head.className = 'skill-col-title'
    head.textContent = `${t(BRANCH_TITLE[branch])} ${owned}/${total}`
    col.appendChild(head)
    const ul = document.createElement('ul')
    ul.className = 'skill-outline'
    for (const r of roots) ul.appendChild(columnNode(game, r, kids, stateOf, buy))
    col.appendChild(ul)
    root.appendChild(col)
  }
}

function columnNode(game, up, kids, stateOf, buy) {
  const li = document.createElement('li')
  const state = stateOf(up)
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = `perk-option skill-node is-${state}${state === 'locked' || state === 'lifetime' || state === 'fork' ? ' locked' : ''}${up.fork ? ' is-forked' : ''}`
  btn.dataset.upgrade = up.id
  btn.disabled = state !== 'buy'
  btn.innerHTML = `
    <span class="perk-name"></span>
    <span class="perk-cost"></span>
    ${up.fork ? '<span class="skill-fork-tag"></span>' : ''}
  `
  btn.querySelector('.perk-name').textContent = t(up.titleKey)
  btn.querySelector('.perk-cost').textContent = statusLine(game, up, state)
  if (up.fork) btn.querySelector('.skill-fork-tag').textContent = t('skillForkTag')
  btn.addEventListener('click', () => buy(up))
  li.appendChild(btn)
  const children = kids.get(up.id)
  if (children?.length) {
    const ul = document.createElement('ul')
    for (const c of children) ul.appendChild(columnNode(game, c, kids, stateOf, buy))
    li.appendChild(ul)
  }
  return li
}

// --- Map ---

// Where the map is looking: x/y in screen pixels, s = zoom.
// auto: nobody has moved it since it appeared, so keep it fitted.
const cam = { x: 0, y: 0, s: 0.5, auto: true }
let selected = null
let mapSize = { w: 0, h: 0 }

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
  return { pos, reach }
}

function renderMap(game, list, stateOf, buy) {
  const wrap = document.getElementById('skill-map')
  const stage = document.getElementById('skill-map-stage')
  if (!wrap || !stage) return
  const { pos, reach } = layoutMap(list)
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
  // Start, in the middle.
  const start = document.createElement('div')
  start.className = 'skill-map-start'
  start.textContent = t('skillMapStart')
  start.style.left = `${centre.x - MAP_START / 2}px`
  start.style.top = `${centre.y - MAP_START / 2}px`
  start.style.width = `${MAP_START}px`
  start.style.height = `${MAP_START}px`
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
    // The roots carry their branch's name on top.
    if (isRoot) {
      const tag = document.createElement('span')
      tag.className = 'skill-map-branch'
      tag.textContent = t(BRANCH_TITLE[up.branch])
      node.appendChild(tag)
    }
    node.appendChild(document.createTextNode(t(up.titleKey)))
    node.title = `${t(up.titleKey)} - ${statusLine(game, up, state)}`
    node.addEventListener('click', () => {
      if (wrap._dragged) return
      selected = up.id
      for (const n of stage.querySelectorAll('.skill-map-node.selected')) n.classList.remove('selected')
      node.classList.add('selected')
      renderInfo(game, up, stateOf(up), buy)
    })
    stage.appendChild(node)
  }
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
  if (cam.s >= MAP_OPEN_ZOOM) return
  cam.s = MAP_OPEN_ZOOM
  cam.x = view.clientWidth / 2 - (mapSize.w / 2) * cam.s
  cam.y = view.clientHeight / 2 - (mapSize.h / 2) * cam.s
  applyCam()
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
