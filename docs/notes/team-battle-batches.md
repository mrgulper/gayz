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
- [ ] **Batch 3 - Pack Leaders.** One boss trainer per biome with a themed team.
  Beat them for a badge on the Team page.
- [ ] **Batch 4 - Gauntlet mode.** Separate run: start with coins, buy random
  creatures from a small shop each round, 3 copies merge into a stronger one,
  win 10 battles before your lives run out. Doesn't touch caught creatures.
