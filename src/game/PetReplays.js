// Pet battle replays on the Pets tab (pet battles round 4, Batch J,
// 2026-11-24): the Replays button opens a list - the last battle (Watch,
// Save) and up to SAVED_MAX saved ones (Watch, Delete - a second tap
// deletes). Kept on this device only (ReplayStore.js); played by
// TeamBattle.playReplay.
import { loadReplays, saveReplay, deleteReplay, isSaved, SAVED_MAX } from './ReplayStore.js'
import { playReplay } from './TeamBattle.js'
import { saveSettings } from './Game.js'
import { t } from './i18n.js'

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function when(ms) {
  try {
    return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch {
    return ''
  }
}

function row(r, key, { last = false } = {}) {
  const result = r.won === true ? t('replayWon') : r.won === false ? t('replayLost') : ''
  const title = last ? t('replayLast') : when(r.t)
  const saved = last && isSaved(r)
  const btns = last
    ? `<button type="button" class="mini-action-btn" data-replay-watch="${key}">${esc(t('replayWatch'))}</button>
       <button type="button" class="mini-action-btn" data-replay-save ${saved ? 'disabled' : ''}>${esc(t(saved ? 'replaySaved' : 'replaySave'))}</button>`
    : `<button type="button" class="mini-action-btn" data-replay-watch="${key}">${esc(t('replayWatch'))}</button>
       <button type="button" class="mini-action-btn replay-del" data-replay-del="${r.t}">${esc(t('replayDelete'))}</button>`
  return `<div class="replay-row${r.won ? ' won' : ''}">
    <span class="replay-info"><b>${esc(title)}</b> <span>${esc(t('replayVs', { name: String(r.foe).slice(0, 40) }))}</span>${result ? ` <em>${esc(result)}</em>` : ''}</span>
    <span class="replay-btns">${btns}</span>
  </div>`
}

export function renderReplays() {
  const list = $('replays-list')
  if (!list || list.hidden) return
  const d = loadReplays()
  if (!d.last && !d.saved.length) {
    list.innerHTML = `<p class="team-snack-hint">${esc(t('replayNone'))}</p>`
    return
  }
  list.innerHTML = [
    d.last ? row(d.last, 'last', { last: true }) : '',
    d.saved.length ? `<p class="team-snack-hint replay-count">${esc(t('replaySavedCount', { n: d.saved.length, max: SAVED_MAX }))}</p>` : '',
    ...d.saved.map((r, i) => row(r, String(i))),
  ].join('')
}

export function bindReplays(game) {
  if (game._replaysBound) return
  game._replaysBound = true
  const btn = $('replays-btn')
  const list = $('replays-list')
  if (!btn || !list) return
  btn.textContent = t('replaysBtn')
  btn.addEventListener('click', () => {
    list.hidden = !list.hidden
    btn.classList.toggle('open', !list.hidden)
    renderReplays()
  })
  list.addEventListener('click', (e) => {
    const d = loadReplays()
    const watch = e.target.closest('[data-replay-watch]')
    if (watch) {
      const k = watch.dataset.replayWatch
      const rec = k === 'last' ? d.last : d.saved[Number(k)]
      if (!rec) return
      playReplay(rec, {
        view: game.settings?.battleView === '2d' ? '2d' : '3d',
        onView: (v) => {
          if (!game.settings) return
          game.settings.battleView = v
          saveSettings(game.settings)
          const sel = $('battle-view-select')
          if (sel) sel.value = v
        },
      })
      return
    }
    if (e.target.closest('[data-replay-save]')) {
      const res = saveReplay(d.last)
      if (res === 'full') game._showHomepageToast?.(t('replayFull'))
      else if (res === 'error') game._showHomepageToast?.(t('replayError'))
      renderReplays()
      return
    }
    const del = e.target.closest('[data-replay-del]')
    if (del) {
      // First tap asks, the second deletes.
      if (!del.classList.contains('sure')) {
        del.classList.add('sure')
        del.textContent = t('replayDeleteSure')
        return
      }
      deleteReplay(Number(del.dataset.replayDel))
      renderReplays()
    }
  })
}
