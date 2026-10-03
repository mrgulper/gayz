// Chat UI - both chat surfaces: the in-game HUD chat (#chat-panel, Global/
// Clan/Party tabs) and the homepage Global panel's chat (#server-panel),
// plus the shared emoji picker, Name/ID/Mute popup, and Settings > Social's
// Muted Players list they both use. Extracted from Game.js verbatim - plain
// exported functions taking `game` as an explicit first parameter, same
// convention as CloudSaveUI.js/MenuPresets.js/MenuEasterEggs.js. All chat
// state (_chatChannel, _chatUnsub, _serverChatMutedUntil, etc.) still lives
// on the Game instance itself, exactly where it did before the move, since
// Game.js's multiplayer sync (_syncNetworkPlayerState) and clan code read
// and write some of it directly.

import { t } from './i18n.js'
import * as CloudSync from './CloudSync.js'
import { EMOJI_CATEGORIES } from './EmojiData.js'
import { _escapeHtml, _censorText, saveSettings } from './Game.js'

// Global panel chat (#server-panel) - see CloudSync.js's
// sendServerChatMessage for why this is a separate chat room from the
// in-game HUD's #chat-panel, not the same conversation. Structurally a
// much simpler cousin of bindChatWidget's global channel: no tab
// switching (this panel IS the global channel, always), no pointer-lock/
// gameplay-hotkey handling (this only ever opens from the homepage
// menu, never mid-run), own rate-limit state so it doesn't share
// counters with the in-game chat.
export function bindServerChat(game) {
  if (!game.serverPanel) return
  game._serverChatUnsub = null
  game._serverChatSendTimestamps = []
  game._serverChatMutedUntil = 0
  game._serverChatMuteTimer = null

  if (game.serverChatSigninBtn) game.serverChatSigninBtn.addEventListener('click', () => game._handleCloudSignIn())

  if (game.serverChatInputRow) {
    game.serverChatInputRow.addEventListener('submit', (e) => {
      e.preventDefault()
      sendServerChatMessage(game)
    })
  }

  if (game.serverChatMessages) {
    // Left-click a name to copy their Player ID directly; right-click
    // shows the shared "Name #ID" + Mute popup (see showPlayerIdPopup) -
    // same technique as the in-game HUD chat's identical feature.
    //
    // Looks up by uid (the message's own stored sender uid, see
    // sendGlobalChatMessage - a direct leaderboard/{uid} doc GET) when
    // available, falling back to the old by-name query only if it isn't
    // (very old cached messages sent before this field existed). Real
    // bug fixed here (2026-09-22): nickname isn't a stable key - it's
    // just whatever the sender's CURRENT nickname happens to be, so a
    // message sent under an older nickname (or with a name that doesn't
    // exactly match, case/whitespace included) silently failed this
    // lookup and showed the "not found" toast instead of ever copying/
    // showing the Copied badge. uid never changes, so this can't drift.
    const lookupEntry = async (nickname, uid) => {
      try {
        if (uid) {
          const byUid = await CloudSync.fetchLeaderboardEntryByUid(uid)
          if (byUid) return byUid
        }
        return await CloudSync.fetchLeaderboardEntryByName(nickname)
      } catch {
        // Falls through to the "not found" toast below, same as every
        // other best-effort leaderboard lookup in this file.
        return null
      }
    }
    const openPopupForNickname = async (e, btn) => {
      const nickname = btn.dataset.nickname
      if (!nickname) return
      const entry = await lookupEntry(nickname, btn.dataset.uid)
      if (!entry || !entry.playerId) {
        game._showHomepageToast(t('chatCopyPlayerIdNotFound', { name: nickname }))
        return
      }
      showPlayerIdPopup(game, e.clientX, e.clientY, nickname, entry.playerId)
    }
    game.serverChatMessages.addEventListener('contextmenu', (e) => {
      const btn = e.target.closest('.chat-message-nickname')
      if (!btn) return
      e.preventDefault()
      openPopupForNickname(e, btn)
    })
    bindChatNicknameLongPress(game, game.serverChatMessages, openPopupForNickname)
    // Click an ID pasted into a message (see renderChatMessageText) to
    // look up that player's stats - same feature as the in-game HUD chat.
    game.serverChatMessages.addEventListener('click', async (e) => {
      const nameBtn = e.target.closest('.chat-message-nickname')
      if (nameBtn) {
        const nickname = nameBtn.dataset.nickname
        if (!nickname) return
        const entry = await lookupEntry(nickname, nameBtn.dataset.uid)
        if (!entry || !entry.playerId) {
          game._showHomepageToast(t('chatCopyPlayerIdNotFound', { name: nickname }))
          return
        }
        copyChatPlayerId(game, entry.playerId, nameBtn, (msg) => game._showHomepageToast(msg))
        return
      }
      const link = e.target.closest('.chat-message-id-link')
      if (link) {
        const id = link.dataset.lookupId
        if (!id) return
        game._openOtherPlayerProfileById(id)
        return
      }
      const showBtn = e.target.closest('.chat-blocked-show-btn')
      if (showBtn) revealBlockedMessage(game, showBtn)
    })
  }
}

// One shared #emoji-picker overlay (position:fixed, see its own CSS
// comment for why) rather than a separate copy per chat input - reused
// by both #chat-emoji-btn (in-game HUD chat, covers Global/Clan/Party
// since they all share #chat-input) and #server-chat-emoji-btn (the
// homepage Global panel's own input). Repositioned and re-targeted
// every time it opens rather than kept permanently bound to one input.
export function bindEmojiPicker(game) {
  if (!game.emojiPicker) return
  game.emojiPickerCategories.innerHTML = EMOJI_CATEGORIES.map(
    (cat) => `<button type="button" class="emoji-picker-category-btn" data-emoji-category="${cat.id}" title="${_escapeHtml(t(cat.labelKey))}">${cat.icon}</button>`
  ).join('')
  game._emojiPickerTarget = null

  const openFor = (triggerBtn, targetInput) => {
    if (!targetInput) return
    if (game.emojiPicker.style.display !== 'none' && game._emojiPickerTarget === targetInput) {
      closeEmojiPicker(game)
      return
    }
    game._emojiPickerTarget = targetInput
    game.emojiPickerSearch.value = ''
    renderEmojiPickerList(game, '')
    game.emojiPicker.style.display = 'flex'
    // Anchored above the trigger button (chat inputs sit at the bottom
    // of their panel) and clamped inside the viewport - offsetWidth/
    // Height read AFTER display:flex so they're the real rendered
    // size, not 0 from a still-display:none element.
    const rect = triggerBtn.getBoundingClientRect()
    const pickerWidth = game.emojiPicker.offsetWidth
    const pickerHeight = game.emojiPicker.offsetHeight
    let left = rect.right - pickerWidth
    left = Math.max(8, Math.min(left, window.innerWidth - pickerWidth - 8))
    let top = rect.top - pickerHeight - 8
    if (top < 8) top = Math.min(rect.bottom + 8, window.innerHeight - pickerHeight - 8)
    game.emojiPicker.style.left = `${left}px`
    game.emojiPicker.style.top = `${top}px`
    for (const btn of document.querySelectorAll('.chat-emoji-btn')) btn.classList.toggle('active', btn === triggerBtn)
  }

  if (game.chatEmojiBtn) {
    game.chatEmojiBtn.addEventListener('click', (e) => {
      e.preventDefault()
      openFor(game.chatEmojiBtn, game.chatInput)
    })
  }
  if (game.serverChatEmojiBtn) {
    game.serverChatEmojiBtn.addEventListener('click', (e) => {
      e.preventDefault()
      openFor(game.serverChatEmojiBtn, game.serverChatInput)
    })
  }

  game.emojiPickerSearch.addEventListener('input', () => renderEmojiPickerList(game, game.emojiPickerSearch.value))
  game.emojiPickerSearch.addEventListener('click', (e) => e.stopPropagation())

  game.emojiPickerCategories.addEventListener('click', (e) => {
    const btn = e.target.closest('.emoji-picker-category-btn')
    if (!btn) return
    game.emojiPickerList.querySelector(`.emoji-picker-section-label[data-emoji-section="${btn.dataset.emojiCategory}"]`)?.scrollIntoView({ block: 'start' })
  })

  game.emojiPickerList.addEventListener('click', (e) => {
    const item = e.target.closest('.emoji-picker-item')
    if (!item || !game._emojiPickerTarget) return
    insertEmojiIntoInput(game, game._emojiPickerTarget, item.textContent)
  })

  // Click-outside-closes - the two trigger buttons already toggle it
  // themselves in openFor() above, so excluded here to avoid a
  // close-then-immediately-reopen double-fire on the same click.
  document.addEventListener('click', (e) => {
    if (game.emojiPicker.style.display === 'none') return
    if (game.emojiPicker.contains(e.target)) return
    if (e.target === game.chatEmojiBtn || e.target === game.serverChatEmojiBtn) return
    closeEmojiPicker(game)
  })
}

export function closeEmojiPicker(game) {
  if (!game.emojiPicker) return
  game.emojiPicker.style.display = 'none'
  game._emojiPickerTarget = null
  for (const btn of document.querySelectorAll('.chat-emoji-btn')) btn.classList.remove('active')
}

export function renderEmojiPickerList(game, filterText) {
  const filter = filterText.trim().toLowerCase()
  game.emojiPickerList.innerHTML = ''
  let anyMatch = false
  for (const cat of EMOJI_CATEGORIES) {
    const matches = filter ? cat.emojis.filter((e) => e.k.includes(filter)) : cat.emojis
    if (matches.length === 0) continue
    anyMatch = true
    const label = document.createElement('div')
    label.className = 'emoji-picker-section-label'
    label.textContent = t(cat.labelKey)
    label.dataset.emojiSection = cat.id
    game.emojiPickerList.appendChild(label)
    const grid = document.createElement('div')
    grid.className = 'emoji-picker-grid'
    for (const e of matches) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'emoji-picker-item'
      btn.textContent = e.c
      grid.appendChild(btn)
    }
    game.emojiPickerList.appendChild(grid)
  }
  if (!anyMatch) {
    const empty = document.createElement('p')
    empty.id = 'emoji-picker-empty'
    empty.textContent = t('emojiPickerNoResults')
    game.emojiPickerList.appendChild(empty)
  }
}

// Inserts at the current cursor position (or replaces a selection)
// rather than always appending to the end, and stops at the input's
// own maxlength (300, same cap chat messages already have) instead of
// silently typing past it.
export function insertEmojiIntoInput(game, input, emoji) {
  const start = input.selectionStart ?? input.value.length
  const end = input.selectionEnd ?? input.value.length
  const maxLen = Number(input.maxLength) > 0 ? input.maxLength : Infinity
  const next = input.value.slice(0, start) + emoji + input.value.slice(end)
  if (next.length > maxLen) return
  input.value = next
  input.focus()
  const caret = start + emoji.length
  input.setSelectionRange(caret, caret)
}

export function subscribeServerChat(game) {
  if (game._serverChatUnsub) return
  game._serverChatUnsub = CloudSync.subscribeServerChat((msgs) => renderServerChatMessages(game, msgs))
}

export function unsubscribeServerChat(game) {
  if (game._serverChatUnsub) {
    game._serverChatUnsub()
    game._serverChatUnsub = null
  }
}

export function renderServerChatMessages(game, msgs) {
  if (!game.serverChatMessages) return
  game._lastServerChatMsgs = msgs
  const muted = new Set(game.settings.mutedChatPlayers)
  // Hides pre-existing history on a fresh page load (see
  // _chatSessionStartMs's own comment) - this is the only case that
  // actually drops a message; a muted sender's message stays in
  // `visible` and renders as a "Blocked message - Show" placeholder
  // instead (see renderChatMessageRow) rather than disappearing
  // outright.
  const visible = msgs.filter((m) => !(m.createdAt && m.createdAt <= game._chatSessionStartMs))
  // Always linkify here (unlike the in-game HUD chat's channel-gated
  // version) - this panel IS the global channel, always, no tabs to
  // gate on (see bindServerChat's own comment).
  game.serverChatMessages.innerHTML = visible.map((m) => renderChatMessageRow(game, m, true, muted.has(m.nickname))).join('')
  game.serverChatMessages.scrollTop = game.serverChatMessages.scrollHeight
}

// Toggles the sign-in prompt vs. the actual input form (see
// #server-chat-wrap's own CSS comment - the message list itself always
// shows, reading is public). Called on panel open and again whenever
// sign-in state changes (CloudSaveUI.renderCloudSaveState) so the panel
// updates live if it's open while the player signs in/out.
export function renderServerChatSignInState(game) {
  if (!game.serverChatSignedOut) return
  const signedIn = !!game._cloudUid
  game.serverChatSignedOut.style.display = signedIn ? 'none' : 'flex'
  if (game.serverChatInputRow) game.serverChatInputRow.style.display = signedIn ? 'flex' : 'none'
  if (game.serverChatSignedOutDesc) game.serverChatSignedOutDesc.textContent = t('chatSignInRequired')
  if (game.serverChatSigninBtn) game.serverChatSigninBtn.textContent = t('cloudsaveSigninBtn')
}

export async function sendServerChatMessage(game) {
  if (!game.serverChatInput) return
  const text = _censorText(game.serverChatInput.value.trim())
  if (!text) return
  const now = Date.now()
  if (game._serverChatMutedUntil > now) return
  // Same 5-in-10s -> 5-minute mute as the in-game chat's own send
  // handler, own counters though (see bindServerChat's comment).
  game._serverChatSendTimestamps = game._serverChatSendTimestamps.filter((ts) => now - ts < 10000)
  game._serverChatSendTimestamps.push(now)
  if (game._serverChatSendTimestamps.length > 5) {
    game._serverChatMutedUntil = now + 5 * 60 * 1000
    game._serverChatSendTimestamps = []
    startServerChatMuteCountdown(game)
    return
  }
  if (!game._cloudUid) {
    game._showHomepageToast(t('chatSignInRequired'))
    return
  }
  const nickname = game.settings.nickname || 'Player'
  game.serverChatInput.value = ''
  const ok = await CloudSync.sendServerChatMessage(game._cloudUid, nickname, text).then(
    () => true,
    () => false
  )
  if (!ok) game._showHomepageToast(t('chatSendFailed'))
}

export function startServerChatMuteCountdown(game) {
  if (!game.serverChatMutedNotice) return
  if (game._serverChatMuteTimer) clearInterval(game._serverChatMuteTimer)
  const tick = () => {
    const secondsLeft = Math.ceil((game._serverChatMutedUntil - Date.now()) / 1000)
    if (secondsLeft <= 0) {
      game.serverChatMutedNotice.style.display = 'none'
      clearInterval(game._serverChatMuteTimer)
      game._serverChatMuteTimer = null
      return
    }
    game.serverChatMutedNotice.textContent = t('chatMutedNotice', { seconds: secondsLeft })
    game.serverChatMutedNotice.style.display = 'block'
  }
  tick()
  game._serverChatMuteTimer = setInterval(tick, 1000)
}

// Chat - Global/Clan/Party channels, always visible (see #chat-panel's
// own CSS comment for why this isn't a click-to-open widget any more).
// Global and Clan are live Firestore subscriptions (see CloudSync.js);
// Party comes through the multiplayer sync poll instead (see
// _syncNetworkPlayerState and its response handler) since a multiplayer
// session isn't Firebase-Auth-signed-in at all. Only one channel is
// ever subscribed at a time (switching tabs unsubscribes the old one
// first) to keep the read cost bounded, but - unlike the old toggle
// version - always subscribed to SOME channel from the moment the game
// loads, since there's no more "closed" state to gate it behind.
export function bindChatWidget(game) {
  if (!game.chatPanel) return
  game._chatChannel = 'global'
  game._chatUnsub = null
  game._chatSendTimestamps = []
  game._chatMutedUntil = 0
  game._chatMuteTimer = null
  game._chatPartySeenIds = new Set()
  game._chatPartyMessages = []
  game._pendingChatText = null
  game._pendingChatNickname = null
  game._chatInputFocused = false

  game.chatInput.addEventListener('focus', () => {
    game._chatInputFocused = true
    // Map Editor: free the mouse so the chat can be clicked, and drop any
    // held movement keys (their key-ups may never reach the editor).
    // Clicking back into the view locks it again.
    if (game.buildMode?.active) {
      game.buildMode._keys?.clear()
      if (document.pointerLockElement) document.exitPointerLock()
    }
  })
  game.chatInput.addEventListener('blur', () => {
    game._chatInputFocused = false
    // Focusing chat released pointer lock (see _onGameplayPaused's own
    // comment on this) - re-acquire it on blur so aim/look resumes,
    // same re-lock-on-close convention every other panel that unlocks
    // itself already follows (e.g. _closeTraderPanel). Only mid-run -
    // there's no pointer lock to reacquire on the homepage.
    if (game.gameStarted && game.playerState.alive) game._requestPointerLock()
  })

  for (const btn of game.chatTabBtns) {
    btn.addEventListener('click', () => {
      if (btn.disabled || btn.classList.contains('active')) return
      for (const b of game.chatTabBtns) b.classList.toggle('active', b === btn)
      game._chatChannel = btn.dataset.channel
      unsubscribeChatChannel(game)
      subscribeChatChannel(game)
    })
  }

  if (game.chatInputRow) {
    game.chatInputRow.addEventListener('submit', (e) => {
      e.preventDefault()
      sendChatMessage(game)
    })
  }

  // Suppress every gameplay hotkey listener while the chat input is
  // focused - capture phase on window fires before every other keydown
  // listener in this file (all bubble-phase, default), same technique
  // PlayerController's own mousemove-filter guard relies on (see that
  // file's comment): stopImmediatePropagation blocks the OTHER
  // listeners without touching the input's own native typing, since
  // that's the browser's default action, not one of our own listeners.
  // Same listener also handles Enter opening chat when it's NOT
  // focused yet - clicking it directly wouldn't work mid-run anyway
  // (the mouse is pointer-locked for aiming, not a free cursor), same
  // "press a key to open chat" convention every multiplayer FPS uses.
  window.addEventListener('keydown', (e) => {
    if (document.activeElement === game.chatInput) {
      if (e.code === 'Escape') game.chatInput.blur()
      e.stopImmediatePropagation()
      return
    }
    if (e.code === 'Enter' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
      e.preventDefault()
      e.stopImmediatePropagation()
      game.chatInput.focus()
    }
  }, true)

  updateChatTabAvailability(game)
  subscribeChatChannel(game)
  bindChatContextActions(game)
  renderMutedChatPlayers(game)
}

export function updateChatTabAvailability(game) {
  if (!game.chatTabBtns) return
  let fellBack = false
  for (const btn of game.chatTabBtns) {
    const channel = btn.dataset.channel
    const nowDisabled = (channel === 'clan' && !game.settings.clanId) || (channel === 'party' && !game._multiplayerSessionId)
    btn.disabled = nowDisabled
    if (nowDisabled && btn.classList.contains('active')) fellBack = true
  }
  if (fellBack) {
    for (const btn of game.chatTabBtns) btn.classList.toggle('active', btn.dataset.channel === 'global')
    game._chatChannel = 'global'
    unsubscribeChatChannel(game)
    subscribeChatChannel(game)
  }
}

export function subscribeChatChannel(game) {
  renderChatMessages(game, [])
  if (game._chatChannel === 'global') {
    game._chatUnsub = CloudSync.subscribeGlobalChat((msgs) => renderChatMessages(game, msgs))
  } else if (game._chatChannel === 'clan') {
    if (!game.settings.clanId) return
    game._chatUnsub = CloudSync.subscribeClanChat(game.settings.clanId, (msgs) => renderChatMessages(game, msgs))
  } else if (game._chatChannel === 'party') {
    renderChatMessages(game, game._chatPartyMessages)
  }
}

export function unsubscribeChatChannel(game) {
  if (game._chatUnsub) {
    game._chatUnsub()
    game._chatUnsub = null
  }
}

export function renderChatMessages(game, msgs) {
  if (!game.chatMessages) return
  game._lastChatMsgs = msgs
  // Mute/block (Settings > Social > Muted Players) - a muted sender's
  // message stays in `visible` and renders as a "Blocked message -
  // Show" placeholder instead of being filtered out entirely (see
  // renderChatMessageRow) - by nickname (the one thing every channel's
  // messages actually share - Global/Clan carry a Firebase uid, Party
  // carries an ephemeral multiplayer playerId, no single id scheme
  // spans all three). This is a personal chat filter, not real
  // moderation - someone could evade it by changing their nickname,
  // which is an accepted tradeoff for how lightweight this needs to
  // be. Settings > Social is how an existing mute gets undone.
  const muted = new Set(game.settings.mutedChatPlayers)
  // Hides pre-existing history on a fresh page load, same as the
  // homepage Global panel's identical filter (see _chatSessionStartMs's
  // own comment) - only filters messages that actually carry a
  // createdAt, so Party chat (no createdAt field, see its own comment
  // below) passes through unaffected.
  const visible = msgs.filter((m) => !(m.createdAt && m.createdAt <= game._chatSessionStartMs))
  // Global-only for now (see the design conversation) - Party chat's
  // ephemeral multiplayer players have no Player ID at all, and Clan
  // chat wasn't asked for yet. renderChatMessageText no-ops back to
  // plain escaped text outside 'global', same as it always rendered.
  const linkifyIds = game._chatChannel === 'global'
  game.chatMessages.innerHTML = visible.map((m) => renderChatMessageRow(game, m, linkifyIds, muted.has(m.nickname))).join('')
  game.chatMessages.scrollTop = game.chatMessages.scrollHeight
}

// Splits on a pasted Player ID (see _generatePlayerId - always exactly
// '#' + 6 uppercase letters/digits) and wraps just that piece as a
// clickable lookup link, escaping every other piece of the message
// exactly as before. Matching against the RAW text (before any escaping)
// and only ever inserting either escaped plain text or an element built
// entirely from our own fixed strings + the already-charset-constrained
// matched id keeps this exactly as safe against injection as the single
// _escapeHtml(m.text) call this replaced - the regex's character class
// can't match '<', '>', or quotes, so the id itself never needs its own
// escaping to be safe in an attribute or as text.
export function renderChatMessageText(game, text, linkifyIds) {
  if (!linkifyIds) return _escapeHtml(text)
  const idPattern = /#[A-Z0-9]{6}/g
  let out = ''
  let lastIndex = 0
  let match
  while ((match = idPattern.exec(text))) {
    out += _escapeHtml(text.slice(lastIndex, match.index))
    out += `<button type="button" class="chat-message-id-link" data-lookup-id="${match[0].slice(1)}">${match[0]}</button>`
    lastIndex = match.index + match[0].length
  }
  out += _escapeHtml(text.slice(lastIndex))
  return out
}

// Shared by both chat surfaces (homepage Global panel + in-game HUD
// chat) - a muted sender's message used to be filtered out of `visible`
// entirely (silently absent, no trace it was ever sent). Now it still
// renders, as a "Blocked message - Show" placeholder - the real text
// sits in a pre-rendered (already escaped/linkified, same as a normal
// message) sibling span that starts hidden and toggles visible on
// click (see the .chat-blocked-show-btn handler in each chat's click
// listener), rather than looking the text up again at click time - one
// render pass, no index/id bookkeeping needed to find it later.
export function renderChatMessageRow(game, m, linkifyIds, isMuted) {
  const nameBtn = `<button type="button" class="chat-message-nickname" data-nickname="${_escapeHtml(m.nickname)}" data-uid="${_escapeHtml(m.uid || '')}">${_escapeHtml(m.nickname)}:</button>`
  if (isMuted) {
    return `<div class="chat-message-row chat-message-row-blocked">${nameBtn}<span class="chat-message-text chat-blocked-text"><span class="chat-blocked-label">${t('chatBlockedMessage')}</span> - <button type="button" class="chat-blocked-show-btn">${t('chatBlockedShowBtn')}</button><span class="chat-blocked-real-text" style="display: none">${renderChatMessageText(game, m.text, linkifyIds)}</span></span></div>`
  }
  return `<div class="chat-message-row">${nameBtn}<span class="chat-message-text">${renderChatMessageText(game, m.text, linkifyIds)}</span></div>`
}

// Shared by the popup's own ID button AND the direct left-click-to-copy
// handlers below, so the clipboard-write logic exists exactly once. Named
// distinctly from the unrelated, already-existing _copyPlayerId() (copies
// YOUR OWN id from the menu tag, no args) a few hundred lines up - same
// name would have silently clobbered it via duplicate method definition.
// Reuses the existing "Copied" oval badge (_showCopiedBadge, already used
// for the menu Player ID tag and Other Profile's ID) instead of a text
// toast, per reference screenshot (2026-09-20) - anchorEl is whatever
// element was actually clicked, so the badge pops up right above it.
// toastFn is only needed for the (rare) clipboard-unsupported fallback,
// which isn't a "success" so doesn't fit the badge.
export function copyChatPlayerId(game, playerId, anchorEl, toastFn) {
  navigator.clipboard?.writeText(`#${playerId}`).then(() => {
    game._showCopiedBadge(anchorEl)
  }).catch(() => {
    toastFn(t('clipboardCopyUnsupported'))
  })
}

// Shows "Name #ID" plus a Mute button right at the click point, ID itself
// is a button that copies it (per reference screenshots, 2026-09-20) -
// shared by both the in-game HUD chat and the homepage "Global" panel
// chat's right-click handlers below, so there's one popup implementation
// instead of two. Always uses _showHomepageToast (not _showLoreToast) for
// its own feedback toasts - this popup is reachable from the homepage
// chat where gameStarted is false, and _showLoreToast's gameStarted guard
// would silently swallow the toast there.
// position:fixed + clamped after an initial render (its size isn't known
// until it's actually in the DOM) keeps it fully on-screen even from a
// click near an edge.
export function showPlayerIdPopup(game, x, y, name, playerId) {
  if (!game.chatIdPopup) return
  game.chatIdPopupName.textContent = name
  game.chatIdPopupIdBtn.textContent = `#${playerId}`
  // Can't mute yourself - would just hide your own messages from you.
  const isSelf = name === game.settings.nickname
  game.chatIdPopupMuteBtn.textContent = t('muteBtn')
  game.chatIdPopupMuteBtn.style.display = isSelf ? 'none' : ''
  game.chatIdPopup.style.left = `${x}px`
  game.chatIdPopup.style.top = `${y}px`
  game.chatIdPopup.style.display = 'flex'
  const rect = game.chatIdPopup.getBoundingClientRect()
  if (rect.right > window.innerWidth) game.chatIdPopup.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`
  if (rect.bottom > window.innerHeight) game.chatIdPopup.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`

  const hide = () => { game.chatIdPopup.style.display = 'none' }
  // Opens the full stats profile instead of copying (2026-09-22, explicit
  // request) - copying the ID is still one click away via the nickname
  // itself (left-click, see bindChatContextActions/bindServerChat),
  // this button's own job in THIS popup is now "show me who this is."
  game.chatIdPopupIdBtn.onclick = () => {
    hide()
    game._openOtherPlayerProfileById(playerId, name)
  }
  game.chatIdPopupMuteBtn.onclick = () => {
    hide()
    if (!game.settings.mutedChatPlayers.includes(name)) {
      game.settings.mutedChatPlayers.push(name)
      saveSettings(game.settings)
    }
    renderMutedChatPlayers(game)
    refreshChatAfterMuteChange(game)
    game._showHomepageToast(t('chatPlayerMuted', { name }))
  }
  // Deferred (setTimeout 0) so the very click that opened this popup
  // doesn't immediately bubble up and count as the "click outside" that
  // closes it again.
  setTimeout(() => document.addEventListener('click', hide, { once: true }), 0)
}

// Touch/pen equivalent of right-click (desktop's contextmenu) on a chat
// name - a long-press opens the same Name/ID/Mute popup. Pointer Events
// (not touchstart) so this only reacts to pointerType 'touch'/'pen',
// leaving mouse clicks/contextmenu completely alone. Most mobile
// browsers still fire a synthetic click after a long-press's pointerup
// (there was no real "drag"), which would otherwise ALSO trigger the
// direct-copy click handler right after the popup opens - the
// _longPress* state plus a capture-phase click listener swallows just
// that one click. Shared by both chat surfaces (see bindChatContextActions
// /bindServerChat) so the long-press timer/cancel logic exists once.
export function bindChatNicknameLongPress(game, container, openPopupForNickname) {
  const LONG_PRESS_MS = 500
  const MOVE_CANCEL_PX = 10
  let pressTimer = null
  let startX = 0
  let startY = 0
  let longPressFired = false
  let pressBtn = null

  const cancelPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer)
      pressTimer = null
    }
  }

  container.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
    const btn = e.target.closest('.chat-message-nickname')
    if (!btn) return
    startX = e.clientX
    startY = e.clientY
    pressBtn = btn
    longPressFired = false
    cancelPress()
    pressTimer = setTimeout(() => {
      longPressFired = true
      openPopupForNickname(e, btn)
    }, LONG_PRESS_MS)
  })
  container.addEventListener('pointermove', (e) => {
    if (!pressTimer) return
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_CANCEL_PX) cancelPress()
  })
  container.addEventListener('pointerup', cancelPress)
  container.addEventListener('pointercancel', cancelPress)
  // Capture phase so this runs before the bubble-phase click listener
  // that does the direct-copy action.
  container.addEventListener('click', (e) => {
    if (longPressFired && e.target.closest('.chat-message-nickname') === pressBtn) {
      e.stopImmediatePropagation()
      e.preventDefault()
      longPressFired = false
    }
  }, true)
}

// Re-renders whichever chat surfaces have messages cached, so muting (or
// unmuting, see renderMutedChatPlayers) hides/shows their messages right
// away instead of waiting for the next Firestore snapshot to happen to
// fire. Harmless no-op for a surface that's never rendered anything yet.
export function refreshChatAfterMuteChange(game) {
  if (game._lastChatMsgs) renderChatMessages(game, game._lastChatMsgs)
  if (game._lastServerChatMsgs) renderServerChatMessages(game, game._lastServerChatMsgs)
}

// Left-click a name to copy their Player ID directly; right-click shows
// the "Name #ID" + Mute popup instead (per reference screenshots,
// 2026-09-20 - left-click used to also open the popup, now it's a
// one-step copy). Click an ID pasted into a message (see
// renderChatMessageText) to look up that player's stats.
export function bindChatContextActions(game) {
  if (!game.chatMessages) return
  // Same uid-first lookup fix as the Global chat panel's identical
  // handler (see its own comment) - a name-only lookup silently failed
  // whenever the sender's nickname had since changed.
  const lookupEntry = async (nickname, uid) => {
    try {
      if (uid) {
        const byUid = await CloudSync.fetchLeaderboardEntryByUid(uid)
        if (byUid) return byUid
      }
      return await CloudSync.fetchLeaderboardEntryByName(nickname)
    } catch {
      // Falls through to the "not found" toast below, same as every
      // other best-effort leaderboard lookup in this file.
      return null
    }
  }
  const openPopupForNickname = async (e, btn) => {
    const nickname = btn.dataset.nickname
    if (!nickname) return
    const entry = await lookupEntry(nickname, btn.dataset.uid)
    if (!entry || !entry.playerId) {
      game._showLoreToast(t('chatCopyPlayerIdNotFound', { name: nickname }))
      return
    }
    showPlayerIdPopup(game, e.clientX, e.clientY, nickname, entry.playerId)
  }
  game.chatMessages.addEventListener('contextmenu', (e) => {
    const btn = e.target.closest('.chat-message-nickname')
    if (!btn) return
    e.preventDefault()
    openPopupForNickname(e, btn)
  })
  bindChatNicknameLongPress(game, game.chatMessages, openPopupForNickname)
  game.chatMessages.addEventListener('click', async (e) => {
    const nameBtn = e.target.closest('.chat-message-nickname')
    if (nameBtn) {
      const nickname = nameBtn.dataset.nickname
      if (!nickname) return
      const entry = await lookupEntry(nickname, nameBtn.dataset.uid)
      if (!entry || !entry.playerId) {
        game._showLoreToast(t('chatCopyPlayerIdNotFound', { name: nickname }))
        return
      }
      copyChatPlayerId(game, entry.playerId, nameBtn, (msg) => game._showLoreToast(msg))
      return
    }
    const link = e.target.closest('.chat-message-id-link')
    if (link) {
      const id = link.dataset.lookupId
      if (!id) return
      game._openOtherPlayerProfileById(id)
      return
    }
    const showBtn = e.target.closest('.chat-blocked-show-btn')
    if (showBtn) revealBlockedMessage(game, showBtn)
  })
}

// "Show" on a muted sender's "Blocked message" placeholder (see
// renderChatMessageRow) - swaps the label+button for the real,
// already-rendered text sitting right next to them in the DOM. One
// reveal per message row; there's no "hide again" since re-blocking a
// message you already read isn't meaningfully private.
export function revealBlockedMessage(game, showBtn) {
  const row = showBtn.closest('.chat-blocked-text')
  if (!row) return
  const label = row.querySelector('.chat-blocked-label')
  const realText = row.querySelector('.chat-blocked-real-text')
  if (label) label.style.display = 'none'
  showBtn.style.display = 'none'
  if (realText) realText.style.display = ''
}

// Settings > Social > Muted Players - the only way to SEE the current
// mute list and undo one. A muted player's messages still show up in
// chat (as a "Blocked message - Show" placeholder, see
// renderChatMessageRow) - undoing the mute here is what makes them
// render normally again going forward, same as any other message.
// Mirrors the empty-state pattern this project's other list panels
// (Friend List, etc.) already use.
export function renderMutedChatPlayers(game) {
  if (!game.mutedChatPlayersList) return
  const muted = game.settings.mutedChatPlayers
  if (!muted.length) {
    game.mutedChatPlayersList.innerHTML = `<p class="menu-hint-line">${t('mutedChatPlayersEmpty')}</p>`
    return
  }
  game.mutedChatPlayersList.innerHTML = muted.map((name) => `
    <div class="muted-chat-player-row">
      <span>${_escapeHtml(name)}</span>
      <button type="button" class="mini-action-btn" data-unmute="${_escapeHtml(name)}">${t('unmuteBtn')}</button>
    </div>
  `).join('')
  for (const btn of game.mutedChatPlayersList.querySelectorAll('[data-unmute]')) {
    btn.addEventListener('click', () => {
      game.settings.mutedChatPlayers = game.settings.mutedChatPlayers.filter((n) => n !== btn.dataset.unmute)
      saveSettings(game.settings)
      renderMutedChatPlayers(game)
      refreshChatAfterMuteChange(game)
    })
  }
}

export async function sendChatMessage(game) {
  const text = _censorText(game.chatInput.value.trim())
  if (!text) return
  const now = Date.now()
  if (game._chatMutedUntil > now) return
  // 5+ sends inside a 10s rolling window -> muted for 5 minutes. Client-
  // side only - no custom backend here to enforce it server-side too
  // (same trust model this game already accepts everywhere else, see
  // CLAUDE.md's anti-cheat note), per the design conversation.
  game._chatSendTimestamps = game._chatSendTimestamps.filter((t) => now - t < 10000)
  game._chatSendTimestamps.push(now)
  if (game._chatSendTimestamps.length > 5) {
    game._chatMutedUntil = now + 5 * 60 * 1000
    game._chatSendTimestamps = []
    startChatMuteCountdown(game)
    return
  }
  const nickname = game.settings.nickname || 'Player'
  // Guard checks run BEFORE clearing the input and give a visible reason
  // via the same ungated toast used for Community Builds' sign-in check
  // (_showHomepageToast/_renderLoreToast has no gameStarted gate of its
  // own - see that function's comment - so it renders fine mid-run too).
  // Previously the input was cleared unconditionally up front and every
  // failure/guard case was a silent `return`, so a blocked or failed send
  // looked identical to a successful one: the typed text vanished and
  // nothing ever appeared in the log, with zero clue why.
  if (game._chatChannel === 'global') {
    if (!game._cloudUid) {
      game._showHomepageToast(t('chatSignInRequired'))
      return
    }
    game.chatInput.value = ''
    const ok = await CloudSync.sendGlobalChatMessage(game._cloudUid, nickname, text).then(
      () => true,
      () => false
    )
    if (!ok) game._showHomepageToast(t('chatSendFailed'))
  } else if (game._chatChannel === 'clan') {
    if (!game._cloudUid) {
      game._showHomepageToast(t('chatSignInRequired'))
      return
    }
    if (!game.settings.clanId) {
      game._showHomepageToast(t('chatNoClanRequired'))
      return
    }
    game.chatInput.value = ''
    const ok = await CloudSync.sendClanChatMessage(game.settings.clanId, game._cloudUid, nickname, text).then(
      () => true,
      () => false
    )
    if (!ok) game._showHomepageToast(t('chatSendFailed'))
  } else if (game._chatChannel === 'party') {
    if (!game._multiplayerSessionId) {
      game._showHomepageToast(t('chatNoPartyYet'))
      return
    }
    game.chatInput.value = ''
    // Picked up by _syncNetworkPlayerState's next tick (runs every
    // 100ms during a run) rather than a dedicated one-off call - see
    // its own payload-building comment for the same pattern already
    // used for pendingZombieHits/pendingInteractions.
    game._pendingChatText = text
    game._pendingChatNickname = nickname
  }
}

export function startChatMuteCountdown(game) {
  if (!game.chatMutedNotice) return
  clearInterval(game._chatMuteTimer)
  const tick = () => {
    const remaining = Math.max(0, game._chatMutedUntil - Date.now())
    if (remaining <= 0) {
      game.chatMutedNotice.style.display = 'none'
      clearInterval(game._chatMuteTimer)
      return
    }
    game.chatMutedNotice.style.display = 'block'
    game.chatMutedNotice.textContent = t('chatMutedNotice', { seconds: Math.ceil(remaining / 1000) })
  }
  game._chatMuteTimer = setInterval(tick, 1000)
  tick()
}
