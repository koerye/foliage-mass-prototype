import { CatmullRomCurve3, MathUtils, Vector3 } from 'three'
import { rng, seedFor } from '../shape'
import { CrownEnvelope, evalProfileCurve } from '../tree/envelope'
import { radiusAt, type Branch, type Skeleton } from '../tree/skeleton'
import type { BranchEdit, TreeSpec } from '../tree/spec'

export interface BirchFoliageClump {
  center: Vector3
  radii: Vector3
  direction: Vector3
  density?: number
  shade?: number
}

type Point = [number, number, number]

// Baseline values of makeBirchHeroTreeSpec so every slider responds continuously around 1.0 / 0.0
// without ever snapping or morphing into an unrelated tree!
const BASE_HEIGHT = 7.35
const BASE_WIDTH = 1.88
const BASE_DEPTH = 0.92
const BASE_TAPER = 1.32
const BASE_GNARL = 0.26
const BASE_FORK_HEIGHT = 0.46
const BASE_CROWN_BASE = 0.49
const BASE_CROWN_TOP = 1.0
const BASE_PAD_FLATTEN = 0.24
const BASE_CANOPY_LIFT = 0.44
const BASE_TOP_BIAS = 1.24
const BASE_IRREG = 0.46
const BASE_START_HEIGHT = 0.48
const BASE_HEIGHT_SPAN = 0.50
const BASE_ANGLE_DEG = 34
const BASE_ANGLE_TOP_DEG = 70
const BASE_REACH = 1.06
const BASE_CURV = 0.34
const BASE_DROOP = 0.08
const BASE_RADIUS_RATIO = 0.76
const BASE_AZIMUTH = 18
const BASE_CHILD_START = 0.42
const BASE_CHILD_ANGLE = 46
const BASE_CHILD_LEN = 0.40
const BASE_CHILD_DROOP = 0.06
const GOLDEN = Math.PI * (3 - Math.sqrt(5))

function applyBranchEditToPoints(
  pts: Vector3[],
  edit: BranchEdit | undefined,
  parentCurve?: CatmullRomCurve3,
  baseSocket?: number,
): Vector3[] {
  if (!edit) return pts
  const out = pts.map(p => p.clone())
  if (out.length < 2) return out

  if (parentCurve && baseSocket !== undefined && edit.socketDelta) {
    const nextSock = MathUtils.clamp(baseSocket + edit.socketDelta, 0.05, 0.96)
    const delta = parentCurve.getPoint(nextSock).sub(out[0])
    for (const p of out) p.add(delta)
  }

  const origin = out[0].clone()
  const lenScale = MathUtils.clamp(edit.lengthScale ?? 1, 0.2, 2.8)
  const yawRad = MathUtils.degToRad(edit.yawDelta ?? 0)
  const pitchRad = MathUtils.degToRad(edit.pitchDelta ?? 0)
  const droopDelta = edit.gravityDelta ?? 0
  const cosY = Math.cos(yawRad), sinY = Math.sin(yawRad)

  for (let i = 1; i < out.length; i++) {
    const t = i / (out.length - 1)
    const rel = out[i].clone().sub(origin).multiplyScalar(lenScale)
    const rx = rel.x * cosY - rel.z * sinY
    const rz = rel.x * sinY + rel.z * cosY
    rel.x = rx; rel.z = rz
    if (Math.abs(pitchRad) > 1e-4) {
      const horiz = Math.hypot(rel.x, rel.z)
      const cosP = Math.cos(pitchRad), sinP = Math.sin(pitchRad)
      const nh = horiz * cosP - rel.y * sinP
      const ny = horiz * sinP + rel.y * cosP
      if (horiz > 1e-5) {
        const s = nh / horiz
        rel.x *= s; rel.z *= s
      }
      rel.y = ny
    }
    rel.y -= droopDelta * t * t * 1.6
    out[i].copy(origin).add(rel)
  }

  if (edit.offset) {
    const [ox, oy, oz] = edit.offset
    for (const p of out) { p.x += ox; p.y += oy; p.z += oz }
  }

  if (edit.spineOffsets && edit.spineOffsets.length > 0) {
    const m = edit.spineOffsets.length
    for (let i = 1; i < out.length; i++) {
      const u = i / (out.length - 1)
      const pos = u * (m - 1)
      const i0 = Math.min(m - 1, Math.floor(pos))
      const i1 = Math.min(m - 1, i0 + 1)
      const f = pos - i0
      const o0 = edit.spineOffsets[i0], o1 = edit.spineOffsets[i1]
      out[i].x += MathUtils.lerp(o0[0], o1[0], f)
      out[i].y += MathUtils.lerp(o0[1], o1[1], f)
      out[i].z += MathUtils.lerp(o0[2], o1[2], f)
    }
  }
  return out
}

// The branch tips carry overlapping foliage pads. All control points are in tree-local coordinates
// so the same silhouette deforms with the trunk, crown and branch controls.
export function buildMeadowBirchStructure(spec: TreeSpec): { skeleton: Skeleton; clumps: BirchFoliageClump[] } {
  const random = rng(seedFor(spec.seed, 4108))
  const heightScale = spec.trunk.height / BASE_HEIGHT
  const topScale = MathUtils.clamp((spec.crown.top ?? BASE_CROWN_TOP) / BASE_CROWN_TOP, 0.55, 1.25)
  const spreadX = spec.crown.width / BASE_WIDTH
  const spreadZ = spreadX * MathUtils.clamp(spec.crown.depth / BASE_DEPTH, 0.35, 2.2)
  const gnarlScale = MathUtils.clamp((spec.trunk.gnarl ?? BASE_GNARL) / BASE_GNARL, 0, 3.0)
  const taperExp = MathUtils.clamp(1.27 * (spec.trunk.taper / BASE_TAPER), 0.4, 2.8)
  const forkShift = ((spec.trunk.forkHeight ?? BASE_FORK_HEIGHT) - BASE_FORK_HEIGHT) * 0.72
  const crownBaseShift = (spec.crown.base - BASE_CROWN_BASE) * 0.62
  const startHeightShift = (spec.branches.startHeight - BASE_START_HEIGHT) * 0.85
  const spanScale = MathUtils.clamp(spec.branches.heightSpan / BASE_HEIGHT_SPAN, 0.25, 2.2)
  const reachScale = MathUtils.clamp(spec.branches.reach / BASE_REACH, 0.32, 2.4)
  const angleLowDelta = MathUtils.degToRad(spec.branches.angle - BASE_ANGLE_DEG)
  const angleTopDelta = MathUtils.degToRad(spec.branches.angleTop - BASE_ANGLE_TOP_DEG)
  const droopDelta = spec.branches.droop - BASE_DROOP
  const curvDelta = spec.branches.curvature - BASE_CURV
  const radRatioScale = MathUtils.clamp(spec.branches.radiusRatio / BASE_RADIUS_RATIO, 0.25, 2.4)
  const azimRad = MathUtils.degToRad(spec.branches.azimuthOffset - BASE_AZIMUTH)
  const cosA = Math.cos(azimRad), sinA = Math.sin(azimRad)
  const lenVarDelta = (spec.branches.lengthVariance ?? 0.26) - 0.26
  const irregDelta = (spec.crown.irregularity ?? BASE_IRREG) - BASE_IRREG
  const topBiasDelta = (spec.crown.topBias ?? BASE_TOP_BIAS) - BASE_TOP_BIAS
  const canopyLiftDelta = (spec.crown.canopyLift ?? BASE_CANOPY_LIFT) - BASE_CANOPY_LIFT
  const padFlattenDelta = (spec.crown.padFlatten ?? BASE_PAD_FLATTEN) - BASE_PAD_FLATTEN

  // Trunk lean & wobble (clearly responsive when user drags trunk.lean / leanAngle / wobble!)
  const leanAzim = spec.trunk.leanAngle !== undefined && spec.trunk.leanAngle >= 0
    ? MathUtils.degToRad(spec.trunk.leanAngle)
    : random() * Math.PI * 2
  const leanAmt = spec.trunk.lean ?? 0
  const wobbleDelta = (spec.trunk.wobble ?? 0.14) - 0.14
  const gOffX = spec.branches.offsetX ?? 0
  const gOffY = spec.branches.offsetY ?? 0
  const gOffZ = spec.branches.offsetZ ?? 0

  const editMap = new Map<number, BranchEdit>()
  for (const e of spec.branchEdits ?? []) editMap.set(e.id, e)

  const point = ([x, y, z]: Point, isLimb = false): Vector3 => {
    let lx = x * spreadX
    const ly = y * heightScale * topScale
    let lz = z * spreadZ
    if (isLimb) {
      lx *= reachScale
      lz *= reachScale
      const rx = lx * cosA - lz * sinA
      const rz = lx * sinA + lz * cosA
      lx = rx; lz = rz
    }
    return new Vector3(lx, ly, lz)
  }

  const branches: Branch[] = []
  const bareBranchIds = new Set<number>()
  const prunedBranchIds = new Set<number>()

  function remapTrunkSocket(baseSocket: number): number {
    // Remap limb attachment smoothly by forkHeight, crown.base, branches.startHeight, and branches.heightSpan
    const center = 0.62
    const shifted = center + (baseSocket - center) * spanScale + startHeightShift + forkShift + crownBaseShift
    return MathUtils.clamp(shifted, 0.12, 0.96)
  }

  let nextBranchId = 0
  function add(
    controls: Point[],
    startRadius: number,
    endRadius: number,
    parent?: Branch,
    socket = 0,
    isChild = false,
  ) {
    const id = nextBranchId++
    const edit = editMap.get(id)
    const isLimb = Boolean(parent)
    const effSocket = parent
      ? (isChild
        ? MathUtils.clamp(socket + (spec.branches.childStart - BASE_CHILD_START) * 0.85, 0.08, 0.92)
        : remapTrunkSocket(socket))
      : 0
    const anchor = parent ? parent.curve.getPoint(effSocket) : new Vector3(0, 0, 0)

    let points: Vector3[]
    if (!parent) {
      points = controls.map(([x, y, z], idx) => {
        const t = idx / Math.max(1, controls.length - 1)
        const wobX = Math.sin(t * Math.PI * 2.4 + spec.seed * 0.01) * wobbleDelta * 1.15 * t
        const wobZ = Math.cos(t * Math.PI * 1.9 + spec.seed * 0.013) * wobbleDelta * 1.15 * t
        return new Vector3(
          x * spreadX * gnarlScale + Math.cos(leanAzim) * leanAmt * t * t + wobX,
          y * heightScale * topScale,
          z * spreadZ * gnarlScale + Math.sin(leanAzim) * leanAmt * t * t + wobZ,
        )
      })
    } else {
      const baseAnchor = parent.curve.getPoint(socket)
      const limbHeightFrac = MathUtils.clamp((effSocket - 0.35) / 0.55, 0, 1)
      const pitchD = isChild
        ? MathUtils.degToRad((spec.branches.childAngle - BASE_CHILD_ANGLE) * 0.65)
        : MathUtils.lerp(angleLowDelta, angleTopDelta, limbHeightFrac)
      const childLenRatio = isChild ? MathUtils.clamp(spec.branches.childLength / BASE_CHILD_LEN, 0.25, 2.6) : 1
      const childDroopD = isChild ? (spec.branches.childDroop - BASE_CHILD_DROOP) : 0
      const lenJitter = 1 + (random() - 0.5) * 2 * lenVarDelta * 0.75
      const uProfile = MathUtils.clamp((effSocket - 0.25) / 0.75, 0, 1)
      const profileScale = evalProfileCurve(spec.crown.profileCurve, uProfile)
        * (1 + topBiasDelta * (uProfile - 0.45) * 0.55)

      points = controls.map((c, idx) => {
        const t = (idx + 1) / controls.length
        const rawP = point(c, true)
        const rel = rawP.clone().sub(baseAnchor)
        rel.x *= childLenRatio * lenJitter * profileScale
        rel.z *= childLenRatio * lenJitter * profileScale
        rel.y *= childLenRatio * lenJitter
        if (Math.abs(pitchD) > 1e-4) {
          const horiz = Math.hypot(rel.x, rel.z)
          const cosP = Math.cos(pitchD), sinP = Math.sin(pitchD)
          const nh = horiz * cosP - rel.y * sinP
          const ny = horiz * sinP + rel.y * cosP
          if (horiz > 1e-5) { const s = nh / horiz; rel.x *= s; rel.z *= s }
          rel.y = ny
        }
        rel.y += curvDelta * Math.sin(Math.PI * t) * 1.15 - (droopDelta + childDroopD) * t * t * 1.85
        rel.y += canopyLiftDelta * (1 - limbHeightFrac) * 0.9 * t
        return anchor.clone().add(rel).add(new Vector3(gOffX, gOffY, gOffZ))
      })
      points.unshift(anchor.clone().add(new Vector3(gOffX, gOffY, gOffZ)))
    }

    points = applyBranchEditToPoints(points, edit, parent?.curve, effSocket)

    const rMul = MathUtils.clamp(edit?.radiusScale ?? 1, 0.25, 3) * (isLimb ? radRatioScale : 1)
    const r0 = startRadius * rMul
    const r1 = endRadius * rMul
    const curve = new CatmullRomCurve3(points)
    const level = parent ? parent.level + 1 : 0
    const radii = points.map((_, i) => MathUtils.lerp(r0, r1, (i / (points.length - 1)) ** (level === 0 ? taperExp : .85)))
    const pruned = Boolean(edit?.pruned || (parent && prunedBranchIds.has(parent.id)))
    if (pruned) prunedBranchIds.add(id)
    if (edit?.bare || pruned) bareBranchIds.add(id)

    const branch: Branch = {
      id, kind: level === 0 ? 'trunk' : level === 1 ? 'primary' : 'secondary',
      role: level === 0 ? 'trunk' : level === 1 ? 'limb' : 'child', level,
      ...(parent ? { parentId: parent.id, socket: effSocket, baseSocket: socket } : {}),
      points, curve, length: curve.getLength(), radii, rootRadius: r0, tipRadius: r1,
    }
    if (!pruned) branches.push(branch)
    return branch
  }

  const trunk = add([
    [0, 0, 0], [-.06, .72, -.025], [-.045, 1.49, .025], [-.085, 2.15, .035],
    [-.31, 2.89, -.01], [-.50, 3.63, -.16], [-.61, 4.56, -.23], [-.53, 5.66, -.30], [-.61, 7.02, -.40],
  ], spec.trunk.radius, .023)

  function bough(parent: Branch, socket: number, proportion: number, controls: Point[], isChild = false) {
    return add(controls, radiusAt(parent, socket) * proportion, .011, parent, socket, isChild)
  }

  // Hero primary bough recipes (ordered from key silhouette boughs outward so branches.count 2..30 scales smoothly!)
  const heroPrimaryRecipes: { socket: number; prop: number; controls: Point[]; padOffset: Point; padRadii: Point; density: number; shade: number }[] = [
    { socket: .397, prop: .57, controls: [[.22, 2.68, .08], [.54, 3.33, .12], [.82, 3.90, .15], [1.47, 4.17, .13]], padOffset: [-.48, .53, .04], padRadii: [1.04, .58, .71], density: 1.28, shade: .035 },
    { socket: .62, prop: .54, controls: [[-.91, 4.06, .12], [-1.39, 4.56, .42], [-1.45, 4.76, .48]], padOffset: [.04, -.04, .11], padRadii: [.85, .84, .62], density: 1.17, shade: -.16 },
    { socket: .74, prop: .51, controls: [[-.95, 5.24, -.33], [-1.82, 5.91, -.36], [-2.04, 6.29, -.37]], padOffset: [.16, -.02, .22], padRadii: [1.14, .82, .68], density: 1.27, shade: -.015 },
    { socket: .79, prop: .55, controls: [[.05, 5.18, -.46], [.49, 5.91, -.52], [.75, 6.42, -.49], [.97, 6.81, -.47]], padOffset: [-.37, .10, .13], padRadii: [.93, .92, .76], density: 1.28, shade: .060 },
    { socket: .78, prop: .38, controls: [[-.08, 5.28, -.65], [.46, 5.61, -.86], [1.07, 6.01, -.78]], padOffset: [.14, .06, -.14], padRadii: [.65, .58, .63], density: 1.02, shade: -.020 },
  ]

  const wantPrimary = MathUtils.clamp(Math.round(spec.branches.count), 1, 24)
  const primaries: Branch[] = []
  const extraClumpSpecs: { branch: Branch; offset: Point; radii: Point; density: number; shade: number }[] = []

  for (let i = 0; i < Math.min(wantPrimary, heroPrimaryRecipes.length); i++) {
    const r = heroPrimaryRecipes[i]
    const b = bough(trunk, r.socket, r.prop, r.controls, false)
    primaries.push(b)
    extraClumpSpecs.push({ branch: b, offset: r.padOffset, radii: r.padRadii, density: r.density, shade: r.shade })
  }

  // Spawn extra parametric primary boughs when user increases branches.count > 5!
  for (let i = heroPrimaryRecipes.length; i < wantPrimary; i++) {
    const k = i - heroPrimaryRecipes.length
    const frac = (k + 0.5) / Math.max(1, wantPrimary - heroPrimaryRecipes.length)
    const sock = MathUtils.clamp(0.42 + frac * 0.44, 0.25, 0.90)
    const ang = k * GOLDEN + 0.85
    const anchor = trunk.curve.getPoint(sock)
    const radLen = (1.15 + (random() - 0.5) * 0.45) * (1 - frac * 0.25)
    const elev = MathUtils.degToRad(MathUtils.lerp(spec.branches.angle, spec.branches.angleTop, frac))
    const dx = Math.cos(ang) * Math.cos(elev) * radLen
    const dz = Math.sin(ang) * Math.cos(elev) * radLen
    const dy = Math.sin(elev) * radLen * 0.85
    const basePts: Point[] = [
      [anchor.x / spreadX + dx * 0.35, anchor.y / heightScale + dy * 0.45, anchor.z / spreadZ + dz * 0.35],
      [anchor.x / spreadX + dx * 0.72, anchor.y / heightScale + dy * 0.82, anchor.z / spreadZ + dz * 0.72],
      [anchor.x / spreadX + dx, anchor.y / heightScale + dy, anchor.z / spreadZ + dz],
    ]
    const b = bough(trunk, sock, 0.50, basePts, false)
    primaries.push(b)
    extraClumpSpecs.push({ branch: b, offset: [0, 0.08, 0], radii: [0.76, 0.62, 0.62], density: 0.92, shade: (random() - 0.5) * 0.14 })
  }

  // Hero secondary shoots (scale dynamically with branches.childCount!)
  const heroShootRecipes: { pIdx: number; socket: number; prop: number; controls: Point[]; padOffset: Point; padRadii: Point; density: number; shade: number }[] = [
    { pIdx: 0, socket: .57, prop: .50, controls: [[.52, 3.86, .47], [.55, 4.49, .60]], padOffset: [-.05, .34, -.01], padRadii: [.56, .45, .42], density: .86, shade: -.08 },
    { pIdx: 1, socket: .59, prop: .50, controls: [[-1.42, 4.59, -.02], [-1.63, 4.44, -.12]], padOffset: [-.10, -.32, .05], padRadii: [.59, .68, .52], density: .89, shade: -.22 },
    { pIdx: 2, socket: .68, prop: .61, controls: [[-1.72, 5.14, .08], [-1.86, 5.32, .19]], padOffset: [0, 0, 0], padRadii: [0, 0, 0], density: 0, shade: 0 },
    { pIdx: 3, socket: .63, prop: .51, controls: [[.88, 6.10, -.14], [1.23, 6.06, .01]], padOffset: [.08, .07, -.06], padRadii: [.52, .53, .48], density: .84, shade: .02 },
  ]
  const wantChildren = MathUtils.clamp(Math.round(spec.branches.childCount), 0, 10)
  if (wantChildren > 0) {
    const baseShootCount = wantChildren === 1 ? 2 : heroShootRecipes.length
    for (let i = 0; i < baseShootCount; i++) {
      const r = heroShootRecipes[i]
      if (r.pIdx >= primaries.length) continue
      const sh = bough(primaries[r.pIdx], r.socket, r.prop, r.controls, true)
      if (r.density > 0) {
        extraClumpSpecs.push({ branch: sh, offset: r.padOffset, radii: r.padRadii, density: r.density, shade: r.shade })
      }
    }
    // Spawn extra secondary shoots when childCount > 2!
    const extraPerLimb = Math.max(0, wantChildren - 2)
    for (let pIdx = 0; pIdx < primaries.length && extraPerLimb > 0; pIdx++) {
      const parent = primaries[pIdx]
      const parentTan = parent.curve.getTangent(0.6).normalize()
      const sideVec = new Vector3().crossVectors(parentTan, new Vector3(0, 1, 0))
      if (sideVec.lengthSq() < 1e-4) sideVec.set(1, 0, 0)
      sideVec.normalize()
      for (let c = 0; c < extraPerLimb; c++) {
        const sock = MathUtils.clamp(spec.branches.childStart + ((c + 0.5) / extraPerLimb) * 0.45, 0.15, 0.85)
        const origin = parent.curve.getPoint(sock)
        const sign = (c + pIdx) % 2 === 0 ? 1 : -1
        const cAng = MathUtils.degToRad(spec.branches.childAngle)
        const dir = parentTan.clone().multiplyScalar(Math.cos(cAng))
          .addScaledVector(sideVec, sign * Math.sin(cAng))
        dir.y += 0.25 - spec.branches.childDroop * 0.5
        dir.normalize()
        const len = Math.max(0.35, parent.length * spec.branches.childLength * 0.85)
        const mid = origin.clone().addScaledVector(dir, len * 0.55)
        const tip = origin.clone().addScaledVector(dir, len)
        tip.y -= spec.branches.childDroop * len * 0.45
        const sh = bough(parent, sock, 0.46, [
          [mid.x / spreadX, mid.y / heightScale, mid.z / spreadZ],
          [tip.x / spreadX, tip.y / heightScale, tip.z / spreadZ],
        ], true)
        extraClumpSpecs.push({ branch: sh, offset: [0, 0.05, 0], radii: [0.46, 0.40, 0.38], density: 0.52, shade: 0 })
      }
    }
  }

  // Optional bare deadwood stubs below the crown (branches.deadCount > 1)
  const extraDead = Math.max(0, Math.round(spec.branches.deadCount ?? 1) - 1)
  for (let d = 0; d < extraDead; d++) {
    const sock = MathUtils.clamp(0.18 + (d / Math.max(1, extraDead)) * 0.28, 0.14, 0.48)
    const origin = trunk.curve.getPoint(sock)
    const ang = d * GOLDEN + 1.2
    const stubLen = 0.42 + random() * 0.38
    const mid: Point = [
      (origin.x + Math.cos(ang) * stubLen * 0.5) / spreadX,
      (origin.y + stubLen * 0.22) / heightScale,
      (origin.z + Math.sin(ang) * stubLen * 0.5) / spreadZ,
    ]
    const tip: Point = [
      (origin.x + Math.cos(ang) * stubLen) / spreadX,
      (origin.y + stubLen * 0.32) / heightScale,
      (origin.z + Math.sin(ang) * stubLen) / spreadZ,
    ]
    const stub = bough(trunk, sock, 0.34, [mid, tip], true)
    bareBranchIds.add(stub.id)
  }

  const envelope = new CrownEnvelope(spec, trunk.curve.getPoint(1))
  const padScale = MathUtils.clamp((spec.leaves.clumpScale ?? 0.96) / 0.96, 0.35, 2.2)
  const flatYScale = MathUtils.clamp(1 - padFlattenDelta * 0.85, 0.32, 1.55)

  function pad(branch: Branch, offset: Point, radii: Point, density: number, shade: number): BirchFoliageClump | undefined {
    if (bareBranchIds.has(branch.id) || prunedBranchIds.has(branch.id)) return undefined
    const rawCenter = branch.curve.getPoint(1).add(point(offset, true))
    const jitter = irregDelta * 0.42
    if (Math.abs(jitter) > 1e-4) {
      rawCenter.x += (random() - 0.5) * jitter
      rawCenter.y += (random() - 0.5) * jitter * 0.7
      rawCenter.z += (random() - 0.5) * jitter
    }
    const center = envelope.deform(rawCenter, 1)
    if (envelope.bare(center) > 0.65) return undefined
    const rad = point(radii, false).multiplyScalar(padScale)
    rad.y *= flatYScale
    return {
      center,
      radii: rad,
      direction: branch.curve.getTangent(.85),
      density,
      shade,
    }
  }

  const clumps: BirchFoliageClump[] = []
  const topPad = pad(trunk, [-.18, .09, .04], [.94, 1.24, .73], 1.40, .025)
  if (topPad) clumps.push(topPad)
  for (const cs of extraClumpSpecs) {
    const p = pad(cs.branch, cs.offset, cs.radii, cs.density, cs.shade)
    if (p) clumps.push(p)
  }

  const skeleton: Skeleton = {
    branches,
    trunk,
    envelope,
    clusters: clumps.map(({ center, radii, direction, density, shade }) => ({
      center, direction, width: radii.x * 2, height: radii.y * 2, depth: radii.z * 2, density, shade,
    })),
  }
  return { skeleton, clumps }
}
