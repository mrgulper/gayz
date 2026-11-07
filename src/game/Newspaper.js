// The Zombie Newspaper (2026-11-06, Gaymi's idea list 8: "a daily silly
// front page made from your own stats: LOCAL HERO KILLS 412 ZOMBIES,
// STILL CAN'T SWIM"). A newsstand at the camp's plaza (CampPlaza.js):
// press Use at it to read today's paper.
//
// The front page is made from your own numbers - lifetime kills, deaths,
// runs, best wave, coins ever earned, time played, the Zombie Book - and
// this game's kills and chests. Which headline, joke and stories you get
// is picked from today's date, so it's the same paper all day and a new
// one tomorrow (the numbers in it are always the latest).
import { t } from './i18n.js'
import { openScreen } from './CampScreen.js'
import { loadBook, BOOK_IDS } from './ZombieBook.js'

export const HEADLINES = 6
export const JOKES = 10
export const STORIES = 6
// Stories on one front page (under the headline).
export const PER_PAGE = 3

// A small number from a day and a salt, the same all day.
function dayPick(day, salt, n) {
  let h = 2166136261 ^ salt
  for (const c of day) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return Math.abs(h) % n
}

export function todayKey(now = new Date()) {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
}

// Every number the paper uses.
export function paperStats(s) {
  const g = s.bm.game || {}
  const c = g.careerStats || {}
  const book = loadBook()
  return {
    kills: Math.max(0, Number(c.totalKills) || 0) + (s.stats?.kills || 0),
    deaths: Math.max(0, Number(c.totalDeaths) || 0),
    runs: Math.max(0, Number(c.totalRuns) || 0),
    wave: Math.max(Number(g.bestStats?.bestWave) || 0, s.wave || 0),
    coins: Math.max(0, Number(c.lifetimeCoinsEarned) || 0),
    hours: Math.floor((Number(c.lifetimePlaytimeSeconds) || 0) / 3600),
    book: BOOK_IDS.filter((id) => book[id]).length,
    bookMax: BOOK_IDS.length,
    runKills: s.stats?.kills || 0,
    chests: s.stats?.chests || 0,
  }
}

// The paper as plain text: { date, headline, stories: [..] }.
export function frontPage(s, now = new Date()) {
  const day = todayKey(now)
  const n = paperStats(s)
  const vars = { ...n, kills: n.kills.toLocaleString(), coins: n.coins.toLocaleString() }
  const joke = t(`newsJoke${dayPick(day, 7, JOKES)}`)
  const headline = t(`newsHead${dayPick(day, 3, HEADLINES)}`, { ...vars, joke })
  const first = dayPick(day, 11, STORIES)
  const stories = []
  for (let i = 0; i < PER_PAGE; i++) stories.push(t(`newsStory${(first + i * 2) % STORIES}`, vars))
  return { date: now.toLocaleDateString(), headline, stories }
}

export function openNewspaper(s) {
  const page = frontPage(s)
  return openScreen(s, {
    title: t('newsTitle'),
    build(body) {
      body.classList.add('news-page')
      const top = document.createElement('div')
      top.className = 'news-masthead'
      top.textContent = t('newsMasthead')
      const date = document.createElement('div')
      date.className = 'news-date'
      date.textContent = t('newsDate', { date: page.date })
      const head = document.createElement('h2')
      head.className = 'news-headline'
      head.textContent = page.headline
      body.append(top, date, head)
      const cols = document.createElement('div')
      cols.className = 'news-stories'
      for (const story of page.stories) {
        const p = document.createElement('p')
        p.textContent = story
        cols.appendChild(p)
      }
      body.appendChild(cols)
    },
  })
}
