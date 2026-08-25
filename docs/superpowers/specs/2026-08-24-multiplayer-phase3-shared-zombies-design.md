# Multiplayer Phase 3: Shared Zombies Design

## Goal

Right now, in a multiplayer session, each player fights their own fully independent set of zombies - the "same session" only means shared position-syncing (Phase 2), not a shared world. Phase 3 makes everyone fight the literal same zombies: one player's shots kill the zombie everyone else sees too.

This picks up the "Shared zombies" item from the original master design doc (`docs/superpowers/specs/2026-08-21-multiplayer-design.md`, Phased build plan #3), but is written fresh against the *current* architecture - that doc assumed the browser talks to Firebase directly; since then, this project built a full server-side proxy (`docs/superpowers/specs/2026-08-24-multiplayer-proxy-design.md`) specifically because ad blockers broke direct-Firebase traffic. Every design decision below builds on the proxy (`api/multiplayer/*`), not the old direct-RTDB assumption.

## Scope for this phase

**Shared:** plain melee zombie types with no special attack/defense mechanic - the common ones a player fights most (shamblers, runners, feral dogs/children, brutes, crawlers, and any other type that's melee-only with no ranged attack, no self-destruct, no burrowing, no shield). Concretely: any type that is not one of the boss tiers (`colossus`, `titan`, `broodmother` - `Game.js`'s existing `BOSS_TIER_IDS`) and has no special-mechanic flag in `ZombieTypes.js` (ranged/spit attack, explode-on-death, burrow, shield, scream-summon). The exact final list needs a pass over `ZombieTypes.js`'s 29 `typeConfig` entries against this criteria at implementation time - this spec defines the *rule*, not a hand-verified exhaustive list, since some type names alone don't fully reveal their mechanics.

**Still solo-only for now** (each player keeps fighting their own independent copy, unchanged from today): all three boss tiers, and every special-mechanic type (exploders, spitters, screamers, burrowers, shielded, and similar). Extending sharing to these is real future work - each one needs its own extra synced fields (an exploder's detonation timing, a spitter's projectile, a shielded zombie's shield health) that adds complexity beyond this phase's scope.

**Explicitly out of scope, unchanged from the master doc:** loot/interactable sharing (Phase 4), reward/anti-cheat integrity (Phase 5), host-disconnect handling and player-count scaling (Phase 6). If the host's tab closes mid-session, the shared run still just ends for everyone, same as today.

## Chosen approach: host stays authoritative, guests self-report hits

**Who simulates, who renders.** The host's `ZombieManager` keeps working exactly as it does in solo play today - same spawning, same AI, no changes. The host additionally broadcasts its zombie state (position, health, which animation state) through the existing sync mechanism, the same way player positions already broadcast. A guest's game does not spawn or simulate its own zombies at all while in a shared session - it only renders whatever the host is broadcasting, using the same visual models each zombie type already has.

**How a guest's shot gets counted.** A guest's own game still does its own hit-detection the instant they fire - same raycast that already exists, so the shot feels immediate (muzzle flash, hit-marker sound, no perceptible lag). Instead of applying that damage itself, it reports "I hit zombie #12 for 40 damage" to the host on the next routine sync call (a few times a second, same cadence as position updates). The host applies that damage to its real zombie on its next sync, and the confirmed health/death state reaches everyone (including the shooter) on the sync round trip after that - typically well under half a second.

This was a deliberate simplicity-over-strictness choice: the alternative (host re-validating every shot against its own copy of the world before counting it) is the more cheat-resistant approach real competitive shooters use, but it's a substantially bigger, well-known-hard engineering problem (lag compensation - rewinding the world to when the shot was fired) and can make shots feel inconsistent for whichever player isn't the host, since the host's view of a non-host player's position/aim is always a little stale. For a casual friends game with nothing valuable at stake, trusting the shooter's own client-reported hit is the right tradeoff - consistent with this project's existing stance (real anti-cheat work was already deferred to Phase 5 in the original plan, not snuck into this phase).

## Data flow

Extends the existing `api/multiplayer/sync` endpoint rather than adding new ones - same merged write-and-read-in-one-call shape already established for player positions.

**Request** (new optional fields, alongside the existing player-position fields):
- From the host only: `zombies: [{ id, x, z, rotY, health, maxHealth, state, type }, ...]` - a snapshot of every currently-alive shared-type zombie.
- From any guest: `hits: [{ zombieId, damage, headshot }, ...]` - a batch of shots resolved locally since their last sync call (batched, not one call per shot, so a fast-firing weapon doesn't need one network round trip per bullet).

**Response** (added to what every player, host included, already gets back):
- `zombies: { [zombieId]: { x, z, rotY, health, maxHealth, state, type, updatedAt } }` - the host's latest broadcast snapshot, for guests to render from.

**Server-side storage** (still fully behind the Admin SDK proxy - the browser never touches Firebase directly, unchanged from the proxy's whole reason for existing):
```
multiplayerSessions/{sessionId}/world/
  zombies/{zombieId}: { x, z, rotY, health, maxHealth, state, type, updatedAt }
  pendingHits/{autoId}: { zombieId, damage, headshot, fromPlayerId }
```

The server determines "is this caller the host" itself, from the session record it already stores (`host` field, set once at creation) - not from a client-supplied flag, so a client can't just claim to be the host. On the host's own sync call, the server delivers any `pendingHits` accumulated from guests in its response and clears them (so the host's own game can call the zombie's real damage method locally), and stores whatever `zombies` snapshot the host just sent. On a guest's sync call, the server appends any `hits` the guest sent into `pendingHits`, and includes the current `zombies` snapshot in the response.

## Client-side rendering (guest side)

A guest needs to *see* a real zombie model (not a placeholder), matching whichever of the 29 types the host reports, without running any of that type's AI/pathfinding logic - the same principle already used for other players in Phase 2 (a lightweight class that renders network-driven state, never simulates).

Rather than build a whole parallel zombie-rendering system, this reuses `Zombie.js`'s own constructor (it already knows how to build the correct visual model per type) but adds one new method - `applyNetworkState(x, z, rotY, health, maxHealth, state)` - that a guest calls instead of the normal `update(...)` AI method. It positions the model, updates the health bar, and switches walk/idle/death animation based on the state the host reports, without touching any pathfinding/aggro/attack-decision code at all. Game.js gets a `_renderSharedZombies(zombiesSnapshot)` method, following the exact same lazily-create/reuse/remove-when-gone pattern `_renderRemotePlayers` already uses for other players.

A guest's own weapon system keeps raycasting against these zombie models exactly like it already does in solo play (no changes to `WeaponSystem._fire()`'s hit-detection itself) - the difference is what happens on a hit: a network-driven zombie's `onHit()` doesn't apply damage locally at all, it just queues `{zombieId, damage, headshot}` for the next sync call instead.

## Payload size

At a typical 9-18 zombies alive (spiking toward a 50-zombie hard cap under horde mutators/high difficulty - see the original master doc), a zombie snapshot adds roughly 1-1.5KB to each sync call at normal counts, growing toward ~4-5KB in the heaviest horde scenarios. This is a real increase over Phase 2's player-only payloads but stays comfortably within Vercel's free-tier bandwidth at hobby scale (a handful of friends playing). Matching the original master doc's own stance: revisit with real measured numbers once this is actually running, rather than guessing a hard limit now.

## Testing approach

Same as every prior multiplayer phase - no test suite exists for this project, verification is by driving the real running game with two simultaneous browser sessions (Playwright), checking that a zombie's health/death state written by the host is observed by a guest within a reasonable delay, and that a guest-reported hit actually reduces the host's real zombie's health.
