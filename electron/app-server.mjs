// Embedded local loopback HTTP server for Vegetation Studio Electron Desktop App.
// Serves:
//   1. Built static `dist/` frontend (when not using live Vite dev URL)
//   2. Reused 1:1 `/api/presets`, `/api/default-presets`, `/api/scenes`, `/api/hidden-showcases`, `/api/textures`
//   3. Authenticated MCP Control Bridge (`/mcp-bridge/health`, `/mcp-bridge/command`)
//   4. Authenticated Streamable HTTP MCP Endpoint (`POST /mcp`)
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { attachPresetsMiddleware } from '../scripts/presets-plugin.mjs'
import { attachTexturesMiddleware } from '../scripts/textures-plugin.mjs'
import { handleMcpJsonRpc } from '../mcp/tools.mjs'

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
}

function createMiddlewareRunner() {
  const stack = []
  return {
    use(prefix, handler) {
      stack.push({ prefix, handler })
    },
    run(req, res, done) {
      const fullUrl = req.url || '/'
      const qIdx = fullUrl.indexOf('?')
      const pathname = qIdx >= 0 ? fullUrl.slice(0, qIdx) : fullUrl
      const query = qIdx >= 0 ? fullUrl.slice(qIdx) : ''
      let i = 0
      const next = () => {
        while (i < stack.length) {
          const entry = stack[i++]
          if (pathname === entry.prefix || pathname.startsWith(entry.prefix + '/')) {
            const origUrl = req.url
            const rest = pathname.slice(entry.prefix.length) || '/'
            req.url = rest + query
            let advanced = false
            entry.handler(req, res, () => {
              if (advanced) return
              advanced = true
              req.url = origUrl
              next()
            })
            return
          }
        }
        done()
      }
      next()
    },
  }
}

function readRawBody(req, maxBytes = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', chunk => {
      total += chunk.length
      if (total > maxBytes) {
        reject(new Error('Request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function checkBearerToken(req, expectedToken) {
  const auth = String(req.headers.authorization || '')
  const prefix = 'Bearer '
  if (!auth.startsWith(prefix)) return false
  const got = Buffer.from(auth.slice(prefix.length), 'utf8')
  const exp = Buffer.from(expectedToken, 'utf8')
  if (got.length !== exp.length) return false
  return crypto.timingSafeEqual(got, exp)
}

const staticFileCache = new Map()

function serveStaticFile(distDir, req, res) {
  let rawPath
  try {
    rawPath = decodeURIComponent((req.url || '/').split('?')[0])
  } catch {
    res.statusCode = 400
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('Bad Request: malformed URI encoding')
    return
  }
  if (rawPath.includes('\0')) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('Bad Request: invalid path')
    return
  }
  const rel = rawPath === '/' ? 'broadleaf.html' : rawPath.replace(/^\/+/, '')
  const resolved = path.resolve(distDir, rel)
  const rootPrefix = path.resolve(distDir) + path.sep
  if (resolved !== path.resolve(distDir) && !resolved.startsWith(rootPrefix)) {
    res.statusCode = 403
    res.end('Forbidden')
    return
  }
  let target = resolved
  let stat
  try {
    stat = fs.statSync(target)
    if (stat.isDirectory()) {
      target = path.join(target, 'index.html')
      stat = fs.statSync(target)
    }
    if (!stat.isFile()) {
      res.statusCode = 404
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end(`Not Found: ${rawPath}`)
      return
    }
  } catch {
    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end(`Not Found: ${rawPath}`)
    return
  }
  const ext = path.extname(target).toLowerCase()
  const etag = `"s-${stat.size}-${Math.round(stat.mtimeMs)}"`
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream')
  res.setHeader('ETag', etag)
  if (rawPath.startsWith('/assets/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  } else {
    res.setHeader('Cache-Control', 'no-cache')
  }
  if (req.headers?.['if-none-match'] === etag) {
    res.statusCode = 304
    res.end()
    return
  }
  try {
    let cached = staticFileCache.get(target)
    if (!cached || cached.etag !== etag) {
      const body = fs.readFileSync(target)
      cached = { etag, body }
      if (body.length <= 4 * 1024 * 1024 && staticFileCache.size < 128) {
        staticFileCache.set(target, cached)
      }
    }
    res.setHeader('Content-Length', String(cached.body.length))
    res.end(cached.body)
  } catch (err) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end(`Static Read Error: ${err?.message || String(err)}`)
  }
}

export async function startAppServer({
  distDir,
  dataDir,
  preferredPort = 27890,
  appVersion = '1.0.0',
  onBridgeCommand,
}) {
  const token = crypto.randomBytes(24).toString('hex')
  const runner = createMiddlewareRunner()
  attachPresetsMiddleware(runner, dataDir)
  attachTexturesMiddleware(runner, dataDir)

  const server = http.createServer(async (req, res) => {
    const pathname = (req.url || '/').split('?')[0]
    try {
      decodeURIComponent(pathname)
    } catch {
      res.statusCode = 400
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('Bad Request: malformed URI encoding')
      return
    }

    // 1. Lightweight bridge liveness ping (reports tokenValid when Authorization Bearer is provided)
    if (pathname === '/mcp-bridge/health' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify({
        ok: true,
        app: 'vegetation-studio',
        version: appVersion,
        tokenValid: checkBearerToken(req, token),
      }))
      return
    }

    // 2. Authenticated local Electron Control Bridge (used by `mcp/server.mjs`)
    if (pathname === '/mcp-bridge/command' && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      if (!checkBearerToken(req, token)) {
        res.statusCode = 401
        res.end(JSON.stringify({ ok: false, error: 'Unauthorized bridge token' }))
        return
      }
      try {
        const body = JSON.parse(await readRawBody(req))
        const result = await onBridgeCommand(String(body?.action || ''), body?.params ?? {})
        res.end(JSON.stringify({ ok: true, result }))
      } catch (err) {
        res.statusCode = 500
        res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }))
      }
      return
    }

    // 3. Built-in Streamable HTTP MCP Endpoint (`POST /mcp`, Bearer-authenticated)
    if (pathname === '/mcp' && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      if (!checkBearerToken(req, token)) {
        res.statusCode = 401
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }))
        return
      }
      try {
        const msg = JSON.parse(await readRawBody(req))
        const response = await handleMcpJsonRpc(msg, (action, params) => onBridgeCommand(action, params))
        if (response === null) {
          res.statusCode = 202
          res.end()
        } else {
          res.end(JSON.stringify(response))
        }
      } catch (err) {
        res.statusCode = 400
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: String(err) } }))
      }
      return
    }

    // 4. Existing `/api/presets`, `/api/default-presets`, `/api/scenes`, `/api/hidden-showcases`, `/api/textures`
    runner.run(req, res, () => {
      // 5. Built `dist/` static web application
      if (distDir && fs.existsSync(distDir)) {
        serveStaticFile(distDir, req, res)
      } else {
        res.statusCode = 404
        res.end('Frontend dist/ not built yet')
      }
    })
  })

  const listenOn = port => new Promise((resolve, reject) => {
    const onError = err => {
      server.removeListener('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.removeListener('error', onError)
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })

  let port
  try {
    port = await listenOn(preferredPort)
  } catch {
    port = await listenOn(0)
  }

  return {
    port,
    token,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(() => resolve())),
  }
}
