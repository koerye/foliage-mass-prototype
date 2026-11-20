import { CubicBezierCurve3, MathUtils, Vector3 } from 'three'
import { clamp, rng, seedFor, tau } from '../shape'
import { parseBroadleafConfig, type BroadleafTreeConfig } from './config'

export interface Limb {
  id: number
  kind: 'trunk' | 'primary' | 'secondary'
  curve: CubicBezierCurve3
  rootRadius: number
  tipRadius: number
  parentId?: number
  socket?: number
}

export interface CrownCluster {
  id: number
  center: Vector3
  direction: Vector3
  width: number
  depth: number
  height: number
  branchId: number
  socket: number
  irregularity: number
  density: number
  tone: number
  seed: number
}

type Sector = readonly [yaw: number, reach: number, elevation: number, socket: number]
const round: readonly Sector[] = [
  [28, .83, .44, .06], [91, .84, .35, .15], [152, .83, .59, .26], [199, .71, .41, .11],
  [253, .82, .51, .29], [315, .72, .69, .39], [76, .23, .94, .58],
]
const open: readonly Sector[] = [
  [18, .86, .31, .03], [109, .56, .62, .20], [190, .83, .46, .13], [274, .58, .37, .08], [220, .28, .91, .52],
]

function polar(yaw: number) {
  return new Vector3(Math.cos(yaw), 0, Math.sin(yaw))
}

function radiusOn(limb: Limb, t: number) {
  return MathUtils.lerp(limb.tipRadius, limb.rootRadius, (1 - t) ** 1.25)
}

export function buildGrowth(input: BroadleafTreeConfig) {
  const config = parseBroadleafConfig(input)
  const enclosed = config.species === 'round'
  const random = rng(seedFor(config.seed, 512))
  const phase = (random() - .5) * .43
  const lean = polar(phase + (enclosed ? 2.3 : 3.5)).multiplyScalar(config.trunkCurvature)
  const stemEnd = Math.min(config.treeHeight * (enclosed ? .82 : .77), config.trunkHeight + config.crownHeight * .73)
  const limbStart = config.trunkHeight / stemEnd
  const bottom = config.treeHeight - config.crownHeight
  const crownBase = bottom + config.crownHeight * .16
  const crownBand = config.crownHeight * .77
  const trunk: Limb = {
    id: 0, kind: 'trunk', rootRadius: config.trunkRadius, tipRadius: config.trunkRadius * .10,
    curve: new CubicBezierCurve3(new Vector3(), new Vector3(-lean.x * .21, stemEnd / 3, -lean.z * .21),
      new Vector3(lean.x * .52, stemEnd * 2 / 3, lean.z * .52), new Vector3(lean.x, stemEnd, lean.z)),
  }
  const limbs: Limb[] = [trunk]
  const branches: Limb[][] = []
  const sectors = enclosed ? round : open
  const heightRatio = config.crownShape === 'wide' ? .78 : 1
  const widthRatio = config.crownShape === 'wide' ? 1.17 : 1

  for (let i = 0; i < config.primaryBranchCount; i++) {
    const primaryRule = config.primaryBranches?.[i]
    const [baseYaw, reach, elevation, attachment] = sectors[i % sectors.length]
    const jitter = config.crownIrregularity
    const yaw = MathUtils.degToRad(primaryRule?.yaw ??
      (baseYaw + (i >= sectors.length ? 37 : 0) + (random() - .5) * (10 + jitter * 29))) + phase
    const outward = polar(yaw)
    const bank = polar(yaw + Math.PI * .5)
    const skew = config.crownShape === 'irregular' ? 1 + Math.cos(yaw * 2.3 + phase) * (.07 + .13 * jitter) : 1
    const socket = Math.min(.93, limbStart + (1 - limbStart) * (attachment + random() * .045))
    const start = trunk.curve.getPoint(socket)
    const bend = primaryRule?.curvature ?? config.branchCurvature * (random() - .30) * 2
    const angle = MathUtils.degToRad(primaryRule?.angle ?? config.primaryBranchAngle)
    const length = primaryRule?.length ?? (.92 + random() * .16)
    const spread = reach * widthRatio * config.branchSpread * length * .44 * skew
    const tip = new Vector3(outward.x * config.crownWidth * spread,
      crownBase + (elevation + (random() - .5) * jitter * .18) * crownBand * heightRatio,
      outward.z * config.crownDepth * spread)
    const droop = primaryRule?.droop ?? (!enclosed && (i % 5 === 0 || i % 5 === 3) ? .15 : 0)
    tip.y = Math.max(start.y + .2, Math.min(config.treeHeight * .97, tip.y - droop * config.crownHeight * .32))
    const horizontal = new Vector3(tip.x - start.x, 0, tip.z - start.z)
    const leaderBow = !enclosed && elevation > .85 ? config.branchCurvature * (tip.y - start.y) * .29 : 0
    const elbow = start.clone().addScaledVector(horizontal, .31 * Math.sin(angle) / Math.sin(Math.PI / 4))
      .addScaledVector(bank, -leaderBow - bend * horizontal.length() * (enclosed ? .16 : .32))
    elbow.y += (tip.y - start.y) * (.34 + Math.cos(angle) * .60)
    const outer = tip.clone().addScaledVector(horizontal, -.24).addScaledVector(bank, bend * horizontal.length() * .45)
    outer.addScaledVector(bank, leaderBow * .61)
    outer.y += (enclosed ? -.12 : .05) + droop * .62
    const limb: Limb = {
      id: limbs.length, kind: 'primary', parentId: 0, socket,
      rootRadius: radiusOn(trunk, socket) * (enclosed ? .77 : .94) * (primaryRule?.thickness ?? 1),
      tipRadius: config.trunkRadius * .079, curve: new CubicBezierCurve3(start, elbow, outer, tip),
    }
    limbs.push(limb)
    const children = [limb]
    const count = primaryRule?.children ?? (enclosed ? 3 : 2 + Number(i % 2 === 0))
    for (let j = 0; j < count; j++) {
      const branchSocket = .52 + .36 * j / Math.max(1, count - 1) + (random() - .5) * .105
      const base = limb.curve.getPoint(branchSocket)
      const sign = (j + i) % 2 === 0 ? -1 : 1
      const inner = enclosed && j === 0
      const bridge = enclosed && j === 1 && i % 2 === 0 && elevation < .85
      const turn = random()
      const azimuth = yaw + sign * (inner ? 1.86 + turn * .67 : bridge ? 2.35 + turn * .43 : .49 + turn * .93)
      const direction = polar(azimuth)
      const length = Math.min(config.crownWidth, config.crownDepth) * (.097 + random() * .044) * (j === 0 ? 1.22 : .94)
      const end = base.clone().addScaledVector(direction, length)
      const r = Math.hypot(end.x / (config.crownWidth * widthRatio), end.z / config.crownDepth)
      if (r > .49) {
        end.x *= .49 / r
        end.z *= .49 / r
      }
      const isHigh = elevation >= .86
      end.y += inner ? config.crownHeight * (.21 + random() * .17) :
        bridge ? config.crownHeight * (.16 + random() * .053) :
          clamp((j % 3 - .55) * config.crownHeight * .13 + random() * .19, -.25, .49)
      if (isHigh) end.y = Math.max(end.y, tip.y - config.crownHeight * .10)
      end.y = Math.min(config.treeHeight * .96, end.y)
      const mid = base.clone().lerp(end, .62).addScaledVector(outward, .15 * length)
      mid.y += (enclosed ? .19 : .32) * length
      const secondary: Limb = {
        id: limbs.length, kind: 'secondary', parentId: limb.id, socket: branchSocket,
        rootRadius: radiusOn(limb, branchSocket) * .79, tipRadius: config.trunkRadius * .027,
        curve: new CubicBezierCurve3(base, base.clone().lerp(mid, .44), mid, end),
      }
      limbs.push(secondary)
      children.push(secondary)
    }
    branches.push(children)
  }

  // Trim the carrier above its last fork with a de Casteljau split. Existing
  // sockets are reparameterized onto the retained portion of the same curve.
  const cut = Math.min(1, Math.max(...branches.map(([primary]) => primary.socket!)) + .06)
  const original = trunk.curve
  const p01 = original.v0.clone().lerp(original.v1, cut)
  const p12 = original.v1.clone().lerp(original.v2, cut)
  trunk.curve = new CubicBezierCurve3(original.v0, p01, p01.clone().lerp(p12, cut), original.getPoint(cut))
  for (const [primary] of branches) primary.socket = primary.socket! / cut

  const clusters: CrownCluster[] = []
  for (let i = 0; i < config.crownClusterCount; i++) {
    const family = branches[i % branches.length]
    const round = Math.floor(i / branches.length)
    const branch = family[round % family.length]
    const random = rng(seedFor(config.seed, 930 + i))
    const socket = round < family.length ? (branch.kind === 'primary' ? .94 : .98) : .63 + random() * .23
    const center = branch.curve.getPoint(socket)
    const direction = branch.curve.getTangent(socket)
    direction.y = 0
    if (direction.lengthSq() < .01) direction.copy(polar(phase + i * tau / branches.length))
    direction.normalize()
    const scale = (enclosed ? .188 : .19) * Math.min(config.crownWidth, config.crownDepth) *
      config.crownClusterSize * (1 + config.crownIrregularity * (random() - .5) * .49)
    const upper = clamp((center.y - bottom) / config.crownHeight)
    clusters.push({
      id: i, center, direction, width: scale * (1.04 - upper * .17), depth: scale * (.75 + random() * .32),
      height: Math.min(config.crownHeight * .25, scale * (.69 + random() * .21)),
      branchId: branch.id, socket, irregularity: config.crownIrregularity, density: config.foliageDensity,
      tone: upper * .68 + random() * .27, seed: seedFor(config.seed, i + 430),
    })
  }
  return { config, limbs, clusters }
}

export type Growth = ReturnType<typeof buildGrowth>

