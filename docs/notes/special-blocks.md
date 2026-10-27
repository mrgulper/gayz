# Special blocks (150 working blocks, started 2026-10-27)

Gaymi asked for "100-200 new special blocks" (like a bell that does something). Agreed: all 150 ideas, built in 15 batches of 10, one PR each, usable everywhere blocks are (Map Editor picker + Try Map + Play). Zombies don't break blocks (they only bash doors), so "breakable like other blocks" = same as today.

## How it's built
- `src/game/SpecialBlocks.js` - the list: id, name, description (English, like block names), look (base + glyph), and what it does (`fx`). Added to `BLOCK_TYPES` with `game: true` (Special picker category, no slab/stairs, not breakable/flammable like the other game blocks). Pads (`shape: 'pad'`) for floor things.
- `src/game/SpecialGlyphs.js` - the 16x16 pictures: a base material plus a small symbol (glyph) per block.
- `src/game/BuildSpecials.js` - `bm.specials`, the runtime: keeps where every special block is, runs triggers (use / step on / near / zombie near / timers / power) while trying or playing, and the effects.
- Hooks: BuildMode place/remove + `_tryUseFromCamera`; BuildTryMode.update (player); BuildSurvival (zombie targets, speed, damage, revive, kills, coins); PlaySpectate (zombie effects while spectating).
- Temporary world changes (crumble, gate, trees) go through `tryMode._broken` / `survival._placed` so the map is put back after Try/Play.
- Per-block runtime state (radio station, locker contents...) is not saved in the map file; it lasts for the run.

## Batches (idea numbers from the original list)
1. Alarm Bell, Zombie Repeller, Bait Block, Spike Block, Reinforced Barricade, Campfire, Teleporter Pad, Crop Plot, Disco Block, Scoreboard
2. Siren Tower, Tripwire Chime, Wind Chime, Doorbell, Megaphone Post, Radio, Echo Stone, Silence Block, Horn Block, Piano Block
3. Garlic, Holy Lantern, Cage, Zombie Counter, Fake Player, Grave, Infection Cleanser, Wave Bell, Cursed Block, Time Slow
4. Bear Trap, Trapdoor Pit, Fire Trap, Sticky Floor, Swinging Blade, Mine, Net Launcher, Crumble Block, Ice Slick, Flame Jet Floor
5. Smoke Bomb, Sound Trap, Shield Generator, Barbed Wire, Sandbag, Watchtower Base, Boiling Oil Pot, Cannon, Catapult, Murder Hole
6. Generator, Solar Panel, Wire, Battery, Button, Timer, Motion Sensor, Light Sensor, Logic Gate, Arrow Shooter
7. Electric Fence, Auto Turret, Searchlight, Repair Station, Gate, Piston, Sticky Piston, Conveyor Belt, Fan Pusher, Magnet
8. Med Station, Bed, Bandage Box, Speed Pad, Jump Pad, Strength Totem, Coffee Machine, Water Well, Sauna Stone, Lucky Clover
9. Fan Block, Elevator, Zipline Post, Bounce Block, Slide Block, Rope Anchor, Rail Track, Launch Cannon, Wind Tunnel, Speed Rail
10. Boat Dock, Checkpoint Flag, Portal, Locker, Shared Chest, Weapon Rack, Ammo Box, Workbench Upgrade, Recycler, Fridge
11. Cooking Pot, Anvil, Trash Can, Vending Machine, Mailbox, Safe, Mystery Box, Slot Machine, Wishing Well, Clone Block
12. Sprinkler, Beehive, Compost Bin, Tree Sapling, Mushroom Log, Fish Trap, Chicken Coop, Flower Pot, Rain Collector, Greenhouse Glass
13. Scarecrow, Colour Lamp, Torch Post, Flicker Light, Firework Launcher, Fog Machine, Snow Machine, Bubble Block, Confetti Cannon, Hologram
14. Glow Paint, Black Light, Dice, Trophy, Arcade Machine, Drum, Countdown Sign, Start/Finish Line, Basketball Hoop, Photo Booth
15. Voting Block, Gravity Flip, Shrink Pad, Grow Pad, Mirror Block, Ghost Block, Weather Stone, Day/Night Switch, Random Block, Invisibility Pad

## Simplified on purpose (tell Gaymi)
Ideas that would need a whole new system get a smaller real effect instead; each block's description says what it actually does. Examples: Portal goes to another portal on the same map (not another map); Mirror bounces half a zombie's hit back instead of showing a reflection; storage blocks hold one stack each (no new storage screen).

## Status
(Updated as each batch ships.)
- Batch 1 shipped 2026-10-27: engine (index, triggers, zombie lure/repel/touch, pads, overlays, floating text, sounds via `audioEngine.playSpecial`, sparkles via `PlayFx.spark`), Vegetables item. Tests: `tests/specials.spec.js` (one test per batch). Special blocks are `game: true`, so they're exempt from the "every full block gets a slab and stairs" rule, like the other game blocks.
- Batch 2 shipped 2026-10-27: sounds use `_sound()` (remembered in `_lastSound` for tests); `onShot` hook in BuildSurvival.shoot; zombie knockback via `zb._knock/_kx/_kz`; label overlays via `fx.label`.
- Batch 3 shipped 2026-10-27: generic `zaura` (slow/dps/curse) and `trap` kinds; `shielded()` checked in `_hurtPlayer`; `onKill` in `damageZombie`; Grave calls `_spawnZombie(spots)`.
- Batch 4 shipped 2026-10-27: `trap` grew burn/blast; `speedMult`/`gripMult` read by BuildTryMode.update; Crumble removes the block itself (`_crumbled`, put back on time and in stop()). Tests must reset cooldown/`next` state first - real frames run during the test's awaits.
- Batch 5 shipped 2026-10-27: `use()` only reacts for kinds in `USE_KINDS` (+ lures with on 'use') - ADD NEW USABLE KINDS THERE. `_raycastGridAligned(skip)` + `SHOOT_THROUGH`; `hurtMult()` in `_hurtPlayer`; `_repellers()` includes active shields.
- Known flaky (also on main before this work): buildmode "new zombie kinds ... spiders climb" fails ~1 run in 5 (`spiderTop` 1); "Play mode spawns zombie waves" fails ~1 in 5 (`killed`/`corpse`).
