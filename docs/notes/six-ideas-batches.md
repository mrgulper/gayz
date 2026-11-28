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
4. **Bug net** - catch the flying insects (creatures already exist) and fill
   a Bug Book, like the Zombie Book / Pet Book.
5. **Camp shop stand** - sell spare loot (food, materials, extra items) to
   the NPC survivors walking by. You set a price; too high and they walk
   away.
6. **Shrink ray** - a rare loot gun (chests / crates) that makes zombies tiny
   and squeaky for a few seconds.

Guessed numbers (ask how they feel when the area comes up): vote time 12 s.
