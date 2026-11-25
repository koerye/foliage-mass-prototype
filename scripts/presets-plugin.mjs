// Local disk persistence middleware for user-saved vegetation presets
// and user-customized built-in default preset overrides.
// Stores files in `<project>/user-presets/` so saved presets and modified
// defaults survive port changes, browser cache clears, and switching browsers.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const MAX_BODY_BYTES = 25 * 1024 * 1024
const VALID_OVERRIDE_SCOPES = new Set(['rock', 'tree'])
const LOCAL_ORIGIN_RE = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i

const gzipCache = new Map()

function sendJsonCached(req, res, payloadStr, etag) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  if (etag) {
    res.setHeader('ETag', etag)
    if (req.headers?.['if-none-match'] === etag) {
      res.statusCode = 304
      res.end()
      return
    }
  }
  const acceptEnc = String(req.headers?.['accept-encoding'] || '')
  if (payloadStr.length > 4096 && acceptEnc.includes('gzip')) {
    let gz = etag ? gzipCache.get(etag) : undefined
    if (!gz) {
      gz = zlib.gzipSync(Buffer.from(payloadStr, 'utf8'), { level: 1 })
      if (etag) {
        if (gzipCache.size > 16) gzipCache.clear()
        gzipCache.set(etag, gz)
      }
    }
    res.setHeader('Content-Encoding', 'gzip')
    res.setHeader('Vary', 'Accept-Encoding')
    res.setHeader('Content-Length', String(gz.length))
    res.end(gz)
    return
  }
  res.end(payloadStr)
}

function guardOrigin(req, res) {
  const headers = req.headers || {}
  const origin = headers.origin
  if (typeof origin === 'string' && origin && !LOCAL_ORIGIN_RE.test(origin)) {
    res.statusCode = 403
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: '禁止跨源写入本地数据' }))
    return false
  }
  return true
}

function guardMutatingRequest(req, res) {
  if (!guardOrigin(req, res)) return false
  const headers = req.headers || {}
  const ct = typeof headers['content-type'] === 'string' ? headers['content-type'].trim().toLowerCase() : ''
  if (!ct.startsWith('application/json')) {
    res.statusCode = 415
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: '写入请求必须指定 Content-Type: application/json' }))
    return false
  }
  return true
}

function rejectMethodNotAllowed(req, res) {
  if (!guardOrigin(req, res)) return
  res.statusCode = 405
  res.setHeader('Allow', 'GET, PUT')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ error: `仅支持 GET / PUT，不支持 ${req.method || 'UNKNOWN'}` }))
}

function writeAtomicJson(dir, file, data) {
  fs.mkdirSync(dir, { recursive: true })
  const out = JSON.stringify(data, null, 2)
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`
  fs.writeFileSync(tmp, out, 'utf8')
  if (fs.existsSync(file)) {
    try {
      // Preserve last known valid JSON in .bak so corrupt primary files never overwrite a good backup
      JSON.parse(fs.readFileSync(file, 'utf8'))
      fs.copyFileSync(file, file + '.bak')
    } catch {}
  }
  let lastErr
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      fs.renameSync(tmp, file)
      return
    } catch (err) {
      lastErr = err
      const code = err && typeof err === 'object' ? err.code : ''
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') break
      const until = Date.now() + 18 * (attempt + 1)
      while (Date.now() < until) { /* brief sync backoff for Windows antivirus lock */ }
    }
  }
  try {
    fs.writeFileSync(file, out, 'utf8')
  } catch (writeErr) {
    try { fs.unlinkSync(tmp) } catch {}
    throw writeErr || lastErr
  }
  try { fs.unlinkSync(tmp) } catch {}
}

function readJsonBody(req, res, onJson) {
  if (!guardMutatingRequest(req, res)) return
  const chunks = []
  let size = 0
  let aborted = false
  req.on('data', chunk => {
    if (aborted) return
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      aborted = true
      res.statusCode = 413
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: '请求体体积超过 25 MB 上限' }))
      return
    }
    chunks.push(chunk)
  })
  req.on('end', () => {
    if (aborted) return
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    let parsed
    try {
      const text = Buffer.concat(chunks).toString('utf8')
      parsed = JSON.parse(text)
    } catch (err) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: String(err) }))
      return
    }
    try {
      onJson(parsed)
    } catch (err) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: `磁盘写入失败：${String(err)}` }))
    }
  })
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function readJsonTextWithBakFallback(filePath) {
  let primaryErr
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8')
      const parsed = JSON.parse(raw)
      const stat = fs.statSync(filePath)
      return { raw, parsed, sig: `${stat.size}-${Math.round(stat.mtimeMs)}`, fromBak: false }
    } catch (err) {
      primaryErr = err
    }
  }
  const bakPath = filePath + '.bak'
  if (fs.existsSync(bakPath)) {
    const raw = fs.readFileSync(bakPath, 'utf8')
    const parsed = JSON.parse(raw)
    const stat = fs.statSync(bakPath)
    console.warn(`[presets-plugin] Primary JSON unreadable (${path.basename(filePath)}); recovered from .bak`)
    return { raw, parsed, sig: `bak-${stat.size}-${Math.round(stat.mtimeMs)}`, fromBak: true }
  }
  if (primaryErr) throw primaryErr
  return null
}

function readOverridesFile(file) {
  const loaded = readJsonTextWithBakFallback(file)
  if (!loaded) {
    return { schemaVersion: 1, persisted: false, rock: {}, tree: {} }
  }
  const raw = loaded.parsed
  return {
    schemaVersion: 1,
    persisted: true,
    rock: isPlainObject(raw?.rock) ? raw.rock : {},
    tree: isPlainObject(raw?.tree) ? raw.tree : {},
  }
}

function normalizeIdList(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function readHiddenShowcasesFile(file) {
  const loaded = readJsonTextWithBakFallback(file)
  if (!loaded) {
    return { schemaVersion: 1, persisted: false, hiddenIds: [] }
  }
  return {
    schemaVersion: 1,
    persisted: true,
    hiddenIds: normalizeIdList(loaded.parsed?.hiddenIds),
  }
}

function filePairSig(filePath) {
  const bakPath = filePath + '.bak'
  let sig = ''
  if (fs.existsSync(filePath)) {
    const s = fs.statSync(filePath)
    sig += `p:${s.size}-${Math.round(s.mtimeMs)}`
  }
  if (fs.existsSync(bakPath)) {
    const b = fs.statSync(bakPath)
    sig += `|b:${b.size}-${Math.round(b.mtimeMs)}`
  }
  return sig
}

function attachMiddleware(middlewares, rootDir) {
  const dir = path.join(rootDir, 'user-presets')
  const presetsFile = path.join(dir, 'presets.json')
  const overridesFile = path.join(dir, 'default-overrides.json')
  const hiddenShowcasesFile = path.join(dir, 'hidden-showcases.json')
  const scenesFile = path.join(dir, 'scenes.json')

  const rawCache = new Map()
  function readCachedRawJson(filePath) {
    const sigKey = filePairSig(filePath)
    if (!sigKey) return null
    const prev = rawCache.get(filePath)
    if (prev && prev.sigKey === sigKey) return prev
    const loaded = readJsonTextWithBakFallback(filePath)
    if (!loaded) return null
    const entry = { sigKey, etag: `"raw-${loaded.sig}"`, raw: loaded.raw }
    rawCache.set(filePath, entry)
    return entry
  }

  let overridesCache = null
  function readCachedOverrides() {
    const sigKey = filePairSig(overridesFile)
    if (!sigKey) {
      return { sig: 'empty', doc: { schemaVersion: 1, persisted: false, rock: {}, tree: {} }, rockJson: null, treeJson: null, allJson: null }
    }
    if (overridesCache && overridesCache.sig === sigKey) return overridesCache
    const doc = readOverridesFile(overridesFile)
    overridesCache = {
      sig: sigKey,
      doc,
      rockJson: JSON.stringify({ schemaVersion: 1, persisted: doc.persisted, rock: doc.rock }),
      treeJson: JSON.stringify({ schemaVersion: 1, persisted: doc.persisted, tree: doc.tree }),
      allJson: JSON.stringify(doc),
    }
    return overridesCache
  }

  // Built-in default preset overrides endpoint (rock + tree, scoped atomic merge)
  middlewares.use('/api/default-presets', (req, res, next) => {
    const rawUrl = req.url || '/'
    const qIdx = rawUrl.indexOf('?')
    const pathname = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl
    const search = qIdx >= 0 ? new URLSearchParams(rawUrl.slice(qIdx + 1)) : null
    if (pathname !== '/' && pathname !== '') return next()

    if (req.method === 'GET') {
      try {
        const cached = readCachedOverrides()
        const reqScope = search?.get('scope')
        if (reqScope === 'rock') {
          const payload = cached.rockJson ?? JSON.stringify({ schemaVersion: 1, persisted: false, rock: {} })
          sendJsonCached(req, res, payload, `"ov-rock-${cached.sig}"`)
        } else if (reqScope === 'tree') {
          const payload = cached.treeJson ?? JSON.stringify({ schemaVersion: 1, persisted: false, tree: {} })
          sendJsonCached(req, res, payload, `"ov-tree-${cached.sig}"`)
        } else {
          const payload = cached.allJson ?? JSON.stringify(cached.doc)
          sendJsonCached(req, res, payload, `"ov-all-${cached.sig}"`)
        }
      } catch (err) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: String(err) }))
      }
      return
    }

    if (req.method === 'PUT') {
      readJsonBody(req, res, parsed => {
        if (!isPlainObject(parsed)) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: '需要 JSON 对象格式' }))
          return
        }
        let current
        try {
          current = readOverridesFile(overridesFile)
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: `读取现有默认预设失败（已中止以防覆盖另一工作台配置）：${String(err)}` }))
          return
        }
        const nextDoc = { schemaVersion: 1, rock: current.rock, tree: current.tree }

        if (typeof parsed.scope === 'string') {
          if (!VALID_OVERRIDE_SCOPES.has(parsed.scope) || !isPlainObject(parsed.overrides)) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'scope 必须为 rock 或 tree，且 overrides 必须为对象' }))
            return
          }
          nextDoc[parsed.scope] = parsed.overrides
          writeAtomicJson(dir, overridesFile, nextDoc)
          overridesCache = null
          res.end(JSON.stringify({ ok: true, scope: parsed.scope, count: Object.keys(parsed.overrides).length }))
          return
        }

        if (!isPlainObject(parsed.rock) && !isPlainObject(parsed.tree)) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: '需要提供 scope + overrides 或 rock / tree 字段' }))
          return
        }
        if (isPlainObject(parsed.rock)) nextDoc.rock = parsed.rock
        if (isPlainObject(parsed.tree)) nextDoc.tree = parsed.tree
        writeAtomicJson(dir, overridesFile, nextDoc)
        overridesCache = null
        res.end(JSON.stringify({
          ok: true,
          rockCount: Object.keys(nextDoc.rock).length,
          treeCount: Object.keys(nextDoc.tree).length,
        }))
      })
      return
    }

    rejectMethodNotAllowed(req, res)
  })

  // Hidden (user-deleted) built-in AI showcase IDs endpoint
  middlewares.use('/api/hidden-showcases', (req, res, next) => {
    const pathname = (req.url || '/').split('?')[0]
    if (pathname !== '/' && pathname !== '') return next()

    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      try {
        res.end(JSON.stringify(readHiddenShowcasesFile(hiddenShowcasesFile)))
      } catch (err) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: String(err) }))
      }
      return
    }

    if (req.method === 'PUT') {
      readJsonBody(req, res, parsed => {
        if (!isPlainObject(parsed) || !Array.isArray(parsed.hiddenIds) || !parsed.hiddenIds.every(x => typeof x === 'string')) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: '需要包含字符串数组 hiddenIds 的 JSON 对象' }))
          return
        }
        const hiddenIds = normalizeIdList(parsed.hiddenIds)
        writeAtomicJson(dir, hiddenShowcasesFile, { schemaVersion: 1, hiddenIds })
        res.end(JSON.stringify({ ok: true, count: hiddenIds.length, hiddenIds }))
      })
      return
    }

    rejectMethodNotAllowed(req, res)
  })

  // Saved Assembly Scene cases endpoint (Scene Assembly Studio)
  middlewares.use('/api/scenes', (req, res, next) => {
    const pathname = (req.url || '/').split('?')[0]
    if (pathname !== '/' && pathname !== '') return next()

    if (req.method === 'GET') {
      try {
        const cached = readCachedRawJson(scenesFile)
        if (!cached) {
          res.setHeader('X-Persisted', '0')
          sendJsonCached(req, res, JSON.stringify({ schemaVersion: 1, items: [] }), '"scenes-empty"')
          return
        }
        res.setHeader('X-Persisted', '1')
        sendJsonCached(req, res, cached.raw, cached.etag)
      } catch (err) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: String(err) }))
      }
      return
    }

    if (req.method === 'PUT') {
      readJsonBody(req, res, parsed => {
        if (!isPlainObject(parsed) || !Array.isArray(parsed.items)) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: '需要包含 items 数组的场景案例库 JSON' }))
          return
        }
        writeAtomicJson(dir, scenesFile, { schemaVersion: 1, items: parsed.items })
        rawCache.delete(scenesFile)
        res.end(JSON.stringify({ ok: true, count: parsed.items.length }))
      })
      return
    }

    rejectMethodNotAllowed(req, res)
  })

  // User preset library endpoint
  middlewares.use('/api/presets', (req, res, next) => {
    const pathname = (req.url || '/').split('?')[0]
    if (pathname !== '/' && pathname !== '') return next()

    if (req.method === 'GET') {
      try {
        const cached = readCachedRawJson(presetsFile)
        if (!cached) {
          res.setHeader('X-Persisted', '0')
          sendJsonCached(req, res, JSON.stringify({ schemaVersion: 1, items: [] }), '"presets-empty"')
          return
        }
        res.setHeader('X-Persisted', '1')
        sendJsonCached(req, res, cached.raw, cached.etag)
      } catch (err) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: String(err) }))
      }
      return
    }

    if (req.method === 'PUT') {
      readJsonBody(req, res, parsed => {
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: '需要包含 items 数组的预设库 JSON' }))
          return
        }
        writeAtomicJson(dir, presetsFile, { schemaVersion: 1, items: parsed.items })
        rawCache.delete(presetsFile)
        res.end(JSON.stringify({ ok: true, count: parsed.items.length }))
      })
      return
    }

    rejectMethodNotAllowed(req, res)
  })
}

export function attachPresetsMiddleware(middlewares, rootDir) {
  attachMiddleware(middlewares, rootDir)
}

export function userPresetsPlugin() {
  let rootDir = process.cwd()
  return {
    name: 'vegetation-studio-user-presets',
    configResolved(config) {
      rootDir = config.root
    },
    configureServer(server) {
      attachMiddleware(server.middlewares, rootDir)
    },
    configurePreviewServer(server) {
      attachMiddleware(server.middlewares, rootDir)
    },
  }
}
