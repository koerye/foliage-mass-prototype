import { describe, expect, it } from 'vitest'
import { Box3, Texture } from 'three'
import { buildTree } from '../src/tree/assemble'
import { lodPresets, optimizeAt, solveForTriangleBudget } from '../src/tree/optimize'
import { presetIds, presetSpec } from '../src/tree/spec'

const textures = { leaf: new Texture(), needle: new Texture(), drape: new Texture(), palm: new Texture(), grass: new Texture(), fern: new Texture() }

describe('mesh optimization & species fixes', () => {
  it.each(presetIds)('%s sits cleanly on or above y = 0 (no trunk root spike)', id => {
    const asset = buildTree(presetSpec(id), textures)
    const wood = asset.group.children.find(m => m.name === 'Trunk and branches')
    if (wood) {
      const box = new Box3().setFromObject(wood)
      expect(box.min.y).toBeGreaterThanOrEqual(-1e-5)
    }
    asset.dispose()
  })

  it.each(['broadleaf-round', 'broadleaf-sakura', 'broadleaf-maple', 'broadleaf-willow', 'conifer-standard', 'palm-tropical', 'shrub-round', 'grass-clump', 'fern', 'flowerbed-stemmed', 'flowerbed-pure'] as const)('%s reduces triangles monotonically across LOD presets', id => {
    const base = presetSpec(id)
    const counts = lodPresets.map(p => {
      const a = buildTree({ ...base, optimize: optimizeAt(p.level) }, textures)
      const tris = a.stats.triangles
      a.dispose()
      return tris
    })
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1])
    // significant savings on trees and shrubs
    if (id !== 'grass-clump' && id !== 'fern' && !id.startsWith('flowerbed')) {
      expect(counts[1]).toBeLessThan(counts[0] * .45)
      expect(counts[3]).toBeLessThan(counts[0] * .2)
    }
  })

  it('auto-solves to hit exact triangle budgets for broadleaf and conifer', () => {
    const broad = solveForTriangleBudget(presetSpec('broadleaf-round'), textures, 4000)
    expect(broad.reached).toBe(true)
    expect(broad.after).toBeLessThanOrEqual(4000)
    expect(broad.after).toBeLessThan(broad.before * .3)

    const con = solveForTriangleBudget(presetSpec('conifer-standard'), textures, 2000)
    expect(con.reached).toBe(true)
    expect(con.after).toBeLessThanOrEqual(2000)
    expect(con.after).toBeLessThan(con.before * .25)
  })

  it('keeps conifer branches inside bare zones even when cullHiddenWood is enabled', () => {
    const base = presetSpec('conifer-standard')
    const opt = { ...optimizeAt(.5), cullHiddenWood: true }
    const noBare = buildTree({ ...base, optimize: opt }, textures)
    const woodNoBare = noBare.group.children.find(m => m.name === 'Trunk and branches') as unknown as { geometry: import('three').BufferGeometry }
    const withBare = buildTree({
      ...base, optimize: opt,
      handles: [{ id: 1, kind: 'bare', anchor: [0, 4.5, 1.0], offset: [0, 0, 0], radius: 2.5 }],
    }, textures)
    const woodBare = withBare.group.children.find(m => m.name === 'Trunk and branches') as unknown as { geometry: import('three').BufferGeometry }
    expect(woodBare.geometry.index!.count).toBeGreaterThan(woodNoBare.geometry.index!.count)
    noBare.dispose(); withBare.dispose()
  })
})
