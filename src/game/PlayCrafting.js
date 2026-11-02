// Crafting (2026-10-31, Gaymi's idea list 2, medium batch: "crafting" -
// picked "makes gear AND blocks"). The inventory's second tab (Tab ->
// Crafting, PlayInventory.js): every recipe is a row with what it makes,
// what it needs (how many you have / need) and a Craft button.
//
// - Ingredients are counted over the hotbar and the grid. A `group` takes
//   any block whose id matches (any log, any stone...), so you don't need
//   one exact kind.
// - Materials: blocks you break, Zombie Goo (zombies drop it, GOO_CHANCE),
//   Plant Fiber (harvested Crop Plots, BuildSpecials._useCrop) and food.
// - Boats, Helicopters and Heli Fuel (Vehicles.js) are items too.
// - Gear goes in as items, blocks as blocks (placed like any held block).
//   A Crop Plot is a block too: placed in the camp it stays there between
//   games and keeps growing (CampFarm.js).
import { t } from './i18n.js'
import { ITEMS, itemName } from './PlayInventory.js'
import { winterOn } from './Snowballs.js'

// A killed zombie (mine) drops Zombie Goo this often (BuildSurvival.damageZombie).
export const GOO_CHANCE = 0.45

// Groups of blocks that count as one ingredient.
const GROUPS = {
  log: { key: 'craftAnyLog', test: (id) => /log$|stem$/.test(id) && !/^stripped/.test(id) },
  planks: { key: 'craftAnyPlanks', test: (id) => /planks$/.test(id) },
  stone: { key: 'craftAnyStone', test: (id) => /^(stone|cobblestone|mossycobblestone|cobbleddeepslate|deepslate|andesite|diorite|granite|tuff|smoothstone|blackstone)$/.test(id) },
  dirt: { key: 'craftAnyDirt', test: (id) => /^(dirt|grass|coarsedirt|rooteddirt|podzol|mud|dirtpath|mycelium)$/.test(id) },
  sand: { key: 'craftAnySand', test: (id) => /^(sand|redsand)$/.test(id) },
}

// { id, kind, n (made), needs: [{ group | item | block, n }] }. Shown in
// this order: gear first, then blocks.
export const RECIPES = [
  { id: 'gooDisguise', kind: 'item', n: 1, needs: [{ item: 'zombieGoo', n: 3 }] },
  { id: 'healthpack', kind: 'item', n: 1, needs: [{ item: 'veggies', n: 2 }, { item: 'plantFiber', n: 2 }] },
  { id: 'ammobox', kind: 'item', n: 1, needs: [{ group: 'stone', n: 4 }, { group: 'log', n: 1 }] },
  { id: 'catchTrap', kind: 'item', n: 2, needs: [{ group: 'log', n: 2 }, { group: 'stone', n: 2 }] },
  // Boats and helicopters (Vehicles.js, 2026-11-01 big batch).
  { id: 'boat', kind: 'item', n: 1, needs: [{ group: 'planks', n: 6 }, { group: 'log', n: 2 }] },
  { id: 'helicopter', kind: 'item', n: 1, needs: [{ group: 'stone', n: 12 }, { block: 'glass', n: 2 }, { group: 'planks', n: 4 }, { item: 'zombieGoo', n: 4 }] },
  { id: 'heliFuel', kind: 'item', n: 1, needs: [{ item: 'zombieGoo', n: 2 }, { group: 'log', n: 1 }] },
  { id: 'helmet', kind: 'item', n: 1, needs: [{ group: 'stone', n: 5 }] },
  { id: 'chestplate', kind: 'item', n: 1, needs: [{ group: 'stone', n: 8 }] },
  { id: 'leggings', kind: 'item', n: 1, needs: [{ group: 'stone', n: 7 }] },
  { id: 'boots', kind: 'item', n: 1, needs: [{ group: 'stone', n: 4 }] },
  { id: 'shield', kind: 'item', n: 1, needs: [{ group: 'planks', n: 6 }] },
  { id: 'potionSpeed', kind: 'item', n: 1, needs: [{ item: 'veggies', n: 1 }, { item: 'plantFiber', n: 1 }, { block: 'glass', n: 1 }] },
  { id: 'potionInvis', kind: 'item', n: 1, needs: [{ item: 'zombieGoo', n: 2 }, { block: 'glass', n: 1 }] },
  { id: 'potionGiant', kind: 'item', n: 1, needs: [{ item: 'veggies', n: 2 }, { item: 'zombieGoo', n: 1 }, { block: 'glass', n: 1 }] },
  { id: 'potionTiny', kind: 'item', n: 1, needs: [{ item: 'plantFiber', n: 2 }, { group: 'sand', n: 1 }, { block: 'glass', n: 1 }] },
  { id: 'jetpack', kind: 'item', n: 1, needs: [{ group: 'stone', n: 10 }, { item: 'heliFuel', n: 1 }, { item: 'zombieGoo', n: 3 }] },
  { id: 'jetFuel', kind: 'item', n: 1, needs: [{ item: 'zombieGoo', n: 2 }] },
  { id: 'metalDetector', kind: 'item', n: 1, needs: [{ group: 'stone', n: 6 }, { block: 'glass', n: 1 }, { item: 'zombieGoo', n: 1 }] },
  // Winter only (Snowballs.winterOn): a Snow block packs into four.
  { id: 'snowball', kind: 'item', n: 4, needs: [{ block: 'snow', n: 1 }], winter: true },
  { id: 'cropplot', kind: 'block', n: 1, needs: [{ group: 'dirt', n: 4 }, { group: 'log', n: 1 }] },
  { id: 'oakplanks', kind: 'block', n: 4, needs: [{ group: 'log', n: 1 }] },
  { id: 'crate', kind: 'block', n: 1, needs: [{ group: 'planks', n: 4 }] },
  { id: 'stonebricks', kind: 'block', n: 4, needs: [{ group: 'stone', n: 4 }] },
  { id: 'glass', kind: 'block', n: 1, needs: [{ group: 'sand', n: 2 }] },
  { id: 'brick', kind: 'block', n: 2, needs: [{ group: 'dirt', n: 2 }, { group: 'sand', n: 2 }] },
]

// Does inventory item `it` count for ingredient `need`?
function fits(it, need) {
  if (!it) return false
  if (need.item) return it.kind === 'item' && it.id === need.item
  if (need.block) return it.kind === 'block' && it.id === need.block
  return it.kind === 'block' && GROUPS[need.group].test(it.id)
}

export class PlayCrafting {
  constructor(inv) {
    this.inv = inv
  }

  get bm() {
    return this.inv.bm
  }

  // How many of an ingredient you have (hotbar + grid).
  have(need) {
    let n = 0
    for (const list of [this.inv.hotbar, this.inv.grid]) for (const it of list) if (fits(it, need)) n += it.n
    return n
  }

  canCraft(r) {
    if (r.winter && !winterOn(this.bm.game?.settings)) return false
    return r.needs.every((need) => this.have(need) >= need.n)
  }

  // Takes the ingredients (the grid first, so the hotbar keeps what you
  // hold) and puts the result in. -> true if made.
  craft(id) {
    const r = RECIPES.find((x) => x.id === id)
    if (!r || !this.canCraft(r) || (r.kind === 'block' && !this.bm.isBlockType(r.id))) return false
    const inv = this.inv
    for (const need of r.needs) {
      let left = need.n
      for (const list of [inv.grid, inv.hotbar]) {
        for (let i = 0; i < list.length && left > 0; i++) {
          if (!fits(list[i], need)) continue
          const k = Math.min(left, list[i].n)
          inv._take(list, i, k)
          left -= k
        }
      }
    }
    const lost = inv.add({ kind: r.kind, id: r.id, n: r.n })
    // No room: what didn't fit goes on the ground at your feet.
    if (lost > 0) {
      const p = this.bm.tryMode.pos
      for (let i = 0; i < lost; i++) {
        if (r.kind === 'item') inv.s._drops?.spawnItem(r.id, p.x, p.y + 1, p.z)
        else inv.s._drops?.spawn(r.id, p.x, p.y + 1, p.z)
      }
    }
    inv.s._message(t('craftMade', { n: r.n, item: this.name(r) }))
    inv.apply()
    return true
  }

  name(r) {
    return r.kind === 'block' ? this.bm.blockName(r.id) : itemName(r.id)
  }

  _needName(need) {
    if (need.item) return itemName(need.item)
    if (need.block) return this.bm.blockName(need.block)
    return t(GROUPS[need.group].key)
  }

  // The Crafting tab's rows (PlayInventory.render).
  html() {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
    const winter = winterOn(this.bm.game?.settings)
    const rows = RECIPES.filter((r) => (r.kind === 'item' ? ITEMS[r.id] : this.bm.isBlockType(r.id)) && (!r.winter || winter)).map((r) => {
      const ok = this.canCraft(r)
      const icon = this.inv._icon({ kind: r.kind, id: r.id })
      const needs = r.needs.map((need) => {
        const have = this.have(need)
        return `<span class="craft-need${have >= need.n ? ' ok' : ''}">${Math.min(have, need.n)}/${need.n} ${esc(this._needName(need))}</span>`
      }).join('')
      return `<div class="craft-row${ok ? ' ready' : ''}">
        <div class="inv-slot craft-icon">${icon ? `<img src="${icon}" alt="" draggable="false">` : ''}${r.n > 1 ? `<span class="inv-slot-count">${r.n}</span>` : ''}</div>
        <div class="craft-text"><b>${esc(this.name(r))}</b><div class="craft-needs">${needs}</div></div>
        <button type="button" class="craft-btn" data-craft="${r.id}"${ok ? '' : ' disabled'}>${t('craftBtn')}</button>
      </div>`
    }).join('')
    return `<div class="craft-list">${rows}</div>`
  }
}
