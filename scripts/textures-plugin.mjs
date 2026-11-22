// Local disk persistence middleware for the real-time procedural texture library.
// Stores saved textures (node graphs + baked PNGs) in `<project>/user-textures/library.json`
// so saved textures persist across port changes, browser reloads, and cache clears.
import fs from 'node:fs'
import path from 'node:path'

const MAX_BODY_BYTES = 50 * 1024 * 1024

function attachMiddleware(middlewares, rootDir) {
  const dir = path.join(rootDir, 'user-textures')
  const file = path.join(dir, 'library.json')

  middlewares.use('/api/textures', (req, res, next) => {
    const pathname = (req.url || '/').split('?')[0]
    if (pathname !== '/' && pathname !== '') return next()

    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      try {
        if (!fs.existsSync(file)) {
          res.end(JSON.stringify({ schemaVersion: 1, items: [] }))
          return
        }
        const raw = fs.readFileSync(file, 'utf8')
        JSON.parse(raw)
        res.end(raw)
      } catch (err) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: String(err) }))
      }
      return
    }

    if (req.method === 'PUT' || req.method === 'POST') {
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
        try {
          const text = Buffer.concat(chunks).toString('utf8')
          const parsed = JSON.parse(text)
          if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: '需要包含 items 数组的贴图库 JSON' }))
            return
          }
          fs.mkdirSync(dir, { recursive: true })
          const out = JSON.stringify({ schemaVersion: 1, items: parsed.items }, null, 2)
          const tmp = file + '.tmp'
          fs.writeFileSync(tmp, out, 'utf8')
          try {
            fs.renameSync(tmp, file)
          } catch {
            fs.writeFileSync(file, out, 'utf8')
            try { fs.unlinkSync(tmp) } catch {}
          }
          res.end(JSON.stringify({ ok: true, count: parsed.items.length }))
        } catch (err) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: String(err) }))
        }
      })
      return
    }

    next()
  })
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
