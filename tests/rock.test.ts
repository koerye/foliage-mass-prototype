import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { prepareGlbScene } from '../src/export-glb'
import { buildRockGeometries, buildRockGroup } from '../src/rock/geometry'
import { makeRockMaterial, updateRockMaterialLive } from '../src/rock/material'
import { parseRockSpec, rockPresetIds, rockPresets, rockPresetSpec, type RockPresetId, type RockSpec } from '../src/rock/spec'
import { createDefaultOverrideStore } from '../src/studio/default-overrides'
import { parseSavedTextureMap } from '../src/studio/texture-serialize'

describe('Stylized Rock Studio', () => {
  it('builds all 6 presets deterministically with grounded y>=0, unit normals, valid colors & rockData', () => {
    for (const id of rockPresetIds) {
      const spec = rockPresetSpec(id)
      const mat = makeRockMaterial(spec, 'final')
      const a = buildRockGroup(spec, mat)
      const b = buildRockGroup(spec, mat)

      expect(a.stats.triangles).toBeGreaterThan(40)
      expect(a.stats.triangles).toBe(b.stats.triangles)
      expect(a.stats.stones).toBe(spec.cluster.count)
      expect(a.bounds.min.y).toBeGreaterThanOrEqual(-1e-4)
      expect(a.bounds.max.y).toBeGreaterThan(0.25)

      for (const mesh of a.meshes) {
        const pos = mesh.geometry.getAttribute('position')
        const norm = mesh.geometry.getAttribute('normal')
        const col = mesh.geometry.getAttribute('color')
        const data = mesh.geometry.getAttribute('rockData')
        const uv = mesh.geometry.getAttribute('uv')
        expect(pos && norm && col && data && uv).toBeTruthy()
        for (let i = 0; i < pos.count; i++) {
          expect(Number.isFinite(pos.getX(i))).toBe(true)
          expect(Number.isFinite(pos.getY(i))).toBe(true)
          expect(Number.isFinite(pos.getZ(i))).toBe(true)
          const nl = Math.hypot(norm.getX(i), norm.getY(i), norm.getZ(i))
          expect(nl).toBeGreaterThan(0.98)
          expect(nl).toBeLessThan(1.02)
          expect(col.getX(i)).toBeGreaterThanOrEqual(0)
          expect(col.getX(i)).toBeLessThanOrEqual(1)
        }
      }

      a.dispose()
      b.dispose()
      mat.dispose()
    }
  })

  it('produces crisp low-poly cel facets with bevel edge weights strictly confined to bevel strips', () => {
    const spec = rockPresetSpec('cel-anime-rock')
    const mat = makeRockMaterial(spec, 'final')
    const built = buildRockGroup(spec, mat)
    expect(built.stats.triangles).toBeLessThan(600)

    const data = built.meshes[0].geometry.getAttribute('rockData')
    let zeroFaces = 0
    let bevelFaces = 0
    for (let i = 0; i < data.count; i += 3) {
      const e = Math.max(data.getX(i), data.getX(i + 1), data.getX(i + 2))
      if (e <= 0.01) zeroFaces++
      else bevelFaces++
    }
    expect(zeroFaces).toBeGreaterThan(10)
    expect(bevelFaces).toBeGreaterThan(10)

    built.dispose()
    mat.dispose()
  })

  it('keeps the chipped shoulders and chamfer corners closed across seeds', () => {
    for (const seed of [17, 89, 512, 1199]) {
      const spec = { ...rockPresetSpec('boulder-sand-cap'), seed }
      spec.shape.facetCount = 28
      spec.shape.asymmetry = .9
      const [{ geometry }] = buildRockGeometries(spec).geometries
      const pos = geometry.getAttribute('position')
      const normal = geometry.getAttribute('normal')
      const data = geometry.getAttribute('rockData')
      const shared = new Map<string, { normal: Vector3; tone: number }>()
      const edges = new Map<string, number>()
      for (let i = 0; i < pos.count; i += 3) {
        const keys = [i, i + 1, i + 2].map(index => {
          const key = [pos.getX(index), pos.getY(index), pos.getZ(index)].join(',')
          const n = new Vector3().fromBufferAttribute(normal, index)
          const tone = data.getW(index)
          const existing = shared.get(key)
          if (existing) {
            expect(existing.normal.distanceToSquared(n)).toBeLessThan(1e-10)
            expect(tone).toBe(existing.tone)
          } else shared.set(key, { normal: n, tone })
          return key
        })
        expect(new Set(keys).size).toBe(3)
        for (let j = 0; j < 3; j++) {
          const a = keys[j], b = keys[(j + 1) % 3]
          const directed = `${a}|${b}`
          edges.set(directed, (edges.get(directed) ?? 0) + 1)
        }
      }
      const badEdges = [...edges].filter(([key, count]) => {
        const [a, b] = key.split('|')
        return count !== 1 || edges.get(`${b}|${a}`) !== 1
      })
      expect(badEdges).toEqual([])
      geometry.dispose()
    }
  })

  it('applies Weighted Face Normals responsively to sharpness even at subdivisions=0 in painterly mode', () => {
    const soft = rockPresetSpec('boulder-slab')
    soft.detail.subdivisions = 0
    soft.detail.sharpness = 0.0
    const crisp = rockPresetSpec('boulder-slab')
    crisp.detail.subdivisions = 0
    crisp.detail.sharpness = 1.0
    const gSoft = buildRockGeometries(soft).geometries[0].geometry
    const gCrisp = buildRockGeometries(crisp).geometries[0].geometry
    const nSoft = gSoft.getAttribute('normal')
    const nCrisp = gCrisp.getAttribute('normal')
    expect(nSoft.count).toBe(nCrisp.count)
    let maxDelta = 0
    for (let i = 0; i < nSoft.count; i++) {
      const d = Math.hypot(
        nSoft.getX(i) - nCrisp.getX(i),
        nSoft.getY(i) - nCrisp.getY(i),
        nSoft.getZ(i) - nCrisp.getZ(i),
      )
      if (d > maxDelta) maxDelta = d
    }
    expect(maxDelta).toBeGreaterThan(0.15)
    gSoft.dispose()
    gCrisp.dispose()
  })

  it('round-trips JSON via parseRockSpec with clamping and prepares clean core glTF 2.0 scene', () => {
    const raw = {
      preset: 'rock-cluster',
      seed: 99123,
      style: 'cel',
      shape: { width: 99, height: -5, facetCount: 2, bevel: 10 },
      detail: { subdivisions: 5, chisel: 2 },
      shading: { baseColor: '#8899aa', shadowColor: 'invalid' },
      top: { mode: 'moss', coverage: 0.7 },
      cluster: { count: 4 },
    }
    const parsed = parseRockSpec(raw)
    expect(parsed.shape.width).toBe(4.5)
    expect(parsed.shape.height).toBe(0.35)
    expect(parsed.shape.facetCount).toBe(6)
    expect(parsed.shape.bevel).toBe(0.32)
    expect(parsed.detail.subdivisions).toBe(2)
    expect(parsed.shading.baseColor).toBe('#8899aa')
    expect(parsed.shading.shadowColor).toBe('#3c495e')
    expect(parsed.cluster.count).toBe(4)

    const mat = makeRockMaterial(parsed, 'final')
    updateRockMaterialLive(mat, parsed, 'clay')
    expect(mat.userData.rockUniforms.uViewMode.value).toBe(1)

    const built = buildRockGroup(parsed, mat)
    const prepared = prepareGlbScene(built.group, { mode: 'merged', excludeDecorations: false })
    let exportedMeshes = 0
    let hasRockData = false
    let matName = ''
    prepared.traverse(obj => {
      if ('isMesh' in obj && obj.isMesh) {
        exportedMeshes++
        const m = obj as unknown as { geometry: { getAttribute(n: string): unknown }; material: { name: string; userData?: Record<string, unknown> } }
        if (m.geometry.getAttribute('rockData')) hasRockData = true
        matName = m.material.name
        expect(m.material.userData?.rockUniforms).toBeUndefined()
      }
    })
    expect(exportedMeshes).toBe(1)
    expect(hasRockData).toBe(false)
    expect(matName).toBe('Mat_Stylized_Rock')

    built.dispose()
    mat.dispose()
  })

  it('persists, reloads, and factory-resets default preset overrides cleanly', async () => {
    const memStorage = new Map<string, string>()
    const storage = {
      getItem: (k: string) => memStorage.get(k) ?? null,
      setItem: (k: string, v: string) => { memStorage.set(k, v) },
    }
    let diskDoc: { schemaVersion: number; persisted: boolean; rock: Record<string, unknown>; tree: Record<string, unknown> } = {
      schemaVersion: 1, persisted: false, rock: {}, tree: {},
    }
    const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { scope: 'rock' | 'tree'; overrides: Record<string, unknown> }
        diskDoc = { ...diskDoc, persisted: true, [body.scope]: body.overrides }
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify(diskDoc), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    const store1 = createDefaultOverrideStore<RockPresetId, RockSpec>({
      scope: 'rock',
      validIds: rockPresetIds,
      parse: (raw, id) => ({ ...parseRockSpec(raw), preset: id, name: rockPresets[id].name }),
      storage,
      fetcher,
    })
    await store1.ready()
    expect(store1.has('boulder-sand-cap')).toBe(false)

    const custom = rockPresetSpec('boulder-sand-cap')
    custom.seed = 42424
    custom.shape.width = 2.45
    await store1.save('boulder-sand-cap', custom)
    expect(store1.storageMode).toBe('file')
    expect(store1.has('boulder-sand-cap')).toBe(true)
    expect(store1.get('boulder-sand-cap')?.shape.width).toBe(2.45)

    // Simulate a fresh browser (empty localStorage) hydrating directly from disk API
    const store2 = createDefaultOverrideStore<RockPresetId, RockSpec>({
      scope: 'rock',
      validIds: rockPresetIds,
      parse: (raw, id) => ({ ...parseRockSpec(raw), preset: id, name: rockPresets[id].name }),
      storage: { getItem: () => null, setItem: () => {} },
      fetcher,
    })
    await store2.ready()
    expect(store2.has('boulder-sand-cap')).toBe(true)
    expect(store2.get('boulder-sand-cap')?.seed).toBe(42424)
    expect(store2.get('boulder-sand-cap')?.shape.width).toBe(2.45)

    // Factory reset removes override on disk & locally
    expect(await store2.resetOne('boulder-sand-cap')).toBe(true)
    expect(store2.has('boulder-sand-cap')).toBe(false)
    expect(Object.keys(diskDoc.rock)).toHaveLength(0)

    // parseSavedTextureMap filters unsafe URLs and preserves valid PBR channels
    const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const parsedTex = parseSavedTextureMap({
      leaf: { name: 'oak_leaf', dataUrl: png1x1, normalDataUrl: png1x1, roughnessDataUrl: 'javascript:alert(1)' },
      bark: { name: 'bad', dataUrl: 'http://evil.example/x.png' },
    })
    expect(parsedTex?.leaf?.name).toBe('oak_leaf')
    expect(parsedTex?.leaf?.normalDataUrl).toBe(png1x1)
    expect(parsedTex?.leaf?.roughnessDataUrl).toBeUndefined()
    expect(parsedTex?.bark).toBeUndefined()
  })
})
