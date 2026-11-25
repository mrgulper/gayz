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
Next: batch 4 (Kill effects).
