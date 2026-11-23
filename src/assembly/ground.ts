// Procedural painterly diorama ground slab for the Scene Assembly Studio.
// Renders stylized hand-brushed meadow grass, warm dirt/sand footpaths, subtle foliage
// shadow tinting, and crisp beveled tile edges matching isometric miniature dioramas.
import {
  BoxGeometry, BufferGeometry, CanvasTexture, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial,
  PlaneGeometry, ShadowMaterial, SRGBColorSpace, type Material,
} from 'three'
import { rng } from '../shape'
import type { AssemblyGroundSpec, PathLayout } from './spec'

export interface BuiltGround {
  group: Group
  dispose(): void
}

function clamp01(v: number) { return v < 0 ? 0 : v > 1 ? 1 : v }
function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6))
  return t * t * (3 - 2 * t)
}

function hash2(ix: number, iy: number, seed: number) {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1274126177)
  n = (n ^ (n >>> 13)) | 0
  n = Math.imul(n, 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}

function noise2(x: number, y: number, seed: number) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash2(ix, iy, seed)
  const b = hash2(ix + 1, iy, seed)
  const c = hash2(ix, iy + 1, seed)
  const d = hash2(ix + 1, iy + 1, seed)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

function fbm2(x: number, y: number, seed: number, octaves = 4) {
  let v = 0, a = 0.52, fx = x, fy = y
  for (let i = 0; i < octaves; i++) {
    v += a * noise2(fx, fy, seed + i * 97)
    fx = fx * 2.04 + 13.7
    fy = fy * 2.04 + 29.3
    a *= 0.5
  }
  return v
}

function distToPolyline(px: number, py: number, pts: [number, number, number][]): { dist: number; width: number } {
  let best = Infinity
  let bestW = 0.1
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay, aw] = pts[i]
    const [bx, by, bw] = pts[i + 1]
    const vx = bx - ax, vy = by - ay
    const lenSq = vx * vx + vy * vy || 1e-6
    const t = clamp01(((px - ax) * vx + (py - ay) * vy) / lenSq)
    const cx = ax + vx * t, cy = ay + vy * t
    const d = Math.hypot(px - cx, py - cy)
    const w = aw + (bw - aw) * t
    if (d - w < best - bestW) {
      best = d
      bestW = w
    }
  }
  return { dist: best, width: bestW }
}

function pathCurveForLayout(layout: PathLayout): [number, number, number][] {
  if (layout === 'birch-curve') {
    // Sweeps gently from front-center grass past the boulder toward the right edge (matches Ref 1)
    return [
      [0.36, 0.78, 0.032],
      [0.54, 0.72, 0.056],
      [0.72, 0.60, 0.068],
      [0.86, 0.44, 0.062],
      [0.98, 0.30, 0.054],
    ]
  }
  if (layout === 'boulder-trail') {
    // Broad organic sandy dirt path winding diagonally across the diorama (matches Ref 2)
    return [
      [0.54, 0.02, 0.072],
      [0.60, 0.24, 0.096],
      [0.65, 0.46, 0.122],
      [0.60, 0.68, 0.135],
      [0.64, 0.88, 0.148],
      [0.68, 1.00, 0.142],
    ]
  }
  if (layout === 'straight') {
    return [
      [0.02, 0.62, 0.075],
      [0.50, 0.54, 0.085],
      [0.98, 0.46, 0.078],
    ]
  }
  return []
}

function birchMeadowField(spec: AssemblyGroundSpec) {
  const curve = pathCurveForLayout('birch-curve')
  const seed = spec.seed
  const pathWidth = Math.max(.25, spec.pathWidth)
  return (u: number, v: number) => {
    const swath = fbm2(u * 5.7, v * 5.5, seed, 3)
    const grain = noise2(u * 46, v * 62, seed + 87)
    const strokes = fbm2(u * 16 + swath, v * 11, seed + 123, 3)
    const { dist, width } = distToPolyline(u, v + (swath - .5) * .075, curve)
    const bank = dist + (strokes - .46) * .11 + (grain - .5) * .022
    const normalized = bank / Math.max(.012, width * pathWidth)
    const path = (1 - smoothstep(.59, 1.24, normalized)) * (.42 + .46 * smoothstep(.31, .67, strokes))
    const back = 1 - smoothstep(.40, .86, u * .78 + v * .48)
    const tone = clamp01(.46 + (swath - .46) * 1.17 + (strokes - .46) * .37 + u * .24 - back * .44)
    return { path, tone, grain, strokes, swath }
  }
}

function birchMeadowPalette(spec: AssemblyGroundSpec) {
  const grass = new Color(spec.grassColor), light = new Color(spec.grassHighlight), shade = new Color(spec.grassShadow)
  return (tone: number, out: Color) => tone < .49
    ? out.copy(shade).lerp(grass, smoothstep(.05, .49, tone))
    : out.copy(grass).lerp(light, smoothstep(.49, .86, tone))
}

function paintBirchMeadow(ctx: CanvasRenderingContext2D, spec: AssemblyGroundSpec, size: number) {
  const sample = birchMeadowField(spec)
  const grassColor = birchMeadowPalette(spec)
  const grass = new Color(), dirt = new Color(), loam = new Color('#b98a4c')
  const soil = new Color(spec.pathColor).lerp(loam, .25)
  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const { path, tone, grain, strokes } = sample(x / (size - 1), y / (size - 1))
      const flecks = (grain - .5) * .075
      const band = Math.floor(clamp01(tone + flecks) * 7) / 7
      grassColor(.62 * tone + .38 * band + flecks, grass)
      dirt.copy(loam).lerp(soil, smoothstep(.25, .70, strokes + flecks))
      grass.lerp(dirt, path)
      const offset = (y * size + x) * 4
      img.data[offset] = Math.round(clamp01(grass.r) ** (1 / 2.2) * 255)
      img.data[offset + 1] = Math.round(clamp01(grass.g) ** (1 / 2.2) * 255)
      img.data[offset + 2] = Math.round(clamp01(grass.b) ** (1 / 2.2) * 255)
      img.data[offset + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

function buildBirchTurf(spec: AssemblyGroundSpec, size: number) {
  const sample = birchMeadowField(spec)
  const pickColor = birchMeadowPalette(spec)
  const random = rng(spec.seed * 129 + 583)
  const positions: number[] = [], colors: number[] = [], indices: number[] = []
  const color = new Color(), stem = new Color(), tip = new Color()
  // Sow shared tufts, then reject individual blades where soil has worn through.
  // The same field sets the ground pigment so real blades meet their painted bank.
  for (let i = 0; i < 720; i++) {
    const u = .007 + random() * .986, v = .007 + random() * .986
    const field = sample(u, v)
    const edge = Math.min(u, v, 1 - u, 1 - v)
    if (field.path > .56 || random() > .52 + field.swath * .5 + field.path * .55) continue
    const count = 4 + Math.floor(random() * 6)
    const radius = .007 + random() * .016
    const tall = .47 + field.swath * .7 + random() * .62
    const groupAngle = random() * Math.PI * 2
    for (let j = 0; j < count; j++) {
      const brushX = u + (random() - .5) * radius * 2
      const brushZ = v + (random() - .5) * radius * 2
      if (brushX < .003 || brushX > .997 || brushZ < .003 || brushZ > .997) continue
      const local = sample(brushX, brushZ)
      if (local.path > .47 + random() * .14) continue
      const x = (brushX - .5) * size, z = (brushZ - .5) * size
      const angle = groupAngle + (random() - .5) * 2.9
      const sideX = Math.cos(angle), sideZ = Math.sin(angle)
      const edgeHeight = edge < .07 ? 1.03 : .87
      const height = Math.min(.27, (.039 + random() ** 1.7 * .143) * tall * size / 7.2 * edgeHeight)
      const width = height * (.07 + random() * .08)
      const bend = height * (.35 + random() * .77)
      const dx = -sideZ * bend, dz = sideX * bend
      pickColor(local.tone + (random() - .5) * .23, color)
      stem.copy(color).multiplyScalar(.83)
      pickColor(local.tone + .18, tip).lerp(color, .46)
      const base = positions.length / 3
      positions.push(
        x - sideX * width, .002, z - sideZ * width,
        x + sideX * width, .002, z + sideZ * width,
        x + dx * .24 - sideX * width * .70, height * .57, z + dz * .24 - sideZ * width * .70,
        x + dx * .24 + sideX * width * .70, height * .57, z + dz * .24 + sideZ * width * .70,
        x + dx, height, z + dz,
      )
      colors.push(stem.r, stem.g, stem.b, stem.r, stem.g, stem.b, color.r, color.g, color.b,
        color.r, color.g, color.b, tip.r, tip.g, tip.b)
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  // A small transmission fill models the extra light that reaches the reverse side of thin grass.
  const material = new MeshStandardMaterial({
    vertexColors: true, side: DoubleSide, roughness: 1,
    emissive: spec.grassColor, emissiveIntensity: .16,
  })
  material.name = 'Meadow grass'
  const mesh = new Mesh(geometry, material)
  mesh.name = 'Meadow turf'
  mesh.receiveShadow = true
  mesh.userData.isGround = true
  return mesh
}

function paintDioramaTopCanvas(spec: AssemblyGroundSpec, sizePx = 768): HTMLCanvasElement | undefined {
  if (typeof document === 'undefined') return undefined
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = sizePx
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  if (spec.style === 'diorama-path' && spec.pathLayout === 'birch-curve') {
    paintBirchMeadow(ctx, spec, sizePx)
    return canvas
  }

  const baseCol = new Color(spec.grassColor)
  const hiCol = new Color(spec.grassHighlight)
  const shCol = new Color(spec.grassShadow)
  const pathCol = new Color(spec.pathColor)
  const pathEdgeCol = pathCol.clone().lerp(new Color('#a98c57'), 0.36)
  const pathWarmCol = pathCol.clone().lerp(new Color('#f0dca8'), 0.30)

  const img = ctx.createImageData(sizePx, sizePx)
  const px = img.data
  const grassCoverage = new Uint8Array(sizePx * sizePx)
  const usePath = spec.style === 'diorama-path' && spec.pathLayout !== 'none'
  const curve = usePath ? pathCurveForLayout(spec.pathLayout) : []
  const pw = Math.max(0.25, spec.pathWidth)
  const seed = spec.seed

  for (let y = 0; y < sizePx; y++) {
    const v = y / (sizePx - 1)
    for (let x = 0; x < sizePx; x++) {
      const u = x / (sizePx - 1)
      // Directional painterly meadow field: brighter sunlit warm-green toward front-right, cooler deeper shadow back-left
      const sunGrad = clamp01(0.18 + u * 0.46 + (1 - v) * 0.14 + v * 0.24)
      const macro = fbm2(u * 4.2, v * 4.2, seed, 4)
      const stroke = fbm2(u * 13.5 + macro * 1.4, v * 9.0 - macro * 1.2, seed + 511, 3)
      const micro = noise2(u * 38, v * 38, seed + 919)

      // Stylized 4-band painterly tonal stepping (Ghibli grass feel)
      const ink = (micro - .5) * .095
      const value = clamp01((sunGrad - .46) * .9 + (macro - .46) * 1.9 + (stroke - .48) * .78 + .44)
      const band = Math.floor(clamp01(value + ink) * 6) / 6
      const tone = value * .39 + band * .61
      let cover = 1

      let r: number, g: number, b: number
      if (tone < 0.45) {
        const k = tone / 0.45
        r = shCol.r + (baseCol.r - shCol.r) * k
        g = shCol.g + (baseCol.g - shCol.g) * k
        b = shCol.b + (baseCol.b - shCol.b) * k
      } else {
        const k = (tone - 0.45) / 0.55
        r = baseCol.r + (hiCol.r - baseCol.r) * k
        g = baseCol.g + (hiCol.g - baseCol.g) * k
        b = baseCol.b + (hiCol.b - baseCol.b) * k
      }

      // Painterly grass-tuft texture modulation
      const bladeMod = 0.92 + 0.14 * stroke + (micro - 0.5) * 0.05
      r *= bladeMod; g *= bladeMod; b *= bladeMod

      // Warm dirt/sand footpath with jagged hand-painted grassy borders
      if (curve.length >= 2) {
        const warpU = u + (macro - 0.5) * 0.075 + (stroke - 0.5) * 0.032
        const warpV = v + (fbm2(u * 4.8 + 7.1, v * 4.8 + 2.3, seed + 307, 3) - 0.5) * 0.075
        const { dist, width } = distToPolyline(warpU, warpV, curve)
        const effW = width * pw
        // Grassy tongues biting irregularly into the dirt path (stronger on Ref 2 boulder-trail)
        const grassTongue = (fbm2(u * 14.0, v * 14.0, seed + 773, 3) - 0.46) * (spec.pathLayout === 'boulder-trail' ? .19 : .09)
        const dNorm = (dist + grassTongue + (micro - .5) * .033) / Math.max(0.015, effW)
        // Longitudinal turf left between worn strips, with breaks along its length.
        const track = Math.abs(warpU - (.62 + .045 * Math.sin(v * 8.4)))
        const island = spec.pathLayout === 'boulder-trail'
          ? (1 - smoothstep(.026, .074, track / pw + (micro - .5) * .082)) * smoothstep(.42, .46, stroke + (micro - .5) * .45)
          : 0
        const pathMask = (1 - smoothstep(.91, 1.04, dNorm)) * (1 - island)
        cover = 1 - pathMask
        if (pathMask > 0.002) {
          const centerLift = 1 - smoothstep(0.0, 0.72, dNorm)
          const grain = fbm2(u * 18.0, v * 18.0, seed + 1231, 3)
          let pr = pathEdgeCol.r + (pathCol.r - pathEdgeCol.r) * (0.4 + 0.6 * centerLift)
          let pg = pathEdgeCol.g + (pathCol.g - pathEdgeCol.g) * (0.4 + 0.6 * centerLift)
          let pb = pathEdgeCol.b + (pathCol.b - pathEdgeCol.b) * (0.4 + 0.6 * centerLift)
          const warm = smoothstep(0.45, 0.85, grain) * 0.45
          pr = pr + (pathWarmCol.r - pr) * warm
          pg = pg + (pathWarmCol.g - pg) * warm
          pb = pb + (pathWarmCol.b - pb) * warm
          const pShade = .85 + .18 * grain + .16 * smoothstep(.47, .53, grain + (micro - .5) * .16)
          pr *= pShade; pg *= pShade; pb *= pShade
          r = r + (pr - r) * pathMask
          g = g + (pg - g) * pathMask
          b = b + (pb - b) * pathMask
        }
      }

      // Gentle vignette darkening right at the outer 4% border for crisp isometric tile definition
      const edgeDist = Math.min(u, 1 - u, v, 1 - v)
      const edgeAO = 0.88 + 0.12 * smoothstep(0.0, 0.045, edgeDist)
      r *= edgeAO; g *= edgeAO; b *= edgeAO

      // Convert linear -> sRGB byte
      const o = (y * sizePx + x) * 4
      grassCoverage[y * sizePx + x] = Math.round(cover * 255)
      px[o] = Math.round(Math.pow(clamp01(r), 1 / 2.2) * 255)
      px[o + 1] = Math.round(Math.pow(clamp01(g), 1 / 2.2) * 255)
      px[o + 2] = Math.round(Math.pow(clamp01(b), 1 / 2.2) * 255)
      px[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)

  // Place families of marks in common patches. The same coverage field that paints
  // the soil trims each tuft, including islands and ragged grass along the verge.
  const rand = rng(seed * 31 + 17)
  for (let i = 0; i < 460; i++) {
    const cx = rand() * sizePx, cy = rand() * sizePx
    const spread = 3 + rand() * 16
    const lean = (rand() - .5) * .8
    const pale = rand() > .63
    ctx.fillStyle = pale ? 'rgba(189,206,110,.46)' : 'rgba(26,86,55,.43)'
    for (let j = 0; j < 14; j++) {
      const x = Math.round(cx + (rand() + rand() - 1) * spread * 2)
      const y = Math.round(cy + (rand() + rand() - 1) * spread)
      if (x < 0 || y < 0 || x >= sizePx || y >= sizePx || grassCoverage[y * sizePx + x] < 180) continue
      const h = 2 + rand() * 5
      ctx.beginPath()
      ctx.moveTo(x - h * .32, y)
      ctx.lineTo(x + lean * h + h * .55, y - h)
      ctx.lineTo(x + h * .48, y - .4)
      ctx.fill()
    }
  }

  return canvas
}

/** Builds the configurable Scene Assembly ground (stylized diorama slab, minimal studio shadow floor, or empty). */
export function buildAssemblyGround(spec: AssemblyGroundSpec): BuiltGround {
  const group = new Group()
  group.name = 'DioramaGround'
  group.userData.isGround = true

  const disposables: { dispose(): void }[] = []

  if (spec.style === 'none') {
    return { group, dispose() {} }
  }

  if (spec.style === 'studio') {
    const geo = new PlaneGeometry(120, 120)
    geo.rotateX(-Math.PI / 2)
    const mat = new ShadowMaterial({ color: '#44504a', opacity: 0.18 })
    const mesh = new Mesh(geo, mat)
    mesh.name = 'StudioShadowFloor'
    mesh.position.y = -0.005
    mesh.receiveShadow = true
    mesh.userData.isGround = true
    group.add(mesh)
    disposables.push(geo, mat)
    return {
      group,
      dispose() { for (const d of disposables) d.dispose() },
    }
  }

  // Stylized isometric diorama tile (top surface sits cleanly at y = 0)
  const size = Math.max(4, spec.size)
  const thick = Math.max(0.04, spec.thickness)
  const canvas = paintDioramaTopCanvas(spec, 768)
  let topTex: CanvasTexture | undefined
  if (canvas) {
    topTex = new CanvasTexture(canvas)
    topTex.colorSpace = SRGBColorSpace
    topTex.anisotropy = 8
    topTex.name = `diorama_ground_${spec.pathLayout}`
    disposables.push(topTex)
  }

  const topMat = new MeshStandardMaterial({
    name: 'Mat_Diorama_Ground_Top',
    color: topTex ? '#ffffff' : spec.grassColor,
    map: topTex ?? null,
    roughness: 0.92,
    metalness: 0,
  })
  const sideMat = new MeshStandardMaterial({
    name: 'Mat_Diorama_Ground_Edge',
    color: new Color(spec.grassShadow).lerp(new Color('#2a2821'), 0.52),
    roughness: 0.96,
    metalness: 0,
  })
  const bottomMat = new MeshStandardMaterial({
    name: 'Mat_Diorama_Ground_Bottom',
    color: '#1f231e',
    roughness: 1,
    metalness: 0,
  })
  disposables.push(topMat, sideMat, bottomMat)

  const slabGeo = new BoxGeometry(size, thick, size)
  disposables.push(slabGeo)
  const mats: Material[] = [sideMat, sideMat, topMat, bottomMat, sideMat, sideMat]
  const slab = new Mesh(slabGeo, mats)
  slab.name = 'DioramaGroundSlab'
  slab.position.y = -thick * 0.5
  slab.receiveShadow = true
  slab.castShadow = false
  slab.userData.isGround = true
  group.add(slab)
  if (spec.style === 'diorama-path' && spec.pathLayout === 'birch-curve') {
    const turf = buildBirchTurf(spec, size)
    group.add(turf)
    disposables.push(turf.geometry, turf.material)
  }

  return {
    group,
    dispose() { for (const d of disposables) d.dispose() },
  }
}
