// Share codes and Community Maps (2026-10-04). Owned by BuildMode
// (`buildMode.share`). Share Map (pause screen) puts the open map online
// under a 6-letter code; anyone can type that code - or pick a map from the
// Community Maps list (Newest / Most Liked / Most Played) - and Play it
// against zombie waves or open it to Edit. Opened maps go in their own
// "Shared Map" slot, so none of your own slots are ever overwritten.
//
// Sharing, liking and reporting need a signed-in Cloud Save account;
// looking and playing don't. Firestore side: CloudSync's sharedMaps
// functions and rules. Names and nicknames from other players are always
// escaped before they're shown (they're untrusted).
import * as CloudSync from './CloudSync.js'
import { t } from './i18n.js'

export const SHARE_SORTS = ['new', 'likes', 'plays']
const CODE_RE = /^[A-Z0-9]{6}$/

function esc(str) {
  const div = document.createElement('div')
  div.textContent = String(str ?? '')
  return div.innerHTML
}

export class BuildShare {
  constructor(buildMode) {
    this.bm = buildMode
    this.sort = 'new'
    this._rows = []
    this._liked = new Set()
    this.panel = document.getElementById('community-maps-panel')
    if (!this.panel) return
    this.list = document.getElementById('community-maps-list')
    this.empty = document.getElementById('community-maps-empty')
    this.codeInput = document.getElementById('community-maps-code')
    this.banner = document.getElementById('community-maps-shared')
    document.getElementById('community-maps-close-btn')?.addEventListener('click', () => this.close())
    this.panel.addEventListener('click', (e) => {
      if (e.target === this.panel) this.close()
    })
    // Typing a code shouldn't fly the camera around.
    this.panel.addEventListener('keydown', (e) => e.stopPropagation())
    this.codeInput?.addEventListener('input', () => {
      this.codeInput.value = this.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
    })
    document.getElementById('community-maps-code-play')?.addEventListener('click', () => this.openCode(this.codeInput.value, true))
    document.getElementById('community-maps-code-edit')?.addEventListener('click', () => this.openCode(this.codeInput.value, false))
    document.getElementById('community-maps-copy')?.addEventListener('click', () => {
      const code = document.getElementById('community-maps-shared-code')?.textContent || ''
      navigator.clipboard?.writeText(code).catch(() => {})
      this._toast(t('shareCodeCopied'))
    })
    for (const btn of this.panel.querySelectorAll('.community-maps-tab')) {
      btn.addEventListener('click', () => {
        this.sort = btn.dataset.sort
        this._renderTabs()
        this.refresh()
      })
    }
    this.list?.addEventListener('click', (e) => this._onListClick(e))
  }

  api() {
    return this.bm.game?.__mapShareBackendForTests || CloudSync
  }

  _uid() {
    return this.bm.game?._cloudUid || null
  }

  _toast(text) {
    this.bm.game?._showHomepageToast?.(text)
  }

  get isOpen() {
    return !!this.panel && this.panel.style.display === 'flex'
  }

  open() {
    if (!this.panel) return
    if (this.bm.menuOpen) this.bm.toggleMenu()
    if (document.pointerLockElement) document.exitPointerLock()
    this.panel.style.display = 'flex'
    this._renderTabs()
    this.refresh()
  }

  close() {
    if (this.panel) this.panel.style.display = 'none'
    if (this.banner) this.banner.style.display = 'none'
  }

  _renderTabs() {
    for (const btn of this.panel.querySelectorAll('.community-maps-tab')) btn.classList.toggle('active', btn.dataset.sort === this.sort)
  }

  // Share Map: the open map online under a new code.
  async shareCurrent() {
    const uid = this._uid()
    if (!uid) {
      this._toast(t('shareSignInRequired'))
      return null
    }
    const name = window.prompt(t('shareNamePrompt'), this.bm._slotName())
    if (!name || !name.trim()) return null
    const { base, data, blockCount } = this.bm._shareData()
    if (data.length > 900000) {
      this._toast(t('shareTooLarge'))
      return null
    }
    const nickname = (this.bm.game?.settings?.nickname || 'Player').slice(0, 24)
    const result = await this.api().shareMap(uid, nickname, name.trim().slice(0, 30), base, data, blockCount).catch(() => ({ ok: false }))
    if (!result?.ok) {
      this._toast(t('shareFailed'))
      return null
    }
    this.open()
    const codeEl = document.getElementById('community-maps-shared-code')
    if (codeEl) codeEl.textContent = result.code
    if (this.banner) this.banner.style.display = 'flex'
    return result.code
  }

  async refresh() {
    if (!this.list) return
    this.list.textContent = t('shareLoading')
    let rows
    try {
      rows = await this.api().fetchSharedMaps(this.sort)
    } catch {
      rows = []
    }
    // Builds published the old way (Community Builds, before share codes)
    // are still there, at the end of Newest.
    let older = []
    if (this.sort === 'new' && this.api().fetchCommunityBuilds) {
      try {
        older = (await this.api().fetchCommunityBuilds()).map((b) => ({ ...b, legacy: true }))
      } catch {
        older = []
      }
    }
    this._rows = rows
    this._older = older
    this._render()
  }

  _render() {
    const uid = this._uid()
    const rowHtml = (m) => {
      const code = CODE_RE.test(m.code) ? m.code : ''
      const mine = uid && m.creatorUid === uid
      return `<div class="community-map-row" data-code="${code}">
        <div class="community-map-info">
          <b>${esc(m.name)}</b>
          <span>${esc(t('shareBy', { name: m.creatorNickname }))} · ${esc(t('shareBlocks', { n: Number(m.blockCount) || 0 }))}</span>
          <span>${esc(t('shareLikes', { n: Number(m.likes) || 0 }))} · ${esc(t('sharePlays', { n: Number(m.plays) || 0 }))} · <span class="community-map-code">${code}</span></span>
        </div>
        <div class="community-map-btns">
          <button type="button" data-act="play">${esc(t('sharePlayBtn'))}</button>
          <button type="button" data-act="edit">${esc(t('shareEditBtn'))}</button>
          <button type="button" data-act="like" ${this._liked.has(code) ? 'disabled' : ''}>${esc(t('shareLikeBtn'))}</button>
          <button type="button" data-act="${mine ? 'delete' : 'report'}">${esc(t(mine ? 'shareDeleteBtn' : 'shareReportBtn'))}</button>
        </div>
      </div>`
    }
    const olderHtml = (b, i) => `<div class="community-map-row" data-older="${i}">
        <div class="community-map-info"><b>${esc(b.name)}</b><span>${esc(t('shareBy', { name: b.creatorNickname }))} · ${esc(t('shareBlocks', { n: Number(b.blockCount) || 0 }))}</span></div>
        <div class="community-map-btns"><button type="button" data-act="play">${esc(t('sharePlayBtn'))}</button><button type="button" data-act="edit">${esc(t('shareEditBtn'))}</button></div>
      </div>`
    const html = this._rows.map(rowHtml).join('') + (this._older?.length ? `<h3 class="community-maps-older">${esc(t('shareOlderTitle'))}</h3>` + this._older.map(olderHtml).join('') : '')
    this.list.innerHTML = html
    if (this.empty) this.empty.style.display = html ? 'none' : 'block'
  }

  async _onListClick(e) {
    const btn = e.target.closest('button[data-act]')
    const row = btn?.closest('.community-map-row')
    if (!btn || !row) return
    const act = btn.dataset.act
    if (row.dataset.older !== undefined) {
      const b = this._older?.[Number(row.dataset.older)]
      if (!b) return
      this._load('blank', null, { name: b.name, creatorNickname: b.creatorNickname, code: null }, act === 'play', { blocks: b.blocks, hotbar: b.hotbar })
      return
    }
    const code = row.dataset.code
    if (!CODE_RE.test(code)) return
    if (act === 'play' || act === 'edit') {
      this.openCode(code, act === 'play')
    } else if (act === 'like') {
      const uid = this._uid()
      if (!uid) return this._toast(t('shareSignInRequired'))
      btn.disabled = true
      const ok = await this.api().likeSharedMap(code, uid).catch(() => false)
      this._liked.add(code)
      if (ok) {
        const m = this._rows.find((r) => r.code === code)
        if (m) m.likes = (Number(m.likes) || 0) + 1
        this._render()
      } else this._toast(t('shareAlreadyLiked'))
    } else if (act === 'report') {
      const uid = this._uid()
      if (!uid) return this._toast(t('shareSignInRequired'))
      await this.api().reportSharedMap(code, uid).catch(() => {})
      btn.disabled = true
      this._toast(t('buildReportSent'))
    } else if (act === 'delete') {
      if (!window.confirm(t('shareDeleteConfirm'))) return
      await this.api().deleteSharedMap(code).catch(() => {})
      this._rows = this._rows.filter((r) => r.code !== code)
      this._render()
    }
  }

  // A map by its code: Play it (zombie waves) or open it to Edit.
  async openCode(rawCode, play) {
    const code = String(rawCode || '').toUpperCase().trim()
    if (!CODE_RE.test(code)) {
      this._toast(t('shareBadCode'))
      return false
    }
    const map = await this.api().fetchSharedMap(code).catch(() => null)
    if (!map || typeof map.data !== 'string') {
      this._toast(t('shareNotFound'))
      return false
    }
    this._load(map.base, map.data, { name: map.name, creatorNickname: map.creatorNickname, code }, play)
    if (play) this.api().countSharedMapPlay(code).catch(() => {})
    return true
  }

  _load(base, data, info, play, parsed = null) {
    if (!this.bm.loadSharedData(base, data, info, parsed)) {
      this._toast(t('shareNotFound'))
      return
    }
    this.close()
    if (play) this.bm.survival.start()
    else this._toast(t('shareOpened', { name: info.name }))
  }
}
