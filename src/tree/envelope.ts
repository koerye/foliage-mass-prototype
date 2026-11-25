// Editable crown envelope.
//
// Base shape: superellipsoid (broadleaf) or cone profile (conifer) around the
// crown axis. User handles add a smooth displacement field D(p); the deformed
// envelope is p' = p + D(p). Skeleton points are generated in base space and
// pushed through the field, so dragging a handle bends/extends the branches
// near it and the foliage follows. Bare handles are spheres where foliage is removed.
import { Vector3 } from 'three'
import { rng, seedFor } from '../shape'
import type { CrownHandle, TreeSpec, XYZ } from './spec'

const v3 = (a: XYZ) => new Vector3(a[0], a[1], a[2])
export const falloff = (d: number) => d >= 1 ? 0 : (1 - d * d) ** 2

/** Evaluates a smooth monotone vertical radial-scale curve `[u, scale][]` at normalized crown height `u ∈ [0, 1]`.
 *  Returns `1.0` when undefined or fewer than 2 control points (preserving 100% baseline envelope behavior). */
export function evalProfileCurve(curve: [number, number][] | undefined, u: number): number {
  if (!curve || curve.length < 2) return 1
  const t = Math.min(1, Math.max(0, u))
  const n = curve.length
  if (t <= curve[0][0]) return Math.min(1.85, Math.max(0.15, curve[0][1]))
  if (t >= curve[n - 1][0]) return Math.min(1.85, Math.max(0.15, curve[n - 1][1]))

  // Find bracketing segment
  let i = 0
  while (i < n - 2 && t > curve[i + 1][0]) i++
  const x0 = curve[i][0], y0 = curve[i][1]
  const x1 = curve[i + 1][0], y1 = curve[i + 1][1]
  const dx = x1 - x0
  if (dx < 1e-6) return Math.min(1.85, Math.max(0.15, y0))

  // Smooth monotone Hermite tangents (Fritsch-Carlson clamping avoids overshoot spikes)
  const secant = (idx: number) => {
    const d = curve[idx + 1][0] - curve[idx][0]
    return d > 1e-6 ? (curve[idx + 1][1] - curve[idx][1]) / d : 0
  }
  const dCur = secant(i)
  const tangentAt = (idx: number) => {
    if (idx === 0) return secant(0)
    if (idx === n - 1) return secant(n - 2)
    const dL = secant(idx - 1), dR = secant(idx)
    if (dL * dR <= 0) return 0
    return (2 * dL * dR) / (dL + dR)
  }
  const m0 = tangentAt(i)
  const m1 = tangentAt(i + 1)
  const s = (t - x0) / dx
  const s2 = s * s, s3 = s2 * s
  const val = (2 * s3 - 3 * s2 + 1) * y0
    + (s3 - 2 * s2 + s) * dx * m0
    + (-2 * s3 + 3 * s2) * y1
    + (s3 - s2) * dx * m1
  // Gentle clamp against any numerical edge noise
  const lo = Math.min(y0, y1) - Math.abs(dCur * dx) * 0.08
  const hi = Math.max(y0, y1) + Math.abs(dCur * dx) * 0.08
  return Math.min(1.85, Math.max(0.15, Math.min(hi, Math.max(lo, val))))
}

export class CrownEnvelope {
  readonly kind: TreeSpec['kind']
  readonly y0: number
  readonly y1: number
  readonly width: number
  readonly axis: Vector3
  readonly depth: number
  private readonly n: number
  private readonly topBias: number
  private readonly cone: number
  private readonly irregularity: number
  private readonly profileCurve?: [number, number][]
  private readonly phases: number[]
  private readonly shapes: { anchor: Vector3; offset: Vector3; radius: number }[]
  private readonly bares: { center: Vector3; radius: number }[]

  constructor(spec: TreeSpec, axis = new Vector3(), bounds?: { y0: number; y1: number; width: number }) {
    const { trunk, crown } = spec
    const safeNum = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback)
    this.kind = spec.kind
    const y0Raw = bounds ? safeNum(bounds.y0, 0) : safeNum(trunk.height, 4) * safeNum(crown.base, 0.3)
    const y1Raw = bounds ? safeNum(bounds.y1, y0Raw + 1) : safeNum(trunk.height, 4) * safeNum(crown.top, 1)
    this.y0 = y0Raw
    this.y1 = Math.max(this.y0 + .3, y1Raw)
    this.width = Math.max(.2, safeNum(bounds ? bounds.width : crown.width, 1))
    this.axis = new Vector3(safeNum(axis.x, 0), 0, safeNum(axis.z, 0))
    this.depth = Math.max(1e-4, safeNum(crown.depth, 1))
    this.n = Math.max(1.2, safeNum(crown.roundness, 2))
    this.topBias = Math.max(1e-4, safeNum(crown.topBias, 1))
    this.cone = Math.max(1e-4, safeNum(crown.coneShape, 1))
    this.irregularity = Math.max(0, Math.min(2, safeNum(crown.irregularity, 0)))
    this.profileCurve = crown.profileCurve && crown.profileCurve.length >= 2
      ? [...crown.profileCurve].sort((a, b) => a[0] - b[0])
      : undefined
    const random = rng(seedFor(spec.seed, 77))
    this.phases = [random(), random(), random()].map(x => x * Math.PI * 2)
    this.shapes = spec.handles.filter(h => h.kind === 'shape')
      .map(h => ({ anchor: v3(h.anchor), offset: v3(h.offset), radius: Math.max(1e-4, safeNum(h.radius, 1)) }))
    this.bares = spec.handles.filter(h => h.kind === 'bare')
      .map(h => ({ center: v3(h.anchor), radius: Math.max(1e-4, safeNum(h.radius, 1)) }))
  }

  get height() { return Math.max(1e-4, this.y1 - this.y0) }

  /** angular radius factor (depth ellipse + irregular lobes) */
  angular(theta: number) {
    const c = Math.cos(theta), s = Math.sin(theta) / this.depth
    const ellipse = 1 / Math.max(1e-4, Math.sqrt(c * c + s * s))
    const [a, b] = this.phases
    return Math.max(1e-4, ellipse * (1 + this.irregularity * .22 * (Math.sin(2 * theta + a) * .6 + Math.sin(3 * theta + b) * .4)))
  }

  private remap(u: number) {
    // broadleaf: topBias > 1 moves the widest section up
    return u <= 0 ? u : u >= 1 ? u : u ** (1 / Math.max(1e-4, this.topBias))
  }

  /** normalized profile radius at crown height fraction u (modulated by optional vertical profileCurve) */
  profile(u: number) {
    const t = Math.min(1, Math.max(0, u))
    const curveScale = evalProfileCurve(this.profileCurve, t)
    if (this.kind === 'conifer') return (Math.max(0, 1 - t) ** this.cone) * curveScale
    const v = Math.abs(2 * this.remap(t) - 1)
    return (Math.max(0, 1 - v ** this.n) ** (1 / this.n)) * curveScale
  }

  baseRadius(u: number, theta: number) { return this.width * this.profile(u) * this.angular(theta) }

  /** point on the undeformed envelope */
  surface(u: number, theta: number, scale = 1) {
    const r = this.baseRadius(u, theta) * scale
    return new Vector3(this.axis.x + Math.cos(theta) * r, this.y0 + u * this.height, this.axis.z + Math.sin(theta) * r)
  }

  /** normalized radius in base space: <1 inside, 1 on the surface */
  rhoBase(q: Vector3) {
    const u = (q.y - this.y0) / Math.max(1e-4, this.height)
    const dx = q.x - this.axis.x, dz = q.z - this.axis.z
    const h = Math.hypot(dx, dz), theta = Math.atan2(dz, dx)
    const ring = Math.max(1e-4, this.width * this.angular(theta))
    if (this.kind === 'conifer') {
      if (u >= 1) return 1 + (u - 1) * 6 + h / ring
      const r = Math.max(1e-4, ring * Math.max(.015, this.profile(u)))
      const radial = h / r
      return u < 0 ? Math.max(radial, 1 - u * 4) : radial
    }
    const curveScale = evalProfileCurve(this.profileCurve, u)
    const v = Math.abs(2 * this.remap(u) - 1)
    return ((h / Math.max(0.05, ring * curveScale)) ** this.n + v ** this.n) ** (1 / this.n)
  }

  displacement(p: Vector3, target = new Vector3()) {
    target.set(0, 0, 0)
    for (const h of this.shapes) {
      const w = falloff(p.distanceTo(h.anchor) / Math.max(1e-4, h.radius))
      if (w > 0) target.addScaledVector(h.offset, w)
    }
    return target
  }

  /** push a base-space point through the handle field; weight lets the trunk stay rooted */
  deform(p: Vector3, weight = 1) {
    if (!this.shapes.length || weight <= 0) return p.clone()
    return p.clone().addScaledVector(this.displacement(p), weight)
  }

  /** skeleton deformation: interior/trunk points move less than crown-surface points */
  deformSkeleton(p: Vector3) {
    const rho = this.rhoBase(p)
    const w = Math.min(1, Math.max(0, (rho - .08) / .7))
    return this.deform(p, w * w * (3 - 2 * w))
  }

  /** approximate inverse of deform (fixed-point iteration) */
  undeform(p: Vector3) {
    if (!this.shapes.length) return p.clone()
    // damped fixed point: q += a * (p - deform(q)); robust when the field is steep
    const q = p.clone().sub(this.displacement(p)), d = new Vector3(), r = new Vector3()
    for (let i = 0; i < 12; i++) {
      r.copy(p).sub(q).sub(this.displacement(q, d))
      if (r.lengthSq() < 1e-8) break
      q.addScaledVector(r, .65)
    }
    return q
  }

  /** normalized radius of the deformed envelope */
  rho(p: Vector3) { return this.rhoBase(this.undeform(p)) }

  /** outward normal of the deformed envelope (numerical gradient) */
  normal(p: Vector3, target = new Vector3()) {
    const e = Math.max(.02, this.width * .03)
    const q = p.clone()
    const f = (axis: 'x' | 'y' | 'z') => {
      q.copy(p); q[axis] += e; const a = this.rho(q)
      q.copy(p); q[axis] -= e; const b = this.rho(q)
      return a - b
    }
    target.set(f('x'), f('y'), f('z'))
    if (target.lengthSq() < 1e-12) target.set(0, 1, 0)
    return target.normalize()
  }

  /** 0..1 bare-zone strength (1 = fully bare) */
  bare(p: Vector3) {
    let b = 0
    for (const z of this.bares) b = Math.max(b, falloff(p.distanceTo(z.center) / Math.max(1e-4, z.radius)) ** .25)
    return b
  }

  /** move a point (inside the base crown) onto/inside the envelope along a ray from `from` */
  clampInside(from: Vector3, to: Vector3, limit = .97) {
    if (this.rhoBase(to) <= limit) return to.clone()
    let lo = 0, hi = 1
    const p = new Vector3()
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2
      p.lerpVectors(from, to, mid)
      if (this.rhoBase(p) > limit) hi = mid
      else lo = mid
    }
    return p.lerpVectors(from, to, lo).clone()
  }
}

/** Default draggable handles: top, four sides, lower ring. */
export function defaultHandles(env: CrownEnvelope): CrownHandle[] {
  const handles: CrownHandle[] = []
  const add = (u: number, theta: number, radius: number) => {
    const p = env.surface(u, theta)
    handles.push({ id: handles.length + 1, kind: 'shape', anchor: [p.x, p.y, p.z], offset: [0, 0, 0], radius })
  }
  const conifer = env.kind === 'conifer'
  const side = conifer ? .32 : .5
  add(1, 0, conifer ? env.height * .45 : env.width * 1.1)
  for (let i = 0; i < 4; i++) add(side, i * Math.PI / 2, conifer ? env.height * .42 : env.width * 1.05)
  if (conifer) for (let i = 0; i < 4; i++) add(.05, Math.PI / 4 + i * Math.PI / 2, env.height * .3)
  return handles
}
