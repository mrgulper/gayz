# Multiplayer Phase 6: Scaling & Host Migration Design

## Goal

Two things, both from the original master plan's final phase (`docs/superpowers/specs/2026-08-21-multiplayer-design.md`'s "Phased build plan", item 6):

1. **No hard cap on session size.** The system has only ever been tested with exactly one host and one guest; confirm (and where needed, generalize) it for any number of players joining the same session.
2. **Seamless host migration.** Today, if the host's browser closes or crashes mid-session, nothing happens - the game silently freezes for everyone else, forever, since only the host's device drives the zombie/world simulation. This phase makes another connected player automatically and invisibly take over as host, with no visible hiccup in the running simulation.

## Current state, in detail

Research into the actual code (not the master doc's assumptions) found the system further along than expected:

**Already N-player-safe, no changes needed:**
- `api/multiplayer/sync.js`'s `states` response already loops over every other active player, not "the" one guest.
- Per-recipient delivery channels (`remoteDamage`, `killEvents`) are already keyed by individual player ID, not a single implicit recipient.
- Broadcast channels (`zombies`, `pickups`, `xpGems`, `chests`, `windows`, `worldEvents`) already go to everyone, with no player-count assumption.
- `Game.js`'s `_remotePlayerBodies` (a `Map` keyed by player ID) and `_otherPlayerPositions` (rebuilt as a full array every sync) already handle any number of other players.
- `ZombieManager.js`'s multi-target AI (`otherPlayers` parameter, added in Phase 3c) already iterates a real array, not a single hardcoded target.
- `api/multiplayer/join.js` has no player-count cap at all - anyone can already join an existing session at any time.

**Genuinely missing:**
- Nothing detects a host disconnecting. If the host's tab closes, `api/multiplayer/leave.js` removes their own `players`/`playerState` entries but does nothing else - the session's stored `host` field keeps pointing at a player who's no longer there, and every subsequent sync call from remaining guests just returns a world that's stopped updating, with zero explanation.
- No host-election mechanism exists.
- No mechanism exists for the world simulation to be picked up by a different client mid-session - today's broadcast only carries enough detail to *render* zombies/pickups on a guest (position, health, type), not enough to *continue simulating* them (AI state, active status effects, cooldowns, spawn-wave timers, hazard zone durations, etc.).

A full inventory of that missing simulation detail (every non-broadcast field on `Zombie`, `ZombieManager`'s wave/spawn director state, hazard zones, XP gem/pickup expiry timers) was catalogued during research. Roughly: ~30 additional fields per zombie, plus ~25 scalar fields for the spawn director, plus a handful of fields for ongoing hazard zones. For a typical 15-30 zombie wave, this takes a sync payload from roughly 3-7KB today to roughly 20-35KB - a real increase, but still small in absolute terms for a several-times-a-second poll among a handful of players.

## Chosen approach

### 1. No player cap

`api/multiplayer/join.js` already allows unlimited joins. The work here is confirming (via real multi-browser testing) that everything downstream - rendering N remote players, N-target zombie AI, N-recipient delivery channels, N-way broadcast - actually behaves correctly with 3+ players, not just the 2 it's been tested with, and fixing anything that doesn't. No cap is added; "no hard cap" per Gaymi's explicit choice.

### 2. Broadcast full simulation state, not just rendering state

Considered three approaches:
- **(Chosen) Broadcast the full state to every player, always.** Every player already receives a broadcast each sync; this extends what's in it. Whoever ends up elected host is always already "warm" with near-real-time full state, since they were receiving it the whole time as a guest - migration becomes "start locally simulating from what I already have," not "fetch a special payload right now."
- **Only send full state to one designated backup player.** Saves bandwidth, but adds real complexity (re-picking a backup if they also leave, races if the backup and the host both drop close together) for a bandwidth saving that doesn't matter much at this payload size.
- **Rewrite sync to send deltas instead of full snapshots.** More efficient long-term, but a much bigger rewrite of an already-working polling system. Out of scope - YAGNI.

`Zombie.js` gains a full serialization of its current-simulation-state fields (status effects and their expiry timestamps, cooldowns, AI mode, type-specific state like shield health or climb progress) into the broadcast payload, alongside a new small "director" block on the session carrying `ZombieManager`'s own spawn/wave timers and horde state, and slightly richer hazard-zone entries (remaining duration, current radius for growing zones).

### 3. Detecting the host is gone

No new mechanism needed. `sync.js`'s `states` response already excludes any player who hasn't updated in `STALE_MS` (2.5s) - so a guest doesn't even see the host as "missing" until that 2.5s window has already passed server-side. A guest already effectively learns "the host is gone" for free the moment the host's ID stops appearing in that list. To avoid reacting to one single missed poll on top of that, a client additionally waits for the host to be absent across 2 consecutive sync calls (roughly 200ms more, at the existing ~100ms sync interval) before treating it as a real disconnect - so total detection time is on the order of ~2.5-3s, not instant, but well within "the world was frozen and then quietly kept going" territory rather than a jarring multi-second visible stall.

### 4. Electing the new host

The remaining player with the earliest `joinedAt` (a value every player already receives, added in Phase 5's anti-abuse guard) becomes the new host. Every client computes this independently from data it already has - no voting, no server round-trip needed to *decide*, and no possibility of two clients disagreeing about who's next.

### 5. Claiming the host role

The elected client calls a new endpoint to make it official server-side (the server's own `isHost` check reads the session's stored `host` field, so the server has to be told, not just the clients). The server doesn't trust the claim blindly - it independently re-verifies the current host's `playerState` is actually stale before granting the claim, using a Firebase transaction on the `host` field so two near-simultaneous claims can't both succeed. This is also what protects against the "host wasn't really gone, just a network blip" case: if the real host's next update lands before a claim is granted, the claim is rejected; if a claim is granted and the original host's browser is still alive and tries to keep acting as host afterward, its own writes are now rejected by the server (it's no longer the stored host), so it can't corrupt state even though it doesn't yet know it's been replaced.

### 6. The actual handoff

The newly-elected host doesn't rebuild the world from scratch. It already has, as a guest, lightweight rendered copies of every zombie/pickup/gem (from `_renderSharedZombies`/`_renderSharedPickups`/`_renderSharedGems`). On taking over, each of those gets "upgraded" in place - the extra simulation-state fields from the last full broadcast are attached to the same objects (reusing their already-existing meshes, so nothing visually pops or resets), and the client switches from passively rendering them to actually running the real zombie AI/update loop on them, exactly as if it had been the host all along. The spawn director's timers and horde state are restored the same way from the broadcast "director" block.

## Data flow changes

- `zombies` broadcast (in `api/multiplayer/sync.js` and `Game.js`) gains the full non-rendering state fields per zombie catalogued above.
- New `director` field on the session, host-broadcast, carrying `ZombieManager`'s wave/spawn timer state.
- `worldEvents`/hazard-zone-related broadcast gains remaining-duration/current-radius so a migrated host can continue an in-progress hazard zone rather than losing track of it.
- New `api/multiplayer/claim-host.js` endpoint: `{sessionId, playerId}` -> re-verifies the current host is actually stale, then transactionally updates the session's `host` field. Returns success/failure - failure means someone else already claimed it, or the old host turned out not to be gone.
- Client gains: host-absence detection (watching the `states` response), the deterministic election computation, the claim call, and the "upgrade my shared render objects into a real simulation" handoff logic.

## Scope notes

- Player rewards/personal progress (coins, XP, achievements, quest progress) are untouched by this phase - Phase 5 already made those live entirely on each player's own client, independent of who's hosting, so a host change doesn't affect them at all.
- This phase does not add a UI affordance for "N players in this session" beyond what already exists (remote player bodies with nicknames are already visible) - a session-size indicator isn't part of the original ask and can be a small follow-up if wanted later.
- The "old host briefly still thinks it's host" case is handled by rejecting its writes server-side (see section 5) - it doesn't need to be told out-of-band that it's been replaced; its own next sync call's rejected write, followed by it too noticing a *different* player is now driving the world, is sufficient. If that player's own game is still running (didn't actually crash, e.g. it was a long tab-freeze), it will itself fall back to rendering as a guest once it can no longer write as host.

## Testing approach

Same as every prior phase - real Playwright browser contexts against the deployed build, not simulated events. New checks this phase needs: a 3-browser session where all three see each other, shared zombies, and shared loot correctly; killing (closing) the host's page mid-session and confirming a specific, predictable other player becomes the new host, the world keeps updating with no reset (a zombie's in-progress status effect/cooldown survives the handoff), and the world doesn't glitch/reset visually; a claim-host call from a non-earliest-joined player being rejected in favor of the correct one; a claim attempt while the "old" host is actually still fine being rejected.
