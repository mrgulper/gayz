// POST { sessionId, playerId, x, y, z, rotY, currentWeapon, isFiring,
//        zombies?, hits? }
//   -> { states, zombies, pendingHits }
// Merges what used to be two separate calls (updatePlayerState +
// subscribeToPlayerStates) into one round trip: write your own state,
// read everyone else's, in the same request. There's no live push
// connection any more (that's what made this whole feature reachable by
// ad blockers) - the client just calls this a few times a second and
// gets a fresh answer every time (polling).
//
// Phase 3 (docs/superpowers/specs/2026-08-24-multiplayer-phase3-shared-zombies-design.md)
// adds zombie state to this same call rather than a new endpoint: the
// host includes its current zombie snapshot (zombies), and a guest
// includes any shots it resolved locally since its last sync (hits) - a
// guest's own game trusts its own hit-detection instead of the host
// re-validating every shot, a deliberate simplicity choice documented in
// that spec. The server decides who's the host from the session's own
// stored `host` field, never from a client claim, so a guest can't just
// send a zombies snapshot and have it accepted.
import { getAdminDb } from '../_lib/firebaseAdmin.js'

// A player who hasn't sent an update in this long is treated as gone -
// the fallback for a crash/dropped connection that never got to send an
// explicit "leave" call. Deliberately short (see this project's spec,
// "Disconnect Handling") since a normal quit uses navigator.sendBeacon
// via the leave endpoint instead and doesn't rely on this timeout at all.
const STALE_MS = 2500
// World events (Phase 3c: docs/superpowers/specs/2026-08-25-multiplayer-phase3c-remaining-zombies-design.md) -
// broadcast (not delivered-and-cleared like pendingHits, since every
// player needs to see the same ones, not just one recipient) but still
// need pruning eventually so the stored list doesn't grow forever over a
// long session. 15s is comfortably longer than any real sync interval, so
// an actively-polling client will always see an event at least once
// before it's pruned.
const WORLD_EVENT_TTL_MS = 15000

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { sessionId, playerId, x, y, z, rotY, currentWeapon, isFiring, zombies, hits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions, killEvents, xpGems } = req.body || {}
  if (!sessionId || !playerId) {
    return res.status(400).json({ error: 'sessionId and playerId are required' })
  }

  const db = getAdminDb()
  const sessionRef = db.ref(`multiplayerSessions/${sessionId}`)
  const now = Date.now()

  await sessionRef.child(`playerState/${playerId}`).set({
    x, y, z, rotY, currentWeapon, isFiring, updatedAt: now,
  })

  const hostSnapshot = await sessionRef.child('host').once('value')
  const isHost = hostSnapshot.val() === playerId

  if (isHost && Array.isArray(zombies)) {
    const zombiesById = {}
    for (const zb of zombies) {
      // Firebase RTDB gotcha: an object whose keys are ALL small sequential
      // numeric strings ("0", "1", "2"...) gets silently stored/returned as
      // a JSON ARRAY instead of a real object - and any gap in that
      // sequence (a zombie id that never became a shared type, which is
      // most of them in real play) comes back as a literal `null` entry,
      // which then throws the instant client code reads `.type` off it.
      // Zombie ids are a plain incrementing counter (Zombie.js's
      // zombieIdCounter), so this gap is the normal case, not an edge
      // case - prefixing the key with a letter keeps this a real object no
      // matter how sparse the id range is. See Game.js's
      // _renderSharedZombies for the matching read-side fix.
      zombiesById['z' + zb.id] = {
        x: zb.x, z: zb.z, rotY: zb.rotY, health: zb.health,
        maxHealth: zb.maxHealth, state: zb.state, type: zb.type,
        // Phase 3b (docs/superpowers/specs/2026-08-24-multiplayer-phase3b-groupa-zombies-design.md) -
        // drives a guest-side cosmetic throat-glow pulse for the screamer
        // type only; harmless/ignored for every other type.
        screaming: !!zb.screaming, updatedAt: now,
      }
    }
    await sessionRef.child('world/zombies').set(zombiesById)
  }

  if (isHost && Array.isArray(pickups)) {
    const pickupsById = {}
    for (const p of pickups) {
      // Same Firebase RTDB sparse-array precaution as world/zombies -
      // pickup ids are also a plain incrementing counter, so this is
      // exactly as likely to have gaps.
      pickupsById['p' + p.id] = { type: p.type, x: p.x, z: p.z }
    }
    await sessionRef.child('world/pickups').set(pickupsById)
  }

  if (isHost && Array.isArray(xpGems)) {
    const gemsById = {}
    for (const g of xpGems) {
      // Same sparse-array precaution as pickups above - gem ids are also
      // a plain incrementing counter.
      gemsById['g' + g.id] = { value: g.value, x: g.x, z: g.z }
    }
    await sessionRef.child('world/xpGems').set(gemsById)
  }

  if (isHost && Array.isArray(chests)) {
    // A plain array is safe here (no sparse-gap risk) - chest count and
    // order are fixed for the whole session, every index is always
    // present, never a candidate for Firebase's array-coercion gotcha.
    await sessionRef.child('world/chests').set(chests)
  }

  if (isHost && typeof vaultOpened === 'boolean') {
    await sessionRef.child('world/vaultOpened').set(vaultOpened)
  }

  if (isHost && Array.isArray(windows)) {
    await sessionRef.child('world/windows').set(windows)
  }

  if (isHost && Array.isArray(worldEvents) && worldEvents.length) {
    const updates = {}
    for (const ev of worldEvents) {
      // ev.id already arrives prefixed ('x...' or 'h...' - see Game.js/
      // ZombieManager.js) - reusing it directly as the Firebase key avoids
      // the same sparse-array gotcha the zombie snapshot fix addressed,
      // and lets a client dedupe by simply remembering which ids it's
      // already replayed.
      updates[`world/events/${ev.id}`] = { type: ev.type, x: ev.x, z: ev.z, at: now }
    }
    await sessionRef.update(updates)
  }

  if (Array.isArray(remoteDamage) && remoteDamage.length) {
    // Keyed per target player (unlike pendingHits' single shared inbox) so
    // a damage report addressed to one player can never be delivered to a
    // different one - see the per-caller drain below.
    const updates = {}
    for (const entry of remoteDamage) {
      const key = sessionRef.child(`world/remoteDamage/${entry.playerId}`).push().key
      updates[`world/remoteDamage/${entry.playerId}/${key}`] = {
        damage: entry.damage, kind: entry.kind, originX: entry.originX ?? null, originZ: entry.originZ ?? null,
      }
    }
    await sessionRef.update(updates)
  }

  if (isHost && Array.isArray(killEvents) && killEvents.length) {
    // Phase 5 multiplayer - a kill event or a Last Stand revival, both
    // addressed to a specific credited/downed player. Same per-recipient
    // shape as remoteDamage above, for the exact same reason (only that
    // one player should ever receive it).
    const updates = {}
    for (const entry of killEvents) {
      const key = sessionRef.child(`world/killEvents/${entry.playerId}`).push().key
      updates[`world/killEvents/${entry.playerId}/${key}`] = entry.payload
    }
    await sessionRef.update(updates)
  }

  if (!isHost && Array.isArray(interactions) && interactions.length) {
    // Same shared-inbox-the-host-drains shape as pendingHits below - a
    // guest's own interactions never need delivering back to a specific
    // player (only the host ever needs to know "apply this to my real
    // managers"), so one unkeyed list is enough, unlike remoteDamage which
    // needed per-player delivery. fromPlayerId (Phase 5) lets a handler
    // that DOES need to know who sent it (becameDowned) find out, while
    // every existing kind that doesn't need it just ignores the extra field.
    const updates = {}
    for (const interaction of interactions) {
      const key = sessionRef.child('world/pendingInteractions').push().key
      updates[`world/pendingInteractions/${key}`] = { ...interaction, fromPlayerId: playerId }
    }
    await sessionRef.update(updates)
  }

  if (!isHost && Array.isArray(hits) && hits.length) {
    // Guests append to a shared inbox the host drains on its own next
    // sync call below - never applied here server-side. The host's own
    // game is what actually calls the zombie's real damage method, this
    // endpoint just relays the report.
    const updates = {}
    for (const hit of hits) {
      const key = sessionRef.child('world/pendingHits').push().key
      updates[`world/pendingHits/${key}`] = {
        zombieId: hit.zombieId, damage: hit.damage, bypassShield: !!hit.bypassShield, fromPlayerId: playerId,
      }
    }
    await sessionRef.update(updates)
  }

  let pendingHits = []
  if (isHost) {
    // Deliver-and-clear: not clearing would re-deliver the same hits
    // again on the host's next sync, double-applying the damage.
    const pendingSnapshot = await sessionRef.child('world/pendingHits').once('value')
    const pending = pendingSnapshot.val() || {}
    pendingHits = Object.values(pending)
    if (pendingHits.length) await sessionRef.child('world/pendingHits').remove()
  }

  let pendingInteractions = []
  if (isHost) {
    const pendingInteractionsSnapshot = await sessionRef.child('world/pendingInteractions').once('value')
    const pendingInteractionsVal = pendingInteractionsSnapshot.val() || {}
    pendingInteractions = Object.values(pendingInteractionsVal)
    if (pendingInteractions.length) await sessionRef.child('world/pendingInteractions').remove()
  }

  // Any player (host or guest) can be on the receiving end of a remote
  // damage report - a guest gets hit by a zombie that picked it as the
  // nearest target, delivered here under its own playerId. Same
  // deliver-and-clear reasoning as pendingHits above.
  const myRemoteDamageSnapshot = await sessionRef.child(`world/remoteDamage/${playerId}`).once('value')
  const myRemoteDamage = myRemoteDamageSnapshot.val() || {}
  const remoteDamageOut = Object.values(myRemoteDamage)
  if (remoteDamageOut.length) await sessionRef.child(`world/remoteDamage/${playerId}`).remove()

  const myKillEventsSnapshot = await sessionRef.child(`world/killEvents/${playerId}`).once('value')
  const myKillEvents = myKillEventsSnapshot.val() || {}
  const killEventsOut = Object.values(myKillEvents)
  if (killEventsOut.length) await sessionRef.child(`world/killEvents/${playerId}`).remove()

  const [stateSnapshot, playersSnapshot, zombiesSnapshot, eventsSnapshot, pickupsSnapshot, chestsSnapshot, vaultOpenedSnapshot, windowsSnapshot, xpGemsSnapshot] = await Promise.all([
    sessionRef.child('playerState').once('value'),
    sessionRef.child('players').once('value'),
    sessionRef.child('world/zombies').once('value'),
    sessionRef.child('world/events').once('value'),
    sessionRef.child('world/pickups').once('value'),
    sessionRef.child('world/chests').once('value'),
    sessionRef.child('world/vaultOpened').once('value'),
    sessionRef.child('world/windows').once('value'),
    sessionRef.child('world/xpGems').once('value'),
  ])
  const allStates = stateSnapshot.val() || {}
  const allPlayers = playersSnapshot.val() || {}
  const states = {}
  for (const [otherId, state] of Object.entries(allStates)) {
    if (otherId === playerId) continue
    if (now - state.updatedAt > STALE_MS) continue
    // Phase 5 multiplayer - the host uses this for the anti-abuse guard
    // (a player who joined less than 30s ago has their kill credit fall
    // back to the host instead of themselves). allPlayers already has
    // this - api/multiplayer/join.js and create.js both record it at
    // join/create time - this is the first read of it.
    states[otherId] = { ...state, nickname: allPlayers[otherId]?.nickname || 'Player', joinedAt: allPlayers[otherId]?.joinedAt || 0 }
  }

  const allEvents = eventsSnapshot.val() || {}
  const worldEventsOut = []
  const staleEventUpdates = {}
  for (const [key, ev] of Object.entries(allEvents)) {
    if (!ev) continue
    if (now - ev.at > WORLD_EVENT_TTL_MS) {
      staleEventUpdates[`world/events/${key}`] = null
      continue
    }
    worldEventsOut.push({ id: key, type: ev.type, x: ev.x, z: ev.z })
  }
  if (Object.keys(staleEventUpdates).length) await sessionRef.update(staleEventUpdates)

  res.status(200).json({
    states, zombies: zombiesSnapshot.val() || {}, pendingHits, worldEvents: worldEventsOut, remoteDamage: remoteDamageOut,
    pickups: pickupsSnapshot.val() || {}, chests: chestsSnapshot.val() || [], vaultOpened: vaultOpenedSnapshot.val() || false,
    windows: windowsSnapshot.val() || [], interactions: pendingInteractions, killEvents: killEventsOut,
    xpGems: xpGemsSnapshot.val() || {},
  })
}
