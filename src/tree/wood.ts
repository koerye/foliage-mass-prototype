// Wood mesh: parallel-transport sweep with integer-periodic root flare, integrated continuous
// root buttresses, anchored wide surface ribs, directional real-time branch collars with
// projected normal blending, smooth apical trunk domes, curvature-aware anti-fold clamping,
// and baked crevice AO + crest wear vertex colors.
import { BufferGeometry, Color, Float32BufferAttribute, MathUtils, Vector3 } from 'three'
import { rng, seedFor } from '../shape'
import { radiusAt, type Branch } from './skeleton'
import type { TrunkSpec } from './spec'
import {
  appendHeroStrands, buildTrunkFeaturePlan, evalBarkSculpt, woodSculptLodParams,
  type BarkHeightField, type SocketFlowHint, type TrunkFeaturePlan, type TrunkSculptSpec,
} from './wood-sculpt'
import { bridgeWeldedCollar, planTrunkWeldHoles, type TrunkWeldPlan } from './wood-weld'

function transportFrames(points: Vector3[]) {
  const tangents = points.map((_, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)]
    const d = b.clone().sub(a)
    return d.lengthSq() > 1e-10 ? d.normalize() : new Vector3(0, 1, 0)
  })
  const normals: Vector3[] = [], binormals: Vector3[] = []
  const t0 = tangents[0]
  let n = Math.abs(t0.y) < .9 ? new Vector3(0, 1, 0).cross(t0).normalize() : new Vector3(1, 0, 0).cross(t0).normalize()
  for (let i = 0; i < points.length; i++) {
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

/** Uniform resampling along branch curve (legacy path). */
function resample(branch: Branch, rings: number) {
  return Array.from({ length: rings }, (_, i) => branch.curve.getPoint(i / (rings - 1)))
}

/** Root-shoulder densified resampling along trunk curve: smoothly clusters extra rings in the lower
 *  root-buttress zone (t in [0, 0.22]) so continuous buttress shoulders curve roundly into y = 0. */
function resampleTrunkRootWeighted(branch: Branch, rings: number): { pts: Vector3[]; ts: number[] } {
  const ts: number[] = []
  const pts: Vector3[] = []
  for (let i = 0; i < rings; i++) {
    const u = i / (rings - 1)
    // Gentle monotonic power blend (u^1.22) densifies root flare without starving upper trunk
    const t = Math.pow(u, 1.22)
    ts.push(t)
    pts.push(branch.curve.getPoint(t))
  }
  return { pts, ts }
}

export interface WoodOptions {
  /** 0.2..1.0 multiplier for ring and radial segment counts */
  detail?: number
  /** return true to omit a branch mesh (e.g. hidden inside foliage during LOD optimization) */
  skip?: (branch: Branch) => boolean
  /** Optional seamless [0,1] bark heightfield for physical geometry displacement (from Substance or custom texture) */
  heightField?: BarkHeightField
}

/** Exact triangle count generated for a single branch in buildWood / buildPalmWood (for SpeedTree Selected-Node HUD). */
export function estimateBranchTriangles(b: Branch, detail = 1, isPalm = false, palmRings = 18, sculpt?: TrunkSculptSpec) {
  const d = MathUtils.clamp(detail, .2, 1)
  if (isPalm && b.role === 'trunk') {
    const ringCount = Math.max(4, Math.round(palmRings))
    const totalRings = Math.max(8, Math.round(ringCount * (d >= .6 ? 2.2 : d >= .38 ? 1.4 : .8)))
    const segs = Math.max(6, Math.round(16 * d))
    return (totalRings - 1) * segs * 2 + segs
  }
  const lod = woodSculptLodParams(d, sculpt)
  const isTrunk = b.role === 'trunk'
  const baseRings = isTrunk
    ? lod.trunkRings
    : b.level === 1 ? lod.limbRings
      : Math.max(3, Math.round((b.role === 'dead' ? 5 : 7) * d))
  const segs = isTrunk
    ? lod.trunkSegs
    : b.level === 1 ? lod.limbSegs
      : Math.max(3, Math.round(5 * d))
  const hasParent = b.parentId !== undefined
  const domeRings = !hasParent && isTrunk && radiusAt(b, 1) > .025 ? 3 : 0
  const totalRings = baseRings + (hasParent ? 1 : domeRings)
  return (totalRings - 1) * segs * 2 + segs * (hasParent ? 2 : 1)
}

export function buildWood(branches: Branch[], trunk: TrunkSpec, seed: number, options: WoodOptions = {}) {
  const detail = MathUtils.clamp(options.detail ?? 1, .2, 1)
  const sculpt = trunk.sculpt
  const lod = woodSculptLodParams(detail, sculpt)
  const useSculpt = lod.active && Boolean(sculpt)
  const position: number[] = [], color: number[] = [], index: number[] = []
  const uv: number[] | undefined = useSculpt ? [] : undefined
  const metric: number[] | undefined = useSculpt ? [] : undefined
  const seamPairs: [number, number][] = []
  const collarBlends: { vertIdx: number; weight: number; parentVertA: number; parentVertB: number; alpha: number }[] = []
  const byId = new Map(branches.map(b => [b.id, b]))
  const customBark = trunk.barkColor && trunk.barkColor.toLowerCase() !== '#5b4636'
  const bark = new Color(trunk.barkColor || '#5b4636')
  const barkLight = customBark ? bark.clone().lerp(new Color('#f2ece6'), .32) : new Color('#9a7656')
  const bleachedCrest = barkLight.clone().lerp(new Color('#f6f1e8'), .46)
  const crevice = customBark ? bark.clone().multiplyScalar(.48) : new Color('#2f231b')
  const deepCrevice = crevice.clone().multiplyScalar(.50)
  const dead = customBark ? bark.clone().lerp(new Color('#8e847c'), .35) : new Color('#7d6a58')
  const c = new Color()
  const phase = (seed % 997) / 997 * Math.PI * 2
  const vOff = new Vector3()
  const radDir = new Vector3()
  const barkScale = trunk.barkScale ?? 1

  let savedTrunkData: {
    branch: Branch
    pts: Vector3[]
    tangents: Vector3[]
    normals: Vector3[]
    binormals: Vector3[]
    radii: number[]
    ringT: number[]
    arcLen: number[]
    surfGrid: Float32Array
    startVert: number
    rings: number
    segs: number
    cols: number
    plan: TrunkFeaturePlan
  } | undefined
  let trunkWeldPlan: TrunkWeldPlan | undefined
  const savedLimbRings = new Map<number, {
    startVert: number
    rings: number
    segs: number
    cols: number
    ringT: number[]
    normals: Vector3[]
    binormals: Vector3[]
  }>()

  const deadCenters: { pos: Vector3; radius: number }[] = []
  for (const b of branches) {
    if (b.role === 'dead') {
      deadCenters.push({ pos: b.curve.getPoint(.2), radius: b.rootRadius })
    }
  }

  const childAttached = (child: Branch, parentBranch: Branch) => {
    if (child.parentId !== parentBranch.id || child.socket === undefined || !child.points.length) return false
    const sock = MathUtils.clamp(child.socket, 0, 1)
    const sockPt = parentBranch.curve.getPoint(sock)
    const pR = radiusAt(parentBranch, sock)
    return child.points[0].distanceTo(sockPt) <= Math.max(.03, pR * .45)
  }

  for (const b of branches) {
    if (options.skip?.(b)) continue
    const isTrunk = b.role === 'trunk'
    const baseRings = isTrunk
      ? lod.trunkRings
      : b.level === 1 ? lod.limbRings
        : Math.max(3, Math.round((b.role === 'dead' ? 5 : 7) * detail))
    const segs = isTrunk
      ? lod.trunkSegs
      : b.level === 1 ? lod.limbSegs
        : Math.max(3, Math.round(5 * detail))
    const cols = useSculpt ? segs + 1 : segs

    let rawPts: Vector3[]
    let rawTs: number[]
    if (useSculpt && isTrunk) {
      const rw = resampleTrunkRootWeighted(b, baseRings)
      rawPts = rw.pts
      rawTs = rw.ts
    } else {
      rawPts = resample(b, baseRings)
      rawTs = Array.from({ length: baseRings }, (_, i) => i / (baseRings - 1))
    }

    const rawParent = b.parentId !== undefined ? byId.get(b.parentId) : undefined
    const parent = rawParent && childAttached(b, rawParent) ? rawParent : undefined
    const parentR = parent ? radiusAt(parent, b.socket ?? 0) : 0
    const pts: Vector3[] = []
    const ringRadii: number[] = []
    const ringT: number[] = []

    // Detect if this is a primary limb emerging directly from the sculpted trunk (for directional collar!)
    const parentIsSculptTrunk = Boolean(useSculpt && savedTrunkData && parent && parent.id === savedTrunkData.branch.id && b.level === 1)
    let limbSocketHint: SocketFlowHint | undefined
    if (parentIsSculptTrunk && savedTrunkData) {
      limbSocketHint = savedTrunkData.plan.sockets.find(s => s.branchId === b.id)
    }
    // Also support soft normal-blended collars on thicker secondary branches emerging from primary limbs
    const parentLimbData = (!parentIsSculptTrunk && b.level === 2 && b.role !== 'dead' && b.rootRadius >= 0.022 && parent)
      ? savedLimbRings.get(parent.id)
      : undefined
    let secParentRingIdx = 0
    let secParentColIdx = 0
    if (parentLimbData && b.socket !== undefined) {
      const pRing = parentLimbData.ringT
      for (let k = 1; k < pRing.length; k++) {
        if (Math.abs(pRing[k] - b.socket) < Math.abs(pRing[secParentRingIdx] - b.socket)) secParentRingIdx = k
      }
      const cDir = b.curve.getTangent(0).normalize()
      const ang = Math.atan2(cDir.dot(parentLimbData.binormals[secParentRingIdx]), cDir.dot(parentLimbData.normals[secParentRingIdx]))
      const angNorm = (((ang / (Math.PI * 2)) % 1) + 1) % 1
      secParentColIdx = Math.floor(angNorm * parentLimbData.segs) % parentLimbData.segs
    }

    // Collect top primary forks (t >= 0.86) for smooth trunk apical crotch dome blending
    const topForks: { dir: Vector3; weight: number }[] = []
    if (isTrunk) {
      for (const child of branches) {
        if (child.parentId !== b.id || child.role === 'dead' || options.skip?.(child) || !childAttached(child, b)) continue
        if ((child.socket ?? 0) >= 0.86 && child.rootRadius > 0.02) {
          topForks.push({ dir: child.curve.getTangent(0).normalize(), weight: child.rootRadius })
        }
      }
    }

    if (parent) {
      const parentTan = parent.curve.getTangent(b.socket ?? 0).normalize()
      const sink = Math.min(parentR * .34, Math.max(.015, b.length * .12))
      const pIn = rawPts[0].clone().addScaledVector(parentTan, -sink)
      const r0 = Math.min(radiusAt(b, 0), parentR * .78)
      pts.push(pIn)
      ringRadii.push(Math.min(r0 * .42, parentR * .44))
      ringT.push(-.06)

      for (let i = 0; i < baseRings; i++) {
        const t = rawTs[i]
        let r = radiusAt(b, t)
        if (i === 0) {
          r = Math.min(r * .86, parentR * .72)
        } else {
          // Organic collar flare peaking cleanly where limb/secondary emerges through parent bark
          const collarPeak = parentIsSculptTrunk ? .24 : parentLimbData ? .19 : .15
          const collar = 1 + collarPeak * Math.exp(-(((t - .085) / .085) ** 2))
          r *= collar
          if (t < .22) r = Math.min(r, MathUtils.lerp(parentR * .86, r, t / .22))
        }
        pts.push(rawPts[i])
        ringRadii.push(r)
        ringT.push(t)
      }
    } else {
      for (let i = 0; i < baseRings; i++) {
        pts.push(rawPts[i])
        ringRadii.push(radiusAt(b, rawTs[i]))
        ringT.push(rawTs[i])
      }
      const rEnd = ringRadii[ringRadii.length - 1]
      if (isTrunk && rEnd > .025) {
        const endPt = rawPts[baseRings - 1]
        const endTan = rawPts[baseRings - 1].clone().sub(rawPts[Math.max(0, baseRings - 2)])
        if (endTan.lengthSq() > 1e-10) endTan.normalize()
        else endTan.set(0, 1, 0)
        // Smoothly steer apical dome axis toward the weighted top-fork crotch centroid (prevents blunt dome step!)
        if (topForks.length > 0) {
          const forkSum = new Vector3()
          let wSum = 0
          for (const tf of topForks) { forkSum.addScaledVector(tf.dir, tf.weight); wSum += tf.weight }
          if (wSum > 1e-4 && forkSum.lengthSq() > 1e-6) {
            forkSum.normalize()
            endTan.lerp(forkSum, 0.35).normalize()
          }
        }
        const domeSteps: [number, number][] = topForks.length > 0
          ? [[.16, .86], [.34, .56], [.50, .18]]
          : [[.20, .82], [.40, .50], [.54, .18]]
        for (const [ext, frac] of domeSteps) {
          pts.push(endPt.clone().addScaledVector(endTan, rEnd * ext))
          ringRadii.push(rEnd * frac)
          ringT.push(1)
        }
      }
    }

    const totalRings = pts.length
    const { tangents, normals, binormals } = transportFrames(pts)
    const arcLen: number[] = new Array(totalRings).fill(0)
    for (let i = 1; i < totalRings; i++) arcLen[i] = arcLen[i - 1] + pts[i].distanceTo(pts[i - 1])

    // Smoothed curvature vectors (3-point weighted average eliminates noisy discrete spikes!)
    const rawK: Vector3[] = Array.from({ length: totalRings }, () => new Vector3())
    for (let i = 1; i < totalRings - 1; i++) {
      const chord = pts[i + 1].distanceTo(pts[i - 1])
      if (chord > 1e-4) rawK[i].subVectors(tangents[i + 1], tangents[i - 1]).multiplyScalar(1 / chord)
    }
    const smoothK: Vector3[] = rawK.map((kv, i) => {
      if (i === 0 || i === totalRings - 1) return kv.clone()
      return kv.clone().multiplyScalar(.5).addScaledVector(rawK[i - 1], .25).addScaledVector(rawK[i + 1], .25)
    })

    // Build LOD-invariant TrunkFeaturePlan once for the trunk (sockets + bend peaks + fixed priority ribs)
    let trunkPlan: TrunkFeaturePlan | undefined
    let trunkSurfGrid: Float32Array | undefined
    if (useSculpt && isTrunk && sculpt) {
      const sockets: SocketFlowHint[] = []
      for (const child of branches) {
        if (child.parentId !== b.id || child.socket === undefined || child.role === 'dead' || options.skip?.(child) || !childAttached(child, b)) continue
        // Locate exact ring nearest child.socket on baseRings
        let sIdx = 0
        for (let k = 1; k < baseRings; k++) {
          if (Math.abs(ringT[k] - child.socket) < Math.abs(ringT[sIdx] - child.socket)) sIdx = k
        }
        const cDir = child.curve.getTangent(0).normalize()
        const nx = cDir.dot(normals[sIdx])
        const bz = cDir.dot(binormals[sIdx])
        sockets.push({
          branchId: child.id,
          t: child.socket,
          arcLen: arcLen[sIdx],
          angle: Math.atan2(bz, nx),
          radius: child.rootRadius,
          trunkRadius: Math.max(.06, ringRadii[sIdx]),
          exitDotTan: Math.abs(cDir.dot(tangents[sIdx])),
          dirLocal: cDir,
          length: child.length,
        })
      }

      // Detect top 1..3 true S-bend curvature peaks along the trunk so inner-bend folds appear ONLY at real elbows!
      const bendPeaks: { t: number; arcLen: number; angle: number; strength: number }[] = []
      for (let i = 2; i < baseRings - 2; i++) {
        const kCur = smoothK[i].length()
        const kPrev = smoothK[i - 1].length()
        const kNext = smoothK[i + 1].length()
        if (kCur > .18 && kCur >= kPrev && kCur >= kNext) {
          const strength = MathUtils.clamp(kCur * ringRadii[i] * 2.2, 0, 1)
          if (strength > .15) {
            const ang = Math.atan2(smoothK[i].dot(binormals[i]), smoothK[i].dot(normals[i]))
            bendPeaks.push({ t: ringT[i], arcLen: arcLen[i], angle: ang, strength })
          }
        }
      }

      trunkPlan = buildTrunkFeaturePlan(
        sculpt, seed, phase, trunk.flare, trunk.flareLobes, trunk.flareHeight,
        trunk.height, arcLen[baseRings - 1], sockets, bendPeaks,
      )
      trunkSurfGrid = new Float32Array(baseRings * segs)
    }

    // For a primary limb emerging from sculpted trunk, compute local downward-shoulder angle for asymmetric collar skirt
    let limbDownAngle = 0
    let limbShallowFade = 1
    let parentCollarRingIdx = 0
    if (parentIsSculptTrunk && savedTrunkData && limbSocketHint) {
      const pRing = savedTrunkData.ringT
      let bestI = 0
      for (let k = 1; k < pRing.length; k++) {
        if (Math.abs(pRing[k] - limbSocketHint.t) < Math.abs(pRing[bestI] - limbSocketHint.t)) bestI = k
      }
      parentCollarRingIdx = bestI
      // Project -parentTangent into child's first exposed ring frame -> identifies underside supporting collar!
      const negPTan = savedTrunkData.tangents[bestI].clone().negate()
      const idxRef = Math.min(2, totalRings - 1)
      limbDownAngle = Math.atan2(negPTan.dot(binormals[idxRef]), negPTan.dot(normals[idxRef]))
      // Shallow emergence angle guard (GPT 4.3: taper collar skirt smoothly when exit is nearly tangent to trunk)
      limbShallowFade = 1 - MathUtils.smoothstep(limbSocketHint.exitDotTan, .72, .94)
    }

    const weldHole = parentIsSculptTrunk ? trunkWeldPlan?.holesByBranchId.get(b.id) : undefined
    let weldVOffset = 0
    if (weldHole && uv) {
      let sumV = 0
      for (const vi of weldHole.boundaryVerts) sumV += uv[vi * 2 + 1]
      weldVOffset = sumV / Math.max(1, weldHole.boundaryVerts.length)
    }
    let firstKeepIdx = 0
    if (weldHole) {
      // Find first child ring whose ENTIRE perimeter clears the trunk hole opening along holeNormal
      const minClear = Math.max(.035, weldHole.socket.radius * .28)
      const maxStart = Math.max(2, totalRings - 3)
      let found = -1
      for (let i = 2; i <= maxStart; i++) {
        const dotN = MathUtils.clamp(tangents[i].dot(weldHole.holeNormal), -1, 1)
        const perpSin = Math.sqrt(Math.max(0, 1 - dotN * dotN))
        const clearance = (pts[i].x - weldHole.holeCenter.x) * weldHole.holeNormal.x
          + (pts[i].y - weldHole.holeCenter.y) * weldHole.holeNormal.y
          + (pts[i].z - weldHole.holeCenter.z) * weldHole.holeNormal.z
          - ringRadii[i] * perpSin
        if (clearance >= minClear) { found = i; break }
      }
      firstKeepIdx = found >= 2 ? found : Math.min(maxStart, Math.max(2, Math.round(totalRings * .22)))
    }
    const emittedRings = totalRings - firstKeepIdx
    const start = position.length / 3

    for (let i = firstKeepIdx; i < totalRings; i++) {
      const t = MathUtils.clamp(ringT[i], 0, 1)
      const r = ringRadii[i]
      const y = pts[i].y
      const isBuriedRoot = Boolean(parent && i === 0)
      const isDomeRing = Boolean(isTrunk && i >= baseRings)
      const kVec = smoothK[i]
      const kappa = kVec.length()
      const rowStart = start + (i - firstKeepIdx) * cols
      const metricScale = MathUtils.clamp(r / Math.max(.08, trunk.radius), .08, 1.35)

      if (useSculpt) seamPairs.push([rowStart, rowStart + segs])

      // Near ground y = 0 on sculpted trunk base, smoothly level ring frame horizontally to avoid tilted base cliff!
      const baseLevelMix = (useSculpt && isTrunk && !isDomeRing && i < 3) ? (1 - i / 3) * .82 : 0

      for (let j = 0; j < cols; j++) {
        const uFrac = j / segs
        if (useSculpt && j === segs) {
          // EXACT SEAM CLOSURE (GPT P0): copy position, color, metric bit-for-bit from j = 0 while advancing uv.x by +1.0!
          const p0 = rowStart * 3
          const u0 = rowStart * 2
          position.push(position[p0], position[p0 + 1], position[p0 + 2])
          color.push(color[p0], color[p0 + 1], color[p0 + 2])
          uv!.push(uv![u0] + 1.0, uv![u0 + 1])
          metric!.push(metric![rowStart])
          continue
        }

        const a = uFrac * Math.PI * 2
        const ca = Math.cos(a), sa = Math.sin(a)
        let rr = r, ridge = 0, cavity = 0, crest = 0
        let uvU = uFrac, uvV = (arcLen[i] / Math.max(.4, trunk.height)) * 2.1

        if (isTrunk && !isDomeRing) {
          if (useSculpt && sculpt) {
            radDir.set(0, 0, 0).addScaledVector(normals[i], ca).addScaledVector(binormals[i], sa)
            const concavity = kappa > 1e-4 ? MathUtils.clamp(radDir.dot(kVec) * r * 2.8, 0, 1) : 0
            const scRes = evalBarkSculpt({
              sculpt, angle: a, t, arcLen: arcLen[i], y, baseRadius: r, refHeight: trunk.height,
              phase, concavity, isTrunk: true, barkScale,
              flare: trunk.flare, flareLobes: trunk.flareLobes, flareHeight: trunk.flareHeight,
              heightField: options.heightField, plan: trunkPlan,
            })
            // Smoothly attenuate harsh top-ring radial sculpt spikes into the top-fork apical dome (t > 0.90)
            const topForkBlend = topForks.length > 0 ? MathUtils.smoothstep(t, 0.90, 1.0) * 0.55 : 0
            rr = MathUtils.lerp(scRes.finalRadius, r, topForkBlend)
            if (trunkSurfGrid && i < baseRings) trunkSurfGrid[i * segs + j] = rr
            cavity = scRes.cavity * (1 - topForkBlend * 0.5)
            crest = scRes.crest * (1 - topForkBlend * 0.4)
            uvU = scRes.uvU
            uvV = scRes.uvV
          } else {
            // Strictly 2*PI-periodic integer harmonic root flare (fixes legacy sin(2.3*a) seam break!)
            const lobes = Math.max(0, Math.cos(trunk.flareLobes * a + phase + Math.sin(a * 2.0 + phase * .5) * .35))
            rr *= 1 + trunk.flare * Math.exp(-y / Math.max(.05, trunk.flareHeight)) * (.35 + .9 * lobes ** 1.6)
            ridge = Math.sin(trunk.barkRidges * a + y * 1.4 + Math.sin(y * 2.1 + phase) * .7)
            rr *= 1 + trunk.barkDepth * ridge * (1 - .5 * t)
          }
        } else if (isTrunk && isDomeRing && topForks.length > 0) {
          // Gently bulge apical dome toward emerging top-fork directions for an organic Y-crotch transition
          radDir.set(0, 0, 0).addScaledVector(normals[i], ca).addScaledVector(binormals[i], sa)
          const domeIdx = i - baseRings
          const fade = domeIdx === 0 ? 0.14 : domeIdx === 1 ? 0.08 : 0.02
          let forkAlign = 0
          for (const tf of topForks) forkAlign = Math.max(forkAlign, Math.max(0, radDir.dot(tf.dir)))
          rr *= 1 + forkAlign * forkAlign * fade
        } else if (b.level === 1 && !isBuriedRoot) {
          if (useSculpt && sculpt) {
            radDir.set(0, 0, 0).addScaledVector(normals[i], ca).addScaledVector(binormals[i], sa)
            const concavity = kappa > 1e-4 ? MathUtils.clamp(radDir.dot(kVec) * r * 2.4, 0, 1) : 0
            const scRes = evalBarkSculpt({
              sculpt, angle: a, t, arcLen: arcLen[i], y, baseRadius: r, refHeight: Math.max(.8, trunk.height * .75),
              phase: phase + b.id * 1.13, concavity, isTrunk: false, barkScale,
              flare: 0, flareLobes: 0, flareHeight: 1,
              heightField: options.heightField,
            })
            rr = scRes.finalRadius
            // Asymmetric flared collar skirt on primary limbs emerging from sculpted trunk (GPT 4.3!)
            if (parentIsSculptTrunk && t < .22 && limbShallowFade > .01) {
              const collarEnv = Math.exp(-(((t - .06) / .085) ** 2)) * limbShallowFade
              const underBias = .5 + .5 * Math.cos(a - limbDownAngle) // thicker supporting underside shoulder
              // Welded limbs get their main flare from the C1 Hermite fillet bridge, keeping a subtle underside reinforcement
              const skirtGain = weldHole ? .45 : 1.0
              rr *= 1 + collarEnv * (.16 + .22 * underBias) * skirtGain
              // Queue normal blend across the contact transition zone (only for non-welded fallback collars!)
              if (!weldHole && t < .16 && savedTrunkData && limbSocketHint) {
                const nWeight = (1 - MathUtils.smoothstep(t, .01, .16)) * .72 * limbShallowFade
                if (nWeight > .02) {
                  const pAngNorm = (((limbSocketHint.angle / (Math.PI * 2)) % 1) + 1) % 1
                  const pj = Math.floor(pAngNorm * savedTrunkData.segs) % savedTrunkData.segs
                  const pVertA = savedTrunkData.startVert + parentCollarRingIdx * savedTrunkData.cols + pj
                  const pRingB = Math.min(savedTrunkData.rings - 1, parentCollarRingIdx + 1)
                  const pVertB = savedTrunkData.startVert + pRingB * savedTrunkData.cols + pj
                  collarBlends.push({ vertIdx: rowStart + j, weight: nWeight, parentVertA: pVertA, parentVertB: pVertB, alpha: .5 })
                  if (j === 0 && useSculpt) {
                    collarBlends.push({ vertIdx: rowStart + segs, weight: nWeight, parentVertA: pVertA, parentVertB: pVertB, alpha: .5 })
                  }
                }
              }
            }
            cavity = scRes.cavity
            crest = scRes.crest
            uvU = scRes.uvU
            uvV = scRes.uvV + weldVOffset
          } else {
            ridge = Math.sin(5 * a + t * 4)
            const fade = Math.min(1, t / .12)
            rr *= 1 + trunk.barkDepth * .55 * ridge * fade
          }
        } else if (parentLimbData && !isBuriedRoot && t < .18) {
          // Soft normal-blended collar transition for thicker secondary branches emerging from primary limbs
          const nWeight = (1 - MathUtils.smoothstep(t, .01, .18)) * .58
          if (nWeight > .02) {
            const pVertA = parentLimbData.startVert + secParentRingIdx * parentLimbData.cols + secParentColIdx
            const pRingB = Math.min(parentLimbData.rings - 1, secParentRingIdx + 1)
            const pVertB = parentLimbData.startVert + pRingB * parentLimbData.cols + secParentColIdx
            collarBlends.push({ vertIdx: rowStart + j, weight: nWeight, parentVertA: pVertA, parentVertB: pVertB, alpha: .5 })
            if (j === 0 && useSculpt) {
              collarBlends.push({ vertIdx: rowStart + segs, weight: nWeight, parentVertA: pVertA, parentVertB: pVertB, alpha: .5 })
            }
          }
        }

        vOff.set(0, 0, 0)
          .addScaledVector(normals[i], ca * rr)
          .addScaledVector(binormals[i], sa * rr)

        if (baseLevelMix > 0) {
          vOff.y *= 1 - baseLevelMix
        }

        // Smooth curvature-aware anti-fold limit (softer threshold prevents harsh rubber-hose pinch crease!)
        if (kappa > 1e-4) {
          const comp = vOff.dot(kVec)
          if (comp > .62) {
            const clamped = .62 + .26 * Math.tanh((comp - .62) / .26)
            vOff.addScaledVector(kVec, (clamped - comp) / (kappa * kappa))
          }
        }

        const p = pts[i].clone().add(vOff)
        if ((isTrunk && i === 0) || p.y < 0) p.y = 0
        position.push(p.x, p.y, p.z)
        if (uv) uv.push(uvU, uvV)
        if (metric) metric.push(metricScale)

        const height = MathUtils.clamp(y / trunk.height, 0, 1)
        c.copy(b.role === 'dead' ? dead : bark).lerp(barkLight, .25 + height * .35 + (isTrunk ? 0 : .08))
        c.lerp(crevice, MathUtils.clamp(-ridge, 0, 1) * .55)
        if (useSculpt && sculpt) {
          if (cavity > 0.001) c.lerp(deepCrevice, cavity * sculpt.creviceAO * .84)
          if (crest > 0.001) c.lerp(bleachedCrest, crest * sculpt.crestWear * .52)
        }
        if (isTrunk) c.multiplyScalar(.84 + .16 * Math.min(1, y / .55))
        else if (parent && t < .16) {
          // Gentle contact grounding shadow right at collar seam (softer on sculpted normal-blended collars)
          const collarDim = parentIsSculptTrunk ? .92 : .84
          c.multiplyScalar(collarDim + (1 - collarDim) * (t / .16))
        }
        color.push(c.r, c.g, c.b)
      }
    }

    if (useSculpt && isTrunk && trunkPlan && trunkSurfGrid) {
      savedTrunkData = {
        branch: b,
        pts: pts.slice(0, baseRings),
        tangents: tangents.slice(0, baseRings),
        normals: normals.slice(0, baseRings),
        binormals: binormals.slice(0, baseRings),
        radii: ringRadii.slice(0, baseRings),
        ringT: ringT.slice(0, baseRings),
        arcLen: arcLen.slice(0, baseRings),
        surfGrid: trunkSurfGrid,
        startVert: start,
        rings: baseRings,
        segs,
        cols,
        plan: trunkPlan,
      }
      if (sculpt?.weldCollars && detail >= 0.45 && trunkPlan.sockets.length > 0) {
        trunkWeldPlan = planTrunkWeldHoles(savedTrunkData, trunkPlan.sockets, position)
      }
    }

    for (let i = 0; i < emittedRings - 1; i++) {
      for (let j = 0; j < segs; j++) {
        if (isTrunk && trunkWeldPlan && i < baseRings && trunkWeldPlan.skipTrunkQuad[i * segs + j]) continue
        const a = start + i * cols + j
        const bb = useSculpt ? a + 1 : start + i * cols + (j + 1) % segs
        index.push(a, bb, bb + cols, a, bb + cols, a + cols)
      }
    }

    if (b.level === 1 && emittedRings >= 2) {
      savedLimbRings.set(b.id, {
        startVert: start,
        rings: emittedRings,
        segs,
        cols,
        ringT: ringT.slice(firstKeepIdx),
        normals: normals.slice(firstKeepIdx),
        binormals: binormals.slice(firstKeepIdx),
      })
    }

    if (weldHole && uv && metric) {
      const childRingVerts = Array.from({ length: segs }, (_, j) => start + j)
      bridgeWeldedCollar(
        weldHole,
        childRingVerts,
        pts[firstKeepIdx],
        tangents[firstKeepIdx],
        normals[firstKeepIdx],
        binormals[firstKeepIdx],
        { position, uv, color, metric, index, seamPairs },
      )
    }

    if ((parent || !isTrunk) && !weldHole) {
      const rootCap = position.length / 3
      const r0Pt = pts[0]
      position.push(r0Pt.x, Math.max(0, r0Pt.y), r0Pt.z)
      if (uv) uv.push(.5, 0)
      if (metric) metric.push(.2)
      color.push(c.r * .75, c.g * .75, c.b * .75)
      for (let j = 0; j < segs; j++) {
        const nextJ = useSculpt ? j + 1 : (j + 1) % segs
        index.push(rootCap, start + nextJ, start + j)
      }
    } else if (useSculpt && isTrunk) {
      // Watertight flat bottom cap on ground plane y = 0 for sculpted integrated buttresses
      const baseCap = position.length / 3
      position.push(pts[0].x, 0, pts[0].z)
      if (uv) uv.push(.5, 0)
      if (metric) metric.push(1)
      color.push(bark.r * .65, bark.g * .65, bark.b * .65)
      for (let j = 0; j < segs; j++) {
        index.push(baseCap, start + j + 1, start + j)
      }
    }

    const tip = position.length / 3
    const end = pts[totalRings - 1].clone()
    if (isTrunk && ringRadii[baseRings - 1] > .025) {
      end.addScaledVector(tangents[totalRings - 1], ringRadii[baseRings - 1] * .06)
    }
    position.push(end.x, Math.max(0, end.y), end.z)
    if (uv) uv.push(.5, (arcLen[totalRings - 1] / Math.max(.4, trunk.height)) * 2.1)
    if (metric) metric.push(.15)
    color.push(c.r, c.g, c.b)
    const last = start + (emittedRings - 1) * cols
    for (let j = 0; j < segs; j++) {
      const nextJ = useSculpt ? j + 1 : (j + 1) % segs
      index.push(tip, last + j, last + nextJ)
    }
  }

  // Layer 4: Style-gated short detached hero strands (0 for stylized, 1-3 for weathered driftwood!)
  if (useSculpt && sculpt && uv && metric && savedTrunkData && lod.activeStrands > 0) {
    appendHeroStrands({
      trunkBranch: savedTrunkData.branch,
      trunkPts: savedTrunkData.pts,
      trunkNormals: savedTrunkData.normals,
      trunkBinormals: savedTrunkData.binormals,
      trunkRadii: savedTrunkData.radii,
      trunkT: savedTrunkData.ringT,
      trunkArc: savedTrunkData.arcLen,
      trunkSurfGrid: savedTrunkData.surfGrid,
      trunkGridRings: savedTrunkData.rings,
      trunkGridSegs: savedTrunkData.segs,
      deadCenters,
      plan: savedTrunkData.plan,
      trunkHeight: trunk.height,
      trunkRadius: trunk.radius,
      sculpt,
      activeStrands: lod.activeStrands,
      strandRings: lod.strandRings,
      strandSegs: lod.strandSegs,
      bark,
      barkLight,
      crevice,
      position,
      uv,
      color,
      metric,
      index,
      seamPairs,
    })
  }

  // Optional separate crawling ground roots (controlled independently via trunk.surfaceRoots)
  const rootCount = Math.min(8, Math.max(0, Math.round(trunk.surfaceRoots ?? 0)))
  const trunkBranch = branches.find(b => b.role === 'trunk')
  if (rootCount > 0 && trunkBranch) {
    const rRng = rng(seedFor(seed, 4401))
    const baseCenter = trunkBranch.points[0]
    const rootRings = Math.max(5, Math.round(10 * detail))
    const rootSegs = Math.max(4, Math.round(7 * detail))
    const rootCols = useSculpt ? rootSegs + 1 : rootSegs
    for (let k = 0; k < rootCount; k++) {
      const a0 = phase + k * Math.PI * 2 / rootCount + (rRng() - .5) * .45
      const len = trunk.radius * (3.1 + rRng() * 2.4)
      const rStart = trunk.radius * (.42 + rRng() * .16)
      const liftY = Math.min(trunk.flareHeight * .62, trunk.radius * (1.05 + rRng() * .48))
      const curveSwing = (rRng() - .5) * .85
      const pts: Vector3[] = []
      const rads: number[] = []
      for (let i = 0; i < rootRings; i++) {
        const s = i / (rootRings - 1)
        const ang = a0 + curveSwing * s * s + Math.sin(s * Math.PI * 1.5) * .16
        const dist = trunk.radius * .35 + len * s
        const arch = liftY * (1 - s) ** 2.0 + trunk.radius * .16 * Math.sin(Math.PI * s) * (1 - s)
        const rr = rStart * (1 - s * .86) ** 1.15 * (i === 0 ? .84 : 1)
        pts.push(new Vector3(
          baseCenter.x + Math.cos(ang) * dist,
          Math.max(rr * .35, arch),
          baseCenter.z + Math.sin(ang) * dist,
        ))
        rads.push(rr)
      }
      const { normals, binormals } = transportFrames(pts)
      const start = position.length / 3
      for (let i = 0; i < rootRings; i++) {
        const s = i / (rootRings - 1)
        const rr = rads[i]
        const rowStart = start + i * rootCols
        if (useSculpt) seamPairs.push([rowStart, rowStart + rootSegs])
        for (let j = 0; j < rootCols; j++) {
          const uFrac = j / rootSegs
          if (useSculpt && j === rootSegs) {
            const p0 = rowStart * 3
            const u0 = rowStart * 2
            position.push(position[p0], position[p0 + 1], position[p0 + 2])
            color.push(color[p0], color[p0 + 1], color[p0 + 2])
            uv!.push(uv![u0] + 1.0, uv![u0 + 1])
            metric!.push(metric![rowStart])
            continue
          }
          const a = uFrac * Math.PI * 2
          const ridge = Math.sin(4 * a + s * 5)
          const p = pts[i].clone()
            .addScaledVector(normals[i], Math.cos(a) * rr * (1 + .08 * ridge))
            .addScaledVector(binormals[i], Math.sin(a) * rr * (1 + .08 * ridge))
          if (p.y < 0) p.y = 0
          position.push(p.x, p.y, p.z)
          if (uv) uv.push(uFrac, s * 1.6)
          if (metric) metric.push(MathUtils.clamp(rr / Math.max(.08, trunk.radius), .12, .8))
          c.copy(bark).lerp(barkLight, .18 + .2 * (1 - s)).lerp(crevice, MathUtils.clamp(-ridge, 0, 1) * .45)
          c.multiplyScalar(.76 + .24 * Math.min(1, p.y / Math.max(.08, liftY)))
          color.push(c.r, c.g, c.b)
        }
      }
      for (let i = 0; i < rootRings - 1; i++) {
        for (let j = 0; j < rootSegs; j++) {
          const a = start + i * rootCols + j
          const bb = useSculpt ? a + 1 : start + i * rootCols + (j + 1) % rootSegs
          index.push(a, bb, bb + rootCols, a, bb + rootCols, a + rootCols)
        }
      }
      const tip = position.length / 3
      const end = pts[rootRings - 1].clone()
      end.y = 0
      position.push(end.x, end.y, end.z)
      if (uv) uv.push(.5, 1.6)
      if (metric) metric.push(.12)
      color.push(c.r, c.g, c.b)
      const last = start + (rootRings - 1) * rootCols
      for (let j = 0; j < rootSegs; j++) {
        const nextJ = useSculpt ? j + 1 : (j + 1) % rootSegs
        index.push(tip, last + j, last + nextJ)
      }
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3))
  if (uv) geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  if (metric) geometry.setAttribute('barkMetric', new Float32BufferAttribute(metric, 1))
  geometry.setAttribute('color', new Float32BufferAttribute(color, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()

  const nAttr = geometry.getAttribute('normal') as Float32BufferAttribute
  // 1. Weld smooth vertex normals across ALL cylindrical UV seam & split-UV collar equivalence classes
  //    using connected-component union-find (handles multi-twin seams like [j=0, j=segs] + [j=0, twin] cleanly!)
  if (seamPairs.length > 0) {
    const parentOf = new Map<number, number>()
    const find = (x: number): number => {
      let r = x
      while (parentOf.has(r) && parentOf.get(r)! !== r) r = parentOf.get(r)!
      let cur = x
      while (cur !== r) {
        const nxt = parentOf.get(cur) ?? cur
        parentOf.set(cur, r)
        cur = nxt
      }
      return r
    }
    for (const [i0, i1] of seamPairs) {
      if (!parentOf.has(i0)) parentOf.set(i0, i0)
      if (!parentOf.has(i1)) parentOf.set(i1, i1)
      const r0 = find(i0), r1 = find(i1)
      if (r0 !== r1) parentOf.set(r1, r0)
    }
    const groups = new Map<number, number[]>()
    for (const v of parentOf.keys()) {
      const r = find(v)
      let g = groups.get(r)
      if (!g) { g = []; groups.set(r, g) }
      g.push(v)
    }
    for (const members of groups.values()) {
      let nx = 0, ny = 0, nz = 0
      for (const vi of members) {
        nx += nAttr.getX(vi)
        ny += nAttr.getY(vi)
        nz += nAttr.getZ(vi)
      }
      const len = Math.hypot(nx, ny, nz)
      if (len > 1e-5) {
        const ix = nx / len, iy = ny / len, iz = nz / len
        for (const vi of members) nAttr.setXYZ(vi, ix, iy, iz)
      }
    }
  }

  // 2. Projected collar normal blending (GPT 4.3): softens lighting across primary limb collar contact band!
  if (collarBlends.length > 0) {
    for (const cb of collarBlends) {
      const pnx = MathUtils.lerp(nAttr.getX(cb.parentVertA), nAttr.getX(cb.parentVertB), cb.alpha)
      const pny = MathUtils.lerp(nAttr.getY(cb.parentVertA), nAttr.getY(cb.parentVertB), cb.alpha)
      const pnz = MathUtils.lerp(nAttr.getZ(cb.parentVertA), nAttr.getZ(cb.parentVertB), cb.alpha)
      const pLen = Math.hypot(pnx, pny, pnz)
      if (pLen < 1e-5) continue
      const cx = nAttr.getX(cb.vertIdx), cy = nAttr.getY(cb.vertIdx), cz = nAttr.getZ(cb.vertIdx)
      const bx = MathUtils.lerp(cx, pnx / pLen, cb.weight)
      const by = MathUtils.lerp(cy, pny / pLen, cb.weight)
      const bz = MathUtils.lerp(cz, pnz / pLen, cb.weight)
      const bLen = Math.hypot(bx, by, bz)
      if (bLen > 1e-5) nAttr.setXYZ(cb.vertIdx, bx / bLen, by / bLen, bz / bLen)
    }
  }

  // 3. Sanitize any unreferenced vertices (e.g. interior vertices inside welded trunk socket cutouts)
  //    so every NORMAL entry in the attribute buffer strictly obeys unit length (glTF 2.0 compliance).
  if (trunkWeldPlan && trunkWeldPlan.weldedCount > 0) {
    for (let i = 0; i < nAttr.count; i++) {
      const lenSq = nAttr.getX(i) ** 2 + nAttr.getY(i) ** 2 + nAttr.getZ(i) ** 2
      if (lenSq < 1e-6) nAttr.setXYZ(i, 0, 1, 0)
    }
  }

  // Expose fixed feature anchors, seam pair indices, weld stats & GLB normal/AO bake metadata
  if (savedTrunkData) {
    geometry.userData.sculptMeta = {
      seamPairsCount: seamPairs.length,
      seamPairs: seamPairs.slice(0, savedTrunkData.rings),
      primaryRoots: savedTrunkData.plan.ribs
        .filter(r => r.isPrimaryRoot)
        .map(r => ({ id: r.id, rootAngle: r.rootAngle, buttressReach: r.buttressReach })),
      activeStrandIds: savedTrunkData.plan.strandAnchors
        .slice(0, lod.activeStrands)
        .map(s => ({ id: s.id, parentRibId: s.parentRibId })),
    }
    let crossSeamCount = 0
    if (trunkWeldPlan) {
      for (const h of trunkWeldPlan.holesByBranchId.values()) {
        if (h.crossesSeam) crossSeamCount++
      }
    }
    geometry.userData.weldStats = trunkWeldPlan
      ? { weldedCount: trunkWeldPlan.weldedCount, skippedOverlap: trunkWeldPlan.skippedOverlap, crossSeamCount }
      : { weldedCount: 0, skippedOverlap: 0, crossSeamCount: 0 }
    geometry.userData.sculptBakeInfo = {
      trunk,
      seed,
      detail,
      plan: savedTrunkData.plan,
      heightField: options.heightField,
    }
  }

  geometry.computeBoundingBox()
  return geometry
}
