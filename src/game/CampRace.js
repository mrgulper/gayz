// Pet Races (2026-11-27, Gaymi's six ideas, batch 2: "your pet races 5 bot
// pets on a track at camp. Before the race, bet coins on any pet; a win
// pays back more"). Owned by BuildCamp (`camp.race`), solo Play only.
//
// Gaymi's answers: you pick which of your caught pets races each time;
// speed + level + luck decide it and you can Cheer (Use key or the Cheer
// button) for a short burst; every pet shows its own odds (favourites pay
// little, long shots a lot); bets are 10 / 50 / 100 or Custom (up to
// MAX_BET), as many races as you like.
//
// - A Race Post stands on open ground in the camp (the walls are full of
//   booths). Use it: a screen to pick your racer, then the six racers with
//   their odds, the pet you bet on and how much.
// - The track itself is too big for the camp, so it goes up in the sky
//   above it (RACE_Y) for the race: real blocks (TempBlocks, all put back
//   after), with a glass rim so nobody falls off. You stand by the finish
//   line, the pets run LANES lanes of TRACK blocks, then you're back at the
//   post. Zombies can't get up there.
// - Bets use the game's camp coins. The winner pays bet x odds. The odds
//   come from RUNS practice races (your pet cheered as often as it can),
//   times HOUSE, so betting isn't free money.
// Meshes only (plus the TempBlocks), never a light. Numbers are a guess.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { findCampSpot, makeLabel } from './CampTrophies.js'
import { TempBlocks } from './TempBlocks.js'
import { openScreen, closeScreen } from './CampScreen.js'
import { loadCreatures, stats, levelOf, creatureName, creatureIconURL, bookKinds, MAX_LEVEL } from './Creatures.js'
import { ZOMBIE_TIERS, ZOMBIE_TIER_IDS } from './ZombieNames.js'
import { zombieModel, animalModel } from './TeamBattle.js'

export const RACERS = 6 // yours + 5 bots
export const LANES = RACERS
export const TRACK = 18 // blocks from the start line to the finish
export const RACE_Y = 160 // the sky track's floor (party arenas sit at 186+)
export const BASE_PACE = 1.8 // blocks a second for an average pet
export const SPEED_W = 0.35 // how much a faster pet's speed counts
export const PACE_MIN = 0.8
export const PACE_MAX = 1.2
export const LUCK_STEP = 1 // a new luck roll this often
export const LUCK_LO = 0.6
export const LUCK_HI = 1.4
export const FORM = 0.12 // each pet's form on the day: its pace x 1 +/- this
export const CHEER_MULT = 1.25
export const CHEER_S = 1
export const CHEER_CD = 3
export const RUNS = 1000 // practice races for the odds
export const HOUSE = 0.88
export const ODDS_MIN = 1.2
export const ODDS_MAX = 25
export const BETS = [10, 50, 100]
export const MAX_BET = 500
export const COUNT_S = 3
export const AFTER_S = 3.5 // the results show this long before you go back
const LIST_MAX = 60
const USE_R = 2.4
const STEP = 0.1 // the practice races' time step

// A pet's racing rating: its speed, a bit more per level, shiny a touch.
export function rating(c) {
  const sp = stats(c).speed || 1
  return sp * (1 + 0.03 * (levelOf(c) - 1)) * (c.s ? 1.05 : 1)
}

// Each racer's base pace (blocks/s), from its rating against the field.
export function paces(list) {
  const r = list.map(rating)
  const mean = r.reduce((a, b) => a + b, 0) / r.length || 1
  return r.map((v) => BASE_PACE * Math.min(PACE_MAX, Math.max(PACE_MIN, 1 + SPEED_W * (v / mean - 1))))
}

// A fresh race state for these paces (each pet's form on the day rolled).
export function newRun(pace, rand = Math.random) {
  return pace.map((p) => ({ p: p * (1 + FORM * (2 * rand() - 1)), x: 0, luck: 1, luckT: 0, boost: 0, cd: 0, at: null }))
}

// One step of a race. auto: the racer (index) that cheers whenever it can.
// -> true once everyone is over the line.
export function stepRun(run, dt, time, rand = Math.random, auto = -1) {
  let all = true
  run.forEach((r, i) => {
    if (r.at !== null) return
    r.luckT -= dt
    if (r.luckT <= 0) {
      r.luck = LUCK_LO + (LUCK_HI - LUCK_LO) * rand()
      r.luckT = LUCK_STEP
    }
    r.cd = Math.max(0, r.cd - dt)
    if (i === auto && r.cd <= 0) cheer(r)
    const v = r.p * r.luck * (r.boost > 0 ? CHEER_MULT : 1)
    r.boost = Math.max(0, r.boost - dt)
    r.x += v * dt
    if (r.x >= TRACK) {
      r.x = TRACK
      r.at = time
    } else all = false
  })
  return all
}

export function cheer(r) {
  if (!r || r.at !== null || r.cd > 0) return false
  r.boost = CHEER_S
  r.cd = CHEER_CD
  return true
}

// Finishing order (racer indexes), first first.
export function order(run) {
  return run.map((r, i) => i).sort((a, b) => (run[a].at ?? Infinity) - (run[b].at ?? Infinity) || run[b].x - run[a].x)
}

// Odds for each racer: how often it wins RUNS practice races (mine cheered
// at every chance), x HOUSE, rounded down to a half.
export function oddsFor(list, mine = 0, rand = Math.random, runs = RUNS) {
  const pace = paces(list)
  const wins = list.map(() => 0)
  for (let k = 0; k < runs; k++) {
    const run = newRun(pace, rand)
    let time = 0
    for (let n = 0; n < 2000; n++) {
      time += STEP
      if (stepRun(run, STEP, time, rand, mine)) break
    }
    wins[order(run)[0]]++
  }
  return wins.map((w) => {
    const p = w / runs
    if (p <= 0) return ODDS_MAX
    return Math.min(ODDS_MAX, Math.max(ODDS_MIN, Math.floor((HOUSE / p) * 2) / 2))
  })
}

// Five bot pets of other kinds, near my pet's level.
export function botPets(mine, rand = Math.random) {
  const pool = bookKinds().filter((k) => !(k.t === mine.t && (k.k || null) === (mine.k || null)))
  const out = []
  const myL = levelOf(mine)
  while (out.length < RACERS - 1 && pool.length) {
    const kind = pool.splice(Math.floor(rand() * pool.length), 1)[0]
    let r = 'common'
    let roll = rand()
    for (const id of ZOMBIE_TIER_IDS) {
      roll -= ZOMBIE_TIERS[id].chance
      if (roll < 0) {
        r = id
        break
      }
    }
    const l = Math.min(MAX_LEVEL, Math.max(1, myL + Math.floor(rand() * 7) - 3))
    const c = kind.t === 'a' ? { t: 'a', k: kind.k, r, l } : { t: 'z', k: kind.k, r, n: 0, b: false, l }
    out.push(c)
  }
  return out
}

// How much is bet: a whole number of coins from 1 to MAX_BET and no more
// than you have; anything else is 0.
export function cleanBet(n, coins) {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v) || v < 1) return 0
  return Math.min(v, MAX_BET, Math.max(0, Math.floor(coins || 0)))
}

export function payout(bet, odds) {
  return Math.floor(bet * odds)
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const sfx = (id) => { try { audioEngine.playSpecial?.(id) } catch { /* no audio */ } }

export class CampRace {
  constructor(camp) {
    this.camp = camp
    this.group = null
    this.spot = null
    this.race = null // the live race
    this.cells = null
  }

  get s() {
    return this.camp.s
  }

  get B() {
    return this.camp.B
  }

  // Racing now (or counting down / showing results)?
  get active() {
    return !!this.race
  }

  // Where you go back to (BuildSurvival.saveRun keeps this instead of a
  // spot in the sky).
  home() {
    return this.race?.home ? { ...this.race.home } : null
  }

  build(avoid = []) {
    if (this.group) return
    const s = this.s
    // Only in a normal solo game (the sky track is each player's own blocks).
    if (s.net || s.party || s.td || s.escape) return
    this.spot = findCampSpot(this.camp, 1, 1, avoid)
    if (!this.spot) return
    const B = this.B
    const g = new THREE.Group()
    const box = (w, h, d, color, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), new THREE.MeshLambertMaterial({ color }))
      m.position.set(x * B, y * B, z * B)
      g.add(m)
      return m
    }
    // A post with a board on top and a chequered flag.
    box(0.2, 2.6, 0.2, 0x7a4f2a, 0, 1.3, 0)
    box(1.6, 0.9, 0.12, 0x5a3a1e, 0, 2.3, 0.12)
    box(0.06, 1.1, 0.06, 0x3a2a18, 0.85, 3.15, 0.12)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) box(0.22, 0.22, 0.04, (i + j) % 2 ? 0x111111 : 0xf4f4f4, 1 + i * 0.22, 3.5 - j * 0.22, 0.12)
    const sign = makeLabel(t('raceSign'), 512, 44, '#ffd23f')
    sign.scale.set(2.4 * B, 0.45 * B, 1)
    sign.position.set(0, 3.95 * B, 0.2 * B)
    g.add(sign)
    g.position.set((this.spot.x + 0.5) * B, 0, (this.spot.z + 0.5) * B)
    g.rotation.y = this.spot.rot
    this.camp.bm.scene.add(g)
    this.group = g
  }

  _mid() {
    return { x: this.spot.x + 0.5, z: this.spot.z + 0.5 }
  }

  near() {
    if (!this.group || this.race) return false
    const p = this.camp.bm.tryMode.pos
    const m = this._mid()
    const dx = m.x - p.x
    const dz = m.z - p.z
    const d = Math.hypot(dx, dz)
    if (d > USE_R) return false
    if (d < 0.6) return true
    const yaw = this.camp.bm._yaw
    return (dx * -Math.sin(yaw) + dz * -Math.cos(yaw)) / d > 0.5
  }

  // The Use key (BuildCamp.use): cheers during a race, opens the post's
  // screen next to it. -> true if it was the race.
  use() {
    if (this.race) {
      this.cheer()
      return true
    }
    if (!this.near()) return false
    this.openPick()
    return true
  }

  // --- The screens ---

  // Step 1: which of my pets races.
  openPick() {
    const data = loadCreatures()
    const team = data.team.map((id) => data.list.find((c) => c.id === id)).filter(Boolean)
    const rest = data.list.filter((c) => !data.team.includes(c.id))
    const list = [...team, ...rest].slice(0, LIST_MAX)
    this.screen = { step: 'pick' }
    openScreen(this.s, {
      title: t('raceTitle'),
      wide: true,
      build: (body, close) => {
        const note = document.createElement('p')
        note.className = 'camp-screen-note'
        body.appendChild(note)
        if (!list.length) {
          note.textContent = t('raceNoPets')
          const ok = document.createElement('button')
          ok.type = 'button'
          ok.className = 'camp-screen-btn'
          ok.textContent = t('raceOk')
          ok.addEventListener('click', close)
          body.appendChild(ok)
          return
        }
        note.textContent = t('racePickNote')
        const grid = document.createElement('div')
        grid.className = 'race-pets'
        for (const c of list) {
          const b = document.createElement('button')
          b.type = 'button'
          b.className = 'race-pet'
          b.dataset.id = String(c.id)
          b.innerHTML = `<img src="${creatureIconURL(c)}" alt="" draggable="false" /><span class="race-pet-name">${esc(creatureName(c))}</span><span class="race-pet-lv">${esc(t('raceLevel', { n: levelOf(c) }))}</span>`
          b.addEventListener('click', () => this.openBet(c))
          grid.appendChild(b)
        }
        body.appendChild(grid)
      },
    })
  }

  // Step 2: the six racers with their odds, the bet, Start.
  openBet(mine, bots = botPets(mine)) {
    const list = [mine, ...bots]
    const odds = oddsFor(list, 0)
    const st = { step: 'bet', list, odds, pick: -1, amount: BETS[0] }
    this.screen = st
    const s = this.s
    openScreen(s, {
      title: t('raceTitle'),
      wide: true,
      build: (body) => {
        const help = document.createElement('p')
        help.className = 'camp-screen-note'
        help.textContent = t('raceBetNote')
        const rows = document.createElement('div')
        rows.className = 'race-rows'
        const amounts = document.createElement('div')
        amounts.className = 'race-amounts'
        const custom = document.createElement('input')
        custom.type = 'number'
        custom.min = '1'
        custom.max = String(MAX_BET)
        custom.inputMode = 'numeric'
        custom.className = 'nickname-input race-custom'
        custom.placeholder = t('raceCustom')
        const note = document.createElement('p')
        note.className = 'camp-screen-note race-sum'
        const go = document.createElement('button')
        go.type = 'button'
        go.className = 'camp-screen-btn race-go'
        const back = document.createElement('button')
        back.type = 'button'
        back.className = 'camp-screen-btn race-back'
        back.textContent = t('raceBack')
        back.addEventListener('click', () => this.openPick())
        const render = () => {
          rows.querySelectorAll('.race-row').forEach((el, i) => el.classList.toggle('pick', i === st.pick))
          amounts.querySelectorAll('.race-amount').forEach((el) => el.classList.toggle('pick', el.dataset.n === String(st.amount)))
          const bet = st.pick >= 0 ? cleanBet(st.amount, s.coins) : 0
          if (st.pick < 0) note.textContent = t('raceNoBet', { coins: Math.floor(s.coins || 0) })
          else if (!bet) note.textContent = t('raceNoCoins', { coins: Math.floor(s.coins || 0) })
          else note.textContent = t('raceBetSum', { n: bet, name: creatureName(list[st.pick]), win: payout(bet, odds[st.pick]), coins: Math.floor(s.coins || 0) })
          go.textContent = st.pick >= 0 && bet ? t('raceStartBet', { n: bet }) : t('raceStart')
        }
        list.forEach((c, i) => {
          const b = document.createElement('button')
          b.type = 'button'
          b.className = `race-row${i === 0 ? ' mine' : ''}`
          const who = i === 0 ? ` <em>${esc(t('raceYours'))}</em>` : ''
          b.innerHTML = `<img src="${creatureIconURL(c)}" alt="" draggable="false" /><span class="race-row-name">${esc(creatureName(c))}${who}</span><span class="race-row-lv">${esc(t('raceLevel', { n: levelOf(c) }))}</span><b class="race-row-odds">x${odds[i]}</b>`
          b.addEventListener('click', () => {
            st.pick = st.pick === i ? -1 : i
            render()
          })
          rows.appendChild(b)
        })
        for (const n of BETS) {
          const b = document.createElement('button')
          b.type = 'button'
          b.className = 'race-amount'
          b.dataset.n = String(n)
          b.textContent = String(n)
          b.addEventListener('click', () => {
            st.amount = n
            custom.value = ''
            render()
          })
          amounts.appendChild(b)
        }
        custom.addEventListener('input', () => {
          const v = Math.min(MAX_BET, Math.max(0, Math.floor(Number(custom.value) || 0)))
          st.amount = v
          render()
        })
        amounts.appendChild(custom)
        go.addEventListener('click', () => {
          const bet = st.pick >= 0 ? cleanBet(st.amount, s.coins) : 0
          if (st.pick >= 0 && !bet) return
          closeScreen()
          this.start(list, odds, st.pick, bet)
        })
        const btns = document.createElement('div')
        btns.className = 'race-btns'
        btns.append(back, go)
        body.append(help, rows, amounts, note, btns)
        render()
      },
    })
    return st
  }

  // --- The race ---

  start(list, odds, pick = -1, bet = 0) {
    if (this.race) return false
    const s = this.s
    const bm = this.camp.bm
    bet = pick >= 0 ? cleanBet(bet, s.coins) : 0
    if (bet) {
      s.coins -= bet
      s._coinStat?.('campOut', 'other', bet)
      s._renderHud?.()
    }
    const tm = bm.tryMode
    const zn = this.camp.zone
    // The track over the middle of the camp.
    const ox = Math.floor((zn.x0 + zn.x1) / 2) - Math.floor(TRACK / 2)
    const oz = Math.floor((zn.z0 + zn.z1) / 2) - LANES
    const race = {
      list,
      odds,
      pick,
      bet,
      ox,
      oz,
      t: 0,
      phase: 'count',
      count: COUNT_S,
      run: newRun(paces(list)),
      home: { x: tm.pos.x, y: tm.pos.y, z: tm.pos.z, yaw: bm._yaw },
      pets: [],
      after: AFTER_S,
      paid: false,
    }
    this.race = race
    this._buildTrack(race)
    this._buildPets(race)
    // Stand by the finish line, looking across the lanes.
    tm.pos.set(ox + TRACK - 2.5, RACE_Y + 1, oz - 2 + 0.5)
    tm.vel?.set(0, 0, 0)
    bm._yaw = Math.PI - 0.6 // towards the start, so the pets run at you
    this._showCheer(true)
    s._message(t('raceCount', { n: COUNT_S }), 1)
    sfx('drum')
    return true
  }

  // The lanes, the start and finish lines, a stand to watch from and a
  // glass rim round it all (two high, so you can't jump off).
  _buildTrack(race) {
    const cells = (this.cells = new TempBlocks(this.s))
    const { ox, oz } = race
    const y = RACE_Y
    const x0 = ox - 3
    const x1 = ox + TRACK + 3
    const z0 = oz - 4 // the stand: oz-4 .. oz-1
    const z1 = oz + LANES * 2 - 1
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        let type
        if (z < oz) type = 'oakplanks'
        else if (x === ox) type = 'redwool'
        else if (x === ox + TRACK) type = (x + z) % 2 ? 'blackconcrete' : 'whiteconcrete'
        else type = Math.floor((z - oz) / 2) % 2 ? 'smoothstone' : 'whiteconcrete'
        cells.put(x, y, z, type)
      }
    }
    for (let h = 1; h <= 2; h++) {
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        cells.put(x, y + h, z0 - 1, 'glass')
        cells.put(x, y + h, z1 + 1, 'glass')
      }
      for (let z = z0; z <= z1; z++) {
        cells.put(x0 - 1, y + h, z, 'glass')
        cells.put(x1 + 1, y + h, z, 'glass')
      }
    }
  }

  _buildPets(race) {
    const B = this.B
    const scene = this.camp.bm.scene
    race.list.forEach((c, i) => {
      const holder = new THREE.Group()
      let legs
      let arms = []
      let own = null
      if (c.t === 'a') {
        // PlayAnimals' models share their kind's materials (never disposed).
        const built = animalModel(c.k)
        built.group.scale.setScalar(B)
        holder.add(built.group)
        legs = built.legs || []
      } else {
        const z = zombieModel(c)
        z.group.scale.multiplyScalar(B)
        holder.add(z.group)
        legs = z.legs || []
        arms = z.arms || []
        own = z
      }
      // Facing down the track (+x).
      holder.rotation.y = Math.PI / 2
      const tag = makeLabel(`${creatureName(c)}  x${race.odds[i]}`, 512, 36, i === 0 ? '#ffd23f' : i === race.pick ? '#8af0ff' : '#ffffff')
      tag.scale.set(2.6 * B, 0.46 * B, 1)
      tag.position.set(0, 2.7 * B, 0)
      const g = new THREE.Group()
      g.add(holder, tag)
      g.position.set(race.ox * B, (RACE_Y + 1) * B, (race.oz + i * 2 + 1) * B)
      scene.add(g)
      race.pets.push({ g, holder, legs, arms, own, tag, ph: Math.random() * 6 })
    })
  }

  cheer() {
    const race = this.race
    if (!race || race.phase !== 'run') return false
    const ok = cheer(race.run[0])
    if (ok) {
      sfx('pop')
      this.s._message(t('raceCheered'), 1)
    }
    return ok
  }

  _showCheer(on) {
    let el = document.getElementById('pet-race-cheer')
    if (on && !el) {
      el = document.createElement('button')
      el.type = 'button'
      el.id = 'pet-race-cheer'
      el.textContent = t('raceCheer')
      // pointerdown so a phone tap counts at once (and never reaches the game).
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.cheer()
      })
      document.body.appendChild(el)
    }
    if (el) el.style.display = on ? 'block' : 'none'
    if (!on) el?.remove()
  }

  // Every frame (BuildCamp.update).
  update(dt) {
    const race = this.race
    if (!race) return
    const s = this.s
    if (!s.active || s.dead) {
      this._end(false)
      return
    }
    // Keep you on the stand side if something pushed you off the track.
    const tm = this.camp.bm.tryMode
    if (tm.pos.y < RACE_Y - 2) tm.pos.set(race.ox + TRACK - 2.5, RACE_Y + 1, race.oz - 2 + 0.5)
    race.t += dt
    const B = this.B
    if (race.phase === 'count') {
      const before = Math.ceil(race.count)
      race.count -= dt
      const now = Math.ceil(race.count)
      if (race.count <= 0) {
        race.phase = 'run'
        race.t = 0
        s._message(t('raceGo'), 1.2)
        sfx('firework')
      } else if (now !== before) {
        s._message(t('raceCount', { n: now }), 1)
        sfx('pop')
      }
    } else if (race.phase === 'run') {
      const all = stepRun(race.run, dt, race.t)
      if (race.run.some((r) => r.at !== null) && !race.first) {
        race.first = true
        sfx('chime')
      }
      if (all) this._results()
    } else {
      race.after -= dt
      if (race.after <= 0) this._end(true)
    }
    // Move and animate the pets.
    race.pets.forEach((p, i) => {
      const r = race.run[i]
      p.g.position.x = (race.ox + r.x) * B
      const moving = race.phase === 'run' && r.at === null
      p.ph += dt * (moving ? 12 * (r.boost > 0 ? 1.4 : 1) : 0)
      const sw = moving ? Math.sin(p.ph) * 0.7 : 0
      p.legs.forEach((l, k) => { l.rotation.x = k % 2 ? sw : -sw })
      p.holder.position.y = moving ? Math.abs(Math.sin(p.ph)) * 0.12 * B : 0
    })
  }

  _results() {
    const race = this.race
    const s = this.s
    race.phase = 'done'
    const ord = order(race.run)
    race.order = ord
    const place = ord.indexOf(0) + 1
    const winner = ord[0]
    let text = t('raceWinner', { name: creatureName(race.list[winner]) }) + ' ' + t('racePlace', { n: place })
    if (race.pick >= 0 && race.bet > 0 && !race.paid) {
      race.paid = true
      if (winner === race.pick) {
        const won = payout(race.bet, race.odds[race.pick])
        s.coins += won
        // Only what you came out ahead counts towards the coins you keep.
        s._coinsEarned = Math.max(0, (s._coinsEarned || 0) + won - race.bet)
        s._coinStat?.('campIn', 'minigames', won)
        race.won = won
        text += ' ' + t('raceBetWon', { n: won })
        sfx('firework')
      } else {
        s._coinsEarned = Math.max(0, (s._coinsEarned || 0) - race.bet)
        race.won = 0
        text += ' ' + t('raceBetLost', { n: race.bet })
      }
      s._renderHud?.()
    }
    race.text = text
    s._message(text, AFTER_S + 1.5)
    this._showCheer(false)
  }

  // Back to the post; the track and pets go.
  _end(goHome) {
    const race = this.race
    if (!race) return
    this.race = null
    this._showCheer(false)
    for (const p of race.pets) {
      p.g.removeFromParent()
      p.tag.material.map?.dispose()
      p.tag.material.dispose()
      if (p.own) {
        p.own.group.traverse((o) => { if (o.isMesh) o.geometry.dispose() })
        for (const m of p.own.mats || []) m.dispose()
      }
    }
    this.cells?.restore()
    this.cells = null
    if (goHome) {
      const bm = this.camp.bm
      bm.tryMode.pos.set(race.home.x, race.home.y, race.home.z)
      bm.tryMode.vel?.set(0, 0, 0)
      bm._yaw = race.home.yaw
    }
  }

  dispose() {
    if (this.race) this._end(false)
    if (this.screen) closeScreen(false)
    this.screen = null
    if (!this.group) return
    this.group.removeFromParent()
    this.group.traverse((o) => {
      if (!o.isMesh && !o.isSprite) return
      o.geometry?.dispose?.()
      for (const m of [].concat(o.material)) {
        m.map?.dispose?.()
        m.dispose()
      }
    })
    this.group = null
  }
}

// The race maths, for tests driving the built game (`camp.race.lib`).
CampRace.prototype.lib = { botPets, oddsFor, cleanBet, payout, RACE_Y, ODDS_MIN, ODDS_MAX, MAX_BET }
