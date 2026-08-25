# Multiplayer Phase 4: Shared Loot/Interactables Design

## Goal

Share the three interactable systems the original master doc's Phase 4 called out (`docs/superpowers/specs/2026-08-21-multiplayer-design.md`) - ground loot drops, chests/the Vault, and barricade window repairs - so two players can't double-claim the same drop, chest, or repair credit, and so a guest actually sees these things happen at all (today a guest sees none of them - see "Current gap" below).

## Current gap (why this isn't already working)

All three systems - `PickupManager` (`Pickups.js`), `ChestManager`/`Vault` (`Chests.js`), `BarricadeWindows` (`BarricadeWindows.js`) - are driven by each client's own independent instance, updated once per frame from `Game.js`'s `_tick()`. In solo play this is correct. In a shared multiplayer session it silently breaks in the same way Phase 3 originally found for zombies: a guest's own copies of these systems still exist and still render, but nothing ever populates or changes them for a guest, because:
- Ground loot only ever spawns from a kill (`spawnKillDrop`) or a chest opening, both of which currently only ever fire on whichever client's own code path processes that event - for a shared kill, that's the host only.
- Chests/barricades don't sync at all today - each client's own chest/window objects track their own `opened`/`planks` state independently, with no communication between them.

Net effect: a guest in today's shared sessions never sees a single loot drop, chest, or barricade repair match what the host sees. This phase fixes that.

## Chosen approach: host-authoritative for existence/state, local for who benefits

Same overall shape as every earlier multiplayer phase: the host's own simulation stays the source of truth; guests render from what the host broadcasts. The one new idea this phase needs: **whoever physically interacts with something applies its effect to themselves locally** (their own ammo/health/inventory, their own "I opened this"), then tells the host what happened so the host's own copy - and therefore everyone else's next broadcast - reflects it. This mirrors the existing guest-reports-a-hit pattern from Phase 3, just generalized to picking up loot, opening a chest, or contributing to a repair.

### Ground loot drops (dynamic - needs real ids)

Loot spawns at runtime (kill locations, chest contents), so each drop needs an id, the same way zombies do. The host's sync payload gains a `pickups: [{id, type, x, z}, ...]` snapshot of every currently-active drop (built from `PickupManager`'s own list, which already needs each `Pickup` instance to carry a real id - it doesn't today, just array position). A guest renders these the same lazily-create/reuse/remove-when-gone way `_renderSharedZombies` already does, reusing `Pickups.js`'s own visual-building code (no AI/logic, purely cosmetic + a proximity check against the *guest's own* position). When the guest's own proximity check triggers a collect, the guest applies the pickup's effect to itself immediately (existing `_onPickup` handler, unchanged) and reports `{collectedPickupId: id}` to the host on the next sync. The host removes that id from its own real `pickups` array (so it stops broadcasting it) without running its own pickup handler for it - the guest already applied the effect to itself, so this only removes the item, it doesn't double-grant it.

A host's own local pickup collection (walking into a drop themselves) needs no changes - already works exactly as today.

### Chests & the Vault, and barricade windows (fixed positions - no ids needed)

Both systems are placed at positions derived from this project's deterministic world generation (`World.js`'s `buildingLayout()`, confirmed by this project's own CLAUDE.md as seeded arithmetic with no `Math.random()`) - every client constructs the exact same chests/windows, in the exact same order, every time. This means state can sync by plain array index instead of needing new ids at all: the host's sync payload gains `chests: [bool, ...]` (opened, one entry per chest in construction order) and `windows: [{planks}, ...]` (one entry per window). A guest applies these directly to its own already-existing chest/window objects (just the state, not rebuilding anything) purely for rendering (a chest that shows as opened, a window with the right plank count) - no local chest/window simulation runs for a guest, same "host is sole simulator" precedent Phase 3 established for zombies.

Opening a chest or repairing a window works the same "local effect, then report" way as loot: whichever player opens a chest gets its real loot locally (existing `Chest.open()` logic, unchanged) and reports `{openedChestIndex: i}` to the host, which marks that chest opened in its own real `ChestManager` (so it stops handing out loot to anyone else who tries) and reflects the change in the next broadcast. Barricade repair (a repeated, held action rather than one instant event) reports `{repairedWindowIndex: i, amount: n}` each sync call while the guest is actively repairing; the host applies that amount to its own real window via the same `BarricadeWindows.repair()` method already used for a local repair.

## Data flow changes

**Request** (`POST /api/multiplayer/sync`): host sends `pickups`, `chests`, `windows` (the three broadcast snapshots above); any player (host or guest) can send `collectedPickupId`, `openedChestIndex`, or `{repairedWindowIndex, amount}` - all optional, matching the existing pattern where a field is only meaningful from whichever side actually has something to report.

**Response**: everyone gets the current `pickups`/`chests`/`windows` snapshots (broadcast, like `zombies` and `worldEvents` already are - not filtered per-recipient, since both players need to see the same loot/chest/window state). Reports (`collectedPickupId` etc.) are relayed to the host the same way guest-reported zombie hits already are - the host is the only one that needs to actually apply them, since it owns the real simulation.

**Server-side storage**: `multiplayerSessions/{sessionId}/world/pickups` (keyed the same non-numeric-prefixed way `world/zombies` is, for the same Firebase sparse-array reason already fixed once this session), `world/chests` and `world/windows` (plain arrays are fine here specifically because chest/window count and order are fixed for the whole session - no risk of a sparse gap the way zombie ids have).

## Scope notes

- Reward/kill-credit integrity for loot (same caveat Phase 3 already carries for zombie kills) isn't newly introduced here - whoever physically collects a drop or opens a chest already gets its real benefit under this design, which is the more intuitive behavior for loot specifically (unlike a zombie kill, "who gets credit" for picking something up more naturally means "whoever walked up to it").
- Doors: this project doesn't currently have a distinct "door" interactable system separate from barricade windows - nothing else needed here beyond the three systems above.
- Minigun/audio log unique pickups (`spawnUnique`) go through the exact same `pickups` broadcast as regular loot drops - no special-casing needed, they're still just `Pickup` instances with an id.

## Testing approach

Same as every prior phase - two real Playwright browser contexts against a deployed build. New checks this phase needs: force a kill-drop near the guest and confirm the guest's own inventory/ammo actually changes (not the host's) and that the drop then disappears from the host's own broadcast (no double-collect); have the guest open a chest and confirm the host's own `ChestManager` marks it opened (and that a second attempt from either player yields nothing); have the guest hold a repair action against a damaged window and confirm the host's real plank count increases.
