import { describe, expect, it } from 'vitest'
import {
  createPresetStore,
  mergePresetLists,
  parsePresetItem,
  parsePresetLibrary,
  type StorageLike,
} from '../src/studio/preset-store'
import { presetSpec, type TreeSpec } from '../src/tree/spec'
import { sakuraBonsaiShowcase } from '../src/ai/showcase'
import type { AiSceneSpec } from '../src/ai/scene'

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
})
