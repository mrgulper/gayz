// Animal voices (2026-11-13 sound upgrade). Every animal kind gets a voice
// from its name: a recording family (Audio.js SFX 'a_*'), a pitch, and
// whether it calls out on its own. Bigger animals sound deeper.
// Special voices: 'chirp' (the built-in birdsong), 'hiss' (reptiles - a
// hiss is just air, which the synth does well), 'splash' (fish and other
// sea life: no call, a splash when hit), 'tiny' (bugs that don't buzz,
// crabs, snails: a little pop when hit).

// [name test, idle sound, pitch, hurt sound (defaults to idle)]
const FAMILIES = [
  [/rooster/, 'a_rooster', 1, 'a_chicken'],
  [/chicken|pheasant|quail|grouse|ptarmigan|dodo/, 'a_chicken', 1],
  [/turkey/, 'a_chicken', 0.75],
  [/penguin/, 'a_duck', 0.6],
  [/duck/, 'a_duck', 1],
  [/goose|swan|loon|pelican|puffin|cormorant/, 'a_duck', 0.7],
  [/owl/, 'a_owl', 1],
  [/crow|raven|magpie|bluejay/, 'a_crow', 1],
  [/gull|albatross|frigate/, 'a_gull', 1],
  [/eagle|hawk|falcon|kestrel|osprey|condor|vulture|secretarybird|griffin|pteranodon/, 'a_gull', 0.75],
  [/peacock|crane|stork|flamingo|heron|ibis|spoonbill|shoebill/, 'a_peacock', 0.95],
  [/ostrich|emu|cassowary|rhea/, 'a_peacock', 0.55],
  [/phoenix/, 'a_peacock', 1.15],
  [/parrot|macaw|cockatoo|lovebird|budgie|toucan|hornbill|kookaburra|cockatiel/, 'a_parrot', 1],
  [/robin|sparrow|cardinal|finch|canary|hummingbird|swallow|kingfisher|woodpecker|hoopoe|quetzal|pigeon|roadrunner|kiwi/, 'chirp', 1],
  [/fish|shark|seahorse|stingray|manta|eel$|octopus|squid|nautilus|barracuda|marlin|piranha|pike|carp|koi|flounder|tuna|salmon|trout/, 'splash', 1],
  [/sealion|leopardseal|elephantseal|walrus/, 'a_dog', 0.55],
  [/seal/, 'a_dog', 0.7],
  [/frog|toad/, 'a_frog', 1],
  [/hedgehog|porcupine|guineapig/, 'a_squeak', 1],
  [/gorilla/, 'a_bear', 1.2],
  [/monkey|chimp|orangutan|baboon|mandrill|gibbon|bonobo|gelada|colobus|capuchin|marmoset|tamarin|lemur|loris|tarsier|ayeaye/, 'a_squeak', 0.7],
  [/trex|giganotosaurus|spinosaurus|allosaurus|carnotaurus|megalosaurus|dragon(?!fly)|manticore/, 'a_bigcat', 0.6],
  [/velociraptor|dilophosaurus/, 'a_bigcat', 1.3],
  [/compsognathus/, 'a_parrot', 0.8],
  [/brachiosaurus|diplodocus|apatosaurus|brontosaurus|mammoth/, 'a_elephant', 0.6],
  [/triceratops|stegosaurus|ankylosaurus|parasaurolophus|iguanodon|pachycephalosaurus/, 'a_hippo', 0.75],
  [/lion|tiger|leopard|jaguar|cheetah|cougar|panther|sabertooth/, 'a_bigcat', 1],
  [/lynx|bobcat|caracal|serval|ocelot|wildcat|sandcat/, 'a_cat', 0.8, 'a_catgrowl'],
  [/^cat$|kitten/, 'a_cat', 1, 'a_catgrowl'],
  [/bear|yeti|sasquatch/, 'a_bear', 1],
  [/wolverine|tasmaniandevil|honeybadger|badger/, 'a_bear', 1.6],
  [/wolf|husky|dingo|jackal|coyote|dhole|wilddog|cerberus/, 'a_wolf', 1, 'a_dog'],
  [/fox/, 'a_dog', 1.35],
  [/hyena/, 'a_dog', 1.15],
  [/dog/, 'a_dog', 1],
  [/elephant(?!shrew)/, 'a_elephant', 1],
  [/hippo|rhino|manatee|dugong/, 'a_hippo', 1],
  [/whale|narwhal|beluga|orca|dolphin|kraken|lakemonster/, 'a_orca', 1],
  [/cow|bull|^ox$|bison|yak|buffalo|muskox|wildebeest|takin/, 'a_cow', 1],
  [/pig|boar|hog|babirusa|peccary|tapir/, 'a_pig', 1],
  [/sheep|alpaca|llama|guanaco|vicuna/, 'a_sheep', 1],
  [/goat|ibex|markhor|chamois|saiga/, 'a_goat', 1],
  [/donkey|mule/, 'a_donkey', 1, 'a_horse'],
  [/horse|pony|zebra|unicorn|pegasus/, 'a_horse', 1],
  [/deer|elk|moose|reindeer|gazelle|impala|kudu|oryx|springbok|gerenuk|dikdik|eland|bongo|nyala|pronghorn|muntjac|giraffe|camel|okapi|jackalope/, 'a_deer', 1],
  [/cricket|grasshopper|mantis|cicada|stickinsect/, 'a_cricket', 1, 'tiny'],
  [/bee|wasp|hornet|^fly$|dragonfly|mosquito|beetle|ladybug|firefly|moth|butterfly|cockroach|termite|ant$|glowworm/, 'a_buzz', 1, 'tiny'],
  [/snake|cobra|python|boa|anaconda|lizard|iguana|gecko|chameleon|komodo|monitor|gila|basilisk|crocodile|alligator|caiman|gharial|tuatara|salamander|newt|axolotl|turtle|tortoise|hydra/, 'hiss', 1],
  [/spider|tarantula|scorpion|centipede|millipede|crab|lobster|shrimp|crayfish|snail|slug|worm|leech|urchin|starfish|jellyfish|sponge|conch|nudibranch|cucumber|strider/, 'tiny', 1],
]

const cache = new Map()

// The voice of one animal kind: { idle, hurt, rate, calls }.
// k: its KINDS entry (body size, swim, fly, legs).
export function animalVoice(kind, k = {}) {
  if (cache.has(kind)) return cache.get(kind)
  const name = String(kind).toLowerCase()
  let v = null
  for (const [test, idle, rate, hurt] of FAMILIES) {
    if (test.test(name)) { v = { idle, hurt: hurt || idle, rate }; break }
  }
  if (!v) {
    if (k.swim) v = { idle: 'splash', hurt: 'splash', rate: 1 }
    else if (k.legs === 6 || k.legs === 8) v = { idle: 'tiny', hurt: 'tiny', rate: 1 }
    else if (k.fly) v = { idle: 'chirp', hurt: 'a_parrot', rate: 1.2 }
    else v = { idle: 'a_squeak', hurt: 'a_squeak', rate: 1 }
  }
  // Size: a big body sounds deeper, a small one higher (gently).
  const b = k.body || [0.5, 0.5, 0.5]
  const size = Math.max(0.05, b[0] * b[1] * b[2])
  v.rate *= Math.max(0.7, Math.min(1.5, Math.pow(0.4 / size, 0.08)))
  // Whether it calls out on its own (fish, bugs that don't buzz and
  // anything that only splashes stay quiet until hit).
  v.calls = !['splash', 'tiny'].includes(v.idle)
  cache.set(kind, v)
  return v
}
