# Shop + skins + pets plan (2026-11-25)

Gaymi: "design more skins and give more ideas to put on the shop". Picked
(answers = the go-ahead, one batch per session):

1. **12 new skins in Shop > More Skins** (replaces that Coming Soon card).
   Winter: Snowman, Gingerbread, Elf, Ice Golem. Survivor jobs: Lumberjack,
   Medic, Firefighter, Hazmat. Creatures: Frog, Bee, Lava Golem, Dragon.
   Price mixes by rarity: Common-Rare cost coins (MARKET_PRICES), Epic and
   up cost gems.
2. **Pets move.** New "Pets" button on the homepage right column, ABOVE
   Map Editor, holding everything pet-related from Inventory > Pets (team,
   Pet Book, team + friend battles, Pet Raids, Pet Rank, replays, trades).
   The daily Pet Shop and Pet Eggs move into Shop instead. Inventory's
   Pets tab goes away. Panel same size as every other panel.
3. **Bundles:** a skin + hat + cape sold together at a discount.
4. **Kill effects:** zombies burst into confetti / snowflakes / pixels.
5. **Walk trails:** sparkles / footprints / snow puffs behind you.

Status: batch 1 shipped 2026-11-25 (More Skins). Batch 2 shipped 2026-11-25:
`#pets-btn` (above Map Editor, unlock tier 3) opens `#pets-panel` (holds
`#team-page`, route `/pets`, TeamUI.openTeamPanel); Shop > Pets is `#shop-pets`
(`#pet-shop` + `#team-eggs`, drawn by renderTeamPanel from `_openShopPanel`,
same click handler; team CSS uses `:is(#team-page, #shop-pets)`).
Batch 3 shipped 2026-11-25 (Bundles, 3 of them, 30% off): `ShopBundles.js`
fills `#shop-bundles` (after More Skins). Bundle-only hats/capes in
Cosmetics.js have `need: { shop: bundleId }`; owned ones are
`game.shopCosmetics` in the shop save (additive Cloud Save, like charSkins).
Hat/cape worth (`PART_VALUES`) is a guess. Test: panels.spec "Shop: Bundles".
Batches 4-5 answers: kill effects + walk trails are BOUGHT in the Shop
(coins), picked in Inventory, and everyone online sees them.
Batch 4 shipped 2026-11-25 (Kill effects): `KillEffects.js` (data, burst,
icon), `ShopEffects.js` fills `#shop-effects`; Inventory > Hats & Capes
has a Kill Effects row (`#cosmetics-kills`). Owned in `shopCosmetics`, used
= `settings.killEffect`. Online: PlayNet state `kfx`; host sets `z.kfx` to
the last hitter's effect and sends `fx` in the zombie snapshot; clients
burst it when the zombie leaves the snapshot. Prices (1,500/1,500/2,500
coins) are a guess. Tests: panels "Shop: Kill Effects", zombies "Kill effects".
Batch 5 shipped 2026-11-25 (Walk trails): `WalkTrails.js` (`TrailMaker`
per walker; sparkles + snow puffs are PlayFx sparks, footprints are a pool
of 48 flat prints per scene that fade in 4 s). `ShopEffects.js` now handles
both kinds (`EFFECT_KINDS`), `#shop-trails`, `#cosmetics-trails`. Used =
`settings.walkTrail`; online state `trail` (server passes `kfx`, `trail`,
zombie `fx`; hat ids with capitals pass too since this batch). Prices
(2,000/1,500/2,000 coins) are a guess. Tests: panels "Shop: Walk Trails",
play "Walk trails", servers "hats with capitals".
All 5 batches done.

Prices tuned 2026-11-25 (Gaymi: "way higher"): bundles Winter 10,000 /
Firefighter 25,000 coins, Dragon 1,000 gems (`BUNDLES[].price`, shown as
30% off price/0.7; an owned skin's Shop price comes off). Kill effects
10k / 25k / 50k, trails Footprints 10k / Snow Puffs 25k / Sparkle 100k coins.
Inventory tab "Hats & Capes" renamed "Cosmetics" (same `#inventory-tab-cosmetics`).
