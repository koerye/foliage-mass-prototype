// Persistent built-in default preset override store shared by Rock Studio & Classic Tree Studio.
// Saves user-customized built-in preset defaults to `<project>/user-presets/default-overrides.json`
// via `/api/default-presets` with synchronous localStorage mirroring & offline fallback,
// while keeping built-in factory presets intact for one-click "恢复出厂".
import type { StorageLike, StorageMode } from './preset-store'

export type DefaultOverrideScope = 'rock' | 'tree'

export interface DefaultOverrideStoreOptions<Id extends string, Spec> {
  scope: DefaultOverrideScope
  validIds: readonly Id[]
  parse: (raw: unknown, id: Id) => Spec
  /** Optional localStorage-only slimmer used when full payloads (e.g. embedded PBR textures) exceed browser quota. */
  slimForLocal?: (value: Spec) => Spec
  storageKey?: string
  storage?: StorageLike | null
  apiUrl?: string | null
  fetcher?: typeof fetch
}

export interface DefaultOverrideStore<Id extends string, Spec> {
  readonly storageMode: StorageMode
  ready(): Promise<void>
  has(id: Id): boolean
  get(id: Id): Spec | undefined
  listIds(): Id[]
  save(id: Id, spec: Spec): Promise<Spec>
  resetOne(id: Id): Promise<boolean>
  resetAll(): Promise<void>
  subscribe(listener: () => void): () => void
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function createDefaultOverrideStore<Id extends string, Spec>(
  options: DefaultOverrideStoreOptions<Id, Spec>,
): DefaultOverrideStore<Id, Spec> {
  const { scope, validIds, parse } = options
  const validSet = new Set<string>(validIds)
  const storageKey = options.storageKey ?? `vegetation-studio:default-overrides:${scope}:v1`
  const storage: StorageLike | null = options.storage !== undefined
    ? options.storage
    : (typeof localStorage !== 'undefined' ? localStorage : null)
  const apiUrl = options.apiUrl !== undefined ? options.apiUrl : '/api/default-presets'
  const fetcher = options.fetcher ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined)

  const map = new Map<Id, Spec>()
  let mode: StorageMode = 'local'
  const listeners = new Set<() => void>()

  const notify = () => { for (const fn of listeners) fn() }

  const parseRecord = (raw: unknown): Map<Id, Spec> => {
    const out = new Map<Id, Spec>()
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!validSet.has(k)) continue
      try {
        out.set(k as Id, parse(v, k as Id))
      } catch {
        // Ignore corrupted individual entry
      }
    }
    return out
  }

  const serializeMap = (): Record<string, Spec> => {
    const out: Record<string, Spec> = {}
    for (const [k, v] of map.entries()) out[k] = cloneJson(v)
    return out
  }

  const readLocal = () => {
    if (!storage) return new Map<Id, Spec>()
    try {
      const text = storage.getItem(storageKey)
      if (!text) return new Map<Id, Spec>()
      const parsed = JSON.parse(text)
      return parseRecord(parsed && typeof parsed === 'object' && 'overrides' in parsed ? parsed.overrides : parsed)
    } catch {
      return new Map<Id, Spec>()
    }
  }

  const writeLocal = () => {
    if (!storage) return
    try {
      storage.setItem(storageKey, JSON.stringify({ schemaVersion: 1, overrides: serializeMap() }))
    } catch {
      if (options.slimForLocal) {
        try {
          const slimmed: Record<string, Spec> = {}
          for (const [k, v] of map.entries()) slimmed[k] = options.slimForLocal(cloneJson(v))
          storage.setItem(storageKey, JSON.stringify({ schemaVersion: 1, overrides: slimmed }))
        } catch {
          // Ignore quota failure when disk file persistence is active
        }
      }
    }
  }

  const writeRemote = async (): Promise<boolean> => {
    if (!apiUrl || !fetcher) return false
    try {
      const resp = await fetcher(apiUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 1, scope, overrides: serializeMap() }),
      })
      if (resp.ok) {
        mode = 'file'
        return true
      }
    } catch {
      // Offline / static fallback to localStorage
    }
    return false
  }

  const persist = async () => {
    writeLocal()
    await writeRemote()
    notify()
  }

  // Hydrate synchronously from localStorage for zero-flicker boot
  for (const [k, v] of readLocal().entries()) map.set(k, v)

  const initPromise = (async () => {
    if (!apiUrl || !fetcher) return
    try {
      const resp = await fetcher(apiUrl, { cache: 'no-store' })
      if (!resp.ok) return
      const ct = resp.headers.get('content-type') || ''
      if (!ct.includes('application/json')) return
      const doc = (await resp.json()) as { persisted?: boolean; rock?: unknown; tree?: unknown }
      mode = 'file'
      const remoteMap = parseRecord(doc[scope])
      if (doc.persisted) {
        // Disk file exists -> disk is authoritative across browsers & tabs
        const prevSnap = JSON.stringify(serializeMap())
        map.clear()
        for (const [k, v] of remoteMap.entries()) map.set(k, v)
        writeLocal()
        if (JSON.stringify(serializeMap()) !== prevSnap) notify()
      } else if (map.size > 0) {
        // Disk file not created yet, push offline localStorage overrides up to disk
        await writeRemote()
      }
    } catch {
      mode = 'local'
    }
  })()

  return {
    get storageMode() { return mode },
    ready: () => initPromise,
    has(id: Id) { return map.has(id) },
    get(id: Id) {
      const hit = map.get(id)
      return hit ? cloneJson(hit) : undefined
    },
    listIds() { return [...map.keys()] },
    async save(id: Id, spec: Spec) {
      await initPromise
      if (!validSet.has(id)) throw new Error(`未知内置预设 ID：${id}`)
      const clean = parse(cloneJson(spec), id)
      map.set(id, clean)
      await persist()
      return cloneJson(clean)
    },
    async resetOne(id: Id) {
      await initPromise
      if (!map.has(id)) return false
      map.delete(id)
      await persist()
      return true
    },
    async resetAll() {
      await initPromise
      if (map.size === 0) return
      map.clear()
      await persist()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
