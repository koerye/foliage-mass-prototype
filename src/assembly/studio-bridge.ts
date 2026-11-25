// Cross-studio live editing bridge between Scene Assembly Studio (scene.html)
// and Vegetation Studio (broadleaf.html).
// Persists the full in-progress AssemblySceneSpec draft plus target plant TreeSpec & custom textures
// across navigation, and broadcasts live updates via BroadcastChannel + storage events for multi-tab sync.
import type { LeafTextureSource } from '../ai/scene'
import type { SavedTextureMap } from '../studio/texture-serialize'
import type { TreeSpec } from '../tree/spec'
import type { LightingPreset } from '../viewport'
import type { AssemblyBarkStyle, AssemblyCategory, AssemblySceneSpec } from './spec'

const BRIDGE_KEY = 'vegetation-studio:scene-edit-bridge:v1'
const SESSION_KEY_PREFIX = 'vegetation-studio:scene-edit-session:'
const DRAFT_FALLBACK_KEY = 'vegetation-studio:scene-edit-draft-fallback:v1'
const IDB_NAME = 'vegetation-studio-scene-bridge-db'
const IDB_STORE = 'sessions'
const CHANNEL_NAME = 'vegetation-studio-scene-bridge'

function openBridgeIdb(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(undefined)
  return new Promise(resolve => {
    try {
      const req = indexedDB.open(IDB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(undefined)
    } catch {
      resolve(undefined)
    }
  })
}

async function idbPutSession(session: SceneEditBridgeSession): Promise<boolean> {
  const db = await openBridgeIdb()
  if (!db) return false
  return new Promise(resolve => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      try { db.close() } catch {}
      resolve(ok)
    }
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(session, session.sessionId)
      tx.oncomplete = () => finish(true)
      tx.onerror = () => finish(false)
      tx.onabort = () => finish(false)
    } catch {
      finish(false)
    }
  })
}

async function idbGetSession(sessionId: string): Promise<SceneEditBridgeSession | undefined> {
  const db = await openBridgeIdb()
  if (!db) return undefined
  return new Promise(resolve => {
    let settled = false
    const finish = (val: SceneEditBridgeSession | undefined) => {
      if (settled) return
      settled = true
      try { db.close() } catch {}
      resolve(val)
    }
    try {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get(sessionId)
      req.onsuccess = () => finish(req.result as SceneEditBridgeSession | undefined)
      req.onerror = () => finish(undefined)
      tx.onerror = () => finish(undefined)
      tx.onabort = () => finish(undefined)
    } catch {
      finish(undefined)
    }
  })
}

async function idbDeleteSession(sessionId: string): Promise<void> {
  const db = await openBridgeIdb()
  if (!db) return
  return new Promise(resolve => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      try { db.close() } catch {}
      resolve()
    }
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).delete(sessionId)
      tx.oncomplete = finish
      tx.onerror = finish
      tx.onabort = finish
    } catch {
      finish()
    }
  })
}

export interface ScenePlantAppearance {
  barkStyle?: AssemblyBarkStyle
  crownStyle?: 'painted'
  treeForm?: 'meadow-birch'
  leafTexture?: LeafTextureSource
  category?: AssemblyCategory
  lighting?: LightingPreset
}

export interface SceneEditBridgeSession extends ScenePlantAppearance {
  version: 1
  sessionId: string
  itemId: string
  itemName: string
  sceneName: string
  returnUrl: string
  treeSpec: TreeSpec
  customTextures?: SavedTextureMap
  sceneDraft: AssemblySceneSpec
  activeBuiltInCaseId?: string
  activeSavedSceneId?: string
  selectedId?: string
  committed?: boolean
  updatedAt: number
}

export interface SceneEditLiveMessage extends ScenePlantAppearance {
  type: 'scene-edit-live' | 'scene-edit-commit'
  sessionId: string
  itemId: string
  itemName?: string
  treeSpec: TreeSpec
  customTextures?: SavedTextureMap
  updatedAt: number
}

function makeSessionId(): string {
  return `se-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

function safeLocalStorage(): Storage | undefined {
  try { return typeof localStorage !== 'undefined' ? localStorage : undefined } catch { return undefined }
}

function safeSessionStorage(): Storage | undefined {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : undefined } catch { return undefined }
}

function postChannelMessage(msg: SceneEditLiveMessage) {
  try {
    if (typeof BroadcastChannel === 'undefined') return
    const ch = new BroadcastChannel(CHANNEL_NAME)
    ch.postMessage(msg)
    ch.close()
  } catch { /* ignore unsupported environments */ }
}

function sessionStorageKey(sessionId: string): string {
  return `${SESSION_KEY_PREFIX}${sessionId}`
}

function makeSlimSession(session: SceneEditBridgeSession): SceneEditBridgeSession {
  return {
    ...session,
    customTextures: undefined,
    sceneDraft: {
      ...session.sceneDraft,
      items: [],
      grassPaint: undefined,
      groundPaint: undefined,
      reference: undefined,
    },
  }
}

const sessionWriteChains = new Map<string, Promise<unknown>>()

function enqueueSessionOp<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionWriteChains.get(sessionId) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(fn)
  sessionWriteChains.set(sessionId, next)
  void next.finally(() => {
    if (sessionWriteChains.get(sessionId) === next) sessionWriteChains.delete(sessionId)
  })
  return next
}

function writeSessionToStorage(
  session: SceneEditBridgeSession,
  options?: { writeIdb?: boolean; hasFullBackup?: boolean },
): boolean {
  if (options?.writeIdb) void idbPutSession(session)
  const ls = safeLocalStorage()
  if (!ls) return false
  const ss = safeSessionStorage()
  const key = sessionStorageKey(session.sessionId)
  const fullJson = JSON.stringify(session)
  try {
    ls.setItem(key, fullJson)
    ls.setItem(BRIDGE_KEY, fullJson)
    try { ss?.removeItem(DRAFT_FALLBACK_KEY) } catch {}
    try { ss?.removeItem(`${DRAFT_FALLBACK_KEY}:${session.sessionId}`) } catch {}
    return true
  } catch {
    // QuotaExceededError fallback: offload full payload to sessionStorage (best-effort),
    // and write a lightweight pointer (stripped of reference/groundPaint/grassPaint/textures) to localStorage.
    // Never fake persistence success based on `typeof indexedDB !== 'undefined'`.
    let offloaded = false
    try {
      if (ss) {
        ss.setItem(`${DRAFT_FALLBACK_KEY}:${session.sessionId}`, JSON.stringify({
          sessionId: session.sessionId,
          sceneDraft: session.sceneDraft,
          customTextures: session.customTextures,
        }))
        offloaded = true
      }
    } catch {}
    let slimWritten = false
    if (offloaded || options?.hasFullBackup) {
      try {
        const slimJson = JSON.stringify(makeSlimSession(session))
        ls.setItem(key, slimJson)
        ls.setItem(BRIDGE_KEY, slimJson)
        slimWritten = true
      } catch {}
    }
    return offloaded && slimWritten
  }
}

export async function createSceneEditSessionAsync(input: CreateSceneEditSessionInput): Promise<{ session: SceneEditBridgeSession; stored: boolean }> {
  const session = buildSessionObject(input)
  const idbOk = await idbPutSession(session)
  const lsOk = writeSessionToStorage(session, { writeIdb: false, hasFullBackup: idbOk })
  return { session, stored: idbOk || lsOk }
}

function buildSessionObject(input: CreateSceneEditSessionInput): SceneEditBridgeSession {
  return {
    version: 1,
    sessionId: makeSessionId(),
    itemId: input.itemId,
    itemName: input.itemName,
    sceneName: input.sceneName,
    returnUrl: input.returnUrl || './scene.html',
    treeSpec: cloneJson(input.treeSpec),
    ...(input.customTextures && Object.keys(input.customTextures).length > 0
      ? { customTextures: cloneJson(input.customTextures) }
      : {}),
    ...(input.barkStyle ? { barkStyle: input.barkStyle } : {}),
    ...(input.crownStyle ? { crownStyle: input.crownStyle } : {}),
    ...(input.treeForm ? { treeForm: input.treeForm } : {}),
    ...(input.leafTexture ? { leafTexture: input.leafTexture } : {}),
    ...(input.category ? { category: input.category } : {}),
    ...(input.lighting ? { lighting: input.lighting } : {}),
    sceneDraft: cloneJson(input.sceneDraft),
    ...(input.activeBuiltInCaseId ? { activeBuiltInCaseId: input.activeBuiltInCaseId } : {}),
    ...(input.activeSavedSceneId ? { activeSavedSceneId: input.activeSavedSceneId } : {}),
    ...(input.selectedId ? { selectedId: input.selectedId } : {}),
    committed: false,
    updatedAt: Date.now(),
  }
}

export interface CreateSceneEditSessionInput extends ScenePlantAppearance {
  itemId: string
  itemName: string
  sceneName: string
  returnUrl?: string
  treeSpec: TreeSpec
  customTextures?: SavedTextureMap
  sceneDraft: AssemblySceneSpec
  activeBuiltInCaseId?: string
  activeSavedSceneId?: string
  selectedId?: string
}

export function createSceneEditSession(input: CreateSceneEditSessionInput): SceneEditBridgeSession {
  const session = buildSessionObject(input)
  writeSessionToStorage(session, { writeIdb: true })
  return session
}

export function loadSceneEditSession(sessionId?: string): SceneEditBridgeSession | undefined {
  const ls = safeLocalStorage()
  if (!ls) return undefined
  try {
    const raw = (sessionId ? ls.getItem(sessionStorageKey(sessionId)) : null) ?? ls.getItem(BRIDGE_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Partial<SceneEditBridgeSession>
    if (!parsed || parsed.version !== 1 || !parsed.sessionId || !parsed.itemId || !parsed.treeSpec || !parsed.sceneDraft) {
      return undefined
    }
    if (sessionId && parsed.sessionId !== sessionId) return undefined
    const session = parsed as SceneEditBridgeSession
    // Rehydrate sceneDraft & customTextures if quota fallback offloaded them to sessionStorage
    const ss = safeSessionStorage()
    if (ss && (session.sceneDraft.items.length === 0 || !session.customTextures)) {
      const fbRaw = ss.getItem(`${DRAFT_FALLBACK_KEY}:${session.sessionId}`) ?? ss.getItem(DRAFT_FALLBACK_KEY)
      if (fbRaw) {
        const fb = JSON.parse(fbRaw) as { sessionId?: string; sceneDraft?: AssemblySceneSpec; customTextures?: SavedTextureMap }
        if (fb.sessionId === session.sessionId) {
          if (fb.sceneDraft && session.sceneDraft.items.length === 0) session.sceneDraft = fb.sceneDraft
          if (fb.customTextures && !session.customTextures) session.customTextures = fb.customTextures
        }
      }
    }
    return session
  } catch {
    return undefined
  }
}

export interface SceneEditProgressUpdate {
  treeSpec: TreeSpec
  customTextures?: SavedTextureMap
  itemName?: string
  barkStyle?: AssemblyBarkStyle | null
  crownStyle?: 'painted' | null
  treeForm?: 'meadow-birch' | null
  leafTexture?: LeafTextureSource | null
  committed?: boolean
}

function hasSceneDraftPayload(draft: AssemblySceneSpec | undefined): boolean {
  if (!draft) return false
  return draft.items.length > 0 || Boolean(draft.grassPaint?.length) || Boolean(draft.groundPaint) || Boolean(draft.reference)
}

function mergeSessionUpdate(
  current: SceneEditBridgeSession,
  update: SceneEditProgressUpdate,
): SceneEditBridgeSession {
  const barkStyle = update.barkStyle === null ? undefined : (update.barkStyle ?? current.barkStyle)
  const crownStyle = update.crownStyle === null ? undefined : (update.crownStyle ?? current.crownStyle)
  const treeForm = update.treeForm === null ? undefined : (update.treeForm ?? current.treeForm)
  const leafTexture = update.leafTexture === null ? undefined : (update.leafTexture ?? current.leafTexture)
  const customTextures = update.customTextures === undefined
    ? current.customTextures
    : Object.keys(update.customTextures).length > 0
      ? cloneJson(update.customTextures)
      : undefined
  return {
    ...current,
    treeSpec: cloneJson(update.treeSpec),
    customTextures,
    itemName: update.itemName?.trim() || current.itemName,
    barkStyle,
    crownStyle,
    treeForm,
    leafTexture,
    committed: update.committed ?? current.committed,
    updatedAt: Math.max(Date.now(), (current.updatedAt ?? 0) + 1),
  }
}

function broadcastSessionProgress(next: SceneEditBridgeSession) {
  postChannelMessage({
    type: next.committed ? 'scene-edit-commit' : 'scene-edit-live',
    sessionId: next.sessionId,
    itemId: next.itemId,
    itemName: next.itemName,
    treeSpec: next.treeSpec,
    customTextures: next.customTextures,
    barkStyle: next.barkStyle,
    crownStyle: next.crownStyle,
    treeForm: next.treeForm,
    leafTexture: next.leafTexture,
    updatedAt: next.updatedAt,
  })
}

export async function loadSceneEditSessionAsync(sessionId?: string): Promise<SceneEditBridgeSession | undefined> {
  const sync = loadSceneEditSession(sessionId)
  const targetId = sessionId || sync?.sessionId
  if (targetId) {
    const fromIdb = await idbGetSession(targetId)
    if (fromIdb && fromIdb.version === 1 && fromIdb.sessionId === targetId) {
      if (!sync || (fromIdb.updatedAt ?? 0) >= (sync.updatedAt ?? 0)) return fromIdb
      // Sync pointer is newer (e.g. updated treeSpec) while IDB holds full heavy sceneDraft / customTextures
      return {
        ...fromIdb,
        ...sync,
        sceneDraft: hasSceneDraftPayload(sync.sceneDraft) ? sync.sceneDraft : fromIdb.sceneDraft,
        customTextures: sync.customTextures ?? fromIdb.customTextures,
      }
    }
  }
  return sync
}

export async function saveSceneEditProgressAsync(
  sessionId: string,
  update: SceneEditProgressUpdate,
): Promise<boolean> {
  return enqueueSessionOp(sessionId, async () => {
    const current = await loadSceneEditSessionAsync(sessionId)
    if (!current) return false
    const next = mergeSessionUpdate(current, update)
    const idbOk = await idbPutSession(next)
    const lsOk = writeSessionToStorage(next, { writeIdb: false, hasFullBackup: idbOk })
    const ok = idbOk || lsOk
    if (ok) broadcastSessionProgress(next)
    return ok
  })
}

export function saveSceneEditProgress(
  sessionId: string,
  update: SceneEditProgressUpdate,
): SceneEditBridgeSession | undefined {
  const current = loadSceneEditSession(sessionId)
  if (!current) {
    // Session may reside exclusively in IndexedDB (e.g. when localStorage hit quota)
    void saveSceneEditProgressAsync(sessionId, update)
    return undefined
  }
  const next = mergeSessionUpdate(current, update)
  if (!hasSceneDraftPayload(current.sceneDraft)) {
    // Avoid overwriting full IndexedDB sceneDraft/customTextures with a slim localStorage shell
    writeSessionToStorage(next, { writeIdb: false, hasFullBackup: true })
    void enqueueSessionOp(sessionId, async () => {
      const fromIdb = await idbGetSession(sessionId)
      if (!fromIdb) return
      const merged = mergeSessionUpdate(fromIdb, update)
      merged.updatedAt = Math.max(merged.updatedAt, next.updatedAt)
      await idbPutSession(merged)
    })
  } else {
    writeSessionToStorage(next, { writeIdb: false })
    void enqueueSessionOp(sessionId, () => idbPutSession(next))
  }
  broadcastSessionProgress(next)
  return next
}

export function clearSceneEditSession(sessionId?: string) {
  const ls = safeLocalStorage()
  if (sessionId) void idbDeleteSession(sessionId)
  if (!ls) return
  if (sessionId) {
    try { ls.removeItem(sessionStorageKey(sessionId)) } catch {}
    try { safeSessionStorage()?.removeItem(`${DRAFT_FALLBACK_KEY}:${sessionId}`) } catch {}
    const cur = loadSceneEditSession()
    if (cur && cur.sessionId !== sessionId) return
  }
  try {
    ls.removeItem(BRIDGE_KEY)
    safeSessionStorage()?.removeItem(DRAFT_FALLBACK_KEY)
  } catch { /* ignore */ }
}

/** Subscribes to live plant edit updates coming from Vegetation Studio (across tabs via BroadcastChannel + storage). */
export function subscribeSceneEditUpdates(handler: (msg: SceneEditLiveMessage) => void): () => void {
  let channel: BroadcastChannel | undefined
  let lastTimestamp = 0

  const dispatch = (msg: SceneEditLiveMessage) => {
    if (!msg || !msg.itemId || !msg.treeSpec) return
    if (msg.updatedAt && msg.updatedAt <= lastTimestamp) return
    lastTimestamp = msg.updatedAt || Date.now()
    handler(msg)
  }

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL_NAME)
      channel.onmessage = ev => {
        const data = ev.data as Partial<SceneEditLiveMessage> | undefined
        if (data && (data.type === 'scene-edit-live' || data.type === 'scene-edit-commit') && data.itemId && data.treeSpec) {
          dispatch(data as SceneEditLiveMessage)
        }
      }
    }
  } catch { /* ignore */ }

  const onStorage = (ev: StorageEvent) => {
    if (ev.key !== BRIDGE_KEY || !ev.newValue) return
    try {
      const parsed = JSON.parse(ev.newValue) as Partial<SceneEditBridgeSession>
      if (parsed && parsed.sessionId && parsed.itemId && parsed.treeSpec) {
        dispatch({
          type: parsed.committed ? 'scene-edit-commit' : 'scene-edit-live',
          sessionId: parsed.sessionId,
          itemId: parsed.itemId,
          itemName: parsed.itemName,
          treeSpec: parsed.treeSpec,
          customTextures: parsed.customTextures,
          barkStyle: parsed.barkStyle,
          crownStyle: parsed.crownStyle,
          treeForm: parsed.treeForm,
          leafTexture: parsed.leafTexture,
          updatedAt: parsed.updatedAt ?? Date.now(),
        })
      }
    } catch { /* ignore */ }
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)

  return () => {
    try { channel?.close() } catch { /* ignore */ }
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}
