// Outer-surface flower decoration.
// Placement, density, orientation and scale are driven directly by the host
// foliage sites (leaf cards or foliage mesh surface) filtered to the outermost
// shell of the crown envelope.
import { BufferAttribute, BufferGeometry, Color, MathUtils, Vector3 } from 'three'
import { clamp, rng, seedFor } from '../shape'
import type { LeafCard } from '../broadleaf/leaves'
import type { CrownEnvelope } from './envelope'
import type { FlowerSpec, OptimizeSpec } from './spec'

export interface FoliageSite {
  position: Vector3
  normal: Vector3
  tangent: Vector3
  leafSize: number
  rho: number
}

const UP = new Vector3(0, 1, 0)

function anyPerpendicular(v: Vector3) {
  const a = Math.abs(v.y) < .9 ? UP : new Vector3(1, 0, 0)
  return new Vector3().crossVectors(v, a).normalize()
}

/** Extract surface anchor sites directly from broadleaf/shrub leaf cards. */
export function sitesFromLeafCards(cards: LeafCard[], env: CrownEnvelope): FoliageSite[] {
  return cards.map(c => ({
    position: c.position.clone(),
    normal: c.normal.clone().normalize(),
    tangent: c.up.clone().normalize(),
    leafSize: (c.width + c.height) * .5,
    rho: env.rho(c.position),
  }))
}

/** Extract surface anchor sites from any foliage mesh (conifer, palm, grass, fern). */
export function sitesFromGeometry(geometry: BufferGeometry, env: CrownEnvelope, leafSize: number): FoliageSite[] {
  const pos = geometry.getAttribute('position')
  const nor = geometry.getAttribute('normal')
  const uv = geometry.getAttribute('uv')
  if (!pos || pos.count === 0) return []
  const step = Math.max(1, Math.floor(pos.count / 900))
  const sites: FoliageSite[] = []
  for (let i = 0; i < pos.count; i += step) {
    // avoid extreme blade tips / roots where a card offset could look detached
    if (uv && (uv.getY(i) > .92 || uv.getY(i) < .2)) continue
    const p = new Vector3().fromBufferAttribute(pos, i)
    const n = nor ? new Vector3().fromBufferAttribute(nor, i) : env.normal(p)
    if (n.lengthSq() < 1e-6) env.normal(p, n)
    n.normalize()
    sites.push({ position: p, normal: n, tangent: anyPerpendicular(n), leafSize, rho: env.rho(p) })
  }
  return sites
}

interface PlacedFlower {
  position: Vector3
  right: Vector3
  up: Vector3
  normal: Vector3
  size: number
  cell: number
  shade: number
  spin: number
  outerness: number
}

/** Selects outermost foliage sites (optionally grouped in well-spaced clusters) and builds flower geometry. */
export function buildFlowers(
  sites: FoliageSite[],
  env: CrownEnvelope,
  flower: FlowerSpec,
  opt: OptimizeSpec,
  treeSeed: number,
) {
  const empty = () => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(0), 3))
    g.setAttribute('normal', new BufferAttribute(new Float32Array(0), 3))
    g.setAttribute('uv', new BufferAttribute(new Float32Array(0), 2))
    g.setAttribute('color', new BufferAttribute(new Float32Array(0), 3))
    g.setAttribute('leafCenter', new BufferAttribute(new Float32Array(0), 3))
    g.setAttribute('leafCorner', new BufferAttribute(new Float32Array(0), 2))
    g.setIndex([])
    return { geometry: g, flowers: 0, placed: [] as PlacedFlower[] }
  }
  if (!flower.enabled || sites.length === 0 || flower.count <= 0) return empty()

  const random = rng(seedFor(treeSeed ^ flower.seed, 8200))
  // 1. Filter out bare zones and rank sites by how far out on the canopy surface they sit.
  const scored = sites
    .filter(s => env.bare(s.position) < .28 && (flower.upBias <= .2 || s.normal.y > -.25))
    .map(site => ({
      site,
      score: site.rho + flower.upBias * .55 * site.normal.y,
    }))
  if (scored.length === 0) return empty()

  const sortedScores = scored.map(x => x.score).sort((a, b) => a - b)
  const qIdx = Math.min(sortedScores.length - 1, Math.floor(clamp(flower.outerShell, .2, .98) * (sortedScores.length - 1)))
  const cutoff = sortedScores[qIdx]
  // Always keep a usable pool even on tiny grass/fern plants
  let outerPool = scored.filter(x => x.score >= cutoff)
  if (outerPool.length < Math.min(12, scored.length)) {
    outerPool = [...scored].sort((a, b) => b.score - a.score).slice(0, Math.min(Math.max(16, flower.count * 2), scored.length))
  }

  // 2. Pick well-spaced cluster centres on the outermost shell via farthest-point sampling.
  const clumping = clamp(flower.clumping, 0, 1)
  const clusterCenters: Vector3[] = []
  if (clumping > .01 && outerPool.length > 0) {
    const kMax = Math.min(outerPool.length, Math.max(1, Math.round(flower.clusterCount)))
    // Seed the first cluster near the top/front sunlit outer shell
    const first = outerPool[Math.floor(random() * outerPool.length)]
    clusterCenters.push(first.site.position.clone())
    for (let k = 1; k < kMax; k++) {
      let bestIdx = 0, bestDist = -1
      for (let i = 0; i < outerPool.length; i++) {
        const p = outerPool[i].site.position
        let minD = Infinity
        for (const c of clusterCenters) minD = Math.min(minD, p.distanceToSquared(c))
        // add tiny jitter so seed changes move clusters naturally
        const d = minD * (.82 + random() * .36)
        if (d > bestDist) { bestDist = d; bestIdx = i }
      }
      clusterCenters.push(outerPool[bestIdx].site.position.clone())
    }
  }

  // 3. Weighted selection of flower sites (following leaf density & cluster fields, with spacing).
  const keepRatio = Math.max(.25, 1 - opt.cardReduction)
  const scaleBoost = keepRatio < 1 ? Math.min(1.6, (1 / keepRatio) ** .4) : 1
  const targetCount = Math.max(1, Math.round(flower.count * keepRatio))
  const meanLeaf = outerPool.reduce((s, x) => s + x.site.leafSize, 0) / outerPool.length
  const clusterRadius = Math.max(meanLeaf * 1.4, env.width * .24)
  const inv2Sig2 = 1 / (2 * clusterRadius * clusterRadius)

  const weights = outerPool.map(entry => {
    if (clumping <= .01 || clusterCenters.length === 0) return 1
    let bestD2 = Infinity
    for (const c of clusterCenters) bestD2 = Math.min(bestD2, entry.site.position.distanceToSquared(c))
    const bump = Math.exp(-bestD2 * inv2Sig2)
    return (1 - clumping) * .15 + clumping * bump
  })
  const totalWeight = weights.reduce((s, w) => s + w, 0)
  const cdf = new Float64Array(weights.length)
  let acc = 0
  for (let i = 0; i < weights.length; i++) { acc += weights[i] / (totalWeight || 1); cdf[i] = acc }

  const pickIndex = () => {
    const u = random()
    let lo = 0, hi = cdf.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cdf[mid] < u) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  const cells = Math.max(1, Math.round(flower.atlasCols)) * Math.max(1, Math.round(flower.atlasRows))
  const placed: PlacedFlower[] = []
  const envN = new Vector3()
  const maxAttempts = targetCount * 6
  const used = new Set<number>()
  for (let attempt = 0; attempt < maxAttempts && placed.length < targetCount; attempt++) {
    const idx = pickIndex()
    if (used.has(idx) && outerPool.length > targetCount) continue
    const site = outerPool[idx].site
    const size = site.leafSize * flower.sizeRatio * Math.max(.2, 1 + (random() * 2 - 1) * flower.sizeVariance) * scaleBoost
    env.normal(site.position, envN)
    const normal = flower.faceOutward >= .999 ? envN.clone() : site.normal.clone().lerp(envN, flower.faceOutward)
    if (normal.lengthSq() < 1e-6) normal.copy(envN)
    normal.normalize()
    // Push gently outside the leaf surface so petals sit flush on top of the outer canopy without floating
    const offset = site.leafSize * flower.surfaceOffset + .008
    const position = site.position.clone().addScaledVector(normal, offset)
    const minDist = size * .36
    if (placed.some(other => other.position.distanceToSquared(position) < minDist * minDist)) continue
    used.add(idx)

    // Build orthonormal card basis with random spin around the outward normal
    const spin = (random() * 2 - 1) * Math.PI
    const up = site.tangent.clone().addScaledVector(normal, -site.tangent.dot(normal))
    if (up.lengthSq() < 1e-6) up.copy(anyPerpendicular(normal))
    up.normalize().applyAxisAngle(normal, spin)
    const right = new Vector3().crossVectors(up, normal).normalize()
    placed.push({
      position, right, up, normal, size,
      cell: Math.min(cells - 1, Math.floor(random() * cells)),
      shade: random(), spin,
      outerness: clamp((site.rho - .45) / .65),
    })
  }
  if (placed.length === 0) return empty()

  // 4. Emit card geometry (quad / cross / cup), respecting LOD flatCards.
  const effectiveType = opt.flatCards && flower.cardType === 'cup' ? 'quad' : flower.cardType
  const curved = effectiveType === 'cup'
  const nx = curved ? 2 : 1, ny = curved ? 2 : 1
  const perPlane = (nx + 1) * (ny + 1)
  const planesPerFlower = effectiveType === 'cross' ? 2 : 1
  const totalVerts = placed.length * planesPerFlower * perPlane

  const positions = new Float32Array(totalVerts * 3)
  const normals = new Float32Array(totalVerts * 3)
  const uvs = new Float32Array(totalVerts * 2)
  const colors = new Float32Array(totalVerts * 3)
  const centers = new Float32Array(totalVerts * 3)
  const corners = new Float32Array(totalVerts * 2)
  const indices: number[] = []
  const innerCol = new Color(flower.tintInner), outerCol = new Color(flower.tintOuter), col = new Color()
  const world = new Vector3(), n3 = new Vector3()
  const cols = Math.max(1, Math.round(flower.atlasCols)), rows = Math.max(1, Math.round(flower.atlasRows))

  let v = 0
  for (const f of placed) {
    const cellCol = f.cell % cols, cellRow = Math.floor(f.cell / cols)
    const shade = 1 + (f.shade * 2 - 1) * flower.tintVariance
    const cs = Math.cos(f.spin), sn = Math.sin(f.spin)
    // For cross blossoms, two perpendicular planes tilted slightly outward so both face the sky cleanly
    const bases = effectiveType === 'cross'
      ? [
        { right: f.right, up: f.up, normal: f.normal },
        {
          right: f.right.clone().applyAxisAngle(f.up, Math.PI * .5),
          up: f.up.clone().applyAxisAngle(f.right, .22),
          normal: f.normal.clone().applyAxisAngle(f.up, Math.PI * .5),
        },
      ]
      : [{ right: f.right, up: f.up, normal: f.normal }]

    for (const basis of bases) {
      for (let j = 0; j <= ny; j++) {
        for (let i = 0; i <= nx; i++) {
          const u = i / nx, w = j / ny
          const x = (u - .5) * f.size
          const y = (w - .5) * f.size
          const r2 = ((u - .5) * 2) ** 2 + ((w - .5) * 2) ** 2
          const z = curved ? r2 * f.size * .14 : 0
          world.copy(f.position).addScaledVector(basis.right, x).addScaledVector(basis.up, y).addScaledVector(basis.normal, z)
          env.normal(world, envN)
          n3.copy(f.normal).lerp(envN, Math.max(.65, flower.faceOutward)).normalize()
          positions.set([world.x, world.y, world.z], v * 3)
          normals.set([n3.x, n3.y, n3.z], v * 3)
          centers.set([f.position.x, f.position.y, f.position.z], v * 3)
          corners.set([x * cs - y * sn, x * sn + y * cs], v * 2)
          uvs.set([(cellCol + u) / cols, 1 - (cellRow + 1 - w) / rows], v * 2)
          const bright = MathUtils.clamp(.86 + .14 * f.outerness, .75, 1.05) * shade
          col.copy(innerCol).lerp(outerCol, MathUtils.clamp(.35 + .65 * f.outerness, 0, 1)).multiplyScalar(bright)
          colors.set([col.r, col.g, col.b], v * 3)
          v++
        }
      }
      const base = v - perPlane
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const a = base + j * (nx + 1) + i, b = a + 1, c0 = a + nx + 1, d = c0 + 1
          indices.push(a, b, d, a, d, c0)
        }
      }
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setAttribute('leafCenter', new BufferAttribute(centers, 3))
  geometry.setAttribute('leafCorner', new BufferAttribute(corners, 2))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return { geometry, flowers: placed.length, placed }
}

/** Lightweight drifting petals / floating leaves around the outer crown silhouette.
 *  Each petal is a 4-triangle gently cupped almond shape (pure vertex color, zero texture dependency). */
export function buildAmbientPetals(
  env: CrownEnvelope,
  count: number,
  innerHex: string,
  outerHex: string,
  seed: number,
) {
  const n = Math.min(80, Math.max(0, Math.round(count)))
  const pos: number[] = [], col: number[] = [], idx: number[] = []
  const random = rng(seedFor(seed, 8821))
  const cIn = new Color(innerHex), cOut = new Color(outerHex), c = new Color()
  const scale = Math.max(.045, Math.min(.11, env.width * .034))
  for (let i = 0; i < n; i++) {
    const theta = random() * Math.PI * 2
    // half drifting just outside the crown, half gently descending below it
    const falling = i % 3 === 0
    const u = falling ? random() * .55 : .15 + random() * .82
    const p = env.deform(env.surface(u, theta, falling ? .65 + random() * .58 : 1.06 + random() * .34))
    if (falling) p.y = Math.max(.12, p.y - random() * env.y0 * .85)
    const sz = scale * (.65 + random() * .75)
    const yaw = random() * Math.PI * 2
    const pitch = (random() - .5) * 1.4
    const roll = (random() - .5) * 1.4
    const fwd = new Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)).normalize()
    const side = new Vector3().crossVectors(UP, fwd)
    if (side.lengthSq() < 1e-5) side.set(1, 0, 0)
    side.normalize().applyAxisAngle(fwd, roll)
    const up = new Vector3().crossVectors(fwd, side).normalize()
    const base = pos.length / 3
    // 5 vertices: base, left, center (slightly cupped), right, tip -> 4 triangles
    const w = sz * .54, cup = sz * .16
    const v0 = p.clone().addScaledVector(fwd, -sz * .55)
    const v1 = p.clone().addScaledVector(side, w).addScaledVector(up, cup)
    const v2 = p.clone()
    const v3 = p.clone().addScaledVector(side, -w).addScaledVector(up, cup)
    const v4 = p.clone().addScaledVector(fwd, sz * .58).addScaledVector(up, cup * .6)
    const mixT = .35 + random() * .65
    const verts: [Vector3, number][] = [[v0, mixT * .7], [v1, mixT], [v2, mixT * .85], [v3, mixT], [v4, Math.min(1, mixT * 1.15)]]
    for (const [pt, t] of verts) {
      pos.push(pt.x, Math.max(.04, pt.y), pt.z)
      c.copy(cIn).lerp(cOut, t)
      col.push(c.r, c.g, c.b)
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3, base + 1, base + 4, base + 2, base + 2, base + 4, base + 3)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  geometry.setIndex(idx)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return { geometry, petals: n }
}
