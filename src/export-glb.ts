import {
  Box3, BufferAttribute, BufferGeometry, Color, Group, InstancedMesh, Matrix3, Matrix4, Mesh, MeshStandardMaterial,
  ShadowMaterial, Texture, Vector3, type Material, type Object3D,
} from 'three'
import { exportSceneToFbxBundle } from './export-fbx'
import { createZipArchive, textureToPngBytes, type ExportArchiveFile } from './export-zip'
import { activityLog, inspectGlbBinary } from './studio/activity-log'
import {
  bakeGrassBladeGradientMap, bakeProceduralBarkMaps,
  type BakedGrassGradientResult, type BakedProceduralBarkResult, type ProceduralBarkUniformLike,
} from './tree/bark-bake'
import type { TrunkSpec } from './tree/spec'
import { isWoodSculptActive, type BarkHeightField, type TrunkFeaturePlan } from './tree/wood-sculpt'
import {
  bakedBarkMapsToPngDataUrls, bakeSculptedBarkMaps, bakeSculptedBarkMapsAsync,
  type BakedBarkMaps, type NormalMapConvention,
} from './tree/wood-weld'

export type BakeResolution = 512 | 1024 | 2048
export type ExportFileFormat = 'glb' | 'gltf-split' | 'fbx'

export interface ExportGlbOptions {
  /** Output format / packaging mode: 'glb' (single embedded file), 'gltf-split' (glTF + bin + textures/*.png), or 'fbx' (FBX 7.4 Binary + textures/*.png). */
  exportFormat?: ExportFileFormat
  /** 'merged' = bake transforms & combine into one single multi-material Mesh (distinct material slots
   *  for bark, foliage, flowers, grass, other); 'separate' = preserve independent parts & sub-meshes. */
  mode?: 'merged' | 'separate'
  /** Remove decorative meshes such as ambient petals/particles, stones/rocks, and accessory ground grass under trees. */
  excludeDecorations?: boolean
  /** Bake 3D world-space upward moss & root grounding from procedural-bark-v3 directly into wood vertex colors
   *  so external PBR engines (Blender / Unity / Unreal) reproduce the mossy trunk without custom GLSL shaders. */
  bakeBarkMoss?: boolean
  /** Bake default procedural bark (when no custom bark bitmap is bound) into seamless BaseColor + Normal PNG maps
   *  so every default tree exports with real bark textures for Blender / Unity / Unreal. */
  bakeProceduralBark?: boolean
  /** Bake analytical High-Poly Sculpted Bark -> glTF 2.0 Tangent-Space NormalMap + Cavity AO Map
   *  so low-poly / game LOD exports preserve crisp carved wide-rib relief & crevices in Blender / Unity / UE. */
  bakeBarkNormal?: boolean
  /** Resolution of baked sculpted / procedural bark maps (default 512). */
  bakeBarkNormalSize?: BakeResolution
  /** Normal map green-channel convention: 'opengl' (+Y, glTF/Blender/Unity) or 'directx' (-Y, Unreal/3dsMax). */
  bakeBarkNormalConvention?: NormalMapConvention
  /** Bake a lightweight 64x256 gradient + vein BaseColor PNG for modeled 3D grass blades (vertex-color only by default). */
  bakeGrassTexture?: boolean
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
  proceduralBarkMeshes: number
  grassBakedMeshes: number
  hasModeledGrass: boolean
  hasProceduralBark: boolean
  vertexColorOnlyMaterials: string[]
  windUvMeshes: number
}

export interface ExportBundleResult {
  format: 'gltf-split' | 'fbx'
  primaryFilename: string
  files: ExportArchiveFile[]
  textureFiles: string[]
  meshCount: number
  materialCount: number
  toZipBlob(): Blob
}

const PREVIEW_ONLY_ATTRIBUTES = new Set(['leafCenter', 'leafCorner', 'shadeWeight', 'windWeight', 'pivotPos', 'barkMetric', 'rockData'])
const PREVIEW_ONLY_USERDATA = new Set(['leafUniforms', 'barkUniforms', 'procUniforms', 'barkMap', 'windUniforms', 'rockUniforms'])

const ALWAYS_DECOR_RE = /ambient\s*petal|drift(?:ing)?\s*petal|falling\s*petal|particle|spark|dust|rock|stone|pebble|碎石|石头|石块|粒子|飘落|落瓣|装饰/i
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

interface BarkUniformBundle extends ProceduralBarkUniformLike {
  uUseBarkMap?: { value: number }
  uBarkTint?: { value: number }
}

function hasActiveBarkMoss(mat: Material | undefined): BarkUniformBundle | undefined {
  const u = mat?.userData?.barkUniforms as BarkUniformBundle | undefined
  if (!u) return undefined
  const moss = Number(u.uBarkMoss?.value ?? 0)
  const rootAO = Number(u.uBarkRootAO?.value ?? 0)
  return (moss > 0.001 || rootAO > 0.001) ? u : undefined
}

function isProceduralBarkMaterial(mat: Material | undefined): BarkUniformBundle | undefined {
  if (!mat || !(mat instanceof MeshStandardMaterial)) return undefined
  const u = mat.userData?.barkUniforms as BarkUniformBundle | undefined
  if (!u) return undefined
  const useMap = Number(u.uUseBarkMap?.value ?? 0) > 0.5 || Boolean(mat.userData?.barkMap) || Boolean(mat.map)
  return useMap ? undefined : u
}

function isModeledGrassMesh(node: Mesh, mat: Material | undefined): boolean {
  if (!mat || !(mat instanceof MeshStandardMaterial)) return false
  if (mat.map || !mat.vertexColors) return false
  if (!node.geometry.getAttribute('uv') || !node.geometry.getAttribute('color')) return false
  const mName = (node.name || '').toLowerCase()
  const matName = (mat.name || '').toLowerCase()
  return mName.includes('grass') || matName.includes('grass') || matName.includes('blade') || Boolean(node.userData?.isPaintedGrass)
}

/** Resolves whether wood vertex colors need CPU baking before glTF export:
 *  - When `bakeBarkMoss` is true and moss/rootAO > 0: full moss + rootAO + map AO normalization.
 *  - Whenever a bark texture (`uUseBarkMap > 0.5`, custom `barkMap`, OR newly baked procedural bark map)
 *    is active on a vertex-colored wood material: ALWAYS normalize the dark-brown base vertex color into
 *    neutral AO (prevents pitch-black trunks in Blender/UE/Unity!). */
function resolveBarkColorBake(
  mat: Material | undefined,
  bakeBarkMoss: boolean,
  hasBakedProceduralMap = false,
): { u: BarkUniformBundle; includeMoss: boolean } | undefined {
  const u = mat?.userData?.barkUniforms as BarkUniformBundle | undefined
  if (!u) return undefined
  if (hasBakedProceduralMap && mat instanceof MeshStandardMaterial && mat.vertexColors) {
    // When procedural bark BaseColor PNG already contains the bark color (and moss if enabled),
    // normalize vertex color into neutral AO so texture * vertexColor never double-darkens!
    return { u, includeMoss: bakeBarkMoss && Boolean(hasActiveBarkMoss(mat)) }
  }
  if (bakeBarkMoss && hasActiveBarkMoss(mat)) return { u, includeMoss: true }
  const useMap = Number(u.uUseBarkMap?.value ?? 0) > 0.5 || Boolean(mat?.userData?.barkMap)
  if (useMap && mat instanceof MeshStandardMaterial && mat.vertexColors) {
    return { u, includeMoss: false }
  }
  return undefined
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
  includeMoss = true,
  forceNormalizeForMap = false,
): BufferAttribute | undefined {
  const pos = geo.getAttribute('position')
  const norm = geo.getAttribute('normal')
  if (!pos) return undefined
  const colAttr = geo.getAttribute('color') as BufferAttribute | undefined
  const mossAmt = includeMoss ? clamp01(Number(u.uBarkMoss?.value ?? 0)) : 0
  const rootAoAmt = includeMoss ? clamp01(Number(u.uBarkRootAO?.value ?? 0)) : 0
  const scale = Math.max(0.15, Number(u.uBarkScale?.value ?? 1))
  const useMap = forceNormalizeForMap || Number(u.uUseBarkMap?.value ?? 0) > 0.5
  const baseLum = Math.max(0.03, Number(u.uBarkBaseLum?.value ?? 0.12))
  const tint = forceNormalizeForMap ? 0 : clamp01(Number(u.uBarkTint?.value ?? 0.45))
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

  if (mName.includes('lotus petal') || matName === 'lotuspetals') return 'Mat_Lotus_Petals'
  if (mName.includes('lotus center') || matName === 'lotuscenters') return 'Mat_Lotus_Center'
  if (mName.includes('lotus leaf') || mName.includes('lotus leaves') || matName === 'lotusleaves') return 'Mat_Lotus_Leaves'
  if (mName.includes('lotus stem') || matName === 'lotusstems') return 'Mat_Lotus_Stems'
  if (mName.includes('bamboo culm') || matName === 'bambooculm') return 'Mat_Bamboo_Culm'
  if (mName.includes('bamboo leaf') || mName.includes('bamboo leaves') || matName === 'bambooleaves') return 'Mat_Foliage_Bamboo'
  if (mName.includes('ambient petal') || matName.includes('ambientpetal')) return 'Mat_Decor_Petals'
  if (mName.includes('stem leave') || matName === 'flowerstemleaves') return 'Mat_Plant_StemLeaves'
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
    if (kind === 'broadleaf' || kind === 'conifer' || kind === 'palm' || kind === 'bamboo') { found = true; return }
    if (o instanceof Mesh && (o.name === 'Trunk and branches' || o.name === 'Leaf cards' || o.name === 'Needle fronds' || o.name === 'Palm fronds' || o.name === 'Bamboo culms')) {
      found = true
    }
  })
  return found
}

function isEffectivelyVisible(node: Object3D, root: Object3D): boolean {
  let cur: Object3D | null = node
  while (cur) {
    if (!cur.visible) return false
    if (cur === root) break
    cur = cur.parent
  }
  return true
}

function isExportIgnoredMesh(node: Mesh): boolean {
  if (node.userData?.exportIgnore === true) return true
  if (node.name === 'StudioShadowFloor') return true
  const mats = Array.isArray(node.material) ? node.material : [node.material]
  if (mats.length > 0 && mats.every(m => m instanceof ShadowMaterial)) return true
  return false
}

function isDecorativeNode(node: Object3D, root: Object3D, hasTree: boolean): boolean {
  // Never classify the scene diorama base or explicit user-placed Scene Assembly hero rocks as tree decorations
  let pCheck: Object3D | null = node
  while (pCheck && pCheck !== root) {
    if (pCheck.userData?.isGround === true && pCheck.userData?.exportIgnore !== true) return false
    if (pCheck.userData?.assemblyItemId && (pCheck.userData?.assemblyCategory === 'rock' || (pCheck.userData?.spec as { preset?: string } | undefined)?.preset)) return false
    pCheck = pCheck.parent
  }
  const check = (o: Object3D): boolean => {
    const role = o.userData?.role
    if (role === 'particle' || role === 'decoration') return true
    if (o.name && ALWAYS_DECOR_RE.test(o.name)) return true
    if (hasTree) {
      const kind = (o.userData?.spec as { kind?: string } | undefined)?.kind
      if (kind === 'grass' || kind === 'fern' || kind === 'flowerbed' || kind === 'lotus') return true
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

function isBrokenTexture(val: unknown): boolean {
  if (!val || typeof val !== 'object' || !(val as { isTexture?: boolean }).isTexture) return false
  const img = (val as Texture).image as { width?: number; height?: number; complete?: boolean; naturalWidth?: number } | null | undefined
  if (!img) return true
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) {
    return !img.complete || img.naturalWidth === 0
  }
  return false
}

function hasBrokenTextureOnMaterial(mat: Material): boolean {
  const rec = mat as unknown as Record<string, unknown>
  for (const key of Object.keys(rec)) {
    if (key === 'userData') continue
    if (isBrokenTexture(rec[key])) return true
  }
  const barkTex = mat.userData?.barkMap as Texture | undefined
  if (barkTex) {
    if (isBrokenTexture(barkTex) || isBrokenTexture(barkTex.userData?.normalMap) || isBrokenTexture(barkTex.userData?.roughnessMap)) {
      return true
    }
  }
  return false
}

function stripBrokenTexturesOnMaterial(mat: Material): string[] {
  const stripped: string[] = []
  const rec = mat as unknown as Record<string, unknown>
  for (const key of Object.keys(rec)) {
    if (key === 'userData') continue
    const val = rec[key]
    if (isBrokenTexture(val)) {
      const texName = (val as Texture).name || '(unnamed)'
      rec[key] = null
      stripped.push(`${key}(${texName})`)
    }
  }
  if (stripped.length > 0) {
    activityLog.warn(
      'export',
      `材质 ${mat.name || '(unnamed)'} 包含未加载或损坏的贴图，导出前已自动剥离：${stripped.join('、')}`,
      { material: mat.name || '(unnamed)', stripped },
    )
  }
  return stripped
}

function createMaterialDeduper(
  stripBrokenTextures = false,
  tempDisposables?: { dispose(): void }[],
): CleanMaterialFactory {
  const cache = new Map<string, Material>()
  const nonStdCache = new Map<Material, Material>()
  return {
    get(mesh: Mesh, mat: Material, useSemanticName: boolean): Material {
      const semantic = useSemanticName ? semanticMaterialName(mesh, mat) : undefined
      const key = materialKey(mat, semantic)
      if (!key) {
        if (!stripBrokenTextures || !hasBrokenTextureOnMaterial(mat)) return mat
        const hit = nonStdCache.get(mat)
        if (hit) return hit
        const cloned = mat.clone()
        stripBrokenTexturesOnMaterial(cloned)
        nonStdCache.set(mat, cloned)
        tempDisposables?.push(cloned)
        return cloned
      }
      const existing = cache.get(key)
      if (existing) return existing
      const barkTex = mat.userData?.barkMap as Texture | undefined
      const hasCustomData = Boolean(mat.userData && Object.keys(mat.userData).some(k => PREVIEW_ONLY_USERDATA.has(k)))
      const hasBroken = stripBrokenTextures && hasBrokenTextureOnMaterial(mat)
      const hasPotentialRoughness = mat instanceof MeshStandardMaterial && Boolean(mat.roughnessMap || barkTex?.userData?.roughnessMap)
      const needsMetalRoughAlias = mat instanceof MeshStandardMaterial && mat.metalness === 0 && hasPotentialRoughness && !mat.metalnessMap
      const needsClone = hasCustomData || (semantic !== undefined && semantic !== mat.name) || hasBroken || needsMetalRoughAlias
      let clean = mat
      if (needsClone) {
        clean = mat.clone()
        if (semantic) clean.name = semantic
        if (clean instanceof MeshStandardMaterial && barkTex) {
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
        if (stripBrokenTextures) {
          stripBrokenTexturesOnMaterial(clean)
        }
        // Zero-reencode optimization (ez-tree inspired): when metalness === 0 and roughnessMap is set
        // without a separate metalnessMap, alias metalnessMap = roughnessMap so GLTFExporter skips CPU
        // metallicRoughness PNG compositing and avoids console merge warnings.
        if (clean instanceof MeshStandardMaterial && clean.metalness === 0 && clean.roughnessMap && !clean.metalnessMap) {
          clean.metalnessMap = clean.roughnessMap
        }
        tempDisposables?.push(clean)
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

/** Bakes a Three.js `InstancedMesh` (e.g. UE-style painted grass clusters) into a standard
 *  non-instanced `BufferGeometry` in local mesh space, applying every instance matrix & color
 *  so Blender, Unity, Unreal, and glTF viewers open painted foliage 1:1 without extensions. */
function bakeInstancedMeshGeometry(instMesh: InstancedMesh): BufferGeometry | undefined {
  const count = instMesh.count
  const src = instMesh.geometry
  const posAttr = src.getAttribute('position')
  if (count <= 0 || !posAttr) return undefined

  const vPerInst = posAttr.count
  const idxAttr = src.index
  const iPerInst = idxAttr ? idxAttr.count : vPerInst
  const totalVerts = vPerInst * count
  const totalIndices = iPerInst * count

  const normAttr = src.getAttribute('normal')
  const colAttr = src.getAttribute('color') as BufferAttribute | undefined
  const uvAttr = src.getAttribute('uv') as BufferAttribute | undefined
  const hasInstColor = Boolean(instMesh.instanceColor)
  const wantColor = Boolean(colAttr || hasInstColor)

  const positions = new Float32Array(totalVerts * 3)
  const normals = new Float32Array(totalVerts * 3)
  const colors = wantColor ? new Float32Array(totalVerts * 3) : undefined
  const uvs = uvAttr ? new Float32Array(totalVerts * 2) : undefined
  const windWeights = new Float32Array(totalVerts)
  const indices = totalVerts > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices)

  // Compute instance-local Y range so grass roots stay strictly 0 regardless of terrain hill elevation
  let instMinY = Infinity, instMaxY = -Infinity
  for (let i = 0; i < vPerInst; i++) {
    const ly = posAttr.getY(i)
    if (ly < instMinY) instMinY = ly
    if (ly > instMaxY) instMaxY = ly
  }
  const instInvSpan = 1 / Math.max(0.05, instMaxY - instMinY)
  const localWind = new Float32Array(vPerInst)
  for (let i = 0; i < vPerInst; i++) {
    localWind[i] = clamp01((posAttr.getY(i) - instMinY) * instInvSpan)
  }

  const mat4 = new Matrix4()
  const normMat = new Matrix3()
  const instCol = new Color(1, 1, 1)
  const v = new Vector3()
  const n = new Vector3()
  let vCursor = 0
  let iCursor = 0

  for (let k = 0; k < count; k++) {
    instMesh.getMatrixAt(k, mat4)
    normMat.getNormalMatrix(mat4)
    const flip = mat4.determinant() < 0
    if (hasInstColor) instMesh.getColorAt(k, instCol)
    else instCol.setRGB(1, 1, 1)

    const baseVertex = vCursor
    for (let i = 0; i < vPerInst; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(mat4)
      positions[(vCursor + i) * 3] = v.x
      positions[(vCursor + i) * 3 + 1] = v.y
      positions[(vCursor + i) * 3 + 2] = v.z

      if (normAttr) {
        n.fromBufferAttribute(normAttr, i).applyMatrix3(normMat)
        if (n.lengthSq() > 1e-10) n.normalize()
        else n.set(0, 1, 0)
      } else {
        n.set(0, 1, 0)
      }
      normals[(vCursor + i) * 3] = n.x
      normals[(vCursor + i) * 3 + 1] = n.y
      normals[(vCursor + i) * 3 + 2] = n.z

      if (colors) {
        const cr = colAttr ? colAttr.getX(i) : 1
        const cg = colAttr ? colAttr.getY(i) : 1
        const cb = colAttr ? colAttr.getZ(i) : 1
        colors[(vCursor + i) * 3] = Math.min(1, Math.max(0, cr * instCol.r))
        colors[(vCursor + i) * 3 + 1] = Math.min(1, Math.max(0, cg * instCol.g))
        colors[(vCursor + i) * 3 + 2] = Math.min(1, Math.max(0, cb * instCol.b))
      }

      if (uvs && uvAttr) {
        uvs[(vCursor + i) * 2] = uvAttr.getX(i)
        uvs[(vCursor + i) * 2 + 1] = uvAttr.getY(i)
      }
      windWeights[vCursor + i] = localWind[i]
    }

    if (idxAttr) {
      for (let i = 0; i < iPerInst; i += 3) {
        const a = baseVertex + idxAttr.getX(i)
        const b = baseVertex + idxAttr.getX(i + 1)
        const c = baseVertex + idxAttr.getX(i + 2)
        if (flip) {
          indices[iCursor++] = a; indices[iCursor++] = c; indices[iCursor++] = b
        } else {
          indices[iCursor++] = a; indices[iCursor++] = b; indices[iCursor++] = c
        }
      }
    } else {
      for (let i = 0; i < vPerInst; i += 3) {
        const a = baseVertex + i
        const b = baseVertex + i + 1
        const c = baseVertex + i + 2
        if (flip) {
          indices[iCursor++] = a; indices[iCursor++] = c; indices[iCursor++] = b
        } else {
          indices[iCursor++] = a; indices[iCursor++] = b; indices[iCursor++] = c
        }
      }
    }
    vCursor += vPerInst
  }

  const out = new BufferGeometry()
  out.name = src.name || instMesh.name || 'InstancedBaked'
  out.setAttribute('position', new BufferAttribute(positions, 3))
  out.setAttribute('normal', new BufferAttribute(normals, 3))
  if (colors) out.setAttribute('color', new BufferAttribute(colors, 3))
  if (uvs) out.setAttribute('uv', new BufferAttribute(uvs, 2))
  out.setAttribute('windWeight', new BufferAttribute(windWeights, 1))
  out.setIndex(new BufferAttribute(indices, 1))
  out.computeBoundingBox()
  out.computeBoundingSphere()
  return out
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

/** Slices a sub-range `[start, start+count)` of an indexed or non-indexed BufferGeometry
 *  and compacts vertex attributes so multi-material merges never duplicate unreferenced vertices. */
function sliceGeometryGroup(src: BufferGeometry, start: number, count: number): BufferGeometry {
  const out = new BufferGeometry()
  out.name = src.name
  const pos = src.getAttribute('position')
  if (!pos || count <= 0) return out
  if (src.index) {
    const idxArr = src.index.array
    const end = Math.min(idxArr.length, start + count)
    const remap = new Map<number, number>()
    const used: number[] = []
    const newIdx = new Uint32Array(Math.max(0, end - start))
    for (let i = start; i < end; i++) {
      const oldV = idxArr[i]
      let nv = remap.get(oldV)
      if (nv === undefined) {
        nv = used.length
        remap.set(oldV, nv)
        used.push(oldV)
      }
      newIdx[i - start] = nv
    }
    for (const [name, attr] of Object.entries(src.attributes)) {
      if (!(attr instanceof BufferAttribute)) continue
      const itemSize = attr.itemSize
      const Ctor = attr.array.constructor as new (len: number) => Float32Array | Uint16Array | Uint8Array | Uint32Array
      const nextArr = new Ctor(used.length * itemSize)
      for (let i = 0; i < used.length; i++) {
        const srcOff = used[i] * itemSize
        const dstOff = i * itemSize
        for (let k = 0; k < itemSize; k++) nextArr[dstOff + k] = attr.array[srcOff + k]
      }
      out.setAttribute(name, new BufferAttribute(nextArr, itemSize, attr.normalized))
    }
    const finalIdx = used.length <= 65535 ? new Uint16Array(newIdx) : newIdx
    out.setIndex(new BufferAttribute(finalIdx, 1))
  } else {
    const end = Math.min(pos.count, start + count)
    const n = Math.max(0, end - start)
    for (const [name, attr] of Object.entries(src.attributes)) {
      if (!(attr instanceof BufferAttribute)) continue
      const itemSize = attr.itemSize
      const Ctor = attr.array.constructor as new (len: number) => Float32Array | Uint16Array | Uint8Array | Uint32Array
      const nextArr = new Ctor(n * itemSize)
      nextArr.set(attr.array.subarray(start * itemSize, end * itemSize))
      out.setAttribute(name, new BufferAttribute(nextArr, itemSize, attr.normalized))
    }
  }
  return out
}

async function prebakeSculptedBarkMapsAsync(
  root: Object3D,
  options: ExportGlbOptions,
  tempDisposables: { dispose(): void }[],
): Promise<Map<BufferGeometry, BakedBarkMaps>> {
  const prebaked = new Map<BufferGeometry, BakedBarkMaps>()
  if (!options.bakeBarkNormal) return prebaked
  const excludeDecorations = Boolean(options.excludeDecorations)
  const hasTree = excludeDecorations ? hasWoodyTreeInScene(root) : false
  const size: BakeResolution = options.bakeBarkNormalSize === 1024 || options.bakeBarkNormalSize === 2048 ? options.bakeBarkNormalSize : 512
  const normalConvention: NormalMapConvention = options.bakeBarkNormalConvention === 'directx' ? 'directx' : 'opengl'

  const jobs: {
    geometry: BufferGeometry
    info: NonNullable<ReturnType<typeof getSculptBakeInfo>>
    baseNormalMap?: Texture
  }[] = []
  const seen = new Set<BufferGeometry>()

  root.traverse(node => {
    if (!(node instanceof Mesh) || seen.has(node.geometry)) return
    if (!isEffectivelyVisible(node, root) || isExportIgnoredMesh(node)) return
    if (excludeDecorations && isDecorativeNode(node, root, hasTree)) return
    const info = getSculptBakeInfo(node)
    if (!info) return
    const mats = Array.isArray(node.material) ? node.material : [node.material]
    const stdMat = mats.find(m => m instanceof MeshStandardMaterial)
    if (!stdMat) return
    seen.add(node.geometry)
    const barkNormFallback = (stdMat.userData?.barkMap as Texture | undefined)?.userData?.normalMap
    const baseNormalMap = stdMat.normalMap
      ?? (barkNormFallback instanceof Texture ? barkNormFallback : undefined)
    jobs.push({ geometry: node.geometry, info, baseNormalMap: baseNormalMap ?? undefined })
  })

  for (const job of jobs) {
    const baked = await bakeSculptedBarkMapsAsync(job.info.trunk, job.info.seed, job.info.detail, {
      size,
      normalConvention,
      heightField: job.info.heightField,
      baseNormalMap: job.baseNormalMap,
      plan: job.info.plan,
    })
    prebaked.set(job.geometry, baked)
    tempDisposables.push(baked)
  }
  return prebaked
}

function prepareGlbSceneInternal(
  root: Object3D,
  options: ExportGlbOptions = {},
  tempDisposables?: { dispose(): void }[],
  stripBrokenTextures = false,
  prebakedNormals?: Map<BufferGeometry, BakedBarkMaps>,
): Object3D {
  const mode = options.mode ?? 'separate'
  const excludeDecorations = Boolean(options.excludeDecorations)
  const bakeBarkMoss = Boolean(options.bakeBarkMoss)
  const bakeBarkNormal = Boolean(options.bakeBarkNormal)
  const bakeProceduralBark = Boolean(options.bakeProceduralBark)
  const bakeGrassTexture = Boolean(options.bakeGrassTexture)
  const bakeBarkNormalSize: BakeResolution = options.bakeBarkNormalSize === 1024 || options.bakeBarkNormalSize === 2048 ? options.bakeBarkNormalSize : 512
  const bakeBarkNormalConvention: NormalMapConvention = options.bakeBarkNormalConvention === 'directx' ? 'directx' : 'opengl'
  const exportWindUv = Boolean(options.exportWindUv)
  const hasTree = excludeDecorations ? hasWoodyTreeInScene(root) : false
  const hasRootAiScene = Boolean(root.userData && 'aiScene' in root.userData)
  const deduper = createMaterialDeduper(stripBrokenTextures, tempDisposables)
  const bakedNormalCache = new Map<BufferGeometry, BakedBarkMaps>(prebakedNormals)
  const bakedProcBarkCache = new Map<string, BakedProceduralBarkResult>()
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
      if (!isEffectivelyVisible(node, root) || isExportIgnoredMesh(node)) return
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

  const maybeAttachBakedNormal = (
    node: Mesh,
    rawMat: Material,
    cleanMat: Material,
  ): { material: Material; hasProceduralColorMap: boolean } => {
    if (!(cleanMat instanceof MeshStandardMaterial)) {
      return { material: cleanMat, hasProceduralColorMap: false }
    }
    const bakeInfo = bakeBarkNormal ? getSculptBakeInfo(node) : undefined
    const procUniforms = bakeProceduralBark ? isProceduralBarkMaterial(rawMat) : undefined
    if (!bakeInfo && !procUniforms) {
      return { material: cleanMat, hasProceduralColorMap: false }
    }

    const procKey = procUniforms
      ? `${procUniforms.uBarkTargetColor?.value?.getHexString?.() ?? '5b4636'}|${Number(procUniforms.uBarkScale?.value ?? 1).toFixed(2)}|${Number(procUniforms.uBarkDetail?.value ?? 0.72).toFixed(2)}|${bakeBarkMoss ? Number(procUniforms.uBarkMoss?.value ?? 0).toFixed(2) : 0}|${bakeBarkNormalSize}|${bakeBarkNormalConvention}`
      : ''
    const cacheKey = `${bakeInfo ? node.geometry.uuid : 'nosc'}|${cleanMat.uuid}|${procKey}|${bakeBarkNormalSize}|${bakeBarkNormalConvention}`
    const cachedMat = bakedMaterialCache.get(cacheKey)
    if (cachedMat) {
      return { material: cachedMat, hasProceduralColorMap: Boolean(procUniforms) }
    }

    const matWithBaked = cleanMat.clone()

    if (bakeInfo) {
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
      matWithBaked.normalMap = baked.normalMap
      matWithBaked.normalScale.set(1, 1)
      matWithBaked.aoMap = baked.aoMap
      matWithBaked.aoMapIntensity = 0.85
    }

    if (procUniforms) {
      let procBaked = bakedProcBarkCache.get(procKey)
      if (!procBaked) {
        procBaked = bakeProceduralBarkMaps(procUniforms, {
          size: bakeBarkNormalSize,
          normalConvention: bakeBarkNormalConvention,
          includeMoss: bakeBarkMoss,
        })
        bakedProcBarkCache.set(procKey, procBaked)
        tempDisposables?.push(procBaked)
      }
      if (!matWithBaked.map) {
        matWithBaked.map = procBaked.colorMap
      }
      // Attach procedural bark normal map whenever sculpted normal map is not already present
      if (!matWithBaked.normalMap) {
        matWithBaked.normalMap = procBaked.normalMap
        matWithBaked.normalScale.set(0.85, 0.85)
      }
    }

    bakedMaterialCache.set(cacheKey, matWithBaked)
    tempDisposables?.push(matWithBaked)
    return { material: matWithBaked, hasProceduralColorMap: Boolean(procUniforms) }
  }

  const maybeBakeGrassMaterial = (
    node: Mesh,
    geoForSample: BufferGeometry,
    rawMat: Material,
    cleanMat: Material,
  ): { material: Material; normalizedColors?: BufferAttribute } => {
    if (!bakeGrassTexture || !(cleanMat instanceof MeshStandardMaterial) || !isModeledGrassMesh(node, rawMat)) {
      return { material: cleanMat }
    }
    const baked: BakedGrassGradientResult | undefined = bakeGrassBladeGradientMap(geoForSample, { width: 64, height: 256 })
    if (!baked) return { material: cleanMat }
    tempDisposables?.push(baked)
    const matWithGrass = cleanMat.clone()
    matWithGrass.map = baked.colorMap
    tempDisposables?.push(matWithGrass)
    return { material: matWithGrass, normalizedColors: baked.normalizedColors }
  }

  if (mode === 'merged') {
    const entries: MergeEntry[] = []

    root.traverse(node => {
      if (!(node instanceof Mesh)) return
      if (!isEffectivelyVisible(node, root) || isExportIgnoredMesh(node)) return
      if (excludeDecorations && isDecorativeNode(node, root, hasTree)) return
      const relMatrix = invRoot.clone().multiply(node.matrixWorld)
      const normalMatrix = new Matrix3().getNormalMatrix(relMatrix)
      const flipWinding = relMatrix.determinant() < 0

      if (node instanceof InstancedMesh) {
        const bakedInst = bakeInstancedMeshGeometry(node)
        if (!bakedInst) return
        tempDisposables?.push(bakedInst)
        const rawMat = Array.isArray(node.material) ? node.material[0] : node.material
        if (!rawMat) return
        const { material: barkMat } = maybeAttachBakedNormal(node, rawMat, deduper.get(node, rawMat, true))
        const grassRes = maybeBakeGrassMaterial(node, bakedInst, rawMat, barkMat)
        const windUv1 = exportWindUv ? synthesizeWindUv1(bakedInst, node, relMatrix, windYMin, windHeightSpan) : undefined
        const geo = cleanGeometry(bakedInst, grassRes.normalizedColors, windUv1)
        entries.push({ geometry: geo, material: grassRes.material, matrix: relMatrix, normalMatrix, flipWinding })
        return
      }

      const windUv1 = exportWindUv ? synthesizeWindUv1(node.geometry, node, relMatrix, windYMin, windHeightSpan) : undefined

      if (Array.isArray(node.material) && node.geometry.groups.length > 0) {
        for (const g of node.geometry.groups) {
          const rawMat = node.material[g.materialIndex ?? 0]
          if (!rawMat) continue
          const { material: barkMat, hasProceduralColorMap } = maybeAttachBakedNormal(node, rawMat, deduper.get(node, rawMat, true))
          const grassRes = maybeBakeGrassMaterial(node, node.geometry, rawMat, barkMat)
          const barkBake = resolveBarkColorBake(rawMat, bakeBarkMoss, hasProceduralColorMap)
          const bakedCol = grassRes.normalizedColors ?? (barkBake
            ? bakeBarkMossToColorAttr(node.geometry, barkBake.u, node.matrixWorld, barkBake.includeMoss, hasProceduralColorMap)
            : undefined)
          const cleanAll = cleanGeometry(node.geometry, bakedCol, windUv1)
          const sub = sliceGeometryGroup(cleanAll, g.start, g.count)
          entries.push({ geometry: sub, material: grassRes.material, matrix: relMatrix, normalMatrix, flipWinding })
        }
      } else {
        const rawMat = Array.isArray(node.material) ? node.material[0] : node.material
        if (!rawMat) return
        const { material: barkMat, hasProceduralColorMap } = maybeAttachBakedNormal(node, rawMat, deduper.get(node, rawMat, true))
        const grassRes = maybeBakeGrassMaterial(node, node.geometry, rawMat, barkMat)
        const barkBake = resolveBarkColorBake(rawMat, bakeBarkMoss, hasProceduralColorMap)
        const bakedCol = grassRes.normalizedColors ?? (barkBake
          ? bakeBarkMossToColorAttr(node.geometry, barkBake.u, node.matrixWorld, barkBake.includeMoss, hasProceduralColorMap)
          : undefined)
        const geo = cleanGeometry(node.geometry, bakedCol, windUv1)
        entries.push({ geometry: geo, material: grassRes.material, matrix: relMatrix, normalMatrix, flipWinding })
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
  // optionally baking procedural bark BaseColor+Normal, sculpted Normal+AO, grass gradient BaseColor,
  // 3D bark moss into vertex colors, engine wind TEXCOORD_1, and removing decorative meshes/groups.
  const geometryCache = new Map<BufferGeometry, BufferGeometry>()
  const cloneNode = (node: Object3D, isRoot: boolean): Object3D | undefined => {
    if (!isRoot && !node.visible) return undefined
    if (!isRoot && node instanceof Mesh && isExportIgnoredMesh(node)) return undefined
    if (!isRoot && excludeDecorations && isDecorativeNode(node, root, hasTree)) return undefined
    let copy: Object3D
    if (node instanceof Mesh) {
      if (node instanceof InstancedMesh) {
        const bakedInst = bakeInstancedMeshGeometry(node)
        if (!bakedInst) return undefined
        tempDisposables?.push(bakedInst)
        const rawMat = Array.isArray(node.material) ? node.material[0] : node.material
        const { material: barkMat } = maybeAttachBakedNormal(node, rawMat, deduper.get(node, rawMat, false))
        const grassRes = maybeBakeGrassMaterial(node, bakedInst, rawMat, barkMat)
        const relMatrix = exportWindUv ? invRoot.clone().multiply(node.matrixWorld) : undefined
        const windUv1 = relMatrix ? synthesizeWindUv1(bakedInst, node, relMatrix, windYMin, windHeightSpan) : undefined
        const geo = cleanGeometry(bakedInst, grassRes.normalizedColors, windUv1)
        copy = new Mesh(geo, grassRes.material)
        copy.castShadow = node.castShadow
        copy.receiveShadow = node.receiveShadow
      } else {
        const rawMat = Array.isArray(node.material) ? node.material[0] : node.material
        let hasProceduralColorMap = false
        let grassNormColors: BufferAttribute | undefined
        const processOneMat = (m: Material) => {
          const b = maybeAttachBakedNormal(node, m, deduper.get(node, m, false))
          if (b.hasProceduralColorMap) hasProceduralColorMap = true
          const g = maybeBakeGrassMaterial(node, node.geometry, m, b.material)
          if (g.normalizedColors && !grassNormColors) grassNormColors = g.normalizedColors
          return g.material
        }
        const mat = Array.isArray(node.material)
          ? node.material.map(processOneMat)
          : processOneMat(node.material)
        const barkBake = resolveBarkColorBake(rawMat, bakeBarkMoss, hasProceduralColorMap)
        const canCacheGeo = !barkBake && !grassNormColors && !exportWindUv
        let geo = canCacheGeo ? geometryCache.get(node.geometry) : undefined
        if (!geo) {
          const bakedCol = grassNormColors ?? (barkBake
            ? bakeBarkMossToColorAttr(node.geometry, barkBake.u, node.matrixWorld, barkBake.includeMoss, hasProceduralColorMap)
            : undefined)
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
      }
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

/** Fast non-mutating inspection for the GLB / Split / FBX export dialog (exact mesh count, triangles, material slots). */
export function inspectGlbExport(root: Object3D, options: ExportGlbOptions = {}): GlbExportPreview {
  const mode = options.mode ?? 'merged'
  const excludeDecorations = Boolean(options.excludeDecorations)
  const bakeBarkMoss = Boolean(options.bakeBarkMoss)
  const bakeBarkNormal = Boolean(options.bakeBarkNormal)
  const bakeProceduralBark = Boolean(options.bakeProceduralBark)
  const bakeGrassTexture = Boolean(options.bakeGrassTexture)
  const exportWindUv = Boolean(options.exportWindUv)
  const hasTree = excludeDecorations ? hasWoodyTreeInScene(root) : false
  const deduper = createMaterialDeduper()
  const matNames: string[] = []
  const vertexColorOnlyMaterials: string[] = []
  const seenMats = new Set<Material>()
  let keptMeshes = 0
  let excludedDecorations = 0
  let mossBakedMeshes = 0
  let normalBakedMeshes = 0
  let proceduralBarkMeshes = 0
  let grassBakedMeshes = 0
  let hasModeledGrass = false
  let hasProceduralBark = false
  let triangles = 0

  root.traverse(node => {
    if (!(node instanceof Mesh)) return
    if (!isEffectivelyVisible(node, root) || isExportIgnoredMesh(node)) return
    if (node instanceof InstancedMesh && node.count <= 0) return
    if (excludeDecorations && isDecorativeNode(node, root, hasTree)) {
      excludedDecorations++
      return
    }
    keptMeshes++
    const pos = node.geometry.getAttribute('position')
    const baseTris = node.geometry.index ? Math.round(node.geometry.index.count / 3) : Math.round((pos?.count ?? 0) / 3)
    triangles += node instanceof InstancedMesh ? baseTris * node.count : baseTris
    const mats = Array.isArray(node.material) ? node.material : [node.material]
    if (bakeBarkMoss && mats.some(m => Boolean(hasActiveBarkMoss(m)))) mossBakedMeshes++
    if (bakeBarkNormal && Boolean(getSculptBakeInfo(node))) normalBakedMeshes++
    const anyProcBark = mats.some(m => Boolean(isProceduralBarkMaterial(m)))
    if (anyProcBark) {
      hasProceduralBark = true
      if (bakeProceduralBark) proceduralBarkMeshes++
    }
    const anyModeledGrass = mats.some(m => isModeledGrassMesh(node, m))
    if (anyModeledGrass) {
      hasModeledGrass = true
      if (bakeGrassTexture) grassBakedMeshes++
    }
    for (const rawMat of mats) {
      if (!rawMat) continue
      const clean = deduper.get(node, rawMat, mode === 'merged')
      if (!seenMats.has(clean)) {
        seenMats.add(clean)
        const mName = clean.name || 'Material'
        matNames.push(mName)
        const willGetBakedMap = (bakeProceduralBark && Boolean(isProceduralBarkMaterial(rawMat)))
          || (bakeGrassTexture && isModeledGrassMesh(node, rawMat))
        const hasMap = clean instanceof MeshStandardMaterial && Boolean(clean.map || willGetBakedMap)
        const usesVertexColors = clean instanceof MeshStandardMaterial && Boolean(clean.vertexColors)
        if (!hasMap && usesVertexColors) {
          vertexColorOnlyMaterials.push(mName)
        }
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
    proceduralBarkMeshes,
    grassBakedMeshes,
    hasModeledGrass,
    hasProceduralBark,
    vertexColorOnlyMaterials,
    windUvMeshes: exportWindUv ? keptMeshes : 0,
  }
}

export interface StandaloneBarkBakePng {
  name: string
  width: number
  height: number
  normalConvention: NormalMapConvention
  colorDataUrl?: string
  normalDataUrl: string
  aoDataUrl?: string
}

function rgbaBytesToPngDataUrl(bytes: Uint8Array, width: number, height: number): string {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = width; c.height = height
    const ctx = c.getContext('2d')
    if (ctx) {
      const id = ctx.createImageData(width, height)
      id.data.set(bytes)
      ctx.putImageData(id, 0, 0)
      return c.toDataURL('image/png')
    }
  }
  return ''
}

/** Bakes standalone Bark BaseColor / Normal / Cavity AO PNG data URLs for every sculpted OR default procedural trunk in `root`. */
export function extractStandaloneBarkBakePngs(
  root: Object3D,
  options: { size?: BakeResolution; normalConvention?: NormalMapConvention; includeMoss?: boolean } = {},
): StandaloneBarkBakePng[] {
  const size: BakeResolution = options.size === 1024 || options.size === 2048 ? options.size : 512
  const normalConvention: NormalMapConvention = options.normalConvention === 'directx' ? 'directx' : 'opengl'
  const seen = new Set<BufferGeometry>()
  const out: StandaloneBarkBakePng[] = []

  root.traverse(node => {
    if (!(node instanceof Mesh) || seen.has(node.geometry)) return
    const info = getSculptBakeInfo(node)
    const rawMat = Array.isArray(node.material) ? node.material[0] : node.material
    const procUniforms = isProceduralBarkMaterial(rawMat)
    if (!info && !procUniforms) return
    seen.add(node.geometry)
    const baseName = sanitizeMatToken(node.parent?.name || node.name || 'Bark')

    if (info) {
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
      const procColor = procUniforms
        ? bakeProceduralBarkMaps(procUniforms, { size, normalConvention, includeMoss: options.includeMoss ?? true })
        : undefined
      try {
        const urls = bakedBarkMapsToPngDataUrls(baked)
        out.push({
          name: baseName,
          width: baked.width,
          height: baked.height,
          normalConvention,
          ...(procColor ? { colorDataUrl: rgbaBytesToPngDataUrl(procColor.colorBytes, procColor.width, procColor.height) } : {}),
          normalDataUrl: urls.normalDataUrl,
          aoDataUrl: urls.aoDataUrl,
        })
      } finally {
        baked.dispose()
        procColor?.dispose()
      }
      return
    }

    if (procUniforms) {
      const proc = bakeProceduralBarkMaps(procUniforms, { size, normalConvention, includeMoss: options.includeMoss ?? true })
      try {
        out.push({
          name: baseName,
          width: proc.width,
          height: proc.height,
          normalConvention,
          colorDataUrl: rgbaBytesToPngDataUrl(proc.colorBytes, proc.width, proc.height),
          normalDataUrl: rgbaBytesToPngDataUrl(proc.normalBytes, proc.width, proc.height),
        })
      } finally {
        proc.dispose()
      }
    }
  })
  return out
}

/** Non-blocking Worker-accelerated version of `extractStandaloneBarkBakePngs` (keeps UI responsive at 2048²). */
export async function extractStandaloneBarkBakePngsAsync(
  root: Object3D,
  options: { size?: BakeResolution; normalConvention?: NormalMapConvention; includeMoss?: boolean } = {},
): Promise<StandaloneBarkBakePng[]> {
  const size: BakeResolution = options.size === 1024 || options.size === 2048 ? options.size : 512
  const normalConvention: NormalMapConvention = options.normalConvention === 'directx' ? 'directx' : 'opengl'
  const seen = new Set<BufferGeometry>()
  const targets: {
    baseName: string
    info?: ReturnType<typeof getSculptBakeInfo>
    rawMat: Material | undefined
    procUniforms?: ProceduralBarkUniformLike
  }[] = []

  root.traverse(node => {
    if (!(node instanceof Mesh) || seen.has(node.geometry)) return
    const info = getSculptBakeInfo(node)
    const rawMat = Array.isArray(node.material) ? node.material[0] : node.material
    const procUniforms = isProceduralBarkMaterial(rawMat)
    if (!info && !procUniforms) return
    seen.add(node.geometry)
    targets.push({
      baseName: sanitizeMatToken(node.parent?.name || node.name || 'Bark'),
      info,
      rawMat,
      procUniforms,
    })
  })

  const out: StandaloneBarkBakePng[] = []
  for (const t of targets) {
    if (t.info) {
      const barkNormFallback = (t.rawMat?.userData?.barkMap as Texture | undefined)?.userData?.normalMap
      const baseNormalMap = (t.rawMat instanceof MeshStandardMaterial ? t.rawMat.normalMap : undefined)
        ?? (barkNormFallback instanceof Texture ? barkNormFallback : undefined)
      const baked = await bakeSculptedBarkMapsAsync(t.info.trunk, t.info.seed, t.info.detail, {
        size,
        normalConvention,
        heightField: t.info.heightField,
        baseNormalMap: baseNormalMap ?? undefined,
        plan: t.info.plan,
      })
      const procColor = t.procUniforms
        ? bakeProceduralBarkMaps(t.procUniforms, { size, normalConvention, includeMoss: options.includeMoss ?? true })
        : undefined
      try {
        out.push({
          name: t.baseName,
          width: baked.width,
          height: baked.height,
          normalConvention,
          ...(procColor ? { colorDataUrl: rgbaBytesToPngDataUrl(procColor.colorBytes, procColor.width, procColor.height) } : {}),
          normalDataUrl: rgbaBytesToPngDataUrl(baked.normalBytes, baked.width, baked.height),
          aoDataUrl: rgbaBytesToPngDataUrl(baked.aoBytes, baked.width, baked.height),
        })
      } finally {
        baked.dispose()
        procColor?.dispose()
      }
      continue
    }

    if (t.procUniforms) {
      const proc = bakeProceduralBarkMaps(t.procUniforms, { size, normalConvention, includeMoss: options.includeMoss ?? true })
      try {
        out.push({
          name: t.baseName,
          width: proc.width,
          height: proc.height,
          normalConvention,
          colorDataUrl: rgbaBytesToPngDataUrl(proc.colorBytes, proc.width, proc.height),
          normalDataUrl: rgbaBytesToPngDataUrl(proc.normalBytes, proc.width, proc.height),
        })
      } finally {
        proc.dispose()
      }
    }
  }
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
  try {
    const prebakedNormals = await prebakeSculptedBarkMapsAsync(group, options, tempDisposables)
    const prepared = prepareGlbSceneInternal(group, options, tempDisposables, true, prebakedNormals)
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

function sanitizeExportBaseName(raw: string): string {
  const clean = raw.replace(/\.(glb|gltf|fbx|zip)$/i, '').replace(/[^A-Za-z0-9_\-\u4e00-\u9fa5]+/g, '_').replace(/^_+|_+$/g, '')
  return clean ? clean.slice(0, 64) : 'vegetation'
}

/**
 * Exports a split glTF 2.0 bundle: `<baseName>.gltf` + `<baseName>.bin` + `textures/*.png`,
 * separating all BaseColor / Normal / AO / Roughness PNG images into a clean external folder.
 */
export async function exportSplitGltfBundle(
  group: Object3D,
  baseName: string,
  options: ExportGlbOptions = {},
): Promise<ExportBundleResult> {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const cleanBase = sanitizeExportBaseName(baseName)
  activityLog.exportStep(`开始拆分导出 glTF + 贴图（${options.mode === 'separate' ? '独立分体' : '整体合并'}）`, {
    rootName: group.name || '(unnamed)',
    baseName: cleanBase,
    options,
  })
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js')
  const tempDisposables: { dispose(): void }[] = []
  try {
    const prebakedNormals = await prebakeSculptedBarkMapsAsync(group, options, tempDisposables)
    const prepared = prepareGlbSceneInternal(group, options, tempDisposables, true, prebakedNormals)
    const preDiag = inspectPreparedSceneForLog(prepared)
    // 1. Collect every unique texture per material channel, encode to PNG once, and temporarily detach
    //    from materials before GLTFExporter so we never waste CPU base64-encoding & re-decoding images
    //    (and so headless Node/Vitest works identically without DOM canvas!).
    interface SplitMatBinding {
      mat: MeshStandardMaterial
      matName: string
      slots: {
        slot: 'map' | 'normalMap' | 'aoMap' | 'roughnessMap' | 'emissiveMap'
        channel: string
        tex: Texture
      }[]
    }
    const matBindings: SplitMatBinding[] = []
    const seenMat = new Set<Material>()
    const uniqueTexPng = new Map<Texture, { relPath: string; png: Uint8Array; tex: Texture }>()
    const usedPaths = new Set<string>()
    const textureFiles: string[] = []
    const files: ExportArchiveFile[] = []

    const rawSlots: { mat: MeshStandardMaterial; slot: SplitMatBinding['slots'][number]['slot']; channel: string; tex: Texture }[] = []
    prepared.traverse(node => {
      if (!(node instanceof Mesh)) return
      const mats = Array.isArray(node.material) ? node.material : [node.material]
      for (const m of mats) {
        if (!(m instanceof MeshStandardMaterial) || seenMat.has(m)) continue
        seenMat.add(m)
        const binding: SplitMatBinding = { mat: m, matName: m.name || 'Material', slots: [] }
        const candidates: [SplitMatBinding['slots'][number]['slot'], string][] = [
          ['map', 'BaseColor'],
          ['normalMap', 'Normal'],
          ['aoMap', 'AO'],
          ['roughnessMap', 'Roughness'],
          ['emissiveMap', 'Emissive'],
        ]
        for (const [slot, channel] of candidates) {
          const tex = m[slot]
          if (!tex) continue
          binding.slots.push({ slot, channel, tex })
          rawSlots.push({ mat: m, slot, channel, tex })
        }
        if (binding.slots.length) matBindings.push(binding)
      }
    })

    for (const item of rawSlots) {
      if (uniqueTexPng.has(item.tex)) continue
      const png = await textureToPngBytes(item.tex)
      if (!png || png.length < 8) continue
      const hint = `${sanitizeMatToken(item.mat.name || 'Material')}_${item.channel}`
      let relPath = `textures/${hint}.png`
      let dup = 2
      while (usedPaths.has(relPath.toLowerCase())) relPath = `textures/${hint}_${dup++}.png`
      usedPaths.add(relPath.toLowerCase())
      uniqueTexPng.set(item.tex, { relPath, png, tex: item.tex })
      textureFiles.push(relPath)
      files.push({ path: relPath, data: png })
    }

    // Detach textures during GLTFExporter binary pass (avoids FileReader & Base64 overhead!), then split JSON + BIN
    const savedMetalnessMaps = new Map<MeshStandardMaterial, Texture | null>()
    for (const b of matBindings) {
      savedMetalnessMaps.set(b.mat, b.mat.metalnessMap)
      b.mat.metalnessMap = null
      for (const s of b.slots) b.mat[s.slot] = null
    }
    let glbArrayBuf: ArrayBuffer
    try {
      const parsed = await new GLTFExporter().parseAsync(prepared, { binary: true, onlyVisible: false })
      if (!(parsed instanceof ArrayBuffer)) throw new Error('glTF 拆分导出未能生成二进制缓冲区')
      glbArrayBuf = parsed
    } finally {
      for (const b of matBindings) {
        for (const s of b.slots) b.mat[s.slot] = s.tex
        b.mat.metalnessMap = savedMetalnessMaps.get(b.mat) ?? null
      }
    }

    // 2. Unpack GLB header -> Chunk 0 (JSON) + Chunk 1 (raw .bin Uint8Array, zero Base64 round-trip!)
    const dv = new DataView(glbArrayBuf)
    const jsonLen = dv.getUint32(12, true)
    const jsonStr = new TextDecoder('utf-8').decode(new Uint8Array(glbArrayBuf, 20, jsonLen)).trimEnd()
    const rawGltf = JSON.parse(jsonStr) as {
      buffers?: { uri?: string; byteLength: number }[]
      samplers?: { magFilter: number; minFilter: number; wrapS: number; wrapT: number }[]
      images?: { uri: string; mimeType: string; name: string }[]
      textures?: { sampler: number; source: number; name: string }[]
      materials?: {
        name?: string
        pbrMetallicRoughness?: {
          baseColorTexture?: { index: number }
          metallicRoughnessTexture?: { index: number }
          [k: string]: unknown
        }
        normalTexture?: { index: number; scale?: number }
        occlusionTexture?: { index: number; strength?: number }
        emissiveTexture?: { index: number }
      }[]
    }
    const binChunkOffset = 20 + jsonLen
    if (binChunkOffset + 8 <= glbArrayBuf.byteLength) {
      const binLen = dv.getUint32(binChunkOffset, true)
      const binName = `${cleanBase}.bin`
      const binBytes = new Uint8Array(glbArrayBuf.slice(binChunkOffset + 8, binChunkOffset + 8 + binLen))
      files.push({ path: binName, data: binBytes })
      if (rawGltf.buffers && rawGltf.buffers.length > 0) {
        rawGltf.buffers[0].uri = binName
        rawGltf.buffers[0].byteLength = binBytes.byteLength
      }
    }

    // 3. Wire external `textures/*.png` images, samplers, textures & material references cleanly
    if (uniqueTexPng.size > 0) {
      const outSamplers: { magFilter: number; minFilter: number; wrapS: number; wrapT: number }[] = []
      const samplerIndexByKey = new Map<string, number>()
      const outImages: { uri: string; mimeType: string; name: string }[] = []
      const outTextures: { sampler: number; source: number; name: string }[] = []
      const texIndexMap = new Map<Texture, number>()

      const gltfWrap = (w: number) => (w === 1001 ? 33071 : w === 1002 ? 33648 : 10497) // ClampToEdge / MirroredRepeat / Repeat
      for (const [tex, rec] of uniqueTexPng.entries()) {
        const ws = gltfWrap(tex.wrapS)
        const wt = gltfWrap(tex.wrapT)
        const sKey = `${ws}|${wt}`
        let sIdx = samplerIndexByKey.get(sKey)
        if (sIdx === undefined) {
          sIdx = outSamplers.length
          samplerIndexByKey.set(sKey, sIdx)
          outSamplers.push({ magFilter: 9729, minFilter: 9987, wrapS: ws, wrapT: wt })
        }
        const imgIdx = outImages.length
        const cleanLabel = rec.relPath.replace(/^textures\//, '').replace(/\.png$/i, '')
        outImages.push({ uri: rec.relPath, mimeType: 'image/png', name: cleanLabel })
        const tIdx = outTextures.length
        outTextures.push({ sampler: sIdx, source: imgIdx, name: cleanLabel })
        texIndexMap.set(tex, tIdx)
      }

      rawGltf.samplers = outSamplers
      rawGltf.images = outImages
      rawGltf.textures = outTextures

      const gltfMats = rawGltf.materials ?? []
      const usedGltfMatIdx = new Set<number>()
      for (const b of matBindings) {
        let gmIdx = gltfMats.findIndex((gm, idx) => !usedGltfMatIdx.has(idx) && gm.name === b.matName)
        if (gmIdx < 0) gmIdx = gltfMats.findIndex((gm, idx) => !usedGltfMatIdx.has(idx) && (gm.name || '') === b.mat.name)
        if (gmIdx < 0) continue
        usedGltfMatIdx.add(gmIdx)
        const gm = gltfMats[gmIdx]
        for (const s of b.slots) {
          const tIdx = texIndexMap.get(s.tex)
          if (tIdx === undefined) continue
          if (s.slot === 'map') {
            gm.pbrMetallicRoughness = { ...(gm.pbrMetallicRoughness ?? {}), baseColorTexture: { index: tIdx } }
          } else if (s.slot === 'normalMap') {
            gm.normalTexture = { index: tIdx, scale: b.mat.normalScale?.x ?? 1 }
          } else if (s.slot === 'aoMap') {
            gm.occlusionTexture = { index: tIdx, strength: b.mat.aoMapIntensity ?? 1 }
          } else if (s.slot === 'roughnessMap') {
            gm.pbrMetallicRoughness = { ...(gm.pbrMetallicRoughness ?? {}), metallicRoughnessTexture: { index: tIdx } }
          } else if (s.slot === 'emissiveMap') {
            gm.emissiveTexture = { index: tIdx }
          }
        }
      }
    }

    const gltfFilename = `${cleanBase}.gltf`
    const gltfBytes = new TextEncoder().encode(JSON.stringify(rawGltf, null, 2))
    files.unshift({ path: gltfFilename, data: gltfBytes })

    const totalMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started)
    activityLog.exportStep(
      `拆分 glTF + 贴图完成：${files.length} 个文件（${preDiag.meshCount} 网格 · ${preDiag.materials.length} 材质 · ${textureFiles.length} 张外部 PNG · ${totalMs} ms）`,
      { primaryFilename: gltfFilename, files: files.map(f => ({ path: f.path, bytes: f.data.length })) },
    )

    return {
      format: 'gltf-split',
      primaryFilename: gltfFilename,
      files,
      textureFiles,
      meshCount: preDiag.meshCount,
      materialCount: preDiag.materials.length,
      toZipBlob: () => {
        const zip = createZipArchive(files)
        return new Blob([zip as unknown as BlobPart], { type: 'application/zip' })
      },
    }
  } finally {
    for (const d of tempDisposables) d.dispose()
  }
}

/**
 * Exports a real FBX 7.4 Binary + external PNG textures bundle (`<baseName>.fbx` + `textures/*.png`)
 * natively importable in Blender, Unreal Engine, Unity, Maya, and 3ds Max.
 */
export async function exportFbxBundle(
  group: Object3D,
  baseName: string,
  options: ExportGlbOptions = {},
): Promise<ExportBundleResult> {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const cleanBase = sanitizeExportBaseName(baseName)
  activityLog.exportStep(`开始导出 FBX + TEX（${options.mode === 'separate' ? '独立分体' : '整体合并'}）`, {
    rootName: group.name || '(unnamed)',
    baseName: cleanBase,
    options,
  })
  const tempDisposables: { dispose(): void }[] = []
  try {
    const prebakedNormals = await prebakeSculptedBarkMapsAsync(group, options, tempDisposables)
    const prepared = prepareGlbSceneInternal(group, options, tempDisposables, true, prebakedNormals)
    const fbx = await exportSceneToFbxBundle(prepared, cleanBase)
    const totalMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started)
    activityLog.exportStep(
      `FBX + TEX 编码完成：${fbx.files.length} 个文件（${(fbx.fbxBytes.length / 1024).toFixed(1)} KB FBX · ${fbx.meshCount} 网格 · ${fbx.materialCount} 材质 · ${fbx.textureFiles.length} 张外部 PNG · ${totalMs} ms）`,
      { primaryFilename: `${cleanBase}.fbx`, files: fbx.files.map(f => ({ path: f.path, bytes: f.data.length })) },
    )
    return {
      format: 'fbx',
      primaryFilename: `${cleanBase}.fbx`,
      files: fbx.files,
      textureFiles: fbx.textureFiles,
      meshCount: fbx.meshCount,
      materialCount: fbx.materialCount,
      toZipBlob: () => {
        const zip = createZipArchive(fbx.files)
        return new Blob([zip as unknown as BlobPart], { type: 'application/zip' })
      },
    }
  } finally {
    for (const d of tempDisposables) d.dispose()
  }
}
