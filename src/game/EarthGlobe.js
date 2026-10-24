// The World Map mode's M map as a globe (2026-10-18, Gaymi: "make it a
// circle that you can spin 3d circle"; in and out a few times, back again
// 2026-10-24: "for the map when keep going too much make it go to the
// circle world map"). When the big map in the middle is zoomed out past
// GLOBE_FROM, BuildTryMode draws this instead of the block map: the same
// block-map picture of the whole Earth (OpenWorld.earthPicture) wrapped on
// a sphere - the real-world atlas (EarthAtlas.js) stands in until it's
// drawn - turned so the map's centre faces you. Dragging the map spins it,
// scrolling zooms, with country and city names and your arrow on top.
//
// Its own small renderer and scene (no lights - the picture is drawn as
// it is, with a soft shading circle on top), made the first time it's
// needed and kept.
import * as THREE from 'three'
import { earthAtlasCanvas, earthCountryLabels, mapText, cityDot } from './EarthAtlas.js'
import { CITIES } from './Towns.js'

const FOV = 30
const HALF = Math.tan((FOV * Math.PI) / 360)
// Nearest and farthest the camera gets (globe radius 1).
const NEAR_D = 1.15
const FAR_D = 1.12 / Math.sin((FOV * Math.PI) / 360)

// The point on the unit sphere for a latitude / longitude, in the globe's
// own space (three's SphereGeometry UVs: u = 0 is longitude -180).
function spherePoint(lat, lon, out = new THREE.Vector3()) {
  const phi = ((lon + 180) / 360) * Math.PI * 2
  const c = Math.cos((lat * Math.PI) / 180)
  return out.set(-Math.cos(phi) * c, Math.sin((lat * Math.PI) / 180), Math.sin(phi) * c)
}

export class EarthGlobe {
  constructor(container) {
    this.gl = document.createElement('canvas')
    this.gl.className = 'earth-globe'
    this.overlay = document.createElement('canvas')
    this.overlay.className = 'earth-globe-labels'
    // First in the box, so the hint and place name stay on top.
    container.prepend(this.gl, this.overlay)
    this.renderer = new THREE.WebGLRenderer({ canvas: this.gl, alpha: true, antialias: true })
    this.renderer.setClearColor(0x000000, 0)
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 20)
    this.tilt = new THREE.Group()
    this.spin = new THREE.Group()
    this.tilt.add(this.spin)
    this.scene.add(this.tilt)
    this._mat = new THREE.MeshBasicMaterial()
    this._pic = null
    this._picVersion = -1
    this._useTexture(earthAtlasCanvas())
    this.spin.add(new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), this._mat))
    // A thin blue glow round the edge, like air.
    const air = new THREE.Mesh(new THREE.SphereGeometry(1.035, 64, 32), new THREE.MeshBasicMaterial({ color: 0x9ad2ff, transparent: true, opacity: 0.22, side: THREE.BackSide }))
    this.scene.add(air)
    this._v = new THREE.Vector3()
    this.show(false)
  }

  _useTexture(canvas) {
    this._mat.map?.dispose()
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    this._mat.map = tex
    this._mat.needsUpdate = true
  }

  // The block-map picture of the Earth (OpenWorld.earthPicture), once it's
  // been drawn: it replaces the atlas, and updates as it's finished.
  setPicture(pic) {
    if (!pic?.done) return
    if (pic !== this._pic) {
      this._pic = pic
      this._picVersion = pic.version
      this._useTexture(pic.canvas)
    } else if (pic.version !== this._picVersion) {
      this._picVersion = pic.version
      this._mat.map.needsUpdate = true
    }
  }

  show(on) {
    this.gl.style.display = on ? 'block' : 'none'
    this.overlay.style.display = on ? 'block' : 'none'
  }

  // Draws the globe `px` pixels square with (lat, lon) facing you and
  // about `spanDeg` degrees across; `you` = { lat, lon, ang } (the arrow's
  // angle as the flat map draws it, north up).
  draw(px, lat, lon, spanDeg, you) {
    if (this.gl.width !== px) {
      this.renderer.setSize(px, px, false)
      this.overlay.width = this.overlay.height = px
    }
    lat = Math.max(-80, Math.min(80, lat))
    const d = Math.max(NEAR_D, Math.min(FAR_D, 1 + ((spanDeg * Math.PI) / 180) / (2 * HALF)))
    this.camera.position.set(0, 0, d)
    this.camera.lookAt(0, 0, 0)
    this.camera.updateMatrixWorld()
    const p = spherePoint(0, lon, this._v)
    this.spin.rotation.y = -Math.atan2(p.x, p.z)
    this.tilt.rotation.x = (lat * Math.PI) / 180
    this.scene.updateMatrixWorld(true)
    this.renderer.render(this.scene, this.camera)

    const ctx = this.overlay.getContext('2d')
    ctx.clearRect(0, 0, px, px)
    // Soft light from the top left, darker towards the far edge.
    const r = (Math.tan(Math.asin(1 / d)) / HALF) * (px / 2)
    const g = ctx.createRadialGradient(px / 2 - r * 0.35, px / 2 - r * 0.35, r * 0.1, px / 2, px / 2, r)
    g.addColorStop(0, 'rgba(255, 255, 255, 0.14)')
    g.addColorStop(0.6, 'rgba(0, 0, 0, 0)')
    g.addColorStop(1, 'rgba(0, 10, 30, 0.42)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(px / 2, px / 2, r, 0, Math.PI * 2)
    ctx.fill()

    // Screen spot of a place, or null round the back.
    const at = (la, lo) => {
      const v = spherePoint(la, lo, this._v)
      this.spin.localToWorld(v)
      if (v.z < 1 / d + 0.02) return null
      v.project(this.camera)
      return [(v.x + 1) * px / 2, (1 - v.y) * px / 2]
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const base = Math.max(10, Math.min(20, px / 40))
    const minSize = spanDeg > 150 ? 900 : spanDeg > 70 ? 250 : spanDeg > 35 ? 60 : 0
    for (const l of earthCountryLabels()) {
      if (l.size < minSize) continue
      const s = at(l.lat, l.lon)
      if (s) mapText(ctx, l.name.toUpperCase(), s[0], s[1], base * (l.size > 900 ? 1 : 0.8), 'rgba(90, 60, 50, 0.95)', 700)
    }
    if (spanDeg <= 90) {
      for (const c of CITIES) {
        const s = at(c.lat, c.lon)
        if (!s) continue
        const dot = Math.max(2.5, px / 220)
        cityDot(ctx, s[0], s[1], dot)
        if (spanDeg <= 45) {
          ctx.textAlign = 'left'
          mapText(ctx, c.name, s[0] + dot + 4, s[1], base * 0.8, '#2a1d16')
          ctx.textAlign = 'center'
        }
      }
    }
    // You: an arrow pointing the way you face, turned with the globe.
    const me = you && at(you.lat, you.lon)
    if (me) {
      const north = at(you.lat + 0.5, you.lon)
      const up = north ? Math.atan2(north[0] - me[0], me[1] - north[1]) : 0
      const ang = up + you.ang
      const a = Math.max(6, px / 34)
      ctx.save()
      ctx.translate(me[0], me[1])
      ctx.rotate(ang)
      ctx.beginPath()
      ctx.moveTo(a * 1.4, 0)
      ctx.lineTo(-a, a * 0.85)
      ctx.lineTo(-a * 0.45, 0)
      ctx.lineTo(-a, -a * 0.85)
      ctx.closePath()
      ctx.fillStyle = '#ffde5c'
      ctx.strokeStyle = '#1a1408'
      ctx.lineWidth = Math.max(1.5, a / 4)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
  }
}
