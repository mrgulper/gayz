// Hidden pace tuning (2026-11-14, Batch 4a: "doing great -> slightly
// tougher waves; struggling -> slightly easier. You never see it happen").
// Owned by BuildSurvival (`s.pace`).
//
// At each wave start it looks at the wave before: how much of your max
// health the zombies took off you (`hurt`, from _hurtPlayer) and how much
// health you have left.
//   - Barely touched (under EASY_HURT of your max health) and still healthy
//     (over EASY_HEALTH): `level` goes up by STEP_UP.
//   - Took a beating (over HARD_HURT) or low on health (under LOW_HEALTH):
//     `level` goes down by STEP_DOWN.
// `level` stays within -MAX..+MAX. New zombies get 1 + level more health,
// and 1 + level x HALF more speed and bite (so at most +-15% health and
// +-7.5% speed/bite - a nudge on top of the chosen difficulty, never a
// different game). Zombies already out keep what they spawned with.
//
// No message, pill or number anywhere: it's meant to be felt, not seen.
// Off in Speedrun (its clock should be fair), Tower Defense, party modes,
// Escape Rooms and no-zombie games; on a server only the host runs it
// (its zombies are the host's).
export const STEP_UP = 0.05
export const STEP_DOWN = 0.08
export const MAX = 0.15
export const HALF = 0.5
export const EASY_HURT = 0.15
export const EASY_HEALTH = 0.7
export const HARD_HURT = 0.6
export const LOW_HEALTH = 0.35

export class PaceTuning {
  constructor(survival) {
    this.s = survival
    this.clear()
  }

  get allowed() {
    const s = this.s
    return s.active && !s.speedrun && !s.party && !s.td && !s.escape && !s.cfg?.noZombies && (!s.net || s.net.isHost)
  }

  clear() {
    this.level = 0
    this.hurt = 0
  }

  // Damage that got through to me (BuildSurvival._hurtPlayer).
  onHurt(amount) {
    if (amount > 0) this.hurt += amount
  }

  // A new wave (BuildSurvival._startWave), before its zombies come.
  onWaveStart(wave) {
    const s = this.s
    const max = s.maxHealth || 100
    const hurt = this.hurt / max
    this.hurt = 0
    // Nothing to judge before the first wave.
    if (!this.allowed || wave <= 1) return
    const health = (s.health || 0) / max
    if (hurt < EASY_HURT && health > EASY_HEALTH) this.level += STEP_UP
    else if (hurt > HARD_HURT || health < LOW_HEALTH) this.level -= STEP_DOWN
    this.level = Math.max(-MAX, Math.min(MAX, +this.level.toFixed(3)))
  }

  // A new zombie (BuildSurvival._spawnZombie / _extraZombie).
  apply(z) {
    if (!z || !this.allowed || !this.level) return
    const hp = 1 + this.level
    z.health *= hp
    z.maxHealth = (z.maxHealth || 0) * hp || z.health
    const more = 1 + this.level * HALF
    z.paceMult = more
    z.damageMult = (z.damageMult || 1) * more
  }
}
