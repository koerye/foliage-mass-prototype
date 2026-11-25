// Local disk persistence middleware for the real-time procedural texture library.
// Stores saved textures (node graphs + baked PNGs) in `<project>/user-textures/library.json`
// so saved textures persist across port changes, browser reloads, and cache clears.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const MAX_BODY_BYTES = 50 * 1024 * 1024
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
    res.end(JSON.stringify({ error: '禁止跨源写入本地贴图库' }))
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
      while (Date.now() < until) { /* brief sync backoff for Windows lock */ }
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
    console.warn(`[textures-plugin] Primary JSON unreadable (${path.basename(filePath)}); recovered from .bak`)
    return { raw, parsed, sig: `bak-${stat.size}-${Math.round(stat.mtimeMs)}`, fromBak: true }
  }
  if (primaryErr) throw primaryErr
  return null
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
  const dir = path.join(rootDir, 'user-textures')
  const file = path.join(dir, 'library.json')
  let fileCache = null

  function loadCachedLibrary() {
    const sigKey = filePairSig(file)
    if (!sigKey) return null
    if (fileCache && fileCache.sigKey === sigKey) return fileCache
    const loaded = readJsonTextWithBakFallback(file)
    if (!loaded) return null
    const { raw, parsed, sig } = loaded
    const items = Array.isArray(parsed?.items) ? parsed.items : []
    const summaryStr = JSON.stringify({
      schemaVersion: 1,
      summary: true,
      count: items.length,
      items: items.map(it => ({
        id: it?.id,
        name: it?.name,
        category: it?.category,
        targetSlot: it?.targetSlot,
        resolution: it?.resolution,
        updatedAt: it?.updatedAt,
      })),
    })
    fileCache = {
      sigKey,
      etag: `"tex-${sig}"`,
      summaryEtag: `"tex-sum-${sig}"`,
      raw,
      summaryStr,
    }
    return fileCache
  }

  middlewares.use('/api/textures', (req, res, next) => {
    const rawUrl = req.url || '/'
    const qIdx = rawUrl.indexOf('?')
    const pathname = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl
    const search = qIdx >= 0 ? new URLSearchParams(rawUrl.slice(qIdx + 1)) : null
    if (pathname !== '/' && pathname !== '') return next()

    if (req.method === 'GET') {
      const wantSummary = search?.get('summary') === '1'
      try {
        const cached = loadCachedLibrary()
        if (!cached) {
          res.setHeader('X-Persisted', '0')
          const empty = wantSummary
            ? JSON.stringify({ schemaVersion: 1, summary: true, count: 0, items: [] })
            : JSON.stringify({ schemaVersion: 1, items: [] })
          sendJsonCached(req, res, empty, wantSummary ? '"tex-sum-empty"' : '"tex-empty"')
          return
        }
        res.setHeader('X-Persisted', '1')
        if (wantSummary) {
          sendJsonCached(req, res, cached.summaryStr, cached.summaryEtag)
        } else {
          sendJsonCached(req, res, cached.raw, cached.etag)
        }
      } catch (err) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: String(err) }))
      }
      return
    }

    if (req.method === 'PUT') {
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
          res.end(JSON.stringify({ error: '贴图库体积超过 50 MB 上限' }))
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
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: '需要包含 items 数组的贴图库 JSON' }))
          return
        }
        try {
          writeAtomicJson(dir, file, { schemaVersion: 1, items: parsed.items })
          fileCache = null
          res.end(JSON.stringify({ ok: true, count: parsed.items.length }))
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: `贴图库写入磁盘失败：${String(err)}` }))
        }
      })
      return
    }

    rejectMethodNotAllowed(req, res)
  })
}

export function attachTexturesMiddleware(middlewares, rootDir) {
  attachMiddleware(middlewares, rootDir)
}

export function userTexturesPlugin() {
  let rootDir = process.cwd()
  return {
    name: 'vegetation-studio-user-textures',
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
