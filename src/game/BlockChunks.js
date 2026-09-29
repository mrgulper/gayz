// Map editor block rendering, Minecraft/Kirka style (2026-09-29, "make the
// map editor blocks look like kirka.io and 60fps stable").
//
// Before: one InstancedMesh per block type, every cube drawn with all 6
// faces - the default 128x128 grass floor alone was 16,384 full cubes
// (~200k triangles, drawn a second time for the shadow map), almost all of
// them faces no camera could ever see because another block covered them.
//
// Now: the world is cut into CHUNK x CHUNK x CHUNK cell chunks, and each
// chunk is ONE mesh holding only the faces that touch air (or see-through
// blocks). Every block type's texture lives in one shared atlas, so a
// chunk is one draw call no matter how many block types it holds. Each
// face vertex gets Minecraft-style "smooth lighting" ambient occlusion
// (darker where blocks meet in a corner) baked into its vertex color -
// that, plus crisp pixel textures, is most of what makes a voxel game
// read as "high quality" rather than flat.
//
// Only plain cubes go through here. Shaped blocks (stairs/fence/ladder)
// keep BuildMode's per-type InstancedMesh path - they're rare, and they
// never hide a neighbor's face.
import * as THREE from 'three'

export const CHUNK = 16
// A power-of-two SLOT with the tile repeated into half-tile padding: every
// mipmap level (down to one texel per slot) then only ever averages a
// block's own texture - no distant speckles bled in from the next tile.
// 32px slots holding each 16x16 pixel-art texture (BlockTextures.js)
// scaled up 2x with no smoothing - the same crisp pixels, just with room
// for the padding trick below.
const TILE = 32
const PAD = TILE / 2
const SLOT = TILE + PAD * 2

// 6 faces: normal, 4 corners (cube-local 0/1, counter-clockwise seen from
// outside), texture v points up (+y) on the sides, -z on top/bottom.
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.86 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.86 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.7 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.93 },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.93 },
]
const CORNER_UV = [[0, 0], [1, 0], [1, 1], [0, 1]]
// Vertex brightness by how many of the 3 neighbor cells around a corner
// are solid (0 = fully open ... 3 = tucked into a corner).
const AO_LEVELS = [1, 0.78, 0.6, 0.45]

// Same stable per-block brightness wobble the instanced path used to roll
// with Math.random() - hashed from the position instead, so a chunk
// rebuild never makes blocks flicker to a new shade.
function tintAt(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return 0.9 + ((h >>> 0) % 1000) / 1000 * 0.16
}

export class BlockChunks {
  // types: BLOCK_TYPES. faces(type) -> { top, side, bottom } canvases.
  // hasAlpha(type) -> the texture carries its own transparency. getType(x,
  // y, z) -> type id or null.
  constructor(scene, { blockSize, types, faces, hasAlpha, getType, maxAnisotropy = 4 }) {
    this.scene = scene
    this.blockSize = blockSize
    this.getType = getType
    this.info = new Map()
    this.chunks = new Map() // "cx,cy,cz" -> { meshes: [] }
    this.dirty = new Set()

    const cube = types.filter((t) => !t.shape)
    const faceSets = cube.map((t) => faces(t))
    const unique = [...new Set(faceSets.flatMap((f) => [f.top, f.side, f.bottom]))]
    // 2048 wide x as many rows as needed (512 for today's ~130 textures):
    // about 5 MB of GPU memory with mipmaps.
    const atlasW = 2048
    const perRow = atlasW / SLOT
    const atlasH = THREE.MathUtils.ceilPowerOfTwo(Math.ceil(unique.length / perRow) * SLOT)
    const canvas = document.createElement('canvas')
    canvas.width = atlasW
    canvas.height = atlasH
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false
    const uvOf = new Map()
    unique.forEach((src, i) => {
      const ox = (i % perRow) * SLOT + PAD
      const oy = Math.floor(i / perRow) * SLOT + PAD
      // Padding around each tile repeats the tile's own opposite edge, so
      // the smaller mipmap levels blend into matching colors instead of
      // bleeding a neighboring block's texture across the seam.
      ctx.save()
      ctx.beginPath()
      ctx.rect(ox - PAD, oy - PAD, SLOT, SLOT)
      ctx.clip()
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) ctx.drawImage(src, ox + dx * TILE, oy + dy * TILE, TILE, TILE)
      }
      ctx.restore()
      // Canvas y runs down, texture v runs up (flipY) - v0 is the bottom.
      const u0 = ox / atlasW
      const u1 = (ox + TILE) / atlasW
      const v1 = 1 - oy / atlasH
      const v0 = 1 - (oy + TILE) / atlasH
      uvOf.set(src, [u0, v0, u1, v1])
    })
    cube.forEach((t, i) => {
      const f = faceSets[i]
      this.info.set(t.id, {
        // Indexed like FACES: +x, -x, top, bottom, +z, -z.
        uvs: [uvOf.get(f.side), uvOf.get(f.side), uvOf.get(f.top), uvOf.get(f.bottom), uvOf.get(f.side), uvOf.get(f.side)],
        opaque: !t.transparent,
        // Glass/leaves carry their own per-pixel alpha in the texture.
        alpha: hasAlpha(t) ? 1 : (t.opacity ?? 1),
        glow: !!t.emissive,
      })
    })
    const tex = new THREE.CanvasTexture(canvas)
    tex.magFilter = THREE.NearestFilter
    // Crisp pixels up close (Nearest magnification), trilinear mipmaps +
    // full anisotropy far away so the floor doesn't shimmer toward the
    // horizon. Safe with an atlas: the padded power-of-two slots above keep
    // every mip level inside a block's own texture.
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = maxAnisotropy
    this.atlas = tex

    this.materials = {
      solid: new THREE.MeshLambertMaterial({ map: tex, vertexColors: true }),
      glow: new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55 }),
      clear: new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false, alphaTest: 0.02 }),
    }
  }

  isChunkType(type) {
    return this.info.has(type)
  }

  _opaqueAt(x, y, z) {
    const t = this.getType(x, y, z)
    return !!t && !!this.info.get(t)?.opaque
  }

  // Call after any block change at (x, y, z) - also marks the neighbor
  // chunk(s) when the cell sits on a chunk border, since their outer faces
  // and corner shading depend on it.
  markDirty(x, y, z) {
    const cx = Math.floor(x / CHUNK)
    const cy = Math.floor(y / CHUNK)
    const cz = Math.floor(z / CHUNK)
    const lx = x - cx * CHUNK
    const ly = y - cy * CHUNK
    const lz = z - cz * CHUNK
    for (const dx of [lx === 0 ? -1 : 0, 0, lx === CHUNK - 1 ? 1 : 0]) {
      for (const dy of [ly === 0 ? -1 : 0, 0, ly === CHUNK - 1 ? 1 : 0]) {
        for (const dz of [lz === 0 ? -1 : 0, 0, lz === CHUNK - 1 ? 1 : 0]) {
          this.dirty.add(`${cx + dx},${cy + dy},${cz + dz}`)
        }
      }
    }
  }

  // Rebuilds every dirty chunk. Cheap enough to run every frame: a normal
  // click dirties 1-4 chunks, and a full load is a one-off.
  flush(blocksByChunk) {
    if (this.dirty.size === 0) return
    for (const key of this.dirty) this._build(key, blocksByChunk.get(key))
    this.dirty.clear()
  }

  clear() {
    for (const key of [...this.chunks.keys()]) this._disposeChunk(key)
    this.dirty.clear()
  }

  _disposeChunk(key) {
    const chunk = this.chunks.get(key)
    if (!chunk) return
    for (const mesh of chunk.meshes) {
      this.scene.remove(mesh)
      mesh.geometry.dispose()
    }
    this.chunks.delete(key)
  }

  // cells: Set of "x,y,z" keys inside this chunk (see BuildMode's
  // _chunkIndex).
  _build(key, cells) {
    this._disposeChunk(key)
    if (!cells || cells.size === 0) return
    const [cx, cy, cz] = key.split(',').map(Number)
    const bx = cx * CHUNK
    const by = cy * CHUNK
    const bz = cz * CHUNK
    const out = { solid: newBuffers(3), glow: newBuffers(3), clear: newBuffers(4) }
    for (const cell of cells) {
      const [x, y, z] = cell.split(',').map(Number)
      const type = this.getType(x, y, z)
      const info = type && this.info.get(type)
      if (!info) continue
      const buf = info.opaque ? (info.glow ? out.glow : out.solid) : out.clear
      const tint = tintAt(x, y, z)
      for (let fi = 0; fi < 6; fi++) {
        const face = FACES[fi]
        const [nx, ny, nz] = face.n
        const nType = this.getType(x + nx, y + ny, z + nz)
        if (nType) {
          const nInfo = this.info.get(nType)
          // Hidden behind a solid cube, or glass against the same glass.
          if (nInfo && (nInfo.opaque || nType === type)) continue
        }
        const [u0, v0, u1, v1] = info.uvs[fi]
        const ao = [0, 0, 0, 0]
        for (let i = 0; i < 4; i++) {
          const c = face.c[i]
          // The two in-plane axes' step toward this corner, taken in the
          // air layer just outside the face.
          const ox = x + nx
          const oy = y + ny
          const oz = z + nz
          const sx = nx === 0 ? (c[0] ? 1 : -1) : 0
          const sy = ny === 0 ? (c[1] ? 1 : -1) : 0
          const sz = nz === 0 ? (c[2] ? 1 : -1) : 0
          let s1, s2
          if (nx !== 0) {
            s1 = this._opaqueAt(ox, oy + sy, oz)
            s2 = this._opaqueAt(ox, oy, oz + sz)
          } else if (ny !== 0) {
            s1 = this._opaqueAt(ox + sx, oy, oz)
            s2 = this._opaqueAt(ox, oy, oz + sz)
          } else {
            s1 = this._opaqueAt(ox + sx, oy, oz)
            s2 = this._opaqueAt(ox, oy + sy, oz)
          }
          const corner = this._opaqueAt(ox + sx, oy + sy, oz + sz)
          ao[i] = s1 && s2 ? 3 : (s1 ? 1 : 0) + (s2 ? 1 : 0) + (corner ? 1 : 0)
        }
        const base = buf.pos.length / 3
        for (let i = 0; i < 4; i++) {
          const c = face.c[i]
          buf.pos.push((x - bx + c[0]) * this.blockSize, (y - by + c[1]) * this.blockSize, (z - bz + c[2]) * this.blockSize)
          buf.nrm.push(nx, ny, nz)
          buf.uv.push(CORNER_UV[i][0] ? u1 : u0, CORNER_UV[i][1] ? v1 : v0)
          const b = AO_LEVELS[ao[i]] * face.shade * tint
          if (buf.stride === 4) buf.col.push(b, b, b, info.alpha)
          else buf.col.push(b, b, b)
        }
        // Split the quad along the diagonal whose corners are shaded more
        // alike, or the corner darkening shows a visible crease.
        if (ao[0] + ao[2] > ao[1] + ao[3]) {
          buf.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base)
        } else {
          buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
        }
      }
    }
    const meshes = []
    for (const kind of ['solid', 'glow', 'clear']) {
      const buf = out[kind]
      if (buf.idx.length === 0) continue
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3))
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nrm, 3))
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2))
      geo.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, buf.stride))
      geo.setIndex(buf.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(buf.idx, 1) : new THREE.Uint16BufferAttribute(buf.idx, 1))
      geo.computeBoundingSphere()
      const mesh = new THREE.Mesh(geo, this.materials[kind])
      mesh.position.set(bx * this.blockSize, by * this.blockSize, bz * this.blockSize)
      mesh.castShadow = kind !== 'clear'
      mesh.receiveShadow = true
      mesh.matrixAutoUpdate = false
      mesh.updateMatrix()
      this.scene.add(mesh)
      meshes.push(mesh)
    }
    this.chunks.set(key, { meshes })
  }
}

function newBuffers(stride) {
  return { pos: [], nrm: [], uv: [], col: [], idx: [], stride }
}
