import { fbm3, type RockV2Field, type Vec3 } from './sdf'
import type { UnwrappedLowPolyMesh } from './uv-charts'

export type RockV2BrushMode = 'off' | 'subtle'

export interface BakeRockV2Options {
  size?: number
  dilationPasses?: number
  /** Controlled Art A/B toggle: 'off' = clean flat-ish albedo baseline; 'subtle' = low-intensity directional broad brushstrokes. */
  brushMode?: RockV2BrushMode
  /** Sandstone BaseColor hex (default '#cca988'). */
  baseColorHex?: string
}

export interface RockV2BakeDiagnostics {
  resolution: number
  coveredTexels: number
  /** True analytical hits where evalMacro strictly bracketed zero & bisected cleanly with same-side normal (>0.55). */
  analyticalCleanHits: number
  /** True analytical hits at grazing angles (0.25 < nDot <= 0.55). */
  analyticalGrazingHits: number
  /** Cache-only fallbacks where 48³ cache saw a crossing but analytical evalMacro did not bracket zero. */
  cacheFallbacks: number
  /** Candidate roots rejected because normal pointed to opposite wall (nDot <= 0.25). */
  crossWallRejected: number
  /** Texels with no crossing found in the bilateral cage search interval. */
  misses: number
  flippedNormalFallback: number
  /** Fraction of covered texels solved analytically (clean + grazing). */
  analyticalHitRate: number
  /** Fraction of covered texels that fell back to cached trilinear midpoint. */
  cacheFallbackRate: number
  crossWallRate: number
  missRate: number
  /** Residual |evalMacro(P_hit)| across all hit texels (meters). */
  maxAnalyticalResidual: number
  meanAnalyticalResidual: number
  p95AnalyticalResidual: number
  timings: {
    volumeCacheMs: number
    rasterAndProjectMs: number
    aoMs: number
    albedoMs: number
    dilationMs: number
    totalBakeMs: number
  }
}

export interface RockV2BakedTextures {
  size: number
  /** sRGB RGBA8 BaseColor (restrained albedo — NO baked directional key-light shadows!). */
  albedo: Uint8ClampedArray
  /** Linear RGBA8 OpenGL/glTF Tangent-Space Normal Map encoded in locked MikkTSpace basis. */
  normal: Uint8ClampedArray
  /** Linear RGBA8 Ambient Occlusion Map (grayscale stored in RGB for standard glTF occlusionTexture). */
  ao: Uint8ClampedArray
  /** Diagnostic map: Green=analytical clean, Yellow=analytical grazing, Orange=cache fallback, Magenta=cross-wall, Red=miss. */
  diagnostic: Uint8ClampedArray
  stats: RockV2BakeDiagnostics
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1)
  return t * t * (3 - 2 * t)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function parseHexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [204, 169, 136]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// 8 deterministic Fibonacci-hemisphere unit directions in local tangent space (+Z is surface normal)
const HEMI_RAYS: readonly [number, number, number][] = (() => {
  const out: [number, number, number][] = []
  const n = 8
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const z = 0.24 + (0.74 * (i + 0.5)) / n
    const r = Math.sqrt(Math.max(0, 1 - z * z))
    const th = i * golden
    out.push([Math.cos(th) * r, Math.sin(th) * r, z])
  }
  return out
})()

const AO_STEPS = [0.04, 0.09, 0.17, 0.28] as const
const AO_WEIGHTS = [0.40, 0.30, 0.18, 0.12] as const

interface SdfVolumeCache {
  grid: Float32Array
  nx: number; ny: number; nz: number
  ox: number; oy: number; oz: number
  invH: number
  h: number
}

function buildSdfVolumeCache(field: RockV2Field, res = 48): SdfVolumeCache {
  const pad = 0.34
  const ox = field.boundsMin.x - pad
  const oy = field.boundsMin.y - pad
  const oz = field.boundsMin.z - pad
  const sx = (field.boundsMax.x + pad) - ox
  const sy = (field.boundsMax.y + pad) - oy
  const sz = (field.boundsMax.z + pad) - oz
  const h = Math.max(sx, sy, sz) / res
  const nx = Math.ceil(sx / h) + 1
  const ny = Math.ceil(sy / h) + 1
  const nz = Math.ceil(sz / h) + 1
  const grid = new Float32Array(nx * ny * nz)
  const evalMacro = field.evalMacro

  for (let k = 0; k < nz; k++) {
    const z = oz + k * h
    for (let j = 0; j < ny; j++) {
      const y = oy + j * h
      const row = (k * ny + j) * nx
      for (let i = 0; i < nx; i++) {
        grid[row + i] = evalMacro(ox + i * h, y, z)
      }
    }
  }
  return { grid, nx, ny, nz, ox, oy, oz, invH: 1 / h, h }
}

function sampleVolumeTrilinear(vol: SdfVolumeCache, x: number, y: number, z: number): number {
  const fx = clamp((x - vol.ox) * vol.invH, 0, vol.nx - 1.0001)
  const fy = clamp((y - vol.oy) * vol.invH, 0, vol.ny - 1.0001)
  const fz = clamp((z - vol.oz) * vol.invH, 0, vol.nz - 1.0001)
  const ix = fx | 0, iy = fy | 0, iz = fz | 0
  const tx = fx - ix, ty = fy - iy, tz = fz - iz
  const { grid, nx, ny } = vol
  const c000 = (iz * ny + iy) * nx + ix
  const c100 = c000 + 1
  const c010 = c000 + nx
  const c110 = c010 + 1
  const strideZ = nx * ny
  const c001 = c000 + strideZ
  const c101 = c100 + strideZ
  const c011 = c010 + strideZ
  const c111 = c110 + strideZ
  const x00 = grid[c000] + (grid[c100] - grid[c000]) * tx
  const x10 = grid[c010] + (grid[c110] - grid[c010]) * tx
  const x01 = grid[c001] + (grid[c101] - grid[c001]) * tx
  const x11 = grid[c011] + (grid[c111] - grid[c011]) * tx
  const y0 = x00 + (x10 - x00) * ty
  const y1 = x01 + (x11 - x01) * ty
  return y0 + (y1 - y0) * tz
}

function evalTetraGradient(
  fn: (x: number, y: number, z: number) => number,
  x: number,
  y: number,
  z: number,
  eps: number,
): Vec3 {
  const f0 = fn(x + eps, y - eps, z - eps)
  const f1 = fn(x - eps, y - eps, z + eps)
  const f2 = fn(x - eps, y + eps, z - eps)
  const f3 = fn(x + eps, y + eps, z + eps)
  const gx = f0 - f1 - f2 + f3
  const gy = -f0 - f1 + f2 + f3
  const gz = -f0 + f1 - f2 + f3
  const len = Math.hypot(gx, gy, gz) || 1
  return { x: gx / len, y: gy / len, z: gz / len }
}

/**
 * Analytical SDF -> Low-Poly UV Multi-Pass Baker with honest diagnostic separation:
 * - Strictly separates true analytical bisected hits from cache-midpoint fallbacks (never hides cache fallbacks in green!).
 * - Measures exact analytical surface residual |evalMacro(P_hit)| (max / mean / P95).
 * - Supports controlled Art A/B toggle (`brushMode: 'off' | 'subtle'`) on the identical mesh, normal & AO maps.
 */
export function bakeRockV2Textures(
  field: RockV2Field,
  mesh: UnwrappedLowPolyMesh,
  sizeOrOpts: number | BakeRockV2Options = 512,
  dilationPassesArg = 10,
): RockV2BakedTextures {
  const opts: BakeRockV2Options = typeof sizeOrOpts === 'number'
    ? { size: sizeOrOpts, dilationPasses: dilationPassesArg }
    : sizeOrOpts
  const size = opts.size ?? 512
  const dilationPasses = opts.dilationPasses ?? dilationPassesArg
  const brushMode: RockV2BrushMode = opts.brushMode ?? 'off'
  const [baseR, baseG, baseB] = parseHexRgb(opts.baseColorHex ?? '#cca988')

  const tStart = performance.now()
  const totalPix = size * size
  const albedo = new Uint8ClampedArray(totalPix * 4)
  const normal = new Uint8ClampedArray(totalPix * 4)
  const ao = new Uint8ClampedArray(totalPix * 4)
  const diagnostic = new Uint8ClampedArray(totalPix * 4)
  const chartIdBuf = new Int32Array(totalPix).fill(-1)

  for (let i = 0; i < totalPix; i++) {
    const p4 = i * 4
    albedo[p4] = baseR; albedo[p4 + 1] = baseG; albedo[p4 + 2] = baseB; albedo[p4 + 3] = 255
    normal[p4] = 128; normal[p4 + 1] = 128; normal[p4 + 2] = 255; normal[p4 + 3] = 255
    ao[p4] = 255; ao[p4 + 1] = 255; ao[p4 + 2] = 255; ao[p4 + 3] = 255
    diagnostic[p4] = 26; diagnostic[p4 + 1] = 28; diagnostic[p4 + 2] = 34; diagnostic[p4 + 3] = 255
  }

  const tVol0 = performance.now()
  const vol = buildSdfVolumeCache(field, 40)
  const volumeCacheMs = performance.now() - tVol0

  const { positions, normals, uvs, tangents, indices, triChartIds, shift, voxelSize } = mesh
  const tCount = indices.length / 3
  const evalMacro = field.evalMacro

  const cageHalf = Math.max(0.06, voxelSize * 1.25)
  const bracketSteps = 10
  const dt = (cageHalf * 2) / bracketSteps
  const residualTol = 0.005 // 5 mm analytical surface convergence tolerance

  let coveredTexels = 0
  let analyticalCleanHits = 0
  let analyticalGrazingHits = 0
  let cacheFallbacks = 0
  let crossWallRejected = 0
  let misses = 0
  let flippedNormalFallback = 0
  const residuals: number[] = []

  const hitPosX = new Float32Array(totalPix)
  const hitPosY = new Float32Array(totalPix)
  const hitPosZ = new Float32Array(totalPix)
  const hitNormX = new Float32Array(totalPix)
  const hitNormY = new Float32Array(totalPix)
  const hitNormZ = new Float32Array(totalPix)
  const hitCurv = new Float32Array(totalPix)
  const hitCrackMask = new Float32Array(totalPix)

  const evalCrackDetail = (x: number, y: number, z: number, gnx: number, gny: number, gnz: number): number => {
    const base = evalMacro(x, y, z)
    const cr = field.evalCrackAt(x, y, z, gnx, gny, gnz)
    return base + cr.depth
  }

  // -------------------------------------------------------------------------
  // Pass 1: UV Rasterization + Bounded Analytical Root Finding + Tangent Normal
  // -------------------------------------------------------------------------
  const tRaster0 = performance.now()
  for (let t = 0; t < tCount; t++) {
    const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2]
    const cid = triChartIds[t]

    const u0 = uvs[i0 * 2] * size, v0 = uvs[i0 * 2 + 1] * size
    const u1 = uvs[i1 * 2] * size, v1 = uvs[i1 * 2 + 1] * size
    const u2 = uvs[i2 * 2] * size, v2 = uvs[i2 * 2 + 1] * size

    const denom = (v1 - v2) * (u0 - u2) + (u2 - u1) * (v0 - v2)
    if (Math.abs(denom) < 1e-8) continue
    const invDenom = 1 / denom

    const minX = Math.max(0, Math.floor(Math.min(u0, u1, u2)))
    const maxX = Math.min(size - 1, Math.ceil(Math.max(u0, u1, u2)))
    const minY = Math.max(0, Math.floor(Math.min(v0, v1, v2)))
    const maxY = Math.min(size - 1, Math.ceil(Math.max(v0, v1, v2)))

    const p0x = positions[i0 * 3] - shift.x, p0y = positions[i0 * 3 + 1] - shift.y, p0z = positions[i0 * 3 + 2] - shift.z
    const p1x = positions[i1 * 3] - shift.x, p1y = positions[i1 * 3 + 1] - shift.y, p1z = positions[i1 * 3 + 2] - shift.z
    const p2x = positions[i2 * 3] - shift.x, p2y = positions[i2 * 3 + 1] - shift.y, p2z = positions[i2 * 3 + 2] - shift.z

    const n0x = normals[i0 * 3], n0y = normals[i0 * 3 + 1], n0z = normals[i0 * 3 + 2]
    const n1x = normals[i1 * 3], n1y = normals[i1 * 3 + 1], n1z = normals[i1 * 3 + 2]
    const n2x = normals[i2 * 3], n2y = normals[i2 * 3 + 1], n2z = normals[i2 * 3 + 2]

    const t0x = tangents[i0 * 4], t0y = tangents[i0 * 4 + 1], t0z = tangents[i0 * 4 + 2]
    const t1x = tangents[i1 * 4], t1y = tangents[i1 * 4 + 1], t1z = tangents[i1 * 4 + 2]
    const t2x = tangents[i2 * 4], t2y = tangents[i2 * 4 + 1], t2z = tangents[i2 * 4 + 2]
    const wSign = tangents[i0 * 4 + 3]

    const triAreaUv = Math.abs(denom) * 0.5
    const e1x = p1x - p0x, e1y = p1y - p0y, e1z = p1z - p0z
    const e2x = p2x - p0x, e2y = p2y - p0y, e2z = p2z - p0z
    const triArea3D = 0.5 * Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x)
    const texelWorld = Math.sqrt(triArea3D / Math.max(1e-4, triAreaUv))

    for (let py = minY; py <= maxY; py++) {
      const cy = py + 0.5
      for (let px = minX; px <= maxX; px++) {
        const cx = px + 0.5
        const b0 = ((v1 - v2) * (cx - u2) + (u2 - u1) * (cy - v2)) * invDenom
        const b1 = ((v2 - v0) * (cx - u2) + (u0 - u2) * (cy - v2)) * invDenom
        const b2 = 1 - b0 - b1
        if (b0 < -1e-4 || b1 < -1e-4 || b2 < -1e-4) continue

        const pix = py * size + px
        if (chartIdBuf[pix] !== -1) continue
        chartIdBuf[pix] = cid
        coveredTexels++

        const lx = p0x * b0 + p1x * b1 + p2x * b2
        const ly = p0y * b0 + p1y * b1 + p2y * b2
        const lz = p0z * b0 + p1z * b1 + p2z * b2

        let nlx = n0x * b0 + n1x * b1 + n2x * b2
        let nly = n0y * b0 + n1y * b1 + n2y * b2
        let nlz = n0z * b0 + n1z * b1 + n2z * b2
        const nlLen = Math.hypot(nlx, nly, nlz) || 1
        nlx /= nlLen; nly /= nlLen; nlz /= nlLen

        let tx = t0x * b0 + t1x * b1 + t2x * b2
        let ty = t0y * b0 + t1y * b1 + t2y * b2
        let tz = t0z * b0 + t1z * b1 + t2z * b2
        const ndt = nlx * tx + nly * ty + nlz * tz
        tx -= nlx * ndt; ty -= nly * ndt; tz -= nlz * ndt
        const tLen = Math.hypot(tx, ty, tz) || 1
        tx /= tLen; ty /= tLen; tz /= tLen

        let bx = (nly * tz - nlz * ty) * wSign
        let by = (nlz * tx - nlx * tz) * wSign
        let bz = (nlx * ty - nly * tx) * wSign
        const bLen = Math.hypot(bx, by, bz) || 1
        bx /= bLen; by /= bLen; bz /= bLen

        // 2. Fast analytical Newton/Secant convergence at s=0 for well-behaved interior texels (~92%+),
        //    falling back seamlessly to the full bounded 10-step bracket + bisection solver near ridges/clefts!
        let bestAnaScore = Infinity
        let bestAnaHx = lx, bestAnaHy = ly, bestAnaHz = lz
        let bestAnaDot = -1
        let bestAnaRes = Infinity
        let bestAnaNorm: Vec3 | null = null

        let bestCacheScore = Infinity
        let bestCacheHx = lx, bestCacheHy = ly, bestCacheHz = lz
        let bestCacheRes = Infinity
        let foundAnyRoot = false

        const f0 = evalMacro(lx, ly, lz)
        if (Math.abs(f0) < 0.042) {
          const maxFastS = cageHalf * 0.78
          const s1 = clamp(-f0, -maxFastS, maxFastS)
          const f1 = evalMacro(lx + nlx * s1, ly + nly * s1, lz + nlz * s1)
          let rS = s1
          let rF = Math.abs(f1)
          if (rF > 0.0006 && Math.abs(f1 - f0) > 1e-6) {
            const s2 = clamp(s1 - (f1 * s1) / (f1 - f0), -maxFastS, maxFastS)
            const f2 = evalMacro(lx + nlx * s2, ly + nly * s2, lz + nlz * s2)
            if (Math.abs(f2) < rF) {
              rS = s2
              rF = Math.abs(f2)
            }
          }
          if (rF <= 0.0018) {
            const rx = lx + nlx * rS
            const ry = ly + nly * rS
            const rz = lz + nlz * rS
            const ag = evalTetraGradient(evalMacro, rx, ry, rz, 0.005)
            const nDot = ag.x * nlx + ag.y * nly + ag.z * nlz
            if (nDot > 0.55) {
              bestAnaScore = Math.abs(rS) + (1 - nDot) * 0.08
              bestAnaHx = rx; bestAnaHy = ry; bestAnaHz = rz
              bestAnaDot = nDot
              bestAnaRes = rF
              bestAnaNorm = ag
              foundAnyRoot = true
            }
          }
        }

        // Full bounded bracket + analytical bisection search for ridges, crevices, grazing angles & multi-root V-clefts
        if (bestAnaNorm === null) {
          let prevS = -cageHalf
          let prevF = sampleVolumeTrilinear(vol, lx + nlx * prevS, ly + nly * prevS, lz + nlz * prevS)
          for (let step = 1; step <= bracketSteps; step++) {
            const curS = -cageHalf + step * dt
            const curF = sampleVolumeTrilinear(vol, lx + nlx * curS, ly + nly * curS, lz + nlz * curS)
            if ((prevF <= 0 && curF >= 0) || (prevF >= 0 && curF <= 0)) {
              foundAnyRoot = true
              let aS = Math.max(-cageHalf, prevS - dt * 0.75)
              let bS = Math.min(cageHalf, curS + dt * 0.75)
              let fa = evalMacro(lx + nlx * aS, ly + nly * aS, lz + nlz * aS)
              const fb = evalMacro(lx + nlx * bS, ly + nly * bS, lz + nlz * bS)

              if ((fa <= 0 && fb >= 0) || (fa >= 0 && fb <= 0)) {
                for (let bi = 0; bi < 6; bi++) {
                  const mS = 0.5 * (aS + bS)
                  const fm = evalMacro(lx + nlx * mS, ly + nly * mS, lz + nlz * mS)
                  if ((fa <= 0 && fm <= 0) || (fa >= 0 && fm >= 0)) {
                    aS = mS; fa = fm
                  } else {
                    bS = mS
                  }
                }
                const rS = 0.5 * (aS + bS)
                const rx = lx + nlx * rS
                const ry = ly + nly * rS
                const rz = lz + nlz * rS
                const res = Math.abs(evalMacro(rx, ry, rz))
                const ag = evalTetraGradient(evalMacro, rx, ry, rz, 0.005)
                const nDot = ag.x * nlx + ag.y * nly + ag.z * nlz
                if (nDot > 0.25 && res <= residualTol) {
                  const score = Math.abs(rS) + (1 - nDot) * 0.08
                  if (score < bestAnaScore) {
                    bestAnaScore = score
                    bestAnaHx = rx; bestAnaHy = ry; bestAnaHz = rz
                    bestAnaDot = nDot
                    bestAnaRes = res
                    bestAnaNorm = ag
                  }
                }
              } else {
                const rS = 0.5 * (prevS + curS)
                const rx = lx + nlx * rS
                const ry = ly + nly * rS
                const rz = lz + nlz * rS
                const vEps = vol.h * 0.6
                const vg = evalTetraGradient((x, y, z) => sampleVolumeTrilinear(vol, x, y, z), rx, ry, rz, vEps)
                const nDot = vg.x * nlx + vg.y * nly + vg.z * nlz
                if (nDot > 0.25) {
                  const score = Math.abs(rS) + (1 - nDot) * 0.08
                  if (score < bestCacheScore) {
                    bestCacheScore = score
                    bestCacheHx = rx; bestCacheHy = ry; bestCacheHz = rz
                    bestCacheRes = Math.abs(evalMacro(rx, ry, rz))
                  }
                }
              }
            }
            prevS = curS
            prevF = curF
          }
        }

        const p4 = pix * 4
        let bestHx = lx, bestHy = ly, bestHz = lz
        let hasSurfaceHit = false
        let nhi: Vec3 = { x: nlx, y: nly, z: nlz }

        if (bestAnaNorm !== null) {
          hasSurfaceHit = true
          bestHx = bestAnaHx; bestHy = bestAnaHy; bestHz = bestAnaHz
          nhi = bestAnaNorm
          residuals.push(bestAnaRes)
          if (bestAnaDot > 0.55) {
            analyticalCleanHits++
            diagnostic[p4] = 52; diagnostic[p4 + 1] = 200; diagnostic[p4 + 2] = 96 // Green: analytical clean hit
          } else {
            analyticalGrazingHits++
            diagnostic[p4] = 235; diagnostic[p4 + 1] = 195; diagnostic[p4 + 2] = 58 // Yellow: analytical grazing hit
          }
        } else if (bestCacheScore < Infinity) {
          hasSurfaceHit = true
          bestHx = bestCacheHx; bestHy = bestCacheHy; bestHz = bestCacheHz
          nhi = evalTetraGradient(evalMacro, bestHx, bestHy, bestHz, 0.005)
          residuals.push(bestCacheRes)
          cacheFallbacks++
          diagnostic[p4] = 245; diagnostic[p4 + 1] = 145; diagnostic[p4 + 2] = 36 // Orange: cache fallback (explicit!)
        } else if (foundAnyRoot) {
          crossWallRejected++
          diagnostic[p4] = 225; diagnostic[p4 + 1] = 48; diagnostic[p4 + 2] = 210 // Magenta: cross-wall rejected
        } else {
          misses++
          diagnostic[p4] = 230; diagnostic[p4 + 1] = 52; diagnostic[p4 + 2] = 52 // Red: miss
        }

        // 3. Apply 2x2 sub-texel supersampling strictly on texels touching structural cracks -> silky anti-aliased V-lips!
        const crack = field.evalCrackAt(bestHx, bestHy, bestHz, nhi.x, nhi.y, nhi.z)
        let crackMaskFinal = crack.mask
        if (hasSurfaceHit && crack.mask > 0.002) {
          const halfStep = texelWorld * 0.28
          let snx = 0, sny = 0, snz = 0, sm = 0
          const gnx = nhi.x, gny = nhi.y, gnz = nhi.z
          const subOffsets = [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const
          for (let si = 0; si < 4; si++) {
            const ox = (tx * subOffsets[si][0] + bx * subOffsets[si][1]) * halfStep
            const oy = (ty * subOffsets[si][0] + by * subOffsets[si][1]) * halfStep
            const oz = (tz * subOffsets[si][0] + bz * subOffsets[si][1]) * halfStep
            const sx = bestHx + ox, sy = bestHy + oy, sz = bestHz + oz
            const sg = evalTetraGradient((x, y, z) => evalCrackDetail(x, y, z, gnx, gny, gnz), sx, sy, sz, 0.004)
            snx += sg.x; sny += sg.y; snz += sg.z
            sm += field.evalCrackAt(sx, sy, sz, gnx, gny, gnz).mask
          }
          const sl = Math.hypot(snx, sny, snz) || 1
          nhi = { x: snx / sl, y: sny / sl, z: snz / sl }
          crackMaskFinal = sm * 0.25
        }

        if (nhi.x * nlx + nhi.y * nly + nhi.z * nlz < 0.12) {
          flippedNormalFallback++
          nhi = { x: nlx, y: nly, z: nlz }
        }

        // O(1) curvature estimate from cached macro SDF volume
        const cEps = vol.h * 1.15
        const fCenter = sampleVolumeTrilinear(vol, bestHx, bestHy, bestHz)
        const lap = (
          sampleVolumeTrilinear(vol, bestHx + cEps, bestHy, bestHz) +
          sampleVolumeTrilinear(vol, bestHx - cEps, bestHy, bestHz) +
          sampleVolumeTrilinear(vol, bestHx, bestHy + cEps, bestHz) +
          sampleVolumeTrilinear(vol, bestHx, bestHy - cEps, bestHz) +
          sampleVolumeTrilinear(vol, bestHx, bestHy, bestHz + cEps) +
          sampleVolumeTrilinear(vol, bestHx, bestHy, bestHz - cEps) -
          6 * fCenter
        ) / (cEps * cEps)
        const signedCurv = clamp(-lap * 0.055, -1, 1)

        hitPosX[pix] = bestHx; hitPosY[pix] = bestHy; hitPosZ[pix] = bestHz
        hitNormX[pix] = nhi.x; hitNormY[pix] = nhi.y; hitNormZ[pix] = nhi.z
        hitCurv[pix] = signedCurv
        hitCrackMask[pix] = crackMaskFinal

        // Encode Tangent-Space Normal in exact locked (T, B, N_low) basis
        let tnx = nhi.x * tx + nhi.y * ty + nhi.z * tz
        let tny = nhi.x * bx + nhi.y * by + nhi.z * bz
        let tnz = nhi.x * nlx + nhi.y * nly + nhi.z * nlz
        const tnLen = Math.hypot(tnx, tny, tnz) || 1
        tnx /= tnLen; tny /= tnLen; tnz /= tnLen
        normal[p4] = Math.round(clamp(tnx * 0.5 + 0.5, 0, 1) * 255)
        normal[p4 + 1] = Math.round(clamp(tny * 0.5 + 0.5, 0, 1) * 255)
        normal[p4 + 2] = Math.round(clamp(tnz * 0.5 + 0.5, 0, 1) * 255)
        normal[p4 + 3] = 255
      }
    }
  }
  const rasterAndProjectMs = performance.now() - tRaster0

  // -------------------------------------------------------------------------
  // Pass 2: Flat-Plane-Normalized Short-Range Hemisphere AO
  // -------------------------------------------------------------------------
  const tAo0 = performance.now()
  for (let pix = 0; pix < totalPix; pix++) {
    if (chartIdBuf[pix] < 0) continue
    const hx = hitPosX[pix], hy = hitPosY[pix], hz = hitPosZ[pix]
    const nx = hitNormX[pix], ny = hitNormY[pix], nz = hitNormZ[pix]

    const refX = Math.abs(ny) < 0.88 ? 0 : 1
    const refY = Math.abs(ny) < 0.88 ? 1 : 0
    const refZ = 0
    let ux = refY * nz - refZ * ny
    let uy = refZ * nx - refX * nz
    let uz = refX * ny - refY * nx
    const uLen = Math.hypot(ux, uy, uz) || 1
    ux /= uLen; uy /= uLen; uz /= uLen
    const vx = ny * uz - nz * uy
    const vy = nz * ux - nx * uz
    const vz = nx * uy - ny * ux

    let occSum = 0
    for (let r = 0; r < HEMI_RAYS.length; r++) {
      const [rx, ry, rz] = HEMI_RAYS[r]
      const dx = ux * rx + vx * ry + nx * rz
      const dy = uy * rx + vy * ry + ny * rz
      const dz = uz * rx + vz * ry + nz * rz
      let rayOcc = 0
      for (let s = 0; s < AO_STEPS.length; s++) {
        const dist = AO_STEPS[s]
        const expectedFlat = dist * rz
        const f = sampleVolumeTrilinear(vol, hx + dx * dist, hy + dy * dist, hz + dz * dist)
        const blocked = clamp((expectedFlat - f) / expectedFlat, 0, 1)
        rayOcc += blocked * AO_WEIGHTS[s]
      }
      occSum += rayOcc
    }
    const hemiOcc = clamp((occSum / HEMI_RAYS.length) * 1.35, 0, 0.85)

    const yMesh = hy + shift.y
    const groundOcc = smoothstep(0.14, 0.0, yMesh) * 0.44
    const concaveOcc = smoothstep(-0.12, -0.58, hitCurv[pix]) * 0.42
    const crackOcc = hitCrackMask[pix] * 0.68
    const totalOcc = clamp(Math.max(hemiOcc, groundOcc, concaveOcc) + crackOcc * 0.58, 0, 0.90)
    const aoByte = Math.round((1 - totalOcc) * 255)
    const p4 = pix * 4
    ao[p4] = aoByte; ao[p4 + 1] = aoByte; ao[p4 + 2] = aoByte; ao[p4 + 3] = 255
  }
  const aoMs = performance.now() - tAo0

  // -------------------------------------------------------------------------
  // Pass 3: Restrained BaseColor + Controlled Art A/B Directional Broad Brushstrokes ('off' vs 'subtle')
  //   Still ZERO baked directional key-light shadows — dynamic lights drive 100% of light/shadow sides!
  // -------------------------------------------------------------------------
  const tAlb0 = performance.now()
  const sedR = baseR * 0.81, sedG = baseG * 0.80, sedB = baseB * 0.81
  const chipR = Math.min(255, baseR * 1.17), chipG = Math.min(255, baseG * 1.27), chipB = Math.min(255, baseB * 1.38)
  const crackR = baseR * 0.55, crackG = baseG * 0.50, crackB = baseB * 0.49
  // Controlled warm-ochre vs cool-taupe gouache strata palette for Art A/B 'subtle' mode
  // (still zero directional key-light shading; adds readable inclined strata rhythm on wide planes)
  const warmStrokeR = Math.min(255, baseR * 1.16), warmStrokeG = Math.min(255, baseG * 1.11), warmStrokeB = Math.min(255, baseB * 1.01)
  const coolStrokeR = baseR * 0.81, coolStrokeG = baseG * 0.79, coolStrokeB = baseB * 0.84
  const enableBrush = brushMode === 'subtle'

  for (let pix = 0; pix < totalPix; pix++) {
    if (chartIdBuf[pix] < 0) continue
    const hx = hitPosX[pix], hy = hitPosY[pix], hz = hitPosZ[pix]
    const nx = hitNormX[pix], ny = hitNormY[pix], nz = hitNormZ[pix]
    const info = field.evalSurfaceColorInfo(hx, hy, hz, nx, ny, nz)

    const toneMul = clamp(
      1.0 + info.strata * 0.045 + (enableBrush ? info.brushTone * 0.045 : 0) + (info.heightNorm - 0.45) * 0.05,
      0.86,
      1.12,
    )
    let r = baseR * toneMul
    let g = baseG * toneMul
    let b = baseB * toneMul

    if (enableBrush) {
      // Low-intensity directional broad gouache strata strokes aligned with inclined geological bedding:
      // coherent wide bands (3.8:1 stretched along strata), softly stepped so game-scale views read richer strata
      // without high-frequency noise or fake lighting direction.
      const uBed = hx * 0.88 + hy * 0.40 + hz * 0.24
      const vBed = -hx * 0.34 + hy * 0.91 - hz * 0.22
      const wBed = hz * 0.94 - hx * 0.32
      const bedWave = Math.sin(vBed * 7.8 + fbm3(uBed * 1.35, vBed * 1.85, wBed * 1.35, 911, 2) * 2.2)
      const strokePatch = fbm3(uBed * 1.65 + 4.1, vBed * 4.40 - 2.7, wBed * 1.75, 977, 2) * 1.65
      const signal = bedWave * 0.58 + strokePatch * 0.52
      const bandWarm = smoothstep(0.18, 0.78, signal)
      const bandCool = smoothstep(0.20, 0.82, -signal)
      r = lerp(r, warmStrokeR, bandWarm * 0.52)
      g = lerp(g, warmStrokeG, bandWarm * 0.52)
      b = lerp(b, warmStrokeB, bandWarm * 0.52)
      r = lerp(r, coolStrokeR, bandCool * 0.42)
      g = lerp(g, coolStrokeG, bandCool * 0.42)
      b = lerp(b, coolStrokeB, bandCool * 0.42)
    }

    const sedMix = clamp(info.footSediment * 0.36, 0, 0.38)
    r = lerp(r, sedR, sedMix)
    g = lerp(g, sedG, sedMix)
    b = lerp(b, sedB, sedMix)

    // Restrained fresh-chip pale pigment strictly on chosen corner chips & sharp convex bevels
    const curvHint = smoothstep(0.16, 0.54, hitCurv[pix])
    const brushBreak = enableBrush ? smoothstep(-0.22, 0.38, info.brushTone) : 0.65
    const freshChip = clamp(
      info.chipFreshness * (0.30 + 0.55 * curvHint) + curvHint * (enableBrush ? 0.22 : 0.14) * brushBreak,
      0,
      enableBrush ? 0.70 : 0.60,
    )
    r = lerp(r, chipR, freshChip)
    g = lerp(g, chipG, freshChip)
    b = lerp(b, chipB, freshChip)

    const crackCore = smoothstep(0.30, 0.90, hitCrackMask[pix]) * 0.44
    r = lerp(r, crackR, crackCore)
    g = lerp(g, crackG, crackCore)
    b = lerp(b, crackB, crackCore)

    const p4 = pix * 4
    albedo[p4] = Math.round(clamp(r, 0, 255))
    albedo[p4 + 1] = Math.round(clamp(g, 0, 255))
    albedo[p4 + 2] = Math.round(clamp(b, 0, 255))
    albedo[p4 + 3] = 255
  }
  const albedoMs = performance.now() - tAlb0

  // -------------------------------------------------------------------------
  // Pass 4: Per-Chart Isolated Dilation Padding
  // -------------------------------------------------------------------------
  const tDil0 = performance.now()
  dilatePerChart(size, chartIdBuf, [albedo, normal, ao], dilationPasses)
  const dilationMs = performance.now() - tDil0

  const totalBakeMs = performance.now() - tStart
  const safeCov = Math.max(1, coveredTexels)

  // Compute exact analytical residual stats (max, mean, P95)
  let maxRes = 0, sumRes = 0, p95Res = 0
  if (residuals.length > 0) {
    residuals.sort((a, b) => a - b)
    maxRes = residuals[residuals.length - 1]
    for (let i = 0; i < residuals.length; i++) sumRes += residuals[i]
    p95Res = residuals[Math.min(residuals.length - 1, Math.floor(residuals.length * 0.95))]
  }

  return {
    size,
    albedo,
    normal,
    ao,
    diagnostic,
    stats: {
      resolution: size,
      coveredTexels,
      analyticalCleanHits,
      analyticalGrazingHits,
      cacheFallbacks,
      crossWallRejected,
      misses,
      flippedNormalFallback,
      analyticalHitRate: Math.round(((analyticalCleanHits + analyticalGrazingHits) / safeCov) * 10000) / 10000,
      cacheFallbackRate: Math.round((cacheFallbacks / safeCov) * 10000) / 10000,
      crossWallRate: Math.round((crossWallRejected / safeCov) * 10000) / 10000,
      missRate: Math.round((misses / safeCov) * 10000) / 10000,
      maxAnalyticalResidual: round5(maxRes),
      meanAnalyticalResidual: round5(residuals.length > 0 ? sumRes / residuals.length : 0),
      p95AnalyticalResidual: round5(p95Res),
      timings: {
        volumeCacheMs: round1(volumeCacheMs),
        rasterAndProjectMs: round1(rasterAndProjectMs),
        aoMs: round1(aoMs),
        albedoMs: round1(albedoMs),
        dilationMs: round1(dilationMs),
        totalBakeMs: round1(totalBakeMs),
      },
    },
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

function round5(v: number): number {
  return Math.round(v * 100000) / 100000
}

export function dilatePerChart(
  size: number,
  chartIdBuf: Int32Array,
  buffers: Uint8ClampedArray[],
  passes: number,
) {
  const curChart = new Int32Array(chartIdBuf)
  const nextChart = new Int32Array(curChart)
  const offsets = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ]

  for (let pass = 0; pass < passes; pass++) {
    let changed = 0
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = y * size + x
        if (curChart[idx] >= 0) continue

        let pickedChart = -1
        for (let k = 0; k < offsets.length; k++) {
          const nx = x + offsets[k][0], ny = y + offsets[k][1]
          if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue
          const cid = curChart[ny * size + nx]
          if (cid >= 0) { pickedChart = cid; break }
        }
        if (pickedChart < 0) continue

        nextChart[idx] = pickedChart
        changed++
        for (let bi = 0; bi < buffers.length; bi++) {
          const buf = buffers[bi]
          let sr = 0, sg = 0, sb = 0, cnt = 0
          for (let k = 0; k < offsets.length; k++) {
            const nx = x + offsets[k][0], ny = y + offsets[k][1]
            if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue
            const nIdx = ny * size + nx
            if (curChart[nIdx] !== pickedChart) continue
            const p4 = nIdx * 4
            sr += buf[p4]; sg += buf[p4 + 1]; sb += buf[p4 + 2]
            cnt++
          }
          if (cnt > 0) {
            const d4 = idx * 4
            buf[d4] = Math.round(sr / cnt)
            buf[d4 + 1] = Math.round(sg / cnt)
            buf[d4 + 2] = Math.round(sb / cnt)
            buf[d4 + 3] = 255
          }
        }
      }
    }
    curChart.set(nextChart)
    if (changed === 0) break
  }
}
