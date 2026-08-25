# Multiplayer Phase 3b: "Group A" Shared Zombie Types Design

## Goal

Phase 3 (shipped, see `2026-08-24-multiplayer-phase3-shared-zombies-design.md`) made 11 plain melee zombie types shared across a multiplayer session, and deliberately left 17 "special-mechanic" types solo-only (each fought independently per player) because each needed its own extra design work. This phase covers the 4 cheapest of those 17 - `shielded`, `screamer`, `stalker`, `burrower` - bringing shared coverage to 15 of 29 types. The remaining 13 (ranged attackers, death-effect types, bosses) stay solo-only; they're bigger, separate pieces of future work.

## Scope for this phase

**Added to `SHARED_ZOMBIE_TYPE_IDS`:** `shielded`, `screamer`, `stalker`, `burrower`.

**Deliberately NOT included:** `screamer_swarmer`. It shares `screamer`'s scream mechanic, but also bursts into 2 new `shambler` zombies on death (`summonOnDeath`/`summonType` in `ZombieTypes.js`) - spawning new zombies mid-session needs its own snapshot-id-assignment design (a host-simulated zombie that spawns needs a new id the guest can pick up in the very next sync, and this phase's data flow doesn't cover that), so it's left for whichever future phase covers death-effects/spawning.

**Still out of scope, unchanged:** every ranged type (spitter, spitter_bomber, anchor, siren, webber), every death-effect type (exploder, fester, acid_trail, brittle, spitter_bomber again), and all 3 bosses (colossus, titan, broodmother). Same reasoning as the original Phase 3 spec - these need real new data flow (a synced projectile, a synced hazard-zone event, spawn-id assignment), not just guest-side rendering catch-up.

## A bug in already-shipped Phase 3, fixed by this same work

While designing `burrower`'s support, a real gap turned up in the 11 types already shared today: `ZombieManager._spawnRandom` rolls **any** non-ranged type into "ambush" mode (dormant, squashed flat like a corpse, popping upright once a player gets close) at a 55-85% chance (`this.ambushChance`, `ZombieManager.js:791`) - this already applies to every currently-shared type (shambler, runner, brute, etc.), not just burrower.

`Zombie.js`'s `applyNetworkState` (the method a guest calls to render a network-driven zombie) has no handling for the `dormant`/`popping` states at all today - it only branches on `alive`/`popping` for the health bar, and `dying`/`dead` for the death clip. The squash-flat-then-pop-up visual is entirely inside `update()`'s own per-frame branches, which a network-driven zombie never runs. Net effect: **right now, if an ambush zombie spawns in a shared session, the guest's screen shows it standing at full height immediately, instead of playing dead until the host's player closes in** - a real, already-live visual mismatch (the two players don't see the same thing at the same moment), even though position/health/death state all sync correctly otherwise.

This phase's `burrower` work fixes this generally (burrower just always rolls ambush, so it can't ship without the fix), and the fix benefits all 11 already-shared types too.

## Chosen approach: no new data flow, just guest-side rendering catch-up

Every fix in this phase reuses data the game already sends (position, health, `state` string) or needs at most one new small field per type. Nothing here adds a new endpoint, a new request/response shape change beyond the fields listed below, or a new simulation concept on the host. All of it is really about teaching `applyNetworkState` (which currently only knows how to move a zombie and switch a couple of animations) to also replicate a few small per-type visual behaviors that today only run inside `update()`.

### Shielded

No new synced field needed. A guest's own weapon system already resolves damage locally and reports `{ zombieId, damage, bypassShield }` to the host (existing Phase 3 plumbing) - `bypassShield` is set from `w.armorPierce` at the point `WeaponSystem._fire()` calls `onHit()`. The real shield-health pool only ever exists on the host's own `Zombie` instance (which already handles it correctly in solo play), so once `shielded` is in the shared list, this works as-is - **except** for one real bug this phase fixes: a network-driven zombie's `onHit()` currently forwards only `opts.bypassShield` to the queued hit report, silently dropping the fact that `this.lastHitWeaponId === 'melee'` should *also* bypass the shield (melee always bypasses in solo play, matching the `blockedByShield` check in the real `onHit`). Fix: fold `this.lastHitWeaponId === 'melee'` into the bypass flag before it's queued, so a guest's melee hit against a shared shielded zombie is honored correctly when the host replays it.

### Screamer

The scream's actual effect (waking nearby dormant zombies, briefly speeding up others) is entirely a host-side simulation concern already - it only ever touches other zombies that get broadcast in the normal snapshot anyway, so it needs no new data at all to function correctly for a guest.

The one purely cosmetic piece - a screamer's throat glowing brighter for about half a second when it screams - is invisible to a guest today since it's computed in `update()`'s per-frame render branch. Per your call to include it: the host's zombie snapshot gains one new boolean per zombie, `screaming` (true exactly while the host's own `screamPulseUntil` timer is active). A guest's `applyNetworkState` starts its own local 500ms pulse the first time it sees `screaming: true`, and fades the throat material the same way the host's own code already does. Since this only updates at the sync call's cadence (a few times a second) rather than every rendered frame, the glow will step rather than smoothly ramp - the same minor tradeoff every other network-driven visual in this game already accepts.

### Stalker

No new synced field needed. The fade-in-as-you-approach effect is already computed from the *local* player's own distance to the zombie (`update()`'s `stealthy` branch, `Zombie.js` around line 1599) - a guest computing this against its own camera position gets the correct per-player fade with no extra data. The only change needed is for `applyNetworkState` to run this same distance-to-opacity calculation itself (it currently doesn't run any of `update()`'s per-frame branches), which means it needs the guest's own player position as a new parameter it doesn't currently take.

### Burrower

As covered above - `applyNetworkState` needs its own `dormant`/`popping` handling, mirroring `update()`'s existing scale/eye-glow lerp:
- `dormant`: squash to the same flattened look (`scale.y = baseScale * 0.35`, dimmed eye glow) every call, so it's correct immediately even for a zombie the guest is just now seeing for the first time.
- `popping`: lerp scale/eye-glow from the flattened look to full height over the zombie's own `popDurationMs` (already computed at construction, same jittered-per-instance value every `Zombie` gets), timed from a local timestamp recorded the moment the guest first observes the state flip from `dormant` to `popping` - not from the host's own pop-start time, since that's never transmitted. This is a cosmetic approximation (the guest's local pop animation won't be frame-for-frame identical to the host's), but reaches the correct end state (full height, `alive`) at essentially the same real time, since the host's own state flip to `alive` arrives in the very next sync or two after that.

The ambush *trigger* itself (deciding when a dormant zombie wakes up) stays entirely host-side, based only on the host's own player distance - consistent with the whole shared-zombie model, where no zombie AI decision ever factors in a guest's position. This is a pre-existing characteristic of every already-shared type's aggro/wander behavior too, not a new limitation this phase introduces.

## Data flow changes

**Request** (`POST /api/multiplayer/sync`, host's `zombies` array): each entry gains one new optional field, `screaming` (boolean) - only meaningful for `screamer`-type entries, harmless/ignored for every other type.

**Response**: unchanged shape - `screaming` just rides along inside the same per-zombie snapshot object already returned.

**No other server-side changes.** `api/multiplayer/sync.js` already stores and forwards whatever fields are in each snapshot entry without inspecting them individually - `screaming` needs no explicit handling there at all.

## Client-side changes (summary - exact code in the implementation plan)

- `ZombieTypes.js`: add the 4 ids to `SHARED_ZOMBIE_TYPE_IDS`.
- `Game.js`'s `_syncNetworkPlayerState` (host branch): include `screaming` in each mapped zombie snapshot entry.
- `Zombie.js`'s `onHit` (network-driven branch): fold `this.lastHitWeaponId === 'melee'` into the forwarded `bypassShield`.
- `Zombie.js`'s `applyNetworkState`: gains a new parameter for the guest's own local player position (for `stalker`'s opacity), and new branches for `dormant`/`popping` (scale/eye-glow) and the `screaming` flag (throat glow), alongside its existing position/health/death-state handling.
- `Game.js`'s `_renderSharedZombies`: passes the guest's own current camera/feet position into `applyNetworkState`'s new parameter.

## Testing approach

Same as Phase 3 - no test suite, verification via two real Playwright browser contexts against a deployed preview/production build. This phase specifically needs to force each of the 4 types to spawn (rather than wait on random spawn odds) and, for `burrower`/ambush verification, needs to check the guest's zombie is squashed (`scale.y` near `baseScale * 0.35`) immediately after first appearing, then confirm it reaches full height within a few seconds of the host's player approaching. Shield/scream verification checks the guest-reported melee hit still damages health past a shield, and that the `screaming` flag arrives at least once during a scream cooldown window.
