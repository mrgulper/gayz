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

## Big shop plan (2026-11-25, Gaymi: "make the shop have everything")
Gaymi picked all 8 new sections, one batch per session, in this order:
1. **Way more skins** - SHIPPED 2026-11-25: 32 skins in 8 new sets
   (Pirates, Space, Food, Sports, Royalty, Ninja, Robots, Spooky), drawn in
   `scripts/shop-skins-sets-2.mjs` (imported by make-shop-skins.mjs; uses
   3 shade levels so the PNGs pack ~3x smaller). Set filter buttons
   (`.shop-skin-set-chip`, All + 11 sets) above the grids. Names checked
   against Market: Knight/Shadow Ninja/Robo exist, so Jester/Oni Mask/
   Retro Bot instead. Test: panels "Shop: More Skins sells 44 skins".
2. **Gun skins** - SHIPPED 2026-11-25: `GunSkins.js`, 8 skins (Jungle Camo,
   Arctic Camo 10k, Neon 25k, Gold 50k, Lava 50k, Galaxy 75k, Rainbow 100k,
   Diamond 150k coins - prices a guess). ONE skin paints every gun
   (`settings.gunSkin`, owned in `shopCosmetics`). Third kind in
   ShopEffects `EFFECT_KINDS.gun` (`#shop-gunskins`, `#cosmetics-gunskins`).
   `paintGun(root, id)` swaps materials (keeps the model's normal map; each
   mesh remembers `userData.gunBaseMaterial`); `holdWeapon(..., skin)` for
   bodies. Shown: hand gun (`BuildTryMode._showGun`, `_gunModel`), own body,
   others online (PlayNet state `gskin`, server passes it), Inspect,
   thrown gun. NOT on Couch Co-op P2 / party-mode bots. Rainbow slides,
   Lava/Neon pulse via material.onBeforeRender. Gallery > Weapon is no
   longer Coming Soon: the 8 skins as Shop-style cards (look only) + Open
   the Shop button. Tests: panels "Shop: Gun Skins", play "Gun skins",
   servers "hats with capitals", gallery.
3. **Back items + hats** - SHIPPED 2026-11-25: new Back slot
   (`settings.cosmeticBack`, worn WITH hat + cape; `BackItems.js`: 4 wings
   that flap - harder while moving - and 4 packs; sits further out when a
   cape is on, `placeBack`). 10 hats (boxes in FunnyZombies `HAT_BOXES`,
   `STRAIGHT_HATS` don't tilt) + 6 capes + 8 back items in Cosmetics.js with
   `need: { shop: 'buy' }, price: [currency, amount]` (coins 10k-50k, gems
   250-1,000 - a guess). `ShopCosmetics.js` fills `#shop-hats`,
   `#shop-capes`, `#shop-backs` (after Bundles); Inventory > Cosmetics has
   `#cosmetics-backs`. Online: PlayNet state `back`, server passes it.
   Shop buys don't count as "new hat unlocked". Tests: panels "Shop: Hats,
   Capes and Back Items", servers "hats with capitals".
4. **Daily Deals + Crate Spin** - SHIPPED 2026-11-25 (Shop's Coming Soon
   section is gone). `ShopCatalog.js` = every single Shop item (More
   Skins, shop hats/capes/backs, kill effects, trails, gun skins; not
   bundle-only parts) with own/grant/use helpers; 1 gem = 100 coins
   (`GEM_IN_COINS`, a guess). Daily Deals (`ShopDeals.js`, `#shop-deals`
   at the top of the Shop): the day's shuffle (seeded by the Los Angeles
   date) -> first 3 you don't own, remembered in localStorage
   `gayz-daily-deals` for the day; each 20-50% off (steps of 5, seeded);
   countdown `#shop-deals-timer`. Crates are ON (`CRATES_COMING_SOON`
   false; Monthly Chest still Coming Soon), prices Wood 5k / Ice 20k /
   Golden 50k (Gaymi). `CrateSpin.js`: Shop price button = buy + spin;
   card click = bulk-buy to Inventory; Inventory > Crates Open = spin one
   you own. Prize given before the reel (`#crate-spin-modal`) slides; click
   the reel to skip. Odds in `CRATE_PRIZES` (item 30/35/40%, item cap
   25k/75k/any, cheaper items likelier, coin piles) - a guess; average
   worth ~4k / ~13k / ~31k per crate. Duplicate item = 25% of its worth in
   coins. Test: panels "Shop: Daily Deals and Crate Spin".
5. **Pet + ride looks** - SHIPPED 2026-11-25: `PetRideLooks.js`. Gaymi
   picked hats + REAL recolours (a bought paint is the one exception to
   "pets keep their wild look"), on every pet, and one paint for every ride.
   8 pet hats (FunnyZombies hat shapes, scaled to the head: `addPetHat`),
   6 pet paints, 7 ride paints (coins 10k-100k - a guess). Three more
   ShopEffects kinds (`petHat`, `petPaint`, `ridePaint`; `#shop-pethats`,
   `#shop-petpaints`, `#shop-ridepaints`, same rows in Inventory >
   Cosmetics), settings `petHat` / `petPaint` / `ridePaint`.
   `paintModel(root, id, 'pet'|'ride', ownMats)`: clones materials (keeps
   `userData.paintBase` for `unpaint`); pets: everything but very dark bits,
   tinted brighter over fur/skin pictures (`texLum`); rides: only coloured
   parts (greys/blacks stay) + `userData.paint`; `noPaint` skips (hats,
   bow, glow, collar, red eyes). Rainbow cycles in onBeforeRender.
   On: Pet Zombie (hat replaces bow + wild hat), tamed animals
   (`PlayAnimals._dressPet` each frame, only re-done when the look
   changes), homepage pet, go-kart, bike, hoverboard, boats/heli/balloon/
   sub/jet ski. Online: state `phat` / `ppaint` / `rpaint` (server passes
   them); the host's animal snapshot `t` is now the owner's player id, so
   guests dress other players' pets; remote vehicles repaint from `rpaint`.
   NOT on Couch Co-op P2, skateboards, sleds. Tests: panels "Shop: Pet
   Hats, Pet Paints and Ride Paints", play "Pet and ride looks".
6. **Jump + death effects** - SHIPPED 2026-11-25: `JumpDeathEffects.js`.
   Jump: Cloud Puff / Hearts / Lightning / Rainbow Ring; death: Tombstone /
   Ghost / Firework / Explosion (looks only). 10k/25k/50k/100k coins each
   (Gaymi: Kill Effects ladder). Two more ShopEffects kinds (`jump`,
   `death`; `#shop-jumps`, `#shop-deaths`, `#cosmetics-jumps`,
   `#cosmetics-deaths`), settings `jumpEffect` / `deathEffect`. PlayFx got
   `heart` + `puff` textures and `emit()`. Jump hook: BuildTryMode's normal
   jump -> `survival.onJump()` (not swim jumps, not spectating). Death:
   `_die` (not on a win). Ghost + tombstone are box models in
   `s._deathProps` (updateDeathProps each frame). Online: state `jfx`,
   `dfx`, `jn` (jump count; server passes all 3); PlayNet plays a remote
   jump when `jn` goes up and a death on alive->dead. NOT Couch Co-op P2.
   Tests: panels "Shop: Jump Effects and Death Effects", play "Jump and
   death effects".
7. Name + chat style (glowing/rainbow name, chat bubbles, profile frames).
8. Sounds + music packs (kill sounds, menu music).
PRs #475-477 (Kill Effects, Walk Trails, higher prices) shipped together in
#477 on 2026-11-25 after main was merged in; the ladder test's CI failure was
timing (now waits with expect.poll).
