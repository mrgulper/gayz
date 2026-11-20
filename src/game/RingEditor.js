// The ring editor and item bag (2026-11-15, Batch 2 of the spin ring plan).
// Opens with the Ring Bag key (I), a tap or click on the ring bar, or the
// pause menu's Ring & Bag button. The game keeps running underneath (Gaymi
// picked "anytime", no pause) - and it works in Spectate too.
//
//   Top: your ring slots (3, up to 10 - more in the Shop's Ring tab). Tap one to pick it (it glows).
//   Middle: the item you last tapped - name, rarity, what it does, numbers.
//   Bottom: the bag - everything you own, rarest first, with how many.
//   Tap a bag item = it goes into the picked slot (then the next slot is
//   picked). "Take Out" empties the picked slot.
//
// You can't put in more copies of an item than you own (RingItems.fitLoadout).
//
// Batch 3: with 5 or more of the shown item in the bag, Merge turns 5 into
// 1 of the next rarity (always works); Merge All does every 5 at once. The
// Shop button opens the Shop's Ring tab (items, Mystery Box, more slots).
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { ICONS, parseKey, itemStats, owned, ownedList, loadBag, saveLoadout, fitLoadout, rarityColor, rarityNameKey, mergesAvailable, mergeItem, nextRarity, MERGE_N, MAX_SLOTS } from './RingItems.js'
import { itemLabel } from './SpinRing.js'
import { getKeyFor, keyLabel } from './Keybinds.js'
import { ringCode, readRingCode, copyText } from './ShareCodes.js'

// Numbers shown for an item, as i18n keys with their value.
function statLines(st) {
  const out = []
  if (st.damage) out.push(t('ringStatDamage', { n: st.damage }))
  if (st.heal) out.push(t('ringStatHeal', { n: st.heal }))
  if (st.guard) out.push(t('ringStatGuard', { n: st.guard }))
  if (st.slow) out.push(t('ringStatSlow', { n: st.slow }))
  if (st.zap) out.push(t('ringStatZap', { n: st.zap }))
  if (st.blast) out.push(t('ringStatBlast', { n: st.blast }))
  if (st.pull) out.push(t('ringStatPull', { n: st.pull }))
  if (st.thorns) out.push(t('ringStatThorns', { n: st.thorns }))
  if (st.reload) out.push(t('ringStatReload', { n: st.reload }))
  if (st.bite) out.push(t('ringStatBite', { n: st.bite }))
  return out
}

export class RingEditor {
  constructor(survival) {
    this.s = survival
    this.isOpen = false
    this.pick = 0
    this.shown = ''
  }

  get bm() {
    return this.s.bm
  }

  toggle() {
    if (this.isOpen) this.close()
    else this.open()
  }

  open() {
    const s = this.s
    if (!s.active || s.dead || !s.ring) return
    this._ensureDom()
    this.isOpen = true
    this.bm._keys?.clear()
    this.bm._fireHeld = false
    if (document.pointerLockElement) document.exitPointerLock()
    // Start on the first empty slot, else the first one.
    const empty = s.ring.keys.indexOf('')
    this.pick = empty >= 0 ? empty : 0
    this.shown = s.ring.keys[this.pick] || ''
    this.el.style.display = 'flex'
    this.render()
    s.ringTutorial?.did('bag')
    try { audioEngine.playUi?.('open') } catch { /* no audio */ }
  }

  close(relock = true) {
    if (!this.isOpen) return
    this.isOpen = false
    this.el.style.display = 'none'
    try { audioEngine.playUi?.('close') } catch { /* no audio */ }
    if (relock && !this.bm.touch?.enabled && !this.bm.menuOpen) {
      try { this.bm.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available */ }
    }
  }

  // A new item reached the bag while the editor is open.
  refresh() {
    if (this.isOpen) this.render()
  }

  // Every frame (BuildSurvival.update): closes itself when the game ends.
  update() {
    if (this.isOpen && (!this.s.active || this.s.dead || !this.s.ring)) this.close(false)
  }

  _ensureDom() {
    this.el = document.getElementById('play-ring-editor')
    if (!this.el) {
      this.el = document.createElement('div')
      this.el.id = 'play-ring-editor'
      this.el.style.display = 'none'
      // GayZ panel style: a red X in the corner; a click outside the box
      // closes it too.
      this.el.innerHTML = `<div class="build-share-box" role="dialog" aria-modal="true" aria-labelledby="ring-ed-title">
        <button type="button" class="panel-close-btn" data-ring="close">&times;</button>
        <h2 id="ring-ed-title"></h2>
        <p class="ring-ed-hint"></p>
        <div class="ring-ed-slots"></div>
        <div class="ring-ed-info"></div>
        <div class="ring-ed-merge"></div>
        <h3 class="ring-ed-bag-title"></h3>
        <div class="ring-ed-bag"></div>
        <button type="button" class="ring-ed-shop" data-ring="shop"></button>
        <div class="share-code-box ring-ed-share">
          <h3 class="ring-ed-share-title"></h3>
          <div class="share-code-row">
            <input type="text" class="nickname-input share-code-input" maxlength="400" autocomplete="off" spellcheck="false" />
            <button type="button" class="mini-action-btn" data-ring="code-use"></button>
            <button type="button" class="mini-action-btn" data-ring="code-copy"></button>
          </div>
          <p class="share-code-status" aria-live="polite"></p>
        </div>
      </div>`
      document.body.appendChild(this.el)
    }
    this.el.onclick = (e) => {
      if (!e.target.closest('.build-share-box')) return this.close()
      const btn = e.target.closest('[data-ring]')
      if (!btn) return
      const act = btn.dataset.ring
      if (act === 'close') this.close()
      else if (act === 'slot') this.pickSlot(Number(btn.dataset.i))
      else if (act === 'bag') this.putIn(btn.dataset.key)
      else if (act === 'out') this.takeOut()
      else if (act === 'merge') this.merge(btn.dataset.all === '1' ? Infinity : 1)
      else if (act === 'code-copy') this.copyCode()
      else if (act === 'code-use') this.useCode()
      else if (act === 'shop') {
        this.close(false)
        this.s.shop?.openPanel('', 'ring')
      }
    }
    // Clicks and taps here never reach the game behind it.
    for (const ev of ['pointerdown', 'mousedown', 'touchstart', 'wheel']) this.el.addEventListener(ev, (e) => e.stopPropagation())
    // Typing a code never moves you or closes the window.
    const input = this.el.querySelector('.share-code-input')
    if (input && !input._bound) {
      input._bound = true
      for (const ev of ['keydown', 'keyup']) input.addEventListener(ev, (e) => {
        e.stopPropagation()
        if (ev === 'keydown' && e.key === 'Enter') this.useCode()
        if (ev === 'keydown' && e.key === 'Escape') this.close()
      })
    }
  }

  pickSlot(i) {
    this.pick = Math.max(0, Math.min(this.s.ring.keys.length - 1, i))
    this.shown = this.s.ring.keys[this.pick] || this.shown
    try { audioEngine.playUi?.('tab') } catch { /* no audio */ }
    this.render()
  }

  // A bag item into the picked slot. Full on copies? It swaps with the slot
  // that already holds one of them.
  putIn(key) {
    const ring = this.s.ring
    if (!ring || !parseKey(key)) return
    this.shown = key
    const keys = ring.keys.slice()
    if (keys[this.pick] === key) return this.render()
    const using = keys.filter((k) => k === key).length
    if (using >= owned(key)) {
      // Every copy is already in the ring: move one over (swap places).
      const from = keys.indexOf(key)
      keys[from] = keys[this.pick]
    }
    keys[this.pick] = key
    this._apply(keys)
    // Then the next empty slot (else stay).
    const next = keys.indexOf('')
    if (next >= 0) this.pick = next
    this.render()
  }

  takeOut() {
    const keys = this.s.ring.keys.slice()
    if (!keys[this.pick]) return
    keys[this.pick] = ''
    this._apply(keys)
    this.render()
  }

  // Merge the shown item: 5 -> 1 of the next rarity (times = Infinity: all).
  merge(times) {
    const key = this.shown
    const res = mergeItem(key, times)
    if (!res.made) return
    // The new one is shown; the ring keeps only copies you still own.
    this.shown = res.key
    const ring = this.s.ring
    const fitted = fitLoadout(ring.keys)
    if (fitted.join() !== ring.keys.join()) {
      saveLoadout(fitted)
      ring.setLoadout(fitted)
    }
    this.s._message(t('ringMerged', { n: res.made, name: itemLabel(res.key) }), 2.5)
    try { audioEngine.playUi?.('unbox') } catch { /* no audio */ }
    this.render()
  }

  // Share codes (ShareCodes.js): copy my ring, or use a friend's.
  _codeSay(key, params) {
    const el = this.el?.querySelector('.share-code-status')
    if (el) el.textContent = t(key, params)
  }

  async copyCode() {
    const code = ringCode(this.s.ring.keys)
    const input = this.el.querySelector('.share-code-input')
    if (await copyText(code)) this._codeSay('shareCodeCopiedFriend')
    else {
      // No clipboard: the code goes in the box, picked, to copy by hand.
      input.value = code
      input.select()
      this._codeSay('shareCodeCopyByHand')
    }
  }

  useCode() {
    const input = this.el.querySelector('.share-code-input')
    const wanted = readRingCode(input.value)
    if (!wanted) return this._codeSay('shareCodeBad')
    // Only as many slots as I have; only items I own.
    const want = wanted.slice(0, this.s.ring.keys.length)
    while (want.length < this.s.ring.keys.length) want.push('')
    const fitted = fitLoadout(want)
    this._apply(fitted)
    const asked = want.filter(Boolean).length
    const got = fitted.filter(Boolean).length
    input.value = ''
    this._codeSay(got < asked ? 'shareCodeRingSome' : 'shareCodeRingAll', { n: got, of: asked })
    this.render()
  }

  _apply(keys) {
    const fitted = fitLoadout(keys)
    saveLoadout(fitted)
    this.s.ring.setLoadout(fitted)
    this.s.ringTutorial?.did('swap')
    try { audioEngine.playUi?.('confirm') } catch { /* no audio */ }
  }

  render() {
    if (!this.el) return
    const ring = this.s.ring
    if (!ring) return
    const bag = loadBag()
    const q = (sel) => this.el.querySelector(sel)
    q('#ring-ed-title').textContent = t('ringEditorTitle')
    q('.ring-ed-hint').textContent = this.bm.touch?.enabled ? t('ringEditorHintTouch') : t('ringEditorHint', { key: keyLabel(getKeyFor('ringBag')) })
    q('.panel-close-btn').setAttribute('aria-label', t('ringEditorClose'))
    q('.ring-ed-share-title').textContent = t('shareCodeRingTitle')
    q('.share-code-input').placeholder = t('shareCodePaste')
    q('.share-code-input').setAttribute('aria-label', t('shareCodePaste'))
    q('[data-ring="code-use"]').textContent = t('shareCodeUse')
    q('[data-ring="code-copy"]').textContent = t('shareCodeCopy')
    // The ring's slots.
    const slots = q('.ring-ed-slots')
    slots.textContent = ''
    for (let i = 0; i < ring.keys.length; i++) {
      const key = ring.keys[i]
      const p = parseKey(key)
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'ring-ed-slot' + (i === this.pick ? ' picked' : '')
      b.dataset.ring = 'slot'
      b.dataset.i = String(i)
      b.setAttribute('aria-pressed', i === this.pick ? 'true' : 'false')
      if (p) {
        b.innerHTML = ICONS[p.id] || ''
        b.style.borderColor = rarityColor(p.rarity)
        b.setAttribute('aria-label', t('ringEditorSlot', { n: i + 1, name: itemLabel(key) }))
      } else b.setAttribute('aria-label', t('ringEditorSlotEmpty', { n: i + 1 }))
      slots.appendChild(b)
    }
    const out = document.createElement('button')
    out.type = 'button'
    out.className = 'ring-ed-out'
    out.dataset.ring = 'out'
    out.disabled = !ring.keys[this.pick]
    out.textContent = t('ringEditorTakeOut')
    slots.appendChild(out)
    // What the last tapped item does.
    const info = q('.ring-ed-info')
    info.textContent = ''
    const sp = parseKey(this.shown)
    if (sp) {
      const st = itemStats(sp.id, sp.rarity)
      const name = document.createElement('b')
      name.textContent = t(st.nameKey)
      const rar = document.createElement('span')
      rar.className = 'ring-ed-rarity'
      rar.style.color = rarityColor(sp.rarity)
      rar.textContent = t(rarityNameKey(sp.rarity))
      const about = document.createElement('span')
      about.textContent = t(st.aboutKey)
      const nums = document.createElement('span')
      nums.className = 'ring-ed-nums'
      nums.textContent = statLines(st).join(' · ')
      const head = document.createElement('div')
      head.append(name, ' ', rar)
      info.append(head, about, nums)
    } else info.textContent = t('ringEditorPickInfo')
    // Merge (Batch 3).
    const merge = q('.ring-ed-merge')
    merge.textContent = ''
    if (sp) {
      const up = nextRarity(sp.rarity)
      const can = mergesAvailable(this.shown, bag)
      const note = document.createElement('span')
      note.className = 'ring-ed-merge-note'
      if (!up) note.textContent = t('ringMergeTop')
      else if (!can) note.textContent = t('ringMergeNeed', { n: MERGE_N, have: bag[this.shown] || 0 })
      if (note.textContent) merge.appendChild(note)
      if (up && can) {
        const upName = itemLabel(`${sp.id}:${up}`)
        const one = document.createElement('button')
        one.type = 'button'
        one.dataset.ring = 'merge'
        one.textContent = t('ringMergeOne', { n: MERGE_N, name: upName })
        merge.appendChild(one)
        if (can > 1) {
          const all = document.createElement('button')
          all.type = 'button'
          all.dataset.ring = 'merge'
          all.dataset.all = '1'
          all.textContent = t('ringMergeAll', { n: can })
          merge.appendChild(all)
        }
      }
    }
    const shop = q('.ring-ed-shop')
    shop.textContent = t('ringEditorShop', { n: ring.keys.length, max: MAX_SLOTS })
    shop.hidden = !this.s.shop
    // The bag.
    q('.ring-ed-bag-title').textContent = t('ringEditorBag')
    const grid = q('.ring-ed-bag')
    grid.textContent = ''
    for (const key of ownedList(bag)) {
      const p = parseKey(key)
      const n = owned(key, bag)
      const inRing = ring.keys.filter((k) => k === key).length
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'ring-ed-item' + (key === this.shown ? ' shown' : '') + (inRing ? ' in-ring' : '')
      b.dataset.ring = 'bag'
      b.dataset.key = key
      b.style.borderColor = rarityColor(p.rarity)
      b.innerHTML = ICONS[p.id] || ''
      const c = document.createElement('span')
      c.className = 'ring-ed-count'
      c.textContent = `×${n}`
      b.appendChild(c)
      b.title = itemLabel(key)
      b.setAttribute('aria-label', `${itemLabel(key)}, ${t('ringEditorOwned', { n })}${inRing ? `, ${t('ringEditorInRing')}` : ''}`)
      grid.appendChild(b)
    }
  }
}
