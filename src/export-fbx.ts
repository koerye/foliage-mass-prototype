// Standards-compliant FBX 7.4 Binary (.fbx) + external PNG textures exporter.
// Produces genuine Kaydara FBX Binary 7400 files natively supported by Blender (io_scene_fbx),
// Unreal Engine, Unity, Maya, and 3ds Max — including multi-material slots, normals, UV0/UV1,
// vertex colors (COLOR_0), hierarchy transforms, and external relative texture paths ("textures/*.png").
import {
  BufferAttribute, DoubleSide, Euler, Material, Matrix4, Mesh, MeshStandardMaterial,
  Object3D, Quaternion, Texture, Vector3,
} from 'three'
import { textureToPngBytes, type ExportArchiveFile } from './export-zip'

type FbxProp =
  | { t: 'C'; v: number }
  | { t: 'Y'; v: number }
  | { t: 'I'; v: number }
  | { t: 'L'; v: number }
  | { t: 'F'; v: number }
  | { t: 'D'; v: number }
  | { t: 'S'; v: string }
  | { t: 'R'; v: Uint8Array }
  | { t: 'i'; v: Int32Array | number[] }
  | { t: 'd'; v: Float64Array | number[] }

interface FbxNode {
  name: string
  props?: FbxProp[]
  children?: FbxNode[]
  /** Force writing empty 13-byte child terminator even when children is empty (FBX spec for container blocks). */
  forceBlock?: boolean
}

const textEnc = new TextEncoder()

const P = {
  C: (v: number): FbxProp => ({ t: 'C', v }),
  Y: (v: number): FbxProp => ({ t: 'Y', v }),
  I: (v: number): FbxProp => ({ t: 'I', v }),
  L: (v: number): FbxProp => ({ t: 'L', v }),
  F: (v: number): FbxProp => ({ t: 'F', v }),
  D: (v: number): FbxProp => ({ t: 'D', v }),
  S: (v: string): FbxProp => ({ t: 'S', v }),
  R: (v: Uint8Array): FbxProp => ({ t: 'R', v }),
  i: (v: Int32Array | number[]): FbxProp => ({ t: 'i', v }),
  d: (v: Float64Array | number[]): FbxProp => ({ t: 'd', v }),
}

function propByteLength(p: FbxProp): number {
  switch (p.t) {
    case 'C': return 2
    case 'Y': return 3
    case 'I': case 'F': return 5
    case 'L': case 'D': return 9
    case 'S': return 5 + textEnc.encode(p.v).length
    case 'R': return 5 + p.v.length
    case 'i': return 13 + p.v.length * 4
    case 'd': return 13 + p.v.length * 8
  }
}

function nodeByteLength(node: FbxNode): number {
  const nameBytes = textEnc.encode(node.name)
  let propsLen = 0
  if (node.props) {
    for (const p of node.props) propsLen += propByteLength(p)
  }
  const hasChildren = Boolean(node.children && node.children.length > 0) || Boolean(node.forceBlock)
  let childrenLen = 0
  if (node.children) {
    for (const c of node.children) childrenLen += nodeByteLength(c)
  }
  return 13 + nameBytes.length + propsLen + (hasChildren ? childrenLen + 13 : 0)
}

function writeInt64LE(view: DataView, offset: number, value: number) {
  // Safe integer up to 2^53 - 1
  const big = BigInt(Math.trunc(value))
  view.setBigInt64(offset, big, true)
}

function writeProp(buf: Uint8Array, view: DataView, offset: number, p: FbxProp): number {
  buf[offset++] = p.t.charCodeAt(0)
  switch (p.t) {
    case 'C':
      buf[offset++] = p.v & 0xff
      return offset
    case 'Y':
      view.setInt16(offset, p.v, true)
      return offset + 2
    case 'I':
      view.setInt32(offset, p.v, true)
      return offset + 4
    case 'F':
      view.setFloat32(offset, p.v, true)
      return offset + 4
    case 'L':
      writeInt64LE(view, offset, p.v)
      return offset + 8
    case 'D':
      view.setFloat64(offset, p.v, true)
      return offset + 8
    case 'S': {
      const bytes = textEnc.encode(p.v)
      view.setUint32(offset, bytes.length, true)
      offset += 4
      buf.set(bytes, offset)
      return offset + bytes.length
    }
    case 'R': {
      view.setUint32(offset, p.v.length, true)
      offset += 4
      buf.set(p.v, offset)
      return offset + p.v.length
    }
    case 'i': {
      const len = p.v.length
      view.setUint32(offset, len, true)
      view.setUint32(offset + 4, 0, true)       // encoding: 0 (raw uncompressed)
      view.setUint32(offset + 8, len * 4, true) // byteLength
      offset += 12
      for (let k = 0; k < len; k++) {
        view.setInt32(offset, p.v[k], true)
        offset += 4
      }
      return offset
    }
    case 'd': {
      const len = p.v.length
      view.setUint32(offset, len, true)
      view.setUint32(offset + 4, 0, true)
      view.setUint32(offset + 8, len * 8, true)
      offset += 12
      for (let k = 0; k < len; k++) {
        view.setFloat64(offset, p.v[k], true)
        offset += 8
      }
      return offset
    }
  }
}

function writeNode(buf: Uint8Array, view: DataView, offset: number, node: FbxNode): number {
  const start = offset
  const nameBytes = textEnc.encode(node.name)
  const props = node.props ?? []
  let propsLen = 0
  for (const p of props) propsLen += propByteLength(p)
  const totalLen = nodeByteLength(node)
  const endOffset = start + totalLen

  view.setUint32(offset, endOffset, true)
  view.setUint32(offset + 4, props.length, true)
  view.setUint32(offset + 8, propsLen, true)
  buf[offset + 12] = nameBytes.length
  offset += 13
  buf.set(nameBytes, offset)
  offset += nameBytes.length

  for (const p of props) {
    offset = writeProp(buf, view, offset, p)
  }

  const hasChildren = Boolean(node.children && node.children.length > 0) || Boolean(node.forceBlock)
  if (node.children) {
    for (const c of node.children) {
      offset = writeNode(buf, view, offset, c)
    }
  }
  if (hasChildren) {
    // 13-byte null sentinel (buffer is zero-initialized)
    offset += 13
  }
  return offset
}

function serializeFbxBinary(topNodes: FbxNode[]): Uint8Array {
  const headerMagic = 'Kaydara FBX Binary  \0'
  const headerLen = 27
  let bodyLen = 0
  for (const n of topNodes) bodyLen += nodeByteLength(n)
  // Top-level 13-byte null sentinel + standard FBX 7400 footer for Autodesk FBX SDK (Maya/UE/Unity) & Blender
  const sentinelLen = 13
  const afterSentinel = headerLen + bodyLen + sentinelLen
  const footerId = new Uint8Array([0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e])
  const footerMagic = new Uint8Array([0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b])
  const afterId = afterSentinel + footerId.length
  const padLen = ((16 - (afterId % 16)) % 16) || 16
  const totalLen = afterId + padLen + 4 + 4 + 120 + footerMagic.length
  const buf = new Uint8Array(totalLen)
  const view = new DataView(buf.buffer)

  for (let i = 0; i < headerMagic.length; i++) buf[i] = headerMagic.charCodeAt(i)
  buf[21] = 0x1a
  buf[22] = 0x00
  view.setUint32(23, 7400, true)

  let offset = headerLen
  for (const n of topNodes) {
    offset = writeNode(buf, view, offset, n)
  }
  offset += sentinelLen
  buf.set(footerId, offset)
  offset += footerId.length + padLen + 4
  view.setUint32(offset, 7400, true)
  offset += 4 + 120
  buf.set(footerMagic, offset)
  return buf
}

function linearToSrgbFloat(lin: number): number {
  const c = lin <= 0 ? 0 : lin >= 1 ? 1 : lin
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

function sanitizeFileBase(raw: string): string {
  const clean = raw.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  return clean ? clean.slice(0, 48) : 'Texture'
}

interface TextureRecord {
  texId: number
  vidId: number
  texName: string
  relPath: string
  tex: Texture
}

interface MaterialRecord {
  matId: number
  name: string
  mat: Material
  diffuseTex?: TextureRecord
  normalTex?: TextureRecord
  aoTex?: TextureRecord
  roughnessTex?: TextureRecord
}

export interface FbxExportBundle {
  fbxBytes: Uint8Array
  files: ExportArchiveFile[]
  textureFiles: string[]
  meshCount: number
  materialCount: number
}

/**
 * Encodes a prepared Three.js Object3D hierarchy (from `prepareGlbScene`) into a real FBX 7.4 Binary
 * file plus external `textures/*.png` files linked via standard relative FBX Video/Texture nodes.
 */
export async function exportSceneToFbxBundle(
  preparedRoot: Object3D,
  baseName: string,
): Promise<FbxExportBundle> {
  preparedRoot.updateMatrixWorld(true)

  let nextId = 1000001
  const allocId = () => nextId++

  const textureFiles: ExportArchiveFile[] = []
  const usedTexPaths = new Set<string>()
  const texMap = new Map<Texture, TextureRecord>()

  async function registerTexture(tex: Texture | null | undefined, matName: string, channel: string): Promise<TextureRecord | undefined> {
    if (!tex) return undefined
    const existing = texMap.get(tex)
    if (existing) return existing
    const png = await textureToPngBytes(tex)
    if (!png || png.length < 8) return undefined
    const base = sanitizeFileBase(`${matName}_${channel}`)
    let relPath = `textures/${base}.png`
    let suffix = 2
    while (usedTexPaths.has(relPath.toLowerCase())) {
      relPath = `textures/${base}_${suffix++}.png`
    }
    usedTexPaths.add(relPath.toLowerCase())
    const rec: TextureRecord = {
      texId: allocId(),
      vidId: allocId(),
      texName: `${base}_${channel}`,
      relPath,
      tex,
    }
    texMap.set(tex, rec)
    textureFiles.push({ path: relPath, data: png })
    return rec
  }

  const matRecords = new Map<Material, MaterialRecord>()
  async function registerMaterial(mat: Material): Promise<MaterialRecord> {
    const existing = matRecords.get(mat)
    if (existing) return existing
    const name = (mat.name || `Material_${matRecords.size + 1}`).trim()
    const rec: MaterialRecord = {
      matId: allocId(),
      name,
      mat,
    }
    matRecords.set(mat, rec)
    if (mat instanceof MeshStandardMaterial) {
      rec.diffuseTex = await registerTexture(mat.map, name, 'BaseColor')
      rec.normalTex = await registerTexture(mat.normalMap, name, 'Normal')
      rec.aoTex = await registerTexture(mat.aoMap, name, 'AO')
      rec.roughnessTex = await registerTexture(mat.roughnessMap, name, 'Roughness')
    }
    return rec
  }

  // Collect all meshes in deterministic traversal order
  const meshes: Mesh[] = []
  preparedRoot.traverse(node => {
    if (node instanceof Mesh && node.geometry.getAttribute('position')) {
      meshes.push(node)
    }
  })

  // Register all materials & textures asynchronously
  const meshMatLists = new Map<Mesh, MaterialRecord[]>()
  for (const mesh of meshes) {
    const rawMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const recs: MaterialRecord[] = []
    for (const m of rawMats) {
      if (m) recs.push(await registerMaterial(m))
    }
    meshMatLists.set(mesh, recs)
  }

  const invRoot = preparedRoot.matrixWorld.clone().invert()
  const relMat = new Matrix4()
  const posV = new Vector3()
  const quat = new Quaternion()
  const scaleV = new Vector3()
  const euler = new Euler()
  const RAD2DEG = 180 / Math.PI

  const objectNodes: FbxNode[] = []
  const connections: FbxNode[] = []

  const p70 = (name: string, type1: string, type2: string, flags: string, ...vals: FbxProp[]): FbxNode => ({
    name: 'P',
    props: [P.S(name), P.S(type1), P.S(type2), P.S(flags), ...vals],
  })

  for (let mi = 0; mi < meshes.length; mi++) {
    const mesh = meshes[mi]
    const geo = mesh.geometry
    const posAttr = geo.getAttribute('position') as BufferAttribute
    const normAttr = geo.getAttribute('normal') as BufferAttribute | undefined
    const uvAttr = geo.getAttribute('uv') as BufferAttribute | undefined
    const uv1Attr = geo.getAttribute('uv1') as BufferAttribute | undefined
    const colAttr = geo.getAttribute('color') as BufferAttribute | undefined
    const idxAttr = geo.index

    const vCount = posAttr.count
    const vertices = new Float64Array(vCount * 3)
    for (let i = 0; i < vCount; i++) {
      vertices[i * 3] = posAttr.getX(i)
      vertices[i * 3 + 1] = posAttr.getY(i)
      vertices[i * 3 + 2] = posAttr.getZ(i)
    }

    const triCount = idxAttr ? Math.floor(idxAttr.count / 3) : Math.floor(vCount / 3)
    const polyIdx = new Int32Array(triCount * 3)
    for (let t = 0; t < triCount; t++) {
      const a = idxAttr ? idxAttr.getX(t * 3) : t * 3
      const b = idxAttr ? idxAttr.getX(t * 3 + 1) : t * 3 + 1
      const c = idxAttr ? idxAttr.getX(t * 3 + 2) : t * 3 + 2
      polyIdx[t * 3] = a
      polyIdx[t * 3 + 1] = b
      polyIdx[t * 3 + 2] = -(c + 1) // FBX polygon terminator
    }

    const geoId = allocId()
    const modelId = allocId()
    const meshName = (mesh.name || `Mesh_${mi + 1}`).replace(/\0/g, '')
    const mats = meshMatLists.get(mesh) ?? []

    const geoChildren: FbxNode[] = [
      { name: 'Vertices', props: [P.d(vertices)] },
      { name: 'PolygonVertexIndex', props: [P.i(polyIdx)] },
      { name: 'GeometryVersion', props: [P.I(124)] },
    ]
    const layerElements: FbxNode[] = []

    if (normAttr) {
      const normals = new Float64Array(vCount * 3)
      for (let i = 0; i < vCount; i++) {
        normals[i * 3] = normAttr.getX(i)
        normals[i * 3 + 1] = normAttr.getY(i)
        normals[i * 3 + 2] = normAttr.getZ(i)
      }
      geoChildren.push({
        name: 'LayerElementNormal',
        props: [P.I(0)],
        children: [
          { name: 'Version', props: [P.I(101)] },
          { name: 'Name', props: [P.S('')] },
          { name: 'MappingInformationType', props: [P.S('ByVertice')] },
          { name: 'ReferenceInformationType', props: [P.S('Direct')] },
          { name: 'Normals', props: [P.d(normals)] },
        ],
      })
      layerElements.push({
        name: 'LayerElement',
        children: [
          { name: 'Type', props: [P.S('LayerElementNormal')] },
          { name: 'TypedIndex', props: [P.I(0)] },
        ],
      })
    }

    if (uvAttr) {
      const uvs = new Float64Array(vCount * 2)
      for (let i = 0; i < vCount; i++) {
        uvs[i * 2] = uvAttr.getX(i)
        uvs[i * 2 + 1] = uvAttr.getY(i)
      }
      geoChildren.push({
        name: 'LayerElementUV',
        props: [P.I(0)],
        children: [
          { name: 'Version', props: [P.I(101)] },
          { name: 'Name', props: [P.S('UVMap')] },
          { name: 'MappingInformationType', props: [P.S('ByVertice')] },
          { name: 'ReferenceInformationType', props: [P.S('Direct')] },
          { name: 'UV', props: [P.d(uvs)] },
        ],
      })
      layerElements.push({
        name: 'LayerElement',
        children: [
          { name: 'Type', props: [P.S('LayerElementUV')] },
          { name: 'TypedIndex', props: [P.I(0)] },
        ],
      })
    }

    if (uv1Attr) {
      const uv1s = new Float64Array(vCount * 2)
      for (let i = 0; i < vCount; i++) {
        uv1s[i * 2] = uv1Attr.getX(i)
        uv1s[i * 2 + 1] = uv1Attr.getY(i)
      }
      geoChildren.push({
        name: 'LayerElementUV',
        props: [P.I(1)],
        children: [
          { name: 'Version', props: [P.I(101)] },
          { name: 'Name', props: [P.S('WindUV')] },
          { name: 'MappingInformationType', props: [P.S('ByVertice')] },
          { name: 'ReferenceInformationType', props: [P.S('Direct')] },
          { name: 'UV', props: [P.d(uv1s)] },
        ],
      })
      layerElements.push({
        name: 'LayerElement',
        children: [
          { name: 'Type', props: [P.S('LayerElementUV')] },
          { name: 'TypedIndex', props: [P.I(1)] },
        ],
      })
    }

    if (colAttr) {
      const cols = new Float64Array(vCount * 4)
      for (let i = 0; i < vCount; i++) {
        cols[i * 4] = linearToSrgbFloat(colAttr.getX(i))
        cols[i * 4 + 1] = linearToSrgbFloat(colAttr.getY(i))
        cols[i * 4 + 2] = linearToSrgbFloat(colAttr.getZ(i))
        cols[i * 4 + 3] = 1.0
      }
      geoChildren.push({
        name: 'LayerElementColor',
        props: [P.I(0)],
        children: [
          { name: 'Version', props: [P.I(101)] },
          { name: 'Name', props: [P.S('Col')] },
          { name: 'MappingInformationType', props: [P.S('ByVertice')] },
          { name: 'ReferenceInformationType', props: [P.S('Direct')] },
          { name: 'Colors', props: [P.d(cols)] },
        ],
      })
      layerElements.push({
        name: 'LayerElement',
        children: [
          { name: 'Type', props: [P.S('LayerElementColor')] },
          { name: 'TypedIndex', props: [P.I(0)] },
        ],
      })
    }

    if (mats.length > 0) {
      if (mats.length === 1 || geo.groups.length === 0) {
        geoChildren.push({
          name: 'LayerElementMaterial',
          props: [P.I(0)],
          children: [
            { name: 'Version', props: [P.I(101)] },
            { name: 'Name', props: [P.S('')] },
            { name: 'MappingInformationType', props: [P.S('AllSame')] },
            { name: 'ReferenceInformationType', props: [P.S('IndexToDirect')] },
            { name: 'Materials', props: [P.i([0])] },
          ],
        })
      } else {
        const polyMats = new Int32Array(triCount)
        for (const g of geo.groups) {
          const mIdx = Math.max(0, Math.min(mats.length - 1, g.materialIndex ?? 0))
          const startTri = Math.floor(g.start / 3)
          const endTri = Math.min(triCount, Math.floor((g.start + g.count) / 3))
          for (let t = startTri; t < endTri; t++) polyMats[t] = mIdx
        }
        geoChildren.push({
          name: 'LayerElementMaterial',
          props: [P.I(0)],
          children: [
            { name: 'Version', props: [P.I(101)] },
            { name: 'Name', props: [P.S('')] },
            { name: 'MappingInformationType', props: [P.S('ByPolygon')] },
            { name: 'ReferenceInformationType', props: [P.S('IndexToDirect')] },
            { name: 'Materials', props: [P.i(polyMats)] },
          ],
        })
      }
      layerElements.push({
        name: 'LayerElement',
        children: [
          { name: 'Type', props: [P.S('LayerElementMaterial')] },
          { name: 'TypedIndex', props: [P.I(0)] },
        ],
      })
    }

    geoChildren.push({
      name: 'Layer',
      props: [P.I(0)],
      children: [{ name: 'Version', props: [P.I(100)] }, ...layerElements],
    })

    objectNodes.push({
      name: 'Geometry',
      props: [P.L(geoId), P.S(`${meshName}\0\x01Geometry`), P.S('Mesh')],
      children: geoChildren,
    })

    // Decompose transform relative to preparedRoot
    relMat.multiplyMatrices(invRoot, mesh.matrixWorld)
    relMat.decompose(posV, quat, scaleV)
    euler.setFromQuaternion(quat, 'XYZ')

    const isDoubleSided = mats.some(m => m.mat.side === DoubleSide)
    objectNodes.push({
      name: 'Model',
      props: [P.L(modelId), P.S(`${meshName}\0\x01Model`), P.S('Mesh')],
      children: [
        { name: 'Version', props: [P.I(232)] },
        {
          name: 'Properties70',
          children: [
            p70('Lcl Translation', 'Lcl Translation', '', 'A', P.D(posV.x), P.D(posV.y), P.D(posV.z)),
            p70('Lcl Rotation', 'Lcl Rotation', '', 'A', P.D(euler.x * RAD2DEG), P.D(euler.y * RAD2DEG), P.D(euler.z * RAD2DEG)),
            p70('Lcl Scaling', 'Lcl Scaling', '', 'A', P.D(scaleV.x), P.D(scaleV.y), P.D(scaleV.z)),
            p70('DefaultAttributeIndex', 'int', 'Integer', '', P.I(0)),
          ],
        },
        { name: 'Shading', props: [P.C(1)] },
        { name: 'Culling', props: [P.S(isDoubleSided ? 'CullingOff' : 'CullingOn')] },
      ],
    })

    // Connect Model -> Scene Root (0), Geometry -> Model, Materials -> Model
    connections.push({ name: 'C', props: [P.S('OO'), P.L(modelId), P.L(0)] })
    connections.push({ name: 'C', props: [P.S('OO'), P.L(geoId), P.L(modelId)] })
    for (const m of mats) {
      connections.push({ name: 'C', props: [P.S('OO'), P.L(m.matId), P.L(modelId)] })
    }
  }

  // Emit Materials
  for (const rec of matRecords.values()) {
    const std = rec.mat instanceof MeshStandardMaterial ? rec.mat : undefined
    const col = std ? std.color : { r: 1, g: 1, b: 1 }
    const rough = std ? std.roughness : 0.85
    const shininess = Math.max(2, Math.round((1 - rough) * 64))
    const opacity = std ? std.opacity : 1.0
    objectNodes.push({
      name: 'Material',
      props: [P.L(rec.matId), P.S(`${rec.name}\0\x01Material`), P.S('')],
      children: [
        { name: 'Version', props: [P.I(102)] },
        { name: 'ShadingModel', props: [P.S('phong')] },
        { name: 'MultiLayer', props: [P.I(0)] },
        {
          name: 'Properties70',
          children: [
            p70('DiffuseColor', 'Color', '', 'A', P.D(linearToSrgbFloat(col.r)), P.D(linearToSrgbFloat(col.g)), P.D(linearToSrgbFloat(col.b))),
            p70('DiffuseFactor', 'Number', '', 'A', P.D(1.0)),
            p70('AmbientColor', 'Color', '', 'A', P.D(0.05), P.D(0.05), P.D(0.05)),
            p70('SpecularColor', 'Color', '', 'A', P.D(0.15), P.D(0.15), P.D(0.15)),
            p70('SpecularFactor', 'Number', '', 'A', P.D(Math.max(0.05, 1 - rough))),
            p70('ShininessExponent', 'Number', '', 'A', P.D(shininess)),
            p70('Opacity', 'Number', '', 'A', P.D(opacity)),
            p70('TransparencyFactor', 'Number', '', 'A', P.D(1 - opacity)),
          ],
        },
      ],
    })
    if (rec.diffuseTex) {
      connections.push({ name: 'C', props: [P.S('OP'), P.L(rec.diffuseTex.texId), P.L(rec.matId), P.S('DiffuseColor')] })
    }
    if (rec.normalTex) {
      connections.push({ name: 'C', props: [P.S('OP'), P.L(rec.normalTex.texId), P.L(rec.matId), P.S('NormalMap')] })
    }
    if (rec.aoTex) {
      connections.push({ name: 'C', props: [P.S('OP'), P.L(rec.aoTex.texId), P.L(rec.matId), P.S('AmbientColor')] })
    }
    if (rec.roughnessTex) {
      connections.push({ name: 'C', props: [P.S('OP'), P.L(rec.roughnessTex.texId), P.L(rec.matId), P.S('ShininessExponent')] })
    }
  }

  // Emit Textures & Videos
  for (const tr of texMap.values()) {
    objectNodes.push({
      name: 'Video',
      props: [P.L(tr.vidId), P.S(`${tr.texName}\0\x01Video`), P.S('Clip')],
      children: [
        { name: 'Type', props: [P.S('Clip')] },
        {
          name: 'Properties70',
          children: [p70('Path', 'KString', 'XRefUrl', '', P.S(tr.relPath))],
        },
        { name: 'UseMipMap', props: [P.I(0)] },
        { name: 'Filename', props: [P.S(tr.relPath)] },
        { name: 'RelativeFilename', props: [P.S(tr.relPath)] },
      ],
    })
    objectNodes.push({
      name: 'Texture',
      props: [P.L(tr.texId), P.S(`${tr.texName}\0\x01Texture`), P.S('')],
      children: [
        { name: 'Type', props: [P.S('TextureVideoClip')] },
        { name: 'Version', props: [P.I(202)] },
        { name: 'TextureName', props: [P.S(`${tr.texName}\0\x01Texture`)] },
        {
          name: 'Properties70',
          children: [
            p70('UVSet', 'KString', '', '', P.S('UVMap')),
            p70('UseMaterial', 'bool', '', '', P.I(1)),
          ],
        },
        { name: 'Media', props: [P.S(`${tr.texName}\0\x01Video`)] },
        { name: 'FileName', props: [P.S(tr.relPath)] },
        { name: 'RelativeFilename', props: [P.S(tr.relPath)] },
        { name: 'ModelUVTranslation', props: [P.D(0), P.D(0)] },
        { name: 'ModelUVScaling', props: [P.D(1), P.D(1)] },
        { name: 'Texture_Alpha_Source', props: [P.S('None')] },
        { name: 'Cropping', props: [P.I(0), P.I(0), P.I(0), P.I(0)] },
      ],
    })
    connections.push({ name: 'C', props: [P.S('OO'), P.L(tr.vidId), P.L(tr.texId)] })
  }

  const now = new Date()
  const topNodes: FbxNode[] = [
    {
      name: 'FBXHeaderExtension',
      children: [
        { name: 'FBXHeaderVersion', props: [P.I(1003)] },
        { name: 'FBXVersion', props: [P.I(7400)] },
        { name: 'EncryptionType', props: [P.I(0)] },
        {
          name: 'CreationTimeStamp',
          children: [
            { name: 'Version', props: [P.I(1000)] },
            { name: 'Year', props: [P.I(now.getUTCFullYear())] },
            { name: 'Month', props: [P.I(now.getUTCMonth() + 1)] },
            { name: 'Day', props: [P.I(now.getUTCDate())] },
            { name: 'Hour', props: [P.I(now.getUTCHours())] },
            { name: 'Minute', props: [P.I(now.getUTCMinutes())] },
            { name: 'Second', props: [P.I(now.getUTCSeconds())] },
            { name: 'Millisecond', props: [P.I(now.getUTCMilliseconds())] },
          ],
        },
        { name: 'Creator', props: [P.S('Vegetation Studio FBX 7.4 Exporter')] },
      ],
    },
    {
      name: 'GlobalSettings',
      children: [
        { name: 'Version', props: [P.I(1000)] },
        {
          name: 'Properties70',
          children: [
            p70('UpAxis', 'int', 'Integer', '', P.I(1)),
            p70('UpAxisSign', 'int', 'Integer', '', P.I(1)),
            p70('FrontAxis', 'int', 'Integer', '', P.I(2)),
            p70('FrontAxisSign', 'int', 'Integer', '', P.I(1)),
            p70('CoordAxis', 'int', 'Integer', '', P.I(0)),
            p70('CoordAxisSign', 'int', 'Integer', '', P.I(1)),
            p70('OriginalUpAxis', 'int', 'Integer', '', P.I(1)),
            p70('OriginalUpAxisSign', 'int', 'Integer', '', P.I(1)),
            // 100 cm = 1.0 meter so Three.js meter coordinates import 1:1 in Blender / UE / Unity
            p70('UnitScaleFactor', 'double', 'Number', '', P.D(100.0)),
            p70('OriginalUnitScaleFactor', 'double', 'Number', '', P.D(100.0)),
          ],
        },
      ],
    },
    {
      name: 'Documents',
      children: [
        { name: 'Count', props: [P.I(1)] },
        {
          name: 'Document',
          props: [P.L(1000000), P.S(''), P.S('Scene')],
          children: [
            {
              name: 'Properties70',
              children: [p70('SourceObject', 'object', '', '')],
            },
            { name: 'RootNode', props: [P.L(0)] },
          ],
        },
      ],
    },
    { name: 'References', forceBlock: true },
    {
      name: 'Definitions',
      children: [
        { name: 'Version', props: [P.I(100)] },
        { name: 'Count', props: [P.I(1 + meshes.length * 2 + matRecords.size + texMap.size * 2)] },
        { name: 'ObjectType', props: [P.S('GlobalSettings')], children: [{ name: 'Count', props: [P.I(1)] }] },
        ...(meshes.length ? [
          { name: 'ObjectType', props: [P.S('Geometry')], children: [{ name: 'Count', props: [P.I(meshes.length)] }] },
          { name: 'ObjectType', props: [P.S('Model')], children: [{ name: 'Count', props: [P.I(meshes.length)] }] },
        ] : []),
        ...(matRecords.size ? [
          { name: 'ObjectType', props: [P.S('Material')], children: [{ name: 'Count', props: [P.I(matRecords.size)] }] },
        ] : []),
        ...(texMap.size ? [
          { name: 'ObjectType', props: [P.S('Texture')], children: [{ name: 'Count', props: [P.I(texMap.size)] }] },
          { name: 'ObjectType', props: [P.S('Video')], children: [{ name: 'Count', props: [P.I(texMap.size)] }] },
        ] : []),
      ],
    },
    { name: 'Objects', children: objectNodes, forceBlock: true },
    { name: 'Connections', children: connections, forceBlock: true },
  ]

  const fbxBytes = serializeFbxBinary(topNodes)
  const cleanBase = sanitizeFileBase(baseName || 'vegetation')
  const fbxFilename = `${cleanBase}.fbx`
  const files: ExportArchiveFile[] = [
    { path: fbxFilename, data: fbxBytes },
    ...textureFiles,
  ]

  return {
    fbxBytes,
    files,
    textureFiles: textureFiles.map(f => f.path),
    meshCount: meshes.length,
    materialCount: matRecords.size,
  }
}
