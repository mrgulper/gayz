// Clip Maker's GIF side (Batch 2, 2026-11-19). A GIF is a string of
// little pictures; here each picture is turned into GIF bytes the moment
// it's grabbed (in a worker, ClipGifWorker.js, so the game doesn't stutter),
// and kept on its own. Every picture carries its own 256 colours, so any
// run of them can be glued into a file: the header, the pictures, the end.
// That's why a GIF is exactly the length you picked, unlike a video.
import { GIFEncoder, quantize, applyPalette } from 'gifenc'

export const GIF_FPS = 10
const DELAY_MS = 1000 / GIF_FPS

// One picture (RGBA pixels) -> its GIF bytes.
export function encodeGifFrame(rgba, w, h) {
  const palette = quantize(rgba, 256)
  const index = applyPalette(rgba, palette)
  const enc = GIFEncoder({ auto: false })
  enc.writeFrame(index, w, h, { palette, delay: DELAY_MS, first: false })
  return enc.bytes()
}

// The pictures -> a GIF file that loops forever.
export function gifBlob(frames, w, h) {
  const head = new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // "GIF89a"
    w & 255, w >> 8, h & 255, h >> 8,
    0x00, 0x00, 0x00, // no shared colours (each picture has its own)
    // Loop forever (the NETSCAPE2.0 note every browser understands).
    0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01, 0x00, 0x00, 0x00,
  ])
  return new Blob([head, ...frames, new Uint8Array([0x3b])], { type: 'image/gif' })
}

// Slow-mo (Batch 3): the same picture shown longer. A picture's bytes
// start with its timing note (0x21 0xF9 0x04 flags, then the wait in
// hundredths of a second), so only those two bytes change.
export function slowGifFrame(bytes, speed) {
  if (bytes[0] !== 0x21 || bytes[1] !== 0xf9) return bytes
  const out = bytes.slice()
  const wait = Math.min(65535, Math.round(DELAY_MS / 10 / speed))
  out[4] = wait & 255
  out[5] = wait >> 8
  out.w = bytes.w
  out.h = bytes.h
  return out
}
