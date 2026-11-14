// The reading pages: GayZ Features (counts, values and lists filled from the
// code), Patch Notes / What's New (gated to the player's own midnight, the
// digest, the new-version card), How to Play, Credits, Terms of Use and the
// Privacy Policy.
//
// Moved out of Game.js (2026-10-16, bit by bit - see CLAUDE.md). Plain functions
// taking `game`, all state on the Game instance; Game.js keeps a one-line
// stand-in for each, so callers are unchanged.
import * as ChatUI from './ChatUI.js'
import { HORDE_MULT } from './LiveConfig.js'
import { FEEDBACK_MAX } from './PlayerVoice.js'
import { ACHIEVEMENTS } from './Achievements.js'
import { CHANGELOG_LAST_VIEWED_KEY, Game, HOWTOPLAY_STEPS, LOGIN_CALENDAR_DAYS, MARKET_FEE_RATE, MAX_GOALS, PLAY_META_UPGRADES, PRESTIGE_BONUS_PERCENT, PRESTIGE_COST_STEP, SUPPORTED_LANGUAGE_CODES, UPDATE_BANNER_FADE_MS, UPDATE_BANNER_SHOW_MS, WHATS_NEW_SEEN_KEY, WHATS_NEW_VERSION, saveSettings } from './Game.js'
import { BIOMES } from './OpenWorld.js'
import { TIP_COUNT, TOP_PLAYERS, BIRTHDAY_COINS_PER_YEAR, MAPWEEK_DAYS } from './HomeExtras.js'
import { LEAF_DROP_CHANCE, BOSS_HUNT_EVERY, DEFENSE_WAVES, EXTRACTION_HOLD, FUEL_CANS, GLOBETROTTER_SECONDS, SKELETON_FROM_WAVE, MONSTER_FROM_WAVE, MOB_HEIGHT, SPAWN_MIN_DIST, ZONE_STAGES, ZONE_ZOMBIE_SPEED } from './PlayRules.js'
import { RAINBOW_CHANCE } from './BuildSky.js'
import { DISASTERS } from './Disasters.js'
import { LUCK_MULT, LUCK_SECONDS } from './Luck.js'
import { BOTTOM, DEMON_TOP } from './Underground.js'
import { HEAVEN_FLOOR, HEAVEN_TOP } from './HeavenRealm.js'
import { REALM_KINDS } from './ZombieKinds.js'
import { LOG_MAX } from './SettingsLog.js'
import { BUMP_MAX_DEGREES } from './BlockChunks.js'
import { MAX_WILD, ANIMAL_IDS } from './PlayAnimals.js'
import { START_TRAPS, ITEMS } from './PlayInventory.js'
import { RECIPES, GOO_CHANCE } from './PlayCrafting.js'
import { FARM_GROW_S } from './CampFarm.js'
import { CAMP_MAX, MAX_HELPERS } from './Survivors.js'
import { TEAM_SIZE, MAX_CREATURES, MAX_LEVEL, TRIGGER_LEVEL, WIN_XP, LOSS_XP, EVOLVE_AT, TYPE_MULT, SHINY_ODDS, SHINY_BOOST, SNACKS, COMBOS } from './Creatures.js'
import { WIN_COINS, LOSS_COINS } from './TeamUI.js'
import { ROUND_S } from './TeamBattle.js'
import { BOOK_IDS, BOOK_COINS, BOOK_DONE_COINS } from './ZombieBook.js'
import * as Infection from './Infection.js'
import { HELI_FUEL_S, HELI_CEILING, MAX_OUT, BALLOON_FUEL_S, BALLOON_CEILING } from './Vehicles.js'
import { MAX_PINS } from './MapPins.js'
import { PIECE_CHANCE, PIECES_PER_MAP, COINS as TREASURE_COINS, GEMS as TREASURE_GEMS } from './TreasureMaps.js'
import { MAX_FISH as AQUARIUM_FISH, MAX_GOLDEN as AQUARIUM_GOLDEN } from './CampAquarium.js'
import { BOARD_SPEED, TRICK_COINS, FREEZE_R } from './Skateboards.js'
import { SNOW_SPEED as SLED_SPEED, MAX_BOOST as SLED_BOOST, RUN_MIN as SLED_RUN_MIN, RUN_STEP as SLED_RUN_STEP, SLED_COINS } from './Sleds.js'
import { MAX_SPRINGS, HEAL_PER_S as SPRING_HEAL } from './HotSprings.js'
import { MAX_ZOO } from './CampZoo.js'
import { GRID as LAVA_GRID, WARN_S as LAVA_WARN, REGROW_S as LAVA_REGROW } from './PartyLava.js'
import { KO_S as LASER_KO } from './PartyLaser.js'
import { LAPS as KART_LAPS, BOOST_S as KART_BOOST } from './PartyKart.js'
import { CHECKPOINTS as PARKOUR_CPS } from './PartyParkour.js'
import { HOP_EVERY as CART_HOP, CART_COINS } from './Minecarts.js'
import { LEN_MIN as CART_LEN_MIN, LEN_MAX as CART_LEN_MAX } from './MineTracks.js'
import { GHOSTS as HAUNT_GHOSTS, HAUNT_COINS } from './HauntedHouse.js'
import { GRAB_S as UFO_GRAB, ALIENS as UFO_ALIENS, UFO_COINS } from './Ufo.js'
import { FROM_WAVE as DRAGON_WAVE, FIRE_DMG as DRAGON_FIRE, DRAGON_HP, HOARD_COINS, HOARD_GEMS } from './DragonBoss.js'
import { DUEL_HP, RATING_START as DUEL_START, WIN_PTS as DUEL_WIN, LOSS_PTS as DUEL_LOSS } from './PartyDuel.js'
import { HOLES as GOLF_HOLES, PUTT_REACH as GOLF_REACH, GOLF_ZOMBIES, HOLE_S as GOLF_HOLE_S, MISS_STROKES as GOLF_MISS } from './PartyGolf.js'
import { THAW_S as FREEZE_THAW } from './PartyFreeze.js'
import { SPIN_S as WHEEL_SPIN, BIG_PRIZE as WHEEL_BIG } from './CampWheel.js'
import { NOTE_MAX as POSTCARD_NOTE } from './Postcards.js'
import { GRAVES as GRAVE_GRAVES, RISE_GAP as GRAVE_GAP, GRAVE_COINS } from './Graveyard.js'
import { SPOT_S as LIGHTHOUSE_SPOT } from './Lighthouse.js'
import { DECK_Y as TREE_DECK } from './CampTreehouse.js'
import { HEADLINES as NEWS_HEADS, JOKES as NEWS_JOKES, STORIES as NEWS_STORIES, PER_PAGE as NEWS_PER } from './Newspaper.js'
import { MAX_STACKS as LOST_STACKS } from './LostFound.js'
import { BALLS as PIN_BALLS, BUMPER_PTS as PIN_BUMPER, PTS_PER_COIN as PIN_PER_COIN, MAX_PIN_COINS, CHESS_WIN_COINS, CHESS_DEPTH } from './CampArcade.js'
import { TAME_R as PET_TAME_R, GUARD_R as PET_GUARD_R, PET_DAMAGE } from './PetZombie.js'
import { SOAK_S as WATER_SOAK, SOAK_SLOW as WATER_SLOW, TANK as WATER_TANK } from './WaterGun.js'
import { OPEN_H as WING_OPEN_H, RINGS as WING_RINGS, RING_COINS as WING_RING_COINS, ALL_RINGS_COINS as WING_ALL } from './Wingsuit.js'
import { OUT_S as DODGE_OUT, THROW_S as DODGE_THROW } from './PartyDodge.js'
import { MUSIC_S as CHAIRS_MUSIC, GRAB_S as CHAIRS_GRAB } from './PartyChairs.js'
import { CMD_S as SIMON_CMD, MIN_CMD_S as SIMON_MIN, RUN_DIST as SIMON_RUN } from './PartySimon.js'
import { HIDE_S as PROP_HIDE_S, SEEK_S as PROP_SEEK_S, DECOYS as PROP_DECOYS, PROPS as PROP_KINDS, MISS_SLOW_S as PROP_MISS_S } from './PartyProps.js'
import { BIKE_SPEED, HOVER_SPEED, HOVER_FALL, QUIET_HEAR } from './Rides.js'
import { BLIMP_HP, BLIMP_LIFE, BLIMP_COINS, DROP_EVERY as BLIMP_DROP_EVERY, DROPS_MAX as BLIMP_DROPS } from './ZombieBlimp.js'
import { SIZE as BINGO_SIZE, GOALS as BINGO_GOALS, LINE_COINS as BINGO_LINE, FULL_COINS as BINGO_FULL, FULL_GEMS as BINGO_GEMS } from './ZombieBingo.js'
import { PIZZAS, HOT_S as PIZZA_HOT_S, TIP_S as PIZZA_TIP_S, PIZZA_COINS, TIP_COINS as PIZZA_TIP, COLD_COINS as PIZZA_COLD, SMELL_EVERY as PIZZA_SMELL } from './PizzaDelivery.js'
import { WIN as TUG_WIN, ROUND as TUG_ROUND, MAX_TAPS as TUG_TAPS } from './PartyTug.js'
import { MIN_DROP as BUNGEE_DROP, HANG_S as BUNGEE_HANG, BAG_COINS as BUNGEE_COINS, BAG_ITEMS as BUNGEE_ITEMS, GUARDS as BUNGEE_GUARDS } from './Bungee.js'
import { JET_SEA_EVERY, JET_SEA_MAX, JET_GRAB_S } from './Vehicles.js'
import { DISHES as DINER_DISHES, SEATS as DINER_SEATS, DISH_COINS as DINER_COINS, TIP_COINS as DINER_TIP, TIP_S as DINER_TIP_S, SPOT_COINS as DINER_SPOT, PATIENCE_S as DINER_PATIENCE, REVEAL_S as DINER_REVEAL } from './ZombieDiner.js'
import { WINDOW as LEARN_WINDOW, SHARE as LEARN_SHARE, MAX_LEVEL as LEARN_MAX, LEVEL_CHANCE as LEARN_CHANCE, GEAR_MULT as LEARN_GEAR, FORGET_S as LEARN_FORGET } from './ZombieLearning.js'
import { FIND_FIRST_S, FIND_EVERY_S, FIND_LIFE_S } from './WorldFinds.js'
import { NOTES as MUSIC_NOTES, HEAR_R as MUSIC_HEAR, JAM_R as MUSIC_JAM } from './Instruments.js'
import { BOO_S, BOO_CD, MARK_S, REVIVE_S, GHOST_WAIT_S } from './Ghosts.js'
import { CHAPTERS as STORY_CHAPTERS, CHAPTER_COINS as STORY_COINS, FINALE_COINS as STORY_FINALE } from './Campaign.js'
import { HUNGER_MINUTES, RAW_FOOD, COOKED_FOOD, STARVE_DPS, COOK_R } from './Hunger.js'
import { EXHIBITS as MUSEUM_EXHIBITS, BOSSES as MUSEUM_BOSSES } from './CampMuseum.js'
import { GUARDS as HEIST_GUARDS, ALARM_EXTRA as HEIST_EXTRA, HEIST_COINS, STEALTH_X as HEIST_STEALTH } from './Heist.js'
import { PARK_DIST, FERRIS_S as PARK_FERRIS, GAME_S as PARK_GAME, TICKET_COINS as PARK_TICKET, PARK_ZOMBIES } from './ThemePark.js'
import { ERAS as TIME_ERAS, ERA_S as TIME_ERA_S, ERA_COINS as TIME_COINS, ALL_ERAS_COINS as TIME_ALL } from './TimeMachine.js'
import { NIGHT_S as WOLF_NIGHT, DAY_S as WOLF_DAY, CLAW_R as WOLF_CLAW } from './PartyWerewolf.js'
import { PLANT_S as BOMB_PLANT, BOMB_S as BOMB_TIME, DEFUSE_S as BOMB_DEFUSE, STUN_S as BOMB_STUN } from './PartyBomb.js'
import { DANCE_S, DANCE_R, DANCE_COINS, DAZE_S, COOLDOWN_S as BOOMBOX_COOL } from './DanceOff.js'
import { MAX_RUINS, SEA_ZOMBIES as RUIN_ZOMBIES } from './Reefs.js'
import { PIRATES, PIRATE_COINS, SHIP_LIFE } from './PirateShip.js'
import { STATIONS as TRAIN_STATIONS, CARS as TRAIN_CARS, STOP_S as TRAIN_STOP, CAR_ZOMBIES } from './ZombieTrain.js'
import { MOON_G } from './MoonTrip.js'
import { ROOMS as ESC_ROOMS, ROOM_S as ESC_ROOM_S, WRONG_COST as ESC_WRONG, ESC_COINS, ROOM_COINS as ESC_ROOM_COINS } from './EscapeRooms.js'
import { TROPHIES } from './Trophies.js'
import { ZONE_TOTAL_S } from './ShrinkZone.js'
import { DINO_KINDS, DINO_CHANCE } from './DinoKinds.js'
import { RARITIES } from './NewAnimalKinds.js'
import { ZOMBIE_SHINES, PINATA_COINS } from './ZombieNames.js'
import { DAILY_TEMPLATES, STREAK_STEP, STREAK_MAX_DAYS, streakMult } from './DailyChallenge.js'
import { DEATH_JOB_COUNT } from './DeathJokes.js'
import { HAT_EVERY, CAPE_EVERY } from './FunnyZombies.js'
import { LIFE_S as GOLDEN_LIFE_S, COINS as GOLDEN_COINS } from './GoldenRunner.js'
import { CATCHES, ROD_COST } from './Fishing.js'
import { RADIO_LINES } from './ZombieRadio.js'
import { MAX_SPRAYS, SPRAY_SIZE, SPRAY_COLORS } from './Sprays.js'
import { CHANCE as BLOOD_MOON_CHANCE, FROM_WAVE as BLOOD_MOON_WAVE } from './BloodMoon.js'
import { SPAN as REPLAY_SECONDS } from './DeathReplay.js'
import { PHOTO_FILTERS } from './PhotoFilters.js'
import { JOKE_SIGN_COUNT } from './JokeSigns.js'
import { FREEZE_S, START_SNOWBALLS, WAVE_SNOWBALLS } from './Snowballs.js'
import { POTION_S } from './Potions.js'
import { JET_S } from './Jetpack.js'
import { SPEEDRUN_WAVES, TOP_N as SPEEDRUN_TOP } from './Speedrun.js'
import * as Party from './PartyModes.js'
import { SIZE as DUNGEON_SIZE } from './Dungeons.js'
import { SILLY_TIP_COUNT } from './SillyTips.js'
import { HINT_MAX } from './GameplayAssist.js'
import { MORE_SETTINGS } from './MoreSettingsList.js'
import { COSMETIC_IDS } from './Cosmetics.js'
import { MIN_FPS } from './PlayEntryUI.js'
import { EMOTES } from './Emotes.js'
import { SHOP_TABS, AMMO_FILL_COOLDOWN } from './PlayShop.js'
import { GRASS_GROW_SECONDS } from './GrassTufts.js'
import { PLAY_WEAPONS, HEAVY } from './PlayWeapons.js'
import { LANGUAGES, t, tHtml } from './i18n.js'
import { SPECIAL_BLOCKS } from './SpecialBlocks.js'
import { levelUpCoins } from './Xp.js'
import { PERKS, CARDS as PERK_CARDS } from './RunPerks.js'
import { COINS as ESCORT_COINS, BONUS_XP as ESCORT_XP } from './EscortMission.js'
import { FROM_WAVE as SIEGE_WAVE, BREAK_INS as SIEGE_BREAK_INS, LIMIT_S as SIEGE_LIMIT_S, COINS as SIEGE_COINS, BONUS_XP as SIEGE_XP } from './CampSiege.js'
import { TD_WAVES, LIVES as TD_LIVES, START_COINS as TD_START_COINS, LEAK_BOSS as TD_LEAK_BOSS } from './TowerDefense.js'
import { CONSTELLATION_COUNT } from './NightSky.js'
import { STAMP_COINS } from './Passport.js'
import { TRAVEL_BASE, TRAVEL_PER_BLOCKS, TRAVEL_MOST, TRAVEL_WAIT_S } from './FastTravel.js'
import { SIZE as TOURNEY_SIZE, ROUND_COINS as TOURNEY_ROUND_COINS, CHAMP_COINS as TOURNEY_CHAMP_COINS } from './TeamTournament.js'
import { LEADERS, leaderCoins, LOSS_COINS as LEADER_LOSS_COINS } from './PackLeaders.js'
import * as GT from './Gauntlet.js'

// Update-available check - only ever called from _exitBuildMode (back
// at the homepage), never mid-game, so a fresh deploy
// while someone's playing never interrupts them; they just find out the
// next time they're actually looking at the main menu again. version.json
// carries the exact same build timestamp __BUILD_ID__ was compiled from
// (see vite.config.js) - if they differ, a newer build than the one
// currently loaded exists. Deliberately a timestamp, not the git hash
// __BUILD_HASH__ already carries - confirmed via a real production
// deploy that `vercel --prod`'s upload doesn't include .git, so the git
// hash is always the literal fallback string 'dev' there, useless for
// telling two real deploys apart. The "what changed" content isn't
// duplicated anywhere - it re-fetches the live index.html and reads its
// #changelog-list directly, so there's exactly one place (that list) to
// keep updated, same as today.
export async function _checkForUpdate(game) {
  if (!game.updateAvailableBanner || game.updateAvailableBanner.style.display === 'flex') return
  try {
    const versionRes = await fetch('/version.json', { cache: 'no-store' })
    const { id } = await versionRes.json()
    if (!id || id === __BUILD_ID__ || id === game.settings.lastSeenBuildId) return
    const pageRes = await fetch('/index.html', { cache: 'no-store' })
    const freshDoc = new DOMParser().parseFromString(await pageRes.text(), 'text/html')
    const freshChangelogList = freshDoc.getElementById('changelog-list')
    if (!freshChangelogList) return
    // What's New on game page gets the new notes too, so the card never
    // shows a version the Patch Notes don't have yet (2026-10-12, Gaymi:
    // the card said v0.17 while What's New still said v0.16) - and both
    // only show entries whose day has started on the player's clock.
    const list = document.getElementById('changelog-list')
    if (list) {
      list.innerHTML = freshChangelogList.innerHTML
      game._gateChangelog()
    }
    // Only the newest entry - the card is small; the full list is one
    // click away in What's New.
    const entries = [...(list || freshChangelogList).querySelectorAll('.changelog-entry:not(.changelog-future)')].slice(0, 1)
    if (!entries.length) return
    game.updateAvailableChangelog.innerHTML = entries.map((entry) => entry.outerHTML).join('')
    game._pendingUpdateId = id
    if (game.updateAvailableTitleEl) game.updateAvailableTitleEl.textContent = t('navLinkWhatsNew')
    if (game.updateAvailableRefreshBtn) game.updateAvailableRefreshBtn.textContent = t('updateAvailableRefreshBtn')
    game.updateAvailableBanner.classList.remove('fading')
    game.updateAvailableBanner.style.display = 'flex'
    _fitUpdateBanner(game)
    game._scheduleUpdateBannerFade()
  } catch {
    // A failed check (offline, blocked request, etc.) just means no
    // banner game time - not a player-facing error worth surfacing.
  }
}

// Patch Notes go live at 12am on each player's own clock (2026-10-12,
// Gaymi: "each player sees a new v# at their time zone at 12am"): an
// entry dated later than the player's local today is hidden until their
// midnight, then shown without a reload.
export function _gateChangelog(game) {
  const list = document.getElementById('changelog-list')
  if (!list) return
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const now = Date.now()
  for (const el of list.querySelectorAll('.changelog-entry')) {
    const m = /([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/.exec(el.querySelector('.changelog-date')?.textContent || '')
    const month = m ? MONTHS.indexOf(m[1]) : -1
    // Local midnight of the entry's date.
    const startsAt = month >= 0 ? new Date(Number(m[3]), month, Number(m[2])).getTime() : 0
    el.classList.toggle('changelog-future', startsAt > now)
  }
  clearTimeout(game._changelogMidnightTimer)
  const next = new Date()
  next.setHours(24, 0, 1, 0)
  game._changelogMidnightTimer = setTimeout(() => game._gateChangelog(), next.getTime() - now)
}

// The What's New card reaches down to the bottom of the profile card it
// sits over, so that's fully covered (2026-10-18, Gaymi: "make it wider up
// to down until it fully covers the profile" - taller, same width).
// Without the profile card on screen (phones) it keeps its CSS size.
export function _fitUpdateBanner(game) {
  const banner = game.updateAvailableBanner
  if (!banner || banner.style.display === 'none') return
  const badge = document.getElementById('menu-player-badge')
  const r = badge && getComputedStyle(badge).display !== 'none' ? badge.getBoundingClientRect() : null
  if (!r?.height) {
    banner.style.height = ''
    banner.style.maxHeight = ''
    return
  }
  const top = banner.getBoundingClientRect().top
  banner.style.maxHeight = 'none'
  banner.style.height = `${Math.max(120, r.bottom - top)}px`
}

// Fades the What's New card out by itself after UPDATE_BANNER_SHOW_MS if
// the player leaves it alone - the timer waits while the mouse is over it.
export function _scheduleUpdateBannerFade(game) {
  const banner = game.updateAvailableBanner
  clearTimeout(game._updateBannerTimer)
  if (!banner._fadeBound) {
    banner._fadeBound = true
    banner.addEventListener('mouseenter', () => clearTimeout(game._updateBannerTimer))
    banner.addEventListener('mouseleave', () => game._scheduleUpdateBannerFade())
    // Clicking anywhere else fades it away too (2026-10-18).
    document.addEventListener('pointerdown', (e) => {
      if (banner.style.display !== 'none' && !banner.contains(e.target)) game._hideUpdateBanner()
    }, true)
    window.addEventListener('resize', () => _fitUpdateBanner(game))
  }
  game._updateBannerTimer = setTimeout(() => game._hideUpdateBanner(), UPDATE_BANNER_SHOW_MS)
}

// Closed with the X or faded away: remember this version was seen, so
// coming back to the homepage doesn't show the same card again (a newer
// deploy still gets its own).
export function _hideUpdateBanner(game) {
  const banner = game.updateAvailableBanner
  if (!banner || banner.style.display === 'none') return
  clearTimeout(game._updateBannerTimer)
  game.settings.lastSeenBuildId = game._pendingUpdateId
  saveSettings(game.settings)
  banner.classList.add('fading')
  setTimeout(() => {
    if (banner.classList.contains('fading')) banner.style.display = 'none'
  }, UPDATE_BANNER_FADE_MS)
}

// What's New badge dot - a small red dot on the Credits nav button until
// the player has actually opened Credits at least once since
// WHATS_NEW_VERSION last changed (bump that constant on future updates).
export function _updateWhatsNewDot(game) {
  if (!game.whatsNewDot) return
  game.whatsNewDot.style.display = localStorage.getItem(WHATS_NEW_SEEN_KEY) === WHATS_NEW_VERSION ? 'none' : ''
}

// How to Play - a replayable overlay. Renders every step as one
// static scrollable list rather than a Next/Back stepper.
export function _openHowToPlayPanel(game) {
  game._closeAllMenuPanels()
  game.howtoplayPanel.style.display = 'flex'
  game.howtoplayPanelTitle.textContent = t('howtoplayPanelTitle')
  game.howtoplayContent.innerHTML = HOWTOPLAY_STEPS.map((step) => `<h3>${t(step.headingKey)}</h3><p>${tHtml(step.key)}</p>`).join('')
}

export function _closeHowToPlayPanel(game) {
  game.howtoplayPanel.style.display = 'none'
}

// Credits panel - static prose (dev/asset credits only), not a
// data-driven list, so no render step needed beyond the title.
export function _openCreditsPanel(game) {
  game._closeAllMenuPanels()
  game.creditsPanel.style.display = 'flex'
  game.creditsPanelTitle.textContent = t('creditsPanelTitle')
}

export function _closeCreditsPanel(game) {
  game.creditsPanel.style.display = 'none'
}

// "Last updated" on Terms and Privacy is the day the live build was made,
// so it moves with every game update (2026-10-24, Gaymi: "make terms of use
// and privacy policy update as the game updates"). The date in index.html
// is only the fallback. New online features also get a line in the text
// itself (see CLAUDE.md).
export function fillLegalUpdatedDates(root = document) {
  const day = typeof __BUILD_DATE__ === 'string' ? new Date(`${__BUILD_DATE__}T12:00:00Z`) : null
  if (!day || Number.isNaN(day.getTime())) return
  const text = `Last updated: ${day.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}`
  for (const el of root.querySelectorAll('#terms-content .legal-updated, #privacy-content .legal-updated')) el.textContent = text
}

export function _openTermsPanel(game) {
  game._closeAllMenuPanels()
  fillLegalUpdatedDates()
  game.termsPanel.style.display = 'flex'
  game.termsPanelTitle.textContent = t('termsBtn')
}

export function _closeTermsPanel(game) {
  game.termsPanel.style.display = 'none'
}

export function _openPrivacyPanel(game) {
  game._closeAllMenuPanels()
  fillLegalUpdatedDates()
  game.privacyPanel.style.display = 'flex'
  game.privacyPanelTitle.textContent = t('creditsPrivacyLink')
}

export function _closePrivacyPanel(game) {
  game.privacyPanel.style.display = 'none'
}

// GayZ Features - ported in from the standalone gayz-features.vercel.app
// site's own index.html/style.css/app.js (that project's own repo,
// updated separately after every shipped game change - see its own
// habit note) rather than iframed, per explicit request. "GayZ
// Features" (like "GayZ" itself) is treated as a proper-noun brand
// name, not translated - same as the standalone site itself, which has
// no i18n of its own either. #features-content lives as
// static HTML (index.html) with the styling in style.css; this only
// wires up the same interactive behavior app.js had: TOC nav built
// from the category sections, expandable multi-item cards, live/
// coming-soon counts and search-as-you-type filtering.
export function _openFeaturesPanel(game) {
  game._closeAllMenuPanels()
  game.featuresPanel.style.display = 'flex'
  game._refreshFeatureValues()
}

export function _closeFeaturesPanel(game) {
  game.featuresPanel.style.display = 'none'
}

// The lists GayZ Features builds from code. All of them (guns, zombie
// types, night events, items, game modes, mutators) were the old Map 1's
// and went with it (2026-10-05) - a new list goes here as id -> {name,
// about}, shown under a [data-feature-list] in index.html.
export function _featureCatalogs(_game) {
  return {}
}

export function _featureCounts(_game) {
  return {
    achievements: ACHIEVEMENTS.length,
  }
}

// The numbers (and a few name lists) inside GayZ Features descriptions,
// read from the constants the game itself uses. scripts/check-docs.mjs
// fails a commit that types a new number into that page instead of
// adding one here and wrapping it in <span data-feature-value="...">.
export function _featureValues(_game) {
  const joinAnd = (names) => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
  const supported = LANGUAGES.filter((l) => SUPPORTED_LANGUAGE_CODES.has(l.code)).map((l) => l.name)
  const coming = LANGUAGES.filter((l) => !SUPPORTED_LANGUAGE_CODES.has(l.code)).map((l) => l.name)
  return {
    // The Console's Horde Night switch (LiveConfig.js).
    hordeNightPercent: Math.round((HORDE_MULT - 1) * 100),
    feedbackMax: FEEDBACK_MAX,
    constellations: CONSTELLATION_COUNT,
    goals: MAX_GOALS,
    startTraps: START_TRAPS,
    teamSize: TEAM_SIZE,
    maxCreatures: MAX_CREATURES,
    teamMaxLevel: MAX_LEVEL,
    teamTrigLevel: TRIGGER_LEVEL,
    teamWinXp: WIN_XP,
    teamLossXp: LOSS_XP,
    teamEvolveA: EVOLVE_AT[0],
    teamEvolveB: EVOLVE_AT[1],
    teamTypeBonus: Math.round((TYPE_MULT - 1) * 100),
    // Team combos: how many of a group it takes ("3, 5 or 7").
    ...Object.fromEntries(COMBOS.map((k) => [`combo${k.id[0].toUpperCase()}${k.id.slice(1)}At`, `${k.at.slice(0, -1).join(', ')} or ${k.at[k.at.length - 1]}`])),
    teamShinyOdds: SHINY_ODDS,
    teamShinyBoost: Math.round(SHINY_BOOST * 100),
    snackSteakCost: SNACKS.steak.cost,
    snackBandageCost: SNACKS.bandage.cost,
    snackCandyCost: SNACKS.candy.cost,
    snackCookieCost: SNACKS.cookie.cost,
    snackSteak: SNACKS.steak.n,
    snackBandage: SNACKS.bandage.n,
    snackCandy: SNACKS.candy.n,
    teamWinCoins: WIN_COINS,
    teamLossCoins: LOSS_COINS,
    teamRoundSeconds: ROUND_S,
    bookKinds: BOOK_IDS.length,
    bookCoins: BOOK_COINS,
    bookDoneCoins: BOOK_DONE_COINS,
    infectionPlayers: Infection.TOTAL,
    infectionWait: Infection.WAIT_S,
    infectionRound: Infection.ROUND_S,
    infectionHeadStart: Infection.HEAD_START_S,
    infectionStun: Infection.STUN_S,
    infectionHumanCoins: Infection.HUMAN_WIN_COINS,
    infectionZombieCoins: Infection.INFECTED_WIN_COINS,
    shopSkinPrice: Game.SHOP_SKIN_PRICE.toLocaleString('en-US'),
    defenseWaves: DEFENSE_WAVES,
    fuelCans: FUEL_CANS,
    heliFuelSeconds: HELI_FUEL_S,
    heliCeiling: HELI_CEILING,
    vehiclesOut: MAX_OUT,
    balloonFuelSeconds: BALLOON_FUEL_S,
    balloonCeiling: BALLOON_CEILING,
    mapPins: MAX_PINS,
    trophyCount: TROPHIES.length,
    zoneStages: ZONE_STAGES.length,
    zoneStartR: ZONE_STAGES[0].r,
    perkCards: PERK_CARDS,
    perkCount: PERKS.length,
    escortCoins: ESCORT_COINS.survivor,
    escortBusCoins: ESCORT_COINS.bus,
    escortXp: ESCORT_XP,
    siegeWave: SIEGE_WAVE,
    siegeBreakIns: SIEGE_BREAK_INS,
    siegeMinutes: SIEGE_LIMIT_S / 60,
    siegeCoins: SIEGE_COINS,
    siegeXp: SIEGE_XP,
    tdWaves: TD_WAVES,
    tdLives: TD_LIVES,
    tdStartCoins: TD_START_COINS,
    tdBossLeak: TD_LEAK_BOSS,
    tourneyTeams: TOURNEY_SIZE,
    tourneyRoundCoins: TOURNEY_ROUND_COINS,
    leaderCount: LEADERS.length,
    leaderFirstCoins: leaderCoins(0),
    leaderLastCoins: leaderCoins(LEADERS.length - 1),
    leaderLossCoins: LEADER_LOSS_COINS,
    gauntletWins: GT.WINS_NEEDED,
    gauntletLives: GT.LIVES,
    gauntletGold: GT.ROUND_GOLD,
    gauntletShop: GT.SHOP_SIZE,
    gauntletPrice: GT.PRICE,
    gauntletReroll: GT.REROLL,
    gauntletSlots: GT.MAX_SLOTS,
    gauntletStartSlots: GT.slots(1),
    gauntletDinoFrom: GT.DINO_FROM,
    gauntletStar2: GT.STAR_LEVEL[1],
    gauntletStar3: GT.STAR_LEVEL[2],
    gauntletWinCoins: GT.WIN_COINS,
    gauntletDoneCoins: GT.DONE_COINS,
    tourneyChampCoins: TOURNEY_CHAMP_COINS,
    zoneFinalR: ZONE_STAGES[ZONE_STAGES.length - 1].r,
    pinataOdds: Math.round(1 / ZOMBIE_SHINES.pinata.chance),
    pinataCoins: PINATA_COINS,
    snowFreeze: FREEZE_S,
    snowStart: START_SNOWBALLS,
    snowWave: WAVE_SNOWBALLS,
    potionSeconds: POTION_S,
    jetSeconds: JET_S,
    speedrunWaves: SPEEDRUN_WAVES,
    speedrunTop: SPEEDRUN_TOP,
    partyPlayers: Party.TOTAL,
    partyHide: Party.HIDE_S,
    partyCaps: Party.CAPS_TO_WIN,
    partyHill: Party.HILL_POINTS,
    partyGoals: Party.GOALS_TO_WIN,
    partyCoins: Party.WIN_COINS,
    potatoFuse: `${Party.FUSE_S[0]}-${Party.FUSE_S[1]}`,
    bowlRolls: Party.ROLLS,
    bowlPins: Party.PINS,
    bowlTurn: Party.TURN_S,
    paintArena: Party.PAINT_R,
    bbBlocks: Party.BB_PALETTE.length,
    bbMinutes: Math.round(Party.BUILD_S / 60),
    bbVoteS: Party.VOTE_S,
    boardSpeed: BOARD_SPEED,
    trickCoins: TRICK_COINS,
    freezeR: FREEZE_R,
    danceS: DANCE_S,
    danceR: DANCE_R,
    danceCoins: DANCE_COINS,
    dazeS: DAZE_S,
    boomboxCool: BOOMBOX_COOL,
    escRooms: ESC_ROOMS,
    escDoorS: ESC_ROOM_S.join(', '),
    escWrong: ESC_WRONG,
    escCoins: ESC_COINS,
    escRoomCoins: ESC_ROOM_COINS,
    maxRuins: MAX_RUINS,
    ruinZombies: RUIN_ZOMBIES,
    pirates: PIRATES,
    pirateCoins: PIRATE_COINS,
    shipMinutes: Math.round(SHIP_LIFE / 60),
    trainStations: TRAIN_STATIONS,
    trainCars: TRAIN_CARS,
    trainStop: TRAIN_STOP,
    carZombies: CAR_ZOMBIES,
    moonGravity: Math.round(MOON_G * 100),
    mapPieceChance: Math.round(PIECE_CHANCE * 100),
    mapPieces: PIECES_PER_MAP,
    treasureCoins: `${TREASURE_COINS[0]}-${TREASURE_COINS[1]}`,
    treasureGems: `${TREASURE_GEMS[0]}-${TREASURE_GEMS[1]}`,
    aquariumFish: AQUARIUM_FISH,
    aquariumGolden: AQUARIUM_GOLDEN,
    sledSpeed: SLED_SPEED,
    sledBoost: SLED_BOOST,
    sledRunMin: SLED_RUN_MIN,
    sledRunStep: SLED_RUN_STEP,
    sledCoins: SLED_COINS,
    springMax: MAX_SPRINGS,
    springHeal: SPRING_HEAL,
    zooMax: MAX_ZOO,
    lavaGrid: `${LAVA_GRID} x ${LAVA_GRID}`,
    lavaWarn: LAVA_WARN,
    lavaRegrow: LAVA_REGROW,
    laserKo: LASER_KO,
    kartLaps: KART_LAPS,
    kartBoost: KART_BOOST,
    parkourCheckpoints: PARKOUR_CPS.length - 1,
    cartLenMin: CART_LEN_MIN,
    cartLenMax: CART_LEN_MAX,
    cartHop: CART_HOP,
    cartCoins: CART_COINS,
    heavyPct: Math.round(HEAVY * 100),
    hauntGhosts: HAUNT_GHOSTS,
    hauntCoins: HAUNT_COINS,
    ufoGrab: UFO_GRAB,
    ufoAliens: UFO_ALIENS,
    ufoCoins: UFO_COINS,
    dragonWave: DRAGON_WAVE,
    dragonFire: DRAGON_FIRE,
    dragonHp: DRAGON_HP,
    dragonCoins: HOARD_COINS,
    dragonGems: HOARD_GEMS,
    duelHp: DUEL_HP,
    duelStart: DUEL_START,
    duelWin: DUEL_WIN,
    duelLoss: DUEL_LOSS,
    golfHoles: GOLF_HOLES,
    golfReach: GOLF_REACH,
    golfZombies: GOLF_ZOMBIES,
    golfHoleS: GOLF_HOLE_S,
    golfMiss: GOLF_MISS,
    freezeThaw: FREEZE_THAW,
    wheelSpin: WHEEL_SPIN,
    wheelBig: WHEEL_BIG,
    postcardNote: POSTCARD_NOTE,
    graveGraves: GRAVE_GRAVES,
    graveGap: GRAVE_GAP,
    graveCoins: GRAVE_COINS,
    lighthouseSpot: LIGHTHOUSE_SPOT,
    treeDeck: TREE_DECK,
    newsHeadlines: NEWS_HEADS,
    newsJokes: NEWS_JOKES,
    newsStories: NEWS_STORIES,
    newsPerPage: NEWS_PER,
    lostStacks: LOST_STACKS,
    pinBumper: PIN_BUMPER,
    pinBalls: PIN_BALLS,
    pinPerCoin: PIN_PER_COIN,
    pinMaxCoins: MAX_PIN_COINS,
    chessDepth: CHESS_DEPTH,
    chessCoins: CHESS_WIN_COINS,
    petTameR: PET_TAME_R,
    petGuardR: PET_GUARD_R,
    petDamage: PET_DAMAGE,
    waterSlow: Math.round(WATER_SLOW * 100),
    waterSoak: WATER_SOAK,
    waterTank: WATER_TANK,
    wingOpenH: WING_OPEN_H,
    wingRings: WING_RINGS,
    wingRingCoins: WING_RING_COINS,
    wingAllCoins: WING_ALL,
    dodgeThrow: DODGE_THROW,
    dodgeOut: DODGE_OUT,
    dodgeMinutes: Math.round(Party.ROUND_S.dodgeball / 60),
    chairsMusic: `${CHAIRS_MUSIC[0]}-${CHAIRS_MUSIC[1]}`,
    chairsGrab: CHAIRS_GRAB,
    simonCmd: SIMON_CMD,
    simonMinCmd: SIMON_MIN,
    simonRun: SIMON_RUN,
    propKinds: PROP_KINDS.length,
    propDecoys: PROP_DECOYS,
    propHideS: PROP_HIDE_S,
    propSeekMinutes: Math.round(PROP_SEEK_S / 60),
    propMissS: PROP_MISS_S,
    bikeSpeed: BIKE_SPEED,
    hoverSpeed: HOVER_SPEED,
    hoverFall: HOVER_FALL,
    quietHear: QUIET_HEAR,
    // Idea list 10 (2026-11-09).
    blimpHp: BLIMP_HP,
    blimpLife: BLIMP_LIFE,
    blimpCoins: BLIMP_COINS,
    blimpDropEvery: BLIMP_DROP_EVERY,
    blimpDrops: BLIMP_DROPS,
    bingoSize: BINGO_SIZE,
    bingoGoals: BINGO_GOALS.length,
    bingoLine: BINGO_LINE,
    bingoFull: BINGO_FULL,
    bingoGems: BINGO_GEMS,
    pizzaCount: PIZZAS,
    pizzaHotS: PIZZA_HOT_S,
    pizzaTipS: PIZZA_TIP_S,
    pizzaCoins: PIZZA_COINS,
    pizzaTip: PIZZA_TIP,
    pizzaCold: PIZZA_COLD,
    pizzaSmell: PIZZA_SMELL,
    tugWin: TUG_WIN,
    tugMinutes: Math.round(TUG_ROUND / 60),
    tugTaps: TUG_TAPS,
    bungeeDrop: BUNGEE_DROP,
    bungeeHang: BUNGEE_HANG,
    bungeeCoins: BUNGEE_COINS,
    bungeeItems: BUNGEE_ITEMS,
    bungeeGuards: BUNGEE_GUARDS,
    jetSeaEvery: JET_SEA_EVERY,
    jetSeaMax: JET_SEA_MAX,
    jetGrabS: JET_GRAB_S,
    dinerDishes: DINER_DISHES.length,
    dinerSeats: DINER_SEATS,
    dinerCoins: DINER_COINS,
    dinerTip: DINER_TIP,
    dinerTipS: DINER_TIP_S,
    dinerSpot: DINER_SPOT,
    dinerPatience: DINER_PATIENCE,
    dinerReveal: `${DINER_REVEAL[0]}-${DINER_REVEAL[1]}`,
    learnWindow: LEARN_WINDOW,
    learnShare: Math.round(LEARN_SHARE * 100),
    learnMax: LEARN_MAX,
    learnChance: Math.round(LEARN_CHANCE * 100),
    learnGear: Math.round(LEARN_GEAR * 100),
    learnForget: LEARN_FORGET,
    findFirst: FIND_FIRST_S,
    // World Map travel (Passport.js, FastTravel.js).
    stampCoins: STAMP_COINS,
    travelBase: TRAVEL_BASE,
    travelPerBlocks: TRAVEL_PER_BLOCKS,
    travelMost: TRAVEL_MOST,
    travelWaitMin: TRAVEL_WAIT_S / 60,
    findEveryMinutes: Math.round(FIND_EVERY_S / 60),
    findLifeMinutes: Math.round(FIND_LIFE_S / 60),
    musicNotes: MUSIC_NOTES,
    musicHear: MUSIC_HEAR,
    musicJam: MUSIC_JAM,
    booS: BOO_S,
    booCd: BOO_CD,
    markS: MARK_S,
    reviveS: REVIVE_S,
    ghostWait: GHOST_WAIT_S,
    storyChapters: STORY_CHAPTERS.length,
    storyCoins: STORY_COINS,
    storyFinale: STORY_FINALE,
    hungerMinutes: HUNGER_MINUTES,
    hungerRaw: RAW_FOOD,
    hungerCooked: COOKED_FOOD,
    hungerStarve: STARVE_DPS,
    hungerCookR: COOK_R,
    museumExhibits: MUSEUM_EXHIBITS.length,
    museumBosses: MUSEUM_BOSSES.length,
    bombPlant: BOMB_PLANT,
    bombTime: BOMB_TIME,
    bombDefuse: BOMB_DEFUSE,
    bombStun: BOMB_STUN,
    heistGuards: HEIST_GUARDS,
    heistExtra: HEIST_EXTRA,
    heistCoins: HEIST_COINS,
    heistStealth: HEIST_STEALTH,
    parkDist: PARK_DIST,
    parkFerris: PARK_FERRIS,
    parkGame: PARK_GAME,
    parkTicket: PARK_TICKET,
    parkZombies: PARK_ZOMBIES,
    timeEraS: TIME_ERA_S,
    timeCoins: TIME_COINS,
    timeAllCoins: TIME_ALL,
    timeEras: TIME_ERAS.length,
    wolfNight: WOLF_NIGHT,
    wolfDay: WOLF_DAY,
    wolfClaw: WOLF_CLAW,
    dungeonSize: DUNGEON_SIZE,
    zoneSpeed: ZONE_ZOMBIE_SPEED,
    zoneMinutes: Math.floor(ZONE_TOTAL_S / 60),
    recipes: RECIPES.length,
    gooChance: Math.round(GOO_CHANCE * 100),
    gooSeconds: ITEMS.gooDisguise.disguise,
    farmMinutes: FARM_GROW_S / 60,
    campSurvivors: CAMP_MAX,
    maxFollowers: MAX_HELPERS,
    extractionHold: EXTRACTION_HOLD,
    bossEvery: BOSS_HUNT_EVERY,
    rainbowOdds: Math.round(1 / RAINBOW_CHANCE),
    disasters: DISASTERS.length,
    luckMult: LUCK_MULT,
    luckHours: LUCK_SECONDS / 60,
    globetrotterMinutes: GLOBETROTTER_SECONDS / 60,
    upgrades: PLAY_META_UPGRADES.length,
    prestigeBonus: PRESTIGE_BONUS_PERCENT,
    prestigeStep: PRESTIGE_COST_STEP.toLocaleString('en-US'),
    prestigeStep2: (PRESTIGE_COST_STEP * 2).toLocaleString('en-US'),
    biomes: Object.keys(BIOMES).length,
    undergroundDepth: -BOTTOM,
    demonDepth: -DEMON_TOP,
    settingsLogMax: LOG_MAX,
    heavenFloor: HEAVEN_FLOOR,
    heavenTop: HEAVEN_TOP,
    angelKinds: REALM_KINDS.heaven.length,
    demonKinds: REALM_KINDS.demon.length,
    seaZombieKinds: REALM_KINDS.ocean.length,
    mobHeight: MOB_HEIGHT,
    bumpDegrees: BUMP_MAX_DEGREES,
    levelUpCoinsPerLevel: levelUpCoins(1),
    maxWildAnimals: MAX_WILD,
    animalKinds: ANIMAL_IDS.length,
    dinoKinds: Object.keys(DINO_KINDS).length,
    rarityTiers: Object.keys(RARITIES).length,
    goldOdds: Math.round(1 / ZOMBIE_SHINES.gold.chance),
    goldCoins: ZOMBIE_SHINES.gold.coins,
    diamondOdds: Math.round(1 / ZOMBIE_SHINES.diamond.chance),
    diamondCoins: ZOMBIE_SHINES.diamond.coins,
    dailyKinds: DAILY_TEMPLATES.length,
    dailyMinKills: DAILY_TEMPLATES.find((d) => d.type === 'kills')?.targets[0],
    tipCount: TIP_COUNT,
    topPlayers: TOP_PLAYERS,
    birthdayCoins: BIRTHDAY_COINS_PER_YEAR,
    mapWeekDays: MAPWEEK_DAYS,
    dailyStreakStep: Math.round(STREAK_STEP * 100),
    dailyStreakDays: STREAK_MAX_DAYS,
    dailyStreakMax: streakMult(STREAK_MAX_DAYS),
    deathJobs: DEATH_JOB_COUNT,
    discoOdds: Math.round(1 / ZOMBIE_SHINES.disco.chance),
    discoCoins: ZOMBIE_SHINES.disco.coins,
    zombieHatOdds: HAT_EVERY,
    zombieCapeOdds: CAPE_EVERY,
    bloodMoonOdds: Math.round(1 / BLOOD_MOON_CHANCE),
    bloodMoonWave: BLOOD_MOON_WAVE,
    goldenLife: GOLDEN_LIFE_S,
    goldenCoins: GOLDEN_COINS,
    rodCost: ROD_COST,
    catchKinds: CATCHES.length,
    radioLines: RADIO_LINES,
    spraySize: SPRAY_SIZE,
    sprayColors: SPRAY_COLORS.length - 1,
    maxSprays: MAX_SPRAYS,
    replaySeconds: REPLAY_SECONDS,
    photoFilters: PHOTO_FILTERS.length - 1,
    jokeSigns: JOKE_SIGN_COUNT,
    sillyTips: SILLY_TIP_COUNT,
    hintMax: HINT_MAX,
    afkMin: Math.min(...afkMinutes()),
    afkMax: Math.max(...afkMinutes()),
    cosmetics: COSMETIC_IDS.length,
    minFps: MIN_FPS,
    emotes: EMOTES.length,
    shopTabs: SHOP_TABS.length,
    ammoFillCooldown: AMMO_FILL_COOLDOWN,
    dinoChance: Math.round(DINO_CHANCE * 100),
    grassGrowMinutes: GRASS_GROW_SECONDS / 60,
    leafDropPercent: Math.round(LEAF_DROP_CHANCE * 100),
    magRifle: PLAY_WEAPONS.rifle.mag,
    spareRifle: PLAY_WEAPONS.rifle.reserve,
    magPistol: PLAY_WEAPONS.pistol.mag,
    magShotgun: PLAY_WEAPONS.shotgun.mag,
    spareShotgun: PLAY_WEAPONS.shotgun.reserve,
    magAwp: PLAY_WEAPONS.awp.mag,
    magGpmg: PLAY_WEAPONS.gpmg.mag,
    spareRocket: PLAY_WEAPONS.rocket.reserve,
    scopeZoom: PLAY_WEAPONS.awp.scope,
    editorStoreSide: 10,
    specialBlocks: SPECIAL_BLOCKS.length,
    skeletonWave: SKELETON_FROM_WAVE,
    monsterWave: MONSTER_FROM_WAVE,
    spawnMinDist: SPAWN_MIN_DIST,
    marketFee: Math.round(MARKET_FEE_RATE * 100),
    chatMuteMinutes: ChatUI.CHAT_MUTE_MS / 60000,
    loginDays: LOGIN_CALENDAR_DAYS,
    languages: LANGUAGES.length,
    languagesSupported: joinAnd(supported),
    languagesComing: joinAnd(coming),
  }
}

// Builds every [data-feature-list] from its catalog (hand-written
// data-extra items, which have no single thing in code, stay at the end),
// and the one-line summary above each list from the same names. An entry
// with no name or description is still shown, marked data-missing, so
// tests/docs.spec.js can name it.
export function _syncFeatureLists(game) {
  const catalogs = game._featureCatalogs()
  const pretty = (id) => id.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (c) => c.toUpperCase())
  game.featuresContent.querySelectorAll('[data-feature-list]').forEach((list) => {
    const key = list.dataset.featureList
    const catalog = catalogs[key]
    if (!catalog) return
    list.querySelectorAll('.detail-item[data-id]').forEach((el) => el.remove())
    const firstExtra = list.querySelector('.detail-item[data-extra]')
    for (const [id, { name, about }] of Object.entries(catalog)) {
      const item = document.createElement('div')
      item.className = 'detail-item'
      item.dataset.id = id
      if (!name || !about) item.dataset.missing = ''
      const b = document.createElement('b')
      b.textContent = name || pretty(id)
      item.appendChild(b)
      if (about) item.append(` — ${about}`)
      list.insertBefore(item, firstExtra)
    }
    const line = game.featuresContent.querySelector(`[data-feature-list-line="${key}"]`)
    if (line) {
      line.textContent = Object.entries(catalog).map(([id, { name }]) => (name || pretty(id)).replace(/ \(boss\)$/, '')).join(', ')
    }
  })
}

// Also run on every open, so a rebound key (the grapple's) shows up.
export function _refreshFeatureValues(game) {
  if (!game.featuresContent) return
  const featureValues = game._featureValues()
  game.featuresContent.querySelectorAll('[data-feature-value]').forEach((el) => {
    const v = featureValues[el.dataset.featureValue]
    // 0 means a lookup broke (nothing on that page is really zero) - keep the HTML's number.
    if (v !== undefined && v !== null && v !== '' && v !== 0) el.textContent = String(v)
  })
}

export function _bindFeaturesPanel(game) {
  if (!game.featuresContent) return
  const categories = game.featuresContent.querySelectorAll('section.category')

  // TOC - one pill button per category, scrolling the internal
  // #features-content scroll area (not the page - game panel is a
  // fixed-size overlay, a plain <a href="#id"> anchor jump doesn't
  // reliably target content inside one).
  if (game.featuresToc) {
    const tocLinks = []
    categories.forEach((section) => {
      const heading = section.querySelector('h2')
      const link = document.createElement('button')
      link.type = 'button'
      link.className = 'features-toc-link'
      link.textContent = heading.textContent
      if (section.id === 'coming-soon') link.classList.add('coming-link')
      // 'auto' (instant), not 'smooth' - every other tab/section switch
      // in game game jumps instantly (Settings tabs, Clan tabs, etc.),
      // and smooth scroll's animation depends on the compositor thread
      // actually running each frame, which isn't guaranteed the moment
      // right after a panel opens.
      link.addEventListener('click', () => {
        // Only the list scrolls - the search bar above it stays put.
        const box = game.featuresLayout || game.featuresContent
        box.scrollTop += section.getBoundingClientRect().top - box.getBoundingClientRect().top
        // Immediate feedback rather than waiting on the observer below,
        // which only re-fires after the (instant, but still async)
        // scroll actually settles a frame later.
        tocLinks.forEach((l) => l.classList.toggle('active', l === link))
      })
      game.featuresToc.appendChild(link)
      tocLinks.push(link)
    })

    // Highlight whichever section is currently in view as you scroll,
    // same "you're here" behavior as a normal page table-of-contents -
    // previously only :hover lit a link up, so the active section had
    // no visual indicator once you scrolled past the first one.
    if (tocLinks.length && 'IntersectionObserver' in window) {
      if (game._featuresTocObserver) game._featuresTocObserver.disconnect()
      const visibleRatios = new Map()
      game._featuresTocObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            visibleRatios.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0)
          })
          let bestSection = null
          let bestRatio = 0
          categories.forEach((section) => {
            const ratio = visibleRatios.get(section) || 0
            if (ratio > bestRatio) { bestRatio = ratio; bestSection = section }
          })
          if (bestSection) {
            const idx = [...categories].indexOf(bestSection)
            tocLinks.forEach((l, i) => l.classList.toggle('active', i === idx))
          }
        },
        { root: game.featuresLayout || game.featuresContent, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] }
      )
      categories.forEach((section) => game._featuresTocObserver.observe(section))
      tocLinks[0].classList.add('active')
    }
  }

  // Expandable cards (weapons, mutators, zombie types, etc.) - click the
  // heading to reveal a per-item breakdown.
  game.featuresContent.querySelectorAll('.feature.expandable > h3').forEach((h3) => {
    h3.addEventListener('click', () => h3.closest('.feature').classList.toggle('open'))
  })

  // The expandable lists, their one-line summaries, the counts in the
  // headings and the numbers inside descriptions all come from the game's
  // own data, so they can't go stale the way hand-typed ones did ("15
  // firearms", "30 zombie types", "4 bosses" naming only 3 - all wrong by
  // 2026-10-04). The HTML keeps the descriptions and a fallback.
  game._syncFeatureLists()
  const featureCounts = game._featureCounts()
  game.featuresContent.querySelectorAll('[data-feature-count]').forEach((el) => {
    const n = featureCounts[el.dataset.featureCount]
    if (Number.isFinite(n) && n > 0) el.textContent = String(n)
  })
  game._refreshFeatureValues()

  if (game.featuresStatLive && game.featuresStatSoon) {
    game.featuresStatLive.textContent = game.featuresContent.querySelectorAll('section.category:not(#coming-soon) .feature').length
    game.featuresStatSoon.textContent = game.featuresContent.querySelectorAll('#coming-soon .feature').length
  }

  if (game.featuresSearch && game.featuresSearchCount) {
    const allFeatures = game.featuresContent.querySelectorAll('.feature')
    game.featuresSearch.addEventListener('input', () => {
      const q = game.featuresSearch.value.trim().toLowerCase()
      if (!q) {
        allFeatures.forEach((f) => f.classList.remove('hidden-search'))
        categories.forEach((c) => c.classList.remove('hidden-search'))
        game.featuresSearchCount.style.display = 'none'
        return
      }
      let matches = 0
      categories.forEach((section) => {
        let sectionHasMatch = false
        section.querySelectorAll('.feature').forEach((f) => {
          const hit = f.textContent.toLowerCase().includes(q)
          f.classList.toggle('hidden-search', !hit)
          if (hit) { sectionHasMatch = true; matches++ }
        })
        section.classList.toggle('hidden-search', !sectionHasMatch)
      })
      game.featuresSearchCount.style.display = 'block'
      game.featuresSearchCount.textContent = `${matches} feature${matches === 1 ? '' : 's'} found`
    })
  }

}

// What's New panel - split out from Credits (used to be one combined
// panel/nav entry point for both) so the changelog/build info content
// has its own dedicated place, distinct from the static dev-credits
// prose.
export function _openWhatsNewPanel(game) {
  if (!game.whatsNewPanel) return
  game._closeAllMenuPanels()
  game.whatsNewPanel.style.display = 'flex'
  if (game.whatsNewPanelTitle) game.whatsNewPanelTitle.textContent = t('whatsNewPanelTitle')
  // Paused, with where the news goes instead (2026-10-30): Discord's
  // #updates channel, the word Discord a link to the server invite.
  const pausedTitle = document.getElementById('whatsnew-paused-title')
  const pausedDiscord = document.getElementById('whatsnew-paused-discord')
  if (pausedTitle) pausedTitle.textContent = t('whatsNewPaused')
  if (pausedDiscord) {
    pausedDiscord.innerHTML = t('whatsNewPausedDiscord', {
      discord: '<a href="https://discord.gg/kukR72Euj6" target="_blank" rel="noopener noreferrer">Discord</a>',
    })
  }
  if (game.buildVersionLine) game.buildVersionLine.textContent = t('buildVersionLine')
  // What's New badge dot - clears the moment the player actually reads
  // game panel, not just on page load, so it stays a genuine "have you
  // seen game" indicator rather than a permanent decoration.
  try { localStorage.setItem(WHATS_NEW_SEEN_KEY, WHATS_NEW_VERSION) } catch { /* storage unavailable */ }
  // Separate from WHATS_NEW_SEEN_KEY above (that's a single version
  // string gating the nav-button dot) - game is an actual timestamp, so
  // the What's New card can diff real changelog entry dates against it,
  // not just know "has the dot been cleared."
  try { localStorage.setItem(CHANGELOG_LAST_VIEWED_KEY, String(Date.now())) } catch { /* storage unavailable */ }
  game._updateWhatsNewDot()
}

export function _closeWhatsNewPanel(game) {
  if (game.whatsNewPanel) game.whatsNewPanel.style.display = 'none'
}

// What's New digest (see #whats-new-digest) - a fuller, more prominent
// one-time, dismissible card of the changelog entries since your last
// visit (same lastViewed gate).
// Closing it (or opening Credits, which already does this) marks it
// seen - reload before dismissing and it shows again, which is the
// correct behavior for "you still haven't caught up."
export function _maybeShowWhatsNewDigest(game) {
  if (!game.whatsNewDigest) return
  // Show What's New Every Launch (General tab) - bypasses the normal
  // "only entries newer than my last visit" gate below and just shows
  // the most recent entries unconditionally, for anyone who wants the
  // reminder every time rather than only once per real update.
  let newEntries
  if (game.settings.whatsNewEveryLaunch) {
    newEntries = Array.from(document.querySelectorAll('#changelog-list .changelog-entry:not(.changelog-future)')).slice(0, 3)
  } else {
    const lastViewed = Number(localStorage.getItem(CHANGELOG_LAST_VIEWED_KEY))
    if (!lastViewed) return
    newEntries = Array.from(document.querySelectorAll('#changelog-list .changelog-entry:not(.changelog-future)')).filter((el) => {
      const parsed = Date.parse(el.querySelector('.changelog-date')?.textContent || '')
      return !isNaN(parsed) && parsed > lastViewed
    })
  }
  if (!newEntries.length) return
  game.whatsNewDigestTitle.textContent = t('whatsNewDigestTitle', { n: newEntries.length })
  // Our own static patch notes (index.html), never player data - the
  // bullet lists are copied as they are.
  game.whatsNewDigestList.innerHTML = newEntries.map((el) => `<div class="changelog-text">${el.querySelector('.changelog-text')?.innerHTML || ''}</div>`).join('')
  game.whatsNewDigest.style.display = 'block'
  game.whatsNewDigest.classList.remove('fading')
  // Auto-fade after 10s if left untouched (2026-09-18) - it used to just
  // sit open indefinitely until the player noticed the X, which meant it
  // was still covering the corner of the screen in every homepage
  // screenshot from an entire play session. Cleared if the player closes
  // it manually first, and the Play button click handler below also
  // triggers game same fade immediately, so it never carries into an
  // actual run.
  game._whatsNewDigestFadeTimer = setTimeout(() => game._fadeOutWhatsNewDigest(), 10000)
}

// Shared by the 10s idle timer above and the Play button click handler -
// fades instead of vanishing instantly (see .fading in style.css), then
// actually hides it once the transition finishes so it's not sitting
// there invisible-but-still-in-the-DOM. Deliberately does NOT mark the
// digest as seen or touch the What's New dot, unlike the explicit X
// close button - the player never actually read it, so it should still
// show again next launch, same as if they'd never seen it at all.
export function _fadeOutWhatsNewDigest(game) {
  if (!game.whatsNewDigest || game.whatsNewDigest.style.display === 'none') return
  clearTimeout(game._whatsNewDigestFadeTimer)
  game.whatsNewDigest.classList.add('fading')
  setTimeout(() => { game.whatsNewDigest.style.display = 'none' }, 600)
}

// Settings > Gameplay > AFK Pause's choices, in minutes (GayZ Features).
function afkMinutes() {
  return MORE_SETTINGS.find((d) => d.key === 'afkPause').opts.filter((v) => v !== 'off').map(Number)
}
