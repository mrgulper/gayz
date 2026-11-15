// Zombie facts for the Discord bot's /zombiefact (2026-11-15, Gaymi: "mix
// of both [real and game facts] also this should update as the game
// updates").
//
// Runs after `vite build` and writes dist/zombie-facts.json, served at
// /zombie-facts.json. The bot fetches it every few hours, so the facts
// follow whatever is on the live site:
//
// - game facts are read from the game's own code (MONSTER_KINDS,
//   FunnyZombies.js), so a new kind of zombie gets a fact on the next
//   deploy with nothing to remember. A hand-written line in GAME_LINES
//   replaces the automatic one for that kind - add one when a new kind
//   deserves a funnier line.
// - real facts are true things about "zombies" in nature.
//
// Never fails the build: if anything goes wrong the bot just keeps the
// facts it already has (or its own built-in list).
import { writeFileSync, existsSync } from 'node:fs'

const OUT = new URL('../dist/zombie-facts.json', import.meta.url)

// Hand-written lines per kind (optional). Anything not listed here gets an
// automatic line from its stats.
const GAME_LINES = {
  hunched: 'The hunched ghoul drags its long arms along the ground - slower than a regular zombie, but it hits harder.',
  blob: 'The blob hops by squashing and stretching like jelly. It is mostly mouth.',
  beast: 'Zombie dogs are fast but fragile. Good boys no longer.',
  crawler: 'The crawler has no legs, so it sits low to the ground - aim down or you will shoot right over it.',
  brute: 'The brute is still only 2 blocks tall, but almost twice as wide as a regular zombie. Bring lots of ammo.',
  bloater: 'When a bloater dies it bursts, hurting everyone close by - zombies included - and leaves a slime puddle.',
  skinny: 'The skinny runner is very fast and very weak. One good hit and it folds.',
  screamer: 'The screamer screams to call more zombies over. Take it out first.',
  lurker: 'The lurker hides by turning see-through. If something looks wobbly, shoot it.',
  angel: 'Angels live way up in the sky realm and never burn in the sun.',
  seraph: 'The seraph is a floating eye wrapped in six wings. It is watching. Always.',
  archangel: 'The archangel wears gold armour and carries a sword - one of the toughest things in the sky realm.',
  cherub: 'Cherubs are small, quick and floaty. Do not let the cute fool you.',
  imp: 'Imps are thin, horned and quick. They live deep underground in the Demon Realm.',
  hellhound: 'The hellhound is a burning dog from the Demon Realm, and one of the fastest monsters in the game.',
  demon: 'The demon is a huge horned brute with bat wings, as tough as a brute.',
  fiend: 'Fiends are hunched clawed ghouls from the Demon Realm.',
  drowned: 'The drowned are soggy, seaweed-wrapped zombies that wait in and by the sea.',
  sharkman: 'Yes, there is a shark-headed zombie. It lives in the ocean. Swim carefully.',
  jelly: 'The jelly zombie glows in the deep sea. Pretty. Painful.',
  angler: 'The angler is a deep-sea fish-man with a glowing lure. Do not follow the light.',
}

// Extra game lines that aren't about one kind.
const GAME_EXTRA = [
  'Some zombies burp or hiccup instead of moaning.',
  'The Disco Zombie dances instead of walking - one arm up, then the other.',
]

const REAL = [
  'A real fungus (Ophiocordyceps) takes over carpenter ants, makes them climb a plant, bite down and stay there until it bursts out of their head.',
  'A tiny wasp stings cockroaches in the brain, then leads them by an antenna like a dog on a leash.',
  'A parasite (Leucochloridium) makes snail eyestalks pulse like bright caterpillars so birds will eat them.',
  'Hairworms make crickets jump into water, where the worm swims out to lay its eggs.',
  'A fungus called Entomophthora makes flies climb high, spread their wings and die in a pose that rains spores on other flies.',
  'Some ladybugs end up guarding a wasp cocoon like a twitching bodyguard after a parasitic wasp uses them.',
  'Toxoplasma, a tiny parasite, makes infected mice lose their fear of cats.',
  'The word "zombie" comes from Haitian folklore - a body brought back and controlled by someone else.',
  'Dead people do not really keep growing hair and nails - the skin just dries and shrinks back.',
  'A barnacle called Sacculina takes over crabs and makes them care for its eggs as if they were their own - even male crabs.',
  'Some caterpillars carrying a baculovirus climb to the top of a plant and melt, raining virus on the leaves below.',
  'The jewel wasp\'s sting does not kill the cockroach - it just switches off its will to escape.',
]

const times = (x) => {
  if (x >= 1.15) return `${Math.round(x * 10) / 10}x`
  if (x <= 0.85) return `${Math.round((1 / x) * 10) / 10}x less`
  return null
}

// An automatic line from a kind's stats, for kinds with no written line.
function autoLine(id, k) {
  const name = id.charAt(0).toUpperCase() + id.slice(1)
  const where = k.realm === 'heaven' ? ' up in the sky realm' : k.realm === 'demon' ? ' deep in the Demon Realm' : k.realm === 'ocean' ? ' in and by the sea' : ''
  const bits = []
  const hp = times(k.hp)
  const speed = times(k.speed)
  const dmg = times(k.damage)
  if (hp) bits.push(hp.endsWith('less') ? 'is easier to kill' : `has ${hp} the health`)
  if (speed) bits.push(speed.endsWith('less') ? 'is slower' : `moves ${speed} as fast`)
  if (dmg) bits.push(dmg.endsWith('less') ? 'hits softer' : `hits ${dmg} as hard`)
  if (k.climbs) bits.push('climbs straight up walls')
  if (k.burst) bits.push('bursts when it dies')
  const what = bits.length ? ` It ${bits.slice(0, 3).join(', ').replace(/, ([^,]*)$/, ' and $1')} compared to a regular zombie.` : ''
  return `The ${name} lives${where || ' in GayZ'}.${what}`
}

try {
  const { MONSTER_KINDS } = await import('../src/game/ZombieKinds.js')
  const { HAT_EVERY, CAPE_EVERY } = await import('../src/game/FunnyZombies.js')
  const game = []
  // waves: false with no realm = not a zombie any more (the spider is a
  // friendly animal now).
  const kinds = Object.entries(MONSTER_KINDS).filter(([, k]) => k.waves !== false || k.realm)
  for (const [id, k] of kinds) game.push(GAME_LINES[id] || autoLine(id, k))
  game.push(`About 1 in ${HAT_EVERY} zombies wears a hat - a party hat, a traffic cone, a tiny crown, or even a player's own hat.`)
  game.push(`About 1 in ${CAPE_EVERY} zombies wears a cape.`)
  game.push(`There are ${kinds.length} kinds of monster in GayZ right now, on top of the regular zombies and skeletons.`)
  game.push(...GAME_EXTRA)
  if (!existsSync(new URL('../dist/', import.meta.url))) throw new Error('dist/ missing - run vite build first')
  writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), game, real: REAL }, null, 2))
  console.log(`[zombie-facts] wrote ${game.length} game + ${REAL.length} real facts`)
} catch (err) {
  console.warn('[zombie-facts] skipped:', err.message)
}
