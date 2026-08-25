# Multiplayer Phase 3c: Remaining Zombie Types + Bosses Design

## Goal

Share the last 13 zombie types across a multiplayer session - the 5 ranged types (spitter, spitter_bomber, anchor, siren, webber), the 4 death/area-effect types (exploder, fester, acid_trail, brittle), screamer_swarmer, and the 3 bosses (colossus, titan, broodmother) - bringing shared coverage to all 28 types. Unlike Phase 3/3b, this needs the zombie AI to actually be aware of BOTH players, not just whoever is hosting, since a ranged/explosive attack has to be able to threaten either player.

## Scope for this phase

**Explicitly out of scope, matching the original master doc's own deferred phases** (`docs/superpowers/specs/2026-08-21-multiplayer-design.md`): loot/interactable sharing, and reward integrity. On that last point specifically - a real, ALREADY-EXISTING gap this phase's own research surfaced: every shared zombie kill's rewards (coins, XP, kill count, achievements) credit only whichever player is hosting today, regardless of who actually landed the killing blow, because `Game.js`'s `_onZombieKilled` only ever fires on the host's own client (only the host calls `ZombieManager.update()` at all in a shared session). This phase does not fix that - it's the same "Phase 5: Reward integrity" the master doc already deferred - but it's worth being explicit that bosses inherit this exact same characteristic, not a new or worse one.

**Not attempted**: syncing a projectile's actual mid-flight position frame-by-frame. Sync cadence (a few times a second) is too coarse for that to look smooth. Instead, only the moment a projectile lands (or a hazard effect spawns) gets broadcast - see "World events" below.

## Approach

### 1. Target picking (the real foundation)

`ZombieManager.js`'s per-zombie loop already has a proven "redirect this zombie's target away from the local player" pattern, used today for wandering-horde waypoints, decoys, and a boss occasionally preferring the nearest companion over the player (`update()`, around line 1563-1662: a per-iteration `targetPos`/`attackCb` pair, reassigned by a sequence of override blocks before being passed into `zombie.update(...)`). This phase adds one more override block in that same sequence, using the same shape: given a list of every OTHER connected player's last-known position (see below), if one of them is nearer to this zombie than the local player is, `targetPos` becomes that player's position and `attackCb` becomes a callback that queues a damage report for that specific player instead of calling the local `onPlayerDamage`.

This applies to every zombie, not just the newly-shared types - it also fixes the same targeting gap in the 15 types shared in Phase 3/3b, where today a zombie will keep chasing the host's stale position even if the actual nearest player is a guest standing right next to it.

**Where "other players' positions" comes from**: `Game.js`'s `_renderRemotePlayers(states)` already receives every other connected player's position on each sync call (used today only for rendering their `MinecraftPlayerBody`) - it starts also storing this as `this._otherPlayerPositions` (an array of `{playerId, x, z}`), which `_tick()` passes into `ZombieManager.update()` as a new parameter alongside the existing single `playerPos`.

### 2. Getting hurt remotely

When the override above picks a non-local player as the target and a hit lands (melee, a projectile, or an explosion), the host cannot directly reduce that player's health - only that player's own browser can, since it owns its own `playerState`. Instead, the host queues `{playerId, damage}` into a new outgoing list (mirroring the existing guest-to-host `hits`/`pendingHits` shape, just in the opposite direction: host-to-guest). The sync endpoint stores and relays these the same way it already relays `pendingHits`, and each affected guest's own regular sync response includes any entries addressed to it, applying them locally via the same `_onZombieAttack(damage)` method solo play already uses (no new damage-application code needed - this is the same reuse-what-exists principle as every prior phase). Anchor's pull and Siren's disorient effects follow the identical path, just calling `_onZombiePull`/the disorient screen-shake locally on the targeted guest instead of `_onZombieAttack`.

### 3. Projectiles

`ZombieManager._spawnProjectile`/`_updateProjectiles` currently check whether a landed shot is near the single `playerPos`. Each projectile now also remembers which player it was actually launched at (`targetPlayerId`, `null` meaning the local/host player) - set at spawn time from whichever target the override in part 1 chose - and the landing check compares against that specific player's current position (the host's own, or that player's last-known synced position) instead of always the local one.

### 4. World events (gas clouds, acid puddles, explosions)

`fester`'s gas-on-death and `acid_trail`'s leaving-a-puddle both call `Game.js`'s `_spawnHazardZone(type, x, z)` today, and `exploder`/`spitter_bomber`/`brittle`'s detonation calls `_spawnExplosionFX(x, z)` - both purely local today, meaning a guest never sees any of this happen even though (per parts 1-3) it may now be able to damage them. The host's outgoing sync payload gains a small `worldEvents: [{id, type, x, z}]` list (a couple of entries at most per sync call in practice - these are already rare, cooldown-gated events, not a per-frame stream), each with a small incrementing id so a guest can tell which ones it has already replayed. A guest's own regular sync response includes any new event ids since its last one, and replays them locally by calling its own `_spawnHazardZone`/`_spawnExplosionFX` - purely cosmetic/hazard-visual on the guest's side, since the actual damage (if any) already arrived via part 2's `remoteDamage` list.

### 5. Adding the remaining types

Once parts 1-4 exist, adding `spitter`, `spitter_bomber`, `anchor`, `siren`, `webber`, `exploder`, `fester`, `acid_trail`, `brittle`, `screamer_swarmer`, `colossus`, `titan`, `broodmother` to `SHARED_ZOMBIE_TYPE_IDS` is the same one-line change Phase 3b's Task 1 was.

**Reinforcements/summons need no new mechanism at all**: `screamer_swarmer`'s `summonOnDeath`/`summonType: 'shambler'` and `broodmother`'s `addType: 'sewer_dweller'` both summon zombies of types that are already shared. Since the host's outgoing snapshot is rebuilt fresh from `this.zombies.zombies` every single sync call (not incrementally), any newly-summoned zombie of a shared type simply appears in the very next snapshot with its own real id - the exact same lazily-create-on-first-sight logic `_renderSharedZombies` already has for any other id handles it with zero changes.

## Data flow changes

**Request** (`POST /api/multiplayer/sync`):
- From the host: `zombies` array unchanged in shape; adds `worldEvents: [{id, type, x, z}]` and `remoteDamage: [{playerId, damage, kind}]` (`kind` is `'damage'`, `'pull'`, or `'disorient'`).
- From a guest: unchanged (`hits`, as before).

**Response**: everyone's response gains `worldEvents` (the host's latest list, same as `zombies`) and, for a specific guest, whichever `remoteDamage` entries are addressed to that guest's own player id.

**Server-side storage**: `multiplayerSessions/{sessionId}/world/events` (a small capped/rolling list, since these are rare) and reuses the same delivered-and-cleared pattern `pendingHits` already established, keyed per-player this time instead of a single shared inbox (a guest's own damage report shouldn't be visible to or consumable by a different guest).

## Testing approach

Same as every prior phase - two real Playwright browser contexts against a deployed build, forcing each type to spawn via the existing `_spawnRandom()` loop technique. New checks this phase specifically needs: force a ranged type to spawn near the GUEST's position (not the host's) and confirm the guest's own health actually drops; force a fester/acid_trail/exploder death/trail near the guest and confirm a hazard zone or explosion FX appears on the guest's screen at the right spot; confirm a boss added to the shared list behaves exactly like any other shared melee zombie (same health/state sync, same hit-report flow). Given tonight's Firebase sparse-array bug was only caught because burrower's rarer spawn odds pushed the id range wide enough to expose it, every new snapshot-keyed list this phase adds (`worldEvents`, `remoteDamage`) uses the same non-numeric-prefixed-key precaution from the start rather than risking the same class of bug again.
