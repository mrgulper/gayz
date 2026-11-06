// Photo Postcards (2026-11-06, Gaymi's idea list 7: "turn a Gallery photo
// into a postcard and send it to a friend" - Gaymi picked "friends only").
//
// - On one of your own Photo posts in the Gallery, Send as Postcard opens a
//   little form: pick a friend from your Friends list (only friends with a
//   saved account id), write a short note (NOTE_MAX letters, run through
//   the chat filter) and Send.
// - The Photo tab's Postcards button opens your mailbox: every postcard
//   sent to you, newest first, with who sent it, when, their note and the
//   picture. Delete clears one. Up to MAX_CARDS are kept to read.
//
// Firestore: postcards/{toUid}/inbox/{id} (CloudSync's postcard functions
// and rules) - only the receiver can read or delete theirs, anyone signed
// in can drop one in someone else's box (the friends-only check is the
// Friends list here, like friend requests). Same plain-functions-taking-
// `game` convention as GalleryUI.js; everything someone else wrote is
// escaped, and a picture is only ever an <img> after it's checked to be a
// PNG/JPEG data URL.
import * as CloudSync from './CloudSync.js'
import { t } from './i18n.js'
import { _escapeHtml, _censorText, _formatRelativeTime } from './Game.js'

export const NOTE_MAX = 80
export const MAX_CARDS = 30
// Seconds between two postcards from the same player.
const SEND_GAP_MS = 10000
const IMAGE_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/
const UID_RE = /^[A-Za-z0-9]{6,128}$/

const $ = (id) => document.getElementById(id)

function api(game) {
  return game.__galleryBackendForTests || CloudSync
}

function safeImage(src) {
  return typeof src === 'string' && src.length <= 400000 && IMAGE_RE.test(src) ? src : ''
}

// Friends you can send to (they need their account id).
export function postcardFriends(game) {
  return (game.settings?.savedFriends || []).filter((f) => f && typeof f.uid === 'string' && UID_RE.test(f.uid) && f.uid !== game._cloudUid)
}

export function bindPostcards(game, setView, needSignIn) {
  game._postcardPost = null
  game._postcards = []
  game._postcardSentAt = 0
  $('gallery-postcard-btn')?.addEventListener('click', () => {
    const post = game._galleryOpen
    if (!post || post.kind !== 'photo') return
    if (!game._cloudUid) return needSignIn(game)
    openForm(game, post, setView)
  })
  $('gallery-postcard-cancel')?.addEventListener('click', () => {
    game._postcardPost = null
    setView('detail')
  })
  $('gallery-postcard-send')?.addEventListener('click', () => send(game, setView))
  $('gallery-postcard-note')?.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') send(game, setView)
  })
  $('gallery-postcards-btn')?.addEventListener('click', () => {
    if (!game._cloudUid) return needSignIn(game)
    openInbox(game, setView)
  })
  $('gallery-postcards-back')?.addEventListener('click', () => {
    setView('list')
  })
  $('gallery-postcards-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-delete-postcard]')
    if (btn) removeCard(game, btn.dataset.deletePostcard)
  })
}

export function renderPostcardTexts() {
  const text = (id, key) => { const el = $(id); if (el) el.textContent = t(key) }
  text('gallery-postcard-btn', 'postcardSendBtn')
  text('gallery-postcard-heading', 'postcardHeading')
  text('gallery-postcard-to-label', 'postcardTo')
  text('gallery-postcard-send', 'gallerySendBtn')
  text('gallery-postcard-cancel', 'galleryCancelBtn')
  text('gallery-postcards-btn', 'postcardsBtn')
  text('gallery-postcards-back', 'galleryBackBtn')
  text('gallery-postcards-heading', 'postcardsHeading')
  const note = $('gallery-postcard-note')
  if (note) note.placeholder = t('postcardNotePlaceholder')
}

// The detail view's button: only on your own photos.
export function showPostcardButton(game, post) {
  const btn = $('gallery-postcard-btn')
  if (btn) btn.hidden = !post || post.kind !== 'photo' || !game._cloudUid || post.creatorUid !== game._cloudUid
}

// The toolbar's Postcards button: only on the Photo tab.
export function showInboxButton(kind) {
  const btn = $('gallery-postcards-btn')
  if (btn) btn.hidden = kind !== 'photo'
}

function openForm(game, post, setView) {
  game._postcardPost = post
  setView('postcard')
  const img = $('gallery-postcard-preview')
  const src = safeImage(post.image)
  if (img) {
    if (src) img.src = src
    else img.removeAttribute('src')
  }
  const sel = $('gallery-postcard-to')
  const friends = postcardFriends(game)
  if (sel) {
    sel.innerHTML = friends.map((f) => `<option value="${_escapeHtml(f.uid)}">${_escapeHtml(String(f.name || '?').slice(0, 24))}</option>`).join('')
    sel.disabled = !friends.length
  }
  const sendBtn = $('gallery-postcard-send')
  if (sendBtn) sendBtn.disabled = !friends.length
  const note = $('gallery-postcard-note')
  if (note) {
    note.value = ''
    note.maxLength = NOTE_MAX
  }
  status(friends.length ? '' : t('postcardNoFriends'))
}

function status(text) {
  const el = $('gallery-postcard-status')
  if (el) el.textContent = text
}

async function send(game, setView) {
  const post = game._postcardPost
  if (!post || !game._cloudUid) return
  const to = $('gallery-postcard-to')?.value || ''
  const friend = postcardFriends(game).find((f) => f.uid === to)
  if (!friend) return status(t('postcardNoFriends'))
  const image = safeImage(post.image)
  if (!image) return status(t('postcardFailed'))
  if (Date.now() - game._postcardSentAt < SEND_GAP_MS) return status(t('postcardWait'))
  const note = _censorText(String($('gallery-postcard-note')?.value || '').trim().slice(0, NOTE_MAX))
  const nick = String(game.settings?.nickname || 'Survivor').slice(0, 24)
  const btn = $('gallery-postcard-send')
  if (btn) btn.disabled = true
  status(t('postcardSending'))
  try {
    await api(game).sendPostcard(friend.uid, { fromUid: game._cloudUid, fromNickname: nick, image, note, title: String(post.title || '').slice(0, 40) })
    game._postcardSentAt = Date.now()
    game._postcardPost = null
    setView('detail')
    game._showHomepageToast?.(t('postcardSent', { name: String(friend.name || '').slice(0, 24) }))
  } catch {
    status(t('postcardFailed'))
  } finally {
    if (btn) btn.disabled = false
  }
}

async function openInbox(game, setView) {
  setView('postcards')
  const list = $('gallery-postcards-list')
  const empty = $('gallery-postcards-empty')
  if (list) list.innerHTML = ''
  if (empty) {
    empty.hidden = false
    empty.textContent = t('galleryLoading')
  }
  let cards
  try {
    cards = await api(game).fetchPostcards(game._cloudUid, MAX_CARDS)
  } catch {
    cards = null
  }
  if (!cards) {
    if (empty) empty.textContent = t('galleryLoadFailed')
    return
  }
  game._postcards = cards.filter((c) => c && typeof c.id === 'string').sort((a, b) => (Number(b.sentAt) || 0) - (Number(a.sentAt) || 0))
  renderInbox(game)
}

function renderInbox(game) {
  const list = $('gallery-postcards-list')
  const empty = $('gallery-postcards-empty')
  if (!list) return
  list.innerHTML = game._postcards.map((c) => `
    <div class="postcard" data-id="${_escapeHtml(c.id)}">
      <div class="postcard-pic"><img alt="" data-card-img="${_escapeHtml(c.id)}"></div>
      <div class="postcard-side">
        <p class="postcard-from">${_escapeHtml(t('postcardFrom', { name: String(c.fromNickname || '?').slice(0, 24) }))}</p>
        <p class="postcard-when">${_escapeHtml(_formatRelativeTime(Math.max(0, Date.now() - (Number(c.sentAt) || 0))))}</p>
        <p class="postcard-note">${_escapeHtml(String(c.note || '').slice(0, NOTE_MAX))}</p>
        <button type="button" class="mini-action-btn" data-delete-postcard="${_escapeHtml(c.id)}">${_escapeHtml(t('galleryDeleteBtn'))}</button>
      </div>
    </div>`).join('')
  for (const c of game._postcards) {
    const img = list.querySelector(`img[data-card-img="${CSS.escape(c.id)}"]`)
    const src = safeImage(c.image)
    if (img && src) img.src = src
  }
  if (empty) {
    empty.hidden = game._postcards.length > 0
    empty.textContent = t('postcardsEmpty')
  }
}

async function removeCard(game, id) {
  if (!game._cloudUid) return
  try {
    await api(game).deletePostcard(game._cloudUid, id)
  } catch {
    return
  }
  game._postcards = game._postcards.filter((c) => c.id !== id)
  renderInbox(game)
}
