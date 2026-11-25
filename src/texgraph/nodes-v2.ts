// v2 Orthogonal Procedural Texture Nodes:
// 1. custom_leaf   - Editable Bezier/monotone-profile leaf SDF + asymmetric tip curl + notch + veins + fold shading
// 2. vector_layout - Editable multi-Bezier stems + stable-ID leaf instances + 4 inputs + discrete palette + integer Int32Array labelMap
// 3. ink_outline   - Exact O(N) Felzenszwalb-Huttenlocher EDT outer outline + integer-labelMap inner overlap ink linework
// 4. curves_lut    - Fritsch-Carlson monotone cubic Hermite LUT (zero overshoot!) for RGB/Luma/channel/gray tone sculpting
// 5. curvature_ao  - Multi-scale signed curvature (convex/concave) + O(N) fast AO & optional 8x4 Horizon AO
// 6. palette_map   - CIELAB perceptual palette quantization & color remapping (hard cel-shade or soft painterly blend)
import {
  defaultAsymmetricAtlasRegions, defaultBarkPalette, defaultCurvePoints,
  defaultLeafProfile, defaultVinePalette,
} from './nodes'
import type {
  AtlasRegion, CurvePoint, GrayBuffer, ImageBuffer, LabelBuffer, RgbaBuffer,
  VectorLeafInstance, VectorStem,
} from './types'

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const mod = (a: number, n: number) => ((a % n) + n) % n
const smoothstep = (e0: number, e1: number, x: number) => {
  const denom = e1 - e0
  if (Math.abs(denom) < 1e-6) return x >= e1 ? 1 : 0
  const t = clamp01((x - e0) / denom)
  return t * t * (3 - 2 * t)
}

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

function hexToRgb01(hex: string): [number, number, number] {
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

function makeGray(width: number, height: number, fill = 0): GrayBuffer {
  const data = new Float32Array(width * height)
  if (fill !== 0) data.fill(fill)
  return { kind: 'gray', width, height, data }
}

function makeRgba(width: number, height: number, r = 0, g = 0, b = 0, a = 0): RgbaBuffer {
  const data = new Float32Array(width * height * 4)
  if (r !== 0 || g !== 0 || b !== 0 || a !== 0) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a
    }
  }
  return { kind: 'rgba', width, height, data }
}

function makeLabel(width: number, height: number): LabelBuffer {
  return { kind: 'label', width, height, data: new Int32Array(width * height) }
}

function toGrayLocal(buf: ImageBuffer | undefined, w: number, h: number, fallback = 0.5): GrayBuffer {
  if (!buf || buf.kind === 'label') return makeGray(w, h, fallback)
  if (buf.kind === 'gray') return buf
  const out = makeGray(buf.width, buf.height)
  const src = buf.data, dst = out.data
  for (let i = 0, j = 0; i < dst.length; i++, j += 4) {
    dst[i] = (0.299 * src[j] + 0.587 * src[j + 1] + 0.114 * src[j + 2]) * src[j + 3]
  }
  return out
}

function toRgbaLocal(buf: ImageBuffer | undefined, w: number, h: number, fallbackAlpha = 1): RgbaBuffer {
  if (!buf || buf.kind === 'label') return makeRgba(w, h, 0.5, 0.5, 0.5, fallbackAlpha)
  if (buf.kind === 'rgba') return buf
  const out = makeRgba(buf.width, buf.height, 0, 0, 0, 0)
  const src = buf.data, dst = out.data
  for (let i = 0, j = 0; i < src.length; i++, j += 4) {
    const v = src[i]
    dst[j] = v; dst[j + 1] = v; dst[j + 2] = v; dst[j + 3] = 1
  }
  return out
}

// ---------------------------------------------------------------------------
// 1. Fritsch-Carlson Monotone Cubic Hermite Spline & LUT Builder
// ---------------------------------------------------------------------------
function normalizeCurvePoints(raw: unknown, fallback: CurvePoint[]): CurvePoint[] {
  if (!Array.isArray(raw) || raw.length < 2) return fallback.map(pt => [pt[0], pt[1]])
  const pts: CurvePoint[] = []
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 2) continue
    const x = Number(entry[0]), y = Number(entry[1])
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push([clamp01(x), clamp01(y)])
  }
  if (pts.length < 2) return fallback.map(pt => [pt[0], pt[1]])
  pts.sort((a, b) => a[0] - b[0])
  // Deduplicate identical X coordinates safely
  const unique: CurvePoint[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] - unique[unique.length - 1][0] > 1e-4) unique.push(pts[i])
    else unique[unique.length - 1][1] = pts[i][1]
  }
  if (unique.length < 2) return fallback.map(pt => [pt[0], pt[1]])
  return unique
}

/** Builds a 256-entry [0..1] LUT using Fritsch-Carlson monotone cubic Hermite (or optional Catmull-Rom). */
export function buildCurveLut(rawPoints: unknown, fallback: CurvePoint[], monotone = true, samples = 256): Float32Array {
  const pts = normalizeCurvePoints(rawPoints, fallback)
  const n = pts.length
  const xs = pts.map(p => p[0])
  const ys = pts.map(p => p[1])
  const dx = new Float64Array(n - 1)
  const sec = new Float64Array(n - 1)
  for (let i = 0; i < n - 1; i++) {
    dx[i] = Math.max(1e-5, xs[i + 1] - xs[i])
    sec[i] = (ys[i + 1] - ys[i]) / dx[i]
  }

  const m = new Float64Array(n)
  m[0] = sec[0]
  m[n - 1] = sec[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (monotone && sec[i - 1] * sec[i] <= 0) {
      m[i] = 0
    } else {
      m[i] = 0.5 * (sec[i - 1] + sec[i])
    }
  }
  if (monotone) {
    for (let i = 0; i < n - 1; i++) {
      if (Math.abs(sec[i]) < 1e-8) {
        m[i] = 0
        m[i + 1] = 0
      } else {
        const a = m[i] / sec[i]
        const b = m[i + 1] / sec[i]
        const h = Math.hypot(a, b)
        if (h > 3) {
          const tau = 3 / h
          m[i] = tau * a * sec[i]
          m[i + 1] = tau * b * sec[i]
        }
      }
    }
  }

  const lut = new Float32Array(samples)
  let seg = 0
  for (let s = 0; s < samples; s++) {
    const x = s / (samples - 1)
    if (x <= xs[0]) { lut[s] = clamp01(ys[0]); continue }
    if (x >= xs[n - 1]) { lut[s] = clamp01(ys[n - 1]); continue }
    while (seg < n - 2 && x > xs[seg + 1]) seg++
    const h = dx[seg]
    const t = clamp01((x - xs[seg]) / h)
    const t2 = t * t, t3 = t2 * t
    const h00 = 2 * t3 - 3 * t2 + 1
    const h10 = t3 - 2 * t2 + t
    const h01 = -2 * t3 + 3 * t2
    const h11 = t3 - t2
    lut[s] = clamp01(h00 * ys[seg] + h10 * h * m[seg] + h01 * ys[seg + 1] + h11 * h * m[seg + 1])
  }
  return lut
}

function sampleLut(lut: Float32Array, v: number): number {
  const f = clamp01(v) * (lut.length - 1)
  const i0 = Math.floor(f)
  const i1 = Math.min(lut.length - 1, i0 + 1)
  return lut[i0] + (lut[i1] - lut[i0]) * (f - i0)
}

export function evalCurvesLut(
  p: Record<string, unknown>,
  inputs: Record<string, ImageBuffer | undefined>,
  w: number,
  h: number,
): Record<string, ImageBuffer> {
  const srcBuf = inputs.input
  const channel = str(p, 'channel', 'rgb')
  const monotone = bool(p, 'monotone', true)
  const lut = buildCurveLut(p.points, defaultCurvePoints, monotone, 256)

  if (srcBuf?.kind === 'gray') {
    const out = makeGray(w, h)
    const s = srcBuf.data, d = out.data
    for (let i = 0; i < d.length; i++) d[i] = sampleLut(lut, s[i])
    return { out }
  }

  const src = toRgbaLocal(srcBuf, w, h, 1)
  const out = makeRgba(w, h, 0, 0, 0, 0)
  const s = src.data, d = out.data
  for (let i = 0; i < d.length; i += 4) {
    let r = s[i], g = s[i + 1], b = s[i + 2], a = s[i + 3]
    if (channel === 'rgb') {
      r = sampleLut(lut, r)
      g = sampleLut(lut, g)
      b = sampleLut(lut, b)
    } else if (channel === 'luma') {
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const yNext = sampleLut(lut, y)
      const ratio = y > 1e-4 ? yNext / y : 1
      r = clamp01(r * ratio)
      g = clamp01(g * ratio)
      b = clamp01(b * ratio)
    } else if (channel === 'r') {
      r = sampleLut(lut, r)
    } else if (channel === 'g') {
      g = sampleLut(lut, g)
    } else if (channel === 'b') {
      b = sampleLut(lut, b)
    } else if (channel === 'alpha') {
      a = sampleLut(lut, a)
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a
  }
  return { out }
}

// ---------------------------------------------------------------------------
// 2. Custom Leaf (Editable Contour Profile + Asymmetric Curl + Notch + Veins)
// ---------------------------------------------------------------------------
export function evalCustomLeaf(p: Record<string, unknown>, w: number, h: number): Record<string, ImageBuffer> {
  const length = num(p, 'length', 0.84)
  const width = num(p, 'width', 0.54)
  const bend = num(p, 'bend', 0.04)
  const tipCurl = num(p, 'tipCurl', 0.0)
  const asymmetry = num(p, 'asymmetry', 0.0)
  const lobeCount = Math.round(num(p, 'lobeCount', 0))
  const lobeDepth = num(p, 'lobeDepth', 0.0)
  const notchPos = num(p, 'notchPos', 0.62)
  const notchDepth = num(p, 'notchDepth', 0.0)
  const foldShade = num(p, 'foldShade', 0.12)
  const veinStrength = num(p, 'veinStrength', 0.22)
  const veinCount = Math.round(num(p, 'veinCount', 4))
  const stemLen = num(p, 'stemLen', 0.04)
  const baseCol = hexToRgb01(str(p, 'baseColor', '#3e6e35'))
  const tipCol = hexToRgb01(str(p, 'tipColor', '#69a644'))
  const veinCol = hexToRgb01(str(p, 'veinColor', '#98cb62'))
  const stemCol = hexToRgb01(str(p, 'stemColor', '#6b5336'))

  const profileLut = buildCurveLut(p.profile, defaultLeafProfile, true, 256)
  const rgba = makeRgba(w, h, 0, 0, 0, 0)
  const height = makeGray(w, h, 0)
  const mask = makeGray(w, h, 0)

  const yBase = 0.5 + length * 0.5 - stemLen * 0.35
  const yTip = yBase - length
  const aa = 1.6 / Math.max(w, h)
  const stemHalfW = Math.max(0.008, width * 0.024)

  const rd = rgba.data, hd = height.data, md = mask.data

  for (let py = 0; py < h; py++) {
    const v = (py + 0.5) / h
    const t = (yBase - v) / Math.max(0.05, length) // 0 at base, 1 at tip
    const spineX = 0.5 + bend * Math.sin(Math.PI * clamp01(t)) + tipCurl * Math.pow(clamp01(t), 2.8)
    const dtEps = 0.008
    const tA = clamp01(t - dtEps), tB = clamp01(t + dtEps)
    const dxDt = ((bend * Math.sin(Math.PI * tB) + tipCurl * Math.pow(tB, 2.8))
      - (bend * Math.sin(Math.PI * tA) + tipCurl * Math.pow(tA, 2.8))) / Math.max(1e-4, tB - tA)
    // Tangent along spine pointing up (-v): (dxDt, -length), normal to the right: (length, dxDt)
    const invNorm = 1 / Math.hypot(length, dxDt)
    const baseHalfW = (t >= -0.02 && t <= 1.02) ? sampleLut(profileLut, t) * width * 0.92 : 0

    for (let px = 0; px < w; px++) {
      const u = (px + 0.5) / w
      const idx = py * w + px
      const off = idx * 4

      // Optional short petiole stem below base
      let stemAlpha = 0
      if (stemLen > 0.002 && v > yBase - 0.02 && v < yBase + stemLen) {
        const st = (v - yBase) / Math.max(1e-4, stemLen)
        const sx = 0.5 - bend * 0.25 * st
        const dStem = Math.abs(u - sx) - stemHalfW * (1 - 0.25 * st)
        stemAlpha = 1 - smoothstep(-aa, aa, dStem)
      }

      if (t >= -0.03 && t <= 1.03 && baseHalfW > 1e-4) {
        // Signed lateral offset perpendicular to curved midrib
        const lat = (u - spineX) * (length * invNorm)
        const sideSign = lat >= 0 ? 1 : -1
        const sideScale = 1 + sideSign * asymmetry * Math.sin(Math.PI * clamp01(t))
        let hw = baseHalfW * Math.max(0.25, sideScale)

        // Optional lobe waves / serrations
        if (lobeCount > 0 && lobeDepth > 0.001) {
          const wave = Math.sin(clamp01(t) * Math.PI * lobeCount)
          const env = Math.sin(Math.PI * clamp01(t))
          hw *= Math.max(0.2, 1 + lobeDepth * wave * env)
        }
        // Optional organic bite/notch on right edge
        if (notchDepth > 0.001 && sideSign > 0) {
          const dn = (t - notchPos) / 0.065
          hw *= Math.max(0.15, 1 - notchDepth * Math.exp(-dn * dn))
        }

        const sdf = Math.abs(lat) - hw
        const capFade = smoothstep(-0.015, 0.008, t) * (1 - smoothstep(0.992, 1.015, t))
        const bladeAlpha = (1 - smoothstep(-aa, aa, sdf)) * capFade

        if (bladeAlpha > 0.002) {
          const edgeRatio = clamp01(Math.abs(lat) / Math.max(1e-4, hw))
          // Midrib & lateral arched veins
          const midrib = Math.exp(-((lat / Math.max(0.004, width * 0.018 * (1 - 0.55 * clamp01(t)))) ** 2))
          let latVein = 0
          if (veinCount > 0 && veinStrength > 0.01) {
            const vCoord = clamp01(t) * (veinCount + 1) - Math.pow(edgeRatio, 1.25) * 1.15
            const frac = Math.abs(((vCoord % 1) + 1) % 1 - 0.5) * 2
            latVein = Math.pow(clamp01(1 - frac), 6) * (1 - edgeRatio * 0.8) * Math.sin(Math.PI * clamp01(t))
          }
          const veinVal = clamp01(midrib * 0.85 + latVein * 0.65) * veinStrength

          // Folded 3D-like blade height + directional fold shade
          const dome = Math.sqrt(Math.max(0, 1 - edgeRatio * edgeRatio * 0.88))
          const vFold = 1 - Math.abs(edgeRatio) * 0.35
          const hVal = clamp01(0.25 + 0.55 * dome * vFold + veinVal * 0.28)

          const gradT = smoothstep(0.06, 0.94, t)
          let r = lerp(baseCol[0], tipCol[0], gradT)
          let g = lerp(baseCol[1], tipCol[1], gradT)
          let b = lerp(baseCol[2], tipCol[2], gradT)

          // Fold shading across midrib (left vs right facet)
          const sideTone = 1 + (lat >= 0 ? foldShade : -foldShade) * smoothstep(0.02, 0.25, Math.abs(lat) / Math.max(0.02, width * 0.25))
          r *= sideTone; g *= sideTone; b *= sideTone

          // Blend vein color cleanly
          if (veinVal > 0.005) {
            const vm = clamp01(veinVal * 0.72)
            r = lerp(r, veinCol[0], vm)
            g = lerp(g, veinCol[1], vm)
            b = lerp(b, veinCol[2], vm)
          }

          if (stemAlpha > 0.002 && bladeAlpha < 0.99) {
            const outA = bladeAlpha + stemAlpha * (1 - bladeAlpha)
            rd[off] = clamp01((r * bladeAlpha + stemCol[0] * stemAlpha * (1 - bladeAlpha)) / Math.max(1e-4, outA))
            rd[off + 1] = clamp01((g * bladeAlpha + stemCol[1] * stemAlpha * (1 - bladeAlpha)) / Math.max(1e-4, outA))
            rd[off + 2] = clamp01((b * bladeAlpha + stemCol[2] * stemAlpha * (1 - bladeAlpha)) / Math.max(1e-4, outA))
            rd[off + 3] = outA
            hd[idx] = Math.max(hVal * bladeAlpha, 0.35 * stemAlpha)
            md[idx] = outA
          } else {
            rd[off] = clamp01(r)
            rd[off + 1] = clamp01(g)
            rd[off + 2] = clamp01(b)
            rd[off + 3] = bladeAlpha
            hd[idx] = hVal * bladeAlpha
            md[idx] = bladeAlpha
          }
          continue
        }
      }

      if (stemAlpha > 0.002) {
        rd[off] = stemCol[0]
        rd[off + 1] = stemCol[1]
        rd[off + 2] = stemCol[2]
        rd[off + 3] = stemAlpha
        hd[idx] = 0.36 * stemAlpha
        md[idx] = stemAlpha
      }
    }
  }

  return { rgba, height, mask }
}

// ---------------------------------------------------------------------------
// 3. Vector Layout (Bezier Stems + Stable-ID Leaf Instances + Int32 LabelMap)
// ---------------------------------------------------------------------------
/** Evaluates a smooth multi-point stem curve at `t in [0, 1]` (2pt line, 3pt quad, 4pt cubic, 5..8pt Catmull-Rom). */
export function evalStemPoint(points: [number, number][], t: number): [number, number] {
  const n = points.length
  if (n === 0) return [0.5, 0.5]
  if (n === 1) return points[0]
  const u = clamp01(t)
  if (n === 2) {
    return [lerp(points[0][0], points[1][0], u), lerp(points[0][1], points[1][1], u)]
  }
  if (n === 3) {
    const mu = 1 - u
    return [
      mu * mu * points[0][0] + 2 * mu * u * points[1][0] + u * u * points[2][0],
      mu * mu * points[0][1] + 2 * mu * u * points[1][1] + u * u * points[2][1],
    ]
  }
  if (n === 4) {
    const mu = 1 - u, mu2 = mu * mu, u2 = u * u
    return [
      mu2 * mu * points[0][0] + 3 * mu2 * u * points[1][0] + 3 * mu * u2 * points[2][0] + u2 * u * points[3][0],
      mu2 * mu * points[0][1] + 3 * mu2 * u * points[1][1] + 3 * mu * u2 * points[2][1] + u2 * u * points[3][1],
    ]
  }
  // Catmull-Rom piecewise smooth spline for 5..8 points
  const scaled = u * (n - 1)
  const i = Math.min(n - 2, Math.floor(scaled))
  const f = scaled - i
  const p0 = points[Math.max(0, i - 1)]
  const p1 = points[i]
  const p2 = points[i + 1]
  const p3 = points[Math.min(n - 1, i + 2)]
  const f2 = f * f, f3 = f2 * f
  const cr = (a: number, b: number, c: number, d: number) =>
    0.5 * ((2 * b) + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f2 + (-a + 3 * b - 3 * c + d) * f3)
  return [cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]
}

function sampleRgbaBilinearClamped(buf: RgbaBuffer, u: number, v: number, out: [number, number, number, number]) {
  if (u < 0 || u > 1 || v < 0 || v > 1) {
    out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0
    return
  }
  const w = buf.width, h = buf.height
  const fx = u * w - 0.5, fy = v * h - 0.5
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(fx)))
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)))
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1)
  const tx = clamp01(fx - Math.floor(fx)), ty = clamp01(fy - Math.floor(fy))
  const d = buf.data
  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4
  const i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4
  const a00 = d[i00 + 3], a10 = d[i10 + 3], a01 = d[i01 + 3], a11 = d[i11 + 3]
  const aTop = a00 + (a10 - a00) * tx
  const aBot = a01 + (a11 - a01) * tx
  const a = aTop + (aBot - aTop) * ty
  if (a < 1e-4) {
    out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0
    return
  }
  // Premultiplied bilinear interpolation prevents dark fringe bleeding at leaf edges!
  for (let c = 0; c < 3; c++) {
    const cTop = d[i00 + c] * a00 + (d[i10 + c] * a10 - d[i00 + c] * a00) * tx
    const cBot = d[i01 + c] * a01 + (d[i11 + c] * a11 - d[i01 + c] * a01) * tx
    out[c] = clamp01((cTop + (cBot - cTop) * ty) / a)
  }
  out[3] = clamp01(a)
}

function sampleGrayBilinearClamped(buf: GrayBuffer | undefined, u: number, v: number): number {
  if (!buf || u < 0 || u > 1 || v < 0 || v > 1) return 0.5
  const w = buf.width, h = buf.height
  const fx = u * w - 0.5, fy = v * h - 0.5
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(fx)))
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)))
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1)
  const tx = clamp01(fx - Math.floor(fx)), ty = clamp01(fy - Math.floor(fy))
  const d = buf.data
  const v0 = d[y0 * w + x0] + (d[y0 * w + x1] - d[y0 * w + x0]) * tx
  const v1 = d[y1 * w + x0] + (d[y1 * w + x1] - d[y1 * w + x0]) * tx
  return v0 + (v1 - v0) * ty
}

function meanOpaqueLuma(buf: RgbaBuffer): number {
  const d = buf.data
  let sum = 0, cnt = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 0.45) {
      sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      cnt++
    }
  }
  return cnt > 0 ? Math.max(0.08, sum / cnt) : 0.45
}

export function evalVectorLayout(
  p: Record<string, unknown>,
  inputs: Record<string, ImageBuffer | undefined>,
  w: number,
  h: number,
): Record<string, ImageBuffer> {
  const rgba = makeRgba(w, h, 0, 0, 0, 0)
  const height = makeGray(w, h, 0)
  const label = makeLabel(w, h)

  const rawPalette = Array.isArray(p.palette) && p.palette.length > 0 ? p.palette as string[] : defaultVinePalette
  const paletteRgb = rawPalette.map(hexToRgb01)
  const paletteStrength = clamp01(num(p, 'paletteStrength', 0.78))
  const lightAngle = (num(p, 'lightAngle', -45) * Math.PI) / 180
  const lightDx = Math.cos(lightAngle), lightDy = Math.sin(lightAngle)
  const lightStrength = num(p, 'lightStrength', 0.14)
  const depthShade = num(p, 'depthShade', 0.12)
  const layerShadow = num(p, 'layerShadow', 0.08)
  const defaultStemRgb = hexToRgb01(str(p, 'stemColor', '#6e5237'))
  const stemHighlight = num(p, 'stemHighlight', 0.16)

  const stems: VectorStem[] = Array.isArray(p.stems) ? p.stems as VectorStem[] : []
  const instances: VectorLeafInstance[] = Array.isArray(p.instances) ? p.instances as VectorLeafInstance[] : []

  // Resolve up to 4 leaf variants (fallback to default procedural custom_leaf if unwired!)
  let fallbackLeaf: { rgba: RgbaBuffer; height: GrayBuffer } | undefined
  const getFallback = () => {
    if (!fallbackLeaf) {
      const sz = Math.min(256, Math.max(128, Math.round(w * 0.5)))
      const res = evalCustomLeaf({ length: 0.84, width: 0.54, veinStrength: 0.18 }, sz, sz)
      fallbackLeaf = { rgba: res.rgba as RgbaBuffer, height: res.height as GrayBuffer }
    }
    return fallbackLeaf
  }
  const leafVariants: { rgba: RgbaBuffer; height: GrayBuffer; meanLuma: number }[] = []
  const inKeys: [string, string][] = [['leafA', 'heightA'], ['leafB', 'heightB'], ['leafC', 'heightC'], ['leafD', 'heightD']]
  for (const [lk, hk] of inKeys) {
    const lb = inputs[lk]
    if (lb && (lb.kind === 'rgba' || lb.kind === 'gray')) {
      const rgbaBuf = toRgbaLocal(lb, lb.width, lb.height, 1)
      const hb = inputs[hk]
      leafVariants.push({
        rgba: rgbaBuf,
        height: hb && hb.kind !== 'label'
          ? toGrayLocal(hb, rgbaBuf.width, rgbaBuf.height, 0.5)
          : (lb.kind === 'gray' ? lb : toGrayLocal(rgbaBuf, rgbaBuf.width, rgbaBuf.height, 0.5)),
        meanLuma: meanOpaqueLuma(rgbaBuf),
      })
    }
  }
  if (leafVariants.length === 0) {
    const fb = getFallback()
    leafVariants.push({ rgba: fb.rgba, height: fb.height, meanLuma: meanOpaqueLuma(fb.rgba) })
  }

  // Unified z-sorted render queue (stems + leaf instances share z-axis cleanly!)
  type DrawItem =
    | { kind: 'stem'; idx: number; z: number; stem: VectorStem }
    | { kind: 'leaf'; idx: number; z: number; inst: VectorLeafInstance }

  const items: DrawItem[] = []
  stems.forEach((stem, idx) => items.push({ kind: 'stem', idx, z: stem.z ?? 0, stem }))
  instances.forEach((inst, idx) => items.push({ kind: 'leaf', idx, z: inst.z ?? (idx * 0.01), inst }))
  items.sort((a, b) => a.z - b.z)

  const minZ = items.length ? items[0].z : 0
  const zSpan = items.length > 1 ? Math.max(1e-4, items[items.length - 1].z - minZ) : 1
  const aa = 1.35 / Math.max(w, h)
  const rd = rgba.data, hd = height.data, ld = label.data
  const samp: [number, number, number, number] = [0, 0, 0, 0]

  for (const item of items) {
    const zNorm = clamp01((item.z - minZ) / zSpan)
    const depthMul = 1 - depthShade * (1 - zNorm)

    if (item.kind === 'stem') {
      const st = item.stem
      if (!st.points || st.points.length < 2) continue
      const col = st.color ? hexToRgb01(st.color) : defaultStemRgb
      const segCount = Math.max(12, Math.min(36, st.points.length * 8))
      const poly: [number, number, number][] = []
      let minX = 1, maxX = 0, minY = 1, maxY = 0
      for (let s = 0; s <= segCount; s++) {
        const t = s / segCount
        const [px, py] = evalStemPoint(st.points, t)
        const rad = lerp(st.widthStart, st.widthEnd, t)
        poly.push([px, py, rad])
        if (px - rad < minX) minX = px - rad
        if (px + rad > maxX) maxX = px + rad
        if (py - rad < minY) minY = py - rad
        if (py + rad > maxY) maxY = py + rad
      }
      const pad = aa * 3 + (layerShadow > 0 ? 0.015 : 0)
      const x0 = Math.max(0, Math.floor((minX - pad) * w))
      const x1 = Math.min(w - 1, Math.ceil((maxX + pad) * w))
      const y0 = Math.max(0, Math.floor((minY - pad) * h))
      const y1 = Math.min(h - 1, Math.ceil((maxY + pad) * h))
      const stemLabelId = -(item.idx + 1)

      for (let py = y0; py <= y1; py++) {
        const v = (py + 0.5) / h
        for (let px = x0; px <= x1; px++) {
          const u = (px + 0.5) / w
          // Exact closest point along polyline segments
          let bestDist = Infinity
          let bestRad = 0.008
          let bestSide = 0
          for (let k = 0; k < segCount; k++) {
            const ax = poly[k][0], ay = poly[k][1], ar = poly[k][2]
            const bx = poly[k + 1][0], by = poly[k + 1][1], br = poly[k + 1][2]
            const abx = bx - ax, aby = by - ay
            const ab2 = abx * abx + aby * aby
            const f = ab2 > 1e-10 ? clamp01(((u - ax) * abx + (v - ay) * aby) / ab2) : 0
            const cx = ax + abx * f, cy = ay + aby * f
            const dx = u - cx, dy = v - cy
            const dist = Math.hypot(dx, dy)
            const rSeg = ar + (br - ar) * f
            if (dist - rSeg < bestDist - bestRad) {
              bestDist = dist
              bestRad = rSeg
              bestSide = (dx * lightDx + dy * lightDy) / Math.max(1e-4, rSeg)
            }
          }
          const sdf = bestDist - bestRad
          if (sdf > aa) continue
          const alpha = 1 - smoothstep(-aa, aa, sdf)
          if (alpha <= 0.002) continue

          const cyl = Math.sqrt(Math.max(0, 1 - Math.min(1, (bestDist / Math.max(1e-4, bestRad)) ** 2)))
          const shade = (1 + stemHighlight * clamp01(bestSide * 0.5 + 0.5) * cyl - 0.14 * (1 - cyl)) * depthMul
          const sr = clamp01(col[0] * shade)
          const sg = clamp01(col[1] * shade)
          const sb = clamp01(col[2] * shade)

          const pIdx = py * w + px
          const off = pIdx * 4
          const dstA = rd[off + 3]
          const outA = alpha + dstA * (1 - alpha)
          if (outA > 1e-5) {
            rd[off] = (sr * alpha + rd[off] * dstA * (1 - alpha)) / outA
            rd[off + 1] = (sg * alpha + rd[off + 1] * dstA * (1 - alpha)) / outA
            rd[off + 2] = (sb * alpha + rd[off + 2] * dstA * (1 - alpha)) / outA
            rd[off + 3] = outA
          }
          const hStem = clamp01(0.28 + 0.35 * zNorm + 0.28 * cyl)
          hd[pIdx] = Math.max(hd[pIdx] * (1 - alpha * 0.5), hStem * alpha)
          if (alpha >= 0.45) ld[pIdx] = stemLabelId
        }
      }
      continue
    }

    // Leaf instance compositing
    const inst = item.inst
    const variant = leafVariants[mod(inst.variant ?? 0, leafVariants.length)]
    const palCol = paletteRgb[mod(inst.colorIdx ?? 0, paletteRgb.length)]
    const cosR = Math.cos(inst.rot), sinR = Math.sin(inst.rot)
    const sx = Math.max(0.02, inst.scaleX)
    const sy = Math.max(0.02, inst.scaleY)
    const invSx = 1 / sx, invSy = 1 / sy
    const flipSign = inst.flip ? -1 : 1
    const instBend = inst.bend ?? 0
    const leafLabelId = item.idx + 1

    // Global directional sunlight boost based on leaf position in canvas
    const lightProj = (inst.x - 0.5) * lightDx + (inst.y - 0.5) * lightDy
    const lightMul = 1 + lightProj * lightStrength * 1.4

    // Tight world bounding box of rotated stamp
    const halfW = sx * 0.56, halfH = sy * 0.56
    const extX = Math.abs(cosR) * halfW + Math.abs(sinR) * halfH
    const extY = Math.abs(sinR) * halfW + Math.abs(cosR) * halfH
    const shOffX = -lightDx * 0.012, shOffY = -lightDy * 0.012
    const minX = Math.min(inst.x - extX, inst.x - extX + shOffX)
    const maxX = Math.max(inst.x + extX, inst.x + extX + shOffX)
    const minY = Math.min(inst.y - extY, inst.y - extY + shOffY)
    const maxY = Math.max(inst.y + extY, inst.y + extY + shOffY)
    const x0 = Math.max(0, Math.floor(minX * w))
    const x1 = Math.min(w - 1, Math.ceil(maxX * w))
    const y0 = Math.max(0, Math.floor(minY * h))
    const y1 = Math.min(h - 1, Math.ceil(maxY * h))

    // Optional soft cast shadow pass onto already-composited lower layers
    if (layerShadow > 0.005) {
      for (let py = y0; py <= y1; py++) {
        const v = (py + 0.5) / h
        for (let px = x0; px <= x1; px++) {
          const pIdx = py * w + px
          const off = pIdx * 4
          if (rd[off + 3] < 0.02) continue
          const dx = (px + 0.5) / w - (inst.x + shOffX)
          const dy = v - (inst.y + shOffY)
          const lx = (dx * cosR + dy * sinR) * invSx * flipSign + 0.5
          const ly = (-dx * sinR + dy * cosR) * invSy + 0.5
          sampleRgbaBilinearClamped(variant.rgba, lx, ly, samp)
          if (samp[3] > 0.05) {
            const dim = 1 - samp[3] * layerShadow * 0.55
            rd[off] *= dim
            rd[off + 1] *= dim
            rd[off + 2] *= dim
          }
        }
      }
    }

    // Main leaf stamp pass
    for (let py = y0; py <= y1; py++) {
      const v = (py + 0.5) / h
      for (let px = x0; px <= x1; px++) {
        const dx = (px + 0.5) / w - inst.x
        const dy = v - inst.y
        let lx = (dx * cosR + dy * sinR) * invSx * flipSign + 0.5
        const ly = (-dx * sinR + dy * cosR) * invSy + 0.5
        if (instBend !== 0) {
          const lt = clamp01(1 - ly)
          lx -= instBend * lt * lt
        }
        sampleRgbaBilinearClamped(variant.rgba, lx, ly, samp)
        const a = samp[3]
        if (a <= 0.003) continue

        let sr = samp[0], sg = samp[1], sb = samp[2]
        if (paletteStrength > 0.001) {
          const pxLuma = 0.2126 * sr + 0.7152 * sg + 0.0722 * sb
          const relShade = Math.max(0.45, Math.min(1.42, 1.0 + (pxLuma / variant.meanLuma - 1) * 0.55))
          const pr = clamp01(palCol[0] * relShade)
          const pg = clamp01(palCol[1] * relShade)
          const pb = clamp01(palCol[2] * relShade)
          sr = lerp(sr, pr, paletteStrength)
          sg = lerp(sg, pg, paletteStrength)
          sb = lerp(sb, pb, paletteStrength)
        }
        const shadeMul = depthMul * lightMul
        sr = clamp01(sr * shadeMul)
        sg = clamp01(sg * shadeMul)
        sb = clamp01(sb * shadeMul)

        const pIdx = py * w + px
        const off = pIdx * 4
        const dstA = rd[off + 3]
        const outA = a + dstA * (1 - a)
        if (outA > 1e-5) {
          rd[off] = (sr * a + rd[off] * dstA * (1 - a)) / outA
          rd[off + 1] = (sg * a + rd[off + 1] * dstA * (1 - a)) / outA
          rd[off + 2] = (sb * a + rd[off + 2] * dstA * (1 - a)) / outA
          rd[off + 3] = outA
        }
        const lh = sampleGrayBilinearClamped(variant.height, lx, ly)
        const outH = clamp01(0.20 + 0.42 * zNorm + 0.38 * lh)
        hd[pIdx] = Math.max(hd[pIdx] * (1 - a * 0.6), outH * a)
        // Strict non-interpolated integer instance label write!
        if (a >= 0.45) ld[pIdx] = leafLabelId
      }
    }
  }

  return { rgba, height, label }
}

export type VectorHitTarget =
  | { kind: 'leaf'; id: string }
  | { kind: 'stemPoint'; stemId: string; pointIdx: number }
  | { kind: 'stem'; stemId: string }

/** Fast CPU hit-testing in normalized [0..1] preview coordinates (reverse z-order so topmost leaf wins!). */
export function hitTestVectorLayout(
  stems: VectorStem[],
  instances: VectorLeafInstance[],
  u: number,
  v: number,
  selectedStemId?: string,
): VectorHitTarget | undefined {
  // 1. Prioritize control points of currently selected stem for effortless curve dragging
  // 1. Prioritize control points of currently selected stem first
  if (selectedStemId) {
    const st = stems.find(s => s.id === selectedStemId)
    if (st) {
      for (let i = 0; i < st.points.length; i++) {
        if (Math.hypot(u - st.points[i][0], v - st.points[i][1]) <= 0.034) {
          return { kind: 'stemPoint', stemId: st.id, pointIdx: i }
        }
      }
    }
  }

  // 1b. Direct click right on any visible stem control-point dot (unless even closer to a leaf center)
  let bestStemPt: { stemId: string; pointIdx: number; dist: number } | undefined
  for (const st of stems) {
    for (let i = 0; i < st.points.length; i++) {
      const d = Math.hypot(u - st.points[i][0], v - st.points[i][1])
      if (d <= 0.021 && (!bestStemPt || d < bestStemPt.dist)) {
        bestStemPt = { stemId: st.id, pointIdx: i, dist: d }
      }
    }
  }
  if (bestStemPt) {
    const nearLeafCenter = instances.some(l => Math.hypot(u - l.x, v - l.y) < bestStemPt!.dist)
    if (!nearLeafCenter) {
      return { kind: 'stemPoint', stemId: bestStemPt.stemId, pointIdx: bestStemPt.pointIdx }
    }
  }

  // 2. Reverse z-order check across leaves & stems
  type HitItem = { kind: 'leaf'; z: number; inst: VectorLeafInstance } | { kind: 'stem'; z: number; stem: VectorStem }
  const items: HitItem[] = [
    ...instances.map(inst => ({ kind: 'leaf' as const, z: inst.z ?? 0, inst })),
    ...stems.map(stem => ({ kind: 'stem' as const, z: stem.z ?? 0, stem })),
  ]
  items.sort((a, b) => b.z - a.z)

  for (const item of items) {
    if (item.kind === 'leaf') {
      const inst = item.inst
      const cosR = Math.cos(inst.rot), sinR = Math.sin(inst.rot)
      const dx = u - inst.x, dy = v - inst.y
      const lx = (dx * cosR + dy * sinR) / Math.max(0.02, inst.scaleX)
      const ly = (-dx * sinR + dy * cosR) / Math.max(0.02, inst.scaleY)
      // Elliptical blade bounds inside local [-0.5..0.5]^2 stamp
      if ((lx * lx) / (0.34 * 0.34) + (ly * ly) / (0.48 * 0.48) <= 1.0) {
        return { kind: 'leaf', id: inst.id }
      }
    } else {
      const st = item.stem
      for (let i = 0; i < st.points.length; i++) {
        if (Math.hypot(u - st.points[i][0], v - st.points[i][1]) <= 0.026) {
          return { kind: 'stemPoint', stemId: st.id, pointIdx: i }
        }
      }
      for (let s = 0; s <= 18; s++) {
        const [px, py] = evalStemPoint(st.points, s / 18)
        const rad = Math.max(0.016, lerp(st.widthStart, st.widthEnd, s / 18) * 1.6)
        if (Math.hypot(u - px, v - py) <= rad) {
          return { kind: 'stem', stemId: st.id }
        }
      }
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// 4. Exact O(N) Felzenszwalb-Huttenlocher EDT + Ink Outline Node
// ---------------------------------------------------------------------------
const EDT_INF = 1e12

function edt1d(f: Float32Array, d: Float32Array, v: Int32Array, z: Float32Array, n: number) {
  let k = 0
  v[0] = 0
  z[0] = -EDT_INF
  z[1] = EDT_INF
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = EDT_INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const dq = q - v[k]
    d[q] = dq * dq + f[v[k]]
  }
}

/** Exact O(w*h) 2D Euclidean Distance Transform from a binary seed mask (seed[i] = 1 -> dist 0). */
export function computeEdt2d(seedMask: Uint8Array, w: number, h: number, periodic = false): Float32Array {
  const maxDim = Math.max(w, h)
  const padDim = periodic ? maxDim * 2 : maxDim
  const f = new Float32Array(padDim)
  const d = new Float32Array(padDim)
  const v = new Int32Array(padDim)
  const z = new Float32Array(padDim + 1)
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)

  // Pass 1: Horizontal
  const hw = periodic ? Math.floor(w / 2) : 0
  const lenX = periodic ? w + hw * 2 : w
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < lenX; x++) {
      const sx = periodic ? mod(x - hw, w) : x
      f[x] = seedMask[row + sx] ? 0 : EDT_INF
    }
    edt1d(f, d, v, z, lenX)
    for (let x = 0; x < w; x++) tmp[row + x] = d[x + hw]
  }

  // Pass 2: Vertical
  const hh = periodic ? Math.floor(h / 2) : 0
  const lenY = periodic ? h + hh * 2 : h
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < lenY; y++) {
      const sy = periodic ? mod(y - hh, h) : y
      f[y] = tmp[sy * w + x]
    }
    edt1d(f, d, v, z, lenY)
    for (let y = 0; y < h; y++) out[y * w + x] = Math.sqrt(Math.max(0, d[y + hh]))
  }
  return out
}

export function evalInkOutline(
  p: Record<string, unknown>,
  inputs: Record<string, ImageBuffer | undefined>,
  w: number,
  h: number,
  seamless: boolean,
): Record<string, ImageBuffer> {
  const src = toRgbaLocal(inputs.input, w, h, 0)
  const labelBuf = inputs.label?.kind === 'label' ? inputs.label : undefined
  const scale = w / 512
  const outerWidth = num(p, 'outerWidth', 2.5) * scale
  const position = str(p, 'position', 'center')
  const outerCol = hexToRgb01(str(p, 'outerColor', '#1f421f'))
  const outerOpacity = clamp01(num(p, 'outerOpacity', 0.92))
  const innerWidth = num(p, 'innerWidth', 1.5) * scale
  const innerCol = hexToRgb01(str(p, 'innerColor', '#224a23'))
  const innerOpacity = clamp01(num(p, 'innerOpacity', 0.78))
  const softness = Math.max(0.25, num(p, 'softness', 1.0))

  const outRgba = makeRgba(w, h, 0, 0, 0, 0)
  outRgba.data.set(src.data)
  const maskBuf = makeGray(w, h, 0)

  // Fast exit when both outlines are disabled (e.g. flat lineless vine illustration!)
  if (outerWidth <= 0.02 && (innerWidth <= 0.02 || !labelBuf)) {
    return { rgba: outRgba, mask: maskBuf }
  }

  const n = w * h
  const sd = src.data
  const od = outRgba.data
  const md = maskBuf.data

  // 1. Outer Alpha Outline via exact dual EDT
  if (outerWidth > 0.02 && outerOpacity > 0.001) {
    const insideSeed = new Uint8Array(n)
    const outsideSeed = new Uint8Array(n)
    let anyIn = false, anyOut = false
    for (let i = 0, j = 3; i < n; i++, j += 4) {
      if (sd[j] >= 0.45) { insideSeed[i] = 1; anyIn = true }
      else { outsideSeed[i] = 1; anyOut = true }
    }
    if (anyIn && anyOut) {
      const distOut = computeEdt2d(insideSeed, w, h, seamless)  // 0 inside, >=1 outside
      const distIn = computeEdt2d(outsideSeed, w, h, seamless)  // 0 outside, >=1 inside
      const aa = Math.max(0.35, 0.55 * softness)

      for (let i = 0, off = 0; i < n; i++, off += 4) {
        let stroke = 0
        if (position === 'outside') {
          if (distOut[i] > 0) stroke = 1 - smoothstep(outerWidth - aa, outerWidth + aa, distOut[i] - 0.5)
          else if (distIn[i] <= 1.1) stroke = (1 - smoothstep(0, 1.1, distIn[i] - 0.5)) * 0.45
        } else if (position === 'inside') {
          if (sd[off + 3] > 0.1) stroke = 1 - smoothstep(outerWidth - aa, outerWidth + aa, Math.max(0, distIn[i] - 0.5))
        } else {
          // center: boundary lies halfway between adjacent inside (-0.5) and outside (+0.5) pixels
          const halfW = outerWidth * 0.5
          const absD = distOut[i] > 0 ? (distOut[i] - 0.5) : Math.max(0, distIn[i] - 0.5)
          stroke = 1 - smoothstep(halfW - aa, halfW + aa, absD)
        }
        const stA = clamp01(stroke * outerOpacity)
        if (stA <= 0.002) continue
        md[i] = Math.max(md[i], stA)
        const baseA = od[off + 3]
        const nextA = stA + baseA * (1 - stA)
        if (nextA > 1e-5) {
          od[off] = (outerCol[0] * stA + od[off] * baseA * (1 - stA)) / nextA
          od[off + 1] = (outerCol[1] * stA + od[off + 1] * baseA * (1 - stA)) / nextA
          od[off + 2] = (outerCol[2] * stA + od[off + 2] * baseA * (1 - stA)) / nextA
          od[off + 3] = nextA
        }
      }
    }
  }

  // 2. Inner Overlap Ink Linework strictly from non-interpolated integer labelMap boundaries!
  if (innerWidth > 0.02 && innerOpacity > 0.001 && labelBuf) {
    const ld = labelBuf.data
    const seamSeed = new Uint8Array(n)
    let hasSeam = false
    for (let y = 0; y < h; y++) {
      const row = y * w
      for (let x = 0; x < w; x++) {
        const idx = row + x
        const cur = ld[idx]
        if (cur === 0) continue
        const rgt = x + 1 < w ? ld[idx + 1] : 0
        const bot = y + 1 < h ? ld[idx + w] : 0
        if ((rgt !== 0 && rgt !== cur) || (bot !== 0 && bot !== cur)) {
          seamSeed[idx] = 1
          hasSeam = true
        }
      }
    }
    if (hasSeam) {
      const distSeam = computeEdt2d(seamSeed, w, h, false)
      const halfIn = Math.max(0.35, innerWidth * 0.5)
      const aa = Math.max(0.35, 0.55 * softness)
      for (let i = 0, off = 0; i < n; i++, off += 4) {
        if (sd[off + 3] < 0.25) continue
        const st = (1 - smoothstep(halfIn - aa, halfIn + aa, distSeam[i])) * innerOpacity * smoothstep(0.25, 0.75, sd[off + 3])
        if (st <= 0.002) continue
        md[i] = Math.max(md[i], st)
        od[off] = lerp(od[off], innerCol[0], st)
        od[off + 1] = lerp(od[off + 1], innerCol[1], st)
        od[off + 2] = lerp(od[off + 2], innerCol[2], st)
      }
    }
  }

  return { rgba: outRgba, mask: maskBuf }
}

// ---------------------------------------------------------------------------
// 5. Curvature & Low-Cost / Horizon AO (Bark Ridge Wear & Crevice Moss Masks)
// ---------------------------------------------------------------------------
function separableBoxBlurGray(src: Float32Array, w: number, h: number, radius: number, seamless: boolean): Float32Array {
  const r = Math.max(1, Math.min(Math.floor(Math.min(w, h) / 4), Math.round(radius)))
  const tmp = new Float32Array(w * h)
  const dst = new Float32Array(w * h)
  const inv = 1 / (2 * r + 1)

  // Horizontal sliding window O(w*h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    for (let dx = -r; dx <= r; dx++) {
      const sx = seamless ? mod(dx, w) : Math.max(0, Math.min(w - 1, dx))
      sum += src[row + sx]
    }
    tmp[row] = sum * inv
    for (let x = 1; x < w; x++) {
      const addX = seamless ? mod(x + r, w) : Math.min(w - 1, x + r)
      const subX = seamless ? mod(x - r - 1, w) : Math.max(0, x - r - 1)
      sum += src[row + addX] - src[row + subX]
      tmp[row + x] = sum * inv
    }
  }

  // Vertical sliding window O(w*h)
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let dy = -r; dy <= r; dy++) {
      const sy = seamless ? mod(dy, h) : Math.max(0, Math.min(h - 1, dy))
      sum += tmp[sy * w + x]
    }
    dst[x] = sum * inv
    for (let y = 1; y < h; y++) {
      const addY = seamless ? mod(y + r, h) : Math.min(h - 1, y + r)
      const subY = seamless ? mod(y - r - 1, h) : Math.max(0, y - r - 1)
      sum += tmp[addY * w + x] - tmp[subY * w + x]
      dst[y * w + x] = sum * inv
    }
  }
  return dst
}

export function evalCurvatureAo(
  p: Record<string, unknown>,
  inputs: Record<string, ImageBuffer | undefined>,
  w: number,
  h: number,
  seamless: boolean,
): Record<string, ImageBuffer> {
  const srcH = toGrayLocal(inputs.height, w, h, 0.5)
  const maskIn = inputs.mask ? toGrayLocal(inputs.mask, w, h, 1) : undefined
  const scale = w / 512
  const radius = Math.max(1, num(p, 'radius', 5.5) * scale)
  const intensity = num(p, 'intensity', 1.85)
  const aoRadius = Math.max(2, num(p, 'aoRadius', 12) * scale)
  const aoStrength = num(p, 'aoStrength', 0.85)
  const aoMode = str(p, 'aoMode', 'fast')
  const bias = num(p, 'bias', 0.0)

  const hd = srcH.data
  const n = w * h
  // 2-pass box blur approximates smooth Gaussian without ringing
  const blurFine = separableBoxBlurGray(hd, w, h, Math.max(1, radius * 0.45), seamless)
  const blurMain = separableBoxBlurGray(
    separableBoxBlurGray(hd, w, h, radius, seamless),
    w, h, Math.max(1, radius * 0.65), seamless,
  )

  const ao = makeGray(w, h, 1)
  const convex = makeGray(w, h, 0)
  const concave = makeGray(w, h, 0)
  const ad = ao.data, cvx = convex.data, cnc = concave.data

  for (let i = 0; i < n; i++) {
    const valid = maskIn ? maskIn.data[i] : 1
    if (valid < 0.05) {
      cvx[i] = 0; cnc[i] = 0; ad[i] = 1
      continue
    }
    const diff = ((hd[i] - blurMain[i]) * 0.68 + (hd[i] - blurFine[i]) * 0.32) * intensity * 3.2 + bias
    cvx[i] = clamp01(diff) * valid
    cnc[i] = clamp01(-diff) * valid
  }

  if (aoMode === 'horizon') {
    // 8-direction x 4-step physical-scale Horizon AO (masked against transparent pixels!)
    const dirs: [number, number][] = [
      [1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071],
      [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071],
    ]
    const steps = 4
    const hScale = 12 * scale
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x
        const valid = maskIn ? maskIn.data[idx] : 1
        if (valid < 0.05) { ad[idx] = 1; continue }
        const h0 = hd[idx]
        let occ = 0
        for (let d = 0; d < 8; d++) {
          const dx = dirs[d][0], dy = dirs[d][1]
          let maxSin = 0
          for (let s = 1; s <= steps; s++) {
            const dist = (aoRadius * s) / steps
            const sx = seamless ? mod(Math.round(x + dx * dist), w) : Math.max(0, Math.min(w - 1, Math.round(x + dx * dist)))
            const sy = seamless ? mod(Math.round(y + dy * dist), h) : Math.max(0, Math.min(h - 1, Math.round(y + dy * dist)))
            const sIdx = sy * w + sx
            if (maskIn && maskIn.data[sIdx] < 0.1) continue
            const dh = (hd[sIdx] - h0) * hScale
            if (dh > 0) {
              const sinA = dh / Math.hypot(dist, dh)
              if (sinA > maxSin) maxSin = sinA
            }
          }
          occ += maxSin
        }
        ad[idx] = clamp01(1 - (occ / 8) * aoStrength * 1.45)
      }
    }
  } else {
    // Ultra-fast O(N) 3-scale separable ambient difference AO (ideal for 60fps interactive bark sculpting!)
    const ao1 = separableBoxBlurGray(hd, w, h, Math.max(1, aoRadius * 0.35), seamless)
    const ao2 = separableBoxBlurGray(hd, w, h, Math.max(2, aoRadius * 0.8), seamless)
    const ao3 = separableBoxBlurGray(ao2, w, h, Math.max(2, aoRadius * 1.15), seamless)
    for (let i = 0; i < n; i++) {
      const valid = maskIn ? maskIn.data[i] : 1
      if (valid < 0.05) { ad[i] = 1; continue }
      const amb = ao1[i] * 0.35 + ao2[i] * 0.35 + ao3[i] * 0.30
      const sink = Math.max(0, amb - hd[i])
      ad[i] = clamp01(1 - sink * aoStrength * 3.4)
    }
  }

  return { ao, convex, concave }
}

// ---------------------------------------------------------------------------
// 6. CIELAB Perceptual Palette Map (Flat Vector / Cel / Stylized Bark Lock)
// ---------------------------------------------------------------------------
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function rgb01ToLab(r: number, g: number, b: number): [number, number, number] {
  const rl = srgbToLinear(clamp01(r))
  const gl = srgbToLinear(clamp01(g))
  const bl = srgbToLinear(clamp01(b))
  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047
  const y = (0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl) / 1.00000
  const z = (0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(x), fy = f(y), fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export function evalPaletteMap(
  p: Record<string, unknown>,
  inputs: Record<string, ImageBuffer | undefined>,
  w: number,
  h: number,
): Record<string, ImageBuffer> {
  const src = toRgbaLocal(inputs.input, w, h, 1)
  const rawPal = Array.isArray(p.palette) && p.palette.length >= 2 ? p.palette as string[] : defaultBarkPalette
  const strength = clamp01(num(p, 'strength', 0.85))
  const softness = clamp01(num(p, 'softness', 0.25))
  const preserveLuma = clamp01(num(p, 'preserveLuma', 0.35))

  const palRgb = rawPal.map(hexToRgb01)
  const palLab = palRgb.map(([r, g, b]) => rgb01ToLab(r, g, b))
  const palLuma = palRgb.map(([r, g, b]) => Math.max(0.03, 0.2126 * r + 0.7152 * g + 0.0722 * b))
  const k = palRgb.length

  const out = makeRgba(w, h, 0, 0, 0, 0)
  const s = src.data, d = out.data

  for (let i = 0; i < d.length; i += 4) {
    const a = s[i + 3]
    if (a < 0.005 || strength <= 0.001) {
      d[i] = s[i]; d[i + 1] = s[i + 1]; d[i + 2] = s[i + 2]; d[i + 3] = a
      continue
    }
    const r = s[i], g = s[i + 1], b = s[i + 2]
    const [L, A, B] = rgb01ToLab(r, g, b)

    let bestIdx = 0, secondIdx = 1
    let bestD2 = Infinity, secondD2 = Infinity
    for (let c = 0; c < k; c++) {
      const dL = L - palLab[c][0]
      const dA = A - palLab[c][1]
      const dB = B - palLab[c][2]
      const dist2 = dL * dL + dA * dA + dB * dB
      if (dist2 < bestD2) {
        secondD2 = bestD2; secondIdx = bestIdx
        bestD2 = dist2; bestIdx = c
      } else if (dist2 < secondD2) {
        secondD2 = dist2; secondIdx = c
      }
    }

    let mr = palRgb[bestIdx][0], mg = palRgb[bestIdx][1], mb = palRgb[bestIdx][2]
    let mLuma = palLuma[bestIdx]
    if (softness > 0.01 && secondD2 < Infinity) {
      const d1 = Math.sqrt(bestD2), d2 = Math.sqrt(secondD2)
      const margin = (d2 - d1) / (d2 + d1 + 1e-4)
      const mix2 = (1 - smoothstep(0, softness * 0.75, margin)) * 0.5
      if (mix2 > 0.001) {
        mr = lerp(mr, palRgb[secondIdx][0], mix2)
        mg = lerp(mg, palRgb[secondIdx][1], mix2)
        mb = lerp(mb, palRgb[secondIdx][2], mix2)
        mLuma = lerp(mLuma, palLuma[secondIdx], mix2)
      }
    }

    if (preserveLuma > 0.001) {
      const origLuma = Math.max(0.02, 0.2126 * r + 0.7152 * g + 0.0722 * b)
      const ratio = clamp01(lerp(1, origLuma / mLuma, preserveLuma) * 0.5) * 2
      mr = clamp01(mr * ratio)
      mg = clamp01(mg * ratio)
      mb = clamp01(mb * ratio)
    }

    d[i] = lerp(r, mr, strength)
    d[i + 1] = lerp(g, mg, strength)
    d[i + 2] = lerp(b, mb, strength)
    d[i + 3] = a
  }

  return { out }
}

// ---------------------------------------------------------------------------
// 7. Non-Uniform Asymmetric Atlas Compose (`atlas_compose`, Phase 3)
// ---------------------------------------------------------------------------
export function resolveAtlasRegions(p: Record<string, unknown>, refSize = 512): AtlasRegion[] {
  const layout = str(p, 'layout', 'asymmetric_4big_4small')
  const padPx = Math.max(2, Math.min(20, Math.round(num(p, 'paddingPx', 8))))
  const padNorm = padPx / Math.max(128, refSize)

  if (layout === 'custom' && Array.isArray(p.regions) && p.regions.length > 0) {
    return (p.regions as AtlasRegion[]).map((r, i) => ({
      id: typeof r.id === 'string' && r.id ? r.id : `reg-${i + 1}`,
      x: clamp01(Number(r.x) || 0),
      y: clamp01(Number(r.y) || 0),
      w: Math.max(0.05, Math.min(1, Number(r.w) || 0.25)),
      h: Math.max(0.05, Math.min(1, Number(r.h) || 0.25)),
      padding: Math.max(0.002, Math.min(0.05, Number(r.padding) || padNorm)),
      slot: Math.max(0, Math.min(3, Math.round(Number(r.slot) || 0))),
      anchorX: r.anchorX ?? 0.5,
      anchorY: r.anchorY ?? 0.85,
      weight: r.weight ?? 1,
      role: r.role ?? 'canopy',
    }))
  }

  if (layout === 'grid_2x2' || layout === 'grid_3x2') {
    const cols = layout === 'grid_3x2' ? 3 : 2
    const rows = 2
    const gutter = Math.max(0.012, padNorm * 1.1)
    const cw = (1 - gutter * (cols + 1)) / cols
    const ch = (1 - gutter * (rows + 1)) / rows
    const out: AtlasRegion[] = []
    let idx = 0
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        out.push({
          id: `reg-g-${r + 1}-${c + 1}`,
          x: Number((gutter + c * (cw + gutter)).toFixed(4)),
          y: Number((gutter + r * (ch + gutter)).toFixed(4)),
          w: Number(cw.toFixed(4)),
          h: Number(ch.toFixed(4)),
          padding: Number(padNorm.toFixed(4)),
          slot: idx % 4,
          anchorX: 0.5,
          anchorY: 0.85,
          weight: 1.0,
          role: 'canopy',
        })
        idx++
      }
    }
    return out
  }

  // Default: `asymmetric_4big_4small` (4 large canopy clusters + 4 small accent sprigs, zero overlap!)
  return defaultAsymmetricAtlasRegions.map(r => ({
    ...r,
    padding: Number(Math.min(Math.min(r.w, r.h) * 0.14, padNorm).toFixed(4)),
  }))
}

export function evalAtlasCompose(
  p: Record<string, unknown>,
  inputs: Record<string, ImageBuffer | undefined>,
  w: number,
  h: number,
): Record<string, ImageBuffer> {
  const rgba = makeRgba(w, h, 0, 0, 0, 0)
  const height = makeGray(w, h, 0)
  const label = makeLabel(w, h)
  const regions = resolveAtlasRegions(p, w)
  const colorVar = clamp01(num(p, 'colorVar', 0.12))
  const seed = Math.round(num(p, 'seed', 708))

  // Resolve up to 4 input slots (fallback gracefully to slotA or default procedural leaf if unwired)
  let fallback: { rgba: RgbaBuffer; height: GrayBuffer } | undefined
  const getFallback = () => {
    if (!fallback) {
      const sz = Math.min(256, Math.max(128, Math.round(w * 0.5)))
      const res = evalCustomLeaf({ length: 0.86, width: 0.62, veinStrength: 0.22 }, sz, sz)
      fallback = { rgba: res.rgba as RgbaBuffer, height: res.height as GrayBuffer }
    }
    return fallback
  }

  const slotEntries: ({ rgba: RgbaBuffer; height: GrayBuffer } | undefined)[] = [
    ['slotA', 'heightA'], ['slotB', 'heightB'], ['slotC', 'heightC'], ['slotD', 'heightD'],
  ].map(([rk, hk]) => {
    const rb = inputs[rk]
    if (!rb || (rb.kind !== 'rgba' && rb.kind !== 'gray')) return undefined
    const rgbaBuf = toRgbaLocal(rb, rb.width, rb.height, 1)
    const hb = inputs[hk]
    return {
      rgba: rgbaBuf,
      height: hb && hb.kind !== 'label'
        ? toGrayLocal(hb, rgbaBuf.width, rgbaBuf.height, 0.5)
        : (rb.kind === 'gray' ? rb : toGrayLocal(rgbaBuf, rgbaBuf.width, rgbaBuf.height, 0.5)),
    }
  })

  const firstValid = slotEntries.find(Boolean) ?? getFallback()
  const accentFallback = slotEntries[2] ?? slotEntries[3] ?? slotEntries[1] ?? firstValid
  const rd = rgba.data, hd = height.data, ld = label.data
  const samp: [number, number, number, number] = [0, 0, 0, 0]

  regions.forEach((reg, idx) => {
    // Pick wired input slot; for `accent` role prefer slotC/slotD when wired!
    const chosen = reg.role === 'accent'
      ? (slotEntries[reg.slot >= 2 ? reg.slot : 2 + (reg.slot & 1)] ?? accentFallback)
      : (slotEntries[reg.slot] ?? slotEntries[reg.slot & 1] ?? firstValid)

    const padX = Math.min(reg.w * 0.16, reg.padding)
    const padY = Math.min(reg.h * 0.16, reg.padding)
    const innerX0 = reg.x + padX
    const innerY0 = reg.y + padY
    const innerW = Math.max(0.01, reg.w - padX * 2)
    const innerH = Math.max(0.01, reg.h - padY * 2)

    // Deterministic per-region organic variation (subtle mirror, slight tilt, warm/cool shift)
    const hVal = Math.sin((idx + 1) * 127.1 + seed * 0.173) * 43758.5453
    const frac = hVal - Math.floor(hVal)
    const hVal2 = Math.sin((idx + 1) * 269.5 + seed * 0.311) * 43758.5453
    const frac2 = hVal2 - Math.floor(hVal2)
    const mirror = (idx & 1) === 1
    const rot = (frac - 0.5) * 0.34
    const cosR = Math.cos(rot), sinR = Math.sin(rot)
    const shadeMul = 1 + (frac2 - 0.5) * colorVar * 1.4
    const warmShift = (frac - 0.5) * colorVar * 0.65

    // Strict pixel bounding box clipped to region rect (zero bleeding into neighboring regions!)
    const px0 = Math.max(0, Math.floor(reg.x * w))
    const px1 = Math.min(w - 1, Math.ceil((reg.x + reg.w) * w) - 1)
    const py0 = Math.max(0, Math.floor(reg.y * h))
    const py1 = Math.min(h - 1, Math.ceil((reg.y + reg.h) * h) - 1)

    for (let py = py0; py <= py1; py++) {
      const v = (py + 0.5) / h
      const lv = (v - innerY0) / innerH
      if (lv < 0 || lv > 1) continue
      for (let px = px0; px <= px1; px++) {
        const u = (px + 0.5) / w
        const lu = (u - innerX0) / innerW
        if (lu < 0 || lu > 1) continue

        let su = (mirror ? 1 - lu : lu) - 0.5
        let sv = lv - 0.5
        const ru = su * cosR - sv * sinR + 0.5
        const rv = su * sinR + sv * cosR + 0.5
        if (ru < 0 || ru > 1 || rv < 0 || rv > 1) continue

        sampleRgbaBilinearClamped(chosen.rgba, ru, rv, samp)
        const a = samp[3]
        if (a <= 0.004) continue

        const pIdx = py * w + px
        const off = pIdx * 4
        rd[off] = clamp01(samp[0] * shadeMul * (1 + warmShift * 0.5))
        rd[off + 1] = clamp01(samp[1] * shadeMul * (1 + warmShift * 0.15))
        rd[off + 2] = clamp01(samp[2] * shadeMul * (1 - warmShift * 0.45))
        rd[off + 3] = a
        hd[pIdx] = sampleGrayBilinearClamped(chosen.height, ru, rv)
        if (a >= 0.45) ld[pIdx] = idx + 1
      }
    }
  })

  return { rgba, height, label }
}
