// Unified user-saved preset store shared by Classic Studio (broadleaf.html) and AI Mode (ai.html).
// Persists to local project file `user-presets/presets.json` via Vite middleware (`/api/presets`)
// with automatic localStorage mirror & offline/static fallback.
import type { Object3D } from 'three'
import { parseAiScene, type AiSceneSpec } from '../ai/scene'
import { parseTreeSpec, type TreeKind, type TreeSpec } from '../tree/spec'
import { lightingPresets, type LightingPreset, type Viewer } from '../viewport'

export type PresetScope = 'tree' | 'ai'
export type StorageMode = 'file' | 'local'

export interface SavedPreset<T = TreeSpec | AiSceneSpec> {
  id: string
  scope: PresetScope
  name: string
  kind: TreeKind | 'multi'
  kindLabel: string
  triangles: number
  lighting: LightingPreset
  thumbnail: string
  createdAt: string
  updatedAt: string
  payload: T
}

export interface PresetLibraryFile {
  schemaVersion: 1
  items: SavedPreset[]
}

export interface SavePresetInput<T = TreeSpec | AiSceneSpec> {
  scope: PresetScope
  name: string
  kind: TreeKind | 'multi'
  kindLabel: string
  triangles: number
  lighting: LightingPreset
  thumbnail: string
  payload: T
}

const STORAGE_KEY = 'vegetation-studio:saved-presets:v1'
const validLighting = new Set<string>(Object.keys(lightingPresets))
const safeThumbRe = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function makeId(scope: PresetScope) {
  return `${scope}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function parsePresetItem(raw: unknown): SavedPreset | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const scope: PresetScope | undefined = o.scope === 'tree' || o.scope === 'ai' ? o.scope : undefined
  if (!scope) return undefined
  try {
    const payload = scope === 'tree' ? parseTreeSpec(o.payload) : parseAiScene(o.payload)
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 80) : payload.name || '未命名预设'
    const lighting: LightingPreset = typeof o.lighting === 'string' && validLighting.has(o.lighting)
      ? o.lighting as LightingPreset
      : 'neutral'
    const thumbnail = typeof o.thumbnail === 'string' && safeThumbRe.test(o.thumbnail) ? o.thumbnail : ''
    const now = new Date().toISOString()
    const createdAt = typeof o.createdAt === 'string' && o.createdAt ? o.createdAt : now
    const updatedAt = typeof o.updatedAt === 'string' && o.updatedAt ? o.updatedAt : createdAt
    const kind = scope === 'tree'
      ? (payload as TreeSpec).kind
      : ((payload as AiSceneSpec).parts.length === 1 ? (payload as AiSceneSpec).parts[0].spec.kind : 'multi')
    const kindLabel = typeof o.kindLabel === 'string' && o.kindLabel.trim()
      ? o.kindLabel.trim().slice(0, 32)
      : (scope === 'tree' ? kind : `${(payload as AiSceneSpec).parts.length} 部件场景`)
    const triangles = typeof o.triangles === 'number' && Number.isFinite(o.triangles) && o.triangles >= 0
      ? Math.round(o.triangles)
      : 0
    return {
      id: typeof o.id === 'string' && o.id.trim() ? o.id.trim() : makeId(scope),
      scope,
      name,
      kind,
      kindLabel,
      triangles,
      lighting,
      thumbnail,
      createdAt,
      updatedAt,
      payload,
    }
  } catch {
    return undefined
  }
}

export function parsePresetLibrary(raw: unknown): SavedPreset[] {
  const list = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).items)
      ? (raw as Record<string, unknown>).items as unknown[]
      : [])
  const out: SavedPreset[] = []
  const seen = new Set<string>()
  for (const entry of list) {
    const item = parsePresetItem(entry)
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return sortPresets(out)
}

export function sortPresets(items: SavedPreset[]): SavedPreset[] {
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function mergePresetLists(a: SavedPreset[], b: SavedPreset[]): SavedPreset[] {
  const map = new Map<string, SavedPreset>()
  for (const item of [...a, ...b]) {
    const prev = map.get(item.id)
    if (!prev || item.updatedAt >= prev.updatedAt) map.set(item.id, item)
  }
  return sortPresets([...map.values()])
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface PresetStoreOptions {
  storage?: StorageLike | null
  apiUrl?: string | null
  fetcher?: typeof fetch
}

export interface PresetStore {
  readonly storageMode: StorageMode
  ready(): Promise<void>
  list<T = TreeSpec | AiSceneSpec>(scope?: PresetScope): SavedPreset<T>[]
  get<T = TreeSpec | AiSceneSpec>(id: string): SavedPreset<T> | undefined
  saveNew<T extends TreeSpec | AiSceneSpec>(input: SavePresetInput<T>): Promise<SavedPreset<T>>
  overwrite<T extends TreeSpec | AiSceneSpec>(id: string, input: Omit<SavePresetInput<T>, 'scope' | 'name'> & { name?: string }): Promise<SavedPreset<T>>
  rename(id: string, nextName: string): Promise<SavedPreset>
  remove(id: string): Promise<boolean>
  exportBundle(scope?: PresetScope): PresetLibraryFile
  importBundle(raw: unknown, scopeFilter?: PresetScope): Promise<{ added: number; updated: number }>
  subscribe(listener: () => void): () => void
}

export function createPresetStore(options: PresetStoreOptions = {}): PresetStore {
  const storage: StorageLike | null = options.storage !== undefined
    ? options.storage
    : (typeof localStorage !== 'undefined' ? localStorage : null)
  const apiUrl = options.apiUrl !== undefined ? options.apiUrl : '/api/presets'
  const fetcher = options.fetcher ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined)

  let items: SavedPreset[] = []
  let mode: StorageMode = 'local'
  const listeners = new Set<() => void>()

  const notify = () => { for (const fn of listeners) fn() }

  const readLocal = (): SavedPreset[] => {
    if (!storage) return []
    try {
      const raw = storage.getItem(STORAGE_KEY)
      return raw ? parsePresetLibrary(JSON.parse(raw)) : []
    } catch {
      return []
    }
  }

  const writeLocal = (list: SavedPreset[]) => {
    if (!storage) return
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, items: list }))
    } catch {
      // If localStorage quota is full (e.g. many thumbnails), retry storing without old thumbnails in local cache
      try {
        const slim = list.map((p, i) => i < 24 ? p : { ...p, thumbnail: '' })
        storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, items: slim }))
      } catch { /* ignore quota error when file persistence is active */ }
    }
  }

  const writeRemote = async (list: SavedPreset[]): Promise<boolean> => {
    if (!apiUrl || !fetcher) return false
    try {
      const resp = await fetcher(apiUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 1, items: list }),
      })
      if (resp.ok) {
        mode = 'file'
        return true
      }
    } catch { /* fallback to localStorage */ }
    return false
  }

  const persist = async () => {
    items = sortPresets(items)
    writeLocal(items)
    await writeRemote(items)
    notify()
  }

  // Hydrate synchronously from localStorage first for instant UI render
  items = readLocal()

  const initPromise = (async () => {
    if (!apiUrl || !fetcher) return
    try {
      const resp = await fetcher(apiUrl, { cache: 'no-store' })
      if (!resp.ok) return
      const ct = resp.headers.get('content-type') || ''
      if (!ct.includes('application/json')) return
      const remoteItems = parsePresetLibrary(await resp.json())
      mode = 'file'
      const merged = mergePresetLists(remoteItems, items)
      const changed = merged.length !== items.length || JSON.stringify(merged.map(x => [x.id, x.updatedAt])) !== JSON.stringify(items.map(x => [x.id, x.updatedAt]))
      items = merged
      writeLocal(items)
      // If local had newer/additional entries not yet on disk, sync them to disk
      if (merged.length !== remoteItems.length || merged.some((m, i) => remoteItems[i]?.id !== m.id || remoteItems[i]?.updatedAt !== m.updatedAt)) {
        await writeRemote(items)
      }
      if (changed || mode === 'file') notify()
    } catch {
      mode = 'local'
    }
  })()

  return {
    get storageMode() { return mode },
    ready: () => initPromise,
    list<T = TreeSpec | AiSceneSpec>(scope?: PresetScope) {
      return (scope ? items.filter(x => x.scope === scope) : items) as SavedPreset<T>[]
    },
    get<T = TreeSpec | AiSceneSpec>(id: string) {
      return items.find(x => x.id === id) as SavedPreset<T> | undefined
    },
    async saveNew<T extends TreeSpec | AiSceneSpec>(input: SavePresetInput<T>) {
      await initPromise
      const now = new Date().toISOString()
      const name = input.name.trim().slice(0, 80) || '我的植物预设'
      const payload = deepClone(input.payload)
      payload.name = name
      const entry: SavedPreset<T> = {
        id: makeId(input.scope),
        scope: input.scope,
        name,
        kind: input.kind,
        kindLabel: input.kindLabel,
        triangles: Math.max(0, Math.round(input.triangles)),
        lighting: input.lighting,
        thumbnail: safeThumbRe.test(input.thumbnail) ? input.thumbnail : '',
        createdAt: now,
        updatedAt: now,
        payload,
      }
      items = [entry, ...items]
      await persist()
      return entry
    },
    async overwrite<T extends TreeSpec | AiSceneSpec>(id: string, input: Omit<SavePresetInput<T>, 'scope' | 'name'> & { name?: string }) {
      await initPromise
      const idx = items.findIndex(x => x.id === id)
      if (idx < 0) throw new Error('找不到要更新的预设')
      const prev = items[idx]
      const name = (input.name ?? prev.name).trim().slice(0, 80) || prev.name
      const payload = deepClone(input.payload)
      payload.name = name
      const updated: SavedPreset<T> = {
        ...prev,
        name,
        kind: input.kind,
        kindLabel: input.kindLabel,
        triangles: Math.max(0, Math.round(input.triangles)),
        lighting: input.lighting,
        thumbnail: safeThumbRe.test(input.thumbnail) ? input.thumbnail : prev.thumbnail,
        updatedAt: new Date().toISOString(),
        payload,
      }
      items = items.map((x, i) => i === idx ? updated : x)
      await persist()
      return updated
    },
    async rename(id: string, nextName: string) {
      await initPromise
      const idx = items.findIndex(x => x.id === id)
      if (idx < 0) throw new Error('找不到要重命名的预设')
      const name = nextName.trim().slice(0, 80)
      if (!name) throw new Error('预设名称不能为空')
      const prev = items[idx]
      const payload = deepClone(prev.payload)
      payload.name = name
      const updated: SavedPreset = { ...prev, name, updatedAt: new Date().toISOString(), payload }
      items = items.map((x, i) => i === idx ? updated : x)
      await persist()
      return updated
    },
    async remove(id: string) {
      await initPromise
      const before = items.length
      items = items.filter(x => x.id !== id)
      if (items.length === before) return false
      await persist()
      return true
    },
    exportBundle(scope?: PresetScope): PresetLibraryFile {
      const list = scope ? items.filter(x => x.scope === scope) : items
      return { schemaVersion: 1, items: deepClone(list) }
    },
    async importBundle(raw: unknown, scopeFilter?: PresetScope) {
      await initPromise
      const parsed = parsePresetLibrary(raw).filter(x => !scopeFilter || x.scope === scopeFilter)
      if (!parsed.length) throw new Error('文件中没有有效的预设条目')
      let added = 0, updated = 0
      const map = new Map(items.map(x => [x.id, x]))
      for (const entry of parsed) {
        if (map.has(entry.id)) updated++
        else added++
        map.set(entry.id, entry)
      }
      items = sortPresets([...map.values()])
      await persist()
      return { added, updated }
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

/** Captures a compact, crisp 320x220 JPEG preview thumbnail directly from the live WebGL viewport
 *  (temporarily hiding editor gizmos so thumbnails stay clean). */
export function captureViewportThumbnail(viewer: Viewer | undefined, hideObjects: (Object3D | undefined)[] = []): string {
  if (!viewer) return ''
  const prevVis = hideObjects.map(o => o?.visible)
  try {
    for (const o of hideObjects) if (o) o.visible = false
    viewer.renderer.render(viewer.scene, viewer.camera)
    const src = viewer.renderer.domElement
    const sw = src.width || src.clientWidth
    const sh = src.height || src.clientHeight
    if (!sw || !sh) return ''
    const tw = 320, th = 220
    const canvas = document.createElement('canvas')
    canvas.width = tw
    canvas.height = th
    const g = canvas.getContext('2d')
    if (!g) return ''
    // Center-crop cover so the plant fills the thumbnail attractively without stretching
    const scale = Math.max(tw / sw, th / sh)
    const cw = tw / scale, ch = th / scale
    const sx = (sw - cw) * .5, sy = (sh - ch) * .5
    g.fillStyle = '#f2f1ec'
    g.fillRect(0, 0, tw, th)
    g.drawImage(src, sx, sy, cw, ch, 0, 0, tw, th)
    return canvas.toDataURL('image/jpeg', .84)
  } catch {
    return ''
  } finally {
    hideObjects.forEach((o, i) => { if (o) o.visible = Boolean(prevVis[i]) })
  }
}
