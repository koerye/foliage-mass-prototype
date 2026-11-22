// Deterministic, zero-dependency Image-to-Plant Computer Vision analyzer &
// parametric synthesis engine.
//
// Takes any RGBA pixel buffer (plant photo / concept art / illustration) and:
//  1. Removes studio/sky/alpha background via perimeter-seeded flood-fill.
//  2. Classifies foreground pixels into WOOD (bark/trunks), FOLIAGE (leaves or
//     blossoms), and optional GROUND skirt (base grass/meadow carpet).
//  3. Extracts rich inner/outer foliage palettes, bark color, accent flowers,
//     and ground colors.
//  4. Classifies plant architecture (broadleaf, conifer, palm, shrub, grass,
//     fern, flowerbed) and decomposes multi-stem / satellite crowns (e.g.
//     bonsai sakura with lower side trunks).
//  5. Measures trunk root, lean direction, S-bend wobble, flare, fork height,
//     and asymmetric crown contour -> synthesizes a fully editable AiSceneSpec
//     using Vegetation Studio's real procedural algorithms & CrownHandles.
import { MathUtils } from 'three'
import { CrownEnvelope } from '../tree/envelope'
import { buildSkeleton } from '../tree/skeleton'
import { presetSpec, type CrownHandle, type LeafStyle, type TreeKind, type TreeSpec, type XYZ } from '../tree/spec'
import type { AiPart, AiSceneSpec, LeafTextureSource } from './scene'

export interface PixelBuffer {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface PaletteSummary {
  foliageInner: string
  foliageOuter: string
  bark: string
  accentFlower?: string
  groundBase?: string
  groundTip?: string
}

export interface CrownBlob {
  id: number
  area: number
  minX: number
  maxX: number
  minY: number
  maxY: number
  cx: number
  cy: number
  width: number
  height: number
}

export interface AnalysisReport {
  kind: TreeKind
  foliageStyle: 'green' | 'blossom' | 'autumn'
  leafStyle: LeafStyle
  crownCount: number
  tracedSpines: number
  hasGroundSkirt: boolean
  hasAccentFlowers: boolean
  aspectRatio: number
  woodRatio: number
  canopyPorosity: number
  palette: PaletteSummary
  summary: string
}

export interface AnalyzeOptions {
  /** Optional custom foreground mask (1 = keep plant, 0 = background) at source or working resolution. */
  customMask?: Uint8Array
  customMaskWidth?: number
  customMaskHeight?: number
}

export interface AnalyzeResult {
  report: AnalysisReport
  scene: AiSceneSpec
}

// ---- color helpers ---------------------------------------------------------

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) * .5
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > .5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h * 60, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360
  s = MathUtils.clamp(s, 0, 1)
  l = MathUtils.clamp(l, 0, 1)
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const hex = (v: number) => Math.round(MathUtils.clamp((v + m) * 255, 0, 255)).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(MathUtils.clamp(v, 0, 255)).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

function median(values: number[], q = .5): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * q)))]
}

/** Quantile color from a list of RGB triples sorted by luminance, with optional vividness boost. */
function quantileColor(
  samples: [number, number, number, number][],
  q: number,
  satBoost = 1,
  lightShift = 0,
  fallback = '#6b9445',
): string {
  if (!samples.length) return fallback
  const sorted = [...samples].sort((a, b) => a[3] - b[3])
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)))
  const lo = Math.max(0, idx - 12), hi = Math.min(sorted.length, idx + 13)
  let sr = 0, sg = 0, sb = 0
  for (let i = lo; i < hi; i++) { sr += sorted[i][0]; sg += sorted[i][1]; sb += sorted[i][2] }
  const n = hi - lo
  const [h, s, l] = rgbToHsl(sr / n, sg / n, sb / n)
  return hslToHex(h, MathUtils.clamp(s * satBoost, 0, .96), MathUtils.clamp(l + lightShift, .08, .94))
}

function hashSeed(name: string, w: number, h: number, fgCount: number): number {
  let acc = (w * 73856093 ^ h * 19349663 ^ fgCount * 83492791) >>> 0
  for (let i = 0; i < name.length; i++) acc = (Math.imul(acc, 31) + name.charCodeAt(i)) >>> 0
  return (acc % 89999) + 1000
}

// ---- downsampling & segmentation -------------------------------------------

function downsample(src: PixelBuffer, maxDim = 144): PixelBuffer {
  if (src.width <= maxDim && src.height <= maxDim) return src
  const scale = maxDim / Math.max(src.width, src.height)
  const width = Math.max(16, Math.round(src.width * scale))
  const height = Math.max(16, Math.round(src.height * scale))
  const data = new Uint8ClampedArray(width * height * 4)
  const sx = src.width / width, sy = src.height / height
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.min(src.height, Math.max(y0 + 1, Math.ceil((y + 1) * sy)))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.min(src.width, Math.max(x0 + 1, Math.ceil((x + 1) * sx)))
      let r = 0, g = 0, b = 0, a = 0, cnt = 0
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * src.width + xx) * 4
          r += src.data[o]; g += src.data[o + 1]; b += src.data[o + 2]; a += src.data[o + 3]
          cnt++
        }
      }
      const o = (y * width + x) * 4
      data[o] = r / cnt; data[o + 1] = g / cnt; data[o + 2] = b / cnt; data[o + 3] = a / cnt
    }
  }
  return { width, height, data }
}

const MASK_BG = 0
const MASK_WOOD = 1
const MASK_FOLIAGE = 2
const MASK_GROUND = 3

function labelComponents(mask: Uint8Array, w: number, h: number, target: number) {
  const labels = new Int32Array(w * h)
  const blobs: CrownBlob[] = []
  const queue = new Int32Array(w * h)
  let nextId = 1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const start = y * w + x
      if (mask[start] !== target || labels[start] !== 0) continue
      const id = nextId++
      let head = 0, tail = 0
      queue[tail++] = start
      labels[start] = id
      let area = 0, sumX = 0, sumY = 0
      let minX = x, maxX = x, minY = y, maxY = y
      while (head < tail) {
        const idx = queue[head++]
        const px = idx % w, py = (idx - px) / w
        area++; sumX += px; sumY += py
        if (px < minX) minX = px
        if (px > maxX) maxX = px
        if (py < minY) minY = py
        if (py > maxY) maxY = py
        for (let dy = -1; dy <= 1; dy++) {
          const ny = py + dy
          if (ny < 0 || ny >= h) continue
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = px + dx
            if (nx < 0 || nx >= w) continue
            const ni = ny * w + nx
            if (mask[ni] === target && labels[ni] === 0) {
              labels[ni] = id
              queue[tail++] = ni
            }
          }
        }
      }
      blobs.push({
        id, area, minX, maxX, minY, maxY,
        cx: sumX / area, cy: sumY / area,
        width: maxX - minX + 1, height: maxY - minY + 1,
      })
    }
  }
  blobs.sort((a, b) => b.area - a.area)
  return { labels, blobs }
}

/** Morphological open (r erosions -> r masked dilations) to detach narrow twig bridges between crowns. */
function morphOpen(mask: Uint8Array, w: number, h: number, target: number, radius = 1): Uint8Array {
  let cur = new Uint8Array(w * h)
  for (let i = 0; i < cur.length; i++) if (mask[i] === target) cur[i] = target
  for (let step = 0; step < radius; step++) {
    const next = new Uint8Array(w * h)
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        if (cur[i] === target && cur[i - 1] === target && cur[i + 1] === target && cur[i - w] === target && cur[i + w] === target) {
          next[i] = target
        }
      }
    }
    cur = next
  }
  for (let step = 0; step < radius; step++) {
    const next = new Uint8Array(w * h)
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        if (mask[i] === target && (cur[i] === target || cur[i - 1] === target || cur[i + 1] === target || cur[i - w] === target || cur[i + w] === target)) {
          next[i] = target
        }
      }
    }
    cur = next
  }
  return cur
}

/** 2-pass Chamfer distance transform over MASK_WOOD pixels to locate true medial-axis ridge centerlines. */
function computeWoodDistance(mask: Uint8Array, w: number, h: number): Float32Array {
  const dist = new Float32Array(w * h)
  const INF = 1e4
  for (let i = 0; i < w * h; i++) dist[i] = mask[i] === MASK_WOOD ? INF : 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (dist[i] === 0) continue
      dist[i] = Math.min(
        dist[i],
        dist[i - 1] + 1,
        dist[i - w] + 1,
        dist[i - w - 1] + 1.414,
        dist[i - w + 1] + 1.414,
      )
    }
  }
  for (let y = h - 2; y >= 1; y--) {
    for (let x = w - 2; x >= 1; x--) {
      const i = y * w + x
      if (dist[i] === 0) continue
      dist[i] = Math.min(
        dist[i],
        dist[i + 1] + 1,
        dist[i + w] + 1,
        dist[i + w + 1] + 1.414,
        dist[i + w - 1] + 1.414,
      )
    }
  }
  return dist
}

interface TracedSpine {
  spine: XYZ[]
  rootX: number
  topX: number
  midRadiusPx: number
  rootRadiusPx: number
}

/** Top-down medial-axis ridge tracker: seeds right below the crown's own entry
 *  point (where each stem is unambiguously isolated) and traces downward along
 *  the contiguous wood ridge to the ground, then reverses into a root->fork 3D spline. */
function extractTrunkSpine(
  mask: Uint8Array,
  woodDist: Float32Array,
  w: number,
  h: number,
  xLo: number,
  xHi: number,
  yTop: number,
  yBot: number,
  targetTopX: number,
  px2m: number,
  zSign: number,
): TracedSpine | undefined {
  const minX = Math.max(1, Math.floor(xLo))
  const maxX = Math.min(w - 2, Math.ceil(xHi))
  const startY = Math.max(1, Math.floor(yTop))
  const endY = Math.min(h - 2, Math.floor(yBot))
  if (maxX <= minX || endY - startY < 8) return undefined

  // 1. Seed right below the crown entry (top 28% band), preferring thick wood aligned with targetTopX
  const seedBandBot = Math.min(endY, startY + Math.max(6, Math.round((endY - startY) * .28)))
  let seedX = -1, seedY = -1, bestScore = -1, seedR = 2
  const spanX = Math.max(1, maxX - minX)
  for (let y = startY; y <= seedBandBot; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = woodDist[y * w + x]
      if (d <= 0) continue
      const align = 1 / (1 + 2.4 * Math.abs(x - targetTopX) / spanX)
      const topBias = 1 - .15 * (y - startY) / Math.max(1, seedBandBot - startY)
      const score = (d + .6) * align * topBias
      if (score > bestScore) { bestScore = score; seedX = x; seedY = y; seedR = d }
    }
  }
  if (seedX < 0) return undefined

  // 2. Trace downward row-by-row from crown entry to ground root
  const down: { x: number; y: number; r: number }[] = [{ x: seedX, y: seedY, r: seedR }]
  let curX = seedX, curR = seedR, dxVel = 0, miss = 0
  for (let y = seedY + 1; y <= endY; y++) {
    const predX = curX + dxVel * .6
    const win = Math.max(5, Math.round(curR * 1.45 + 3.5))
    const lx = Math.max(minX, Math.floor(predX - win))
    const rx = Math.min(maxX, Math.ceil(predX + win))

    let bestRunX = -1, bestRunR = 0, bestRunScore = -1
    let x = lx
    while (x <= rx) {
      if (mask[y * w + x] !== MASK_WOOD) { x++; continue }
      let sumXW = 0, sumW = 0, peakR = 0
      while (x <= rx && mask[y * w + x] === MASK_WOOD) {
        const d = Math.max(.5, woodDist[y * w + x])
        const wt = d * d
        sumXW += x * wt; sumW += wt
        if (d > peakR) peakR = d
        x++
      }
      const runCx = sumXW / sumW
      const score = (peakR + .5) / (1 + .22 * Math.abs(runCx - predX))
      if (score > bestRunScore) { bestRunScore = score; bestRunX = runCx; bestRunR = peakR }
    }

    if (bestRunX >= 0) {
      dxVel = MathUtils.clamp(dxVel * .55 + (bestRunX - curX) * .45, -3.2, 3.2)
      curX = bestRunX
      curR = curR * .65 + bestRunR * .35
      miss = 0
      down.push({ x: curX, y, r: bestRunR })
    } else {
      miss++
      if (miss > 5) break
      curX = MathUtils.clamp(curX + dxVel * .45, minX, maxX)
    }
  }

  if (down.length < 7) return undefined

  // Reverse into root -> crown fork order
  const raw = down.reverse()

  // Smooth traced X gently (3 passes, endpoints anchored) to remove 1px staircase jitter
  const xs = raw.map(p => p.x)
  for (let pass = 0; pass < 3; pass++) {
    const next = [...xs]
    for (let i = 1; i < xs.length - 1; i++) next[i] = xs[i - 1] * .25 + xs[i] * .5 + xs[i + 1] * .25
    for (let i = 1; i < xs.length - 1; i++) xs[i] = next[i]
  }

  const rootX = xs[0]
  const topX = xs[xs.length - 1]
  const radii = raw.map(p => p.r)
  const rootRadiusPx = median(radii.slice(0, Math.max(2, Math.floor(radii.length * .2))))
  const midRadiusPx = median(radii.slice(Math.floor(radii.length * .25), Math.max(3, Math.floor(radii.length * .72))))

  // Resample into 8 crisp 3D control points in local tree meters ([0,0,0] at ground)
  const samples = 8
  const spine: XYZ[] = []
  const maxSpanX = Math.max(.2, ...xs.map(v => Math.abs(v - rootX) * px2m))
  const baseY = raw[0].y
  for (let k = 0; k < samples; k++) {
    const u = k / (samples - 1)
    const f = u * (raw.length - 1)
    const i0 = Math.min(raw.length - 2, Math.floor(f))
    const frac = f - i0
    const px = MathUtils.lerp(xs[i0], xs[i0 + 1], frac)
    const py = MathUtils.lerp(raw[i0].y, raw[i0 + 1].y, frac)
    const lx = k === 0 ? 0 : (px - rootX) * px2m
    const ly = k === 0 ? 0 : Math.max(.04 * k, (baseY - py) * px2m)
    const lz = k === 0 ? 0 : zSign * Math.sin(u * Math.PI) * Math.min(.38, maxSpanX * .24 + Math.abs(lx) * .14)
    spine.push([Number(lx.toFixed(3)), Number(ly.toFixed(3)), Number(lz.toFixed(3))])
  }
  return { spine, rootX, topX, midRadiusPx, rootRadiusPx }
}

/** Interactive foreground/background scribble segmentation (fast GrabCut-lite)
 *  for messy real-world photos.
 *  strokes: 0 = unmarked, 1 = foreground (green brush), 2 = background (red brush).
 *  Returns binary foreground mask (1 = plant, 0 = background) matching source dimensions. */
export function computeScribbleMask(source: PixelBuffer, strokes: Uint8Array): Uint8Array {
  const { width: W, height: H, data } = source
  const N = W * H
  const fgSamples: [number, number, number][] = []
  const bgSamples: [number, number, number][] = []
  const fgSeeds: [number, number][] = []
  const bgSeeds: [number, number][] = []

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const s = strokes[i]
      if (s === 1) {
        fgSamples.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]])
        if ((x + y) % 3 === 0) fgSeeds.push([x, y])
      } else if (s === 2) {
        bgSamples.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]])
        if ((x + y) % 3 === 0) bgSeeds.push([x, y])
      }
    }
  }
  // If user only painted foreground or only background, supplement background from unmarked border pixels
  if (bgSamples.length < 8) {
    for (let x = 0; x < W; x += 2) {
      for (const y of [0, H - 1]) {
        const i = y * W + x
        if (strokes[i] !== 1) bgSamples.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]])
      }
    }
    for (let y = 0; y < H; y += 2) {
      for (const x of [0, W - 1]) {
        const i = y * W + x
        if (strokes[i] !== 1) bgSamples.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]])
      }
    }
  }
  if (!fgSamples.length) return new Uint8Array(N)

  // Quantize color prototypes via greedy farthest-point sampling (up to 10 clusters each)
  const buildPrototypes = (pts: [number, number, number][], maxK = 10) => {
    const step = Math.max(1, Math.floor(pts.length / 260))
    const sub: [number, number, number][] = []
    for (let i = 0; i < pts.length; i += step) sub.push(pts[i])
    const protos: [number, number, number][] = [sub[0]]
    while (protos.length < maxK && protos.length < sub.length) {
      let bestIdx = -1, bestDist = -1
      for (let i = 0; i < sub.length; i++) {
        let minD = Infinity
        for (const p of protos) {
          const d = (sub[i][0] - p[0]) ** 2 + (sub[i][1] - p[1]) ** 2 + (sub[i][2] - p[2]) ** 2
          if (d < minD) minD = d
        }
        if (minD > bestDist) { bestDist = minD; bestIdx = i }
      }
      if (bestIdx < 0 || bestDist < 180) break
      protos.push(sub[bestIdx])
    }
    return protos
  }

  const fgProtos = buildPrototypes(fgSamples, 12)
  const bgProtos = buildPrototypes(bgSamples.length ? bgSamples : [[255, 255, 255]], 12)
  const minColorDist = (r: number, g: number, b: number, protos: [number, number, number][]) => {
    let best = Infinity
    for (const p of protos) {
      const d = Math.hypot(r - p[0], g - p[1], b - p[2])
      if (d < best) best = d
    }
    return best
  }

  // Compute spatial nearest-stroke hint (subsampled for speed)
  const fgSub = fgSeeds.filter((_, i) => i % Math.max(1, Math.floor(fgSeeds.length / 48)) === 0)
  const bgSub = bgSeeds.filter((_, i) => i % Math.max(1, Math.floor(bgSeeds.length / 48)) === 0)
  const diag = Math.hypot(W, H) || 1
  const minSpatial = (x: number, y: number, list: [number, number][]) => {
    if (!list.length) return diag
    let best = Infinity
    for (const [sx, sy] of list) {
      const d = Math.hypot(x - sx, y - sy)
      if (d < best) best = d
    }
    return best
  }

  let mask = new Uint8Array(N)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (strokes[i] === 1) { mask[i] = 1; continue }
      if (strokes[i] === 2) { mask[i] = 0; continue }
      const o = i * 4
      if (data[o + 3] < 40) { mask[i] = 0; continue }
      const dFg = minColorDist(data[o], data[o + 1], data[o + 2], fgProtos)
      const dBg = minColorDist(data[o], data[o + 1], data[o + 2], bgProtos)
      const sFg = minSpatial(x, y, fgSub) / diag
      const sBg = bgSub.length ? minSpatial(x, y, bgSub) / diag : .42
      const scoreFg = dFg + sFg * 36
      const scoreBg = dBg + sBg * 36
      mask[i] = scoreFg < scoreBg ? 1 : 0
    }
  }

  // 2 passes of 3x3 majority smoothing (keeping explicit strokes locked)
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(mask)
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x
        if (strokes[i] === 1) { next[i] = 1; continue }
        if (strokes[i] === 2) { next[i] = 0; continue }
        const sum = mask[i - W - 1] + mask[i - W] + mask[i - W + 1] +
          mask[i - 1] + mask[i] + mask[i + 1] +
          mask[i + W - 1] + mask[i + W] + mask[i + W + 1]
        next[i] = sum >= 5 ? 1 : 0
      }
    }
    mask = next
  }

  // Keep only foreground components touched by green strokes (or largest component)
  const comps = labelComponents(mask, W, H, 1)
  const touched = new Set<number>()
  for (let i = 0; i < N; i++) if (strokes[i] === 1 && comps.labels[i] > 0) touched.add(comps.labels[i])
  if (!touched.size && comps.blobs.length) touched.add(comps.blobs[0].id)
  for (let i = 0; i < N; i++) if (mask[i] && !touched.has(comps.labels[i])) mask[i] = 0
  return mask
}

// ---- main analysis & parametric synthesis ----------------------------------

export function analyzePlantImage(source: PixelBuffer, imageName = '参考图植物', options: AnalyzeOptions = {}): AnalyzeResult {
  const img = downsample(source, 144)
  const { width: W, height: H, data } = img
  const N = W * H

  // 1. Sample perimeter pixels for background color / transparency
  const br: number[] = [], bg: number[] = [], bb: number[] = []
  let borderTotal = 0, borderTransparent = 0
  const sampleBorder = (x: number, y: number) => {
    const o = (y * W + x) * 4
    borderTotal++
    if (data[o + 3] < 40) { borderTransparent++; return }
    br.push(data[o]); bg.push(data[o + 1]); bb.push(data[o + 2])
  }
  for (let x = 0; x < W; x++) { sampleBorder(x, 0); sampleBorder(x, H - 1) }
  for (let y = 1; y < H - 1; y++) { sampleBorder(0, y); sampleBorder(W - 1, y) }

  const useAlpha = borderTransparent / Math.max(1, borderTotal) >= .1
  const bgR = median(br), bgG = median(bg), bgB = median(bb)
  const [, bgS, bgL] = rgbToHsl(bgR, bgG, bgB)
  const brightNeutralBg = !useAlpha && bgL > .84 && bgS < .12

  const isBgPixel = (i: number, strict = false) => {
    const o = i * 4
    if (useAlpha) return data[o + 3] < 48
    const dr = data[o] - bgR, dg = data[o + 1] - bgG, db = data[o + 2] - bgB
    const dist = Math.hypot(dr, dg, db)
    if (brightNeutralBg) {
      const [, s, l] = rgbToHsl(data[o], data[o + 1], data[o + 2])
      return dist < (strict ? 42 : 44) && s < (strict ? .16 : .16) && l > (strict ? .82 : .81)
    }
    return dist < (strict ? 32 : 38)
  }

  // Flood-fill exterior background from border (or apply user's custom scribble cutout mask)
  const extBg = new Uint8Array(N)
  const fg = new Uint8Array(N)
  if (options.customMask && options.customMask.length > 0) {
    const mw = options.customMaskWidth ?? source.width
    const mh = options.customMaskHeight ?? source.height
    for (let y = 0; y < H; y++) {
      const sy = Math.min(mh - 1, Math.floor((y + .5) * mh / H))
      for (let x = 0; x < W; x++) {
        const sx = Math.min(mw - 1, Math.floor((x + .5) * mw / W))
        const keep = options.customMask[sy * mw + sx] > 0
        fg[y * W + x] = keep ? 1 : 0
        extBg[y * W + x] = keep ? 0 : 1
      }
    }
  } else if (useAlpha) {
    for (let i = 0; i < N; i++) {
      if (data[i * 4 + 3] >= 48) fg[i] = 1
      else extBg[i] = 1
    }
  } else {
    const queue = new Int32Array(N)
    let head = 0, tail = 0
    const push = (i: number) => {
      if (!extBg[i] && isBgPixel(i, false)) { extBg[i] = 1; queue[tail++] = i }
    }
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x) }
    for (let y = 1; y < H - 1; y++) { push(y * W); push(y * W + W - 1) }
    while (head < tail) {
      const idx = queue[head++]
      const x = idx % W, y = (idx - x) / W
      if (x > 0) push(idx - 1)
      if (x + 1 < W) push(idx + 1)
      if (y > 0) push(idx - W)
      if (y + 1 < H) push(idx + W)
    }
    for (let i = 0; i < N; i++) {
      if (!extBg[i] && !isBgPixel(i, true)) fg[i] = 1
    }
  }

  // Remove tiny isolated stray specks (like floating petals far outside)
  let totalFg = 0
  for (let i = 0; i < N; i++) if (fg[i]) totalFg++
  const fgComps = labelComponents(fg, W, H, 1)
  const minKeepArea = Math.max(6, Math.round(totalFg * .0035))
  const keepSet = new Set(fgComps.blobs.filter(b => b.area >= minKeepArea).map(b => b.id))
  if (!keepSet.size && fgComps.blobs.length) keepSet.add(fgComps.blobs[0].id)
  totalFg = 0
  let fgMinX = W, fgMaxX = 0, fgMinY = H, fgMaxY = 0
  let interiorHoles = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (fg[i] && !keepSet.has(fgComps.labels[i])) fg[i] = 0
      if (fg[i]) {
        totalFg++
        if (x < fgMinX) fgMinX = x
        if (x > fgMaxX) fgMaxX = x
        if (y < fgMinY) fgMinY = y
        if (y > fgMaxY) fgMaxY = y
      } else if (!extBg[i]) {
        interiorHoles++
      }
    }
  }

  // Fallback if image is completely blank
  if (totalFg < 16) {
    const spec = presetSpec('broadleaf-round')
    return {
      report: {
        kind: 'broadleaf', foliageStyle: 'green', leafStyle: 'default', crownCount: 1, tracedSpines: 0, hasGroundSkirt: false,
        hasAccentFlowers: false, aspectRatio: 1, woodRatio: .15, canopyPorosity: .1,
        palette: { foliageInner: spec.leaves.tintInner, foliageOuter: spec.leaves.tintOuter, bark: '#5b4636' },
        summary: '未检测到清晰植物轮廓，已回退默认阔叶树参数。',
      },
      scene: {
        schemaVersion: 1, mode: 'ai-blank', name: imageName, summary: '未检测到清晰主体，使用默认阔叶树。',
        parts: [{ id: 'part-main', label: '主树体', enabled: true, position: [0, 0, 0], rotationY: 0, scale: 1, leafTexture: 'auto', spec }],
      },
    }
  }

  const fgW = Math.max(1, fgMaxX - fgMinX + 1)
  const fgH = Math.max(1, fgMaxY - fgMinY + 1)
  const canopyPorosity = MathUtils.clamp(interiorHoles / Math.max(1, totalFg + interiorHoles), 0, .6)

  // 2. Chromatic census of foreground pixels -> determine dominant foliage style
  let greenPx = 0, blossomPx = 0, autumnPx = 0, whiteBlossomPx = 0
  const satValues: number[] = []
  const hslCache = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) {
    if (!fg[i]) continue
    const o = i * 4
    const [h, s, l] = rgbToHsl(data[o], data[o + 1], data[o + 2])
    hslCache[i * 3] = h; hslCache[i * 3 + 1] = s; hslCache[i * 3 + 2] = l
    if (s >= .22 && l >= .18 && l <= .94) {
      if (h >= 58 && h <= 176) { greenPx++; satValues.push(s) }
      else if ((h >= 278 || (h <= 10 && l >= .56)) && l >= .34) { blossomPx++; satValues.push(s) }
      else if (((h > 10 && h < 58) || (h <= 10 && l < .56)) && l >= .24 && s >= .34) { autumnPx++; satValues.push(s) }
    } else if (s < .22 && l >= .74 && Math.floor(i / W) < fgMinY + fgH * .72) {
      whiteBlossomPx++
    }
  }
  const medSat = satValues.length ? median(satValues, .55) : .45
  let foliageStyle: 'green' | 'blossom' | 'autumn' = 'green'
  if (blossomPx > greenPx * 1.15 && blossomPx >= autumnPx) foliageStyle = 'blossom'
  else if (autumnPx > greenPx * 1.25 && autumnPx > blossomPx) foliageStyle = 'autumn'
  else if (whiteBlossomPx > (greenPx + blossomPx + autumnPx) * 1.1 && whiteBlossomPx > totalFg * .25) foliageStyle = 'blossom'

  // 3. Pixel semantic mask: WOOD vs FOLIAGE
  const mask = new Uint8Array(N)
  const woodSamples: [number, number, number, number][] = []
  const foliageSamples: [number, number, number, number][] = []
  const accentSamples: [number, number, number, number][] = []
  let woodCount = 0, foliageCount = 0

  for (let y = fgMinY; y <= fgMaxY; y++) {
    const yFrac = (y - fgMinY) / fgH // 0 = top, 1 = bottom
    for (let x = fgMinX; x <= fgMaxX; x++) {
      const i = y * W + x
      if (!fg[i]) continue
      const o = i * 4
      const h = hslCache[i * 3], s = hslCache[i * 3 + 1], l = hslCache[i * 3 + 2]
      let isWood = false
      if (foliageStyle === 'blossom') {
        // gray, taupe, brown, dark limbs, OR ambient-pinkish gray bark (noticeably less saturated & darker than blossoms)
        const lowSatBark = s < Math.min(.33, medSat * .54) && l < .66
        const warmBark = h >= 10 && h <= 54 && s < .58 && l < .56
        const darkLimb = l < .28
        isWood = lowSatBark || warmBark || darkLimb
      } else if (foliageStyle === 'autumn') {
        const darkBrown = h >= 8 && h <= 46 && s < .55 && l < .42
        const grayBark = s < .17 && l < .58
        isWood = darkBrown || grayBark
      } else {
        const brownBark = (h >= 6 && h <= 52 && s < .68 && l < .56) || (h >= 340 && s < .35 && l < .45)
        const grayBark = s < .16 && l < .62
        const birchBark = s < .12 && l >= .68 && yFrac > .48 && Math.abs((x - fgMinX) / fgW - .5) < .24
        isWood = brownBark || grayBark || birchBark
      }

      if (isWood) {
        mask[i] = MASK_WOOD
        woodCount++
        woodSamples.push([data[o], data[o + 1], data[o + 2], l])
      } else {
        mask[i] = MASK_FOLIAGE
        foliageCount++
        // If green tree has vivid non-green blossom pixels, collect them as accent flowers
        if (foliageStyle === 'green' && ((h >= 285 || h <= 46) && s >= .38 && l >= .42)) {
          accentSamples.push([data[o], data[o + 1], data[o + 2], l])
        } else {
          foliageSamples.push([data[o], data[o + 1], data[o + 2], l])
        }
      }
    }
  }

  // 4. Ground skirt / base grass separation (detect surge of bottom foliage after a lower-trunk pinch)
  const folRow = new Int32Array(H)
  const woodRow = new Int32Array(H)
  for (let y = fgMinY; y <= fgMaxY; y++) {
    let fc = 0, wc = 0
    for (let x = fgMinX; x <= fgMaxX; x++) {
      const m = mask[y * W + x]
      if (m === MASK_FOLIAGE) fc++
      else if (m === MASK_WOOD) wc++
    }
    folRow[y] = fc; woodRow[y] = wc
  }

  let hasGroundSkirt = false
  let groundPinchY = fgMaxY + 1
  const groundSamples: [number, number, number, number][] = []
  let groundMinX = W, groundMaxX = 0, groundMinY = H, groundMaxY = 0
  if (woodCount > totalFg * .045) {
    const upperFolSum = Array.from({ length: Math.floor(fgH * .55) }, (_, dy) => folRow[fgMinY + dy]).reduce((a, b) => a + b, 0)
    if (upperFolSum > foliageCount * .28) {
      // Find minimum-foliage pinch in lower-mid zone (66%..90% from top) where wood exists
      const searchLo = fgMinY + Math.floor(fgH * .66)
      const searchHi = fgMinY + Math.floor(fgH * .91)
      let minVal = Infinity, minY = -1
      for (let y = searchLo; y <= searchHi; y++) {
        if (woodRow[y] > 0 && folRow[y] < minVal) { minVal = folRow[y]; minY = y }
      }
      if (minY > 0 && minY < fgMaxY - 2) {
        let maxBotFol = 0, botFolTotal = 0
        for (let y = minY + 1; y <= fgMaxY; y++) {
          if (folRow[y] > maxBotFol) maxBotFol = folRow[y]
          botFolTotal += folRow[y]
        }
        if (maxBotFol > Math.max(12, minVal * 2.1, fgW * .35) && botFolTotal > totalFg * .025) {
          hasGroundSkirt = true
          // Walk down from minY until bottom surge starts
          groundPinchY = minY
          for (let y = minY; y <= fgMaxY; y++) {
            if (folRow[y] >= Math.max(8, maxBotFol * .28)) { groundPinchY = Math.max(minY, y - 1); break }
          }
          for (let y = groundPinchY; y <= fgMaxY; y++) {
            for (let x = fgMinX; x <= fgMaxX; x++) {
              const i = y * W + x
              if (mask[i] === MASK_FOLIAGE) {
                mask[i] = MASK_GROUND
                const o = i * 4
                groundSamples.push([data[o], data[o + 1], data[o + 2], hslCache[i * 3 + 2]])
                if (x < groundMinX) groundMinX = x
                if (x > groundMaxX) groundMaxX = x
                if (y < groundMinY) groundMinY = y
                if (y > groundMaxY) groundMaxY = y
              }
            }
          }
        }
      }
    }
  }

  // Re-collect clean tree foliage samples (excluding ground skirt & pale anti-aliased white border fringe)
  const isChromatic = foliageStyle !== 'blossom' || blossomPx > totalFg * .12
  const treeFoliageSamples: [number, number, number, number][] = []
  const vividTreeSamples: [number, number, number, number][] = []
  let treeFolMinY = H, treeFolMaxY = 0, treeFolMinX = W, treeFolMaxX = 0
  for (let y = fgMinY; y <= fgMaxY; y++) {
    for (let x = fgMinX; x <= fgMaxX; x++) {
      const i = y * W + x
      if (mask[i] !== MASK_FOLIAGE) continue
      const o = i * 4
      const h = hslCache[i * 3], s = hslCache[i * 3 + 1], l = hslCache[i * 3 + 2]
      // Strip residual enclosed bright-white anti-aliased sky pixels on chromatic trees
      if (brightNeutralBg && isChromatic && s < .16 && l > .82) {
        mask[i] = MASK_BG
        continue
      }
      if (!(foliageStyle === 'green' && ((h >= 285 || h <= 46) && s >= .38 && l >= .42))) {
        treeFoliageSamples.push([data[o], data[o + 1], data[o + 2], l])
        if (!isChromatic || (s >= .24 && l <= .87)) {
          vividTreeSamples.push([data[o], data[o + 1], data[o + 2], l])
        }
      }
      if (x < treeFolMinX) treeFolMinX = x
      if (x > treeFolMaxX) treeFolMaxX = x
      if (y < treeFolMinY) treeFolMinY = y
      if (y > treeFolMaxY) treeFolMaxY = y
    }
  }
  const activeFolSamples = vividTreeSamples.length > 24 ? vividTreeSamples : (treeFoliageSamples.length > 20 ? treeFoliageSamples : foliageSamples)
  const vividGroundSamples = groundSamples.filter(([r, g, b, l]) => {
    const [, s] = rgbToHsl(r, g, b)
    return s >= .24 && l <= .88
  })
  const activeGroundSamples = vividGroundSamples.length > 16 ? vividGroundSamples : groundSamples

  // Extract palettes (lightly lifted for PBR/ACES lighting so bright blossoms & colored grass stay luminous)
  const satBoost = foliageStyle === 'blossom' ? 1.18 : 1.08
  const foliageInner = quantileColor(activeFolSamples, foliageStyle === 'blossom' ? .26 : .18, satBoost, foliageStyle === 'blossom' ? .06 : -.04, '#5c7a3c')
  const foliageOuter = quantileColor(activeFolSamples, foliageStyle === 'blossom' ? .84 : .8, satBoost, foliageStyle === 'blossom' ? .1 : .08, '#d8f09c')
  const barkHex = woodSamples.length > 8 ? quantileColor(woodSamples, .52, .95, .06, '#5b4636') : '#5b4636'
  const hasAccentFlowers = foliageStyle === 'green' && accentSamples.length >= Math.max(12, foliageCount * .03) && accentSamples.length <= foliageCount * .42
  const accentFlowerHex = hasAccentFlowers ? quantileColor(accentSamples, .74, 1.15, .06, '#ff7ca8') : undefined
  const groundBaseHex = hasGroundSkirt ? quantileColor(activeGroundSamples, .28, 1.16, .06, '#5d8a3c') : undefined
  const groundTipHex = hasGroundSkirt ? quantileColor(activeGroundSamples, .82, 1.16, .11, '#e8ffd0') : undefined

  const palette: PaletteSummary = {
    foliageInner, foliageOuter, bark: barkHex,
    accentFlower: accentFlowerHex,
    groundBase: groundBaseHex, groundTip: groundTipHex,
  }

  // 5. Measure overall tree geometry & classify architecture
  const groundY = hasGroundSkirt ? Math.round((groundMinY + groundMaxY) * .5) : fgMaxY
  const treeTopY = Math.min(fgMinY, treeFolMinY)
  const treeH = Math.max(8, groundY - treeTopY + 1)
  const treeW = Math.max(8, fgMaxX - fgMinX + 1)
  const aspectRatio = treeW / treeH
  const woodRatio = woodCount / Math.max(1, woodCount + treeFoliageSamples.length)

  // Check if a real wood trunk exists in the lower 38% of the tree
  let lowerWoodRows = 0
  const lowerStart = treeTopY + Math.floor(treeH * .62)
  for (let y = lowerStart; y <= groundY; y++) if (woodRow[y] > 0) lowerWoodRows++
  const hasVisibleTrunk = woodRatio >= .04 && lowerWoodRows >= Math.max(3, Math.floor(treeH * .14))

  // Crown width profile (from bottom of foliage to top)
  const folH = Math.max(4, treeFolMaxY - treeFolMinY + 1)
  const crownWidthAt = (uFromBottom: number) => {
    const y = MathUtils.clamp(Math.round(treeFolMaxY - uFromBottom * (folH - 1)), 0, H - 1)
    let lo = W, hi = -1
    for (let x = fgMinX; x <= fgMaxX; x++) {
      if (mask[y * W + x] === MASK_FOLIAGE) { if (x < lo) lo = x; if (x > hi) hi = x }
    }
    return hi >= lo ? hi - lo + 1 : 0
  }
  const wLow = (crownWidthAt(.22) + crownWidthAt(.3)) * .5
  const wMid = (crownWidthAt(.5) + crownWidthAt(.6)) * .5
  const wHigh = (crownWidthAt(.84) + crownWidthAt(.9)) * .5
  const foliageBottomFrac = MathUtils.clamp((groundY - treeFolMaxY) / treeH, 0, .85)
  const crownHeightFrac = MathUtils.clamp(folH / treeH, .1, 1)

  // Classify kind
  let kind: TreeKind = 'broadleaf'
  const hasMeadowBlossoms = foliageStyle === 'blossom' || hasAccentFlowers || accentSamples.length >= Math.max(12, foliageCount * .1)
  if (!hasVisibleTrunk && foliageBottomFrac < .22) {
    if (hasMeadowBlossoms) kind = 'flowerbed'
    else if (aspectRatio > .95 && wHigh < wLow * .75) kind = 'fern'
    else if (canopyPorosity > .12 || aspectRatio < 1.15) kind = 'grass'
    else kind = 'broadleaf' // low dense shrub
  } else if (hasVisibleTrunk && foliageStyle === 'green' && wLow > 6 && wHigh / Math.max(1, wLow) < .44 && wMid < wLow * .86 && aspectRatio < .9) {
    kind = 'conifer'
  } else if (hasVisibleTrunk && foliageStyle === 'green' && foliageBottomFrac > .5 && crownHeightFrac < .48 && woodRatio < .22) {
    kind = 'palm'
  } else {
    kind = 'broadleaf'
  }

  const seed = hashSeed(imageName, source.width, source.height, totalFg)
  const parts: AiPart[] = []
  let crownCount = 1
  let tracedSpines = 0
  let chosenLeafStyle: LeafStyle = foliageStyle === 'blossom' ? 'sakura' : foliageStyle === 'autumn' ? 'maple' : 'default'
  const woodDist = computeWoodDistance(mask, W, H)

  // Helper: trace wood centroid & width within horizontal band [xLo..xHi] and vertical [yLo..yHi]
  const traceWood = (xLo: number, xHi: number, yLo: number, yHi: number) => {
    const xs: { y: number; cx: number; w: number }[] = []
    for (let y = Math.max(0, yLo); y <= Math.min(H - 1, yHi); y++) {
      let sum = 0, cnt = 0, lx = W, rx = 0
      for (let x = Math.max(0, xLo); x <= Math.min(W - 1, xHi); x++) {
        if (mask[y * W + x] === MASK_WOOD) {
          sum += x; cnt++
          if (x < lx) lx = x
          if (x > rx) rx = x
        }
      }
      if (cnt > 0) xs.push({ y, cx: sum / cnt, w: rx - lx + 1 })
    }
    return xs
  }

  // ---- Synthesize by detected architecture ---------------------------------
  if (kind === 'conifer') {
    const spec = presetSpec('conifer-standard', seed)
    const worldH = MathUtils.clamp(6.8 + (1 / Math.max(.45, aspectRatio) - 1) * 2.2, 5.2, 11.5)
    const px2m = worldH / treeH
    spec.name = imageName
    spec.trunk.height = Number(worldH.toFixed(2))
    spec.trunk.barkColor = barkHex
    spec.crown.base = Number(MathUtils.clamp(foliageBottomFrac, .08, .35).toFixed(2))
    spec.crown.width = Number(MathUtils.clamp((treeFolMaxX - treeFolMinX) * .5 * px2m, 1.3, 3.8).toFixed(2))
    spec.crown.coneShape = Number(MathUtils.clamp(wMid / Math.max(1, wLow) < .52 ? 1.15 : .82, .55, 1.4).toFixed(2))
    spec.fronds.tintInner = foliageInner
    spec.fronds.tintOuter = foliageOuter
    if (hasAccentFlowers && accentFlowerHex) {
      spec.flowers.enabled = true
      spec.flowers.tintOuter = accentFlowerHex
      spec.flowers.tintInner = quantileColor(accentSamples, .28, 1.05, -.08, accentFlowerHex)
    }
    parts.push({ id: 'part-main', label: '主针叶树', enabled: true, position: [0, 0, 0], rotationY: 0, scale: 1, leafTexture: 'auto', spec })
  } else if (kind === 'palm') {
    const spec = presetSpec('palm-tropical', seed)
    const worldH = MathUtils.clamp(5.2 + (1 / Math.max(.5, aspectRatio) - .8) * 1.4, 3.8, 8.5)
    const px2m = worldH / treeH
    const wood = traceWood(fgMinX, fgMaxX, Math.round(treeTopY + treeH * .38), groundY)
    const rootX = wood.length ? wood[wood.length - 1].cx : (fgMinX + fgMaxX) * .5
    const topX = wood.length ? wood[0].cx : rootX
    const bendM = MathUtils.clamp(Math.abs(topX - rootX) * px2m, .25, 3.2)
    spec.name = imageName
    spec.trunk.height = Number(worldH.toFixed(2))
    spec.trunk.barkColor = barkHex
    spec.palm.bend = Number(bendM.toFixed(2))
    spec.palm.frondLength = Number(MathUtils.clamp((treeFolMaxX - treeFolMinX) * .48 * px2m, 1.5, 3.8).toFixed(2))
    spec.palm.tintInner = foliageInner
    spec.palm.tintOuter = foliageOuter
    parts.push({
      id: 'part-main', label: '主棕榈树', enabled: true, position: [0, 0, 0],
      rotationY: topX < rootX ? 180 : 0, scale: 1, leafTexture: 'auto', spec,
    })
  } else if (kind === 'grass' || kind === 'fern') {
    const spec = presetSpec(kind === 'fern' ? 'fern' : 'grass-clump', seed)
    spec.name = imageName
    spec.ground.tintBase = foliageInner
    spec.ground.tintTip = foliageOuter
    spec.ground.length = Number(MathUtils.clamp(aspectRatio < .9 ? 1.15 : .78, .35, 1.8).toFixed(2))
    spec.ground.spread = Number(MathUtils.clamp(.18 + aspectRatio * .2, .08, .75).toFixed(2))
    parts.push({ id: 'part-main', label: kind === 'fern' ? '蕨类丛' : '草丛', enabled: true, position: [0, 0, 0], rotationY: 0, scale: 1, leafTexture: 'auto', spec })
  } else if (kind === 'flowerbed') {
    const withStems = greenPx > totalFg * .08
    const spec = presetSpec(withStems ? 'flowerbed-stemmed' : 'flowerbed-pure', seed)
    spec.name = imageName
    spec.flowerbed.withStems = withStems
    const petalSamples = accentSamples.length > 10 ? accentSamples : activeFolSamples
    spec.flowerbed.tintInner = quantileColor(petalSamples, .22, 1.12, -.05, foliageInner)
    spec.flowerbed.tintOuter = quantileColor(petalSamples, .8, 1.12, .05, foliageOuter)
    if (withStems && greenPx > 10) {
      const greenSamples: [number, number, number, number][] = []
      for (let i = 0; i < N; i++) {
        if (!fg[i]) continue
        const h = hslCache[i * 3], s = hslCache[i * 3 + 1], l = hslCache[i * 3 + 2]
        if (s >= .2 && h >= 58 && h <= 176) greenSamples.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2], l])
      }
      if (greenSamples.length > 5) spec.flowerbed.stemTint = quantileColor(greenSamples, .5, 1.05, 0, '#4d8a35')
    }
    parts.push({ id: 'part-main', label: withStems ? '有杆花丛' : '纯花丛', enabled: true, position: [0, 0, 0], rotationY: 0, scale: 1, leafTexture: 'auto', spec })
  } else {
    // ---- Broadleaf / Flowering Tree / Multi-Stem Bonsai / Shrub ------------
    const open1 = morphOpen(mask, W, H, MASK_FOLIAGE, 1)
    const open2 = morphOpen(mask, W, H, MASK_FOLIAGE, 2)
    const extractCrowns = (buf: Uint8Array) => {
      const c = labelComponents(buf, W, H, MASK_FOLIAGE)
      const tot = c.blobs.reduce((s, b) => s + b.area, 0)
      const sig = c.blobs.filter(b => b.area >= Math.max(12, tot * .045))
      const main = sig[0]
      const sats: CrownBlob[] = []
      if (main) {
        for (const b of sig.slice(1, 5)) {
          const horizSep = Math.abs(b.cx - main.cx) > main.width * .24
          const lowerThanMain = b.cy > main.cy + main.height * .2
          const woodBelow = traceWood(b.minX - 4, b.maxX + 4, Math.round(b.cy), groundY).length >= 3
          if ((horizSep && (lowerThanMain || woodBelow)) || (lowerThanMain && woodBelow)) sats.push(b)
        }
      }
      return { buf, comps: c, main, sats }
    }
    const r1 = extractCrowns(open1)
    const r2 = extractCrowns(open2)
    const chosen = r2.main && r2.sats.length > r1.sats.length ? r2 : r1
    const opened = chosen.buf
    const comps = chosen.comps
    const mainBlob: CrownBlob = chosen.main ?? {
      id: 1, area: foliageCount, minX: treeFolMinX, maxX: treeFolMaxX, minY: treeFolMinY, maxY: treeFolMaxY,
      cx: (treeFolMinX + treeFolMaxX) * .5, cy: (treeFolMinY + treeFolMaxY) * .5,
      width: Math.max(1, treeFolMaxX - treeFolMinX + 1), height: Math.max(1, treeFolMaxY - treeFolMinY + 1),
    }
    const satellites = chosen.sats
    crownCount = 1 + satellites.length

    const mainBottomFrac = MathUtils.clamp((groundY - mainBlob.maxY) / treeH, 0, .85)
    const isShrub = !hasVisibleTrunk || (satellites.length === 0 && mainBottomFrac < .16 && woodRatio < .12)
    const worldH = isShrub ? 1.85 : satellites.length > 0 ? 5.6 : 6.4
    const px2m = worldH / treeH

    // C-2 Automatic Leaf-Style Matching (sakura / maple / willow / cloud / default)
    // Measure hanging vertical drapery score on green broadleaf canopies to detect weeping willows
    let vertEdges = 0, horizEdges = 0
    for (let y = mainBlob.minY + 1; y < mainBlob.maxY; y++) {
      for (let x = mainBlob.minX + 1; x < mainBlob.maxX; x++) {
        const i = y * W + x
        if (mask[i] !== MASK_FOLIAGE) continue
        if (mask[i - 1] !== MASK_FOLIAGE || mask[i + 1] !== MASK_FOLIAGE) vertEdges++
        if (mask[i - W] !== MASK_FOLIAGE || mask[i + W] !== MASK_FOLIAGE) horizEdges++
      }
    }
    const vertToHoriz = vertEdges / Math.max(1, horizEdges)
    const isWillow = !isShrub && foliageStyle === 'green' && satellites.length === 0 &&
      mainBlob.height > mainBlob.width * .92 && mainBottomFrac < .3 && vertToHoriz > 1.38
    chosenLeafStyle = foliageStyle === 'blossom' ? 'sakura'
      : foliageStyle === 'autumn' ? 'maple'
        : isWillow ? 'willow'
          : (canopyPorosity < .075 && !isShrub) ? 'cloud' : 'default'
    const leafTex: LeafTextureSource = chosenLeafStyle === 'default' ? 'auto' : chosenLeafStyle

    // Trace main trunk real medial-axis spine beneath mainBlob
    const mainSearchXLo = Math.round(mainBlob.cx - mainBlob.width * .42)
    const mainSearchXHi = Math.round(mainBlob.cx + mainBlob.width * .42)
    const mainForkRow = Math.round(mainBlob.maxY - mainBlob.height * .16)
    const tracedMain = !isShrub
      ? extractTrunkSpine(mask, woodDist, W, H, mainSearchXLo, mainSearchXHi, mainForkRow, groundY, mainBlob.cx, px2m, 1)
      : undefined
    const trunkTrace = traceWood(mainSearchXLo, mainSearchXHi, mainForkRow, groundY)
    const rootSlice = trunkTrace.length ? trunkTrace.slice(Math.floor(trunkTrace.length * .82)) : []
    const midSlice = trunkTrace.length ? trunkTrace.slice(Math.floor(trunkTrace.length * .35), Math.floor(trunkTrace.length * .65)) : []
    const topSlice = trunkTrace.length ? trunkTrace.slice(0, Math.max(1, Math.floor(trunkTrace.length * .2))) : []

    const rootX = tracedMain ? tracedMain.rootX : (rootSlice.length ? median(rootSlice.map(s => s.cx)) : mainBlob.cx)
    const forkX = tracedMain ? tracedMain.topX : (topSlice.length ? median(topSlice.map(s => s.cx)) : mainBlob.cx)
    const rootWidthPx = tracedMain ? tracedMain.rootRadiusPx * 2 : (rootSlice.length ? median(rootSlice.map(s => s.w)) : treeW * .08)
    const midWidthPx = tracedMain ? tracedMain.midRadiusPx * 2 : (midSlice.length ? median(midSlice.map(s => s.w)) : rootWidthPx * .72)

    // S-curve wobble measured as max lateral excursion from root->fork chord
    let maxDevPx = 0
    if (trunkTrace.length >= 4) {
      const y0 = trunkTrace[trunkTrace.length - 1].y, y1 = trunkTrace[0].y
      for (const s of trunkTrace) {
        const t = (s.y - y0) / Math.max(1, y1 - y0)
        const chordX = MathUtils.lerp(rootX, forkX, t)
        maxDevPx = Math.max(maxDevPx, Math.abs(s.cx - chordX))
      }
    }

    const spec: TreeSpec = presetSpec(isShrub ? 'shrub-spread' : 'broadleaf-open', seed)
    spec.name = imageName
    spec.trunk.height = Number(worldH.toFixed(2))
    spec.trunk.barkColor = barkHex
    const estRadius = MathUtils.clamp(midWidthPx * .38 * px2m, isShrub ? .07 : .16, .33)
    spec.trunk.radius = Number(estRadius.toFixed(3))
    spec.trunk.flare = Number(MathUtils.clamp((rootWidthPx / Math.max(1, midWidthPx) - 1) * .8 + .48, .35, 1.15).toFixed(2))
    spec.trunk.flareHeight = Number(MathUtils.clamp(worldH * .14, .35, .95).toFixed(2))

    // Main crown vertical & horizontal bounds in world meters
    const mainTopM = MathUtils.clamp((groundY - mainBlob.minY) * px2m, worldH * .65, worldH * 1.05)
    const mainBotM = MathUtils.clamp((groundY - mainBlob.maxY) * px2m, isShrub ? .12 : worldH * .24, mainTopM - .6)
    spec.trunk.height = Number(Math.max(worldH * .82, mainTopM).toFixed(2))
    spec.crown.base = Number(MathUtils.clamp(mainBotM / spec.trunk.height, .08, .72).toFixed(2))
    spec.crown.top = 1
    spec.crown.width = Number(MathUtils.clamp(mainBlob.width * .54 * px2m, isShrub ? .65 : 1.4, 4.4).toFixed(2))
    spec.crown.depth = Number(MathUtils.clamp(satellites.length > 0 ? .84 : .92, .65, 1.15).toFixed(2))
    spec.crown.roundness = Number(MathUtils.clamp(foliageStyle === 'blossom' ? 2.5 : 2.2, 1.6, 3.6).toFixed(2))
    spec.crown.topBias = Number(MathUtils.clamp(foliageStyle === 'blossom' ? 1.3 : 1.15, .8, 1.8).toFixed(2))
    spec.crown.irregularity = .42

    if (!isShrub) {
      const forkM = MathUtils.clamp(mainBotM + (mainTopM - mainBotM) * .12, spec.trunk.height * .26, spec.trunk.height * .62)
      spec.trunk.forkHeight = Number((forkM / spec.trunk.height).toFixed(2))
      // Aim trunk top slightly toward mainBlob horizontal center
      const leanX = ((mainBlob.cx * .65 + forkX * .35) - rootX) * px2m
      spec.trunk.lean = Number(MathUtils.clamp(Math.abs(leanX) * 1.15, .15, 1.45).toFixed(2))
      spec.trunk.leanAngle = leanX >= 0 ? 0 : 180
      spec.trunk.wobble = Number(MathUtils.clamp(maxDevPx * px2m * .95 + (satellites.length > 0 ? .14 : 0), .12, .46).toFixed(2))
      spec.trunk.gnarl = satellites.length > 0 ? .45 : MathUtils.clamp(maxDevPx * px2m * .85, .12, .55)
      spec.trunk.surfaceRoots = satellites.length > 0 || spec.trunk.flare > .7 ? 5 : 3
      if (tracedMain) {
        spec.trunk.spine = tracedMain.spine
        tracedSpines++
      }
      spec.trunk.barkRidges = 8
      spec.trunk.barkDepth = .065
      spec.crown.canopyLift = satellites.length > 0 ? .34 : .2
      spec.crown.padFlatten = foliageStyle === 'blossom' || satellites.length > 0 ? .44 : .18
      spec.shading.petals = foliageStyle === 'blossom' ? 22 : foliageStyle === 'autumn' ? 14 : 0
      spec.branches.count = satellites.length > 0 ? 6 : 7
      spec.branches.angle = 26
      spec.branches.angleTop = 58
      spec.branches.curvature = satellites.length > 0 ? .62 : .42
      spec.branches.droop = satellites.length > 0 ? .22 : .15
      spec.branches.radiusRatio = .62
      spec.branches.childCount = 4
    }

    // Calibrate leaf / blossom cards by matched leafStyle (C-2)
    spec.shading.leafStyle = chosenLeafStyle
    spec.leaves.tintInner = foliageInner
    spec.leaves.tintOuter = foliageOuter
    spec.leaves.tintVariance = .16
    if (foliageStyle === 'blossom') {
      const scaleK = MathUtils.clamp(spec.crown.width / 2.6, .6, 1.4)
      spec.leaves.cardType = 'quad'
      spec.leaves.leafSize = Number((.64 * scaleK).toFixed(2))
      spec.leaves.leafPivot = .48
      spec.leaves.leavesPerTwig = 9
      spec.leaves.clumpFill = 6.5
      spec.leaves.clumpFillScale = 1.45
      spec.leaves.faceOutward = .9
      spec.leaves.cameraFacing = .3
      spec.leaves.normalSpherize = .85
      spec.leaves.aoStrength = .2
      spec.leaves.alphaCutoff = .46
      spec.leaves.pruneInner = .24
    } else if (chosenLeafStyle === 'willow') {
      spec.branches.droop = .85
      spec.branches.childDroop = .88
      spec.leaves.cardType = 'drape'
      spec.leaves.twigUpBias = -.45
      spec.leaves.twigGravity = -.8
      spec.leaves.leafSize = 1.55
      spec.leaves.leafAspect = .5
      spec.leaves.leafSizeVariance = .36
      spec.leaves.leafPivot = 0
      spec.leaves.leavesPerTwig = 6
      spec.leaves.limbLeafFrequency = 3.5
      spec.leaves.clumpFill = 2.8
      spec.leaves.cameraFacing = 0
      spec.leaves.alphaCutoff = .38
      spec.leaves.aoStrength = .36
    } else if (chosenLeafStyle === 'maple') {
      spec.leaves.leafSize = .72
      spec.leaves.leafPivot = .3
      spec.leaves.aoStrength = .3
      spec.leaves.alphaCutoff = .44
      spec.leaves.tintVariance = .22
      spec.leaves.clumpFill = Number(MathUtils.clamp(5.4 - canopyPorosity * 7, 2.5, 6.8).toFixed(1))
    } else if (chosenLeafStyle === 'cloud') {
      spec.leaves.leafSize = .84
      spec.leaves.leafPivot = .45
      spec.leaves.faceOutward = .84
      spec.leaves.aoStrength = .32
      spec.leaves.alphaCutoff = .44
      spec.leaves.clumpFill = Number(MathUtils.clamp(5.6 - canopyPorosity * 6, 3.0, 7.2).toFixed(1))
    } else {
      spec.leaves.aoStrength = .52
      spec.leaves.clumpFill = Number(MathUtils.clamp(5.2 - canopyPorosity * 8, 2.2, 7).toFixed(1))
    }

    if (hasAccentFlowers && accentFlowerHex) {
      spec.flowers.enabled = true
      spec.flowers.count = Math.round(MathUtils.clamp(accentSamples.length / Math.max(1, foliageCount) * 420, 35, 140))
      spec.flowers.tintOuter = accentFlowerHex
      spec.flowers.tintInner = quantileColor(accentSamples, .22, 1.05, -.08, accentFlowerHex)
    }

    // Fit asymmetric silhouette contour of mainBlob via real CrownHandles
    const baseSk = buildSkeleton({ ...spec, handles: [] })
    const env = baseSk.envelope
    const handles: CrownHandle[] = []
    let hid = 1
    const sampleBlobExtentAt = (u: number) => {
      const y = Math.round(mainBlob.maxY - u * (mainBlob.height - 1))
      let lx = W, rx = -1
      for (let x = mainBlob.minX; x <= mainBlob.maxX; x++) {
        if (opened[y * W + x] === MASK_FOLIAGE && comps.labels[y * W + x] === mainBlob.id) {
          if (x < lx) lx = x
          if (x > rx) rx = x
        }
      }
      return rx >= lx ? { lx, rx } : undefined
    }
    const sampleBlobTopAt = (xNorm: number) => {
      const x = MathUtils.clamp(Math.round(mainBlob.minX + xNorm * (mainBlob.width - 1)), 0, W - 1)
      for (let y = mainBlob.minY; y <= mainBlob.maxY; y++) {
        if (opened[y * W + x] === MASK_FOLIAGE && comps.labels[y * W + x] === mainBlob.id) return (groundY - y) * px2m
      }
      return undefined
    }

    const pushHandle = (u: number, theta: number, dx: number, dy: number, radScale = .85) => {
      if (Math.hypot(dx, dy) < spec.crown.width * .1) return
      const anchor = env.surface(u, theta)
      handles.push({
        id: hid++, kind: 'shape',
        anchor: [Number(anchor.x.toFixed(2)), Number(anchor.y.toFixed(2)), Number(anchor.z.toFixed(2))],
        offset: [Number(MathUtils.clamp(dx, -spec.crown.width * .65, spec.crown.width * .65).toFixed(2)),
          Number(MathUtils.clamp(dy, -env.height * .5, env.height * .45).toFixed(2)), 0],
        radius: Number((spec.crown.width * radScale).toFixed(2)),
      })
    }

    for (const u of [.35, .72]) {
      const ext = sampleBlobExtentAt(u)
      if (!ext) continue
      const targetLeftX = (ext.lx - rootX) * px2m
      const targetRightX = (ext.rx - rootX) * px2m
      const surfL = env.surface(u, Math.PI)
      const surfR = env.surface(u, 0)
      const topL = sampleBlobTopAt(.22), topR = sampleBlobTopAt(.78)
      const dyL = u > .5 && topL !== undefined ? (topL - env.y1) * .55 : 0
      const dyR = u > .5 && topR !== undefined ? (topR - env.y1) * .55 : 0
      pushHandle(u, Math.PI, targetLeftX - surfL.x, dyL, .78)
      pushHandle(u, 0, targetRightX - surfR.x, dyR, .78)
    }
    spec.handles = handles

    parts.push({
      id: 'part-main', label: satellites.length > 0 ? '主干与主冠' : '主植物体',
      enabled: true, position: [0, 0, 0], rotationY: 0, scale: 1, leafTexture: leafTex, spec,
    })

    // ---- Satellite sub-trunks + crowns (e.g. lower-left & lower-right bonsai clouds) ----
    satellites.forEach((blob, idx) => {
      const satTopM = MathUtils.clamp((groundY - blob.minY) * px2m, 1.3, spec.trunk.height * .85)
      const satBotM = MathUtils.clamp((groundY - (blob.maxY - blob.height * .12)) * px2m, .55, satTopM - .55)
      const satWidthM = MathUtils.clamp(blob.width * .46 * px2m, .58, spec.crown.width * .62)
      const blobCenterX = (blob.cx - rootX) * px2m
      // Locate supporting stem base & real curved spine below this satellite crown, excluding the main trunk band
      const isLeft = blob.cx < rootX
      const excl = Math.max(4, Math.round(midWidthPx * .78))
      const subXLo = isLeft ? Math.max(0, blob.minX - 6) : Math.round(rootX + excl)
      const subXHi = isLeft ? Math.round(rootX - excl) : Math.min(W - 1, blob.maxX + 6)
      const subForkRow = Math.round(blob.maxY - blob.height * .15)
      const zSign = idx % 2 === 0 ? 1 : -1
      const tracedSub = subXHi > subXLo
        ? extractTrunkSpine(mask, woodDist, W, H, subXLo, subXHi, subForkRow, groundY, blob.cx, px2m, -zSign)
        : undefined
      const subWood = subXHi >= subXLo ? traceWood(subXLo, subXHi, subForkRow, groundY) : []
      const subBot = subWood.length ? subWood.slice(Math.floor(subWood.length * .65)) : []
      const subRootX = tracedSub
        ? (tracedSub.rootX - rootX) * px2m
        : (subBot.length ? (median(subBot.map(s => s.cx)) - rootX) * px2m : blobCenterX * .72)
      const subMidW = tracedSub
        ? tracedSub.midRadiusPx * 1.15 * px2m
        : (subWood.length ? median(subWood.map(s => s.w)) * .38 * px2m : spec.trunk.radius * .44)
      const leanX = blobCenterX - subRootX
      // Give subtle 3D depth staggering so the bonsai looks sculptural in 45° / side views
      const zOffset = zSign * Math.min(.55, Math.abs(blobCenterX) * .22)

      const subSpec = presetSpec('broadleaf-open', seed + (idx + 1) * 97)
      subSpec.name = blobCenterX < 0 ? '左侧枝冠' : '右侧枝冠'
      subSpec.trunk.height = Number(satTopM.toFixed(2))
      subSpec.trunk.radius = Number(MathUtils.clamp(subMidW, .09, spec.trunk.radius * .52).toFixed(3))
      subSpec.trunk.taper = 1.05
      subSpec.trunk.flare = .48
      subSpec.trunk.flareHeight = .4
      subSpec.trunk.barkColor = barkHex
      subSpec.trunk.forkHeight = Number(MathUtils.clamp((satBotM + (satTopM - satBotM) * .18) / satTopM, .45, .74).toFixed(2))
      subSpec.trunk.lean = Number(MathUtils.clamp(Math.abs(leanX) * 1.15, .15, 1.35).toFixed(2))
      subSpec.trunk.leanAngle = leanX >= 0 ? 0 : 180
      subSpec.trunk.wobble = Number(MathUtils.clamp(.2 + Math.abs(leanX) * .14, .18, .42).toFixed(2))
      subSpec.trunk.gnarl = .38
      subSpec.trunk.surfaceRoots = 2
      if (tracedSub) {
        subSpec.trunk.spine = tracedSub.spine
        tracedSpines++
      }
      subSpec.crown.base = Number(MathUtils.clamp(satBotM / satTopM, .44, .72).toFixed(2))
      subSpec.crown.canopyLift = .28
      subSpec.crown.padFlatten = foliageStyle === 'blossom' ? .42 : .18
      subSpec.crown.top = 1
      subSpec.crown.width = Number(satWidthM.toFixed(2))
      subSpec.crown.depth = .9
      subSpec.crown.roundness = 2.2
      subSpec.crown.topBias = 1.15
      subSpec.crown.irregularity = .35
      subSpec.branches.count = 5
      subSpec.branches.angle = 32
      subSpec.branches.angleTop = 64
      subSpec.branches.curvature = .48
      subSpec.branches.droop = .16
      subSpec.branches.radiusRatio = .58
      subSpec.branches.childCount = 3
      subSpec.shading.leafStyle = chosenLeafStyle
      subSpec.leaves = {
        ...spec.leaves,
        leafSize: Number(MathUtils.clamp(spec.leaves.leafSize * .78, .3, .65).toFixed(2)),
        twigLength: Number(MathUtils.clamp(satWidthM * .42, .28, .65).toFixed(2)),
        leavesPerTwig: 8,
        clumpFill: 5.2,
        clumpFillScale: 1.35,
        leafSeed: (seed + idx * 17) % 9999,
      }

      parts.push({
        id: `part-sub-${idx + 1}`,
        label: blobCenterX < 0 ? `左侧分干与副冠 ${idx + 1}` : `右侧分干与副冠 ${idx + 1}`,
        enabled: true,
        position: [Number(subRootX.toFixed(2)), 0, Number(zOffset.toFixed(2))],
        rotationY: 0,
        scale: 1,
        leafTexture: leafTex,
        spec: subSpec,
      })
    })

    // ---- Ground grass / meadow skirt at root base (if detected) ------------
    if (hasGroundSkirt && groundBaseHex && groundTipHex) {
      const skirtRadius = MathUtils.clamp((groundMaxX - groundMinX) * .48 * px2m, .85, 2.8)
      const skirtH = MathUtils.clamp((groundMaxY - groundMinY + 1) * px2m * .9, .24, .58)
      // Check if ground carpet is non-green (e.g. pink sakura grass, golden autumn grass) -> use neutral tintable blade texture
      const greenGroundCount = activeGroundSamples.filter(([r, g, b]) => {
        const [h, s] = rgbToHsl(r, g, b)
        return s >= .2 && h >= 58 && h <= 176
      }).length
      const groundIsGreen = greenGroundCount > activeGroundSamples.length * .5
      const grassSpec = presetSpec('grass-clump', seed + 503)
      grassSpec.name = '根部草丛基底'
      grassSpec.ground.mode = 'card'
      grassSpec.ground.count = Math.round(MathUtils.clamp(skirtRadius * 64, 75, 160))
      grassSpec.ground.spread = Number(MathUtils.clamp(skirtRadius * .94, .65, 2.5).toFixed(2))
      grassSpec.ground.length = Number(skirtH.toFixed(2))
      grassSpec.ground.lengthVariance = .42
      grassSpec.ground.width = .095
      grassSpec.ground.lean = 26
      grassSpec.ground.arch = .36
      grassSpec.ground.planes = 2
      grassSpec.ground.segments = 4
      grassSpec.ground.spherize = .55
      grassSpec.ground.tintBase = groundBaseHex
      grassSpec.ground.tintTip = groundTipHex
      grassSpec.ground.aoStrength = groundIsGreen ? .35 : .14
      parts.push({
        id: 'part-ground',
        label: '根部草丛基底',
        enabled: true,
        position: [0, 0, 0],
        rotationY: 0,
        scale: 1,
        leafTexture: groundIsGreen ? 'grass' : 'grassTint',
        spec: grassSpec,
      })

      // If blossom tree also has delicate wildflowers rising slightly out of the ground carpet
      if (foliageStyle === 'blossom') {
        const fbSpec = presetSpec('flowerbed-stemmed', seed + 709)
        fbSpec.name = '根部点缀小花'
        fbSpec.flowerbed.count = 14
        fbSpec.flowerbed.spread = Number(MathUtils.clamp(skirtRadius * .86, .55, 2.2).toFixed(2))
        fbSpec.flowerbed.height = Number(MathUtils.clamp(skirtH * 1.45, .36, .75).toFixed(2))
        fbSpec.flowerbed.heightVariance = .42
        fbSpec.flowerbed.stemRadius = .005
        fbSpec.flowerbed.stemLeaves = 1
        fbSpec.flowerbed.stemLeafSize = .07
        fbSpec.flowerbed.flowerSize = .095
        fbSpec.flowerbed.tintInner = foliageInner
        fbSpec.flowerbed.tintOuter = foliageOuter
        fbSpec.flowerbed.stemTint = barkHex
        parts.push({
          id: 'part-ground-flowers',
          label: '根部点缀小花',
          enabled: true,
          position: [0, 0, 0],
          rotationY: 0,
          scale: 1,
          leafTexture: 'blossom',
          spec: fbSpec,
        })
      }
    }
  }

  const kindLabel: Record<TreeKind, string> = {
    broadleaf: foliageStyle === 'blossom' ? '观花阔叶树 / 樱花盆景' : '阔叶树',
    conifer: '针叶树',
    palm: '棕榈树',
    grass: '草丛',
    fern: '蕨类',
    flowerbed: '花丛',
  }
  const styleNames: Record<LeafStyle, string> = {
    default: '标准阔叶', cloud: '厚涂圆云叶', oak: '手绘厚涂橡叶叠簇', bush: '翠绿尖叶灌木簇', sakura: '樱花柔瓣簇', maple: '枫叶五角簇', willow: '垂柳细长丝', flower: '通用花簇',
  }
  const summaryParts = [
    `识别类型：${kindLabel[kind]}`,
    crownCount > 1 ? `多冠分干：${crownCount} 组树冠` : '单冠主体',
    tracedSpines > 0 ? `真树干样条复刻 ×${tracedSpines}` : null,
    kind === 'broadleaf' ? `匹配叶型：${styleNames[chosenLeafStyle]}` : null,
    hasGroundSkirt ? '含根部草地基底' : null,
    hasAccentFlowers ? '含表层花朵装饰' : null,
  ].filter(Boolean)
  const summary = summaryParts.join(' · ')

  const report: AnalysisReport = {
    kind, foliageStyle, leafStyle: chosenLeafStyle, crownCount, tracedSpines, hasGroundSkirt, hasAccentFlowers,
    aspectRatio: Number(aspectRatio.toFixed(2)),
    woodRatio: Number(woodRatio.toFixed(3)),
    canopyPorosity: Number(canopyPorosity.toFixed(3)),
    palette,
    summary,
  }
  const scene: AiSceneSpec = {
    schemaVersion: 1,
    mode: 'ai-blank',
    name: imageName.replace(/\.[^.]+$/, '') || 'AI 生成植物',
    sourceImage: imageName,
    summary,
    parts,
  }
  return { report, scene }
}
