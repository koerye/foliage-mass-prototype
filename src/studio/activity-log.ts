// Unified User Action & Diagnostic Logger for Vegetation Studio (broadleaf / ai / rock).
// Captures step-by-step user interactions, semantic studio events, deep GLB export / texture
// diagnostics (pre-export material/texture inspection + post-export binary GLB validation),
// environment/WebGL/canvas capabilities, and runtime warnings/errors.

export type LogLevel = 'action' | 'info' | 'export' | 'warn' | 'error'

export type LogCategory =
  | 'env'
  | 'ui'
  | 'param'
  | 'preset'
  | 'texture'
  | 'scene'
  | 'export'
  | 'system'

export interface ActivityLogEntry {
  seq: number
  ts: string
  elapsedMs: number
  page: string
  level: LogLevel
  category: LogCategory
  message: string
  detail?: unknown
}

export interface CanvasBlobProbe {
  tested: boolean
  pngOk: boolean
  pngBytes: number
  pngMime: string
  webpOk: boolean
  webpBytes: number
  error?: string
}

export interface EnvironmentSnapshot {
  capturedAt: string
  page: string
  url: string
  userAgent: string
  platform: string
  language: string
  browser: string
  isSafari: boolean
  isIOS: boolean
  devicePixelRatio: number
  viewport: string
  webgl: {
    available: boolean
    version?: string
    renderer?: string
    vendor?: string
    maxTextureSize?: number
  }
  capabilities: {
    hasCanvasToBlob: boolean
    hasOffscreenCanvas: boolean
    hasImageBitmap: boolean
    hasFileReader: boolean
    hasCreateObjectURL: boolean
    hasClipboard: boolean
  }
  canvasProbe: CanvasBlobProbe
}

export interface GlbImageDiagnostic {
  index: number
  mimeType: string
  bufferView?: number
  byteLength: number
  hasUri: boolean
  uriPrefix?: string
  magic: 'PNG' | 'JPEG' | 'WEBP' | 'URI' | 'EMPTY' | 'MISSING' | 'UNKNOWN'
}

export interface GlbMaterialDiagnostic {
  index: number
  name: string
  alphaMode: string
  doubleSided: boolean
  hasBaseColorTex: boolean
  baseColorTexIndex?: number
  hasNormalTex: boolean
  normalTexIndex?: number
  hasOcclusionTex: boolean
  occlusionTexIndex?: number
  hasMetallicRoughnessTex: boolean
  metallicRoughnessTexIndex?: number
  hasEmissiveTex: boolean
}

export interface GlbBinaryDiagnostic {
  valid: boolean
  error?: string
  version: number
  totalBytes: number
  jsonChunkBytes: number
  binChunkBytes: number
  meshCount: number
  materialCount: number
  textureCount: number
  imageCount: number
  bufferViewCount: number
  extensionsUsed: string[]
  extensionsRequired: string[]
  materials: GlbMaterialDiagnostic[]
  images: GlbImageDiagnostic[]
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export interface ActivityLogOptions {
  maxEntries?: number
  storageKey?: string
  storage?: StorageLike | null
}

export interface ActivityLogStore {
  getPage(): string
  setPage(page: string): void
  getEnv(): EnvironmentSnapshot | undefined
  setEnv(env: EnvironmentSnapshot): void
  log(level: LogLevel, category: LogCategory, message: string, detail?: unknown): ActivityLogEntry
  action(message: string, detail?: unknown, category?: LogCategory): ActivityLogEntry
  info(category: LogCategory, message: string, detail?: unknown): ActivityLogEntry
  exportStep(message: string, detail?: unknown, level?: 'export' | 'info' | 'warn' | 'error'): ActivityLogEntry
  warn(category: LogCategory, message: string, detail?: unknown): ActivityLogEntry
  error(category: LogCategory, message: string, detail?: unknown): ActivityLogEntry
  entries(): readonly ActivityLogEntry[]
  counts(): { total: number; actions: number; exports: number; warns: number; errors: number }
  clear(): void
  subscribe(listener: (entry?: ActivityLogEntry) => void): () => void
  exportJson(): string
  exportText(): string
}

const DEFAULT_STORAGE_KEY = 'vegetation-studio:activity-log:v1'
const DEFAULT_MAX_ENTRIES = 1500
const PERSIST_MAX_ENTRIES = 320

function safeCloneDetail(value: unknown, depth = 0, seen?: WeakSet<object>): unknown {
  if (value === undefined || value === null) return value
  if (typeof value === 'string') return value.length > 2000 ? value.slice(0, 2000) + '…(truncated)' : value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'boolean') return value
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'function') return `[Function ${(value as { name?: string }).name || 'anonymous'}]`
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack.split('\n').slice(0, 8).join('\n') } : {}),
    }
  }
  if (depth >= 5) return '[MaxDepth]'
  if (typeof value === 'object') {
    const obj = value as object
    const refs = seen ?? new WeakSet<object>()
    if (refs.has(obj)) return '[Circular]'
    refs.add(obj)
    if (Array.isArray(obj)) {
      const cap = 48
      const out = obj.slice(0, cap).map(item => safeCloneDetail(item, depth + 1, refs))
      if (obj.length > cap) out.push(`…(+${obj.length - cap} more)`)
      return out
    }
    if (ArrayBuffer.isView(obj)) {
      return `${obj.constructor.name}(${(obj as Uint8Array).byteLength}B)`
    }
    if (obj instanceof ArrayBuffer) {
      return `ArrayBuffer(${obj.byteLength}B)`
    }
    const out: Record<string, unknown> = {}
    const entries = Object.entries(obj as Record<string, unknown>)
    const cap = 40
    for (let i = 0; i < Math.min(entries.length, cap); i++) {
      const [k, v] = entries[i]
      if (v === undefined) continue
      out[k] = safeCloneDetail(v, depth + 1, refs)
    }
    if (entries.length > cap) out['__moreKeys'] = entries.length - cap
    return out
  }
  return String(value)
}

export function detectBrowserInfo(ua: string): { browser: string; isSafari: boolean; isIOS: boolean } {
  const s = ua || ''
  const isIOS = /iPad|iPhone|iPod/i.test(s) || (/Macintosh/i.test(s) && /Mobile/i.test(s))
  const hasSafariToken = /Safari/i.test(s)
  const isOtherChromiumOrGecko = /Chrome|Chromium|CriOS|Edg|EdgiOS|OPR|OPT|Firefox|FxiOS|SamsungBrowser|DuckDuckGo/i.test(s)
  const isSafari = (hasSafariToken && !isOtherChromiumOrGecko) || (isIOS && /AppleWebKit/i.test(s) && !/CriOS|FxiOS|EdgiOS/i.test(s))

  let browser = 'Unknown'
  const match = (re: RegExp, label: string) => {
    const m = s.match(re)
    return m ? `${label} ${m[1]}` : undefined
  }
  browser =
    match(/Edg(?:iOS|A)?\/([\d.]+)/i, 'Edge') ||
    match(/OPR\/([\d.]+)/i, 'Opera') ||
    match(/Firefox\/([\d.]+)/i, 'Firefox') ||
    match(/FxiOS\/([\d.]+)/i, 'Firefox iOS') ||
    match(/CriOS\/([\d.]+)/i, 'Chrome iOS') ||
    match(/Chrome\/([\d.]+)/i, 'Chrome') ||
    (isSafari ? (match(/Version\/([\d.]+)/i, 'Safari') || 'Safari (WebKit)') : undefined) ||
    (s ? s.slice(0, 48) : 'Non-browser')

  return { browser, isSafari, isIOS }
}

function detectMagic(bytes: Uint8Array): GlbImageDiagnostic['magic'] {
  if (bytes.byteLength === 0) return 'EMPTY'
  if (bytes.byteLength >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'PNG'
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'JPEG'
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'WEBP'
  return 'UNKNOWN'
}

/** Parses a binary GLB (.glb) ArrayBuffer to inspect the exact glTF 2.0 JSON chunk and embedded image slices.
 *  Used immediately after GLTFExporter.parseAsync() to verify whether textures actually landed inside the GLB. */
export function inspectGlbBinary(bytes: ArrayBuffer): GlbBinaryDiagnostic {
  const empty = (error: string): GlbBinaryDiagnostic => ({
    valid: false,
    error,
    version: 0,
    totalBytes: bytes?.byteLength ?? 0,
    jsonChunkBytes: 0,
    binChunkBytes: 0,
    meshCount: 0,
    materialCount: 0,
    textureCount: 0,
    imageCount: 0,
    bufferViewCount: 0,
    extensionsUsed: [],
    extensionsRequired: [],
    materials: [],
    images: [],
  })

  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 20) {
    return empty(`GLB 缓冲区过小 (${bytes?.byteLength ?? 0} B)`)
  }

  const dv = new DataView(bytes)
  const magic = dv.getUint32(0, true)
  if (magic !== 0x46546c67) {
    return empty(`无效 GLB 文件头 magic=0x${magic.toString(16)}`)
  }
  const version = dv.getUint32(4, true)
  const declaredLen = dv.getUint32(8, true)
  const jsonLen = dv.getUint32(12, true)
  const jsonType = dv.getUint32(16, true)
  if (jsonType !== 0x4e4f534a || 20 + jsonLen > bytes.byteLength) {
    return empty(`无效 JSON chunk (type=0x${jsonType.toString(16)}, len=${jsonLen})`)
  }

  let doc: Record<string, unknown>
  try {
    const jsonBytes = new Uint8Array(bytes, 20, jsonLen)
    const text = new TextDecoder('utf-8').decode(jsonBytes)
    doc = JSON.parse(text) as Record<string, unknown>
  } catch (err) {
    return empty(`GLB JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`)
  }

  let binOffset = -1
  let binLen = 0
  const secondChunkOffset = 20 + jsonLen
  if (secondChunkOffset + 8 <= bytes.byteLength) {
    const cLen = dv.getUint32(secondChunkOffset, true)
    const cType = dv.getUint32(secondChunkOffset + 4, true)
    if (cType === 0x004e4942) {
      binOffset = secondChunkOffset + 8
      binLen = Math.min(cLen, Math.max(0, bytes.byteLength - binOffset))
    }
  }

  const meshes = Array.isArray(doc.meshes) ? doc.meshes : []
  const rawMats = Array.isArray(doc.materials) ? doc.materials as Record<string, unknown>[] : []
  const rawTextures = Array.isArray(doc.textures) ? doc.textures : []
  const rawImages = Array.isArray(doc.images) ? doc.images as Record<string, unknown>[] : []
  const rawBufferViews = Array.isArray(doc.bufferViews) ? doc.bufferViews as Record<string, unknown>[] : []

  const materials: GlbMaterialDiagnostic[] = rawMats.map((m, index) => {
    const pbr = (m.pbrMetallicRoughness && typeof m.pbrMetallicRoughness === 'object'
      ? m.pbrMetallicRoughness
      : {}) as Record<string, unknown>
    const baseTex = pbr.baseColorTexture as { index?: number } | undefined
    const mrTex = pbr.metallicRoughnessTexture as { index?: number } | undefined
    const normTex = m.normalTexture as { index?: number } | undefined
    const occTex = m.occlusionTexture as { index?: number } | undefined
    const emTex = m.emissiveTexture as { index?: number } | undefined
    return {
      index,
      name: typeof m.name === 'string' && m.name ? m.name : `Material_${index}`,
      alphaMode: typeof m.alphaMode === 'string' ? m.alphaMode : 'OPAQUE',
      doubleSided: Boolean(m.doubleSided),
      hasBaseColorTex: typeof baseTex?.index === 'number',
      ...(typeof baseTex?.index === 'number' ? { baseColorTexIndex: baseTex.index } : {}),
      hasNormalTex: typeof normTex?.index === 'number',
      ...(typeof normTex?.index === 'number' ? { normalTexIndex: normTex.index } : {}),
      hasOcclusionTex: typeof occTex?.index === 'number',
      ...(typeof occTex?.index === 'number' ? { occlusionTexIndex: occTex.index } : {}),
      hasMetallicRoughnessTex: typeof mrTex?.index === 'number',
      ...(typeof mrTex?.index === 'number' ? { metallicRoughnessTexIndex: mrTex.index } : {}),
      hasEmissiveTex: typeof emTex?.index === 'number',
    }
  })

  const images: GlbImageDiagnostic[] = rawImages.map((img, index) => {
    const mimeType = typeof img.mimeType === 'string' ? img.mimeType : 'unknown'
    const uri = typeof img.uri === 'string' ? img.uri : undefined
    const bvIndex = typeof img.bufferView === 'number' ? img.bufferView : undefined
    if (bvIndex !== undefined) {
      const bv = rawBufferViews[bvIndex]
      const bvOffset = typeof bv?.byteOffset === 'number' ? bv.byteOffset : 0
      const bvLen = typeof bv?.byteLength === 'number' ? bv.byteLength : 0
      if (binOffset >= 0 && bvOffset + bvLen <= binLen && bvLen > 0) {
        const headLen = Math.min(16, bvLen)
        const head = new Uint8Array(bytes, binOffset + bvOffset, headLen)
        return {
          index,
          mimeType,
          bufferView: bvIndex,
          byteLength: bvLen,
          hasUri: Boolean(uri),
          magic: detectMagic(head),
        }
      }
      return {
        index,
        mimeType,
        bufferView: bvIndex,
        byteLength: bvLen,
        hasUri: Boolean(uri),
        magic: bvLen === 0 ? 'EMPTY' : 'MISSING',
      }
    }
    if (uri) {
      return {
        index,
        mimeType,
        byteLength: uri.length,
        hasUri: true,
        uriPrefix: uri.slice(0, 36),
        magic: 'URI',
      }
    }
    return {
      index,
      mimeType,
      byteLength: 0,
      hasUri: false,
      magic: 'MISSING',
    }
  })

  return {
    valid: declaredLen <= bytes.byteLength,
    version,
    totalBytes: bytes.byteLength,
    jsonChunkBytes: jsonLen,
    binChunkBytes: binLen,
    meshCount: meshes.length,
    materialCount: materials.length,
    textureCount: rawTextures.length,
    imageCount: images.length,
    bufferViewCount: rawBufferViews.length,
    extensionsUsed: Array.isArray(doc.extensionsUsed) ? doc.extensionsUsed.map(String) : [],
    extensionsRequired: Array.isArray(doc.extensionsRequired) ? doc.extensionsRequired.map(String) : [],
    materials,
    images,
  }
}

export function formatTimeShort(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(11, 23)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

export function formatLogText(entries: readonly ActivityLogEntry[], env?: EnvironmentSnapshot): string {
  const lines: string[] = []
  lines.push('=== Vegetation Studio 操作与诊断日志 ===')
  lines.push(`导出时间: ${new Date().toISOString()}`)
  lines.push(`日志条数: ${entries.length}`)
  if (env) {
    lines.push(`页面: ${env.page} (${env.url})`)
    lines.push(`浏览器: ${env.browser} | Safari=${env.isSafari} | iOS=${env.isIOS} | DPR=${env.devicePixelRatio} | 视口=${env.viewport}`)
    lines.push(`UA: ${env.userAgent}`)
    lines.push(`WebGL: available=${env.webgl.available} | renderer=${env.webgl.renderer ?? '-'} | maxTex=${env.webgl.maxTextureSize ?? '-'}`)
    lines.push(
      `Canvas探针: pngOk=${env.canvasProbe.pngOk} (${env.canvasProbe.pngBytes}B ${env.canvasProbe.pngMime})` +
      ` | webpOk=${env.canvasProbe.webpOk} (${env.canvasProbe.webpBytes}B)` +
      ` | OffscreenCanvas=${env.capabilities.hasOffscreenCanvas} | ImageBitmap=${env.capabilities.hasImageBitmap}`,
    )
  }
  lines.push('----------------------------------------')
  for (const e of entries) {
    const lvl = e.level.toUpperCase().padEnd(6, ' ')
    lines.push(`#${String(e.seq).padStart(4, '0')} [${formatTimeShort(e.ts)}] [${e.page}] [${lvl}] [${e.category}] ${e.message}`)
    if (e.detail !== undefined) {
      try {
        lines.push('    detail: ' + JSON.stringify(e.detail))
      } catch {
        lines.push('    detail: [Unserializable]')
      }
    }
  }
  return lines.join('\n')
}

export function createActivityLog(options: ActivityLogOptions = {}): ActivityLogStore {
  const maxEntries = Math.max(50, options.maxEntries ?? DEFAULT_MAX_ENTRIES)
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY
  const storage: StorageLike | null = options.storage !== undefined
    ? options.storage
    : (typeof sessionStorage !== 'undefined' ? sessionStorage : null)

  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  let currentPage = 'studio'
  let envSnapshot: EnvironmentSnapshot | undefined
  let seq = 0
  let list: ActivityLogEntry[] = []
  const listeners = new Set<(entry?: ActivityLogEntry) => void>()

  // Hydrate previous entries from current browser tab session so cross-page switches & refreshes keep full history
  if (storage) {
    try {
      const raw = storage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as { entries?: unknown[]; seq?: number }
        if (Array.isArray(parsed?.entries)) {
          const valid: ActivityLogEntry[] = []
          for (const item of parsed.entries) {
            if (!item || typeof item !== 'object') continue
            const r = item as Partial<ActivityLogEntry>
            if (typeof r.message !== 'string' || typeof r.ts !== 'string') continue
            valid.push({
              seq: typeof r.seq === 'number' && Number.isFinite(r.seq) ? r.seq : valid.length + 1,
              ts: r.ts,
              elapsedMs: typeof r.elapsedMs === 'number' ? r.elapsedMs : 0,
              page: typeof r.page === 'string' ? r.page : 'studio',
              level: (['action', 'info', 'export', 'warn', 'error'].includes(String(r.level)) ? r.level : 'info') as LogLevel,
              category: (['env', 'ui', 'param', 'preset', 'texture', 'scene', 'export', 'system'].includes(String(r.category))
                ? r.category
                : 'system') as LogCategory,
              message: r.message,
              ...(r.detail !== undefined ? { detail: r.detail } : {}),
            })
          }
          list = valid.slice(-maxEntries)
          seq = Math.max(
            typeof parsed.seq === 'number' ? parsed.seq : 0,
            list.length ? list[list.length - 1].seq : 0,
          )
        }
      }
    } catch {
      // Ignore corrupt or blocked sessionStorage
    }
  }

  let persistScheduled = false
  const persistNow = () => {
    persistScheduled = false
    if (!storage) return
    try {
      const tail = list.slice(-PERSIST_MAX_ENTRIES)
      const json = JSON.stringify({ schemaVersion: 1, seq, entries: tail })
      if (json.length <= 220_000) {
        storage.setItem(storageKey, json)
      } else {
        // Trim details on older entries to stay well under sessionStorage quota
        const compact = tail.map((e, idx) =>
          idx < tail.length - 40 && e.detail !== undefined
            ? { ...e, detail: '[已省略历史详情以节省存储空间]' }
            : e,
        )
        storage.setItem(storageKey, JSON.stringify({ schemaVersion: 1, seq, entries: compact }))
      }
    } catch {
      // Safari Private mode / quota exceeded -> keep in-memory log unaffected
    }
  }

  const schedulePersist = () => {
    if (!storage || persistScheduled) return
    persistScheduled = true
    if (typeof setTimeout === 'function') {
      setTimeout(persistNow, 120)
    } else {
      persistNow()
    }
  }

  const notify = (entry?: ActivityLogEntry) => {
    for (const fn of listeners) {
      try { fn(entry) } catch {}
    }
  }

  const add = (level: LogLevel, category: LogCategory, message: string, detail?: unknown): ActivityLogEntry => {
    const nowPerf = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const entry: ActivityLogEntry = {
      seq: ++seq,
      ts: new Date().toISOString(),
      elapsedMs: Math.max(0, Math.round(nowPerf - startedAt)),
      page: currentPage,
      level,
      category,
      message: String(message),
      ...(detail !== undefined ? { detail: safeCloneDetail(detail) } : {}),
    }
    list.push(entry)
    if (list.length > maxEntries) list.splice(0, list.length - maxEntries)
    schedulePersist()
    notify(entry)
    return entry
  }

  const store: ActivityLogStore = {
    getPage: () => currentPage,
    setPage(page: string) { currentPage = page || 'studio' },
    getEnv: () => envSnapshot,
    setEnv(env: EnvironmentSnapshot) {
      envSnapshot = env
      notify(undefined)
    },
    log: add,
    action: (message, detail, category = 'ui') => add('action', category, message, detail),
    info: (category, message, detail) => add('info', category, message, detail),
    exportStep: (message, detail, level = 'export') => add(level, 'export', message, detail),
    warn: (category, message, detail) => add('warn', category, message, detail),
    error: (category, message, detail) => add('error', category, message, detail),
    entries: () => list,
    counts() {
      let actions = 0, exports = 0, warns = 0, errors = 0
      for (const e of list) {
        if (e.level === 'action') actions++
        else if (e.level === 'export') exports++
        else if (e.level === 'warn') warns++
        else if (e.level === 'error') errors++
      }
      return { total: list.length, actions, exports, warns, errors }
    },
    clear() {
      list = []
      if (storage) {
        try {
          if (storage.removeItem) storage.removeItem(storageKey)
          else storage.setItem(storageKey, JSON.stringify({ schemaVersion: 1, seq, entries: [] }))
        } catch {}
      }
      notify(undefined)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    exportJson() {
      return JSON.stringify({
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        env: envSnapshot ?? null,
        counts: store.counts(),
        entries: list,
      }, null, 2)
    },
    exportText() {
      return formatLogText(list, envSnapshot)
    },
  }

  return store
}

/** Shared global logger instance used by all studio pages, texture slots, and GLB export pipeline. */
export const activityLog = createActivityLog()

async function runCanvasBlobProbe(): Promise<CanvasBlobProbe> {
  if (typeof document === 'undefined') {
    return { tested: false, pngOk: false, pngBytes: 0, pngMime: '', webpOk: false, webpBytes: 0 }
  }
  try {
    const c = document.createElement('canvas')
    c.width = 4
    c.height = 4
    const g = c.getContext('2d')
    if (!g) {
      return { tested: true, pngOk: false, pngBytes: 0, pngMime: '', webpOk: false, webpBytes: 0, error: '无法创建 2D Context' }
    }
    g.fillStyle = '#3c8f52'
    g.fillRect(0, 0, 4, 4)
    if (typeof c.toBlob !== 'function') {
      return { tested: true, pngOk: false, pngBytes: 0, pngMime: '', webpOk: false, webpBytes: 0, error: 'canvas.toBlob 不存在' }
    }
    const probeOne = (mime: string) => new Promise<Blob | null>(resolve => {
      try { c.toBlob(blob => resolve(blob), mime) } catch { resolve(null) }
    })
    const [png, webp] = await Promise.all([probeOne('image/png'), probeOne('image/webp')])
    return {
      tested: true,
      pngOk: Boolean(png && png.size > 0),
      pngBytes: png?.size ?? 0,
      pngMime: png?.type ?? '',
      webpOk: Boolean(webp && webp.size > 0 && webp.type === 'image/webp'),
      webpBytes: webp?.size ?? 0,
    }
  } catch (err) {
    return {
      tested: true,
      pngOk: false,
      pngBytes: 0,
      pngMime: '',
      webpOk: false,
      webpBytes: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export function captureEnvironmentSnapshot(
  page: string,
  gl?: WebGLRenderingContext | WebGL2RenderingContext | null,
): EnvironmentSnapshot {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  const ua = nav?.userAgent ?? ''
  const { browser, isSafari, isIOS } = detectBrowserInfo(ua)
  const webgl: EnvironmentSnapshot['webgl'] = { available: Boolean(gl) }
  if (gl) {
    try {
      webgl.version = String(gl.getParameter(gl.VERSION) ?? '')
      webgl.maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE) ?? 0) || undefined
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      if (ext) {
        webgl.renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '')
        webgl.vendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) ?? '')
      } else {
        webgl.renderer = String(gl.getParameter(gl.RENDERER) ?? '')
        webgl.vendor = String(gl.getParameter(gl.VENDOR) ?? '')
      }
    } catch {}
  }
  const testCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : undefined
  return {
    capturedAt: new Date().toISOString(),
    page,
    url: typeof location !== 'undefined' ? location.pathname + location.search : '',
    userAgent: ua,
    platform: nav?.platform ?? '',
    language: nav?.language ?? '',
    browser,
    isSafari,
    isIOS,
    devicePixelRatio: typeof window !== 'undefined' ? Number((window.devicePixelRatio || 1).toFixed(2)) : 1,
    viewport: typeof window !== 'undefined' ? `${window.innerWidth}×${window.innerHeight}` : '0×0',
    webgl,
    capabilities: {
      hasCanvasToBlob: Boolean(testCanvas && typeof testCanvas.toBlob === 'function'),
      hasOffscreenCanvas: typeof OffscreenCanvas !== 'undefined',
      hasImageBitmap: typeof ImageBitmap !== 'undefined',
      hasFileReader: typeof FileReader !== 'undefined',
      hasCreateObjectURL: typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function',
      hasClipboard: Boolean(nav?.clipboard && typeof nav.clipboard.writeText === 'function'),
    },
    canvasProbe: {
      tested: false,
      pngOk: false,
      pngBytes: 0,
      pngMime: '',
      webpOk: false,
      webpBytes: 0,
    },
  }
}

function cleanLabel(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 64)
}

function findControlLabel(el: HTMLElement): string {
  if (el.dataset.logLabel) return cleanLabel(el.dataset.logLabel)
  if (el.getAttribute('aria-label')) return cleanLabel(el.getAttribute('aria-label'))
  const field = el.closest('.s-field, .glb-opt-row, .pl-hover-toggle, label')
  if (field) {
    const span = field.querySelector(':scope > span, :scope > b, div > b, label > b')
    if (span && span !== el) {
      const txt = cleanLabel(span.textContent)
      if (txt) return txt
    }
    if (field.tagName === 'LABEL') {
      const txt = cleanLabel(field.textContent)
      if (txt) return txt
    }
  }
  const pathAttr = el.dataset.path || el.dataset.r || el.dataset.n || el.dataset.c || el.dataset.s || el.dataset.k
  if (pathAttr) return pathAttr
  if (el.title) return cleanLabel(el.title)
  return el.id || el.tagName.toLowerCase()
}

function isInsideLogUi(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('[data-log-ignore="true"], #activity-log-drawer, #activity-log-btn'))
}

export interface StudioLoggingOptions {
  page: string
  store?: ActivityLogStore
  getWebGLContext?: () => WebGLRenderingContext | WebGL2RenderingContext | null
}

/** Initializes environment capture, automatic capture-phase DOM user-action tracking,
 *  and runtime warning/error interception for a studio page. */
export function initStudioLogging(options: StudioLoggingOptions): { dispose(): void } {
  const store = options.store ?? activityLog
  store.setPage(options.page)

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { dispose() {} }
  }

  const gl = options.getWebGLContext?.() ?? null
  const env = captureEnvironmentSnapshot(options.page, gl)
  store.setEnv(env)
  store.info('env', `进入页面「${options.page}」· ${env.browser} · WebGL=${env.webgl.renderer || (env.webgl.available ? 'OK' : '不可用')}`, {
    browser: env.browser,
    isSafari: env.isSafari,
    isIOS: env.isIOS,
    viewport: env.viewport,
    dpr: env.devicePixelRatio,
    maxTextureSize: env.webgl.maxTextureSize,
    capabilities: env.capabilities,
  })

  // Async non-blocking canvas.toBlob capability self-test (critical for Safari export triage)
  void runCanvasBlobProbe().then(probe => {
    const nextEnv: EnvironmentSnapshot = { ...env, canvasProbe: probe }
    store.setEnv(nextEnv)
    if (!probe.pngOk) {
      store.error('env', `⚠️ Canvas PNG 导出探针失败：${probe.error || 'canvas.toBlob("image/png") 返回空'}`, probe)
    } else if (env.isSafari) {
      store.info('env', `Safari 环境探针通过：PNG toBlob=${probe.pngBytes}B (${probe.pngMime})，WebP=${probe.webpOk ? '支持' : '不支持'}`, probe)
    }
  })

  const onClick = (ev: MouseEvent) => {
    if (isInsideLogUi(ev.target)) return
    const target = ev.target as Element | null
    if (!target) return
    const ctrl = target.closest<HTMLElement>('button, a[href], [role="button"], [role="tab"], .pl-card, .tl-card')
    if (!ctrl || isInsideLogUi(ctrl)) return

    if (ctrl.classList.contains('pl-card') || ctrl.classList.contains('tl-card')) {
      const title = cleanLabel(ctrl.querySelector('.pl-card-title, .tl-card-title')?.textContent) || ctrl.dataset.presetId || ctrl.dataset.showcaseId || '卡片'
      const kind = ctrl.dataset.showcaseId ? 'AI案例卡片' : ctrl.dataset.presetId ? '预设卡片' : '贴图卡片'
      store.action(`点击${kind}「${title}」`, {
        id: ctrl.dataset.showcaseId || ctrl.dataset.presetId || ctrl.dataset.texId || ctrl.id || undefined,
      }, ctrl.classList.contains('tl-card') ? 'texture' : 'preset')
      return
    }

    const label = cleanLabel(ctrl.dataset.logLabel || ctrl.textContent || ctrl.getAttribute('aria-label') || ctrl.title || ctrl.id)
    const detail: Record<string, unknown> = {}
    if (ctrl.id) detail.id = ctrl.id
    if (ctrl.dataset.act) detail.act = ctrl.dataset.act
    if (ctrl.dataset.id) detail.targetId = ctrl.dataset.id
    if (ctrl.dataset.view) detail.view = ctrl.dataset.view
    if (ctrl.dataset.camera) detail.camera = ctrl.dataset.camera
    if (ctrl.dataset.preset) detail.preset = ctrl.dataset.preset
    if (ctrl.dataset.quickCase) detail.showcase = ctrl.dataset.quickCase
    if (ctrl.dataset.sub) detail.subdiv = ctrl.dataset.sub
    if (ctrl.dataset.style) detail.style = ctrl.dataset.style
    if (ctrl.dataset.globalLod) detail.lod = ctrl.dataset.globalLod
    if (ctrl.tagName === 'A') detail.href = (ctrl as HTMLAnchorElement).getAttribute('href')

    const cat: LogCategory =
      ctrl.id.startsWith('glb') ? 'export'
        : ctrl.id.includes('preset') || ctrl.dataset.preset || ctrl.dataset.quickCase || ctrl.dataset.act?.includes('case') ? 'preset'
          : ctrl.id.includes('tex') || ctrl.id.endsWith('-load') || ctrl.id.endsWith('-default') ? 'texture'
            : 'ui'

    store.action(`点击「${label || '按钮'}」`, Object.keys(detail).length ? detail : undefined, cat)
  }

  const onChange = (ev: Event) => {
    if (isInsideLogUi(ev.target)) return
    const target = ev.target
    if (!(target instanceof HTMLElement)) return

    if (target instanceof HTMLInputElement) {
      const label = findControlLabel(target)
      if (target.type === 'file') {
        const files = target.files ? [...target.files].map(f => ({
          name: f.name,
          type: f.type || '(empty)',
          sizeKB: Number((f.size / 1024).toFixed(1)),
        })) : []
        if (files.length) {
          store.action(`选择文件「${label}」：${files.map(f => f.name).join(', ')}`, {
            id: target.id || undefined,
            files,
          }, target.id.includes('file') && target.accept.includes('image') ? 'texture' : 'ui')
        }
        return
      }
      if (target.type === 'checkbox' || target.type === 'radio') {
        const verb = target.checked ? '勾选' : '取消勾选'
        const cat: LogCategory = target.id.startsWith('glb') ? 'export' : 'param'
        store.action(`${verb}「${label}」`, {
          id: target.id || undefined,
          checked: target.checked,
        }, cat)
        return
      }
      const path = target.dataset.path || target.dataset.r || target.dataset.n || target.dataset.c || target.dataset.k || target.id || undefined
      const cat: LogCategory = target.id.startsWith('glb') ? 'export' : 'param'
      store.action(`调整「${label}」→ ${target.value}`, {
        path,
        type: target.type,
        value: target.value,
      }, cat)
      return
    }

    if (target instanceof HTMLSelectElement) {
      const label = findControlLabel(target)
      const optText = cleanLabel(target.selectedOptions?.[0]?.textContent)
      const path = target.dataset.path || target.dataset.s || target.dataset.k || target.id || undefined
      const cat: LogCategory =
        target.id.startsWith('glb') ? 'export'
          : target.id === 'preset' ? 'preset'
            : 'param'
      store.action(`选择「${label}」→ ${optText || target.value}`, {
        path,
        value: target.value,
        label: optText,
      }, cat)
    }
  }

  const onError = (ev: ErrorEvent) => {
    store.error('system', `未捕获异常：${ev.message || 'Unknown error'}`, {
      filename: ev.filename,
      lineno: ev.lineno,
      colno: ev.colno,
      error: ev.error,
    })
  }

  const onUnhandledRejection = (ev: PromiseRejectionEvent) => {
    const reason = ev.reason
    const msg = reason instanceof Error ? reason.message : String(reason)
    store.error('system', `未处理的异步错误：${msg}`, reason)
  }

  const origWarn = console.warn
  const origError = console.error
  let inConsoleTap = false

  const formatConsoleArgs = (args: unknown[]) =>
    args.map(a => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : (() => {
      try { return JSON.stringify(safeCloneDetail(a, 1)) } catch { return String(a) }
    })())).join(' ').slice(0, 600)

  console.warn = (...args: unknown[]) => {
    origWarn.apply(console, args)
    if (inConsoleTap) return
    inConsoleTap = true
    try {
      store.warn('system', `console.warn: ${formatConsoleArgs(args)}`, args.length > 1 ? args.slice(1) : undefined)
    } finally {
      inConsoleTap = false
    }
  }

  console.error = (...args: unknown[]) => {
    origError.apply(console, args)
    if (inConsoleTap) return
    inConsoleTap = true
    try {
      store.error('system', `console.error: ${formatConsoleArgs(args)}`, args.find(a => a instanceof Error) ?? (args.length > 1 ? args.slice(1) : undefined))
    } finally {
      inConsoleTap = false
    }
  }

  document.addEventListener('click', onClick, true)
  document.addEventListener('change', onChange, true)
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)

  return {
    dispose() {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('change', onChange, true)
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
      console.warn = origWarn
      console.error = origError
    },
  }
}
