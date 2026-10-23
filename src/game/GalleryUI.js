// The Gallery (2026-10-13, Gaymi: "you can put your skin on gallery ... make
// 3 sections for Character, Weapon and Map ... where everyone can see, like,
// and comment on it"). Opened from its footer link next to Design a Skin.
// Character posts come from Design a Skin (its Post to Gallery button), map
// posts from the Map Editor's pause screen; Weapon is Coming Soon.
//
// Same convention as ChatUI.js/CloudSaveUI.js: plain functions taking `game`,
// all state on the Game instance. Firestore side: CloudSync's gallery
// functions and rules. Everything other players wrote (titles, names,
// comments) is escaped before it's shown, and pictures are only ever used as
// <img> sources after checking they're PNG/JPEG data URLs.
import { blockedOffline } from './Offline.js'
import * as CloudSync from './CloudSync.js'
import { t } from './i18n.js'
import { _escapeHtml, _censorText, _formatRelativeTime, skinFrontIconURL } from './Game.js'

export const GALLERY_KINDS = ['character', 'weapon', 'map']
// The biggest picture a post may carry (the rules allow 400k characters).
const MAX_IMAGE = 300000
// Skins bigger than this are posted as a copy with fewer pixels.
const SKIN_POST_MAX = 150000
// Seconds between two comments from the same player.
const COMMENT_GAP_MS = 3000
const IMAGE_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/
const MAP_CODE_RE = /^[A-Z0-9]{6}$/

function api(game) {
  return game.__galleryBackendForTests || CloudSync
}

const $ = (id) => document.getElementById(id)

function safeImage(src) {
  return typeof src === 'string' && src.length <= 400000 && IMAGE_RE.test(src) ? src : ''
}

export function bindGallery(game) {
  game._galleryKind = 'character'
  game._gallerySort = 'new'
  game._galleryPosts = []
  game._galleryLiked = new Set()
  game._galleryOpen = null
  game._galleryDraft = null
  for (const tab of document.querySelectorAll('.gallery-tab')) {
    tab.addEventListener('click', () => showKind(game, tab.dataset.galleryKind))
  }
  $('gallery-sort')?.addEventListener('change', (e) => {
    game._gallerySort = e.target.value === 'likes' ? 'likes' : 'new'
    renderGrid(game)
  })
  $('gallery-grid')?.addEventListener('click', (e) => {
    const card = e.target.closest('.gallery-card')
    const post = card && game._galleryPosts.find((p) => p.id === card.dataset.id)
    if (post) openPost(game, post)
  })
  $('gallery-back-btn')?.addEventListener('click', () => showList(game))
  $('gallery-like-btn')?.addEventListener('click', () => likeOpenPost(game))
  $('gallery-use-btn')?.addEventListener('click', () => useOpenPost(game, true))
  $('gallery-edit-btn')?.addEventListener('click', () => useOpenPost(game, false))
  $('gallery-delete-btn')?.addEventListener('click', () => deleteOpenPost(game))
  $('gallery-comment-send')?.addEventListener('click', () => sendComment(game))
  $('gallery-comment-input')?.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') sendComment(game)
  })
  $('gallery-comments')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-delete-comment]')
    if (btn) deleteComment(game, btn.dataset.deleteComment)
  })
  $('gallery-post-submit')?.addEventListener('click', () => submitPost(game))
  $('gallery-post-cancel')?.addEventListener('click', () => {
    game._galleryDraft = null
    showList(game)
  })
  $('gallery-post-title')?.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') submitPost(game)
  })
}

// Opens the Gallery on a section (the last one, by default).
export function openGallery(game, kind = game._galleryKind || 'character') {
  if (blockedOffline(game)) return
  game._closeAllMenuPanels()
  game.galleryPanel.style.display = 'flex'
  renderTexts(game)
  game._authReadyPromise?.then(() => game._renderSignInFooters())
  showKind(game, kind)
}

export function renderTexts() {
  const text = (id, key, params) => { const el = $(id); if (el) el.textContent = t(key, params) }
  text('gallery-panel-title', 'galleryBtn')
  for (const kind of GALLERY_KINDS) {
    const label = document.querySelector(`#gallery-tab-${kind} .gallery-tab-label`)
    if (label) label.textContent = t(`galleryTab_${kind}`)
  }
  text('gallery-weapon-soon-tag', 'comingSoonTitle')
  text('gallery-weapon-coming-title', 'comingSoonTitle')
  text('gallery-weapon-coming-text', 'galleryWeaponSoon')
  const sort = $('gallery-sort')
  if (sort) {
    sort.options[0].textContent = t('gallerySortNew')
    sort.options[1].textContent = t('gallerySortLikes')
  }
  text('gallery-back-btn', 'galleryBackBtn')
  text('gallery-comments-heading', 'galleryCommentsHeading')
  text('gallery-comment-send', 'gallerySendBtn')
  text('gallery-post-submit', 'galleryPostBtn')
  text('gallery-post-cancel', 'galleryCancelBtn')
  text('gallery-post-heading', 'galleryPostHeading')
  const input = $('gallery-comment-input')
  if (input) input.placeholder = t('galleryCommentPlaceholder')
  const title = $('gallery-post-title')
  if (title) title.placeholder = t('galleryTitlePlaceholder')
}

function showKind(game, kind) {
  if (!GALLERY_KINDS.includes(kind)) kind = 'character'
  game._galleryKind = kind
  for (const tab of document.querySelectorAll('.gallery-tab')) tab.classList.toggle('active', tab.dataset.galleryKind === kind)
  const how = $('gallery-how')
  if (how) how.textContent = t(kind === 'map' ? 'galleryHowMap' : 'galleryHowCharacter')
  if (kind === 'weapon') {
    setView('weapon')
    return
  }
  if (game._galleryDraft && game._galleryDraft.kind === kind) {
    showDraft(game)
    return
  }
  showList(game)
}

function setView(view) {
  const views = { list: 'gallery-list-view', weapon: 'gallery-weapon-page', post: 'gallery-post-form', detail: 'gallery-detail' }
  for (const [name, id] of Object.entries(views)) {
    const el = $(id)
    if (el) el.hidden = name !== view
  }
}

async function showList(game) {
  setView('list')
  game._galleryOpen = null
  const kind = game._galleryKind
  const empty = $('gallery-empty')
  if (empty) {
    empty.textContent = t('galleryLoading')
    empty.hidden = false
  }
  $('gallery-grid').innerHTML = ''
  let posts
  try {
    posts = await api(game).fetchGalleryPosts(kind)
  } catch {
    posts = null
  }
  if (game._galleryKind !== kind) return
  game._galleryPosts = (posts || []).filter((p) => p && typeof p.id === 'string' && p.kind === kind)
  if (!posts && empty) {
    empty.textContent = t('galleryLoadFailed')
    return
  }
  renderGrid(game)
}

function renderGrid(game) {
  const grid = $('gallery-grid')
  const empty = $('gallery-empty')
  if (!grid) return
  const posts = [...game._galleryPosts].sort((a, b) => game._gallerySort === 'likes'
    ? (Number(b.likes) || 0) - (Number(a.likes) || 0) || (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)
    : (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
  grid.innerHTML = posts.map((p) => `
    <button type="button" class="gallery-card" data-id="${_escapeHtml(p.id)}">
      <span class="gallery-card-pic gallery-pic-${p.kind === 'map' ? 'map' : 'character'}"><img alt="" data-src-for="${_escapeHtml(p.id)}"></span>
      <span class="gallery-card-title">${_escapeHtml(String(p.title || '').slice(0, 40))}</span>
      <span class="gallery-card-by">${_escapeHtml(t('galleryBy', { name: String(p.creatorNickname || '').slice(0, 24) }))}</span>
      <span class="gallery-card-likes">${_escapeHtml(t('galleryLikes', { n: Math.max(0, Math.floor(Number(p.likes) || 0)) }))}</span>
    </button>`).join('')
  if (empty) {
    empty.hidden = posts.length > 0
    empty.textContent = t('galleryEmpty')
  }
  // Pictures: a map's screenshot as it is, a skin as its flat front view.
  for (const p of posts) {
    const img = grid.querySelector(`img[data-src-for="${CSS.escape(p.id)}"]`)
    const src = safeImage(p.image)
    if (!img || !src) continue
    if (p.kind === 'map') img.src = src
    else skinFrontIconURL(src).then((url) => { if (url) img.src = url })
  }
}

async function openPost(game, post) {
  game._galleryOpen = post
  setView('detail')
  const src = safeImage(post.image)
  const img = $('gallery-detail-img')
  img.className = post.kind === 'map' ? 'gallery-detail-map' : 'gallery-detail-character'
  img.removeAttribute('src')
  if (src) {
    if (post.kind === 'map') img.src = src
    else skinFrontIconURL(src).then((url) => { if (url && game._galleryOpen === post) img.src = url })
  }
  $('gallery-detail-title').textContent = String(post.title || '').slice(0, 40)
  $('gallery-detail-by').textContent = `${t('galleryBy', { name: String(post.creatorNickname || '').slice(0, 24) })} · ${_formatRelativeTime(Math.max(0, Date.now() - (Number(post.createdAt) || 0)))}`
  const mine = !!game._cloudUid && post.creatorUid === game._cloudUid
  const use = $('gallery-use-btn')
  const edit = $('gallery-edit-btn')
  use.textContent = t(post.kind === 'map' ? 'galleryPlayBtn' : 'galleryWearBtn')
  use.hidden = post.kind === 'map' ? !MAP_CODE_RE.test(post.mapCode || '') : !src
  edit.textContent = t('galleryEditBtn')
  edit.hidden = post.kind !== 'map' || !MAP_CODE_RE.test(post.mapCode || '')
  const del = $('gallery-delete-btn')
  del.textContent = t('galleryDeleteBtn')
  del.hidden = !mine
  renderLike(game)
  if (game._cloudUid && !game._galleryLiked.has(post.id)) {
    api(game).hasLikedGalleryPost(post.id, game._cloudUid).then((liked) => {
      if (liked) game._galleryLiked.add(post.id)
      if (game._galleryOpen === post) renderLike(game)
    }).catch(() => {})
  }
  loadComments(game, post)
}

function renderLike(game) {
  const post = game._galleryOpen
  const btn = $('gallery-like-btn')
  if (!post || !btn) return
  const liked = game._galleryLiked.has(post.id)
  btn.textContent = `${t(liked ? 'galleryLiked' : 'galleryLikeBtn')} · ${Math.max(0, Math.floor(Number(post.likes) || 0))}`
  btn.disabled = liked
  btn.classList.toggle('liked', liked)
}

async function likeOpenPost(game) {
  const post = game._galleryOpen
  if (!post) return
  if (!game._cloudUid) return needSignIn(game)
  if (game._galleryLiked.has(post.id)) return
  game._galleryLiked.add(post.id)
  renderLike(game)
  const ok = await api(game).likeGalleryPost(post.id, game._cloudUid).catch(() => false)
  if (ok) post.likes = (Number(post.likes) || 0) + 1
  renderLike(game)
}

async function useOpenPost(game, primary) {
  const post = game._galleryOpen
  if (!post) return
  if (post.kind === 'map') {
    if (!MAP_CODE_RE.test(post.mapCode || '')) return
    game._closeGalleryPanel()
    await game._enterBuildMode()
    game.buildMode?.share?.openCode(post.mapCode, primary)
    return
  }
  const src = safeImage(post.image)
  if (!src) return
  await game._applyImportedSkin(src)
  game._showHomepageToast(t('galleryWorn', { name: String(post.creatorNickname || '').slice(0, 24) }))
}

async function deleteOpenPost(game) {
  const post = game._galleryOpen
  if (!post || post.creatorUid !== game._cloudUid) return
  if (!window.confirm(t('galleryDeleteConfirm'))) return
  await api(game).deleteGalleryPost(post.id).catch(() => {})
  game._galleryPosts = game._galleryPosts.filter((p) => p.id !== post.id)
  showList(game)
}

async function loadComments(game, post) {
  const box = $('gallery-comments')
  box.textContent = t('galleryLoading')
  let comments
  try {
    comments = await api(game).fetchGalleryComments(post.id)
  } catch {
    comments = []
  }
  if (game._galleryOpen !== post) return
  post._comments = comments.filter((c) => c && typeof c.text === 'string')
  renderComments(game)
}

function renderComments(game) {
  const post = game._galleryOpen
  const box = $('gallery-comments')
  if (!post || !box) return
  const me = game._cloudUid
  const list = post._comments || []
  box.innerHTML = list.length
    ? list.map((c) => `
      <div class="gallery-comment">
        <span class="gallery-comment-name">${_escapeHtml(String(c.nickname || '').slice(0, 24))}</span>
        <span class="gallery-comment-text">${_escapeHtml(String(c.text).slice(0, 200))}</span>
        <span class="gallery-comment-time">${_escapeHtml(_formatRelativeTime(Math.max(0, Date.now() - (Number(c.createdAt) || 0))))}</span>
        ${me && (c.uid === me || post.creatorUid === me) ? `<button type="button" class="gallery-comment-delete" data-delete-comment="${_escapeHtml(c.id)}" aria-label="${_escapeHtml(t('galleryDeleteBtn'))}">&times;</button>` : ''}
      </div>`).join('')
    : `<p class="gallery-no-comments">${_escapeHtml(t('galleryNoComments'))}</p>`
}

async function sendComment(game) {
  const post = game._galleryOpen
  const input = $('gallery-comment-input')
  if (!post || !input) return
  if (!game._cloudUid) return needSignIn(game)
  const text = _censorText(input.value.trim()).slice(0, 200)
  if (!text) return
  const now = Date.now()
  if (now - (game._galleryLastComment || 0) < COMMENT_GAP_MS) return
  game._galleryLastComment = now
  const nickname = (game.settings.nickname || 'Survivor').slice(0, 24)
  input.value = ''
  try {
    const id = await api(game).addGalleryComment(post.id, { uid: game._cloudUid, nickname, text })
    post._comments = [...(post._comments || []), { id, uid: game._cloudUid, nickname, text, createdAt: now }]
    if (game._galleryOpen === post) renderComments(game)
  } catch {
    game._showHomepageToast(t('galleryPostFailed'))
  }
}

async function deleteComment(game, commentId) {
  const post = game._galleryOpen
  if (!post) return
  await api(game).deleteGalleryComment(post.id, commentId).catch(() => {})
  post._comments = (post._comments || []).filter((c) => c.id !== commentId)
  renderComments(game)
}

function needSignIn(game) {
  game._showHomepageToast(t('gallerySignIn'))
}

// --- posting ---

// A skin from Design a Skin, ready to post: opens the Gallery's post form.
export async function startSkinPost(game, dataUrl, name = '') {
  if (blockedOffline(game)) return
  if (!game._cloudUid) {
    needSignIn(game)
    game._openProfilePanel?.()
    return
  }
  const image = await smallerSkin(dataUrl)
  if (!image) {
    game._showHomepageToast(t('galleryPostFailed'))
    return
  }
  game._galleryDraft = { kind: 'character', image, title: String(name || '').slice(0, 40) }
  openGallery(game, 'character')
}

function showDraft(game) {
  const draft = game._galleryDraft
  setView('post')
  $('gallery-post-title').value = draft.title || ''
  const status = $('gallery-post-status')
  if (status) status.textContent = ''
  const img = $('gallery-post-preview')
  img.removeAttribute('src')
  if (draft.kind === 'map') img.src = draft.image
  else skinFrontIconURL(draft.image).then((url) => { if (url) img.src = url })
}

async function submitPost(game) {
  const draft = game._galleryDraft
  if (!draft) return
  if (!game._cloudUid) return needSignIn(game)
  const title = _censorText($('gallery-post-title').value.trim()).slice(0, 40)
  const status = $('gallery-post-status')
  if (!title) {
    if (status) status.textContent = t('galleryNeedTitle')
    return
  }
  const btn = $('gallery-post-submit')
  btn.disabled = true
  try {
    await postToGallery(game, { ...draft, title })
    game._galleryDraft = null
    game._showHomepageToast(t('galleryPosted'))
    showList(game)
  } catch {
    if (status) status.textContent = t('galleryPostFailed')
  } finally {
    btn.disabled = false
  }
}

// Sends a post (also used by the Map Editor, BuildShare.postToGallery).
export async function postToGallery(game, { kind, title, image, mapCode }) {
  if (!game._cloudUid) throw new Error('signed-out')
  if (!IMAGE_RE.test(image || '') || image.length > MAX_IMAGE) throw new Error('bad-image')
  return api(game).createGalleryPost({
    kind,
    title: String(title).slice(0, 40),
    creatorUid: game._cloudUid,
    creatorNickname: (game.settings.nickname || 'Survivor').slice(0, 24),
    image,
    ...(mapCode ? { mapCode } : {}),
  })
}

// An HD skin (8x/16x) is posted as the biggest 4x/2x/1x copy that fits.
async function smallerSkin(url) {
  if (typeof url !== 'string' || !url.startsWith('data:image/png;base64,')) return ''
  if (url.length <= SKIN_POST_MAX) return url
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    for (const k of [4, 2, 1]) {
      if (img.naturalWidth <= 64 * k) continue
      const c = document.createElement('canvas')
      c.width = 64 * k
      c.height = Math.round(img.naturalHeight * (64 * k) / img.naturalWidth)
      const ctx = c.getContext('2d')
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, 0, 0, c.width, c.height)
      const small = c.toDataURL('image/png')
      if (small.length <= SKIN_POST_MAX) return small
    }
  } catch { /* unreadable */ }
  return ''
}
