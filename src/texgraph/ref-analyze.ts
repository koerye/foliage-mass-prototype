// Automatic Structural Reference Image Analyzer -> Editable v2 Draft TextureGraph + Confidence & Evidence.
// Runs identically in Browser and Node CLI (zero DOM / Canvas dependencies).
import {
  clamp01, extractLabPalette, resizeImageData,
  rgb01ToHex, rgbToHsv, srgbToLab, type RgbaImageData,
} from './image-utils'
import { createNode, normalizeGraphSchemaVersion } from './nodes'
import { computeEdt2d } from './nodes-v2'
import { extractImageFeatures, type ScoreMode } from './ref-score'
import type {
  GraphEdge, TextureGraph, VectorLeafInstance, VectorStem,
} from './types'

export const ANALYZER_VERSION = '2.0'

export type RefArchetype = 'vine' | 'cluster_flat' | 'bush_inked' | 'bark_tile' | 'atlas_2x2'

export interface OptimizableParamSpec {
  nodeId: string
  key: string
  min: number
  max: number
  step: number
  stage: 1 | 2 | 3
}

export interface RefAnalysisResult {
  analyzerVersion: string
  kind: RefArchetype
  scoreMode: ScoreMode
  confidence: number
  evidence: {
    alphaCoverage: number
    woodRatio: number
    mossRatio: number
    inkOutlineScore: number
    inkOuterWidthPx: number
    inkColorHex: string
    dominantAngleDeg: number
    corrLenX: number
    corrLenY: number
    detectedLeaves: number
    detectedStems: number
    palette: string[]
    woodPalette?: string[]
    mossPalette?: string[]
    lightDirDeg: number
    notes: string[]
  }
  draftGraph: TextureGraph
  recommendedParams: OptimizableParamSpec[]
}

const edge = (fromNode: string, fromPort: string, toNode: string, toPort: string): GraphEdge => ({
  id: `${fromNode}.${fromPort}->${toNode}.${toPort}`,
  fromNode, fromPort, toNode, toPort,
})

function isWoodPixel(r: number, g: number, b: number, h: number, s: number, v: number): boolean {
  // Warm brown woody stems: hue 10°..54°, R clearly >= G >= B, moderate saturation, not near-white
  return h >= 10 && h <= 54 && s >= 0.20 && v >= 0.08 && v <= 0.72 && r > g * 1.03 && g >= b * 1.02
}

function isMossPixel(h: number, s: number, v: number, labA: number): boolean {
  return h >= 56 && h <= 162 && s >= 0.20 && v >= 0.12 && labA < -7
}

/** Ramer-Douglas-Peucker polyline simplification to bounded control point count. */
function simplifyPolyline(pts: [number, number][], eps: number, maxPts = 6): [number, number][] {
  if (pts.length <= 2) return pts
  const rdp = (arr: [number, number][], tol: number): [number, number][] => {
    if (arr.length <= 2) return arr
    const [x1, y1] = arr[0]
    const [x2, y2] = arr[arr.length - 1]
    const dx = x2 - x1, dy = y2 - y1
    const len = Math.hypot(dx, dy) || 1e-6
    let maxD = -1, idx = 0
    for (let i = 1; i < arr.length - 1; i++) {
      const d = Math.abs(dy * arr[i][0] - dx * arr[i][1] + x2 * y1 - y2 * x1) / len
      if (d > maxD) { maxD = d; idx = i }
    }
    if (maxD > tol) {
      const left = rdp(arr.slice(0, idx + 1), tol)
      const right = rdp(arr.slice(idx), tol)
      return [...left.slice(0, -1), ...right]
    }
    return [arr[0], arr[arr.length - 1]]
  }
  let res = rdp(pts, eps)
  let curEps = eps
  while (res.length > maxPts && curEps < 0.08) {
    curEps *= 1.35
    res = rdp(pts, curEps)
  }
  if (res.length === 2) {
    const mid = pts[Math.floor(pts.length / 2)]
    res = [res[0], mid, res[1]]
  }
  return res.map(([x, y]) => [Number(x.toFixed(4)), Number(y.toFixed(4))])
}

/** Extracts smooth medial-axis woody Bezier stems via weighted geodesic diameter tracing. */
function extractVectorStems(
  woodMask: Uint8Array,
  sd: Uint8ClampedArray,
  w: number,
  h: number,
): { stems: VectorStem[]; stemColorHex: string } {
  const n = w * h
  // Light 1px morphological closing bridges thin anti-aliased gaps in thin stems
  const closed = new Uint8Array(woodMask)
  for (let y = 1; y < h - 1; y++) {
    const row = y * w
    for (let x = 1; x < w - 1; x++) {
      const i = row + x
      if (!woodMask[i]) {
        const nbr = woodMask[i - 1] + woodMask[i + 1] + woodMask[i - w] + woodMask[i + w]
        if (nbr >= 3) closed[i] = 1
      }
    }
  }

  // Average woody color
  let rSum = 0, gSum = 0, bSum = 0, wCnt = 0
  for (let i = 0; i < n; i++) {
    if (!closed[i]) continue
    const o = i * 4
    rSum += sd[o] / 255; gSum += sd[o + 1] / 255; bSum += sd[o + 2] / 255; wCnt++
  }
  const stemColorHex = wCnt > 0 ? rgb01ToHex(rSum / wCnt, gSum / wCnt, bSum / wCnt) : '#75583a'

  // Exact distance to outside of wood gives exact local half-width along stems!
  const invWood = new Uint8Array(n)
  for (let i = 0; i < n; i++) invWood[i] = closed[i] ? 0 : 1
  const radMap = computeEdt2d(invWood, w, h, false)

  // Connected components on closed wood mask
  const visited = new Uint8Array(n)
  const residual = new Uint8Array(closed)
  const stems: VectorStem[] = []

  const nbrOffsets = [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1]
  const nbrStep = [1, 1, 1, 1, 1.414, 1.414, 1.414, 1.414]

  const traceGeodesicComponent = (seedPixels: number[]): number[] => {
    const compSet = new Uint8Array(n)
    for (const p of seedPixels) compSet[p] = 1

    const bfsFarthest = (start: number): { far: number; parent: Int32Array } => {
      const dist = new Float32Array(n).fill(-1)
      const parent = new Int32Array(n).fill(-1)
      const q = new Int32Array(seedPixels.length + 8)
      let head = 0, tail = 0
      dist[start] = 0
      q[tail++] = start
      let far = start, maxD = 0
      while (head < tail) {
        const cur = q[head++]
        const cx = cur % w, cy = (cur - cx) / w
        const cd = dist[cur]
        if (cd > maxD) { maxD = cd; far = cur }
        for (let k = 0; k < 8; k++) {
          const nx = cx + (k === 0 ? -1 : k === 1 ? 1 : k === 4 || k === 6 ? -1 : k === 5 || k === 7 ? 1 : 0)
          const ny = cy + (k === 2 ? -1 : k === 3 ? 1 : k === 4 || k === 5 ? -1 : k === 6 || k === 7 ? 1 : 0)
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
          const ni = cur + nbrOffsets[k]
          if (!compSet[ni] || dist[ni] >= 0) continue
          // Slight bias toward centerline via radMap
          dist[ni] = cd + nbrStep[k] / (0.65 + radMap[ni] * 0.4)
          parent[ni] = cur
          q[tail++] = ni
        }
      }
      return { far, parent }
    }

    const p1 = bfsFarthest(seedPixels[0]).far
    const res2 = bfsFarthest(p1)
    const path: number[] = []
    let cur = res2.far
    while (cur >= 0) {
      path.push(cur)
      cur = res2.parent[cur]
    }
    return path
  }

  // Iteratively extract main stems + forked sub-branches until no substantial wood fragment remains
  for (let pass = 0; pass < 2 && stems.length < 14; pass++) {
    visited.fill(0)
    const components: number[][] = []
    for (let i = 0; i < n; i++) {
      if (!residual[i] || visited[i]) continue
      const comp: number[] = []
      const stack = [i]
      visited[i] = 1
      while (stack.length) {
        const cur = stack.pop()!
        comp.push(cur)
        const cx = cur % w, cy = (cur - cx) / w
        for (let k = 0; k < 8; k++) {
          const nx = cx + (k === 0 ? -1 : k === 1 ? 1 : k === 4 || k === 6 ? -1 : k === 5 || k === 7 ? 1 : 0)
          const ny = cy + (k === 2 ? -1 : k === 3 ? 1 : k === 4 || k === 5 ? -1 : k === 6 || k === 7 ? 1 : 0)
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
          const ni = cur + nbrOffsets[k]
          if (residual[ni] && !visited[ni]) { visited[ni] = 1; stack.push(ni) }
        }
      }
      if (comp.length >= 26) components.push(comp)
    }
    components.sort((a, b) => b.length - a.length)

    for (const comp of components) {
      if (stems.length >= 14) break
      const path = traceGeodesicComponent(comp)
      if (path.length < 12) continue

      // Orient stem from thicker/lower base to thinner/higher tip
      const r0 = radMap[path[0]]
      const r1 = radMap[path[path.length - 1]]
      const y0 = Math.floor(path[0] / w)
      const y1 = Math.floor(path[path.length - 1] / w)
      if (r1 > r0 * 1.15 || (Math.abs(r1 - r0) <= r0 * 0.15 && y1 > y0)) {
        path.reverse()
      }

      // Smooth centerline slightly before RDP
      const normPts: [number, number][] = path.map((idx, k) => {
        let sx = 0, sy = 0, sc = 0
        for (let j = Math.max(0, k - 2); j <= Math.min(path.length - 1, k + 2); j++) {
          const pi = path[j]
          sx += (pi % w + 0.5) / w
          sy += (Math.floor(pi / w) + 0.5) / h
          sc++
        }
        return [sx / sc, sy / sc]
      })

      // Compute median stem radii near base and tip
      const qLen = Math.max(2, Math.floor(path.length * 0.22))
      let radStart = 0, radEnd = 0
      for (let k = 0; k < qLen; k++) {
        radStart += radMap[path[k]]
        radEnd += radMap[path[path.length - 1 - k]]
      }
      const ws = Math.max(0.004, Math.min(0.022, (radStart / qLen) / w * 1.15))
      const we = Math.max(0.0025, Math.min(ws, (radEnd / qLen) / w * 1.05))
      const simplePts = simplifyPolyline(normPts, 0.015, 6)

      stems.push({
        id: `stem-${String(stems.length + 1).padStart(2, '0')}`,
        points: simplePts,
        widthStart: Number(ws.toFixed(4)),
        widthEnd: Number(we.toFixed(4)),
        z: Number((0.18 + stems.length * 0.015).toFixed(3)),
        color: stemColorHex,
      })

      // Erase pixels belonging to this traced stem from `residual` so forked branches can be discovered on pass 2!
      for (const pi of path) {
        const px = pi % w, py = Math.floor(pi / w)
        const eraseR = Math.max(3, Math.ceil(radMap[pi] * 2.1))
        for (let dy = -eraseR; dy <= eraseR; dy++) {
          const ny = py + dy
          if (ny < 0 || ny >= h) continue
          for (let dx = -eraseR; dx <= eraseR; dx++) {
            const nx = px + dx
            if (nx < 0 || nx >= w) continue
            if (dx * dx + dy * dy <= eraseR * eraseR) residual[ny * w + nx] = 0
          }
        }
      }
    }
  }

  return { stems, stemColorHex }
}

/**
 * Multi-signal marker-controlled leaf instance extractor.
 * Combines alpha distance peaks, Lab color boundaries, wood stem cuts, and dark ink seams
 * to fit oriented, color-indexed, z-ordered editable VectorLeafInstances.
 */
function extractVectorLeaves(
  img: RgbaImageData,
  lab: Float32Array,
  alphaBin: Uint8Array,
  woodMask: Uint8Array,
  stems: VectorStem[],
  palette: { hex: string; lab: [number, number, number]; weight: number }[],
  opts: { hasInkOutline: boolean; inkLThresh: number; archetype: 'vine' | 'cluster_flat' | 'bush_inked' },
): {
  instances: VectorLeafInstance[]
  medianAspect: number
  confidence: number
} {
  const w = img.width, h = img.height, n = w * h
  const leafMask = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (alphaBin[i] && !woodMask[i]) leafMask[i] = 1
  }

  // 1. Compute Lab boundary magnitude + optional dark ink seam barrier
  const labGrad = new Float32Array(n)
  const barrier = new Uint8Array(n)
  const colorJumpThresh = opts.archetype === 'cluster_flat' ? 7.2 : opts.archetype === 'vine' ? 8.8 : 13.5

  for (let y = 1; y < h - 1; y++) {
    const row = y * w
    for (let x = 1; x < w - 1; x++) {
      const i = row + x
      if (!leafMask[i]) continue
      const L = lab[i * 3], A = lab[i * 3 + 1], B = lab[i * 3 + 2]
      let maxD = 0
      for (const ni of [i - 1, i + 1, i - w, i + w]) {
        if (!leafMask[ni]) continue
        const d = Math.hypot(L - lab[ni * 3], A - lab[ni * 3 + 1], B - lab[ni * 3 + 2])
        if (d > maxD) maxD = d
      }
      labGrad[i] = maxD
      if (maxD >= colorJumpThresh) barrier[i] = 1
      if (opts.hasInkOutline && L <= opts.inkLThresh) barrier[i] = 1
    }
  }

  // 2. Core mask = leaf pixels cleanly separated by boundaries/stems/ink
  const coreMask = new Uint8Array(n)
  const invCore = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (leafMask[i] && !barrier[i]) coreMask[i] = 1
    invCore[i] = coreMask[i] ? 0 : 1
  }
  const coreDist = computeEdt2d(invCore, w, h, false)

  // Connected components on coreMask give clean initial leaf regions!
  const labels = new Int32Array(n) // 0 = unassigned, 1..K = region ID
  let nextLabel = 1
  const minCoreArea = opts.archetype === 'vine' ? 18 : 26
  const coreAreas: number[] = []
  const corePixelsById = new Map<number, number[]>()

  const stack: number[] = []
  for (let i = 0; i < n; i++) {
    if (!coreMask[i] || labels[i] !== 0) continue
    const id = nextLabel++
    const pix: number[] = []
    stack.length = 0
    stack.push(i)
    labels[i] = id
    while (stack.length) {
      const cur = stack.pop()!
      pix.push(cur)
      const cx = cur % w, cy = (cur - cx) / w
      if (cx > 0 && coreMask[cur - 1] && !labels[cur - 1]) { labels[cur - 1] = id; stack.push(cur - 1) }
      if (cx + 1 < w && coreMask[cur + 1] && !labels[cur + 1]) { labels[cur + 1] = id; stack.push(cur + 1) }
      if (cy > 0 && coreMask[cur - w] && !labels[cur - w]) { labels[cur - w] = id; stack.push(cur - w) }
      if (cy + 1 < h && coreMask[cur + w] && !labels[cur + w]) { labels[cur + w] = id; stack.push(cur + w) }
    }
    if (pix.length < minCoreArea) {
      for (const p of pix) labels[p] = 0
      nextLabel--
    } else {
      coreAreas.push(pix.length)
      corePixelsById.set(id, pix)
    }
  }

  // 3. Split oversized merged components (touching same-color leaves) via local EDT peaks!
  const sortedAreas = [...coreAreas].sort((a, b) => a - b)
  const medArea = sortedAreas.length ? sortedAreas[Math.floor(sortedAreas.length * 0.5)] : 160
  const splitThresh = opts.archetype === 'cluster_flat'
    ? Math.max(180, medArea * 1.52)
    : Math.max(210, medArea * 1.85)
  const peakMinDist = opts.archetype === 'vine' ? 6 : 9

  for (const [id, pix] of [...corePixelsById.entries()]) {
    if (pix.length < splitThresh) continue
    // Find local maxima of coreDist inside this component
    const peaks: { idx: number; val: number }[] = []
    for (const p of pix) {
      const v = coreDist[p]
      if (v < 3.5) continue
      const px = p % w, py = (p - px) / w
      let isMax = true
      for (let dy = -3; dy <= 3 && isMax; dy++) {
        const ny = py + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -3; dx <= 3; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = px + dx
          if (nx < 0 || nx >= w) continue
          if (coreDist[ny * w + nx] > v + 0.05) { isMax = false; break }
        }
      }
      if (isMax) peaks.push({ idx: p, val: v })
    }
    peaks.sort((a, b) => b.val - a.val)
    const keptPeaks: number[] = []
    for (const pk of peaks) {
      const px = pk.idx % w, py = (pk.idx - px) / w
      if (keptPeaks.every(o => Math.hypot(px - (o % w), py - Math.floor(o / w)) >= peakMinDist)) {
        keptPeaks.push(pk.idx)
        if (keptPeaks.length >= 6) break
      }
    }
    if (keptPeaks.length >= 2) {
      const subIds = keptPeaks.map((_, k) => (k === 0 ? id : nextLabel++))
      // Clear component labels and re-seed from peaks -> Voronoi/geodesic split inside component
      for (const p of pix) labels[p] = 0
      const q: number[] = []
      keptPeaks.forEach((pk, k) => { labels[pk] = subIds[k]; q.push(pk) })
      let head = 0
      while (head < q.length) {
        const cur = q[head++]
        const lbl = labels[cur]
        const cx = cur % w, cy = (cur - cx) / w
        for (const ni of [
          cx > 0 ? cur - 1 : -1,
          cx + 1 < w ? cur + 1 : -1,
          cy > 0 ? cur - w : -1,
          cy + 1 < h ? cur + w : -1,
        ]) {
          if (ni >= 0 && coreMask[ni] && labels[ni] === 0) {
            labels[ni] = lbl
            q.push(ni)
          }
        }
      }
    }
  }

  // 4. Dilate/watershed labels across boundary pixels so every leaf pixel gets exact ownership
  const frontier: number[] = []
  for (let i = 0; i < n; i++) {
    if (labels[i] > 0) frontier.push(i)
  }
  let fHead = 0
  while (fHead < frontier.length) {
    const cur = frontier[fHead++]
    const lbl = labels[cur]
    const cx = cur % w, cy = (cur - cx) / w
    for (const ni of [
      cx > 0 ? cur - 1 : -1,
      cx + 1 < w ? cur + 1 : -1,
      cy > 0 ? cur - w : -1,
      cy + 1 < h ? cur + w : -1,
    ]) {
      if (ni >= 0 && leafMask[ni] && labels[ni] === 0) {
        labels[ni] = lbl
        frontier.push(ni)
      }
    }
  }

  // 5. Gather final pixel lists per label & fit oriented leaf ellipses
  const regMap = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const lbl = labels[i]
    if (lbl <= 0) continue
    let arr = regMap.get(lbl)
    if (!arr) { arr = []; regMap.set(lbl, arr) }
    arr.push(i)
  }

  // Pre-sample dense stem coordinates for resolving 180° leaf orientation (base near stem, tip away!)
  const stemSamples: [number, number][] = []
  for (const st of stems) {
    for (let s = 0; s <= 16; s++) {
      const t = s / 16
      const idxF = t * (st.points.length - 1)
      const i0 = Math.floor(idxF), i1 = Math.min(st.points.length - 1, i0 + 1)
      const f = idxF - i0
      stemSamples.push([
        st.points[i0][0] + (st.points[i1][0] - st.points[i0][0]) * f,
        st.points[i0][1] + (st.points[i1][1] - st.points[i0][1]) * f,
      ])
    }
  }

  interface RawLeafFit {
    x: number
    y: number
    scaleX: number
    scaleY: number
    rot: number
    colorIdx: number
    lumaL: number
    compactness: number
    area: number
    aspect: number
  }

  const rawFits: RawLeafFit[] = []
  const minFinalArea = opts.archetype === 'vine' ? 22 : 38

  for (const pix of regMap.values()) {
    if (pix.length < minFinalArea) continue
    let mx = 0, my = 0
    for (const p of pix) {
      mx += (p % w + 0.5) / w
      my += (Math.floor(p / w) + 0.5) / h
    }
    mx /= pix.length
    my /= pix.length

    // 2x2 central moments
    let cxx = 0, cxy = 0, cyy = 0
    for (const p of pix) {
      const dx = (p % w + 0.5) / w - mx
      const dy = (Math.floor(p / w) + 0.5) / h - my
      cxx += dx * dx; cxy += dx * dy; cyy += dy * dy
    }
    cxx /= pix.length; cxy /= pix.length; cyy /= pix.length
    const tr = cxx + cyy
    const det = Math.max(0, (cxx - cyy) * (cxx - cyy) * 0.25 + cxy * cxy)
    const sq = Math.sqrt(det)
    const lam1 = Math.max(1e-6, tr * 0.5 + sq)
    const lam2 = Math.max(1e-6, tr * 0.5 - sq)

    // Principal major axis unit vector (ux, uy)
    const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy)
    let ux = Math.cos(theta), uy = Math.sin(theta)
    const vx = -uy, vy = ux

    // Exact extent along principal axes + tip taper check to break 180° symmetry!
    let posMin = 0, posMax = 0, sideMax = 0
    let wPosSum = 0, wPosCnt = 0, wNegSum = 0, wNegCnt = 0
    const semiMajEst = Math.max(0.015, 2.0 * Math.sqrt(lam1))
    for (const p of pix) {
      const dx = (p % w + 0.5) / w - mx
      const dy = (Math.floor(p / w) + 0.5) / h - my
      const prj = dx * ux + dy * uy
      const lat = Math.abs(dx * vx + dy * vy)
      if (prj > posMax) posMax = prj
      if (prj < posMin) posMin = prj
      if (lat > sideMax) sideMax = lat
      if (prj > semiMajEst * 0.42) { wPosSum += lat; wPosCnt++ }
      else if (prj < -semiMajEst * 0.42) { wNegSum += lat; wNegCnt++ }
    }

    const avgWPos = wPosCnt > 0 ? wPosSum / wPosCnt : 0.05
    const avgWNeg = wNegCnt > 0 ? wNegSum / wNegCnt : 0.05
    let tipScorePos = avgWNeg - avgWPos // narrower half is the leaf tip!

    // Stem proximity cue: base sits closer to nearest stem, tip points away from stem!
    if (stemSamples.length > 0) {
      const pPlusX = mx + ux * posMax * 0.85, pPlusY = my + uy * posMax * 0.85
      const pMinusX = mx + ux * posMin * 0.85, pMinusY = my + uy * posMin * 0.85
      let dPlus = 10, dMinus = 10
      for (const [sx, sy] of stemSamples) {
        const dp = Math.hypot(pPlusX - sx, pPlusY - sy)
        const dm = Math.hypot(pMinusX - sx, pMinusY - sy)
        if (dp < dPlus) dPlus = dp
        if (dm < dMinus) dMinus = dm
      }
      if (dPlus + 0.012 < dMinus) tipScorePos -= 0.06 // +end is closer to stem -> base!
      else if (dMinus + 0.012 < dPlus) tipScorePos += 0.06
    }

    if (tipScorePos < 0) { ux = -ux; uy = -uy }

    // In custom_leaf / vector_layout, local -Y (upward on image) is leaf tip when rot = 0!
    // Check: in nodes-v2.ts: lx = (dx*cos + dy*sin)/sx, ly = (-dx*sin + dy*cos)/sy;
    // Tip of custom_leaf is at v = 0 (ly = -0.5) -> local (0, -1) maps to world (sin(rot), -cos(rot))!
    // So rot = atan2(ux, -uy)!
    const rot = Math.atan2(ux, -uy)

    // Calibrate ellipse dimensions to custom_leaf blade occupancy (~0.84 vertical, ~0.58 horizontal of stamp)
    const spanMaj = Math.max(0.032, Math.min(0.32, (posMax - posMin) * 0.56 + 4.0 * Math.sqrt(lam1) * 0.44))
    const spanMin = Math.max(0.020, Math.min(0.24, sideMax * 1.12 + 4.0 * Math.sqrt(lam2) * 0.44))
    const scaleY = Math.max(0.05, Math.min(0.40, spanMaj / 0.84))
    const scaleX = Math.max(0.04, Math.min(0.36, spanMin / 0.58))

    // Interior median Lab color (skip dark ink edges!)
    const lArr: number[] = [], aArr: number[] = [], bArr: number[] = []
    for (const p of pix) {
      if (opts.hasInkOutline && lab[p * 3] <= opts.inkLThresh + 4) continue
      lArr.push(lab[p * 3]); aArr.push(lab[p * 3 + 1]); bArr.push(lab[p * 3 + 2])
    }
    const useL = lArr.length >= 6 ? lArr : pix.map(p => lab[p * 3])
    const useA = aArr.length >= 6 ? aArr : pix.map(p => lab[p * 3 + 1])
    const useB = bArr.length >= 6 ? bArr : pix.map(p => lab[p * 3 + 2])
    useL.sort((a, b) => a - b); useA.sort((a, b) => a - b); useB.sort((a, b) => a - b)
    const mL = useL[Math.floor(useL.length * 0.5)]
    const mA = useA[Math.floor(useA.length * 0.5)]
    const mB = useB[Math.floor(useB.length * 0.5)]

    let bestPal = 0, bestD = Infinity
    palette.forEach((pc, idx) => {
      const d = (mL - pc.lab[0]) ** 2 + (mA - pc.lab[1]) ** 2 + (mB - pc.lab[2]) ** 2
      if (d < bestD) { bestD = d; bestPal = idx }
    })

    const ellArea = Math.PI * (spanMaj * 0.5) * (spanMin * 0.5) * (w * h)
    const compactness = clamp01(pix.length / Math.max(1, ellArea))

    rawFits.push({
      x: Number(mx.toFixed(4)),
      y: Number(my.toFixed(4)),
      scaleX: Number(scaleX.toFixed(4)),
      scaleY: Number(scaleY.toFixed(4)),
      rot: Number(rot.toFixed(4)),
      colorIdx: bestPal,
      lumaL: mL,
      compactness,
      area: pix.length,
      aspect: spanMin / Math.max(0.01, spanMaj),
    })
  }

  // Cap at 88 largest / cleanest leaves so vine & dense clusters retain every visible leaf while staying editable!
  rawFits.sort((a, b) => b.area - a.area)
  const kept = rawFits.slice(0, 88)

  // Order z-depth cleanly:
  // - For inked lush bushes: deeper shadowed leaves in back, sunlit brighter intact leaves in front
  // - For flat clusters / vines: more intact (higher compactness) leaves on top of occluded neighbors
  const sortedForZ = [...kept].sort((a, b) => {
    const scoreA = opts.archetype === 'bush_inked'
      ? a.lumaL * 0.014 + a.compactness * 0.55 - a.y * 0.18
      : a.compactness * 0.78 + a.lumaL * 0.004
    const scoreB = opts.archetype === 'bush_inked'
      ? b.lumaL * 0.014 + b.compactness * 0.55 - b.y * 0.18
      : b.compactness * 0.78 + b.lumaL * 0.004
    return scoreA - scoreB
  })

  const instances: VectorLeafInstance[] = sortedForZ.map((f, idx) => ({
    id: `leaf-${String(idx + 1).padStart(2, '0')}`,
    x: f.x,
    y: f.y,
    rot: f.rot,
    scaleX: f.scaleX,
    scaleY: f.scaleY,
    variant: 0,
    colorIdx: f.colorIdx,
    z: Number((0.25 + (idx / Math.max(1, sortedForZ.length)) * 0.72).toFixed(3)),
    flip: false,
  }))

  const intactAspects = kept.filter(f => f.compactness > 0.65).map(f => f.aspect).sort((a, b) => a - b)
  const medianAspect = intactAspects.length ? intactAspects[Math.floor(intactAspects.length * 0.5)] : 0.60
  const confidence = clamp01(0.45 + Math.min(0.48, instances.length / 45 * 0.35 + (intactAspects.length / Math.max(1, kept.length)) * 0.20))

  return { instances, medianAspect, confidence }
}

export function analyzeReferenceImage(
  refImgRaw: RgbaImageData,
  opts: { name?: string; resolution?: 256 | 512 | 1024 } = {},
): RefAnalysisResult {
  const workSize = 256
  const img = resizeImageData(refImgRaw, workSize, workSize)
  const w = img.width, h = img.height, n = w * h
  const sd = img.data
  const targetRes = opts.resolution ?? 512
  const notes: string[] = []

  const lab = new Float32Array(n * 3)
  const alphaBin = new Uint8Array(n)
  const woodMask = new Uint8Array(n)
  let fgCount = 0, woodCount = 0, mossCount = 0
  const fgSamples: [number, number, number][] = []
  const woodSamples: [number, number, number][] = []
  const mossSamples: [number, number, number][] = []
  const sampleStep = Math.max(1, Math.floor(n / 2800))

  let lightSumX = 0, lightSumY = 0, lightWeight = 0

  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const r = sd[o] / 255, g = sd[o + 1] / 255, b = sd[o + 2] / 255
    const a = sd[o + 3]
    const [L, A, B] = srgbToLab(r, g, b)
    lab[i * 3] = L; lab[i * 3 + 1] = A; lab[i * 3 + 2] = B
    if (a >= 128) {
      alphaBin[i] = 1
      fgCount++
      const [hue, sat, val] = rgbToHsv(r, g, b)
      const isW = isWoodPixel(r, g, b, hue, sat, val)
      const isM = isMossPixel(hue, sat, val, A)
      if (isW) woodMask[i] = 1
      if (isW) woodCount++
      if (isM) mossCount++
      if (i % sampleStep === 0) {
        if (isM) mossSamples.push([L, A, B])
        else if (isW) woodSamples.push([L, A, B])
        if (!isW) fgSamples.push([L, A, B])
      }
      const x = (i % w) / w - 0.5
      const y = Math.floor(i / w) / h - 0.5
      const lumW = Math.max(0, L - 35)
      lightSumX += x * lumW
      lightSumY += y * lumW
      lightWeight += lumW
    }
  }

  const alphaCoverage = fgCount / Math.max(1, n)
  const woodRatio = woodCount / Math.max(1, fgCount)
  const mossRatio = mossCount / Math.max(1, fgCount)
  const lightDirDeg = lightWeight > 1 ? Math.round((Math.atan2(lightSumY, lightSumX) * 180) / Math.PI) : -45

  // =========================================================================
  // Case 1: Opaque Seamless Bark Tile (`bark_tile`)
  // =========================================================================
  if (alphaCoverage >= 0.96) {
    const feat = extractImageFeatures(img, 'bark_tile')
    const bs = feat.barkStats!
    const allWoodSamples: [number, number, number][] = []
    const allMossSamples: [number, number, number][] = []
    for (let i = 0, o = 0; i < n; i += sampleStep, o += sampleStep * 4) {
      const [hue, sat, val] = rgbToHsv(sd[o] / 255, sd[o + 1] / 255, sd[o + 2] / 255)
      const L = lab[i * 3], A = lab[i * 3 + 1], B = lab[i * 3 + 2]
      if (isMossPixel(hue, sat, val, A)) {
        if (sat >= 0.34 && A <= -12) allMossSamples.push([L, A, B])
      } else {
        allWoodSamples.push([L, A, B])
      }
    }
    const woodPal = extractLabPalette(allWoodSamples.length ? allWoodSamples : fgSamples, 5, 14)
    const mossPal = allMossSamples.length >= 12
      ? extractLabPalette(allMossSamples, 3, 12)
      : [
          { hex: '#2f5420', lab: [31, -20, 22] as [number, number, number], weight: 0.33 },
          { hex: '#5c9130', lab: [54, -27, 42] as [number, number, number], weight: 0.34 },
          { hex: '#88bc44', lab: [71, -28, 52] as [number, number, number], weight: 0.33 },
        ]
    const fullPal = feat.palette.map(p => p.hex)
    const wHex = woodPal.map(p => p.hex)
    const mHex = mossPal.map(p => p.hex)

    const isPainterlyBroad = bs.corrLenX >= 0.042 || bs.creviceCompDensity < 45
    notes.push(isPainterlyBroad
      ? `识别为宽笔触厚涂树皮（横向相关长度 ${(bs.corrLenX * 100).toFixed(1)}%，青苔占比 ${(bs.mossCoverage * 100).toFixed(1)}%）`
      : `识别为深裂纹古木皮（主向 ${bs.dominantAngleDeg.toFixed(0)}°，青苔占比 ${(bs.mossCoverage * 100).toFixed(1)}%）`)

    let draftGraph: TextureGraph
    let recommendedParams: OptimizableParamSpec[]

    if (isPainterlyBroad) {
      // Painterly wide-plane bark with real moss mask compositing + independent curvature_ao + curves_lut + palette_map!
      const estScaleX = Math.max(4, Math.min(12, Math.round(0.15 / Math.max(0.02, bs.corrLenX))))
      const estScaleY = Math.max(1, Math.min(5, Math.round(0.18 / Math.max(0.05, bs.corrLenY))))
      const crevHex = wHex[0]
      const midHex = wHex[Math.floor(wHex.length * 0.55)]
      const lightHex = wHex[wHex.length - 1]
      const mossStops = mHex.map((hex, i) => ({ pos: Number((i / Math.max(1, mHex.length - 1)).toFixed(2)), color: hex }))

      draftGraph = normalizeGraphSchemaVersion({
        schemaVersion: 2,
        name: opts.name || '智能复刻 · 厚涂苔藓木皮',
        category: 'bark',
        targetSlot: 'bark',
        resolution: targetRes,
        seamless: true,
        nodes: [
          createNode('painterly_bark', 20, 60, 'pbark', {
            scaleX: estScaleX,
            scaleY: estScaleY,
            flowWarp: 0.58,
            brushSteps: 6,
            creviceDepth: 0.78,
            mossCoverage: Number(clamp01(bs.mossCoverage * 1.95).toFixed(2)),
            coolAccent: 0.14,
            highlightColor: lightHex,
            midColor: midHex,
            creviceColor: crevHex,
            seed: 724,
          }),
          createNode('curves_lut', 260, 30, 'tone_curve', {
            channel: 'rgb',
            points: [[0, 0], [0.33, 0.33], [0.67, 0.67], [1, 1]],
            monotone: true,
          }),
          createNode('curvature_ao', 260, 210, 'curv', {
            radius: 10, intensity: 1.8, aoRadius: 14, aoStrength: 0.45, aoMode: 'fast', bias: 0,
          }),
          createNode('blend', 490, 50, 'ao_mix', { mode: 'multiply', opacity: 0.16 }),
          createNode('perlin_noise', 260, 390, 'moss_n', {
            scaleX: 5, scaleY: 5, octaves: 4, persistence: 0.54, ridged: false, seed: 842,
          }),
          createNode('gradient_map', 490, 360, 'moss_col', { stops: mossStops }),
          createNode('palette_map', 720, 50, 'pal_polish', {
            palette: wHex,
            strength: 0.14, softness: 0.45, preserveLuma: 0.70,
          }),
          createNode('blend', 940, 110, 'moss_mix', { mode: 'normal', opacity: bs.mossCoverage > 0.02 ? 0.96 : 0.0 }),
          createNode('output_material', 1170, 120, 'out', {
            normalStrength: 2.6, roughnessBase: 0.86, roughnessContrast: 0.16, dilateAlpha: false,
          }),
        ],
        edges: [
          edge('pbark', 'rgba', 'tone_curve', 'input'),
          edge('pbark', 'height', 'curv', 'height'),
          edge('tone_curve', 'out', 'ao_mix', 'base'),
          edge('curv', 'ao', 'ao_mix', 'overlay'),
          edge('ao_mix', 'out', 'pal_polish', 'input'),
          edge('moss_n', 'out', 'moss_col', 'input'),
          edge('pal_polish', 'out', 'moss_mix', 'base'),
          edge('moss_col', 'out', 'moss_mix', 'overlay'),
          edge('pbark', 'moss', 'moss_mix', 'mask'),
          edge('moss_mix', 'out', 'out', 'baseColor'),
          edge('pbark', 'height', 'out', 'height'),
        ],
      })
      recommendedParams = [
        { nodeId: 'pbark', key: 'scaleX', min: 3, max: 14, step: 1, stage: 1 },
        { nodeId: 'pbark', key: 'scaleY', min: 1, max: 6, step: 1, stage: 1 },
        { nodeId: 'pbark', key: 'flowWarp', min: 0.1, max: 1.3, step: 0.15, stage: 1 },
        { nodeId: 'pbark', key: 'mossCoverage', min: 0, max: 0.95, step: 0.08, stage: 1 },
        { nodeId: 'pbark', key: 'creviceDepth', min: 0.25, max: 1.35, step: 0.15, stage: 1 },
        { nodeId: 'pbark', key: 'brushSteps', min: 3, max: 10, step: 1, stage: 2 },
        { nodeId: 'ao_mix', key: 'opacity', min: 0, max: 0.55, step: 0.08, stage: 2 },
        { nodeId: 'pal_polish', key: 'strength', min: 0, max: 0.65, step: 0.10, stage: 2 },
        { nodeId: 'curv', key: 'aoStrength', min: 0.1, max: 1.2, step: 0.15, stage: 3 },
      ]
    } else {
      const estScaleX = Math.max(4, Math.min(14, Math.round(0.28 / Math.max(0.02, bs.corrLenX))))
      const gradStops = wHex.map((hex, i) => ({ pos: Number((i / Math.max(1, wHex.length - 1)).toFixed(2)), color: hex }))
      const mossStops = mHex.map((hex, i) => ({ pos: Number((i / Math.max(1, mHex.length - 1)).toFixed(2)), color: hex }))
      draftGraph = normalizeGraphSchemaVersion({
        schemaVersion: 2,
        name: opts.name || '智能复刻 · 沟壑曲率木皮',
        category: 'bark',
        targetSlot: 'bark',
        resolution: targetRes,
        seamless: true,
        nodes: [
          createNode('bark_fibers', 20, 40, 'fibers', {
            scaleX: estScaleX, scaleY: 2, warp: 0.65, fissure: 1.3, fineGrain: 0.24, octaves: 4, seed: 731,
          }),
          createNode('cells_voronoi', 20, 240, 'plates', {
            scaleX: Math.max(3, Math.round(estScaleX * 0.7)), scaleY: 2, jitter: 0.82, mode: 'edge', edgeWidth: 0.34, seed: 419,
          }),
          createNode('blend', 240, 80, 'base_h', { mode: 'multiply', opacity: 0.52 }),
          createNode('curves_lut', 440, 40, 'h_curve', {
            channel: 'rgb', points: [[0, 0.04], [0.3, 0.24], [0.7, 0.78], [1, 0.98]], monotone: true,
          }),
          createNode('curvature_ao', 440, 230, 'curv', {
            radius: 12, intensity: 2.6, aoRadius: 16, aoStrength: 0.88, aoMode: 'fast', bias: -0.12,
          }),
          createNode('gradient_map', 650, 30, 'wood_grad', { stops: gradStops }),
          createNode('palette_map', 860, 30, 'wood_pal', {
            palette: wHex, strength: 0.62, softness: 0.35, preserveLuma: 0.45,
          }),
          createNode('blend', 1070, 50, 'wood_ao', { mode: 'multiply', opacity: 0.62 }),
          createNode('perlin_noise', 650, 340, 'moss_n', { scaleX: 3, scaleY: 3, octaves: 4, persistence: 0.55, ridged: false, seed: 842 }),
          createNode('blend', 860, 240, 'moss_mask', { mode: 'multiply', opacity: 1.0 }),
          createNode('levels', 1070, 240, 'moss_thresh', {
            inLow: bs.mossCoverage > 0.04 ? 0.14 : 0.82,
            inHigh: bs.mossCoverage > 0.04 ? 0.36 : 0.96,
            gamma: 0.85, outLow: 0, outHigh: 1, invert: false,
          }),
          createNode('gradient_map', 860, 410, 'moss_col', { stops: mossStops }),
          createNode('blend', 1290, 120, 'final_mix', { mode: 'normal', opacity: bs.mossCoverage > 0.03 ? 0.95 : 0.0 }),
          createNode('output_material', 1500, 130, 'out', {
            normalStrength: 3.0, roughnessBase: 0.85, roughnessContrast: 0.16, dilateAlpha: false,
          }),
        ],
        edges: [
          edge('fibers', 'out', 'base_h', 'base'),
          edge('plates', 'out', 'base_h', 'overlay'),
          edge('base_h', 'out', 'h_curve', 'input'),
          edge('h_curve', 'out', 'curv', 'height'),
          edge('h_curve', 'out', 'wood_grad', 'input'),
          edge('wood_grad', 'out', 'wood_pal', 'input'),
          edge('wood_pal', 'out', 'wood_ao', 'base'),
          edge('curv', 'ao', 'wood_ao', 'overlay'),
          edge('curv', 'concave', 'moss_mask', 'base'),
          edge('moss_n', 'out', 'moss_mask', 'overlay'),
          edge('moss_mask', 'out', 'moss_thresh', 'input'),
          edge('moss_n', 'out', 'moss_col', 'input'),
          edge('wood_ao', 'out', 'final_mix', 'base'),
          edge('moss_col', 'out', 'final_mix', 'overlay'),
          edge('moss_thresh', 'out', 'final_mix', 'mask'),
          edge('final_mix', 'out', 'out', 'baseColor'),
          edge('h_curve', 'out', 'out', 'height'),
        ],
      })
      recommendedParams = [
        { nodeId: 'fibers', key: 'scaleX', min: 3, max: 16, step: 1.5, stage: 1 },
        { nodeId: 'fibers', key: 'warp', min: 0.1, max: 1.4, step: 0.18, stage: 1 },
        { nodeId: 'fibers', key: 'fissure', min: 0.5, max: 2.2, step: 0.2, stage: 1 },
        { nodeId: 'curv', key: 'bias', min: -0.35, max: 0.25, step: 0.06, stage: 2 },
        { nodeId: 'curv', key: 'aoStrength', min: 0.2, max: 1.4, step: 0.15, stage: 2 },
        { nodeId: 'moss_thresh', key: 'inLow', min: 0.04, max: 0.65, step: 0.06, stage: 2 },
        { nodeId: 'wood_ao', key: 'opacity', min: 0.15, max: 0.92, step: 0.1, stage: 2 },
        { nodeId: 'wood_pal', key: 'strength', min: 0.1, max: 0.95, step: 0.12, stage: 3 },
      ]
    }

    return {
      analyzerVersion: ANALYZER_VERSION,
      kind: 'bark_tile',
      scoreMode: 'bark_tile',
      confidence: 0.88,
      evidence: {
        alphaCoverage: Number(alphaCoverage.toFixed(4)),
        woodRatio: Number((1 - bs.mossCoverage).toFixed(4)),
        mossRatio: Number(bs.mossCoverage.toFixed(4)),
        inkOutlineScore: 0,
        inkOuterWidthPx: 0,
        inkColorHex: wHex[0],
        dominantAngleDeg: Number(bs.dominantAngleDeg.toFixed(1)),
        corrLenX: Number(bs.corrLenX.toFixed(4)),
        corrLenY: Number(bs.corrLenY.toFixed(4)),
        detectedLeaves: 0,
        detectedStems: 0,
        palette: fullPal,
        woodPalette: wHex,
        mossPalette: mHex,
        lightDirDeg,
        notes,
      },
      draftGraph,
      recommendedParams,
    }
  }

  // =========================================================================
  // Case 2: Transparent Foliage — Detect Ink Outline & 2x2 Atlas vs Vector Foliage
  // =========================================================================
  const invAlpha = new Uint8Array(n)
  for (let i = 0; i < n; i++) invAlpha[i] = alphaBin[i] ? 0 : 1
  const distIn = computeEdt2d(invAlpha, w, h, false)

  let bndLSum = 0, bndCnt = 0, intLSum = 0, intCnt = 0
  let darkBndCnt = 0
  const darkBndSamples: [number, number, number][] = []
  for (let i = 0; i < n; i++) {
    if (!alphaBin[i] || woodMask[i]) continue
    const L = lab[i * 3]
    if (distIn[i] >= 1 && distIn[i] <= 2.4) {
      bndLSum += L; bndCnt++
      if (L < 38) {
        darkBndCnt++
        if (darkBndSamples.length < 400) darkBndSamples.push([L, lab[i * 3 + 1], lab[i * 3 + 2]])
      }
    } else if (distIn[i] >= 5.0) {
      intLSum += L; intCnt++
    }
  }
  const meanBndL = bndCnt > 0 ? bndLSum / bndCnt : 50
  const meanIntL = intCnt > 0 ? intLSum / intCnt : 50
  const darkBndFrac = bndCnt > 0 ? darkBndCnt / bndCnt : 0
  const lDrop = meanIntL - meanBndL
  const inkOutlineScore = clamp01((lDrop / 22) * 0.6 + darkBndFrac * 0.55)
  const hasInkOutline = lDrop >= 7.5 && darkBndFrac >= 0.34 && inkOutlineScore >= 0.36
  const inkPal = darkBndSamples.length >= 10 ? extractLabPalette(darkBndSamples, 1, 8) : undefined
  const inkColorHex = inkPal?.[0]?.hex ?? '#214b21'
  const inkLThresh = inkPal ? Math.min(39, inkPal[0].lab[0] + 10) : 34
  const inkOuterWidthPx = hasInkOutline ? Number(Math.max(2.2, Math.min(4.8, 2.2 + darkBndFrac * 2.2)).toFixed(2)) : 0

  // Check 2x2 Atlas signature FIRST (4 dense quadrants + open center hole + no stems; outer foliage may be dark forest green!)
  const qCov = [0, 0, 0, 0]
  let centerCov = 0, centerTot = 0
  const half = w >> 1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = alphaBin[y * w + x]
      const qi = (y >= half ? 2 : 0) + (x >= half ? 1 : 0)
      qCov[qi] += a
      const dx = (x + 0.5) / w - 0.5, dy = (y + 0.5) / h - 0.5
      if (Math.hypot(dx, dy) <= 0.085) { centerCov += a; centerTot++ }
    }
  }
  const quadArea = half * half
  const minQuadCov = Math.min(...qCov) / Math.max(1, quadArea)
  const centerHoleCov = centerCov / Math.max(1, centerTot)

  const fgPal = extractLabPalette(fgSamples, hasInkOutline ? 6 : 5, 14)
  const palHexes = fgPal.map(p => p.hex)

  if (minQuadCov >= 0.42 && centerHoleCov <= 0.22 && woodRatio < 0.015) {
    notes.push(`识别为 2×2 独立叶簇图集（四象限最低覆盖 ${(minQuadCov * 100).toFixed(0)}%，中心留白 ${(100 - centerHoleCov * 100).toFixed(0)}%）`)
    const darkHex = palHexes[0]
    const midHex = palHexes[Math.floor(palHexes.length * 0.55)]
    const brightHex = palHexes[palHexes.length - 1]
    const draftGraph = normalizeGraphSchemaVersion({
      schemaVersion: 2,
      name: opts.name || '智能复刻 · 2×2 厚涂橡叶图集',
      category: 'leaf',
      targetSlot: 'leaf',
      resolution: targetRes,
      seamless: false,
      nodes: [
        createNode('leaf_shape', 30, 80, 'oak_leaf', {
          shape: 'oak', length: 0.88, width: 0.72, lobes: 7, serration: 0.04,
          veinStrength: 0.14, veinCount: 5, stemLen: 0.05,
          baseColor: darkHex, tipColor: brightHex, veinColor: brightHex, stemColor: '#56412d',
        }),
        createNode('branch_scatter', 280, 60, 'atlas_scatter', {
          layout: 'oak_rosette', atlasCols: 2, atlasRows: 2, budGlint: 0.55,
          stemCount: 4, leavesPerStem: 9, leafScale: 0.46, scaleFalloff: 0.18,
          spread: 1.05, arch: 0.18, rotJitter: 0.25, colorVar: 0.20,
          depthShade: 0.46, stemWidth: 0, stemColor: '#52402c', seed: 618,
        }),
        createNode('curves_lut', 530, 70, 'tone_curve', {
          channel: 'rgb', points: [[0, 0], [0.35, 0.35], [0.7, 0.72], [1, 1]], monotone: true,
        }),
        createNode('palette_map', 770, 70, 'pal_polish', {
          palette: palHexes.length >= 3 ? palHexes : [darkHex, midHex, brightHex],
          strength: 0.32, softness: 0.42, preserveLuma: 0.60,
        }),
        createNode('output_material', 1010, 80, 'out', {
          normalStrength: 1.6, roughnessBase: 0.68, roughnessContrast: 0.14, dilateAlpha: true,
        }),
      ],
      edges: [
        edge('oak_leaf', 'rgba', 'atlas_scatter', 'leaf'),
        edge('oak_leaf', 'height', 'atlas_scatter', 'height'),
        edge('atlas_scatter', 'rgba', 'tone_curve', 'input'),
        edge('tone_curve', 'out', 'pal_polish', 'input'),
        edge('pal_polish', 'out', 'out', 'baseColor'),
        edge('atlas_scatter', 'height', 'out', 'height'),
      ],
    })
    return {
      analyzerVersion: ANALYZER_VERSION,
      kind: 'atlas_2x2',
      scoreMode: 'figurative',
      confidence: 0.85,
      evidence: {
        alphaCoverage: Number(alphaCoverage.toFixed(4)),
        woodRatio: Number(woodRatio.toFixed(4)),
        mossRatio: Number(mossRatio.toFixed(4)),
        inkOutlineScore: Number(inkOutlineScore.toFixed(3)),
        inkOuterWidthPx: 0,
        inkColorHex,
        dominantAngleDeg: 0,
        corrLenX: 0,
        corrLenY: 0,
        detectedLeaves: 4,
        detectedStems: 0,
        palette: palHexes,
        lightDirDeg,
        notes,
      },
      draftGraph,
      recommendedParams: [
        { nodeId: 'atlas_scatter', key: 'leafScale', min: 0.30, max: 0.64, step: 0.04, stage: 1 },
        { nodeId: 'atlas_scatter', key: 'spread', min: 0.65, max: 1.35, step: 0.08, stage: 1 },
        { nodeId: 'atlas_scatter', key: 'depthShade', min: 0.12, max: 0.68, step: 0.07, stage: 2 },
        { nodeId: 'atlas_scatter', key: 'budGlint', min: 0.1, max: 0.95, step: 0.1, stage: 2 },
        { nodeId: 'pal_polish', key: 'strength', min: 0.0, max: 0.85, step: 0.12, stage: 2 },
        { nodeId: 'oak_leaf', key: 'width', min: 0.52, max: 0.88, step: 0.06, stage: 3 },
      ],
    }
  }

  // =========================================================================
  // Case 3: Figurative Vector Foliage (`vine` | `cluster_flat` | `bush_inked`)
  // =========================================================================
  const archetype: 'vine' | 'cluster_flat' | 'bush_inked' = hasInkOutline
    ? 'bush_inked'
    : woodRatio >= 0.022
      ? 'vine'
      : 'cluster_flat'

  const { stems, stemColorHex } = woodRatio >= 0.014
    ? extractVectorStems(woodMask, sd, w, h)
    : { stems: [], stemColorHex: '#6e5237' }

  const { instances, medianAspect, confidence } = extractVectorLeaves(
    img, lab, alphaBin, woodMask, stems, fgPal,
    { hasInkOutline, inkLThresh, archetype },
  )

  if (archetype === 'vine') {
    notes.push(`识别为无描边交织藤蔓（检出 ${stems.length} 根木质枝条、${instances.length} 片独立叶，保持干净色块无描边）`)
  } else if (archetype === 'cluster_flat') {
    notes.push(`识别为多色平涂叶簇（无枝条、无描边，检出 ${instances.length} 片独立彩色叶与 ${palHexes.length} 色板）`)
  } else {
    notes.push(`识别为手绘线稿繁茂灌木（外描边 ~${inkOuterWidthPx}px ${inkColorHex}，检出 ${stems.length} 根枝干与 ${instances.length} 片叠层叶）`)
  }

  // For dense inked bushes, ensure deep occluded interior shadow holes are supported by back-layer leaves
  const finalInstances = [...instances]
  if (archetype === 'bush_inked') {
    const covered = new Uint8Array(n)
    for (const inst of finalInstances) {
      const rx = Math.max(4, Math.round(inst.scaleX * 0.42 * w))
      const ry = Math.max(4, Math.round(inst.scaleY * 0.45 * h))
      const cx = Math.round(inst.x * w), cy = Math.round(inst.y * h)
      for (let dy = -ry; dy <= ry; dy++) {
        const py = cy + dy
        if (py < 0 || py >= h) continue
        for (let dx = -rx; dx <= rx; dx++) {
          const px = cx + dx
          if (px < 0 || px >= w) continue
          if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) covered[py * w + px] = 1
        }
      }
    }
    // Place up to 14 dark backing leaves at largest uncovered opaque interior pockets
    for (let k = 0; k < 14 && finalInstances.length < 80; k++) {
      let bestX = -1, bestY = -1, bestScore = 0
      for (let y = 16; y < h - 16; y += 8) {
        for (let x = 16; x < w - 16; x += 8) {
          const i = y * w + x
          if (alphaBin[i] && !woodMask[i] && !covered[i] && distIn[i] > bestScore) {
            bestScore = distIn[i]; bestX = x; bestY = y
          }
        }
      }
      if (bestScore < 5.5 || bestX < 0) break
      const u = bestX / w, v = bestY / h
      const rad = Math.max(0.09, Math.min(0.18, (bestScore / w) * 2.4))
      finalInstances.unshift({
        id: `leaf-bg-${String(k + 1).padStart(2, '0')}`,
        x: Number(u.toFixed(4)),
        y: Number(v.toFixed(4)),
        rot: Number(Math.atan2(u - 0.5, -(v - 0.5)).toFixed(3)),
        scaleX: Number((rad * 1.15).toFixed(4)),
        scaleY: Number((rad * 1.45).toFixed(4)),
        variant: 0,
        colorIdx: 0,
        z: Number((0.04 + k * 0.01).toFixed(3)),
        flip: (k & 1) === 1,
      })
      const rPx = Math.round(rad * 0.65 * w)
      for (let dy = -rPx; dy <= rPx; dy++) {
        for (let dx = -rPx; dx <= rPx; dx++) {
          const px = bestX + dx, py = bestY + dy
          if (px >= 0 && px < w && py >= 0 && py < h && dx * dx + dy * dy <= rPx * rPx) covered[py * w + px] = 1
        }
      }
    }
  }

  const leafWidthParam = Number(Math.max(0.42, Math.min(0.76, medianAspect * 0.96)).toFixed(3))
  const midColor = palHexes[Math.floor(palHexes.length * 0.5)] ?? '#5c8c38'
  const hiColor = palHexes[palHexes.length - 1] ?? '#8ebe44'
  const darkColor = palHexes[0] ?? '#2f6537'
  const isFlatStyle = archetype === 'vine' || archetype === 'cluster_flat'

  // For complex hand-drawn bushes (`bush_inked`), cluster instances into 3 distinct morphological prototypes
  // (0: broad ovate sunlit, 1: curved tapering tip, 2: notched painterly accent) wired to leafA/leafB/leafC!
  if (archetype === 'bush_inked') {
    finalInstances.forEach((inst, i) => {
      const aspect = inst.scaleX / Math.max(0.02, inst.scaleY)
      if (inst.id.startsWith('leaf-bg-')) {
        inst.variant = 0
      } else if (aspect < 0.72) {
        inst.variant = 1
        inst.flip = inst.x < 0.5
      } else if ((i % 3) === 2) {
        inst.variant = 2
        inst.flip = (i & 1) === 1
      } else {
        inst.variant = 0
      }
    })
  }

  const bushNodes = archetype === 'bush_inked' ? [
    createNode('custom_leaf', 20, 20, 'leaf_proto', {
      length: 0.88,
      width: leafWidthParam,
      profile: [[0, 0.05], [0.18, 0.46], [0.46, 0.58], [0.74, 0.36], [0.91, 0.12], [1, 0]],
      bend: 0.06,
      tipCurl: -0.06,
      asymmetry: 0.05,
      lobeCount: 0,
      lobeDepth: 0,
      notchDepth: 0,
      foldShade: 0.10,
      veinStrength: 0.18,
      veinCount: 4,
      stemLen: 0.0,
      baseColor: '#5c7c58',
      tipColor: '#9eb88c',
      veinColor: '#c4dc9e',
      stemColor: stemColorHex,
    }),
    createNode('custom_leaf', 20, 220, 'leaf_proto_b', {
      length: 0.90,
      width: Number(Math.max(0.36, leafWidthParam * 0.84).toFixed(3)),
      profile: [[0, 0.04], [0.20, 0.40], [0.48, 0.50], [0.76, 0.30], [0.92, 0.09], [1, 0]],
      bend: 0.14,
      tipCurl: -0.14,
      asymmetry: 0.08,
      lobeCount: 0,
      lobeDepth: 0,
      notchDepth: 0,
      foldShade: 0.11,
      veinStrength: 0.18,
      veinCount: 4,
      stemLen: 0.0,
      baseColor: '#5c7c58',
      tipColor: '#9eb88c',
      veinColor: '#c4dc9e',
      stemColor: stemColorHex,
    }),
    createNode('custom_leaf', 20, 420, 'leaf_proto_c', {
      length: 0.86,
      width: Number(Math.min(0.78, leafWidthParam * 1.04).toFixed(3)),
      profile: [[0, 0.05], [0.18, 0.48], [0.48, 0.58], [0.74, 0.38], [0.91, 0.12], [1, 0]],
      bend: -0.09,
      tipCurl: 0.10,
      asymmetry: -0.06,
      lobeCount: 0,
      lobeDepth: 0,
      notchPos: 0.66,
      notchDepth: 0.18,
      foldShade: 0.10,
      veinStrength: 0.18,
      veinCount: 4,
      stemLen: 0.0,
      baseColor: '#5c7c58',
      tipColor: '#9eb88c',
      veinColor: '#c4dc9e',
      stemColor: stemColorHex,
    }),
  ] : [
    createNode('custom_leaf', 30, 80, 'leaf_proto', {
      length: 0.86,
      width: leafWidthParam,
      profile: [[0, 0.04], [0.20, 0.44], [0.48, 0.56], [0.76, 0.40], [0.92, 0.14], [1, 0]],
      bend: 0.0,
      tipCurl: 0.0,
      asymmetry: 0.0,
      lobeCount: 0,
      lobeDepth: 0,
      notchDepth: 0,
      foldShade: isFlatStyle ? 0.01 : 0.10,
      veinStrength: isFlatStyle ? 0.01 : 0.18,
      veinCount: isFlatStyle ? 0 : 4,
      stemLen: archetype === 'vine' ? 0.02 : 0.0,
      // Flat styles keep uniform neutral leaf luminance so palette_map/colorIdx reproduces crisp flat colors with ΔE00 < 3!
      baseColor: isFlatStyle ? '#808880' : darkColor,
      tipColor: isFlatStyle ? '#848c84' : hiColor,
      veinColor: isFlatStyle ? '#848c84' : hiColor,
      stemColor: stemColorHex,
    }),
  ]

  const draftGraph = normalizeGraphSchemaVersion({
    schemaVersion: 2,
    name: opts.name || (archetype === 'vine' ? '智能复刻 · 交织藤蔓' : archetype === 'cluster_flat' ? '智能复刻 · 多色叶簇' : '智能复刻 · 繁茂灌木'),
    category: 'leaf',
    targetSlot: 'leaf',
    resolution: targetRes,
    seamless: false,
    nodes: [
      ...bushNodes,
      createNode('vector_layout', 300, 120, 'vec_layout', {
        palette: palHexes,
        paletteStrength: isFlatStyle ? 1.0 : 0.90,
        lightAngle: lightDirDeg,
        lightStrength: isFlatStyle ? 0.01 : 0.18,
        depthShade: isFlatStyle ? 0.01 : 0.18,
        layerShadow: isFlatStyle ? 0.0 : 0.14,
        stemColor: stemColorHex,
        stemHighlight: isFlatStyle ? 0.06 : 0.22,
        stems,
        instances: finalInstances,
      }),
      createNode('ink_outline', 570, 130, 'vec_outline', {
        outerWidth: hasInkOutline ? inkOuterWidthPx : 0,
        position: 'center',
        outerColor: inkColorHex,
        outerOpacity: 0.92,
        innerWidth: hasInkOutline ? Number((inkOuterWidthPx * 0.56).toFixed(2)) : 0,
        innerColor: inkColorHex,
        innerOpacity: 0.82,
        softness: 0.9,
      }),
      createNode('output_material', 840, 140, 'out', {
        normalStrength: archetype === 'bush_inked' ? 1.8 : 0.9,
        roughnessBase: 0.68,
        roughnessContrast: 0.12,
        dilateAlpha: true,
      }),
    ],
    edges: [
      edge('leaf_proto', 'rgba', 'vec_layout', 'leafA'),
      edge('leaf_proto', 'height', 'vec_layout', 'heightA'),
      ...(archetype === 'bush_inked' ? [
        edge('leaf_proto_b', 'rgba', 'vec_layout', 'leafB'),
        edge('leaf_proto_b', 'height', 'vec_layout', 'heightB'),
        edge('leaf_proto_c', 'rgba', 'vec_layout', 'leafC'),
      ] : []),
      edge('vec_layout', 'rgba', 'vec_outline', 'input'),
      edge('vec_layout', 'label', 'vec_outline', 'label'),
      edge('vec_outline', 'rgba', 'out', 'baseColor'),
      edge('vec_layout', 'height', 'out', 'height'),
    ],
  })

  const recommendedParams: OptimizableParamSpec[] = [
    { nodeId: 'leaf_proto', key: 'width', min: 0.34, max: 0.84, step: 0.05, stage: 1 },
    { nodeId: 'leaf_proto', key: 'length', min: 0.72, max: 0.96, step: 0.04, stage: 1 },
    { nodeId: 'leaf_proto', key: 'bend', min: -0.25, max: 0.25, step: 0.06, stage: 1 },
    { nodeId: 'vec_layout', key: 'paletteStrength', min: 0.65, max: 1.0, step: 0.08, stage: 2 },
    { nodeId: 'vec_layout', key: 'lightStrength', min: 0.0, max: 0.42, step: 0.06, stage: 2 },
    { nodeId: 'vec_layout', key: 'depthShade', min: 0.0, max: 0.42, step: 0.06, stage: 2 },
    { nodeId: 'vec_layout', key: 'lightAngle', min: -180, max: 180, step: 25, stage: 2 },
    ...(hasInkOutline ? [
      { nodeId: 'vec_outline', key: 'outerWidth', min: 1.2, max: 5.5, step: 0.5, stage: 3 as const },
      { nodeId: 'vec_outline', key: 'innerWidth', min: 0.6, max: 3.6, step: 0.4, stage: 3 as const },
      { nodeId: 'vec_layout', key: 'layerShadow', min: 0.0, max: 0.35, step: 0.05, stage: 3 as const },
    ] : []),
  ]

  // Reference check to suppress unused variable warning
  void midColor

  return {
    analyzerVersion: ANALYZER_VERSION,
    kind: archetype,
    scoreMode: 'figurative',
    confidence: Number(confidence.toFixed(3)),
    evidence: {
      alphaCoverage: Number(alphaCoverage.toFixed(4)),
      woodRatio: Number(woodRatio.toFixed(4)),
      mossRatio: Number(mossRatio.toFixed(4)),
      inkOutlineScore: Number(inkOutlineScore.toFixed(3)),
      inkOuterWidthPx,
      inkColorHex,
      dominantAngleDeg: 0,
      corrLenX: 0,
      corrLenY: 0,
      detectedLeaves: finalInstances.length,
      detectedStems: stems.length,
      palette: palHexes,
      lightDirDeg,
      notes,
    },
    draftGraph,
    recommendedParams,
  }
}
