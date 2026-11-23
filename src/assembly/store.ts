// Persistent store for saved Scene Assembly cases (`user-presets/scenes.json` via `/api/scenes`
// with automatic localStorage mirror & offline fallback).
import type { StorageLike, StorageMode } from '../studio/preset-store'
import { cloneJson, parseAssemblyScene, type AssemblySceneSpec } from './spec'

export interface SavedAssemblyScene {
  id: string
  name: string
  description: string
  itemCount: number
  triangles: number
  thumbnail: string
  createdAt: string
  updatedAt: string
  scene: AssemblySceneSpec
}

export interface SaveAssemblySceneInput {
  name: string
  description?: string
  itemCount: number
  triangles: number
  thumbnail: string
  scene: AssemblySceneSpec
}

export interface AssemblySceneStoreOptions {
  storageKey?: string
  storage?: StorageLike | null
  apiUrl?: string | null
  fetcher?: typeof fetch
}

export interface AssemblySceneStore {
  readonly storageMode: StorageMode
  ready(): Promise<void>
  list(): SavedAssemblyScene[]
  get(id: string): SavedAssemblyScene | undefined
  saveNew(input: SaveAssemblySceneInput): Promise<SavedAssemblyScene>
  overwrite(id: string, input: Omit<SaveAssemblySceneInput, 'name'> & { name?: string }): Promise<SavedAssemblyScene>
  rename(id: string, name: string): Promise<SavedAssemblyScene>
  remove(id: string): Promise<boolean>
  subscribe(listener: () => void): () => void
}

const DEFAULT_STORAGE_KEY = 'vegetation-studio:assembly-scenes:v1'
const SAFE_THUMB_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/

function makeSceneId() {
  return `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function parseSavedAssemblyScene(raw: unknown): SavedAssemblyScene | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  if (!o.scene || typeof o.scene !== 'object') return undefined
  try {
    const scene = parseAssemblyScene(o.scene)
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 80) : scene.name
    const now = new Date().toISOString()
    return {
      id: typeof o.id === 'string' && o.id.trim() ? o.id.trim() : makeSceneId(),
      name,
      description: typeof o.description === 'string' ? o.description.trim().slice(0, 200) : scene.description,
      itemCount: typeof o.itemCount === 'number' && Number.isFinite(o.itemCount) ? Math.max(0, Math.round(o.itemCount)) : scene.items.length,
      triangles: typeof o.triangles === 'number' && Number.isFinite(o.triangles) ? Math.max(0, Math.round(o.triangles)) : 0,
      thumbnail: typeof o.thumbnail === 'string' && SAFE_THUMB_RE.test(o.thumbnail) ? o.thumbnail : '',
      createdAt: typeof o.createdAt === 'string' && o.createdAt ? o.createdAt : now,
      updatedAt: typeof o.updatedAt === 'string' && o.updatedAt ? o.updatedAt : now,
      scene: { ...scene, name },
    }
  } catch {
    return undefined
  }
}

export function createAssemblySceneStore(options: AssemblySceneStoreOptions = {}): AssemblySceneStore {
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY
  const storage: StorageLike | null = options.storage !== undefined
    ? options.storage
    : (typeof localStorage !== 'undefined' ? localStorage : null)
  const apiUrl = options.apiUrl !== undefined ? options.apiUrl : '/api/scenes'
  const fetcher = options.fetcher ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined)

  let items: SavedAssemblyScene[] = []
  let mode: StorageMode = 'local'
  const listeners = new Set<() => void>()

  const notify = () => { for (const fn of listeners) fn() }

  const parseList = (raw: unknown): SavedAssemblyScene[] => {
    const arr = Array.isArray(raw)
      ? raw
      : (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items)
        ? (raw as { items: unknown[] }).items
        : [])
    const out: SavedAssemblyScene[] = []
    const seen = new Set<string>()
    for (const entry of arr) {
      const p = parseSavedAssemblyScene(entry)
      if (!p || seen.has(p.id)) continue
      seen.add(p.id)
      out.push(p)
    }
    return out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  }

  const readLocal = (): SavedAssemblyScene[] => {
    if (!storage) return []
    try {
      const text = storage.getItem(storageKey)
      if (!text) return []
      return parseList(JSON.parse(text))
    } catch {
      return []
    }
  }

  const writeLocal = () => {
    if (!storage) return
    try {
      storage.setItem(storageKey, JSON.stringify({ schemaVersion: 1, items }))
    } catch {
      // Strip thumbnails on localStorage quota pressure (disk file keeps full data)
      try {
        storage.setItem(storageKey, JSON.stringify({
          schemaVersion: 1,
          items: items.map(x => ({ ...x, thumbnail: '' })),
        }))
      } catch {}
    }
  }

  const writeRemote = async (): Promise<boolean> => {
    if (!apiUrl || !fetcher) return false
    try {
      const resp = await fetcher(apiUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 1, items }),
      })
      if (resp.ok) {
        mode = 'file'
        return true
      }
    } catch {
      // Static/offline fallback
    }
    return false
  }

  const persist = async () => {
    writeLocal()
    await writeRemote()
    notify()
  }

  items = readLocal()

  const initPromise = (async () => {
    if (!apiUrl || !fetcher) return
    try {
      const resp = await fetcher(apiUrl, { cache: 'no-store' })
      if (!resp.ok) return
      const ct = resp.headers.get('content-type') || ''
      if (!ct.includes('application/json')) return
      const remoteItems = parseList(await resp.json())
      mode = 'file'
      const byId = new Map<string, SavedAssemblyScene>()
      for (const r of remoteItems) byId.set(r.id, r)
      let pushedLocal = false
      for (const l of items) {
        const existing = byId.get(l.id)
        if (!existing || (l.updatedAt || '') > (existing.updatedAt || '')) {
          byId.set(l.id, l)
          pushedLocal = true
        }
      }
      items = [...byId.values()].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      writeLocal()
      if (pushedLocal) await writeRemote()
      notify()
    } catch {
      mode = 'local'
    }
  })()

  return {
    get storageMode() { return mode },
    ready: () => initPromise,
    list: () => items,
    get: (id: string) => items.find(x => x.id === id),
    async saveNew(input) {
      await initPromise
      const now = new Date().toISOString()
      const name = input.name.trim().slice(0, 80) || '未命名组装场景'
      const scene = cloneJson(input.scene)
      scene.name = name
      const saved: SavedAssemblyScene = {
        id: makeSceneId(),
        name,
        description: (input.description ?? scene.description ?? '').trim().slice(0, 200),
        itemCount: Math.max(0, Math.round(input.itemCount)),
        triangles: Math.max(0, Math.round(input.triangles)),
        thumbnail: SAFE_THUMB_RE.test(input.thumbnail) ? input.thumbnail : '',
        createdAt: now,
        updatedAt: now,
        scene,
      }
      items = [saved, ...items]
      await persist()
      return saved
    },
    async overwrite(id, input) {
      await initPromise
      const idx = items.findIndex(x => x.id === id)
      if (idx < 0) throw new Error('找不到要更新的组装场景')
      const prev = items[idx]
      const name = (input.name ?? prev.name).trim().slice(0, 80) || prev.name
      const scene = cloneJson(input.scene)
      scene.name = name
      const updated: SavedAssemblyScene = {
        ...prev,
        name,
        description: (input.description ?? scene.description ?? prev.description).trim().slice(0, 200),
        itemCount: Math.max(0, Math.round(input.itemCount)),
        triangles: Math.max(0, Math.round(input.triangles)),
        thumbnail: SAFE_THUMB_RE.test(input.thumbnail) ? input.thumbnail : prev.thumbnail,
        updatedAt: new Date().toISOString(),
        scene,
      }
      items = items.map((x, i) => (i === idx ? updated : x))
      await persist()
      return updated
    },
    async rename(id, rawName) {
      await initPromise
      const idx = items.findIndex(x => x.id === id)
      if (idx < 0) throw new Error('找不到要重命名的组装场景')
      const name = rawName.trim().slice(0, 80)
      if (!name) throw new Error('场景名称不能为空')
      const prev = items[idx]
      const updated: SavedAssemblyScene = {
        ...prev,
        name,
        scene: { ...prev.scene, name },
        updatedAt: new Date().toISOString(),
      }
      items = items.map((x, i) => (i === idx ? updated : x))
      await persist()
      return updated
    },
    async remove(id) {
      await initPromise
      const next = items.filter(x => x.id !== id)
      if (next.length === items.length) return false
      items = next
      await persist()
      return true
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
