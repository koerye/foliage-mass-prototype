// Unified High-Detail Sculpted Bark Wrinkles, Integrated Root Buttresses, Directional Branch Collars,
// and Style-Gated Detached Hero Strands Engine (v2 Consensus Architecture).
//
// Core principles:
// 1. Strict 2*PI periodicity (integer harmonics + integer flow UV tiling + exact seam vertex closure).
// 2. Unified twist sign: anchored wide ribs, flanking furrows, Flow UV, CPU heightfield & optional hero strands
//    all follow the exact same spiral direction and phase.
// 3. Fixed priority-ordered TrunkFeaturePlan built once independent of LOD -> 0.0 deg anchor drift across LOD tiers.
// 4. Integrated continuous root buttresses directly in the trunk sweep (zero glued-on cone tentacles).
// 5. Real-time fixed-topology branch collars: directional trunk socket mounds + smooth multi-limb overlap blending
//    + rib-to-limb steering + asymmetric child collar skirt with projected normal blending.
// 6. Stylized Twist uses 0 detached strands; Ancient Driftwood optionally adds 1-3 short hero strands positioned
//    on the ACTUAL final displaced host surface with bury-first hidden caps & clearance checks.
import { CatmullRomCurve3, Color, MathUtils, Vector3, type Texture } from 'three'
import { rng, seedFor } from '../shape'
import { radiusAt, type Branch } from './skeleton'

export const barkUvModes = ['triplanar', 'flow'] as const
export type BarkUvMode = typeof barkUvModes[number]

export const woodSculptStyleIds = ['off', 'stylized-twist', 'ancient-driftwood', 'cracked-oak'] as const
export type WoodSculptStyleId = typeof woodSculptStyleIds[number]

export interface TrunkSculptSpec {
  /** Overall sculpted wide-rib & furrow intensity (0..1; 0 = classic wood.ts untouched) */
  intensity: number
  /** Geometric subdivision multiplier on trunk & primary limbs at high LOD (1..3.5; scales smoothly with LOD woodDetail) */
  subdiv: number
  /** Unified macro spiral twist turns along trunk height (-3..3; positive = right-handed coil for ribs, UV & strands) */
  twist: number
  /** Primary anchored wide ribs / integrated root buttresses around trunk circumference (3..18; 4..7 = bold muscular ribs) */
  flutes: number
  /** Flanking crevice sharpness along wide rib boundaries (0..1) */
  sharpness: number
  /** Organic rib meander & intermittent split-fissure complexity (0..1: low = clean sculpted bonsai, high = weathered driftwood) */
  furrowWarp: number
  /** Localized inner-bend short oblique compression folds at S-bend curvature peaks (0..1) */
  bendWrinkles: number
  /** Optional short detached hero cross-strands on weathered driftwood (0 = pure monolithic skin; 1..3 recommended for driftwood) */
  strands: number
  /** Detached hero strand radius relative to trunk radius (0.06..0.34) */
  strandThickness: number
  /** Extra spiral drift of detached hero strands relative to main trunk twist (-2.5..2.5) */
  strandTwist: number
  /** Lift clearance of detached hero strands off actual displaced host bark (0..1) */
  strandRelief: number
  /** Physical vertex displacement depth driven by active bark texture Height / luminance (0..1) */
  heightDisplace: number
  /** Deep crevice ambient occlusion darkening baked into linear vertex color (0..1) */
  creviceAO: number
  /** Convex ridge crest weathering / sunlit highlight baked into linear vertex color (0..1) */
  crestWear: number
  /** UV mapping mode: 'triplanar' (3D object-space non-tiling) | 'flow' (seamless twist-aligned cylindrical flow UV) */
  uvMode: BarkUvMode
  /** Static / export-grade primary branch collar topological welding (cuts trunk socket hole & bridges with C1 Hermite fillet) */
  weldCollars: boolean
}

export function defaultTrunkSculpt(): TrunkSculptSpec {
  return {
    intensity: 0,
    subdiv: 1.8,
    twist: 0.42,
    flutes: 5,
    sharpness: 0.65,
    furrowWarp: 0.35,
    bendWrinkles: 0.45,
    strands: 0,
    strandThickness: 0.14,
    strandTwist: 0.12,
    strandRelief: 0.55,
    heightDisplace: 0,
    creviceAO: 0.62,
    crestWear: 0.48,
    uvMode: 'triplanar',
    weldCollars: false,
  }
}

export const woodSculptStyleMeta: Record<WoodSculptStyleId, { label: string; hint: string; spec: TrunkSculptSpec }> = {
  off: {
    label: '经典平滑',
    hint: '关闭高精树干褶皱雕刻与一体板根，恢复默认轻量木质网格',
    spec: defaultTrunkSculpt(),
  },
  'stylized-twist': {
    label: '风格扭纹',
    hint: '0 根外贴细管：宽厚一体化扭转主脊 + 连续展宽一体板根 + 内弯局部短斜褶 + 一级枝口无缝焊接，像手雕盆景古干',
    spec: {
      intensity: 0.82,
      subdiv: 2.3,
      twist: 0.46,
      flutes: 5,
      sharpness: 0.64,
      furrowWarp: 0.28,
      bendWrinkles: 0.68,
      strands: 0,
      strandThickness: 0.13,
      strandTwist: 0.08,
      strandRelief: 0.45,
      heightDisplace: 0.18,
      creviceAO: 0.64,
      crestWear: 0.58,
      uvMode: 'flow',
      weldCollars: true,
    },
  },
  'ancient-driftwood': {
    label: '风化古木',
    hint: '一体深沟宽脊 + 粗壮连续板根 + 枝口焊接为主体，配 2 段贴合宿主曲面、两端埋入宽脊的穿绕短筋与风化磨蚀棱脊',
    spec: {
      intensity: 0.94,
      subdiv: 2.7,
      twist: 0.52,
      flutes: 6,
      sharpness: 0.84,
      furrowWarp: 0.74,
      bendWrinkles: 0.54,
      strands: 2,
      strandThickness: 0.15,
      strandTwist: 0.18,
      strandRelief: 0.64,
      heightDisplace: 0.36,
      creviceAO: 0.82,
      crestWear: 0.78,
      uvMode: 'flow',
      weldCollars: true,
    },
  },
  'cracked-oak': {
    label: '裂纹老橡',
    hint: '紧凑纵裂老树皮宽脊 + 适度贴图高度置换 + 连续根肩，0 根悬空木筋，适合写实/半写实乔木',
    spec: {
      intensity: 0.68,
      subdiv: 2.2,
      twist: 0.22,
      flutes: 8,
      sharpness: 0.80,
      furrowWarp: 0.66,
      bendWrinkles: 0.36,
      strands: 0,
      strandThickness: 0.12,
      strandTwist: 0.06,
      strandRelief: 0.35,
      heightDisplace: 0.40,
      creviceAO: 0.74,
      crestWear: 0.42,
      uvMode: 'flow',
      weldCollars: false,
    },
  },
}

export function cloneTrunkSculpt(s?: TrunkSculptSpec): TrunkSculptSpec {
  return { ...defaultTrunkSculpt(), ...(s ?? {}) }
}

export function parseTrunkSculpt(raw: unknown): TrunkSculptSpec {
  const base = defaultTrunkSculpt()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<TrunkSculptSpec>
  const num = (v: unknown, fb: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? MathUtils.clamp(v, lo, hi) : fb
  return {
    intensity: num(r.intensity, base.intensity, 0, 1),
    subdiv: num(r.subdiv, base.subdiv, 1, 3.5),
    twist: num(r.twist, base.twist, -3, 3),
    flutes: Math.round(num(r.flutes, base.flutes, 3, 18)),
    sharpness: num(r.sharpness, base.sharpness, 0, 1),
    furrowWarp: num(r.furrowWarp, base.furrowWarp, 0, 1),
    bendWrinkles: num(r.bendWrinkles, base.bendWrinkles, 0, 1),
    strands: Math.round(num(r.strands, base.strands, 0, 14)),
    strandThickness: num(r.strandThickness, base.strandThickness, 0.06, 0.34),
    strandTwist: num(r.strandTwist, base.strandTwist, -2.5, 2.5),
    strandRelief: num(r.strandRelief, base.strandRelief, 0, 1),
    heightDisplace: num(r.heightDisplace, base.heightDisplace, 0, 1),
    creviceAO: num(r.creviceAO, base.creviceAO, 0, 1),
    crestWear: num(r.crestWear, base.crestWear, 0, 1),
    uvMode: r.uvMode === 'flow' ? 'flow' : 'triplanar',
    weldCollars: Boolean(r.weldCollars),
  }
}

/** True when any geometric sculpt feature or flow-UV mode is active (false = zero-change legacy wood.ts path). */
export function isWoodSculptActive(sculpt?: TrunkSculptSpec): boolean {
  if (!sculpt) return false
  return sculpt.intensity > 0.001 || sculpt.strands > 0 || sculpt.heightDisplace > 0.001 || sculpt.uvMode === 'flow'
}

/** Integer circumferential UV repeat shared identically by CPU heightfield sampling and GPU Flow UV shader.
 *  Strictly integer >= 1 so seam u=0 and u=1 always sample the exact same texel value and derivative! */
export function barkFlowTileU(barkScale: number): number {
  return Math.max(1, Math.round(Math.max(0.25, barkScale)))
}

/** Unified twist displacement angle along normalized arc length `normS = arcLen / refHeight`.
 *  Positive twist -> right-handed coil (+angle as s increases) for ribs, grooves, Flow UV, and hero strands alike! */
export function flowTwistAngle(normS: number, twist: number): number {
  return twist * normS * Math.PI * 2
}

/** Monotonic LOD subdivision & strand budget derived from `optimize.woodDetail` (0.2..1.0) and `sculpt`.
 *  Because all anchors live in a fixed priority-ordered TrunkFeaturePlan, reducing `activeStrands` NEVER shifts
 *  the angle or position of any retained root buttress, wide rib, or hero strand! */
export function woodSculptLodParams(detail: number, sculpt?: TrunkSculptSpec) {
  const d = MathUtils.clamp(detail, 0.2, 1)
  const active = isWoodSculptActive(sculpt)
  if (!active || !sculpt) {
    return {
      active: false,
      trunkRings: Math.max(10, Math.round(44 * d)),
      trunkSegs: Math.max(6, Math.round(22 * d)),
      limbRings: Math.max(5, Math.round(14 * d)),
      limbSegs: Math.max(5, Math.round(9 * d)),
      activeStrands: 0,
      strandRings: 0,
      strandSegs: 0,
      lodNormalBoost: 0,
    }
  }

  const hiFrac = Math.pow(MathUtils.clamp((d - 0.30) / 0.70, 0, 1), 1.32)
  const subdivMult = 1 + Math.max(0, sculpt.subdiv - 1) * hiFrac
  const limbMult = 1 + Math.max(0, sculpt.subdiv - 1) * hiFrac * 0.52

  // Ensure enough circumferential resolution to cleanly separate integrated buttress shoulders (min 12 on sculpt)
  const trunkRings = Math.max(12, Math.round(46 * d * subdivMult))
  const trunkSegs = Math.max(12, Math.round(26 * d * subdivMult))
  const limbRings = Math.max(6, Math.round(15 * d * limbMult))
  const limbSegs = Math.max(6, Math.round(10 * d * limbMult))

  // Detached hero strands: capped cleanly at max 4 in gameplay/hero mode (still honors explicit slider up to 6)
  const maxStrands = Math.max(0, Math.min(6, Math.round(sculpt.strands)))
  const activeStrands = d < 0.40 ? 0
    : d >= 0.86 ? maxStrands
      : Math.max(0, Math.min(maxStrands, Math.round(maxStrands * MathUtils.clamp((d - 0.36) / 0.50, 0, 1))))
  const strandRings = Math.max(14, Math.round((24 + 16 * hiFrac) * d))
  const strandSegs = d >= 0.72 ? 10 : 7

  // Gentle low-frequency bump retention on lower LODs (never excessive high-freq sharpening!)
  const lodNormalBoost = MathUtils.clamp((1 - d) * 0.55, 0, 0.42) * Math.max(sculpt.intensity, sculpt.heightDisplace)

  return {
    active: true,
    trunkRings,
    trunkSegs,
    limbRings,
    limbSegs,
    activeStrands,
    strandRings,
    strandSegs,
    lodNormalBoost,
  }
}

// ---------------------------------------------------------------------------
// Deterministic seamless 3D value noise & ridged fBM (zero allocations)
// ---------------------------------------------------------------------------
function fract(x: number) { return x - Math.floor(x) }

function smoothstep(e0: number, e1: number, x: number): number {
  const denom = e1 - e0
  if (Math.abs(denom) < 1e-6) return x >= e1 ? 1 : 0
  const t = MathUtils.clamp((x - e0) / denom, 0, 1)
  return t * t * (3 - 2 * t)
}

function wrapAngleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

function hash3(x: number, y: number, z: number): number {
  let px = fract(x * 0.1031)
  let py = fract(y * 0.1030)
  let pz = fract(z * 0.0973)
  const d = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33)
  px += d; py += d; pz += d
  return fract((px + py) * pz)
}

function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  const fx = x - ix, fy = y - iy, fz = z - iz
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const uz = fz * fz * (3 - 2 * fz)
  const n000 = hash3(ix, iy, iz)
  const n100 = hash3(ix + 1, iy, iz)
  const n010 = hash3(ix, iy + 1, iz)
  const n110 = hash3(ix + 1, iy + 1, iz)
  const n001 = hash3(ix, iy, iz + 1)
  const n101 = hash3(ix + 1, iy, iz + 1)
  const n011 = hash3(ix, iy + 1, iz + 1)
  const n111 = hash3(ix + 1, iy + 1, iz + 1)
  const nx00 = n000 + (n100 - n000) * ux
  const nx10 = n010 + (n110 - n010) * ux
  const nx01 = n001 + (n101 - n001) * ux
  const nx11 = n011 + (n111 - n011) * ux
  const nxy0 = nx00 + (nx10 - nx00) * uy
  const nxy1 = nx01 + (nx11 - nx01) * uy
  return nxy0 + (nxy1 - nxy0) * uz
}

function fbm3(x: number, y: number, z: number, octaves = 3): number {
  let sum = 0, amp = 0.54, norm = 0
  let px = x, py = y, pz = z
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(px, py, pz)
    norm += amp
    px = px * 2.04 + 13.7
    py = py * 2.04 + 29.1
    pz = pz * 2.04 + 7.3
    amp *= 0.5
  }
  return sum / norm
}

/** Exact CPU mirror of GPU `barkFlowHeightAt` used by the High-Poly -> Low-Poly GLB Normal Map Baker. */
export function evalFlowBarkMicroCpu(u: number, v: number, barkScale: number): number {
  const bScale = Math.max(0.15, barkScale)
  const ang = u * Math.PI * 2
  const fv = v * bScale
  const ca = Math.cos(ang), sa = Math.sin(ang)
  const fw = (fbm3(ca * 1.6 * bScale + 4.1, fv * 0.95 + 1.3, sa * 1.6 * bScale + 7.2, 3) - 0.5) * 0.72
  const angW = ang + fw
  const cw = Math.cos(angW), sw = Math.sin(angW)
  const r1 = 1 - Math.abs(fbm3(cw * 3.2 * bScale, fv * 0.75, sw * 3.2 * bScale, 3) * 2 - 1)
  const r2 = 1 - Math.abs(noise3(cw * 3.2 * bScale * 1.9 + 9.1, fv * 0.75 * 1.6 + 3.7, sw * 3.2 * bScale * 1.9 + 2.5) * 2 - 1)
  return MathUtils.clamp(r1 * r1 * 0.74 + r2 * r2 * 0.26, 0, 1)
}

export function ridgedFbm3(x: number, y: number, z: number, octaves = 2): number {
  let sum = 0, amp = 0.58, norm = 0
  let px = x, py = y, pz = z
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise3(px, py, pz) * 2 - 1)
    sum += amp * (n * n)
    norm += amp
    px = px * 2.08 + 19.3
    py = py * 2.08 + 11.7
    pz = pz * 2.08 + 23.9
    amp *= 0.5
  }
  return sum / norm
}

// ---------------------------------------------------------------------------
// Bark HeightField extraction (zero-cost reuse of Substance Float32 Height!)
// ---------------------------------------------------------------------------
export interface BarkHeightField {
  data: Float32Array
  width: number
  height: number
}

export function getBarkHeightField(tex?: Texture): BarkHeightField | undefined {
  if (!tex) return undefined
  const existing = tex.userData?.heightField as BarkHeightField | undefined
  if (existing && existing.data instanceof Float32Array && existing.width > 0 && existing.height > 0) {
    return existing
  }
  const img = tex.image as { width?: number; height?: number } | undefined
  if (!img || !img.width || !img.height || typeof document === 'undefined') return undefined
  try {
    const sz = 128
    const canvas = document.createElement('canvas')
    canvas.width = sz; canvas.height = sz
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.drawImage(img as CanvasImageSource, 0, 0, sz, sz)
    const rgba = ctx.getImageData(0, 0, sz, sz).data
    const data = new Float32Array(sz * sz)
    for (let i = 0, p = 0; i < data.length; i++, p += 4) {
      data[i] = (rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114) / 255
    }
    const field: BarkHeightField = { data, width: sz, height: sz }
    tex.userData.heightField = field
    return field
  } catch {
    return undefined
  }
}

export function sampleBarkHeightField(field: BarkHeightField, u: number, v: number): number {
  const { data, width, height } = field
  const fu = (((u % 1) + 1) % 1) * width
  const fv = (((v % 1) + 1) % 1) * height
  const x0 = Math.floor(fu) % width
  const y0 = Math.floor(fv) % height
  const x1 = (x0 + 1) % width
  const y1 = (y0 + 1) % height
  const tx = fu - Math.floor(fu)
  const ty = fv - Math.floor(fv)
  const h00 = data[y0 * width + x0]
  const h10 = data[y0 * width + x1]
  const h01 = data[y1 * width + x0]
  const h11 = data[y1 * width + x1]
  const a = h00 + (h10 - h00) * tx
  const b = h01 + (h11 - h01) * tx
  return a + (b - a) * ty
}

// ---------------------------------------------------------------------------
// Fixed Priority-Ordered Trunk Feature Plan (LOD-Invariant Anchors!)
// ---------------------------------------------------------------------------
export interface SocketFlowHint {
  branchId: number
  t: number          // normalized trunk parameter 0..1
  arcLen: number     // arc length along trunk (m)
  angle: number      // azimuthal angle around trunk parallel-transport frame
  radius: number     // child limb root radius (m)
  trunkRadius: number
  exitDotTan: number // cos(exit angle relative to trunk tangent); small = perpendicular, large = shallow
  dirLocal: Vector3  // unit direction of emerging limb
  length?: number    // child limb total length (m), used to ensure safe hole-weld clearance
}

export interface RibFeature {
  id: number
  priority: number
  rootAngle: number         // fixed azimuth at s = 0 (strictly LOD-invariant!)
  isPrimaryRoot: boolean    // true = expands continuously into an integrated ground buttress at s -> 0
  buttressReach: number     // radial flare extension multiplier at y = 0 (fraction of trunk radius)
  buttressHalfWidth: number // angular half-width at y = 0 (rad)
  buttressHeight: number    // height over which root shoulder blends smoothly into trunk rib (m)
  ribHalfWidth: number      // angular half-width along trunk body (rad)
  ribHeight: number         // relief amplitude (fraction of local trunk radius)
  startT: number            // smooth C1 onset along trunk (0 for primary roots)
  endT: number              // smooth C1 fadeout along trunk
  meanderAmp: number        // organic angular wander amplitude (rad)
  meanderFreq: number
  meanderPhase: number
  creviceDepth: number      // localized flanking furrow depth along this rib's shoulders
  targetSocket?: SocketFlowHint // optional primary limb socket this rib smoothly steers into
}

export interface StrandAnchor {
  id: number
  priority: number
  parentRibId: number       // rib that this short hero strand emerges from & buries back into!
  startT: number            // smooth bury-in start along trunk
  endT: number              // smooth bury-in end along trunk
  driftSign: number         // gentle angular drift across parent rib (+1 / -1)
  thickMul: number
  liftOrder: number         // explicit over/under priority layer (0 = under, 1 = over)
}

export interface TrunkFeaturePlan {
  ribs: RibFeature[]
  strandAnchors: StrandAnchor[]
  sockets: SocketFlowHint[]
  bendPeaks: { t: number; arcLen: number; angle: number; strength: number }[]
  trunkArcLen: number
}

/** Builds a strictly deterministic, LOD-invariant feature plan for the trunk:
 *  - Fixed root-buttress & wide-rib anchors (`id`, `rootAngle`) never shift when switching LOD!
 *  - Stable branch-ID mapping for rib-to-collar steering so dragging limbs never causes rib snapping!
 *  - Curvature bend peaks pre-detected once so inner-bend folds appear ONLY at true S-bend elbows! */
export function buildTrunkFeaturePlan(
  sculpt: TrunkSculptSpec,
  seed: number,
  phase: number,
  flare: number,
  flareLobes: number,
  flareHeight: number,
  trunkHeight: number,
  trunkArcTotal: number,
  sockets: SocketFlowHint[],
  bendPeaks: { t: number; arcLen: number; angle: number; strength: number }[],
): TrunkFeaturePlan {
  const rRng = rng(seedFor(seed, 6109))
  // 3..8 primary root-anchored wide ribs; plus secondary mid-trunk ribs when flutes > 6
  const primaryCount = MathUtils.clamp(Math.round(Math.min(Math.max(3, flareLobes || 5), Math.max(4, sculpt.flutes))), 3, 7)
  const extraRibs = Math.max(0, Math.min(6, Math.round(sculpt.flutes) - primaryCount))
  const ribs: RibFeature[] = []
  const hRef = Math.max(0.4, trunkHeight)

  // 1. Primary root-anchored continuous buttress ribs (each flows from a wide grounded root shoulder up the trunk!)
  for (let i = 0; i < primaryCount; i++) {
    const baseAng = phase + (i * Math.PI * 2) / primaryCount + (rRng() - 0.5) * (0.48 / primaryCount * Math.PI)
    const reachScale = 0.78 + rRng() * 0.44
    const widthScale = 0.85 + rRng() * 0.34
    const heightScale = 0.82 + rRng() * 0.36
    // Priority favors broader, front/side-reading buttresses cleanly across all LODs
    const priority = 100 - i * 8 + reachScale * 6
    ribs.push({
      id: i,
      priority,
      rootAngle: baseAng,
      isPrimaryRoot: true,
      buttressReach: Math.max(0.18, flare * 0.72 * reachScale),
      buttressHalfWidth: MathUtils.clamp((Math.PI / primaryCount) * 0.76 * widthScale, 0.24, 0.78),
      buttressHeight: Math.max(0.32, flareHeight * (0.95 + rRng() * 0.45)),
      ribHalfWidth: MathUtils.clamp((Math.PI / Math.max(3.5, primaryCount + extraRibs * 0.45)) * 0.84 * widthScale, 0.22, 0.72),
      ribHeight: (0.14 + 0.14 * sculpt.intensity) * heightScale,
      startT: 0,
      endT: MathUtils.clamp(0.84 + rRng() * 0.24, 0.76, 1.05),
      meanderAmp: (0.06 + 0.24 * sculpt.furrowWarp) * (0.7 + rRng() * 0.6),
      meanderFreq: 1.1 + rRng() * 1.1,
      meanderPhase: rRng() * Math.PI * 2,
      creviceDepth: 0.65 + rRng() * 0.35,
    })
  }

  // 2. Secondary intermittent ribs that split/emerge smoothly mid-trunk (adds organic branching rhythm, zero periodicity!)
  for (let j = 0; j < extraRibs; j++) {
    const id = primaryCount + j
    const baseAng = phase + ((j + 0.5) * Math.PI * 2) / Math.max(1, extraRibs) + (rRng() - 0.5) * 0.42
    const startT = 0.06 + rRng() * 0.24
    const endT = MathUtils.clamp(startT + 0.42 + rRng() * 0.46, startT + 0.30, 1.02)
    ribs.push({
      id,
      priority: 40 - j * 5,
      rootAngle: baseAng,
      isPrimaryRoot: false,
      buttressReach: 0,
      buttressHalfWidth: 0.2,
      buttressHeight: 0.2,
      ribHalfWidth: MathUtils.clamp((Math.PI / Math.max(5, sculpt.flutes)) * (0.66 + rRng() * 0.34), 0.14, 0.46),
      ribHeight: (0.08 + 0.10 * sculpt.intensity) * (0.75 + rRng() * 0.45),
      startT,
      endT,
      meanderAmp: (0.08 + 0.26 * sculpt.furrowWarp) * (0.7 + rRng() * 0.5),
      meanderFreq: 1.5 + rRng() * 1.2,
      meanderPhase: rRng() * Math.PI * 2,
      creviceDepth: 0.45 + rRng() * 0.45,
    })
  }

  // 3. Stable rib-to-limb steering (sorted by stable branchId so live node dragging never flips rib ownership!)
  const sortedSockets = [...sockets].sort((a, b) => a.branchId - b.branchId)
  const claimedRibs = new Set<number>()
  for (const sk of sortedSockets) {
    if (sk.radius < sk.trunkRadius * 0.28) continue
    let bestRib: RibFeature | undefined
    let bestDist = Infinity
    const normS = sk.arcLen / hRef
    const twistAtSk = flowTwistAngle(normS, sculpt.twist)
    for (const rib of ribs) {
      if (claimedRibs.has(rib.id) || rib.startT > sk.t - 0.12) continue
      const projAng = rib.rootAngle + twistAtSk
      const d = Math.abs(wrapAngleDiff(projAng, sk.angle))
      if (d < bestDist && d < 0.85) {
        bestDist = d
        bestRib = rib
      }
    }
    if (bestRib) {
      bestRib.targetSocket = sk
      claimedRibs.add(bestRib.id)
    }
  }

  // 4. Fixed priority-ordered short detached hero strand anchors (max 6 candidates; stylized uses 0, driftwood uses 2)
  const strandAnchors: StrandAnchor[] = []
  const maxCandidates = Math.min(6, primaryCount)
  // Order by visual prominence around the front/side display faces (strictly fixed across all LODs!)
  const orderedPrimary = [...ribs.filter(r => r.isPrimaryRoot)].sort((a, b) => {
    const scoreA = Math.cos(a.rootAngle - 0.35) * 0.4 + a.buttressReach
    const scoreB = Math.cos(b.rootAngle - 0.35) * 0.4 + b.buttressReach
    return scoreB - scoreA
  })
  for (let k = 0; k < maxCandidates; k++) {
    const hostRib = orderedPrimary[k]
    const sRng = rng(seedFor(seed, 8311 + hostRib.id * 37))
    const startT = 0.05 + (k % 2) * 0.05 + sRng() * 0.04
    const spanT = 0.42 + sRng() * 0.24
    strandAnchors.push({
      id: k,
      priority: 100 - k * 15,
      parentRibId: hostRib.id,
      startT,
      endT: Math.min(0.84, startT + spanT),
      driftSign: k % 2 === 0 ? 1 : -1,
      thickMul: 0.88 + sRng() * 0.28,
      liftOrder: k % 2, // explicit alternating over/under clearance ordering
    })
  }

  return { ribs, strandAnchors, sockets, bendPeaks, trunkArcLen: trunkArcTotal }
}

/** Computes a rib's exact center azimuth `theta_i(s)` at trunk position `(t, arcLen)`.
 *  Uses the unified positive twist convention + smooth organic meander + stable socket steering! */
export function ribCenterAngleAt(
  rib: RibFeature,
  t: number,
  arcLen: number,
  refHeight: number,
  twist: number,
): number {
  const normS = arcLen / Math.max(0.4, refHeight)
  let ang = rib.rootAngle + flowTwistAngle(normS, twist)
  ang += Math.sin(normS * Math.PI * rib.meanderFreq + rib.meanderPhase) * rib.meanderAmp * smoothstep(0.02, 0.22, t)

  // Smoothly steer rib toward its assigned primary limb shoulder below the fork (no snapping!)
  if (rib.targetSocket) {
    const sk = rib.targetSocket
    const pullEnv = smoothstep(Math.max(0.05, sk.t - 0.32), sk.t, t) * (1 - smoothstep(sk.t, sk.t + 0.16, t) * 0.5)
    if (pullEnv > 0.001) {
      const targetDiff = wrapAngleDiff(sk.angle, ang)
      // Limit steering angle so ribs curve gracefully into the limb collar without kinking
      ang += MathUtils.clamp(targetDiff, -0.68, 0.68) * pullEnv * 0.72
    }
  }
  return ang
}

// ---------------------------------------------------------------------------
// Unified Host Surface Evaluator (Single Source of Truth for Trunk, Collars & Hero Strands!)
// ---------------------------------------------------------------------------
export interface SculptEvalInput {
  sculpt: TrunkSculptSpec
  angle: number           // 0..2*PI around ring
  t: number               // 0..1 along branch
  arcLen: number          // physical meters along branch
  y: number               // world Y height (m)
  baseRadius: number      // un-displaced local branch radius (m)
  refHeight: number       // reference trunk height (m)
  phase: number           // deterministic seed phase
  concavity: number       // 0..1 smoothed concave inner-bend intensity at this vertex
  isTrunk: boolean
  barkScale: number
  flare: number
  flareLobes: number
  flareHeight: number
  heightField?: BarkHeightField
  plan?: TrunkFeaturePlan
}

export interface SculptEvalResult {
  /** Final physical radius (meters) including integrated buttresses, wide ribs, socket mounds, bend folds & heightmap! */
  finalRadius: number
  /** Fractional sculpt displacement ratio relative to flared base (kept for tests & diagnostics) */
  dispRatio: number
  /** 0..1 deep crevice AO factor */
  cavity: number
  /** 0..1 weathered convex ridge crest factor */
  crest: number
  /** 0..1 collar mound influence (used to blend branch-collar coloring) */
  collarFactor: number
  /** Unified twist-aligned seamless cylindrical Flow UV [u, v] */
  uvU: number
  uvV: number
}

/** Evaluates the COMPLETE sculpted bark surface in strictly 2*PI-periodic cylindrical space.
 *  Used identically by:
 *   1) Trunk & primary limb mesh vertices (`wood.ts`)
 *   2) Primary branch collar socket sampling (`wood.ts`)
 *   3) Detached short hero strand surface positioning (`appendHeroStrands`) */
export function evalBarkSculpt(inp: SculptEvalInput): SculptEvalResult {
  const {
    sculpt, angle, t, arcLen, y, baseRadius, refHeight, phase,
    concavity, isTrunk, barkScale, flare, flareLobes, flareHeight, heightField, plan,
  } = inp
  const hRef = Math.max(0.4, refHeight)
  const normS = arcLen / hRef
  const limbAtten = isTrunk ? 1.0 : 0.42
  const twistRate = sculpt.twist * (isTrunk ? 1.0 : 0.55)

  // 1. Unified Flow UV: constant along a twisting rib theta = a0 + twist * normS * 2*PI!
  //    Strictly (uvU(2*PI) - uvU(0)) === 1.0!
  const twistAng = flowTwistAngle(normS, twistRate)
  const thetaInv = angle - twistAng
  const uvU = thetaInv / (Math.PI * 2)
  const uvV = normS * 2.1

  // 2. Base Flare (strictly 2*PI-periodic integer harmonics — ZERO sin(2.3*a) seam tear!)
  let radius = baseRadius
  let buttressBoost = 0
  let ribTotal = 0
  let ribMax = 0
  let creviceTotal = 0
  let collarFactor = 0

  if (isTrunk) {
    const ySafe = Math.max(0, y)
    const expDecay = Math.exp(-ySafe / Math.max(0.06, flareHeight))
    if (plan && plan.ribs.length > 0 && sculpt.intensity > 0.001) {
      // Smooth isotropic base foot flare (gentle pedestal supporting the integrated continuous buttresses)
      radius *= 1 + flare * 0.28 * expDecay

      // 3. Anchored Wide Surface Ribs + Integrated Continuous Root Buttresses (GPT 4.1 & 4.2!)
      for (let i = 0; i < plan.ribs.length; i++) {
        const rib = plan.ribs[i]
        const thetaRib = ribCenterAngleAt(rib, t, arcLen, hRef, twistRate)
        const dAng = wrapAngleDiff(angle, thetaRib)

        // Smooth C1 onset & termination envelope (height AND slope go to 0 at startT and endT!)
        const envOn = rib.startT <= 0.001 ? 1.0 : smoothstep(rib.startT, rib.startT + 0.14, t)
        const envOff = rib.endT >= 1.0 ? 1.0 : (1 - smoothstep(rib.endT - 0.16, rib.endT, t))
        const bodyEnv = envOn * envOff * (1.08 - 0.38 * Math.pow(t, 1.2))
        if (bodyEnv <= 0.001 && !rib.isPrimaryRoot) continue

        // Continuous integrated root buttress shoulder at s -> 0 (expands seamlessly out of this rib!)
        let halfW = rib.ribHalfWidth
        let amp = rib.ribHeight * bodyEnv
        if (rib.isPrimaryRoot && ySafe < rib.buttressHeight * 1.35) {
          const rw = Math.pow(smoothstep(rib.buttressHeight * 1.25, 0, ySafe), 1.85)
          // Smoothly widen angular shoulder & amplify radial root extension toward ground y = 0
          halfW = MathUtils.lerp(halfW, rib.buttressHalfWidth, rw)
          const bAdd = rib.buttressReach * rw * (0.45 + 0.55 * sculpt.intensity)
          amp += bAdd
          buttressBoost = Math.max(buttressBoost, rw)
        }

        const q = Math.abs(dAng) / Math.max(0.08, halfW)
        if (q < 1.0) {
          // GPT 4.1 wide smooth C1 muscular rib profile: A * (1 - q^2)^2
          const u = 1 - q * q
          const profile = u * u
          const hRib = amp * profile
          ribTotal += hRib
          if (hRib > ribMax) ribMax = hRib
        }
        // Localized intermittent flanking crevice right along the shoulder edges of each wide rib
        if (q > 0.58 && q < 1.32 && sculpt.sharpness > 0.02) {
          const shoulder = Math.exp(-(((q - 0.94) / 0.22) ** 2))
          // Low-frequency intermittent modulation so grooves deepen, split & fade organically
          const cInv = Math.cos(thetaInv), sInv = Math.sin(thetaInv)
          const inter = smoothstep(0.24, 0.72, fbm3(cInv * 1.6 + rib.id * 2.3, normS * 1.45, sInv * 1.6 + 4.1, 2))
          const crevAmt = shoulder * rib.creviceDepth * (0.45 + 0.55 * inter) * sculpt.sharpness * Math.max(bodyEnv, buttressBoost * 0.85)
          creviceTotal = Math.max(creviceTotal, crevAmt)
        }
      }

      // Soft overlap saturation prevents adjacent ribs/buttresses from stacking into spiky double-height lumps
      const overlap = Math.max(0, ribTotal - ribMax)
      const softRib = ribMax + (0.34 * overlap) / (1 + 0.72 * overlap)
      // Carve crisp localized flanking crevices between ribs
      const crevCarve = creviceTotal * (0.095 + 0.065 * sculpt.furrowWarp) * sculpt.intensity
      // Attenuate inner-bend rib height gently on extreme bends to prevent self-folding
      const bendReliefScale = 1 - concavity * 0.28
      radius *= 1 + (softRib - crevCarve) * bendReliefScale
    } else {
      // Integer-periodic fallback flare (used when plan is omitted in scalar unit tests)
      const lobes = Math.max(0, Math.cos(flareLobes * angle + phase + Math.sin(angle * 2.0 + phase * 0.5) * 0.35))
      radius *= 1 + flare * expDecay * (0.35 + 0.9 * Math.pow(lobes, 1.6))
    }
  } else if (sculpt.intensity > 0.001) {
    // Primary limbs: gentle, smooth twist-aligned wide flutes (no noisy high-frequency ripples on thin limbs!)
    const cInv = Math.cos(thetaInv), sInv = Math.sin(thetaInv)
    const warp = (fbm3(cInv * 1.3 + 2.1, normS * 1.4 + phase, sInv * 1.3 + 5.3, 2) - 0.5) * sculpt.furrowWarp * 0.55
    const fCount = Math.max(3, Math.min(6, Math.round(sculpt.flutes * 0.65)))
    const wave = Math.pow(Math.max(1e-4, Math.abs(Math.sin(fCount * 0.5 * (thetaInv + warp)))), MathUtils.lerp(1.0, 0.55, sculpt.sharpness))
    const limbFade = smoothstep(0.02, 0.16, t) * (1 - 0.55 * t)
    ribMax = wave * 0.14 * sculpt.intensity * limbAtten * limbFade
    creviceTotal = Math.pow(MathUtils.clamp((0.48 - wave) / 0.48, 0, 1), 1.4) * sculpt.sharpness * limbFade * 0.65
    radius *= 1 + (wave - 0.48) * 0.14 * sculpt.intensity * limbAtten * limbFade
  }

  // 4. Secondary Organic Weathering Fissures (controlled by `furrowWarp`, strictly periodic in thetaInv!)
  let fissureCrev = 0
  if (sculpt.intensity > 0.001 && sculpt.furrowWarp > 0.02) {
    const cInv = Math.cos(thetaInv), sInv = Math.sin(thetaInv)
    const fNoise = ridgedFbm3(cInv * 2.1 + 7.4, normS * 1.65 + phase, sInv * 2.1 + 3.2, 2)
    // Only carve intermittent fissures where ridged noise dips deep (weathered driftwood character!)
    const splitMask = smoothstep(0.55, 0.14, fNoise) * sculpt.furrowWarp * sculpt.intensity * limbAtten * (1 - 0.4 * t)
    radius *= 1 - splitMask * 0.055
    fissureCrev = splitMask * 0.62
  }

  // 5. Directional Branch Collar Mounds on Parent Trunk (GPT 4.3: smooth soft-max when two limbs overlap!)
  if (isTrunk && plan && plan.sockets.length > 0) {
    let moundMax = 0
    for (let k = 0; k < plan.sockets.length; k++) {
      const sk = plan.sockets[k]
      const dt = t - sk.t
      // Asymmetric collar envelope: wider & thicker BELOW the emerging branch (supporting shoulder!)
      const spanT = Math.max(0.055, (sk.radius / hRef) * 2.6)
      const normDt = dt < 0 ? dt / (spanT * 1.45) : dt / (spanT * 0.85)
      if (Math.abs(normDt) > 2.2) continue
      const dAng = wrapAngleDiff(angle, sk.angle)
      const spanA = MathUtils.clamp((sk.radius / Math.max(0.06, sk.trunkRadius)) * 1.15, 0.34, 1.05)
      const normDa = dAng / spanA
      const d2 = normDt * normDt + normDa * normDa
      if (d2 < 3.6) {
        const w = Math.exp(-d2 * 1.25) * Math.max(0, 1 - d2 / 3.6) * (1 - smoothstep(0.86, 0.99, t) * 0.65)
        // Soft-max fusion prevents double-height spikes when two limbs are dragged right next to each other!
        const amp = MathUtils.clamp(sk.radius / Math.max(0.08, sk.trunkRadius), 0.18, 0.72) * 0.34
        const m = w * amp
        // Polynomial smooth max
        const diff = Math.abs(moundMax - m)
        const h = Math.max(0.08 - diff, 0) / 0.08
        moundMax = Math.max(moundMax, m) + h * h * 0.08 * 0.25
        collarFactor = Math.max(collarFactor, w)
      }
    }
    radius *= 1 + moundMax
  }

  // 6. Localized Inner-Bend Short Oblique Compression Folds (ONLY around true curvature peaks, fading cleanly at all ends!)
  let bendCrevice = 0
  if (isTrunk && sculpt.bendWrinkles > 0.001 && concavity > 0.08) {
    const concEnv = smoothstep(0.14, 0.68, concavity)
    // Short oblique folds localized at bend peaks (3-4 clean sculptural skin wrinkles, NOT full-trunk stripes!)
    let peakEnv = concEnv
    if (plan && plan.bendPeaks.length > 0) {
      let pMax = 0
      for (const pk of plan.bendPeaks) {
        const dt = (t - pk.t) / 0.14
        const da = wrapAngleDiff(angle, pk.angle) / 1.05
        const d2 = dt * dt + da * da
        if (d2 < 3.0) pMax = Math.max(pMax, Math.exp(-d2 * 1.2) * pk.strength)
      }
      peakEnv = Math.max(concEnv * 0.45, pMax * concEnv)
    }
    if (peakEnv > 0.01) {
      const obliquePhase = normS * 16.5 + Math.sin(thetaInv) * 1.1
      const fold = 0.5 + 0.5 * Math.cos(obliquePhase)
      const foldAmt = peakEnv * sculpt.bendWrinkles
      radius *= 1 + (fold - 0.5) * 0.095 * foldAmt
      bendCrevice = Math.pow(1 - fold, 1.6) * foldAmt * 0.52
    }
  }

  // 7. Physical Substance / Custom Texture Heightmap Displacement (STRICT INTEGER uTile -> ZERO SEAM TEAR!)
  let texCavity = 0
  let texCrest = 0
  if (sculpt.heightDisplace > 0.001 && heightField) {
    const uTile = barkFlowTileU(barkScale)
    const vTile = Math.max(0.25, barkScale) * 0.85
    const th = sampleBarkHeightField(heightField, uvU * uTile, uvV * vTile)
    const centered = (th - 0.5) * 2
    const hAmp = 0.14 * sculpt.heightDisplace * limbAtten * (1 - 0.35 * t)
    radius *= 1 + centered * hAmp
    texCavity = MathUtils.clamp((0.46 - th) * 2.0, 0, 1) * sculpt.heightDisplace
    texCrest = MathUtils.clamp((th - 0.56) * 2.0, 0, 1) * sculpt.heightDisplace
  }

  // Clamp minimum physical radius so thin sections never invert inside-out
  const minR = baseRadius * 0.58
  const maxR = baseRadius * (isTrunk ? (2.6 + flare * 0.9) : 1.48)
  const finalRadius = MathUtils.clamp(radius, minR, maxR)
  const dispRatio = (finalRadius - baseRadius) / Math.max(1e-5, baseRadius)

  // 8. Sculptural Cavity (localized crevices & inner-bend folds) & Crest Wear (exposed wide rib crowns)
  const cavity = MathUtils.clamp(creviceTotal * 0.82 + fissureCrev * 0.65 + bendCrevice * 0.65 + texCavity * 0.45, 0, 1)
  const ribNorm = MathUtils.clamp(ribMax / Math.max(0.06, 0.24 * Math.max(0.25, sculpt.intensity)), 0, 1)
  const crest = MathUtils.clamp(Math.pow(ribNorm, 1.3) * (1 - cavity * 0.7) + texCrest * 0.4, 0, 1)

  return { finalRadius, dispRatio, cavity, crest, collarFactor, uvU, uvV }
}

// ---------------------------------------------------------------------------
// Layer 4: Style-Gated Short Detached Hero Strands (GPT 4.4: 0 for stylized, 1-3 for driftwood!)
// ---------------------------------------------------------------------------
export interface HeroStrandContext {
  trunkBranch: Branch
  trunkPts: Vector3[]
  trunkNormals: Vector3[]
  trunkBinormals: Vector3[]
  trunkRadii: number[]
  trunkT: number[]
  trunkArc: number[]
  /** Actual final sculpted trunk surface radii per ring & angle (exact host skin!) */
  trunkSurfGrid: Float32Array
  trunkGridRings: number
  trunkGridSegs: number
  /** Dead stub exit points so hero strands check clearance against dead stubs too! */
  deadCenters: { pos: Vector3; radius: number }[]
  plan: TrunkFeaturePlan
  trunkHeight: number
  trunkRadius: number
  sculpt: TrunkSculptSpec
  activeStrands: number
  strandRings: number
  strandSegs: number
  bark: Color
  barkLight: Color
  crevice: Color
  // Output buffers to append into (single batched wood mesh = 0 extra draw calls)
  position: number[]
  uv: number[]
  color: number[]
  metric: number[]
  index: number[]
  seamPairs: [number, number][]
}

function transportSimpleFrames(pts: Vector3[]) {
  const tangents = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]
    const d = b.clone().sub(a)
    return d.lengthSq() > 1e-10 ? d.normalize() : new Vector3(0, 1, 0)
  })
  const normals: Vector3[] = [], binormals: Vector3[] = []
  const t0 = tangents[0]
  let n = Math.abs(t0.y) < 0.9 ? new Vector3(0, 1, 0).cross(t0).normalize() : new Vector3(1, 0, 0).cross(t0).normalize()
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
      const axis = new Vector3().crossVectors(tangents[i - 1], tangents[i])
      const s = axis.length()
      if (s > 1e-6) n = n.clone().applyAxisAngle(axis.normalize(), Math.atan2(s, tangents[i - 1].dot(tangents[i])))
      n.addScaledVector(tangents[i], -n.dot(tangents[i])).normalize()
    }
    normals.push(n.clone())
    binormals.push(new Vector3().crossVectors(tangents[i], n).normalize())
  }
  return { tangents, normals, binormals }
}

/** Appends 1-3 short, curated detached hero wood strands for weathered ancient driftwood (0 for stylized!):
 *  - Positioned directly against the ACTUAL displaced host surface (`trunkSurfGrid`)
 *  - Follows the UNIFIED trunk twist direction (+twist) with gentle drift across its host wide rib
 *  - Checks 3D clearance against dead stubs & neighboring strands
 *  - Bury-First Termination Order (GPT 4.4): sinks completely inside the target wide rib BEFORE pinching/capping -> ZERO floating sharp tips! */
export function appendHeroStrands(ctx: HeroStrandContext) {
  const {
    trunkPts, trunkNormals, trunkBinormals, trunkArc,
    trunkSurfGrid, trunkGridRings, trunkGridSegs, deadCenters,
    plan, trunkHeight, trunkRadius, sculpt, activeStrands, strandRings, strandSegs,
    bark, barkLight, crevice, position, uv, color, metric, index, seamPairs,
  } = ctx
  if (activeStrands <= 0 || trunkPts.length < 3 || plan.strandAnchors.length === 0) return

  const count = Math.min(activeStrands, plan.strandAnchors.length)
  const hRef = Math.max(0.4, trunkHeight)
  const c = new Color()
  const bleached = barkLight.clone().lerp(new Color('#f3eee6'), 0.42)
  const deepCrev = crevice.clone().multiplyScalar(0.54)
  const surfPt = new Vector3()
  const radDir = new Vector3()
  const tanVec = new Vector3()
  const outVec = new Vector3()
  const sideVec = new Vector3()
  const vPos = new Vector3()

  // Bilinear sampler of the ACTUAL final displaced host trunk surface radius & frame at (t, angle)
  const sampleHostSurface = (t: number, ang: number, outCenter: Vector3, outRadDir: Vector3) => {
    const tf = MathUtils.clamp(t, 0, 1) * (trunkGridRings - 1)
    const i0 = Math.min(trunkGridRings - 2, Math.floor(tf))
    const ia = tf - i0
    outCenter.lerpVectors(trunkPts[i0], trunkPts[i0 + 1], ia)
    const nx = MathUtils.lerp(trunkNormals[i0].x, trunkNormals[i0 + 1].x, ia)
    const ny = MathUtils.lerp(trunkNormals[i0].y, trunkNormals[i0 + 1].y, ia)
    const nz = MathUtils.lerp(trunkNormals[i0].z, trunkNormals[i0 + 1].z, ia)
    const bx = MathUtils.lerp(trunkBinormals[i0].x, trunkBinormals[i0 + 1].x, ia)
    const by = MathUtils.lerp(trunkBinormals[i0].y, trunkBinormals[i0 + 1].y, ia)
    const bz = MathUtils.lerp(trunkBinormals[i0].z, trunkBinormals[i0 + 1].z, ia)
    const ca = Math.cos(ang), sa = Math.sin(ang)
    outRadDir.set(nx * ca + bx * sa, ny * ca + by * sa, nz * ca + bz * sa)
    if (outRadDir.lengthSq() > 1e-8) outRadDir.normalize()
    else outRadDir.set(ca, 0, sa)

    const uNorm = (((ang / (Math.PI * 2)) % 1) + 1) % 1
    const jf = uNorm * trunkGridSegs
    const j0 = Math.floor(jf) % trunkGridSegs
    const j1 = (j0 + 1) % trunkGridSegs
    const ja = jf - Math.floor(jf)
    const r00 = trunkSurfGrid[i0 * trunkGridSegs + j0]
    const r01 = trunkSurfGrid[i0 * trunkGridSegs + j1]
    const r10 = trunkSurfGrid[(i0 + 1) * trunkGridSegs + j0]
    const r11 = trunkSurfGrid[(i0 + 1) * trunkGridSegs + j1]
    const hostR = MathUtils.lerp(MathUtils.lerp(r00, r01, ja), MathUtils.lerp(r10, r11, ja), ia)
    const arc = MathUtils.lerp(trunkArc[i0], trunkArc[i0 + 1], ia)
    return { hostR, arc }
  }

  // Track placed strand centerlines for explicit 3D over/under clearance checks
  const placedPaths: { pts: Vector3[]; rads: number[] }[] = []

  for (let k = 0; k < count; k++) {
    const anchor = plan.strandAnchors[k]
    const hostRib = plan.ribs.find(r => r.id === anchor.parentRibId) ?? plan.ribs[0]
    if (!hostRib) continue

    const knots = 10
    const ctrlPts: Vector3[] = []
    const ctrlOut: Vector3[] = []
    const ctrlRad: number[] = []

    for (let m = 0; m < knots; m++) {
      const f = m / (knots - 1) // 0 = buried start inside host rib, 1 = buried end inside host rib
      const tCur = MathUtils.lerp(anchor.startT, anchor.endT, f)
      const fIdx = Math.min(trunkArc.length - 1, Math.floor(tCur * (trunkArc.length - 1)))
      const arcEst = trunkArc[fIdx]

      // Follow the EXACT same rib twist direction (+twist), with a smooth bow drift across the middle span
      const ribAng = ribCenterAngleAt(hostRib, tCur, arcEst, hRef, sculpt.twist)
      const driftBell = Math.sin(f * Math.PI)
      const ang = ribAng + anchor.driftSign * (0.28 + Math.abs(sculpt.strandTwist) * 0.45) * driftBell

      const { hostR } = sampleHostSurface(tCur, ang, surfPt, radDir)
      const baseSr = Math.max(0.018, hostR * sculpt.strandThickness * anchor.thickMul * (1.0 - 0.30 * f))

      // BURY-FIRST TERMINATION ORDER (GPT 4.4!):
      // - Outer 16% at both ends: center sinks deep INSIDE hostR (-0.65 * baseSr), hiding the strand inside the wide rib
      // - ONLY at the very buried endpoints (f < 0.08 or f > 0.92) does radius narrow for capping -> ZERO visible sharp tips!
      const emergeEnv = smoothstep(0.10, 0.30, f) * (1 - smoothstep(0.70, 0.90, f))
      const radiusPinch = smoothstep(0.0, 0.09, f) * (1 - smoothstep(0.91, 1.0, f))
      const sr = baseSr * (0.35 + 0.65 * radiusPinch)

      // Compute explicit clearance lift in the emerged mid-span
      let liftOffset = MathUtils.lerp(-baseSr * 0.72, baseSr * (0.38 + 0.58 * sculpt.strandRelief), emergeEnv)

      const candidate = surfPt.clone().addScaledVector(radDir, hostR + liftOffset)

      // 3D Clearance check against previously placed hero strands (explicit over/under separation)
      if (emergeEnv > 0.15) {
        for (const prev of placedPaths) {
          for (let pi = 0; pi < prev.pts.length; pi++) {
            const minClear = sr + prev.rads[pi] + 0.012
            const d = candidate.distanceTo(prev.pts[pi])
            if (d < minClear) {
              // Upper layer (`liftOrder === 1`) gently lifts clear over lower strand; lower layer tucks snugger
              const push = (minClear - d) * (anchor.liftOrder === 1 ? 1.0 : -0.45) * emergeEnv
              liftOffset += push
              candidate.copy(surfPt).addScaledVector(radDir, hostR + liftOffset)
            }
          }
        }
        // Clearance check against dead stubs so strands never spear through dead branch bases
        for (const stub of deadCenters) {
          const minClear = sr + stub.radius + 0.025
          const d = candidate.distanceTo(stub.pos)
          if (d < minClear) {
            liftOffset -= (minClear - d) * 0.85
            candidate.copy(surfPt).addScaledVector(radDir, hostR + liftOffset)
          }
        }
      }

      if (candidate.y < sr * 0.55) candidate.y = sr * 0.55
      ctrlPts.push(candidate)
      ctrlOut.push(radDir.clone())
      ctrlRad.push(sr)
    }

    const curve = new CatmullRomCurve3(ctrlPts, false, 'centripetal', 0.5)
    const totalPts = Math.max(16, strandRings)
    const pts: Vector3[] = []
    const outDirs: Vector3[] = []
    const rMain: number[] = []
    const maxK = ctrlPts.length - 1
    for (let i = 0; i < totalPts; i++) {
      const s = i / (totalPts - 1)
      const p = curve.getPoint(s)
      const kf = s * maxK
      const k0 = Math.min(maxK - 1, Math.floor(kf))
      const ka = kf - k0
      const sr = MathUtils.lerp(ctrlRad[k0], ctrlRad[k0 + 1], ka)
      if (p.y < sr * 0.45) p.y = sr * 0.45
      pts.push(p)
      outDirs.push(ctrlOut[k0].clone().lerp(ctrlOut[k0 + 1], ka).normalize())
      rMain.push(sr)
    }
    placedPaths.push({ pts, rads: rMain })

    const frames = transportSimpleFrames(pts)
    const start = position.length / 3
    const cols = strandSegs + 1
    let arcAcc = 0

    for (let i = 0; i < totalPts; i++) {
      if (i > 0) arcAcc += pts[i].distanceTo(pts[i - 1])
      const sr = rMain[i]
      const y = pts[i].y
      tanVec.copy(frames.tangents[i])
      outVec.copy(outDirs[i]).addScaledVector(tanVec, -outDirs[i].dot(tanVec))
      if (outVec.lengthSq() > 1e-6) outVec.normalize()
      else outVec.copy(frames.normals[i])
      sideVec.crossVectors(tanVec, outVec).normalize()

      const vUv = (arcAcc / hRef) * 2.1
      const metricScale = MathUtils.clamp(sr / Math.max(0.08, trunkRadius), 0.14, 1.0)
      const rowStart = start + i * cols
      seamPairs.push([rowStart, rowStart + strandSegs])

      for (let j = 0; j < cols; j++) {
        const uFrac = j / strandSegs
        if (j === strandSegs) {
          // Exact seam closure: copy position, color, metric bit-for-bit from j = 0!
          const p0 = rowStart * 3
          position.push(position[p0], position[p0 + 1], position[p0 + 2])
          color.push(color[p0], color[p0 + 1], color[p0 + 2])
          uv.push(1.0 + k * 0.25, vUv)
          metric.push(metric[rowStart])
          continue
        }
        const ang = uFrac * Math.PI * 2
        const ca = Math.cos(ang), sa = Math.sin(ang)
        const outScale = ca >= 0 ? 1.02 : 0.72
        const sideScale = 1.24
        vPos.copy(pts[i]).addScaledVector(outVec, ca * sr * outScale).addScaledVector(sideVec, sa * sr * sideScale)
        if (vPos.y < 0) vPos.y = 0
        position.push(vPos.x, vPos.y, vPos.z)
        uv.push(uFrac + k * 0.25, vUv)
        metric.push(metricScale)

        const outerExposure = MathUtils.clamp(ca * 0.5 + 0.5, 0, 1)
        const tuckedCavity = Math.pow(1 - outerExposure, 1.4)
        const crestExp = Math.pow(outerExposure, 1.8)
        const heightFrac = MathUtils.clamp(y / hRef, 0, 1)
        c.copy(bark).lerp(barkLight, 0.24 + heightFrac * 0.30)
        c.lerp(deepCrev, tuckedCavity * sculpt.creviceAO * 0.76)
        c.lerp(bleached, crestExp * sculpt.crestWear * 0.48)
        color.push(c.r, c.g, c.b)
      }
    }

    for (let i = 0; i < totalPts - 1; i++) {
      const row0 = start + i * cols
      for (let j = 0; j < strandSegs; j++) {
        const a = row0 + j, b = a + 1
        index.push(a, b, b + cols, a, b + cols, a + cols)
      }
    }

    // Hidden buried end caps (deep inside host rib!)
    const capStart = position.length / 3
    position.push(pts[0].x, Math.max(0, pts[0].y), pts[0].z)
    uv.push(0.5, 0)
    metric.push(0.15)
    color.push(bark.r * 0.7, bark.g * 0.7, bark.b * 0.7)
    for (let j = 0; j < strandSegs; j++) index.push(capStart, start + j + 1, start + j)

    const capEnd = position.length / 3
    const lastPt = pts[totalPts - 1]
    position.push(lastPt.x, Math.max(0, lastPt.y), lastPt.z)
    uv.push(0.5, 1)
    metric.push(0.15)
    color.push(bark.r * 0.7, bark.g * 0.7, bark.b * 0.7)
    const lastRow = start + (totalPts - 1) * cols
    for (let j = 0; j < strandSegs; j++) index.push(capEnd, lastRow + j, lastRow + j + 1)
  }
}
