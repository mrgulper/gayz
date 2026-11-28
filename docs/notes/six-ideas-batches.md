# Six new ideas (2026-11-27)

Gaymi asked "what could we do more to the game" and then said "do all but
do them 1 by 1". One batch per session, in this order. Answers to the
questions asked on 2026-11-27 are written into each batch.

1. **Mode voting** - DONE (PR #514, 2026-11-27). At the end of every party round
   (servers and solo with bots), 3 modes show up: the one you just played
   plus 2 random others. Everyone taps one (keys 1-3 too). Bots vote at
   random. Most votes wins (a tie = random pick among the tied). Not on
   Deathmatch / Team Deathmatch / Duel / Obstacle Course servers - they
   have their own maps / server tabs. Code: `src/game/PartyVote.js`,
   `BuildSurvival.switchPartyMode`, API `api/_lib/servers.js` (host may
   change a party server's mode to another vote mode; `n` + mode index
   hits).
2. **Pet racing** - DONE (2026-11-27). Your pet races 5 bot pets; bet camp
   coins on any of them. Answers: pick your racer each race; speed + level
   + luck + Cheer (Use key / Cheer button, x1.25 for 1 s, every 3 s); each
   pet has its own odds (1000 practice races x 0.88); bets 10/50/100/Custom
   up to 500, no daily limit. The camp walls are full, so a Race Post stands
   on open ground and the track is built in the sky above the camp
   (RACE_Y 160, TempBlocks, glass rim), you stand by the finish and come
   back after. Solo only (not servers/party/TD/escape). Only coins you come
   out ahead count toward the coins kept after the run. A save mid-race
   keeps the post spot, not the sky. Code: `src/game/CampRace.js`
   (`camp.race`, `race.lib` for tests), text `i18n/race-*.js`, test camp
   "Pet Races: ...". Guessed numbers: TRACK 18, pace 1.8 b/s (~10 s
   races), luck 0.6-1.4, form +/-12%.
3. **Fossil digs** - DONE (2026-11-27). Answers: both ways to find bones -
   any underground block of the world's own rock (y -3 or lower) has a 1%
   chance, and Bone Block pockets (Underground.js ORES, -6..-170) always
   give one per block; every dinosaur (DINO_IDS, new ones join by
   themselves) has 5 bones (Skull, Ribs, Spine, Legs, Tail), the famous 6
   on the front row; small skeletons; 150 camp coins per finished one. A
   bone is always a missing one. The camp has no free ground, so the
   "Fossil Hall" is the museum's sky wing (HALL_Y 130, TempBlocks, glass
   rim): Museum screen > Visit the Fossil Hall; Use goes back down. Solo
   visits only; bones anywhere. Code: `src/game/Fossils.js` (bones, KEY
   `gayz-fossils`, `digForBone` from BuildSurvival.onBlockMined),
   `src/game/CampFossils.js` (`camp.fossils`, skeletons from DinoKinds
   boxes), text `i18n/fossil-*.js`, test camp "Fossil digs: ...". Guessed
   numbers: 1% chance, Bone Block 0.003, 150 coins.
4. **Bug net** - DONE (2026-11-27). Answers: the Bug Net is both bought
   (Shop > Items, 45) and crafted (3 Plant Fiber + 1 log); it catches every
   bug (BUG_IDS, 31 kinds - flying and ground ones, not the big friendly
   spider or sea life); a caught bug becomes a Bug Jar of its kind
   (`jar_<kind>`) in your bag, sold at Shop > Items > Sell Bug Jars (in-game
   coins by rarity, JAR_PRICE); the Bug Book (Inventory > Bug Book) pays
   homepage coins at 25/50/75/100% (100/250/500/1200). Hold the net and
   click near a bug (REACH 3.5 blocks, in front of you) - no roll. Pets are
   never caught. Servers: only the host's net catches (a guest gets a
   message). Couch Co-op Player 2's shop doesn't sell it (`p1Only`). Code:
   `src/game/BugNet.js` (net, jars, book, `s.bugNet.lib` for tests), text
   `i18n/bugnet-*.js`, test camp "Bug Net: ...". Guessed numbers: all of
   the prices above, reach 3.5.
5. **Camp shop stand** - DONE (2026-11-27). Answers: use-up things only
   (food, materials, potions, fuel, ammo boxes, med kits - not keep-forever
   gear, guns or armour; `FAIR` lists them, every `meat_<kind>` too); each
   has a fair price, you pick Cheap x0.7 / Fair / Pricey x1.5 / Custom and
   how many (1 / 5 / All); too dear = they haggle once (accept / no; no and
   they leave), way too dear = they walk off; pays camp coins. A Shop Stand
   stall on open ground in the camp (next to the Race Post), up to 4 kinds
   on it; while you're within 14 blocks a survivor walks up every ~6 s (2
   at once). Items stay in your bag until sold; locked slots never sell;
   the stand's list isn't saved with the game. Solo and servers (each
   player's own customers), not party/TD/escape. Code:
   `src/game/CampStand.js` (`camp.stand`, `stand.lib` for tests), text
   `i18n/stand-*.js`, test camp "Shop Stand: ...". Guessed numbers: all of
   `FAIR`, want 0.75-1.3 x fair, haggle up to 1.5 x, 15 s to answer.
6. **Shrink ray** - DONE (2026-11-27). Answers: weaker too (bites for 1/3,
   takes x2 damage while tiny); battery refills (8 zaps, one back every 4 s,
   never used up); bosses / big ones shrink less and shorter (0.6 size, 3 s;
   others 0.35 size, 6 s); servers: the host shrinks it so everyone sees it
   (snapshot `sk`, guest zap = hit `shrink: true` via PlayNet.queueShrink,
   api/_lib/servers.js passes it; cleanZombie now also passes hd/ys/mu, which
   it used to drop). Found in Loot Chests (3%) and supply crates (15%), only
   if you don't have one; Couch Co-op Player 2's chests never give it. Beam
   24 blocks, walls stop it (not glass/leaves). Tiny zombies squeak instead
   of moaning (Audio `squeak`, caption). Corpses now keep the zombie's size
   (mutants too). Code: `src/game/ShrinkRay.js` (`s.shrinkRay`, `.lib` for
   tests), text `i18n/shrink-*.js`, test zombies "Shrink Ray: ...". Guessed
   numbers: all of the above.

All six batches done.

Guessed numbers (ask how they feel when the area comes up): vote time 12 s.
