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

# Auto-battler shop upgrade (picked 2026-11-23)

Gaymi: make pet battles more like auto-battler shop games. Picked: KEEP the
arena fight (no line-up), freeze, food in the shop (new fruit), shop powers,
drag to reorder, tiers that unlock, a daily pet shop for coins, and more
realistic arena textures. Two batches, shop stuff first.

- [x] **Batch A - Shop stuff** (shipped 2026-11-23). Gauntlet.js: POOL in 5
  tiers sorted by real power (shopTier = new tier every 2 battles; dinos now
  tier 4/5, DINO_FROM gone); FOODS row of 2 (apple +15 hp, honey +3 atk, pear,
  berries = whole team, melon +40 hp; fruit = bh/ba on the run creature, added
  in Creatures.stats, summed on merge, caps MAX_BH/MAX_BA; the 4 snacks cost
  gold and last one battle, eaten when the fight starts); Freeze per shop/food
  slot (run.frozen); bots spend leftover gold on fruit. Fruit is NOT in
  packTeam, so a team saved for other players is a bit weaker. Reorder.js:
  drag (mouse) / hold-then-drag (touch) on the Team page's picked team and the
  Gauntlet team; order = where they stand (first ones front). PetShop.js:
  4 creatures a day picked from the date (any zombie/skeleton/monster/animal,
  rarity as often as in game), coins by rarity (PRICES, a guess: 60 to 2000),
  save `gayz-pet-shop` { day, bought }. Tests: team.spec "Gauntlet food...".
- [x] **Batch B - Shop powers + arena textures** (shipped 2026-11-23). Gaymi
  picked: every creature has one from 1 star; arena detailed but still blocky.
  Gauntlet.SHOP_POWERS, one per battle power: horde Gather (bought: other
  zombies +4 hp), bones Scrap (sold: +1 gold), rage Feast (end: itself +1
  atk), stomp Rally (end: team +3 hp), pounce Share the Hunt (sold: friends
  +1 atk), roar Rule (bought: 2 front friends +2 atk), hide Graze (end:
  itself +4 hp), heal Picnic (sold: friends +3 hp). Times stars. Boosts are
  fruit (bh/ba, same caps). "End of a shop round" = pressing Fight, once
  per battle (run.eor); botRun uses buy + end. Shown as a gold line on
  Gauntlet cards (tooltip has the text) and in the Pets guide. Numbers are
  a guess. Arena: TeamBattle floorCanvas/dirtCanvas/woodCanvas, 16 px per
  block, seeded, drawn once; worn dirt in the middle, flowers, wood grain;
  rails are 1-block instances; 2D caches the board picture (board2d).

# Pet battles round 3 (picked 2026-11-23)

Gaymi: "do them all". One batch per session, questions first. Order is
mine (smallest first, live online last).

- [x] **Batch C - Nicknames** (shipped 2026-11-23). Gaymi picked: everyone
  sees them, up to 50 letters, each creature picks if its kind shows.
  Creatures.js: c.nm (name) + c.nk (show kind), cleanNick (no control/bidi
  characters, chat bad-word swap via setNickFilter(_censorText) from
  TeamUI, NICK_MAX 50), creatureName = nickname first, kindName/kindNote,
  shortName for the camp zoo's 3D tag, renameCreature; packTeam sends nm/nk
  (Firestore team list isn't field-checked, no rules paste). TeamUI
  "Nicknames" under the snacks: Rename a creature -> tap a card -> box
  (Enter saves, Esc closes). Cards clamp the name to 2 lines; battle labels
  cut at 130px. Terms + Privacy lines added. Test: team.spec "nicknames".
- [x] **Batch D - Held items** (shipped 2026-11-23). Gaymi picked: 10
  items, random drops, ghost teams keep theirs, Gauntlet sells them for
  gold. Creatures.ITEMS (n = number, w = drop weight; fang, feather,
  helmet, charm, collar, claws, tooth, bone, horn, totem), c.hi on the
  creature (cleanCreature checks it, packTeam sends it - team list isn't
  field-checked, no rules paste), save `items` { id: count } = the bag.
  holdItem (old one back to bag) / takeItem / giveItem / dropItem /
  rollItem. ITEM_DROP: Pack Leader win 50%, tournament round won 30%,
  champion 100% (guess). Battle onEnd may return { coins, item } -> a
  "Found a held item" news line. TeamBattle._applyItems (both sides),
  _itemsAfterHit (tooth, horn, collar), Lucky Bone + claws in _hit, totem
  in _down, charm in _step (CHARM_EVERY 4). TeamUI "Held items" under the
  snacks (game._teamItem: id | 'off'). Gauntlet: items added to FOODS
  (held: true, ITEM_GOLD 4) but NOT in FOOD_IDS; rollFood: from tier
  ITEM_TIER 2 a slot is an item ITEM_ODDS 25%; merge keeps one; bots
  don't buy them. Privacy lines updated. Test: team.spec "held items".
- [x] **Batch E - Arena hazards** (shipped 2026-11-23). Gaymi picked: all 4
  (lava, mud, bounce, + healing flowers), 1 in 3 battles, every kind of pet
  battle (Leaders/Tournament/Gauntlet too), same for both teams, flyers float
  over. TeamBattle.js: HAZARDS (lava 6%/s in 0.5 s burns, mud 50% speed,
  bounce push 12 / 0.5 s air / 1.2 s cooldown, flowers 4%/s - all a guess),
  rollHazard (HAZARD_EVERY 3), hazardCells = "x,z" block corners laid out on
  my half and turned round the middle (fair). Constructor `hazard` option
  (id / null / left out = roll) - tests use it. _hazardStep per fighter
  (only after the start, skipped for flies(c) and mid-bounce), _lift for the
  bounce jump. Pictures: hazardCanvas 16 px tiles, 3D InstancedMesh
  (lava unlit + pulses), 2D drawn into board2d. Banner .tb-hazard in
  .tb-bottom above the hint. Pets guide "Arena hazards" list. Creatures.flies.
  Test: team.spec "arena hazards".
- [x] **Batch F - Eggs + hatching** (shipped 2026-11-23). Gaymi picked:
  Loot Chests, rarer = longer walk, 3 warm at once, rarer = better shiny
  odds. PetEggs.js: EGG_CHANCE 5% per chest (useChest, P1 only, not Couch
  P2), rarity as often as zombies (ZOMBIE_TIERS chance). EGG_WALK common 300
  / uncommon 450 / rare 600 / epic 900 / legendary 1200 / mythic 1500 blocks;
  EGG_SHINY 1 in 200 / 100 / 50 / 25 / 10 / 10 (all a guess). Save `eggs`
  [{ r, d }] in the creatures save (EGG_MAX 13 = 3 warm + 10 waiting).
  EggWalker (s.eggs, made in BuildSurvival setup, stepped in update): flat
  distance from bodyPos, not dead/spectating/menu, >4 blocks in one frame =
  teleport, saved every 5 blocks (walkEggs). Hatch = random zombie /
  skeleton / monster / animal of that rarity (addCreature got an `odds`
  arg). Full (200 creatures): egg waits, tap it on the Pets tab later.
  TeamUI "Eggs" under held items (renderEggs / eggClick: tap waiting = warm
  it, tap ready = hatch). Test: team.spec "pet eggs".
- [x] **Batch G - Friend battles (live)** (shipped 2026-11-23). Gaymi picked:
  button on a friend's profile AND a "Battle a Friend" online list on the
  Pets tab, XP only (no coins - no farming), invite pops up on menus only
  (waits while playing in the world), its own "vs friends" record (fw / fl
  in the creatures save). FriendBattle.js: Firestore petDuels/{id} { from,
  fromName, to, state ask|go|no, at, a, b, seed } (new rules block, file
  firestore-rules-2026-11-23-petduels.txt - needs Gaymi's paste). Challenger
  creates (a = packLive = packTeam + snacks), waits INVITE_S 60 s (timed by
  local clock, seen time on the friend's side), deletes the doc when it
  starts / no / gives up; friend answers in a transaction (b + seed),
  deletes very old ones (STALE_MS 1 h). Same fight on both screens:
  TeamBattle `live` { seed, me, ids } = seeded dice (this.rand), fixed
  LIVE_STEP 1/60 steps, dist() = sqrt instead of Math.hypot (exact in every
  browser), first knock-out decides (_winner), speed button hidden. `mine`
  inside is always the challenger; me = 'foe' turns the view round (3D
  camera, 2D board, cards, rings, labels) and flips the result. Both teams'
  snacks count, only my own get eaten. Leaving = no record; the other
  screen plays on. Not tested with two real accounts (Claude can't sign
  in). Test: team.spec "friend battles".

# Pet battles round 4 (picked 2026-11-24)

Gaymi: "Do all 8". One batch per session, questions first. Smallest
first, online (Firestore) last.

- [x] **Batch H - Cheer** (shipped 2026-11-24). Gaymi picked: pick 1 of
  3 (Attack / Heal / Speed), a meter that fills as your pets take hits,
  every pet battle incl. live friend battles, bots cheer too. TeamBattle.js:
  CHEERS (atk +30% / heal 20% / speed +40%), CHEER_S 5, CHEER_FILL 0.3 =
  full after the team loses 30% of its total health (_fill on hits, collar,
  lava) - all a guess. meter { mine, foe }, cheerQueue { side, kind, at },
  `steps` counts _step calls; _cheerStep lands due cheers, _applyCheer
  re-checks the meter (same on both screens). Bots (not live, botCheer
  option): 0.5-3 s after full, heal under half health else atk/speed.
  UI: .tb-cheer button (fills, glows when full) -> .tb-cheer-pick of 3;
  C / 1 / 2 / 3 keys; small .tb-foe-cheer bar under the foe name; Pets
  guide "Cheer" list. Live: cheer(kind) -> onCheer(kind, at = steps +
  CHEER_LEAD 90) sends first (FriendBattle -> CloudSync sendPetCheers,
  petCheers/{duelId}_{uid} { duel, from, to, c: [step*4+kind], at }),
  lands only once sent; failed send = meter kept + "couldn't reach";
  the friend's list is watched (watchPetCheers) -> friendCheer; doc
  deleted on close (onClose option). A cheer arriving after its step lands
  late (could split the fight if the internet is very slow - XP only).
  NEW RULES block petCheers -> ~/Desktop/GayZ/firestore-rules-2026-11-24-cheers.txt,
  NOT pasted yet (one paste at the end of round 4); until then live
  cheers say "couldn't reach your friend". Privacy line added.
  Test: team.spec "cheer".
- [x] **Batch I - After-battle stats** (shipped 2026-11-24). Gaymi picked:
  damage / healing / taken / knockouts, both teams, points-mix Best Pet,
  always shown. TeamBattle.js: every fighter has st { dmg, heal, took, ko }
  (a Last Groan mini shares its maker's st). Damage = only what really came
  off (capped at health left), incl. Spiked Collar hit-backs; lava = taken
  only. _heal(o, add, by) counts only real health back, credited to the
  healer (Heal Friends, Last Gift) or itself (cheer, charm, tooth, Second
  Wind, flowers; Bandage / Totem count the health they get back up with).
  _down(f, by) gives by a KO (not for lava, not if Bandage/Totem saved it).
  Best Pet score = dmg + heal + KOs x 25% of the average pet's health
  (KO_SCORE, a guess); can be on either team ("(their team)" then).
  _renderStats -> .tb-stats under the XP news (table scrolls past 34vh).
  Test: team.spec "after-battle stats".
- [x] **Batch J - Replays** (shipped 2026-11-24). Gaymi picked: every pet
  battle (incl. tournament / Gauntlet / Pack Leaders / live friend ones),
  last battle always kept + up to 10 saved, THIS DEVICE ONLY
  (ReplayStore.js, localStorage `gayz-pet-replays` { last, saved[] }),
  controls pause/play (Space) + speed x1/x2/x4 + restart + skip to end,
  Pets tab "Replays" button -> list (PetReplays.js; Watch / Save on the
  last, Watch / Delete (2 taps) on saved). Result screen: Watch Replay +
  Save Replay. How: EVERY battle now has a seed (this.rand = seeded(seed))
  and runs fixed LIVE_STEP steps (non-live: at most 0.25 s a frame x
  speed, paused = 0). Which hazard still rolls Math.random outside friend
  battles (rec.hz stored; rec.hs = rolled from the seed). Record (rec):
  { v, seed, hs, hz, lv, me, bc, foe, ghost, mine, theirs (JSON copies at
  start), ch: [step, side 0/1, kind] for EVERY cheer that went off (bots
  too), t, won }. A replay re-rolls the same dice (bot cheer logic runs
  but doesn't push - the recording's cheers land instead), no XP / coins /
  snacks eaten / cheering. playReplay(rec) in TeamBattle.js;
  TeamBattle.track(b) (set in TeamUI) sets game._teamBattle. Tests that
  forced dice must now set b.rand, not Math.random. Known limit: a replay
  saved before a future balance change (stats, powers) may play out
  differently - no version check beyond REPLAY_V. Test: team.spec
  "replays".
- [x] **Batch K - Collection book** (shipped 2026-11-24). Gaymi picked:
  grid + tap to open, page = basics + my record + where to find it, coins
  at milestones, pets already owned count (eggs / Pet Shop too - all go
  through addCreature). 447 pages (Creatures.bookKinds: plain zombie, every
  MONSTER_KINDS, SKELETON_KINDS, animals, then dinos; a boss counts for its
  kind). Saved IN gayz-creatures: book { 'a:cow' / 'z:' / 'z:mage': { n,
  f first caught, lv best, s shiny } } + bp [milestones paid]; noteCatch in
  addCreature, syncBook (on render) fills from pets owned. BOOK_PRIZES
  25% 150 / 50% 400 / 75% 800 / 100% 2000 coins (a guess), paid when the
  book renders (PetBook.updateBook -> toast). PetBook.js: Pets tab
  "Collection Book" button -> #pet-book (count + bar, fixed-height page
  box, group buttons, search finds caught kinds only, card grid 46vh
  scroll). Where: BIOME_ANIMALS + DINO_BIOMES biome names (4 + "N more"),
  zombies realm / "anywhere" / spider "eggs and Pet Shop". Zombie pictures
  = ZombieBook.bookPictures (3D, fall back to the pixel face - the 3D ones
  never showed in the headless test, not checked in a real browser).
  New i18n key book_spider. Test: team.spec "collection book".
- [x] **Batch L - Weekly challenge** (shipped 2026-11-24). Gaymi picked:
  ladder of 5, all rule types, coins + held item + badge, own Pets tab
  section (offline). WeeklyChallenge.js: RULES (10, one a week by
  TeamTournament.weekId % 10: skeleton / level1 / random / animal / bare /
  zombie / trio / hazard / dino / common). weeklyTeam: kind weeks = my
  strongest of that bookGroup + loaners (common lv 1, loan: true, no id =
  no XP) up to TEAM_MAX 5; random = seeded from the week (same for
  everyone); else picked team (first 5, trio 3). applyRule on both teams
  (copies keep id, so XP reaches real pets): level1 (l 1, x dropped),
  common, bare (no sn / hi). foeTeam: seeded kinds, rarity + level tuned
  to my power x STEP_POWER [0.75 .. 1.25]. Hazard week = a set hazard per
  battle. STEP_COINS 25, LOSS 5, WEEK_COINS 500 + rollItem + badge
  { week, rule } (BADGES_KEPT 20) - all a guess. Save
  `gayz-weekly-challenge` { week, step, badges }. Lose = retry that step.
  No "double speed" twist (the x2 button already does it). i18n in
  weekly-<lang>.js. Test: team.spec "weekly challenge".
- [x] **Batch M - Pet battle leaderboard** (shipped 2026-11-24). Gaymi
  picked: trophies, only the Pets tab Battle button counts, All-time top
  50 + This week + Friends + my place, rank badge only (no coins).
  PetRank.js: trophyChange = win 20 x (foe power / mine, clamped 0.5..2,
  max 40), loss 10 / that ratio (5..20), never below 0. RANKS Bronze 0 /
  Silver 300 / Gold 800 / Platinum 1500 / Diamond 2500 / Champion 4000
  (all a guess). Saved in gayz-creatures: tr + tw { w: weekId, n }.
  TeamUI onEnd -> applyTrophies + pushTrophies (signed in only; also once
  when the Leaderboard opens) -> CloudSync.savePetTrophies:
  petTrophies/{uid} { nickname, tr, at } + petTrophyWeeks/{week}/entries/
  {uid} { nickname, n, tr, at } (at = serverTimestamp). Lists read only
  when opened, cached 2 min; my place = COUNT of higher scores + 1;
  Friends = getDoc of each savedFriends uid (max 5) + me. Anonymous Mode
  sends "Anonymous". Result screen: "+N trophies" (+ "New rank: X!") at
  the end of the news list. #pet-rank-line under Wins/Losses; button
  #pet-rank-btn (ONLINE_ONLY) -> #pet-rank (tabs, fixed 40vh list).
  NEW RULES block petTrophies + petTrophyWeeks: a new doc <= 5000,
  then at most +40 per 5 s since the last write (server clock). File
  ~/Desktop/GayZ/firestore-rules-2026-11-24-pettrophies.txt (cheers file +
  this), NOT pasted (one paste at the end of round 4) - until then the
  lists say "couldn't load". Known limit: trophies are per device (the pet
  save isn't in Cloud Save); two devices on one account overwrite each
  other's number. Terms + Privacy lines added. i18n rank-<lang>.js.
  Test: team.spec "pet battle leaderboard".
- [ ] **Batch N - Pet trading with friends.** Like Skin Trades (online).
- [ ] **Batch O - Co-op boss raid.** Two friends' teams vs one giant
  boss (online, biggest).
