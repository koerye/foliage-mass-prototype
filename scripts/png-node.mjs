// Zero-dependency Node.js PNG decoder & encoder (supports 8/16-bit Gray/RGB/Palette/GrayA/RGBA + all 5 scanline filters).
// Kept outside `src/` so the browser bundle remains 100% pure DOM/ESNext with zero `node:*` imports.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

const PNG_SIG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
const WORKSPACE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

export function resolveWorkspacePath(...segments) {
  return resolve(WORKSPACE_ROOT, ...segments)
}

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

export function decodePngBytes(bytes) {
  if (bytes.length < 24) throw new Error('PNG buffer too short')
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIG[i]) throw new Error('Invalid PNG signature')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  let width = 0, height = 0, bitDepth = 8, colorType = 6, interlace = 0
  const idatParts = []
  let plte
  let trns

  while (offset + 8 <= bytes.length) {
    const len = view.getUint32(offset, false)
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
    const dataStart = offset + 8
    const dataEnd = dataStart + len
    if (dataEnd + 4 > bytes.length) break
    const chunk = bytes.subarray(dataStart, dataEnd)
    if (type === 'IHDR') {
      width = view.getUint32(dataStart, false)
      height = view.getUint32(dataStart + 4, false)
      bitDepth = bytes[dataStart + 8]
      colorType = bytes[dataStart + 9]
      interlace = bytes[dataStart + 12]
    } else if (type === 'PLTE') {
      plte = chunk
    } else if (type === 'tRNS') {
      trns = chunk
    } else if (type === 'IDAT') {
      idatParts.push(chunk)
    } else if (type === 'IEND') {
      break
    }
    offset = dataEnd + 4
  }

  if (!width || !height) throw new Error('PNG missing IHDR')
  if (interlace !== 0) throw new Error('Interlaced Adam7 PNG not supported')
  if (bitDepth !== 8 && bitDepth !== 16) throw new Error(`Unsupported PNG bit depth: ${bitDepth}`)

  let totalLen = 0
  for (const p of idatParts) totalLen += p.length
  const compressed = new Uint8Array(totalLen)
  let pos = 0
  for (const p of idatParts) { compressed.set(p, pos); pos += p.length }
  const raw = inflateSync(compressed)

  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0
  if (!channels) throw new Error(`Unsupported PNG colorType: ${colorType}`)
  const bytesPerSample = bitDepth === 16 ? 2 : 1
  const bpp = channels * bytesPerSample
  const stride = width * bpp

  const recon = new Uint8Array(height * stride)
  let inOff = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[inOff++]
    const rowOff = y * stride
    const prevOff = (y - 1) * stride
    for (let x = 0; x < stride; x++) {
      const f = raw[inOff++]
      const a = x >= bpp ? recon[rowOff + x - bpp] : 0
      const b = y > 0 ? recon[prevOff + x] : 0
      const c = (x >= bpp && y > 0) ? recon[prevOff + x - bpp] : 0
      let val = f
      if (filter === 1) val = (f + a) & 0xff
      else if (filter === 2) val = (f + b) & 0xff
      else if (filter === 3) val = (f + ((a + b) >>> 1)) & 0xff
      else if (filter === 4) val = (f + paeth(a, b, c)) & 0xff
      recon[rowOff + x] = val
    }
  }

  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const rowOff = y * stride
    for (let x = 0; x < width; x++) {
      const i = rowOff + x * bpp
      const o = (y * width + x) * 4
      if (colorType === 6) {
        out[o] = recon[i]
        out[o + 1] = recon[i + bytesPerSample]
        out[o + 2] = recon[i + bytesPerSample * 2]
        out[o + 3] = recon[i + bytesPerSample * 3]
      } else if (colorType === 2) {
        out[o] = recon[i]
        out[o + 1] = recon[i + bytesPerSample]
        out[o + 2] = recon[i + bytesPerSample * 2]
        out[o + 3] = 255
      } else if (colorType === 0) {
        const g = recon[i]
        out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255
      } else if (colorType === 4) {
        const g = recon[i]
        out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = recon[i + bytesPerSample]
      } else if (colorType === 3 && plte) {
        const idx = recon[i]
        out[o] = plte[idx * 3] ?? 0
        out[o + 1] = plte[idx * 3 + 1] ?? 0
        out[o + 2] = plte[idx * 3 + 2] ?? 0
        out[o + 3] = trns && idx < trns.length ? trns[idx] : 255
      }
    }
  }
  return { width, height, data: out }
}

function makeChunk(type, data) {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length, false)
  out[4] = type.charCodeAt(0)
  out[5] = type.charCodeAt(1)
  out[6] = type.charCodeAt(2)
  out[7] = type.charCodeAt(3)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false)
  return out
}

export function encodePngBytes(img) {
  const { width, height, data } = img
  const ihdr = new Uint8Array(13)
  const iv = new DataView(ihdr.buffer)
  iv.setUint32(0, width, false)
  iv.setUint32(4, height, false)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

  const stride = width * 4
  const scanlines = new Uint8Array(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1)
    scanlines[rowStart] = 0
    scanlines.set(data.subarray(y * stride, (y + 1) * stride), rowStart + 1)
  }
  const compressed = deflateSync(scanlines, { level: 6 })
  const c1 = makeChunk('IHDR', ihdr)
  const c2 = makeChunk('IDAT', compressed)
  const c3 = makeChunk('IEND', new Uint8Array(0))

  const out = new Uint8Array(PNG_SIG.length + c1.length + c2.length + c3.length)
  let off = 0
  out.set(PNG_SIG, off); off += PNG_SIG.length
  out.set(c1, off); off += c1.length
  out.set(c2, off); off += c2.length
  out.set(c3, off)
  return out
}

export function decodePngFile(filePath) {
  return decodePngBytes(readFileSync(filePath))
}

export function encodePngFile(filePath, img) {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, encodePngBytes(img))
}
