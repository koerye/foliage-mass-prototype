import {
  Box3, BufferAttribute, BufferGeometry, Color, Group, Matrix3, Matrix4, Mesh, MeshStandardMaterial,
  Texture, Vector3, type Material, type Object3D,
} from 'three'
import { activityLog, inspectGlbBinary } from './studio/activity-log'
import type { TrunkSpec } from './tree/spec'
import { isWoodSculptActive, type BarkHeightField, type TrunkFeaturePlan } from './tree/wood-sculpt'
import {
  bakedBarkMapsToPngDataUrls, bakeSculptedBarkMaps,
  type BakedBarkMaps, type NormalMapConvention,
} from './tree/wood-weld'

export type BakeResolution = 512 | 1024 | 2048

export interface ExportGlbOptions {
  /** 'merged' = bake transforms & combine into one single multi-material Mesh (distinct material slots
   *  for bark, foliage, flowers, grass, other); 'separate' = preserve independent parts & sub-meshes. */
  mode?: 'merged' | 'separate'
  /** Remove decorative meshes such as ambient petals/particles, stones/rocks, and accessory ground grass under trees. */
  excludeDecorations?: boolean
  /** Bake 3D world-space upward moss & root grounding from procedural-bark-v3 directly into wood vertex colors
   *  so external PBR engines (Blender / Unity / Unreal) reproduce the mossy trunk without custom GLSL shaders. */
  bakeBarkMoss?: boolean
  /** Bake analytical High-Poly Sculpted Bark -> glTF 2.0 Tangent-Space NormalMap + Cavity AO Map
   *  so low-poly / game LOD exports preserve crisp carved wide-rib relief & crevices in Blender / Unity / UE. */
  bakeBarkNormal?: boolean
  /** Resolution of baked sculpted bark Normal + AO maps (default 512). */
  bakeBarkNormalSize?: BakeResolution
  /** Normal map green-channel convention: 'opengl' (+Y, glTF/Blender/Unity) or 'directx' (-Y, Unreal/3dsMax). */
  bakeBarkNormalConvention?: NormalMapConvention
  /** Export engine-ready vertex wind weights into standard glTF TEXCOORD_1 (uv1):
   *  u1 = primary height/trunk sway weight [0..1], v1 = leaf-edge / twig flutter weight [0..1]. */
  exportWindUv?: boolean
}

export interface GlbExportPreview {
  meshCount: number
  triangles: number
  materials: string[]
  excludedDecorations: number
  mossBakedMeshes: number
  normalBakedMeshes: number
  windUvMeshes: number
}

const PREVIEW_ONLY_ATTRIBUTES = new Set(['leafCenter', 'leafCorner', 'shadeWeight', 'windWeight', 'pivotPos', 'barkMetric', 'rockData'])
const PREVIEW_ONLY_USERDATA = new Set(['leafUniforms', 'barkUniforms', 'procUniforms', 'barkMap', 'windUniforms', 'rockUniforms'])

const ALWAYS_DECOR_RE = /ambient\s*petal|petal|particle|spark|dust|rock|stone|pebble|碎石|石头|石块|粒子|飘落|落瓣|装饰/i
const GROUND_DECOR_NAME_RE = /grass|flower\s*stems|flower\s*blossoms|根部草|根梢|草丛|草簇|小草|点缀小花|ground/i

/** Generates fallback triplanar-projected UVs strictly for exported glTF meshes that
 *  carry an imported bark texture or share a merged multi-material UV buffer. */
function synthesizeTriplanarUv(geo: BufferGeometry): BufferAttribute | undefined {
  const pos = geo.getAttribute('position')
  const norm = geo.getAttribute('normal')
  if (!pos) return undefined
  const n = pos.count
  const uv = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const nx = norm ? Math.abs(norm.getX(i)) : 0
    const ny = norm ? Math.abs(norm.getY(i)) : 0
    const nz = norm ? Math.abs(norm.getZ(i)) : 1
    if (ny >= nx && ny >= nz) {
      uv[i * 2] = x; uv[i * 2 + 1] = z
    } else if (nx >= nz) {
      uv[i * 2] = z; uv[i * 2 + 1] = y
    } else {
      uv[i * 2] = x; uv[i * 2 + 1] = y
    }
  }
  return new BufferAttribute(uv, 2)
}

function quantizeColorAttribute(attr: BufferAttribute): BufferAttribute {
  const itemSize = attr.itemSize
  if (attr.array instanceof Uint16Array && attr.normalized) return attr
  if (attr.array instanceof Uint8Array && attr.normalized) return attr
  const src = attr.array
  const out = new Uint16Array(src.length)
  for (let i = 0; i < src.length; i++) {
    const v = src[i]
    out[i] = v <= 0 ? 0 : v >= 1 ? 65535 : Math.round(v * 65535)
  }
  return new BufferAttribute(out, itemSize, true)
}

function clamp01(v: number) { return v < 0 ? 0 : v > 1 ? 1 : v }
function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6))
  return t * t * (3 - 2 * t)
}
function fract(x: number) { return x - Math.floor(x) }
function barkHash31Cpu(px: number, py: number, pz: number) {
  let x = fract(px * 0.1031), y = fract(py * 0.1030), z = fract(pz * 0.0973)
  const d = x * (y + 33.33) + y * (x + 33.33) + z * (z + 33.33)
  x += d; y += d; z += d
  return fract((x + y) * z)
}
function barkNoise3Cpu(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  let fx = x - ix, fy = y - iy, fz = z - iz
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz)
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const c000 = barkHash31Cpu(ix, iy, iz), c100 = barkHash31Cpu(ix + 1, iy, iz)
  const c010 = barkHash31Cpu(ix, iy + 1, iz), c110 = barkHash31Cpu(ix + 1, iy + 1, iz)
  const c001 = barkHash31Cpu(ix, iy, iz + 1), c101 = barkHash31Cpu(ix + 1, iy, iz + 1)
  const c011 = barkHash31Cpu(ix, iy + 1, iz + 1), c111 = barkHash31Cpu(ix + 1, iy + 1, iz + 1)
  return lerp(
    lerp(lerp(c000, c100, fx), lerp(c010, c110, fx), fy),
    lerp(lerp(c001, c101, fx), lerp(c011, c111, fx), fy),
    fz,
  )
}
function barkFbm3Cpu(px: number, py: number, pz: number) {
  let v = 0, a = 0.52, x = px, y = py, z = pz
  for (let i = 0; i < 4; i++) {
    v += a * barkNoise3Cpu(x, y, z)
    x = x * 2.03 + 17.1; y = y * 2.03 + 31.7; z = z * 2.03 + 11.3
    a *= 0.5
  }
  return v
}

interface BarkUniformBundle {
  uUseBarkMap?: { value: number }
  uBarkScale?: { value: number }
  uBarkTint?: { value: number }
  uBarkBaseLum?: { value: number }
  uBarkMoss?: { value: number }
  uBarkMossColor?: { value: Color }
  uBarkRootAO?: { value: number }
}

function hasActiveBarkMoss(mat: Material | undefined): BarkUniformBundle | undefined {
  const u = mat?.userData?.barkUniforms as BarkUniformBundle | undefined
  if (!u) return undefined
  const moss = Number(u.uBarkMoss?.value ?? 0)
  const rootAO = Number(u.uBarkRootAO?.value ?? 0)
  return (moss > 0.001 || rootAO > 0.001) ? u : undefined
}

interface SculptBakeInfo {
  trunk: TrunkSpec
  seed: number
  detail: number
  plan: TrunkFeaturePlan
  heightField?: BarkHeightField
}

function getSculptBakeInfo(mesh: Mesh): SculptBakeInfo | undefined {
  const info = mesh.geometry.userData?.sculptBakeInfo as SculptBakeInfo | undefined
  if (!info || !isWoodSculptActive(info.trunk.sculpt)) return undefined
  return info
}

/** CPU mirror of procedural-bark-v3's 3D world-space upward moss & root grounding.
 *  Bakes the exact mossy back / root-hollow coloration into linear vertex COLOR_0 for glTF export. */
function bakeBarkMossToColorAttr(
  geo: BufferGeometry,
  u: BarkUniformBundle,
  matrixWorld: Matrix4,
): BufferAttribute | undefined {
  const pos = geo.getAttribute('position')
  const norm = geo.getAttribute('normal')
  if (!pos) return undefined
  const colAttr = geo.getAttribute('color') as BufferAttribute | undefined
  const mossAmt = clamp01(Number(u.uBarkMoss?.value ?? 0))
  const rootAoAmt = clamp01(Number(u.uBarkRootAO?.value ?? 0))
  const scale = Math.max(0.15, Number(u.uBarkScale?.value ?? 1))
  const useMap = Number(u.uUseBarkMap?.value ?? 0) > 0.5
  const baseLum = Math.max(0.03, Number(u.uBarkBaseLum?.value ?? 0.12))
  const tint = clamp01(Number(u.uBarkTint?.value ?? 0.45))
  const mc = u.uBarkMossColor?.value instanceof Color ? u.uBarkMossColor.value : new Color('#5d9132')
  const nMat = new Matrix3().getNormalMatrix(matrixWorld)
  const wn = new Vector3()
  const count = pos.count
  const out = new Float32Array(count * 3)

  for (let i = 0; i < count; i++) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i)
    // BufferAttribute.getX/Y/Z in Three.js already de-normalizes Uint16/Uint8 normalized attributes to [0, 1]
    let r = colAttr ? colAttr.getX(i) : 0.45
    let g = colAttr ? colAttr.getY(i) : 0.36
    let b = colAttr ? colAttr.getZ(i) : 0.28

    // If a custom bark texture is also exported on mat.map, normalize bare-wood vertex color
    // toward neutral AO so external glTF PBR viewers don't double-darken the wood map.
    if (useMap) {
      const vLum = Math.max(0.015, r * 0.2126 + g * 0.7152 + b * 0.0722)
      const relAo = Math.min(1.45, Math.max(0.30, vLum / baseLum))
      const aoShade = 0.68 + (1.12 - 0.68) * smoothstep(0.40, 1.15, relAo)
      const nr = aoShade, ng = aoShade, nb = aoShade
      const tr = Math.min(1.48, Math.max(0.32, r / Math.max(0.05, baseLum))) * aoShade
      const tg = Math.min(1.48, Math.max(0.32, g / Math.max(0.05, baseLum))) * aoShade
      const tb = Math.min(1.48, Math.max(0.32, b / Math.max(0.05, baseLum))) * aoShade
      r = nr + (tr - nr) * tint
      g = ng + (tg - ng) * tint
      b = nb + (tb - nb) * tint
    }

    if (rootAoAmt > 0.001) {
      const rootLift = smoothstep(0.0, 1.35, py)
      const rootShade = (1.0 - rootAoAmt * 0.34) + (rootAoAmt * 0.34) * rootLift
      r *= rootShade * (0.86 + 0.14 * rootLift)
      g *= rootShade * (0.90 + 0.10 * rootLift)
      b *= rootShade * (0.84 + 0.16 * rootLift)
    }

    if (mossAmt > 0.001) {
      if (norm) wn.fromBufferAttribute(norm, i).applyMatrix3(nMat).normalize()
      else wn.set(0, 1, 0)
      const bpX = px * scale, bpY = py * scale, bpZ = pz * scale
      const wX = barkNoise3Cpu(bpX * 1.85 + 2.1, bpY * 1.85, bpZ * 1.85 + 5.4) - 0.5
      const wY = barkNoise3Cpu(bpX * 1.05 + 7.3, bpY * 1.05 + 4.2, bpZ * 1.05 + 1.8) - 0.5
      const wZ = barkNoise3Cpu(bpX * 1.85 + 9.1, bpY * 1.85 + 3.3, bpZ * 1.85 + 6.7) - 0.5
      const ridges = barkFbm3Cpu(bpX * 6.8 + wX * 1.25, bpY * 1.35 + wY * 1.25, bpZ * 6.8 + wZ * 1.25)

      const upSun = smoothstep(0.22, 0.78, wn.y)
      const crevBias = smoothstep(0.76, 0.24, ridges)
      const rootDamp = smoothstep(1.55, 0.04, py) * smoothstep(-0.18, 0.34, wn.y) * (0.35 + 0.65 * crevBias)
      const macroPatch = barkFbm3Cpu(px * 1.85 + 4.1, py * 1.35 + 1.7, pz * 1.85 + 8.3)
      const tuft = barkFbm3Cpu(px * 5.8 + 1.3, py * 5.8 + 5.1, pz * 5.8 + 2.7)
      const fineBrush = barkNoise3Cpu(px * 14.0, py * 7.5, pz * 14.0)
      const mField = upSun * 0.48 + rootDamp * 0.28 + crevBias * 0.26
        + (macroPatch - 0.50) * 0.72 + (tuft - 0.50) * 0.30 + (fineBrush - 0.50) * 0.12
      const mThresh = 1.06 + (0.24 - 1.06) * mossAmt
      const mossMask = smoothstep(mThresh - 0.065, mThresh + 0.075, mField)
      const aoRim = smoothstep(mThresh - 0.16, mThresh - 0.015, mField) * (1.0 - mossMask)
      const rimMul = 1.0 - aoRim * 0.22
      r *= rimMul; g *= rimMul; b *= rimMul

      const ml = clamp01(0.18 + upSun * 0.44 + (macroPatch - 0.35) * 0.36 + (tuft - 0.45) * 0.48)
      const mq = Math.floor(ml * 5.0)
      const mf = smoothstep(0.20, 0.80, ml * 5.0 - mq)
      const mt = (mq + mf) * 0.20
      const hiR = mc.r * 1.36, hiG = mc.g * 1.24, hiB = mc.b * 0.68
      const midR = mc.r * 0.84, midG = mc.g * 0.94, midB = mc.b * 0.68
      const loR = mc.r * 0.32, loG = mc.g * 0.50, loB = mc.b * 0.44
      const mossR = mt < 0.5 ? loR + (midR - loR) * (mt * 2) : midR + (hiR - midR) * ((mt - 0.5) * 2)
      const mossG = mt < 0.5 ? loG + (midG - loG) * (mt * 2) : midG + (hiG - midG) * ((mt - 0.5) * 2)
      const mossB = mt < 0.5 ? loB + (midB - loB) * (mt * 2) : midB + (hiB - midB) * ((mt - 0.5) * 2)
      // When multiplied with a warm beige bark texture in external glTF viewers, gently lift green moss target
      // so the resulting product reads cleanly as lush stylized moss rather than muddy olive.
      const boost = useMap ? 1.38 : 1.0
      const blend = mossMask * (0.80 + 0.14 * smoothstep(0.3, 0.9, mossMask))
      r = r + (Math.min(1, mossR * boost) - r) * blend
      g = g + (Math.min(1, mossG * boost) - g) * blend
      b = b + (Math.min(1, mossB * boost) - b) * blend
    }

    out[i * 3] = clamp01(r)
    out[i * 3 + 1] = clamp01(g)
    out[i * 3 + 2] = clamp01(b)
  }
  return new BufferAttribute(out, 3)
}

function sanitizeNormalAttribute(attr: BufferAttribute): BufferAttribute {
  let dirty = false
  for (let i = 0; i < attr.count; i++) {
    const x = attr.getX(i), y = attr.getY(i), z = attr.getZ(i)
    const lenSq = x * x + y * y + z * z
    if (!Number.isFinite(lenSq) || Math.abs(lenSq - 1) > 1e-3) { dirty = true; break }
  }
  if (!dirty) return attr
  const out = new Float32Array(attr.count * 3)
  for (let i = 0; i < attr.count; i++) {
    const x = attr.getX(i), y = attr.getY(i), z = attr.getZ(i)
    const len = Math.hypot(x, y, z)
    if (Number.isFinite(len) && len > 1e-5) {
      out[i * 3] = x / len
      out[i * 3 + 1] = y / len
      out[i * 3 + 2] = z / len
    } else {
      out[i * 3] = 0
      out[i * 3 + 1] = 1
      out[i * 3 + 2] = 0
    }
  }
  return new BufferAttribute(out, 3)
}

/** Synthesizes standard engine-ready vertex wind weights in TEXCOORD_1 (uv1):
 *  - u1 (X): Primary canopy / trunk sway weight [0..1] (0 at ground root -> 1 at upper crown / grass tips)
 *  - v1 (Y): High-frequency leaf-edge / outer-twig flutter weight [0..1] */
function synthesizeWindUv1(
  src: BufferGeometry,
  mesh: Mesh,
  relMatrix: Matrix4,
  yMin: number,
  heightSpan: number,
): BufferAttribute | undefined {
  const pos = src.getAttribute('position')
  if (!pos) return undefined
  const n = pos.count
  const uvAttr = src.getAttribute('uv') as BufferAttribute | undefined
  const leafCorner = src.getAttribute('leafCorner') as BufferAttribute | undefined
  const windAttr = src.getAttribute('windWeight') as BufferAttribute | undefined
  const barkMetric = src.getAttribute('barkMetric') as BufferAttribute | undefined
  const mName = (mesh.name || '').toLowerCase()
  const role = String(mesh.userData?.role || '')
  const isWood = role === 'wood' || mName.includes('trunk') || mName.includes('twig') || mName.includes('branch')
  const isFoliage = role === 'foliage' || mName.includes('leaf') || mName.includes('needle') || mName.includes('frond')
    || mName.includes('grass') || mName.includes('fern') || mName.includes('flower')
  // Detect whether leafCorner actually holds non-zero billboard offsets (drape curtains & twig strips fill it with zeros!)
  let hasNonZeroCorner = false
  if (leafCorner) {
    const step = Math.max(1, Math.floor(n / 64))
    for (let i = 0; i < n; i += step) {
      if (Math.abs(leafCorner.getX(i)) + Math.abs(leafCorner.getY(i)) > 1e-4) {
        hasNonZeroCorner = true
        break
      }
    }
  }
  // Detect hanging curtains (e.g. weeping willow drape / conifer drape where v=1 is top anchor & v=0 is hanging tip!)
  let invertVFlutter = false
  if (isFoliage && !hasNonZeroCorner && uvAttr) {
    let hiYSum = 0, hiN = 0, loYSum = 0, loN = 0
    const step = Math.max(1, Math.floor(n / 120))
    const tmp = new Vector3()
    for (let i = 0; i < n; i += step) {
      const uy = uvAttr.getY(i)
      tmp.fromBufferAttribute(pos, i).applyMatrix4(relMatrix)
      if (uy > 0.7) { hiYSum += tmp.y; hiN++ }
      else if (uy < 0.3) { loYSum += tmp.y; loN++ }
    }
    if (hiN > 0 && loN > 0 && (hiYSum / hiN) > (loYSum / loN) + 0.05) {
      invertVFlutter = true
    }
  }
  const invH = 1 / Math.max(0.25, heightSpan)
  const out = new Float32Array(n * 2)
  const v = new Vector3()

  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(relMatrix)
    const h = clamp01((v.y - yMin) * invH)

    if (windAttr) {
      const w = clamp01(windAttr.getX(i))
      out[i * 2] = w
      out[i * 2 + 1] = clamp01(w * 1.1)
      continue
    }

    let u1: number
    let v1: number
    if (isWood) {
      u1 = Math.pow(h, 1.45) * 0.65
      if (barkMetric) {
        const m = clamp01(barkMetric.getX(i))
        v1 = clamp01((1 - m) * Math.pow(h, 0.85))
      } else {
        v1 = Math.pow(h, 2.1) * 0.35
      }
    } else if (isFoliage) {
      u1 = Math.pow(h, 1.12)
      if (hasNonZeroCorner && leafCorner) {
        const cx = leafCorner.getX(i), cy = leafCorner.getY(i)
        v1 = clamp01(Math.hypot(cx, cy) * 0.95)
      } else if (uvAttr) {
        const ux = uvAttr.getX(i), rawUy = clamp01(uvAttr.getY(i))
        const tipWeight = invertVFlutter ? (1 - rawUy) : rawUy
        const edge = Math.abs((ux - Math.floor(ux)) - 0.5) * 2
        v1 = clamp01(tipWeight * (0.55 + 0.45 * edge))
      } else {
        v1 = clamp01(h * 0.85)
      }
    } else {
      u1 = Math.pow(h, 1.35) * 0.5
      v1 = Math.pow(h, 1.8) * 0.25
    }
    out[i * 2] = u1
    out[i * 2 + 1] = v1
  }
  return new BufferAttribute(out, 2)
}

function cleanGeometry(src: BufferGeometry, bakedColor?: BufferAttribute, windUv1?: BufferAttribute): BufferGeometry {
  const out = new BufferGeometry()
  out.name = src.name
  if (src.index) out.setIndex(src.index)
  for (const [name, attr] of Object.entries(src.attributes)) {
    if (PREVIEW_ONLY_ATTRIBUTES.has(name)) continue
    if (name === 'color' && attr instanceof BufferAttribute) {
      out.setAttribute(name, quantizeColorAttribute(bakedColor ?? attr))
    } else if (name === 'normal' && attr instanceof BufferAttribute) {
      out.setAttribute(name, sanitizeNormalAttribute(attr))
    } else {
      out.setAttribute(name, attr)
    }
  }
  if (bakedColor && !out.getAttribute('color')) {
    out.setAttribute('color', quantizeColorAttribute(bakedColor))
  }
  if (windUv1) {
    out.setAttribute('uv1', windUv1)
  }
  for (const g of src.groups) out.addGroup(g.start, g.count, g.materialIndex)
  if (src.boundingBox) out.boundingBox = src.boundingBox.clone()
  if (src.boundingSphere) out.boundingSphere = src.boundingSphere.clone()
  return out
}

function sanitizeMatToken(raw: string): string {
  const cleaned = raw
    .replace(/^placeholder_/i, '')
    .replace(/_(cluster|sprig|strands|card|frond|single)$/i, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!cleaned) return 'Custom'
  return cleaned.split('_').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join('_').slice(0, 24)
}

/** Derives a clear, semantic material slot name (bark, foliage, flowers, grass, stems, other)
 *  so merged multi-material GLBs open with crystal-clear slots in Blender/Unity/Unreal. */
function semanticMaterialName(mesh: Mesh, mat: Material): string {
  const mName = (mesh.name || '').toLowerCase()
  const matName = (mat.name || '').toLowerCase()
  const mapName = mat instanceof MeshStandardMaterial && mat.map?.name ? sanitizeMatToken(mat.map.name) : ''
  const barkMapName = mat.userData?.barkMap && typeof (mat.userData.barkMap as { name?: string }).name === 'string'
    ? sanitizeMatToken((mat.userData.barkMap as { name: string }).name)
    : ''

  if (mName.includes('ambient petal') || matName.includes('petal')) return 'Mat_Decor_Petals'
  if (mName.includes('flower stem') || matName.includes('flowerstem')) return 'Mat_Plant_Stems'
  if (mName.includes('flower') || matName.includes('flower')) {
    return mapName ? `Mat_Flowers_${mapName}` : 'Mat_Flowers'
  }
  if (mName.includes('trunk') || mName.includes('twig') || matName.includes('bark') || mesh.userData?.role === 'wood') {
    return barkMapName ? `Mat_Tree_Bark_${barkMapName}` : 'Mat_Tree_Bark'
  }
  if (mName.includes('grass') || matName.includes('grass')) {
    return mapName ? `Mat_Grass_${mapName}` : 'Mat_Grass'
  }
  if (mName.includes('fern') || matName.includes('fern')) return 'Mat_Foliage_Fern'
  if (mName.includes('palm') || matName.includes('palm')) return 'Mat_Foliage_Palm'
  if (mName.includes('needle') || matName.includes('needle')) return 'Mat_Foliage_Needles'
  if (mName.includes('leaf') || matName.includes('leaf') || mesh.userData?.role === 'foliage') {
    return mapName ? `Mat_Foliage_${mapName}` : 'Mat_Foliage_Leaves'
  }
  if (mName.includes('rock') || matName.includes('rock')) return 'Mat_Stylized_Rock'
  return `Mat_Other_${sanitizeMatToken(mat.name || mesh.name || 'Mesh')}`
}

function materialKey(mat: Material, semanticName?: string): string | undefined {
  if (!(mat instanceof MeshStandardMaterial)) return undefined
  const barkTex = mat.userData?.barkMap as Texture | undefined
  const barkNorm = barkTex?.userData?.normalMap as Texture | undefined
  const barkRough = barkTex?.userData?.roughnessMap as Texture | undefined
  return [
    mat.type,
    semanticName ?? mat.name,
    mat.color.getHex(),
    mat.emissive.getHex(),
    mat.emissiveIntensity.toFixed(4),
    mat.roughness.toFixed(4),
    mat.metalness.toFixed(4),
    mat.opacity.toFixed(4),
    mat.transparent ? 1 : 0,
    mat.alphaTest.toFixed(4),
    mat.side,
    mat.vertexColors ? 1 : 0,
    mat.flatShading ? 1 : 0,
    mat.map?.uuid ?? '',
    barkTex?.uuid ?? '',
    mat.normalMap?.uuid ?? barkNorm?.uuid ?? '',
    mat.roughnessMap?.uuid ?? barkRough?.uuid ?? '',
    mat.metalnessMap?.uuid ?? '',
    mat.aoMap?.uuid ?? '',
    mat.emissiveMap?.uuid ?? '',
    mat.alphaMap?.uuid ?? '',
  ].join('|')
}

function copyUserData(src: Record<string, unknown>, omitChildSpec: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(src)) {
    if (omitChildSpec && k === 'spec') continue
    if (v !== undefined) out[k] = v
  }
  return out
}

function hasWoodyTreeInScene(root: Object3D): boolean {
  let found = false
  root.traverse(o => {
    if (found) return
    const kind = (o.userData?.spec as { kind?: string } | undefined)?.kind
    if (kind === 'broadleaf' || kind === 'conifer' || kind === 'palm') { found = true; return }
    if (o instanceof Mesh && (o.name === 'Trunk and branches' || o.name === 'Leaf cards' || o.name === 'Needle fronds' || o.name === 'Palm fronds')) {
      found = true
    }
  })
  return found
}

function isDecorativeNode(node: Object3D, root: Object3D, hasTree: boolean): boolean {
  const check = (o: Object3D): boolean => {
    const role = o.userData?.role
    if (role === 'particle' || role === 'decoration') return true
    if (o.name && ALWAYS_DECOR_RE.test(o.name)) return true
    if (hasTree) {
      const kind = (o.userData?.spec as { kind?: string } | undefined)?.kind
      if (kind === 'grass' || kind === 'fern' || kind === 'flowerbed') return true
      if (o instanceof Mesh && (o.name === 'GrassBlades' || o.name === 'FernFronds' || o.name === 'Flower stems and leaves' || o.name === 'Flower blossoms')) {
        return true
      }
      if (o !== root && o.name && GROUND_DECOR_NAME_RE.test(o.name)) return true
    }
    return false
  }
  let cur: Object3D | null = node
  while (cur && cur !== root) {
    if (check(cur)) return true
    cur = cur.parent
  }
  return check(node)
}

interface CleanMaterialFactory {
  get(mesh: Mesh, mat: Material, useSemanticName: boolean): Material
}

function createMaterialDeduper(): CleanMaterialFactory {
  const cache = new Map<string, Material>()
  return {
    get(mesh: Mesh, mat: Material, useSemanticName: boolean): Material {
      const semantic = useSemanticName ? semanticMaterialName(mesh, mat) : undefined
      const key = materialKey(mat, semantic)
      if (!key) return mat
      const existing = cache.get(key)
      if (existing) return existing
      const hasCustomData = Boolean(mat.userData && Object.keys(mat.userData).some(k => PREVIEW_ONLY_USERDATA.has(k)))
      const needsClone = hasCustomData || (semantic !== undefined && semantic !== mat.name)
      let clean = mat
      if (needsClone) {
        clean = mat.clone()
        if (semantic) clean.name = semantic
        if (clean instanceof MeshStandardMaterial && mat.userData.barkMap) {
          const barkTex = mat.userData.barkMap as Texture
          if (!clean.map) clean.map = barkTex
          if (!clean.normalMap && barkTex.userData?.normalMap instanceof Texture) {
            clean.normalMap = barkTex.userData.normalMap
          }
          if (!clean.roughnessMap && barkTex.userData?.roughnessMap instanceof Texture) {
            clean.roughnessMap = barkTex.userData.roughnessMap
            clean.roughness = 1.0
          }
        }
        const ud: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(mat.userData ?? {})) {
          if (!PREVIEW_ONLY_USERDATA.has(k)) ud[k] = v
        }
        clean.userData = ud
      }
      cache.set(key, clean)
      return clean
    },
  }
}

interface MergeEntry {
  geometry: BufferGeometry
  material: Material
  matrix: Matrix4
  normalMatrix: Matrix3
  flipWinding: boolean
}

function mergeEntriesIntoSingleMesh(entries: MergeEntry[], name: string): Mesh {
  const matList: Material[] = []
  const matIndexMap = new Map<Material, number>()
  const buckets: MergeEntry[][] = []

  for (const e of entries) {
    let idx = matIndexMap.get(e.material)
    if (idx === undefined) {
      idx = matList.length
      matIndexMap.set(e.material, idx)
      matList.push(e.material)
      buckets.push([])
    }
    buckets[idx].push(e)
  }

  let totalVerts = 0
  let totalIndices = 0
  let anyUv = false
  let anyUv1 = false
  let anyColor = false
  for (const e of entries) {
    const pos = e.geometry.getAttribute('position')
    if (!pos) continue
    totalVerts += pos.count
    totalIndices += e.geometry.index ? e.geometry.index.count : pos.count
    if (e.geometry.getAttribute('uv') || (e.material instanceof MeshStandardMaterial && (e.material.map || e.material.normalMap || e.material.roughnessMap || e.material.aoMap))) anyUv = true
    if (e.geometry.getAttribute('uv1')) anyUv1 = true
    if (e.geometry.getAttribute('color')) anyColor = true
  }

  const positions = new Float32Array(totalVerts * 3)
  const normals = new Float32Array(totalVerts * 3)
  const colors = anyColor ? new Uint16Array(totalVerts * 3) : undefined
  const uvs = anyUv ? new Float32Array(totalVerts * 2) : undefined
  const uv1s = anyUv1 ? new Float32Array(totalVerts * 2) : undefined
  const indices = totalVerts > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices)

  const geo = new BufferGeometry()
  geo.name = name
  const v = new Vector3()
  const n = new Vector3()
  let vCursor = 0
  let iCursor = 0

  for (let mIdx = 0; mIdx < buckets.length; mIdx++) {
    const groupStart = iCursor
    for (const e of buckets[mIdx]) {
      const posAttr = e.geometry.getAttribute('position')
      if (!posAttr) continue
      const normAttr = e.geometry.getAttribute('normal')
      const colAttr = e.geometry.getAttribute('color') as BufferAttribute | undefined
      let uvAttr = e.geometry.getAttribute('uv') as BufferAttribute | undefined
      const uv1Attr = e.geometry.getAttribute('uv1') as BufferAttribute | undefined
      if (anyUv && !uvAttr) uvAttr = synthesizeTriplanarUv(e.geometry)
      const baseVertex = vCursor
      const count = posAttr.count

      for (let i = 0; i < count; i++) {
        v.fromBufferAttribute(posAttr, i).applyMatrix4(e.matrix)
        positions[(vCursor + i) * 3] = v.x
        positions[(vCursor + i) * 3 + 1] = v.y
        positions[(vCursor + i) * 3 + 2] = v.z

        if (normAttr) {
          n.fromBufferAttribute(normAttr, i).applyMatrix3(e.normalMatrix)
          if (n.lengthSq() > 1e-10) n.normalize()
          else n.set(0, 1, 0)
        } else {
          n.set(0, 1, 0)
        }
        normals[(vCursor + i) * 3] = n.x
        normals[(vCursor + i) * 3 + 1] = n.y
        normals[(vCursor + i) * 3 + 2] = n.z

        if (colors) {
          if (colAttr) {
            // BufferAttribute.getX/Y/Z always returns [0, 1] floats even for normalized Uint16/Uint8 arrays
            const r = colAttr.getX(i), g = colAttr.getY(i), b = colAttr.getZ(i)
            colors[(vCursor + i) * 3] = Math.round(Math.min(1, Math.max(0, r)) * 65535)
            colors[(vCursor + i) * 3 + 1] = Math.round(Math.min(1, Math.max(0, g)) * 65535)
            colors[(vCursor + i) * 3 + 2] = Math.round(Math.min(1, Math.max(0, b)) * 65535)
          } else {
            colors[(vCursor + i) * 3] = 65535
            colors[(vCursor + i) * 3 + 1] = 65535
            colors[(vCursor + i) * 3 + 2] = 65535
          }
        }

        if (uvs) {
          if (uvAttr) {
            uvs[(vCursor + i) * 2] = uvAttr.getX(i)
            uvs[(vCursor + i) * 2 + 1] = uvAttr.getY(i)
          } else {
            uvs[(vCursor + i) * 2] = 0
            uvs[(vCursor + i) * 2 + 1] = 0
          }
        }

        if (uv1s) {
          if (uv1Attr) {
            uv1s[(vCursor + i) * 2] = uv1Attr.getX(i)
            uv1s[(vCursor + i) * 2 + 1] = uv1Attr.getY(i)
          } else {
            uv1s[(vCursor + i) * 2] = 0
            uv1s[(vCursor + i) * 2 + 1] = 0
          }
        }
      }

      const idxAttr = e.geometry.index
      if (idxAttr) {
        const ic = idxAttr.count
        for (let i = 0; i < ic; i += 3) {
          const a = baseVertex + idxAttr.getX(i)
          const b = baseVertex + idxAttr.getX(i + 1)
          const c = baseVertex + idxAttr.getX(i + 2)
          if (e.flipWinding) {
            indices[iCursor++] = a; indices[iCursor++] = c; indices[iCursor++] = b
          } else {
            indices[iCursor++] = a; indices[iCursor++] = b; indices[iCursor++] = c
          }
        }
      } else {
        for (let i = 0; i < count; i += 3) {
          const a = baseVertex + i
          const b = baseVertex + i + 1
          const c = baseVertex + i + 2
          if (e.flipWinding) {
            indices[iCursor++] = a; indices[iCursor++] = c; indices[iCursor++] = b
          } else {
            indices[iCursor++] = a; indices[iCursor++] = b; indices[iCursor++] = c
          }
        }
      }
      vCursor += count
    }
    const groupCount = iCursor - groupStart
    if (groupCount > 0) geo.addGroup(groupStart, groupCount, mIdx)
  }

  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setAttribute('normal', new BufferAttribute(normals, 3))
  if (colors) geo.setAttribute('color', new BufferAttribute(colors, 3, true))
  if (uvs) geo.setAttribute('uv', new BufferAttribute(uvs, 2))
  if (uv1s) geo.setAttribute('uv1', new BufferAttribute(uv1s, 2))
  geo.setIndex(new BufferAttribute(indices, 1))
  geo.computeBoundingBox()
  geo.computeBoundingSphere()

  const mesh = new Mesh(geo, matList.length === 1 ? matList[0] : matList)
  mesh.name = name
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** Builds a lightweight, non-mutating clone of `root` optimized for standard glTF 2.0 export:
 *  - Strips preview-only shader attributes (`leafCenter`, `leafCorner`, `shadeWeight`)
 *  - Quantizes linear vertex colors (`COLOR_0`) to core glTF 2.0 normalized `UNSIGNED_SHORT`
 *  - Deduplicates identical `MeshStandardMaterial` instances across multi-part scenes
 *  - Supports `mode: 'merged'` (1 single multi-material Mesh with distinct named material slots)
 *    vs `mode: 'separate'` (preserves original hierarchy)
 *  - Supports `excludeDecorations: true` (strips grass skirts/tufts under trees, stones, ambient petals/particles) */
export function prepareGlbScene(root: Object3D, options: ExportGlbOptions = {}): Object3D {
  return prepareGlbSceneInternal(root, options)
}

function prepareGlbSceneInternal(
  root: Object3D,
  options: ExportGlbOptions = {},
  tempDisposables?: { dispose(): void }[],
): Object3D {
  const mode = options.mode ?? 'separate'
  const excludeDecorations = Boolean(options.excludeDecorations)
  const bakeBarkMoss = Boolean(options.bakeBarkMoss)
  const bakeBarkNormal = Boolean(options.bakeBarkNormal)
  const bakeBarkNormalSize: BakeResolution = options.bakeBarkNormalSize === 1024 || options.bakeBarkNormalSize === 2048 ? options.bakeBarkNormalSize : 512
  const bakeBarkNormalConvention: NormalMapConvention = options.bakeBarkNormalConvention === 'directx' ? 'directx' : 'opengl'
  const exportWindUv = Boolean(options.exportWindUv)
  const hasTree = excludeDecorations ? hasWoodyTreeInScene(root) : false
  const hasRootAiScene = Boolean(root.userData && 'aiScene' in root.userData)
  const deduper = createMaterialDeduper()
  const bakedNormalCache = new Map<BufferGeometry, BakedBarkMaps>()
  const bakedMaterialCache = new Map<string, Material>()

  root.updateWorldMatrix(true, true)
  const invRoot = root.matrixWorld.clone().invert()
  // Measure root-local vertical span for normalized engine wind height weights
  let windYMin = 0
  let windHeightSpan = 1
  if (exportWindUv) {
    const box = new Box3()
    const pt = new Vector3()
    root.traverse(node => {
      if (!(node instanceof Mesh)) return
      if (excludeDecorations && isDecorativeNode(node, root, hasTree)) return
      const pos = node.geometry.getAttribute('position')
      if (!pos) return
      const rel = invRoot.clone().multiply(node.matrixWorld)
      for (let i = 0; i < pos.count; i++) {
        pt.fromBufferAttribute(pos, i).applyMatrix4(rel)
        box.expandByPoint(pt)
      }
    })
    if (!box.isEmpty()) {
      windYMin = Math.min(0, box.min.y)
      windHeightSpan = Math.max(0.25, box.max.y - windYMin)
    }
  }

  const maybeAttachBakedNormal = (node: Mesh, rawMat: Material, cleanMat: Material): Material => {
    if (!bakeBarkNormal || !(cleanMat instanceof MeshStandardMaterial)) return cleanMat
    const bakeInfo = getSculptBakeInfo(node)
    if (!bakeInfo) return cleanMat
    const cacheKey = `${node.geometry.uuid}|${cleanMat.uuid}|${bakeBarkNormalSize}|${bakeBarkNormalConvention}`
    const cachedMat = bakedMaterialCache.get(cacheKey)
    if (cachedMat) return cachedMat
    let baked = bakedNormalCache.get(node.geometry)
    if (!baked) {
      const barkNormFallback = (rawMat.userData?.barkMap as Texture | undefined)?.userData?.normalMap
      const baseNormalMap = (cleanMat instanceof MeshStandardMaterial ? cleanMat.normalMap : undefined)
        ?? (rawMat instanceof MeshStandardMaterial ? rawMat.normalMap : undefined)
        ?? (barkNormFallback instanceof Texture ? barkNormFallback : undefined)
      baked = bakeSculptedBarkMaps(bakeInfo.trunk, bakeInfo.seed, bakeInfo.detail, {
        size: bakeBarkNormalSize,
        normalConvention: bakeBarkNormalConvention,
        heightField: bakeInfo.heightField,
        baseNormalMap: baseNormalMap ?? undefined,
        plan: bakeInfo.plan,
      })
      bakedNormalCache.set(node.geometry, baked)
      tempDisposables?.push(baked)
    }
    const matWithBaked = cleanMat.clone()
    matWithBaked.normalMap = baked.normalMap
    matWithBaked.normalScale.set(1, 1)
    matWithBaked.aoMap = baked.aoMap
    matWithBaked.aoMapIntensity = 0.85
    bakedMaterialCache.set(cacheKey, matWithBaked)
    tempDisposables?.push(matWithBaked)
    return matWithBaked
  }

  if (mode === 'merged') {
    const entries: MergeEntry[] = []

    root.traverse(node => {
      if (!(node instanceof Mesh)) return
      if (excludeDecorations && isDecorativeNode(node, root, hasTree)) return
      const relMatrix = invRoot.clone().multiply(node.matrixWorld)
      const normalMatrix = new Matrix3().getNormalMatrix(relMatrix)
      const flipWinding = relMatrix.determinant() < 0
      const windUv1 = exportWindUv ? synthesizeWindUv1(node.geometry, node, relMatrix, windYMin, windHeightSpan) : undefined

      if (Array.isArray(node.material) && node.geometry.groups.length > 0) {
        for (const g of node.geometry.groups) {
          const rawMat = node.material[g.materialIndex ?? 0]
          if (!rawMat) continue
          const mat = maybeAttachBakedNormal(node, rawMat, deduper.get(node, rawMat, true))
          const barkU = bakeBarkMoss ? hasActiveBarkMoss(rawMat) : undefined
          const bakedCol = barkU ? bakeBarkMossToColorAttr(node.geometry, barkU, node.matrixWorld) : undefined
          const sub = cleanGeometry(node.geometry, bakedCol, windUv1)
          if (sub.index) {
            const slice = sub.index.array.slice(g.start, g.start + g.count)
            sub.setIndex(new BufferAttribute(slice, 1))
          }
          entries.push({ geometry: sub, material: mat, matrix: relMatrix, normalMatrix, flipWinding })
        }
      } else {
        const rawMat = Array.isArray(node.material) ? node.material[0] : node.material
        if (!rawMat) return
        const mat = maybeAttachBakedNormal(node, rawMat, deduper.get(node, rawMat, true))
        const barkU = bakeBarkMoss ? hasActiveBarkMoss(rawMat) : undefined
        const bakedCol = barkU ? bakeBarkMossToColorAttr(node.geometry, barkU, node.matrixWorld) : undefined
        const geo = cleanGeometry(node.geometry, bakedCol, windUv1)
        entries.push({ geometry: geo, material: mat, matrix: relMatrix, normalMatrix, flipWinding })
      }
    })

    const outRoot = new Group()
    outRoot.name = root.name || 'Vegetation_Merged'
    outRoot.userData = copyUserData(root.userData, false)
    if (entries.length > 0) {
      const mergedName = (root.name || 'Vegetation').replace(/^Vegetation Studio(?:\s+AI)?\s*\/\s*/i, '').trim() || 'Vegetation'
      outRoot.add(mergeEntriesIntoSingleMesh(entries, mergedName))
    }
    return outRoot
  }

  // Separate mode: preserve hierarchy while still cleaning geometry, deduplicating materials,
  // optionally baking 3D bark moss into vertex colors and high-poly sculpted bark into tangent normal+AO maps,
  // exporting engine wind TEXCOORD_1, and removing decorative meshes/groups.
  const geometryCache = new Map<BufferGeometry, BufferGeometry>()
  const cloneNode = (node: Object3D, isRoot: boolean): Object3D | undefined => {
    if (!isRoot && excludeDecorations && isDecorativeNode(node, root, hasTree)) return undefined
    let copy: Object3D
    if (node instanceof Mesh) {
      const rawMat = Array.isArray(node.material) ? node.material[0] : node.material
      const mat = Array.isArray(node.material)
        ? node.material.map(m => maybeAttachBakedNormal(node, m, deduper.get(node, m, false)))
        : maybeAttachBakedNormal(node, node.material, deduper.get(node, node.material, false))
      const barkU = bakeBarkMoss ? hasActiveBarkMoss(rawMat) : undefined
      const canCacheGeo = !barkU && !exportWindUv
      let geo = canCacheGeo ? geometryCache.get(node.geometry) : undefined
      if (!geo) {
        const bakedCol = barkU ? bakeBarkMossToColorAttr(node.geometry, barkU, node.matrixWorld) : undefined
        const relMatrix = exportWindUv ? invRoot.clone().multiply(node.matrixWorld) : undefined
        const windUv1 = relMatrix ? synthesizeWindUv1(node.geometry, node, relMatrix, windYMin, windHeightSpan) : undefined
        geo = cleanGeometry(node.geometry, bakedCol, windUv1)
        const needsUv = (Array.isArray(mat) ? mat : [mat]).some(m => m instanceof MeshStandardMaterial && Boolean(m.map || m.normalMap || m.roughnessMap || m.aoMap))
        if (needsUv && !geo.getAttribute('uv')) {
          const fallbackUv = synthesizeTriplanarUv(geo)
          if (fallbackUv) geo.setAttribute('uv', fallbackUv)
        }
        if (canCacheGeo) geometryCache.set(node.geometry, geo)
      }
      copy = new Mesh(geo, mat)
      copy.castShadow = node.castShadow
      copy.receiveShadow = node.receiveShadow
    } else {
      copy = new Group()
    }
    copy.name = node.name
    copy.visible = node.visible
    copy.position.copy(node.position)
    copy.quaternion.copy(node.quaternion)
    copy.scale.copy(node.scale)
    copy.userData = copyUserData(node.userData, hasRootAiScene && !isRoot)
    for (const child of node.children) {
      const c = cloneNode(child, false)
      if (c) {
        // Prune empty non-mesh groups left behind after stripping decorations
        if (!(c instanceof Mesh) && c.children.length === 0) continue
        copy.add(c)
      }
    }
    return copy
  }

  return cloneNode(root, true) ?? new Group()
}

/** Fast non-mutating inspection for the GLB export dialog (exact mesh count, triangles, material slots). */
export function inspectGlbExport(root: Object3D, options: ExportGlbOptions = {}): GlbExportPreview {
  const mode = options.mode ?? 'merged'
  const excludeDecorations = Boolean(options.excludeDecorations)
  const bakeBarkMoss = Boolean(options.bakeBarkMoss)
  const bakeBarkNormal = Boolean(options.bakeBarkNormal)
  const exportWindUv = Boolean(options.exportWindUv)
  const hasTree = excludeDecorations ? hasWoodyTreeInScene(root) : false
  const deduper = createMaterialDeduper()
  const matNames: string[] = []
  const seenMats = new Set<Material>()
  let keptMeshes = 0
  let excludedDecorations = 0
  let mossBakedMeshes = 0
  let normalBakedMeshes = 0
  let triangles = 0

  root.traverse(node => {
    if (!(node instanceof Mesh)) return
    if (excludeDecorations && isDecorativeNode(node, root, hasTree)) {
      excludedDecorations++
      return
    }
    keptMeshes++
    const pos = node.geometry.getAttribute('position')
    triangles += node.geometry.index ? Math.round(node.geometry.index.count / 3) : Math.round((pos?.count ?? 0) / 3)
    const mats = Array.isArray(node.material) ? node.material : [node.material]
    if (bakeBarkMoss && mats.some(m => Boolean(hasActiveBarkMoss(m)))) mossBakedMeshes++
    if (bakeBarkNormal && Boolean(getSculptBakeInfo(node))) normalBakedMeshes++
    for (const rawMat of mats) {
      if (!rawMat) continue
      const clean = deduper.get(node, rawMat, mode === 'merged')
      if (!seenMats.has(clean)) {
        seenMats.add(clean)
        matNames.push(clean.name || 'Material')
      }
    }
  })

  return {
    meshCount: mode === 'merged' ? (keptMeshes > 0 ? 1 : 0) : keptMeshes,
    triangles,
    materials: matNames,
    excludedDecorations,
    mossBakedMeshes,
    normalBakedMeshes,
    windUvMeshes: exportWindUv ? keptMeshes : 0,
  }
}

export interface StandaloneBarkBakePng {
  name: string
  width: number
  height: number
  normalConvention: NormalMapConvention
  normalDataUrl: string
  aoDataUrl: string
}

/** Bakes standalone Tangent-Space Normal PNG + Cavity AO PNG data URLs for every sculpted trunk in `root`. */
export function extractStandaloneBarkBakePngs(
  root: Object3D,
  options: { size?: BakeResolution; normalConvention?: NormalMapConvention } = {},
): StandaloneBarkBakePng[] {
  const size: BakeResolution = options.size === 1024 || options.size === 2048 ? options.size : 512
  const normalConvention: NormalMapConvention = options.normalConvention === 'directx' ? 'directx' : 'opengl'
  const seen = new Set<BufferGeometry>()
  const out: StandaloneBarkBakePng[] = []

  root.traverse(node => {
    if (!(node instanceof Mesh) || seen.has(node.geometry)) return
    const info = getSculptBakeInfo(node)
    if (!info) return
    seen.add(node.geometry)
    const rawMat = Array.isArray(node.material) ? node.material[0] : node.material
    const barkNormFallback = (rawMat?.userData?.barkMap as Texture | undefined)?.userData?.normalMap
    const baseNormalMap = (rawMat instanceof MeshStandardMaterial ? rawMat.normalMap : undefined)
      ?? (barkNormFallback instanceof Texture ? barkNormFallback : undefined)
    const baked = bakeSculptedBarkMaps(info.trunk, info.seed, info.detail, {
      size,
      normalConvention,
      heightField: info.heightField,
      baseNormalMap: baseNormalMap ?? undefined,
      plan: info.plan,
    })
    try {
      const urls = bakedBarkMapsToPngDataUrls(baked)
      out.push({
        name: sanitizeMatToken(node.parent?.name || node.name || 'Bark'),
        width: baked.width,
        height: baked.height,
        normalConvention,
        normalDataUrl: urls.normalDataUrl,
        aoDataUrl: urls.aoDataUrl,
      })
    } finally {
      baked.dispose()
    }
  })
  return out
}

interface TextureDiagEntry {
  slot: string
  name: string
  texType: string
  imageType: string
  width: number
  height: number
  complete?: boolean
  naturalWidth?: number
  format: number
  colorSpace: string
  flipY: boolean
  mimeType: string
  pixelStatus: 'ok' | 'all-zero' | 'empty' | 'not-loaded' | 'tainted' | 'unchecked'
  pixelError?: string
}

function inspectTextureForLog(slot: string, tex: Texture): TextureDiagEntry {
  const img = tex.image as Record<string, unknown> | null | undefined
  const mimeType = typeof tex.userData?.mimeType === 'string' ? tex.userData.mimeType : 'image/png (default)'
  if (!img) {
    return {
      slot,
      name: tex.name || '(unnamed)',
      texType: tex.constructor?.name || 'Texture',
      imageType: 'null',
      width: 0,
      height: 0,
      format: tex.format,
      colorSpace: String(tex.colorSpace || ''),
      flipY: Boolean(tex.flipY),
      mimeType,
      pixelStatus: 'empty',
    }
  }

  let imageType = img.constructor?.name || typeof img
  const isHtmlImg = typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement
  const isHtmlCanvas = typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement
  const isOffscreen = typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas
  const isBitmap = typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap
  if (isHtmlCanvas) imageType = 'HTMLCanvasElement'
  else if (isOffscreen) imageType = 'OffscreenCanvas'
  else if (isHtmlImg) imageType = 'HTMLImageElement'
  else if (isBitmap) imageType = 'ImageBitmap'
  else if ('data' in img && img.data) imageType = `DataTextureImage(${(img.data as object).constructor?.name || 'TypedArray'})`

  const width = Number((isHtmlImg ? (img.naturalWidth || img.width) : img.width) || 0)
  const height = Number((isHtmlImg ? (img.naturalHeight || img.height) : img.height) || 0)
  let pixelStatus: TextureDiagEntry['pixelStatus'] = 'unchecked'
  let pixelError: string | undefined

  if (width <= 0 || height <= 0) {
    pixelStatus = 'empty'
  } else if (isHtmlImg) {
    pixelStatus = img.complete && Number(img.naturalWidth) > 0 ? 'ok' : 'not-loaded'
  } else if ('data' in img && img.data && ArrayBuffer.isView(img.data)) {
    const arr = img.data as Uint8Array | Uint8ClampedArray
    const step = Math.max(4, Math.floor(arr.length / 256) * 4)
    let anyNonZero = false
    for (let i = 0; i < arr.length; i += step) {
      if ((arr[i] | arr[i + 1] | arr[i + 2] | arr[i + 3]) !== 0) { anyNonZero = true; break }
    }
    pixelStatus = anyNonZero ? 'ok' : 'all-zero'
  } else if (isHtmlCanvas) {
    try {
      const ctx = img.getContext('2d')
      if (ctx) {
        const grid = 12
        let anyNonZero = false
        outer: for (let gy = 0; gy < grid; gy++) {
          const py = Math.min(height - 1, Math.floor(((gy + 0.5) / grid) * height))
          for (let gx = 0; gx < grid; gx++) {
            const px = Math.min(width - 1, Math.floor(((gx + 0.5) / grid) * width))
            const d = ctx.getImageData(px, py, 1, 1).data
            if ((d[0] | d[1] | d[2] | d[3]) !== 0) { anyNonZero = true; break outer }
          }
        }
        pixelStatus = anyNonZero ? 'ok' : 'all-zero'
      }
    } catch (err) {
      pixelStatus = 'tainted'
      pixelError = err instanceof Error ? err.message : String(err)
    }
  }

  return {
    slot,
    name: tex.name || '(unnamed)',
    texType: tex.constructor?.name || 'Texture',
    imageType,
    width,
    height,
    ...(isHtmlImg ? { complete: Boolean(img.complete), naturalWidth: Number(img.naturalWidth || 0) } : {}),
    format: tex.format,
    colorSpace: String(tex.colorSpace || ''),
    flipY: Boolean(tex.flipY),
    mimeType,
    pixelStatus,
    ...(pixelError ? { pixelError } : {}),
  }
}

function inspectPreparedSceneForLog(prepared: Object3D) {
  const seenMats = new Set<Material>()
  const uniqueTextures = new Set<string>()
  const issues: string[] = []
  let meshCount = 0
  let totalVertices = 0
  let totalTriangles = 0
  const meshes: { name: string; vertices: number; triangles: number; attrs: string[] }[] = []
  const materials: {
    name: string
    type: string
    vertexColors: boolean
    transparent: boolean
    alphaTest: number
    textures: TextureDiagEntry[]
  }[] = []

  const texSlots = ['map', 'normalMap', 'roughnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const

  prepared.traverse(node => {
    if (!(node instanceof Mesh)) return
    meshCount++
    const pos = node.geometry.getAttribute('position')
    const verts = pos?.count ?? 0
    const tris = node.geometry.index ? Math.round(node.geometry.index.count / 3) : Math.round(verts / 3)
    totalVertices += verts
    totalTriangles += tris
    meshes.push({
      name: node.name || '(unnamed)',
      vertices: verts,
      triangles: tris,
      attrs: Object.keys(node.geometry.attributes),
    })
    const mats = Array.isArray(node.material) ? node.material : [node.material]
    for (const mat of mats) {
      if (!mat || seenMats.has(mat)) continue
      seenMats.add(mat)
      const texList: TextureDiagEntry[] = []
      if (mat instanceof MeshStandardMaterial) {
        for (const slot of texSlots) {
          const t = mat[slot]
          if (!t) continue
          uniqueTextures.add(t.uuid)
          const diag = inspectTextureForLog(slot, t)
          texList.push(diag)
          if (diag.pixelStatus === 'empty' || diag.pixelStatus === 'not-loaded' || diag.pixelStatus === 'tainted' || diag.pixelStatus === 'all-zero') {
            issues.push(`材质 ${mat.name || '(unnamed)'}.${slot}(${diag.name}) 状态=${diag.pixelStatus} (${diag.width}×${diag.height})`)
          }
        }
      }
      materials.push({
        name: mat.name || '(unnamed)',
        type: mat.type,
        vertexColors: Boolean((mat as MeshStandardMaterial).vertexColors),
        transparent: Boolean(mat.transparent),
        alphaTest: Number(mat.alphaTest || 0),
        textures: texList,
      })
    }
  })

  return {
    meshCount,
    totalVertices,
    totalTriangles,
    uniqueTextureCount: uniqueTextures.size,
    meshes,
    materials,
    issues,
  }
}

export async function exportGlb(group: Object3D, options: ExportGlbOptions = {}) {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now()
  activityLog.exportStep(`开始导出 GLB（${options.mode === 'separate' ? '独立分体' : '整体合并'}）`, {
    rootName: group.name || '(unnamed)',
    options,
  })
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js')
  const tempDisposables: { dispose(): void }[] = []
  const prepared = prepareGlbSceneInternal(group, options, tempDisposables)
  const preDiag = inspectPreparedSceneForLog(prepared)
  activityLog.exportStep(
    `GLB 预处理完成：${preDiag.meshCount} 网格 · ${preDiag.materials.length} 材质 · ${preDiag.uniqueTextureCount} 张贴图`,
    preDiag,
  )
  if (preDiag.issues.length > 0) {
    activityLog.exportStep(
      `⚠️ 导出前检测到 ${preDiag.issues.length} 项贴图状态异常：${preDiag.issues.join('；')}`,
      preDiag.issues,
      'warn',
    )
  }
  try {
    const encodeStart = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const bytes = await new GLTFExporter().parseAsync(prepared, { binary: true, onlyVisible: false })
    if (!(bytes instanceof ArrayBuffer)) throw new Error('GLB 导出未生成二进制文件')
    const encodeMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - encodeStart)
    const totalMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started)
    const glbDiag = inspectGlbBinary(bytes)
    activityLog.exportStep(
      `GLB 编码完成：${(bytes.byteLength / 1024).toFixed(1)} KB（${glbDiag.meshCount} 网格 · ${glbDiag.materialCount} 材质 · ${glbDiag.textureCount} 贴图 · ${glbDiag.imageCount} 图像 · 编码 ${encodeMs} ms / 总计 ${totalMs} ms）`,
      glbDiag,
    )
    if (!glbDiag.valid) {
      activityLog.exportStep(`⚠️ GLB 文件头校验失败：${glbDiag.error || '未知结构异常'}`, glbDiag, 'error')
    } else if (preDiag.uniqueTextureCount > 0 && glbDiag.imageCount === 0) {
      activityLog.exportStep(
        `⚠️ GLB 贴图丢失：导出前有 ${preDiag.uniqueTextureCount} 张贴图，但生成的 GLB 中图像数为 0！`,
        { preMaterials: preDiag.materials, glbMaterials: glbDiag.materials, glbImages: glbDiag.images },
        'error',
      )
    } else {
      const badImages = glbDiag.images.filter(i => i.byteLength === 0 || i.magic === 'EMPTY' || i.magic === 'MISSING' || i.magic === 'UNKNOWN')
      if (badImages.length > 0) {
        activityLog.exportStep(
          `⚠️ GLB 内有 ${badImages.length} 张贴图数据异常（字节为空或格式头无效）`,
          badImages,
          'error',
        )
      } else if (preDiag.uniqueTextureCount === 0) {
        activityLog.exportStep(
          '提示：当前导出材质均使用顶点色/程序着色（未挂载位图贴图），因此 GLB 中不含位图图像（images=0）',
          { glbMaterials: glbDiag.materials },
          'info',
        )
      }
    }
    return new Blob([bytes], { type: 'model/gltf-binary' })
  } catch (err) {
    activityLog.exportStep(
      `GLB 编码失败：${err instanceof Error ? err.message : String(err)}`,
      err,
      'error',
    )
    throw err
  } finally {
    for (const d of tempDisposables) d.dispose()
  }
}
