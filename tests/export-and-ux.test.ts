import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BufferAttribute, DataTexture, Mesh, MeshStandardMaterial, RGBAFormat, SRGBColorSpace,
} from 'three'
import { describe, expect, it } from 'vitest'
import { userPresetsPlugin } from '../scripts/presets-plugin.mjs'
import { userTexturesPlugin } from '../scripts/textures-plugin.mjs'
import {
  exportFbxBundle, exportSplitGltfBundle, inspectGlbExport, prepareGlbScene,
} from '../src/export-glb'
import { createZipArchive, encodeRgbaToPng } from '../src/export-zip'
import { defaultTemplateForSlot } from '../src/texgraph/templates'
import { createTextureLibraryStore } from '../src/texgraph/store'
import { buildTree } from '../src/tree/assemble'
import { presetSpec } from '../src/tree/spec'
import type { TreeTextures } from '../src/tree/assemble'

function dummyTextures(): TreeTextures {
  const mk = (r: number, g: number, b: number, name: string) => {
    const data = new Uint8Array(16 * 16 * 4)
    for (let i = 0; i < 16 * 16; i++) {
      data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255
    }
    const t = new DataTexture(data, 16, 16, RGBAFormat)
    t.colorSpace = SRGBColorSpace
    t.name = name
    t.needsUpdate = true
    return t
  }
  const leaf = mk(110, 185, 92, 'leaf_cluster')
  return {
    leaf, cloud: leaf, sakura: leaf, maple: leaf, willow: leaf, bush: leaf, oakAtlas: leaf, painted: leaf,
    needle: leaf, drape: leaf, grass: leaf, grassTint: leaf, fern: leaf, palm: leaf,
    bamboo: leaf, lotusLeaf: leaf, lotusPetal: leaf, flower: leaf, wildrose: leaf, blossom: leaf,
  }
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 24
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
}

/** Strict structural parser for Kaydara FBX 7.4 Binary verifying header, every node endOffset & child hierarchy. */
function parseFbxBinaryTopNodes(buf: Uint8Array): { version: number; topNames: string[]; allNodeNames: Set<string>; strings: string[] } {
  const magic = new TextDecoder('ascii').decode(buf.subarray(0, 21))
  expect(magic).toBe('Kaydara FBX Binary  \0')
  expect(buf[21]).toBe(0x1a)
  expect(buf[22]).toBe(0x00)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const version = view.getUint32(23, true)
  expect(version).toBe(7400)

  const dec = new TextDecoder('utf-8')
  const topNames: string[] = []
  const allNodeNames = new Set<string>()
  const strings: string[] = []

  function readNode(offset: number, depth: number): number {
    const endOffset = view.getUint32(offset, true)
    const numProps = view.getUint32(offset + 4, true)
    const propListLen = view.getUint32(offset + 8, true)
    const nameLen = buf[offset + 12]
    if (endOffset === 0 && numProps === 0 && propListLen === 0 && nameLen === 0) {
      return 0 // null sentinel
    }
    expect(endOffset).toBeGreaterThan(offset)
    expect(endOffset).toBeLessThanOrEqual(buf.length)
    const name = dec.decode(buf.subarray(offset + 13, offset + 13 + nameLen))
    if (depth === 0) topNames.push(name)
    allNodeNames.add(name)

    let pOff = offset + 13 + nameLen
    const propsEnd = pOff + propListLen
    for (let i = 0; i < numProps; i++) {
      const code = String.fromCharCode(buf[pOff++])
      if (code === 'C') pOff += 1
      else if (code === 'Y') pOff += 2
      else if (code === 'I' || code === 'F') pOff += 4
      else if (code === 'L' || code === 'D') pOff += 8
      else if (code === 'S' || code === 'R') {
        const len = view.getUint32(pOff, true)
        pOff += 4
        if (code === 'S') strings.push(dec.decode(buf.subarray(pOff, pOff + len)))
        pOff += len
      } else if (code === 'i' || code === 'd' || code === 'f' || code === 'l' || code === 'b') {
        const compLen = view.getUint32(pOff + 8, true)
        pOff += 12 + compLen
      } else {
        throw new Error(`Unknown FBX property type: ${code}`)
      }
    }
    expect(pOff).toBe(propsEnd)

    let cOff = propsEnd
    if (cOff < endOffset) {
      while (cOff < endOffset - 13) {
        const nextOff = readNode(cOff, depth + 1)
        if (nextOff === 0) break
        cOff = nextOff
      }
      expect(cOff + 13).toBe(endOffset)
    }
    return endOffset
  }

  let cursor = 27
  while (cursor < buf.length - 13) {
    const next = readNode(cursor, 0)
    if (next === 0) break
    cursor = next
  }
  return { version, topNames, allNodeNames, strings }
}

describe('User Feedback: Click-Only Texture Preview, Fast Switching, Bark/Grass Bake & Split/FBX Export', () => {
  it('Req #1: Texture Library uses click-only preview (no pointerenter/pointerleave hover thrashing)', async () => {
    const src = await readFile(join(process.cwd(), 'src', 'texgraph', 'library-ui.ts'), 'utf8')
    expect(src).not.toContain("'pointerenter'")
    expect(src).not.toContain("'pointerleave'")
    expect(src).not.toContain('tl-hover-cb')
    expect(src).toContain("'click'")
    expect(src).toContain("'dblclick'")
  })

  it('Req #2: Middleware supports ?summary=1, ?scope=, ETag 304, and lazy TextureLibraryStore skips 10MB fetch on boot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'veg-perf-'))
    try {
      const texPlugin = userTexturesPlugin() as unknown as {
        configResolved: (cfg: { root: string }) => void
        configureServer: (srv: { middlewares: { use: (p: string, fn: (req: unknown, res: unknown, next: () => void) => void) => void } }) => void
      }
      texPlugin.configResolved({ root: dir })
      const routes: Record<string, (req: unknown, res: unknown, next: () => void) => void> = {}
      texPlugin.configureServer({ middlewares: { use: (p, fn) => { routes[p] = fn } } })

      const presetPlugin = userPresetsPlugin() as unknown as {
        configResolved: (cfg: { root: string }) => void
        configureServer: (srv: { middlewares: { use: (p: string, fn: (req: unknown, res: unknown, next: () => void) => void) => void } }) => void
      }
      presetPlugin.configResolved({ root: dir })
      presetPlugin.configureServer({ middlewares: { use: (p, fn) => { routes[p] = fn } } })

      const callRoute = async (route: string, method: string, url: string, body?: string, reqHeaders: Record<string, string> = {}) => {
        const req = Object.assign(new EventEmitter(), { method, url, headers: { 'content-type': 'application/json', ...reqHeaders } })
        const headers: Record<string, string> = {}
        const result = new Promise<{ status: number; headers: Record<string, string>; body: string }>(resolve => {
          const res = {
            statusCode: 200,
            setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = String(v) },
            end: (chunk?: unknown) => resolve({ status: res.statusCode, headers, body: chunk ? String(chunk) : '' }),
          }
          routes[route](req, res, () => resolve({ status: 404, headers, body: '' }))
        })
        if (body !== undefined) {
          req.emit('data', Buffer.from(body, 'utf8'))
          req.emit('end')
        }
        return result
      }

      // 1. Seed a large texture and verify ?summary=1 drops Base64 & graph, plus ETag 304 works
      const g = defaultTemplateForSlot('leaf')
      const bigDataUrl = 'data:image/png;base64,' + 'A'.repeat(2048)
      const putTex = await callRoute('/api/textures', 'PUT', '/', JSON.stringify({
        items: [{
          id: 'tex-leaf-1', name: '高模树叶', category: 'leaf', targetSlot: 'leaf', resolution: 512,
          seamless: false, dataUrl: bigDataUrl, thumbnail: bigDataUrl, graph: g,
          createdAt: '2026-11-25T00:00:00Z', updatedAt: '2026-11-25T00:00:00Z',
        }],
      }))
      expect(putTex.status).toBe(200)

      const sumRes = await callRoute('/api/textures', 'GET', '/?summary=1')
      expect(sumRes.status).toBe(200)
      const sumJson = JSON.parse(sumRes.body)
      expect(sumJson.summary).toBe(true)
      expect(sumJson.count).toBe(1)
      expect(sumJson.items[0].dataUrl).toBeUndefined()
      expect(sumRes.body.length).toBeLessThan(300)

      const etag = sumRes.headers.etag
      expect(etag).toBeTruthy()
      const notMod = await callRoute('/api/textures', 'GET', '/?summary=1', undefined, { 'if-none-match': etag })
      expect(notMod.status).toBe(304)

      // 2. Verify lazy TextureLibraryStore boots with ONLY ?summary=1, then hydrates on ensureLoaded()
      const urlsHit: string[] = []
      const lazyStore = createTextureLibraryStore({
        lazy: true,
        storage: null,
        apiUrl: '/api/textures',
        fetcher: (async (url: string | URL | Request) => {
          const u = String(url)
          urlsHit.push(u)
          const r = await callRoute('/api/textures', 'GET', u.replace('/api/textures', '') || '/')
          return new Response(r.body, { status: r.status, headers: r.headers })
        }) as typeof fetch,
      })
      await lazyStore.ready()
      expect(urlsHit).toEqual(['/api/textures?summary=1'])
      expect(lazyStore.count).toBe(1)
      expect(lazyStore.isLoaded).toBe(false)

      await lazyStore.ensureLoaded()
      expect(urlsHit).toEqual(['/api/textures?summary=1', '/api/textures'])
      expect(lazyStore.isLoaded).toBe(true)
      expect(lazyStore.list()).toHaveLength(1)

      // 3. Verify /api/default-presets?scope=rock excludes heavy tree scope
      await callRoute('/api/default-presets', 'PUT', '/', JSON.stringify({
        scope: 'tree', overrides: { 'broadleaf-round': { spec: presetSpec('broadleaf-round'), blob: 'B'.repeat(4000) } },
      }))
      await callRoute('/api/default-presets', 'PUT', '/', JSON.stringify({
        scope: 'rock', overrides: { 'boulder-sand-cap': { seed: 42 } },
      }))
      const rockOnly = await callRoute('/api/default-presets', 'GET', '/?scope=rock')
      expect(rockOnly.status).toBe(200)
      const rockJson = JSON.parse(rockOnly.body)
      expect(rockJson.rock['boulder-sand-cap']).toBeDefined()
      expect(rockJson.tree).toBeUndefined()
      expect(rockOnly.body.length).toBeLessThan(200)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('Req #3: Default procedural bark auto-bakes seamless BaseColor + Normal PNGs and neutralizes wood vertex colors', () => {
    const tex = dummyTextures()
    const spec = presetSpec('broadleaf-round')
    spec.trunk.barkMoss = 0.4
    const built = buildTree(spec, tex)

    const previewWithBake = inspectGlbExport(built.group, {
      mode: 'merged', bakeProceduralBark: true, bakeBarkNormal: true, bakeBarkMoss: true,
    })
    expect(previewWithBake.hasProceduralBark).toBe(true)
    expect(previewWithBake.proceduralBarkMeshes).toBeGreaterThanOrEqual(1)
    expect(previewWithBake.vertexColorOnlyMaterials).not.toContain('Mat_Tree_Bark')

    const glScene = prepareGlbScene(built.group, {
      mode: 'merged', bakeProceduralBark: true, bakeBarkNormal: true, bakeBarkNormalSize: 512,
      bakeBarkNormalConvention: 'opengl', bakeBarkMoss: true,
    })
    const dxScene = prepareGlbScene(built.group, {
      mode: 'merged', bakeProceduralBark: true, bakeBarkNormal: true, bakeBarkNormalSize: 512,
      bakeBarkNormalConvention: 'directx', bakeBarkMoss: true,
    })

    const getBarkMat = (root: typeof glScene) => {
      let found: MeshStandardMaterial | undefined
      root.traverse(o => {
        if (o instanceof Mesh) {
          const mats = Array.isArray(o.material) ? o.material : [o.material]
          for (const m of mats) {
            if (m instanceof MeshStandardMaterial && m.name === 'Mat_Tree_Bark') found = m
          }
        }
      })
      return found
    }

    const barkGl = getBarkMat(glScene)!
    const barkDx = getBarkMat(dxScene)!
    expect(barkGl).toBeDefined()
    expect(barkGl.map).toBeTruthy()
    expect(barkGl.normalMap).toBeTruthy()
    expect(barkGl.map!.colorSpace).toBe(SRGBColorSpace)

    // Verify OpenGL (+Y) vs DirectX (-Y) normal green channel inversion
    const glBytes = (barkGl.normalMap!.userData.rawRgba as { bytes: Uint8Array }).bytes
    const dxBytes = (barkDx.normalMap!.userData.rawRgba as { bytes: Uint8Array }).bytes
    let diffG = 0
    for (let i = 1; i < glBytes.length; i += 4) {
      if (Math.abs(glBytes[i] - dxBytes[i]) > 2) diffG++
    }
    expect(diffG).toBeGreaterThan(1000)

    // Verify wood mesh got synthesized UVs and normalized AO vertex colors (not crushed dark brown)
    let mergedMesh: Mesh | undefined
    glScene.traverse(o => { if (o instanceof Mesh) mergedMesh = o })
    expect(mergedMesh?.geometry.getAttribute('uv')).toBeDefined()
    const col = mergedMesh!.geometry.getAttribute('color') as BufferAttribute
    let maxBright = 0
    for (let i = 0; i < Math.min(400, col.count); i++) {
      maxBright = Math.max(maxBright, col.getX(i), col.getY(i), col.getZ(i))
    }
    expect(maxBright).toBeGreaterThan(0.65)
    built.dispose()
  })

  it('Req #4: Modeled 3D grass flags vertexColorOnly when unbaked, and bakes 64x256 gradient PNG when enabled', () => {
    const built = buildTree(presetSpec('grass-narrow'), dummyTextures())

    const unbakedInfo = inspectGlbExport(built.group, { mode: 'merged', bakeGrassTexture: false })
    expect(unbakedInfo.hasModeledGrass).toBe(true)
    expect(unbakedInfo.vertexColorOnlyMaterials).toContain('Mat_Grass')

    const bakedInfo = inspectGlbExport(built.group, { mode: 'merged', bakeGrassTexture: true })
    expect(bakedInfo.grassBakedMeshes).toBe(1)
    expect(bakedInfo.vertexColorOnlyMaterials).not.toContain('Mat_Grass')

    const prepared = prepareGlbScene(built.group, { mode: 'merged', bakeGrassTexture: true })
    let grassMat: MeshStandardMaterial | undefined
    prepared.traverse(o => {
      if (o instanceof Mesh) {
        const m = Array.isArray(o.material) ? o.material[0] : o.material
        if (m instanceof MeshStandardMaterial) grassMat = m
      }
    })
    expect(grassMat?.map).toBeTruthy()
    const raw = grassMat!.map!.userData.rawRgba as { bytes: Uint8Array; width: number; height: number }
    expect(raw.width).toBe(64)
    expect(raw.height).toBe(256)
    // Tip row (y=4) should be brighter than root row (y=250)
    const tipLum = raw.bytes[(4 * 64 + 32) * 4 + 1]
    const rootLum = raw.bytes[(250 * 64 + 32) * 4 + 1]
    expect(tipLum).toBeGreaterThan(rootLum)
    built.dispose()
  })

  it('Req #5: Exports valid Split glTF + PNGs bundle, real FBX 7.4 Binary + PNGs bundle, and standard PKZIP archive', async () => {
    const prevFileReader = (globalThis as Record<string, unknown>).FileReader
    if (!prevFileReader) {
      ;(globalThis as Record<string, unknown>).FileReader = class NodeFileReader {
        result: ArrayBuffer | null = null
        onloadend: (() => void) | null = null
        readAsArrayBuffer(blob: Blob) {
          blob.arrayBuffer().then(ab => { this.result = ab; this.onloadend?.() })
        }
      }
    }
    const tex = dummyTextures()
    const tree = buildTree(presetSpec('broadleaf-round'), tex)
    const grass = buildTree(presetSpec('grass-narrow'), tex)
    try {

    // A. Split glTF + bin + textures/*.png
    const gltfBundle = await exportSplitGltfBundle(tree.group, 'broadleaf_oak', {
      mode: 'merged', bakeProceduralBark: true, bakeBarkNormal: true, bakeBarkNormalSize: 256 as 512,
    })
    expect(gltfBundle.primaryFilename).toBe('broadleaf_oak.gltf')
    expect(gltfBundle.files.some(f => f.path === 'broadleaf_oak.gltf')).toBe(true)
    expect(gltfBundle.files.some(f => f.path === 'broadleaf_oak.bin')).toBe(true)
    expect(gltfBundle.textureFiles.length).toBeGreaterThanOrEqual(3) // Bark BaseColor + Bark Normal + Leaf BaseColor
    for (const f of gltfBundle.files.filter(x => x.path.startsWith('textures/'))) {
      expect(isPng(f.data)).toBe(true)
    }
    const gltfDoc = JSON.parse(new TextDecoder().decode(gltfBundle.files[0].data))
    expect(gltfDoc.buffers[0].uri).toBe('broadleaf_oak.bin')
    expect(gltfDoc.images.every((im: { uri: string }) => im.uri.startsWith('textures/'))).toBe(true)

    // Verify ZIP archive header & EOCD
    const zipBytes = createZipArchive(gltfBundle.files)
    expect(zipBytes[0]).toBe(0x50) // 'P'
    expect(zipBytes[1]).toBe(0x4b) // 'K'
    expect(zipBytes[2]).toBe(0x03)
    expect(zipBytes[3]).toBe(0x04)
    expect(zipBytes[zipBytes.length - 22]).toBe(0x50)
    expect(zipBytes[zipBytes.length - 21]).toBe(0x4b)
    expect(zipBytes[zipBytes.length - 20]).toBe(0x05)
    expect(zipBytes[zipBytes.length - 19]).toBe(0x06)

    // B. Real FBX 7.4 Binary + textures/*.png on broadleaf tree (with WindUV!)
    const fbxBundle = await exportFbxBundle(tree.group, 'broadleaf_fbx', {
      mode: 'merged', bakeProceduralBark: true, bakeBarkNormal: true, exportWindUv: true,
    })
    expect(fbxBundle.primaryFilename).toBe('broadleaf_fbx.fbx')
    expect(fbxBundle.textureFiles.length).toBeGreaterThanOrEqual(3)
    for (const f of fbxBundle.files.filter(x => x.path.startsWith('textures/'))) {
      expect(isPng(f.data)).toBe(true)
    }
    const parsedFbx = parseFbxBinaryTopNodes(fbxBundle.files[0].data)
    expect(parsedFbx.version).toBe(7400)
    expect(parsedFbx.topNames).toEqual([
      'FBXHeaderExtension', 'GlobalSettings', 'Documents', 'References', 'Definitions', 'Objects', 'Connections',
    ])
    expect(parsedFbx.allNodeNames.has('Geometry')).toBe(true)
    expect(parsedFbx.allNodeNames.has('Model')).toBe(true)
    expect(parsedFbx.allNodeNames.has('Material')).toBe(true)
    expect(parsedFbx.allNodeNames.has('Texture')).toBe(true)
    expect(parsedFbx.allNodeNames.has('Video')).toBe(true)
    expect(parsedFbx.allNodeNames.has('LayerElementNormal')).toBe(true)
    expect(parsedFbx.allNodeNames.has('LayerElementUV')).toBe(true)
    expect(parsedFbx.allNodeNames.has('LayerElementColor')).toBe(true)
    expect(parsedFbx.allNodeNames.has('LayerElementMaterial')).toBe(true)
    expect(parsedFbx.strings).toContain('WindUV')
    expect(parsedFbx.strings).toContain('DiffuseColor')
    expect(parsedFbx.strings).toContain('NormalMap')
    expect(parsedFbx.strings.some(s => s.startsWith('textures/') && s.endsWith('.png'))).toBe(true)

    // C. FBX + TEX on modeled 3D grass with baked 64x256 gradient PNG
    const grassFbx = await exportFbxBundle(grass.group, 'grass_fbx', {
      mode: 'merged', bakeGrassTexture: true,
    })
    expect(grassFbx.textureFiles).toContain('textures/Mat_Grass_BaseColor.png')
    const grassParsed = parseFbxBinaryTopNodes(grassFbx.files[0].data)
    expect(grassParsed.strings).toContain('textures/Mat_Grass_BaseColor.png')

    // D. Pure-TS PNG encoder smoke check
    const pngTest = encodeRgbaToPng(new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]), 2, 2)
    expect(isPng(pngTest)).toBe(true)
    } finally {
      tree.dispose()
      grass.dispose()
      if (!prevFileReader) delete (globalThis as Record<string, unknown>).FileReader
    }
  })
})
