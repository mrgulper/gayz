// Coin Flow (2026-11-27): anonymous daily totals of where coins come from
// and where they go, so the owner can see which prices and rewards are off.
// Two wallets:
//   bank = your saved coins (the homepage's coin count)
//   camp = the coins you earn and spend inside one game (camp shop)
// Each earn/spend spot calls game._playStats.countCoins(cat, key, n);
// PlayStats.js adds them up and sends one total per group now and then,
// and api/_lib/playStats.js only keeps groups from these lists.
export const COIN_CATS = {
  // Saved coins in: coins carried over from a game, level-ups, login
  // streak, quests, daily/weekly challenges, playtime milestones, selling
  // (skins and market sales), crate prizes, gifts and codes from staff,
  // friend mail, pets (battles, raids, tournaments, book), wins in party
  // modes / camp wheel, other rewards (world goal, birthday, book, clan).
  bankIn: ['games', 'levels', 'login', 'quests', 'challenges', 'milestones', 'selling', 'crates', 'gifts', 'mail', 'pets', 'wins', 'rewards', 'other'],
  // Saved coins out: shop skins, cosmetics, bundles, deals, effects, the
  // player market, crates, pets (pet shop, snacks), friend mail gifts.
  bankOut: ['skins', 'cosmetics', 'bundles', 'deals', 'effects', 'market', 'crates', 'pets', 'mail', 'other'],
  // In-game coins in: zombie kills, bosses, waves, quests and missions,
  // chests and finds, mini-games, map places (UFO, pirate ship...), skills.
  campIn: ['kills', 'bosses', 'waves', 'quests', 'chests', 'minigames', 'places', 'skills', 'other'],
  // In-game coins out: camp shop items, traps/towers, upgrades, fast
  // travel, special blocks.
  campOut: ['items', 'traps', 'upgrades', 'travel', 'specials', 'other'],
}
// Most one group may add in one message (a page sends a total at most
// once a minute; the biggest single prize is a 100,000-coin gift).
export const COIN_MAX = 100000
