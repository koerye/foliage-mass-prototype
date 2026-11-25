// Real-time Texture Library persistent store (shared between Classic Studio & AI Mode).
// Dual persistence: local project disk (`user-textures/library.json` via `/api/textures`)
// + localStorage mirror & offline static fallback.
import { editableTextureSlots, type EditableTextureSlot } from '../studio/texture-slots'
import { cloneGraph, parseTextureGraph } from './nodes'
import { resolveAtlasRegions } from './nodes-v2'
import type { AtlasRegion, TextureCategory, TextureGraph } from './types'
import { defaultCategoryForSlot } from './types'

export type TextureStorageMode = 'file' | 'local'

export interface SavedTextureItem {
  id: string
  name: string
  category: TextureCategory
  targetSlot: EditableTextureSlot
  resolution: 256 | 512 | 1024
  seamless: boolean
  /** Optional N x M atlas grid metadata auto-detected from branch_scatter (1..4). */
  atlasCols?: number
  atlasRows?: number
  /** Optional non-uniform asymmetric atlas region rects auto-detected from atlas_compose. */
  atlasRegions?: AtlasRegion[]
  /** Baked sRGB BaseColor PNG data URL for instant zero-lag loading onto 3D trees. */
  dataUrl: string
  /** Optional persisted linear PBR channels (OpenGL Normal / Height / Roughness) for lossless 3D & GLB round-trip. */
  normalDataUrl?: string
  heightDataUrl?: string
  roughnessDataUrl?: string
  /** Compact preview thumbnail data URL for the texture library grid. */
  thumbnail: string
  /** Full non-destructive Substance-style node graph (editable anytime). */
  graph: TextureGraph
  createdAt: string
  updatedAt: string
}

export interface TextureLibraryFile {
  schemaVersion: 1
  items: SavedTextureItem[]
}

export interface SaveTextureInput {
  name: string
  category?: TextureCategory
  targetSlot: EditableTextureSlot
  resolution?: 256 | 512 | 1024
  seamless?: boolean
  atlasCols?: number
  atlasRows?: number
  atlasRegions?: AtlasRegion[]
  dataUrl: string
  normalDataUrl?: string
  heightDataUrl?: string
  roughnessDataUrl?: string
  thumbnail: string
  graph: TextureGraph
}

function inferAtlasMeta(
  graph: TextureGraph,
  colsIn?: unknown,
  rowsIn?: unknown,
  regionsIn?: unknown,
): { atlasCols?: number; atlasRows?: number; atlasRegions?: AtlasRegion[] } {
  if (graph.targetSlot !== 'bark') {
    const comp = graph.nodes.find(n => n.type === 'atlas_compose')
    if (Array.isArray(regionsIn) && regionsIn.length > 0) {
      return { atlasRegions: regionsIn as AtlasRegion[] }
    }
    if (comp) {
      return { atlasRegions: resolveAtlasRegions(comp.params, graph.resolution) }
    }
  }
  const clampGrid = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? Math.max(1, Math.min(4, Math.round(v))) : undefined
  let cols = clampGrid(colsIn)
  let rows = clampGrid(rowsIn)
  if ((cols === undefined || rows === undefined) && graph.targetSlot !== 'bark') {
    const scatter = graph.nodes.find(n => n.type === 'branch_scatter')
    if (scatter && scatter.params.layout !== 'tile') {
      const legacy = scatter.params.atlas2x2 === true
      if (cols === undefined) cols = clampGrid(scatter.params.atlasCols) ?? (legacy ? 2 : 1)
      if (rows === undefined) rows = clampGrid(scatter.params.atlasRows) ?? (legacy ? 2 : 1)
    }
  }
  return cols && rows && (cols > 1 || rows > 1) ? { atlasCols: cols, atlasRows: rows } : {}
}

const STORAGE_KEY = 'vegetation-studio:saved-textures:v1'
const validSlots = new Set<string>(editableTextureSlots)
const validCats = new Set<TextureCategory>(['leaf', 'bark', 'needle', 'flower', 'grass', 'other'])
const safeDataUrlRe = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/

function makeId(category: TextureCategory) {
  return `tex-${category}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function sortTextures(items: SavedTextureItem[]): SavedTextureItem[] {
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function mergeTextureLists(a: SavedTextureItem[], b: SavedTextureItem[]): SavedTextureItem[] {
  const map = new Map<string, SavedTextureItem>()
  for (const item of [...a, ...b]) {
    const prev = map.get(item.id)
    if (!prev || item.updatedAt > prev.updatedAt) {
      map.set(item.id, item)
    } else if (item.updatedAt === prev.updatedAt) {
      // On equal timestamp, coalesce non-empty PBR & atlas payloads so a quota-slimmed localStorage mirror
      // can NEVER clobber authoritative full-PBR entries loaded from disk!
      const merged: SavedTextureItem = {
        ...prev,
        ...item,
        dataUrl: item.dataUrl || prev.dataUrl,
        thumbnail: item.thumbnail || prev.thumbnail,
        ...(item.normalDataUrl || prev.normalDataUrl ? { normalDataUrl: item.normalDataUrl || prev.normalDataUrl } : {}),
        ...(item.heightDataUrl || prev.heightDataUrl ? { heightDataUrl: item.heightDataUrl || prev.heightDataUrl } : {}),
        ...(item.roughnessDataUrl || prev.roughnessDataUrl ? { roughnessDataUrl: item.roughnessDataUrl || prev.roughnessDataUrl } : {}),
        ...(item.atlasRegions?.length ? { atlasRegions: item.atlasRegions } : prev.atlasRegions?.length ? { atlasRegions: prev.atlasRegions } : {}),
      }
      map.set(item.id, merged)
    }
  }
  return sortTextures([...map.values()])
}

export function parseSavedTextureItem(raw: unknown): SavedTextureItem | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  try {
    const graph = parseTextureGraph(o.graph)
    const targetSlot: EditableTextureSlot = typeof o.targetSlot === 'string' && validSlots.has(o.targetSlot)
      ? o.targetSlot as EditableTextureSlot
      : graph.targetSlot
    const category: TextureCategory = typeof o.category === 'string' && validCats.has(o.category as TextureCategory)
      ? o.category as TextureCategory
      : defaultCategoryForSlot(targetSlot)
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 80) : graph.name
    const dataUrl = typeof o.dataUrl === 'string' && safeDataUrlRe.test(o.dataUrl) ? o.dataUrl : ''
    const normalDataUrl = typeof o.normalDataUrl === 'string' && safeDataUrlRe.test(o.normalDataUrl) ? o.normalDataUrl : undefined
    const heightDataUrl = typeof o.heightDataUrl === 'string' && safeDataUrlRe.test(o.heightDataUrl) ? o.heightDataUrl : undefined
    const roughnessDataUrl = typeof o.roughnessDataUrl === 'string' && safeDataUrlRe.test(o.roughnessDataUrl) ? o.roughnessDataUrl : undefined
    const thumbnail = typeof o.thumbnail === 'string' && safeDataUrlRe.test(o.thumbnail) ? o.thumbnail : dataUrl
    const now = new Date().toISOString()
    const createdAt = typeof o.createdAt === 'string' && o.createdAt ? o.createdAt : now
    const updatedAt = typeof o.updatedAt === 'string' && o.updatedAt ? o.updatedAt : createdAt
    const resolution: 256 | 512 | 1024 = o.resolution === 256 || o.resolution === 512 || o.resolution === 1024
      ? o.resolution
      : graph.resolution
    const atlasMeta = inferAtlasMeta({ ...graph, targetSlot }, o.atlasCols, o.atlasRows, o.atlasRegions)
    return {
      id: typeof o.id === 'string' && o.id.trim() ? o.id.trim() : makeId(category),
      name,
      category,
      targetSlot,
      resolution,
      seamless: typeof o.seamless === 'boolean' ? o.seamless : graph.seamless,
      ...atlasMeta,
      dataUrl,
      ...(normalDataUrl ? { normalDataUrl } : {}),
      ...(heightDataUrl ? { heightDataUrl } : {}),
      ...(roughnessDataUrl ? { roughnessDataUrl } : {}),
      thumbnail,
      graph: { ...graph, name, category, targetSlot, resolution },
      createdAt,
      updatedAt,
    }
  } catch {
    return undefined
  }
}

export function parseTextureLibrary(raw: unknown): SavedTextureItem[] {
  const list = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).items)
      ? (raw as Record<string, unknown>).items as unknown[]
      : [])
  const out: SavedTextureItem[] = []
  const seen = new Set<string>()
  for (const entry of list) {
    const item = parseSavedTextureItem(entry)
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return sortTextures(out)
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface TextureStoreOptions {
  storage?: StorageLike | null
  apiUrl?: string | null
  fetcher?: typeof fetch
  /** Defer downloading full multi-MB library.json until ensureLoaded() is called (boot only fetches ~2 KB summary count). */
  lazy?: boolean
}

export interface TextureLibraryStore {
  readonly storageMode: TextureStorageMode
  readonly count: number
  readonly isLoaded: boolean
  ready(): Promise<void>
  ensureLoaded(): Promise<void>
  list(category?: TextureCategory): SavedTextureItem[]
  get(id: string): SavedTextureItem | undefined
  saveNew(input: SaveTextureInput): Promise<SavedTextureItem>
  overwrite(id: string, input: Partial<SaveTextureInput>): Promise<SavedTextureItem>
  rename(id: string, nextName: string): Promise<SavedTextureItem>
  duplicate(id: string): Promise<SavedTextureItem>
  remove(id: string): Promise<boolean>
  exportBundle(): TextureLibraryFile
  importBundle(raw: unknown): Promise<{ added: number; updated: number }>
  subscribe(listener: () => void): () => void
}

export function createTextureLibraryStore(options: TextureStoreOptions = {}): TextureLibraryStore {
  const storage: StorageLike | null = options.storage !== undefined
    ? options.storage
    : (typeof localStorage !== 'undefined' ? localStorage : null)
  const apiUrl = options.apiUrl !== undefined ? options.apiUrl : '/api/textures'
  const fetcher = options.fetcher ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined)

  let items: SavedTextureItem[] = []
  let mode: TextureStorageMode = 'local'
  let summaryCount = 0
  let fullyLoaded = false
  let fullLoadPromise: Promise<void> | undefined
  const listeners = new Set<() => void>()

  const notify = () => { for (const fn of listeners) fn() }

  const readLocal = (): SavedTextureItem[] => {
    if (!storage) return []
    try {
      const raw = storage.getItem(STORAGE_KEY)
      return raw ? parseTextureLibrary(JSON.parse(raw)) : []
    } catch {
      return []
    }
  }

  const writeLocal = (list: SavedTextureItem[]) => {
    if (!storage) return
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, items: list }))
    } catch {
      // Fallback 1: strip secondary PBR channels from localStorage mirror (full PBR stays intact on disk!)
      try {
        const slimPbr = list.map(item => {
          const { normalDataUrl: _n, heightDataUrl: _h, roughnessDataUrl: _r, ...rest } = item
          return rest
        })
        storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, items: slimPbr }))
      } catch {
        // Fallback 2: keep graphs + thumbnails in localStorage even if big baked PNGs exceed quota
        try {
          const slim = list.map((item, i) => {
            const { normalDataUrl: _n, heightDataUrl: _h, roughnessDataUrl: _r, ...rest } = item
            return i < 10 ? rest : { ...rest, dataUrl: '' }
          })
          storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, items: slim }))
        } catch { /* ignore when disk persistence is active */ }
      }
    }
  }

  const writeRemote = async (list: SavedTextureItem[]): Promise<{ ok: boolean; error?: string }> => {
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
  const runMutation = async <T>(
    mutator: () => { nextItems: SavedTextureItem[]; result: T; changed?: boolean },
  ): Promise<T> => {
    await loadFull()
    const run = writeChain.then(async () => {
      const prevItems = items
      const prevCount = summaryCount
      const { nextItems, result, changed = true } = mutator()
      if (!changed) return result
      const sorted = sortTextures(nextItems)
      try {
        if (mode === 'file') {
          // Disk is authoritative: do NOT push multi-MB Base64 textures into 5MB localStorage
          const res = await writeRemote(sorted)
          if (!res.ok) {
            throw new Error(`贴图库写入本地磁盘失败：${res.error || '服务不可用'}`)
          }
          items = sorted
          summaryCount = sorted.length
        } else {
          items = sorted
          summaryCount = sorted.length
          writeLocal(sorted)
          await writeRemote(sorted)
        }
      } catch (err) {
        items = prevItems
        summaryCount = prevCount
        throw err
      }
      notify()
      return result
    })
    writeChain = run.then(() => {}, () => {})
    return await run
  }

  if (!options.lazy) {
    items = readLocal()
    summaryCount = items.length
  }

  const loadFull = (): Promise<void> => {
    if (fullyLoaded) return Promise.resolve()
    if (fullLoadPromise) return fullLoadPromise
    fullLoadPromise = (async () => {
      if (options.lazy && items.length === 0) {
        items = readLocal()
      }
      if (!apiUrl || !fetcher) {
        fullyLoaded = true
        summaryCount = items.length
        return
      }
      try {
        const resp = await fetcher(apiUrl, { cache: 'no-cache' })
        if (!resp.ok) {
          fullyLoaded = true
          summaryCount = items.length
          return
        }
        const ct = resp.headers.get('content-type') || ''
        if (!ct.includes('application/json')) {
          fullyLoaded = true
          summaryCount = items.length
          return
        }
        const persistedHeader = resp.headers.get('x-persisted')
        const remoteItems = parseTextureLibrary(await resp.json())
        mode = 'file'
        fullyLoaded = true
        if (persistedHeader === '1') {
          items = remoteItems
          summaryCount = items.length
          notify()
          return
        }
        if (persistedHeader === '0') {
          if (items.length > 0) {
            await writeRemote(items)
          } else {
            items = remoteItems
          }
          summaryCount = items.length
          notify()
          return
        }
        const merged = mergeTextureLists(items, remoteItems)
        const changed = merged.length !== items.length
          || JSON.stringify(merged.map(x => [x.id, x.updatedAt, Boolean(x.normalDataUrl), Boolean(x.dataUrl)]))
            !== JSON.stringify(items.map(x => [x.id, x.updatedAt, Boolean(x.normalDataUrl), Boolean(x.dataUrl)]))
        items = merged
        summaryCount = items.length
        writeLocal(items)
        if (merged.length !== remoteItems.length || merged.some((m, i) => remoteItems[i]?.id !== m.id || remoteItems[i]?.updatedAt !== m.updatedAt)) {
          await writeRemote(items)
        }
        if (changed || mode === 'file') notify()
      } catch {
        mode = 'local'
        fullyLoaded = true
        summaryCount = items.length
      }
    })()
    return fullLoadPromise
  }

  const initPromise = options.lazy
    ? (async () => {
        if (!apiUrl || !fetcher) {
          items = readLocal()
          summaryCount = items.length
          fullyLoaded = true
          return
        }
        try {
          const sep = apiUrl.includes('?') ? '&' : '?'
          const resp = await fetcher(`${apiUrl}${sep}summary=1`, { cache: 'no-cache' })
          if (!resp.ok) {
            await loadFull()
            return
          }
          const ct = resp.headers.get('content-type') || ''
          if (!ct.includes('application/json')) {
            await loadFull()
            return
          }
          const doc = await resp.json() as { summary?: boolean; count?: number; items?: unknown[] }
          mode = 'file'
          if (doc && doc.summary === true && typeof doc.count === 'number') {
            summaryCount = doc.count
            notify()
            return
          }
          // Fallback if server doesn't support ?summary=1 (e.g. static server)
          items = parseTextureLibrary(doc)
          summaryCount = items.length
          fullyLoaded = true
          notify()
        } catch {
          items = readLocal()
          summaryCount = items.length
          mode = 'local'
          fullyLoaded = true
          notify()
        }
      })()
    : loadFull()

  return {
    get storageMode() { return mode },
    get count() { return fullyLoaded ? items.length : summaryCount },
    get isLoaded() { return fullyLoaded },
    ready: () => initPromise,
    ensureLoaded: () => loadFull(),
    list(category?: TextureCategory) {
      return category ? items.filter(x => x.category === category) : [...items]
    },
    get(id: string) {
      return items.find(x => x.id === id)
    },
    async saveNew(input: SaveTextureInput) {
      return runMutation(() => {
        const now = new Date().toISOString()
        const category = input.category ?? defaultCategoryForSlot(input.targetSlot)
        const name = input.name.trim().slice(0, 80) || '我的程序贴图'
        const graph = cloneGraph(input.graph)
        graph.name = name
        graph.category = category
        graph.targetSlot = input.targetSlot
        if (input.resolution) graph.resolution = input.resolution
        const optUrl = (u?: string) => (u && safeDataUrlRe.test(u) ? u : undefined)
        const normalDataUrl = optUrl(input.normalDataUrl)
        const heightDataUrl = optUrl(input.heightDataUrl)
        const roughnessDataUrl = optUrl(input.roughnessDataUrl)
        const entry: SavedTextureItem = {
          id: makeId(category),
          name,
          category,
          targetSlot: input.targetSlot,
          resolution: input.resolution ?? graph.resolution,
          seamless: input.seamless ?? graph.seamless,
          ...inferAtlasMeta(graph, input.atlasCols, input.atlasRows, input.atlasRegions),
          dataUrl: safeDataUrlRe.test(input.dataUrl) ? input.dataUrl : '',
          ...(normalDataUrl ? { normalDataUrl } : {}),
          ...(heightDataUrl ? { heightDataUrl } : {}),
          ...(roughnessDataUrl ? { roughnessDataUrl } : {}),
          thumbnail: safeDataUrlRe.test(input.thumbnail) ? input.thumbnail : (safeDataUrlRe.test(input.dataUrl) ? input.dataUrl : ''),
          graph,
          createdAt: now,
          updatedAt: now,
        }
        return { nextItems: [entry, ...items], result: entry }
      })
    },
    async overwrite(id: string, input: Partial<SaveTextureInput>) {
      return runMutation(() => {
        const idx = items.findIndex(x => x.id === id)
        if (idx < 0) throw new Error('找不到要覆盖更新的贴图')
        const prev = items[idx]
        const name = (input.name ?? prev.name).trim().slice(0, 80) || prev.name
        const targetSlot = input.targetSlot ?? prev.targetSlot
        const category = input.category ?? defaultCategoryForSlot(targetSlot)
        const graph = input.graph ? cloneGraph(input.graph) : cloneGraph(prev.graph)
        graph.name = name
        graph.category = category
        graph.targetSlot = targetSlot
        const nextAtlas = inferAtlasMeta(graph, input.atlasCols, input.atlasRows, input.atlasRegions)
        const keepOr = (cand?: string, old?: string) => (cand && safeDataUrlRe.test(cand) ? cand : old)
        const updated: SavedTextureItem = {
          ...prev,
          name,
          category,
          targetSlot,
          resolution: input.resolution ?? graph.resolution,
          seamless: input.seamless ?? graph.seamless,
          atlasCols: nextAtlas.atlasCols,
          atlasRows: nextAtlas.atlasRows,
          atlasRegions: nextAtlas.atlasRegions,
          dataUrl: input.dataUrl && safeDataUrlRe.test(input.dataUrl) ? input.dataUrl : prev.dataUrl,
          normalDataUrl: keepOr(input.normalDataUrl, prev.normalDataUrl),
          heightDataUrl: keepOr(input.heightDataUrl, prev.heightDataUrl),
          roughnessDataUrl: keepOr(input.roughnessDataUrl, prev.roughnessDataUrl),
          thumbnail: input.thumbnail && safeDataUrlRe.test(input.thumbnail) ? input.thumbnail : prev.thumbnail,
          graph,
          updatedAt: new Date().toISOString(),
        }
        return { nextItems: items.map((x, i) => i === idx ? updated : x), result: updated }
      })
    },
    async rename(id: string, nextName: string) {
      return runMutation(() => {
        const idx = items.findIndex(x => x.id === id)
        if (idx < 0) throw new Error('找不到要重命名的贴图')
        const name = nextName.trim().slice(0, 80)
        if (!name) throw new Error('贴图名称不能为空')
        const prev = items[idx]
        const graph = cloneGraph(prev.graph)
        graph.name = name
        const updated: SavedTextureItem = { ...prev, name, graph, updatedAt: new Date().toISOString() }
        return { nextItems: items.map((x, i) => i === idx ? updated : x), result: updated }
      })
    },
    async duplicate(id: string) {
      return runMutation(() => {
        const orig = items.find(x => x.id === id)
        if (!orig) throw new Error('找不到要复制的贴图')
        const now = new Date().toISOString()
        const name = `${orig.name} 副本`.slice(0, 80)
        const graph = cloneGraph(orig.graph)
        graph.name = name
        const copy: SavedTextureItem = {
          ...orig,
          id: makeId(orig.category),
          name,
          graph,
          createdAt: now,
          updatedAt: now,
        }
        return { nextItems: [copy, ...items], result: copy }
      })
    },
    async remove(id: string) {
      return runMutation(() => {
        const nextItems = items.filter(x => x.id !== id)
        if (nextItems.length === items.length) {
          return { nextItems: items, result: false, changed: false }
        }
        return { nextItems, result: true }
      })
    },
    exportBundle(): TextureLibraryFile {
      return { schemaVersion: 1, items: JSON.parse(JSON.stringify(items)) as SavedTextureItem[] }
    },
    async importBundle(raw: unknown) {
      return runMutation(() => {
        const parsed = parseTextureLibrary(raw)
        if (!parsed.length) throw new Error('文件中没有有效的贴图条目')
        let added = 0, updated = 0
        const map = new Map(items.map(x => [x.id, x]))
        for (const entry of parsed) {
          if (map.has(entry.id)) updated++
          else added++
          map.set(entry.id, entry)
        }
        return { nextItems: [...map.values()], result: { added, updated } }
      })
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
