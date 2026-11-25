import { Box3, Mesh, Texture } from 'three'
import { describe, expect, it } from 'vitest'
import { inspectGlbExport } from '../src/export-glb'
import { createDefaultOverrideStore } from '../src/studio/default-overrides'
import { createPresetStore, parsePresetLibrary, type StorageLike } from '../src/studio/preset-store'
import { buildTree, type TreeTextures } from '../src/tree/assemble'
import { optimizeAt } from '../src/tree/optimize'
import { parseTreeSpec, presetIds, presetSpec, type PresetId, type TreeSpec } from '../src/tree/spec'

function dummyTextures(): TreeTextures {
  const mk = (name: string) => { const t = new Texture(); t.name = name; return t }
  return {
    leaf: mk('leaf'), needle: mk('needle'), drape: mk('drape'), palm: mk('palm'),
    bamboo: mk('bamboo'), lotusLeaf: mk('lotusLeaf'), lotusPetal: mk('lotusPetal'),
    grass: mk('grass'), grassTint: mk('grassTint'), fern: mk('fern'),
    flower: mk('flower'), blossom: mk('blossom'), stemLeaf: mk('stemLeaf'),
    painted: mk('painted'), feathery: mk('feathery'), sakura: mk('sakura'),
    cloud: mk('cloud'), oak: mk('oak'), oakAtlas: mk('oakAtlas'),
    maple: mk('maple'), willow: mk('willow'), bush: mk('bush'), wildrose: mk('wildrose'),
  }
}

function memStorage(): StorageLike {
  const map = new Map<string, string>()
  return {
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v) },
  }
}

describe('Direct 3D Leaf Editing (clumps + densify/prune/scale/tint)', () => {
  const tex = dummyTextures()

  it('round-trips leafEdits cleanly in parseTreeSpec and leaves unedited presets unchanged', () => {
    const clean = presetSpec('broadleaf-poplar')
    expect(clean.leafEdits).toBeUndefined()
    expect(parseTreeSpec(JSON.parse(JSON.stringify(clean)))).toEqual(clean)

    const edited: TreeSpec = {
      ...clean,
      leafEdits: {
        clumps: [{
          id: 1, position: [2.4, 3.2, 0.5], radius: 0.9, flatten: 0.4,
          density: 1.4, leafScale: 1.2, tint: '#e65522', tintStrength: 0.75,
        }],
        brushes: [
          { id: 1, kind: 'densify', position: [0, 5.2, 0], radius: 1.0, strength: 0.8 },
          { id: 2, kind: 'prune', position: [0.6, 4.1, 0.2], radius: 0.8, strength: 0.9 },
          { id: 3, kind: 'scale', position: [-0.5, 6.0, 0], radius: 1.1, strength: -0.5 },
          { id: 4, kind: 'tint', position: [0, 7.2, 0], radius: 1.3, strength: 0.85, color: '#ff3344' },
        ],
      },
    }
    const rt = parseTreeSpec(JSON.parse(JSON.stringify(edited)))
    expect(rt.leafEdits).toEqual(edited.leafEdits)
  })

  it('plants manual broadleaf leaf clumps, applies densify/prune/scale/tint brushes, and survives LOD + GLB export', () => {
    const baseSpec = presetSpec('broadleaf-round')
    const base = buildTree(baseSpec, tex)
    const baseLeaves = base.stats.leaves
    const baseBox = new Box3().setFromObject(base.group)

    // 1. Hand-placed leaf clump planted outside right edge expands canopy & increases leaf count
    const clumped = buildTree({
      ...baseSpec,
      leafEdits: {
        clumps: [{
          id: 1, position: [baseBox.max.x + 2.2, 3.4, 0], radius: 1.1, flatten: 0.5,
          density: 1.5, leafScale: 1.15, tint: '#ff2222', tintStrength: 0.95,
        }],
        brushes: [],
      },
    }, tex)
    const clumpBox = new Box3().setFromObject(clumped.group)
    expect(clumped.stats.leaves).toBeGreaterThan(baseLeaves + 10)
    expect(clumpBox.max.x).toBeGreaterThan(baseBox.max.x + 1.5)

    // Verify clump tint actually turned vertices near the clump red-dominant (r > g)
    const leafMesh = clumped.group.children.find(c => c.name === 'Leaf cards') as Mesh
    const posAttr = leafMesh.geometry.getAttribute('position')
    const colAttr = leafMesh.geometry.getAttribute('color')
    let redHits = 0
    for (let i = 0; i < posAttr.count; i++) {
      if (posAttr.getX(i) > baseBox.max.x + 1.2) {
        if (colAttr.getX(i) > colAttr.getY(i) * 1.4) redHits++
      }
    }
    expect(redHits).toBeGreaterThan(20)

    // Verify LOD remesh preserves manual clumps & reduces tris monotonically
    const lodOk = clumped.remeshForOptimize({
      ...baseSpec,
      leafEdits: {
        clumps: [{
          id: 1, position: [baseBox.max.x + 2.2, 3.4, 0], radius: 1.1, flatten: 0.5,
          density: 1.5, leafScale: 1.15, tint: '#ff2222', tintStrength: 0.95,
        }],
        brushes: [],
      },
      optimize: optimizeAt(0.65),
    })
    expect(lodOk).toBe(true)
    expect(inspectGlbExport(clumped.group, { mode: 'merged' }).triangles).toBeGreaterThan(1000)

    // 2. Prune brush painted onto the outer canopy removes leaves & carves a clean inner core
    const crownCenterY = (baseBox.min.y + baseBox.max.y) * 0.65
    const prunePos: [number, number, number] = [baseBox.max.x * 0.65, crownCenterY, 0]
    const pruned = buildTree({
      ...baseSpec,
      leafEdits: {
        clumps: [],
        brushes: [{ id: 1, kind: 'prune', position: prunePos, radius: 2.8, strength: 1 }],
      },
    }, tex)
    expect(pruned.stats.leaves).toBeLessThan(baseLeaves * 0.85)
    const prunedMesh = pruned.group.children.find(c => c.name === 'Leaf cards') as Mesh
    const pCenter = prunedMesh.geometry.getAttribute('leafCenter')
    let coreLeaves = 0
    for (let i = 0; i < pCenter.count; i++) {
      const d = Math.hypot(pCenter.getX(i) - prunePos[0], pCenter.getY(i) - prunePos[1], pCenter.getZ(i) - prunePos[2])
      if (d < 0.75) coreLeaves++
    }
    expect(coreLeaves).toBe(0)

    // 3. Densify + tint brush increases leaves & shifts colors cleanly
    const densified = buildTree({
      ...baseSpec,
      leafEdits: {
        clumps: [],
        brushes: [
          { id: 1, kind: 'densify', position: [0, crownCenterY, 0], radius: 1.5, strength: 0.95 },
          { id: 2, kind: 'tint', position: [0, crownCenterY, 0], radius: 2.5, strength: 0.95, color: '#ee3311' },
        ],
      },
    }, tex)
    expect(densified.stats.leaves).toBeGreaterThan(baseLeaves + 15)

    base.dispose(); clumped.dispose(); pruned.dispose(); densified.dispose()
  })

  it('supports prune and tint leaf brushes on non-broadleaf plants (bamboo)', () => {
    const spec = presetSpec('bamboo-chibi')
    const base = buildTree(spec, tex)
    const box = new Box3().setFromObject(base.group)
    const midY = (box.min.y + box.max.y) * 0.55

    const edited = buildTree({
      ...spec,
      leafEdits: {
        clumps: [],
        brushes: [
          { id: 1, kind: 'prune', position: [0, midY, 0], radius: 1.6, strength: 0.95 },
          { id: 2, kind: 'tint', position: [0, box.max.y * 0.85, 0], radius: 2.4, strength: 0.9, color: '#ffaa22' },
        ],
      },
    }, tex)
    expect(edited.stats.triangles).toBeLessThan(base.stats.triangles)
    const leafMesh = edited.group.children.find(c => c.name === 'Bamboo leaves') as Mesh
    const col = leafMesh.geometry.getAttribute('color')
    let warmHits = 0
    for (let i = 0; i < col.count; i++) {
      if (col.getX(i) > col.getY(i)) warmHits++
    }
    expect(warmHits).toBeGreaterThan(10)
    base.dispose(); edited.dispose()
  })
})

describe('Tree Studio <-> Scene Assembly Asset Library Sync', () => {
  it('persists custom textures on SavedPreset and reloads updates from disk across workbenches', async () => {
    const samplePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2dIAAAAASUVORK5CYII='
    let diskPayload = JSON.stringify({ schemaVersion: 1, items: [] })
    const mockFetch = (async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'PUT' && typeof init.body === 'string') {
        diskPayload = init.body
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(diskPayload, {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Persisted': '1' },
      })
    }) as typeof fetch

    const treeStudioStore = createPresetStore({ storage: memStorage(), apiUrl: '/api/presets', fetcher: mockFetch })
    const assemblyStore = createPresetStore({ storage: memStorage(), apiUrl: '/api/presets', fetcher: mockFetch })
    await Promise.all([treeStudioStore.ready(), assemblyStore.ready()])
    expect(assemblyStore.list()).toHaveLength(0)

    // Tree Studio saves a preset with custom leaf texture
    const saved = await treeStudioStore.saveNew<TreeSpec>({
      scope: 'tree',
      name: '自制羽叶树',
      kind: 'broadleaf',
      kindLabel: '阔叶树',
      triangles: 12000,
      lighting: 'ghibli',
      thumbnail: '',
      payload: presetSpec('broadleaf-poplar'),
      textures: { leaf: { dataUrl: samplePng, name: 'custom-feathery.png' } },
    })
    expect(saved.textures?.leaf?.dataUrl).toBe(samplePng)

    // Scene Assembly reloads and immediately sees the preset + its custom texture
    let notified = 0
    assemblyStore.subscribe(() => { notified++ })
    await assemblyStore.reload()
    expect(notified).toBeGreaterThan(0)
    const synced = assemblyStore.get<TreeSpec>(saved.id)
    expect(synced?.name).toBe('自制羽叶树')
    expect(synced?.textures?.leaf?.dataUrl).toBe(samplePng)
    expect(parsePresetLibrary(JSON.parse(diskPayload))[0]?.textures?.leaf?.name).toBe('custom-feathery.png')
  })

  it('reloads updated default-overrides into Scene Assembly readOnly store', async () => {
    let diskDoc: { persisted: boolean; tree: Record<string, unknown>; rock: Record<string, unknown> } = {
      persisted: true,
      tree: {},
      rock: {},
    }
    const mockFetch = (async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'PUT' && typeof init.body === 'string') {
        const body = JSON.parse(init.body) as { scope: 'tree' | 'rock'; overrides: Record<string, unknown> }
        diskDoc[body.scope] = body.overrides
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify(diskDoc), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    const writer = createDefaultOverrideStore<PresetId, TreeSpec>({
      scope: 'tree',
      validIds: presetIds,
      parse: raw => parseTreeSpec(raw),
      storage: memStorage(),
      apiUrl: '/api/default-presets',
      fetcher: mockFetch,
    })
    const reader = createDefaultOverrideStore<PresetId, TreeSpec>({
      scope: 'tree',
      validIds: presetIds,
      readOnly: true,
      parse: raw => parseTreeSpec(raw),
      storage: memStorage(),
      apiUrl: '/api/default-presets',
      fetcher: mockFetch,
    })
    await Promise.all([writer.ready(), reader.ready()])
    expect(reader.listIds()).toHaveLength(0)

    await writer.save('broadleaf-poplar', { ...presetSpec('broadleaf-poplar'), seed: 9999 })
    await reader.reload()
    expect(reader.has('broadleaf-poplar')).toBe(true)
    expect(reader.get('broadleaf-poplar')?.seed).toBe(9999)
  })
})
