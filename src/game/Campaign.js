// The Story Campaign (2026-11-06, Gaymi's idea list 8: "chapters with a
// plot, like 'find out where the zombies came from and make a cure'. Each
// chapter sends you to places GayZ already has (Moon, Heaven, Dungeons,
// Under City), with short speech-bubble scenes in between" - picked "5
// short chapters").
//
// Dr. Goo has a little lab against a camp wall (owned by BuildCamp,
// `camp.lab`). Press Use at the lab for the next scene: Dr. Goo talks (a
// speech bubble over their head, and the lines in a pop-up you click
// through). Then a Story pill on screen shows the chapter's goal:
//   1. Strange Signals - fly a rocket to the Moon (MoonTrip.js).
//   2. Above the Clouds - climb up to Heaven (HeavenRealm.js).
//   3. Deep Down - find a dungeon underground (Dungeons.js).
//   4. The Lost City - find an underground city (UnderCity.js).
//   5. The Cure - craft The Cure (PlayCrafting) and bring it to Dr. Goo.
// Reaching a goal pays CHAPTER_COINS; go back to the lab for the next
// scene. Finishing the story pays FINALE_COINS. The story is kept on this
// device (KEY) and carries on over as many games as it takes. Each
// player's own, on a server too. Never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { findCampSpot, makeLabel } from './CampTrophies.js'
import { openScreen, closeScreen } from './CampScreen.js'
import { showPill, hidePill } from './PlayPills.js'
import { speechBubble, disposeBubble } from './SpeechBubble.js'
import { buildTexturedCharacter, loadSkinTexture } from './MenuAvatar3D.js'
import { nameTag, NPC_SKINS } from './BuildCamp.js'
import { MOB_HEIGHT } from './PlayRules.js'
import { HEAVEN_FLOOR } from './HeavenRealm.js'
import { citiesOver, cityYRange } from './UnderCity.js'

export const KEY = 'gayz-campaign'
export const CHAPTERS = ['moon', 'heaven', 'dungeon', 'undercity', 'cure']
export const CHAPTER_COINS = 100
export const FINALE_COINS = 500
// Lines in each scene (`storyScene<n>_<i>`): the intro to chapter n, and
// the ending after the last one (n = 5).
export const SCENE_LINES = [4, 3, 3, 3, 4, 4]
export const WIDE = 4
const DEEP = 2
const USE_R = 2
const CITY_R = 44

// { ch: 0..5 (5 = the end), started: the chapter's scene was seen,
//   done: its goal reached }
export function loadStory() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || '{}')
    const ch = Math.max(0, Math.min(CHAPTERS.length, Math.floor(Number(d?.ch) || 0)))
    return { ch, started: !!d?.started, done: !!d?.done }
  } catch {
    return { ch: 0, started: false, done: false }
  }
}

function saveStory(d) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d))
  } catch { /* not kept */ }
}

export class Campaign {
  constructor(camp) {
    this.camp = camp
    this.group = null
    this.spot = null
    this.doc = null
    this.story = loadStory()
    this._checkIn = 0
    this._bubble = null
    this._bubbleLeft = 0
  }

  get s() {
    return this.camp.s
  }

  get B() {
    return this.camp.B
  }

  build(avoid = []) {
    if (this.group) return
    this.spot = findCampSpot(this.camp, WIDE, DEEP, avoid)
    if (!this.spot) return
    const B = this.B
    const g = new THREE.Group()
    const box = (w, h, d, color, x, y, z, emissive = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), new THREE.MeshLambertMaterial({ color, emissive }))
      m.position.set(x * B, y * B, z * B)
      g.add(m)
      return m
    }
    box(WIDE, 3, 0.2, 0xdfe6e8, 0, 1.5, 0.1)
    box(WIDE + 0.3, 0.16, DEEP + 0.3, 0x4a8a5a, 0, 3.05, DEEP / 2)
    // The lab bench with bubbling flasks.
    box(2.4, 0.9, 0.7, 0x7a7f86, -0.5, 0.45, 0.5)
    for (const [x, c] of [[-1.3, 0x6fe36f], [-0.8, 0xff6fd0], [-0.3, 0x6fc8ff], [0.2, 0xffd23f]]) {
      box(0.18, 0.3, 0.18, c, x, 1.05, 0.5, c & 0x3f3f3f)
    }
    const sign = makeLabel(t('labSign'), 512, 44, '#c8ffd0')
    sign.scale.set(2.6 * B, 0.5 * B, 1)
    sign.position.set(0, 3.55 * B, (DEEP + 0.2) * B)
    g.add(sign)
    g.position.set(this.spot.x * B, 0, this.spot.z * B)
    g.rotation.y = this.spot.rot
    this.camp.bm.scene.add(g)
    this.group = g
    // Dr. Goo, beside the bench (blocks), facing into the camp.
    const c = Math.cos(this.spot.rot)
    const sn = Math.sin(this.spot.rot)
    const at = (a, d) => ({ x: this.spot.x + a * c + d * sn, z: this.spot.z - a * sn + d * c })
    const dp = at(1.3, 0.9)
    this.door = at(0.5, 2.2)
    const doc = new THREE.Group()
    doc.position.set(dp.x * B, 0, dp.z * B)
    doc.rotation.y = this.spot.rot
    doc.add(nameTag(t('labDoc'), B))
    this.camp.bm.scene.add(doc)
    this.doc = doc
    loadSkinTexture(NPC_SKINS.upgrader).then((skin) => {
      if (this.doc !== doc) return
      const body = buildTexturedCharacter(skin)
      const sc = (MOB_HEIGHT * B) / 32
      body.scale.setScalar(sc)
      body.position.y = 2 * sc
      doc.add(body)
      // A white lab coat over it.
      const coat = new THREE.Mesh(new THREE.BoxGeometry(0.56 * B, 0.78 * B, 0.34 * B), new THREE.MeshLambertMaterial({ color: 0xf4f4f4 }))
      coat.position.y = 1.12 * B
      doc.add(coat)
    }).catch(() => { /* just the name */ })
  }

  // The chapter's goal text ('' when there's nothing to do out there).
  goalText() {
    const st = this.story
    if (st.ch >= CHAPTERS.length) return ''
    if (!st.started) return t('storyGoTalk')
    if (st.done) return t('storyGoBack')
    return t(`storyGoal_${CHAPTERS[st.ch]}`)
  }

  // p: someone's feet (Couch Co-op's Player 2 - CouchToys.handInCure), else Player 1's.
  near(p = this.camp.bm.tryMode.pos) {
    if (!this.group || !this.door) return false
    return Math.hypot(p.x - this.door.x, p.z - this.door.z) < USE_R && p.y < 3
  }

  prompt() {
    const st = this.story
    if (st.ch >= CHAPTERS.length) return t('labPromptDone')
    if (CHAPTERS[st.ch] === 'cure' && st.started && this.s.inv?.has('theCure')) return t('labPromptCure')
    return t(st.started && !st.done ? 'labPromptGoal' : 'labPromptTalk')
  }

  // Use at the lab.
  use() {
    if (!this.near()) return false
    const s = this.s
    const st = this.story
    if (st.ch < CHAPTERS.length && CHAPTERS[st.ch] === 'cure' && st.started && s.inv?.has('theCure')) {
      s.inv.takeItem('theCure')
      this._finish(st.ch)
      return true
    }
    if (st.ch >= CHAPTERS.length) return this.scene(CHAPTERS.length, true)
    if (!st.started || st.done) {
      // The goal's done: on to the next chapter's scene.
      if (st.done) {
        st.ch++
        st.done = false
        st.started = false
      }
      if (st.ch >= CHAPTERS.length) {
        saveStory(st)
        return this.scene(CHAPTERS.length)
      }
      st.started = true
      saveStory(st)
      return this.scene(st.ch)
    }
    // Still working on it: a reminder.
    s._message(this.goalText(), 3)
    this.say(this.goalText())
    return true
  }

  // A scene: Dr. Goo's lines, one at a time.
  scene(n, again = false) {
    const lines = []
    for (let i = 0; i < SCENE_LINES[n]; i++) lines.push(t(`storyScene${n}_${i}`))
    let i = 0
    const title = n < CHAPTERS.length ? t('storyChapter', { n: n + 1, name: t(`storyTitle_${CHAPTERS[n]}`) }) : t('storyEndTitle')
    this.last = openScreen(this.s, {
      title,
      build: (body, close) => {
        const p = document.createElement('p')
        p.className = 'story-line'
        const who = document.createElement('b')
        who.textContent = t('labDoc')
        const line = document.createElement('span')
        p.append(who, line)
        const next = document.createElement('button')
        next.type = 'button'
        next.className = 'camp-screen-btn'
        const show = () => {
          line.textContent = lines[i]
          this.say(lines[i])
          next.textContent = i < lines.length - 1 ? t('storyNext') : n < CHAPTERS.length ? t('storyGo') : t('storyClose')
        }
        next.addEventListener('click', () => {
          if (i < lines.length - 1) {
            i++
            show()
          } else close()
        })
        body.append(p, next)
        show()
      },
      onClose: () => {
        if (n < CHAPTERS.length && !again) this.s._message(this.goalText(), 4)
      },
    })
    this.lines = lines
    return true
  }

  // A speech bubble over Dr. Goo.
  say(text) {
    if (!this.doc) return
    if (this._bubble) {
      disposeBubble(this._bubble)
      this._bubble.removeFromParent()
    }
    this._bubble = speechBubble(text, this.B)
    this.doc.add(this._bubble)
    this._bubbleLeft = 6
  }

  // The goal's been reached (the update's checks, or the Cure handed in).
  _finish(ch) {
    const s = this.s
    const st = this.story
    if (st.ch !== ch || st.done || !st.started) return false
    if (CHAPTERS[ch] === 'cure') {
      st.ch = CHAPTERS.length
      st.done = false
      st.started = true
      saveStory(st)
      s._earn(FINALE_COINS)
      s._renderHud?.()
      try { audioEngine.playSpecial?.('firework') } catch { /* no audio */ }
      this.scene(CHAPTERS.length)
      return true
    }
    st.done = true
    saveStory(st)
    s._earn(CHAPTER_COINS)
    s._renderHud?.()
    s._message(t('storyChapterDone', { n: ch + 1, c: CHAPTER_COINS }), 5)
    try { audioEngine.playSpecial?.('bell') } catch { /* no audio */ }
    return true
  }

  // Is this chapter's place reached right now?
  reached(ch) {
    const s = this.s
    const p = s.bodyPos()
    const id = CHAPTERS[ch]
    if (id === 'moon') return !!s.moon?.on
    if (id === 'heaven') return p.y >= HEAVEN_FLOOR - 4
    if (id === 'dungeon') return (s._dungeonsSeen?.size || 0) > 0
    if (id === 'undercity') {
      return citiesOver(p.x, p.z, p.x, p.z).some((c) => {
        if (c.dungeon) return false
        const [lo, hi] = cityYRange(c)
        return p.y >= lo && p.y <= hi && Math.hypot(p.x - c.x, p.z - c.z) < CITY_R
      })
    }
    return false
  }

  update(dt) {
    const s = this.s
    if (this._bubble) {
      this._bubbleLeft -= dt
      if (this._bubbleLeft <= 0) {
        disposeBubble(this._bubble)
        this._bubble.removeFromParent()
        this._bubble = null
      }
    }
    const goal = this.goalText()
    // Only once the story's begun (no nagging before you've talked to Dr. Goo).
    if (goal && s.active && (this.story.ch > 0 || this.story.started)) showPill('story', t('storyPill', { goal }))
    else hidePill('story')
    const st = this.story
    if (!st.started || st.done || st.ch >= CHAPTERS.length || CHAPTERS[st.ch] === 'cure') return
    this._checkIn -= dt
    if (this._checkIn > 0) return
    this._checkIn = 0.5
    if (this.reached(st.ch)) this._finish(st.ch)
  }

  dispose() {
    hidePill('story')
    if (this.last) closeScreen(false)
    if (this._bubble) disposeBubble(this._bubble)
    this._bubble = null
    for (const g of [this.group, this.doc]) {
      if (!g) continue
      g.removeFromParent()
      g.traverse((o) => {
        if (!o.isMesh && !o.isSprite) return
        o.geometry?.dispose?.()
        o.material.map?.dispose?.()
        o.material.dispose()
      })
    }
    this.group = null
    this.doc = null
    this.spot = null
  }
}
