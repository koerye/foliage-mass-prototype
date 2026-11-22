// Headless Multi-Metric Reference Image Scorer, Cached Feature Extractor & 4-Panel Visual Diagnostic Sheet.
// Shared identically across Browser, Web Worker, Vitest, and Node CLI (zero DOM dependencies).
import {
  clamp01, clampByte, deltaE00, extractLabPalette, resizeImageData,
  rgbToHsv, srgbToLab, type RgbaImageData,
} from './image-utils'
import { computeEdt2d } from './nodes-v2'

export const SCORER_VERSION = '2.0'

export type ScoreMode = 'figurative' | 'bark_tile'

export interface BarkStats {
  orientHist: Float32Array // 3 scales * 8 bins = 24
  dominantAngleDeg: number
  anisotropy: number
  corrLenX: number
  corrLenY: number
  creviceArea20: number
  creviceArea35: number
  creviceCompDensity: number
  creviceElongation: number
  creviceContrast: number
  labQuantiles: Float32Array // 3 * 9 = 27
  labCov: Float32Array // [varL, varA, varB, covLA, covLB, covAB]
  mossCoverage: number
  mossCoherence: number
  seamRatioX: number
  seamRatioY: number
}

export interface ImageFeatureEntry {
  width: number
  height: number
  img: RgbaImageData
  lab: Float32Array
  luma: Float32Array
  alphaBin: Uint8Array
  alphaCoverage: number
  contourSeed: Uint8Array
  contourDist: Float32Array
  edgeSeed: Uint8Array
  edgeDist: Float32Array
  quadStats: Float32Array // 16 cells * 4 [cov, L, a, b]
  palette: { hex: string; lab: [number, number, number]; weight: number }[]
  barkStats?: BarkStats
}

export interface ScoreBreakdown {
  scorerVersion: string
  mode: ScoreMode
  resolution: number
  totalScore: number // 0..100
  hardGatesPassed: boolean
  hardGateIssues: string[]
  diagnostics: string[]
  scoreMs: number
  // Figurative metrics (present when mode === 'figurative')
  alphaIoU?: number
  contourF1?: number
  labDeltaE00Median?: number
  labDeltaE00Mean?: number
  paletteDeltaE00?: number
  edgeF1?: number
  lightBalance?: number
  refCoverage?: number
  genCoverage?: number
  // Bark tile metrics (present when mode === 'bark_tile')
  orientationScore?: number
  dominantAngleErrDeg?: number
  scaleScore?: number
  corrLenErrRatio?: number
  creviceScore?: number
  labDistScore?: number
  mossScore?: number
  mossCoverageRef?: number
  mossCoverageGen?: number
  mossCoverageErr?: number
  seamRatioX?: number
  seamRatioY?: number
  seamPassed?: boolean
}

export class RefFeatureCache {
  private readonly entries = new Map<string, ImageFeatureEntry>()
  constructor(public readonly source: RgbaImageData) {}

  get(resolution: number, mode: ScoreMode): ImageFeatureEntry {
    const key = `${resolution}:${mode}`
    const hit = this.entries.get(key)
    if (hit) return hit
    const resized = resizeImageData(this.source, resolution, resolution)
    const entry = extractImageFeatures(resized, mode)
    this.entries.set(key, entry)
    return entry
  }
}

const mod = (a: number, n: number) => ((a % n) + n) % n

function boxBlurPeriodic(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const r = Math.max(1, Math.min(Math.floor(Math.min(w, h) / 4), Math.round(radius)))
  const tmp = new Float32Array(w * h)
  const dst = new Float32Array(w * h)
  const inv = 1 / (2 * r + 1)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let s = 0
    for (let dx = -r; dx <= r; dx++) s += src[row + mod(dx, w)]
    tmp[row] = s * inv
    for (let x = 1; x < w; x++) {
      s += src[row + mod(x + r, w)] - src[row + mod(x - r - 1, w)]
      tmp[row + x] = s * inv
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0
    for (let dy = -r; dy <= r; dy++) s += tmp[mod(dy, h) * w + x]
    dst[x] = s * inv
    for (let y = 1; y < h; y++) {
      s += tmp[mod(y + r, h) * w + x] - tmp[mod(y - r - 1, h) * w + x]
      dst[y * w + x] = s * inv
    }
  }
  return dst
}

function quantiles(vals: Float32Array, qs: number[]): number[] {
  const sorted = Float32Array.from(vals).sort()
  const n = sorted.length
  if (n === 0) return qs.map(() => 0)
  return qs.map(q => sorted[Math.min(n - 1, Math.max(0, Math.floor(q * (n - 1))))])
}

function computePeriodicCorrLen(luma: Float32Array, w: number, h: number): [number, number] {
  const n = w * h
  let mean = 0
  for (let i = 0; i < n; i++) mean += luma[i]
  mean /= Math.max(1, n)
  let variance = 0
  for (let i = 0; i < n; i++) {
    const d = luma[i] - mean
    variance += d * d
  }
  variance /= Math.max(1, n)
  if (variance < 1e-6) return [w * 0.5, h * 0.5]

  const maxLagX = Math.max(4, Math.floor(w * 0.35))
  const maxLagY = Math.max(4, Math.floor(h * 0.35))
  const stride = w > 128 ? 2 : 1

  let lenX = maxLagX
  let prevC = 1
  for (let dx = 1; dx <= maxLagX; dx++) {
    let acc = 0, cnt = 0
    for (let y = 0; y < h; y += stride) {
      const row = y * w
      for (let x = 0; x < w; x += stride) {
        acc += (luma[row + x] - mean) * (luma[row + ((x + dx) % w)] - mean)
        cnt++
      }
    }
    const c = (acc / Math.max(1, cnt)) / variance
    if (c <= 0.5) {
      const frac = prevC > c ? (prevC - 0.5) / (prevC - c) : 0
      lenX = (dx - 1) + frac
      break
    }
    prevC = c
  }

  let lenY = maxLagY
  prevC = 1
  for (let dy = 1; dy <= maxLagY; dy++) {
    let acc = 0, cnt = 0
    for (let y = 0; y < h; y += stride) {
      const rowA = y * w
      const rowB = ((y + dy) % h) * w
      for (let x = 0; x < w; x += stride) {
        acc += (luma[rowA + x] - mean) * (luma[rowB + x] - mean)
        cnt++
      }
    }
    const c = (acc / Math.max(1, cnt)) / variance
    if (c <= 0.5) {
      const frac = prevC > c ? (prevC - 0.5) / (prevC - c) : 0
      lenY = (dy - 1) + frac
      break
    }
    prevC = c
  }

  // Normalize correlation lengths to fraction of image size (resolution invariant!)
  return [lenX / w, lenY / h]
}

function computePeriodicCreviceGeometry(
  luma: Float32Array,
  w: number,
  h: number,
): { area20: number; area35: number; compDensity: number; elongation: number; contrast: number } {
  const n = w * h
  const smooth = boxBlurPeriodic(luma, w, h, Math.max(1, Math.round(w / 64)))
  const macro = boxBlurPeriodic(smooth, w, h, Math.max(3, Math.round(w / 14)))
  // Valley depth = how much darker local smooth luma is than macro neighborhood
  const valley = new Float32Array(n)
  let sumPos = 0
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, macro[i] - smooth[i])
    valley[i] = v
    sumPos += v
  }
  const contrast = sumPos / Math.max(1, n)
  const [q20, q35] = quantiles(smooth, [0.20, 0.35])
  const mask20 = new Uint8Array(n)
  let cnt20 = 0, cnt35 = 0
  for (let i = 0; i < n; i++) {
    if (smooth[i] <= q20 + 0.015 && valley[i] > 0.025) { mask20[i] = 1; cnt20++ }
    if (smooth[i] <= q35 + 0.02 && valley[i] > 0.018) cnt35++
  }

  // Periodic Union-Find connected components on mask20 (handles wrap across tile seams!)
  const parent = new Int32Array(n).fill(-1)
  const find = (a: number) => {
    let r = a
    while (parent[r] !== r) r = parent[r]
    while (parent[a] !== r) { const nx = parent[a]; parent[a] = r; a = nx }
    return r
  }
  const unite = (a: number, b: number) => {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }
  for (let i = 0; i < n; i++) if (mask20[i]) parent[i] = i
  for (let y = 0; y < h; y++) {
    const row = y * w
    const nextRow = ((y + 1) % h) * w
    for (let x = 0; x < w; x++) {
      const idx = row + x
      if (!mask20[idx]) continue
      const rgt = row + ((x + 1) % w)
      const bot = nextRow + x
      if (mask20[rgt]) unite(idx, rgt)
      if (mask20[bot]) unite(idx, bot)
    }
  }

  // Compute periodic circular-variance elongation per component (completely wrap-safe!)
  const comps = new Map<number, { cnt: number; sxC: number; sxS: number; syC: number; syS: number }>()
  for (let y = 0; y < h; y++) {
    const ay = (y / h) * Math.PI * 2
    const cy = Math.cos(ay), sy = Math.sin(ay)
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      if (!mask20[idx]) continue
      const r = find(idx)
      const ax = (x / w) * Math.PI * 2
      let rec = comps.get(r)
      if (!rec) { rec = { cnt: 0, sxC: 0, sxS: 0, syC: 0, syS: 0 }; comps.set(r, rec) }
      rec.cnt++
      rec.sxC += Math.cos(ax); rec.sxS += Math.sin(ax)
      rec.syC += cy; rec.syS += sy
    }
  }

  const minPixels = Math.max(4, Math.round(n * 0.00035))
  let validComps = 0
  let elongSum = 0
  for (const c of comps.values()) {
    if (c.cnt < minPixels) continue
    validComps++
    const rx = Math.hypot(c.sxC, c.sxS) / c.cnt
    const ry = Math.hypot(c.syC, c.syS) / c.cnt
    const spreadX = Math.sqrt(Math.max(1e-5, -2 * Math.log(Math.max(1e-4, Math.min(0.9999, rx)))))
    const spreadY = Math.sqrt(Math.max(1e-5, -2 * Math.log(Math.max(1e-4, Math.min(0.9999, ry)))))
    elongSum += Math.min(6, spreadY / Math.max(0.02, spreadX))
  }

  const area20 = cnt20 / Math.max(1, n)
  const area35 = cnt35 / Math.max(1, n)
  const compDensity = validComps / Math.max(1, (w / 128) * (h / 128))
  const elongation = validComps > 0 ? elongSum / validComps : 1.0
  return { area20, area35, compDensity, elongation, contrast }
}

function computeBarkStats(img: RgbaImageData, lab: Float32Array, luma: Float32Array): BarkStats {
  const w = img.width, h = img.height, n = w * h
  const sd = img.data

  // 1. Multi-scale periodic orientation energy (3 scales x 8 bins)
  const scales = [Math.max(1, Math.round(w / 128)), Math.max(2, Math.round(w / 48)), Math.max(3, Math.round(w / 20))]
  const orientHist = new Float32Array(24)
  let cos2Sum = 0, sin2Sum = 0, magSum = 0

  scales.forEach((rad, sIdx) => {
    const field = rad <= 1 ? luma : boxBlurPeriodic(luma, w, h, rad)
    let scaleEnergy = 0
    for (let y = 0; y < h; y++) {
      const ym = mod(y - 1, h) * w
      const yc = y * w
      const yp = mod(y + 1, h) * w
      for (let x = 0; x < w; x++) {
        const xm = mod(x - 1, w)
        const xp = mod(x + 1, w)
        const gx = (field[ym + xp] + 2 * field[yc + xp] + field[yp + xp])
          - (field[ym + xm] + 2 * field[yc + xm] + field[yp + xm])
        const gy = (field[yp + xm] + 2 * field[yp + x] + field[yp + xp])
          - (field[ym + xm] + 2 * field[ym + x] + field[ym + xp])
        const mag = Math.hypot(gx, gy)
        if (mag < 1e-4) continue
        // Tangent orientation (perpendicular to gradient): vertical bark ridges have horizontal gradient -> tangent angle ~90°
        let ang = Math.atan2(gx, -gy)
        if (ang < 0) ang += Math.PI
        const bin = Math.min(7, Math.floor((ang / Math.PI) * 8))
        orientHist[sIdx * 8 + bin] += mag
        scaleEnergy += mag
        if (sIdx === 1) {
          cos2Sum += Math.cos(2 * ang) * mag
          sin2Sum += Math.sin(2 * ang) * mag
          magSum += mag
        }
      }
    }
    if (scaleEnergy > 1e-6) {
      for (let b = 0; b < 8; b++) orientHist[sIdx * 8 + b] /= scaleEnergy
    }
  })

  const dominantAngleDeg = magSum > 1e-6 ? (((0.5 * Math.atan2(sin2Sum, cos2Sum) * 180) / Math.PI) + 180) % 180 : 90
  const anisotropy = magSum > 1e-6 ? Math.hypot(cos2Sum, sin2Sum) / magSum : 0

  // 2. Periodic autocorrelation length
  const [corrLenX, corrLenY] = computePeriodicCorrLen(luma, w, h)

  // 3. Multi-threshold periodic crevice geometry
  const crev = computePeriodicCreviceGeometry(luma, w, h)

  // 4. Lab 9-quantile distribution + covariance
  const Ls = new Float32Array(n), As = new Float32Array(n), Bs = new Float32Array(n)
  let mL = 0, mA = 0, mB = 0
  for (let i = 0; i < n; i++) {
    const L = lab[i * 3], A = lab[i * 3 + 1], B = lab[i * 3 + 2]
    Ls[i] = L; As[i] = A; Bs[i] = B
    mL += L; mA += A; mB += B
  }
  mL /= n; mA /= n; mB /= n
  let vL = 0, vA = 0, vB = 0, cLA = 0, cLB = 0, cAB = 0
  for (let i = 0; i < n; i++) {
    const dL = Ls[i] - mL, dA = As[i] - mA, dB = Bs[i] - mB
    vL += dL * dL; vA += dA * dA; vB += dB * dB
    cLA += dL * dA; cLB += dL * dB; cAB += dA * dB
  }
  const qs = [0.05, 0.15, 0.25, 0.35, 0.5, 0.65, 0.75, 0.85, 0.95]
  const labQuantiles = new Float32Array([...quantiles(Ls, qs), ...quantiles(As, qs), ...quantiles(Bs, qs)])
  const labCov = Float32Array.from([vL / n, vA / n, vB / n, cLA / n, cLB / n, cAB / n])

  // 5. Moss coverage + spatial patch coherence (separates moss islands from uniform green tint/speckle)
  const mossMask = new Uint8Array(n)
  let mossCount = 0
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const [hue, sat, val] = rgbToHsv(sd[o] / 255, sd[o + 1] / 255, sd[o + 2] / 255)
    const a = lab[i * 3 + 1]
    if (hue >= 56 && hue <= 162 && sat >= 0.20 && val >= 0.12 && a < -7) {
      mossMask[i] = 1
      mossCount++
    }
  }
  let sameNbr = 0
  for (let y = 0; y < h; y++) {
    const row = y * w
    const nextRow = ((y + 1) % h) * w
    for (let x = 0; x < w; x++) {
      const idx = row + x
      if (!mossMask[idx]) continue
      if (mossMask[row + ((x + 1) % w)]) sameNbr++
      if (mossMask[row + mod(x - 1, w)]) sameNbr++
      if (mossMask[nextRow + x]) sameNbr++
      if (mossMask[mod(y - 1, h) * w + x]) sameNbr++
    }
  }
  const mossCoverage = mossCount / Math.max(1, n)
  const mossCoherence = mossCount > 0 ? sameNbr / (mossCount * 4) : 1

  // 6. Seam continuity gate (cross-seam gradient P95 vs interior adjacent gradient P95, both X and Y!)
  const seamGradsX = new Float32Array(h)
  const seamGradsY = new Float32Array(w)
  const intGradsX = new Float32Array(h * Math.min(32, w - 1))
  const intGradsY = new Float32Array(w * Math.min(32, h - 1))
  const rgbDiff = (i1: number, i2: number) => {
    const o1 = i1 * 4, o2 = i2 * 4
    return Math.hypot(
      (sd[o1] - sd[o2]) / 255,
      (sd[o1 + 1] - sd[o2 + 1]) / 255,
      (sd[o1 + 2] - sd[o2 + 2]) / 255,
    )
  }
  const stepX = Math.max(1, Math.floor((w - 1) / 32))
  const stepY = Math.max(1, Math.floor((h - 1) / 32))
  let ix = 0
  for (let y = 0; y < h; y++) {
    const row = y * w
    seamGradsX[y] = rgbDiff(row, row + w - 1)
    for (let k = 0, x = 1; k < 32 && x < w - 1; k++, x += stepX) {
      if (ix < intGradsX.length) intGradsX[ix++] = rgbDiff(row + x, row + x + 1)
    }
  }
  let iy = 0
  for (let x = 0; x < w; x++) {
    seamGradsY[x] = rgbDiff(x, (h - 1) * w + x)
    for (let k = 0, y = 1; k < 32 && y < h - 1; k++, y += stepY) {
      if (iy < intGradsY.length) intGradsY[iy++] = rgbDiff(y * w + x, (y + 1) * w + x)
    }
  }
  const p95SeamX = quantiles(seamGradsX, [0.95])[0]
  const p95IntX = Math.max(0.03, quantiles(intGradsX.subarray(0, ix), [0.95])[0])
  const p95SeamY = quantiles(seamGradsY, [0.95])[0]
  const p95IntY = Math.max(0.03, quantiles(intGradsY.subarray(0, iy), [0.95])[0])

  return {
    orientHist,
    dominantAngleDeg,
    anisotropy,
    corrLenX,
    corrLenY,
    creviceArea20: crev.area20,
    creviceArea35: crev.area35,
    creviceCompDensity: crev.compDensity,
    creviceElongation: crev.elongation,
    creviceContrast: crev.contrast,
    labQuantiles,
    labCov,
    mossCoverage,
    mossCoherence,
    seamRatioX: p95SeamX / p95IntX,
    seamRatioY: p95SeamY / p95IntY,
  }
}

export function extractImageFeatures(img: RgbaImageData, mode: ScoreMode): ImageFeatureEntry {
  const w = img.width, h = img.height, n = w * h
  const sd = img.data
  const lab = new Float32Array(n * 3)
  const luma = new Float32Array(n)
  const alphaBin = new Uint8Array(n)
  const fgSamples: [number, number, number][] = []
  let fgCnt = 0
  const sampleStep = Math.max(1, Math.floor(n / 2400))

  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const r = sd[o] / 255, g = sd[o + 1] / 255, b = sd[o + 2] / 255
    const a = sd[o + 3]
    luma[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const [L, A, B] = srgbToLab(r, g, b)
    lab[i * 3] = L; lab[i * 3 + 1] = A; lab[i * 3 + 2] = B
    if (a >= 128) {
      alphaBin[i] = 1
      fgCnt++
      if (i % sampleStep === 0) fgSamples.push([L, A, B])
    }
  }

  const contourSeed = new Uint8Array(n)
  const edgeSeed = new Uint8Array(n)
  const quadStats = new Float32Array(16 * 4)

  if (mode === 'figurative') {
    for (let y = 0; y < h; y++) {
      const row = y * w
      const qy = Math.min(3, Math.floor((y * 4) / h))
      for (let x = 0; x < w; x++) {
        const idx = row + x
        const cur = alphaBin[idx]
        if (cur) {
          const lft = x > 0 ? alphaBin[idx - 1] : 0
          const rgt = x + 1 < w ? alphaBin[idx + 1] : 0
          const top = y > 0 ? alphaBin[idx - w] : 0
          const bot = y + 1 < h ? alphaBin[idx + w] : 0
          if (!lft || !rgt || !top || !bot) contourSeed[idx] = 1
          // Internal + external gradient edges
          if (x + 1 < w && y + 1 < h) {
            const dL1 = Math.abs(lab[idx * 3] - lab[(idx + 1) * 3]) + Math.abs(lab[idx * 3 + 1] - lab[(idx + 1) * 3 + 1]) * 0.8
            const dL2 = Math.abs(lab[idx * 3] - lab[(idx + w) * 3]) + Math.abs(lab[idx * 3 + 1] - lab[(idx + w) * 3 + 1]) * 0.8
            if (dL1 > 9.5 || dL2 > 9.5 || !rgt || !bot) edgeSeed[idx] = 1
          }
          const qx = Math.min(3, Math.floor((x * 4) / w))
          const qi = (qy * 4 + qx) * 4
          quadStats[qi] += 1
          quadStats[qi + 1] += lab[idx * 3]
          quadStats[qi + 2] += lab[idx * 3 + 1]
          quadStats[qi + 3] += lab[idx * 3 + 2]
        }
      }
    }
    const cellArea = Math.max(1, n / 16)
    for (let q = 0; q < 16; q++) {
      const qi = q * 4
      const c = quadStats[qi]
      if (c > 0) {
        quadStats[qi + 1] /= c
        quadStats[qi + 2] /= c
        quadStats[qi + 3] /= c
      }
      quadStats[qi] = c / cellArea
    }
  }

  const contourDist = mode === 'figurative' ? computeEdt2d(contourSeed, w, h, false) : new Float32Array(0)
  const edgeDist = mode === 'figurative' ? computeEdt2d(edgeSeed, w, h, false) : new Float32Array(0)
  const palette = extractLabPalette(fgSamples, 6, 12)
  const barkStats = mode === 'bark_tile' ? computeBarkStats(img, lab, luma) : undefined

  return {
    width: w,
    height: h,
    img,
    lab,
    luma,
    alphaBin,
    alphaCoverage: fgCnt / Math.max(1, n),
    contourSeed,
    contourDist,
    edgeSeed,
    edgeDist,
    quadStats,
    palette,
    barkStats,
  }
}

function bidirectionalMaskF1(
  seedA: Uint8Array, distA: Float32Array,
  seedB: Uint8Array, distB: Float32Array,
  tolPx: number,
): number {
  let aCnt = 0, aHit = 0, bCnt = 0, bHit = 0
  for (let i = 0; i < seedA.length; i++) {
    if (seedA[i]) { aCnt++; if (distB[i] <= tolPx) aHit++ }
    if (seedB[i]) { bCnt++; if (distA[i] <= tolPx) bHit++ }
  }
  if (aCnt === 0 && bCnt === 0) return 1
  if (aCnt === 0 || bCnt === 0) return 0
  const rec = aHit / aCnt
  const prec = bHit / bCnt
  return (rec + prec) > 1e-6 ? (2 * prec * rec) / (prec + rec) : 0
}

export function scoreAgainstReference(
  refCache: RefFeatureCache,
  genImgRaw: RgbaImageData,
  mode: ScoreMode,
  evalRes?: number,
): ScoreBreakdown {
  const t0 = performance.now()
  const res = evalRes ?? genImgRaw.width
  const ref = refCache.get(res, mode)
  const genImg = (genImgRaw.width === res && genImgRaw.height === res)
    ? genImgRaw
    : resizeImageData(genImgRaw, res, res)
  const gen = extractImageFeatures(genImg, mode)
  const diagnostics: string[] = []
  const hardGateIssues: string[] = []

  if (mode === 'bark_tile') {
    const rs = ref.barkStats!
    const gs = gen.barkStats!

    // 1. Multi-scale periodic orientation energy similarity
    let histL1 = 0
    for (let i = 0; i < 24; i++) histL1 += Math.abs(rs.orientHist[i] - gs.orientHist[i])
    const histSim = clamp01(1 - (histL1 / 6) * 0.9)
    let angDiff = Math.abs(rs.dominantAngleDeg - gs.dominantAngleDeg)
    if (angDiff > 90) angDiff = 180 - angDiff
    const angSim = rs.anisotropy < 0.08 ? 1 : clamp01(1 - angDiff / 45)
    const anisoSim = clamp01(1 - Math.abs(rs.anisotropy - gs.anisotropy) * 1.4)
    const orientationScore = clamp01(0.55 * histSim + 0.25 * angSim + 0.20 * anisoSim)

    // 2. Periodic autocorrelation scale match (separates fine noise & wrong scale!)
    const errX = Math.abs(gs.corrLenX - rs.corrLenX) / Math.max(0.012, rs.corrLenX)
    const errY = Math.abs(gs.corrLenY - rs.corrLenY) / Math.max(0.012, rs.corrLenY)
    const corrLenErrRatio = 0.5 * (errX + errY)
    const scaleScore = Math.exp(-corrLenErrRatio * 1.35)

    // 3. Periodic multi-threshold crevice geometry (kills histogram-matched noise & blurred mush!)
    const areaErr = Math.abs(gs.creviceArea20 - rs.creviceArea20) + Math.abs(gs.creviceArea35 - rs.creviceArea35)
    const densErr = Math.abs(Math.log((gs.creviceCompDensity + 1) / (rs.creviceCompDensity + 1)))
    const elongErr = Math.abs(gs.creviceElongation - rs.creviceElongation) / Math.max(0.5, rs.creviceElongation)
    const contrastErr = Math.abs(gs.creviceContrast - rs.creviceContrast) / Math.max(0.025, rs.creviceContrast)
    const creviceScore = clamp01(
      0.30 * Math.exp(-areaErr * 6)
      + 0.30 * Math.exp(-densErr * 1.1)
      + 0.20 * Math.exp(-elongErr * 1.2)
      + 0.20 * Math.exp(-contrastErr * 1.4),
    )

    // 4. Lab 9-quantile distribution + covariance match
    let qErrL = 0, qErrAB = 0
    for (let i = 0; i < 9; i++) {
      qErrL += Math.abs(rs.labQuantiles[i] - gs.labQuantiles[i]) / 9
      qErrAB += (Math.abs(rs.labQuantiles[9 + i] - gs.labQuantiles[9 + i]) + Math.abs(rs.labQuantiles[18 + i] - gs.labQuantiles[18 + i])) / 18
    }
    const stdErr = (
      Math.abs(Math.sqrt(Math.max(0, rs.labCov[0])) - Math.sqrt(Math.max(0, gs.labCov[0]))) / 16
      + Math.abs(Math.sqrt(Math.max(0, rs.labCov[1])) - Math.sqrt(Math.max(0, gs.labCov[1]))) / 14
      + Math.abs(Math.sqrt(Math.max(0, rs.labCov[2])) - Math.sqrt(Math.max(0, gs.labCov[2]))) / 14
    ) / 3
    const labDistScore = clamp01(0.52 * Math.exp(-qErrL / 14) + 0.30 * Math.exp(-qErrAB / 12) + 0.18 * Math.exp(-stdErr * 1.4))

    // 5. Moss coverage & patch clustering coherence (strongly penalizes speckled green noise!)
    const mossCoverageErr = Math.abs(gs.mossCoverage - rs.mossCoverage)
    const mossCohErr = rs.mossCoverage > 0.03 ? Math.abs(gs.mossCoherence - rs.mossCoherence) : 0
    const mossScore = clamp01(Math.exp(-mossCoverageErr * 5.2) * Math.exp(-mossCohErr * 3.8))

    // 6. Seamless tiling continuity gate
    const seamPassed = gs.seamRatioX <= 1.5 && gs.seamRatioY <= 1.5
    if (!seamPassed) hardGateIssues.push(`平铺接缝不连续（X:${gs.seamRatioX.toFixed(2)}x, Y:${gs.seamRatioY.toFixed(2)}x > 1.5x）`)
    if (rs.anisotropy >= 0.12 && angDiff > 15) hardGateIssues.push(`主纹理方向偏差 ${angDiff.toFixed(1)}° (> 15°)`)
    if (corrLenErrRatio > 0.35) hardGateIssues.push(`主尺度自相关长度偏差 ${(corrLenErrRatio * 100).toFixed(0)}% (> 35%)`)
    if (mossCoverageErr > 0.12) hardGateIssues.push(`苔藓占比偏差 ${(mossCoverageErr * 100).toFixed(1)} 个百分点 (> 12%)`)
    if (mossCohErr > 0.25) hardGateIssues.push(`苔藓斑块聚集度塌陷（差值 ${mossCohErr.toFixed(2)} > 0.25）`)

    // Structural gate prevents histogram-matched white noise or blurred mush from gaming color score!
    const structGate = clamp01(0.32 + 0.68 * Math.sqrt(Math.max(0, scaleScore * creviceScore)))
    let total = 100 * structGate * (
      0.24 * orientationScore
      + 0.22 * scaleScore
      + 0.20 * creviceScore
      + 0.22 * labDistScore
      + 0.12 * mossScore
    )
    if (!seamPassed) total *= 0.65

    // Actionable diagnostics
    if (gs.mossCoverage < rs.mossCoverage - 0.04) diagnostics.push(`苔藓面积偏少（生成 ${(gs.mossCoverage * 100).toFixed(1)}% vs 参考 ${(rs.mossCoverage * 100).toFixed(1)}%）`)
    else if (gs.mossCoverage > rs.mossCoverage + 0.04) diagnostics.push(`苔藓面积偏多（生成 ${(gs.mossCoverage * 100).toFixed(1)}% vs 参考 ${(rs.mossCoverage * 100).toFixed(1)}%）`)
    if (gs.corrLenX < rs.corrLenX * 0.78) diagnostics.push(`纹理横向过细密（需降低 scaleX）`)
    else if (gs.corrLenX > rs.corrLenX * 1.25) diagnostics.push(`纹理横向过宽疏（需提高 scaleX）`)
    if (gs.labQuantiles[4] < rs.labQuantiles[4] - 5) diagnostics.push(`整体偏暗（中位亮度 ${(gs.labQuantiles[4] - rs.labQuantiles[4]).toFixed(1)}L）`)
    else if (gs.labQuantiles[4] > rs.labQuantiles[4] + 5) diagnostics.push(`整体偏亮（中位亮度 +${(gs.labQuantiles[4] - rs.labQuantiles[4]).toFixed(1)}L）`)
    diagnostics.push(`接缝梯度比 X:${gs.seamRatioX.toFixed(2)}x / Y:${gs.seamRatioY.toFixed(2)}x（${seamPassed ? '通过' : '未通过'}）`)

    return {
      scorerVersion: SCORER_VERSION,
      mode,
      resolution: res,
      totalScore: Number(total.toFixed(2)),
      hardGatesPassed: hardGateIssues.length === 0,
      hardGateIssues,
      diagnostics,
      scoreMs: Number((performance.now() - t0).toFixed(2)),
      orientationScore: Number(orientationScore.toFixed(4)),
      dominantAngleErrDeg: Number(angDiff.toFixed(2)),
      scaleScore: Number(scaleScore.toFixed(4)),
      corrLenErrRatio: Number(corrLenErrRatio.toFixed(4)),
      creviceScore: Number(creviceScore.toFixed(4)),
      labDistScore: Number(labDistScore.toFixed(4)),
      mossScore: Number(mossScore.toFixed(4)),
      mossCoverageRef: Number(rs.mossCoverage.toFixed(4)),
      mossCoverageGen: Number(gs.mossCoverage.toFixed(4)),
      mossCoverageErr: Number(mossCoverageErr.toFixed(4)),
      seamRatioX: Number(gs.seamRatioX.toFixed(3)),
      seamRatioY: Number(gs.seamRatioY.toFixed(3)),
      seamPassed,
    }
  }

  // ---- Figurative Mode (Vine / Multi-color Cluster / Lush Bush / 2D Atlas) ----
  const n = res * res
  let inter = 0, union = 0
  const deSamples: number[] = []
  const deStride = Math.max(1, Math.floor(n / 6000))
  for (let i = 0; i < n; i++) {
    const rA = ref.alphaBin[i]
    const gA = gen.alphaBin[i]
    if (rA && gA) {
      inter++
      union++
      if (i % deStride === 0) {
        deSamples.push(deltaE00(
          ref.lab[i * 3], ref.lab[i * 3 + 1], ref.lab[i * 3 + 2],
          gen.lab[i * 3], gen.lab[i * 3 + 1], gen.lab[i * 3 + 2],
        ))
      }
    } else if (rA || gA) {
      union++
    }
  }
  const alphaIoU = union > 0 ? inter / union : 1
  const tolPx = Math.max(1.6, (3.0 * res) / 512)
  const contourF1 = bidirectionalMaskF1(ref.contourSeed, ref.contourDist, gen.contourSeed, gen.contourDist, tolPx)
  const edgeF1 = bidirectionalMaskF1(ref.edgeSeed, ref.edgeDist, gen.edgeSeed, gen.edgeDist, tolPx * 1.15)

  deSamples.sort((a, b) => a - b)
  const labDeltaE00Median = deSamples.length ? deSamples[Math.floor(deSamples.length * 0.5)] : 35
  const labDeltaE00Mean = deSamples.length ? deSamples.reduce((a, b) => a + b, 0) / deSamples.length : 35
  const colorScore = Math.exp(-labDeltaE00Median / 18)

  // Symmetric bidirectional Lab palette matching
  let palDistSum = 0
  for (const rc of ref.palette) {
    let best = 100
    for (const gc of gen.palette) {
      const d = deltaE00(rc.lab[0], rc.lab[1], rc.lab[2], gc.lab[0], gc.lab[1], gc.lab[2])
      if (d < best) best = d
    }
    palDistSum += best * rc.weight
  }
  let palDistRev = 0
  for (const gc of gen.palette) {
    let best = 100
    for (const rc of ref.palette) {
      const d = deltaE00(gc.lab[0], gc.lab[1], gc.lab[2], rc.lab[0], rc.lab[1], rc.lab[2])
      if (d < best) best = d
    }
    palDistRev += best * gc.weight
  }
  const paletteDeltaE00 = 0.5 * (palDistSum + palDistRev)
  const paletteScore = Math.exp(-paletteDeltaE00 / 12)

  // 4x4 Quadrant spatial luminance & coverage balance
  let quadErrSum = 0, quadValid = 0
  for (let q = 0; q < 16; q++) {
    const qi = q * 4
    const rCov = ref.quadStats[qi], gCov = gen.quadStats[qi]
    quadErrSum += Math.abs(rCov - gCov) * 1.6
    if (rCov > 0.05 && gCov > 0.05) {
      const dL = Math.abs(ref.quadStats[qi + 1] - gen.quadStats[qi + 1]) / 30
      const dAB = Math.hypot(ref.quadStats[qi + 2] - gen.quadStats[qi + 2], ref.quadStats[qi + 3] - gen.quadStats[qi + 3]) / 36
      quadErrSum += 0.5 * dL + 0.5 * dAB
      quadValid++
    }
  }
  const lightBalance = Math.exp(-(quadErrSum / Math.max(8, 8 + quadValid)) * 1.2)

  if (alphaIoU < 0.30) hardGateIssues.push(`前景 Alpha IoU 过低 (${(alphaIoU * 100).toFixed(1)}%)`)
  if (gen.alphaCoverage < 0.03) hardGateIssues.push('生成前景几乎为空')
  if (gen.alphaCoverage > 0.96) hardGateIssues.push('生成前景填满整画布，缺失留白')

  const structGate = Math.min(1, alphaIoU / 0.38)
  const total = 100 * structGate * (
    0.34 * alphaIoU
    + 0.24 * contourF1
    + 0.16 * colorScore
    + 0.12 * paletteScore
    + 0.08 * edgeF1
    + 0.06 * lightBalance
  )

  const covDiff = gen.alphaCoverage - ref.alphaCoverage
  if (covDiff < -0.04) diagnostics.push(`前景覆盖偏少 (${(covDiff * 100).toFixed(1)}%)`)
  else if (covDiff > 0.04) diagnostics.push(`前景覆盖偏多 (+${(covDiff * 100).toFixed(1)}%)`)
  if (labDeltaE00Median > 8) diagnostics.push(`重合前景中位色差 ΔE00=${labDeltaE00Median.toFixed(1)}`)
  if (paletteDeltaE00 > 5) diagnostics.push(`主色板色差 ΔE00=${paletteDeltaE00.toFixed(1)}`)
  if (contourF1 < 0.72) diagnostics.push(`轮廓贴合 F1@3px=${(contourF1 * 100).toFixed(1)}%`)

  return {
    scorerVersion: SCORER_VERSION,
    mode,
    resolution: res,
    totalScore: Number(total.toFixed(2)),
    hardGatesPassed: hardGateIssues.length === 0,
    hardGateIssues,
    diagnostics,
    scoreMs: Number((performance.now() - t0).toFixed(2)),
    alphaIoU: Number(alphaIoU.toFixed(4)),
    contourF1: Number(contourF1.toFixed(4)),
    labDeltaE00Median: Number(labDeltaE00Median.toFixed(2)),
    labDeltaE00Mean: Number(labDeltaE00Mean.toFixed(2)),
    paletteDeltaE00: Number(paletteDeltaE00.toFixed(2)),
    edgeF1: Number(edgeF1.toFixed(4)),
    lightBalance: Number(lightBalance.toFixed(4)),
    refCoverage: Number(ref.alphaCoverage.toFixed(4)),
    genCoverage: Number(gen.alphaCoverage.toFixed(4)),
  }
}

/**
 * Renders a crisp 2x2 visual diagnostic sheet (width = 2*size, height = 2*size):
 *   TL: Reference | TR: Generated
 *   BL: Perceptual Diff Heatmap | BR: 50% Split Wipe (figurative) or 2x2 Seamless Tile Check (bark)
 */
export function renderDiagnosticSheet(
  refImgRaw: RgbaImageData,
  genImgRaw: RgbaImageData,
  mode: ScoreMode,
  panelSize = 256,
): RgbaImageData {
  const ref = resizeImageData(refImgRaw, panelSize, panelSize)
  const gen = resizeImageData(genImgRaw, panelSize, panelSize)
  const W = panelSize * 2
  const H = panelSize * 2
  const out = new Uint8ClampedArray(W * H * 4)

  const writeOverChecker = (dstX: number, dstY: number, r: number, g: number, b: number, a: number) => {
    const checker = (((dstX >> 3) + (dstY >> 3)) & 1) === 0 ? 44 : 32
    const af = a / 255
    const o = (dstY * W + dstX) * 4
    out[o] = clampByte(r * af + checker * (1 - af))
    out[o + 1] = clampByte(g * af + checker * (1 - af))
    out[o + 2] = clampByte(b * af + checker * (1 - af))
    out[o + 3] = 255
  }

  for (let y = 0; y < panelSize; y++) {
    for (let x = 0; x < panelSize; x++) {
      const si = (y * panelSize + x) * 4
      const rr = ref.data[si], rg = ref.data[si + 1], rb = ref.data[si + 2], ra = ref.data[si + 3]
      const gr = gen.data[si], gg = gen.data[si + 1], gb = gen.data[si + 2], ga = gen.data[si + 3]

      // Top-Left: Reference
      writeOverChecker(x, y, rr, rg, rb, ra)
      // Top-Right: Generated
      writeOverChecker(panelSize + x, y, gr, gg, gb, ga)

      // Bottom-Left: Perceptual Diff Heatmap
      const blO = ((panelSize + y) * W + x) * 4
      if (mode === 'figurative') {
        const refOn = ra >= 128, genOn = ga >= 128
        if (refOn && !genOn) {
          // Missing reference foreground -> vivid warm red
          out[blO] = 232; out[blO + 1] = 56; out[blO + 2] = 66; out[blO + 3] = 255
        } else if (!refOn && genOn) {
          // Extra generated foreground -> vivid cool blue
          out[blO] = 48; out[blO + 1] = 136; out[blO + 2] = 242; out[blO + 3] = 255
        } else if (refOn && genOn) {
          const [L1, a1, b1] = srgbToLab(rr / 255, rg / 255, rb / 255)
          const [L2, a2, b2] = srgbToLab(gr / 255, gg / 255, gb / 255)
          const d = clamp01(Math.hypot(L1 - L2, a1 - a2, b1 - b2) / 38)
          // Low error = clean teal-green, high error = bright gold-orange
          out[blO] = clampByte(24 + d * 230)
          out[blO + 1] = clampByte(168 + d * 60 - d * d * 120)
          out[blO + 2] = clampByte(120 * (1 - d))
          out[blO + 3] = 255
        } else {
          out[blO] = 18; out[blO + 1] = 24; out[blO + 2] = 30; out[blO + 3] = 255
        }
      } else {
        // Bark: local Lab difference heatmap (note: unaligned tile pixel diff for local inspection)
        const [L1, a1, b1] = srgbToLab(rr / 255, rg / 255, rb / 255)
        const [L2, a2, b2] = srgbToLab(gr / 255, gg / 255, gb / 255)
        const d = clamp01(Math.hypot(L1 - L2, a1 - a2, b1 - b2) / 45)
        out[blO] = clampByte(24 + d * 228)
        out[blO + 1] = clampByte(58 + Math.sin(d * Math.PI) * 165)
        out[blO + 2] = clampByte(150 * (1 - d))
        out[blO + 3] = 255
      }

      // Bottom-Right: Split Wipe (figurative) OR 2x2 Seamless Tile Check (bark)
      if (mode === 'figurative') {
        if (x < panelSize / 2) writeOverChecker(panelSize + x, panelSize + y, rr, rg, rb, ra)
        else writeOverChecker(panelSize + x, panelSize + y, gr, gg, gb, ga)
      } else {
        const tx = (x * 2) % panelSize
        const ty = (y * 2) % panelSize
        const ti = (ty * panelSize + tx) * 4
        const brO = ((panelSize + y) * W + (panelSize + x)) * 4
        out[brO] = gen.data[ti]
        out[brO + 1] = gen.data[ti + 1]
        out[brO + 2] = gen.data[ti + 2]
        out[brO + 3] = 255
      }
    }
  }

  // Draw crisp 2px panel dividers + split-wipe / tile-seam guide markers
  for (let i = 0; i < W; i++) {
    for (const dy of [-1, 0]) {
      const oH = ((panelSize + dy) * W + i) * 4
      out[oH] = 16; out[oH + 1] = 22; out[oH + 2] = 28; out[oH + 3] = 255
      const oV = (i * W + (panelSize + dy)) * 4
      out[oV] = 16; out[oV + 1] = 22; out[oV + 2] = 28; out[oV + 3] = 255
    }
  }
  if (mode === 'figurative') {
    const cx = panelSize + Math.floor(panelSize / 2)
    for (let y = panelSize; y < H; y++) {
      const o = (y * W + cx) * 4
      out[o] = 83; out[o + 1] = 216; out[o + 2] = 251; out[o + 3] = 255
    }
  } else {
    // Subtle cyan tick marks at 2x2 seam midpoint so seams are easy to inspect
    const mx = panelSize + Math.floor(panelSize / 2)
    const my = panelSize + Math.floor(panelSize / 2)
    for (let k = 0; k < 10; k++) {
      for (const [px, py] of [[mx, panelSize + k], [mx, H - 1 - k], [panelSize + k, my], [W - 1 - k, my]]) {
        const o = (py * W + px) * 4
        out[o] = 83; out[o + 1] = 216; out[o + 2] = 251; out[o + 3] = 255
      }
    }
  }

  return { width: W, height: H, data: out }
}
