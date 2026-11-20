// GayZ TV (2026-11-19, Gaymi: "100% free", YouTube only, signed in with a
// daily cap, a TV tab in the Gallery, reports hide a clip at 10). A clip is
// a YouTube link (only its 11-letter video id is kept; it plays in a
// youtube-nocookie frame) or a small GIF file (a Clip Maker GIF, say). The
// list reads only small docs (`tvClips`: title, name, video id or a tiny
// JPEG thumb); a GIF's bytes live in `tvGifs/{id}` and load on tap.
// Firestore side: CloudSync's tv functions + rules. Same convention as
// GalleryUI.js: plain functions taking `game`.
import * as CloudSync from './CloudSync.js'
import { t } from './i18n.js'
import { _escapeHtml, _censorText, _formatRelativeTime } from './Game.js'

export const TV_DAILY_CAP = 3 // guess - Gaymi said "daily cap"
export const TV_HIDE_AT = 10 // reports that hide a clip (Gaymi)
export const TV_MAX_GIF_BYTES = 650000
const THUMB_LONG = 192
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/
const GIF_RE = /^data:image\/gif;base64,[A-Za-z0-9+/=]+$/
const THUMB_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/

const $ = (id) => document.getElementById(id)
const api = (game) => game.__tvBackendForTests || CloudSync

// A YouTube video id from a link (watch, youtu.be, Shorts, embed, live) or
// a bare id; '' when it isn't one.
export function youtubeIdFromLink(text) {
  const s = String(text || '').trim()
  if (YT_ID_RE.test(s)) return s
  let url
  try { url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`) } catch { return '' }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '')
  let id = ''
  if (host === 'youtu.be') id = url.pathname.split('/')[1] || ''
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0] === 'watch') id = url.searchParams.get('v') || ''
    else if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1] || ''
  }
  return YT_ID_RE.test(id) ? id : ''
}

// Left out: 10+ reports, or hidden by the owner (`hidden`, set server-side).
const shown = (clip) => clip && typeof clip.id === 'string' && clip.hidden !== true && (Number(clip.reports) || 0) < TV_HIDE_AT
  && ((clip.kind === 'youtube' && YT_ID_RE.test(clip.youtubeId || '')) || (clip.kind === 'gif' && THUMB_RE.test(clip.thumb || '')))
const ytThumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`
const name = (c) => String(c.creatorNickname || '').slice(0, 24)

export function bindTv(game) {
  game._tvClips = []
  game._tvOpen = null
  game._tvDraft = null
  game._tvReported = new Set()
  $('tv-post-btn')?.addEventListener('click', () => startPost(game))
  $('tv-grid')?.addEventListener('click', (e) => {
    const card = e.target.closest('.tv-card')
    const clip = card && game._tvClips.find((c) => c.id === card.dataset.id)
    if (clip) openClip(game, clip)
  })
  $('tv-back-btn')?.addEventListener('click', () => showTv(game))
  $('tv-report-btn')?.addEventListener('click', () => reportOpen(game))
  $('tv-delete-btn')?.addEventListener('click', () => deleteOpen(game))
  $('tv-kind-youtube')?.addEventListener('click', () => setDraftKind(game, 'youtube'))
  $('tv-kind-gif')?.addEventListener('click', () => setDraftKind(game, 'gif'))
  $('tv-pick-gif')?.addEventListener('click', () => $('tv-post-file')?.click())
  $('tv-post-file')?.addEventListener('change', (e) => pickGif(game, e.target.files?.[0]))
  $('tv-post-submit')?.addEventListener('click', () => submitPost(game))
  $('tv-post-cancel')?.addEventListener('click', () => showTv(game))
  for (const id of ['tv-post-link', 'tv-post-title']) {
    $(id)?.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') submitPost(game)
    })
  }
}

export function renderTvTexts() {
  const text = (id, key) => { const el = $(id); if (el) el.textContent = t(key) }
  text('tv-how', 'tvHow')
  text('tv-post-btn', 'tvPostBtn')
  text('tv-post-heading', 'tvPostHeading')
  text('tv-kind-youtube', 'tvKindYoutube')
  text('tv-kind-gif', 'tvKindGif')
  text('tv-pick-gif', 'tvPickGif')
  text('tv-post-submit', 'galleryPostBtn')
  text('tv-post-cancel', 'galleryCancelBtn')
  text('tv-back-btn', 'galleryBackBtn')
  text('tv-report-btn', 'tvReportBtn')
  text('tv-delete-btn', 'galleryDeleteBtn')
  const link = $('tv-post-link')
  if (link) link.placeholder = t('tvLinkPlaceholder')
  const title = $('tv-post-title')
  if (title) title.placeholder = t('galleryTitlePlaceholder')
}

function setTvView(view) {
  for (const [v, id] of [['list', 'tv-list'], ['post', 'tv-post-form'], ['detail', 'tv-detail']]) {
    const el = $(id)
    if (el) el.hidden = v !== view
  }
  if (view !== 'detail') stopTv()
}

// Stops a playing clip (leaving a clip, closing the Gallery).
export function stopTv() {
  $('tv-player')?.replaceChildren()
}

// The TV tab's list: the newest clips, hidden ones (10+ reports) left out.
export async function showTv(game) {
  renderTvTexts()
  setTvView('list')
  game._tvOpen = null
  game._tvDraft = null
  const empty = $('tv-empty')
  const grid = $('tv-grid')
  if (empty) { empty.textContent = t('galleryLoading'); empty.hidden = false }
  if (grid) grid.innerHTML = ''
  let clips
  try { clips = await api(game).fetchTvClips() } catch { clips = null }
  if (game._galleryKind !== 'tv' || $('tv-list')?.hidden) return
  if (!clips) {
    if (empty) empty.textContent = t('galleryLoadFailed')
    return
  }
  game._tvClips = clips.filter(shown).sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
  if (!grid) return
  grid.innerHTML = game._tvClips.map((c) => `
    <button type="button" class="tv-card gallery-card" data-id="${_escapeHtml(c.id)}">
      <span class="gallery-card-pic gallery-pic-map tv-card-pic"><img alt="" src="${_escapeHtml(c.kind === 'youtube' ? ytThumb(c.youtubeId) : c.thumb)}"><span class="tv-card-kind">${c.kind === 'youtube' ? 'YouTube' : 'GIF'}</span></span>
      <span class="gallery-card-title">${_escapeHtml(String(c.title || '').slice(0, 40))}</span>
      <span class="gallery-card-by">${_escapeHtml(t('galleryBy', { name: name(c) }))}</span>
    </button>`).join('')
  if (empty) {
    empty.hidden = game._tvClips.length > 0
    empty.textContent = t('tvEmpty')
  }
}

async function openClip(game, clip) {
  game._tvOpen = clip
  setTvView('detail')
  const player = $('tv-player')
  $('tv-detail-title').textContent = String(clip.title || '').slice(0, 40)
  $('tv-detail-by').textContent = `${t('galleryBy', { name: name(clip) })} · ${_formatRelativeTime(Math.max(0, Date.now() - (Number(clip.createdAt) || 0)))}`
  $('tv-detail-status').textContent = ''
  const mine = !!game._cloudUid && clip.creatorUid === game._cloudUid
  $('tv-delete-btn').hidden = !mine
  const report = $('tv-report-btn')
  report.hidden = mine
  report.disabled = game._tvReported.has(clip.id)
  if (game._cloudUid && !mine && !game._tvReported.has(clip.id)) {
    api(game).hasReportedTvClip(clip.id, game._cloudUid).then((yes) => {
      if (yes) game._tvReported.add(clip.id)
      if (game._tvOpen === clip) report.disabled = game._tvReported.has(clip.id)
    }).catch(() => {})
  }
  if (clip.kind === 'youtube') {
    const frame = document.createElement('iframe')
    frame.className = 'tv-frame'
    frame.src = `https://www.youtube-nocookie.com/embed/${clip.youtubeId}?autoplay=1&rel=0`
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
    frame.allowFullscreen = true
    frame.title = String(clip.title || '').slice(0, 40)
    player.replaceChildren(frame)
    return
  }
  // A GIF: its tiny picture first, then the real GIF (1 read).
  const img = document.createElement('img')
  img.className = 'tv-gif'
  img.alt = ''
  img.src = clip.thumb
  player.replaceChildren(img)
  let gif
  try { gif = await api(game).fetchTvGif(clip.id) } catch { gif = '' }
  if (game._tvOpen !== clip) return
  if (typeof gif === 'string' && GIF_RE.test(gif)) img.src = gif
  else $('tv-detail-status').textContent = t('galleryLoadFailed')
}

async function reportOpen(game) {
  const clip = game._tvOpen
  if (!clip) return
  if (!game._cloudUid) return game._showHomepageToast(t('gallerySignIn'))
  if (game._tvReported.has(clip.id)) return
  if (!window.confirm(t('tvReportConfirm'))) return
  $('tv-report-btn').disabled = true
  try {
    await api(game).reportTvClip(clip.id, game._cloudUid)
    game._tvReported.add(clip.id)
    clip.reports = (Number(clip.reports) || 0) + 1
    if (game._tvOpen === clip) $('tv-detail-status').textContent = t('tvReported')
  } catch {
    if (game._tvOpen === clip) {
      $('tv-report-btn').disabled = false
      $('tv-detail-status').textContent = t('galleryPostFailed')
    }
  }
}

async function deleteOpen(game) {
  const clip = game._tvOpen
  if (!clip || clip.creatorUid !== game._cloudUid) return
  if (!window.confirm(t('tvDeleteConfirm'))) return
  await api(game).deleteTvClip(clip.id, clip.kind).catch(() => {})
  game._tvClips = game._tvClips.filter((c) => c.id !== clip.id)
  showTv(game)
}

// --- posting ---

function startPost(game) {
  if (!game._cloudUid) {
    game._showHomepageToast(t('gallerySignIn'))
    return
  }
  game._tvDraft = { kind: 'youtube', gif: '', thumb: '' }
  setTvView('post')
  $('tv-post-link').value = ''
  $('tv-post-title').value = ''
  $('tv-post-file').value = ''
  $('tv-post-status').textContent = ''
  setDraftKind(game, 'youtube')
}

function setDraftKind(game, kind) {
  const draft = game._tvDraft
  if (!draft) return
  draft.kind = kind
  $('tv-kind-youtube').classList.toggle('active', kind === 'youtube')
  $('tv-kind-gif').classList.toggle('active', kind === 'gif')
  $('tv-post-link').hidden = kind !== 'youtube'
  $('tv-pick-gif').hidden = kind !== 'gif'
  const preview = $('tv-post-preview')
  preview.hidden = kind !== 'gif' || !draft.gif
  if (!preview.hidden) preview.src = draft.gif
  $('tv-post-status').textContent = ''
}

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result || ''))
  r.onerror = () => reject(r.error)
  r.readAsDataURL(file)
})

// The GIF's first picture, shrunk to a small JPEG for the list.
async function gifThumb(dataUrl) {
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  const w = img.naturalWidth || 1
  const h = img.naturalHeight || 1
  const k = Math.min(1, THUMB_LONG / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * k))
  c.height = Math.max(1, Math.round(h * k))
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.7)
}

async function pickGif(game, file) {
  const draft = game._tvDraft
  const status = $('tv-post-status')
  if (!draft || !file) return
  draft.gif = ''
  draft.thumb = ''
  status.textContent = ''
  if (file.type !== 'image/gif' && !/\.gif$/i.test(file.name || '')) { status.textContent = t('tvNotGif'); setDraftKind(game, 'gif'); return }
  if (file.size > TV_MAX_GIF_BYTES) { status.textContent = t('tvGifTooBig'); setDraftKind(game, 'gif'); return }
  try {
    const gif = (await readAsDataUrl(file)).replace(/^data:[^;,]*;base64,/, 'data:image/gif;base64,')
    if (!GIF_RE.test(gif)) throw new Error('not a gif')
    const thumb = await gifThumb(gif)
    if (game._tvDraft !== draft) return
    draft.gif = gif
    draft.thumb = thumb
  } catch {
    status.textContent = t('tvNotGif')
  }
  setDraftKind(game, 'gif')
}

async function submitPost(game) {
  const draft = game._tvDraft
  if (!draft) return
  const status = $('tv-post-status')
  if (!game._cloudUid) return game._showHomepageToast(t('gallerySignIn'))
  const youtubeId = draft.kind === 'youtube' ? youtubeIdFromLink($('tv-post-link').value) : ''
  if (draft.kind === 'youtube' && !youtubeId) { status.textContent = t('tvBadLink'); return }
  if (draft.kind === 'gif' && (!draft.gif || !draft.thumb)) { status.textContent = t('tvNeedClip'); return }
  const title = _censorText($('tv-post-title').value.trim()).slice(0, 40)
  if (!title) { status.textContent = t('galleryNeedTitle'); return }
  const btn = $('tv-post-submit')
  btn.disabled = true
  try {
    await api(game).createTvClip({
      kind: draft.kind,
      title,
      creatorUid: game._cloudUid,
      creatorNickname: (game.settings.nickname || 'Survivor').slice(0, 24),
      ...(draft.kind === 'youtube' ? { youtubeId } : { thumb: draft.thumb, gif: draft.gif }),
    }, TV_DAILY_CAP)
    game._tvDraft = null
    game._showHomepageToast(t('galleryPosted'))
    showTv(game)
  } catch (e) {
    const why = e?.message
    status.textContent = t(why === 'tv-daily-cap' ? 'tvDailyCap' : why === 'tv-banned' ? 'tvBanned' : 'galleryPostFailed')
  } finally {
    btn.disabled = false
  }
}
