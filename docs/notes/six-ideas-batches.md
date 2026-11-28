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
2. **Pet racing** - race + bet. Your pet races 5 bot pets on a track at
   camp. Before the race, bet coins on any pet; a win pays back more.
3. **Fossil digs** - dinosaur bones underground; dig them up and build full
   skeletons in the Camp Museum.
4. **Bug net** - catch the flying insects (creatures already exist) and fill
   a Bug Book, like the Zombie Book / Pet Book.
5. **Camp shop stand** - sell spare loot (food, materials, extra items) to
   the NPC survivors walking by. You set a price; too high and they walk
   away.
6. **Shrink ray** - a rare loot gun (chests / crates) that makes zombies tiny
   and squeaky for a few seconds.

Guessed numbers (ask how they feel when the area comes up): vote time 12 s.
