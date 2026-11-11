# Team Battle upgrade batches (picked 2026-11-11)

Gaymi: "add everything", one batch at a time, a fresh prompt after each one.
Mix of auto-battle team building and creature raising.

- [x] **Batch 1 - Levels, trigger powers, types** (shipped 2026-11-11). Max level 20,
  up one rarity at 10 and 20, a 2nd "trigger" power at level 5 (Creatures.TRIGGERS),
  Zombie > Animal > Skeleton > Zombie for +30%. Powers & types guide on the Pets tab.
- [x] **Batch 2 - Team combos, snacks, shiny catches** (shipped 2026-11-11). Gaymi picked:
  tiered combos, all 4 snacks with no per-team limit, shiny = +5% health and attack,
  ghost teams keep combos + shinies but never snacks. Built as: Creatures.COMBOS
  (Zombie Pack 3/5/7 health, Bone Crew 3/5/7 speed, Wild Pack 3/5/7 attack, Thick Skin
  2/4 dinos, Flock 2/4 flyers dodge, Boss Squad 2/3; members only, a creature can be in
  2 groups), SNACKS (Steak 50, Bandage 80, Candy 40, Shield Cookie 60; eaten when a
  battle starts, even if you leave), SHINY_ODDS 200 rolled in addCreature. Pixel-art
  snack icons (no emoji rule), shiny = hue-rotate + gold star. Bot teams get combos too.
  Original plan:
  - Combos: bonus for 3+ of a group on the team (e.g. 3 skeletons: +10% speed;
    2 dinos: thick skin). Show active combos on the Team page and the battle.
  - Snacks: feed one creature an item before a battle (steak +attack, bandage = one
    revive), bought with coins, used up after the battle.
  - Shiny: 1 in 200 catches is a recolour with a sparkle; shows on cards and in battle.
- [x] **Batch 3 - Pack Leaders** (shipped 2026-11-11). Gaymi picked: all 26 biomes,
  fought from the Pets tab AND met in their biome, fixed ladder unlocked in order,
  badge + bigger first-win prize (no rematches). Built as: PackLeaders.js (LEADERS
  easiest first, leaderTeam tuned to a rising power curve 70 -> 3000 - always
  stronger than the one before; dinos from leader 8, boss zombie from 22; prize
  100 + 10 per step, loss 5; save `gayz-pack-leaders`), PackLeaderWorld.js
  (s.leaders: the biome's leader 12-30 blocks away, beam in badge colour, raft on
  water, Use to battle; no damage while battling). TeamBattle againKey -> false
  hides the again button.
- [x] **Batch 4 - Gauntlet mode** (shipped 2026-11-11). Gaymi picked: coins only,
  3 lives, buy + sell + reroll, both bots and real players. Built as: Gauntlet.js
  (Pets tab section under Pack Leaders; 10 gold a round, leftovers kept; shop of 5
  at 3 gold, reroll 1, sell half back; slots 3 -> 7; 3 same kind + same stars ->
  +1 star = level 1/10/20 and +1 rarity; 15 coins a win, +100 for the 10th; no XP;
  bots = botRun, the same shop played greedily for as many rounds; players =
  gauntletTeams/{uid}_{round} in Firestore, fetched once per 10 min, 40 newest,
  matched by battle number; save `gayz-gauntlet`). Online part needs the rules
  paste (firestore-rules-2026-11-11-gauntlet.txt); until then always bots.
