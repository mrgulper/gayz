// A silly line on the You Died card (2026-10-30, Gaymi: "You were eaten
// by Gary, a zombie who used to be an accountant", family-friendly). The
// zombie that got you is named (ZombieNames.js), with a random old job
// from before it was a zombie. Died some other way (a fall, the sun,
// another player's server)? One of the "nobody did it" lines instead.
//
// i18n: deathJoke1..N take {name} and {job}; deathJob1..N are "an
// accountant" style (with their article); deathJokeAlone1..N stand alone.
import { t } from './i18n.js'

export const DEATH_JOKE_COUNT = 8
export const DEATH_JOB_COUNT = 24
export const DEATH_ALONE_COUNT = 6

const pick = (n) => 1 + Math.floor(Math.random() * n)

export function deathJoke(zombieName = null) {
  if (!zombieName) return t(`deathJokeAlone${pick(DEATH_ALONE_COUNT)}`)
  return t(`deathJoke${pick(DEATH_JOKE_COUNT)}`, { name: zombieName, job: t(`deathJob${pick(DEATH_JOB_COUNT)}`) })
}
