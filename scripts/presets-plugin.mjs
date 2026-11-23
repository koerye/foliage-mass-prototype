// Local disk persistence middleware for user-saved vegetation presets
// and user-customized built-in default preset overrides.
// Stores files in `<project>/user-presets/` so saved presets and modified
// defaults survive port changes, browser cache clears, and switching browsers.
import fs from 'node:fs'
import path from 'node:path'

const MAX_BODY_BYTES = 25 * 1024 * 1024
const VALID_OVERRIDE_SCOPES = new Set(['rock', 'tree'])

function writeAtomicJson(dir, file, data) {
  fs.mkdirSync(dir, { recursive: true })
  const out = JSON.stringify(data, null, 2)
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, out, 'utf8')
  try {
    fs.renameSync(tmp, file)
  } catch {
    fs.writeFileSync(file, out, 'utf8')
    try { fs.unlinkSync(tmp) } catch {}
  }
}

function readJsonBody(req, res, onJson) {
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
    try {
      const text = Buffer.concat(chunks).toString('utf8')
      onJson(JSON.parse(text))
    } catch (err) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: String(err) }))
    }
  })
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function readOverridesFile(file) {
  if (!fs.existsSync(file)) {
    return { schemaVersion: 1, persisted: false, rock: {}, tree: {} }
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
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
  if (!fs.existsSync(file)) {
    return { schemaVersion: 1, persisted: false, hiddenIds: [] }
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  return {
    schemaVersion: 1,
    persisted: true,
    hiddenIds: normalizeIdList(raw?.hiddenIds),
  }
}

function attachMiddleware(middlewares, rootDir) {
  const dir = path.join(rootDir, 'user-presets')
  const presetsFile = path.join(dir, 'presets.json')
  const overridesFile = path.join(dir, 'default-overrides.json')
  const hiddenShowcasesFile = path.join(dir, 'hidden-showcases.json')
  const scenesFile = path.join(dir, 'scenes.json')

  // Built-in default preset overrides endpoint (rock + tree, scoped atomic merge)
  middlewares.use('/api/default-presets', (req, res, next) => {
    const pathname = (req.url || '/').split('?')[0]
    if (pathname !== '/' && pathname !== '') return next()

    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      try {
        res.end(JSON.stringify(readOverridesFile(overridesFile)))
      } catch (err) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: String(err) }))
      }
      return
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      readJsonBody(req, res, parsed => {
        if (!isPlainObject(parsed)) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: '需要 JSON 对象格式' }))
          return
        }
        const current = (() => {
          try { return readOverridesFile(overridesFile) } catch { return { schemaVersion: 1, persisted: false, rock: {}, tree: {} } }
        })()
        const nextDoc = { schemaVersion: 1, rock: current.rock, tree: current.tree }

        if (typeof parsed.scope === 'string') {
          if (!VALID_OVERRIDE_SCOPES.has(parsed.scope) || !isPlainObject(parsed.overrides)) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'scope 必须为 rock 或 tree，且 overrides 必须为对象' }))
            return
          }
          nextDoc[parsed.scope] = parsed.overrides
          writeAtomicJson(dir, overridesFile, nextDoc)
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
        res.end(JSON.stringify({
          ok: true,
          rockCount: Object.keys(nextDoc.rock).length,
          treeCount: Object.keys(nextDoc.tree).length,
        }))
      })
      return
    }

    next()
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

    if (req.method === 'PUT' || req.method === 'POST') {
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

    next()
  })

  // Saved Assembly Scene cases endpoint (Scene Assembly Studio)
  middlewares.use('/api/scenes', (req, res, next) => {
    const pathname = (req.url || '/').split('?')[0]
    if (pathname !== '/' && pathname !== '') return next()

    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      try {
        if (!fs.existsSync(scenesFile)) {
          res.end(JSON.stringify({ schemaVersion: 1, items: [] }))
          return
        }
        const raw = fs.readFileSync(scenesFile, 'utf8')
        JSON.parse(raw)
        res.end(raw)
      } catch (err) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: String(err) }))
      }
      return
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      readJsonBody(req, res, parsed => {
        if (!isPlainObject(parsed) || !Array.isArray(parsed.items)) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: '需要包含 items 数组的场景案例库 JSON' }))
          return
        }
        writeAtomicJson(dir, scenesFile, { schemaVersion: 1, items: parsed.items })
        res.end(JSON.stringify({ ok: true, count: parsed.items.length }))
      })
      return
    }

    next()
  })

  // User preset library endpoint
  middlewares.use('/api/presets', (req, res, next) => {
    const pathname = (req.url || '/').split('?')[0]
    if (pathname !== '/' && pathname !== '') return next()

    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      try {
        if (!fs.existsSync(presetsFile)) {
          res.end(JSON.stringify({ schemaVersion: 1, items: [] }))
          return
        }
        const raw = fs.readFileSync(presetsFile, 'utf8')
        JSON.parse(raw)
        res.end(raw)
      } catch (err) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: String(err) }))
      }
      return
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      readJsonBody(req, res, parsed => {
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: '需要包含 items 数组的预设库 JSON' }))
          return
        }
        writeAtomicJson(dir, presetsFile, { schemaVersion: 1, items: parsed.items })
        res.end(JSON.stringify({ ok: true, count: parsed.items.length }))
      })
      return
    }

    next()
  })
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
