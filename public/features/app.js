// Builds the sidebar nav from the category sections, and powers the
// search box - both derived directly from the DOM (no separate data file
// to keep in sync), so adding a new .feature block to index.html is
// automatically searchable and counted with zero JS changes needed.

const categories = document.querySelectorAll('section.category')
const toc = document.getElementById('toc')

categories.forEach((section) => {
  const heading = section.querySelector('h2')
  const link = document.createElement('a')
  link.href = `#${section.id}`
  link.textContent = heading.textContent
  if (section.id === 'coming-soon') link.classList.add('coming-link')
  toc.appendChild(link)
})

// Expandable cards (weapons, mutators, zombie types, etc.) - click the
// heading to reveal a per-item breakdown. Only .feature.expandable cards
// have this; plain single-idea cards are untouched.
document.querySelectorAll('.feature.expandable > h3').forEach((h3) => {
  h3.addEventListener('click', () => {
    h3.closest('.feature').classList.toggle('open')
  })
})

function updateCounts() {
  const liveCount = document.querySelectorAll('section.category:not(#coming-soon) .feature').length
  const soonCount = document.querySelectorAll('#coming-soon .feature').length
  document.getElementById('stat-live').textContent = liveCount
  document.getElementById('stat-soon').textContent = soonCount
}
updateCounts()

const searchInput = document.getElementById('search')
const searchCount = document.getElementById('search-count')
const allFeatures = document.querySelectorAll('.feature')

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase()

  if (!q) {
    allFeatures.forEach((f) => f.classList.remove('hidden-search'))
    categories.forEach((c) => c.classList.remove('hidden-search'))
    searchCount.style.display = 'none'
    return
  }

  let matches = 0
  categories.forEach((section) => {
    let sectionHasMatch = false
    section.querySelectorAll('.feature').forEach((f) => {
      const hit = f.textContent.toLowerCase().includes(q)
      f.classList.toggle('hidden-search', !hit)
      if (hit) { sectionHasMatch = true; matches++ }
    })
    section.classList.toggle('hidden-search', !sectionHasMatch)
  })

  searchCount.style.display = 'block'
  searchCount.textContent = `${matches} feature${matches === 1 ? '' : 's'} found`
})

// Map blueprint lightbox - click the map to open a bigger, zoomable copy.
// Clones #map-blueprint-svg into the lightbox rather than moving the real
// one, so the inline map on the page is never disturbed. Zoom/pan is one
// CSS transform on #map-lightbox-canvas, driven by scale/panX/panY state -
// wheel and the +/- buttons adjust scale (zooming toward the cursor when
// the wheel is used), dragging adjusts pan, and both are clamped so the
// map can't be zoomed out past its natural size or dragged offscreen.
const mapTrigger = document.getElementById('map-blueprint-trigger')
const mapSvg = document.getElementById('map-blueprint-svg')

if (mapTrigger && mapSvg) {
  const lightbox = document.getElementById('map-lightbox')
  const viewport = document.getElementById('map-lightbox-viewport')
  const canvas = document.getElementById('map-lightbox-canvas')
  const zoomLevelEl = document.getElementById('map-lightbox-zoom-level')
  const zoomInBtn = document.getElementById('map-lightbox-zoom-in')
  const zoomOutBtn = document.getElementById('map-lightbox-zoom-out')
  const resetBtn = document.getElementById('map-lightbox-reset')
  const closeBtn = document.getElementById('map-lightbox-close')

  const MIN_SCALE = 1
  const MAX_SCALE = 6
  let scale = 1
  let panX = 0
  let panY = 0
  let dragging = false
  let dragStartX = 0
  let dragStartY = 0
  let panStartX = 0
  let panStartY = 0
  let lastActiveEl = null

  function applyTransform() {
    canvas.style.transform = `translate(-50%, -50%) translate(${panX}px, ${panY}px) scale(${scale})`
    zoomLevelEl.textContent = `${Math.round(scale * 100)}%`
  }

  function clampPan() {
    // Loose clamp based on how far zoomed in we are - not pixel-exact
    // against the rendered size, just enough to stop the map from being
    // dragged completely off screen at high zoom.
    const maxPan = (scale - 1) * 300
    panX = Math.max(-maxPan, Math.min(maxPan, panX))
    panY = Math.max(-maxPan, Math.min(maxPan, panY))
  }

  function setScale(next, focusX, focusY) {
    const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next))
    if (focusX !== undefined && clamped !== scale) {
      // Keep the point under the cursor/pinch-center stationary while
      // zooming, rather than always zooming toward the canvas center.
      const rect = viewport.getBoundingClientRect()
      const cx = focusX - rect.left - rect.width / 2
      const cy = focusY - rect.top - rect.height / 2
      const ratio = clamped / scale
      panX = cx - (cx - panX) * ratio
      panY = cy - (cy - panY) * ratio
    }
    scale = clamped
    clampPan()
    applyTransform()
  }

  function openLightbox() {
    canvas.innerHTML = ''
    canvas.appendChild(mapSvg.cloneNode(true))
    scale = 1
    panX = 0
    panY = 0
    applyTransform()
    lastActiveEl = document.activeElement
    lightbox.classList.add('open')
    document.body.style.overflow = 'hidden'
    closeBtn.focus()
  }

  function closeLightbox() {
    lightbox.classList.remove('open')
    document.body.style.overflow = ''
    canvas.innerHTML = ''
    if (lastActiveEl) lastActiveEl.focus()
  }

  mapTrigger.addEventListener('click', openLightbox)
  closeBtn.addEventListener('click', closeLightbox)
  resetBtn.addEventListener('click', () => { scale = 1; panX = 0; panY = 0; applyTransform() })
  zoomInBtn.addEventListener('click', () => setScale(scale + 0.5))
  zoomOutBtn.addEventListener('click', () => setScale(scale - 0.5))

  // Clicking anywhere that isn't the canvas (or a drag) closes it - the
  // viewport has no background of its own, so it's what actually receives
  // a "backdrop" click, not #map-lightbox itself (fully covered by the
  // toolbar + viewport children).
  let viewportClickWasDrag = false
  viewport.addEventListener('click', (e) => {
    if (viewportClickWasDrag) { viewportClickWasDrag = false; return }
    if (e.target === viewport) closeLightbox()
  })
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox()
  })

  document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('open')) return
    if (e.key === 'Escape') closeLightbox()
    else if (e.key === '+' || e.key === '=') setScale(scale + 0.5)
    else if (e.key === '-') setScale(scale - 0.5)
  })

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault()
    const delta = e.deltaY < 0 ? 0.35 : -0.35
    setScale(scale + delta, e.clientX, e.clientY)
  }, { passive: false })

  viewport.addEventListener('pointerdown', (e) => {
    if (scale <= MIN_SCALE) return
    dragging = true
    viewport.classList.add('dragging')
    dragStartX = e.clientX
    dragStartY = e.clientY
    panStartX = panX
    panStartY = panY
    viewport.setPointerCapture(e.pointerId)
  })

  viewport.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const dx = e.clientX - dragStartX
    const dy = e.clientY - dragStartY
    // A few px of jitter still counts as "just a click" - only a real
    // drag should suppress the click-to-close handler above.
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) viewportClickWasDrag = true
    panX = panStartX + dx
    panY = panStartY + dy
    clampPan()
    applyTransform()
  })

  const endDrag = () => {
    dragging = false
    viewport.classList.remove('dragging')
  }
  viewport.addEventListener('pointerup', endDrag)
  viewport.addEventListener('pointercancel', endDrag)
}
