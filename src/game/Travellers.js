// Who can climb into the Rocket (MoonTrip.js) or the Time Machine
// (TimeMachine.js): Player 1, and Couch Co-op's equal Player 2 (2026-11-14,
// Batch 5c - Gaymi: world-changers take only whoever climbs in, so Player 2
// can go to the Moon or an era alone, and Player 1 stays home unless they
// climb in too).
//
// traveller(s, 'p1' | 'p2') -> one small object with the same things for
// either player (or null when there's no equal Player 2 in the game):
//   pos()             where their body is (blocks)
//   yaw()             which way they face
//   put(x, y, z)      moves them there, standing still
//   say(text, secs)   their own message line (Player 2: their half)
//   take(id) / count(id)   an item from their own inventory
//   pay(n)            coins to them (Player 2's are their own, a guest's)
//   leaveRide()       out of any vehicle first

export function traveller(s, id) {
  if (id === 'p1') {
    const tm = s.bm.tryMode
    return {
      id,
      pos: () => s.bodyPos(),
      yaw: () => s.bm._yaw,
      put(x, y, z) {
        tm.pos.set(x, y, z)
        tm.vel?.set(0, 0, 0)
      },
      say: (text, secs) => s._message(text, secs),
      take: (item) => !!s.inv?.takeItem(item),
      count: (item) => {
        let n = 0
        for (const list of [s.inv?.grid || [], s.inv?.hotbar || []]) for (const it of list) if (it?.kind === 'item' && it.id === item) n += it.n || 1
        return n
      },
      pay(n) {
        s.coins = (s.coins || 0) + n
        s._renderHud?.()
      },
      leaveRide: () => s.kart?.leave?.(),
    }
  }
  const c = s.couch
  if (id !== 'p2' || !c?.gear || !c.joined) return null
  const p = c.p2
  return {
    id,
    pos: () => p,
    yaw: () => p.yaw,
    put(x, y, z) {
      p.x = x
      p.y = y
      p.z = z
      p.vx = p.vy = p.vz = 0
    },
    say: (text, secs) => c.p2Message(text, secs),
    take: (item) => c.gear.takeItem(item),
    count: (item) => [...c.gear.hot, ...c.gear.bag].reduce((n, it) => n + (it?.kind === 'item' && it.id === item ? it.n || 1 : 0), 0),
    pay(n) {
      c.gear.coins += n
      c.gear._checkQuests?.()
    },
    leaveRide: () => c.hands?.leave(true),
  }
}

// Everyone who could travel right now: Player 1, then an equal Player 2.
export function travellerIds(s) {
  return traveller(s, 'p2') ? ['p1', 'p2'] : ['p1']
}
