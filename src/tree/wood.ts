// Wood mesh: parallel-transport sweep with root flare buttresses, twisted bark
// ridges, non-protruding tapered branch root plugs, smooth apical trunk domes,
// curvature-aware anti-fold ring clamping, and baked vertex AO + height gradient.
import { BufferGeometry, Color, Float32BufferAttribute, MathUtils, Vector3 } from 'three'
import { rng, seedFor } from '../shape'
import { radiusAt, type Branch } from './skeleton'
import type { TrunkSpec } from './spec'

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
      // rotate previous normal by the rotation between successive tangents
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

function resample(branch: Branch, rings: number) {
  return Array.from({ length: rings }, (_, i) => branch.curve.getPoint(i / (rings - 1)))
}

export interface WoodOptions {
  /** 0.2..1.0 multiplier for ring and radial segment counts */
  detail?: number
  /** return true to omit a branch mesh (e.g. hidden inside foliage during LOD optimization) */
  skip?: (branch: Branch) => boolean
}

/** Exact triangle count generated for a single branch in buildWood / buildPalmWood (for SpeedTree Selected-Node HUD). */
export function estimateBranchTriangles(b: Branch, detail = 1, isPalm = false, palmRings = 18) {
  const d = MathUtils.clamp(detail, .2, 1)
  if (isPalm && b.role === 'trunk') {
    const ringCount = Math.max(4, Math.round(palmRings))
    const totalRings = Math.max(8, Math.round(ringCount * (d >= .6 ? 2.2 : d >= .38 ? 1.4 : .8)))
    const segs = Math.max(6, Math.round(16 * d))
    return (totalRings - 1) * segs * 2 + segs
  }
  const isTrunk = b.role === 'trunk'
  const baseRings = isTrunk
    ? Math.max(10, Math.round(44 * d))
    : b.level === 1 ? Math.max(5, Math.round(14 * d))
      : Math.max(3, Math.round((b.role === 'dead' ? 5 : 7) * d))
  const segs = isTrunk
    ? Math.max(6, Math.round(22 * d))
    : b.level === 1 ? Math.max(5, Math.round(9 * d))
      : Math.max(3, Math.round(5 * d))
  const hasParent = b.parentId !== undefined
  const domeRings = !hasParent && isTrunk && radiusAt(b, 1) > .025 ? 3 : 0
  const totalRings = baseRings + (hasParent ? 1 : domeRings)
  return (totalRings - 1) * segs * 2 + segs * (hasParent ? 2 : 1)
}

export function buildWood(branches: Branch[], trunk: TrunkSpec, seed: number, options: WoodOptions = {}) {
  const detail = MathUtils.clamp(options.detail ?? 1, .2, 1)
  const position: number[] = [], color: number[] = [], index: number[] = []
  const byId = new Map(branches.map(b => [b.id, b]))
  const customBark = trunk.barkColor && trunk.barkColor.toLowerCase() !== '#5b4636'
  const bark = new Color(trunk.barkColor || '#5b4636')
  const barkLight = customBark ? bark.clone().lerp(new Color('#f2ece6'), .32) : new Color('#9a7656')
  const crevice = customBark ? bark.clone().multiplyScalar(.48) : new Color('#2f231b')
  const dead = customBark ? bark.clone().lerp(new Color('#8e847c'), .35) : new Color('#7d6a58')
  const c = new Color()
  const phase = (seed % 997) / 997 * Math.PI * 2
  const kVec = new Vector3()
  const vOff = new Vector3()

  for (const b of branches) {
    if (options.skip?.(b)) continue
    const isTrunk = b.role === 'trunk'
    const baseRings = isTrunk
      ? Math.max(10, Math.round(44 * detail))
      : b.level === 1 ? Math.max(5, Math.round(14 * detail))
        : Math.max(3, Math.round((b.role === 'dead' ? 5 : 7) * detail))
    const segs = isTrunk
      ? Math.max(6, Math.round(22 * detail))
      : b.level === 1 ? Math.max(5, Math.round(9 * detail))
        : Math.max(3, Math.round(5 * detail))

    const rawPts = resample(b, baseRings)
    const parent = b.parentId !== undefined ? byId.get(b.parentId) : undefined
    const parentR = parent ? radiusAt(parent, b.socket ?? 0) : 0
    const pts: Vector3[] = []
    const ringRadii: number[] = []
    const ringT: number[] = []

    if (parent) {
      // Buried tapered root plug recessed gently DOWN into the parent's core along -parentTan
      // (NEVER laterally backward through the far wall, and radius strictly < parentR).
      const parentTan = parent.curve.getTangent(b.socket ?? 0).normalize()
      const sink = Math.min(parentR * .34, Math.max(.015, b.length * .12))
      const pIn = rawPts[0].clone().addScaledVector(parentTan, -sink)
      const r0 = Math.min(radiusAt(b, 0), parentR * .78)
      pts.push(pIn)
      ringRadii.push(Math.min(r0 * .44, parentR * .46))
      ringT.push(-.06)

      for (let i = 0; i < baseRings; i++) {
        const t = i / (baseRings - 1)
        let r = radiusAt(b, t)
        if (i === 0) {
          // On parent centerline: stay strictly inside parent wall so no open pipe rim pokes out
          r = Math.min(r * .86, parentR * .70)
        } else {
          // Smooth organic collar flare peaking gently right as the limb exits the parent bark
          const collar = 1 + .15 * Math.exp(-(((t - .09) / .09) ** 2))
          r *= collar
          if (t < .22) r = Math.min(r, MathUtils.lerp(parentR * .84, r, t / .22))
        }
        pts.push(rawPts[i])
        ringRadii.push(r)
        ringT.push(t)
      }
    } else {
      for (let i = 0; i < baseRings; i++) {
        const t = i / (baseRings - 1)
        pts.push(rawPts[i])
        ringRadii.push(radiusAt(b, t))
        ringT.push(t)
      }
      // Broadleaf trunk apical dome: smoothly round off thick trunk tops instead of a flat pipe cut
      const rEnd = ringRadii[ringRadii.length - 1]
      if (isTrunk && rEnd > .025) {
        const endPt = rawPts[baseRings - 1]
        const endTan = rawPts[baseRings - 1].clone().sub(rawPts[Math.max(0, baseRings - 2)])
        if (endTan.lengthSq() > 1e-10) endTan.normalize()
        else endTan.set(0, 1, 0)
        const domeSteps: [number, number][] = [[.20, .82], [.40, .50], [.54, .18]]
        for (const [ext, frac] of domeSteps) {
          pts.push(endPt.clone().addScaledVector(endTan, rEnd * ext))
          ringRadii.push(rEnd * frac)
          ringT.push(1)
        }
      }
    }

    const totalRings = pts.length
    const { tangents, normals, binormals } = transportFrames(pts)
    const start = position.length / 3

    for (let i = 0; i < totalRings; i++) {
      const t = MathUtils.clamp(ringT[i], 0, 1)
      const r = ringRadii[i]
      const y = pts[i].y
      const isBuriedRoot = Boolean(parent && i === 0)
      const isDomeRing = Boolean(isTrunk && i >= baseRings)

      // Curvature-aware anti-fold vector for tight bends (points toward concave inside of curve)
      let kappa = 0
      if (i > 0 && i < totalRings - 1) {
        const chord = pts[i + 1].distanceTo(pts[i - 1])
        if (chord > 1e-4) {
          kVec.subVectors(tangents[i + 1], tangents[i - 1]).multiplyScalar(1 / chord)
          kappa = kVec.length()
        }
      }

      for (let j = 0; j < segs; j++) {
        const a = j / segs * Math.PI * 2
        let rr = r, ridge = 0
        if (isTrunk && !isDomeRing) {
          const lobes = Math.max(0, Math.cos(trunk.flareLobes * a + phase + Math.sin(a * 2.3) * .4))
          rr *= 1 + trunk.flare * Math.exp(-y / Math.max(.05, trunk.flareHeight)) * (.35 + .9 * lobes ** 1.6)
          ridge = Math.sin(trunk.barkRidges * a + y * 1.4 + Math.sin(y * 2.1 + phase) * .7)
          rr *= 1 + trunk.barkDepth * ridge * (1 - .5 * t)
        } else if (b.level === 1 && !isBuriedRoot) {
          ridge = Math.sin(5 * a + t * 4)
          const fade = Math.min(1, t / .12)
          rr *= 1 + trunk.barkDepth * .55 * ridge * fade
        }

        vOff.set(0, 0, 0)
          .addScaledVector(normals[i], Math.cos(a) * rr)
          .addScaledVector(binormals[i], Math.sin(a) * rr)

        // Prevent concave inner rings from crossing/folding over each other on tight S-bends
        if (kappa > 1e-4) {
          const comp = vOff.dot(kVec)
          if (comp > .56) {
            const clamped = .56 + .24 * Math.tanh((comp - .56) / .24)
            vOff.addScaledVector(kVec, (clamped - comp) / (kappa * kappa))
          }
        }

        const p = pts[i].clone().add(vOff)
        // keep base rings and low root-collars flush with the ground plane (never poke below y = 0)
        if ((isTrunk && i === 0) || p.y < 0) p.y = 0
        position.push(p.x, p.y, p.z)

        const height = MathUtils.clamp(y / trunk.height, 0, 1)
        c.copy(b.role === 'dead' ? dead : bark).lerp(barkLight, .25 + height * .35 + (isTrunk ? 0 : .08))
        c.lerp(crevice, MathUtils.clamp(-ridge, 0, 1) * .55)
        if (isTrunk) c.multiplyScalar(.82 + .18 * Math.min(1, y / .6))
        else if (parent && t < .16) {
          // Soft organic branch-collar crease darkening right where the limb emerges
          c.multiplyScalar(.84 + .16 * (t / .16))
        }
        color.push(c.r, c.g, c.b)
      }
    }

    for (let i = 0; i < totalRings - 1; i++) {
      for (let j = 0; j < segs; j++) {
        const a = start + i * segs + j, bb = start + i * segs + (j + 1) % segs
        index.push(a, bb, bb + segs, a, bb + segs, a + segs)
      }
    }

    // Close buried root plug cleanly inside parent (prevents any open hollow cylinder edge)
    if (parent) {
      const rootCap = position.length / 3
      const r0Pt = pts[0]
      position.push(r0Pt.x, Math.max(0, r0Pt.y), r0Pt.z)
      color.push(c.r * .75, c.g * .75, c.b * .75)
      for (let j = 0; j < segs; j++) index.push(rootCap, start + (j + 1) % segs, start + j)
    }

    // Smooth apical tip cap
    const tip = position.length / 3
    const end = pts[totalRings - 1].clone()
    if (isTrunk && ringRadii[baseRings - 1] > .025) {
      end.addScaledVector(tangents[totalRings - 1], ringRadii[baseRings - 1] * .06)
    }
    position.push(end.x, Math.max(0, end.y), end.z)
    color.push(c.r, c.g, c.b)
    const last = start + (totalRings - 1) * segs
    for (let j = 0; j < segs; j++) index.push(tip, last + j, last + (j + 1) % segs)
  }

  // Sculptural crawling surface roots radiating from trunk flare along y >= 0
  const rootCount = Math.min(8, Math.max(0, Math.round(trunk.surfaceRoots ?? 0)))
  const trunkBranch = branches.find(b => b.role === 'trunk')
  if (rootCount > 0 && trunkBranch) {
    const rRng = rng(seedFor(seed, 4401))
    const baseCenter = trunkBranch.points[0]
    const rootRings = Math.max(5, Math.round(10 * detail))
    const rootSegs = Math.max(4, Math.round(7 * detail))
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
        for (let j = 0; j < rootSegs; j++) {
          const a = j / rootSegs * Math.PI * 2
          const ridge = Math.sin(4 * a + s * 5)
          const p = pts[i].clone()
            .addScaledVector(normals[i], Math.cos(a) * rr * (1 + .08 * ridge))
            .addScaledVector(binormals[i], Math.sin(a) * rr * (1 + .08 * ridge))
          if (p.y < 0) p.y = 0
          position.push(p.x, p.y, p.z)
          c.copy(bark).lerp(barkLight, .18 + .2 * (1 - s)).lerp(crevice, MathUtils.clamp(-ridge, 0, 1) * .45)
          c.multiplyScalar(.76 + .24 * Math.min(1, p.y / Math.max(.08, liftY)))
          color.push(c.r, c.g, c.b)
        }
      }
      for (let i = 0; i < rootRings - 1; i++) {
        for (let j = 0; j < rootSegs; j++) {
          const a = start + i * rootSegs + j, bb = start + i * rootSegs + (j + 1) % rootSegs
          index.push(a, bb, bb + rootSegs, a, bb + rootSegs, a + rootSegs)
        }
      }
      const tip = position.length / 3
      const end = pts[rootRings - 1].clone()
      end.y = 0
      position.push(end.x, end.y, end.z)
      color.push(c.r, c.g, c.b)
      const last = start + (rootRings - 1) * rootSegs
      for (let j = 0; j < rootSegs; j++) index.push(tip, last + j, last + (j + 1) % rootSegs)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(color, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  return geometry
}
