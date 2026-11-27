import { describe, expect, it } from 'vitest'
import {
  createPresetStore,
  mergePresetLists,
  parsePresetItem,
  parsePresetLibrary,
  type StorageLike,
} from '../src/studio/preset-store'
import { presetSpec, type TreeSpec } from '../src/tree/spec'
import { aiShowcases, sakuraBonsaiShowcase } from '../src/ai/showcase'
import { createHiddenShowcaseStore } from '../src/ai/showcase-store'
import type { AiSceneSpec } from '../src/ai/scene'
import { createDefaultOverrideStore } from '../src/studio/default-overrides'
import { createAssemblySceneStore } from '../src/assembly/store'
import { blankAssemblyScene, defaultPolyCRockSpec, type PolyCRockSpec } from '../src/assembly/spec'
import { rockPresetSpec, type RockSpec } from '../src/rock/spec'

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: k => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v) },
  }
}

const VALID_THUMB = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/'

describe('preset-store', () => {
  it('supports saveNew, overwrite, rename, remove, scope filtering, and deep-clone isolation', async () => {
    const storage = memoryStorage()
    const store = createPresetStore({ storage, apiUrl: null })
    await store.ready()

    const treeInput = presetSpec('broadleaf-sakura')
    treeInput.trunk.height = 7.2
    const savedTree = await store.saveNew({
      scope: 'tree',
      name: '  樱花老树  ',
      kind: 'broadleaf',
      kindLabel: '阔叶树',
      triangles: 4820,
      lighting: 'sakura',
      thumbnail: VALID_THUMB,
      payload: treeInput,
    })

    // Mutating caller object must not mutate stored preset
    treeInput.trunk.height = 1.0
    expect(store.get<TreeSpec>(savedTree.id)?.payload.trunk.height).toBe(7.2)
    expect(savedTree.name).toBe('樱花老树')
    expect(savedTree.payload.name).toBe('樱花老树')
    expect(savedTree.thumbnail).toBe(VALID_THUMB)

    const aiScene = sakuraBonsaiShowcase()
    const savedAi = await store.saveNew({
      scope: 'ai',
      name: '三干樱花盆景',
      kind: 'multi',
      kindLabel: '5 部件场景',
      triangles: 9120,
      lighting: 'sakura',
      thumbnail: VALID_THUMB,
      payload: aiScene,
    })

    expect(store.list('tree').map(x => x.id)).toEqual([savedTree.id])
    expect(store.list('ai').map(x => x.id)).toEqual([savedAi.id])
    expect(store.list().length).toBe(2)

    // Overwrite updates payload, lighting, triangles, and name while preserving id/createdAt
    const updatedSpec = presetSpec('grass-clump')
    const overwritten = await store.overwrite(savedTree.id, {
      name: '宽叶草丛收藏',
      kind: 'grass',
      kindLabel: '草丛',
      triangles: 420,
      lighting: 'ghibli',
      thumbnail: VALID_THUMB,
      payload: updatedSpec,
    })
    expect(overwritten.id).toBe(savedTree.id)
    expect(overwritten.createdAt).toBe(savedTree.createdAt)
    expect(overwritten.kind).toBe('grass')
    expect(overwritten.lighting).toBe('ghibli')
    expect(overwritten.payload.name).toBe('宽叶草丛收藏')

    // Rename updates both entry name and payload.name
    const renamed = await store.rename(savedTree.id, '林间青草')
    expect(renamed.name).toBe('林间青草')
    expect(renamed.payload.name).toBe('林间青草')

    // Reloading a fresh store from the same localStorage recovers all persisted presets
    const reloaded = createPresetStore({ storage, apiUrl: null })
    await reloaded.ready()
    expect(reloaded.list<TreeSpec>('tree')[0].name).toBe('林间青草')
    expect(reloaded.list<AiSceneSpec>('ai')[0].payload.parts.length).toBe(5)

    // Remove
    expect(await store.remove(savedTree.id)).toBe(true)
    expect(await store.remove('non-existent')).toBe(false)
    expect(store.list('tree')).toEqual([])
  })

  it('sanitizes corrupt entries, unsafe thumbnails, and invalid lighting presets', () => {
    const goodTree = presetSpec('broadleaf-willow')
    const list = parsePresetLibrary({
      schemaVersion: 1,
      items: [
        {
          id: 'ok-1',
          scope: 'tree',
          name: '垂柳',
          lighting: 'invalid-mood',
          thumbnail: 'javascript:alert(1)',
          payload: goodTree,
        },
        {
          id: 'ok-2',
          scope: 'tree',
          name: 'SVG 恶意缩略图',
          lighting: 'forest',
          thumbnail: 'data:image/svg+xml;base64,PHN2Zz4=',
          payload: goodTree,
        },
        {
          id: 'bad-scope',
          scope: 'unknown',
          name: '无效作用域',
          payload: goodTree,
        },
        {
          id: 'bad-payload',
          scope: 'tree',
          name: '坏数据',
          payload: null,
        },
        null,
      ],
    })
    expect(list.length).toBe(2)
    const a = list.find(x => x.id === 'ok-1')!
    const b = list.find(x => x.id === 'ok-2')!
    expect(a.lighting).toBe('neutral')
    expect(a.thumbnail).toBe('')
    expect(b.lighting).toBe('forest')
    expect(b.thumbnail).toBe('')
  })

  it('syncs with remote /api/presets, merges newer timestamps, and falls back to localStorage offline', async () => {
    const remoteSpec = presetSpec('broadleaf-maple')
    const localSpec = presetSpec('broadleaf-round')
    let remoteDb = {
      schemaVersion: 1,
      items: [
        parsePresetItem({
          id: 'shared-1',
          scope: 'tree',
          name: '远端新版红枫',
          lighting: 'ghibli',
          thumbnail: VALID_THUMB,
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-10T00:00:00.000Z',
          payload: remoteSpec,
        })!,
      ],
    }

    const storage = memoryStorage()
    // Seed local storage with an older version of shared-1 + an extra offline-only preset
    storage.setItem('vegetation-studio:saved-presets:v1', JSON.stringify({
      schemaVersion: 1,
      items: [
        parsePresetItem({
          id: 'shared-1',
          scope: 'tree',
          name: '本地旧版',
          lighting: 'neutral',
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-02T00:00:00.000Z',
          payload: localSpec,
        })!,
        parsePresetItem({
          id: 'local-only',
          scope: 'tree',
          name: '离线新建圆冠树',
          lighting: 'neutral',
          createdAt: '2026-11-05T00:00:00.000Z',
          updatedAt: '2026-11-05T00:00:00.000Z',
          payload: localSpec,
        })!,
      ],
    }))

    let putCount = 0
    const mockFetch: typeof fetch = (async (_url, init) => {
      if (init?.method === 'PUT') {
        putCount++
        remoteDb = JSON.parse(String(init.body))
        return new Response(JSON.stringify({ ok: true, count: remoteDb.items.length }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(remoteDb), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    const store = createPresetStore({ storage, apiUrl: '/api/presets', fetcher: mockFetch })
    await store.ready()

    expect(store.storageMode).toBe('file')
    expect(store.get('shared-1')?.name).toBe('远端新版红枫')
    expect(store.get('local-only')?.name).toBe('离线新建圆冠树')
    // Local-only preset must be pushed back up to remote file storage
    expect(putCount).toBe(1)
    expect(remoteDb.items.length).toBe(2)

    // Offline fallback when API returns 404 or throws
    const offlineStore = createPresetStore({
      storage,
      apiUrl: '/api/presets',
      fetcher: (async () => new Response('Not Found', { status: 404 })) as typeof fetch,
    })
    await offlineStore.ready()
    expect(offlineStore.storageMode).toBe('local')
    expect(offlineStore.list('tree').length).toBe(2)
  })

  it('exports and imports bundles cleanly with added/updated counts and scope filtering', async () => {
    const storeA = createPresetStore({ storage: memoryStorage(), apiUrl: null })
    const storeB = createPresetStore({ storage: memoryStorage(), apiUrl: null })
    await Promise.all([storeA.ready(), storeB.ready()])

    const p1 = await storeA.saveNew({
      scope: 'tree',
      name: '棕榈测试',
      kind: 'palm',
      kindLabel: '棕榈树',
      triangles: 2200,
      lighting: 'ghibli',
      thumbnail: VALID_THUMB,
      payload: presetSpec('palm-stout'),
    })
    await storeA.saveNew({
      scope: 'ai',
      name: '盆景测试',
      kind: 'multi',
      kindLabel: '5 部件场景',
      triangles: 8000,
      lighting: 'sakura',
      thumbnail: VALID_THUMB,
      payload: sakuraBonsaiShowcase(),
    })

    const bundle = storeA.exportBundle()
    const first = await storeB.importBundle(bundle, 'tree')
    expect(first).toEqual({ added: 1, updated: 0 })
    expect(storeB.list('tree')[0].id).toBe(p1.id)
    expect(storeB.list('ai').length).toBe(0)

    const second = await storeB.importBundle(bundle, 'tree')
    expect(second).toEqual({ added: 0, updated: 1 })

    // mergePresetLists keeps newest timestamp
    const merged = mergePresetLists(storeB.list('tree'), storeA.list('tree'))
    expect(merged.length).toBe(1)
  })

  it('supports scope=rock for both legacy RockSpec and Route C2 PolyCRockSpec (save, rename, overwrite, delete)', async () => {
    const storage = memoryStorage()
    const store = createPresetStore({ storage, apiUrl: null })
    await store.ready()

    const legacyRock = rockPresetSpec('boulder-sand-cap')
    const c2Rock = defaultPolyCRockSpec('terraced-moss-bluff-c2')

    const savedLegacy = await store.saveNew({
      scope: 'rock',
      name: '我的沙顶岩',
      kind: 'rock',
      kindLabel: '厚涂切面',
      triangles: 1420,
      lighting: 'neutral',
      thumbnail: VALID_THUMB,
      payload: legacyRock,
    })
    const savedC2 = await store.saveNew({
      scope: 'rock',
      name: '苔藓层叠巨岩自定义',
      kind: 'rock-c2',
      kindLabel: '路线 C2 · 512 PBR',
      triangles: 512,
      lighting: 'neutral',
      thumbnail: VALID_THUMB,
      payload: c2Rock,
    })

    expect(store.list('rock').length).toBe(2)
    expect(store.list('tree').length).toBe(0)
    expect(store.list('ai').length).toBe(0)
    expect(savedLegacy.kind).toBe('rock')
    expect((savedLegacy.payload as RockSpec).preset).toBe('boulder-sand-cap')
    expect(savedC2.kind).toBe('rock-c2')
    expect((savedC2.payload as PolyCRockSpec).preset).toBe('terraced-moss-bluff-c2')

    // Round-trip parsePresetItem
    const parsedC2 = parsePresetItem(JSON.parse(JSON.stringify(savedC2)))
    expect(parsedC2?.scope).toBe('rock')
    expect(parsedC2?.kind).toBe('rock-c2')
    expect((parsedC2?.payload as PolyCRockSpec).preset).toBe('terraced-moss-bluff-c2')

    // Rename & delete
    const renamed = await store.rename(savedLegacy.id, '改名砂岩')
    expect(renamed?.name).toBe('改名砂岩')
    expect(await store.remove(savedLegacy.id)).toBe(true)
    expect(store.list('rock').map(x => x.id)).toEqual([savedC2.id])

    // Fresh store reloads rock presets from storage
    const reloaded = createPresetStore({ storage, apiUrl: null })
    await reloaded.ready()
    expect(reloaded.list('rock').length).toBe(1)
    expect(reloaded.list('rock')[0].kind).toBe('rock-c2')
  })
})

describe('ai hidden-showcase store', () => {
  const validIds = aiShowcases.map(s => s.id)

  it('hides, persists to localStorage, ignores unknown IDs, and restores built-in showcases', async () => {
    const storage = memoryStorage()
    const store = createHiddenShowcaseStore({ validIds, storage, apiUrl: null })
    await store.ready()

    let notifications = 0
    const unsub = store.subscribe(() => { notifications++ })

    expect(store.hiddenCount()).toBe(0)
    expect(await store.hide('non-existent-case')).toBe(false)
    expect(await store.hide('sakura')).toBe(true)
    expect(await store.hide('sakura')).toBe(false) // already hidden
    expect(store.isHidden('sakura')).toBe(true)
    expect(store.hiddenCount()).toBe(1)
    expect(notifications).toBe(1)

    // Fresh store recovers deleted showcase IDs synchronously from localStorage
    const reloaded = createHiddenShowcaseStore({ validIds, storage, apiUrl: null })
    expect(reloaded.isHidden('sakura')).toBe(true)
    expect(reloaded.listHiddenIds()).toEqual(['sakura'])

    expect(await store.hide('flowering-bush')).toBe(true)
    expect(store.hiddenCount()).toBe(2)

    expect(await store.restore('sakura')).toBe(true)
    expect(store.isHidden('sakura')).toBe(false)
    expect(store.isHidden('flowering-bush')).toBe(true)

    expect(await store.restoreAll()).toBe(1)
    expect(store.hiddenCount()).toBe(0)
    expect(await store.restoreAll()).toBe(0)
    unsub()
  })

  it('syncs authoritatively with /api/hidden-showcases and falls back gracefully offline', async () => {
    let remote = { schemaVersion: 1, persisted: true, hiddenIds: ['sakura-twist'] }
    let putCount = 0
    const mockFetch: typeof fetch = (async (_url, init) => {
      if (init?.method === 'PUT') {
        putCount++
        const body = JSON.parse(String(init.body))
        remote = { schemaVersion: 1, persisted: true, hiddenIds: body.hiddenIds }
        return new Response(JSON.stringify({ ok: true, count: remote.hiddenIds.length }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(remote), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    const storage = memoryStorage()
    const store = createHiddenShowcaseStore({ validIds, storage, apiUrl: '/api/hidden-showcases', fetcher: mockFetch })
    await store.ready()

    expect(store.storageMode).toBe('file')
    expect(store.listHiddenIds()).toEqual(['sakura-twist'])
    expect(putCount).toBe(0)

    await store.hide('wishing-tree')
    expect(putCount).toBe(1)
    expect(remote.hiddenIds).toEqual(['sakura-twist', 'wishing-tree'])

    await store.restoreAll()
    expect(putCount).toBe(2)
    expect(remote.hiddenIds).toEqual([])

    const offline = createHiddenShowcaseStore({
      validIds,
      storage,
      apiUrl: '/api/hidden-showcases',
      fetcher: (async () => new Response('Not Found', { status: 404 })) as typeof fetch,
    })
    await offline.ready()
    expect(offline.storageMode).toBe('local')
  })

  it('preserves foreign IDs from other workbenches sharing /api/hidden-showcases (AI + Rock coexistence)', async () => {
    let remote = { schemaVersion: 1, persisted: true, hiddenIds: ['sakura', 'rock:boulder-moss'] }
    const mockFetch: typeof fetch = (async (_url, init) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body))
        remote = { schemaVersion: 1, persisted: true, hiddenIds: body.hiddenIds }
        return new Response(JSON.stringify({ ok: true, count: remote.hiddenIds.length }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(remote), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    const rockValidIds = ['rock:boulder-moss', 'rock:boulder-sand-cap', 'rock-c2:terraced-moss-bluff-c2']
    const rockStore = createHiddenShowcaseStore({
      validIds: rockValidIds,
      storageKey: 'test:rock-hidden',
      storage: memoryStorage(),
      apiUrl: '/api/hidden-showcases',
      fetcher: mockFetch,
    })
    await rockStore.ready()
    expect(rockStore.listHiddenIds()).toEqual(['rock:boulder-moss'])

    // Hiding a rock preset preserves AI's 'sakura'
    await rockStore.hide('rock-c2:terraced-moss-bluff-c2')
    expect(remote.hiddenIds).toEqual(expect.arrayContaining(['sakura', 'rock:boulder-moss', 'rock-c2:terraced-moss-bluff-c2']))

    // Restoring all rock presets STILL preserves AI's 'sakura'
    expect(await rockStore.restoreAll()).toBe(2)
    expect(rockStore.hiddenCount()).toBe(0)
    expect(remote.hiddenIds).toEqual(['sakura'])
  })

  it('REQ-C4: rolls back in-memory state on disk write failure across all 4 stores and enforces readOnly default overrides', async () => {
    // 1. PresetStore rollback on 500
    let failPut = false
    const presetStore = createPresetStore({
      storage: memoryStorage(),
      apiUrl: '/api/presets',
      fetcher: (async (_url, init) => {
        if (init?.method === 'PUT') {
          if (failPut) return new Response(JSON.stringify({ error: 'disk full' }), { status: 500, headers: { 'content-type': 'application/json' } })
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        return new Response(JSON.stringify({ schemaVersion: 1, items: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-persisted': '1' },
        })
      }) as typeof fetch,
    })
    await presetStore.ready()
    const saved = await presetStore.saveNew({
      scope: 'tree',
      name: '原始松树',
      kind: 'broadleaf',
      kindLabel: '阔叶树',
      triangles: 1000,
      lighting: 'neutral',
      thumbnail: VALID_THUMB,
      payload: presetSpec('broadleaf-round'),
    })
    expect(presetStore.list()).toHaveLength(1)

    failPut = true
    await expect(presetStore.saveNew({
      scope: 'tree',
      name: '失败条目',
      kind: 'broadleaf',
      kindLabel: '阔叶树',
      triangles: 500,
      lighting: 'neutral',
      thumbnail: '',
      payload: presetSpec('broadleaf-round'),
    })).rejects.toThrow(/disk full/)
    expect(presetStore.list().map(x => x.id)).toEqual([saved.id])

    await expect(presetStore.rename(saved.id, '改名失败')).rejects.toThrow(/disk full/)
    expect(presetStore.get(saved.id)?.name).toBe('原始松树')

    await expect(presetStore.remove(saved.id)).rejects.toThrow(/disk full/)
    expect(presetStore.list().map(x => x.id)).toEqual([saved.id])

    // 2. HiddenShowcaseStore throws & rolls back on disk write failure + serializes writes
    let failHidden = true
    const hiddenStore = createHiddenShowcaseStore({
      validIds,
      storage: memoryStorage(),
      apiUrl: '/api/hidden-showcases',
      fetcher: (async (_url, init) => {
        if (init?.method === 'PUT') {
          if (failHidden) return new Response(JSON.stringify({ error: 'readonly fs' }), { status: 500, headers: { 'content-type': 'application/json' } })
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        return new Response(JSON.stringify({ schemaVersion: 1, persisted: true, hiddenIds: ['sakura'] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof fetch,
    })
    await hiddenStore.ready()
    expect(hiddenStore.listHiddenIds()).toEqual(['sakura'])
    await expect(hiddenStore.hide('wishing-tree')).rejects.toThrow(/readonly fs/)
    expect(hiddenStore.listHiddenIds()).toEqual(['sakura'])
    await expect(hiddenStore.restore('sakura')).rejects.toThrow(/readonly fs/)
    expect(hiddenStore.listHiddenIds()).toEqual(['sakura'])
    failHidden = false
    await expect(hiddenStore.hide('wishing-tree')).resolves.toBe(true)
    expect(hiddenStore.listHiddenIds()).toEqual(['sakura', 'wishing-tree'])

    // 3. DefaultOverrideStore rollback + readOnly guard
    let failOverride = true
    let readOnlyPuts = 0
    const overrideStore = createDefaultOverrideStore<'a' | 'b', { v: number }>({
      scope: 'rock',
      validIds: ['a', 'b'],
      parse: raw => ({ v: Number((raw as { v?: number })?.v ?? 0) }),
      storage: memoryStorage(),
      apiUrl: '/api/default-presets',
      fetcher: (async (_url, init) => {
        if (init?.method === 'PUT') {
          if (failOverride) return new Response(JSON.stringify({ error: 'EACCES' }), { status: 500, headers: { 'content-type': 'application/json' } })
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        return new Response(JSON.stringify({ schemaVersion: 1, persisted: true, rock: { a: { v: 1 } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof fetch,
    })
    await overrideStore.ready()
    expect(overrideStore.get('a')).toEqual({ v: 1 })
    await expect(overrideStore.save('a', { v: 99 })).rejects.toThrow(/EACCES/)
    expect(overrideStore.get('a')).toEqual({ v: 1 })
    await expect(overrideStore.resetOne('a')).rejects.toThrow(/EACCES/)
    expect(overrideStore.get('a')).toEqual({ v: 1 })

    const seededLocal = memoryStorage()
    seededLocal.setItem('ro-test-key', JSON.stringify({ schemaVersion: 1, overrides: { a: { v: 7 } } }))
    const readOnlyStore = createDefaultOverrideStore<'a' | 'b', { v: number }>({
      scope: 'rock',
      validIds: ['a', 'b'],
      readOnly: true,
      storageKey: 'ro-test-key',
      parse: raw => ({ v: Number((raw as { v?: number })?.v ?? 0) }),
      storage: seededLocal,
      apiUrl: '/api/default-presets',
      fetcher: (async (_url, init) => {
        if (init?.method === 'PUT') { readOnlyPuts++; return new Response('ok') }
        return new Response(JSON.stringify({ schemaVersion: 1, persisted: false, rock: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof fetch,
    })
    await readOnlyStore.ready()
    expect(readOnlyPuts).toBe(0)
    await expect(readOnlyStore.save('a', { v: 2 })).rejects.toThrow(/只读/)

    // 4. AssemblySceneStore rollback on 500
    let failScene = false
    const sceneStore = createAssemblySceneStore({
      storage: memoryStorage(),
      apiUrl: '/api/scenes',
      fetcher: (async (_url, init) => {
        if (init?.method === 'PUT') {
          if (failScene) return new Response(JSON.stringify({ error: 'ENOSPC' }), { status: 500, headers: { 'content-type': 'application/json' } })
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        return new Response(JSON.stringify({ schemaVersion: 1, items: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-persisted': '1' },
        })
      }) as typeof fetch,
    })
    await sceneStore.ready()
    const sc = await sceneStore.saveNew({
      name: '地块A',
      itemCount: 0,
      triangles: 0,
      thumbnail: '',
      scene: blankAssemblyScene('地块A'),
    })
    expect(sceneStore.list()).toHaveLength(1)

    failScene = true
    await expect(sceneStore.rename(sc.id, '改名失败')).rejects.toThrow(/ENOSPC/)
    expect(sceneStore.get(sc.id)?.name).toBe('地块A')
    await expect(sceneStore.remove(sc.id)).rejects.toThrow(/ENOSPC/)
    expect(sceneStore.list().map(x => x.id)).toEqual([sc.id])
  })
})
