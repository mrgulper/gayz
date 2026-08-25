# Multiplayer Phase 5: Reward & Progress Integrity Design

## Goal

Every one of the ~20 reward/progression systems a zombie kill touches (coins, points, XP, kill-count stats, achievements, quests, bounties, weapon mastery, weapon challenges, cosmetic skin unlocks, weekly challenges, kill feed, and more) currently credits only whoever is hosting a shared session, regardless of who actually landed the killing shot - because `Game.js`'s `_onZombieKilled` only ever runs on the host's own client. This phase makes every one of those systems correctly credit whichever player actually earned it, adds a minimum-time-in-session guard against banking rewards from a session someone barely joined, and builds cross-player credit for the Last Stand revive mechanic (either player's kills count toward reviving whoever's currently downed).

## Current gap, in detail

`ZombieManager.update()` detects a zombie's death and calls `onZombieKilled(...)` - but this only ever fires on the host, since only the host runs the real zombie-AI/death-detection loop at all (every earlier phase gated a guest out of that simulation entirely). A guest's own hit gets applied to the host's real zombie via the existing `hits`/`pendingHits` relay, but the resulting death - and therefore every reward it grants - is purely a host-side event with no concept of "which player actually fired the finishing shot."

Research into `_onZombieKilled`'s full ~200-line body (and everything it calls) found the reward systems split cleanly into two categories:

**Personal** (should follow whoever gets credit for the kill) - coins, points, kill-count stats (`kills`/`totalKills`/`killCountsThisRun`/`killCountsByWeapon`), kill streak, weekly challenge progress, bounty progress, trader quest progress, weapon mastery/challenges (including their skin/reload-speed rewards), achievements (`first_blood`, `centurion`, `elite_hunter`, `meat_grinder`, `bestiary_master`, `brute_knife`, `road_kill`), bestiary-encountered tracking, combo counter, kill feed entries, boss killcam, the two non-airstrike killstreak rewards (damage boost, infinite ammo), and every toast/popup tied to these.

**World-state** (must stay host-only regardless of who gets credit, since only the host's own instances of these systems are the real ones that get broadcast to everyone) - every loot-drop spawn (`pickups.spawnLootDrop`/`spawnKillDrop`, including the guaranteed-every-10th-kill drop, carrier-zombie drops, boss guaranteed drops, power-up drops), XP gem spawning (`xpGems.spawn` - see "XP gems need the same fix Phase 4 gave ground loot" below), fester's gas hazard zone, the Boss Gauntlet mutator's next-boss trigger, the random death-obstacle spawn, and the killstreak Airstrike reward specifically (it calls `zombies.damageInRadius(...)`, which only means anything against the host's real zombies).

**XP gems need the same fix Phase 4 gave ground loot.** `XpGems.js` is a separate manager from `PickupManager` (not touched by Phase 4 at all) with the identical structural gap ground loot had before that phase: `xpGems.spawn(x, z, value)` only ever runs on whichever client processes the kill (today, only the host), so a guest never even sees an XP gem appear, let alone collect it. Since XP is one of the three reward types this phase's own name calls out ("coin/point/XP crediting"), this needs the exact same treatment Phase 4 gave ground loot drops (id-based host broadcast, guest collects locally and reports back) - without it, "XP crediting" has nothing to actually deliver XP through in a shared session.

**Last Stand's cross-player revival is new work, not a data-flow fix.** Per Gaymi's explicit choice, either player's kills should count toward reviving whoever is currently downed - today "downed" is purely local state (`this.playerDowned`/`this.downedKillsNeeded`) with no concept of another connected player at all. This needs its own small broadcast (who's downed, how many kills they still need) and a way for any kill - by either player - to decrement it and trigger a revival on the correct player's own client.

## Chosen approach

### 1. Track who gets credit for each kill

The server already knows which player reported each hit (`fromPlayerId` is already stored per pending hit - see `api/multiplayer/sync.js`'s existing `pendingHits` handling from Phase 3) but this never currently reaches the zombie or the death-detection callback. Threading it through: the host's own reported-hit processing (`zombie.onHit(hit.damage, { bypassShield: hit.bypassShield })`) gains `fromPlayerId: hit.fromPlayerId`; `Zombie.js`'s real `onHit` stores whoever most recently hit it (`this._lastHitFromPlayerId = opts.fromPlayerId ?? null`, overwritten on every hit regardless of source - `null` means the host's own local shot, matching every existing call site's default); `ZombieManager`'s death-detection passes `zombie._lastHitFromPlayerId` through to `onZombieKilled` as a new trailing parameter, `creditPlayerId`.

### 2. Split `_onZombieKilled` into world-effects and personal-rewards

The host always runs the world-effects half locally (unconditionally, regardless of who gets credit - this is unchanged from today's behavior for those specific lines). The personal-rewards half runs on whichever client actually gets credit: if `creditPlayerId` is `null` (the host's own kill, or solo play), it runs locally exactly as today - zero behavior change. If `creditPlayerId` names a specific guest, the host relays the kill's parameters (zombie type, weapon, elite/wandering/golden/fleeing/carrier flags - everything the personal-rewards half needs, nothing position-dependent since none of the personal-reward logic touches world coordinates) to that guest over the same per-player delivery mechanism `remoteDamage` already established, and that guest's own client runs the personal-rewards half locally, mutating its own `this.coins`/`this.achievements`/etc. exactly the way host kills already do today.

### 3. Share XP gems the same way Phase 4 shared ground loot

`XpGems.js` gets the identical treatment `Pickups.js` got in Phase 4: a real id per gem, a guest-side `sharedGems` array and proximity-collect method, a `_renderSharedGems` method mirroring `_renderSharedPickups`, host broadcast + guest collect-and-report + host removes-without-double-granting. The host's own XP gem spawning (part of the world-effects half above) is what populates the broadcast, exactly like a loot drop.

### 4. Cross-player Last Stand revival

The host broadcasts a small `downedPlayers` list (which connected players are currently downed, and how many more kills each one needs) - built from the host's own downed state plus any guest-reported downed state (a player becoming downed is itself a small new report, the same shape as everything else this session has built). Every kill - by any player - decrements every currently-downed player's remaining count (checked as part of the world-effects half, since it needs the host's authoritative view of who's downed); a player whose count reaches zero gets a small relayed "you're revived" message, applied via the exact same local `_reviveFromLastStand()` method that already exists, unchanged.

### 5. Anti-abuse guard

Per Gaymi's explicit choice to include it: a player who joined a shared session less than `MIN_SESSION_TIME_FOR_REWARDS_MS` ago (proposed: 30 seconds, long enough that a legitimate player couldn't reasonably object, short enough that it never gets in the way of normal play) has their kill credit silently fall back to the host instead of themselves - not blocked, not an error, just routed to whoever's actually been there. This guards against the specific abuse the master doc called out (join a session, snipe an easy/lucky kill, leave with rewards) without needing a working anti-cheat system - the fallback-to-host behavior means there's no invalid state to handle, just a different (and safe) crediting choice.

## Data flow changes

Extends the existing `api/multiplayer/sync.js` endpoint, following the same patterns already established:

- Host's outgoing payload gains `killEvents` (broadcast per-recipient like `remoteDamage` - each entry addressed to a specific `creditPlayerId`, carrying everything the personal-rewards half of `_onZombieKilled` needs), `xpGems` (broadcast like `pickups`), and `downedPlayers` (broadcast like `chests`/`windows` - a small list, keyed by player id).
- Any player's outgoing payload gains `collectedGemId` (report, same shape as `collectedPickupId`) and `becameDowned`/`revivedSelf` (small reports for the new downed-state tracking).
- Guest's own reported hits (`hits`) already implicitly carry the guest's own identity via the server-assigned `fromPlayerId` - no new field needed there, just the existing value finally being used.

## Scope notes

- This phase does not attempt server-side validation of a guest's self-reported kills/hits (same deliberate simplicity-over-strictness choice Phase 3 already made and documented) - a guest's client still resolves and reports its own hits, trusted the same way it already is.
- Rewards that are pure per-run local flavor with no persistence (e.g., the kill feed text, the boss killcam) are treated as "personal" even though they're not literally currency - the reasoning is the same either way (whoever earned the kill should see their own kill feed/killcam, not the host's).
- Environmental melee kill bonus points (a kill landed inside an active hazard zone) stays personal - it's `_gainPoints`, no different from the function's other point grants.

## Testing approach

Same as every prior phase - two real Playwright browser contexts against a deployed build. New checks this phase needs: force a guest-credited kill (spawn a zombie, apply enough simulated guest-reported damage to kill it) and confirm the GUEST's own coins/points/kill-count/achievements changed, not the host's; confirm a loot drop from that kill still appears in the host's real `PickupManager` (world-effect, unaffected by credit); confirm an XP gem from that kill appears on both screens and only the collecting player's XP changes; confirm the pre-30-second-guard case correctly falls back to crediting the host; confirm a downed host can be revived by a guest's kill and vice versa.
