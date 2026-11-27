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
  // Preserve IDs belonging to other workbenches (e.g. Rock Studio vs AI Studio) sharing `/api/hidden-showcases`!
  let foreignIds: string[] = []
  let mode: StorageMode = 'local'
  const listeners = new Set<() => void>()

  const notify = () => { for (const fn of listeners) fn() }

  const extractRawArray = (raw: unknown): string[] => {
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
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
    return out
  }

  const parseList = (raw: unknown): string[] => extractRawArray(raw).filter(id => validSet.has(id))

  const mergeWithForeign = (ids: readonly string[]): string[] => {
    const out: string[] = []
    const seen = new Set<string>()
    for (const id of [...foreignIds, ...ids]) {
      if (!id || seen.has(id)) continue
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

  const writeLocal = (ids: readonly string[] = [...hidden]) => {
    if (!storage) return
    try {
      storage.setItem(storageKey, JSON.stringify({ schemaVersion: 1, hiddenIds: [...ids] }))
    } catch {
      // Ignore quota failures when disk persistence is active
    }
  }

  const writeRemote = async (ids: readonly string[]): Promise<{ ok: boolean; error?: string }> => {
    if (!apiUrl || !fetcher) return { ok: false }
    try {
      const resp = await fetcher(apiUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 1, hiddenIds: mergeWithForeign(ids) }),
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

  const persistSnapshot = async (snapshot: string[]) => {
    if (mode === 'file') {
      const res = await writeRemote(snapshot)
      if (!res.ok) throw new Error(`内置案例隐藏状态写入本地磁盘失败：${res.error || '服务不可用'}`)
      writeLocal(snapshot)
    } else {
      writeLocal(snapshot)
      await writeRemote(snapshot)
    }
    notify()
  }

  const mutateWithRollback = <T>(apply: () => { changed: boolean; result: T }): Promise<T> =>
    runSerialized(async () => {
      const prev = [...hidden]
      const { changed, result } = apply()
      if (!changed) return result
      try {
        await persistSnapshot([...hidden])
      } catch (err) {
        hidden.clear()
        for (const id of prev) hidden.add(id)
        throw err
      }
      return result
    })

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
        const allRemote = extractRawArray(doc.hiddenIds)
        foreignIds = allRemote.filter(id => !validSet.has(id))
        const nextIds = allRemote.filter(id => validSet.has(id))
        const prevSnap = JSON.stringify([...hidden])
        hidden.clear()
        for (const id of nextIds) hidden.add(id)
        writeLocal()
        if (JSON.stringify([...hidden]) !== prevSnap) notify()
      } else if (hidden.size > 0) {
        await writeRemote([...hidden])
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
      return mutateWithRollback(() => {
        if (!validSet.has(id) || hidden.has(id)) return { changed: false, result: false }
        hidden.add(id)
        return { changed: true, result: true }
      })
    },
    async restore(id: string) {
      await initPromise
      return mutateWithRollback(() => {
        if (!hidden.has(id)) return { changed: false, result: false }
        hidden.delete(id)
        return { changed: true, result: true }
      })
    },
    async restoreAll() {
      await initPromise
      return mutateWithRollback(() => {
        const count = hidden.size
        if (count === 0) return { changed: false, result: 0 }
        hidden.clear()
        return { changed: true, result: count }
      })
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
