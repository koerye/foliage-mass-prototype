import {
  BufferAttribute, BufferGeometry, Group, Matrix3, Matrix4, Mesh, MeshStandardMaterial,
  Vector3, type Material, type Object3D,
} from 'three'

export interface ExportGlbOptions {
  /** 'merged' = bake transforms & combine into one single multi-material Mesh (distinct material slots
   *  for bark, foliage, flowers, grass, other); 'separate' = preserve independent parts & sub-meshes. */
  mode?: 'merged' | 'separate'
  /** Remove decorative meshes such as ambient petals/particles, stones/rocks, and accessory ground grass under trees. */
  excludeDecorations?: boolean
}

export interface GlbExportPreview {
  meshCount: number
  triangles: number
  materials: string[]
  excludedDecorations: number
}

const PREVIEW_ONLY_ATTRIBUTES = new Set(['leafCenter', 'leafCorner', 'shadeWeight'])
const PREVIEW_ONLY_USERDATA = new Set(['leafUniforms', 'barkUniforms', 'procUniforms', 'barkMap'])

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

function cleanGeometry(src: BufferGeometry): BufferGeometry {
  const out = new BufferGeometry()
  out.name = src.name
  if (src.index) out.setIndex(src.index)
  for (const [name, attr] of Object.entries(src.attributes)) {
    if (PREVIEW_ONLY_ATTRIBUTES.has(name)) continue
    if (name === 'color' && attr instanceof BufferAttribute) {
      out.setAttribute(name, quantizeColorAttribute(attr))
    } else {
      out.setAttribute(name, attr)
    }
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
  return `Mat_Other_${sanitizeMatToken(mat.name || mesh.name || 'Mesh')}`
}

function materialKey(mat: Material, semanticName?: string): string | undefined {
  if (!(mat instanceof MeshStandardMaterial)) return undefined
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
    (mat.userData?.barkMap as { uuid?: string } | undefined)?.uuid ?? '',
    mat.normalMap?.uuid ?? '',
    mat.roughnessMap?.uuid ?? '',
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
        if (clean instanceof MeshStandardMaterial && mat.userData.barkMap && !clean.map) {
          clean.map = mat.userData.barkMap as MeshStandardMaterial['map']
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
  let anyColor = false
  for (const e of entries) {
    const pos = e.geometry.getAttribute('position')
    if (!pos) continue
    totalVerts += pos.count
    totalIndices += e.geometry.index ? e.geometry.index.count : pos.count
    if (e.geometry.getAttribute('uv') || (e.material instanceof MeshStandardMaterial && e.material.map)) anyUv = true
    if (e.geometry.getAttribute('color')) anyColor = true
  }

  const positions = new Float32Array(totalVerts * 3)
  const normals = new Float32Array(totalVerts * 3)
  const colors = anyColor ? new Uint16Array(totalVerts * 3) : undefined
  const uvs = anyUv ? new Float32Array(totalVerts * 2) : undefined
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
      if (anyUv && !uvAttr) uvAttr = synthesizeTriplanarUv(e.geometry)
      const baseVertex = vCursor
      const count = posAttr.count

      for (let i = 0; i < count; i++) {
        v.fromBufferAttribute(posAttr, i).applyMatrix4(e.matrix)
        positions[(vCursor + i) * 3] = v.x
        positions[(vCursor + i) * 3 + 1] = v.y
        positions[(vCursor + i) * 3 + 2] = v.z

        if (normAttr) {
          n.fromBufferAttribute(normAttr, i).applyMatrix3(e.normalMatrix).normalize()
        } else {
          n.set(0, 1, 0)
        }
        normals[(vCursor + i) * 3] = n.x
        normals[(vCursor + i) * 3 + 1] = n.y
        normals[(vCursor + i) * 3 + 2] = n.z

        if (colors) {
          if (colAttr) {
            const isU16 = colAttr.array instanceof Uint16Array && colAttr.normalized
            const isU8 = colAttr.array instanceof Uint8Array && colAttr.normalized
            const r = colAttr.getX(i), g = colAttr.getY(i), b = colAttr.getZ(i)
            colors[(vCursor + i) * 3] = isU16 ? r : isU8 ? Math.round(r * 257) : Math.round(Math.min(1, Math.max(0, r)) * 65535)
            colors[(vCursor + i) * 3 + 1] = isU16 ? g : isU8 ? Math.round(g * 257) : Math.round(Math.min(1, Math.max(0, g)) * 65535)
            colors[(vCursor + i) * 3 + 2] = isU16 ? b : isU8 ? Math.round(b * 257) : Math.round(Math.min(1, Math.max(0, b)) * 65535)
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
  const mode = options.mode ?? 'separate'
  const excludeDecorations = Boolean(options.excludeDecorations)
  const hasTree = excludeDecorations ? hasWoodyTreeInScene(root) : false
  const hasRootAiScene = Boolean(root.userData && 'aiScene' in root.userData)
  const deduper = createMaterialDeduper()

  if (mode === 'merged') {
    root.updateWorldMatrix(true, true)
    const invRoot = root.matrixWorld.clone().invert()
    const entries: MergeEntry[] = []

    root.traverse(node => {
      if (!(node instanceof Mesh)) return
      if (excludeDecorations && isDecorativeNode(node, root, hasTree)) return
      const relMatrix = invRoot.clone().multiply(node.matrixWorld)
      const normalMatrix = new Matrix3().getNormalMatrix(relMatrix)
      const flipWinding = relMatrix.determinant() < 0

      if (Array.isArray(node.material) && node.geometry.groups.length > 0) {
        for (const g of node.geometry.groups) {
          const rawMat = node.material[g.materialIndex ?? 0]
          if (!rawMat) continue
          const mat = deduper.get(node, rawMat, true)
          const sub = cleanGeometry(node.geometry)
          if (sub.index) {
            const slice = sub.index.array.slice(g.start, g.start + g.count)
            sub.setIndex(new BufferAttribute(slice, 1))
          }
          entries.push({ geometry: sub, material: mat, matrix: relMatrix, normalMatrix, flipWinding })
        }
      } else {
        const rawMat = Array.isArray(node.material) ? node.material[0] : node.material
        if (!rawMat) return
        const mat = deduper.get(node, rawMat, true)
        const geo = cleanGeometry(node.geometry)
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
  // and optionally removing decorative meshes/groups.
  const geometryCache = new Map<BufferGeometry, BufferGeometry>()
  const cloneNode = (node: Object3D, isRoot: boolean): Object3D | undefined => {
    if (!isRoot && excludeDecorations && isDecorativeNode(node, root, hasTree)) return undefined
    let copy: Object3D
    if (node instanceof Mesh) {
      const mat = Array.isArray(node.material)
        ? node.material.map(m => deduper.get(node, m, false))
        : deduper.get(node, node.material, false)
      let geo = geometryCache.get(node.geometry)
      if (!geo) {
        geo = cleanGeometry(node.geometry)
        const needsUv = (Array.isArray(mat) ? mat : [mat]).some(m => m instanceof MeshStandardMaterial && Boolean(m.map))
        if (needsUv && !geo.getAttribute('uv')) {
          const fallbackUv = synthesizeTriplanarUv(geo)
          if (fallbackUv) geo.setAttribute('uv', fallbackUv)
        }
        geometryCache.set(node.geometry, geo)
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
  const hasTree = excludeDecorations ? hasWoodyTreeInScene(root) : false
  const deduper = createMaterialDeduper()
  const matNames: string[] = []
  const seenMats = new Set<Material>()
  let keptMeshes = 0
  let excludedDecorations = 0
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
  }
}

export async function exportGlb(group: Object3D, options: ExportGlbOptions = {}) {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js')
  const prepared = prepareGlbScene(group, options)
  const bytes = await new GLTFExporter().parseAsync(prepared, { binary: true, onlyVisible: false })
  if (!(bytes instanceof ArrayBuffer)) throw new Error('GLB 导出未生成二进制文件')
  return new Blob([bytes], { type: 'model/gltf-binary' })
}
