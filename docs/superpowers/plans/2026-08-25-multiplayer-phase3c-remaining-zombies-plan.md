# Multiplayer Phase 3c: Remaining Zombie Types + Bosses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Share the last 13 zombie types (5 ranged, 4 death/area-effect, screamer_swarmer, 3 bosses) across a multiplayer session, bringing shared coverage to all 28 types - requires teaching the host's zombie AI to pick between BOTH connected players as a target, relay damage/effects to whichever player was actually hit, and broadcast world-visible events (gas clouds, puddles, explosions) so a guest sees them too.

**Architecture:** Extends the existing host-authoritative model - the host's `ZombieManager` gains awareness of every other connected player's last-known position (already received via the existing player-sync data, just not stored/used for AI before now) and picks whichever is nearest as each zombie's real target, reusing a targeting-override pattern that already exists in this file for companions/decoys. A hit against a non-host player gets queued and relayed to that specific guest over the same sync endpoint (in the opposite direction from the existing guest-to-host hit reports), who applies it locally with its own existing damage code. World-visible events get a similar small broadcast list, deduplicated client-side by a per-source prefixed id.

**Tech Stack:** Vite/vanilla JS, Three.js, Vercel serverless functions (Firebase Admin SDK proxy), Playwright for verification.

**Spec:** `docs/superpowers/specs/2026-08-25-multiplayer-phase3c-remaining-zombies-design.md`

## Global Constraints

- Reward/kill-credit integrity stays out of scope, matching the master doc's deferred "Phase 5" - bosses inherit the same host-only-credits-rewards characteristic every already-shared type already has.
- No live mid-flight projectile position syncing - only the moment of impact/spawn broadcasts.
- Any new object keyed by an incrementing counter (zombie ids, world event ids) MUST use a non-numeric-prefixed string key when stored in Firebase - a bare numeric-looking key silently becomes a sparse array with `null` gaps, a real bug this exact session already hit and fixed once tonight (see `api/multiplayer/sync.js`'s existing `'z' + zb.id` pattern).
- Playwright verification must alternate touching both browser pages during any multi-second wait - leaving one page idle for many seconds lets Chromium throttle its background tab, which produced a false-negative test result earlier tonight (confirmed and fixed by touching both pages).

---

### Task 1: Track other connected players' positions and thread them into ZombieManager

**Files:**
- Modify: `src/game/Game.js` (`_renderRemotePlayers` at line 15548, `_tick()`'s call to `this.zombies.update(...)` at line 20985)
- Modify: `src/game/ZombieManager.js` (`update()`'s signature at line 1486)

**Interfaces:**
- Produces: `ZombieManager.update(...)` gains a new trailing parameter `otherPlayers = []` (array of `{playerId, x, z}`) - Task 2's targeting redirect and Task 3's projectile targeting both read this. `Game.js`'s `this._otherPlayerPositions` (array, same shape) - populated on every `_renderRemotePlayers` call, empty array by default.

- [ ] **Step 1: Store remote player positions for AI use, not just rendering**

Find in `Game.js`:

```js
  _renderRemotePlayers(states) {
    const seenIds = new Set()
    for (const [id, state] of Object.entries(states)) {
      seenIds.add(id)
      let body = this._remotePlayerBodies.get(id)
      if (!body) {
        body = new MinecraftPlayerBody(this.scene)
        this._remotePlayerBodies.set(id, body)
      }
      body.update(state.x, state.y, state.z, state.rotY, true)
      body.setNickname(state.nickname || 'Player')
    }
    for (const [id, body] of this._remotePlayerBodies) {
      if (seenIds.has(id)) continue
      body.group.parent?.remove(body.group)
      this._remotePlayerBodies.delete(id)
    }
  }
```

Replace with:

```js
  _renderRemotePlayers(states) {
    const seenIds = new Set()
    // Phase 3c (docs/superpowers/specs/2026-08-25-multiplayer-phase3c-remaining-zombies-design.md) -
    // rebuilt fresh every call, same as the rendering loop below - this is
    // what lets the host's zombie AI (see ZombieManager.update's new
    // otherPlayers param) know where every OTHER connected player actually
    // is, not just the host's own position.
    this._otherPlayerPositions = []
    for (const [id, state] of Object.entries(states)) {
      seenIds.add(id)
      let body = this._remotePlayerBodies.get(id)
      if (!body) {
        body = new MinecraftPlayerBody(this.scene)
        this._remotePlayerBodies.set(id, body)
      }
      body.update(state.x, state.y, state.z, state.rotY, true)
      body.setNickname(state.nickname || 'Player')
      this._otherPlayerPositions.push({ playerId: id, x: state.x, z: state.z })
    }
    for (const [id, body] of this._remotePlayerBodies) {
      if (seenIds.has(id)) continue
      body.group.parent?.remove(body.group)
      this._remotePlayerBodies.delete(id)
    }
  }
```

- [ ] **Step 2: Initialize the field so it's never undefined before the first sync**

Find in the constructor near the other multiplayer fields:

```js
    this._multiplayerIsHost = false
    this._pendingZombieHits = [] // {zombieId, damage, bypassShield} queued locally, drained into the next sync call
    this._sharedZombieBodies = new Map() // zombieId -> Zombie (network-driven, guest side only)
```

Replace with:

```js
    this._multiplayerIsHost = false
    this._pendingZombieHits = [] // {zombieId, damage, bypassShield} queued locally, drained into the next sync call
    this._sharedZombieBodies = new Map() // zombieId -> Zombie (network-driven, guest side only)
    this._otherPlayerPositions = [] // {playerId, x, z}[] - every OTHER connected player's last-known position, host-side AI targeting input (Phase 3c)
```

- [ ] **Step 3: Add the `otherPlayers` parameter to `ZombieManager.update()`**

Find:

```js
  update(dt, playerPos, onPlayerDamage, onZombieLoot, onAmbushTrigger, onZombieKilled, playerCrouching = false, isNight = false, onTrail = null, onPlayerPull = null, onPlayerDisorient = null, onWebLand = null, playerForwardX = null, playerForwardZ = null, barricadeWindows = null, companionTargets = null, playerProne = false) {
```

Replace with:

```js
  update(dt, playerPos, onPlayerDamage, onZombieLoot, onAmbushTrigger, onZombieKilled, playerCrouching = false, isNight = false, onTrail = null, onPlayerPull = null, onPlayerDisorient = null, onWebLand = null, playerForwardX = null, playerForwardZ = null, barricadeWindows = null, companionTargets = null, playerProne = false, otherPlayers = []) {
```

- [ ] **Step 4: Pass `this._otherPlayerPositions` at the real call site**

Find in `Game.js`'s `_tick()`:

```js
        this.barricadeWindows.windows,
        this._collectCompanionTargets(),
        this.player.isProne
      )
```

Replace with:

```js
        this.barricadeWindows.windows,
        this._collectCompanionTargets(),
        this.player.isProne,
        this._otherPlayerPositions
      )
```

- [ ] **Step 5: Build check**

Run: `npx vite build`
Expected: succeeds - this task only adds an always-empty-by-default parameter, so nothing behaves differently yet in solo play or existing multiplayer.

- [ ] **Step 6: Commit**

```bash
git add src/game/Game.js src/game/ZombieManager.js
git commit -m "Track other connected players' positions for host-side zombie AI (Phase 3c)"
```

---

### Task 2: Add the multi-player targeting redirect and remote damage queue

**Files:**
- Modify: `src/game/ZombieManager.js` (constructor near line 264, `update()`'s per-zombie loop near line 1607-1623)

**Interfaces:**
- Consumes: `otherPlayers` (Task 1).
- Produces: `ZombieManager.remoteDamageQueue` (array of `{playerId, damage, kind}`, `kind` one of `'damage'`, `'pull'` (also carries `originX`/`originZ`), `'disorient'`) - Task 3 also pushes into this for projectile-landed effects; Task 6's `_syncNetworkPlayerState` drains it into the outgoing sync payload.

- [ ] **Step 1: Add the queue field**

Find:

```js
    this.sharedZombies = []
    this.projectiles = []
```

Replace with:

```js
    this.sharedZombies = []
    // Phase 3c multiplayer (docs/superpowers/specs/2026-08-25-multiplayer-phase3c-remaining-zombies-design.md) -
    // a hit that lands on a NON-host player (see update()'s new targeting
    // redirect below) can't be applied locally - only that player's own
    // browser can touch its own health. Queued here instead, drained by
    // Game.js's _syncNetworkPlayerState into the next sync call, which
    // relays it to that specific player.
    this.remoteDamageQueue = []
    this.projectiles = []
```

- [ ] **Step 2: Add the targeting redirect, right after the existing boss-companion override**

Find:

```js
      // Boss occasionally targets the nearest companion instead of the
      // player - rolls fresh every frame (not a sticky decision), so a boss
      // naturally drifts back to the player once nothing companion-shaped
      // is closer/in range anymore.
      if (zombie.isBoss && zombie.state === 'alive' && companionTargets && companionTargets.length > 0) {
        const distToPlayer = Math.hypot(playerPos.x - zombie.group.position.x, playerPos.z - zombie.group.position.z)
        let nearestCompanion = null
        let nearestCompanionDist = Infinity
        for (const c of companionTargets) {
          const d = Math.hypot(c.x - zombie.group.position.x, c.z - zombie.group.position.z)
          if (d < nearestCompanionDist) {
            nearestCompanionDist = d
            nearestCompanion = c
          }
        }
        if (nearestCompanion && nearestCompanionDist < distToPlayer && nearestCompanionDist < BOSS_COMPANION_TARGET_RANGE) {
          targetPos = { x: nearestCompanion.x, y: playerPos.y, z: nearestCompanion.z }
          attackCb = (dmg) => nearestCompanion.takeDamage(dmg)
          spitCb = null
        }
      }
```

Replace with:

```js
      // Boss occasionally targets the nearest companion instead of the
      // player - rolls fresh every frame (not a sticky decision), so a boss
      // naturally drifts back to the player once nothing companion-shaped
      // is closer/in range anymore.
      if (zombie.isBoss && zombie.state === 'alive' && companionTargets && companionTargets.length > 0) {
        const distToPlayer = Math.hypot(playerPos.x - zombie.group.position.x, playerPos.z - zombie.group.position.z)
        let nearestCompanion = null
        let nearestCompanionDist = Infinity
        for (const c of companionTargets) {
          const d = Math.hypot(c.x - zombie.group.position.x, c.z - zombie.group.position.z)
          if (d < nearestCompanionDist) {
            nearestCompanionDist = d
            nearestCompanion = c
          }
        }
        if (nearestCompanion && nearestCompanionDist < distToPlayer && nearestCompanionDist < BOSS_COMPANION_TARGET_RANGE) {
          targetPos = { x: nearestCompanion.x, y: playerPos.y, z: nearestCompanion.z }
          attackCb = (dmg) => nearestCompanion.takeDamage(dmg)
          spitCb = null
        }
      }

      // Phase 3c multiplayer - picks whichever REAL connected player (the
      // host's own position, or any guest's last-known synced position) is
      // actually nearest to this zombie, so it doesn't keep chasing the
      // host's stale position while a guest stands right next to it.
      // otherPlayers is always [] in solo play, so nothing here ever
      // changes solo behavior. Only applies if nothing above already
      // redirected this zombie away from a real player entirely (still
      // pointing at the exact original playerPos reference) - runs before
      // barricade-pull/flanking below, both of which only make sense once
      // a real player target is already chosen.
      let targetPlayerId = null
      if (zombie.state === 'alive' && targetPos === playerPos && otherPlayers && otherPlayers.length > 0) {
        const distToLocal = Math.hypot(playerPos.x - zombie.group.position.x, playerPos.z - zombie.group.position.z)
        let nearestOther = null
        let nearestOtherDist = distToLocal
        for (const p of otherPlayers) {
          const d = Math.hypot(p.x - zombie.group.position.x, p.z - zombie.group.position.z)
          if (d < nearestOtherDist) {
            nearestOtherDist = d
            nearestOther = p
          }
        }
        if (nearestOther) {
          targetPos = { x: nearestOther.x, y: playerPos.y, z: nearestOther.z }
          targetPlayerId = nearestOther.playerId
          attackCb = (dmg) => this.remoteDamageQueue.push({ playerId: nearestOther.playerId, damage: dmg, kind: 'damage' })
        }
      }
```

- [ ] **Step 3: Pass `targetPlayerId` into `_spawnProjectile` so Task 3 can use it**

Find:

```js
      let spitCb = (origin, target, damage, speed) => this._spawnProjectile(origin, target, damage, speed, spitEffect)
```

Replace with:

```js
      let spitCb = (origin, target, damage, speed) => this._spawnProjectile(origin, target, damage, speed, spitEffect, targetPlayerId)
```

(`targetPlayerId` is declared above this line after Step 2's edit, so it's in scope here - if applying these edits out of order, make sure Step 2 lands first.)

- [ ] **Step 4: Build check**

Run: `npx vite build`
Expected: succeeds. `_spawnProjectile` doesn't have a 6th parameter yet - that's fine in JS (extra arguments are silently ignored until Task 3 adds the parameter), so this doesn't break anything yet.

- [ ] **Step 5: Commit**

```bash
git add src/game/ZombieManager.js
git commit -m "Add multi-player targeting redirect and remote damage queue (Phase 3c)"
```

---

### Task 3: Make projectiles remember and check against their real target player

**Files:**
- Modify: `src/game/ZombieManager.js` (`_spawnProjectile` at line 918, `_updateProjectiles` at line 1462, its one call site at line 1758)

**Interfaces:**
- Consumes: `targetPlayerId` (Task 2, passed as `_spawnProjectile`'s new 6th argument), `otherPlayers` (Task 1).
- Produces: `remoteDamageQueue` entries with `kind: 'pull'` (also carrying `originX`/`originZ`) and `kind: 'disorient'`, alongside Task 2's `kind: 'damage'` entries.

- [ ] **Step 1: `_spawnProjectile` records which player it's flying at**

Find:

```js
  _spawnProjectile(origin, targetSnapshot, damage, travelSpeed, effect = 'damage') {
    const mesh = new THREE.Mesh(projectileGeometry, projectileMat)
    mesh.position.copy(origin)
    this.scene.add(mesh)

    const distance = origin.distanceTo(targetSnapshot)
    const travelTime = Math.max(0.15, distance / travelSpeed)

    this.projectiles.push({ mesh, origin, target: targetSnapshot, damage, travelTime, t: 0, effect })
  }
```

Replace with:

```js
  _spawnProjectile(origin, targetSnapshot, damage, travelSpeed, effect = 'damage', targetPlayerId = null) {
    const mesh = new THREE.Mesh(projectileGeometry, projectileMat)
    mesh.position.copy(origin)
    this.scene.add(mesh)

    const distance = origin.distanceTo(targetSnapshot)
    const travelTime = Math.max(0.15, distance / travelSpeed)

    this.projectiles.push({ mesh, origin, target: targetSnapshot, damage, travelTime, t: 0, effect, targetPlayerId })
  }
```

- [ ] **Step 2: `_updateProjectiles` checks against the real target player and routes remote effects**

Find:

```js
  _updateProjectiles(dt, playerPos, onPlayerDamage, onPlayerPull, onPlayerDisorient, onWebLand) {
    this.projectiles = this.projectiles.filter((p) => {
      p.t += dt / p.travelTime
      if (p.t >= 1) {
        this.scene.remove(p.mesh)
        const dist = Math.hypot(playerPos.x - p.target.x, playerPos.z - p.target.z)
        if (dist <= PROJECTILE_HIT_RADIUS) {
          // Anchor/Siren/Webber - same arrival check as a normal damaging
          // hit, just landing a different effect instead of (or alongside,
          // for Webber which plants a zone the player isn't necessarily
          // standing in yet) player damage.
          if (p.effect === 'pull') { if (onPlayerPull) onPlayerPull(p.origin.x, p.origin.z) }
          else if (p.effect === 'disorient') { if (onPlayerDisorient) onPlayerDisorient() }
          else if (onPlayerDamage) onPlayerDamage(p.damage)
        }
        if (p.effect === 'web' && onWebLand) onWebLand(p.target.x, p.target.z)
        return false
      }
      p.mesh.position.lerpVectors(p.origin, p.target, p.t)
      p.mesh.position.y += Math.sin(p.t * Math.PI) * 0.6
      return true
    })
  }
```

Replace with:

```js
  _updateProjectiles(dt, playerPos, onPlayerDamage, onPlayerPull, onPlayerDisorient, onWebLand, otherPlayers = []) {
    this.projectiles = this.projectiles.filter((p) => {
      p.t += dt / p.travelTime
      if (p.t >= 1) {
        this.scene.remove(p.mesh)
        // Phase 3c - a projectile launched at a guest checks against that
        // player's own last-known position instead of the local one. If
        // that player has since disconnected (no longer in otherPlayers),
        // treat it as a miss rather than guessing a stale position.
        const targetPlayerPos = p.targetPlayerId === null
          ? playerPos
          : (otherPlayers || []).find((op) => op.playerId === p.targetPlayerId)
        const dist = targetPlayerPos
          ? Math.hypot(targetPlayerPos.x - p.target.x, targetPlayerPos.z - p.target.z)
          : Infinity
        if (dist <= PROJECTILE_HIT_RADIUS) {
          // Anchor/Siren/Webber - same arrival check as a normal damaging
          // hit, just landing a different effect instead of (or alongside,
          // for Webber which plants a zone the player isn't necessarily
          // standing in yet) player damage. A remote (non-null
          // targetPlayerId) hit queues into remoteDamageQueue instead of
          // calling the local callbacks - see Game.js's _syncNetworkPlayerState.
          if (p.effect === 'pull') {
            if (p.targetPlayerId === null) { if (onPlayerPull) onPlayerPull(p.origin.x, p.origin.z) }
            else this.remoteDamageQueue.push({ playerId: p.targetPlayerId, damage: 0, kind: 'pull', originX: p.origin.x, originZ: p.origin.z })
          } else if (p.effect === 'disorient') {
            if (p.targetPlayerId === null) { if (onPlayerDisorient) onPlayerDisorient() }
            else this.remoteDamageQueue.push({ playerId: p.targetPlayerId, damage: 0, kind: 'disorient' })
          } else if (p.targetPlayerId === null) {
            if (onPlayerDamage) onPlayerDamage(p.damage)
          } else {
            this.remoteDamageQueue.push({ playerId: p.targetPlayerId, damage: p.damage, kind: 'damage' })
          }
        }
        if (p.effect === 'web' && onWebLand) onWebLand(p.target.x, p.target.z)
        return false
      }
      p.mesh.position.lerpVectors(p.origin, p.target, p.t)
      p.mesh.position.y += Math.sin(p.t * Math.PI) * 0.6
      return true
    })
  }
```

- [ ] **Step 3: Pass `otherPlayers` at the one call site**

Find:

```js
    this._updateProjectiles(dt, playerPos, onPlayerDamage, onPlayerPull, onPlayerDisorient, onWebLand)
```

Replace with:

```js
    this._updateProjectiles(dt, playerPos, onPlayerDamage, onPlayerPull, onPlayerDisorient, onWebLand, otherPlayers)
```

(This line is inside `update()` itself, so `otherPlayers` - `update()`'s own parameter from Task 1 - is already in scope here.)

- [ ] **Step 4: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/game/ZombieManager.js
git commit -m "Route projectile landing checks and effects to the real target player (Phase 3c)"
```

---

### Task 4: Broadcast world-visible events (explosions, gas, acid, web)

**Files:**
- Modify: `src/game/ZombieManager.js` (constructor near line 264, the `onExplode` callback at the `zombie.update(...)` call site around line 1675)
- Modify: `src/game/Game.js` (constructor near the multiplayer fields, the `onTrail`/`onWebLand` callbacks at the `this.zombies.update(...)` call site around line 20994/20997, `_onZombieKilled`'s fester line around line 15120)

**Interfaces:**
- Produces: `ZombieManager.worldEvents` (array of `{id, type: 'explosion', x, z}`, `id` prefixed `'x' + counter`). `Game._pendingWorldEvents` (array of `{id, type: 'gas'|'acid'|'web', x, z}`, `id` prefixed `'h' + counter`). Task 6 drains both into the outgoing sync payload and clears them.

- [ ] **Step 1: Add the explosion-event queue and a matching counter to ZombieManager**

Find:

```js
    this.remoteDamageQueue = []
    this.projectiles = []
```

Replace with:

```js
    this.remoteDamageQueue = []
    // Phase 3c multiplayer - only the ZOMBIE-caused explosion (exploder/
    // spitter_bomber/brittle's detonation, via the onExplode callback
    // below) pushes here, not every _spawnExplosionFX call in this file
    // (grenades/airstrike are player-caused and stay purely local - out of
    // this phase's scope). Drained by Game.js's _syncNetworkPlayerState.
    this.worldEvents = []
    this._nextExplosionEventId = 0
    this.projectiles = []
```

- [ ] **Step 2: Push a world event from the zombie-caused explosion callback**

Find:

```js
      zombie.update(
        dt,
        this.elapsed,
        targetPos,
        attackCb,
        spitCb,
        onAmbushTrigger,
        (x, z) => this._spawnExplosionFX(x, z),
        playerCrouching,
```

Replace with:

```js
      zombie.update(
        dt,
        this.elapsed,
        targetPos,
        attackCb,
        spitCb,
        onAmbushTrigger,
        (x, z) => {
          this._spawnExplosionFX(x, z)
          this.worldEvents.push({ id: 'x' + (this._nextExplosionEventId++), type: 'explosion', x, z })
        },
        playerCrouching,
```

- [ ] **Step 3: Add the hazard-zone event queue and a matching counter to Game.js**

Find in the constructor:

```js
    this._otherPlayerPositions = [] // {playerId, x, z}[] - every OTHER connected player's last-known position, host-side AI targeting input (Phase 3c)
```

Replace with:

```js
    this._otherPlayerPositions = [] // {playerId, x, z}[] - every OTHER connected player's last-known position, host-side AI targeting input (Phase 3c)
    // Phase 3c multiplayer - fester's gas-on-death and acid_trail/webber's
    // hazard-zone drops, queued here (host-only) so a guest can replay the
    // same puddle/gas cloud on its own screen. Drained by
    // _syncNetworkPlayerState, same pattern as ZombieManager.worldEvents.
    this._pendingWorldEvents = []
    this._nextHazardEventId = 0
```

- [ ] **Step 4: Queue an event from the acid trail and web-land callbacks**

Find in `_tick()`:

```js
        (x, z) => this._spawnHazardZone('acid', x, z),
        (originX, originZ) => this._onZombiePull(originX, originZ),
        () => this._triggerShake(0.18, 600),
        (x, z) => this._spawnHazardZone('web', x, z),
```

Replace with:

```js
        (x, z) => {
          this._spawnHazardZone('acid', x, z)
          if (this._multiplayerIsHost) this._pendingWorldEvents.push({ id: 'h' + (this._nextHazardEventId++), type: 'acid', x, z })
        },
        (originX, originZ) => this._onZombiePull(originX, originZ),
        () => this._triggerShake(0.18, 600),
        (x, z) => {
          this._spawnHazardZone('web', x, z)
          if (this._multiplayerIsHost) this._pendingWorldEvents.push({ id: 'h' + (this._nextHazardEventId++), type: 'web', x, z })
        },
```

- [ ] **Step 5: Queue an event from fester's gas-on-death**

Find in `_onZombieKilled` (or wherever this project's own `_onZombieKilled` method is - search for this exact line):

```js
    if (zombieTypeId === 'fester') this._spawnHazardZone('gas', x, z)
```

Replace with:

```js
    if (zombieTypeId === 'fester') {
      this._spawnHazardZone('gas', x, z)
      if (this._multiplayerIsHost) this._pendingWorldEvents.push({ id: 'h' + (this._nextHazardEventId++), type: 'gas', x, z })
    }
```

- [ ] **Step 6: Build check**

Run: `npx vite build`
Expected: succeeds. Nothing reads `worldEvents`/`_pendingWorldEvents` yet (Task 6 wires that up), so solo and existing multiplayer behavior is unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/game/ZombieManager.js src/game/Game.js
git commit -m "Queue world-visible events (explosions, gas, acid, web) for broadcasting (Phase 3c)"
```

---

### Task 5: Extend the sync endpoint for world events and remote damage

**Files:**
- Modify: `api/multiplayer/sync.js` (full file - current content below is the complete starting point)

**Interfaces:**
- Consumes: `worldEvents` (Task 4, via the request body), `remoteDamage` (Task 2/3, via the request body).
- Produces: response gains `worldEvents` (array, everyone gets the current recent list) and `remoteDamage` (array, only entries addressed to the calling player - drained and cleared, same pattern `pendingHits` already uses).

- [ ] **Step 1: Add a TTL constant for pruning old world events**

Find:

```js
const STALE_MS = 2500
```

Replace with:

```js
const STALE_MS = 2500
// World events (Phase 3c: docs/superpowers/specs/2026-08-25-multiplayer-phase3c-remaining-zombies-design.md) -
// broadcast (not delivered-and-cleared like pendingHits, since every
// player needs to see the same ones, not just one recipient) but still
// need pruning eventually so the stored list doesn't grow forever over a
// long session. 15s is comfortably longer than any real sync interval, so
// an actively-polling client will always see an event at least once
// before it's pruned.
const WORLD_EVENT_TTL_MS = 15000
```

- [ ] **Step 2: Accept the two new request fields**

Find:

```js
  const { sessionId, playerId, x, y, z, rotY, currentWeapon, isFiring, zombies, hits } = req.body || {}
```

Replace with:

```js
  const { sessionId, playerId, x, y, z, rotY, currentWeapon, isFiring, zombies, hits, worldEvents, remoteDamage } = req.body || {}
```

- [ ] **Step 3: Store incoming world events (host only) right after the existing zombies-snapshot block**

Find:

```js
    await sessionRef.child('world/zombies').set(zombiesById)
  }

  if (!isHost && Array.isArray(hits) && hits.length) {
```

Replace with:

```js
    await sessionRef.child('world/zombies').set(zombiesById)
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

  if (!isHost && Array.isArray(hits) && hits.length) {
```

- [ ] **Step 4: Drain-and-clear this caller's own remote damage inbox**

Find:

```js
  let pendingHits = []
  if (isHost) {
    // Deliver-and-clear: not clearing would re-deliver the same hits
    // again on the host's next sync, double-applying the damage.
    const pendingSnapshot = await sessionRef.child('world/pendingHits').once('value')
    const pending = pendingSnapshot.val() || {}
    pendingHits = Object.values(pending)
    if (pendingHits.length) await sessionRef.child('world/pendingHits').remove()
  }
```

Replace with:

```js
  let pendingHits = []
  if (isHost) {
    // Deliver-and-clear: not clearing would re-deliver the same hits
    // again on the host's next sync, double-applying the damage.
    const pendingSnapshot = await sessionRef.child('world/pendingHits').once('value')
    const pending = pendingSnapshot.val() || {}
    pendingHits = Object.values(pending)
    if (pendingHits.length) await sessionRef.child('world/pendingHits').remove()
  }

  // Any player (host or guest) can be on the receiving end of a remote
  // damage report - a guest gets hit by a zombie that picked it as the
  // nearest target, delivered here under its own playerId. Same
  // deliver-and-clear reasoning as pendingHits above.
  const myRemoteDamageSnapshot = await sessionRef.child(`world/remoteDamage/${playerId}`).once('value')
  const myRemoteDamage = myRemoteDamageSnapshot.val() || {}
  const remoteDamageOut = Object.values(myRemoteDamage)
  if (remoteDamageOut.length) await sessionRef.child(`world/remoteDamage/${playerId}`).remove()
```

- [ ] **Step 5: Read back and prune the world events list, include it in the response**

Find:

```js
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

Replace with:

```js
  const [stateSnapshot, playersSnapshot, zombiesSnapshot, eventsSnapshot] = await Promise.all([
    sessionRef.child('playerState').once('value'),
    sessionRef.child('players').once('value'),
    sessionRef.child('world/zombies').once('value'),
    sessionRef.child('world/events').once('value'),
  ])
  const allStates = stateSnapshot.val() || {}
  const allPlayers = playersSnapshot.val() || {}
  const states = {}
  for (const [otherId, state] of Object.entries(allStates)) {
    if (otherId === playerId) continue
    if (now - state.updatedAt > STALE_MS) continue
    states[otherId] = { ...state, nickname: allPlayers[otherId]?.nickname || 'Player' }
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

  res.status(200).json({ states, zombies: zombiesSnapshot.val() || {}, pendingHits, worldEvents: worldEventsOut, remoteDamage: remoteDamageOut })
}
```

- [ ] **Step 6: Commit**

```bash
git add api/multiplayer/sync.js
git commit -m "Extend the sync endpoint for world events and per-player remote damage (Phase 3c)"
```

---

### Task 6: Wire world events and remote damage through Game.js and Multiplayer.js

**Files:**
- Modify: `src/game/Multiplayer.js` (`syncPlayerState` at line 86)
- Modify: `src/game/Game.js` (`_syncNetworkPlayerState` at line 15497)

**Interfaces:**
- Consumes: `ZombieManager.worldEvents`/`remoteDamageQueue` (Task 2/3/4), `Game._pendingWorldEvents` (Task 4), the sync endpoint's new response fields (Task 5).
- Produces: nothing new consumed by later tasks - Task 7 is a data-only change and Task 8 is deploy + verification.

- [ ] **Step 1: Update `Multiplayer.js`'s return shape**

Find:

```js
export async function syncPlayerState(sessionId, state) {
  const playerId = _playerIdFor.get(sessionId)
  if (!playerId) throw new Error('Not in this session')
  const { states, zombies, pendingHits } = await _apiCall('sync', { sessionId, playerId, ...state })
  return { states, zombies: zombies || {}, pendingHits: pendingHits || [] }
}
```

Replace with:

```js
export async function syncPlayerState(sessionId, state) {
  const playerId = _playerIdFor.get(sessionId)
  if (!playerId) throw new Error('Not in this session')
  const { states, zombies, pendingHits, worldEvents, remoteDamage } = await _apiCall('sync', { sessionId, playerId, ...state })
  return { states, zombies: zombies || {}, pendingHits: pendingHits || [], worldEvents: worldEvents || [], remoteDamage: remoteDamage || [] }
}
```

- [ ] **Step 2: Track which world events this client has already replayed**

Find in the constructor:

```js
    this._pendingWorldEvents = []
    this._nextHazardEventId = 0
```

Replace with:

```js
    this._pendingWorldEvents = []
    this._nextHazardEventId = 0
    this._seenWorldEventIds = new Set() // Phase 3c - dedupes replayed world events across sync calls, both host and guest
```

- [ ] **Step 3: Send the queued events/damage and apply what comes back**

Find:

```js
    if (this._multiplayerIsHost) {
      payload.zombies = this.zombies.zombies
        .filter((z) => SHARED_ZOMBIE_TYPE_IDS.has(z.type) && z.state !== 'dead')
        .map((z) => ({
          id: z.id, x: z.group.position.x, z: z.group.position.z, rotY: z.group.rotation.y,
          health: z.health, maxHealth: z.maxHealth, state: z.state, type: z.type,
          screaming: performance.now() < z.screamPulseUntil,
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
          this._renderSharedZombies(zombies, feetX, feetZ)
        }
      }).catch(() => {})
    })
  }
```

Replace with:

```js
    if (this._multiplayerIsHost) {
      payload.zombies = this.zombies.zombies
        .filter((z) => SHARED_ZOMBIE_TYPE_IDS.has(z.type) && z.state !== 'dead')
        .map((z) => ({
          id: z.id, x: z.group.position.x, z: z.group.position.z, rotY: z.group.rotation.y,
          health: z.health, maxHealth: z.maxHealth, state: z.state, type: z.type,
          screaming: performance.now() < z.screamPulseUntil,
        }))
      // Phase 3c - both queues are drained and cleared here regardless of
      // whether the upcoming network call actually succeeds; losing a rare
      // cosmetic event or a damage tick to a dropped request is an
      // acceptable, already-precedented tradeoff (same as this codebase's
      // existing "fire and forget, .catch(() => {})" sync calls generally).
      if (this.zombies.worldEvents.length || this._pendingWorldEvents.length) {
        payload.worldEvents = [...this.zombies.worldEvents, ...this._pendingWorldEvents]
        this.zombies.worldEvents = []
        this._pendingWorldEvents = []
      }
      if (this.zombies.remoteDamageQueue.length) {
        payload.remoteDamage = this.zombies.remoteDamageQueue
        this.zombies.remoteDamageQueue = []
      }
    } else if (this._pendingZombieHits.length) {
      payload.hits = this._pendingZombieHits
      this._pendingZombieHits = []
    }
    import('./Multiplayer.js').then((Multiplayer) => {
      Multiplayer.syncPlayerState(this._multiplayerSessionId, payload).then(({ states, zombies, pendingHits, worldEvents, remoteDamage }) => {
        this._renderRemotePlayers(states)
        if (this._multiplayerIsHost) {
          for (const hit of pendingHits) {
            const zombie = this.zombies.zombies.find((z) => z.id === hit.zombieId)
            if (zombie) zombie.onHit(hit.damage, { bypassShield: hit.bypassShield })
          }
        } else {
          this._renderSharedZombies(zombies, feetX, feetZ)
        }
        // Phase 3c - world events are broadcast to everyone (not filtered
        // per-recipient like remoteDamage below), so both the host and
        // every guest replay any id they haven't seen yet.
        for (const ev of worldEvents) {
          if (this._seenWorldEventIds.has(ev.id)) continue
          this._seenWorldEventIds.add(ev.id)
          if (ev.type === 'explosion') this.zombies._spawnExplosionFX(ev.x, ev.z)
          else this._spawnHazardZone(ev.type, ev.x, ev.z)
        }
        // remoteDamage only ever contains entries the server has already
        // filtered down to this specific player (see api/multiplayer/sync.js) -
        // applied via the exact same local methods solo play already uses.
        for (const entry of remoteDamage) {
          if (entry.kind === 'pull') this._onZombiePull(entry.originX, entry.originZ)
          else if (entry.kind === 'disorient') this._triggerShake(0.18, 600)
          else this._onZombieAttack(entry.damage)
        }
      }).catch(() => {})
    })
  }
```

- [ ] **Step 4: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/game/Multiplayer.js src/game/Game.js
git commit -m "Wire world events and remote damage through the sync loop (Phase 3c)"
```

---

### Task 7: Add the remaining 13 types to the shared-zombie list

**Files:**
- Modify: `src/game/ZombieTypes.js` (`SHARED_ZOMBIE_TYPE_IDS` near line 620)

**Interfaces:**
- Produces: `SHARED_ZOMBIE_TYPE_IDS` now includes all 28 types - Task 8's verification depends on this.

- [ ] **Step 1: Update the set and its comment**

Find:

```js
// Phase 3 of multiplayer (docs/superpowers/specs/2026-08-24-multiplayer-phase3-shared-zombies-design.md)
// plus Phase 3b (docs/superpowers/specs/2026-08-24-multiplayer-phase3b-groupa-zombies-design.md,
// which added shielded/screamer/stalker/burrower) - these types are shared
// across a session; everything else (ranged attackers, anything that
// explodes/gasses on death, scream-summoners like screamer_swarmer, and
// every boss tier) stays an independent per-player fight for now. See
// those specs' "Scope for this phase" sections for the reasoning behind
// each exclusion.
export const SHARED_ZOMBIE_TYPE_IDS = new Set([
  'feral_dog', 'feral_child', 'shambler', 'runner', 'brute',
  'crawler', 'sewer_dweller', 'leaper', 'regenerator', 'bloodhound', 'vampire',
  'shielded', 'screamer', 'stalker', 'burrower',
])
```

Replace with:

```js
// Multiplayer Phases 3/3b/3c (see docs/superpowers/specs/2026-08-24-multiplayer-phase3-shared-zombies-design.md,
// -phase3b-groupa-zombies-design.md, and -phase3c-remaining-zombies-design.md) -
// every zombie type is now shared across a session. Phase 3c is what
// finally made the ranged/explosive/hazard types safe to share - it added
// host-side awareness of every connected player (not just whoever's
// hosting) so these types can actually threaten either player, plus a
// small broadcast channel for effects that are otherwise invisible to a
// guest (gas clouds, acid puddles, explosions).
export const SHARED_ZOMBIE_TYPE_IDS = new Set([
  'feral_dog', 'feral_child', 'shambler', 'runner', 'brute',
  'crawler', 'sewer_dweller', 'leaper', 'regenerator', 'bloodhound', 'vampire',
  'shielded', 'screamer', 'stalker', 'burrower',
  'spitter', 'spitter_bomber', 'anchor', 'siren', 'webber',
  'exploder', 'fester', 'acid_trail', 'brittle', 'screamer_swarmer',
  'colossus', 'titan', 'broodmother',
])
```

- [ ] **Step 2: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/game/ZombieTypes.js
git commit -m "Share the remaining 13 zombie types and all 3 bosses (Phase 3c)"
```

---

### Task 8: Deploy and verify with two real browser sessions

**Files:**
- None (deploy + verification only).

**Interfaces:**
- Consumes: everything from Tasks 1-7.

- [ ] **Step 1: Deploy to production**

```bash
npx vercel --prod --yes
```

- [ ] **Step 2: Two-browser Playwright verification**

Alternates touching both pages during every wait (see Global Constraints - a page left untouched for many seconds can get throttled by Chromium as a background tab, which produced a false-negative result earlier tonight). Forces each type via the existing `_spawnRandom()` loop technique.

```python
from playwright.sync_api import sync_playwright
import time

def poll_both(check_fn, host_page, guest_page, timeout=180, interval=0.5):
    deadline = time.time() + timeout
    result = None
    while time.time() < deadline:
        host_page.evaluate("() => true")
        guest_page.evaluate("() => true")
        result = check_fn()
        if result:
            return result
        time.sleep(interval)
    return result

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    host_page = browser.new_page()
    guest_page = browser.new_page()

    host_page.goto('https://gayz.vercel.app', timeout=60000)
    poll_both(lambda: host_page.evaluate("() => !!window.__game"), host_page, guest_page, timeout=60)
    host_page.evaluate("() => { const l = document.getElementById('asset-loader'); if (l) l.style.display = 'none' }")

    session_id = host_page.evaluate("""async () => {
        window.__game.settings.nickname = 'ZombieHost'
        await window.__game._createMultiplayerSession()
        return window.__game._multiplayerSessionId
    }""")
    print("session:", session_id)

    guest_page.goto(f'https://gayz.vercel.app/?join={session_id}', timeout=60000)
    poll_both(lambda: guest_page.evaluate("() => !!window.__game"), host_page, guest_page, timeout=60)
    guest_page.evaluate("() => { const l = document.getElementById('asset-loader'); if (l) l.style.display = 'none' }")

    # Position the GUEST's player near the host's spawn point BEFORE
    # joining, so a forced ranged/explosive spawn near the host also ends
    # up near the guest - needed to test that the guest can actually take
    # damage (not just the host).
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

    # Move the guest's player to a known point, then move the host's own
    # player FAR AWAY from that point - so any zombie spawned near the
    # guest's point should target the guest, not the host, proving the
    # multi-target redirect actually works rather than just "whoever's
    # nearest happens to be the host by default."
    guest_page.evaluate("""() => {
        window.__game.player.controls.object.position.set(50, window.__game.player.eyeHeight, 50)
    }""")
    host_page.evaluate("""() => {
        window.__game.player.controls.object.position.set(-200, window.__game.player.eyeHeight, -200)
    }""")

    def force_spawn_near(type_id, x, z):
        for _ in range(60):
            host_page.evaluate("() => window.__game.zombies._spawnRandom()")
            zid = host_page.evaluate(f"""() => {{
                const z = window.__game.zombies.zombies.find((zz) => zz.type === '{type_id}')
                return z ? z.id : null
            }}""")
            if zid is not None:
                # Relocate it right next to the guest's known position so
                # the targeting redirect has an unambiguous nearest player.
                host_page.evaluate(f"""() => {{
                    const z = window.__game.zombies.zombies.find((zz) => zz.id === {zid})
                    z.group.position.set({x}, 0, {z})
                }}""")
                return zid
        return None

    guest_health_before = guest_page.evaluate("() => window.__game.playerState.health")
    host_health_before = host_page.evaluate("() => window.__game.playerState.health")
    spitter_id = force_spawn_near('spitter', 50, 55)
    print("forced a spitter to spawn near the guest:", spitter_id is not None)

    guest_health_dropped = poll_both(
        lambda: guest_page.evaluate("() => window.__game.playerState.health") < guest_health_before,
        host_page, guest_page, timeout=180
    )
    print("guest's own health dropped from a zombie the host is simulating:", guest_health_dropped)

    host_health_after = host_page.evaluate("() => window.__game.playerState.health")
    print("host's health stayed the same (spitter targeted the guest, not the host):", host_health_after == host_health_before)

    # --- World event: fester's gas cloud reaches the guest's screen ---
    fester_id = force_spawn_near('fester', 50, 45)
    print("forced a fester to spawn near the guest:", fester_id is not None)
    poll_both(lambda: guest_page.evaluate(f"() => window.__game._sharedZombieBodies.has({fester_id})"), host_page, guest_page, timeout=180)
    host_page.evaluate(f"""() => {{
        const z = window.__game.zombies.zombies.find((zz) => zz.id === {fester_id})
        z.health = 0
        window.__game._onZombieKilled('fester', 'melee', z.group.position.x, z.group.position.z, false, false, false, false, false)
    }}""")
    guest_saw_hazard = poll_both(
        lambda: guest_page.evaluate("() => window.__game._seenWorldEventIds.size") > 0,
        host_page, guest_page, timeout=180
    )
    print("guest replayed at least one world event (gas cloud):", guest_saw_hazard)

    # --- Boss: added to the shared list, behaves like any other shared type ---
    boss_id = None
    for _ in range(3):
        host_page.evaluate("() => window.__game.zombies._maybeSpawnTitan ? (window.__game.zombies.nextTitanCheckAt = 0, window.__game.zombies._maybeSpawnTitan()) : null")
        boss_id = host_page.evaluate("""() => {
            const z = window.__game.zombies.zombies.find((zz) => zz.type === 'titan')
            return z ? z.id : null
        }""")
        if boss_id is not None:
            break
    print("forced a titan boss to spawn:", boss_id is not None)
    if boss_id is not None:
        boss_synced = poll_both(lambda: guest_page.evaluate(f"() => window.__game._sharedZombieBodies.has({boss_id})"), host_page, guest_page, timeout=180)
        print("guest sees the shared titan boss:", boss_synced)

    browser.close()
```

Expected: `guest's own health dropped from a zombie the host is simulating` is `True`, `host's health stayed the same` is `True`, `guest replayed at least one world event` is `True`, and (if the rare titan spawn roll happened to trigger within 3 tries) `guest sees the shared titan boss` is `True` - titan is a rare rogue spawn on its own timer rather than a guaranteed one, so a `None`/`False` result there specifically isn't itself a failure signal the way the other checks are; colossus/broodmother are simpler to verify manually per Gaymi's own test below since they're scheduled boss-night spawns, not random rolls.

- [ ] **Step 3: No commit needed** - this task deploys and verifies already-committed code from Tasks 1-7.

**Gaymi's test for this batch - needs your friend again:**
1. Start a run, invite your friend, both join the same session.
2. Walk around until either of you finds a **spitter**, **siren**, **webber**, or **anchor** - whichever of you is closer to it should be the one it shoots at and can actually get hurt by it (not always just the host anymore).
3. Find an **exploder**, **fester**, or **acid_trail** zombie - both of you should see the explosion/gas cloud/puddle appear at the same spot when it happens, even if only one of you was close enough to be hurt by it.
4. If a boss night comes up (or you get the rare **Dinosaur** roaming encounter), you should both see and fight the exact same boss - same health bar, dies for both at once.

**What's still normal, not a bug:** kill rewards (coins/XP/achievements) still only credit whoever's hosting for now, even if your friend lands the killing blow - that's a known, separate thing for later, not something this batch was meant to fix.

**Failure looks like:** your friend never takes damage from a ranged/explosive zombie no matter how close they are (only the host ever does), an explosion/gas cloud/puddle only shows up for one of you, or a boss looks different / has different health on each screen.
