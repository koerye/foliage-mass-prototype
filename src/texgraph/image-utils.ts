// Isomorphic (Browser + Node) RGBA image resizing, color space (sRGB <-> CIELAB, exact CIEDE2000),
// and buffer conversion helpers shared by RefAnalyzer, RefScorer, Diagnostic Sheet, and Agent Optimizer.
import type { RgbaBuffer } from './types'

export interface RgbaImageData {
  width: number
  height: number
  data: Uint8ClampedArray
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
export const clampByte = (v: number) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v))

export function rgb01ToHex(r: number, g: number, b: number): string {
  const h = (n: number) => clampByte(n * 255).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

export function hexToRgb01(hex: string): [number, number, number] {
  const s = hex.trim().replace(/^#/, '')
  const v = s.length === 3
    ? parseInt(s[0] + s[0] + s[1] + s[1] + s[2] + s[2], 16)
    : parseInt(s.slice(0, 6), 16)
  if (!Number.isFinite(v)) return [0.5, 0.5, 0.5]
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  const s = max > 1e-6 ? d / max : 0
  return [h, s, max]
}

/** sRGB [0..1] -> CIE L*a*b* (D65). */
export function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const rl = lin(clamp01(r)), gl = lin(clamp01(g)), bl = lin(clamp01(b))
  const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750
  const z = (rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(x), fy = f(y), fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** CIE L*a*b* (D65) -> sRGB [0..1]. */
export function labToSrgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116
  const fx = a / 500 + fy
  const fz = fy - b / 200
  const inv = (t: number) => (t * t * t > 0.008856 ? t * t * t : (t - 16 / 116) / 7.787)
  const x = inv(fx) * 0.95047
  const y = inv(fy)
  const z = inv(fz) * 1.08883
  const rl = x * 3.2404542 - y * 1.5371385 - z * 0.4985314
  const gl = -x * 0.9692660 + y * 1.8760108 + z * 0.0415560
  const bl = x * 0.0556434 - y * 0.2040259 + z * 1.0572252
  const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055)
  return [clamp01(gam(rl)), clamp01(gam(gl)), clamp01(gam(bl))]
}

/** Exact CIEDE2000 perceptual color difference (ΔE00). */
export function deltaE00(
  L1: number, a1: number, b1: number,
  L2: number, a2: number, b2: number,
): number {
  const deg = 180 / Math.PI
  const rad = Math.PI / 180
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cbar = 0.5 * (C1 + C2)
  const Cbar7 = Math.pow(Cbar, 7)
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 6103515625))) // 25^7
  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const h1p = C1p < 1e-6 ? 0 : ((Math.atan2(b1, a1p) * deg + 360) % 360)
  const h2p = C2p < 1e-6 ? 0 : ((Math.atan2(b2, a2p) * deg + 360) % 360)

  const dLp = L2 - L1
  const dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p > 1e-8) {
    const diff = h2p - h1p
    if (Math.abs(diff) <= 180) dhp = diff
    else if (diff > 180) dhp = diff - 360
    else dhp = diff + 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(0.5 * dhp * rad)

  const Lbarp = 0.5 * (L1 + L2)
  const Cbarp = 0.5 * (C1p + C2p)
  let hbarp = h1p + h2p
  if (C1p * C2p > 1e-8) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = 0.5 * (h1p + h2p)
    else if (h1p + h2p < 360) hbarp = 0.5 * (h1p + h2p + 360)
    else hbarp = 0.5 * (h1p + h2p - 360)
  }

  const T = 1
    - 0.17 * Math.cos((hbarp - 30) * rad)
    + 0.24 * Math.cos(2 * hbarp * rad)
    + 0.32 * Math.cos((3 * hbarp + 6) * rad)
    - 0.20 * Math.cos((4 * hbarp - 63) * rad)

  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2))
  const Cbarp7 = Math.pow(Cbarp, 7)
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 6103515625))
  const L50sq = (Lbarp - 50) * (Lbarp - 50)
  const SL = 1 + (0.015 * L50sq) / Math.sqrt(20 + L50sq)
  const SC = 1 + 0.045 * Cbarp
  const SH = 1 + 0.015 * Cbarp * T
  const RT = -Math.sin(2 * dTheta * rad) * RC

  const tL = dLp / SL
  const tC = dCp / SC
  const tH = dHp / SH
  return Math.sqrt(Math.max(0, tL * tL + tC * tC + tH * tH + RT * tC * tH))
}

export function rgbaBufferToImageData(buf: RgbaBuffer): RgbaImageData {
  const n = buf.width * buf.height
  const data = new Uint8ClampedArray(n * 4)
  const sd = buf.data
  for (let i = 0; i < n * 4; i++) data[i] = clampByte(sd[i] * 255)
  return { width: buf.width, height: buf.height, data }
}

export function imageDataToRgbaBuffer(img: RgbaImageData): RgbaBuffer {
  const n = img.width * img.height
  const data = new Float32Array(n * 4)
  const sd = img.data
  for (let i = 0; i < n * 4; i++) data[i] = sd[i] / 255
  return { kind: 'rgba', width: img.width, height: img.height, data }
}

/** High-quality premultiplied-alpha area-box downsampler / bilinear resampler (works in Node & Browser). */
export function resizeImageData(src: RgbaImageData, targetW: number, targetH: number): RgbaImageData {
  if (src.width === targetW && src.height === targetH) {
    return { width: targetW, height: targetH, data: new Uint8ClampedArray(src.data) }
  }
  const out = new Uint8ClampedArray(targetW * targetH * 4)
  const sw = src.width, sh = src.height
  const sd = src.data
  const sxScale = sw / targetW
  const syScale = sh / targetH

  if (sxScale >= 1.5 && syScale >= 1.5) {
    // Premultiplied area averaging prevents dark fringe bleeding & aliasing!
    for (let y = 0; y < targetH; y++) {
      const y0 = Math.floor(y * syScale)
      const y1 = Math.min(sh, Math.max(y0 + 1, Math.ceil((y + 1) * syScale)))
      for (let x = 0; x < targetW; x++) {
        const x0 = Math.floor(x * sxScale)
        const x1 = Math.min(sw, Math.max(x0 + 1, Math.ceil((x + 1) * sxScale)))
        let rSum = 0, gSum = 0, bSum = 0, aSum = 0, cnt = 0
        for (let sy = y0; sy < y1; sy++) {
          let row = (sy * sw + x0) * 4
          for (let sx = x0; sx < x1; sx++, row += 4) {
            const a = sd[row + 3] / 255
            rSum += sd[row] * a
            gSum += sd[row + 1] * a
            bSum += sd[row + 2] * a
            aSum += a
            cnt++
          }
        }
        const o = (y * targetW + x) * 4
        const avgA = aSum / Math.max(1, cnt)
        if (aSum > 1e-5) {
          out[o] = clampByte(rSum / aSum)
          out[o + 1] = clampByte(gSum / aSum)
          out[o + 2] = clampByte(bSum / aSum)
        }
        out[o + 3] = clampByte(avgA * 255)
      }
    }
    return { width: targetW, height: targetH, data: out }
  }

  // Premultiplied bilinear interpolation
  for (let y = 0; y < targetH; y++) {
    const fy = (y + 0.5) * syScale - 0.5
    const y0 = Math.max(0, Math.min(sh - 1, Math.floor(fy)))
    const y1 = Math.min(sh - 1, y0 + 1)
    const ty = clamp01(fy - Math.floor(fy))
    for (let x = 0; x < targetW; x++) {
      const fx = (x + 0.5) * sxScale - 0.5
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(fx)))
      const x1 = Math.min(sw - 1, x0 + 1)
      const tx = clamp01(fx - Math.floor(fx))
      const i00 = (y0 * sw + x0) * 4
      const i10 = (y0 * sw + x1) * 4
      const i01 = (y1 * sw + x0) * 4
      const i11 = (y1 * sw + x1) * 4
      const a00 = sd[i00 + 3] / 255, a10 = sd[i10 + 3] / 255
      const a01 = sd[i01 + 3] / 255, a11 = sd[i11 + 3] / 255
      const aTop = a00 + (a10 - a00) * tx
      const aBot = a01 + (a11 - a01) * tx
      const a = aTop + (aBot - aTop) * ty
      const o = (y * targetW + x) * 4
      if (a > 1e-4) {
        for (let c = 0; c < 3; c++) {
          const cTop = sd[i00 + c] * a00 + (sd[i10 + c] * a10 - sd[i00 + c] * a00) * tx
          const cBot = sd[i01 + c] * a01 + (sd[i11 + c] * a11 - sd[i01 + c] * a01) * tx
          out[o + c] = clampByte((cTop + (cBot - cTop) * ty) / a)
        }
      }
      out[o + 3] = clampByte(a * 255)
    }
  }
  return { width: targetW, height: targetH, data: out }
}

/** Circularly shifts an RGBA image (periodic wrap) for translation-invariance verification. */
export function circularShiftImageData(src: RgbaImageData, dx: number, dy: number): RgbaImageData {
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(w * h * 4)
  const sd = src.data
  const ox = ((dx % w) + w) % w
  const oy = ((dy % h) + h) % h
  for (let y = 0; y < h; y++) {
    const sy = (y + oy) % h
    for (let x = 0; x < w; x++) {
      const sx = (x + ox) % w
      const si = (sy * w + sx) * 4
      const di = (y * w + x) * 4
      out[di] = sd[si]
      out[di + 1] = sd[si + 1]
      out[di + 2] = sd[si + 2]
      out[di + 3] = sd[si + 3]
    }
  }
  return { width: w, height: h, data: out }
}

/** Deterministic k-means++ clustering in CIELAB space on sampled foreground pixels. */
export function extractLabPalette(
  samples: [number, number, number][],
  k: number,
  maxIters = 14,
): { hex: string; lab: [number, number, number]; weight: number }[] {
  if (samples.length === 0) return [{ hex: '#5a8c3c', lab: [53, -24, 34], weight: 1 }]
  const kk = Math.max(1, Math.min(k, samples.length))
  // Deterministic farthest-first seeding starting from median-luminance sample
  const sortedByL = [...samples].sort((a, b) => a[0] - b[0])
  const centers: [number, number, number][] = [sortedByL[Math.floor(sortedByL.length * 0.5)].slice() as [number, number, number]]
  while (centers.length < kk) {
    let bestIdx = 0
    let bestDist = -1
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]
      let minD = Infinity
      for (const c of centers) {
        const d = (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2 + (s[2] - c[2]) ** 2
        if (d < minD) minD = d
      }
      if (minD > bestDist) { bestDist = minD; bestIdx = i }
    }
    centers.push(samples[bestIdx].slice() as [number, number, number])
  }

  const assign = new Int32Array(samples.length)
  const sums = Array.from({ length: kk }, () => [0, 0, 0, 0])

  for (let it = 0; it < maxIters; it++) {
    for (let c = 0; c < kk; c++) sums[c][0] = sums[c][1] = sums[c][2] = sums[c][3] = 0
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]
      let best = 0, bestD = Infinity
      for (let c = 0; c < kk; c++) {
        const cc = centers[c]
        const d = (s[0] - cc[0]) ** 2 + (s[1] - cc[1]) ** 2 + (s[2] - cc[2]) ** 2
        if (d < bestD) { bestD = d; best = c }
      }
      assign[i] = best
      sums[best][0] += s[0]
      sums[best][1] += s[1]
      sums[best][2] += s[2]
      sums[best][3] += 1
    }
    for (let c = 0; c < kk; c++) {
      if (sums[c][3] > 0) {
        centers[c][0] = sums[c][0] / sums[c][3]
        centers[c][1] = sums[c][1] / sums[c][3]
        centers[c][2] = sums[c][2] / sums[c][3]
      }
    }
  }

  const total = Math.max(1, samples.length)
  const out = centers
    .map((lab, idx) => {
      const [r, g, b] = labToSrgb(lab[0], lab[1], lab[2])
      return { hex: rgb01ToHex(r, g, b), lab, weight: sums[idx][3] / total }
    })
    .filter(c => c.weight > 0.005)
    .sort((a, b) => a.lab[0] - b.lab[0])

  return out.length ? out : [{ hex: '#5a8c3c', lab: [53, -24, 34], weight: 1 }]
}
