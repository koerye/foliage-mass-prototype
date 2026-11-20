// Conifer fronds: SpeedTree-style ribbons swept along level-1/level-2 branches.
// Each ring is a tent (left / ridge / right) plus an optional vertical cross
// ribbon for side volume. Normals are blended toward the editable crown envelope.
import { BufferAttribute, BufferGeometry, Color, Vector3 } from 'three'
import { rng, seedFor } from '../shape'
import { drapeDepth, drapeDown, drapeTilt, type Branch, type Skeleton } from './skeleton'
import type { TreeSpec } from './spec'

const UP = new Vector3(0, 1, 0)

interface Ribbon { twist?: number; branch: Branch | null; points: (t: number) => Vector3; tangent: (t: number) => Vector3; width: number; start: number; segments: number; fold: number; cross: number; up?: Vector3 }

export function buildFronds(skeleton: Skeleton, spec: TreeSpec) {
  if (spec.fronds.mode === 'drape') return buildDrape(skeleton, spec)
  if (spec.fronds.mode === 'leaf') return buildLeafCards(skeleton, spec)
  const fr = spec.fronds
  const env = skeleton.envelope
  const random = rng(seedFor(spec.seed, 4040))
  const ribbons: Ribbon[] = []
  for (const b of skeleton.branches) {
    if (b.bare) continue
    if (b.role !== 'limb' && b.role !== 'child') continue
    const main = b.role === 'limb'
    const width = main
      ? fr.width * Math.min(1.25, Math.max(.45, b.length / (env.width * .55)))
      : fr.width * fr.childScale * Math.min(1.1, Math.max(.5, b.length / .55))
    ribbons.push({
      branch: b, points: t => b.curve.getPoint(t), tangent: t => b.curve.getTangent(t), width,
      start: main ? fr.start : .02, segments: main ? fr.segments : Math.max(3, Math.round(fr.segments * .6)),
      fold: fr.fold, cross: fr.cross, twist: (random() * 2 - 1) * fr.twist * (main ? .35 : 1) * Math.PI / 180,
    })
  }
  // leader tuft: crossed vertical fronds around the trunk tip
  if (fr.tuft > 0 && spec.kind === 'conifer') {
    const trunk = skeleton.trunk
    const t0 = .9
    for (let k = 0; k < 3; k++) {
      const up = new Vector3(Math.cos(k * Math.PI / 3), 0, Math.sin(k * Math.PI / 3))
      ribbons.push({
        branch: null, points: t => trunk.curve.getPoint(t0 + (1 - t0) * t), tangent: t => trunk.curve.getTangent(t0 + (1 - t0) * t),
        width: fr.width * .7 * fr.tuft, start: 0, segments: 5, fold: 0, cross: 0, up,
      })
    }
  }

  const position: number[] = [], normal: number[] = [], uv: number[] = [], color: number[] = [], index: number[] = []
  const inner = new Color(fr.tintInner), outer = new Color(fr.tintOuter), c = new Color()
  const envN = new Vector3(), n3 = new Vector3()
  let fronds = 0
  let ringRho = 0
  const push = (p: Vector3, geoNormal: Vector3, u: number, v: number, shade: number) => {
    n3.copy(geoNormal).lerp(envN, fr.spherize)
    if (n3.lengthSq() < 1e-8) n3.copy(envN)
    n3.normalize()
    const rho = ringRho
    const outerness = Math.min(1, Math.max(0, (rho - .3) / .75))
    const height = Math.min(1, Math.max(0, (p.y - env.y0) / env.height))
    c.copy(inner).lerp(outer, outerness)
      .multiplyScalar((1 - fr.aoStrength * (1 - outerness) * .7) * (.82 + .18 * height) * shade)
    position.push(p.x, p.y, p.z)
    normal.push(n3.x, n3.y, n3.z)
    uv.push(u, v)
    color.push(c.r, c.g, c.b)
    return position.length / 3 - 1
  }

  for (const r of ribbons) {
    const shade = 1 + (random() * 2 - 1) * fr.tintVariance
    const rings: number[][] = [], crossRings: number[][] = []
    const keep: boolean[] = []
    for (let i = 0; i <= r.segments; i++) {
      const s = i / r.segments
      const t = r.start + (1 - r.start) * s
      const p = r.points(t), T = r.tangent(t).normalize()
      env.normal(p, envN)
      ringRho = env.rho(p)
      const ref = r.up ?? UP
      // per-frond roll around the branch axis
      const nUp = ref.clone().addScaledVector(T, -ref.dot(T))
      if (nUp.lengthSq() < 1e-6) nUp.set(1, 0, 0).addScaledVector(T, -T.x)
      nUp.normalize()
      if (r.twist) nUp.applyAxisAngle(T, r.twist)
      const side = new Vector3().crossVectors(T, nUp).normalize()
      const w = r.width * Math.min(1, s / .16 + .25) * (1 - s) ** .42 + r.width * .04
      const f = r.fold * Math.PI / 180
      const left = p.clone().addScaledVector(side, w * Math.cos(f)).addScaledVector(nUp, -w * Math.sin(f))
      const right = p.clone().addScaledVector(side, -w * Math.cos(f)).addScaledVector(nUp, -w * Math.sin(f))
      const ridge = p.clone().addScaledVector(nUp, w * .06)
      const nl = nUp.clone().multiplyScalar(Math.cos(f)).addScaledVector(side, Math.sin(f)).normalize()
      const nr = nUp.clone().multiplyScalar(Math.cos(f)).addScaledVector(side, -Math.sin(f)).normalize()
      rings.push([push(left, nl, 0, 1 - s, shade), push(ridge, nUp, .5, 1 - s, shade), push(right, nr, 1, 1 - s, shade)])
      if (r.cross > 0) {
        const top = p.clone().addScaledVector(nUp, w * r.cross), bottom = p.clone().addScaledVector(nUp, -w * r.cross * .8)
        crossRings.push([push(top, side, 0, 1 - s, shade), push(p, side, .5, 1 - s, shade), push(bottom, side, 1, 1 - s, shade)])
      }
      keep.push(env.bare(p) < .35 + random() * .4)
    }
    let any = false
    for (let i = 0; i < r.segments; i++) {
      if (!keep[i] || !keep[i + 1]) continue
      any = true
      for (const set of [rings, crossRings]) {
        if (!set.length) continue
        const a = set[i], b = set[i + 1]
        for (let k = 0; k < 2; k++) index.push(a[k], a[k + 1], b[k + 1], a[k], b[k + 1], b[k])
      }
    }
    if (any) fronds++
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(color), 3))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()
  return { geometry, fronds }
}

/**
 * Conifer drape: one textured plane hangs from each main branch (top edge on
 * the branch spine, lower edge falling under gravity with an outward curl).
 * Texture layout: u runs branch base -> tip, v = 1 at the branch (top edge),
 * v = 0 at the hanging tips of the needles.
 */
function buildDrape(skeleton: Skeleton, spec: TreeSpec) {
  const fr = spec.fronds
  const env = skeleton.envelope
  const random = rng(seedFor(spec.seed, 4141))
  const position: number[] = [], normal: number[] = [], uv: number[] = [], color: number[] = [], index: number[] = []
  const inner = new Color(fr.tintInner), outer = new Color(fr.tintOuter), c = new Color()
  const envN = new Vector3(), n3 = new Vector3()
  let curtains = 0
  type Row = { p: Vector3; down: Vector3; depth: number; curlSide: Vector3; s: number }
  const emit = (rows: Row[], shade: number) => {
    const rowsIdx: number[][] = []
    const keep: boolean[] = []
    for (const row of rows) {
      env.normal(row.p, envN)
      const rho = env.rho(row.p)
      const outerness = Math.min(1, Math.max(0, (rho - .3) / .75))
      const height = Math.min(1, Math.max(0, (row.p.y - env.y0) / Math.max(.01, env.height)))
      const face = row.curlSide.clone()
      if (face.dot(envN) < 0) face.negate()
      const ids: number[] = []
      for (const [k, f] of [[0, 0], [1, .5], [2, 1]] as const) {
        const q = row.p.clone().addScaledVector(row.down, row.depth * f)
          .addScaledVector(row.curlSide, fr.drapeCurl * row.depth * f * f * .55)
        if (k === 0) q.addScaledVector(row.down, -row.depth * .04)
        n3.copy(face).lerp(envN, fr.spherize)
        if (n3.lengthSq() < 1e-8) n3.copy(envN)
        n3.normalize()
        const ao = (1 - fr.aoStrength * (1 - outerness) * .7) * (.82 + .18 * height) * (1 - .18 * f * fr.aoStrength)
        c.copy(inner).lerp(outer, outerness).multiplyScalar(ao * shade)
        position.push(q.x, q.y, q.z)
        normal.push(n3.x, n3.y, n3.z)
        uv.push(row.s, 1 - f)
        color.push(c.r, c.g, c.b)
        ids.push(position.length / 3 - 1)
      }
      rowsIdx.push(ids)
      keep.push(env.bare(row.p) < .35 + random() * .4)
    }
    let any = false
    for (let i = 0; i < rowsIdx.length - 1; i++) {
      if (!keep[i] || !keep[i + 1]) continue
      any = true
      const a = rowsIdx[i], b = rowsIdx[i + 1]
      for (let k = 0; k < 2; k++) index.push(a[k], a[k + 1], b[k + 1], a[k], b[k + 1], b[k])
    }
    if (any) curtains++
  }

  const curtainFor = (b: Branch, widthScale: number) => {
    const tilt = drapeTilt(spec, b.id)
    const rows: Row[] = []
    for (let i = 0; i <= fr.segments; i++) {
      const s = i / fr.segments
      const t = fr.start + (1 - fr.start) * s
      const p = b.curve.getPoint(t), T = b.curve.getTangent(t).normalize()
      const down = drapeDown(T, tilt)
      const curlSide = new Vector3().crossVectors(T, down).normalize().multiplyScalar(tilt >= 0 ? 1 : -1)
      rows.push({ p, down, depth: drapeDepth(spec, b.length, env.width, s) * widthScale, curlSide, s })
    }
    emit(rows, 1 + (random() * 2 - 1) * fr.tintVariance)
  }
  for (const b of skeleton.branches) {
    if (b.bare) continue
    if (b.role === 'limb') curtainFor(b, 1)
    else if (b.role === 'child' && fr.drapeChildren > 0) curtainFor(b, fr.drapeChildren * .6)
  }
  // leader tuft: curtains radiating from the top of the trunk
  if (fr.tuft > 0 && spec.kind === 'conifer') {
    const trunk = skeleton.trunk
    for (let k = 0; k < 3; k++) {
      const radial = new Vector3(Math.cos(k * Math.PI * 2 / 3), 0, Math.sin(k * Math.PI * 2 / 3))
      const rows: Row[] = []
      for (let i = 0; i <= 5; i++) {
        const s = i / 5, t = .86 + .14 * s
        const p = trunk.curve.getPoint(t)
        const down = radial.clone().multiplyScalar(.75).add(new Vector3(0, -.25, 0)).normalize()
        const curlSide = new Vector3().crossVectors(new Vector3(0, 1, 0), radial).normalize()
        rows.push({ p, down, depth: fr.drop * .55 * fr.tuft * Math.max(.08, (1 - s) ** .7), curlSide, s })
      }
      emit(rows, 1)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(color), 3))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()
  return { geometry, fronds: curtains }
}

/** Low-poly kite/shield leaf-card profile: pointed stem, broad shoulder (~28%), pointed tip. */
export function leafProfile(s: number) {
  if (s <= .28) return .04 + .96 * (s / .28)
  if (s <= .72) return 1 - .24 * ((s - .28) / .44)
  return .04 + .72 * (1 - (s - .72) / .28)
}

/**
 * Conifer leaf cards (one folded plane per branch):
 * Each branch carries a low-poly folded kite mesh (left / ridge / right).
 * UVs are un-stretched inside the square texture (u = 0.5 ± 0.5 * profile,
 * v = 1 at the stem/branch root, v = 0 at the hanging outer tip).
 */
function buildLeafCards(skeleton: Skeleton, spec: TreeSpec) {
  const fr = spec.fronds
  const env = skeleton.envelope
  const random = rng(seedFor(spec.seed, 4242))
  const position: number[] = [], normal: number[] = [], uv: number[] = [], color: number[] = [], index: number[] = []
  const inner = new Color(fr.tintInner), outer = new Color(fr.tintOuter), c = new Color()
  const envN = new Vector3(), n3 = new Vector3()
  const cols = [-1, 0, 1] as const
  let cards = 0

  /** emit one folded kite card along a polyline spine */
  const card = (spine: Vector3[], halfWidth: number, roll: number, shade: number, flipV = false) => {
    const rows = spine.length
    const start = position.length / 3
    const keep: boolean[] = []
    const f = fr.fold * Math.PI / 180
    for (let i = 0; i < rows; i++) {
      const s = i / (rows - 1)
      const p = spine[i]
      const T = spine[Math.min(rows - 1, i + 1)].clone().sub(spine[Math.max(0, i - 1)]).normalize()
      const nUp = UP.clone().addScaledVector(T, -UP.dot(T))
      if (nUp.lengthSq() < 1e-6) nUp.set(1, 0, 0).addScaledVector(T, -T.x)
      nUp.normalize().applyAxisAngle(T, roll)
      const side = new Vector3().crossVectors(T, nUp).normalize()
      const prof = leafProfile(s)
      const w = halfWidth * prof
      env.normal(p, envN)
      const rho = env.rho(p)
      const outerness = Math.min(1, Math.max(0, (rho - .25) / .8))
      const height = Math.min(1, Math.max(0, (p.y - env.y0) / Math.max(.01, env.height)))
      for (const x of cols) {
        const ax = Math.abs(x)
        const q = p.clone()
          .addScaledVector(side, x * w * Math.cos(f))
          .addScaledVector(nUp, .018 * Math.sin(Math.PI * s) - ax * w * Math.sin(f) - fr.cardCup * ax * w)
        const geo = x === 0 ? nUp.clone()
          : nUp.clone().multiplyScalar(Math.cos(f)).addScaledVector(side, Math.sign(x) * Math.sin(f)).normalize()
        n3.copy(geo).lerp(envN, fr.spherize)
        if (n3.lengthSq() < 1e-8) n3.copy(envN)
        n3.normalize()
        const tipGlow = flipV ? 1 - s : s
        c.copy(inner).lerp(outer, Math.min(1, outerness * .55 + tipGlow * .45 + (1 - ax) * .08))
          .multiplyScalar((1 - fr.aoStrength * (1 - outerness) * .55) * (.84 + .16 * height) * shade)
        position.push(q.x, q.y, q.z)
        normal.push(n3.x, n3.y, n3.z)
        // un-stretched UVs: vertices sit on the kite inside the [0,1]x[0,1] texture
        uv.push(.5 + .5 * x * prof, flipV ? s : 1 - s)
        color.push(c.r, c.g, c.b)
      }
      keep.push(env.bare(p) < .35 + random() * .4)
    }
    let any = false
    const n = cols.length
    for (let i = 0; i < rows - 1; i++) {
      if (!keep[i] || !keep[i + 1]) continue
      any = true
      for (let k = 0; k < n - 1; k++) {
        const a = start + i * n + k, b = a + n
        index.push(a, a + 1, b + 1, a, b + 1, b)
      }
    }
    if (any) cards++
  }

  /** spine following a branch, extended past its tip, with optional extra arch */
  const opt = spec.optimize
  const segCount = Math.max(2, Math.round(fr.segments * (1 - opt.level * .55)))
  const spineFor = (b: Branch, from: number, lengthScale: number) => {
    const rows = Math.max(3, segCount + 1)
    const span = (1 - from) * b.length
    const total = Math.max(span * (1 + fr.overhang), env.height * .08) * lengthScale
    const end = b.curve.getPoint(1), endT = b.curve.getTangent(1).normalize()
    const pts: Vector3[] = []
    for (let i = 0; i < rows; i++) {
      const s = i / (rows - 1)
      const d = s * total
      const p = d <= span ? b.curve.getPoint(from + (1 - from) * d / span) : end.clone().addScaledVector(endT, d - span)
      p.y -= fr.arch * total * .25 * s * s
      pts.push(p)
    }
    return { pts, total }
  }

  // One folded card per branch (main branches; optional child cards if childCount > 0)
  const keepRatio = Math.max(.25, 1 - opt.cardReduction)
  const widthBoost = keepRatio < 1 ? Math.min(1.65, (1 / keepRatio) ** .4) : 1
  const eligible = skeleton.branches.filter(b => !b.bare && (b.role === 'limb' || (b.role === 'child' && fr.childScale > 0)))
  eligible.forEach((b, idx) => {
    if (keepRatio < 1 && idx > 0 && Math.floor(idx * keepRatio) === Math.floor((idx - 1) * keepRatio)) return
    const main = b.role === 'limb'
    const layers = main ? Math.max(1, Math.min(3, Math.round(fr.cardsPerBranch))) : 1
    const size = .9 + random() * .22
    for (let k = 0; k < layers; k++) {
      const { pts, total } = spineFor(b, main ? fr.start + k * .12 : .04, (main ? 1 : fr.childScale) * size * (1 - k * .2))
      const roll = ((random() * 2 - 1) * fr.twist + (k ? (k % 2 ? 1 : -1) * 18 : 0)) * Math.PI / 180
      if (k) for (const p of pts) p.y += total * .03 * k
      card(pts, total * fr.cardAspect * .5 * widthBoost, roll, 1 + (random() * 2 - 1) * fr.tintVariance)
    }
  })

  // Apex crown: stacked, azimuth-staggered rings of downward-draping cards
  // converging at the peak (same downward needle orientation as every whorl).
  if (fr.tuft > 0 && spec.kind === 'conifer') {
    const trunk = skeleton.trunk
    const top = trunk.curve.getPoint(1)
    const capH = Math.max(.42, env.height * .16) * fr.tuft
    const rings: readonly { count: number; yOff: number; phase: number; len: number; pitch: number; curl: number; width: number }[] = [
      { count: 4, yOff: -capH * .24, phase: .15, len: capH * 1.05, pitch: -64, curl: .38, width: .52 },
      { count: 4, yOff: capH * .02, phase: .15 + Math.PI / 4, len: capH * .9, pitch: -72, curl: .32, width: .44 },
      { count: 3, yOff: capH * .1, phase: .15 + Math.PI / 2, len: capH * .68, pitch: -79, curl: .22, width: .36 },
    ]
    const segs = Math.max(2, segCount)
    for (const ring of rings) {
      const origin = top.clone().addScaledVector(UP, ring.yOff)
      for (let k = 0; k < ring.count; k++) {
        const theta = ring.phase + k * Math.PI * 2 / ring.count + (random() - .5) * .25
        const radial = new Vector3(Math.cos(theta), 0, Math.sin(theta))
        const len = ring.len * (.92 + random() * .16)
        const basePitch = (ring.pitch + (random() - .5) * 4) * Math.PI / 180
        const pts: Vector3[] = [origin.clone()]
        const step = len / segs
        for (let i = 1; i <= segs; i++) {
          const s = (i - .5) / segs
          const a = basePitch + ring.curl * s * s
          const dir = radial.clone().multiplyScalar(Math.cos(a)).addScaledVector(UP, Math.sin(a)).normalize()
          pts.push(pts[i - 1].clone().addScaledVector(dir, step))
        }
        const roll = (random() * 2 - 1) * fr.twist * .5 * Math.PI / 180
        card(pts, len * fr.cardAspect * ring.width, roll, 1.02 + (random() * 2 - 1) * fr.tintVariance * .7)
      }
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(color), 3))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()
  return { geometry, fronds: cards }
}
