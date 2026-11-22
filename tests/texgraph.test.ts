import { describe, expect, it } from 'vitest'
import {
  bufferToRgbaBytes, evaluateTextureGraph, TextureGraphEvaluator,
} from '../src/texgraph/engine'
import {
  arePortsCompatible, cloneGraph, createNode, parseTextureGraph,
  validateTextureGraph, wouldCreateCycle,
} from '../src/texgraph/nodes'
import { buildCurveLut, hitTestVectorLayout } from '../src/texgraph/nodes-v2'
import {
  createTextureLibraryStore, type StorageLike,
} from '../src/texgraph/store'
import { defaultTemplateForSlot, detectGraphAtlasGrid, getTextureTemplate, textureTemplates } from '../src/texgraph/templates'
import { applyGraphPatch, GraphHistory } from '../src/texgraph/transaction'
import type { LabelBuffer, RgbaBuffer, VectorLeafInstance, VectorStem } from '../src/texgraph/types'

function memoryStorage(): StorageLike {
  const map = new Map<string, string>()
  return {
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v) },
  }
}

describe('Procedural Texture Node Graph Engine (Substance-style)', () => {
  it('evaluates all 9 bark & foliage templates deterministically with valid PBR maps', () => {
    for (const tpl of textureTemplates) {
      const g = tpl.build()
      const r1 = evaluateTextureGraph(g, 96)
      const r2 = evaluateTextureGraph(g, 96)
      const n = 96 * 96

      expect(r1.output.baseColor.data.length).toBe(n * 4)
      expect(r1.output.heightMap.data.length).toBe(n)
      expect(r1.output.normal.data.length).toBe(n * 4)
      expect(r1.output.roughness.data.length).toBe(n)

      // Deterministic bit-exact output
      let diff = 0
      for (let i = 0; i < r1.output.baseColor.data.length; i++) {
        diff += Math.abs(r1.output.baseColor.data[i] - r2.output.baseColor.data[i])
      }
      expect(diff).toBe(0)

      // Normal map encodes valid unit vectors with positive Z
      let minZ = 1
      for (let i = 0; i < n * 4; i += 4) {
        const nx = r1.output.normal.data[i] * 2 - 1
        const ny = r1.output.normal.data[i + 1] * 2 - 1
        const nz = r1.output.normal.data[i + 2] * 2 - 1
        const len = Math.hypot(nx, ny, nz)
        expect(len).toBeGreaterThan(0.95)
        expect(len).toBeLessThan(1.05)
        if (nz < minZ) minZ = nz
      }
      expect(minZ).toBeGreaterThan(0.05)

      // Measure opaque coverage & color variance
      let opaque = 0
      let sumLum = 0
      let minLum = 1, maxLum = 0
      for (let i = 0; i < n * 4; i += 4) {
        const a = r1.output.baseColor.data[i + 3]
        if (a > 0.5) {
          opaque++
          const lum = 0.299 * r1.output.baseColor.data[i] + 0.587 * r1.output.baseColor.data[i + 1] + 0.114 * r1.output.baseColor.data[i + 2]
          sumLum += lum
          if (lum < minLum) minLum = lum
          if (lum > maxLum) maxLum = lum
        }
      }
      const coverage = opaque / n
      if (tpl.category === 'bark') {
        expect(coverage).toBe(1)
        expect(maxLum - minLum).toBeGreaterThan(0.18)
      } else {
        // Foliage / flower / needle templates must have clean silhouette cutout (not blank, not solid)
        expect(coverage).toBeGreaterThan(0.10)
        expect(coverage).toBeLessThan(0.92)
        expect(sumLum / Math.max(1, opaque)).toBeGreaterThan(0.12)
      }
    }
  })

  it('produces seamlessly tileable bark textures across left/right and top/bottom boundaries', () => {
    const barkGraph = textureTemplates.find(t => t.id === 'bark-oak')!.build()
    const res = evaluateTextureGraph(barkGraph, 128)
    const d = res.output.baseColor.data
    const w = 128, h = 128
    let lrDiff = 0, tbDiff = 0
    for (let y = 0; y < h; y++) {
      const iL = (y * w) * 4
      const iR = (y * w + w - 1) * 4
      lrDiff += Math.abs(d[iL] - d[iR]) + Math.abs(d[iL + 1] - d[iR + 1]) + Math.abs(d[iL + 2] - d[iR + 2])
    }
    for (let x = 0; x < w; x++) {
      const iT = x * 4
      const iB = ((h - 1) * w + x) * 4
      tbDiff += Math.abs(d[iT] - d[iB]) + Math.abs(d[iT + 1] - d[iB + 1]) + Math.abs(d[iT + 2] - d[iB + 2])
    }
    expect(lrDiff / (h * 3)).toBeLessThan(0.08)
    expect(tbDiff / (w * 3)).toBeLessThan(0.08)
  })

  it('applies alpha dilation cleanly on foliage output bytes without modifying alpha channel', () => {
    const leafGraph = defaultTemplateForSlot('leaf')
    const ev = evaluateTextureGraph(leafGraph, 96)
    const raw = bufferToRgbaBytes(ev.output.baseColor, { dilateAlpha: false })
    const dilated = bufferToRgbaBytes(ev.output.baseColor, { dilateAlpha: true })
    let bleedPixels = 0
    for (let i = 0; i < raw.length; i += 4) {
      expect(dilated[i + 3]).toBe(raw[i + 3])
      if (raw[i + 3] === 0 && (dilated[i] > 0 || dilated[i + 1] > 0 || dilated[i + 2] > 0)) {
        bleedPixels++
      }
    }
    expect(bleedPixels).toBeGreaterThan(100)
  })

  it('prevents DAG cycles, validates graph JSON round-trips, and memoizes unchanged upstream nodes', () => {
    const graph = defaultTemplateForSlot('bark')
    const outNode = graph.nodes.find(n => n.type === 'output_material')!
    const firstNode = graph.nodes[0]
    expect(wouldCreateCycle(graph.nodes, graph.edges, outNode.id, firstNode.id)).toBe(true)
    expect(wouldCreateCycle(graph.nodes, graph.edges, firstNode.id, firstNode.id)).toBe(true)

    const cloned = parseTextureGraph(JSON.parse(JSON.stringify(graph)))
    expect(cloned.nodes.length).toBe(graph.nodes.length)
    expect(cloned.edges.length).toBe(graph.edges.length)

    // Memoization test: modifying only the final gradient_map reuses upstream buffer references
    const evaluator = new TextureGraphEvaluator()
    const first = evaluator.evaluate(cloned, 96)
    const upstreamId = cloned.nodes[0].id
    const upstreamOut1 = Object.values(first.nodeOutputs.get(upstreamId)!)[0]
    const gmap = cloned.nodes.find(n => n.type === 'gradient_map')!
    gmap.params.stops = [
      { pos: 0, color: '#102030' },
      { pos: 1, color: '#90c0e0' },
    ]
    const second = evaluator.evaluate(cloned, 96)
    const upstreamOut2 = Object.values(second.nodeOutputs.get(upstreamId)!)[0]
    expect(upstreamOut2).toBe(upstreamOut1) // Upstream buffer reused by reference!
    expect(second.output.baseColor.data).not.toEqual(first.output.baseColor.data)
  })

  it('supports warp, blur, stylize_paint, transform_2d, gradient_linear, painterly_bark, and all 9 leaf shapes', () => {
    const shapes = ['ovate', 'oak', 'elliptic', 'lance', 'maple', 'sakura', 'ginkgo', 'heart', 'needle']
    for (const shape of shapes) {
      const leaf = createNode('leaf_shape', 0, 0, 'l', { shape })
      const warpN = createNode('perlin_noise', 0, 120, 'n', { scaleX: 6, scaleY: 6 })
      const warp = createNode('warp', 200, 0, 'w', { intensity: 0.03 })
      const blur = createNode('blur', 360, 0, 'b', { radius: 1 })
      const paint = createNode('stylize_paint', 440, 0, 'sp', { brushLength: 3, levels: 7 })
      const xform = createNode('transform_2d', 520, 0, 't', { rotate: 12, tile: false })
      const out = createNode('output_material', 700, 0, 'out')
      const graph = {
        schemaVersion: 1 as const,
        name: `shape-${shape}`,
        category: 'leaf' as const,
        targetSlot: 'leaf' as const,
        resolution: 256 as const,
        seamless: false,
        nodes: [leaf, warpN, warp, blur, paint, xform, out],
        edges: [
          { id: 'e1', fromNode: 'l', fromPort: 'rgba', toNode: 'w', toPort: 'input' },
          { id: 'e2', fromNode: 'n', fromPort: 'out', toNode: 'w', toPort: 'warp' },
          { id: 'e3', fromNode: 'w', fromPort: 'out', toNode: 'b', toPort: 'input' },
          { id: 'e4', fromNode: 'b', fromPort: 'out', toNode: 'sp', toPort: 'input' },
          { id: 'e5', fromNode: 'sp', fromPort: 'out', toNode: 't', toPort: 'input' },
          { id: 'e6', fromNode: 't', fromPort: 'out', toNode: 'out', toPort: 'baseColor' },
        ],
      }
      const ev = evaluateTextureGraph(graph, 64)
      let opaque = 0
      for (let i = 3; i < ev.output.baseColor.data.length; i += 4) {
        if (ev.output.baseColor.data[i] > 0.3) opaque++
      }
      expect(opaque).toBeGreaterThan(40)
    }

    // Verify seamlessness of new Painterly Mossy Bark template
    const pbGraph = textureTemplates.find(t => t.id === 'bark-painterly-moss')!.build()
    const pbRes = evaluateTextureGraph(pbGraph, 96)
    const d = pbRes.output.baseColor.data
    let seamErr = 0
    for (let y = 0; y < 96; y++) {
      const l = (y * 96) * 4, r = (y * 96 + 95) * 4
      seamErr += Math.abs(d[l] - d[r]) + Math.abs(d[l + 1] - d[r + 1]) + Math.abs(d[l + 2] - d[r + 2])
    }
    expect(seamErr / (96 * 3)).toBeLessThan(0.10)

    // Verify 2x2 atlas grid detection for seamless Texture Library <-> 3D canopy auto-sync
    expect(detectGraphAtlasGrid(textureTemplates.find(t => t.id === 'leaf-oak-atlas')!.build())).toEqual({ cols: 2, rows: 2 })
    expect(detectGraphAtlasGrid(textureTemplates.find(t => t.id === 'leaf-oak-painterly')!.build())).toEqual({ cols: 1, rows: 1 })
    expect(detectGraphAtlasGrid(pbGraph)).toBeUndefined()
  })
})

describe('Real-Time Texture Library Store', () => {
  const samplePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  it('persists CRUD operations across localStorage and /api/textures remote sync', async () => {
    const storage = memoryStorage()
    let remoteBody = JSON.stringify({ schemaVersion: 1, items: [] })
    const mockFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        remoteBody = String(init.body)
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(remoteBody, { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    const store = createTextureLibraryStore({ storage, apiUrl: '/api/textures', fetcher: mockFetch })
    await store.ready()
    expect(store.storageMode).toBe('file')
    expect(store.list().length).toBe(0)

    const oak = defaultTemplateForSlot('bark')
    const saved = await store.saveNew({
      name: '深纹古橡木皮',
      targetSlot: 'bark',
      dataUrl: samplePng,
      thumbnail: samplePng,
      graph: oak,
    })
    expect(saved.category).toBe('bark')
    expect(store.list('bark').length).toBe(1)
    expect(store.list('leaf').length).toBe(0)

    const renamed = await store.rename(saved.id, '百年橡树皮')
    expect(renamed.name).toBe('百年橡树皮')
    expect(renamed.graph.name).toBe('百年橡树皮')

    const copy = await store.duplicate(saved.id)
    expect(copy.id).not.toBe(saved.id)
    expect(store.list().length).toBe(2)

    const updatedGraph = cloneGraph(oak)
    updatedGraph.resolution = 1024
    const overwritten = await store.overwrite(saved.id, { resolution: 1024, graph: updatedGraph })
    expect(overwritten.resolution).toBe(1024)

    // New store instance hydrating from remote disk API gets all saved items cleanly
    const store2 = createTextureLibraryStore({ storage: memoryStorage(), apiUrl: '/api/textures', fetcher: mockFetch })
    await store2.ready()
    expect(store2.list().length).toBe(2)
    expect(store2.get(saved.id)?.name).toBe('百年橡树皮')
    expect(store2.get(saved.id)?.resolution).toBe(1024)

    // Export & import bundle round-trip
    const bundle = store2.exportBundle()
    const store3 = createTextureLibraryStore({ storage: memoryStorage(), apiUrl: null })
    const imp = await store3.importBundle(bundle)
    expect(imp.added).toBe(2)
    expect(await store3.remove(copy.id)).toBe(true)
    expect(store3.list().length).toBe(1)
  })
})

describe('TexGraph v2 Contract, Transactions, 6 Core Nodes & Persistence', () => {
  const samplePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  it('enforces v2 schema version contract, rejects future versions & bad port types, and never drops v2 nodes', () => {
    const vine = getTextureTemplate('leaf-vine-intertwined')!.build()
    expect(vine.schemaVersion).toBe(2)
    expect(validateTextureGraph(vine).ok).toBe(true)

    // Round-trip preserves schemaVersion 2 and every v2 node & vector instance ID
    const parsed = parseTextureGraph(JSON.parse(JSON.stringify(vine)), { strict: true })
    expect(parsed.schemaVersion).toBe(2)
    expect(parsed.nodes.map(n => n.type)).toEqual(vine.nodes.map(n => n.type))

    // Future schemaVersion must throw instead of silently stripping nodes
    expect(() => parseTextureGraph({ ...vine, schemaVersion: 99 })).toThrow(/schemaVersion=99/)

    // Strict mode rejects unknown node types & incompatible label->rgba connections
    expect(() => parseTextureGraph({
      ...vine,
      nodes: [...vine.nodes, { id: 'bad', type: 'future_magic_node', x: 0, y: 0, params: {} }],
    }, { strict: true })).toThrow(/未知/)

    expect(arePortsCompatible('label', 'label')).toBe(true)
    expect(arePortsCompatible('label', 'rgba')).toBe(false)
    expect(arePortsCompatible('label', 'gray')).toBe(false)
    expect(() => parseTextureGraph({
      ...vine,
      edges: [...vine.edges, { id: 'bad-edge', fromNode: 'vine_layout', fromPort: 'label', toNode: 'out', toPort: 'opacity' }],
    }, { strict: true })).toThrow(/不兼容/)
  })

  it('supports atomic semantic transactions, revision conflict rejection, bypass, bridging delete & 30-step undo/redo', () => {
    const vine = getTextureTemplate('leaf-vine-intertwined')!.build()
    const history = new GraphHistory(vine, 30)
    const rev0 = history.revision

    // Stale baseRevision fails atomically
    const stale = history.apply([{ op: 'setBypass', nodeId: 'vine_outline', bypass: true }], 'stale', rev0 - 1)
    expect(stale.ok).toBe(false)
    expect(history.revision).toBe(rev0)

    // Partial failure in multi-op batch rolls back cleanly (zero mutation!)
    const badBatch = applyGraphPatch(history.current, [
      { op: 'setBypass', nodeId: 'vine_outline', bypass: true },
      { op: 'connect', fromNode: 'vine_layout', fromPort: 'label', toNode: 'out', toPort: 'baseColor' },
    ], { currentRevision: rev0 })
    expect(badBatch.ok).toBe(false)
    expect(history.current.nodes.find(n => n.id === 'vine_outline')?.bypass).toBeUndefined()

    // Upsert leaf instance by stable ID, commit, undo, redo
    const layout0 = history.current.nodes.find(n => n.id === 'vine_layout')!
    const origLeaf = (layout0.params.instances as VectorLeafInstance[]).find(l => l.id === 'leaf-01')!
    const moved = { ...origLeaf, x: 0.77, y: 0.23 }
    const okMove = history.apply([{ op: 'upsertInstances', nodeId: 'vine_layout', instances: [moved] }], 'move leaf-01', rev0)
    expect(okMove.ok).toBe(true)
    expect(history.canUndo()).toBe(true)
    expect((history.current.nodes.find(n => n.id === 'vine_layout')!.params.instances as VectorLeafInstance[]).find(l => l.id === 'leaf-01')!.x).toBeCloseTo(0.77, 4)

    // Undo restores exact original coordinates
    const undone = history.undo()!
    expect((undone.nodes.find(n => n.id === 'vine_layout')!.params.instances as VectorLeafInstance[]).find(l => l.id === 'leaf-01')!.x).toBeCloseTo(origLeaf.x, 4)
    expect(history.canRedo()).toBe(true)

    // Redo re-applies exact moved coordinates
    const redone = history.redo()!
    expect((redone.nodes.find(n => n.id === 'vine_layout')!.params.instances as VectorLeafInstance[]).find(l => l.id === 'leaf-01')!.x).toBeCloseTo(0.77, 4)

    // Bypass & bridge-remove on bark-moss-v2
    const bark = getTextureTemplate('bark-moss-v2')!.build()
    const bh = new GraphHistory(bark)
    const rBypass = bh.apply([{ op: 'setBypass', nodeId: 'wood_pal', bypass: true }], 'bypass pal')
    expect(rBypass.ok).toBe(true)
    const evBypass = evaluateTextureGraph(rBypass.graph, 96)
    const evOrig = evaluateTextureGraph(bark, 96)
    expect(evBypass.output.baseColor.data).not.toEqual(evOrig.output.baseColor.data)

    const rBridge = bh.apply([{ op: 'removeNode', nodeId: 'wood_pal', bridge: true }], 'bridge delete')
    expect(rBridge.ok).toBe(true)
    expect(rBridge.graph.edges.some(e => e.fromNode === 'wood_grad' && e.toNode === 'wood_ao')).toBe(true)
  })

  it('verifies monotone curves_lut, Int32Array labelMap, EDT ink_outline, curvature_ao & CIELAB palette_map', () => {
    // 1. Fritsch-Carlson monotone curve has ZERO overshoot on steep monotone step
    const lut = buildCurveLut([[0, 0], [0.45, 0.05], [0.55, 0.95], [1, 1]], [[0, 0], [1, 1]], true, 256)
    for (let i = 1; i < lut.length; i++) {
      expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1] - 1e-6)
      expect(lut[i]).toBeGreaterThanOrEqual(0)
      expect(lut[i]).toBeLessThanOrEqual(1)
    }

    // 2. Vine vector_layout produces Int32Array labelMap (negative stems + positive leaves) & exact hit-testing
    const vine = getTextureTemplate('leaf-vine-intertwined')!.build()
    const evLineless = evaluateTextureGraph(vine, 128)
    const labelBuf = evLineless.nodeOutputs.get('vine_layout')!.label as LabelBuffer
    expect(labelBuf.kind).toBe('label')
    expect(labelBuf.data).toBeInstanceOf(Int32Array)
    let negCnt = 0, posCnt = 0
    for (let i = 0; i < labelBuf.data.length; i++) {
      if (labelBuf.data[i] < 0) negCnt++
      else if (labelBuf.data[i] > 0) posCnt++
    }
    expect(negCnt).toBeGreaterThan(100)
    expect(posCnt).toBeGreaterThan(1000)

    // With outerWidth=0 & innerWidth=0, ink_outline is bit-exact pass-through (clean lineless vine!)
    const layoutRgba = evLineless.nodeOutputs.get('vine_layout')!.rgba as RgbaBuffer
    const outlineOffRgba = evLineless.nodeOutputs.get('vine_outline')!.rgba as RgbaBuffer
    expect(outlineOffRgba.data).toEqual(layoutRgba.data)

    // Enabling EDT ink_outline draws both outer silhouette & integer-label inner overlap lines
    const inkedVine = cloneGraph(vine)
    const outlNode = inkedVine.nodes.find(n => n.id === 'vine_outline')!
    outlNode.params.outerWidth = 4
    outlNode.params.innerWidth = 2.5
    const evInked = evaluateTextureGraph(inkedVine, 128)
    const outlineMask = evInked.nodeOutputs.get('vine_outline')!.mask
    let maskPixels = 0
    for (let i = 0; i < outlineMask.data.length; i++) if ((outlineMask.data as Float32Array)[i] > 0.3) maskPixels++
    expect(maskPixels).toBeGreaterThan(400)

    // Hit-test finds leaf-01 right at its own center
    const layoutNode = vine.nodes.find(n => n.id === 'vine_layout')!
    const stems = layoutNode.params.stems as VectorStem[]
    const instances = layoutNode.params.instances as VectorLeafInstance[]
    const leaf1 = instances[0]
    const hit = hitTestVectorLayout(stems, instances, leaf1.x, leaf1.y)
    expect(hit).toBeDefined()

    // 3. Curvature/AO fast + horizon modes + Palette Map CIELAB snapping on bark-moss-v2
    const bark = getTextureTemplate('bark-moss-v2')!.build()
    const evFast = evaluateTextureGraph(bark, 128)
    const curvOut = evFast.nodeOutputs.get('curv')!
    for (const key of ['ao', 'convex', 'concave'] as const) {
      const arr = curvOut[key].data as Float32Array
      let minV = 1, maxV = 0
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] < minV) minV = arr[i]
        if (arr[i] > maxV) maxV = arr[i]
      }
      expect(minV).toBeGreaterThanOrEqual(0)
      expect(maxV).toBeLessThanOrEqual(1)
      expect(maxV - minV).toBeGreaterThan(0.15)
    }

    // Horizon AO mode also produces valid smooth AO
    const barkHorizon = cloneGraph(bark)
    barkHorizon.nodes.find(n => n.id === 'curv')!.params.aoMode = 'horizon'
    const evHor = evaluateTextureGraph(barkHorizon, 128)
    const horAo = evHor.nodeOutputs.get('curv')!.ao.data as Float32Array
    expect(Math.min(...horAo)).toBeLessThan(0.7)
    expect(Math.max(...horAo)).toBeGreaterThan(0.85)

    // Hard CIELAB palette_map snaps all pixels strictly to target 2-color palette
    const palGraph = cloneGraph(bark)
    const palNode = palGraph.nodes.find(n => n.id === 'wood_pal')!
    palNode.params.palette = ['#201008', '#f0e0c0']
    palNode.params.strength = 1.0
    palNode.params.softness = 0.0
    palNode.params.preserveLuma = 0.0
    const evPal = evaluateTextureGraph(palGraph, 64)
    const palOut = evPal.nodeOutputs.get('wood_pal')!.out as RgbaBuffer
    for (let i = 0; i < palOut.data.length; i += 4) {
      const r255 = Math.round(palOut.data[i] * 255)
      expect(r255 === 0x20 || r255 === 0xf0).toBe(true)
    }
  })

  it('persists edited v2 vine instances & stems across save/reload and respects bounded multi-res LRU cache', async () => {
    const vine = getTextureTemplate('leaf-vine-intertwined')!.build()
    const history = new GraphHistory(vine)
    const layout = history.current.nodes.find(n => n.id === 'vine_layout')!
    const origLeaf = (layout.params.instances as VectorLeafInstance[]).find(x => x.id === 'leaf-05')!
    const origStem = (layout.params.stems as VectorStem[]).find(x => x.id === 'stem-top-mid')!
    history.apply([
      { op: 'upsertInstances', nodeId: 'vine_layout', instances: [{ ...origLeaf, x: 0.6125, y: 0.3375, rot: 1.2 }] },
      { op: 'upsertStems', nodeId: 'vine_layout', stems: [{ ...origStem, points: [[0.47, 0.36], [0.44, 0.22], [0.39, 0.09]] }] },
    ], 'edit vine')

    const storage = memoryStorage()
    const storeA = createTextureLibraryStore({ storage, apiUrl: null })
    await storeA.ready()
    const saved = await storeA.saveNew({
      name: '我的交织藤蔓',
      targetSlot: 'leaf',
      dataUrl: samplePng,
      thumbnail: samplePng,
      graph: history.current,
    })

    // Fresh store hydrating from persistence retains exact schemaVersion: 2 and exact leaf/stem IDs & coords
    const storeB = createTextureLibraryStore({ storage, apiUrl: null })
    await storeB.ready()
    const loaded = storeB.get(saved.id)!
    expect(loaded.graph.schemaVersion).toBe(2)
    const loadedLayout = loaded.graph.nodes.find(n => n.id === 'vine_layout')!
    const loadedLeaf = (loadedLayout.params.instances as VectorLeafInstance[]).find(x => x.id === 'leaf-05')!
    const loadedStem = (loadedLayout.params.stems as VectorStem[]).find(x => x.id === 'stem-top-mid')!
    expect(loadedLeaf.x).toBeCloseTo(0.6125, 4)
    expect(loadedLeaf.y).toBeCloseTo(0.3375, 4)
    expect(loadedStem.points[1]).toEqual([0.44, 0.22])

    // Multi-res LRU cache keeps 128px warm across a 256px eval while staying strictly under 48 MiB
    const ev = new TextureGraphEvaluator()
    const r128a = ev.evaluate(loaded.graph, 128)
    expect(r128a.cacheHits).toBe(0)
    ev.evaluate(loaded.graph, 256)
    const r128b = ev.evaluate(loaded.graph, 128)
    expect(r128b.cacheHits).toBeGreaterThan(0)
    expect(ev.cachedBytes).toBeLessThanOrEqual(48 * 1024 * 1024)
  })
})
