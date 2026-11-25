// Procedural skeleton for broadleaf (decurrent) and conifer (excurrent) trees.
// Branches are generated in base space against the crown envelope, then every
// point is pushed through the handle deformation field.
import { CatmullRomCurve3, MathUtils, Quaternion, Vector3 } from 'three'
import { rng, seedFor } from '../shape'
import type { CrownCluster, Limb } from '../broadleaf/leaves'
import { CrownEnvelope } from './envelope'
import { buildPalmSpine } from './palm'
import type { BranchEdit, BranchSpec, TreeSpec } from './spec'

export type BranchRole = 'trunk' | 'limb' | 'child' | 'dead'
export interface Branch extends Limb {
  level: number
  role: BranchRole
  parentId?: number
  socket?: number
  baseSocket?: number
  bare?: boolean
  points: Vector3[]
  radii: number[]
  curve: CatmullRomCurve3
  length: number
}

const UP = new Vector3(0, 1, 0)

/** Conifer drape: per-branch curtain tilt (deg, signed) shared by skeleton and fronds. */
export function drapeTilt(spec: TreeSpec, branchId: number) {
  const h = seedFor(spec.seed, 5000 + branchId)
  return spec.fronds.drapeTilt * (h & 1 ? 1 : -1) * (.6 + .4 * ((h >>> 8) % 1000) / 1000)
}

/** Conifer drape: hanging depth at s (0..1 along the branch). */
export function drapeDepth(spec: TreeSpec, branchLength: number, crownWidth: number, s: number) {
  const scale = Math.min(1.3, Math.max(.4, branchLength / (crownWidth * .6)))
  const rise = Math.min(1, s / .15)
  return spec.fronds.drop * scale * (rise * rise * (3 - 2 * rise) * Math.max(0, 1 - s) ** .5 * .9 + .1)
}

/** world-down projected perpendicular to the branch tangent, rotated by the curtain tilt */
export function drapeDown(tangent: Vector3, tiltDeg: number) {
  const down = new Vector3(0, -1, 0).addScaledVector(tangent, tangent.y)
  if (down.lengthSq() < 1e-6) down.set(1, 0, 0)
  return down.normalize().applyAxisAngle(tangent, tiltDeg * Math.PI / 180)
}
const golden = Math.PI * (3 - Math.sqrt(5))
const polar = (theta: number) => new Vector3(Math.cos(theta), 0, Math.sin(theta))

/** Fisher-Yates shuffled index permutation [0..count-1] using the supplied deterministic RNG (ez-tree inspired). */
export function shuffledIndices(count: number, random: () => number): number[] {
  const n = Math.max(0, Math.floor(count))
  const indices = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const tmp = indices[i]
    indices[i] = indices[j]
    indices[j] = tmp
  }
  return indices
}

export interface StratifiedBranchSlot {
  /** Stratified normalized socket position along parent branch in [start, end]. */
  socket: number
  /** Decorrelated stratified azimuth angle in radians paired via Fisher-Yates shuffle. */
  azimuth: number
  /** Angular sector index assigned to this height slot. */
  sectorIndex: number
}

/**
 * Opt-in stratified azimuth sampler (ez-tree style): partitions [0, 2π) into `count` equal
 * sectors, applies intra-sector jitter, and decorrelates tier order with Fisher-Yates `shuffledIndices`.
 * Opt-in helper for future climbing/vine/branch modes; does NOT alter default `buildSkeleton` RNG.
 */
export function sampleStratifiedAzimuths(
  count: number,
  random: () => number,
  options: { phase?: number; jitter?: number } = {},
): number[] {
  const n = Math.max(0, Math.floor(count))
  if (n === 0) return []
  const phase = options.phase ?? 0
  const jitter = MathUtils.clamp(options.jitter ?? 0.65, 0, 1)
  const sectorSpan = (Math.PI * 2) / n
  const order = shuffledIndices(n, random)
  return order.map(sector => phase + (sector + 0.5 + (random() - 0.5) * jitter) * sectorSpan)
}

/**
 * Opt-in stratified parent-branch socket + shuffled azimuth slot generator for future
 * vine/climbing/decurrent branching modes (zero impact on existing preset RNG sequences).
 */
export function sampleStratifiedBranchSlots(
  count: number,
  random: () => number,
  options: { start?: number; end?: number; phase?: number; socketJitter?: number; azimuthJitter?: number } = {},
): StratifiedBranchSlot[] {
  const n = Math.max(0, Math.floor(count))
  if (n === 0) return []
  const start = MathUtils.clamp(options.start ?? 0.2, 0, 1)
  const end = MathUtils.clamp(options.end ?? 0.95, start, 1)
  const span = end - start
  const socketJitter = MathUtils.clamp(options.socketJitter ?? 0.5, 0, 1)
  const azimuthJitter = MathUtils.clamp(options.azimuthJitter ?? 0.65, 0, 1)
  const phase = options.phase ?? 0
  const sectorSpan = (Math.PI * 2) / n
  const order = shuffledIndices(n, random)
  return order.map((sectorIndex, tier) => {
    const socket = MathUtils.clamp(start + span * ((tier + 0.5 + (random() - 0.5) * socketJitter) / n), start, end)
    const azimuth = phase + (sectorIndex + 0.5 + (random() - 0.5) * azimuthJitter) * sectorSpan
    return { socket, azimuth, sectorIndex }
  })
}

function anyPerpendicular(v: Vector3) {
  const a = Math.abs(v.y) < .9 ? UP : new Vector3(1, 0, 0)
  return new Vector3().crossVectors(v, a).normalize()
}

function cubic(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1), s = 1 - t
    return new Vector3()
      .addScaledVector(p0, s * s * s).addScaledVector(p1, 3 * s * s * t)
      .addScaledVector(p2, 3 * s * t * t).addScaledVector(p3, t * t * t)
  })
}

function makeCurve(points: Vector3[]) {
  return new CatmullRomCurve3(points, false, 'centripetal', .5)
}

/** radius along a branch, interpolated from its samples */
export function radiusAt(branch: Branch, t: number) {
  const f = Math.min(1, Math.max(0, t)) * (branch.radii.length - 1)
  const i = Math.min(branch.radii.length - 2, Math.floor(f))
  return MathUtils.lerp(branch.radii[i], branch.radii[i + 1], f - i)
}

export function hasGeometricEdit(e: BranchEdit | undefined): boolean {
  if (!e) return false
  if (e.lengthScale !== undefined && Math.abs(e.lengthScale - 1) > 1e-4) return true
  if (e.radiusScale !== undefined && Math.abs(e.radiusScale - 1) > 1e-4) return true
  if (e.pitchDelta !== undefined && Math.abs(e.pitchDelta) > 1e-4) return true
  if (e.yawDelta !== undefined && Math.abs(e.yawDelta) > 1e-4) return true
  if (e.gravityDelta !== undefined && Math.abs(e.gravityDelta) > 1e-4) return true
  if (e.socketDelta !== undefined && Math.abs(e.socketDelta) > 1e-4) return true
  if (e.offset && e.offset[0] * e.offset[0] + e.offset[1] * e.offset[1] + e.offset[2] * e.offset[2] > 1e-8) return true
  if (e.spineOffsets?.some(o => o[0] * o[0] + o[1] * o[1] + o[2] * o[2] > 1e-8)) return true
  return false
}

export function hasGlobalBranchOffset(b: Partial<BranchSpec> | undefined): boolean {
  if (!b) return false
  const ox = b.offsetX ?? 0, oy = b.offsetY ?? 0, oz = b.offsetZ ?? 0
  return ox * ox + oy * oy + oz * oz > 1e-8
}

/** Apply SpeedTree-style per-branch node overrides in topological parent -> child order. */
function applyBranchEdits(branches: Branch[], edits: BranchEdit[] | undefined): Branch[] {
  if (!edits || edits.length === 0) return branches
  const editMap = new Map<number, BranchEdit>()
  for (const e of edits) editMap.set(e.id, e)

  // 1. Cascading prune (never prune trunk id = 0)
  const pruned = new Set<number>()
  for (const b of branches) {
    const e = editMap.get(b.id)
    if ((b.role !== 'trunk' && e?.pruned) || (b.parentId !== undefined && pruned.has(b.parentId))) {
      pruned.add(b.id)
    }
  }
  const alive = pruned.size ? branches.filter(b => !pruned.has(b.id)) : branches

  // 2. Cascading per-branch bare flag (strips foliage from just this branch + descendants)
  const bareSet = new Set<number>()
  for (const b of alive) {
    if (editMap.get(b.id)?.bare || (b.parentId !== undefined && bareSet.has(b.parentId))) {
      bareSet.add(b.id)
      b.bare = true
    }
  }

  // 3. Topological geometric transform + parent socket carry-along
  const origCurves = new Map<number, CatmullRomCurve3>()
  const aliveById = new Map<number, Branch>()
  const modified = new Set<number>()
  const qId = new Quaternion()
  const qTmp = new Quaternion()
  const smoothstep = (a: number, b: number, x: number) => {
    const t = MathUtils.clamp((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)
  }

  for (const b of alive) {
    if (b.socket !== undefined && b.baseSocket === undefined) b.baseSocket = b.socket
    origCurves.set(b.id, b.curve)
    aliveById.set(b.id, b)
    const edit = editMap.get(b.id)
    const parentMod = b.parentId !== undefined && modified.has(b.parentId)
    const sockDelta = b.role !== 'trunk' && b.parentId !== undefined ? MathUtils.clamp(edit?.socketDelta ?? 0, -.95, .95) : 0
    const hasSocketSlide = Math.abs(sockDelta) > 1e-4
    const selfGeom = hasGeometricEdit(edit)
    if (!parentMod && !selfGeom) continue
    modified.add(b.id)

    // Step A: carry branch rigidly along its parent's socket position & tangent
    // (handles both edited parent carry-along and per-branch socket sliding along parent spline)
    if ((parentMod || hasSocketSlide) && b.parentId !== undefined) {
      const parent = aliveById.get(b.parentId)!
      const origParent = origCurves.get(b.parentId!)!
      const origSock = MathUtils.clamp(b.baseSocket ?? b.socket ?? 0, 0, 1)
      const newSock = hasSocketSlide ? MathUtils.clamp(origSock + sockDelta, .04, .98) : origSock
      const pOld = origParent.getPoint(origSock)
      const tOld = origParent.getTangent(origSock).normalize()
      const pNew = parent.curve.getPoint(newSock)
      const tNew = parent.curve.getTangent(newSock).normalize()
      const qCarry = new Quaternion().setFromUnitVectors(tOld, tNew)
      b.points = b.points.map(p => p.clone().sub(pOld).applyQuaternion(qCarry).add(pNew))
      b.socket = newSock
    }

    // Step B: apply branch's own SpeedTree node overrides
    if (selfGeom && edit) {
      const n = b.points.length
      const root = b.points[0].clone()
      const chord = b.points[n - 1].clone().sub(root)
      const chordLen = Math.max(.05, chord.length())
      const lengthScale = MathUtils.clamp(edit.lengthScale ?? 1, .25, 2.5)
      const radiusScale = MathUtils.clamp(edit.radiusScale ?? 1, .3, 2.5)
      const pitchRad = MathUtils.degToRad(MathUtils.clamp(edit.pitchDelta ?? 0, -65, 65))
      const yawRad = MathUtils.degToRad(MathUtils.clamp(edit.yawDelta ?? 0, -180, 180))
      const gravity = MathUtils.clamp(edit.gravityDelta ?? 0, -1.5, 1.5)
      const rootOff = edit.offset
        ? new Vector3(
            MathUtils.clamp(edit.offset[0], -4, 4),
            MathUtils.clamp(edit.offset[1], -4, 4),
            MathUtils.clamp(edit.offset[2], -4, 4),
          )
        : undefined
      const hasRootOff = Boolean(rootOff && rootOff.lengthSq() > 1e-8)

      const horiz = new Vector3(chord.x, 0, chord.z)
      if (horiz.lengthSq() < 1e-4) {
        const midTan = b.points[Math.min(n - 1, Math.floor(n * .5))].clone().sub(root)
        horiz.set(midTan.x, 0, midTan.z)
        if (horiz.lengthSq() < 1e-4) horiz.set(1, 0, 0)
      }
      horiz.normalize()
      // Right-hand rule: +pitchRad around cross(horiz, UP) tilts EVERY limb UPWARD (+Y)
      const pitchAxis = new Vector3().crossVectors(horiz, UP).normalize()
      const qYaw = new Quaternion().setFromAxisAngle(UP, yawRad)
      const qPitch = new Quaternion().setFromAxisAngle(pitchAxis, pitchRad)
      const qRot = qYaw.clone().multiply(qPitch)

      let offCurve: CatmullRomCurve3 | undefined
      if (edit.spineOffsets && edit.spineOffsets.some(o => o[0] * o[0] + o[1] * o[1] + o[2] * o[2] > 1e-8)) {
        const ctrl = [new Vector3(0, 0, 0), ...edit.spineOffsets.map(([x, y, z]) => new Vector3(x, y, z))]
        offCurve = new CatmullRomCurve3(ctrl, false, 'centripetal', .5)
      }

      const isTrunk = b.role === 'trunk'
      const nextPts: Vector3[] = []
      for (let i = 0; i < n; i++) {
        const s = i / (n - 1)
        const rel = b.points[i].clone().sub(root).multiplyScalar(lengthScale)
        if (pitchRad !== 0 || yawRad !== 0) {
          if (isTrunk) {
            qTmp.copy(qId).slerp(qRot, smoothstep(0, .35, s))
            rel.applyQuaternion(qTmp)
          } else {
            rel.applyQuaternion(qRot)
          }
        }
        const p = root.clone().add(rel)
        if (gravity !== 0) {
          if (isTrunk) p.addScaledVector(horiz, gravity * chordLen * lengthScale * .28 * (s ** 1.65))
          else p.y -= gravity * chordLen * lengthScale * .42 * (s ** 1.75)
        }
        if (offCurve && i > 0) p.add(offCurve.getPoint(s))
        if (hasRootOff) p.add(rootOff!)
        if (isTrunk && i === 0 && !hasRootOff) p.set(0, 0, 0)
        else if (p.y < 0) p.y = 0
        nextPts.push(p)
      }
      b.points = nextPts
      if (radiusScale !== 1) b.radii = b.radii.map(r => Math.max(.003, r * radiusScale))
    }

    // Keep child root radius cleanly contained inside edited parent bark
    if (b.parentId !== undefined) {
      const parent = aliveById.get(b.parentId)!
      const pR = radiusAt(parent, MathUtils.clamp(b.socket ?? 0, 0, 1))
      if (b.radii[0] > pR * .92 && b.radii[0] > 1e-4) {
        const k = (pR * .92) / b.radii[0]
        b.radii = b.radii.map(r => Math.max(.003, r * k))
      }
    }

    b.curve = makeCurve(b.points)
    b.length = b.curve.getLength()
    b.rootRadius = b.radii[0]
    b.tipRadius = b.radii[b.radii.length - 1]
  }

  return alive
}

export interface Skeleton {
  branches: Branch[]
  trunk: Branch
  envelope: CrownEnvelope
  clusters: CrownCluster[]
}

export function buildSkeleton(spec: TreeSpec): Skeleton {
  const { trunk: T, branches: B, crown: C } = spec
  const conifer = spec.kind === 'conifer'
  const random = rng(seedFor(spec.seed, 101))
  const H = T.height
  const branches: Branch[] = []
  const add = (b: Omit<Branch, 'id' | 'curve' | 'length'>) => {
    const branch = { ...b, baseSocket: b.socket, id: branches.length, curve: makeCurve(b.points), length: 0 } as Branch
    branches.push(branch)
    return branch
  }

  // ---- palm: curved ringed trunk + crown envelope around the trunk apex ----
  if (spec.kind === 'palm') {
    const { points, radii } = buildPalmSpine(spec)
    const trunk = add({ kind: 'trunk', role: 'trunk', level: 0, points, radii, rootRadius: radii[0], tipRadius: radii[radii.length - 1] })
    const tip = points[points.length - 1]
    const env = new CrownEnvelope(spec, tip)
    // keep the trunk rooted while letting handles subtly bend the upper neck if needed
    trunk.points = trunk.points.map((p, i) => {
      const t = i / (trunk.points.length - 1)
      return env.deform(p, t > .65 ? ((t - .65) / .35) ** 2 * .35 : 0)
    })
    trunk.curve = makeCurve(trunk.points)
    trunk.length = trunk.curve.getLength()
    const palmEdited = Boolean(spec.branchEdits?.some(hasGeometricEdit))
    applyBranchEdits([trunk], spec.branchEdits)
    const finalEnv = palmEdited
      ? new CrownEnvelope(spec, trunk.curve.getPoint(1), {
          y0: Math.max(.2, trunk.curve.getPoint(1).y - env.height * .4),
          y1: trunk.curve.getPoint(1).y + env.height * .6,
          width: env.width,
        })
      : env
    return { branches: [trunk], trunk, envelope: finalEnv, clusters: [] }
  }

  // ---- trunk ---------------------------------------------------------------
  const randLean = random() * Math.PI * 2
  const explicitLean = T.leanAngle !== undefined && T.leanAngle >= 0
  const leanDir = polar(explicitLean ? MathUtils.degToRad(T.leanAngle!) : randLean)
  const ph = [random(), random(), random(), random()].map(x => x * Math.PI * 2)
  const topY = (conifer || spec.kind === 'bamboo') ? H : H * T.forkHeight
  const trunkSamples = 22
  const trunkPoints: Vector3[] = [], trunkRadii: number[] = []
  const gnarl = MathUtils.clamp(T.gnarl ?? 0, 0, 1)
  const elbowSign = explicitLean ? 1 : ((spec.seed & 1) ? 1 : -1)
  const tipFraction = conifer ? .025 : .55
  if (T.spine && T.spine.length >= 3) {
    // Photo-traced or custom 3D centerline spline; y scales cleanly with height & forkHeight sliders
    const rawPts = T.spine.map(([x, y, z]) => new Vector3(x, Math.max(0, y), z))
    const rawTopY = Math.max(.1, rawPts[rawPts.length - 1].y)
    const yScale = topY / rawTopY
    const scaled = rawPts.map((p, i) => i === 0 ? new Vector3(0, 0, 0) : new Vector3(p.x, p.y * yScale, p.z))
    const guide = makeCurve(scaled)
    for (let i = 0; i < trunkSamples; i++) {
      const t = i / (trunkSamples - 1)
      const pt = guide.getPoint(t)
      if (i === 0) pt.set(0, 0, 0)
      else if (pt.y < 0) pt.y = 0
      trunkPoints.push(pt)
      const knotSwell = 1 + gnarl * .12 * Math.exp(-(((t - .44) / .13) ** 2))
      trunkRadii.push(T.radius * (1 - t * (1 - tipFraction)) ** T.taper * knotSwell)
    }
  } else {
    for (let i = 0; i < trunkSamples; i++) {
      const t = i / (trunkSamples - 1), y = t * topY
      const k = (y / H) ** 2
      const wob = T.wobble * Math.sin(Math.PI * t)
      const wx = explicitLean
        ? leanDir.x * wob * Math.sin(t * Math.PI * 2) * .72 + (-leanDir.z) * wob * Math.sin(t * 5.1 + ph[0]) * .22
        : wob * Math.sin(t * 6.1 + ph[0]) * .6 + wob * Math.sin(t * 13 + ph[2]) * .15
      const wz = explicitLean
        ? leanDir.z * wob * Math.sin(t * Math.PI * 2) * .72 + leanDir.x * wob * Math.sin(t * 5.1 + ph[0]) * .22
        : wob * Math.cos(t * 5.3 + ph[1]) * .6 + wob * Math.cos(t * 11 + ph[3]) * .15
      // Organic bonsai growth elbows (asymmetric knuckle bends rather than pure sine)
      const elbow1 = gnarl * Math.exp(-(((t - .38) / .2) ** 2)) * H * .085 * elbowSign
      const elbow2 = gnarl * Math.exp(-(((t - .74) / .18) ** 2)) * H * .065 * (-elbowSign)
      const gx = leanDir.x * (elbow1 + elbow2) + (-leanDir.z) * (elbow2 * .45)
      const gz = leanDir.z * (elbow1 + elbow2) + leanDir.x * (elbow2 * .45)
      trunkPoints.push(new Vector3(leanDir.x * T.lean * k + wx + gx, y, leanDir.z * T.lean * k + wz + gz))
      const knotSwell = 1 + gnarl * .14 * Math.exp(-(((t - .42) / .12) ** 2))
      trunkRadii.push(T.radius * (1 - t * (1 - tipFraction)) ** T.taper * knotSwell)
    }
  }
  const trunk = add({ kind: 'trunk', role: 'trunk', level: 0, points: trunkPoints, radii: trunkRadii,
    rootRadius: trunkRadii[0], tipRadius: trunkRadii[trunkRadii.length - 1] })
  const trunkCurve = makeCurve(trunkPoints)
  const trunkAtY = (y: number) => trunkCurve.getPoint(Math.min(1, Math.max(0, y / topY)))
  const axisPoint = conifer ? trunkAtY(H * (C.base + (1 - C.base) * .4)) : trunkPoints[trunkPoints.length - 1]
  const ground = spec.kind === 'grass' || spec.kind === 'fern' || spec.kind === 'flowerbed' || spec.kind === 'lotus'
  const bamboo = spec.kind === 'bamboo'
  const env = new CrownEnvelope(spec, ground ? new Vector3() : axisPoint)
  if (ground || bamboo) return { branches: [trunk], trunk, envelope: env, clusters: [] }
  const trunkR = (t: number) => radiusAt(trunk, t)

  // ---- broadleaf: decurrent limbs aimed at the envelope ---------------------
  const childrenOf = (parent: Branch, n: number, conf: { start: number; span: number; spread: number }) => {
    const base = makeCurve(parent.points)
    for (let j = 0; j < n; j++) {
      const t = conf.start + conf.span * (j + .5) / n + (random() - .5) * .05
      const p = base.getPoint(t), tan = base.getTangent(t).normalize()
      let dir: Vector3
      const drape = conifer && spec.fronds.mode === 'drape'
      if (drape) {
        // twigs hang inside the branch's curtain plane
        const down = drapeDown(tan, drapeTilt(spec, parent.id))
        const a = MathUtils.degToRad(B.childAngle + (random() - .5) * 14)
        const side = new Vector3().crossVectors(tan, down).normalize()
        dir = tan.clone().multiplyScalar(Math.cos(a)).addScaledVector(down, Math.sin(a)).addScaledVector(side, (j % 2 ? 1 : -1) * .12)
      } else if (conifer) {
        // alternating herringbone sub-branches angling outward and downward
        const side = new Vector3().crossVectors(UP, tan)
        if (side.lengthSq() < 1e-4) side.copy(anyPerpendicular(tan))
        side.normalize().multiplyScalar(j % 2 ? 1 : -1)
        const a = MathUtils.degToRad(B.childAngle + (random() - .5) * 14)
        dir = tan.clone().multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a))
        dir.y -= B.childDroop * .85
      } else {
        const side = anyPerpendicular(tan).applyAxisAngle(tan, j * golden + random() * .6)
        const a = MathUtils.degToRad(B.childAngle + (random() - .5) * 16)
        dir = tan.clone().multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a)).addScaledVector(UP, .22)
      }
      dir.normalize()
      const minLen = conifer ? env.height * .055 : .08
      let len = Math.max(minLen, B.childLength * parent.length * (conifer ? (1 - t) ** .42 : 1 - .45 * t) * (.78 + random() * .44))
      if (drape) len = Math.max(.06, drapeDepth(spec, parent.length, env.width, t) / Math.max(.35, Math.sin(MathUtils.degToRad(B.childAngle))) * (.5 + random() * .22))
      let tip = p.clone().addScaledVector(dir, len)
      if (!conifer) tip = env.clampInside(p, tip, .99)
      tip.y -= B.childDroop * len * .3
      const real = p.distanceTo(tip)
      const mid = p.clone().lerp(tip, .5)
      mid.y += real * (conifer ? .03 : .12) - B.childDroop * real * .14
      const pts = cubic(p, p.clone().lerp(mid, .6), mid.clone().lerp(tip, .4), tip, conifer ? 5 : 6)
      const pR = radiusAt(parent, t)
      const r0 = Math.min(pR * .68, pR * (conifer ? .55 : .60))
      add({ kind: 'secondary', role: 'child', level: parent.level + 1, parentId: parent.id, socket: t, points: pts,
        radii: pts.map((_, i) => MathUtils.lerp(r0, conifer ? .004 : .007, (i / (pts.length - 1)) ** .8)),
        rootRadius: r0, tipRadius: conifer ? .004 : .007 }).length = real
    }
  }

  const azOff = MathUtils.degToRad(B.azimuthOffset ?? 0)
  if (!conifer) {
    const n = B.count
    const phase = random() * Math.PI * 2 + azOff
    const startSock = MathUtils.clamp(B.startHeight ?? .58, .05, .92)
    const spanSock = MathUtils.clamp(B.heightSpan ?? .38, .05, .95)
    const topSock = MathUtils.clamp(startSock + spanSock, Math.min(.96, startSock + .05), .96)
    const effSpan = Math.max(.02, topSock - startSock)
    const limbs: Branch[] = []
    for (let i = 0; i < n; i++) {
      const f = (i + .5) / n
      const crownTop = i === n - 1
      const theta = phase + i * golden * 1.0 + (random() - .5) * .45
      const socket = crownTop ? topSock : MathUtils.clamp(startSock + effSpan * f ** .8 + (random() - .5) * .04, .05, Math.min(.94, topSock))
      const S = trunkCurve.getPoint(socket)
      const trunkTan = trunkCurve.getTangent(socket).normalize()
      const u = crownTop ? .9 : MathUtils.lerp(.22, .82, f) + (random() - .5) * .1
      const padTrim = 1 - MathUtils.clamp(C.padFlatten ?? 0, 0, .85) * .16
      const reach = B.reach * (1 - B.lengthVariance * random()) * (crownTop ? .52 : 1) * padTrim
      const tip = env.surface(u, theta, reach)
      const L = S.distanceTo(tip)
      const horiz = tip.clone().sub(S).setY(0)
      if (horiz.lengthSq() < 1e-6) horiz.copy(polar(theta))
      horiz.normalize()
      const side = new Vector3().crossVectors(UP, horiz).normalize()
      const a = MathUtils.degToRad(crownTop ? 64 : MathUtils.lerp(B.angle, B.angleTop, f))
      const d0 = horiz.clone().multiplyScalar(Math.cos(a)).addScaledVector(UP, Math.sin(a))
      // Blend departure smoothly from the parent trunk tangent for seamless Y-fork flow
      const launch = d0.clone().lerp(trunkTan, crownTop ? .46 : .28).normalize()
      const sign = i % 2 ? 1 : -1
      const p1 = S.clone().addScaledVector(launch, L * .36)
      const p2 = S.clone().lerp(tip, .72).addScaledVector(UP, B.curvature * L * .16).addScaledVector(side, sign * B.curvature * L * .12)
      const end = tip.clone()
      end.y -= B.droop * L * .22
      const pts = cubic(S, p1, p2, end, 12)
      const pR = trunkR(socket)
      const r0 = Math.min(pR * .76, pR * B.radiusRatio * (crownTop ? .86 : .78 + .24 * random()))
      const limb = add({ kind: 'primary', role: 'limb', level: 1, parentId: trunk.id, socket, points: pts,
        radii: pts.map((_, k) => MathUtils.lerp(r0, .014, (k / (pts.length - 1)) ** .9)), rootRadius: r0, tipRadius: .014 })
      limb.length = makeCurve(pts).getLength()
      limbs.push(limb)
    }
    const cStart = MathUtils.clamp(B.childStart ?? .26, .04, .88)
    const cSpan = Math.max(.08, .92 - cStart)
    for (const limb of limbs) {
      const n = B.childCount > 0 ? Math.max(1, Math.round(B.childCount * (.75 + random() * .5))) : 0
      childrenOf(limb, n, { start: cStart, span: cSpan, spread: 1 })
    }
  } else {
    // ---- conifer: staggered whorls along the leader, branches sweep down & out ---
    const n = B.count
    const drop0 = Math.max(0, -Math.sin(MathUtils.degToRad(B.angle)) * env.width * .78)
    const crownStartY = Math.min(H * .68, env.y0 + drop0)
    const crownTopY = H * .955
    const cStartCon = MathUtils.clamp(B.childStart ?? .06, .04, .88)
    const cSpanCon = Math.max(.08, .90 - cStartCon)
    for (let w = 0; w < n; w++) {
      // tiers: wider gaps low, tighter toward the top
      const u = Math.min(.97, 1 - (1 - (w + .25 + random() * .2) / n) ** (1 + B.tierGradient))
      const baseY = crownStartY + u * (crownTopY - crownStartY)
      // more branches around the wide base, fewer near the narrow apex (上疏下密)
      const density = MathUtils.lerp(1.25, .58, u)
      const k = Math.max(3, Math.round(B.perWhorl * density) + (random() < .25 ? (random() < .5 ? -1 : 1) : 0))
      const phase = w * golden * 1.7 + random() * .6 + azOff
      for (let j = 0; j < k; j++) {
        const y = Math.min(H * .975, Math.max(env.y0 + .15, baseY + (random() - .5) * (crownTopY - crownStartY) / n * .22))
        const S = trunkAtY(y)
        const theta = phase + j * Math.PI * 2 / k + (random() - .5) * .42
        const a = MathUtils.degToRad(MathUtils.lerp(B.angle, B.angleTop, u) + (random() - .5) * 9)
        const rProfile = Math.max(env.width * .17, env.baseRadius(u * .94, theta) * B.reach * (1 - B.lengthVariance * random()))
        const L = rProfile / Math.max(.48, Math.cos(a))
        const dir = polar(theta + B.curvature * (random() - .5) * .4)
        const side = new Vector3().crossVectors(UP, dir).normalize()
        const swing = B.curvature * (random() - .5) * .35
        const pts: Vector3[] = [S.clone()]
        const step = L / 8
        for (let i = 1; i <= 8; i++) {
          const t = (i - .5) / 8
          const pitch = a + B.tipCurl * t * t * .95 - B.droop * t * .5
          const d = dir.clone().multiplyScalar(Math.cos(pitch))
            .addScaledVector(UP, Math.sin(pitch))
            .addScaledVector(side, swing * Math.cos(Math.PI * t) * .35)
          pts.push(pts[i - 1].clone().addScaledVector(d.normalize(), step))
        }
        const pR = trunkR(y / topY)
        const r0 = Math.min(pR * .76, pR * B.radiusRatio * (.55 + .45 * Math.min(1, rProfile / env.width)))
        const limb = add({ kind: 'primary', role: 'limb', level: 1, parentId: trunk.id, socket: y / topY, points: pts,
          radii: pts.map((_, i) => MathUtils.lerp(r0, .005, (i / 8) ** .8)), rootRadius: r0, tipRadius: .005 })
        limb.length = makeCurve(pts).getLength()
        childrenOf(limb, B.childCount > 0 ? Math.max(2, Math.round(B.childCount * Math.min(1, .45 + rProfile / env.width))) : 0, { start: cStartCon, span: cSpanCon, spread: 1 })
      }
    }
  }

  // ---- dead stubs below the crown -----------------------------------------
  for (let i = 0; i < B.deadCount; i++) {
    const y = env.y0 * (.3 + .62 * random())
    const t = Math.min(1, y / topY)
    const S = trunkCurve.getPoint(t)
    const dir = polar(random() * Math.PI * 2)
    const len = (.25 + random() * .45) * H / 9
    const a = MathUtils.degToRad(-10 + random() * 30)
    const tip = S.clone().addScaledVector(dir, len * Math.cos(a)).addScaledVector(UP, len * Math.sin(a))
    const mid = S.clone().lerp(tip, .5).addScaledVector(UP, len * .08)
    const pts = cubic(S, S.clone().lerp(mid, .6), mid.clone().lerp(tip, .5), tip, 5)
    const r0 = trunkR(t) * .2
    const stub = add({ kind: 'secondary', role: 'dead', level: 1, parentId: trunk.id, socket: t, points: pts,
      radii: pts.map((_, k) => MathUtils.lerp(r0, .008, k / 4)), rootRadius: r0, tipRadius: .008 })
    stub.length = len
    if (random() < .7) {
      const fork = makeCurve(pts).getPoint(.6)
      const fdir = dir.clone().applyAxisAngle(UP, (random() < .5 ? 1 : -1) * (.6 + random() * .5))
      const ftip = fork.clone().addScaledVector(fdir, len * .35).addScaledVector(UP, len * .1)
      const fp = cubic(fork, fork.clone().lerp(ftip, .33), fork.clone().lerp(ftip, .66), ftip, 3)
      const fr0 = Math.min(radiusAt(stub, .6) * .72, r0 * .45)
      add({ kind: 'secondary', role: 'dead', level: 2, parentId: stub.id, socket: .6, points: fp,
        radii: fp.map((_, k) => MathUtils.lerp(fr0, .005, k / 2)), rootRadius: fr0, tipRadius: .005 }).length = len * .35
    }
  }

  // ---- apply the handle deformation field and finalize curves ---------------
  // Weights follow the skeleton path: a branch root inherits its parent's
  // weight at the socket (so it stays attached) and ramps to 1 at the tip.
  const smooth = (x: number, a: number, b: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  const weights = new Map<number, number[]>()
  const weightAt = (id: number, t: number) => {
    const w = weights.get(id)!
    const f = Math.min(1, Math.max(0, t)) * (w.length - 1), i = Math.min(w.length - 2, Math.floor(f))
    return MathUtils.lerp(w[i], w[i + 1], f - i)
  }
  for (const b of branches) {
    let w: number[]
    if (b.role === 'trunk') {
      const denom = Math.max(0.05, H - env.y0)
      w = b.points.map(p => conifer ? smooth((p.y - env.y0) / denom, .5, 1) : 0)
    } else {
      const root = weightAt(b.parentId!, b.socket!)
      const lastIdx = Math.max(1, b.points.length - 1)
      w = b.points.map((_, i) => root + (1 - root) * smooth(i / lastIdx, 0, .85))
    }
    weights.set(b.id, w)
    b.points = b.points.map((p, i) => env.deform(p, w[i]))
    b.curve = makeCurve(b.points)
    b.length = b.curve.getLength()
  }

  // ---- apply SpeedTree-style per-branch node overrides (prune/bare/bend/scale/slide/offset) ---
  const finalBranches = applyBranchEdits(branches, spec.branchEdits)

  // ---- apply optional global branch assembly X/Y/Z displacement ---------------------------
  const gOffX = MathUtils.clamp(B.offsetX ?? 0, -4, 4)
  const gOffY = MathUtils.clamp(B.offsetY ?? 0, -4, 4)
  const gOffZ = MathUtils.clamp(B.offsetZ ?? 0, -4, 4)
  const hasGlobalOff = hasGlobalBranchOffset(B)
  if (hasGlobalOff) {
    for (const b of finalBranches) {
      if (b.role === 'trunk') continue
      b.points = b.points.map(p => new Vector3(p.x + gOffX, Math.max(0, p.y + gOffY), p.z + gOffZ))
      b.curve = makeCurve(b.points)
      b.length = b.curve.getLength()
    }
  }

  const hasGeomNodeEdit = hasGlobalOff || Boolean(spec.branchEdits?.some(hasGeometricEdit))

  // Re-fit the crown envelope when node edits moved/bent/scaled the trunk or branches
  // so downstream foliage AO, conifer fronds, outer flowers, petals, canopyLift & editor cage
  // all stay locked onto the sculpted geometry instead of using stale pre-edit bounds.
  let finalEnv = env
  if (hasGeomNodeEdit) {
    const crownBranches = finalBranches.filter(b => b.role === 'limb' || b.role === 'child')
    if (crownBranches.length > 0) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (const b of crownBranches) {
        for (const p of b.points) {
          if (p.x < minX) minX = p.x
          if (p.x > maxX) maxX = p.x
          if (p.y < minY) minY = p.y
          if (p.y > maxY) maxY = p.y
          if (p.z < minZ) minZ = p.z
          if (p.z > maxZ) maxZ = p.z
        }
      }
      const pad = Math.max(.25, env.width * .16)
      const cx = (minX + maxX) * .5
      const cz = (minZ + maxZ) * .5
      const rx = (maxX - minX) * .5 + pad
      const rz = ((maxZ - minZ) * .5 + pad) / Math.max(.35, C.depth)
      const newWidth = Math.max(env.width * .45, Math.max(rx, rz))
      const newY0 = Math.max(.08, minY - pad * .35)
      const newY1 = Math.max(newY0 + .4, maxY + pad * .6)
      finalEnv = new CrownEnvelope(spec, new Vector3(cx, 0, cz), { y0: newY0, y1: newY1, width: newWidth })
    } else {
      const tip = trunk.curve.getPoint(1)
      finalEnv = new CrownEnvelope(spec, tip)
    }
  }

  // crown clusters (clump centres for leaves / normals) at branch ends + mid-crown bridges
  const clusters: CrownCluster[] = []
  const padFlat = MathUtils.clamp(C.padFlatten ?? 0, 0, .85)
  const addCluster = (b: Branch, t: number, scale: number, rank = 1) => {
    const center = b.curve.getPoint(t)
    const direction = b.curve.getTangent(t).setY(0)
    if (direction.lengthSq() < 1e-4) direction.set(1, 0, 0)
    direction.normalize()
    // Big-Medium-Small rhythmic sizing when cloud pads are enabled
    const rhythm = padFlat > 0 ? MathUtils.lerp(1, rank, padFlat * .7) : 1
    const size = Math.min(finalEnv.width * .68, Math.max(.34, b.length * scale * rhythm))
    const extraFlat = Math.max(0, (padFlat - .68) / .17)
    if (padFlat > 0) center.y += size * padFlat * .16
    clusters.push({
      center, direction,
      width: size * (1.15 + padFlat * .38 + extraFlat * .18),
      height: size * Math.max(.26, .75 - padFlat * .34 - extraFlat * .14),
      depth: size * (1.05 + padFlat * .32 + extraFlat * .14),
    })
  }
  let limbIdx = 0
  for (const b of finalBranches) {
    if (b.bare) continue
    if (b.role !== 'limb' && b.role !== 'child') continue
    if (b.role === 'limb' && !conifer && b.length < finalEnv.width * .25) continue
    const rank = b.role === 'limb' ? (limbIdx++ % 3 === 0 ? 1.24 : limbIdx % 3 === 1 ? .96 : .76) : .88
    addCluster(b, .84, b.role === 'limb' ? .48 : .85, rank)
    // bridge mid-crown gaps on primary broadleaf limbs so foliage reads as cohesive clouds instead of isolated balls
    // (skip when padFlatten >= 0.72 so sculptural bonsai tiers keep clean architectural sky gaps & exposed limbs)
    if (!conifer && b.role === 'limb' && padFlat < .72 && b.length > finalEnv.width * .4) addCluster(b, .56, .38, .92)
  }
  return { branches: finalBranches, trunk, envelope: finalEnv, clusters }
}
