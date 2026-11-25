// Fast pure-JS Float32 procedural texture graph evaluator (Substance Designer-style).
// Runs identically in both Browser and headless Node/Vitest environments.
import { CanvasTexture, DataTexture, NoColorSpace, RepeatWrapping, RGBAFormat, SRGBColorSpace, type Texture } from 'three'
import { dilateAlphaRgba } from '../broadleaf/leaf-material'
import { rng } from '../shape'
import type { EditableTextureSlot } from '../studio/texture-slots'
import { defaultBarkGradient, defaultParamsFor, nodeDefinitions } from './nodes'
import {
  evalAtlasCompose, evalCurvatureAo, evalCurvesLut, evalCustomLeaf,
  evalInkOutline, evalPaletteMap, evalVectorLayout,
} from './nodes-v2'
import type {
  GradientStop, GraphEvalResult, GraphNode, GrayBuffer, ImageBuffer,
  MaterialOutputResult, RgbaBuffer, TextureGraph,
} from './types'

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6))
  return t * t * (3 - 2 * t)
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const mod = (a: number, n: number) => ((a % n) + n) % n

function num(p: Record<string, unknown>, key: string, fallback: number): number {
  const v = p[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
function str(p: Record<string, unknown>, key: string, fallback: string): string {
  const v = p[key]
  return typeof v === 'string' ? v : fallback
}
function bool(p: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = p[key]
  return typeof v === 'boolean' ? v : fallback
}

export function hexToRgb01(hex: string): [number, number, number] {
  const clean = (hex || '#808080').replace('#', '').trim()
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16) / 255,
      parseInt(clean[1] + clean[1], 16) / 255,
      parseInt(clean[2] + clean[2], 16) / 255,
    ]
  }
  const n = parseInt(clean.slice(0, 6), 16)
  if (!Number.isFinite(n)) return [0.5, 0.5, 0.5]
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) * 0.5
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h / 6, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 1) + 1) % 1
  if (s <= 1e-5) return [l, l, l]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue2rgb = (t: number) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  return [hue2rgb(h + 1 / 3), hue2rgb(h), hue2rgb(h - 1 / 3)]
}

function makeGray(width: number, height: number, fill = 0): GrayBuffer {
  const data = new Float32Array(width * height)
  if (fill !== 0) data.fill(fill)
  return { kind: 'gray', width, height, data }
}

function makeRgba(width: number, height: number, r = 0, g = 0, b = 0, a = 1): RgbaBuffer {
  const data = new Float32Array(width * height * 4)
  if (r !== 0 || g !== 0 || b !== 0 || a !== 0) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a
    }
  }
  return { kind: 'rgba', width, height, data }
}

export function toGray(buf: ImageBuffer | undefined, width: number, height: number, fallback = 0.5): GrayBuffer {
  if (!buf || buf.kind === 'label') return makeGray(width, height, fallback)
  if (buf.kind === 'gray') return buf
  const out = makeGray(buf.width, buf.height)
  const src = buf.data, dst = out.data
  for (let i = 0, j = 0; i < dst.length; i++, j += 4) {
    dst[i] = (0.299 * src[j] + 0.587 * src[j + 1] + 0.114 * src[j + 2]) * src[j + 3]
  }
  return out
}

export function toRgba(buf: ImageBuffer | undefined, width: number, height: number, fallbackAlpha = 1): RgbaBuffer {
  if (!buf || buf.kind === 'label') return makeRgba(width, height, 0.5, 0.5, 0.5, fallbackAlpha)
  if (buf.kind === 'rgba') return buf
  const out = makeRgba(buf.width, buf.height, 0, 0, 0, 0)
  const src = buf.data, dst = out.data
  for (let i = 0, j = 0; i < src.length; i++, j += 4) {
    const v = src[i]
    dst[j] = v; dst[j + 1] = v; dst[j + 2] = v; dst[j + 3] = 1
  }
  return out
}

// ---- Tileable integer hash & noise primitives ------------------------------
function hash2(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967296
}

function tileValueNoise(u: number, v: number, px: number, py: number, seed: number): number {
  const gx = u * px, gy = v * py
  const x0 = Math.floor(gx), y0 = Math.floor(gy)
  const fx = gx - x0, fy = gy - y0
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
  const ix0 = mod(x0, px), ix1 = mod(x0 + 1, px)
  const iy0 = mod(y0, py), iy1 = mod(y0 + 1, py)
  const n00 = hash2(ix0, iy0, seed)
  const n10 = hash2(ix1, iy0, seed)
  const n01 = hash2(ix0, iy1, seed)
  const n11 = hash2(ix1, iy1, seed)
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy)
}

function tileFbm(u: number, v: number, px: number, py: number, octaves: number, persistence: number, seed: number, ridged = false): number {
  let sum = 0, amp = 1, norm = 0
  let fx = Math.max(1, Math.round(px)), fy = Math.max(1, Math.round(py))
  for (let o = 0; o < octaves; o++) {
    let n = tileValueNoise(u, v, fx, fy, seed + o * 7919)
    if (ridged) {
      n = 1 - Math.abs(n * 2 - 1)
      n = n * n
    }
    sum += n * amp
    norm += amp
    amp *= persistence
    fx *= 2
    fy *= 2
  }
  return sum / (norm || 1)
}

function sampleGrayBilinear(buf: GrayBuffer, u: number, v: number, wrap: boolean): number {
  const w = buf.width, h = buf.height
  const uu = wrap ? mod(u, 1) : clamp01(u)
  const vv = wrap ? mod(v, 1) : clamp01(v)
  const fx = uu * w - 0.5, fy = vv * h - 0.5
  const x0 = Math.floor(fx), y0 = Math.floor(fy)
  const tx = fx - x0, ty = fy - y0
  const ix0 = wrap ? mod(x0, w) : Math.max(0, Math.min(w - 1, x0))
  const ix1 = wrap ? mod(x0 + 1, w) : Math.max(0, Math.min(w - 1, x0 + 1))
  const iy0 = wrap ? mod(y0, h) : Math.max(0, Math.min(h - 1, y0))
  const iy1 = wrap ? mod(y0 + 1, h) : Math.max(0, Math.min(h - 1, y0 + 1))
  const d = buf.data
  return lerp(
    lerp(d[iy0 * w + ix0], d[iy0 * w + ix1], tx),
    lerp(d[iy1 * w + ix0], d[iy1 * w + ix1], tx),
    ty,
  )
}

function sampleRgbaBilinear(buf: RgbaBuffer, u: number, v: number, wrap: boolean, out: [number, number, number, number]) {
  const w = buf.width, h = buf.height
  if (!wrap && (u < 0 || u > 1 || v < 0 || v > 1)) {
    out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0
    return
  }
  const uu = wrap ? mod(u, 1) : clamp01(u)
  const vv = wrap ? mod(v, 1) : clamp01(v)
  const fx = uu * w - 0.5, fy = vv * h - 0.5
  const x0 = Math.floor(fx), y0 = Math.floor(fy)
  const tx = fx - x0, ty = fy - y0
  const ix0 = wrap ? mod(x0, w) : Math.max(0, Math.min(w - 1, x0))
  const ix1 = wrap ? mod(x0 + 1, w) : Math.max(0, Math.min(w - 1, x0 + 1))
  const iy0 = wrap ? mod(y0, h) : Math.max(0, Math.min(h - 1, y0))
  const iy1 = wrap ? mod(y0 + 1, h) : Math.max(0, Math.min(h - 1, y0 + 1))
  const d = buf.data
  const i00 = (iy0 * w + ix0) * 4
  const i10 = (iy0 * w + ix1) * 4
  const i01 = (iy1 * w + ix0) * 4
  const i11 = (iy1 * w + ix1) * 4
  for (let c = 0; c < 4; c++) {
    out[c] = lerp(lerp(d[i00 + c], d[i10 + c], tx), lerp(d[i01 + c], d[i11 + c], tx), ty)
  }
}

// ---- Individual Node Evaluators --------------------------------------------
function evalPerlinNoise(p: Record<string, unknown>, w: number, h: number): Record<string, ImageBuffer> {
  const sx = Math.max(1, Math.round(num(p, 'scaleX', 6)))
  const sy = Math.max(1, Math.round(num(p, 'scaleY', 6)))
  const oct = Math.max(1, Math.min(6, Math.round(num(p, 'octaves', 4))))
  const pers = num(p, 'persistence', 0.52)
  const ridged = bool(p, 'ridged', false)
  const seed = Math.round(num(p, 'seed', 101))
  const out = makeGray(w, h)
  const d = out.data
  for (let y = 0; y < h; y++) {
    const v = y / h
    const row = y * w
    for (let x = 0; x < w; x++) {
      d[row + x] = clamp01(tileFbm(x / w, v, sx, sy, oct, pers, seed, ridged))
    }
  }
  return { out }
}

function evalBarkFibers(p: Record<string, unknown>, w: number, h: number): Record<string, ImageBuffer> {
  const sx = Math.max(2, Math.round(num(p, 'scaleX', 10)))
  const sy = Math.max(1, Math.round(num(p, 'scaleY', 3)))
  const warp = num(p, 'warp', 0.55)
  const fissure = num(p, 'fissure', 1.25)
  const fineGrain = num(p, 'fineGrain', 0.35)
  const oct = Math.max(2, Math.min(6, Math.round(num(p, 'octaves', 4))))
  const seed = Math.round(num(p, 'seed', 207))
  const out = makeGray(w, h)
  const d = out.data
  const warpAmpX = warp * 0.14
  const warpAmpY = warp * 0.06
  for (let y = 0; y < h; y++) {
    const v = y / h
    const row = y * w
    for (let x = 0; x < w; x++) {
      const u = x / w
      const wx = (tileFbm(u, v, Math.max(2, Math.round(sx * 0.35)), Math.max(2, sy), 2, 0.5, seed + 131) - 0.5) * warpAmpX
      const wy = (tileFbm(u, v, Math.max(2, Math.round(sx * 0.25)), Math.max(2, sy), 2, 0.5, seed + 269) - 0.5) * warpAmpY
      const wu = mod(u + wx, 1), wv = mod(v + wy, 1)
      const base = tileFbm(wu, wv, sx, sy, oct, 0.54, seed, false)
      const ridge = 1 - Math.abs(base * 2 - 1)
      const cracked = Math.pow(clamp01(ridge), fissure)
      const fine = fineGrain > 0.001 ? tileFbm(wu, wv, sx * 3, Math.max(2, sy * 2), 2, 0.5, seed + 997, false) : 0.5
      const val = lerp(cracked, cracked * 0.72 + fine * 0.28, fineGrain)
      d[row + x] = clamp01(val)
    }
  }
  return { out }
}

/** Stylized Hand-Painted Broad-Brushstroke Ancient Bark (Genshin / Ghibli aesthetic):
 *  Sculpted macro wood-ridge relief warped along an organic flow field ->
 *  crisp flat-chisel gouache brush slabs placed by ridge elevation (deep warm umber
 *  & cool taupe hollows -> rich caramel-tan mid slopes -> sunlit creamy beige ridge crests) ->
 *  tapered hand-painted dark umber seam cracks -> crisp velvety valley moss patches with AO rim. */
function evalPainterlyBark(p: Record<string, unknown>, w: number, h: number): Record<string, ImageBuffer> {
  const sx = Math.max(3, Math.round(num(p, 'scaleX', 6)))
  const sy = Math.max(1, Math.round(num(p, 'scaleY', 2)))
  const flowWarp = num(p, 'flowWarp', 0.72)
  const brushSteps = Math.max(3, Math.min(12, Math.round(num(p, 'brushSteps', 6))))
  const creviceDepth = num(p, 'creviceDepth', 0.82)
  const mossCoverage = clamp01(num(p, 'mossCoverage', 0.42))
  const coolAccent = clamp01(num(p, 'coolAccent', 0.24))
  const hiRgb = hexToRgb01(str(p, 'highlightColor', '#e2cda8'))
  const midRgb = hexToRgb01(str(p, 'midColor', '#a8845e'))
  const crevRgb = hexToRgb01(str(p, 'creviceColor', '#4f3527'))
  const seed = Math.round(num(p, 'seed', 731))

  const rgba = makeRgba(w, h, midRgb[0], midRgb[1], midRgb[2], 1)
  const height = makeGray(w, h, 0.45)
  const moss = makeGray(w, h, 0)
  const rd = rgba.data, hd = height.data, md = moss.data
  const coolRgb: [number, number, number] = [0.43, 0.56, 0.54]
  const warmShadowRgb: [number, number, number] = [
    lerp(crevRgb[0], midRgb[0], 0.36),
    lerp(crevRgb[1], midRgb[1], 0.33),
    lerp(crevRgb[2], midRgb[2], 0.30),
  ]

  // Pass 1: Continuous organic sculpted macro relief (broad sunlit driftwood ridges & deep root hollows)
  const flowX = new Float32Array(w * h)
  const macroBase = new Float32Array(w * h)
  const ridgeFreqX = Math.max(2, Math.round(sx * 0.55))
  const ridgeFreqY = Math.max(1, sy)
  for (let y = 0; y < h; y++) {
    const v = y / h
    const row = y * w
    for (let x = 0; x < w; x++) {
      const u = x / w
      const fx = (tileFbm(u, v, 2, 2, 2, 0.52, seed + 131) - 0.5) * flowWarp * 0.22
      flowX[row + x] = fx
      const wu = mod(u + fx, 1)
      const wv = mod(v + (tileFbm(u, v, 2, 2, 2, 0.5, seed + 257) - 0.5) * flowWarp * 0.08, 1)
      // Broad organic sculptural swells + secondary ridge strands (no periodic stripes)
      const broad = tileFbm(wu, wv, ridgeFreqX, ridgeFreqY, 3, 0.54, seed + 401)
      const strand = tileFbm(wu, wv, Math.max(3, sx), Math.max(1, sy), 2, 0.5, seed + 521)
      const relief = clamp01(smoothstep(0.16, 0.86, broad * 0.72 + strand * 0.28))
      macroBase[row + x] = relief
      const o = (row + x) * 4
      // Warm deep umber in hollows -> rich caramel-tan on mid slopes
      const baseT = smoothstep(0.08, 0.78, relief)
      rd[o] = lerp(crevRgb[0] * 0.92, midRgb[0] * 0.96, baseT)
      rd[o + 1] = lerp(crevRgb[1] * 0.90, midRgb[1] * 0.95, baseT)
      rd[o + 2] = lerp(crevRgb[2] * 0.90, midRgb[2] * 0.94, baseT)
      rd[o + 3] = 1
      hd[row + x] = clamp01(0.18 + relief * 0.56)
    }
  }

  // Helper: stamps a crisp seamless flat-chisel gouache brushstroke warped along the organic trunk flow
  const paintWoodStroke = (
    cx: number, cy: number, halfW: number, halfL: number, tilt: number,
    col: [number, number, number], targetH: number, opacity: number, edgeCrisp: number,
    bristleSeed: number, isCrack: boolean,
  ) => {
    const minY = Math.floor((cy - halfL * 1.15) * h)
    const maxY = Math.ceil((cy + halfL * 1.15) * h)
    const minX = Math.floor((cx - halfW * 1.9 - Math.abs(tilt) * halfL) * w)
    const maxX = Math.ceil((cx + halfW * 1.9 + Math.abs(tilt) * halfL) * w)
    const bevelDir = bristleSeed % 2 > 1 ? 1 : -1
    for (let py = minY; py <= maxY; py++) {
      const wy = mod(py, h)
      const dy = (py / h - cy) / Math.max(1e-4, halfL)
      if (dy < -1.04 || dy > 1.04) continue
      const normT = clamp01((dy + 1) * 0.5)
      // Cracks taper sharply to needle tips; chisel gouache wood planes have broad sculpted squared-off ends!
      const lenEnv = isCrack
        ? Math.sin(normT * Math.PI)
        : Math.pow(Math.sin(normT * Math.PI), 0.28)
      const curveShift = Math.sin(dy * 2.1 + bristleSeed) * halfW * 0.48 + dy * tilt * halfL
      const row = wy * w
      for (let px = minX; px <= maxX; px++) {
        const wx = mod(px, w)
        const fShift = flowX[row + wx] * 0.62
        const widthMod = isCrack ? (0.18 + 0.85 * lenEnv) : (0.52 + 0.52 * lenEnv)
        const dx = (px / w - (cx + curveShift + fShift)) / Math.max(1e-4, halfW * widthMod)
        if (dx < -1.08 || dx > 1.08) continue
        // Crisp painterly flat-brush edge + subtle directional gouache paint variation
        const edge = smoothstep(1.02, 1.02 - edgeCrisp, Math.abs(dx)) * smoothstep(0.02, isCrack ? 0.22 : 0.16, lenEnv)
        const a = clamp01(edge * opacity)
        if (a <= 0.004) continue
        const brushSheen = 0.94 + 0.07 * Math.sin(dx * 2.4 + bristleSeed * 1.3) + (isCrack ? 0 : (0.5 - normT) * 0.06)
        const bevel = isCrack ? 1 : (1 - dx * 0.13 * bevelDir)
        const idx = row + wx
        const o = idx * 4
        rd[o] = clamp01(lerp(rd[o], col[0] * brushSheen * bevel, a))
        rd[o + 1] = clamp01(lerp(rd[o + 1], col[1] * brushSheen * bevel, a))
        rd[o + 2] = clamp01(lerp(rd[o + 2], col[2] * brushSheen * bevel, a))
        hd[idx] = clamp01(lerp(hd[idx], targetH * (0.86 + 0.14 * lenEnv), a))
      }
    }
  }

  const sampleMacro = (u: number, v: number) => {
    const ix = mod(Math.floor(u * w), w)
    const iy = mod(Math.floor(v * h), h)
    return macroBase[iy * w + ix]
  }

  // Pass 2: Elevation-Guided Layered Gouache Bark Slabs (true light-on-crest, rich-umber-in-hollow sculpting!)
  const r = rng(seed + 701)
  const baseCount = Math.round(sx * sy * 11)
  const darkCol: [number, number, number] = [crevRgb[0] * 0.86, crevRgb[1] * 0.84, crevRgb[2] * 0.86]
  const warmMidDark: [number, number, number] = [
    lerp(crevRgb[0], midRgb[0], 0.56),
    lerp(crevRgb[1], midRgb[1], 0.54),
    lerp(crevRgb[2], midRgb[2], 0.50),
  ]
  const warmLight: [number, number, number] = [
    lerp(midRgb[0], hiRgb[0], 0.58),
    lerp(midRgb[1], hiRgb[1], 0.58),
    lerp(midRgb[2], hiRgb[2], 0.55),
  ]

  // 2a. Deep shaded wood planes & cool slate-taupe mineral strokes nestled on recessed slopes
  for (let i = 0; i < Math.round(baseCount * 0.85); i++) {
    const cx = r(), cy = r()
    const m = sampleMacro(cx, cy)
    if (m > 0.68 && r() > 0.25) continue
    const hw = (0.038 + r() * 0.064) * (6.5 / sx)
    const hl = (0.12 + r() * 0.22) / Math.max(0.7, sy * 0.65)
    const tilt = (r() - 0.5) * 0.24
    const useCool = coolAccent > 0.02 && r() < coolAccent * 0.55
    const col: [number, number, number] = useCool
      ? [lerp(warmShadowRgb[0], coolRgb[0], 0.52), lerp(warmShadowRgb[1], coolRgb[1], 0.52), lerp(warmShadowRgb[2], coolRgb[2], 0.52)]
      : [warmShadowRgb[0] * (0.86 + r() * 0.24), warmShadowRgb[1] * (0.86 + r() * 0.24), warmShadowRgb[2] * (0.86 + r() * 0.24)]
    paintWoodStroke(cx, cy, hw, hl, tilt, col, 0.24 + r() * 0.16, 0.82, 0.20, r() * 20, false)
  }

  // 2b. Rich caramel-tan & warm sienna sculpted chisel-brush mid planes (backbone of Genshin driftwood)
  for (let i = 0; i < Math.round(baseCount * 1.15); i++) {
    const cx = r(), cy = r()
    const m = sampleMacro(cx, cy)
    if (m < 0.20 && r() > 0.22) continue
    const hw = (0.032 + r() * 0.056) * (6.5 / sx)
    const hl = (0.12 + r() * 0.24) / Math.max(0.7, sy * 0.65)
    const tilt = (r() - 0.5) * 0.22
    const src = m < 0.45 ? warmMidDark : midRgb
    const tone = 0.88 + r() * 0.22
    const col: [number, number, number] = [src[0] * tone, src[1] * tone, src[2] * tone]
    paintWoodStroke(cx, cy, hw, hl, tilt, col, 0.46 + m * 0.22, 0.86, 0.18, r() * 20, false)
  }

  // 2c. Bold tapered dark warm-umber bark crevices separating thick braided wood strands
  const crackCount = Math.round(sx * sy * 6.0 * Math.max(0.4, creviceDepth))
  for (let i = 0; i < crackCount; i++) {
    const cx = r(), cy = r()
    const m = sampleMacro(cx, cy)
    const hw = (0.006 + r() * 0.012) * (6.5 / sx) * (m < 0.45 ? 1.25 : 0.85)
    const hl = (0.14 + r() * 0.28) / Math.max(0.7, sy * 0.65)
    const tilt = (r() - 0.5) * 0.22
    const shade = 0.78 + r() * 0.24
    const col: [number, number, number] = [darkCol[0] * shade, darkCol[1] * shade, darkCol[2] * shade]
    paintWoodStroke(cx, cy, hw, hl, tilt, col, 0.10 + r() * 0.08, clamp01(0.74 * creviceDepth), 0.34, r() * 20, true)
  }

  // 2d. Sunlit creamy-beige flat-chisel highlight planes concentrated on raised wood ridge crowns!
  for (let i = 0; i < Math.round(baseCount * 0.78); i++) {
    const cx = r(), cy = r()
    const m = sampleMacro(cx, cy)
    // Keep highlights on elevated ridges so hollows preserve deep warm contrast!
    if (m < 0.40 && r() > 0.14) continue
    const hw = (0.026 + r() * 0.048) * (6.5 / sx)
    const hl = (0.11 + r() * 0.22) / Math.max(0.7, sy * 0.65)
    const tilt = (r() - 0.5) * 0.20
    const isPeak = m > 0.62 && r() > 0.32
    const srcC = isPeak ? hiRgb : warmLight
    const vJit = 0.94 + r() * 0.10
    const col: [number, number, number] = [srcC[0] * vJit, srcC[1] * vJit, srcC[2] * vJit]
    paintWoodStroke(cx, cy, hw, hl, tilt, col, isPeak ? 0.86 + r() * 0.12 : 0.68 + r() * 0.14, isPeak ? 0.86 : 0.76, 0.16, r() * 20, false)
  }

  // 2e. Crisp secondary shadow crease strokes + occasional subtle turquoise-slate mineral accents
  for (let i = 0; i < Math.round(crackCount * 0.42); i++) {
    const cx = r(), cy = r()
    const hw = (0.004 + r() * 0.008) * (6.5 / sx)
    const hl = (0.09 + r() * 0.18) / Math.max(0.7, sy * 0.65)
    const tilt = (r() - 0.5) * 0.20
    const col: [number, number, number] = [crevRgb[0] * 0.74, crevRgb[1] * 0.70, crevRgb[2] * 0.72]
    paintWoodStroke(cx, cy, hw, hl, tilt, col, 0.06, clamp01(0.70 * creviceDepth), 0.36, r() * 20, true)
  }

  // Pass 3: Painterly tonal step grouping + CRISP velvety macro-hollow moss islands (no blurry fog, no crack slivers!)
  for (let y = 0; y < h; y++) {
    const v = y / h
    const row = y * w
    for (let x = 0; x < w; x++) {
      const u = x / w
      const idx = row + x
      const o = idx * 4
      // Gentle painterly value grouping retains crisp chisel-plane facets
      const lum = Math.max(1e-4, 0.299 * rd[o] + 0.587 * rd[o + 1] + 0.114 * rd[o + 2])
      const q = lum * brushSteps
      const qb = Math.floor(q)
      const qf = smoothstep(0.18, 0.82, q - qb)
      const ql = (qb + qf) / brushSteps
      const ratio = lerp(1, ql / lum, 0.42)
      rd[o] = clamp01(rd[o] * ratio)
      rd[o + 1] = clamp01(rd[o + 1] * ratio)
      rd[o + 2] = clamp01(rd[o + 2] * ratio)

      // Lush painterly moss islands anchored to BROAD macro hollows (1 - macroBase), broken up by
      // crisp brushy tuft noise — NEVER thin vertical crack lines or blurry airbrush clouds!
      if (mossCoverage > 0.005) {
        const wu = mod(u + flowX[idx] * 0.55, 1)
        const macroHollow = smoothstep(0.72, 0.14, macroBase[idx])
        const patch = tileFbm(wu, v, 2, 2, 3, 0.56, seed + 1607)
        const brushEdge = tileFbm(wu, v, 7, 11, 2, 0.52, seed + 1847)
        const field = macroHollow * 0.54 + patch * 0.44 + (brushEdge - 0.5) * 0.24
        const thresh = lerp(0.86, 0.34, mossCoverage)
        const mVal = smoothstep(thresh - 0.022, thresh + 0.026, field)
        md[idx] = mVal
        // Subtle warm-umber contact AO rim right outside moss border so moss sits naturally in the bark recess
        const aoRim = smoothstep(thresh - 0.085, thresh - 0.015, field) * (1 - mVal)
        if (aoRim > 0.01) {
          const dim = 1 - aoRim * 0.22
          rd[o] *= dim
          rd[o + 1] *= dim
          rd[o + 2] *= dim
        }
      }
    }
  }
  return { rgba, height, moss }
}

function evalCellsVoronoi(p: Record<string, unknown>, w: number, h: number): Record<string, ImageBuffer> {
  const sx = Math.max(2, Math.round(num(p, 'scaleX', 8)))
  const sy = Math.max(2, Math.round(num(p, 'scaleY', 4)))
  const jitter = clamp01(num(p, 'jitter', 0.85))
  const mode = str(p, 'mode', 'edge')
  const edgeWidth = Math.max(0.05, num(p, 'edgeWidth', 0.32))
  const seed = Math.round(num(p, 'seed', 309))

  // Precompute cell feature points for fast periodic lookup
  const ptsX = new Float32Array(sx * sy)
  const ptsY = new Float32Array(sx * sy)
  const cellVal = new Float32Array(sx * sy)
  for (let cy = 0; cy < sy; cy++) {
    for (let cx = 0; cx < sx; cx++) {
      const idx = cy * sx + cx
      ptsX[idx] = 0.5 + (hash2(cx, cy, seed + 17) - 0.5) * jitter
      ptsY[idx] = 0.5 + (hash2(cx, cy, seed + 53) - 0.5) * jitter
      cellVal[idx] = hash2(cx, cy, seed + 109)
    }
  }

  const out = makeGray(w, h)
  const d = out.data
  for (let y = 0; y < h; y++) {
    const gy = (y / h) * sy
    const iy = Math.floor(gy)
    const fy = gy - iy
    const row = y * w
    for (let x = 0; x < w; x++) {
      const gx = (x / w) * sx
      const ix = Math.floor(gx)
      const fx = gx - ix
      let f1 = 999, f2 = 999, bestVal = 0.5
      for (let dy = -1; dy <= 1; dy++) {
        const ny = mod(iy + dy, sy)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = mod(ix + dx, sx)
          const idx = ny * sx + nx
          const px = dx + ptsX[idx] - fx
          const py = dy + ptsY[idx] - fy
          const dist = Math.hypot(px, py)
          if (dist < f1) {
            f2 = f1
            f1 = dist
            bestVal = cellVal[idx]
          } else if (dist < f2) {
            f2 = dist
          }
        }
      }
      if (mode === 'plate') {
        d[row + x] = clamp01(1 - f1 * 1.25)
      } else if (mode === 'cell') {
        d[row + x] = bestVal
      } else {
        d[row + x] = smoothstep(0, edgeWidth, f2 - f1)
      }
    }
  }
  return { out }
}

function evalLenticels(p: Record<string, unknown>, w: number, h: number): Record<string, ImageBuffer> {
  const count = Math.max(4, Math.min(260, Math.round(num(p, 'count', 76))))
  const width = num(p, 'width', 0.14)
  const thickness = num(p, 'thickness', 0.012)
  const roughness = num(p, 'roughness', 0.4)
  const seed = Math.round(num(p, 'seed', 412))
  const r = rng(seed)
  const out = makeGray(w, h, 0)
  const d = out.data

  for (let i = 0; i < count; i++) {
    const cx = r(), cy = r()
    const rx = width * (0.45 + r() * 0.95) * 0.5
    const ry = thickness * (0.55 + r() * 0.95) * 0.5
    const strength = 0.55 + r() * 0.45
    const tilt = (r() - 0.5) * 0.08
    const minX = Math.floor((cx - rx * 1.4) * w)
    const maxX = Math.ceil((cx + rx * 1.4) * w)
    const minY = Math.floor((cy - ry * 2.2 - Math.abs(tilt) * rx) * h)
    const maxY = Math.ceil((cy + ry * 2.2 + Math.abs(tilt) * rx) * h)
    for (let py = minY; py <= maxY; py++) {
      const wy = mod(py, h)
      const dy = (py / h - cy)
      for (let px = minX; px <= maxX; px++) {
        const wx = mod(px, w)
        const dx = (px / w - cx)
        const ny = (dy - dx * tilt) / Math.max(1e-4, ry)
        const nx = dx / Math.max(1e-4, rx)
        const wobble = roughness > 0.01 ? (hash2(wx, wy, seed + i) - 0.5) * roughness * 0.45 : 0
        // Pointed almond horizontal lenticel shape
        const dist = nx * nx + ny * ny / Math.max(0.08, 1 - Math.min(0.85, nx * nx))
        const val = smoothstep(1.1, 0.25, dist + wobble) * strength
        const idx = wy * w + wx
        if (val > d[idx]) d[idx] = val
      }
    }
  }
  return { out }
}

function evalGradientLinear(p: Record<string, unknown>, w: number, h: number): Record<string, ImageBuffer> {
  const mode = str(p, 'mode', 'linear')
  const angle = (num(p, 'angle', 0) * Math.PI) / 180
  const start = num(p, 'start', 0)
  const end = num(p, 'end', 1)
  const invert = bool(p, 'invert', false)
  const ca = Math.cos(angle), sa = Math.sin(angle)
  const out = makeGray(w, h)
  const d = out.data
  for (let y = 0; y < h; y++) {
    const v = y / h - 0.5
    const row = y * w
    for (let x = 0; x < w; x++) {
      const u = x / w - 0.5
      let t = 0
      if (mode === 'radial') {
        t = 1 - clamp01(Math.hypot(u, v) * 2)
      } else {
        const proj = u * ca + v * sa + 0.5
        t = mode === 'mirror' ? 1 - Math.abs(proj * 2 - 1) : proj
      }
      let val = smoothstep(start, end, t)
      if (invert) val = 1 - val
      d[row + x] = clamp01(val)
    }
  }
  return { out }
}

function evalLeafShape(p: Record<string, unknown>, w: number, h: number): Record<string, ImageBuffer> {
  const shape = str(p, 'shape', 'ovate')
  const length = num(p, 'length', 0.82)
  const width = num(p, 'width', 0.56)
  const tipSharp = num(p, 'tipSharp', 1.0)
  const serration = num(p, 'serration', 0.04)
  const serrationFreq = Math.max(3, Math.round(num(p, 'serrationFreq', 10)))
  const bend = num(p, 'bend', 0.05)
  const veinStrength = num(p, 'veinStrength', 0.55)
  const veinCount = Math.max(2, Math.round(num(p, 'veinCount', 6)))
  const baseRgb = hexToRgb01(str(p, 'baseColor', '#2f5f2c'))
  const tipRgb = hexToRgb01(str(p, 'tipColor', '#8bd152'))
  const veinRgb = hexToRgb01(str(p, 'veinColor', '#c7ec8c'))

  const rgba = makeRgba(w, h, 0, 0, 0, 0)
  const height = makeGray(w, h, 0)
  const rd = rgba.data, hd = height.data
  const aa = 2.2 / Math.min(w, h)

  // Bottom petiole anchor at (0.5, 0.94), tip growing upward toward y = 0.94 - length
  const yBase = 0.93
  const halfW = width * 0.5

  for (let y = 0; y < h; y++) {
    const v = y / h
    const t = (yBase - v) / Math.max(0.05, length) // 0 at base, 1 at tip
    const row = y * w
    for (let x = 0; x < w; x++) {
      const u = x / w
      const idx = row + x
      const o = idx * 4

      // Short tapered petiole below t = 0 (omitted for oak rosette leaves so no dark ticks protrude)
      const bendOff = bend * t * t * 0.35
      const dx = u - (0.5 + bendOff)
      if (t < 0 && t > -0.1) {
        if (shape === 'oak') continue
        const stemW = 0.018 * (1 + t * 2)
        const stemMask = smoothstep(stemW + aa, stemW - aa, Math.abs(dx))
        if (stemMask > 0.001) {
          rd[o] = baseRgb[0] * 0.65
          rd[o + 1] = baseRgb[1] * 0.62
          rd[o + 2] = baseRgb[2] * 0.52
          rd[o + 3] = stemMask
          hd[idx] = stemMask * 0.45
        }
        continue
      }

      let alpha = 0
      let relAcross = 0
      let relAlong = clamp01(t)
      let vein = 0

      if (shape === 'maple') {
        // 5-lobed palmate Japanese maple leaf centered around (0.5, 0.54)
        const cx = u - 0.5 - bend * 0.08
        const cy = (0.58 - v) / Math.max(0.25, length * 0.95)
        const rad = Math.hypot(cx / Math.max(0.2, width * 1.15), cy)
        const ang = Math.atan2(cx, cy) // 0 = straight up, +-PI = down
        // 5 main lobes at 0, +-52 deg, +-106 deg
        const lobes: [number, number, number][] = [
          [0, 0.48, 0.34],
          [-0.88, 0.43, 0.34],
          [0.88, 0.43, 0.34],
          [-1.78, 0.31, 0.35],
          [1.78, 0.31, 0.35],
        ]
        let maxR = 0.11
        let bestLobeDist = 99
        for (const [la, lr, lw] of lobes) {
          const da = Math.abs(ang - la)
          const lobe = Math.exp(-Math.pow(da / lw, 1.85)) * lr
          if (lobe > maxR) maxR = lobe
          bestLobeDist = Math.min(bestLobeDist, da)
        }
        const saw = serration > 0 ? Math.sin(ang * serrationFreq * 2.5) * serration * 0.14 * smoothstep(0.14, 0.35, maxR) : 0
        const edgeDist = (maxR + saw) - rad
        alpha = smoothstep(-aa * 1.6, aa * 1.6, edgeDist)
        relAlong = clamp01(rad / 0.46)
        relAcross = clamp01(1 - edgeDist / 0.14)
        // Palmate 5 main veins radiating along the 5 lobe axes
        const palmVein = smoothstep(0.065, 0.01, bestLobeDist) * smoothstep(0.46, 0.04, rad)
        const subVein = Math.pow(Math.max(0, Math.cos(rad * veinCount * 9 - bestLobeDist * 8)), 10) * 0.45
        vein = clamp01(palmVein * 0.85 + subVein * 0.45)
      } else if (shape === 'ginkgo') {
        if (t >= 0 && t <= 1.05) {
          const fanW = halfW * Math.pow(clamp01(t), 0.72) * (1.06 - 0.14 * t * t)
          const notch = Math.exp(-Math.pow(dx / (halfW * 0.16), 2)) * 0.24
          const topBound = 0.96 - notch + Math.sin(dx * 28) * 0.025
          const dSide = fanW - Math.abs(dx)
          const dTop = topBound - t
          const dMin = Math.min(dSide, dTop * length)
          alpha = smoothstep(-aa, aa, dMin)
          relAcross = clamp01(Math.abs(dx) / Math.max(0.01, fanW))
          const fanAng = Math.atan2(dx, Math.max(0.02, t))
          vein = Math.pow(Math.abs(Math.sin(fanAng * veinCount * 4.5)), 8) * 0.65 * (1 - t * 0.3)
        }
      } else if (shape === 'oak') {
        // Explicit plush multi-lobed oak leaf SDF (5-7 distinct pillowy rounded oak lobes — matches Genshin/Ghibli oak foliage!)
        if (t >= -0.02 && t <= 1.06) {
          const tt = clamp01(t)
          const ax = Math.abs(dx)
          // Smooth central leaf spine + explicit rounded side lobe circles + plush rounded terminal head lobe
          const lobeDefs: [number, number, number, number][] = [
            // [offsetX_frac, t_center, radX_frac, radT]
            [0.00, 0.86, 0.34, 0.17], // plump rounded apical tip lobe
            [0.44, 0.72, 0.34, 0.14], // upper side lobe pair (widest!)
            [0.46, 0.49, 0.33, 0.135], // mid side lobe pair
            [0.32, 0.27, 0.25, 0.12], // lower side lobe pair
          ]
          // Central connecting blade core (tapers cleanly toward petiole)
          const coreW = halfW * (0.14 + 0.34 * Math.sin(Math.pow(tt, 0.72) * Math.PI))
          let sdf = Math.min(coreW - ax, (0.94 - t) * length, t * length)
          let bestLobeProx = 0
          for (const [oxf, tc, rxf, rt] of lobeDefs) {
            const lx = (ax - halfW * oxf) / Math.max(0.02, halfW * rxf)
            const ly = (t - tc) / Math.max(0.02, rt)
            const dLobe = (1.0 - Math.hypot(lx, ly)) * Math.min(halfW * rxf, rt * length)
            // Smooth union (smin) for organic rounded bay sinuses between oak lobes!
            const k = 0.018
            const hMix = Math.max(k - Math.abs(sdf - dLobe), 0) / k
            sdf = Math.max(sdf, dLobe) + hMix * hMix * k * 0.25
            if (dLobe > -0.01) bestLobeProx = Math.max(bestLobeProx, clamp01(1 - Math.hypot(lx, ly)))
          }
          alpha = smoothstep(-aa * 1.15, aa * 1.15, sdf)
          relAcross = clamp01(ax / Math.max(0.01, halfW * 0.78))
          // Rich dark cool-emerald base -> vibrant luminous sunlit lobe crowns!
          relAlong = clamp01(Math.pow(tt, 0.85) * 0.68 + relAcross * 0.24 + (1 - bestLobeProx) * 0.12)
          // Subtle central midrib + delicate veins fanning gently into each rounded oak lobe
          const midribW = 0.018 * (1 - tt * 0.65)
          const midrib = smoothstep(midribW + aa, midribW * 0.18, ax) * smoothstep(0.92, 0.78, tt)
          const ribPhase = tt * 3.8 - relAcross * 0.55
          const latVein = smoothstep(0.08, 0.015, Math.abs(ribPhase - Math.round(ribPhase))) * (1 - relAcross * 0.5) * smoothstep(0.14, 0.3, tt) * smoothstep(0.92, 0.75, tt)
          vein = clamp01(Math.max(midrib * 0.80, latVein * 0.42))
        }
      } else if (shape === 'sakura') {
        if (t >= 0 && t <= 1.04) {
          // Heart-notched cherry blossom petal
          const profile = Math.sin(Math.pow(clamp01(t), 0.72) * Math.PI) * (0.68 + 0.38 * t)
          const half = halfW * profile
          const notch = Math.exp(-Math.pow(dx / Math.max(0.02, halfW * 0.24), 2)) * 0.18
          const dSide = half - Math.abs(dx)
          const dTop = (1.0 - notch) - t
          alpha = smoothstep(-aa, aa, Math.min(dSide, dTop * length))
          relAcross = clamp01(Math.abs(dx) / Math.max(0.01, half))
          vein = smoothstep(0.06, 0.0, Math.abs(dx) / Math.max(0.01, halfW)) * (1 - t * 0.4) * 0.4
        }
      } else {
        if (t >= -0.01 && t <= 1.02) {
          let profile = 0
          if (shape === 'elliptic') {
            profile = Math.sin(Math.pow(clamp01(t), 0.85) * Math.PI)
            profile = Math.pow(Math.max(0, profile), 0.75)
          } else if (shape === 'lance') {
            profile = Math.sin(Math.pow(clamp01(t), 0.65) * Math.PI) * 0.58 * (1 - 0.15 * t)
          } else if (shape === 'needle') {
            profile = (1 - Math.pow(clamp01(t), 1.4)) * Math.min(1, t * 8) * 0.28
          } else if (shape === 'heart') {
            const s = Math.sin(Math.pow(clamp01(t), 0.62) * Math.PI)
            profile = s * (1.22 - 0.35 * t)
            if (t < 0.14) profile *= smoothstep(-0.02, 0.14, t) + 0.3 * Math.abs(dx) * 4
          } else {
            // Classic ovate broadleaf
            const s = Math.sin(Math.pow(clamp01(t), 0.72 * Math.pow(tipSharp, -0.35)) * Math.PI)
            profile = Math.pow(Math.max(0, s), 0.88) * Math.pow(Math.max(0.001, 1 - t * 0.12), tipSharp * 0.5)
          }
          const saw = serration > 0 && t > 0.08 && t < 0.94
            ? (0.5 + 0.5 * Math.sin(t * serrationFreq * Math.PI * 2)) * serration * halfW * profile
            : 0
          const bound = halfW * profile + saw
          const edge = bound - Math.abs(dx)
          const capTop = (1 - t) * length
          const capBot = t * length
          const sdf = Math.min(edge, capTop, capBot)
          alpha = smoothstep(-aa, aa, sdf)
          relAcross = clamp01(Math.abs(dx) / Math.max(0.005, bound))
          // Midrib + curved pinnate lateral veins
          const midribW = 0.022 * (1 - t * 0.75)
          const midrib = smoothstep(midribW + aa, midribW * 0.2, Math.abs(dx))
          const lateralPhase = t * veinCount - Math.pow(relAcross, 0.85) * 1.35
          const lateralWave = Math.abs(lateralPhase - Math.round(lateralPhase))
          const lateral = smoothstep(0.11, 0.02, lateralWave) * (1 - relAcross * 0.65) * smoothstep(0.05, 0.16, t) * smoothstep(0.98, 0.82, t)
          vein = clamp01(Math.max(midrib * 0.95, lateral * 0.62))
        }
      }

      if (alpha > 0.001) {
        const gradT = clamp01(relAlong * 0.78 + relAcross * 0.22)
        // Subtle 3D leaf blade cushion shading across the midrib (left slightly lighter, right slightly shaded)
        const sideShade = 1 + (dx < 0 ? 0.055 : -0.055) * (1 - relAcross * 0.5)
        const microN = (tileValueNoise(u, v, 24, 24, 73) - 0.5) * 0.06
        let r = lerp(baseRgb[0], tipRgb[0], gradT) * sideShade + microN
        let g = lerp(baseRgb[1], tipRgb[1], gradT) * sideShade + microN
        let b = lerp(baseRgb[2], tipRgb[2], gradT) * sideShade + microN * 0.6
        const vMix = vein * veinStrength
        r = lerp(r, veinRgb[0], vMix * 0.55)
        g = lerp(g, veinRgb[1], vMix * 0.55)
        b = lerp(b, veinRgb[2], vMix * 0.55)
        rd[o] = clamp01(r)
        rd[o + 1] = clamp01(g)
        rd[o + 2] = clamp01(b)
        rd[o + 3] = alpha
        const cushion = Math.sqrt(Math.max(0, 1 - relAcross * relAcross)) * 0.45 + 0.3
        hd[idx] = clamp01((cushion + vMix * 0.28) * alpha)
      }
    }
  }
  return { rgba, height }
}

function evalFlowerBloom(p: Record<string, unknown>, w: number, h: number): Record<string, ImageBuffer> {
  const petalCount = Math.max(3, Math.min(14, Math.round(num(p, 'petalCount', 5))))
  const notchDepth = num(p, 'notchDepth', 0.26)
  const petalWidth = num(p, 'petalWidth', 0.78)
  const radius = num(p, 'radius', 0.43)
  const centerSize = num(p, 'centerSize', 0.12)
  const petalRgb = hexToRgb01(str(p, 'petalColor', '#ffd9e8'))
  const innerRgb = hexToRgb01(str(p, 'innerColor', '#e0648f'))
  const centerRgb = hexToRgb01(str(p, 'centerColor', '#f7c948'))
  const seed = Math.round(num(p, 'seed', 620))

  const rgba = makeRgba(w, h, 0, 0, 0, 0)
  const height = makeGray(w, h, 0)
  const rd = rgba.data, hd = height.data
  const aa = 2.0 / Math.min(w, h)
  const rotOffset = (hash2(seed, 3, 19) - 0.5) * 0.6

  for (let y = 0; y < h; y++) {
    const dy = y / h - 0.5
    const row = y * w
    for (let x = 0; x < w; x++) {
      const dx = x / w - 0.5
      const r = Math.hypot(dx, dy)
      const ang = Math.atan2(dy, dx) + rotOffset
      const idx = row + x
      const o = idx * 4

      // Sector angle within nearest petal [-PI/N, PI/N]
      const sector = (Math.PI * 2) / petalCount
      const localA = mod(ang + sector * 0.5, sector) - sector * 0.5
      const normA = Math.abs(localA) / (sector * 0.5) // 0 at petal center, 1 at gap

      const lobeCos = Math.cos(clamp01(normA / Math.max(0.2, petalWidth)) * Math.PI * 0.5)
      const baseEdge = radius * (0.22 + 0.78 * Math.pow(Math.max(0, lobeCos), 0.7))
      const notch = notchDepth * radius * 0.52 * Math.exp(-Math.pow(normA / 0.22, 2))
      const petalR = Math.max(centerSize * 0.85, baseEdge - notch)
      const petalAlpha = smoothstep(petalR + aa, petalR - aa, r)

      if (petalAlpha > 0.001) {
        const radialT = clamp01((r - centerSize * 0.6) / Math.max(0.05, radius - centerSize * 0.6))
        const rib = Math.pow(Math.max(0, 1 - normA * 2.2), 2) * 0.08
        let cr = lerp(innerRgb[0], petalRgb[0], Math.pow(radialT, 0.75)) + rib
        let cg = lerp(innerRgb[1], petalRgb[1], Math.pow(radialT, 0.75)) + rib * 0.85
        let cb = lerp(innerRgb[2], petalRgb[2], Math.pow(radialT, 0.75)) + rib * 0.9

        // Subtle dark petal overlap groove between petals
        const groove = smoothstep(0.75, 1.0, normA) * 0.12
        cr *= 1 - groove; cg *= 1 - groove; cb *= 1 - groove

        // Golden stamen center disc + ring dots
        const centerAlpha = smoothstep(centerSize + aa, centerSize - aa * 2, r)
        if (centerAlpha > 0.001) {
          const dotRing = Math.sin(ang * (petalCount * 3)) * 0.5 + 0.5
          const dotMask = smoothstep(0.6, 0.95, dotRing) * smoothstep(centerSize * 0.45, centerSize * 0.85, r)
          const dome = 0.78 + 0.25 * (1 - r / Math.max(0.01, centerSize)) + dotMask * 0.18
          cr = lerp(cr, clamp01(centerRgb[0] * dome), centerAlpha)
          cg = lerp(cg, clamp01(centerRgb[1] * dome), centerAlpha)
          cb = lerp(cb, clamp01(centerRgb[2] * dome), centerAlpha)
        }

        rd[o] = clamp01(cr)
        rd[o + 1] = clamp01(cg)
        rd[o + 2] = clamp01(cb)
        rd[o + 3] = petalAlpha

        const petalCup = (0.35 + 0.4 * Math.sin(radialT * Math.PI * 0.85) * (1 - normA * 0.45)) * petalAlpha
        const centerDome = centerAlpha * (0.75 + 0.25 * Math.sqrt(Math.max(0, 1 - Math.pow(r / Math.max(0.01, centerSize), 2))))
        hd[idx] = clamp01(Math.max(petalCup, centerDome))
      }
    }
  }
  return { rgba, height }
}

/** Draws an anti-aliased tapered quadratic bezier stem directly into RGBA + Height buffers. */
function drawStemCurve(
  rgba: RgbaBuffer,
  height: GrayBuffer,
  x0: number, y0: number, cx: number, cy: number, x1: number, y1: number,
  w0: number, w1: number,
  rgb: [number, number, number],
) {
  const w = rgba.width, h = rgba.height
  const rd = rgba.data, hd = height.data
  const steps = 42
  const aa = 1.6 / Math.min(w, h)
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const it = 1 - t
    const px = it * it * x0 + 2 * it * t * cx + t * t * x1
    const py = it * it * y0 + 2 * it * t * cy + t * t * y1
    const rad = lerp(w0, w1, t)
    if (rad <= 0.0005) continue
    const minX = Math.max(0, Math.floor((px - rad - aa) * w))
    const maxX = Math.min(w - 1, Math.ceil((px + rad + aa) * w))
    const minY = Math.max(0, Math.floor((py - rad - aa) * h))
    const maxY = Math.min(h - 1, Math.ceil((py + rad + aa) * h))
    for (let sy = minY; sy <= maxY; sy++) {
      const v = sy / h
      for (let sx = minX; sx <= maxX; sx++) {
        const u = sx / w
        const dist = Math.hypot(u - px, v - py)
        const a = smoothstep(rad + aa, rad - aa, dist)
        if (a <= 0.001) continue
        const shade = 0.72 + 0.35 * (1 - dist / Math.max(1e-4, rad))
        const idx = sy * w + sx
        const o = idx * 4
        const outA = a + rd[o + 3] * (1 - a)
        if (outA > 1e-5) {
          const inv = 1 / outA
          rd[o] = (rgb[0] * shade * a + rd[o] * rd[o + 3] * (1 - a)) * inv
          rd[o + 1] = (rgb[1] * shade * a + rd[o + 1] * rd[o + 3] * (1 - a)) * inv
          rd[o + 2] = (rgb[2] * shade * a + rd[o + 2] * rd[o + 3] * (1 - a)) * inv
          rd[o + 3] = outA
          hd[idx] = Math.max(hd[idx], a * 0.42 * shade)
        }
      }
    }
  }
}

interface StampSpec {
  x: number
  y: number
  angle: number
  scaleX: number
  scaleY: number
  depth: number // 0 = back, 1 = front
  lumMul: number
  hueJitter: number
}

/** Stamps a rotated/scaled leaf RGBA+Height sprite onto destination buffers with depth tinting. */
function compositeStamp(
  dstRgba: RgbaBuffer,
  dstHeight: GrayBuffer,
  srcRgba: RgbaBuffer,
  srcHeight: GrayBuffer,
  s: StampSpec,
  anchorY: number, // 0.92 for bottom-anchored leaf, 0.5 for center-anchored flower
  depthShade: number,
  wrap: boolean,
) {
  const w = dstRgba.width, h = dstRgba.height
  const rd = dstRgba.data, hd = dstHeight.data
  const ca = Math.cos(-s.angle), sa = Math.sin(-s.angle)
  const reach = Math.max(s.scaleX, s.scaleY) * 1.05
  const minX = Math.floor((s.x - reach) * w)
  const maxX = Math.ceil((s.x + reach) * w)
  const minY = Math.floor((s.y - reach) * h)
  const maxY = Math.ceil((s.y + reach) * h)
  const sample: [number, number, number, number] = [0, 0, 0, 0]
  const depthFactor = lerp(1 - depthShade, 1.08, s.depth) * s.lumMul
  const warmR = 1 + s.hueJitter * 0.14
  const warmG = 1 + s.hueJitter * 0.04
  const warmB = 1 - s.hueJitter * 0.12

  for (let py = minY; py <= maxY; py++) {
    if (!wrap && (py < 0 || py >= h)) continue
    const wy = wrap ? mod(py, h) : py
    const dy = py / h - s.y
    const row = wy * w
    for (let px = minX; px <= maxX; px++) {
      if (!wrap && (px < 0 || px >= w)) continue
      const wx = wrap ? mod(px, w) : px
      const dx = px / w - s.x
      // Inverse rotate into sprite local space
      const lx = (dx * ca - dy * sa) / Math.max(0.01, s.scaleX) + 0.5
      const ly = (dx * sa + dy * ca) / Math.max(0.01, s.scaleY) + anchorY
      if (lx < 0 || lx > 1 || ly < 0 || ly > 1) continue
      sampleRgbaBilinear(srcRgba, lx, ly, false, sample)
      const saVal = sample[3]
      if (saVal <= 0.004) continue
      const sr = clamp01(sample[0] * depthFactor * warmR)
      const sg = clamp01(sample[1] * depthFactor * warmG)
      const sb = clamp01(sample[2] * depthFactor * warmB)
      const idx = row + wx
      const o = idx * 4
      const dstA = rd[o + 3]
      const outA = saVal + dstA * (1 - saVal)
      if (outA > 1e-5) {
        const inv = 1 / outA
        // Soft contact AO cast onto already-painted underlying leaves (crisp depth separation)
        const underAo = 1 - saVal * lerp(0.16, 0.36, clamp01(depthShade))
        rd[o] = (sr * saVal + rd[o] * underAo * dstA * (1 - saVal)) * inv
        rd[o + 1] = (sg * saVal + rd[o + 1] * underAo * dstA * (1 - saVal)) * inv
        rd[o + 2] = (sb * saVal + rd[o + 2] * underAo * dstA * (1 - saVal)) * inv
        rd[o + 3] = outA
        const sh = sampleGrayBilinear(srcHeight, lx, ly, false)
        const stackedH = clamp01(lerp(0.25, 0.95, s.depth) * (0.45 + 0.55 * sh))
        hd[idx] = lerp(hd[idx], stackedH, saVal)
      }
    }
  }
}

function evalBranchScatter(
  p: Record<string, unknown>,
  inputs: Record<string, ImageBuffer | undefined>,
  w: number,
  h: number,
): Record<string, ImageBuffer> {
  const layout = str(p, 'layout', 'sprig')
  const legacy2x2 = bool(p, 'atlas2x2', false)
  const rawCols = p.atlasCols !== undefined ? num(p, 'atlasCols', 1) : (legacy2x2 ? 2 : 1)
  const rawRows = p.atlasRows !== undefined ? num(p, 'atlasRows', 1) : (legacy2x2 ? 2 : 1)
  const atlasCols = layout === 'tile' ? 1 : Math.max(1, Math.min(4, Math.round(rawCols)))
  const atlasRows = layout === 'tile' ? 1 : Math.max(1, Math.min(4, Math.round(rawRows)))

  // Fallback leaf sprite if nothing connected to leaf input
  let srcRgba: RgbaBuffer
  let srcHeight: GrayBuffer
  if (inputs.leaf) {
    srcRgba = toRgba(inputs.leaf, w, h)
    srcHeight = inputs.height ? toGray(inputs.height, w, h) : toGray(inputs.leaf, w, h)
  } else {
    const defLeaf = evalLeafShape(defaultParamsFor('leaf_shape'), w, h)
    srcRgba = defLeaf.rgba as RgbaBuffer
    srcHeight = defLeaf.height as GrayBuffer
  }

  // Detect whether sprite is center-anchored (like flower_bloom) or bottom-anchored (like leaf_shape)
  let topAlpha = 0, botAlpha = 0
  for (let y = 0; y < Math.floor(h * 0.25); y++) {
    for (let x = 0; x < w; x += 4) topAlpha += srcRgba.data[(y * w + x) * 4 + 3]
  }
  for (let y = Math.floor(h * 0.75); y < h; y++) {
    for (let x = 0; x < w; x += 4) botAlpha += srcRgba.data[(y * w + x) * 4 + 3]
  }
  const centerAnchored = Math.abs(topAlpha - botAlpha) / Math.max(1, topAlpha + botAlpha) < 0.25
  const anchorY = centerAnchored ? 0.5 : 0.90

  // Arbitrary N x M custom atlas grid (1x1 up to 4x4) with isolated cell rendering (zero cell bleed!)
  if (atlasCols > 1 || atlasRows > 1) {
    const dstRgba = makeRgba(w, h, 0, 0, 0, 0)
    const dstHeight = makeGray(w, h, 0)
    const baseSeed = Math.round(num(p, 'seed', 518))
    const cellBrights = [1.06, 0.80, 1.13, 0.92, 1.00, 0.86, 1.10, 0.95]
    let ci = 0
    for (let gy = 0; gy < atlasRows; gy++) {
      const y0 = Math.round((gy * h) / atlasRows)
      const y1 = Math.round(((gy + 1) * h) / atlasRows)
      const ch = Math.max(8, y1 - y0)
      for (let gx = 0; gx < atlasCols; gx++) {
        const x0 = Math.round((gx * w) / atlasCols)
        const x1 = Math.round(((gx + 1) * w) / atlasCols)
        const cw = Math.max(8, x1 - x0)
        const subParams: Record<string, unknown> = {
          ...p,
          atlasCols: 1,
          atlasRows: 1,
          atlas2x2: false,
          seed: baseSeed + ci * 197,
          leafScale: num(p, 'leafScale', 0.28) * 0.94,
          spread: num(p, 'spread', 0.88) * 0.92,
        }
        const cellRes = evalBranchScatterCell(subParams, srcRgba, srcHeight, anchorY, cw, ch, cellBrights[ci % cellBrights.length])
        const sr = cellRes.rgba.data
        const sh = cellRes.height.data
        for (let py = 0; py < ch; py++) {
          const dstRow = (y0 + py) * w
          const srcRow = py * cw
          for (let px = 0; px < cw; px++) {
            const si = srcRow + px
            const di = dstRow + (x0 + px)
            dstRgba.data[di * 4] = sr[si * 4]
            dstRgba.data[di * 4 + 1] = sr[si * 4 + 1]
            dstRgba.data[di * 4 + 2] = sr[si * 4 + 2]
            dstRgba.data[di * 4 + 3] = sr[si * 4 + 3]
            dstHeight.data[di] = sh[si]
          }
        }
        ci++
      }
    }
    return { rgba: dstRgba, height: dstHeight }
  }

  return evalBranchScatterCell(p, srcRgba, srcHeight, anchorY, w, h, 1.0)
}

function evalBranchScatterCell(
  p: Record<string, unknown>,
  srcRgba: RgbaBuffer,
  srcHeight: GrayBuffer,
  anchorY: number,
  w: number,
  h: number,
  cellBright: number,
): { rgba: RgbaBuffer; height: GrayBuffer } {
  const layout = str(p, 'layout', 'sprig')
  const stemCount = Math.max(1, Math.min(9, Math.round(num(p, 'stemCount', 5))))
  const leavesPerStem = Math.max(2, Math.min(18, Math.round(num(p, 'leavesPerStem', 7))))
  const leafScale = num(p, 'leafScale', 0.28)
  const scaleFalloff = num(p, 'scaleFalloff', 0.22)
  const spread = num(p, 'spread', 0.88)
  const arch = num(p, 'arch', 0.22)
  const rotJitter = num(p, 'rotJitter', 0.25)
  const colorVar = num(p, 'colorVar', 0.18)
  const depthShade = num(p, 'depthShade', 0.34)
  const stemWidth = num(p, 'stemWidth', 0.008)
  const stemRgb = hexToRgb01(str(p, 'stemColor', '#5c4632'))
  const budGlint = clamp01(num(p, 'budGlint', 0.45))
  const seed = Math.round(num(p, 'seed', 518))

  const dstRgba = makeRgba(w, h, 0, 0, 0, 0)
  const dstHeight = makeGray(w, h, 0)
  const r = rng(seed)
  const stamps: StampSpec[] = []
  const stemsToDraw: [number, number, number, number, number, number, number, number][] = []
  const budSpots: [number, number, number][] = []
  const wrap = layout === 'tile'

  if (layout === 'oak_rosette') {
    // Stylized Painterly Multi-Rosette Oak Foliage Clump
    const leavesPerRosette = Math.max(5, Math.min(8, leavesPerStem))
    const subCount = Math.max(4, Math.min(8, stemCount))
    const cx = 0.5, cy = 0.5, cellScale = 0.95
    const cr = r
    const rosettes: { rx: number; ry: number; depth: number; scale: number; warm: number; hasBud: boolean }[] = []
    const outerN = Math.max(5, subCount)
    for (let k = 0; k < outerN; k++) {
      const ang = (k / outerN) * Math.PI * 2 + 0.48 + (cr() - 0.5) * 0.28
      const dist = (0.24 + cr() * 0.06) * spread * cellScale
      rosettes.push({
        rx: cx + Math.cos(ang) * dist,
        ry: cy + Math.sin(ang) * dist,
        depth: 0.06 + cr() * 0.16,
        scale: leafScale * cellScale * (0.94 + cr() * 0.16),
        warm: -0.78 + cr() * 0.30,
        hasBud: k % 3 === 0,
      })
    }
    const midN = Math.max(4, Math.ceil(subCount * 0.8))
    for (let k = 0; k < midN; k++) {
      const ang = (k / midN) * Math.PI * 2 + 0.12 + (cr() - 0.5) * 0.35
      const dist = (0.14 + cr() * 0.06) * spread * cellScale
      rosettes.push({
        rx: cx + Math.cos(ang) * dist,
        ry: cy + Math.sin(ang) * dist,
        depth: 0.40 + cr() * 0.20,
        scale: leafScale * cellScale * (0.90 + cr() * 0.16),
        warm: -0.15 + cr() * 0.40,
        hasBud: k % 2 === 0,
      })
    }
    for (let k = 0; k < 2; k++) {
      const offA = k * Math.PI + 0.7 + (cr() - 0.5) * 0.5
      const offD = (0.04 + cr() * 0.04) * cellScale
      rosettes.push({
        rx: cx + Math.cos(offA) * offD,
        ry: cy + Math.sin(offA) * offD - 0.015 * cellScale,
        depth: 0.84 + k * 0.10,
        scale: leafScale * cellScale * (0.88 - k * 0.06 + cr() * 0.10),
        warm: 0.52 + cr() * 0.45,
        hasBud: k === 0,
      })
    }

    for (const ros of rosettes) {
      const baseRot = cr() * Math.PI * 2
      for (let i = 0; i < leavesPerRosette; i++) {
        const ang = baseRot + (i / leavesPerRosette) * Math.PI * 2 + (cr() - 0.5) * rotJitter * 0.38
        const sc = ros.scale * (0.84 + cr() * 0.28) * (1 - scaleFalloff * 0.14 * (i % 2))
        const radialOff = sc * 0.06
        stamps.push({
          x: ros.rx + Math.sin(ang) * radialOff,
          y: ros.ry - Math.cos(ang) * radialOff,
          angle: ang,
          scaleX: sc * 1.05,
          scaleY: sc * 1.08,
          depth: clamp01(ros.depth + (i / leavesPerRosette) * 0.07),
          lumMul: cellBright * (1 + (cr() - 0.5) * colorVar * 1.4),
          hueJitter: ros.warm + (cr() - 0.5) * 0.32,
        })
      }
      if (ros.hasBud && budGlint > 0.02 && ros.depth > 0.22 && ros.depth < 0.78) {
        budSpots.push([ros.rx, ros.ry, ros.scale * 0.062 * budGlint])
      }
    }
  } else if (layout === 'pine') {
    // Pine frond: stem at top center (0.5, 0.04), hanging downward to pointed tip at (0.5, 0.96)
    stemsToDraw.push([0.5, 0.02, 0.5 + arch * 0.08, 0.42, 0.5, 0.80, stemWidth * 1.4, stemWidth * 0.35])
    const profile = (s: number) => s <= 0.28 ? 0.14 + 0.86 * (s / 0.28) : s <= 0.70 ? 1 - 0.22 * ((s - 0.28) / 0.42) : 0.08 + 0.7 * (1 - (s - 0.70) / 0.30)
    const pairs = Math.max(4, leavesPerStem)
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < pairs; i++) {
        const s = 0.06 + 0.76 * (i + (pass ? 0.45 : 0.1)) / pairs
        const y0 = s
        const reach = 0.42 * spread * profile(s) * (0.9 + r() * 0.18)
        for (const side of [-1, 1]) {
          const ang = Math.PI - side * (0.55 + (1 - s) * 0.48) + (r() - 0.5) * rotJitter * 0.45
          const sc = leafScale * (0.85 + 0.35 * profile(s)) * (1 - s * scaleFalloff * 0.45)
          stamps.push({
            x: 0.5 + side * reach * 0.22,
            y: y0,
            angle: ang,
            scaleX: sc * 0.85,
            scaleY: sc * 1.35,
            depth: pass * 0.5 + (1 - s) * 0.3 + r() * 0.2,
            lumMul: 1 + (r() - 0.5) * colorVar * 2,
            hueJitter: (r() - 0.5) * 2,
          })
        }
      }
    }
    // Terminal hanging pine tip
    stamps.push({ x: 0.5, y: 0.62, angle: Math.PI, scaleX: leafScale * 0.85, scaleY: leafScale * 1.35, depth: 0.95, lumMul: 1.06, hueJitter: 0.2 })
  } else if (layout === 'willow') {
    // Willow drape curtain: arched shoulder at top, vertical strands hanging down
    const strands = Math.max(3, stemCount)
    for (let s = 0; s < strands; s++) {
      const f = strands === 1 ? 0 : (s / (strands - 1)) * 2 - 1 // -1..1
      const xStart = 0.5 + f * 0.32 * spread
      const yStart = 0.03 + Math.abs(f) * 0.14
      const len = 0.76 - Math.abs(f) * 0.16 + (r() - 0.5) * 0.08
      const cx = xStart + (f * 0.08 + arch * 0.12)
      const cy = yStart + len * 0.48
      const xEnd = xStart + f * 0.06 + arch * 0.08
      const yEnd = Math.min(0.97, yStart + len)
      stemsToDraw.push([xStart, yStart, cx, cy, xEnd, yEnd, stemWidth * 0.8, stemWidth * 0.25])
      for (let i = 0; i < leavesPerStem; i++) {
        const t = 0.08 + 0.88 * (i / Math.max(1, leavesPerStem - 1))
        const it = 1 - t
        const px = it * it * xStart + 2 * it * t * cx + t * t * xEnd
        const py = it * it * yStart + 2 * it * t * cy + t * t * yEnd
        const side = i % 2 === 0 ? -1 : 1
        const sc = leafScale * lerp(1.05, 1 - scaleFalloff, t) * (0.88 + r() * 0.24)
        stamps.push({
          x: px,
          y: py,
          angle: Math.PI + side * (0.28 + (r() - 0.5) * rotJitter * 0.5),
          scaleX: sc * 0.65,
          scaleY: sc * 1.25,
          depth: (s / strands) * 0.4 + t * 0.4 + r() * 0.2,
          lumMul: 1 + (r() - 0.5) * colorVar * 2,
          hueJitter: (r() - 0.5) * 2,
        })
      }
    }
  } else if (layout === 'rosette' || layout === 'cluster') {
    const rings = layout === 'rosette' ? 2 : 3
    const total = stemCount * leavesPerStem
    for (let i = 0; i < total; i++) {
      const u = i / Math.max(1, total - 1)
      const ring = i % rings
      const golden = i * 2.3999632 + seed * 0.1
      const rad = (layout === 'rosette' ? (0.14 + 0.24 * Math.sqrt(u)) : (0.04 + 0.34 * Math.sqrt(u))) * spread
      const px = 0.5 + Math.cos(golden) * rad
      const py = (layout === 'cluster' ? 0.54 : 0.50) + Math.sin(golden) * rad * (layout === 'cluster' ? 0.88 : 1.0)
      const outAng = Math.atan2(px - 0.5, -(py - 0.52))
      const ang = outAng + (r() - 0.5) * rotJitter * 1.8
      const sc = leafScale * lerp(1.05, 1 - scaleFalloff * 0.6, ring / rings) * (0.82 + r() * 0.36)
      stamps.push({
        x: px,
        y: py,
        angle: ang,
        scaleX: sc,
        scaleY: sc,
        depth: clamp01(1 - u * 0.55 + (r() - 0.5) * 0.35),
        lumMul: 1 + (r() - 0.5) * colorVar * 2,
        hueJitter: (r() - 0.5) * 2,
      })
    }
  } else if (layout === 'tile') {
    // Substance Tile Sampler: seamless periodic scatter across [0, 1)^2
    const total = Math.max(6, stemCount * leavesPerStem)
    for (let i = 0; i < total; i++) {
      const sc = leafScale * (1 - scaleFalloff * 0.5 + r() * Math.max(0.15, scaleFalloff))
      stamps.push({
        x: r(),
        y: r(),
        angle: (r() - 0.5) * Math.PI * 2 * Math.max(0.15, rotJitter),
        scaleX: sc,
        scaleY: sc,
        depth: i / total,
        lumMul: 1 + (r() - 0.5) * colorVar * 2,
        hueJitter: (r() - 0.5) * 2,
      })
    }
  } else {
    // Default 'sprig': bottom-centered petiole branching into upward fanning cluster
    for (let s = 0; s < stemCount; s++) {
      const f = stemCount === 1 ? 0 : (s / (stemCount - 1)) * 2 - 1 // -1..1
      const angle = f * 0.88 * spread
      const stemLen = (0.72 - Math.abs(f) * 0.16) * (0.9 + r() * 0.14)
      const x0 = 0.5, y0 = 0.95
      const x1 = clamp01(x0 + Math.sin(angle) * stemLen * 0.72)
      const y1 = clamp01(y0 - Math.cos(angle) * stemLen * 0.88)
      const cx = (x0 + x1) * 0.5 + Math.sin(angle) * arch * 0.16
      const cy = (y0 + y1) * 0.5 - Math.abs(arch) * 0.06
      stemsToDraw.push([x0, y0, cx, cy, x1, y1, stemWidth * (1.2 - Math.abs(f) * 0.3), stemWidth * 0.3])

      for (let i = 0; i < leavesPerStem; i++) {
        const t = 0.24 + 0.76 * (i / Math.max(1, leavesPerStem - 1))
        const it = 1 - t
        const px = it * it * x0 + 2 * it * t * cx + t * t * x1
        const py = it * it * y0 + 2 * it * t * cy + t * t * y1
        const side = i % 2 === 0 ? -1 : 1
        const isTip = i === leavesPerStem - 1
        const leafAng = isTip
          ? angle + (r() - 0.5) * rotJitter * 0.4
          : angle + side * (0.58 + (1 - t) * 0.42) + (r() - 0.5) * rotJitter * 0.65
        const sc = leafScale * lerp(1.08, 1 - scaleFalloff, t) * (0.86 + r() * 0.28)
        stamps.push({
          x: px,
          y: py,
          angle: leafAng,
          scaleX: sc,
          scaleY: sc,
          depth: clamp01(0.15 + (1 - Math.abs(f)) * 0.35 + t * 0.35 + (r() - 0.5) * 0.2),
          lumMul: 1 + (r() - 0.5) * colorVar * 2,
          hueJitter: (r() - 0.5) * 2,
        })
      }
    }
  }

  // Apply per-cell brightness variety for non-oak_rosette layouts when baking multi-cell N x M atlases
  if (layout !== 'oak_rosette' && cellBright !== 1) {
    for (const s of stamps) s.lumMul *= cellBright
  }
  // Paint back-most leaves first, draw stems in mid-layer, then front leaves for authentic depth
  stamps.sort((a, b) => a.depth - b.depth)
  const mid = Math.floor(stamps.length * 0.42)
  for (let i = 0; i < mid; i++) {
    compositeStamp(dstRgba, dstHeight, srcRgba, srcHeight, stamps[i], anchorY, depthShade, wrap)
  }
  if (stemWidth > 0.0005 && stemsToDraw.length > 0) {
    for (const seg of stemsToDraw) {
      drawStemCurve(dstRgba, dstHeight, seg[0], seg[1], seg[2], seg[3], seg[4], seg[5], seg[6], seg[7], stemRgb)
    }
  }
  for (let i = mid; i < stamps.length; i++) {
    compositeStamp(dstRgba, dstHeight, srcRgba, srcHeight, stamps[i], anchorY, depthShade, wrap)
  }
  // Subtle crisp pale cream leaf-bud glint right at the heart of oak rosettes (signature painterly accent!)
  if (budSpots.length > 0) {
    const rd = dstRgba.data
    const aa = 1.6 / Math.min(w, h)
    for (const [bx, by, br] of budSpots) {
      const minX = Math.max(0, Math.floor((bx - br * 1.8) * w))
      const maxX = Math.min(w - 1, Math.ceil((bx + br * 1.8) * w))
      const minY = Math.max(0, Math.floor((by - br * 1.8) * h))
      const maxY = Math.min(h - 1, Math.ceil((by + br * 1.8) * h))
      for (let py = minY; py <= maxY; py++) {
        const dy = py / h - by
        for (let px = minX; px <= maxX; px++) {
          const dx = px / w - bx
          const dist = Math.hypot(dx, dy)
          const ang = Math.atan2(dy, dx)
          const star = br * (0.55 + 0.55 * Math.pow(Math.abs(Math.cos(ang * 2.5)), 2))
          const a = smoothstep(star + aa, star * 0.25, dist) * 0.78
          if (a <= 0.01) continue
          const o = (py * w + px) * 4
          if (rd[o + 3] < 0.2) continue
          rd[o] = lerp(rd[o], 0.94, a)
          rd[o + 1] = lerp(rd[o + 1], 0.96, a)
          rd[o + 2] = lerp(rd[o + 2], 0.88, a)
        }
      }
    }
  }
  return { rgba: dstRgba, height: dstHeight }
}

/** Edge-preserving anisotropic directional brushstroke + painterly value-facet filter. */
function evalStylizePaint(
  p: Record<string, unknown>,
  inputs: Record<string, ImageBuffer | undefined>,
  w: number,
  h: number,
  seamless: boolean,
): Record<string, ImageBuffer> {
  const src = toRgba(inputs.input, w, h)
  const brushLen = Math.max(1, num(p, 'brushLength', 5)) * (w / 256)
  const angle = (num(p, 'angle', 90) * Math.PI) / 180
  const levels = Math.max(3, Math.min(16, Math.round(num(p, 'levels', 7))))
  const softness = clamp01(num(p, 'softness', 0.45))
  const crisp = clamp01(num(p, 'crispEdges', 0.35))

  const dxStep = Math.cos(angle)
  const dyStep = Math.sin(angle)
  const taps = Math.max(2, Math.min(7, Math.round(brushLen * 0.85)))
  const out = makeRgba(w, h, 0, 0, 0, 0)
  const sd = src.data, od = out.data

  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      const o0 = (row + x) * 4
      const a0 = sd[o0 + 3]
      if (a0 <= 0.002) continue
      const r0 = sd[o0], g0 = sd[o0 + 1], b0 = sd[o0 + 2]
      const l0 = 0.299 * r0 + 0.587 * g0 + 0.114 * b0

      let sr = r0, sg = g0, sb = b0, sw = 1
      for (let t = -taps; t <= taps; t++) {
        if (t === 0) continue
        const f = (t / taps) * brushLen
        const sx = Math.round(x + dxStep * f)
        const sy = Math.round(y + dyStep * f)
        const wx = seamless ? mod(sx, w) : Math.max(0, Math.min(w - 1, sx))
        const wy = seamless ? mod(sy, h) : Math.max(0, Math.min(h - 1, sy))
        const o = (wy * w + wx) * 4
        const sa = sd[o + 3]
        if (sa <= 0.05) continue
        const l = 0.299 * sd[o] + 0.587 * sd[o + 1] + 0.114 * sd[o + 2]
        // Bilateral color-similarity weight keeps painted plane boundaries razor crisp!
        const dl = Math.abs(l - l0)
        const wColor = Math.exp(-dl * dl * (18 + crisp * 38))
        const wSpatial = 1 - Math.abs(t) / (taps + 1.5)
        const wt = wColor * wSpatial * sa
        sr += sd[o] * wt; sg += sd[o + 1] * wt; sb += sd[o + 2] * wt; sw += wt
      }
      let r = sr / sw, g = sg / sw, b = sb / sw
      // Soft painterly tone-step grouping on luminance (preserves hue cleanly!)
      const lum = Math.max(1e-4, 0.299 * r + 0.587 * g + 0.114 * b)
      const qVal = lum * levels
      const qBase = Math.floor(qVal)
      const qFrac = qVal - qBase
      const smoothFrac = smoothstep(0.5 - softness * 0.45, 0.5 + softness * 0.45, qFrac)
      const targetLum = (qBase + smoothFrac) / levels
      const ratio = lerp(1, targetLum / lum, 1 - softness * 0.55)
      od[o0] = clamp01(r * ratio)
      od[o0 + 1] = clamp01(g * ratio)
      od[o0 + 2] = clamp01(b * ratio)
      od[o0 + 3] = a0
    }
  }
  return { out }
}

function evalWarp(
  p: Record<string, unknown>,
  inputs: Record<string, ImageBuffer | undefined>,
  w: number,
  h: number,
  seamless: boolean,
): Record<string, ImageBuffer> {
  const src = toRgba(inputs.input, w, h)
  const field = toGray(inputs.warp, w, h, 0.5)
  const intensity = num(p, 'intensity', 0.06)
  const angle = (num(p, 'angle', 0) * Math.PI) / 180
  const directional = bool(p, 'directional', false)
  const ca = Math.cos(angle), sa = Math.sin(angle)
  const out = makeRgba(w, h, 0, 0, 0, 0)
  const d = out.data, fd = field.data
  const sample: [number, number, number, number] = [0, 0, 0, 0]

  for (let y = 0; y < h; y++) {
    const ym = seamless ? mod(y - 1, h) : Math.max(0, y - 1)
    const yp = seamless ? mod(y + 1, h) : Math.min(h - 1, y + 1)
    const v = y / h
    const row = y * w
    for (let x = 0; x < w; x++) {
      const xm = seamless ? mod(x - 1, w) : Math.max(0, x - 1)
      const xp = seamless ? mod(x + 1, w) : Math.min(w - 1, x + 1)
      const u = x / w
      let du = 0, dv = 0
      if (directional) {
        const s = (fd[row + x] - 0.5) * 2 * intensity
        du = s * ca
        dv = s * sa
      } else {
        const gx = (fd[row + xp] - fd[row + xm]) * 6
        const gy = (fd[yp * w + x] - fd[ym * w + x]) * 6
        du = (gx * ca - gy * sa) * intensity
        dv = (gx * sa + gy * ca) * intensity
      }
      sampleRgbaBilinear(src, u + du, v + dv, seamless, sample)
      const o = (row + x) * 4
      d[o] = sample[0]; d[o + 1] = sample[1]; d[o + 2] = sample[2]; d[o + 3] = sample[3]
    }
  }
  return { out }
}

function evalSlopeBlur(
  p: Record<string, unknown>,
  inputs: Record<string, ImageBuffer | undefined>,
  w: number,
  h: number,
  seamless: boolean,
): Record<string, ImageBuffer> {
  const src = toGray(inputs.input, w, h, 0.5)
  const slope = toGray(inputs.slope, w, h, 0.5)
  const intensity = num(p, 'intensity', 0.036)
  const samples = Math.max(2, Math.min(12, Math.round(num(p, 'samples', 6))))
  const mode = str(p, 'mode', 'min')
  const out = makeGray(w, h)
  const d = out.data, sd = slope.data
  const stepSize = intensity / samples

  for (let y = 0; y < h; y++) {
    const v0 = y / h
    const row = y * w
    for (let x = 0; x < w; x++) {
      let u = x / w, v = v0
      let acc = src.data[row + x]
      let sum = acc
      for (let s = 1; s <= samples; s++) {
        const ix = seamless ? mod(Math.round(u * w), w) : Math.max(0, Math.min(w - 1, Math.round(u * w)))
        const iy = seamless ? mod(Math.round(v * h), h) : Math.max(0, Math.min(h - 1, Math.round(v * h)))
        const xm = seamless ? mod(ix - 1, w) : Math.max(0, ix - 1)
        const xp = seamless ? mod(ix + 1, w) : Math.min(w - 1, ix + 1)
        const ym = seamless ? mod(iy - 1, h) : Math.max(0, iy - 1)
        const yp = seamless ? mod(iy + 1, h) : Math.min(h - 1, iy + 1)
        const gx = (sd[iy * w + xp] - sd[iy * w + xm]) * 18
        const gy = (sd[yp * w + ix] - sd[ym * w + ix]) * 18
        u += gx * stepSize
        v += gy * stepSize
        const val = sampleGrayBilinear(src, u, v, seamless)
        if (mode === 'min') acc = Math.min(acc, val)
        else if (mode === 'max') acc = Math.max(acc, val)
        else sum += val
      }
      d[row + x] = mode === 'blur' ? sum / (samples + 1) : acc
    }
  }
  return { out }
}

function evalBlur(
  p: Record<string, unknown>,
  inputs: Record<string, ImageBuffer | undefined>,
  w: number,
  h: number,
  seamless: boolean,
): Record<string, ImageBuffer> {
  const src = toRgba(inputs.input, w, h)
  const radius = Math.max(0, Math.min(18, num(p, 'radius', 2.5)))
  const rInt = Math.max(0, Math.round((radius * w) / 256))
  if (rInt < 1) return { out: src }

  const tmp = makeRgba(w, h, 0, 0, 0, 0)
  const out = makeRgba(w, h, 0, 0, 0, 0)
  const kSize = rInt * 2 + 1
  const weights = new Float32Array(kSize)
  const sigma = Math.max(0.5, rInt * 0.5)
  let wSum = 0
  for (let i = -rInt; i <= rInt; i++) {
    const wt = Math.exp(-(i * i) / (2 * sigma * sigma))
    weights[i + rInt] = wt
    wSum += wt
  }
  for (let i = 0; i < kSize; i++) weights[i] /= wSum

  const sd = src.data, td = tmp.data, od = out.data
  // Horizontal pass
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let c0 = 0, c1 = 0, c2 = 0, c3 = 0
      for (let k = -rInt; k <= rInt; k++) {
        const sx = seamless ? mod(x + k, w) : Math.max(0, Math.min(w - 1, x + k))
        const wt = weights[k + rInt]
        const o = (row + sx) * 4
        c0 += sd[o] * wt; c1 += sd[o + 1] * wt; c2 += sd[o + 2] * wt; c3 += sd[o + 3] * wt
      }
      const dstO = (row + x) * 4
      td[dstO] = c0; td[dstO + 1] = c1; td[dstO + 2] = c2; td[dstO + 3] = c3
    }
  }
  // Vertical pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let c0 = 0, c1 = 0, c2 = 0, c3 = 0
      for (let k = -rInt; k <= rInt; k++) {
        const sy = seamless ? mod(y + k, h) : Math.max(0, Math.min(h - 1, y + k))
        const wt = weights[k + rInt]
        const o = (sy * w + x) * 4
        c0 += td[o] * wt; c1 += td[o + 1] * wt; c2 += td[o + 2] * wt; c3 += td[o + 3] * wt
      }
      const dstO = (y * w + x) * 4
      od[dstO] = c0; od[dstO + 1] = c1; od[dstO + 2] = c2; od[dstO + 3] = c3
    }
  }
  return { out }
}

function evalTransform2D(
  p: Record<string, unknown>,
  inputs: Record<string, ImageBuffer | undefined>,
  w: number,
  h: number,
): Record<string, ImageBuffer> {
  const src = toRgba(inputs.input, w, h)
  const ox = num(p, 'offsetX', 0)
  const oy = num(p, 'offsetY', 0)
  const sx = Math.max(0.05, num(p, 'scaleX', 1))
  const sy = Math.max(0.05, num(p, 'scaleY', 1))
  const rot = (-num(p, 'rotate', 0) * Math.PI) / 180
  const tile = bool(p, 'tile', true)
  const ca = Math.cos(rot), sa = Math.sin(rot)
  const out = makeRgba(w, h, 0, 0, 0, 0)
  const d = out.data
  const sample: [number, number, number, number] = [0, 0, 0, 0]
  for (let y = 0; y < h; y++) {
    const v = y / h - 0.5 - oy
    const row = y * w
    for (let x = 0; x < w; x++) {
      const u = x / w - 0.5 - ox
      const ru = (u * ca - v * sa) * sx + 0.5
      const rv = (u * sa + v * ca) * sy + 0.5
      sampleRgbaBilinear(src, ru, rv, tile, sample)
      const o = (row + x) * 4
      d[o] = sample[0]; d[o + 1] = sample[1]; d[o + 2] = sample[2]; d[o + 3] = sample[3]
    }
  }
  return { out }
}

function evalLevels(
  p: Record<string, unknown>,
  inputs: Record<string, ImageBuffer | undefined>,
  w: number,
  h: number,
): Record<string, ImageBuffer> {
  const src = toGray(inputs.input, w, h, 0.5)
  const inLow = num(p, 'inLow', 0.08)
  const inHigh = Math.max(inLow + 0.005, num(p, 'inHigh', 0.92))
  const gamma = Math.max(0.1, num(p, 'gamma', 1.0))
  const outLow = num(p, 'outLow', 0)
  const outHigh = num(p, 'outHigh', 1)
  const invert = bool(p, 'invert', false)
  const invGamma = 1 / gamma
  const out = makeGray(w, h)
  const sd = src.data, dd = out.data
  for (let i = 0; i < sd.length; i++) {
    let v = clamp01((sd[i] - inLow) / (inHigh - inLow))
    v = Math.pow(v, invGamma)
    if (invert) v = 1 - v
    dd[i] = clamp01(lerp(outLow, outHigh, v))
  }
  return { out }
}

function evalGradientMap(
  p: Record<string, unknown>,
  inputs: Record<string, ImageBuffer | undefined>,
  w: number,
  h: number,
): Record<string, ImageBuffer> {
  const src = toGray(inputs.input, w, h, 0.5)
  const rawStops = Array.isArray(p.stops) && p.stops.length >= 2
    ? (p.stops as GradientStop[])
    : defaultBarkGradient
  const stops = [...rawStops]
    .map(s => ({ pos: clamp01(typeof s.pos === 'number' ? s.pos : 0), rgb: hexToRgb01(s.color) }))
    .sort((a, b) => a.pos - b.pos)

  // Build 256-entry LUT for ultra-fast color lookup
  const lut = new Float32Array(256 * 3)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let s0 = stops[0], s1 = stops[stops.length - 1]
    for (let k = 0; k < stops.length - 1; k++) {
      if (t >= stops[k].pos && t <= stops[k + 1].pos) {
        s0 = stops[k]; s1 = stops[k + 1]; break
      }
    }
    const f = s1.pos > s0.pos ? clamp01((t - s0.pos) / (s1.pos - s0.pos)) : 0
    lut[i * 3] = lerp(s0.rgb[0], s1.rgb[0], f)
    lut[i * 3 + 1] = lerp(s0.rgb[1], s1.rgb[1], f)
    lut[i * 3 + 2] = lerp(s0.rgb[2], s1.rgb[2], f)
  }

  const out = makeRgba(w, h, 0, 0, 0, 1)
  const sd = src.data, dd = out.data
  for (let i = 0, j = 0; i < sd.length; i++, j += 4) {
    const idx = Math.min(255, Math.max(0, Math.round(clamp01(sd[i]) * 255))) * 3
    dd[j] = lut[idx]
    dd[j + 1] = lut[idx + 1]
    dd[j + 2] = lut[idx + 2]
    dd[j + 3] = 1
  }
  return { out }
}

function evalHslAdjust(
  p: Record<string, unknown>,
  inputs: Record<string, ImageBuffer | undefined>,
  w: number,
  h: number,
): Record<string, ImageBuffer> {
  const src = toRgba(inputs.input, w, h)
  const hueShift = num(p, 'hue', 0) / 360
  const satMul = num(p, 'saturation', 1)
  const lightAdd = num(p, 'lightness', 0)
  const contrast = num(p, 'contrast', 1)
  const out = makeRgba(w, h, 0, 0, 0, 0)
  const sd = src.data, dd = out.data
  for (let i = 0; i < sd.length; i += 4) {
    const a = sd[i + 3]
    if (a <= 0.0005) continue
    const [hh, ss, ll] = rgbToHsl(sd[i], sd[i + 1], sd[i + 2])
    const [r, g, b] = hslToRgb(hh + hueShift, clamp01(ss * satMul), clamp01(ll + lightAdd))
    dd[i] = clamp01((r - 0.5) * contrast + 0.5)
    dd[i + 1] = clamp01((g - 0.5) * contrast + 0.5)
    dd[i + 2] = clamp01((b - 0.5) * contrast + 0.5)
    dd[i + 3] = a
  }
  return { out }
}

function evalEdgeMask(
  p: Record<string, unknown>,
  inputs: Record<string, ImageBuffer | undefined>,
  w: number,
  h: number,
): Record<string, ImageBuffer> {
  const src = toRgba(inputs.input, w, h)
  const widthPx = Math.max(1, Math.round((num(p, 'width', 3) * w) / 256))
  const tintStrength = clamp01(num(p, 'tintStrength', 0.32))
  const edgeRgb = hexToRgb01(str(p, 'edgeColor', '#f6ffaa'))
  const alphaClip = clamp01(num(p, 'alphaClip', 0))

  const rgba = makeRgba(w, h, 0, 0, 0, 0)
  const mask = makeGray(w, h, 0)
  const sd = src.data, dd = rgba.data, md = mask.data

  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      const idx = row + x
      const o = idx * 4
      const a0 = sd[o + 3]
      if (a0 <= 0.01) continue
      // Find minimum alpha in neighborhood ring to detect silhouette boundary
      let minA = a0
      const offsets: [number, number][] = [
        [-widthPx, 0], [widthPx, 0], [0, -widthPx], [0, widthPx],
        [-widthPx, -widthPx], [widthPx, -widthPx], [-widthPx, widthPx], [widthPx, widthPx],
      ]
      for (const [dx, dy] of offsets) {
        const nx = x + dx, ny = y + dy
        const na = (nx < 0 || nx >= w || ny < 0 || ny >= h) ? 0 : sd[(ny * w + nx) * 4 + 3]
        if (na < minA) minA = na
      }
      const edge = clamp01((a0 - minA) * 1.4)
      md[idx] = edge
      const aOut = alphaClip > 0.001 ? smoothstep(alphaClip, Math.min(1, alphaClip + 0.15), a0) : a0
      const mixAmt = edge * tintStrength
      dd[o] = lerp(sd[o], edgeRgb[0], mixAmt)
      dd[o + 1] = lerp(sd[o + 1], edgeRgb[1], mixAmt)
      dd[o + 2] = lerp(sd[o + 2], edgeRgb[2], mixAmt)
      dd[o + 3] = aOut
    }
  }
  return { rgba, mask }
}

function evalBlend(
  p: Record<string, unknown>,
  inputs: Record<string, ImageBuffer | undefined>,
  w: number,
  h: number,
): Record<string, ImageBuffer> {
  const base = toRgba(inputs.base, w, h, 1)
  const over = toRgba(inputs.overlay, w, h, 1)
  const mask = inputs.mask ? toGray(inputs.mask, w, h, 1) : undefined
  const mode = str(p, 'mode', 'normal')
  const opacity = clamp01(num(p, 'opacity', 0.75))
  const out = makeRgba(w, h, 0, 0, 0, 0)
  const bd = base.data, od = over.data, dd = out.data, md = mask?.data

  const blendChan = (b: number, o: number) => {
    switch (mode) {
      case 'multiply': return b * o
      case 'screen': return 1 - (1 - b) * (1 - o)
      case 'overlay': return b < 0.5 ? 2 * b * o : 1 - 2 * (1 - b) * (1 - o)
      case 'add': return clamp01(b + o)
      case 'subtract': return clamp01(b - o)
      case 'max': return Math.max(b, o)
      case 'min': return Math.min(b, o)
      default: return o
    }
  }

  for (let i = 0, pIdx = 0; i < dd.length; i += 4, pIdx++) {
    const m = md ? clamp01(md[pIdx]) : 1
    const ba = bd[i + 3], oa = od[i + 3]
    const eff = opacity * m * oa
    if (mode === 'normal') {
      const outA = eff + ba * (1 - eff)
      if (outA > 1e-5) {
        const inv = 1 / outA
        dd[i] = (od[i] * eff + bd[i] * ba * (1 - eff)) * inv
        dd[i + 1] = (od[i + 1] * eff + bd[i + 1] * ba * (1 - eff)) * inv
        dd[i + 2] = (od[i + 2] * eff + bd[i + 2] * ba * (1 - eff)) * inv
        dd[i + 3] = outA
      }
    } else {
      dd[i] = lerp(bd[i], blendChan(bd[i], od[i]), eff)
      dd[i + 1] = lerp(bd[i + 1], blendChan(bd[i + 1], od[i + 1]), eff)
      dd[i + 2] = lerp(bd[i + 2], blendChan(bd[i + 2], od[i + 2]), eff)
      dd[i + 3] = Math.max(ba, eff)
    }
  }
  return { out }
}

/** Synthesizes tangent-space OpenGL Normal Map RGBA from grayscale height buffer using Sobel operator. */
export function heightToNormal(height: GrayBuffer, strength: number, seamless: boolean): RgbaBuffer {
  const w = height.width, h = height.height
  const out = makeRgba(w, h, 0.5, 0.5, 1, 1)
  const sd = height.data, dd = out.data
  const at = (x: number, y: number) => {
    const ix = seamless ? mod(x, w) : Math.max(0, Math.min(w - 1, x))
    const iy = seamless ? mod(y, h) : Math.max(0, Math.min(h - 1, y))
    return sd[iy * w + ix]
  }
  const scale = strength * (w / 256)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1)
      const l = at(x - 1, y), r = at(x + 1, y)
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1)
      const dx = (tr + 2 * r + br - tl - 2 * l - bl) * scale
      const dy = (bl + 2 * b + br - tl - 2 * t - tr) * scale
      const nx = -dx, ny = dy, nz = 1
      const invLen = 1 / Math.hypot(nx, ny, nz)
      const o = (row + x) * 4
      dd[o] = nx * invLen * 0.5 + 0.5
      dd[o + 1] = ny * invLen * 0.5 + 0.5
      dd[o + 2] = nz * invLen * 0.5 + 0.5
      dd[o + 3] = 1
    }
  }
  return out
}

// ---- Graph Topological Sort & Bounded Multi-Res LRU Memoized Evaluator -----
export interface EvalCacheEntry {
  sig: string
  bytes: number
  outputs: Record<string, ImageBuffer>
}

export interface EvaluateGraphOptions {
  /** Skip Sobel Normal & Roughness derivation for ultra-fast interactive/optimizer loops. */
  skipPbrMaps?: boolean
}

function estimateOutputsBytes(outputs: Record<string, ImageBuffer>): number {
  let total = 0
  for (const buf of Object.values(outputs)) {
    total += buf.data.byteLength
  }
  return total
}

const MAX_CACHE_BYTES = 48 * 1024 * 1024 // 48 MiB cap prevents 1024px multi-res memory bloat

export class TextureGraphEvaluator {
  private cache = new Map<string, EvalCacheEntry>()
  private cacheBytes = 0

  clear() {
    this.cache.clear()
    this.cacheBytes = 0
  }

  get cachedBytes(): number {
    return this.cacheBytes
  }

  private setCache(key: string, entry: EvalCacheEntry) {
    const prev = this.cache.get(key)
    if (prev) {
      this.cacheBytes -= prev.bytes
      this.cache.delete(key)
    }
    this.cache.set(key, entry)
    this.cacheBytes += entry.bytes
    // LRU eviction (Map preserves insertion order; delete oldest entries until under budget)
    for (const [oldKey, oldEntry] of this.cache) {
      if (this.cacheBytes <= MAX_CACHE_BYTES) break
      if (oldKey === key) continue
      this.cache.delete(oldKey)
      this.cacheBytes -= oldEntry.bytes
    }
  }

  evaluate(graph: TextureGraph, resolution?: number, options: EvaluateGraphOptions = {}): GraphEvalResult {
    const started = performance.now()
    const size = resolution ?? graph.resolution ?? 512

    const nodeMap = new Map<string, GraphNode>(graph.nodes.map(n => [n.id, n]))
    // Build topological order (Kahn's algorithm)
    const inDeg = new Map<string, number>()
    const children = new Map<string, string[]>()
    const incomingByNode = new Map<string, Map<string, { fromNode: string; fromPort: string }>>()

    for (const n of graph.nodes) {
      inDeg.set(n.id, 0)
      children.set(n.id, [])
      incomingByNode.set(n.id, new Map())
    }
    for (const e of graph.edges) {
      if (!nodeMap.has(e.fromNode) || !nodeMap.has(e.toNode)) continue
      incomingByNode.get(e.toNode)!.set(e.toPort, { fromNode: e.fromNode, fromPort: e.fromPort })
      children.get(e.fromNode)!.push(e.toNode)
      inDeg.set(e.toNode, (inDeg.get(e.toNode) ?? 0) + 1)
    }

    const queue: string[] = []
    for (const [id, deg] of inDeg) if (deg === 0) queue.push(id)
    const order: string[] = []
    while (queue.length) {
      const id = queue.shift()!
      order.push(id)
      for (const ch of children.get(id) ?? []) {
        const next = (inDeg.get(ch) ?? 1) - 1
        inDeg.set(ch, next)
        if (next === 0) queue.push(ch)
      }
    }
    // Include any disconnected / remaining nodes safely
    for (const n of graph.nodes) if (!order.includes(n.id)) order.push(n.id)

    const nodeOutputs = new Map<string, Record<string, ImageBuffer>>()
    const nodeSigs = new Map<string, string>()
    const nodeTimings: Record<string, number> = {}
    let cacheHits = 0
    let cacheMisses = 0

    for (const id of order) {
      const node = nodeMap.get(id)!
      const inc = incomingByNode.get(id)!
      const inputSigs: string[] = []
      const inputs: Record<string, ImageBuffer | undefined> = {}
      const def = nodeDefinitions[node.type]
      for (const port of def.inputs) {
        const wire = inc.get(port.id)
        if (wire) {
          const fromOut = nodeOutputs.get(wire.fromNode)
          inputs[port.id] = fromOut?.[wire.fromPort]
          inputSigs.push(`${port.id}=${nodeSigs.get(wire.fromNode) ?? ''}:${wire.fromPort}`)
        } else {
          inputSigs.push(`${port.id}=none`)
        }
      }
      const bypassFlag = node.bypass && node.type !== 'output_material' ? 1 : 0
      const sig = `${node.type}|${size}|${graph.seamless ? 1 : 0}|b${bypassFlag}|${JSON.stringify(node.params)}|${inputSigs.join(',')}`
      nodeSigs.set(id, sig)

      const cacheKey = `${id}@${size}`
      const cached = this.cache.get(cacheKey)
      if (cached && cached.sig === sig) {
        // Touch for LRU recency
        this.cache.delete(cacheKey)
        this.cache.set(cacheKey, cached)
        nodeOutputs.set(id, cached.outputs)
        nodeTimings[id] = 0
        cacheHits++
        continue
      }

      const tNode = performance.now()
      const out = bypassFlag
        ? this.evalBypassNode(node, inputs, size, size)
        : this.evalNode(node, inputs, size, size, graph.seamless)
      nodeTimings[id] = performance.now() - tNode
      cacheMisses++
      this.setCache(cacheKey, { sig, bytes: estimateOutputsBytes(out), outputs: out })
      nodeOutputs.set(id, out)
    }

    // Prune cache entries from deleted nodes across all resolutions
    for (const [k, entry] of [...this.cache.entries()]) {
      const nodeId = k.slice(0, k.lastIndexOf('@'))
      if (!nodeMap.has(nodeId)) {
        this.cache.delete(k)
        this.cacheBytes -= entry.bytes
      }
    }

    const outNode = graph.nodes.find(n => n.type === 'output_material')
    const output = this.buildMaterialOutput(
      outNode,
      outNode ? incomingByNode.get(outNode.id)! : new Map(),
      nodeOutputs,
      size,
      graph.seamless,
      Boolean(options.skipPbrMaps),
    )
    if (outNode) {
      nodeOutputs.set(outNode.id, {
        baseColor: output.baseColor,
        height: output.heightMap,
        normal: output.normal,
        roughness: output.roughness,
      })
    }

    return {
      width: size,
      height: size,
      nodeOutputs,
      output,
      evalMs: performance.now() - started,
      nodeTimings,
      cacheHits,
      cacheMisses,
    }
  }

  /** Clean, port-type-safe passthrough when a node has `bypass: true`. */
  private evalBypassNode(
    node: GraphNode,
    inputs: Record<string, ImageBuffer | undefined>,
    w: number,
    h: number,
  ): Record<string, ImageBuffer> {
    const def = nodeDefinitions[node.type]
    const primaryIn = inputs.input ?? inputs.base ?? inputs.height ?? inputs.leafA ?? inputs.slotA ?? inputs.leaf
    const out: Record<string, ImageBuffer> = {}
    for (const port of def.outputs) {
      if (port.type === 'label') {
        out[port.id] = inputs.label?.kind === 'label'
          ? inputs.label
          : { kind: 'label', width: w, height: h, data: new Int32Array(w * h) }
      } else if (port.type === 'gray') {
        const samePortIn = inputs[port.id]
        out[port.id] = toGray(samePortIn ?? primaryIn, w, h, port.id === 'ao' ? 1 : 0.5)
      } else {
        out[port.id] = toRgba(primaryIn, w, h, 0)
      }
    }
    return out
  }

  private evalNode(
    node: GraphNode,
    inputs: Record<string, ImageBuffer | undefined>,
    w: number,
    h: number,
    seamless: boolean,
  ): Record<string, ImageBuffer> {
    const p = node.params
    switch (node.type) {
      case 'perlin_noise': return evalPerlinNoise(p, w, h)
      case 'bark_fibers': return evalBarkFibers(p, w, h)
      case 'painterly_bark': return evalPainterlyBark(p, w, h)
      case 'cells_voronoi': return evalCellsVoronoi(p, w, h)
      case 'lenticels': return evalLenticels(p, w, h)
      case 'gradient_linear': return evalGradientLinear(p, w, h)
      case 'leaf_shape': return evalLeafShape(p, w, h)
      case 'custom_leaf': return evalCustomLeaf(p, w, h)
      case 'branch_scatter': return evalBranchScatter(p, inputs, w, h)
      case 'vector_layout': return evalVectorLayout(p, inputs, w, h)
      case 'atlas_compose': return evalAtlasCompose(p, inputs, w, h)
      case 'flower_bloom': return evalFlowerBloom(p, w, h)
      case 'warp': return evalWarp(p, inputs, w, h, seamless)
      case 'stylize_paint': return evalStylizePaint(p, inputs, w, h, seamless)
      case 'slope_blur': return evalSlopeBlur(p, inputs, w, h, seamless)
      case 'ink_outline': return evalInkOutline(p, inputs, w, h, seamless)
      case 'curvature_ao': return evalCurvatureAo(p, inputs, w, h, seamless)
      case 'blur': return evalBlur(p, inputs, w, h, seamless)
      case 'transform_2d': return evalTransform2D(p, inputs, w, h)
      case 'levels': return evalLevels(p, inputs, w, h)
      case 'curves_lut': return evalCurvesLut(p, inputs, w, h)
      case 'gradient_map': return evalGradientMap(p, inputs, w, h)
      case 'palette_map': return evalPaletteMap(p, inputs, w, h)
      case 'hsl_adjust': return evalHslAdjust(p, inputs, w, h)
      case 'edge_mask': return evalEdgeMask(p, inputs, w, h)
      case 'blend': return evalBlend(p, inputs, w, h)
      case 'output_material': return {}
    }
  }

  private buildMaterialOutput(
    outNode: GraphNode | undefined,
    inc: Map<string, { fromNode: string; fromPort: string }>,
    nodeOutputs: Map<string, Record<string, ImageBuffer>>,
    size: number,
    seamless: boolean,
    skipPbrMaps = false,
  ): MaterialOutputResult {
    const getIn = (port: string) => {
      const w = inc.get(port)
      return w ? nodeOutputs.get(w.fromNode)?.[w.fromPort] : undefined
    }
    const p = outNode?.params ?? defaultParamsFor('output_material')
    const rawBase = getIn('baseColor')
    const baseSrc = toRgba(rawBase, size, size, 1)
    const baseColor: RgbaBuffer = { kind: 'rgba', width: size, height: size, data: new Float32Array(baseSrc.data) }

    const opacityIn = getIn('opacity')
    if (opacityIn) {
      const opGray = toGray(opacityIn, size, size, 1)
      for (let i = 0, j = 0; i < opGray.data.length; i++, j += 4) {
        baseColor.data[j + 3] = clamp01(opGray.data[i])
      }
    }

    const heightIn = getIn('height')
    const heightMap = heightIn ? toGray(heightIn, size, size, 0.5) : toGray(baseColor, size, size, 0.5)

    const roughBase = clamp01(num(p, 'roughnessBase', 0.78))
    const roughContrast = num(p, 'roughnessContrast', 0.16)
    let roughness: GrayBuffer
    let normal: RgbaBuffer
    if (skipPbrMaps) {
      roughness = makeGray(size, size, roughBase)
      normal = makeRgba(size, size, 0.5, 0.5, 1, 1)
    } else {
      const roughIn = getIn('roughness')
      if (roughIn) {
        roughness = toGray(roughIn, size, size, roughBase)
      } else {
        roughness = makeGray(size, size)
        for (let i = 0; i < heightMap.data.length; i++) {
          roughness.data[i] = clamp01(roughBase + (0.5 - heightMap.data[i]) * roughContrast)
        }
      }
      const normalStrength = Math.max(0, num(p, 'normalStrength', 2.2))
      normal = heightToNormal(heightMap, normalStrength, seamless)
    }
    const dilateAlpha = bool(p, 'dilateAlpha', true)

    return {
      width: size,
      height: size,
      baseColor,
      heightMap,
      roughness,
      normal,
      alphaDilated: dilateAlpha,
    }
  }
}

export function evaluateTextureGraph(
  graph: TextureGraph,
  resolution?: number,
  options?: EvaluateGraphOptions,
): GraphEvalResult {
  return new TextureGraphEvaluator().evaluate(graph, resolution, options)
}

// ---- Browser Canvas & Three.js Texture Conversion --------------------------
/** Converts a float ImageBuffer to packed 8-bit RGBA Uint8ClampedArray (with optional alpha dilation). */
export function bufferToRgbaBytes(
  buf: ImageBuffer,
  options: { dilateAlpha?: boolean; showAlphaOnly?: boolean } = {},
): Uint8ClampedArray {
  const n = buf.width * buf.height
  const bytes = new Uint8ClampedArray(n * 4)
  if (buf.kind === 'gray') {
    const d = buf.data
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const v = Math.round(clamp01(d[i]) * 255)
      bytes[j] = v; bytes[j + 1] = v; bytes[j + 2] = v; bytes[j + 3] = 255
    }
    return bytes
  }
  if (buf.kind === 'label') {
    const d = buf.data
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const id = d[i]
      if (id === 0) {
        bytes[j] = 0; bytes[j + 1] = 0; bytes[j + 2] = 0; bytes[j + 3] = 0
      } else if (id < 0) {
        // Stems visualized in warm amber tones
        bytes[j] = 175; bytes[j + 1] = 126; bytes[j + 2] = 74; bytes[j + 3] = 255
      } else {
        const hue = ((id * 0.61803398875) % 1 + 1) % 1
        const [r, g, b] = hslToRgb(hue, 0.68, 0.56)
        bytes[j] = Math.round(r * 255); bytes[j + 1] = Math.round(g * 255); bytes[j + 2] = Math.round(b * 255); bytes[j + 3] = 255
      }
    }
    return bytes
  }
  const d = buf.data
  let hasTrans = false
  if (options.showAlphaOnly) {
    for (let i = 0; i < n * 4; i += 4) {
      const a = Math.round(clamp01(d[i + 3]) * 255)
      bytes[i] = a; bytes[i + 1] = a; bytes[i + 2] = a; bytes[i + 3] = 255
    }
    return bytes
  }
  for (let i = 0; i < n * 4; i += 4) {
    bytes[i] = Math.round(clamp01(d[i]) * 255)
    bytes[i + 1] = Math.round(clamp01(d[i + 1]) * 255)
    bytes[i + 2] = Math.round(clamp01(d[i + 2]) * 255)
    const a = Math.round(clamp01(d[i + 3]) * 255)
    bytes[i + 3] = a
    if (a < 220) hasTrans = true
  }
  if (options.dilateAlpha && hasTrans) {
    dilateAlphaRgba(bytes, buf.width, buf.height, 6)
  }
  return bytes
}

export function drawBufferToCanvas(
  buf: ImageBuffer,
  canvas: HTMLCanvasElement,
  options: { dilateAlpha?: boolean; showAlphaOnly?: boolean; checkerboard?: boolean; tile2x2?: boolean } = {},
) {
  const w = buf.width, h = buf.height
  const bytes = bufferToRgbaBytes(buf, { dilateAlpha: options.dilateAlpha, showAlphaOnly: options.showAlphaOnly })
  const tmp = document.createElement('canvas')
  tmp.width = w
  tmp.height = h
  const tg = tmp.getContext('2d')!
  const imgData = tg.createImageData(w, h)
  imgData.data.set(bytes)
  tg.putImageData(imgData, 0, 0)

  const g = canvas.getContext('2d')!
  const cw = canvas.width, ch = canvas.height
  g.clearRect(0, 0, cw, ch)
  if (options.checkerboard) {
    const cell = Math.max(8, Math.round(cw / 16))
    for (let y = 0; y < ch; y += cell) {
      for (let x = 0; x < cw; x += cell) {
        g.fillStyle = ((x / cell + y / cell) & 1) === 0 ? '#2b3136' : '#21262a'
        g.fillRect(x, y, cell, cell)
      }
    }
  }
  if (options.tile2x2) {
    const hw = cw / 2, hh = ch / 2
    g.drawImage(tmp, 0, 0, hw, hh)
    g.drawImage(tmp, hw, 0, hw, hh)
    g.drawImage(tmp, 0, hh, hw, hh)
    g.drawImage(tmp, hw, hh, hw, hh)
  } else {
    g.drawImage(tmp, 0, 0, cw, ch)
  }
}

/** Renders an interactive real-time PBR-lit 2D material preview using BaseColor + Normal + Roughness
 *  with zero extra WebGL contexts. */
export function renderLitPbrPreview(
  out: MaterialOutputResult,
  canvas: HTMLCanvasElement,
  lightAzimuth: number,
  lightElevation: number,
  tile2x2 = false,
  checkerboard = true,
) {
  const w = out.width, h = out.height
  const base = out.baseColor.data
  const norm = out.normal.data
  const rough = out.roughness.data
  const lx = Math.cos(lightElevation) * Math.cos(lightAzimuth)
  const ly = Math.cos(lightElevation) * Math.sin(lightAzimuth)
  const lz = Math.sin(lightElevation)
  // Half-vector with viewer at (0, 0, 1)
  const hx = lx, hy = ly, hz = lz + 1
  const hInv = 1 / Math.hypot(hx, hy, hz)
  const hnx = hx * hInv, hny = hy * hInv, hnz = hz * hInv

  const bytes = new Uint8ClampedArray(w * h * 4)
  for (let i = 0, p = 0; i < bytes.length; i += 4, p++) {
    const a = base[i + 3]
    const nx = norm[i] * 2 - 1
    const ny = norm[i + 1] * 2 - 1
    const nz = norm[i + 2] * 2 - 1
    const ndl = Math.max(0, nx * lx + ny * ly + nz * lz)
    const ndh = Math.max(0, nx * hnx + ny * hny + nz * hnz)
    const rgh = clamp01(rough[p])
    const shininess = lerp(96, 6, rgh)
    const spec = Math.pow(ndh, shininess) * lerp(0.42, 0.04, rgh)
    const diff = 0.28 + 0.88 * ndl
    const fill = Math.max(0, -nx * 0.4 - ny * 0.2 + nz * 0.3) * 0.16
    bytes[i] = Math.round(clamp01(base[i] * (diff + fill) + spec) * 255)
    bytes[i + 1] = Math.round(clamp01(base[i + 1] * (diff + fill * 1.08) + spec * 0.98) * 255)
    bytes[i + 2] = Math.round(clamp01(base[i + 2] * (diff + fill * 1.2) + spec * 0.94) * 255)
    bytes[i + 3] = Math.round(clamp01(a) * 255)
  }

  const tmp = document.createElement('canvas')
  tmp.width = w; tmp.height = h
  const tg = tmp.getContext('2d')!
  const img = tg.createImageData(w, h)
  img.data.set(bytes)
  tg.putImageData(img, 0, 0)

  const g = canvas.getContext('2d')!
  const cw = canvas.width, ch = canvas.height
  g.clearRect(0, 0, cw, ch)
  if (checkerboard) {
    const cell = Math.max(8, Math.round(cw / 16))
    for (let y = 0; y < ch; y += cell) {
      for (let x = 0; x < cw; x += cell) {
        g.fillStyle = ((x / cell + y / cell) & 1) === 0 ? '#2b3136' : '#21262a'
        g.fillRect(x, y, cell, cell)
      }
    }
  }
  if (tile2x2) {
    const hw = cw / 2, hh = ch / 2
    g.drawImage(tmp, 0, 0, hw, hh)
    g.drawImage(tmp, hw, 0, hw, hh)
    g.drawImage(tmp, 0, hh, hw, hh)
    g.drawImage(tmp, hw, hh, hw, hh)
  } else {
    g.drawImage(tmp, 0, 0, cw, ch)
  }
}

/** Creates a Three.js Texture ready for Bark (seamless RepeatWrapping) or Foliage (alpha-dilated) slots.
 *  Attaches linear NormalMap, RoughnessMap, and Float32 HeightField in `userData` for full PBR 3D + GLB binding. */
export function materialOutputToThreeTexture(
  out: MaterialOutputResult,
  slot: EditableTextureSlot,
  name: string,
): Texture {
  const makeChannelTex = (buf: ImageBuffer, suffix: string, isSrgb: boolean, dilate = false): Texture => {
    const bytes = bufferToRgbaBytes(buf, { dilateAlpha: dilate })
    let t: Texture
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas')
      c.width = buf.width
      c.height = buf.height
      const g = c.getContext('2d')!
      const img = g.createImageData(buf.width, buf.height)
      img.data.set(bytes)
      g.putImageData(img, 0, 0)
      t = new CanvasTexture(c)
    } else {
      t = new DataTexture(bytes, buf.width, buf.height, RGBAFormat)
      t.flipY = true
      t.needsUpdate = true
    }
    t.colorSpace = isSrgb ? SRGBColorSpace : NoColorSpace
    t.anisotropy = 8
    t.name = (name || 'procedural_texture') + suffix
    if (slot === 'bark') {
      t.wrapS = RepeatWrapping
      t.wrapT = RepeatWrapping
      t.generateMipmaps = true
    }
    return t
  }

  const tex = makeChannelTex(out.baseColor, '', true, slot !== 'bark' && out.alphaDilated)
  const nTex = makeChannelTex(out.normal, '_normal', false, false)
  const rTex = makeChannelTex(out.roughness, '_roughness', false, false)

  tex.userData.normalMap = nTex
  tex.userData.roughnessMap = rTex
  tex.userData.heightField = {
    data: new Float32Array(out.heightMap.data),
    width: out.width,
    height: out.height,
  }
  tex.userData.pbrChannels = { hasNormal: true, hasRoughness: true, hasHeight: true }

  const origDispose = tex.dispose.bind(tex)
  tex.dispose = () => {
    nTex.dispose()
    rTex.dispose()
    origDispose()
  }
  return tex
}

/** Renders MaterialOutput BaseColor to PNG dataUrl (dilated cleanly for foliage). */
export function materialOutputToDataUrl(out: MaterialOutputResult, slot: EditableTextureSlot, size?: number): string {
  const target = size ?? out.width
  const src = document.createElement('canvas')
  src.width = out.width
  src.height = out.height
  const bytes = bufferToRgbaBytes(out.baseColor, { dilateAlpha: slot !== 'bark' && out.alphaDilated })
  const sg = src.getContext('2d')!
  const img = sg.createImageData(out.width, out.height)
  img.data.set(bytes)
  sg.putImageData(img, 0, 0)
  if (target === out.width) return src.toDataURL('image/png')
  const dst = document.createElement('canvas')
  dst.width = target; dst.height = target
  dst.getContext('2d')!.drawImage(src, 0, 0, target, target)
  return dst.toDataURL('image/png')
}

/** Exports all PBR channels as PNG data URLs with explicit color-space & glTF 2.0 conventions:
 *  - baseColor: sRGB RGBA (alpha-dilated on foliage slots)
 *  - normal: Linear OpenGL (+Y up) tangent-space normal map
 *  - height: Linear 8-bit grayscale [0..1]
 *  - roughness: Linear 8-bit grayscale [0..1]
 *  - alpha: Linear opacity mask (omitted if fully opaque bark) */
export function materialOutputToPbrDataUrls(
  out: MaterialOutputResult,
  slot: EditableTextureSlot,
): { baseColor: string; normal: string; height: string; roughness: string; alpha?: string } {
  const encodeBuf = (buf: ImageBuffer, opts?: { dilateAlpha?: boolean; showAlphaOnly?: boolean }) => {
    const c = document.createElement('canvas')
    c.width = buf.width; c.height = buf.height
    const g = c.getContext('2d')!
    const img = g.createImageData(buf.width, buf.height)
    img.data.set(bufferToRgbaBytes(buf, opts))
    g.putImageData(img, 0, 0)
    return c.toDataURL('image/png')
  }
  return {
    baseColor: encodeBuf(out.baseColor, { dilateAlpha: slot !== 'bark' && out.alphaDilated }),
    normal: encodeBuf(out.normal),
    height: encodeBuf(out.heightMap),
    roughness: encodeBuf(out.roughness),
    ...(slot !== 'bark' ? { alpha: encodeBuf(out.baseColor, { showAlphaOnly: true }) } : {}),
  }
}

export interface SavedPbrChannelUrls {
  normalDataUrl?: string
  heightDataUrl?: string
  roughnessDataUrl?: string
}

function decodeDataUrlToCanvas(dataUrl: string, fillHex?: string): Promise<HTMLCanvasElement> {
  return new Promise<HTMLCanvasElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const w = Math.min(2048, img.naturalWidth || img.width || 512)
        const h = Math.min(2048, img.naturalHeight || img.height || 512)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const g = canvas.getContext('2d')!
        if (fillHex) { g.fillStyle = fillHex; g.fillRect(0, 0, w, h) }
        g.drawImage(img, 0, 0, w, h)
        resolve(canvas)
      } catch (err) { reject(err) }
    }
    img.onerror = () => reject(new Error('无法解码贴图库图像'))
    img.src = dataUrl
  })
}

/** Decodes a saved PNG/WebP/JPEG dataUrl (and optional persisted PBR Normal/Height/Roughness channels)
 *  back into a ready-to-use Three.js Texture with proper sRGB vs Linear color spaces. */
export async function dataUrlToThreeTexture(
  dataUrl: string,
  slot: EditableTextureSlot,
  name: string,
  pbr?: SavedPbrChannelUrls,
): Promise<Texture> {
  const baseCanvas = await decodeDataUrlToCanvas(dataUrl, slot === 'bark' ? '#5b4636' : undefined)
  const tex = new CanvasTexture(baseCanvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  tex.name = name || 'library_texture'
  if (slot === 'bark') {
    tex.wrapS = RepeatWrapping
    tex.wrapT = RepeatWrapping
    tex.generateMipmaps = true
  }

  const disposables: Texture[] = []
  const attachLinear = async (url: string | undefined, suffix: string, key: 'normalMap' | 'roughnessMap') => {
    if (!url) return false
    try {
      const c = await decodeDataUrlToCanvas(url)
      const t = new CanvasTexture(c)
      t.colorSpace = NoColorSpace
      t.anisotropy = 8
      t.name = `${tex.name}${suffix}`
      if (slot === 'bark') { t.wrapS = RepeatWrapping; t.wrapT = RepeatWrapping; t.generateMipmaps = true }
      tex.userData[key] = t
      disposables.push(t)
      return true
    } catch { return false }
  }

  const hasNormal = await attachLinear(pbr?.normalDataUrl, '_normal', 'normalMap')
  const hasRoughness = await attachLinear(pbr?.roughnessDataUrl, '_roughness', 'roughnessMap')
  let hasHeight = false
  if (pbr?.heightDataUrl) {
    try {
      const hc = await decodeDataUrlToCanvas(pbr.heightDataUrl)
      const hg = hc.getContext('2d')!
      const hPixels = hg.getImageData(0, 0, hc.width, hc.height).data
      const hFloat = new Float32Array(hc.width * hc.height)
      for (let i = 0; i < hFloat.length; i++) hFloat[i] = hPixels[i * 4] / 255
      tex.userData.heightField = { data: hFloat, width: hc.width, height: hc.height }
      hasHeight = true
    } catch { /* ignore */ }
  }
  if (hasNormal || hasRoughness || hasHeight) {
    tex.userData.pbrChannels = { hasNormal, hasRoughness, hasHeight }
  }
  if (disposables.length > 0) {
    const origDispose = tex.dispose.bind(tex)
    tex.dispose = () => {
      for (const d of disposables) d.dispose()
      origDispose()
    }
  }
  return tex
}
