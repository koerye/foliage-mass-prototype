// SpeedTree-style leaf card distribution.
//
// Pipeline: branch skeleton (growth.ts) -> generated twigs (level 3) ->
// leaf anchors on twigs and limbs -> crown envelope (data-driven ellipsoid +
// soft clump field) -> pruning, orientation, card mesh with blended normals.
// The leaf look itself comes from a user supplied alpha texture.
import {
  BufferAttribute, BufferGeometry, Color, QuadraticBezierCurve3, Vector3,
} from 'three'
import { clamp, rng, seedFor } from '../shape'
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
}
/** Optional external crown model: normalized radius (1 = surface) and a keep mask (bare zones). */
export interface LeafShaping {
  radius?: (p: Vector3) => number
  keep?: (p: Vector3, random: number) => boolean
  flat?: boolean
  reduce?: number
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
  leafSeed: number
}

type NumericKey = { [K in keyof LeafParams]: LeafParams[K] extends number ? K : never }[keyof LeafParams]
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
    if (!(cardTypes as readonly string[]).includes(data.cardType as string)) throw new Error('未知插片方式')
    result.cardType = data.cardType as CardType
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
}

export interface Envelope {
  center: Vector3
  radii: Vector3
  clumps: { center: Vector3; sigma: number; radii: Vector3; yaw: number }[]
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
  return target.multiplyScalar(.45).addScaledVector(field, .55).normalize()
}

function randomUnit(u: number, v: number) {
  const z = u * 2 - 1, a = v * Math.PI * 2, s = Math.sqrt(1 - z * z)
  return new Vector3(s * Math.cos(a), z, s * Math.sin(a))
}

/** Distributes leaf cards over twigs and limbs, prunes against the envelope and orients them. */
export function distributeLeaves(limbs: Limb[], twigs: Twig[], env: Envelope, p: LeafParams, seed: number, shaping: LeafShaping = {}) {
  const radiusOf = shaping.radius ?? ((q: Vector3) => envelopeRadius(env, q))
  const cards: LeafCard[] = []
  const random = rng(seedFor(seed ^ p.leafSeed, 9100))
  const cells = p.atlasCols * p.atlasRows
  let pruned = 0
  const place = (point: Vector3, tangent: Vector3, k: number, along: number, tip: boolean) => {
    // consume a fixed number of random values per anchor for stable layouts
    const r = Array.from({ length: 11 }, random)
    const position = point.clone().addScaledVector(randomUnit(r[0], r[1]), p.leafJitter * p.leafSize * .5 * r[2])
    const outward = envelopeNormal(env, position, p.normalSource)
    position.addScaledVector(outward, p.leafOffset * p.leafSize * .5)
    const rho = radiusOf(position)
    if (rho > p.pruneOuter || rho < p.pruneInner) { pruned++; return }
    if (shaping.keep && !shaping.keep(position, r[9])) { pruned++; return }
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
    const size = p.leafSize * Math.max(.1, 1 + (r[7] * 2 - 1) * p.leafSizeVariance) * (1 + (p.leafTipScale - 1) * along)
    cards.push({
      position, right, up, normal, width: size * p.leafAspect, height: size,
      cell: Math.min(cells - 1, Math.floor(r[8] * cells)), shade: r[9], spin: (r[10] * 2 - 1) * p.randomRoll * Math.PI / 180,
    })
  }
  const along = (curve: { getPoint(t: number): Vector3; getTangent(t: number): Vector3 }, count: number, start: number, tips: number) => {
    for (let k = 0; k < count; k++) {
      const t = clamp(start + (1 - start) * (k + .15 + random() * .7) / count)
      place(curve.getPoint(t), curve.getTangent(t), k, t, false)
    }
    for (let k = 0; k < tips; k++) place(curve.getPoint(1), curve.getTangent(1), k + count, 1, true)
  }
  for (const twig of twigs) {
    along(twig.curve, stochasticCount(p.leavesPerTwig, random), p.leafStart, p.tipLeaves)
  }
  for (const limb of limbs) {
    if (limb.kind === 'trunk') continue
    const count = stochasticCount(p.limbLeafFrequency * limb.curve.getLength() * (1 - p.twigStart), random)
    along(limb.curve, count, p.twigStart, limb.kind === 'secondary' ? p.tipLeaves : 0)
  }
  // Clump shell fill: SpeedTree "mesh force"/hull style coverage. Points are
  // sampled on the union surface of the (inflated) crown clumps so the crown
  // reads as soft masses without holes, independent of twig randomness.
  const fillRandom = rng(seedFor(seed ^ p.leafSeed, 9400))
  env.clumps.forEach((clump, i) => {
    const r = clump.radii.clone().multiplyScalar(p.clumpFillScale)
    const a = (r.x * r.y) ** 1.6, b = (r.x * r.z) ** 1.6, c = (r.y * r.z) ** 1.6
    const area = 4 * Math.PI * ((a + b + c) / 3) ** (1 / 1.6)
    const count = stochasticCount(p.clumpFill * area, fillRandom)
    const offset = fillRandom() * Math.PI * 2
    for (let k = 0; k < count; k++) {
      const jitter = fillRandom(), depth = fillRandom(), spin = fillRandom()
      const y = 1 - 2 * (k + .2 + jitter * .6) / count
      const radial = Math.sqrt(Math.max(0, 1 - y * y)), theta = k * golden + offset
      const local = new Vector3(Math.cos(theta) * radial * r.x, y * r.y, Math.sin(theta) * radial * r.z)
      local.applyAxisAngle(UP, clump.yaw).multiplyScalar(1 - p.clumpFillDepth * depth)
      const point = local.add(clump.center)
      // hidden inside a neighbouring clump -> skip (interior culling of the union)
      const hidden = env.clumps.some((other, j) => j !== i && clumpRadius(other, point, p.clumpFillScale) < .82)
      if (hidden) { pruned++; continue }
      const n = point.clone().sub(clump.center).normalize()
      const t = UP.clone().addScaledVector(n, -n.y)
      if (t.lengthSq() < 1e-4) t.copy(anyPerpendicular(n))
      t.normalize().applyAxisAngle(n, (spin - .5) * 1.2)
      place(point, t, k, .5, false)
    }
  })
  return { cards, pruned }
}

function clumpRadius(clump: Envelope['clumps'][number], point: Vector3, scale: number) {
  const local = point.clone().sub(clump.center).applyAxisAngle(UP, -clump.yaw)
  return Math.hypot(local.x / (clump.radii.x * scale), local.y / (clump.radii.y * scale), local.z / (clump.radii.z * scale))
}


/** Card insertion types ("插片方式"). */
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
  let v = 0
  cards.forEach((card, c) => {
    const col = card.cell % p.atlasCols, row = Math.floor(card.cell / p.atlasCols)
    const shade = 1 + (card.shade * 2 - 1) * p.tintVariance
    const cs = Math.cos(card.spin), sn = Math.sin(card.spin)
    for (const plane of planes[c]) {
      for (let j = 0; j <= ny; j++) {
        for (let i = 0; i <= nx; i++) {
          const u = i / nx, w = j / ny
          const x = (u - .5) * card.width
          const y = (w - p.leafPivot) * card.height
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
          uvs.set([(col + u) / p.atlasCols, 1 - (row + 1 - w) / p.atlasRows], v * 2)
          let rho = radiusOf(world)
          if (env.clumps.length > 0 && rho < .9) {
            // On asymmetric or node-edited crowns, an exposed exterior clump skin may sit inside
            // the global bounding ellipsoid. Lift outerness by local clump-surface exposure so
            // exterior lobes never collapse into dark interior AO.
            let minClump = Infinity
            for (const clump of env.clumps) {
              const cr = clumpRadius(clump, world, 1)
              if (cr < minClump) minClump = cr
            }
            if (minClump > .72) rho = Math.max(rho, Math.min(1.02, minClump * .84))
          }
          const outerness = clamp((rho - .35) / .75)
          const occlusion = Math.max(.44, 1 - p.aoStrength * (1 - outerness) * .72 - p.aoStrength * clamp(-env3.y) * .22)
          color.copy(inner).lerp(outer, outerness).multiplyScalar(occlusion * shade)
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

/** Dedicated gravity-hanging curtain algorithm ("垂帘下挂") for weeping willows & cascading vines.
 *  Strictly isolated from standard broadleaf card modes: every strand anchors at a high limb/dome point
 *  and hangs vertically downward (-Y) with gentle outward fountain arch, ground clearance, and crossed
 *  dual-curtain depth so the silhouette reads as cascading curtains from every camera angle. */
function buildDrapeCurtains(
  limbs: Limb[],
  twigs: Twig[],
  env: Envelope,
  p: LeafParams,
  seed: number,
  shaping: LeafShaping,
) {
  const radiusOf = shaping.radius ?? ((q: Vector3) => envelopeRadius(env, q))
  const random = rng(seedFor(seed ^ p.leafSeed, 9850))
  const cells = p.atlasCols * p.atlasRows
  const envMinY = env.center.y - env.radii.y
  const envHeight = Math.max(.5, env.radii.y * 2)

  interface DrapeAnchor {
    pos: Vector3
    radialXZ: Vector3
    dropLen: number
    width: number
    cell: number
    shade: number
    yawJitter: number
    swayDir: number
    outerness: number
  }

  const rawAnchors: DrapeAnchor[] = []
  let pruned = 0

  const addAnchor = (rawPos: Vector3, dropBoost: number, isDome: boolean) => {
    const r = [random(), random(), random(), random(), random(), random(), random(), random()]
    const pos = rawPos.clone()
    pos.x += (r[0] - .5) * p.leafJitter * p.leafSize * .34
    pos.y += (r[1] - .5) * p.leafJitter * p.leafSize * .18
    pos.z += (r[2] - .5) * p.leafJitter * p.leafSize * .34
    const rho = radiusOf(pos)
    if (rho > p.pruneOuter * 1.12 || rho < p.pruneInner) { pruned++; return }
    if (shaping.keep && !shaping.keep(pos, r[3])) { pruned++; return }

    const radialXZ = new Vector3(pos.x - env.center.x, 0, pos.z - env.center.z)
    if (radialXZ.lengthSq() < 1e-5) radialXZ.set(Math.cos(r[4] * Math.PI * 2), 0, Math.sin(r[4] * Math.PI * 2))
    else radialXZ.normalize()

    const heightFrac = clamp((pos.y - envMinY) / envHeight)
    const outerness = clamp((rho - .25) / .78)

    // Cascading curtain length profile:
    // - outer mid-to-upper canopy hangs longest (classic weeping willow waterfall)
    // - very top dome cap is slightly shorter to bridge softly without flat-top banding
    // - lower inner canopy stays shorter so trunk arch stays readable
    const domeFactor = heightFrac > .84
      ? .68 + (1 - heightFrac) * 2.0
      : (.72 + .62 * Math.sin(Math.min(1, heightFrac * 1.15) * Math.PI * .78)) * (.72 + .48 * outerness)
    const variance = Math.max(.35, 1 + (r[5] * 2 - 1) * Math.max(.22, p.leafSizeVariance))
    const wantedDrop = p.leafSize * dropBoost * domeFactor * variance
    // Never let trailing tips clip below ground plane (keep graceful clearance above y = 0)
    const maxClearDrop = Math.max(.28, pos.y - (.16 + r[6] * .28))
    const dropLen = Math.min(wantedDrop, maxClearDrop)
    if (dropLen < .22) { pruned++; return }

    const width = p.leafSize * p.leafAspect * (isDome ? .96 : .84) * (.76 + .28 * Math.min(1.5, dropLen / Math.max(.3, p.leafSize)))
    rawAnchors.push({
      pos,
      radialXZ,
      dropLen,
      width,
      cell: Math.min(cells - 1, Math.floor(r[6] * cells)),
      shade: r[3],
      yawJitter: (r[4] - .5) * .65,
      swayDir: (r[7] - .5) * 2,
      outerness,
    })
  }

  // 1. Anchors along outer arching limbs & secondary branches (tight branch-to-curtain connection)
  for (const limb of limbs) {
    if (limb.kind === 'trunk') continue
    const len = limb.curve.getLength()
    const count = stochasticCount(Math.max(2, len * (limb.kind === 'secondary' ? 3.2 : 2.4)), random)
    for (let k = 0; k < count; k++) {
      const t = clamp(.28 + .72 * (k + .2 + random() * .6) / Math.max(1, count))
      addAnchor(limb.curve.getPoint(t), .92 + .52 * t, false)
    }
    // Extra lush waterfall tuft right at arching branch tip
    addAnchor(limb.curve.getPoint(1), 1.38, false)
  }

  // 2. Anchors along drooping twig ends
  const twigRate = clamp(p.leavesPerTwig / 6.5, .25, 2.2)
  for (const twig of twigs) {
    const count = stochasticCount(twigRate, random)
    for (let k = 0; k < count; k++) {
      const t = clamp(.55 + .45 * (k + .3 + random() * .5) / Math.max(1, count))
      addAnchor(twig.curve.getPoint(t), 1.05 + .25 * t, false)
    }
  }

  // 3. Upper & outer dome shell anchors across canopy clumps (never upside-down!)
  const domeRng = rng(seedFor(seed ^ p.leafSeed, 9910))
  env.clumps.forEach((clump, i) => {
    const r = clump.radii.clone().multiplyScalar(p.clumpFillScale * .95)
    const a = (r.x * r.y) ** 1.6, b = (r.x * r.z) ** 1.6, c = (r.y * r.z) ** 1.6
    const area = 4 * Math.PI * ((a + b + c) / 3) ** (1 / 1.6)
    const count = stochasticCount(p.clumpFill * area * .55, domeRng)
    const offset = domeRng() * Math.PI * 2
    for (let k = 0; k < count; k++) {
      const jitter = domeRng(), depth = domeRng()
      // Sample upper dome & outer skirt (-0.18..0.98), skipping flat underside so curtains drape DOWN
      const y = .98 - 1.16 * (k + .2 + jitter * .6) / Math.max(1, count)
      const radial = Math.sqrt(Math.max(0, 1 - y * y))
      const theta = k * golden + offset
      const local = new Vector3(Math.cos(theta) * radial * r.x, y * r.y, Math.sin(theta) * radial * r.z)
      local.applyAxisAngle(UP, clump.yaw).multiplyScalar(1 - p.clumpFillDepth * .7 * depth)
      const point = local.add(clump.center)
      const hidden = env.clumps.some((other, j) => j !== i && clumpRadius(other, point, p.clumpFillScale * .95) < .84)
      if (hidden) { pruned++; continue }
      addAnchor(point, 1.08 + .32 * Math.max(0, 1 - Math.abs(y - .2)), true)
    }
  })

  // Apply LOD thinning with area-preserving width compensation
  const reduce = clamp(shaping.reduce ?? 0, 0, .78)
  let anchors = rawAnchors
  let widthBoost = 1
  if (reduce > 0 && rawAnchors.length > 0) {
    const keep = 1 - reduce
    widthBoost = Math.min(1.8, (1 / keep) ** .44)
    anchors = []
    for (let i = 0; i < rawAnchors.length; i++) {
      if (i === 0 || Math.floor(i * keep) !== Math.floor((i - 1) * keep)) anchors.push(rawAnchors[i])
    }
  }

  // Build crossed vertical hanging curtain ribbons (v = 1 top branch anchor -> v = 0 trailing tip)
  const ny = shaping.flat ? 2 : 4
  const planesPerAnchor = shaping.flat && reduce > .45 ? 1 : 2
  const perPlane = 2 * (ny + 1)
  const totalVerts = anchors.length * planesPerAnchor * perPlane

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
  const archBase = .12 + Math.max(0, -p.leafCurl) * .22
  const planeAngles = planesPerAnchor === 1 ? [0] : [-.62, .62] // ~71 deg crossed V-curtains for 360-deg fullness
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

    for (const relAngle of planeAngles) {
      const ang = relAngle + anc.yawJitter
      const ca = Math.cos(ang), sa = Math.sin(ang)
      // Horizontal ribbon width axis & outward face normal (strictly vertical curtain!)
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
        // Graceful fountain arch: starts gently curved over the dome shoulder then drops vertically
        const outPush = anc.dropLen * (archBase * Math.sin(s * Math.PI * .75) + Math.max(0, -p.leafCurl) * .08 * s * s)
        const sway = anc.dropLen * .045 * Math.sin(s * Math.PI * 1.15) * anc.swayDir
        const cx = anc.pos.x + anc.radialXZ.x * outPush + tangentXZ.x * sway
        // Soft fountain shoulder curve: gentle easing near top s=0..0.25 so dome top is velvety & rounded
        const dropCurve = s < .25 ? s * (.72 + 1.12 * s) : s
        const cy = Math.max(.08, anc.pos.y - anc.dropLen * dropCurve)
        const cz = anc.pos.z + anc.radialXZ.z * outPush + tangentXZ.z * sway
        // Narrower at branch root (s=0) widening into full curtain then tapering softly at tip
        const wScale = .68 + .38 * Math.sin(Math.min(1, s * 1.08 + .08) * Math.PI)
        const hw = halfW * wScale
        const foldOffset = p.leafFold * hw * .35

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
          uvs[v * 2] = (atlasCol + i) / p.atlasCols
          uvs[v * 2 + 1] = 1 - (atlasRow + s) / p.atlasRows

          const rho = radiusOf(world)
          const outMix = clamp((rho - .28) / .78)
          // Slightly deeper green inside upper boughs, brighter translucent sunlit green along hanging tips
          const tipLift = .84 + .22 * s
          const occlusion = (1 - p.aoStrength * (1 - outMix) * .72 - p.aoStrength * clamp(-envN.y) * .16) * tipLift
          col.copy(inner).lerp(outer, clamp(outMix * .78 + s * .24)).multiplyScalar(occlusion * shade)
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
  }

  const geometry = toGeometry(positions, normals, uvs, colors, centers, corners, indices)
  return { twigs, envelope: env, cards, pruned, geometry, strips: 0 }
}

export function generateLeafCards(growth: { limbs: Limb[]; clusters: CrownCluster[]; config: { seed: number } },
  params: LeafParams, shaping: LeafShaping = {}) {
  const seed = growth.config.seed
  const twigs = generateTwigs(growth.limbs, params, seed)
  const envelope = fitEnvelope(twigs, growth.limbs, growth.clusters, params)
  if (params.cardType === 'drape') {
    return buildDrapeCurtains(growth.limbs, twigs, envelope, params, seed, shaping)
  }
  const strip = params.cardType === 'strip'
  const cardParams = strip ? { ...params, leavesPerTwig: 0, tipLeaves: 0, cardType: 'quad' as const } : params
  const { cards: rawCards, pruned } = distributeLeaves(growth.limbs, twigs, envelope, cardParams, seed, shaping)
  const reduce = clamp(shaping.reduce ?? 0, 0, .78)
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
  let geometry = buildCardGeometry(cards, envelope, cardParams, shaping)
  let strips = 0
  if (strip) {
    const keepTwigs = reduce > 0 ? twigs.filter((_, i) => i === 0 || Math.floor(i * (1 - reduce)) !== Math.floor((i - 1) * (1 - reduce))) : twigs
    const s = buildTwigStrips(keepTwigs, envelope, params, seed, shaping)
    strips = s.strips
    geometry = mergeGeometry(geometry, s.geometry)
  }
  return { twigs, envelope, cards, pruned, geometry, strips }
}
