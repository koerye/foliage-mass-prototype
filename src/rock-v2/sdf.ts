export interface Vec3 {
  x: number
  y: number
  z: number
}

export type RockV2ArchetypeId = 'block-bluff' | 'twin-slab' | 'sandstone-ledge-a' | 'sandstone-ledge-b'

export interface RockV2SculptParams {
  seed?: number
  /** Width/height/depth uniform or per-axis stretch (default 1,1,1). */
  scaleX?: number
  scaleY?: number
  scaleZ?: number
  /** How deeply the stepped shoulder terrace / V-cleft carves into the monolith (0.5..1.5, default 1.0). */
  carveDepth?: number
  /** Edge sharpness / bevel tightness (0 = softer, 1 = crisp chiseled shoulder ridges, default 0.78). */
  ridgeCrispness?: number
  /** Structural fine crack depth multiplier (0..1.5, default 1.0). */
  crackStrength?: number
}

export interface CrackSegment {
  a: Vec3
  b: Vec3
  widthA: number
  widthB: number
  depthA: number
  depthB: number
}

export interface CrackPath {
  name: string
  /** Dominant face normal where this crack lives; rejects opposite/back walls cleanly. */
  faceNormal: Vec3
  /** Minimum dot(surfaceNormal, faceNormal) required for crack to apply. */
  normalMinDot: number
  /** Side of the asymmetric V-groove that catches the steeper slope (+1 or -1). */
  asymmetry: number
  segments: CrackSegment[]
}

export interface RockV2ChipZone {
  center: Vec3
  radius: number
  strength: number
}

export interface RockV2Field {
  id: RockV2ArchetypeId
  name: string
  /** Conservative world-space AABB strictly containing F(p) <= 0 with margin. */
  boundsMin: Vec3
  boundsMax: Vec3
  /** Macro SDF (interior < 0) used for Surface Nets extraction & macro silhouette. */
  evalMacro(x: number, y: number, z: number): number
  /** Analytical fine-detail SDF (macro + structural cracks + subtle micro-chips) used for texel baking. */
  evalDetail(x: number, y: number, z: number): number
  /** Evaluates structural crack intensity [0..1] & signed depth at p (strictly gated by surface normal). */
  evalCrackAt(x: number, y: number, z: number, nx: number, ny: number, nz: number): {
    mask: number
    depth: number
    lipSlope: number
  }
  /** Evaluates localized fresh-chip highlight mask [0..1] strictly on intentionally chipped corners. */
  evalChipMask(x: number, y: number, z: number): number
  /** Macro height-normalized [0..1] & organic strata / painterly tonal variation for restrained BaseColor. */
  evalSurfaceColorInfo(x: number, y: number, z: number, nx: number, ny: number, nz: number): {
    heightNorm: number
    strata: number
    brushTone: number
    footSediment: number
    chipFreshness: number
  }
  /** Exposed structural crack curves for debugging/tests. */
  cracks: CrackPath[]
  /** Exposed localized chip zones. */
  chips: RockV2ChipZone[]
}

// ---------------------------------------------------------------------------
// Deterministic 3D Noise & Basic Vector / Smooth CSG Primitives
// ---------------------------------------------------------------------------
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1)
  return t * t * (3 - 2 * t)
}

export function vNorm(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z)
  return l > 1e-8 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 1, z: 0 }
}

function vCross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}

function vDot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function hash2(ix: number, iy: number, seed: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1274126177)
  n = (n ^ (n >>> 13)) | 0
  n = Math.imul(n, 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}

export function noise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const n00 = hash2(ix, iy, seed)
  const n10 = hash2(ix + 1, iy, seed)
  const n01 = hash2(ix, iy + 1, seed)
  const n11 = hash2(ix + 1, iy + 1, seed)
  return lerp(lerp(n00, n10, ux), lerp(n01, n11, ux), uy)
}

export function fbm2(x: number, y: number, seed: number, octaves = 2): number {
  let sum = 0, amp = 0.5, freq = 1, norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * (noise2(x * freq, y * freq, seed + i * 37) * 2 - 1)
    norm += amp
    amp *= 0.5
    freq *= 2.03
  }
  return sum / (norm || 1)
}

function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 2147483647) + Math.imul(seed, 1274126177)
  n = (n ^ (n >>> 13)) | 0
  n = Math.imul(n, 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}

export function noise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  const fx = x - ix, fy = y - iy, fz = z - iz
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const uz = fz * fz * (3 - 2 * fz)
  const n000 = hash3(ix, iy, iz, seed)
  const n100 = hash3(ix + 1, iy, iz, seed)
  const n010 = hash3(ix, iy + 1, iz, seed)
  const n110 = hash3(ix + 1, iy + 1, iz, seed)
  const n001 = hash3(ix, iy, iz + 1, seed)
  const n101 = hash3(ix + 1, iy, iz + 1, seed)
  const n011 = hash3(ix, iy + 1, iz + 1, seed)
  const n111 = hash3(ix + 1, iy + 1, iz + 1, seed)
  const x00 = lerp(n000, n100, ux), x10 = lerp(n010, n110, ux)
  const x01 = lerp(n001, n101, ux), x11 = lerp(n011, n111, ux)
  return lerp(lerp(x00, x10, uy), lerp(x01, x11, uy), uz)
}

export function fbm3(x: number, y: number, z: number, seed: number, octaves = 3): number {
  let sum = 0, amp = 0.5, freq = 1, norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * (noise3(x * freq, y * freq, z * freq, seed + i * 37) * 2 - 1)
    norm += amp
    amp *= 0.5
    freq *= 2.03
  }
  return sum / (norm || 1)
}

/** Polynomial smooth-min (union of solid masses, interior < 0). */
export function smoothMin(a: number, b: number, k: number): number {
  if (k <= 1e-6) return Math.min(a, b)
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

/** Polynomial smooth-max (intersection / smooth carving cut, interior < 0). */
export function smoothMax(a: number, b: number, k: number): number {
  return -smoothMin(-a, -b, k)
}

/** Smoothly rounded, optionally tapered oriented box lobe (interior < 0). */
interface OrientedLobe {
  cx: number; cy: number; cz: number
  rx: number; ry: number; rz: number // half-extents
  round: number
  taperX: number // top X taper factor
  taperZ: number // top Z taper factor
  leanX: number  // X shift per +Y
  leanZ: number  // Z shift per +Y
  rotY: number
  rotZ: number
  cY: number; sY: number
  cZ: number; sZ: number
}

function makeLobe(opts: Omit<OrientedLobe, 'cY' | 'sY' | 'cZ' | 'sZ'>): OrientedLobe {
  return {
    ...opts,
    cY: Math.cos(-opts.rotY),
    sY: Math.sin(-opts.rotY),
    cZ: Math.cos(-opts.rotZ),
    sZ: Math.sin(-opts.rotZ),
  }
}

function evalLobe(x: number, y: number, z: number, l: OrientedLobe): number {
  let px = x - l.cx
  let py = y - l.cy
  let pz = z - l.cz
  // Rotate around Y then Z (inverse transform)
  const rx1 = px * l.cY + pz * l.sY
  const rz1 = -px * l.sY + pz * l.cY
  px = rx1; pz = rz1
  const rx2 = px * l.cZ - py * l.sZ
  const ry2 = px * l.sZ + py * l.cZ
  px = rx2; py = ry2

  // Gentle organic top taper & lean
  const yn = clamp((py + l.ry) / (2 * l.ry), 0, 1)
  px -= l.leanX * py
  pz -= l.leanZ * py
  const hx = Math.max(0.08, l.rx * (1 - l.taperX * yn))
  const hz = Math.max(0.08, l.rz * (1 - l.taperZ * yn))

  const qx = Math.abs(px) - (hx - l.round)
  const qy = Math.abs(py) - (l.ry - l.round)
  const qz = Math.abs(pz) - (hz - l.round)
  const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0))
  const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0)
  return out + inside - l.round
}

/**
 * Controlled Warped Plane: `dot(n, p) - h + boundedLowFreqInPlaneWarp(u, v)`
 * Keeps major faces cleanly readable & broad while eliminating CAD ruler rigidity.
 */
interface WarpedPlane {
  nx: number; ny: number; nz: number
  ux: number; uy: number; uz: number
  vx: number; vy: number; vz: number
  h: number
  freq: number
  amp: number
  /** Slight quadratic dome/bowl curve across the plane (+ convex dome, - subtle scoop). */
  bow: number
  /** Smooth cut transition radius `k` when intersecting with body via smoothMax. */
  k: number
  seed: number
}

function makeWarpedPlane(
  normal: Vec3,
  h: number,
  opts: { freq?: number; amp?: number; bow?: number; k?: number; seed?: number } = {},
): WarpedPlane {
  const n = vNorm(normal)
  const ref: Vec3 = Math.abs(n.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
  const u = vNorm(vCross(ref, n))
  const v = vCross(n, u)
  return {
    nx: n.x, ny: n.y, nz: n.z,
    ux: u.x, uy: u.y, uz: u.z,
    vx: v.x, vy: v.y, vz: v.z,
    h,
    freq: opts.freq ?? 1.25,
    amp: opts.amp ?? 0.032,
    bow: opts.bow ?? 0.018,
    k: opts.k ?? 0.04,
    seed: opts.seed ?? 101,
  }
}

function evalWarpedPlane(x: number, y: number, z: number, pl: WarpedPlane, curMax = -Infinity): number {
  const d = x * pl.nx + y * pl.ny + z * pl.nz - pl.h
  // Exact mathematical cull: if this plane is strictly further inside than `curMax - maxPossibleWarp - k`,
  // smoothMax(curMax, planeVal, k) is guaranteed identically equal to curMax!
  if (d + pl.amp + pl.k + 0.01 < curMax) return d
  const u = x * pl.ux + y * pl.uy + z * pl.uz
  const v = x * pl.vx + y * pl.vy + z * pl.vz
  const w1 = fbm2(u * pl.freq + 1.7, v * pl.freq - 2.3, pl.seed, 2)
  const bowOff = pl.bow !== 0 ? pl.bow * Math.min(1.6, u * u + v * v) : 0
  return d + w1 * pl.amp + bowOff
}

/**
 * Finite-volume slanted V-notch / terrace cutter (interior < 0 is CARVED AWAY via `smoothMax(rock, -notch, kRim)`).
 * Local frame:
 *   `u` = across groove width (0 = groove centerline)
 *   `v` = outward/up from groove bottom (0 = floor, > 0 = open air above groove)
 *   `w` = along groove finite length (|w| <= halfLen)
 */
interface FiniteNotch {
  ox: number; oy: number; oz: number
  ux: number; uy: number; uz: number
  vx: number; vy: number; vz: number
  wx: number; wy: number; wz: number
  throatHalf: number
  cosL: number; sinL: number
  cosR: number; sinR: number
  halfLen: number
  /** How steeply the groove floor rises toward its front/back ends so it terminates naturally into the stone. */
  endRise: number
  /** Optional subtle wobble along the groove axis w. */
  wobbleAmp: number
  wobbleFreq: number
  /** Smooth rounding at groove bottom floor. */
  kFloor: number
  /** Smooth rounding at groove outer rim lip. */
  kRim: number
  seed: number
}

function makeFiniteNotch(opts: {
  origin: Vec3
  /** Direction across groove width (left -> right). */
  across: Vec3
  /** Direction outward/upward out of the carved groove. */
  upOut: Vec3
  throatHalf: number
  angleLeftRad: number
  angleRightRad: number
  halfLen: number
  endRise?: number
  wobbleAmp?: number
  wobbleFreq?: number
  kFloor?: number
  kRim?: number
  seed?: number
}): FiniteNotch {
  const v = vNorm(opts.upOut)
  // Orthogonalize across against upOut
  const aRaw = opts.across
  const dot = vDot(aRaw, v)
  const u = vNorm({ x: aRaw.x - v.x * dot, y: aRaw.y - v.y * dot, z: aRaw.z - v.z * dot })
  const w = vNorm(vCross(u, v))
  return {
    ox: opts.origin.x, oy: opts.origin.y, oz: opts.origin.z,
    ux: u.x, uy: u.y, uz: u.z,
    vx: v.x, vy: v.y, vz: v.z,
    wx: w.x, wy: w.y, wz: w.z,
    throatHalf: opts.throatHalf,
    cosL: Math.cos(opts.angleLeftRad), sinL: Math.sin(opts.angleLeftRad),
    cosR: Math.cos(opts.angleRightRad), sinR: Math.sin(opts.angleRightRad),
    halfLen: opts.halfLen,
    endRise: opts.endRise ?? 0.24,
    wobbleAmp: opts.wobbleAmp ?? 0.025,
    wobbleFreq: opts.wobbleFreq ?? 2.2,
    kFloor: opts.kFloor ?? 0.032,
    kRim: opts.kRim ?? 0.035,
    seed: opts.seed ?? 307,
  }
}

function evalFiniteNotch(x: number, y: number, z: number, n: FiniteNotch): number {
  const dx = x - n.ox, dy = y - n.oy, dz = z - n.oz
  let u = dx * n.ux + dy * n.uy + dz * n.uz
  const v = dx * n.vx + dy * n.vy + dz * n.vz
  const w = dx * n.wx + dy * n.wy + dz * n.wz

  if (n.wobbleAmp > 0) {
    u += fbm3(w * n.wobbleFreq + 1.3, v * 1.4, 0.5, n.seed, 2) * n.wobbleAmp
  }
  const wNorm = clamp(w / (n.halfLen || 1), -1.5, 1.5)
  const vEff = v - n.endRise * (wNorm * wNorm)

  // Negative inside the V-opening, positive outside in solid rock
  const dRight = (u - n.throatHalf) * n.cosR - vEff * n.sinR
  const dLeft = (-u - n.throatHalf) * n.cosL - vEff * n.sinL
  const dFloor = -vEff
  const dEnds = Math.abs(w) - n.halfLen

  let d = smoothMax(dRight, dLeft, n.kFloor)
  d = smoothMax(d, dFloor, n.kFloor)
  d = smoothMax(d, dEnds, 0.06)
  return d
}

/**
 * Asymmetric rocky foot base:
 * Breaks up uniform circular rounding using multi-lobe angular footprint modulation + asymmetric undercut,
 * leaving a stable central contact pad while making low-angle 360° silhouettes read as angular chiseled stone.
 */
function evalOrganicBottom(x: number, y: number, z: number, baseY: number, flatRadius: number, seed: number): number {
  const r = Math.hypot(x, z)
  const ang = Math.atan2(z, x)
  // Asymmetric polygonal lobe modulation (breaks smooth oval symmetry cleanly!)
  const polyLobe =
    0.18 * Math.cos(ang * 2.0 + 0.65) +
    0.14 * Math.sin(ang * 3.0 - 0.90) +
    0.09 * Math.cos(ang * 5.0 + 1.40)
  const nVar = (noise3(Math.cos(ang) * 2.4 + 3.1, Math.sin(ang) * 2.4 - 1.4, 0.7, seed) - 0.5) * 0.44
  const rimFactor = clamp(0.92 + polyLobe + nVar, 0.46, 1.38)
  const excess = Math.max(0, r - flatRadius * rimFactor)
  const skirtLift = excess * excess * 0.34 + excess * 0.11 * (1.28 - 0.45 * rimFactor)
  return (baseY + skirtLift) - y
}

// ---------------------------------------------------------------------------
// Structural Finite-Curve Crack Evaluator (Gate 2 Analytical Fine Detail)
// ---------------------------------------------------------------------------
function evalCrackPaths(
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  paths: CrackPath[],
): { mask: number; depth: number; lipSlope: number } {
  let bestDepth = 0
  let bestMask = 0
  let bestLip = 0

  for (let pi = 0; pi < paths.length; pi++) {
    const path = paths[pi]
    const nDot = nx * path.faceNormal.x + ny * path.faceNormal.y + nz * path.faceNormal.z
    const faceGate = smoothstep(path.normalMinDot - 0.14, path.normalMinDot + 0.12, nDot)
    if (faceGate <= 0.001) continue

    let minDistSq = Infinity
    let hitW = 0
    let hitD = 0
    let hitSide = 0

    for (let si = 0; si < path.segments.length; si++) {
      const seg = path.segments[si]
      const abx = seg.b.x - seg.a.x
      const aby = seg.b.y - seg.a.y
      const abz = seg.b.z - seg.a.z
      const lenSq = abx * abx + aby * aby + abz * abz
      if (lenSq < 1e-8) continue
      const apx = x - seg.a.x
      const apy = y - seg.a.y
      const apz = z - seg.a.z
      const t = clamp((apx * abx + apy * aby + apz * abz) / lenSq, 0, 1)
      const qx = seg.a.x + abx * t
      const qy = seg.a.y + aby * t
      const qz = seg.a.z + abz * t
      const dx = x - qx, dy = y - qy, dz = z - qz
      // Guard off-surface bleed: reject points too far along the face normal from the crack curve
      const normalOff = Math.abs(dx * path.faceNormal.x + dy * path.faceNormal.y + dz * path.faceNormal.z)
      if (normalOff > 0.14) continue
      const dSq = dx * dx + dy * dy + dz * dz
      if (dSq < minDistSq) {
        minDistSq = dSq
        hitW = lerp(seg.widthA, seg.widthB, t)
        hitD = lerp(seg.depthA, seg.depthB, t)
        // Cross product of segment tangent & face normal gives signed across-crack side
        const sx = aby * path.faceNormal.z - abz * path.faceNormal.y
        const sy = abz * path.faceNormal.x - abx * path.faceNormal.z
        const sz = abx * path.faceNormal.y - aby * path.faceNormal.x
        const sLen = Math.hypot(sx, sy, sz) || 1
        hitSide = (dx * sx + dy * sy + dz * sz) / sLen
      }
    }

    if (hitW <= 1e-4 || hitD <= 1e-5 || minDistSq >= hitW * hitW * 2.6) continue
    // Slightly asymmetric V cross-section: one wall is steeper (catches crisp dynamic light lip!)
    const sideNorm = hitSide / hitW
    const asymScale = sideNorm * path.asymmetry >= 0 ? 0.78 : 1.28
    const effDist = Math.abs(sideNorm) / asymScale
    if (effDist >= 1.0) continue

    // Crisp V-groove depth profile with smooth bottom & clean shoulder
    const vProfile = Math.pow(1 - effDist, 1.35)
    const depth = hitD * vProfile * faceGate
    const mask = smoothstep(1.0, 0.12, effDist) * faceGate
    const lip = clamp(sideNorm * path.asymmetry, -1, 1) * mask
    if (depth > bestDepth) {
      bestDepth = depth
      bestMask = mask
      bestLip = lip
    }
  }

  return { mask: bestMask, depth: bestDepth, lipSlope: bestLip }
}

/** Projects a crack polyline onto the macro zero-isosurface so every vertex sits tightly on F(p) = 0. */
function projectPointToMacroSurface(p: Vec3, evalMacro: (x: number, y: number, z: number) => number): Vec3 {
  let { x, y, z } = p
  const eps = 0.008
  for (let iter = 0; iter < 12; iter++) {
    const f = evalMacro(x, y, z)
    if (Math.abs(f) < 1e-4) break
    const gx = (evalMacro(x + eps, y, z) - evalMacro(x - eps, y, z)) / (2 * eps)
    const gy = (evalMacro(x, y + eps, z) - evalMacro(x, y - eps, z)) / (2 * eps)
    const gz = (evalMacro(x, y, z + eps) - evalMacro(x, y, z - eps)) / (2 * eps)
    const g2 = gx * gx + gy * gy + gz * gz
    if (g2 < 1e-5) break
    const step = clamp(f / g2, -0.15, 0.15)
    x -= gx * step
    y -= gy * step
    z -= gz * step
  }
  return { x, y, z }
}

function buildProjectedCrackPath(
  name: string,
  rawPoints: Vec3[],
  widths: number[],
  depths: number[],
  faceNormal: Vec3,
  normalMinDot: number,
  asymmetry: number,
  evalMacro: (x: number, y: number, z: number) => number,
): CrackPath {
  const projected = rawPoints.map(pt => projectPointToMacroSurface(pt, evalMacro))
  const segments: CrackSegment[] = []
  for (let i = 0; i + 1 < projected.length; i++) {
    segments.push({
      a: projected[i],
      b: projected[i + 1],
      widthA: widths[i],
      widthB: widths[i + 1],
      depthA: depths[i],
      depthB: depths[i + 1],
    })
  }
  return {
    name,
    faceNormal: vNorm(faceNormal),
    normalMinDot,
    asymmetry,
    segments,
  }
}

export function evalFieldGradient(
  evalFn: (x: number, y: number, z: number) => number,
  x: number,
  y: number,
  z: number,
  eps = 0.006,
): Vec3 {
  const gx = evalFn(x + eps, y, z) - evalFn(x - eps, y, z)
  const gy = evalFn(x, y + eps, z) - evalFn(x, y - eps, z)
  const gz = evalFn(x, y, z + eps) - evalFn(x, y, z - eps)
  return vNorm({ x: gx, y: gy, z: gz })
}

// ---------------------------------------------------------------------------
// Archetype 1: Stepped Block Bluff — Upgraded Method B (阶梯方巨岩 · 单偏心母体减切版)
// ZERO smoothMin lobes, ZERO quadratic marshmallow bottom!
// Single eccentric oblique chunky crag monolith with oblique rising summit peak,
// bold subtractive diagonal shoulder terrace, diagonal front-cheek ridge break,
// outward lower-right cliff buttress & solid monolithic back spine.
// ---------------------------------------------------------------------------
function createBlockBluffField(params: RockV2SculptParams = {}): RockV2Field {
  const seed = Math.round(params.seed ?? 7342)
  const carveDepth = clamp(params.carveDepth ?? 1.0, 0.5, 1.5)
  const crisp = clamp(params.ridgeCrispness ?? 0.86, 0.0, 1.0)
  const crackMul = clamp(params.crackStrength ?? 1.0, 0.0, 1.5)
  const kHard = lerp(0.012, 0.004, crisp)
  const kMed = lerp(0.018, 0.008, crisp)
  const kSoft = lerp(0.028, 0.014, crisp)

  // Subtle deterministic seed offsets so re-seeding reshapes geological proportions cleanly
  const jX = (hash3(seed, 11, 3, 91) - 0.5) * 0.12
  const jZ = (hash3(seed, 29, 7, 91) - 0.5) * 0.10
  const jDip = (hash3(seed, 47, 13, 91) - 0.5) * 0.08

  // 1. SINGLE unified eccentric oblique chunky parent monolith (ZERO smoothMin!)
  const parentPlanes: WarpedPlane[] = [
    // Crisp flat grounded base (zero soup-bowl pillow!)
    makeWarpedPlane({ x: 0, y: -1, z: 0 }, 0.0, { freq: 1.0, amp: 0.003, k: kHard, seed: seed + 1 }),
    // Oblique rising summit crown (~17° left->right rise + slight roll -> NEVER flat horizontal cube top!)
    makeWarpedPlane({ x: -0.28 + jDip * 0.5, y: 0.93, z: 0.22 }, 1.24, { freq: 1.15, amp: 0.011, k: kSoft, seed: seed + 11 }),
    // Eccentric right-rear descending crown bevel (places sharp apex around x~+0.28, y~1.46, z~-0.08)
    makeWarpedPlane({ x: 0.48, y: 0.84, z: -0.26 }, 1.41, { freq: 1.20, amp: 0.010, k: kMed, seed: seed + 17 }),
    // Steep outer right cliff base (extends to x~+0.96 so upper-right outward relief leaves a crisp lower-right buttress!)
    makeWarpedPlane({ x: 0.91, y: 0.26, z: 0.32 }, 0.98 + jX * 0.3, { freq: 1.15, amp: 0.010, k: kHard, seed: seed + 23 }),
    // Crisp diagonal front-right shadow cliff bevel
    makeWarpedPlane({ x: 0.68, y: 0.22, z: 0.70 }, 0.90, { freq: 1.20, amp: 0.010, k: kHard, seed: seed + 25 }),
    // Bold DIAGONALLY-angled front-right flank (higher y-tilt -> oblique front ridge, zero vertical seam!)
    makeWarpedPlane({ x: 0.30, y: 0.34, z: 0.89 }, 0.84 + jZ * 0.25, { freq: 1.15, amp: 0.010, k: kHard, seed: seed + 29 }),
    // Broad intact sunlit front-left hero face (steep battered cliff)
    makeWarpedPlane({ x: -0.10, y: 0.17, z: 0.98 }, 0.67 + jZ * 0.2, { freq: 1.10, amp: 0.011, k: kHard, seed: seed + 31 }),
    // Steep chunky left flank cliff (grounds the lower-left stepped wing solidly!)
    makeWarpedPlane({ x: -0.92, y: 0.28, z: 0.26 }, 0.99 - jX * 0.3, { freq: 1.15, amp: 0.010, k: kHard, seed: seed + 37 }),
    // Crisp upper-left nose chamfer
    makeWarpedPlane({ x: -0.66, y: 0.64, z: 0.39 }, 1.04, { freq: 1.20, amp: 0.009, k: kHard, seed: seed + 39 }),
    // Converging rear-left fractured flank
    makeWarpedPlane({ x: -0.54, y: 0.24, z: -0.81 }, 0.76, { freq: 1.15, amp: 0.011, k: kMed, seed: seed + 41 }),
    // Solid thick rear-right spine (guarantees 100% monolithic back in 145° counter-evidence view!)
    makeWarpedPlane({ x: 0.24, y: 0.26, z: -0.94 }, 0.72, { freq: 1.15, amp: 0.011, k: kMed, seed: seed + 43 }),
    // Rear-right corner cliff
    makeWarpedPlane({ x: 0.76, y: 0.26, z: -0.59 }, 0.90, { freq: 1.20, amp: 0.010, k: kHard, seed: seed + 47 }),
    // Three localized angular base undercuts (leave 3 clear faceted grounded rock feet — ZERO pillow skirt!)
    makeWarpedPlane({ x: -0.08, y: -0.56, z: 0.82 }, 0.50, { freq: 1.35, amp: 0.008, k: kMed, seed: seed + 53 }),
    makeWarpedPlane({ x: -0.14, y: -0.56, z: -0.82 }, 0.54, { freq: 1.35, amp: 0.009, k: kMed, seed: seed + 59 }),
    makeWarpedPlane({ x: 0.82, y: -0.50, z: -0.28 }, 0.78, { freq: 1.35, amp: 0.008, k: kMed, seed: seed + 61 }),
  ]

  // 2. PRIMARY SUBTRACTIVE OBLIQUE SHOULDER CLEAVAGE CUT:
  //    Carves upper-left ~44% of the chunky crag cleanly down to an oblique dipping + cross-rolled shoulder bench
  //    (y ~ 0.68..0.84, NEVER flat horizontal!) against a steep diagonal ~64° cleavage riser!
  const benchY = 0.77 - (carveDepth - 1.0) * 0.20
  const cutBenchFloor = makeWarpedPlane({ x: 0.28, y: -0.94, z: -0.20 }, -(benchY + 0.04), {
    freq: 1.10, amp: 0.009, k: kHard, seed: seed + 101,
  })
  const cutShoulderRiser = makeWarpedPlane({ x: 0.84, y: -0.36, z: -0.40 }, -(0.46 + jX * 0.25), {
    freq: 1.25, amp: 0.010, k: kHard, seed: seed + 107,
  })

  // 3. CLEAN OUTWARD-OPENING UPPER-RIGHT CLIFF RELIEF (carves upper-right cliff cleanly from outer air,
  //    leaving a proud lower-right cliff buttress step!)
  const upperRightFloor = makeWarpedPlane({ x: -0.36, y: -0.84, z: -0.40 }, -0.94, {
    freq: 1.20, amp: 0.008, k: kHard, seed: seed + 149,
  })
  const upperRightInnerWall = makeWarpedPlane({ x: -0.92, y: -0.28, z: -0.28 }, -0.86 - jX * 0.2, {
    freq: 1.15, amp: 0.009, k: kHard, seed: seed + 151,
  })

  // 4. CONCENTRATED DIAGONAL SHOULDER FRACTURE + LOCALIZED FOOT/CROWN CHIPS
  const shoulderFracture = makeFiniteNotch({
    origin: { x: -0.18 + jX * 0.2, y: benchY + 0.02, z: 0.34 },
    across: { x: 0.78, y: -0.24, z: -0.58 },
    upOut: { x: -0.26, y: 0.88, z: 0.39 },
    throatHalf: 0.042,
    angleLeftRad: 0.62,
    angleRightRad: 0.14,
    halfLen: 0.48,
    endRise: 0.22,
    wobbleAmp: 0.008,
    wobbleFreq: 2.5,
    kFloor: 0.006,
    kRim: 0.004,
    seed: seed + 131,
  })

  const footNotch = makeFiniteNotch({
    origin: { x: -0.28, y: 0.08, z: 0.59 },
    across: { x: 0.94, y: 0.10, z: 0.32 },
    upOut: { x: 0.12, y: -0.24, z: 0.96 },
    throatHalf: 0.055,
    angleLeftRad: 0.78,
    angleRightRad: 0.58,
    halfLen: 0.24,
    endRise: 0.18,
    wobbleAmp: 0.006,
    wobbleFreq: 3.0,
    kFloor: 0.006,
    kRim: 0.005,
    seed: seed + 181,
  })

  const cornerChips: { plane: WarpedPlane; zone: RockV2ChipZone }[] = [
    {
      plane: makeWarpedPlane({ x: 0.56, y: 0.64, z: 0.52 }, 1.40, { freq: 2.0, amp: 0.007, bow: 0.0, k: 0.004, seed: seed + 211 }),
      zone: { center: { x: 0.56, y: 1.24, z: 0.30 }, radius: 0.28, strength: 0.95 },
    },
    {
      plane: makeWarpedPlane({ x: -0.68, y: 0.50, z: 0.54 }, 0.98, { freq: 2.0, amp: 0.007, bow: 0.0, k: 0.004, seed: seed + 227 }),
      zone: { center: { x: -0.74, y: 0.64, z: 0.42 }, radius: 0.26, strength: 0.95 },
    },
    {
      plane: makeWarpedPlane({ x: 0.72, y: -0.10, z: 0.68 }, 0.88, { freq: 2.0, amp: 0.007, bow: 0.0, k: 0.004, seed: seed + 241 }),
      zone: { center: { x: 0.68, y: 0.34, z: 0.48 }, radius: 0.24, strength: 0.85 },
    },
  ]

  const evalMacro = (x: number, y: number, z: number): number => {
    let d = evalPlanarPolyhedron(x, y, z, parentPlanes)

    // Primary bold oblique shoulder cleavage cut
    const cutFloor = evalWarpedPlane(x, y, z, cutBenchFloor)
    const cutRiser = evalWarpedPlane(x, y, z, cutShoulderRiser)
    const shoulderVoid = smoothMax(cutFloor, cutRiser, 0.008)
    d = smoothMax(d, -shoulderVoid, 0.005)

    // Outward-opening upper-right cliff relief (creates proud lower-right buttress!)
    const urF = evalWarpedPlane(x, y, z, upperRightFloor)
    const urW = evalWarpedPlane(x, y, z, upperRightInnerWall)
    const upperRightVoid = smoothMax(urF, urW, 0.008)
    d = smoothMax(d, -upperRightVoid, 0.005)

    // Concentrated shoulder fracture + base foot break + localized outer corner chips
    d = smoothMax(d, -evalFiniteNotch(x, y, z, shoulderFracture), 0.004)
    d = smoothMax(d, -evalFiniteNotch(x, y, z, footNotch), 0.005)
    for (let i = 0; i < cornerChips.length; i++) {
      d = smoothMax(d, evalWarpedPlane(x, y, z, cornerChips[i].plane, d), cornerChips[i].plane.k)
    }
    d = smoothMax(d, -y, 0.005)
    return d
  }

  // 5. Gate 2 Structural Fine Cracks: 1 primary crack starting at the shoulder elbow and tapering across the broad front face + 1 short branch
  const primaryCrack = buildProjectedCrackPath(
    'shoulder-primary-fracture',
    [
      { x: -0.22, y: benchY + 0.04, z: 0.44 },
      { x: -0.02, y: benchY - 0.03, z: 0.52 },
      { x: 0.18, y: benchY - 0.11, z: 0.54 },
      { x: 0.38, y: benchY - 0.22, z: 0.50 },
      { x: 0.50, y: benchY - 0.30, z: 0.44 },
    ],
    [0.028, 0.025, 0.020, 0.014, 0.004],
    [0.019 * crackMul, 0.017 * crackMul, 0.013 * crackMul, 0.008 * crackMul, 0.000],
    { x: -0.06, y: 0.20, z: 0.98 },
    0.35,
    1.0,
    evalMacro,
  )

  const branchCrack = buildProjectedCrackPath(
    'crown-short-branch',
    [
      { x: 0.16, y: benchY - 0.10, z: 0.54 },
      { x: 0.20, y: benchY + 0.12, z: 0.50 },
      { x: 0.14, y: benchY + 0.30, z: 0.46 },
    ],
    [0.019, 0.015, 0.004],
    [0.013 * crackMul, 0.009 * crackMul, 0.000],
    { x: -0.06, y: 0.20, z: 0.98 },
    0.35,
    -1.0,
    evalMacro,
  )

  const cracks = crackMul > 0.01 ? [primaryCrack, branchCrack] : []
  const chips: RockV2ChipZone[] = cornerChips.map(c => c.zone)

  const evalCrackAt = (x: number, y: number, z: number, nx: number, ny: number, nz: number) =>
    evalCrackPaths(x, y, z, nx, ny, nz, cracks)

  const evalDetail = (x: number, y: number, z: number): number => {
    const base = evalMacro(x, y, z)
    if (Math.abs(base) > 0.14) return base
    const g = evalFieldGradient(evalMacro, x, y, z, 0.01)
    const cr = evalCrackAt(x, y, z, g.x, g.y, g.z)
    const micro = fbm3(x * 4.5 + 2.1, y * 4.5 - 1.3, z * 4.5 + 3.7, seed + 409, 2) * 0.0018
    return base + cr.depth + micro
  }

  const evalChipMask = (x: number, y: number, z: number): number => {
    let m = 0
    for (let i = 0; i < chips.length; i++) {
      const c = chips[i]
      const d = Math.hypot(x - c.center.x, y - c.center.y, z - c.center.z)
      if (d < c.radius) {
        m = Math.max(m, smoothstep(c.radius, c.radius * 0.35, d) * c.strength)
      }
    }
    return m
  }

  const evalSurfaceColorInfo = (x: number, y: number, z: number, _nx: number, ny: number, _nz: number) => {
    const heightNorm = clamp(y / 1.46, 0, 1)
    const strata = fbm3(x * 0.85, y * 2.1 + x * 0.45, z * 0.85, seed + 601, 2)
    const brushTone = fbm3((x * 0.7 + y * 0.4) * 2.6, (y * 0.8 - x * 0.35) * 1.15, z * 2.2, seed + 677, 2)
    const footSediment = smoothstep(0.28, 0.02, heightNorm) * smoothstep(0.35, -0.1, ny)
    const chipFreshness = evalChipMask(x, y, z)
    return { heightNorm, strata, brushTone, footSediment, chipFreshness }
  }

  return {
    id: 'block-bluff',
    name: '阶梯方巨岩 (方案B单母体)',
    boundsMin: { x: -1.16, y: -0.06, z: -0.92 },
    boundsMax: { x: 1.14, y: 1.62, z: 0.88 },
    evalMacro,
    evalDetail,
    evalCrackAt,
    evalChipMask,
    evalSurfaceColorInfo,
    cracks,
    chips,
  }
}

// ---------------------------------------------------------------------------
// Archetype 2: Twin Overlapping Slab with Slanted Asymmetric V-Cleft
// (双叠断层岩 — Gate 1 Clay Geometry Challenge, Reference Row 1 Col 2)
// ---------------------------------------------------------------------------
function createTwinSlabField(seed = 7218): RockV2Field {
  // 1. Staggered front-left hero slab + recessed rear-right shoulder slab fused into ONE solid base mass:
  //    Staggering Z depths (+0.14 vs -0.18) creates natural overlapping twin slabs like Row 1 Col 2
  //    instead of a parallel-sided CNC slot!
  const lobeLeftFront = makeLobe({
    cx: -0.22, cy: 0.58, cz: 0.12,
    rx: 0.82, ry: 0.68, rz: 0.56,
    round: 0.07,
    taperX: 0.32, taperZ: 0.22,
    leanX: 0.22, leanZ: -0.06,
    rotY: 0.12, rotZ: -0.06,
  })
  const lobeRightRear = makeLobe({
    cx: 0.44, cy: 0.46, cz: -0.18,
    rx: 0.66, ry: 0.54, rz: 0.56,
    round: 0.07,
    taperX: 0.24, taperZ: 0.20,
    leanX: -0.10, leanZ: 0.04,
    rotY: -0.18, rotZ: 0.06,
  })

  // 2. Controlled broad chiseled hero planes:
  //    Wide unbroken sunlit front-left main slope (Row 1 Col 2 signature!) + crisp back/side facets
  const planes: WarpedPlane[] = [
    // Wide, sweeping, unbroken front-left main slope!
    makeWarpedPlane({ x: -0.32, y: 0.44, z: 0.84 }, 0.72, { freq: 0.95, amp: 0.014, bow: 0.0, k: 0.010, seed: seed + 13 }),
    // Lower front base heel facet (sturdy grounded thickness)
    makeWarpedPlane({ x: -0.14, y: -0.14, z: 0.98 }, 0.66, { freq: 1.10, amp: 0.014, bow: 0.0, k: 0.012, seed: seed + 29 }),
    // Right steep drop cliff on the recessed right shoulder
    makeWarpedPlane({ x: 0.88, y: 0.20, z: 0.42 }, 0.94, { freq: 1.15, amp: 0.014, bow: 0.0, k: 0.010, seed: seed + 41 }),
    // Upper-left sloped ridge plane
    makeWarpedPlane({ x: -0.68, y: 0.72, z: 0.14 }, 0.88, { freq: 1.05, amp: 0.015, bow: 0.0, k: 0.011, seed: seed + 53 }),
    // Top-right crown slant on the recessed right shoulder (distinctly lower than main peak)
    makeWarpedPlane({ x: 0.34, y: 0.92, z: 0.18 }, 0.90, { freq: 1.15, amp: 0.014, bow: 0.0, k: 0.011, seed: seed + 67 }),
    // Sculptural rear-left & rear-right slopes (clean 360° silhouette)
    makeWarpedPlane({ x: -0.58, y: 0.34, z: -0.74 }, 0.76, { freq: 1.05, amp: 0.016, bow: 0.0, k: 0.012, seed: seed + 79 }),
    makeWarpedPlane({ x: 0.48, y: 0.32, z: -0.82 }, 0.86, { freq: 1.10, amp: 0.016, bow: 0.0, k: 0.012, seed: seed + 97 }),
    // Chiseled base heel facets around perimeter
    makeWarpedPlane({ x: -0.68, y: -0.64, z: 0.36 }, 0.64, { freq: 1.25, amp: 0.015, bow: 0.0, k: 0.014, seed: seed + 107 }),
    makeWarpedPlane({ x: 0.68, y: -0.66, z: -0.32 }, 0.64, { freq: 1.25, amp: 0.015, bow: 0.0, k: 0.014, seed: seed + 113 }),
  ]

  // 3. Diagonal asymmetric V-cleft separating the forward-left main slab from the recessed rear-right shoulder:
  //    Sharp V apex (throatHalf = 0.022, asymmetric wall angles 0.22 & 0.56 rad -> wide open V without U-slot bottom!)
  //    Oriented obliquely in XZ so front & 45° views show dramatic overlapping twin-slab depth!
  const vCleft = makeFiniteNotch({
    origin: { x: 0.22, y: 0.46, z: 0.02 },
    across: { x: 0.80, y: -0.36, z: -0.48 }, // oblique fault normal between front-left & rear-right slabs!
    upOut: { x: 0.32, y: 0.90, z: 0.29 },    // opens upward-front-right across the skyline notch
    throatHalf: 0.022,
    angleLeftRad: 0.22,  // steep overhanging shadow back-wall of the broad sunlit front-left slab
    angleRightRad: 0.56, // broader angled slope rising up the recessed rear-right shoulder
    halfLen: 1.25,
    endRise: 0.06,
    wobbleAmp: 0.012,
    wobbleFreq: 1.75,
    kFloor: 0.016,
    kRim: 0.010,
    seed: seed + 149,
  })

  // 4. Only 2 restrained flat corner bevel chips on outer edges (broad main slope stays 100% intact!)
  const cornerChips: { plane: WarpedPlane; zone: RockV2ChipZone }[] = [
    {
      plane: makeWarpedPlane({ x: -0.78, y: 0.44, z: 0.44 }, 0.90, { freq: 2.0, amp: 0.008, bow: 0.0, k: 0.007, seed: seed + 223 }),
      zone: { center: { x: -0.68, y: 0.54, z: 0.34 }, radius: 0.22, strength: 1.0 },
    },
    {
      plane: makeWarpedPlane({ x: 0.68, y: 0.62, z: 0.39 }, 0.96, { freq: 2.0, amp: 0.008, bow: 0.0, k: 0.007, seed: seed + 239 }),
      zone: { center: { x: 0.70, y: 0.64, z: 0.12 }, radius: 0.20, strength: 1.0 },
    },
  ]

  const evalMacro = (x: number, y: number, z: number): number => {
    let d = smoothMin(evalLobe(x, y, z, lobeLeftFront), evalLobe(x, y, z, lobeRightRear), 0.16)
    for (let i = 0; i < planes.length; i++) {
      d = smoothMax(d, evalWarpedPlane(x, y, z, planes[i], d), planes[i].k)
    }
    d = smoothMax(d, -evalFiniteNotch(x, y, z, vCleft), vCleft.kRim)
    for (let i = 0; i < cornerChips.length; i++) {
      d = smoothMax(d, evalWarpedPlane(x, y, z, cornerChips[i].plane, d), cornerChips[i].plane.k)
    }
    const bot = evalOrganicBottom(x, y, z, 0.03, 0.48, seed + 331)
    d = smoothMax(d, bot, 0.016)
    return d
  }

  const primaryCrack = buildProjectedCrackPath(
    'main-slope-cleavage',
    [
      { x: -0.20, y: 0.96, z: 0.20 },
      { x: -0.28, y: 0.72, z: 0.44 },
      { x: -0.40, y: 0.48, z: 0.58 },
      { x: -0.46, y: 0.32, z: 0.63 },
    ],
    [0.020, 0.018, 0.012, 0.002],
    [0.014, 0.013, 0.008, 0.000],
    { x: -0.32, y: 0.44, z: 0.84 },
    0.45,
    1.0,
    evalMacro,
  )

  const cracks = [primaryCrack]
  const chips: RockV2ChipZone[] = cornerChips.map(c => c.zone)

  const evalCrackAt = (x: number, y: number, z: number, nx: number, ny: number, nz: number) =>
    evalCrackPaths(x, y, z, nx, ny, nz, cracks)

  const evalDetail = (x: number, y: number, z: number): number => {
    const base = evalMacro(x, y, z)
    if (Math.abs(base) > 0.16) return base
    const g = evalFieldGradient(evalMacro, x, y, z, 0.01)
    const cr = evalCrackAt(x, y, z, g.x, g.y, g.z)
    const micro = fbm3(x * 4.5 + 1.3, y * 4.5 + 2.7, z * 4.5 - 1.9, seed + 419, 2) * 0.0018
    return base + cr.depth + micro
  }

  const evalChipMask = (x: number, y: number, z: number): number => {
    let m = 0
    for (let i = 0; i < chips.length; i++) {
      const c = chips[i]
      const d = Math.hypot(x - c.center.x, y - c.center.y, z - c.center.z)
      if (d < c.radius) {
        m = Math.max(m, smoothstep(c.radius, c.radius * 0.35, d) * c.strength)
      }
    }
    return m
  }

  const evalSurfaceColorInfo = (x: number, y: number, z: number, _nx: number, ny: number, _nz: number) => {
    const heightNorm = clamp(y / 1.18, 0, 1)
    const strata = fbm3(x * 0.9, y * 2.2 - x * 0.5, z * 0.9, seed + 613, 2)
    const brushTone = fbm3((x * 0.65 + y * 0.5) * 2.4, (y * 0.75 - x * 0.45) * 1.1, z * 2.1, seed + 691, 2)
    const footSediment = smoothstep(0.32, 0.02, heightNorm) * smoothstep(0.35, -0.1, ny)
    const chipFreshness = evalChipMask(x, y, z)
    return { heightNorm, strata, brushTone, footSediment, chipFreshness }
  }

  return {
    id: 'twin-slab',
    name: '双叠断层岩 (SDF Proto)',
    boundsMin: { x: -1.16, y: -0.08, z: -0.96 },
    boundsMax: { x: 1.18, y: 1.34, z: 0.94 },
    evalMacro,
    evalDetail,
    evalCrackAt,
    evalChipMask,
    evalSurfaceColorInfo,
    cracks,
    chips,
  }
}

/**
 * Evaluates a convex-ish polyhedral rock wedge defined solely by controlled oblique cleavage planes
 * (`smoothMax` per-plane so sharp cliff ridges & softer weathered slopes coexist without global fillet bloat).
 */
function evalPlanarPolyhedron(x: number, y: number, z: number, planes: WarpedPlane[]): number {
  let d = -1e9
  for (let i = 0; i < planes.length; i++) {
    const pl = planes[i]
    const pv = evalWarpedPlane(x, y, z, pl, d)
    d = i === 0 ? pv : smoothMax(d, pv, pl.k)
  }
  return d
}

// ---------------------------------------------------------------------------
// Archetype 3A: Low-Slung Horizontal Sandstone — Method A (Multi-Wedge Union -> Carve Shoulder)
// Shares exact V3 proportions with Method B (chunky left nose, 14° cross-rolled sunlit lower ramp,
// bold ~45% shoulder rise, oblique rising summit ridge, steep mid-shadow front cheek, deep-shadow right cliff).
// ---------------------------------------------------------------------------
function createSandstoneLedgeAField(params: RockV2SculptParams = {}): RockV2Field {
  const seed = Math.round(params.seed ?? 5104)
  const crisp = clamp(params.ridgeCrispness ?? 0.90, 0, 1)
  const kHard = lerp(0.011, 0.0035, crisp)
  const kMed = lerp(0.016, 0.007, crisp)
  const kSoft = lerp(0.024, 0.012, crisp)

  // Wedge 1: Eccentric high right-rear shoulder block (y rises obliquely from ~0.92 to 1.08 apex!)
  const highPlanes: WarpedPlane[] = [
    makeWarpedPlane({ x: 0, y: -1, z: 0 }, 0.0, { freq: 1.0, amp: 0.003, k: kHard, seed: seed + 1 }),
    // Oblique rising summit crown (~16° left->right rise + slight rear roll -> NEVER flat horizontal!)
    makeWarpedPlane({ x: -0.27, y: 0.94, z: 0.20 }, 0.87, { freq: 1.15, amp: 0.009, k: kSoft, seed: seed + 11 }),
    // Right-rear summit bevel forming eccentric apex at x~+0.64, z~-0.06
    makeWarpedPlane({ x: 0.46, y: 0.85, z: -0.24 }, 1.24, { freq: 1.2, amp: 0.009, k: kMed, seed: seed + 17 }),
    // Long crisp steep right main shadow cliff
    makeWarpedPlane({ x: 0.94, y: 0.28, z: 0.19 }, 1.00, { freq: 1.15, amp: 0.010, k: kHard, seed: seed + 23 }),
    // Faceted front-right diagonal cliff break (sharp 3-plane corner on right!)
    makeWarpedPlane({ x: 0.72, y: 0.22, z: 0.66 }, 0.92, { freq: 1.2, amp: 0.009, k: kHard, seed: seed + 25 }),
    // Bold diagonal shoulder riser drop (~60° cleavage cliff facing upper-front-left)
    makeWarpedPlane({ x: -0.82, y: 0.47, z: 0.33 }, 0.34, { freq: 1.25, amp: 0.009, k: kHard, seed: seed + 29 }),
    // Steep shaded front cheek (76° -> crisp mid-shadow plane break!)
    makeWarpedPlane({ x: 0.14, y: 0.19, z: 0.97 }, 0.56, { freq: 1.15, amp: 0.009, k: kHard, seed: seed + 31 }),
    // Solid fractured rear spine
    makeWarpedPlane({ x: 0.16, y: 0.26, z: -0.95 }, 0.66, { freq: 1.15, amp: 0.010, k: kMed, seed: seed + 37 }),
    // Rear-right corner cliff
    makeWarpedPlane({ x: 0.76, y: 0.25, z: -0.60 }, 0.94, { freq: 1.2, amp: 0.009, k: kHard, seed: seed + 41 }),
    // Rear-left side taper
    makeWarpedPlane({ x: -0.58, y: 0.22, z: -0.78 }, 0.58, { freq: 1.2, amp: 0.009, k: kMed, seed: seed + 43 }),
  ]

  // Wedge 2: Stretched lower-left main ramp block (chunky nose y~0.30 -> broad sunlit cross-rolled ramp to y~0.50!)
  const lowPlanes: WarpedPlane[] = [
    makeWarpedPlane({ x: 0, y: -1, z: 0 }, 0.0, { freq: 1.0, amp: 0.003, k: kHard, seed: seed + 51 }),
    // Wide sunlit cross-rolled lower ramp: rises 14° left->right AND rolls 10° toward front-left (non-extruded!)
    makeWarpedPlane({ x: -0.23, y: 0.96, z: 0.17 }, 0.495, { freq: 1.05, amp: 0.008, k: kSoft, seed: seed + 53 }),
    // Bold steep lower-front cheek (78° -> crisp 60° ridge against sunlit ramp top!)
    makeWarpedPlane({ x: 0.11, y: 0.18, z: 0.98 }, 0.565, { freq: 1.15, amp: 0.009, k: kHard, seed: seed + 61 }),
    // Chunky grounded left nose wall (height ~0.30m -> NO thin doorstop!)
    makeWarpedPlane({ x: -0.91, y: 0.34, z: 0.24 }, 1.20, { freq: 1.2, amp: 0.009, k: kHard, seed: seed + 71 }),
    // Crisp angled front-left nose facet
    makeWarpedPlane({ x: -0.66, y: 0.64, z: 0.39 }, 1.02, { freq: 1.2, amp: 0.008, k: kHard, seed: seed + 72 }),
    // Converging rear-left spine (organic depth taper toward left toe)
    makeWarpedPlane({ x: -0.38, y: 0.24, z: -0.89 }, 0.72, { freq: 1.15, amp: 0.010, k: kMed, seed: seed + 73 }),
    // Right termination buried inside high wedge
    makeWarpedPlane({ x: 0.88, y: 0.16, z: 0.44 }, 0.44, { freq: 1.1, amp: 0.008, k: kMed, seed: seed + 79 }),
  ]

  // Wedge 3: Outward lower-right stepped cliff buttress
  const spurPlanes: WarpedPlane[] = [
    makeWarpedPlane({ x: 0, y: -1, z: 0 }, 0.0, { freq: 1.0, amp: 0.003, k: kHard, seed: seed + 83 }),
    makeWarpedPlane({ x: 0.38, y: 0.84, z: 0.39 }, 0.78, { freq: 1.2, amp: 0.008, k: kHard, seed: seed + 89 }),
    makeWarpedPlane({ x: 0.93, y: 0.22, z: 0.29 }, 1.10, { freq: 1.2, amp: 0.009, k: kHard, seed: seed + 97 }),
    makeWarpedPlane({ x: 0.20, y: 0.18, z: 0.96 }, 0.59, { freq: 1.2, amp: 0.009, k: kHard, seed: seed + 101 }),
    makeWarpedPlane({ x: -0.82, y: 0.12, z: -0.56 }, -0.22, { freq: 1.1, amp: 0.008, k: kMed, seed: seed + 103 }),
    makeWarpedPlane({ x: 0.15, y: 0.22, z: -0.96 }, 0.46, { freq: 1.1, amp: 0.008, k: kMed, seed: seed + 107 }),
  ]

  // Concentrated primary diagonal fracture slicing boldly across the shoulder elbow & front ridge, tapering to 0 before back!
  const shoulderFracture = makeFiniteNotch({
    origin: { x: -0.02, y: 0.49, z: 0.28 },
    across: { x: 0.78, y: -0.22, z: -0.58 },
    upOut: { x: -0.26, y: 0.88, z: 0.39 },
    throatHalf: 0.048,
    angleLeftRad: 0.58,
    angleRightRad: 0.14,
    halfLen: 0.52,
    endRise: 0.24,
    wobbleAmp: 0.008,
    wobbleFreq: 2.5,
    kFloor: 0.006,
    kRim: 0.004,
    seed: seed + 131,
  })

  // Localized angular front-mid foot notch
  const footNotchFront = makeFiniteNotch({
    origin: { x: -0.34, y: 0.08, z: 0.54 },
    across: { x: 0.94, y: 0.10, z: 0.32 },
    upOut: { x: 0.16, y: -0.24, z: 0.96 },
    throatHalf: 0.055,
    angleLeftRad: 0.78,
    angleRightRad: 0.55,
    halfLen: 0.24,
    endRise: 0.18,
    wobbleAmp: 0.005,
    wobbleFreq: 3.0,
    kFloor: 0.006,
    kRim: 0.005,
    seed: seed + 149,
  })

  const undercutFront = makeWarpedPlane({ x: -0.06, y: -0.56, z: 0.83 }, 0.445, { freq: 1.3, amp: 0.007, k: kMed, seed: seed + 163 })
  const undercutRear = makeWarpedPlane({ x: -0.14, y: -0.56, z: -0.82 }, 0.49, { freq: 1.3, amp: 0.008, k: kMed, seed: seed + 167 })

  const evalMacro = (x: number, y: number, z: number): number => {
    const dHigh = evalPlanarPolyhedron(x, y, z, highPlanes)
    const dLow = evalPlanarPolyhedron(x, y, z, lowPlanes)
    const dSpur = evalPlanarPolyhedron(x, y, z, spurPlanes)
    let d = smoothMin(dHigh, dLow, 0.062)
    d = smoothMin(d, dSpur, 0.045)
    d = smoothMax(d, evalWarpedPlane(x, y, z, undercutFront, d), kMed)
    d = smoothMax(d, evalWarpedPlane(x, y, z, undercutRear, d), kMed)
    d = smoothMax(d, -evalFiniteNotch(x, y, z, shoulderFracture), 0.005)
    d = smoothMax(d, -evalFiniteNotch(x, y, z, footNotchFront), 0.006)
    d = smoothMax(d, -y, 0.005)
    return d
  }

  const evalSurfaceColorInfo = (x: number, y: number, z: number, _nx: number, ny: number, _nz: number) => ({
    heightNorm: clamp(y / 1.08, 0, 1),
    strata: fbm3(x * 0.8, y * 2.1 - x * 0.45, z * 0.8, seed + 401, 2),
    brushTone: fbm3(x * 1.4, y * 1.6, z * 1.4, seed + 409, 2),
    footSediment: smoothstep(0.24, 0.02, clamp(y / 1.08, 0, 1)) * smoothstep(0.4, -0.1, ny),
    chipFreshness: 0,
  })

  return {
    id: 'sandstone-ledge-a',
    name: '低矮横展砂岩 · 方案 A (融合后雕)',
    boundsMin: { x: -1.38, y: -0.06, z: -0.86 },
    boundsMax: { x: 1.24, y: 1.20, z: 0.78 },
    evalMacro,
    evalDetail: evalMacro,
    evalCrackAt: () => ({ mask: 0, depth: 0, lipSlope: 0 }),
    evalChipMask: () => 0,
    evalSurfaceColorInfo,
    cracks: [],
    chips: [],
  }
}

// ---------------------------------------------------------------------------
// Archetype 3B: Low-Slung Horizontal Sandstone — Method B (Single Eccentric Oblique Monolith -> Subtractive Cuts)
// ZERO smoothMin lobes; 100% single fractured monolith:
// - Bold ~45% shoulder drop in silhouette & front-oblique view (y~0.49 ramp -> y~1.08 oblique summit peak!)
// - Razor-crisp 3-value plane break: sunlit cross-rolled ramp / shaded 78° front cheek / deep-shadow right cliff
// - Clean outward-stepped lower-right buttress (no recessed pocket!)
// - Concentrated diagonal fracture slicing across the shoulder elbow & front ridge, tapering cleanly to 0
// - Monolithic unbroken back spine verified from 145° rear-opposite counter-evidence view!
// ---------------------------------------------------------------------------
function createSandstoneLedgeBField(params: RockV2SculptParams = {}): RockV2Field {
  const seed = Math.round(params.seed ?? 5104)
  const carveDepth = clamp(params.carveDepth ?? 1.0, 0.5, 1.5)
  const crisp = clamp(params.ridgeCrispness ?? 0.90, 0, 1)
  const kHard = lerp(0.011, 0.0035, crisp)
  const kMed = lerp(0.016, 0.007, crisp)
  const kSoft = lerp(0.024, 0.012, crisp)
  // Subtle deterministic seed variation (preserves monolithic silhouette while letting 🎲 generate fresh sandstone boulders!)
  const jX = (hash3(seed, 17, 5, 73) - 0.5) * 0.14
  const jY = (hash3(seed, 31, 9, 73) - 0.5) * 0.08
  const jDip = (hash3(seed, 53, 13, 73) - 0.5) * 0.06

  // 1. SINGLE unified eccentric oblique parent monolith (ZERO smoothMin!)
  const parentPlanes: WarpedPlane[] = [
    makeWarpedPlane({ x: 0, y: -1, z: 0 }, 0.0, { freq: 1.0, amp: 0.003, k: kHard, seed: seed + 1 }),
    // Oblique rising summit crown (~16° left->right rise + slight roll -> NEVER flat horizontal!)
    makeWarpedPlane({ x: -0.27 + jDip * 0.5, y: 0.94, z: 0.20 }, 0.87 + jY * 0.5, { freq: 1.15, amp: 0.009, k: kSoft, seed: seed + 11 }),
    // Rear-right summit bevel forming eccentric apex at x~+0.64, z~-0.06
    makeWarpedPlane({ x: 0.46, y: 0.85, z: -0.24 }, 1.24 + jX * 0.35 + jY * 0.4, { freq: 1.2, amp: 0.009, k: kMed, seed: seed + 17 }),
    // Steep outer right cliff base (extends to x~+1.10 so upper-right outward cut reveals a crisp lower-right buttress!)
    makeWarpedPlane({ x: 0.93, y: 0.22, z: 0.29 }, 1.09 + jX * 0.35, { freq: 1.15, amp: 0.009, k: kHard, seed: seed + 23 }),
    // Faceted front-right diagonal cliff break (sharp shadow corner on right!)
    makeWarpedPlane({ x: 0.70, y: 0.22, z: 0.68 }, 0.92 + jX * 0.2, { freq: 1.2, amp: 0.009, k: kHard, seed: seed + 25 }),
    // Bold DIAGONALLY-angled front-right flank (higher y-tilt -> diagonal geological ridge, ZERO vertical seam!)
    makeWarpedPlane({ x: 0.34, y: 0.34, z: 0.88 }, 0.68, { freq: 1.15, amp: 0.009, k: kHard, seed: seed + 29 }),
    // Bold steep front-left cheek (80° -> strong 3-value shadow separation from sunlit upper ramp!)
    makeWarpedPlane({ x: -0.06, y: 0.15, z: 0.99 }, 0.545, { freq: 1.15, amp: 0.009, k: kHard, seed: seed + 31 }),
    // Chunky grounded left nose wall (height ~0.30m -> NO thin doorstop!)
    makeWarpedPlane({ x: -0.91, y: 0.34, z: 0.24 }, 1.20 - jX * 0.35, { freq: 1.2, amp: 0.009, k: kHard, seed: seed + 37 }),
    // Crisp angled upper-left nose facet
    makeWarpedPlane({ x: -0.66, y: 0.64, z: 0.39 }, 1.02 - jX * 0.2, { freq: 1.2, amp: 0.008, k: kHard, seed: seed + 39 }),
    // Converging rear-left spine (tapers depth cleanly toward left nose)
    makeWarpedPlane({ x: -0.38, y: 0.24, z: -0.89 }, 0.72, { freq: 1.15, amp: 0.010, k: kMed, seed: seed + 41 }),
    // Solid unbroken rear-right spine (guarantees monolithic thickness in 145° counter-evidence view!)
    makeWarpedPlane({ x: 0.16, y: 0.26, z: -0.95 }, 0.66, { freq: 1.15, amp: 0.010, k: kMed, seed: seed + 43 }),
    // Rear-right corner cliff
    makeWarpedPlane({ x: 0.76, y: 0.25, z: -0.60 }, 0.94 + jX * 0.25, { freq: 1.2, amp: 0.009, k: kHard, seed: seed + 47 }),
    // Localized angular base undercuts (leave 3 clear faceted grounded rock feet!)
    makeWarpedPlane({ x: -0.06, y: -0.56, z: 0.83 }, 0.445, { freq: 1.3, amp: 0.007, k: kMed, seed: seed + 53 }),
    makeWarpedPlane({ x: -0.14, y: -0.56, z: -0.82 }, 0.49, { freq: 1.3, amp: 0.008, k: kMed, seed: seed + 59 }),
    makeWarpedPlane({ x: 0.84, y: -0.48, z: -0.24 }, 0.88 + jX * 0.2, { freq: 1.3, amp: 0.008, k: kMed, seed: seed + 61 }),
  ]

  // 2. PRIMARY SUBTRACTIVE SHOULDER CLEAVAGE CUT:
  //    Drops left ~55% of the parent monolith cleanly down to y~0.495 (bold ~48% shoulder drop below 1.08 summit!),
  //    exposing a WIDE sunlit cross-rolled main ramp (`14°` left->right rise + `10°` front-left roll)!
  const rampLift = (1.0 - carveDepth) * 0.14 + jY * 0.3
  const cutRampFloor = makeWarpedPlane({ x: 0.23 - jDip * 0.4, y: -0.96, z: -0.17 }, -(0.495 + rampLift), {
    freq: 1.05, amp: 0.008, k: kHard, seed: seed + 101,
  })
  // Diagonal conjugate shoulder riser (~60° cleavage wall angling diagonally front-right -> back-left!)
  const cutShoulderRiser = makeWarpedPlane({ x: 0.82, y: -0.47, z: -0.33 }, -(0.34 + jX * 0.55), {
    freq: 1.25, amp: 0.009, k: kHard, seed: seed + 107,
  })

  // 3. CLEAN OUTWARD-OPENING UPPER-RIGHT CLIFF RELIEF (carves upper-right cliff inward from open air,
  //    leaving a proud chiseled lower-right rock buttress — ZERO recessed pocket!)
  const upperRightFloor = makeWarpedPlane({ x: -0.38, y: -0.84, z: -0.39 }, -0.78, {
    freq: 1.2, amp: 0.008, k: kHard, seed: seed + 149,
  })
  const upperRightInnerWall = makeWarpedPlane({ x: -0.94, y: -0.28, z: -0.19 }, -0.99, {
    freq: 1.15, amp: 0.009, k: kHard, seed: seed + 151,
  })

  // 4. CONCENTRATED DIAGONAL PRIMARY FRACTURE CLEFT AT SHOULDER ELBOW:
  //    Slices boldly & diagonally across the shoulder elbow AND cuts a visible notch across the front ridge,
  //    staying crisp at both N=64 and N=30 while tapering cleanly to zero before the back spine!
  const shoulderFracture = makeFiniteNotch({
    origin: { x: -0.02, y: 0.49 + rampLift, z: 0.28 },
    across: { x: 0.78, y: -0.22, z: -0.58 },
    upOut: { x: -0.26, y: 0.88, z: 0.39 },
    throatHalf: 0.048,
    angleLeftRad: 0.58,
    angleRightRad: 0.14,
    halfLen: 0.52,
    endRise: 0.24,
    wobbleAmp: 0.008,
    wobbleFreq: 2.5,
    kFloor: 0.006,
    kRim: 0.004,
    seed: seed + 131,
  })

  // Localized diagonal corner-break chip on the high shoulder's upper-front-left crown ridge
  const crownShoulderChip = makeFiniteNotch({
    origin: { x: 0.16, y: 0.89, z: 0.12 },
    across: { x: 0.72, y: -0.35, z: -0.60 },
    upOut: { x: -0.58, y: 0.72, z: 0.38 },
    throatHalf: 0.030,
    angleLeftRad: 0.60,
    angleRightRad: 0.28,
    halfLen: 0.30,
    endRise: 0.20,
    wobbleAmp: 0.006,
    wobbleFreq: 3.0,
    kFloor: 0.006,
    kRim: 0.004,
    seed: seed + 141,
  })

  // 5. TWO LOCALIZED CORNER / FOOT CHIPS (break ground-line & left-nose symmetry cleanly!)
  const footNotchFront = makeFiniteNotch({
    origin: { x: -0.34, y: 0.08, z: 0.54 },
    across: { x: 0.94, y: 0.10, z: 0.32 },
    upOut: { x: 0.16, y: -0.24, z: 0.96 },
    throatHalf: 0.055,
    angleLeftRad: 0.78,
    angleRightRad: 0.55,
    halfLen: 0.24,
    endRise: 0.18,
    wobbleAmp: 0.005,
    wobbleFreq: 3.0,
    kFloor: 0.006,
    kRim: 0.005,
    seed: seed + 163,
  })

  // Crisp left-nose diagonal split facet (gives subtle angular broken-stone character at left end)
  const toeSplitChip = makeFiniteNotch({
    origin: { x: -1.04, y: 0.26, z: 0.22 },
    across: { x: 0.44, y: -0.16, z: -0.88 },
    upOut: { x: -0.58, y: 0.66, z: 0.47 },
    throatHalf: 0.022,
    angleLeftRad: 0.48,
    angleRightRad: 0.35,
    halfLen: 0.30,
    endRise: 0.16,
    wobbleAmp: 0.005,
    wobbleFreq: 3.0,
    kFloor: 0.006,
    kRim: 0.004,
    seed: seed + 173,
  })

  const evalMacro = (x: number, y: number, z: number): number => {
    let d = evalPlanarPolyhedron(x, y, z, parentPlanes)

    // Primary bold shoulder cleavage cut (wide sunlit cross-rolled ramp + proud eccentric right shoulder)
    const cutFloor = evalWarpedPlane(x, y, z, cutRampFloor)
    const cutRiser = evalWarpedPlane(x, y, z, cutShoulderRiser)
    const shoulderVoid = smoothMax(cutFloor, cutRiser, 0.007)
    d = smoothMax(d, -shoulderVoid, 0.005)

    // Clean outward-opening upper-right cliff relief (creates proud lower-right cliff buttress!)
    const urF = evalWarpedPlane(x, y, z, upperRightFloor)
    const urW = evalWarpedPlane(x, y, z, upperRightInnerWall)
    const upperRightVoid = smoothMax(urF, urW, 0.007)
    d = smoothMax(d, -upperRightVoid, 0.005)

    // Concentrated diagonal shoulder fracture + localized crown/base/toe chips
    d = smoothMax(d, -evalFiniteNotch(x, y, z, shoulderFracture), 0.004)
    d = smoothMax(d, -evalFiniteNotch(x, y, z, crownShoulderChip), 0.005)
    d = smoothMax(d, -evalFiniteNotch(x, y, z, footNotchFront), 0.005)
    d = smoothMax(d, -evalFiniteNotch(x, y, z, toeSplitChip), 0.004)

    d = smoothMax(d, -y, 0.005)
    return d
  }

  // Analytical fine structural fracture extending from the primary shoulder notch diagonally across the front ramp & cheek
  const crackMul = clamp(params.crackStrength ?? 1.0, 0, 1.5)
  const cracks: CrackPath[] = [
    {
      name: 'shoulder-ramp-cleavage',
      faceNormal: vNorm({ x: -0.14, y: 0.78, z: 0.61 }),
      normalMinDot: 0.16,
      asymmetry: 1,
      segments: [
        { a: { x: 0.06, y: 0.56 + rampLift, z: 0.14 }, b: { x: -0.06, y: 0.49 + rampLift, z: 0.34 }, widthA: 0.036, widthB: 0.032, depthA: 0.028, depthB: 0.025 },
        { a: { x: -0.06, y: 0.49 + rampLift, z: 0.34 }, b: { x: 0.16, y: 0.42 + rampLift, z: 0.46 }, widthA: 0.032, widthB: 0.007, depthA: 0.025, depthB: 0.004 },
      ],
    },
    {
      name: 'shoulder-left-taper',
      faceNormal: vNorm({ x: -0.22, y: 0.94, z: 0.26 }),
      normalMinDot: 0.28,
      asymmetry: -1,
      segments: [
        { a: { x: -0.06, y: 0.49 + rampLift, z: 0.34 }, b: { x: -0.34, y: 0.42 + rampLift, z: 0.38 }, widthA: 0.026, widthB: 0.005, depthA: 0.020, depthB: 0.003 },
      ],
    },
  ]

  const chips: RockV2ChipZone[] = [
    { center: { x: 0.16, y: 0.89, z: 0.12 }, radius: 0.24, strength: 0.85 },
    { center: { x: 0.62, y: 1.04, z: -0.02 }, radius: 0.26, strength: 0.72 },
    { center: { x: -0.04, y: 0.50, z: 0.34 }, radius: 0.25, strength: 0.80 },
    { center: { x: -1.04, y: 0.28, z: 0.22 }, radius: 0.22, strength: 0.75 },
    { center: { x: 0.82, y: 0.46, z: 0.32 }, radius: 0.24, strength: 0.75 },
  ]

  const evalCrackAt = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    if (crackMul <= 0.001) return { mask: 0, depth: 0, lipSlope: 0 }
    const res = evalCrackPaths(x, y, z, nx, ny, nz, cracks)
    return { mask: clamp(res.mask * crackMul, 0, 1), depth: res.depth * crackMul, lipSlope: res.lipSlope * crackMul }
  }

  const evalDetail = (x: number, y: number, z: number): number => {
    const dMacro = evalMacro(x, y, z)
    if (Math.abs(dMacro) > 0.10) return dMacro
    const g = evalFieldGradient(evalMacro, x, y, z, 0.008)
    const crack = evalCrackAt(x, y, z, g.x, g.y, g.z)
    const micro = fbm3(x * 3.8 + 1.3, y * 3.8 - 2.1, z * 3.8 + 0.7, seed + 521, 2) * 0.0032
    return dMacro + crack.depth + micro
  }

  const evalChipMask = (x: number, y: number, z: number): number => {
    let m = 0
    for (let i = 0; i < chips.length; i++) {
      const c = chips[i]
      const dist = Math.hypot(x - c.center.x, y - c.center.y, z - c.center.z)
      if (dist < c.radius) m = Math.max(m, smoothstep(c.radius, c.radius * 0.35, dist) * c.strength)
    }
    return m
  }

  const evalSurfaceColorInfo = (x: number, y: number, z: number, _nx: number, ny: number, _nz: number) => ({
    heightNorm: clamp(y / 1.08, 0, 1),
    strata: fbm3(x * 0.85, y * 2.1 - x * 0.45, z * 0.85, seed + 401, 2),
    brushTone: fbm3((x * 0.85 + y * 0.35) * 2.1, (y * 0.90 - x * 0.30) * 1.15, z * 2.0, seed + 409, 2),
    footSediment: smoothstep(0.24, 0.02, clamp(y / 1.08, 0, 1)) * smoothstep(0.4, -0.1, ny),
    chipFreshness: evalChipMask(x, y, z),
  })

  return {
    id: 'sandstone-ledge-b',
    name: '低矮横展砂岩 · 方案 B (单偏心斜楔减切)',
    boundsMin: { x: -1.38, y: -0.06, z: -0.86 },
    boundsMax: { x: 1.24, y: 1.20, z: 0.78 },
    evalMacro,
    evalDetail,
    evalCrackAt,
    evalChipMask,
    evalSurfaceColorInfo,
    cracks,
    chips,
  }
}

export function createRockV2Field(
  id: RockV2ArchetypeId,
  seedOrParams?: number | RockV2SculptParams,
): RockV2Field {
  const params: RockV2SculptParams = typeof seedOrParams === 'number' ? { seed: seedOrParams } : (seedOrParams ?? {})
  if (id === 'twin-slab') return createTwinSlabField(params.seed ?? 7218)
  if (id === 'sandstone-ledge-a') return createSandstoneLedgeAField(params)
  if (id === 'sandstone-ledge-b') return createSandstoneLedgeBField(params)
  return createBlockBluffField(params)
}
