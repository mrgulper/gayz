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

## Big shop plan (2026-11-25, Gaymi: "make the shop have everything")
Gaymi picked all 8 new sections, one batch per session, in this order:
1. **Way more skins** - SHIPPED 2026-11-25: 32 skins in 8 new sets
   (Pirates, Space, Food, Sports, Royalty, Ninja, Robots, Spooky), drawn in
   `scripts/shop-skins-sets-2.mjs` (imported by make-shop-skins.mjs; uses
   3 shade levels so the PNGs pack ~3x smaller). Set filter buttons
   (`.shop-skin-set-chip`, All + 11 sets) above the grids. Names checked
   against Market: Knight/Shadow Ninja/Robo exist, so Jester/Oni Mask/
   Retro Bot instead. Test: panels "Shop: More Skins sells 44 skins".
2. Gun skins (paint jobs for weapons; Gallery's Weapon tab is Coming Soon).
3. Back items (wings, backpacks) + 15+ buyable hats and capes.
4. Daily Deals + Crate Spin (the two Coming Soon cards).
5. Pet + ride looks (pet hats/colours, car/kart paint).
6. Jump + death effects (like Kill Effects).
7. Name + chat style (glowing/rainbow name, chat bubbles, profile frames).
8. Sounds + music packs (kill sounds, menu music).
Open: PRs #475-477 (Kill Effects, Walk Trails, higher prices) still not
merged on 2026-11-25 - CI failed (#477: panels "homepage unlock ladder").
