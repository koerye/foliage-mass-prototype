// SpeedTree-style leaf card distribution.
//
// Pipeline: branch skeleton (growth.ts) -> generated twigs (level 3) ->
// leaf anchors on twigs and limbs -> crown envelope (data-driven ellipsoid +
// soft clump field) -> pruning, orientation, card mesh with blended normals.
// The leaf look itself comes from a user supplied alpha texture.
import {
  BufferAttribute, BufferGeometry, Color, MathUtils, QuadraticBezierCurve3, Vector3,
} from 'three'
import { clamp, rng, seedFor, tau } from '../shape'
import type { AtlasRegion } from '../texgraph/types'
import {
  applyLeafTintAt, clumpToCrownCluster, leafPruneMaskAt, leafScaleFactorAt,
  type LeafClumpEdit, type LeafEditSpec,
} from '../tree/leaf-edits'
import type { Curve } from 'three'

/** Any branch carrier (old growth.ts limbs or the new skeleton). */
export interface Limb {
  id: number
  kind: 'trunk' | 'primary' | 'secondary'
  curve: Curve<Vector3>
  rootRadius: number
  tipRadius: number
}
export interface CrownCluster {
  center: Vector3
  direction: Vector3
  width: number
  height: number
  depth: number
  /** Optional relative card density multiplier for this cluster (default 1). */
  density?: number
  /** Optional clump-local sunlit/shadow pigment bias (-0.4..+0.4, default 0). */
  shade?: number
  /** Optional per-cluster leaf card scale multiplier (used by manual sculpted leaf clumps). */
  leafScale?: number
  /** Optional hex tint override for sculpted leaf clumps. */
  tint?: string
  /** Optional 0..1 tint blend strength for sculpted leaf clumps. */
  tintStrength?: number
  /** When true, bypasses global outer/inner/canopyLift pruning so hand-placed clumps always stay lush. */
  manual?: boolean
}
/** Optional external crown model: normalized radius (1 = surface) and a keep mask (bare zones). */
export interface LeafShaping {
  radius?: (p: Vector3) => number
  keep?: (p: Vector3, random: number) => boolean
  colorAt?: (position: Vector3, cardIndex: number, target: Color) => void
  padFlatten?: number
  flat?: boolean
  reduce?: number
  /** When true, preserve protruding branch-anchored clump shells against global ellipsoid outer clipping. */
  preserveClumpShells?: boolean
  /** When true, applies 3D spatial-hash blue-noise spacing across twigs/limbs/clumps so overlapping
   *  branches never crowd into dense blobs, overlapping clumps merge without holes, and bare pruned twigs are omitted. */
  uniformDensity?: boolean
  /** 0..1 coherent clump-local two-tone gouache color-mass shading (sunlit face vs cool shaded mass). */
  colorMass?: number
  /** When true, distributes cards cleanly across clump ellipsoid shells (preserving crisp breathing air gaps
   *  between boughs while scaling smoothly with all twig/limb/clump density controls). */
  clumpMassMode?: boolean
  /** Optional 3D interactive leaf clumps & foliage brush edits. */
  leafEdits?: LeafEditSpec
}

export const normalSources = ['clumps', 'crown'] as const
export type NormalSource = typeof normalSources[number]

export interface LeafParams {
  schemaVersion: 1
  // twigs
  twigFrequency: number
  twigStart: number
  twigEnd: number
  twigLength: number
  twigLengthVariance: number
  twigTaper: number
  twigAngle: number
  twigUpBias: number
  twigGravity: number
  // leaves on carriers
  leavesPerTwig: number
  leafStart: number
  tipLeaves: number
  limbLeafFrequency: number
  leafSize: number
  leafSizeVariance: number
  leafTipScale: number
  leafAspect: number
  leafPivot: number
  leafAngle: number
  leafOffset: number
  leafJitter: number
  // orientation
  faceOutward: number
  upAlign: number
  randomRoll: number
  randomTilt: number
  leafFold: number
  leafCurl: number
  // crown envelope
  pruneOuter: number
  pruneInner: number
  normalSource: NormalSource
  normalSpherize: number
  clumpScale: number
  clumpFill: number
  clumpFillScale: number
  clumpFillDepth: number
  cameraFacing: number
  cardType: CardType
  fanCount: number
  fanSpread: number
  // color & texture
  tintInner: string
  tintOuter: string
  tintVariance: number
  aoStrength: number
  alphaCutoff: number
  atlasCols: number
  atlasRows: number
  /** Optional non-uniform asymmetric atlas region rects (`atlas_compose` v2); overrides uniform grid UVs when non-empty. */
  atlasRegions?: AtlasRegion[]
  leafSeed: number
}

type NumericKey = { [K in keyof LeafParams]-?: LeafParams[K] extends number ? K : never }[keyof LeafParams]
type Range = readonly [min: number, max: number, step: number]

export const leafRules: Record<Exclude<NumericKey, 'schemaVersion'>, Range> = {
  twigFrequency: [0, 30, .1],
  twigStart: [0, 1, .01],
  twigEnd: [0, 1, .01],
  twigLength: [.05, 2.5, .01],
  twigLengthVariance: [0, 1, .01],
  twigTaper: [0, 1, .01],
  twigAngle: [5, 120, 1],
  twigUpBias: [-1, 1, .01],
  twigGravity: [-1, 1, .01],
  leavesPerTwig: [0, 40, .1],
  leafStart: [0, 1, .01],
  tipLeaves: [0, 8, 1],
  limbLeafFrequency: [0, 30, .1],
  leafSize: [.05, 3, .01],
  leafSizeVariance: [0, 1, .01],
  leafTipScale: [.2, 2, .01],
  leafAspect: [.2, 4, .01],
  leafPivot: [0, .5, .01],
  leafAngle: [0, 120, 1],
  leafOffset: [-1, 1, .01],
  leafJitter: [0, 1, .01],
  faceOutward: [0, 1, .01],
  upAlign: [0, 1, .01],
  randomRoll: [0, 180, 1],
  randomTilt: [0, 90, 1],
  leafFold: [-1, 1, .01],
  leafCurl: [-1, 1, .01],
  pruneOuter: [.5, 2, .01],
  pruneInner: [0, .95, .01],
  normalSpherize: [0, 1, .01],
  clumpScale: [.3, 3, .01],
  clumpFill: [0, 40, .1],
  clumpFillScale: [.5, 3, .01],
  clumpFillDepth: [0, 1, .01],
  cameraFacing: [0, 1, .01],
  fanCount: [2, 6, 1],
  fanSpread: [10, 160, 1],
  tintVariance: [0, .6, .01],
  aoStrength: [0, 1, .01],
  alphaCutoff: [.01, .99, .01],
  atlasCols: [1, 8, 1],
  atlasRows: [1, 8, 1],
  leafSeed: [0, 4294967295, 1],
}

export const defaultLeafParams: LeafParams = {
  schemaVersion: 1,
  twigFrequency: 5.5, twigStart: .3, twigEnd: 1, twigLength: .75, twigLengthVariance: .35, twigTaper: .45,
  twigAngle: 52, twigUpBias: .25, twigGravity: -.15,
  leavesPerTwig: 7, leafStart: .25, tipLeaves: 1, limbLeafFrequency: 2.5,
  leafSize: .78, leafSizeVariance: .3, leafTipScale: .85, leafAspect: 1, leafPivot: .12,
  leafAngle: 45, leafOffset: .06, leafJitter: .12,
  faceOutward: .72, upAlign: .12, randomRoll: 40, randomTilt: 18, leafFold: .18, leafCurl: -.12,
  pruneOuter: 1.12, pruneInner: .3, normalSource: 'clumps', normalSpherize: .8, clumpScale: 1.15,
  clumpFill: 5, clumpFillScale: 1.8, clumpFillDepth: .25, cameraFacing: .4,
  cardType: 'quad', fanCount: 3, fanSpread: 70,
  tintInner: '#5c7a3c', tintOuter: '#f4ffd8', tintVariance: .16, aoStrength: .55,
  alphaCutoff: .42, atlasCols: 1, atlasRows: 1, leafSeed: 1,
}

const hex = /^#[0-9a-fA-F]{6}$/

/** Validates a (possibly partial) leaf parameter object, filling defaults. */
export function parseLeafParams(value: unknown): LeafParams {
  if (value === undefined || value === null) return { ...defaultLeafParams }
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('叶片参数必须是对象')
  const data = value as Record<string, unknown>
  const result: LeafParams = { ...defaultLeafParams }
  for (const [key, [min, max, step]] of Object.entries(leafRules)) {
    if (data[key] === undefined) continue
    const n = data[key]
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max || (step === 1 && !Number.isInteger(n)))
      throw new Error(`叶片参数 ${key} 必须在 ${min}–${max} 范围内`)
    ;(result as unknown as Record<string, number>)[key] = n
  }
  if (data.cardType !== undefined) {
    if (data.cardType === 'blades') {
      // Legacy 3D-modeled blades migration -> standard game-ready crossed alpha leaf cards
      result.cardType = 'cross'
    } else {
      if (!(cardTypes as readonly string[]).includes(data.cardType as string)) throw new Error('未知插片方式')
      result.cardType = data.cardType as CardType
    }
  }
  if (data.normalSource !== undefined) {
    if (!normalSources.includes(data.normalSource as NormalSource)) throw new Error('未知法线来源')
    result.normalSource = data.normalSource as NormalSource
  }
  for (const key of ['tintInner', 'tintOuter'] as const) {
    if (data[key] === undefined) continue
    if (typeof data[key] !== 'string' || !hex.test(data[key] as string)) throw new Error(key + ' 必须是 #RRGGBB 颜色')
    result[key] = data[key] as string
  }
  if (data.atlasRegions !== undefined) {
    if (!Array.isArray(data.atlasRegions)) throw new Error('atlasRegions 必须是数组')
    const valid: AtlasRegion[] = []
    for (const raw of data.atlasRegions) {
      if (!raw || typeof raw !== 'object') continue
      const r = raw as Record<string, unknown>
      const x = Number(r.x), y = Number(r.y), w = Number(r.w), h = Number(r.h)
      if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue
      const pad = Number.isFinite(Number(r.padding)) ? Math.max(0, Number(r.padding)) : 0
      const rawSlot = Number(r.slot)
      const slot = Number.isFinite(rawSlot) ? Math.max(0, Math.min(3, Math.round(rawSlot))) : 0
      valid.push({
        id: typeof r.id === 'string' && r.id ? r.id : `r${valid.length + 1}`,
        x: clamp(x, 0, 1),
        y: clamp(y, 0, 1),
        w: clamp(w, 0.01, 1),
        h: clamp(h, 0.01, 1),
        padding: clamp(pad, 0, 0.1),
        slot,
        ...(Number.isFinite(Number(r.anchorX)) ? { anchorX: clamp(Number(r.anchorX), 0, 1) } : {}),
        ...(Number.isFinite(Number(r.anchorY)) ? { anchorY: clamp(Number(r.anchorY), 0, 1) } : {}),
        ...(Number.isFinite(Number(r.weight)) ? { weight: Math.max(0.05, Number(r.weight)) } : {}),
        ...(r.role === 'canopy' || r.role === 'accent' ? { role: r.role } : {}),
      })
    }
    if (valid.length > 0) result.atlasRegions = valid
  }
  if (result.twigEnd < result.twigStart) throw new Error('细枝结束位置不能小于起始位置')
  return result
}

export interface Twig {
  id: number
  parentId: number
  curve: QuadraticBezierCurve3
  length: number
  radius: number
}

export interface LeafCard {
  position: Vector3
  /** card plane basis: right (width), up (stem -> tip), normal */
  right: Vector3
  up: Vector3
  normal: Vector3
  width: number
  height: number
  cell: number
  shade: number
  spin: number
  clumpIndex?: number
}

export interface Envelope {
  center: Vector3
  radii: Vector3
  clumps: {
    center: Vector3
    sigma: number
    radii: Vector3
    yaw: number
    direction: Vector3
    density: number
    shade: number
    leafScale?: number
    tint?: string
    tintStrength?: number
    manual?: boolean
  }[]
}

const UP = new Vector3(0, 1, 0)
const golden = Math.PI * (3 - Math.sqrt(5))

function anyPerpendicular(v: Vector3) {
  const a = Math.abs(v.y) < .9 ? UP : new Vector3(1, 0, 0)
  return new Vector3().crossVectors(v, a).normalize()
}

function stochasticCount(expected: number, random: () => number) {
  const base = Math.floor(expected)
  return base + Number(random() < expected - base)
}

/** Level-3 twigs generated along primary/secondary limbs. */
export function generateTwigs(limbs: Limb[], p: LeafParams, seed: number): Twig[] {
  const twigs: Twig[] = []
  for (const limb of limbs) {
    if (limb.kind === 'trunk') continue
    const random = rng(seedFor(seed ^ p.leafSeed, 7000 + limb.id))
    const span = Math.max(0, p.twigEnd - p.twigStart)
    const length = limb.curve.getLength()
    const count = stochasticCount(p.twigFrequency * length * span, random)
    const phase = random() * Math.PI * 2
    for (let k = 0; k < count; k++) {
      const t = clamp(p.twigStart + span * (k + .2 + random() * .6) / count)
      const base = limb.curve.getPoint(t)
      const tangent = limb.curve.getTangent(t).normalize()
      const side = anyPerpendicular(tangent)
      const azimuth = phase + k * golden + (random() - .5) * .6
      const radial = side.clone().applyAxisAngle(tangent, azimuth)
      const angle = (p.twigAngle + (random() - .5) * 14) * Math.PI / 180
      const direction = tangent.clone().multiplyScalar(Math.cos(angle)).addScaledVector(radial, Math.sin(angle))
      direction.addScaledVector(UP, p.twigUpBias).normalize()
      const size = p.twigLength * (1 + (random() * 2 - 1) * p.twigLengthVariance) * (1 - p.twigTaper * t * .8)
      const len = Math.max(.03, size)
      const tip = base.clone().addScaledVector(direction, len)
      tip.y += p.twigGravity * len * .45
      const mid = base.clone().addScaledVector(direction, len * .5)
      mid.y += p.twigGravity * len * .05
      const radius = limb.tipRadius + (limb.rootRadius - limb.tipRadius) * (1 - t) ** 1.25
      twigs.push({
        id: twigs.length, parentId: limb.id, curve: new QuadraticBezierCurve3(base, mid, tip),
        length: len, radius: Math.max(.004, radius * .32),
      })
    }
  }
  return twigs
}

/** Crown envelope fitted to the actual skeleton (twig tips + crown clusters). */
export function fitEnvelope(twigs: Twig[], limbs: Limb[], clusters: CrownCluster[], p: LeafParams): Envelope {
  const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)
  const add = (v: Vector3) => { min.min(v); max.max(v) }
  for (const twig of twigs) add(twig.curve.v2)
  for (const limb of limbs) if (limb.kind !== 'trunk') add(limb.curve.getPoint(1))
  for (const c of clusters) {
    add(c.center.clone().add(new Vector3(c.width * .5, c.height * .5, c.depth * .5)))
    add(c.center.clone().sub(new Vector3(c.width * .5, c.height * .5, c.depth * .5)))
  }
  if (!Number.isFinite(min.x)) { min.set(-1, 1, -1); max.set(1, 3, 1) }
  const center = min.clone().add(max).multiplyScalar(.5)
  const radii = max.clone().sub(min).multiplyScalar(.5).max(new Vector3(.3, .3, .3))
  const clumps = clusters.map(c => ({
    center: c.center.clone(),
    sigma: Math.max(.15, (c.width + c.height + c.depth) / 3 * .6 * p.clumpScale),
    radii: new Vector3(c.width * .5, c.height * .5, c.depth * .5),
    yaw: -Math.atan2(c.direction.z, c.direction.x),
    direction: c.direction.clone().normalize(),
    density: c.density ?? 1,
    shade: c.shade ?? 0,
    ...(c.leafScale !== undefined ? { leafScale: c.leafScale } : {}),
    ...(c.tint ? { tint: c.tint } : {}),
    ...(c.tintStrength !== undefined ? { tintStrength: c.tintStrength } : {}),
    ...(c.manual ? { manual: true } : {}),
  }))
  return { center, radii, clumps }
}

/** Normalized ellipsoid radius: 0 at crown center, 1 at the envelope surface. */
export function envelopeRadius(env: Envelope, point: Vector3) {
  return Math.hypot((point.x - env.center.x) / env.radii.x, (point.y - env.center.y) / env.radii.y,
    (point.z - env.center.z) / env.radii.z)
}

const scratch = new Vector3()
/** Outward normal of the crown (ellipsoid gradient) or soft clump field. */
export function envelopeNormal(env: Envelope, point: Vector3, source: NormalSource, target = new Vector3()) {
  const { center: c, radii: r } = env
  target.set((point.x - c.x) / (r.x * r.x), (point.y - c.y) / (r.y * r.y), (point.z - c.z) / (r.z * r.z))
  if (target.lengthSq() < 1e-12) target.copy(UP)
  target.normalize()
  if (source === 'crown' || env.clumps.length === 0) return target
  // Soft-min weighted sum of directions away from clump centers (gradient of a
  // Gaussian blob field), computed in log space to avoid underflow.
  let best = Infinity
  const d2s = env.clumps.map(clump => {
    const d2 = point.distanceToSquared(clump.center) / (clump.sigma * clump.sigma)
    best = Math.min(best, d2)
    return d2
  })
  const field = new Vector3()
  env.clumps.forEach((clump, i) => {
    const w = Math.exp(-(d2s[i] - best)) / (clump.sigma * clump.sigma)
    field.addScaledVector(scratch.subVectors(point, clump.center), w)
  })
  if (field.lengthSq() < 1e-12) return target
  field.normalize()
  // Never let concave saddle creases between neighboring clumps invert normals inward into darkness:
  // remove any inward-pointing component opposing the convex crown normal, then blend smoothly.
  const align = field.dot(target)
  if (align < 0) {
    field.addScaledVector(target, -align)
    if (field.lengthSq() < 1e-8) return target
    field.normalize()
  }
  return target.multiplyScalar(.30).addScaledVector(field, .70).normalize()
}

function randomUnit(u: number, v: number) {
  const z = u * 2 - 1, a = v * Math.PI * 2, s = Math.sqrt(1 - z * z)
  return new Vector3(s * Math.cos(a), z, s * Math.sin(a))
}

/** Lightweight 3D spatial hash for O(1) blue-noise leaf-card spacing (prevents overcrowded branch blobs
 *  and lets overlapping clump pillows fuse seamlessly without Swiss-cheese holes). */
class LeafOccupancyGrid {
  private readonly cell: number
  private readonly inv: number
  private readonly buckets = new Map<string, number[]>()
  private readonly coords: number[] = []

  constructor(cellSize: number) {
    this.cell = Math.max(.06, cellSize)
    this.inv = 1 / this.cell
  }

  private key(ix: number, iy: number, iz: number) {
    return `${ix},${iy},${iz}`
  }

  tooClose(p: Vector3, minDist: number): boolean {
    if (minDist <= 1e-4) return false
    const r2 = minDist * minDist
    const cx = Math.floor(p.x * this.inv)
    const cy = Math.floor(p.y * this.inv)
    const cz = Math.floor(p.z * this.inv)
    const span = Math.max(1, Math.ceil(minDist * this.inv))
    for (let dx = -span; dx <= span; dx++) {
      for (let dy = -span; dy <= span; dy++) {
        for (let dz = -span; dz <= span; dz++) {
          const list = this.buckets.get(this.key(cx + dx, cy + dy, cz + dz))
          if (!list) continue
          for (let i = 0; i < list.length; i++) {
            const o = list[i]
            const ox = p.x - this.coords[o], oy = p.y - this.coords[o + 1], oz = p.z - this.coords[o + 2]
            if (ox * ox + oy * oy + oz * oz < r2) return true
          }
        }
      }
    }
    return false
  }

  add(p: Vector3) {
    const idx = this.coords.length
    this.coords.push(p.x, p.y, p.z)
    const k = this.key(Math.floor(p.x * this.inv), Math.floor(p.y * this.inv), Math.floor(p.z * this.inv))
    const list = this.buckets.get(k)
    if (list) list.push(idx)
    else this.buckets.set(k, [idx])
  }
}

const FORWARD = new Vector3(0, 0, 1)

/** Unified clump-surface Fibonacci shell distribution for coherent painterly color-mass canopies.
 *  Preserves crisp negative-space breathing gaps between boughs while still responding to every
 *  twig, limb, clump, orientation, bare-zone, pruning, and LOD parameter! */
function distributeClumpMassLeaves(
  env: Envelope,
  p: LeafParams,
  seed: number,
  shaping: LeafShaping,
): { cards: LeafCard[]; pruned: number; activeTwigIds: Set<number> } {
  const cards: LeafCard[] = []
  let pruned = 0
  const cells = p.atlasCols * p.atlasRows
  const twigSpan = Math.max(0, p.twigEnd - p.twigStart)
  const leavesOnTwigs = p.twigFrequency * twigSpan * p.leavesPerTwig * (1 - p.leafStart)
  const leafDensity = p.clumpFill + leavesOnTwigs * .42 + p.limbLeafFrequency * .46 + p.tipLeaves * .26
  const clumpRandomBase = seed ^ p.leafSeed
  const useUniform = Boolean(shaping.uniformDensity)
  const denseCrown = clamp((env.clumps.length - 10) / 20)
  const multiPlane = p.cardType === 'cross' || p.cardType === 'tri' || p.cardType === 'fan'
  const planeSpacingMul = multiPlane ? MathUtils.lerp(1, 1.18, denseCrown) : 1
  const occupancy = useUniform ? new LeafOccupancyGrid(Math.max(.08, p.leafSize * .24)) : undefined
  // Strictly asymmetric (j < index) deep-overlap culling prevents mutual deletion of visible bough seams
  const deepOverlapLimit = MathUtils.lerp(.52, .68, denseCrown)

  const leafEdits = shaping.leafEdits
  for (const [index, clump] of env.clumps.entries()) {
    const random = rng(seedFor(clumpRandomBase, 7301 + index))
    const isManual = Boolean(clump.manual)
    const radii = isManual ? clump.radii.clone() : clump.radii.clone().multiplyScalar(p.clumpFillScale)
    const area = (radii.x * radii.y + radii.x * radii.z + radii.y * radii.z) * (4 * Math.PI / 3)
    const baseDensity = isManual ? Math.max(5.2, leafDensity) : leafDensity
    const count = Math.round(clamp(area * baseDensity * clump.density, 0, 440))
    const phase = random() * tau
    for (let i = 0; i < count; i++) {
      const y = 1 - 2 * (i + .2 + random() * .6) / Math.max(1, count)
      const horizontal = Math.sqrt(Math.max(0, 1 - y * y))
      const angle = i * golden + phase + (random() - .5) * p.leafJitter
      const dir = new Vector3(Math.cos(angle) * horizontal, y, Math.sin(angle) * horizontal)
      const isInner = i % 5 === 0
      const distance = isInner
        ? .82 - random() * p.clumpFillDepth * .76
        : .97 - random() * p.clumpFillDepth * .30
      if (!isManual && (distance < p.pruneInner || distance > p.pruneOuter)) { pruned++; continue }
      const position = dir.clone().multiply(radii).multiplyScalar(distance).add(clump.center)
      position.addScaledVector(dir, p.leafOffset * .12)
      if (!isManual && shaping.radius && shaping.radius(position) > p.pruneOuter) { pruned++; continue }
      if (!isManual && shaping.keep && !shaping.keep(position, random())) { pruned++; continue }
      if (leafEdits) {
        const pm = leafPruneMaskAt(position, leafEdits)
        if (pm > .92 || (pm > .04 && random() < pm)) { pruned++; continue }
      }
      if (!isManual && index > 0) {
        let buried = false
        for (let j = 0; j < index; j++) {
          if (clumpRadius(env.clumps[j], position, p.clumpFillScale) < deepOverlapLimit) {
            buried = true
            break
          }
        }
        if (buried) { pruned++; continue }
      }
      if (occupancy && !isManual) {
        const gapFactor = MathUtils.lerp(isInner ? .22 : .16, isInner ? .33 : .26, denseCrown) * planeSpacingMul
        if (occupancy.tooClose(position, p.leafSize * gapFactor)) { pruned++; continue }
      }
      const normal = clump.direction.clone().lerp(dir, .55 + p.faceOutward * .45)
        .addScaledVector(UP, p.upAlign * .35).normalize()
      const right = new Vector3().crossVectors(Math.abs(normal.y) > .95 ? FORWARD : UP, normal).normalize()
      const tilt = (random() - .5) * MathUtils.degToRad(p.randomTilt)
      normal.applyAxisAngle(right, tilt)
      const up = new Vector3().crossVectors(normal, right)
      const spin = (random() - .5) * MathUtils.degToRad(p.randomRoll) * 1.15
      right.applyAxisAngle(normal, spin)
      up.applyAxisAngle(normal, spin)
      const taper = MathUtils.lerp(1, p.leafTipScale, Math.max(0, y) * .38)
      const scaleMul = (clump.leafScale ?? 1) * leafScaleFactorAt(position, leafEdits)
      const size = p.leafSize * (.82 + (random() - .5) * p.leafSizeVariance) * taper * scaleMul
      const cell = Math.min(cells - 1, Math.floor(random() * cells))
      cards.push({
        position, right, up, normal,
        width: size * p.leafAspect, height: size,
        cell, shade: random(), spin, clumpIndex: index,
      })
      occupancy?.add(position)
    }
  }
  if (leafEdits?.brushes.length) {
    emitDensifyBrushCards(cards, env, p, seed, leafEdits, cells)
  }
  return { cards, pruned, activeTwigIds: new Set<number>() }
}

/** Emits localized organic foliage card bursts for user-painted 'densify' brush strokes. */
function emitDensifyBrushCards(
  cards: LeafCard[],
  env: Envelope,
  p: LeafParams,
  seed: number,
  leafEdits: LeafEditSpec,
  cells: number,
) {
  for (const stroke of leafEdits.brushes) {
    if (stroke.kind !== 'densify' || stroke.strength <= 0) continue
    const br = rng(seedFor(seed ^ p.leafSeed, 17300 + stroke.id * 37))
    const rad = MathUtils.clamp(stroke.radius, .2, 3.5)
    const count = Math.round(clamp(8 + 22 * stroke.strength * rad * rad, 6, 92))
    const center = new Vector3(stroke.position[0], stroke.position[1], stroke.position[2])
    const phase = br() * tau
    for (let k = 0; k < count; k++) {
      const y = 1 - 2 * (k + .25 + br() * .5) / Math.max(1, count)
      const h = Math.sqrt(Math.max(0, 1 - y * y))
      const a = k * golden + phase + (br() - .5) * .6
      const dist = Math.cbrt(.18 + br() * .82) * rad
      const position = new Vector3(
        center.x + Math.cos(a) * h * dist,
        center.y + y * dist * .82,
        center.z + Math.sin(a) * h * dist,
      )
      const pm = leafPruneMaskAt(position, leafEdits)
      if (pm > .92 || (pm > .04 && br() < pm)) continue
      const outward = envelopeNormal(env, position, p.normalSource)
      const localDir = position.clone().sub(center)
      if (localDir.lengthSq() < 1e-6) localDir.copy(outward)
      else localDir.normalize()
      const normal = outward.clone().lerp(localDir, .35).addScaledVector(UP, p.upAlign * .35).normalize()
      const right = new Vector3().crossVectors(Math.abs(normal.y) > .95 ? FORWARD : UP, normal).normalize()
      const tilt = (br() - .5) * MathUtils.degToRad(p.randomTilt)
      normal.applyAxisAngle(right, tilt)
      const up = new Vector3().crossVectors(normal, right).normalize()
      const spin = (br() - .5) * MathUtils.degToRad(p.randomRoll)
      right.applyAxisAngle(normal, spin)
      up.applyAxisAngle(normal, spin)
      const size = p.leafSize * (.76 + br() * .42) * leafScaleFactorAt(position, leafEdits)
      cards.push({
        position, right, up, normal,
        width: size * p.leafAspect, height: size,
        cell: Math.min(cells - 1, Math.floor(br() * cells)),
        shade: br(), spin,
      })
    }
  }
}

/** Distributes leaf cards over twigs and limbs, prunes against the envelope and orients them. */
export function distributeLeaves(limbs: Limb[], twigs: Twig[], env: Envelope, p: LeafParams, seed: number, shaping: LeafShaping = {}) {
  if (shaping.clumpMassMode && env.clumps.length > 0) {
    return distributeClumpMassLeaves(env, p, seed, shaping)
  }
  const radiusOf = shaping.radius ?? ((q: Vector3) => envelopeRadius(env, q))
  const cards: LeafCard[] = []
  const random = rng(seedFor(seed ^ p.leafSeed, 9100))
  const cells = p.atlasCols * p.atlasRows
  const useUniform = Boolean(shaping.uniformDensity)
  const occupancy = useUniform ? new LeafOccupancyGrid(Math.max(.08, p.leafSize * .32)) : undefined
  const activeTwigIds = new Set<number>()
  const leafEdits = shaping.leafEdits
  let pruned = 0

  const place = (
    point: Vector3,
    tangent: Vector3,
    k: number,
    along: number,
    tip: boolean,
    minGap = 0,
    twigId = -1,
    clumpIndex?: number,
  ): boolean => {
    // consume a fixed number of random values per anchor for stable layouts
    const r = Array.from({ length: 11 }, random)
    const manualClump = clumpIndex !== undefined && env.clumps[clumpIndex]?.manual ? env.clumps[clumpIndex] : undefined
    const position = point.clone().addScaledVector(randomUnit(r[0], r[1]), p.leafJitter * p.leafSize * .5 * r[2])
    const outward = envelopeNormal(env, position, p.normalSource)
    position.addScaledVector(outward, p.leafOffset * p.leafSize * .5)
    if (!manualClump) {
      const rho = radiusOf(position)
      // Measure outer pruning against the union of the envelope and local branch-anchored clump shells
      // so protruding outer lobes (like birch Y-fork limbs) are NEVER scalped bare!
      let outerRho = rho
      if (shaping.preserveClumpShells && env.clumps.length > 0 && outerRho > p.pruneOuter) {
        const shellScale = Math.max(1, p.clumpFillScale)
        let minClump = Infinity
        for (const cl of env.clumps) {
          const cr = clumpRadius(cl, position, shellScale)
          if (cr < minClump) minClump = cr
        }
        outerRho = Math.min(outerRho, minClump)
      }
      if (outerRho > p.pruneOuter || rho < p.pruneInner) { pruned++; return false }
      if (shaping.keep && !shaping.keep(position, r[9])) { pruned++; return false }
      if (occupancy && minGap > 0 && occupancy.tooClose(position, minGap)) { pruned++; return false }
    }
    if (leafEdits) {
      const pm = leafPruneMaskAt(position, leafEdits)
      if (pm > .92 || (pm > .04 && r[9] < pm)) { pruned++; return false }
    }
    const t = tangent.clone().normalize()
    const radial = anyPerpendicular(t).applyAxisAngle(t, k * golden + r[3] * .5)
    const angle = tip ? 0 : p.leafAngle * Math.PI / 180
    const up0 = t.clone().multiplyScalar(Math.cos(angle)).addScaledVector(radial, Math.sin(angle)).normalize()
    const width0 = new Vector3().crossVectors(t, radial).normalize()
    let normal = new Vector3().crossVectors(width0, up0).normalize()
    if (normal.dot(outward) < 0) normal.negate()
    normal.lerp(outward, p.faceOutward)
    if (normal.lengthSq() < 1e-6) normal.copy(outward)
    normal.normalize().lerp(UP, p.upAlign)
    if (normal.lengthSq() < 1e-6) normal.copy(UP)
    normal.normalize()
    if (p.randomTilt > 0) {
      const axis = anyPerpendicular(normal).applyAxisAngle(normal, r[4] * Math.PI * 2)
      normal.applyAxisAngle(axis, (r[5] * 2 - 1) * p.randomTilt * Math.PI / 180).normalize()
    }
    const up = up0.clone().addScaledVector(normal, -up0.dot(normal))
    if (up.lengthSq() < 1e-6) up.copy(anyPerpendicular(normal))
    up.normalize().applyAxisAngle(normal, (r[6] * 2 - 1) * p.randomRoll * Math.PI / 180)
    const right = new Vector3().crossVectors(up, normal).normalize()
    const scaleMul = (manualClump?.leafScale ?? 1) * leafScaleFactorAt(position, leafEdits)
    const size = p.leafSize * Math.max(.1, 1 + (r[7] * 2 - 1) * p.leafSizeVariance) * (1 + (p.leafTipScale - 1) * along) * scaleMul
    cards.push({
      position, right, up, normal, width: size * p.leafAspect, height: size,
      cell: Math.min(cells - 1, Math.floor(r[8] * cells)), shade: r[9], spin: (r[10] * 2 - 1) * p.randomRoll * Math.PI / 180,
      ...(clumpIndex !== undefined ? { clumpIndex } : {}),
    })
    occupancy?.add(position)
    if (twigId >= 0) activeTwigIds.add(twigId)
    return true
  }
  const twigGap = useUniform ? p.leafSize * .18 : 0
  const limbGap = useUniform ? p.leafSize * .24 : 0
  const clumpGap = useUniform ? p.leafSize * .26 : 0
  const along = (
    curve: { getPoint(t: number): Vector3; getTangent(t: number): Vector3 },
    count: number,
    start: number,
    tips: number,
    gap: number,
    twigId = -1,
  ) => {
    for (let k = 0; k < count; k++) {
      const t = clamp(start + (1 - start) * (k + .15 + random() * .7) / count)
      place(curve.getPoint(t), curve.getTangent(t), k, t, false, gap, twigId)
    }
    for (let k = 0; k < tips; k++) place(curve.getPoint(1), curve.getTangent(1), k + count, 1, true, gap * .75, twigId)
  }
  // 1. Place uniform clump-fill core & shell FIRST when uniformDensity is on so every branch cluster
  //    gets an even, hole-free painterly pillow before twig/limb accents fill in remaining spaces!
  const padFlatten = clamp(shaping.padFlatten ?? 0, 0, .85)
  const fillDepth = p.clumpFillDepth ** (1 - .7 * padFlatten)
  const fillRandom = rng(seedFor(seed ^ p.leafSeed, 9400))
  const emitClumpFill = () => {
    env.clumps.forEach((clump, i) => {
      const isManual = Boolean(clump.manual)
      const r = isManual ? clump.radii.clone() : clump.radii.clone().multiplyScalar(p.clumpFillScale)
      const a = (r.x * r.y) ** 1.6, b = (r.x * r.z) ** 1.6, c = (r.y * r.z) ** 1.6
      const area = 4 * Math.PI * ((a + b + c) / 3) ** (1 / 1.6)
      const fillRate = isManual ? Math.max(4.8, p.clumpFill) * clump.density : p.clumpFill
      const count = stochasticCount(fillRate * area, fillRandom)
      const offset = fillRandom() * Math.PI * 2
      for (let k = 0; k < count; k++) {
        const jitter = fillRandom(), depth = fillRandom(), spin = fillRandom()
        const y = 1 - 2 * (k + .2 + jitter * .6) / count
        const radial = Math.sqrt(Math.max(0, 1 - y * y)), theta = k * golden + offset
        const local = new Vector3(Math.cos(theta) * radial * r.x, y * r.y, Math.sin(theta) * radial * r.z)
        if (useUniform && fillDepth > .04) {
          // Dual-band stratified pillow: 72% crisp outer silhouette shell + 28% soft inner core (zero sky holes!)
          const radialScale = (k % 4 === 0)
            ? Math.max(.26, 1 - fillDepth * (.52 + .48 * depth))
            : (1 - fillDepth * .32 * depth)
          local.applyAxisAngle(UP, clump.yaw).multiplyScalar(radialScale)
        } else {
          local.applyAxisAngle(UP, clump.yaw).multiplyScalar(1 - fillDepth * depth)
        }
        const point = local.add(clump.center)
        if (!useUniform && !isManual) {
          // Legacy interior neighbor culling (replaced by 3D spatial hash in uniformDensity mode)
          const hidden = env.clumps.some((other, j) => j !== i && clumpRadius(other, point, p.clumpFillScale) < .82)
          if (hidden) { pruned++; continue }
        }
        const n = point.clone().sub(clump.center).normalize()
        const t = UP.clone().addScaledVector(n, -n.y)
        if (t.lengthSq() < 1e-4) t.copy(anyPerpendicular(n))
        t.normalize().applyAxisAngle(n, (spin - .5) * 1.2)
        place(point, t, k, .5, false, isManual ? 0 : clumpGap, -1, i)
      }
    })
  }

  if (useUniform) emitClumpFill()
  for (const twig of twigs) {
    along(twig.curve, stochasticCount(p.leavesPerTwig, random), p.leafStart, p.tipLeaves, twigGap, twig.id)
  }
  for (const limb of limbs) {
    if (limb.kind === 'trunk') continue
    const count = stochasticCount(p.limbLeafFrequency * limb.curve.getLength() * (1 - p.twigStart), random)
    along(limb.curve, count, p.twigStart, limb.kind === 'secondary' ? p.tipLeaves : 0, limbGap)
  }
  if (!useUniform) emitClumpFill()
  if (leafEdits?.brushes.length) {
    emitDensifyBrushCards(cards, env, p, seed, leafEdits, cells)
  }
  return { cards, pruned, activeTwigIds }
}

function clumpRadius(clump: Envelope['clumps'][number], point: Vector3, scale: number) {
  const local = point.clone().sub(clump.center).applyAxisAngle(UP, -clump.yaw)
  return Math.hypot(local.x / (clump.radii.x * scale), local.y / (clump.radii.y * scale), local.z / (clump.radii.z * scale))
}


/** Card insertion types ("插片方式"). Pure alpha leaf cards only (game-ready). */
export const cardTypes = ['quad', 'cross', 'tri', 'fan', 'strip', 'drape'] as const
export type CardType = typeof cardTypes[number]
export const cardTypeLabels: Record<CardType, string> = {
  quad: '单片', cross: '十字交叉', tri: '三向星形', fan: '扇形簇', strip: '沿枝条带', drape: '垂帘下挂（垂柳）',
}

interface Basis { right: Vector3; up: Vector3; normal: Vector3; offset: number }

/** Plane bases for one leaf card according to the insertion type. */
export function cardPlanes(card: LeafCard, p: LeafParams): Basis[] {
  const base: Basis = { right: card.right, up: card.up, normal: card.normal, offset: 0 }
  const aroundUp = (deg: number): Basis => {
    const a = deg * Math.PI / 180
    return { right: card.right.clone().applyAxisAngle(card.up, a), up: card.up, normal: card.normal.clone().applyAxisAngle(card.up, a), offset: 0 }
  }
  switch (p.cardType) {
    case 'cross': return [base, aroundUp(90)]
    case 'tri': return [base, aroundUp(60), aroundUp(120)]
    case 'fan': {
      const k = Math.max(2, Math.round(p.fanCount))
      return Array.from({ length: k }, (_, i) => {
        const a = (i / (k - 1) - .5) * p.fanSpread * Math.PI / 180
        const up = card.up.clone().applyAxisAngle(card.normal, a)
        const right = card.right.clone().applyAxisAngle(card.normal, a)
        const tilt = (i % 2 ? 1 : -1) * .2
        return { right, up: up.clone().applyAxisAngle(right, tilt), normal: card.normal.clone().applyAxisAngle(right, tilt), offset: i * .012 }
      })
    }
    default: return [base]
  }
}

/** Builds the card geometry: UVs (atlas cell), blended normals, tint/AO vertex colors. */
export function buildCardGeometry(cards: LeafCard[], env: Envelope, p: LeafParams, shaping: LeafShaping = {}) {
  const radiusOf = shaping.radius ?? ((q: Vector3) => envelopeRadius(env, q))
  const curved = !shaping.flat && (Math.abs(p.leafFold) > .001 || Math.abs(p.leafCurl) > .001)
  const nx = curved ? 2 : 1, ny = curved ? 2 : 1
  const perPlane = (nx + 1) * (ny + 1)
  const planes = cards.map(card => cardPlanes(card, p))
  const total = planes.reduce((s, list) => s + list.length, 0) * perPlane
  const positions = new Float32Array(total * 3)
  const normals = new Float32Array(total * 3)
  const uvs = new Float32Array(total * 2)
  const colors = new Float32Array(total * 3)
  const centers = new Float32Array(total * 3)
  const corners = new Float32Array(total * 2)
  const indices: number[] = []
  const inner = new Color(p.tintInner), outer = new Color(p.tintOuter)
  const color = new Color(), local = new Vector3(), world = new Vector3(), geo = new Vector3(), env3 = new Vector3()
  const regions = p.atlasRegions && p.atlasRegions.length > 0 ? p.atlasRegions : undefined
  const canopyRegions = regions ? regions.filter(r => r.role !== 'accent') : undefined
  const accentRegions = regions ? regions.filter(r => r.role === 'accent') : undefined
  const pickWeightedRegion = (pool: AtlasRegion[], hash01: number): AtlasRegion => {
    let totalW = 0
    for (const r of pool) totalW += Math.max(0.05, r.weight ?? 1)
    let acc = hash01 * totalW
    for (const r of pool) {
      acc -= Math.max(0.05, r.weight ?? 1)
      if (acc <= 0) return r
    }
    return pool[pool.length - 1]
  }

  const isAtlas = Boolean(regions) || p.atlasCols > 1 || p.atlasRows > 1
  const atlasPad = isAtlas ? .008 : 0
  let v = 0
  cards.forEach((card, c) => {
    const col = card.cell % p.atlasCols, row = Math.floor(card.cell / p.atlasCols)
    const hashBits = ((c * 2654435761 + Math.round(card.shade * 997)) >>> 0)
    const hash01 = (hashBits & 0xffff) / 65536
    // Non-uniform asymmetric atlas region selection: smaller tip/accent cards prefer small accent regions when present!
    let reg: AtlasRegion | undefined
    if (regions) {
      const wantAccent = Boolean(accentRegions?.length && canopyRegions?.length && (card.width < p.leafSize * 0.88 || (c % 5 === 0)))
      const pool = wantAccent ? accentRegions! : (canopyRegions?.length ? canopyRegions : regions)
      reg = pickWeightedRegion(pool, hash01)
    }
    // Multi-tile atlases get deterministic 50% horizontal mirror flip (effectively 2x silhouettes) + safe UV anti-bleed inset
    const flipU = isAtlas && (((c * 2654435761) >>> 31) === 1)
    const cardPivotY = reg?.anchorY !== undefined ? clamp(1 - reg.anchorY, 0.05, 0.95) : p.leafPivot
    const shade = 1 + (card.shade * 2 - 1) * p.tintVariance
    // Gentle warm-cool painterly shift softens repeating card boundaries into continuous cloud billows
    const warmShift = (card.shade - .5) * p.tintVariance * .24
    const cs = Math.cos(card.spin), sn = Math.sin(card.spin)
    for (const plane of planes[c]) {
      for (let j = 0; j <= ny; j++) {
        for (let i = 0; i <= nx; i++) {
          const u = i / nx, w = j / ny
          const x = (u - .5) * card.width
          const y = (w - cardPivotY) * card.height
          const fx = (u - .5) * 2
          const z = p.leafFold * Math.abs(fx) * card.width * .35 + p.leafCurl * w * w * card.height * .4 + plane.offset * card.height
          local.set(-p.leafFold * Math.sign(fx) * .7, -p.leafCurl * .8 * w, 1).normalize()
          world.copy(card.position).addScaledVector(plane.right, x).addScaledVector(plane.up, y).addScaledVector(plane.normal, z)
          geo.set(0, 0, 0).addScaledVector(plane.right, local.x).addScaledVector(plane.up, local.y)
            .addScaledVector(plane.normal, local.z).normalize()
          envelopeNormal(env, world, p.normalSource, env3)
          const n = geo.lerp(env3, p.normalSpherize)
          if (n.lengthSq() < 1e-8) n.copy(env3)
          n.normalize()
          positions.set([world.x, world.y, world.z], v * 3)
          normals.set([n.x, n.y, n.z], v * 3)
          centers.set([card.position.x, card.position.y, card.position.z], v * 3)
          corners.set([x * cs - y * sn, x * sn + y * cs], v * 2)
          if (reg) {
            const padX = Math.min(reg.w * 0.16, Math.max(0.002, reg.padding))
            const padY = Math.min(reg.h * 0.16, Math.max(0.002, reg.padding))
            const su = flipU ? (1 - u) : u
            const sv = 1 - w
            const uvX = reg.x + padX + su * (reg.w - 2 * padX)
            const uvYTop = reg.y + padY + sv * (reg.h - 2 * padY)
            uvs.set([uvX, 1 - uvYTop], v * 2)
          } else {
            const tu = isAtlas ? atlasPad + (flipU ? 1 - u : u) * (1 - 2 * atlasPad) : u
            const tv = isAtlas ? atlasPad + (1 - w) * (1 - 2 * atlasPad) : (1 - w)
            uvs.set([(col + tu) / p.atlasCols, 1 - (row + tv) / p.atlasRows], v * 2)
          }
          const colorMass = clamp(shaping.colorMass ?? 0)
          if (shaping.colorAt) {
            shaping.colorAt(world, c, color)
          } else {
            let rho = radiusOf(world)
            const hasFixedClump = card.clumpIndex !== undefined && env.clumps[card.clumpIndex] !== undefined
            let nearestClump = hasFixedClump ? env.clumps[card.clumpIndex!] : undefined
            let minClump = Infinity
            if (env.clumps.length > 0 && (rho < .9 || (colorMass > 1e-4 && !hasFixedClump))) {
              for (const clump of env.clumps) {
                const cr = clumpRadius(clump, world, 1)
                if (cr < minClump) {
                  minClump = cr
                  if (!hasFixedClump) nearestClump = clump
                }
              }
              if (rho < .9 && minClump > .72) rho = Math.max(rho, Math.min(1.02, minClump * .84))
            }
            const outerness = clamp((rho - .35) / .75)
            const occlusion = Math.max(.44, 1 - p.aoStrength * (1 - outerness) * .72 - p.aoStrength * clamp(-env3.y) * .22)
            color.copy(inner).lerp(outer, outerness).multiplyScalar(occlusion * shade)
            if (warmShift !== 0) {
              color.r = Math.max(0, color.r * (1 + warmShift * .65))
              color.g = Math.max(0, color.g * (1 + warmShift * .22))
              color.b = Math.max(0, color.b * (1 - warmShift * .55))
            }
            if (colorMass > 1e-4) {
              // Universal clump-local two-tone gouache color-mass shading: organizes each bough cluster
              // into a coherent sunlit pigment mass & cool shaded mass with a crisp painterly terminator!
              const pad = nearestClump
              const px = pad ? (world.x - pad.center.x) / Math.max(.05, pad.radii.x) : (world.x - env.center.x) / Math.max(.1, env.radii.x)
              const py = pad ? (world.y - pad.center.y) / Math.max(.05, pad.radii.y) : (world.y - env.center.y) / Math.max(.1, env.radii.y)
              const pz = pad ? (world.z - pad.center.z) / Math.max(.05, pad.radii.z) : (world.z - env.center.z) / Math.max(.1, env.radii.z)
              const cloud = Math.sin(px * 3.8 + pz * 2.1) * .12 + Math.sin(py * 5.4 - pz * 4.1 + px) * .09
              const sunlight = px * .34 + py * .66 + pz * .16 + cloud + (pad?.shade ?? 0)
              const base = MathUtils.smoothstep(sunlight, -.30, .77)
              const paintEdge = MathUtils.smoothstep(sunlight, .08, .26)
              const colorMix = clamp(.04 + base * .56 + paintEdge * .37 + (card.shade - .5) * p.tintVariance * .5)
              const massScale = 1 - p.aoStrength * .22 * (1 - base)
              const mr = MathUtils.lerp(inner.r, outer.r, colorMix) * massScale
              const mg = MathUtils.lerp(inner.g, outer.g, colorMix) * massScale
              const mb = MathUtils.lerp(inner.b, outer.b, colorMix) * massScale
              color.setRGB(
                MathUtils.lerp(color.r, mr, colorMass),
                MathUtils.lerp(color.g, mg, colorMass),
                MathUtils.lerp(color.b, mb, colorMass),
              )
            }
          }
          if (shaping.leafEdits) {
            const fixedClump = card.clumpIndex !== undefined ? env.clumps[card.clumpIndex] : undefined
            const manualHint: LeafClumpEdit | undefined = fixedClump?.manual && fixedClump.tint && (fixedClump.tintStrength ?? 0) > 0
              ? {
                  id: 0, position: [0, 0, 0], radius: 1, flatten: 0, density: 1, leafScale: 1,
                  tint: fixedClump.tint, tintStrength: fixedClump.tintStrength,
                }
              : undefined
            applyLeafTintAt(world, shaping.leafEdits, color, manualHint)
          }
          colors.set([color.r, color.g, color.b], v * 3)
          v++
        }
      }
      const base = v - perPlane
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const a = base + j * (nx + 1) + i, b = a + 1, cc = a + nx + 1, d = cc + 1
          indices.push(a, b, d, a, d, cc)
        }
      }
    }
  })
  return toGeometry(positions, normals, uvs, colors, centers, corners, indices)
}

function toGeometry(positions: Float32Array, normals: Float32Array, uvs: Float32Array, colors: Float32Array,
  centers: Float32Array, corners: Float32Array, indices: number[]) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  // camera-facing support (SpeedTree style facing leaves): pivot + local corner
  geometry.setAttribute('leafCenter', new BufferAttribute(centers, 3))
  geometry.setAttribute('leafCorner', new BufferAttribute(corners, 2))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return geometry
}

/** "Strip" insertion: one textured ribbon swept along each twig (texture v runs base -> tip). */
export function buildTwigStrips(twigs: Twig[], env: Envelope, p: LeafParams, seed: number, shaping: LeafShaping = {}) {
  const radiusOf = shaping.radius ?? ((q: Vector3) => envelopeRadius(env, q))
  const random = rng(seedFor(seed ^ p.leafSeed, 9700))
  const seg = shaping.flat ? 2 : 5
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], cen: number[] = [], cor: number[] = []
  const idx: number[] = []
  const inner = new Color(p.tintInner), outer = new Color(p.tintOuter), color = new Color()
  const envN = new Vector3()
  let strips = 0
  for (const twig of twigs) {
    const r = random(), shade = 1 + (random() * 2 - 1) * p.tintVariance
    const mid = twig.curve.getPoint(.6)
    const rho = radiusOf(mid)
    if (rho > p.pruneOuter || rho < p.pruneInner || (shaping.keep && !shaping.keep(mid, r))) continue
    const width = p.leafSize * p.leafAspect * .5 * (1 + (random() * 2 - 1) * p.leafSizeVariance)
    const start = pos.length / 3
    for (let i = 0; i <= seg; i++) {
      const s = i / seg, t = p.leafStart + (1 - p.leafStart) * s
      const c = twig.curve.getPoint(t), T = twig.curve.getTangent(t).normalize()
      envelopeNormal(env, c, p.normalSource, envN)
      const side = new Vector3().crossVectors(T, envN)
      if (side.lengthSq() < 1e-6) side.copy(anyPerpendicular(T))
      side.normalize()
      const face = new Vector3().crossVectors(side, T).normalize()
      const w = width * (.35 + .65 * Math.sin(Math.PI * Math.min(1, s * .9 + .1)))
      const outerness = clamp((radiusOf(c) - .35) / .75)
      color.copy(inner).lerp(outer, outerness).multiplyScalar((1 - p.aoStrength * (1 - outerness) * .75) * shade)
      for (const k of [0, 1]) {
        const q = c.clone().addScaledVector(side, (k ? -1 : 1) * w).addScaledVector(face, p.leafFold * w * .3)
        const n = face.clone().lerp(envN, p.normalSpherize).normalize()
        pos.push(q.x, q.y, q.z); nor.push(n.x, n.y, n.z); uv.push(k, s); col.push(color.r, color.g, color.b)
        cen.push(q.x, q.y, q.z); cor.push(0, 0)
      }
    }
    for (let i = 0; i < seg; i++) {
      const a = start + i * 2
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2)
    }
    strips++
  }
  const geometry = toGeometry(new Float32Array(pos), new Float32Array(nor), new Float32Array(uv), new Float32Array(col),
    new Float32Array(cen), new Float32Array(cor), idx)
  return { geometry, strips }
}

function mergeGeometry(a: BufferGeometry, b: BufferGeometry) {
  const names = ['position', 'normal', 'uv', 'color', 'leafCenter', 'leafCorner']
  const out = new BufferGeometry()
  const offset = a.getAttribute('position').count
  for (const name of names) {
    const x = a.getAttribute(name), y = b.getAttribute(name)
    const arr = new Float32Array(x.array.length + y.array.length)
    arr.set(x.array as Float32Array, 0)
    arr.set(y.array as Float32Array, x.array.length)
    out.setAttribute(name, new BufferAttribute(arr, x.itemSize))
  }
  const ia = Array.from(a.getIndex()!.array), ib = Array.from(b.getIndex()!.array, i => i + offset)
  out.setIndex([...ia, ...ib])
  out.computeBoundingSphere()
  out.computeBoundingBox()
  a.dispose(); b.dispose()
  return out
}

interface DrapeAnchor {
  pos: Vector3
  radialXZ: Vector3
  dropLen: number
  width: number
  cell: number
  shade: number
  yawJitter: number
  swayDir: number
}

/** Place individual hanging spray anchors along the edited branch skeleton (optimize-independent). */
function placeDrapeAnchors(
  limbs: Limb[],
  twigs: Twig[],
  env: Envelope,
  p: LeafParams,
  seed: number,
  shaping: LeafShaping,
): { rawAnchors: DrapeAnchor[]; pruned: number } {
  const radiusOf = shaping.radius ?? ((q: Vector3) => envelopeRadius(env, q))
  const random = rng(seedFor(seed ^ p.leafSeed, 9850))
  const cells = p.atlasCols * p.atlasRows
  const envMinY = env.center.y - env.radii.y
  const envHeight = Math.max(.5, env.radii.y * 2)

  const rawAnchors: DrapeAnchor[] = []
  let pruned = 0

  const addAnchor = (pos: Vector3, direction: Vector3, dropBoost: number) => {
    const shade = random(), azimuth = random(), length = random(), clearance = random(), sway = random()
    const rho = radiusOf(pos)
    if (rho > p.pruneOuter * 1.12 || rho < p.pruneInner) { pruned++; return }
    if (shaping.keep && !shaping.keep(pos, shade)) { pruned++; return }

    const radialXZ = new Vector3(pos.x - env.center.x, 0, pos.z - env.center.z)
    if (radialXZ.lengthSq() < 1e-5) radialXZ.set(Math.cos(azimuth * Math.PI * 2), 0, Math.sin(azimuth * Math.PI * 2))
    else radialXZ.normalize()
    direction.y = 0
    if (direction.lengthSq() > 1e-5) {
      direction.normalize()
      if (direction.dot(radialXZ) > -.15) radialXZ.lerp(direction, .4).normalize()
    }

    const heightFrac = clamp((pos.y - envMinY) / envHeight)
    const outerness = clamp((rho - .25) / .78)

    const crownLength = (.74 + .33 * Math.sin(heightFrac * Math.PI)) * (.75 + .45 * outerness)
    const variance = 1 + (length * 2 - 1) * p.leafSizeVariance
    const wantedDrop = p.leafSize * dropBoost * crownLength * variance
    const dropLen = Math.min(wantedDrop, pos.y - (.18 + clearance * .32))
    if (dropLen < .22) { pruned++; return }

    const width = dropLen * p.leafAspect * (.86 + sway * .24)
    rawAnchors.push({
      pos,
      radialXZ,
      dropLen,
      width,
      cell: Math.min(cells - 1, Math.floor(clearance * cells)),
      shade,
      yawJitter: (azimuth - .5) * 2.5,
      swayDir: (sway - .5) * 2,
    })
  }

  // Fill the crown along real branches so rotating the tree reveals connected sprays and open space.
  const branchRate = p.limbLeafFrequency * .45 + Math.sqrt(p.clumpFill) * .35
  for (const limb of limbs) {
    if (limb.kind === 'trunk') continue
    const len = limb.curve.getLength()
    const count = stochasticCount(len * branchRate * (limb.kind === 'secondary' ? 1.2 : .85), random)
    for (let k = 0; k < count; k++) {
      const t = .28 + .72 * (k + .2 + random() * .6) / count
      addAnchor(limb.curve.getPointAt(t), limb.curve.getTangentAt(t), .92 + .50 * t)
    }
    if (count > 0 && limb.kind === 'primary') {
      addAnchor(limb.curve.getPoint(1), limb.curve.getTangent(1), .86)
    }
  }

  // 2. Anchors along drooping twig ends
  const twigRate = clamp(p.leavesPerTwig / 8, 0, 2)
  for (const twig of twigs) {
    const count = stochasticCount(twigRate, random)
    for (let k = 0; k < count; k++) {
      const t = .55 + .45 * (k + .3 + random() * .5) / count
      addAnchor(twig.curve.getPoint(t), twig.curve.getTangent(t), .85 + .25 * t)
    }
  }

  return { rawAnchors, pruned }
}

/** Deterministic zero-RNG mesh builder from cached hanging drape spray anchors. */
function buildDrapeGeometry(
  rawAnchors: DrapeAnchor[],
  twigs: Twig[],
  env: Envelope,
  p: LeafParams,
  pruned: number,
  shaping: LeafShaping,
) {
  const radiusOf = shaping.radius ?? ((q: Vector3) => envelopeRadius(env, q))

  // Thin sprays at lower LODs without closing the spaces between them.
  const reduce = clamp(shaping.reduce ?? 0, 0, .78)
  let anchors = rawAnchors
  let widthBoost = 1
  if (reduce > 0 && rawAnchors.length > 0) {
    const keep = 1 - reduce
    widthBoost = Math.min(1.32, (1 / keep) ** .23)
    anchors = []
    for (let i = 0; i < rawAnchors.length; i++) {
      if (i === 0 || Math.floor(i * keep) !== Math.floor((i - 1) * keep)) anchors.push(rawAnchors[i])
    }
  }

  // One curved surface per spray, with UV v running from attachment to tip.
  const ny = shaping.flat ? 2 : 4
  const perPlane = 2 * (ny + 1)
  const totalVerts = anchors.length * perPlane

  const positions = new Float32Array(totalVerts * 3)
  const normals = new Float32Array(totalVerts * 3)
  const uvs = new Float32Array(totalVerts * 2)
  const colors = new Float32Array(totalVerts * 3)
  const centers = new Float32Array(totalVerts * 3)
  const corners = new Float32Array(totalVerts * 2)
  const indices: number[] = []
  const cards: LeafCard[] = []

  const inner = new Color(p.tintInner), outer = new Color(p.tintOuter), col = new Color()
  const envN = new Vector3(), tangentXZ = new Vector3(), right = new Vector3(), faceN = new Vector3(), nVec = new Vector3()
  const world = new Vector3()
  const archBase = .22 + Math.max(0, -p.leafCurl) * .24
  const DOWN = new Vector3(0, -1, 0)

  let v = 0
  for (const anc of anchors) {
    const atlasCol = anc.cell % p.atlasCols
    const atlasRow = Math.floor(anc.cell / p.atlasCols)
    const shade = 1 + (anc.shade * 2 - 1) * p.tintVariance
    const halfW = anc.width * widthBoost * .5
    tangentXZ.set(-anc.radialXZ.z, 0, anc.radialXZ.x)

    // Record representative outward-facing site for optional flower decoration compatibility
    const midPos = anc.pos.clone().addScaledVector(DOWN, anc.dropLen * .42).addScaledVector(anc.radialXZ, anc.dropLen * .08)
    cards.push({
      position: midPos,
      right: tangentXZ.clone(),
      up: DOWN.clone(),
      normal: anc.radialXZ.clone(),
      width: anc.width * widthBoost,
      height: anc.dropLen,
      cell: anc.cell,
      shade: anc.shade,
      spin: 0,
    })

    const ang = anc.yawJitter
    const ca = Math.cos(ang), sa = Math.sin(ang)
    // Vary the spray orientation around the branch for coverage from different views.
    right.set(
      tangentXZ.x * ca + anc.radialXZ.x * sa,
      0,
      tangentXZ.z * ca + anc.radialXZ.z * sa,
    ).normalize()
    faceN.set(
      anc.radialXZ.x * ca - tangentXZ.x * sa,
      .12,
      anc.radialXZ.z * ca - tangentXZ.z * sa,
    ).normalize()

    const base = v
    for (let j = 0; j <= ny; j++) {
      const s = j / ny // 0 = branch anchor (top), 1 = trailing tip (bottom)
      // Start with a gentle outward arc, then steepen the fall toward the tip.
      const outPush = anc.dropLen * (archBase * Math.sin(s * Math.PI * .56) + Math.max(0, -p.leafCurl) * .08 * s * s)
      const sway = anc.dropLen * .14 * Math.sin(s * Math.PI * .86) * anc.swayDir
      const cx = anc.pos.x + anc.radialXZ.x * outPush + tangentXZ.x * sway
      const dropCurve = s * (.48 + .52 * s)
      const cy = anc.pos.y - anc.dropLen * dropCurve
      const cz = anc.pos.z + anc.radialXZ.z * outPush + tangentXZ.z * sway
      // Narrow the spray at the attachment and the tip.
      const wScale = .68 + .38 * Math.sin(Math.min(1, s * 1.08 + .08) * Math.PI)
      const hw = halfW * wScale
      const foldOffset = p.leafFold * hw * .35 * s

      for (let i = 0; i <= 1; i++) {
        const side = i === 0 ? -1 : 1
        world.set(
          cx + right.x * side * hw + faceN.x * foldOffset,
          cy,
          cz + right.z * side * hw + faceN.z * foldOffset,
        )
        envelopeNormal(env, world, p.normalSource, envN)
        nVec.copy(faceN).lerp(envN, p.normalSpherize)
        if (nVec.lengthSq() < 1e-8) nVec.copy(envN)
        nVec.normalize()

        positions[v * 3] = world.x
        positions[v * 3 + 1] = world.y
        positions[v * 3 + 2] = world.z
        normals[v * 3] = nVec.x
        normals[v * 3 + 1] = nVec.y
        normals[v * 3 + 2] = nVec.z
        centers[v * 3] = world.x
        centers[v * 3 + 1] = world.y
        centers[v * 3 + 2] = world.z
        corners[v * 2] = 0
        corners[v * 2 + 1] = 0
        // UV: s=0 (top anchor) -> v=1 (top of texture); s=1 (trailing tip) -> v=0 (bottom of texture)
        uvs[v * 2] = (atlasCol + (anc.swayDir < 0 ? 1 - i : i)) / p.atlasCols
        uvs[v * 2 + 1] = 1 - (atlasRow + s) / p.atlasRows

        const rho = radiusOf(world)
        const outMix = clamp((rho - .28) / .78)
        // Slightly deeper green inside upper boughs, brighter translucent sunlit green along hanging tips
        const tipLift = .84 + .22 * s
        const occlusion = (1 - p.aoStrength * (1 - outMix) * .72 - p.aoStrength * clamp(-envN.y) * .16) * tipLift
        col.copy(inner).lerp(outer, clamp(outMix * .78 + s * .24)).multiplyScalar(occlusion * shade)
        if (shaping.leafEdits) applyLeafTintAt(world, shaping.leafEdits, col)
        colors[v * 3] = col.r
        colors[v * 3 + 1] = col.g
        colors[v * 3 + 2] = col.b
        v++
      }
    }
    for (let j = 0; j < ny; j++) {
      const a = base + j * 2, b = a + 1, c0 = a + 2, d = a + 3
      indices.push(a, b, d, a, d, c0)
    }
  }

  const geometry = toGeometry(positions, normals, uvs, colors, centers, corners, indices)
  return { twigs, envelope: env, cards, pruned, geometry, strips: 0 }
}

/** Cached unreduced broadleaf placement (twigs + envelope + unthinned LeafCard[] / DrapeAnchor[]).
 *  Decouples expensive skeleton/spatial-hash placement from fast zero-RNG LOD remeshing. */
export interface LeafPlacementCache {
  mode: 'cards' | 'drape'
  twigs: Twig[]
  keepTwigsAll: Twig[]
  envelope: Envelope
  pruned: number
  params: LeafParams
  cardParams: LeafParams
  seed: number
  shapingBase: LeafShaping
  strip: boolean
  rawCards?: LeafCard[]
  rawDrapeAnchors?: DrapeAnchor[]
}

/** Runs twig generation, envelope fitting, and full unreduced leaf/drape placement once. */
export function computeLeafPlacement(
  growth: { limbs: Limb[]; clusters: CrownCluster[]; config: { seed: number } },
  params: LeafParams,
  shaping: LeafShaping = {},
): LeafPlacementCache {
  const seed = growth.config.seed
  const twigs = generateTwigs(growth.limbs, params, seed)
  const mergedClusters = shaping.leafEdits?.clumps.length
    ? [...growth.clusters, ...shaping.leafEdits.clumps.map(clumpToCrownCluster)]
    : growth.clusters
  const envelope = fitEnvelope(twigs, growth.limbs, mergedClusters, params)
  const shapingBase: LeafShaping = { ...shaping }
  delete shapingBase.flat
  delete shapingBase.reduce

  if (params.cardType === 'drape') {
    const { rawAnchors, pruned } = placeDrapeAnchors(growth.limbs, twigs, envelope, params, seed, shapingBase)
    return {
      mode: 'drape',
      twigs,
      keepTwigsAll: twigs,
      envelope,
      pruned,
      params,
      cardParams: params,
      seed,
      shapingBase,
      strip: false,
      rawDrapeAnchors: rawAnchors,
    }
  }

  const strip = params.cardType === 'strip'
  const cardParams = strip ? { ...params, leavesPerTwig: 0, tipLeaves: 0, cardType: 'quad' as const } : params
  const { cards: rawCards, pruned, activeTwigIds } = distributeLeaves(growth.limbs, twigs, envelope, cardParams, seed, shapingBase)
  // Omit orphaned bare twig sticks whose leaves were all pruned/culled (prevents dead needle spikes on foliage branches!)
  const keepTwigsAll = (!strip && !shapingBase.clumpMassMode && shapingBase.uniformDensity && (params.leavesPerTwig > 0 || params.tipLeaves > 0))
    ? twigs.filter(t => activeTwigIds.has(t.id))
    : twigs

  return {
    mode: 'cards',
    twigs,
    keepTwigsAll,
    envelope,
    pruned,
    params,
    cardParams,
    seed,
    shapingBase,
    strip,
    rawCards,
  }
}

/** Deterministic zero-RNG LOD remeshing from a cached `LeafPlacementCache` (100% aligned silhouettes across LOD0-LOD3). */
export function remeshLeafPlacement(
  cache: LeafPlacementCache,
  opt: { flat?: boolean; reduce?: number } = {},
) {
  const shaping: LeafShaping = { ...cache.shapingBase, flat: opt.flat, reduce: opt.reduce }
  if (cache.mode === 'drape') {
    return buildDrapeGeometry(cache.rawDrapeAnchors!, cache.twigs, cache.envelope, cache.params, cache.pruned, shaping)
  }
  const rawCards = cache.rawCards!
  const reduce = clamp(opt.reduce ?? 0, 0, .78)
  let cards = rawCards
  if (reduce > 0 && rawCards.length > 0) {
    // Stratified Bresenham thinning keeps coverage uniform across twigs and clumps,
    // while area-preserving scale boost keeps canopy fullness intact.
    const keep = 1 - reduce
    const scale = Math.min(1.85, (1 / keep) ** .46)
    cards = []
    for (let i = 0; i < rawCards.length; i++) {
      if (i === 0 || Math.floor(i * keep) !== Math.floor((i - 1) * keep)) {
        const c = rawCards[i]
        cards.push({ ...c, width: c.width * scale, height: c.height * scale })
      }
    }
  }
  let geometry = buildCardGeometry(cards, cache.envelope, cache.cardParams, shaping)
  let strips = 0
  if (cache.strip) {
    const keepTwigs = reduce > 0
      ? cache.twigs.filter((_, i) => i === 0 || Math.floor(i * (1 - reduce)) !== Math.floor((i - 1) * (1 - reduce)))
      : cache.twigs
    const s = buildTwigStrips(keepTwigs, cache.envelope, cache.params, cache.seed, shaping)
    strips = s.strips
    geometry = mergeGeometry(geometry, s.geometry)
  }
  return { twigs: cache.keepTwigsAll, envelope: cache.envelope, cards, pruned: cache.pruned, geometry, strips }
}

export function generateLeafCards(growth: { limbs: Limb[]; clusters: CrownCluster[]; config: { seed: number } },
  params: LeafParams, shaping: LeafShaping = {}) {
  const cache = computeLeafPlacement(growth, params, shaping)
  return { ...remeshLeafPlacement(cache, { flat: shaping.flat, reduce: shaping.reduce }), cache }
}
