// The Gallery (2026-10-13, Gaymi: "you can put your skin on gallery ... make
// 3 sections for Character, Weapon and Map ... where everyone can see, like,
// and comment on it"). Opened from its footer link next to Design a Skin.
// Character posts come from Design a Skin (its Post to Gallery button), map
// posts from the Map Editor's pause screen, Photo posts from a game's Photo
// Mode (PlaySpectate.postPhoto, 2026-10-31); Weapon is Coming Soon.
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

export const GALLERY_KINDS = ['character', 'weapon', 'map', 'photo']
// Posts that are a picture shown as it is (not a skin).
const PICTURE_KINDS = ['map', 'photo']
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
  // Post id -> 'like' or 'dislike' (one vote each, 2026-10-30).
  game._galleryVotes = new Map()
  game._galleryMine = false
  game._galleryOpen = null
  game._galleryDraft = null
  for (const tab of document.querySelectorAll('.gallery-tab')) {
    tab.addEventListener('click', () => showKind(game, tab.dataset.galleryKind))
  }
  $('gallery-sort')?.addEventListener('change', (e) => {
    game._gallerySort = ['likes', 'week'].includes(e.target.value) ? e.target.value : 'new'
    renderGrid(game)
  })
  // My Posts: only your own posts (2026-10-30).
  $('gallery-mine-btn')?.addEventListener('click', () => {
    if (!game._galleryMine && !game._cloudUid) return needSignIn(game)
    game._galleryMine = !game._galleryMine
    renderGrid(game)
  })
  $('gallery-grid')?.addEventListener('click', (e) => {
    const card = e.target.closest('.gallery-card')
    const post = card && game._galleryPosts.find((p) => p.id === card.dataset.id)
    if (post) openPost(game, post)
  })
  $('gallery-back-btn')?.addEventListener('click', () => showList(game))
  $('gallery-like-btn')?.addEventListener('click', () => voteOpenPost(game, 'like'))
  $('gallery-dislike-btn')?.addEventListener('click', () => voteOpenPost(game, 'dislike'))
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
    sort.options[2].textContent = t('gallerySortWeek')
  }
  text('gallery-mine-btn', 'galleryMineBtn')
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
  if (how) how.textContent = t(kind === 'map' ? 'galleryHowMap' : kind === 'photo' ? 'galleryHowPhoto' : 'galleryHowCharacter')
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

const count = (n) => Math.max(0, Math.floor(Number(n) || 0))
// The thumbs are emoji on purpose - Gaymi asked for exactly these
// (2026-10-30), the one exception to the project's no-emoji rule.
const THUMBS_UP = '\u{1F44D}' // eslint-disable-line local/no-emoji
const THUMBS_DOWN = '\u{1F44E}' // eslint-disable-line local/no-emoji
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function renderGrid(game) {
  const grid = $('gallery-grid')
  const empty = $('gallery-empty')
  if (!grid) return
  $('gallery-mine-btn')?.classList.toggle('active', game._galleryMine)
  // Top This Week: the last 7 days' posts, most liked first.
  const weekAgo = Date.now() - WEEK_MS
  const byNew = (a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)
  const posts = game._galleryPosts
    .filter((p) => (!game._galleryMine || p.creatorUid === game._cloudUid) && (game._gallerySort !== 'week' || (Number(p.createdAt) || 0) >= weekAgo))
    .sort((a, b) => game._gallerySort === 'new' ? byNew(a, b) : count(b.likes) - count(a.likes) || byNew(a, b))
  grid.innerHTML = posts.map((p) => `
    <button type="button" class="gallery-card" data-id="${_escapeHtml(p.id)}">
      <span class="gallery-card-pic gallery-pic-${PICTURE_KINDS.includes(p.kind) ? 'map' : 'character'}"><img alt="" data-src-for="${_escapeHtml(p.id)}"></span>
      <span class="gallery-card-title">${_escapeHtml(String(p.title || '').slice(0, 40))}</span>
      <span class="gallery-card-by">${_escapeHtml(t('galleryBy', { name: String(p.creatorNickname || '').slice(0, 24) }))}</span>
      <span class="gallery-card-likes"><span class="gallery-card-up">${THUMBS_UP} ${count(p.likes)}</span><span class="gallery-card-down">${THUMBS_DOWN} ${count(p.dislikes)}</span></span>
    </button>`).join('')
  if (empty) {
    empty.hidden = posts.length > 0
    empty.textContent = t(game._galleryMine ? 'galleryMineEmpty' : 'galleryEmpty')
  }
  // Pictures: a map's screenshot as it is, a skin as its flat front view.
  for (const p of posts) {
    const img = grid.querySelector(`img[data-src-for="${CSS.escape(p.id)}"]`)
    const src = safeImage(p.image)
    if (!img || !src) continue
    if (PICTURE_KINDS.includes(p.kind)) img.src = src
    else skinFrontIconURL(src).then((url) => { if (url) img.src = url })
  }
}

async function openPost(game, post) {
  game._galleryOpen = post
  setView('detail')
  const src = safeImage(post.image)
  const img = $('gallery-detail-img')
  img.className = PICTURE_KINDS.includes(post.kind) ? 'gallery-detail-map' : 'gallery-detail-character'
  img.removeAttribute('src')
  if (src) {
    if (PICTURE_KINDS.includes(post.kind)) img.src = src
    else skinFrontIconURL(src).then((url) => { if (url && game._galleryOpen === post) img.src = url })
  }
  $('gallery-detail-title').textContent = String(post.title || '').slice(0, 40)
  $('gallery-detail-by').textContent = `${t('galleryBy', { name: String(post.creatorNickname || '').slice(0, 24) })} · ${_formatRelativeTime(Math.max(0, Date.now() - (Number(post.createdAt) || 0)))}`
  const mine = !!game._cloudUid && post.creatorUid === game._cloudUid
  const use = $('gallery-use-btn')
  const edit = $('gallery-edit-btn')
  use.textContent = t(post.kind === 'map' ? 'galleryPlayBtn' : 'galleryWearBtn')
  // A photo is just to look at.
  use.hidden = post.kind === 'photo' || (post.kind === 'map' ? !MAP_CODE_RE.test(post.mapCode || '') : !src)
  edit.textContent = t('galleryEditBtn')
  edit.hidden = post.kind !== 'map' || !MAP_CODE_RE.test(post.mapCode || '')
  const del = $('gallery-delete-btn')
  del.textContent = t('galleryDeleteBtn')
  del.hidden = !mine
  renderVotes(game)
  if (game._cloudUid && !game._galleryVotes.has(post.id)) {
    const backend = api(game)
    Promise.all([
      backend.hasLikedGalleryPost(post.id, game._cloudUid).catch(() => false),
      backend.hasDislikedGalleryPost ? backend.hasDislikedGalleryPost(post.id, game._cloudUid).catch(() => false) : false,
    ]).then(([liked, disliked]) => {
      if (liked) game._galleryVotes.set(post.id, 'like')
      else if (disliked) game._galleryVotes.set(post.id, 'dislike')
      if (game._galleryOpen === post) renderVotes(game)
    })
  }
  loadComments(game, post)
}

// 👍 and 👎 with their counts (2026-10-30). One vote per post: once you
// pick one, both buttons lock and yours is highlighted.
function renderVotes(game) {
  const post = game._galleryOpen
  const up = $('gallery-like-btn')
  const down = $('gallery-dislike-btn')
  if (!post || !up) return
  const vote = game._galleryVotes.get(post.id)
  up.textContent = `${THUMBS_UP} ${count(post.likes)}`
  up.title = t(vote === 'like' ? 'galleryLiked' : 'galleryLikeBtn')
  up.disabled = !!vote
  up.classList.toggle('liked', vote === 'like')
  if (down) {
    down.textContent = `${THUMBS_DOWN} ${count(post.dislikes)}`
    down.title = t(vote === 'dislike' ? 'galleryDisliked' : 'galleryDislikeBtn')
    down.disabled = !!vote
    down.classList.toggle('liked', vote === 'dislike')
  }
}

async function voteOpenPost(game, vote) {
  const post = game._galleryOpen
  if (!post) return
  if (!game._cloudUid) return needSignIn(game)
  if (game._galleryVotes.has(post.id)) return
  game._galleryVotes.set(post.id, vote)
  renderVotes(game)
  const backend = api(game)
  const send = vote === 'like' ? backend.likeGalleryPost : backend.dislikeGalleryPost
  // true = counted, false = this vote was already there, null = it
  // didn't go through (offline, or refused) - then they can try again.
  const ok = send ? await send.call(backend, post.id, game._cloudUid).catch(() => null) : null
  if (ok) {
    const field = vote === 'like' ? 'likes' : 'dislikes'
    post[field] = count(post[field]) + 1
  } else if (ok === null) {
    game._galleryVotes.delete(post.id)
  }
  renderVotes(game)
}

async function useOpenPost(game, primary) {
  const post = game._galleryOpen
  if (!post || post.kind === 'photo') return
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
