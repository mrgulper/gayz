// Makes the HD block textures off the main thread (BlockTextures.js
// prepareHdTextures posts the 16x16 pictures, gets the HD pixels back).
import { hdPixels } from './BlockTexturesHD.js'

self.onmessage = (e) => {
  const out = []
  for (const job of e.data) {
    const r = hdPixels(new Uint8ClampedArray(job.data), job.w, job.h, job.style, job.seed)
    out.push({ id: job.id, data: r.data.buffer, width: r.width, height: r.height })
  }
  self.postMessage(out, out.map((o) => o.data))
}
