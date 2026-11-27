// Unified user-saved preset store shared by Classic Studio (broadleaf.html) and AI Mode (ai.html).
// Persists to local project file `user-presets/presets.json` via Vite middleware (`/api/presets`)
// with automatic localStorage mirror & offline/static fallback.
import type { Object3D } from 'three'
import { parseAiScene, type AiSceneSpec } from '../ai/scene'
import { parsePolyCRockSpec, polyCRockPresetIds, type PolyCRockSpec } from '../assembly/spec'
import { parseRockSpec, type RockSpec } from '../rock/spec'
import { parseTreeSpec, type TreeKind, type TreeSpec } from '../tree/spec'
import { lightingPresets, type LightingPreset, type Viewer } from '../viewport'
import { parseSavedTextureMap, type SavedTextureMap } from './texture-serialize'

export type PresetScope = 'tree' | 'ai' | 'rock'
export type SavedPresetKind = TreeKind | 'multi' | 'rock' | 'rock-c2'
export type SavedPresetPayload = TreeSpec | AiSceneSpec | RockSpec | PolyCRockSpec
export type StorageMode = 'file' | 'local'

export interface SavedPreset<T = SavedPresetPayload> {
  id: string
  scope: PresetScope
  name: string
  kind: SavedPresetKind
  kindLabel: string
  triangles: number
  lighting: LightingPreset
  thumbnail: string
  createdAt: string
  updatedAt: string
  payload: T
  /** Optional serialized custom textures bound when saved from Tree Studio. */
  textures?: SavedTextureMap
}

export interface PresetLibraryFile {
  schemaVersion: 1
  items: SavedPreset[]
}

export interface SavePresetInput<T = SavedPresetPayload> {
  scope: PresetScope
  name: string
  kind: SavedPresetKind
  kindLabel: string
  triangles: number
  lighting: LightingPreset
  thumbnail: string
  payload: T
  textures?: SavedTextureMap
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

function isPolyCRockPayload(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const p = (raw as { preset?: unknown }).preset
  return typeof p === 'string' && (polyCRockPresetIds as readonly string[]).includes(p)
}

export function parsePresetItem(raw: unknown): SavedPreset | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const scope: PresetScope | undefined = o.scope === 'tree' || o.scope === 'ai' || o.scope === 'rock' ? o.scope : undefined
  if (!scope) return undefined
  try {
    let payload: SavedPresetPayload
    let kind: SavedPresetKind
    let defaultKindLabel: string
    if (scope === 'tree') {
      const tree = parseTreeSpec(o.payload)
      payload = tree
      kind = tree.kind
      defaultKindLabel = kind
    } else if (scope === 'ai') {
      const ai = parseAiScene(o.payload)
      payload = ai
      kind = ai.parts.length === 1 ? ai.parts[0].spec.kind : 'multi'
      defaultKindLabel = `${ai.parts.length} 部件场景`
    } else {
      if (o.kind === 'rock-c2' || isPolyCRockPayload(o.payload)) {
        const c2 = parsePolyCRockSpec(o.payload)
        payload = c2
        kind = 'rock-c2'
        defaultKindLabel = '路线 C2 · 512 PBR'
      } else {
        const rk = parseRockSpec(o.payload)
        payload = rk
        kind = 'rock'
        defaultKindLabel = rk.style === 'cel' ? '赛璐璐岩' : rk.style === 'handpainted' ? '手绘裂纹' : '厚涂切面'
      }
    }
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 80) : payload.name || '未命名预设'
    const lighting: LightingPreset = typeof o.lighting === 'string' && validLighting.has(o.lighting)
      ? o.lighting as LightingPreset
      : 'neutral'
    const thumbnail = typeof o.thumbnail === 'string' && safeThumbRe.test(o.thumbnail) ? o.thumbnail : ''
    const now = new Date().toISOString()
    const createdAt = typeof o.createdAt === 'string' && o.createdAt ? o.createdAt : now
    const updatedAt = typeof o.updatedAt === 'string' && o.updatedAt ? o.updatedAt : createdAt
    const kindLabel = typeof o.kindLabel === 'string' && o.kindLabel.trim()
      ? o.kindLabel.trim().slice(0, 32)
      : defaultKindLabel
    const triangles = typeof o.triangles === 'number' && Number.isFinite(o.triangles) && o.triangles >= 0
      ? Math.round(o.triangles)
      : 0
    const textures = scope === 'tree' ? parseSavedTextureMap(o.textures) : undefined
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
      ...(textures ? { textures } : {}),
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
    if (!prev || item.updatedAt > prev.updatedAt) {
      map.set(item.id, item)
    } else if (item.updatedAt === prev.updatedAt) {
      map.set(item.id, { ...prev, ...item, thumbnail: item.thumbnail || prev.thumbnail })
    }
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
  reload(): Promise<SavedPreset[]>
  list<T = SavedPresetPayload>(scope?: PresetScope): SavedPreset<T>[]
  get<T = SavedPresetPayload>(id: string): SavedPreset<T> | undefined
  saveNew<T extends SavedPresetPayload>(input: SavePresetInput<T>): Promise<SavedPreset<T>>
  overwrite<T extends SavedPresetPayload>(id: string, input: Omit<SavePresetInput<T>, 'scope' | 'name'> & { name?: string }): Promise<SavedPreset<T>>
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

  const writeRemote = async (list: SavedPreset[]): Promise<{ ok: boolean; error?: string }> => {
    if (!apiUrl || !fetcher) return { ok: false }
    try {
      const resp = await fetcher(apiUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 1, items: list }),
      })
      if (resp.ok) {
        mode = 'file'
        return { ok: true }
      }
      let msg = `HTTP ${resp.status}`
      try { const j = await resp.json() as { error?: string }; if (j?.error) msg = j.error } catch {}
      return { ok: false, error: msg }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  let writeChain: Promise<void> = Promise.resolve()
  const runSerialized = <T>(op: () => Promise<T>): Promise<T> => {
    const run = writeChain.then(op)
    writeChain = run.then(() => undefined, () => undefined)
    return run
  }

  const ASSET_SYNC_CHANNEL = 'vegetation-studio:asset-sync'
  const syncChannel = typeof BroadcastChannel !== 'undefined' && apiUrl ? new BroadcastChannel(ASSET_SYNC_CHANNEL) : undefined
  const broadcastSync = () => {
    try { syncChannel?.postMessage({ kind: 'presets', ts: Date.now() }) } catch {}
  }

  const persistSnapshot = async (snapshot: SavedPreset[]) => {
    if (mode === 'file') {
      const res = await writeRemote(snapshot)
      if (!res.ok) throw new Error(`预设写入本地磁盘失败：${res.error || '服务不可用'}`)
      // Keep a slim localStorage copy without bulky thumbnails/textures when disk is authoritative
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify({
          schemaVersion: 1,
          items: snapshot.slice(0, 24).map(({ textures: _t, ...p }) => ({ ...p, thumbnail: '' })),
        }))
      } catch {}
    } else {
      writeLocal(snapshot)
      await writeRemote(snapshot)
    }
    broadcastSync()
    notify()
  }

  const mutateWithRollback = <T>(apply: () => { next?: SavedPreset[]; result: T }): Promise<T> =>
    runSerialized(async () => {
      const prevItems = items
      const { next, result } = apply()
      if (!next) return result
      const sorted = sortPresets(next)
      items = sorted
      try {
        await persistSnapshot(sorted)
      } catch (err) {
        items = prevItems
        throw err
      }
      return result
    })

  // Hydrate synchronously from localStorage first for instant UI render
  items = readLocal()

  const initPromise = (async () => {
    if (!apiUrl || !fetcher) return
    try {
      const resp = await fetcher(apiUrl, { cache: 'no-cache' })
      if (!resp.ok) return
      const ct = resp.headers.get('content-type') || ''
      if (!ct.includes('application/json')) return
      const persistedHeader = resp.headers.get('x-persisted')
      const remoteItems = parsePresetLibrary(await resp.json())
      mode = 'file'
      if (persistedHeader === '1') {
        // Disk file exists -> disk is authoritative (prevents deleted presets from resurrecting across ports/browsers)
        items = remoteItems
        notify()
        return
      }
      if (persistedHeader === '0') {
        if (items.length > 0) {
          await writeRemote(items)
        } else {
          items = remoteItems
        }
        notify()
        return
      }
      const merged = mergePresetLists(remoteItems, items)
      const changed = merged.length !== items.length || JSON.stringify(merged.map(x => [x.id, x.updatedAt])) !== JSON.stringify(items.map(x => [x.id, x.updatedAt]))
      items = merged
      writeLocal(items)
      if (merged.length !== remoteItems.length || merged.some((m, i) => remoteItems[i]?.id !== m.id || remoteItems[i]?.updatedAt !== m.updatedAt)) {
        await writeRemote(items)
      }
      if (changed || mode === 'file') notify()
    } catch {
      mode = 'local'
    }
  })()

  const reload = async (): Promise<SavedPreset[]> => {
    if (!apiUrl || !fetcher) {
      const local = readLocal()
      items = local
      notify()
      return items
    }
    try {
      const resp = await fetcher(apiUrl, { cache: 'no-cache' })
      if (!resp.ok) return items
      const ct = resp.headers.get('content-type') || ''
      if (!ct.includes('application/json')) return items
      const remoteItems = parsePresetLibrary(await resp.json())
      mode = 'file'
      const prevSig = JSON.stringify(items.map(x => [x.id, x.updatedAt, x.name, Boolean(x.textures)]))
      const nextSig = JSON.stringify(remoteItems.map(x => [x.id, x.updatedAt, x.name, Boolean(x.textures)]))
      items = remoteItems
      if (prevSig !== nextSig) notify()
    } catch { /* keep cached items on transient error */ }
    return items
  }

  if (syncChannel) {
    syncChannel.onmessage = ev => {
      const msg = ev.data as { kind?: string } | undefined
      if (msg?.kind === 'presets') void reload()
    }
  }

  return {
    get storageMode() { return mode },
    ready: () => initPromise,
    reload,
    list<T = SavedPresetPayload>(scope?: PresetScope) {
      return (scope ? items.filter(x => x.scope === scope) : items) as SavedPreset<T>[]
    },
    get<T = SavedPresetPayload>(id: string) {
      return items.find(x => x.id === id) as SavedPreset<T> | undefined
    },
    async saveNew<T extends SavedPresetPayload>(input: SavePresetInput<T>) {
      await initPromise
      return mutateWithRollback(() => {
        const now = new Date().toISOString()
        const name = input.name.trim().slice(0, 80) || (input.scope === 'rock' ? '我的石头预设' : '我的植物预设')
        const payload = deepClone(input.payload)
        payload.name = name
        const cleanTex = parseSavedTextureMap(input.textures)
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
          ...(cleanTex ? { textures: cleanTex } : {}),
        }
        return { next: [entry, ...items], result: entry }
      })
    },
    async overwrite<T extends SavedPresetPayload>(id: string, input: Omit<SavePresetInput<T>, 'scope' | 'name'> & { name?: string }) {
      await initPromise
      return mutateWithRollback(() => {
        const idx = items.findIndex(x => x.id === id)
        if (idx < 0) throw new Error('找不到要更新的预设')
        const prev = items[idx]
        const name = (input.name ?? prev.name).trim().slice(0, 80) || prev.name
        const payload = deepClone(input.payload)
        payload.name = name
        const cleanTex = input.textures !== undefined ? parseSavedTextureMap(input.textures) : prev.textures
        const { textures: _oldTex, ...prevRest } = prev
        const updated: SavedPreset<T> = {
          ...prevRest,
          name,
          kind: input.kind,
          kindLabel: input.kindLabel,
          triangles: Math.max(0, Math.round(input.triangles)),
          lighting: input.lighting,
          thumbnail: safeThumbRe.test(input.thumbnail) ? input.thumbnail : prev.thumbnail,
          updatedAt: new Date().toISOString(),
          payload,
          ...(cleanTex ? { textures: cleanTex } : {}),
        }
        return { next: items.map((x, i) => i === idx ? updated : x), result: updated }
      })
    },
    async rename(id: string, nextName: string) {
      await initPromise
      return mutateWithRollback(() => {
        const idx = items.findIndex(x => x.id === id)
        if (idx < 0) throw new Error('找不到要重命名的预设')
        const name = nextName.trim().slice(0, 80)
        if (!name) throw new Error('预设名称不能为空')
        const prev = items[idx]
        const payload = deepClone(prev.payload)
        payload.name = name
        const updated: SavedPreset = { ...prev, name, updatedAt: new Date().toISOString(), payload }
        return { next: items.map((x, i) => i === idx ? updated : x), result: updated }
      })
    },
    async remove(id: string) {
      await initPromise
      return mutateWithRollback(() => {
        const next = items.filter(x => x.id !== id)
        if (next.length === items.length) return { result: false }
        return { next, result: true }
      })
    },
    exportBundle(scope?: PresetScope): PresetLibraryFile {
      const list = scope ? items.filter(x => x.scope === scope) : items
      return { schemaVersion: 1, items: deepClone(list) }
    },
    async importBundle(raw: unknown, scopeFilter?: PresetScope) {
      await initPromise
      return mutateWithRollback(() => {
        const parsed = parsePresetLibrary(raw).filter(x => !scopeFilter || x.scope === scopeFilter)
        if (!parsed.length) throw new Error('文件中没有有效的预设条目')
        let added = 0, updated = 0
        const map = new Map(items.map(x => [x.id, x]))
        for (const entry of parsed) {
          if (map.has(entry.id)) updated++
          else added++
          map.set(entry.id, entry)
        }
        return { next: [...map.values()], result: { added, updated } }
      })
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
