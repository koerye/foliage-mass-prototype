// Persistent visibility store for built-in AI Showcase Case Library entries.
// Allows deleting built-in showcase items from the AI case library and restoring them later,
// persisted to `<project>/user-presets/hidden-showcases.json` via `/api/hidden-showcases`
// with synchronous localStorage mirroring & offline fallback.
import type { StorageLike, StorageMode } from '../studio/preset-store'

export interface HiddenShowcaseStoreOptions {
  validIds: readonly string[]
  storageKey?: string
  storage?: StorageLike | null
  apiUrl?: string | null
  fetcher?: typeof fetch
}

export interface HiddenShowcaseStore {
  readonly storageMode: StorageMode
  ready(): Promise<void>
  isHidden(id: string): boolean
  hiddenIds(): ReadonlySet<string>
  listHiddenIds(): string[]
  hiddenCount(): number
  hide(id: string): Promise<boolean>
  restore(id: string): Promise<boolean>
  restoreAll(): Promise<number>
  subscribe(listener: () => void): () => void
}

export function createHiddenShowcaseStore(options: HiddenShowcaseStoreOptions): HiddenShowcaseStore {
  const validSet = new Set<string>(options.validIds)
  const storageKey = options.storageKey ?? 'vegetation-studio:ai-hidden-showcases:v1'
  const storage: StorageLike | null = options.storage !== undefined
    ? options.storage
    : (typeof localStorage !== 'undefined' ? localStorage : null)
  const apiUrl = options.apiUrl !== undefined ? options.apiUrl : '/api/hidden-showcases'
  const fetcher = options.fetcher ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined)

  const hidden = new Set<string>()
  let mode: StorageMode = 'local'
  const listeners = new Set<() => void>()

  const notify = () => { for (const fn of listeners) fn() }

  const parseList = (raw: unknown): string[] => {
    const arr = Array.isArray(raw)
      ? raw
      : (raw && typeof raw === 'object' && Array.isArray((raw as { hiddenIds?: unknown }).hiddenIds)
        ? (raw as { hiddenIds: unknown[] }).hiddenIds
        : [])
    const out: string[] = []
    const seen = new Set<string>()
    for (const item of arr) {
      if (typeof item !== 'string') continue
      const id = item.trim()
      if (!validSet.has(id) || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
    return out
  }

  const readLocal = (): string[] => {
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
      storage.setItem(storageKey, JSON.stringify({ schemaVersion: 1, hiddenIds: [...hidden] }))
    } catch {
      // Ignore quota failures when disk persistence is active
    }
  }

  const writeRemote = async (): Promise<boolean> => {
    if (!apiUrl || !fetcher) return false
    try {
      const resp = await fetcher(apiUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 1, hiddenIds: [...hidden] }),
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

  // Hydrate synchronously from localStorage for zero-flicker initial render
  for (const id of readLocal()) hidden.add(id)

  const initPromise = (async () => {
    if (!apiUrl || !fetcher) return
    try {
      const resp = await fetcher(apiUrl, { cache: 'no-store' })
      if (!resp.ok) return
      const ct = resp.headers.get('content-type') || ''
      if (!ct.includes('application/json')) return
      const doc = (await resp.json()) as { persisted?: boolean; hiddenIds?: unknown }
      mode = 'file'
      if (doc.persisted) {
        const nextIds = parseList(doc.hiddenIds)
        const prevSnap = JSON.stringify([...hidden])
        hidden.clear()
        for (const id of nextIds) hidden.add(id)
        writeLocal()
        if (JSON.stringify([...hidden]) !== prevSnap) notify()
      } else if (hidden.size > 0) {
        await writeRemote()
      }
    } catch {
      mode = 'local'
    }
  })()

  return {
    get storageMode() { return mode },
    ready: () => initPromise,
    isHidden: (id: string) => hidden.has(id),
    hiddenIds: () => new Set(hidden),
    listHiddenIds: () => [...hidden],
    hiddenCount: () => hidden.size,
    async hide(id: string) {
      await initPromise
      if (!validSet.has(id) || hidden.has(id)) return false
      hidden.add(id)
      await persist()
      return true
    },
    async restore(id: string) {
      await initPromise
      if (!hidden.has(id)) return false
      hidden.delete(id)
      await persist()
      return true
    },
    async restoreAll() {
      await initPromise
      const count = hidden.size
      if (count === 0) return 0
      hidden.clear()
      await persist()
      return count
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
