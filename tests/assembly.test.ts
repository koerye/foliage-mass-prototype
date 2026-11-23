import { describe, expect, it } from 'vitest'
import { Mesh, Texture } from 'three'
import { buildAssemblyItem, type AssemblySharedTextures } from '../src/assembly/builder'
import { buildAssemblyGround } from '../src/assembly/ground'
import {
  buildBirchMeadowCase, buildBoulderTrailCase, builtInAssemblyCases, curatedAssemblyAssets,
} from '../src/assembly/showcases'
import {
  blankAssemblyScene, detectImportedAssetJson, parseAssemblyScene,
} from '../src/assembly/spec'
import { createAssemblySceneStore } from '../src/assembly/store'
import { rockPresetSpec } from '../src/rock/spec'
import type { StorageLike } from '../src/studio/preset-store'
import { createTextureRegistry } from '../src/studio/texture-slots'
import { presetSpec } from '../src/tree/spec'

function dummySharedTextures(): AssemblySharedTextures {
  const mk = (name: string) => () => { const t = new Texture(); t.name = name; return t }
  const registry = createTextureRegistry({
    bark: mk('bark'), leaf: mk('leaf'), needle: mk('needle'), drape: mk('drape'),
    palm: mk('palm'), grass: mk('grass'), grassTint: mk('grassTint'), fern: mk('fern'),
    flower: mk('flower'), blossom: mk('blossom'), stemLeaf: mk('stemLeaf'),
    sakura: mk('sakura'), cloud: mk('cloud'), oak: mk('oak'), oakAtlas: mk('oakAtlas'),
    maple: mk('maple'), willow: mk('willow'), bush: mk('bush'), wildrose: mk('wildrose'),
  })
  return { registry, barkTemplates: {} }
}

function memoryStorage(): StorageLike {
  const m = new Map<string, string>()
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) } }
}

describe('Scene Assembly Studio — schema, showcases, ground, builder & store', () => {
  it('builds both reference diorama cases completely and round-trips through parseAssemblyScene', async () => {
    const shared = dummySharedTextures()
    expect(builtInAssemblyCases).toHaveLength(2)

    const case1 = buildBirchMeadowCase()
    expect(case1.items.length).toBeGreaterThanOrEqual(12)
    expect(case1.items[0].barkStyle).toBe('birch')

    const case2 = buildBoulderTrailCase()
    expect(case2.items.length).toBeGreaterThanOrEqual(16)
    expect(case2.items.some(i => i.category === 'deadwood')).toBe(true)
    expect(case2.items.filter(i => i.kind === 'rock').length).toBeGreaterThanOrEqual(7)

    // Round-trip JSON serialization
    const parsed1 = parseAssemblyScene(JSON.parse(JSON.stringify(case1)))
    expect(parsed1.items).toHaveLength(case1.items.length)
    expect(parsed1.cameraPreset).toBe('illustration')
    expect(parsed1.items[0].crownStyle).toBe('painted')
    expect(parsed1.items[0].treeForm).toBe('meadow-birch')
    expect(parseAssemblyScene({ ...case1, items: [{ ...case1.items[0], crownStyle: undefined }] }).items[0].crownStyle).toBeUndefined()
    expect(parsed1.ground.pathLayout).toBe('birch-curve')

    // Build ground slabs & every item in both cases cleanly
    for (const sc of [case1, case2]) {
      const ground = buildAssemblyGround(sc.ground)
      expect(ground.group.children.length).toBeGreaterThan(0)
      ground.dispose()
      for (const item of sc.items) {
        const inst = await buildAssemblyItem(item, shared)
        if (item.crownStyle === 'painted') {
          const leaves = inst.content.getObjectByName('Broadleaf sprays') as Mesh
          expect(inst.content.getObjectByName('Leaf cards')).toBeUndefined()
          const { geometry } = leaves
          const normals = geometry.getAttribute('normal')
          expect(normals.count).toBeGreaterThan(100)
          const directions = new Set<number>()
          for (let i = 0; i < normals.count; i++) directions.add(Math.round(normals.getY(i) * 10))
          expect(directions.size).toBeGreaterThan(6)
        }
        expect(inst.triangles).toBeGreaterThan(0)
        expect(Number.isFinite(inst.localMinY)).toBe(true)
        inst.dispose()
      }
    }
    shared.registry.dispose()
  })

  it('supports curated asset catalog & auto-detects imported Tree/Rock/Assembly JSONs', () => {
    expect(curatedAssemblyAssets.length).toBeGreaterThanOrEqual(10)
    const treeRes = detectImportedAssetJson(presetSpec('broadleaf-sakura'))
    expect(treeRes.type).toBe('item')
    if (treeRes.type === 'item') expect(treeRes.item.kind).toBe('tree')

    const rockRes = detectImportedAssetJson(rockPresetSpec('boulder-chiseled'))
    expect(rockRes.type).toBe('item')
    if (rockRes.type === 'item') expect(rockRes.item.kind).toBe('rock')

    const sceneRes = detectImportedAssetJson(blankAssemblyScene('测试空场'))
    expect(sceneRes.type).toBe('assembly')
  })

  it('persists, overwrites, renames, and deletes saved assembly scenes in store', async () => {
    const storage = memoryStorage()
    const store = createAssemblySceneStore({ storage, apiUrl: null })
    await store.ready()

    const c1 = buildBirchMeadowCase()
    const saved = await store.saveNew({
      name: '我的白桦地块',
      itemCount: c1.items.length,
      triangles: 42000,
      thumbnail: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/',
      scene: c1,
    })
    expect(store.list()).toHaveLength(1)
    expect(saved.name).toBe('我的白桦地块')

    const renamed = await store.rename(saved.id, '林间白桦场景 V2')
    expect(renamed.name).toBe('林间白桦场景 V2')

    const reloaded = createAssemblySceneStore({ storage, apiUrl: null })
    await reloaded.ready()
    expect(reloaded.list()[0].name).toBe('林间白桦场景 V2')
    expect(reloaded.list()[0].scene.items).toHaveLength(c1.items.length)

    expect(await store.remove(saved.id)).toBe(true)
    expect(store.list()).toHaveLength(0)
  })
})
