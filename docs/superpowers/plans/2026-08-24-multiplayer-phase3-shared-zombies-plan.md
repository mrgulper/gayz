# Multiplayer Phase 3: Shared Zombies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make plain melee zombies shared across a multiplayer session - the host's game keeps simulating them exactly as it does in solo play, and every other player renders and fights the same zombies instead of their own independent copies.

**Architecture:** The host's `ZombieManager` is unchanged (same spawning, same AI). The host now also broadcasts a snapshot of its zombies through the same `sync` endpoint that already carries player positions. Guests stop running their own zombie simulation entirely and instead render zombies purely from what the host broadcasts, reusing `Zombie.js`'s existing visual/model code but never its AI. A guest's own hit-detection stays local (so shots feel instant) but the actual damage is reported to the host to apply, not applied locally.

**Tech Stack:** Extends `api/multiplayer/sync.js` (Vercel serverless function, Firebase Admin SDK) and the existing `src/game/Multiplayer.js` client wrapper - no new endpoints, no new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-08-24-multiplayer-phase3-shared-zombies-design.md`

## Global Constraints

- Only plain melee zombie types are shared this phase (see Task 1 for the exact confirmed list) - ranged, explode/gas-on-death, burrow, shield, scream-summon types, and all three boss tiers (`colossus`, `titan`, `broodmother`) stay solo per player, unchanged from today.
- The server determines who is the host from the session's own stored `host` field, never from a client-supplied claim.
- A guest's self-reported hit is trusted as-is (no host-side re-validation) - a deliberate simplicity choice per the spec, consistent with this project's existing stance that real anti-cheat work is deferred to a later phase.
- Same verification method as every other phase in this project - no test suite exists, drive the real running game with two simultaneous Playwright browser contexts (see this project's own CLAUDE.md, "Playwright verification quirks").
- Every completed, working batch gets committed, pushed, and deployed to Vercel production without asking each time (this project's own standing rule).
- Gaymi (project owner, non-coder) gets exact click-by-click test steps per task batch.

---

## File Structure

- **Modify: `src/game/ZombieTypes.js`** - adds `SHARED_ZOMBIE_TYPE_IDS`, the confirmed set of type IDs shared this phase.
- **Modify: `api/multiplayer/sync.js`** - accepts a host's zombie snapshot and a guest's hit reports, returns the current zombie snapshot to everyone.
- **Modify: `src/game/Multiplayer.js`** - `syncPlayerState` passes through the new `zombies`/`hits` fields and returns `zombies`/`pendingHits`.
- **Modify: `src/game/Zombie.js`** - adds `isNetworkDriven` and `applyNetworkState(...)`, and an early-return branch in `onHit()` for network-driven instances.
- **Modify: `src/game/ZombieManager.js`** - adds a `sharedZombies` array and extends `hittableMeshes` to include it, so a guest's weapon can still raycast against shared zombies with zero changes to `WeaponSystem.js`.
- **Modify: `src/game/Game.js`** - tracks host/guest role, extends the existing network-sync throttle to carry zombie data both ways, adds `_renderSharedZombies(zombiesSnapshot)`, stops a guest's own `ZombieManager` from simulating, and cleans up on quit.

---

## Task 1: Confirm which zombie types are shared this phase

**Files:**
- Modify: `src/game/ZombieTypes.js`

**Interfaces:**
- Produces: `SHARED_ZOMBIE_TYPE_IDS` (a `Set<string>` of type IDs), imported by Task 4/5's code to decide whether to include a given zombie in the host's broadcast snapshot.

This task's classification was done directly against the real 28 entries in `ZOMBIE_TYPES` (not guessed), applying the spec's criteria (no ranged attack, no explosion/gas released on death, no burrow, no shield, not a boss tier):

- **Shared (11):** `feral_dog`, `feral_child`, `shambler`, `runner`, `brute`, `crawler`, `sewer_dweller`, `leaper`, `regenerator`, `bloodhound`, `vampire` - all melee-only with no death-triggered world effect. (`leaper`'s leap timing, `regenerator`'s self-heal, and `vampire`'s lifesteal are all host-side AI/health details that need no extra network fields - a guest just sees position and health change, same as any other type.)
- **Solo/unchanged (17):** `spitter`, `burrower`, `exploder`, `shielded`, `screamer`, `spitter_bomber`, `screamer_swarmer`, `colossus`, `fester`, `stalker`, `acid_trail`, `anchor`, `brittle`, `siren`, `webber`, `broodmother`, `titan`. (`fester`'s `gasOnDeath` and `brittle`'s `shatterOnMelee` both spawn a death-triggered hazard/explosion the same way `exploder` does, so they're grouped with it. `stalker`'s stealth-opacity effect is a rendering detail that would need its own per-viewer handling - deferred rather than half-implemented.)

- [ ] **Step 1: Add the constant**

In `src/game/ZombieTypes.js`, add this right after the `ZOMBIE_TYPES` export (before the `ZOMBIE_TYPE_ENTRIES` line):

```js
// Phase 3 of multiplayer (docs/superpowers/specs/2026-08-24-multiplayer-phase3-shared-zombies-design.md) -
// only these plain melee types are shared across a session; everything
// else (ranged attackers, anything that explodes/gasses on death,
// burrowers, the shielded type, scream-summoners, and every boss tier)
// stays an independent per-player fight for now. See that spec's
// "Scope for this phase" section for the reasoning behind each exclusion.
export const SHARED_ZOMBIE_TYPE_IDS = new Set([
  'feral_dog', 'feral_child', 'shambler', 'runner', 'brute',
  'crawler', 'sewer_dweller', 'leaper', 'regenerator', 'bloodhound', 'vampire',
])
```

- [ ] **Step 2: Build check**

Run: `npx vite build`
Expected: succeeds (this constant isn't consumed by anything yet).

- [ ] **Step 3: Commit**

```bash
git add src/game/ZombieTypes.js
git commit -m "Add SHARED_ZOMBIE_TYPE_IDS for multiplayer Phase 3"
```

**Gaymi's test for this batch:** none yet - nothing in the game changed behavior, this just names which zombies will be shared once the rest of this plan is built.

---

## Task 2: Extend the `sync` endpoint to carry zombie state

**Files:**
- Modify: `api/multiplayer/sync.js`

**Interfaces:**
- Consumes: nothing new from earlier tasks.
- Produces: `POST /api/multiplayer/sync` - request body gains two optional fields: `zombies: [{ id, x, z, rotY, health, maxHealth, state, type }, ...]` (only meaningful from the host) and `hits: [{ zombieId, damage, bypassShield }, ...]` (only meaningful from a guest). Response gains `zombies: { [zombieId]: {...} }` (everyone gets this) and `pendingHits: [{ zombieId, damage, bypassShield, fromPlayerId }, ...]` (only ever non-empty for the host - Task 5 consumes this to apply real damage).

- [ ] **Step 1: Replace the handler**

Replace all of `api/multiplayer/sync.js` with:

```js
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { sessionId, playerId, x, y, z, rotY, currentWeapon, isFiring, zombies, hits } = req.body || {}
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
      zombiesById[zb.id] = {
        x: zb.x, z: zb.z, rotY: zb.rotY, health: zb.health,
        maxHealth: zb.maxHealth, state: zb.state, type: zb.type, updatedAt: now,
      }
    }
    await sessionRef.child('world/zombies').set(zombiesById)
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

  const [stateSnapshot, playersSnapshot, zombiesSnapshot] = await Promise.all([
    sessionRef.child('playerState').once('value'),
    sessionRef.child('players').once('value'),
    sessionRef.child('world/zombies').once('value'),
  ])
  const allStates = stateSnapshot.val() || {}
  const allPlayers = playersSnapshot.val() || {}
  const states = {}
  for (const [otherId, state] of Object.entries(allStates)) {
    if (otherId === playerId) continue
    if (now - state.updatedAt > STALE_MS) continue
    states[otherId] = { ...state, nickname: allPlayers[otherId]?.nickname || 'Player' }
  }

  res.status(200).json({ states, zombies: zombiesSnapshot.val() || {}, pendingHits })
}
```

- [ ] **Step 2: Verify locally against a preview deployment**

Local `vercel dev` has an environment-specific issue in this project (it tries to invoke `yarn`, which isn't installed) - verification for every prior API task this session used a quick preview deployment instead. Deploy one:

```bash
npx vercel --yes
```

Note the preview URL it prints (e.g. `https://gayz-XXXXXXXXX-mrgulper.vercel.app`). Preview deployments are protected, so requests need a bypass token - get one the first time with:

```bash
npx vercel curl https://YOUR-PREVIEW-URL/api/multiplayer/create -X POST -H "Content-Type: application/json" -d '{"nickname":"Test"}'
```

The debug output includes a line like `x-vercel-protection-bypass: SOME_TOKEN` - reuse that token directly in the curl commands below instead of going through `vercel curl` again (much faster).

```bash
BASE="https://YOUR-PREVIEW-URL"
BYPASS="YOUR_TOKEN"

HOST=$(curl -s -X POST "$BASE/api/multiplayer/create" -H "x-vercel-protection-bypass: $BYPASS" -H "Content-Type: application/json" -d '{"nickname":"Host"}')
echo "create: $HOST"
SESSION_ID=$(echo "$HOST" | python3 -c "import sys,json; print(json.load(sys.stdin)['sessionId'])")
HOST_ID=$(echo "$HOST" | python3 -c "import sys,json; print(json.load(sys.stdin)['playerId'])")

GUEST=$(curl -s -X POST "$BASE/api/multiplayer/join" -H "x-vercel-protection-bypass: $BYPASS" -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION_ID\",\"nickname\":\"Guest\"}")
GUEST_ID=$(echo "$GUEST" | python3 -c "import sys,json; print(json.load(sys.stdin)['playerId'])")

echo "host sync sends a zombie snapshot:"
curl -s -X POST "$BASE/api/multiplayer/sync" -H "x-vercel-protection-bypass: $BYPASS" -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\",\"playerId\":\"$HOST_ID\",\"x\":0,\"y\":0,\"z\":0,\"rotY\":0,\"currentWeapon\":\"melee\",\"isFiring\":false,\"zombies\":[{\"id\":7,\"x\":5,\"z\":5,\"rotY\":0,\"health\":40,\"maxHealth\":60,\"state\":\"alive\",\"type\":\"shambler\"}]}"
echo ""

echo "guest sync should see that zombie:"
curl -s -X POST "$BASE/api/multiplayer/sync" -H "x-vercel-protection-bypass: $BYPASS" -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\",\"playerId\":\"$GUEST_ID\",\"x\":0,\"y\":0,\"z\":0,\"rotY\":0,\"currentWeapon\":\"melee\",\"isFiring\":false}"
echo ""

echo "guest reports a hit on zombie 7:"
curl -s -X POST "$BASE/api/multiplayer/sync" -H "x-vercel-protection-bypass: $BYPASS" -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\",\"playerId\":\"$GUEST_ID\",\"x\":0,\"y\":0,\"z\":0,\"rotY\":0,\"currentWeapon\":\"melee\",\"isFiring\":false,\"hits\":[{\"zombieId\":7,\"damage\":25,\"bypassShield\":false}]}"
echo ""

echo "host sync should receive that pending hit (and it should be gone if we ask again):"
curl -s -X POST "$BASE/api/multiplayer/sync" -H "x-vercel-protection-bypass: $BYPASS" -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\",\"playerId\":\"$HOST_ID\",\"x\":0,\"y\":0,\"z\":0,\"rotY\":0,\"currentWeapon\":\"melee\",\"isFiring\":false}"
echo ""
curl -s -X POST "$BASE/api/multiplayer/sync" -H "x-vercel-protection-bypass: $BYPASS" -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\",\"playerId\":\"$HOST_ID\",\"x\":0,\"y\":0,\"z\":0,\"rotY\":0,\"currentWeapon\":\"melee\",\"isFiring\":false}"
```

Expected: the guest's plain sync response includes the zombie the host sent (`"zombies":{"7":{...}}`). The FIRST host sync after the guest's hit returns `"pendingHits":[{"zombieId":7,"damage":25,...}]`; the SECOND host sync returns `"pendingHits":[]` (already delivered and cleared, not re-delivered).

- [ ] **Step 3: Commit**

```bash
git add api/multiplayer/sync.js
git commit -m "Extend sync endpoint to carry host zombie snapshots and guest hit reports"
```

**Gaymi's test for this batch:** none yet in the game itself - this is backend plumbing, verified via the curl commands above, same as every other API-only batch this session.

---

## Task 3: Wire the new fields through the client's Multiplayer module

**Files:**
- Modify: `src/game/Multiplayer.js`

**Interfaces:**
- Consumes: Task 2's extended `sync` endpoint.
- Produces: `syncPlayerState(sessionId, state)` → `Promise<{ states, zombies, pendingHits }>` (was `Promise<states>` before - Task 5's `_syncNetworkPlayerState` is the only caller and gets updated in that same task to match). `state` may now include `zombies` and/or `hits`.

- [ ] **Step 1: Update `syncPlayerState`**

Find in `src/game/Multiplayer.js`:

```js
export async function syncPlayerState(sessionId, state) {
  const playerId = _playerIdFor.get(sessionId)
  if (!playerId) throw new Error('Not in this session')
  const { states } = await _apiCall('sync', { sessionId, playerId, ...state })
  return states
}
```

Replace with:

```js
// state may include zombies (host's snapshot) and/or hits (a guest's
// self-reported shots) alongside the usual position fields - see
// docs/superpowers/specs/2026-08-24-multiplayer-phase3-shared-zombies-design.md.
// Returns the whole response now (states/zombies/pendingHits), not just
// states, since callers need all three.
export async function syncPlayerState(sessionId, state) {
  const playerId = _playerIdFor.get(sessionId)
  if (!playerId) throw new Error('Not in this session')
  const { states, zombies, pendingHits } = await _apiCall('sync', { sessionId, playerId, ...state })
  return { states, zombies: zombies || {}, pendingHits: pendingHits || [] }
}
```

- [ ] **Step 2: Build check**

Run: `npx vite build`
Expected: succeeds. (`Game.js`'s `_syncNetworkPlayerState` still destructures the OLD shape at this point - that's fixed in Task 5, not this one. If the build fails on that mismatch, that's expected and harmless; it's checked again after Task 5.)

- [ ] **Step 3: Commit**

```bash
git add src/game/Multiplayer.js
git commit -m "Return zombies and pendingHits from syncPlayerState"
```

**Gaymi's test for this batch:** none yet - `Game.js` doesn't use the new return shape correctly until Task 5.

---

## Task 4: Give Zombie.js a network-driven mode

**Files:**
- Modify: `src/game/Zombie.js`
- Modify: `src/game/ZombieManager.js`

**Interfaces:**
- Consumes: nothing new from earlier tasks.
- Produces: `new Zombie(x, z, typeConfig, isAmbush, isElite, night, healthMult, speedMult, isNetworkDriven)` - a 9th, optional constructor parameter (defaults `false`, so every existing call site is unaffected). `zombie.applyNetworkState(x, z, rotY, health, maxHealth, state)` - Task 5 calls this once per sync response, per shared zombie, instead of the AI `update()` method. `zombieManager.sharedZombies` - a plain array Task 5 pushes network-driven `Zombie` instances into and removes them from; `zombieManager.hittableMeshes` now includes these too, so `WeaponSystem.js` needs zero changes to raycast against them.

- [ ] **Step 1: Add the constructor flag**

Find in `src/game/Zombie.js`:

```js
  constructor(x, z, typeConfig, isAmbush = false, isElite = false, night = 1, healthMult = 1, speedMult = 1) {
    this.id = zombieIdCounter++
    this.type = typeConfig.id
    this.config = typeConfig
    this.isAmbush = isAmbush
    this.isElite = isElite
```

Replace with:

```js
  constructor(x, z, typeConfig, isAmbush = false, isElite = false, night = 1, healthMult = 1, speedMult = 1, isNetworkDriven = false) {
    this.id = zombieIdCounter++
    this.type = typeConfig.id
    this.config = typeConfig
    this.isAmbush = isAmbush
    this.isElite = isElite
    // Phase 3 multiplayer (see this class's applyNetworkState/onHit below,
    // and docs/superpowers/specs/2026-08-24-multiplayer-phase3-shared-zombies-design.md) -
    // true only for a guest's rendering of a zombie the HOST is actually
    // simulating. Everything else about construction (visuals, materials,
    // health bar) runs exactly the same either way; only update()
    // (never called for these) and onHit() (redirected below) differ.
    this.isNetworkDriven = isNetworkDriven
```

- [ ] **Step 2: Add the `onHit` early-return branch**

Find in `src/game/Zombie.js`:

```js
  onHit(damage, opts = {}) {
    if (this.state !== 'alive' && this.state !== 'popping') return
```

Replace with:

```js
  onHit(damage, opts = {}) {
    if (this.isNetworkDriven) {
      // Not authoritative - this instance is a guest's rendering of a
      // zombie the host is really simulating, so don't touch health
      // locally at all. Game.js sets _onNetworkHit right after
      // constructing one of these (see _renderSharedZombies) to queue
      // the hit for the next sync call instead.
      if (typeof this._onNetworkHit === 'function') this._onNetworkHit(damage, opts)
      return
    }
    if (this.state !== 'alive' && this.state !== 'popping') return
```

- [ ] **Step 3: Add `applyNetworkState`**

Add this method right after `onHit` finishes (search for the next method after `onHit`'s closing brace, or add it directly before the `dispose()` method):

```js
  // Drives this zombie purely from network state instead of the normal
  // AI update() loop - only ever called for isNetworkDriven instances
  // (a guest's rendering of a zombie the host is really simulating).
  // Never touches pathfinding/aggro/attack-decision code at all - just
  // position, health bar, and the same walk/idle/death animation clips
  // the AI-driven path already uses. Called once per sync response
  // (Game.js's _renderSharedZombies), not every render frame - same
  // precedent as MinecraftPlayerBody's remote-player rendering, which
  // updates on the same cadence.
  applyNetworkState(x, z, rotY, health, maxHealth, state) {
    const moved = Math.hypot(x - this.group.position.x, z - this.group.position.z)
    this.group.position.set(x, 0, z)
    this.group.rotation.y = rotY
    this.health = health
    this.maxHealth = maxHealth
    if (state !== this.state) {
      this.state = state
      if (state === 'dying' || state === 'dead') this._playGlbAction('death', false)
    }
    if (state === 'alive' || state === 'popping') {
      this._barSprite.visible = true
      this._redrawHealthBar()
      this._playGlbAction(moved > 0.01 ? 'walk' : 'idle', true)
    }
    const now = performance.now()
    const dt = Math.min(0.2, (now - (this._lastNetworkUpdateAt || now)) / 1000)
    this._lastNetworkUpdateAt = now
    if (this.mixer) this.mixer.update(dt)
  }
```

- [ ] **Step 4: Add `sharedZombies` to ZombieManager and extend `hittableMeshes`**

Find in `src/game/ZombieManager.js`:

```js
    this.zombies = []
    this.projectiles = []
```

Replace with:

```js
    this.zombies = []
    // Phase 3 multiplayer - a guest's network-driven Zombie instances
    // (see Zombie.js's isNetworkDriven), pushed/removed by Game.js's
    // _renderSharedZombies. Kept separate from this.zombies (the real
    // AI-simulated array) rather than mixed in, since nothing here ever
    // iterates or updates them - they're purely so WeaponSystem's
    // existing raycast (which reads hittableMeshes below) can still hit
    // them with zero changes to WeaponSystem.js itself.
    this.sharedZombies = []
    this.projectiles = []
```

Find:

```js
  get hittableMeshes() {
    return this.zombies
      .filter((z) => z.state === 'alive')
      .flatMap((z) => z.hittableMeshes)
  }
```

Replace with:

```js
  get hittableMeshes() {
    return this.zombies
      .filter((z) => z.state === 'alive')
      .flatMap((z) => z.hittableMeshes)
      .concat(
        this.sharedZombies
          .filter((z) => z.state === 'alive' || z.state === 'popping')
          .flatMap((z) => z.hittableMeshes)
      )
  }
```

- [ ] **Step 5: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/game/Zombie.js src/game/ZombieManager.js
git commit -m "Add a network-driven mode to Zombie.js for multiplayer Phase 3"
```

**Gaymi's test for this batch:** none yet - nothing calls any of this new code until Task 5.

---

## Task 5: Wire it all into Game.js

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `Multiplayer.syncPlayerState` (Task 3's new return shape), `SHARED_ZOMBIE_TYPE_IDS` (Task 1), `zombie.applyNetworkState` / `zombie.isNetworkDriven` / `zombieManager.sharedZombies` (Task 4).
- Produces: nothing new consumed by later tasks - this is the last code task, Task 6 is deploy + verification only.

- [ ] **Step 1: Track host/guest role and shared-zombie state**

Find in the constructor:

```js
    this._multiplayerSessionId = null
    this._multiplayerUid = null
```

Replace with:

```js
    this._multiplayerSessionId = null
    this._multiplayerUid = null
    this._multiplayerIsHost = false
    this._pendingZombieHits = [] // {zombieId, damage, bypassShield} queued locally, drained into the next sync call
    this._sharedZombieBodies = new Map() // zombieId -> Zombie (network-driven, guest side only)
```

- [ ] **Step 2: Set the host/guest flag on create and join**

Find in `_createMultiplayerSession`:

```js
    this._multiplayerSessionId = sessionId
    this._multiplayerUid = uid
    const link = `${window.location.origin}${window.location.pathname}?join=${sessionId}`
```

Replace with:

```js
    this._multiplayerSessionId = sessionId
    this._multiplayerUid = uid
    this._multiplayerIsHost = true
    const link = `${window.location.origin}${window.location.pathname}?join=${sessionId}`
```

Find in `_joinMultiplayerSession`:

```js
      this._multiplayerSessionId = sessionId
      this._multiplayerUid = uid
    } catch {
      this._showHomepageToast(t('multiplayerJoinFailed'))
```

Replace with:

```js
      this._multiplayerSessionId = sessionId
      this._multiplayerUid = uid
      this._multiplayerIsHost = false
    } catch {
      this._showHomepageToast(t('multiplayerJoinFailed'))
```

- [ ] **Step 3: Extend `_syncNetworkPlayerState` to carry zombie data both ways**

Find:

```js
  _syncNetworkPlayerState() {
    if (!this._multiplayerSessionId) return
    const feetX = this.camera.position.x
    const feetY = this.camera.position.y - this.player.eyeHeight
    const feetZ = this.camera.position.z
    const yaw = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ').y
    import('./Multiplayer.js').then((Multiplayer) => {
      Multiplayer.syncPlayerState(this._multiplayerSessionId, {
        x: feetX,
        y: feetY,
        z: feetZ,
        rotY: yaw,
        currentWeapon: this.weapons.current.id,
        isFiring: !!this.weapons.triggerDown,
      }).then((states) => {
        this._renderRemotePlayers(states)
      }).catch(() => {})
    })
  }
```

Replace with:

```js
  _syncNetworkPlayerState() {
    if (!this._multiplayerSessionId) return
    const feetX = this.camera.position.x
    const feetY = this.camera.position.y - this.player.eyeHeight
    const feetZ = this.camera.position.z
    const yaw = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ').y
    const payload = {
      x: feetX,
      y: feetY,
      z: feetZ,
      rotY: yaw,
      currentWeapon: this.weapons.current.id,
      isFiring: !!this.weapons.triggerDown,
    }
    if (this._multiplayerIsHost) {
      payload.zombies = this.zombies.zombies
        .filter((z) => SHARED_ZOMBIE_TYPE_IDS.has(z.type) && z.state !== 'dead')
        .map((z) => ({
          id: z.id, x: z.group.position.x, z: z.group.position.z, rotY: z.group.rotation.y,
          health: z.health, maxHealth: z.maxHealth, state: z.state, type: z.type,
        }))
    } else if (this._pendingZombieHits.length) {
      payload.hits = this._pendingZombieHits
      this._pendingZombieHits = []
    }
    import('./Multiplayer.js').then((Multiplayer) => {
      Multiplayer.syncPlayerState(this._multiplayerSessionId, payload).then(({ states, zombies, pendingHits }) => {
        this._renderRemotePlayers(states)
        if (this._multiplayerIsHost) {
          for (const hit of pendingHits) {
            const zombie = this.zombies.zombies.find((z) => z.id === hit.zombieId)
            if (zombie) zombie.onHit(hit.damage, { bypassShield: hit.bypassShield })
          }
        } else {
          this._renderSharedZombies(zombies)
        }
      }).catch(() => {})
    })
  }
```

- [ ] **Step 4: Add `_renderSharedZombies`**

Add this method right after `_renderRemotePlayers` finishes:

```js
  // Guest-side only - one network-driven Zombie per shared id, created
  // lazily the first time that id is seen and reused after that (never
  // recreated every update - would rebuild the whole model for no
  // reason). Mirrors _renderRemotePlayers' exact lazily-create/reuse/
  // remove-when-gone pattern. An id that stops appearing (killed, or
  // fell out of the host's shared-type list) gets removed from the
  // scene, disposed, and dropped from both this._sharedZombieBodies and
  // the manager's sharedZombies array (so WeaponSystem's raycast stops
  // considering it too).
  _renderSharedZombies(zombiesSnapshot) {
    const seenIds = new Set()
    for (const [idStr, state] of Object.entries(zombiesSnapshot)) {
      const id = Number(idStr)
      seenIds.add(id)
      let zombie = this._sharedZombieBodies.get(id)
      if (!zombie) {
        const typeConfig = ZOMBIE_TYPES[state.type]
        if (!typeConfig) continue
        zombie = new Zombie(state.x, state.z, typeConfig, false, false, 1, 1, 1, true)
        zombie.id = id
        zombie._onNetworkHit = (damage, opts) => {
          this._pendingZombieHits.push({ zombieId: id, damage, bypassShield: !!opts.bypassShield })
        }
        this._sharedZombieBodies.set(id, zombie)
        this.zombies.sharedZombies.push(zombie)
      }
      zombie.applyNetworkState(state.x, state.z, state.rotY, state.health, state.maxHealth, state.state)
    }
    for (const [id, zombie] of this._sharedZombieBodies) {
      if (seenIds.has(id)) continue
      zombie.group.parent?.remove(zombie.group)
      zombie.dispose()
      this._sharedZombieBodies.delete(id)
      const idx = this.zombies.sharedZombies.indexOf(zombie)
      if (idx !== -1) this.zombies.sharedZombies.splice(idx, 1)
    }
  }
```

- [ ] **Step 5: Add the imports this needs**

Find the existing imports near the top of `Game.js`:

```js
import { MinecraftPlayerBody } from './MinecraftPlayerBody.js'
```

Replace with:

```js
import { MinecraftPlayerBody } from './MinecraftPlayerBody.js'
import { Zombie } from './Zombie.js'
import { ZOMBIE_TYPES, SHARED_ZOMBIE_TYPE_IDS } from './ZombieTypes.js'
```

(If `Game.js` already imports `Zombie` or `ZOMBIE_TYPES`/`ZOMBIE_TYPE_IDS` from elsewhere in the file under different names, merge into that existing import line instead of adding a duplicate one - check for an existing `from './Zombie.js'` or `from './ZombieTypes.js'` line first.)

- [ ] **Step 6: Stop a guest from simulating its own zombies**

Find in `_tick()`:

```js
      this.zombies.update(
        dt,
        playerPos,
```

Replace with:

```js
      // A guest in a shared multiplayer session never runs the real
      // simulation - no spawning, no AI - it only renders whatever the
      // host broadcasts (see _renderSharedZombies). The host (or a solo
      // player with no session at all) keeps working exactly as before.
      if (!this._multiplayerSessionId || this._multiplayerIsHost) this.zombies.update(
        dt,
        playerPos,
```

Find the closing of that same call a few lines down:

```js
        this.player.isProne
      )
```

Replace with:

```js
        this.player.isProne
      )
```

(No change needed here - just confirming the closing parenthesis of the `if` statement lands correctly; the `if (...)` from Step 6's first replacement wraps the entire existing multi-line call, so this line stays exactly as it already is.)

- [ ] **Step 7: Clean up shared zombies on quit**

Find in `_quitRunWithLegacyPayout`:

```js
    for (const body of this._remotePlayerBodies.values()) {
      body.group.parent?.remove(body.group)
    }
    this._remotePlayerBodies.clear()
```

Replace with:

```js
    for (const body of this._remotePlayerBodies.values()) {
      body.group.parent?.remove(body.group)
    }
    this._remotePlayerBodies.clear()
    for (const zombie of this._sharedZombieBodies.values()) {
      zombie.group.parent?.remove(zombie.group)
      zombie.dispose()
    }
    this._sharedZombieBodies.clear()
    this.zombies.sharedZombies = []
    this._pendingZombieHits = []
```

- [ ] **Step 8: Build check**

Run: `npx vite build`
Expected: succeeds, no leftover references to the old `syncPlayerState` return shape (a bare `states` object) anywhere in `Game.js`.

- [ ] **Step 9: Commit**

```bash
git add src/game/Game.js
git commit -m "Wire shared zombies into Game.js (multiplayer Phase 3)"
```

**Gaymi's test for this batch:** none yet in the game itself - Task 6 is where this gets deployed and actually played.

---

## Task 6: Deploy and verify with two real players

**Files:**
- None (deploy + verification only).

**Interfaces:**
- Consumes: everything from Tasks 1-5.

- [ ] **Step 1: Deploy to production**

```bash
npx vercel --prod --yes
```

- [ ] **Step 2: Two-browser Playwright verification**

This project's own CLAUDE.md notes that a `SkinnedMesh` (which is what a zombie's GLB-rigged model is) needs at least one real `renderer.render(...)` call before raycasting against it will find anything, and that headless Playwright can't grant real Pointer Lock - both apply here the same way they applied to every earlier multiplayer verification this session.

```python
from playwright.sync_api import sync_playwright
import time

def poll(fn, expect_truthy=True, timeout=180, interval=1):
    deadline = time.time() + timeout
    result = None
    while time.time() < deadline:
        result = fn()
        if bool(result) == expect_truthy:
            return result
        time.sleep(interval)
    return result

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    host_page = browser.new_page()
    guest_page = browser.new_page()

    host_page.goto('https://gayz.vercel.app', timeout=60000)
    poll(lambda: host_page.evaluate("() => !!window.__game"), timeout=30)
    host_page.evaluate("() => { const l = document.getElementById('asset-loader'); if (l) l.style.display = 'none' }")

    session_id = host_page.evaluate("""async () => {
        window.__game.settings.nickname = 'ZombieHost'
        await window.__game._createMultiplayerSession()
        return window.__game._multiplayerSessionId
    }""")
    print("session:", session_id)

    guest_page.goto(f'https://gayz.vercel.app/?join={session_id}', timeout=60000)
    poll(lambda: guest_page.evaluate("() => !!window.__game"), timeout=30)
    guest_page.evaluate("() => { const l = document.getElementById('asset-loader'); if (l) l.style.display = 'none' }")
    guest_page.evaluate(f"""async () => {{
        window.__game.settings.nickname = 'ZombieGuest'
        await window.__game._joinMultiplayerSession('{session_id}')
    }}""")

    for pg in (host_page, guest_page):
        pg.evaluate("""() => {
            window.__game.gameStarted = true
            window.__game.player.controls.isLocked = true
            window.__game.playerState.alive = true
            window.__game.inventoryOpen = false
            window.__game.perkPanelOpen = false
            window.__game.traderPanelOpen = false
            window.__game.xpLevelupPanelOpen = false
            window.__game.mapOpen = false
            window.__game.journalOpen = false
            window.__game.driving = false
            window.__game.photoModeOpen = false
            window.__game.spectateOpen = false
        }""")

    # Force real spawns until a shared-type zombie shows up, rather than
    # waiting on normal spawn timing. Raw source imports (import('/src/...'))
    # don't work against a deployed production build - only hashed chunk
    # files exist there, a limitation hit earlier this session - so this
    # calls ZombieManager's own real _spawnRandom() method directly
    # instead (the exact method normal gameplay already calls internally
    # to spawn zombies one at a time), loops a bounded number of times,
    # and checks after each call.
    SHARED_TYPES = ['feral_dog', 'feral_child', 'shambler', 'runner', 'brute', 'crawler', 'sewer_dweller', 'leaper', 'regenerator', 'bloodhound', 'vampire']
    found = False
    for _ in range(30):
        host_page.evaluate("() => window.__game.zombies._spawnRandom()")
        found = host_page.evaluate(f"""() => window.__game.zombies.zombies.some((z) => {SHARED_TYPES}.includes(z.type))""")
        if found:
            break
    print("forced a shared-type zombie to spawn on the host:", found)

    guest_sees_zombie = poll(lambda: guest_page.evaluate(
        "() => window.__game._sharedZombieBodies.size"
    ) >= 1, timeout=180)
    print("guest sees a shared zombie:", guest_sees_zombie)

    # Guest reports a hit and confirms the host's real zombie loses health.
    zombie_id = guest_page.evaluate("() => [...window.__game._sharedZombieBodies.keys()][0]")
    guest_page.evaluate(f"""() => {{
        window.__game._pendingZombieHits.push({{ zombieId: {zombie_id}, damage: 25, bypassShield: false }})
    }}""")

    host_health_dropped = poll(lambda: host_page.evaluate(f"""() => {{
        const z = window.__game.zombies.zombies.find((zz) => zz.id === {zombie_id})
        return z ? z.health < z.maxHealth : false
    }}"""), timeout=180)
    print("host's real zombie took the guest's reported damage:", host_health_dropped)

    browser.close()
```

Expected: `forced a shared-type zombie to spawn on the host` is `True` (within 30 tries - shared types make up a solid share of the weighted spawn pool, see `ZombieTypes.js`'s `weight` values), and both later prints are `True` too.

- [ ] **Step 3: No commit needed** - this task deploys and verifies already-committed code from Tasks 1-5; nothing new to commit here.

**Gaymi's test for this batch - the real payoff, needs two windows/a friend again:**
1. Start a run, press Escape, click Invite Friend, click Start Playing.
2. Friend opens the link, clicks Join Game.
3. Walk around and find a zombie (a shambler, runner, feral dog/child, brute, crawler, sewer dweller, leaper, regenerator, bloodhound, or vampire - the "regular" types from Task 1's list). Point it out to your friend by describing where it is.
4. Your friend should see the exact same zombie in the exact same spot - not a second, separate one.
5. Shoot it a few times (whoever's the host or the guest, either direction). Both of you should see its health drop and it eventually die, at the same time.
6. Zombies your friend already killed shouldn't reappear on your screen, and vice versa.

**What's still normal, not a bug:** ranged zombies (spitters, screamers, sirens, webbers, anchors, etc.), anything that explodes or drops gas on death, burrowers, the shielded type, and all three bosses (Titan, Colossus, Broodmother) are still fought independently by each player - that's the deliberate scope for this phase, not something broken.

**Failure looks like:** your friend sees a completely different zombie in that spot (or none at all), your shots don't register on their screen's version of it, or a zombie one of you killed keeps reappearing.
