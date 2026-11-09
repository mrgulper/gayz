// Fast travel (2026-11-09, Gaymi's world-map list 2: "tap a spot you've
// already cleared on the globe to fly there, for coins or with a wait
// between trips" - Gaymi picked both: coins that grow with the distance,
// plus a short wait between trips).
//
// World Map mode only. On the flat big map a pin's menu (MapPins.js) has
// a "Fly here" button; on the globe a tap opens a small "Fly to <place>?"
// box (BuildTryMode._tapGlobe). Only spots you've cleared of fog
// (ExploredMap.seenAt) and on land; not while dead, spectating or riding.
import { t } from './i18n.js'
import { explored, countryAtBlock } from './ExploredMap.js'
import { journal } from './TravelJournal.js'
import { sampleLand } from './OpenWorld.js'
import { HEAVEN_FLOOR } from './HeavenRealm.js'

export const TRAVEL_BASE = 5
export const TRAVEL_PER_BLOCKS = 250
export const TRAVEL_MOST = 60
export const TRAVEL_WAIT_S = 120
const LOWEST = -80
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function travelCost(dist) {
  return Math.min(TRAVEL_MOST, TRAVEL_BASE + Math.floor(dist / TRAVEL_PER_BLOCKS))
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.ceil(s % 60) === 60 ? 0 : Math.ceil(s % 60)).padStart(2, '0')}`

// Can `survival` fly to (x, z) blocks right now? { ok, cost, why }.
export function travelInfo(survival, x, z) {
  const tm = survival.bm.tryMode
  const from = survival.bodyPos?.() || tm.pos
  const cost = travelCost(Math.hypot(x - from.x, z - from.z))
  if (!explored.seenAt(x, z)) return { ok: false, cost, why: t('travelUnexplored') }
  const land = sampleLand(Math.floor(x), Math.floor(z))
  if (land.h < land.w) return { ok: false, cost, why: t('travelSea') }
  const wait = ((survival._travelAt || -Infinity) + TRAVEL_WAIT_S * 1000 - performance.now()) / 1000
  if (wait > 0) return { ok: false, cost, why: t('travelWait', { t: clock(wait) }) }
  if (survival.coins < cost) return { ok: false, cost, why: t('travelNeedCoins', { n: cost }) }
  if (survival.dead || survival.spectating || survival._ride) return { ok: false, cost, why: '' }
  return { ok: true, cost, why: '' }
}

// The button (for the pin's menu and the globe's box); `key` changes when
// it needs drawing again.
export function travelButton(survival, x, z) {
  const info = travelInfo(survival, x, z)
  const label = info.ok ? t('travelFly', { n: info.cost }) : info.why || t('travelFly', { n: info.cost })
  return {
    key: `${info.ok}|${label}`,
    html: `<button type="button" class="map-travel" data-travel="1"${info.ok ? '' : ' disabled'}>${esc(label)}</button>`,
  }
}

// Off you go: true if you flew.
export function flyTo(survival, x, z) {
  const info = travelInfo(survival, x, z)
  if (!info.ok) {
    if (info.why) survival._message(info.why)
    return false
  }
  const bm = survival.bm
  const tm = bm.tryMode
  const cx = Math.floor(x)
  const cz = Math.floor(z)
  survival.kart?.leave()
  survival.vehicles?.leave(true)
  // Grows the land there right now (like a spawn), then stands you on top.
  bm.world.update([{ x: cx + 0.5, z: cz + 0.5 }])
  let top = null
  for (let y = HEAVEN_FLOOR - 1; y > LOWEST && top === null; y--) if (bm.getBlockAt(cx, y, cz)) top = y
  if (top === null) {
    survival._message(t('travelSea'))
    return false
  }
  survival.coins -= info.cost
  survival._travelAt = performance.now()
  tm.pos.set(cx + 0.5, top + 1, cz + 0.5)
  tm.vel?.set(0, 0, 0)
  journal.jumped()
  survival._message(t('travelDone', { place: countryAtBlock(cx, cz) || t('travelSomewhere') }), 3)
  survival._renderHud?.()
  return true
}
