// Turns each grabbed picture into GIF bytes away from the game's own
// thread (ClipGif.js, ClipMaker.js).
import { encodeGifFrame } from './ClipGif.js'

self.onmessage = (e) => {
  const { id, data, w, h } = e.data
  const bytes = encodeGifFrame(new Uint8ClampedArray(data), w, h)
  self.postMessage({ id, bytes, w, h }, [bytes.buffer])
}
