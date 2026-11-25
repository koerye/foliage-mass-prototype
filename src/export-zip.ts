// Zero-dependency standard ZIP archive writer + pure-TS PNG encoder fallback
// for split model + textures exports (glTF + TEX & FBX + TEX) in both Browser and Node.
import type { Texture } from 'three'

export interface ExportArchiveFile {
  /** Forward-slash relative path inside the bundle / folder, e.g. "model.fbx" or "textures/Mat_Bark_BaseColor.png" */
  path: string
  data: Uint8Array
}

// IEEE 802.3 CRC-32 lookup table (shared by ZIP & PNG)
const CRC_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  CRC_TABLE[i] = c >>> 0
}

export function crc32(data: Uint8Array, start = 0, end = data.length): number {
  let crc = 0xffffffff
  for (let i = start; i < end; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function adler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  const MOD = 65521
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % MOD
    b = (b + a) % MOD
  }
  return ((b << 16) | a) >>> 0
}

function writeU32BE(buf: Uint8Array, offset: number, value: number) {
  buf[offset] = (value >>> 24) & 0xff
  buf[offset + 1] = (value >>> 16) & 0xff
  buf[offset + 2] = (value >>> 8) & 0xff
  buf[offset + 3] = value & 0xff
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  writeU32BE(out, 0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  const crc = crc32(out, 4, 8 + data.length)
  writeU32BE(out, 8 + data.length, crc)
  return out
}

/** Pure-TS valid RGBA8 PNG encoder (stored DEFLATE blocks; works identically in Node/Vitest & Browser). */
export function encodeRgbaToPng(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8Array {
  const rowBytes = width * 4
  const raw = new Uint8Array((rowBytes + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = 0 // Filter type 0 (None)
    raw.set(rgba.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1)
  }

  // Wrap raw scanlines in valid RFC 1950 zlib stream with uncompressed DEFLATE blocks (<= 65535 B each)
  const maxBlock = 65535
  const blockCount = Math.max(1, Math.ceil(raw.length / maxBlock))
  const zlibBuf = new Uint8Array(2 + raw.length + blockCount * 5 + 4)
  zlibBuf[0] = 0x78
  zlibBuf[1] = 0x01
  let pos = 2
  for (let off = 0, idx = 0; idx < blockCount; idx++, off += maxBlock) {
    const len = Math.min(maxBlock, raw.length - off)
    const isFinal = idx === blockCount - 1 ? 1 : 0
    zlibBuf[pos++] = isFinal
    zlibBuf[pos++] = len & 0xff
    zlibBuf[pos++] = (len >>> 8) & 0xff
    const nlen = (~len) & 0xffff
    zlibBuf[pos++] = nlen & 0xff
    zlibBuf[pos++] = (nlen >>> 8) & 0xff
    zlibBuf.set(raw.subarray(off, off + len), pos)
    pos += len
  }
  writeU32BE(zlibBuf, pos, adler32(raw))

  const ihdr = new Uint8Array(13)
  writeU32BE(ihdr, 0, width)
  writeU32BE(ihdr, 4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const cIhdr = pngChunk('IHDR', ihdr)
  const cIdat = pngChunk('IDAT', zlibBuf)
  const cIend = pngChunk('IEND', new Uint8Array(0))
  const out = new Uint8Array(sig.length + cIhdr.length + cIdat.length + cIend.length)
  let o = 0
  out.set(sig, o); o += sig.length
  out.set(cIhdr, o); o += cIhdr.length
  out.set(cIdat, o); o += cIdat.length
  out.set(cIend, o)
  return out
}

/** Converts any Three.js Texture (CanvasTexture, DataTexture, ImageBitmap, HTMLImageElement) to valid PNG bytes. */
export async function textureToPngBytes(tex: Texture): Promise<Uint8Array | undefined> {
  const img = tex.image as (
    | HTMLCanvasElement
    | HTMLImageElement
    | ImageBitmap
    | { data?: Uint8Array | Uint8ClampedArray; width?: number; height?: number }
    | undefined
  )
  if (!img) return undefined

  // Browser hardware-compressed PNG via Canvas2D
  if (typeof document !== 'undefined') {
    let canvas: HTMLCanvasElement | undefined
    if (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) {
      canvas = img
    } else if ('width' in img && 'height' in img && Number(img.width) > 0 && Number(img.height) > 0) {
      const w = Number(img.width)
      const h = Number(img.height)
      canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (ctx) {
        if ('data' in img && img.data && (img.data instanceof Uint8Array || img.data instanceof Uint8ClampedArray)) {
          const idata = ctx.createImageData(w, h)
          if (tex.flipY === false) {
            // Flip rows if raw DataTexture is stored bottom-up
            for (let y = 0; y < h; y++) {
              const srcRow = (h - 1 - y) * w * 4
              idata.data.set(img.data.subarray(srcRow, srcRow + w * 4), y * w * 4)
            }
          } else {
            idata.data.set(img.data)
          }
          ctx.putImageData(idata, 0, 0)
        } else {
          try { ctx.drawImage(img as CanvasImageSource, 0, 0, w, h) } catch { canvas = undefined }
        }
      }
    }
    if (canvas && canvas.width > 0 && canvas.height > 0) {
      const blob = await new Promise<Blob | null>(resolve => {
        if (typeof canvas!.toBlob === 'function') {
          canvas!.toBlob(b => resolve(b), 'image/png')
        } else {
          resolve(null)
        }
      })
      if (blob && blob.size > 8) {
        return new Uint8Array(await blob.arrayBuffer())
      }
      if (typeof canvas.toDataURL === 'function') {
        const url = canvas.toDataURL('image/png')
        const idx = url.indexOf(',')
        if (idx > 0) {
          const bin = atob(url.slice(idx + 1))
          const out = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
          return out
        }
      }
    }
  }

  // Headless Node / DataTexture fallback (also checks userData.rawRgba)
  const rawMeta = tex.userData?.rawRgba as { bytes?: Uint8Array; width?: number; height?: number } | undefined
  if (rawMeta?.bytes && rawMeta.width && rawMeta.height) {
    return encodeRgbaToPng(rawMeta.bytes, rawMeta.width, rawMeta.height)
  }
  if ('data' in img && img.data && (img.data instanceof Uint8Array || img.data instanceof Uint8ClampedArray) && img.width && img.height) {
    return encodeRgbaToPng(img.data, img.width, img.height)
  }
  return undefined
}

/** Builds a standards-compliant PKZIP archive (Store mode + UTF-8 filenames) zero-dependency. */
export function createZipArchive(entries: ExportArchiveFile[]): Uint8Array {
  const enc = new TextEncoder()
  const now = new Date()
  const dosTime = ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | ((now.getSeconds() >> 1) & 0x1f)
  const dosDate = (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0x0f) << 5) | (now.getDate() & 0x1f)

  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let localOffset = 0

  for (const entry of entries) {
    const cleanPath = entry.path.replace(/^\/+/, '').replace(/\\/g, '/')
    const nameBytes = enc.encode(cleanPath)
    const data = entry.data
    const crc = crc32(data)

    const lh = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(lh.buffer)
    lv.setUint32(0, 0x04034b50, true) // Local file header signature
    lv.setUint16(4, 20, true)         // Version needed (2.0)
    lv.setUint16(6, 0x0800, true)     // UTF-8 filename flag
    lv.setUint16(8, 0, true)          // Compression method: Store (0)
    lv.setUint16(10, dosTime, true)
    lv.setUint16(12, dosDate, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)
    lh.set(nameBytes, 30)
    localParts.push(lh, data)

    const ch = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(ch.buffer)
    cv.setUint32(0, 0x02014b50, true) // Central directory signature
    cv.setUint16(4, 20, true)         // Version made by
    cv.setUint16(6, 20, true)         // Version needed
    cv.setUint16(8, 0x0800, true)     // UTF-8 flag
    cv.setUint16(10, 0, true)         // Store
    cv.setUint16(12, dosTime, true)
    cv.setUint16(14, dosDate, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true)
    cv.setUint16(32, 0, true)
    cv.setUint16(34, 0, true)
    cv.setUint16(36, 0, true)
    cv.setUint32(38, 0, true)
    cv.setUint32(42, localOffset, true)
    ch.set(nameBytes, 46)
    centralParts.push(ch)

    localOffset += lh.length + data.length
  }

  let centralSize = 0
  for (const c of centralParts) centralSize += c.length

  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(4, 0, true)
  ev.setUint16(6, 0, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, localOffset, true)
  ev.setUint16(20, 0, true)

  const total = localOffset + centralSize + eocd.length
  const out = new Uint8Array(total)
  let pos = 0
  for (const p of localParts) { out.set(p, pos); pos += p.length }
  for (const c of centralParts) { out.set(c, pos); pos += c.length }
  out.set(eocd, pos)
  return out
}
