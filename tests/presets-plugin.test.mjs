import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { userPresetsPlugin } from '../scripts/presets-plugin.mjs'

describe('userPresetsPlugin (Vite disk persistence middleware)', () => {
  it('persists presets atomically to disk and rejects malformed payloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'veg-presets-'))
    try {
      const plugin = userPresetsPlugin()
      plugin.configResolved({ root: dir })
      let mountPath = ''
      let mw
      plugin.configureServer({
        middlewares: {
          use: (p, fn) => { mountPath = p; mw = fn },
        },
      })
      expect(mountPath).toBe('/api/presets')
      expect(mw).toBeTypeOf('function')

      const callApi = (method, url, body) => new Promise((resolve) => {
        const req = Object.assign(new EventEmitter(), { method, url })
        const res = {
          statusCode: 200,
          setHeader: () => {},
          end: (chunk) => resolve({ status: res.statusCode, body: chunk ?? '' }),
        }
        mw(req, res, () => resolve({ status: 404, body: 'NEXT' }))
        if (method === 'PUT' || method === 'POST') {
          queueMicrotask(() => {
            if (body !== undefined) req.emit('data', Buffer.from(body))
            req.emit('end')
          })
        }
      })

      // Initial GET returns empty library
      const r0 = await callApi('GET', '/')
      expect(r0.status).toBe(200)
      expect(JSON.parse(r0.body)).toEqual({ schemaVersion: 1, items: [] })

      // Malformed PUT returns 400
      const bad = await callApi('PUT', '/', '{"items":"nope"}')
      expect(bad.status).toBe(400)

      // Valid PUT persists to user-presets/presets.json and round-trips on GET
      const payload = { schemaVersion: 1, items: [{ id: 't1', scope: 'tree', name: '松树' }] }
      const put = await callApi('PUT', '/', JSON.stringify(payload))
      expect(put.status).toBe(200)
      expect(JSON.parse(put.body)).toEqual({ ok: true, count: 1 })

      const onDisk = JSON.parse(await readFile(join(dir, 'user-presets', 'presets.json'), 'utf8'))
      expect(onDisk.items[0].name).toBe('松树')

      const r1 = await callApi('GET', '/')
      expect(r1.status).toBe(200)
      expect(JSON.parse(r1.body).items[0].id).toBe('t1')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('persists scoped built-in default preset overrides without clobbering sibling scopes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'veg-defaults-'))
    try {
      const plugin = userPresetsPlugin()
      plugin.configResolved({ root: dir })
      const routes = {}
      plugin.configureServer({
        middlewares: {
          use: (p, fn) => { routes[p] = fn },
        },
      })
      const mw = routes['/api/default-presets']
      expect(mw).toBeTypeOf('function')

      const callApi = (method, url, body) => new Promise((resolve) => {
        const req = Object.assign(new EventEmitter(), { method, url })
        const res = {
          statusCode: 200,
          setHeader: () => {},
          end: (chunk) => resolve({ status: res.statusCode, body: chunk ?? '' }),
        }
        mw(req, res, () => resolve({ status: 404, body: 'NEXT' }))
        if (method === 'PUT' || method === 'POST') {
          queueMicrotask(() => {
            if (body !== undefined) req.emit('data', Buffer.from(body))
            req.emit('end')
          })
        }
      })

      const init = JSON.parse((await callApi('GET', '/')).body)
      expect(init).toEqual({ schemaVersion: 1, persisted: false, rock: {}, tree: {} })

      const bad = await callApi('PUT', '/', JSON.stringify({ scope: 'unknown', overrides: {} }))
      expect(bad.status).toBe(400)

      const putRock = await callApi('PUT', '/', JSON.stringify({
        scope: 'rock',
        overrides: { 'boulder-sand-cap': { seed: 7777 } },
      }))
      expect(putRock.status).toBe(200)
      expect(JSON.parse(putRock.body)).toEqual({ ok: true, scope: 'rock', count: 1 })

      const putTree = await callApi('PUT', '/', JSON.stringify({
        scope: 'tree',
        overrides: { 'broadleaf-round': { seed: 8888 } },
      }))
      expect(putTree.status).toBe(200)

      // Both scopes survive on disk side-by-side without clobbering each other
      const onDisk = JSON.parse(await readFile(join(dir, 'user-presets', 'default-overrides.json'), 'utf8'))
      expect(onDisk.rock['boulder-sand-cap'].seed).toBe(7777)
      expect(onDisk.tree['broadleaf-round'].seed).toBe(8888)

      const afterGet = JSON.parse((await callApi('GET', '/')).body)
      expect(afterGet.persisted).toBe(true)
      expect(afterGet.rock['boulder-sand-cap'].seed).toBe(7777)
      expect(afterGet.tree['broadleaf-round'].seed).toBe(8888)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('persists deleted AI showcase IDs atomically on /api/hidden-showcases', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'veg-hidden-cases-'))
    try {
      const plugin = userPresetsPlugin()
      plugin.configResolved({ root: dir })
      const routes = {}
      plugin.configureServer({
        middlewares: {
          use: (p, fn) => { routes[p] = fn },
        },
      })
      const mw = routes['/api/hidden-showcases']
      expect(mw).toBeTypeOf('function')

      const callApi = (method, url, body) => new Promise((resolve) => {
        const req = Object.assign(new EventEmitter(), { method, url })
        const res = {
          statusCode: 200,
          setHeader: () => {},
          end: (chunk) => resolve({ status: res.statusCode, body: chunk ?? '' }),
        }
        mw(req, res, () => resolve({ status: 404, body: 'NEXT' }))
        if (method === 'PUT' || method === 'POST') {
          queueMicrotask(() => {
            if (body !== undefined) req.emit('data', Buffer.from(body))
            req.emit('end')
          })
        }
      })

      const init = JSON.parse((await callApi('GET', '/')).body)
      expect(init).toEqual({ schemaVersion: 1, persisted: false, hiddenIds: [] })

      const bad1 = await callApi('PUT', '/', JSON.stringify({ hiddenIds: 'not-array' }))
      expect(bad1.status).toBe(400)
      const bad2 = await callApi('PUT', '/', JSON.stringify({ hiddenIds: [123] }))
      expect(bad2.status).toBe(400)

      const put = await callApi('PUT', '/', JSON.stringify({
        schemaVersion: 1,
        hiddenIds: ['sakura', 'sakura', '  flowering-bush  ', ''],
      }))
      expect(put.status).toBe(200)
      expect(JSON.parse(put.body)).toEqual({ ok: true, count: 2, hiddenIds: ['sakura', 'flowering-bush'] })

      const onDisk = JSON.parse(await readFile(join(dir, 'user-presets', 'hidden-showcases.json'), 'utf8'))
      expect(onDisk).toEqual({ schemaVersion: 1, hiddenIds: ['sakura', 'flowering-bush'] })

      const afterGet = JSON.parse((await callApi('GET', '/')).body)
      expect(afterGet).toEqual({ schemaVersion: 1, persisted: true, hiddenIds: ['sakura', 'flowering-bush'] })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('persists saved Scene Assembly cases atomically on /api/scenes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'veg-scenes-'))
    try {
      const plugin = userPresetsPlugin()
      plugin.configResolved({ root: dir })
      const routes = {}
      plugin.configureServer({
        middlewares: {
          use: (p, fn) => { routes[p] = fn },
        },
      })
      const mw = routes['/api/scenes']
      expect(mw).toBeTypeOf('function')

      const callApi = (method, url, body) => new Promise((resolve) => {
        const req = Object.assign(new EventEmitter(), { method, url })
        const res = {
          statusCode: 200,
          setHeader: () => {},
          end: (chunk) => resolve({ status: res.statusCode, body: chunk ?? '' }),
        }
        mw(req, res, () => resolve({ status: 404, body: 'NEXT' }))
        if (method === 'PUT' || method === 'POST') {
          queueMicrotask(() => {
            if (body !== undefined) req.emit('data', Buffer.from(body))
            req.emit('end')
          })
        }
      })

      expect(JSON.parse((await callApi('GET', '/')).body)).toEqual({ schemaVersion: 1, items: [] })
      expect((await callApi('PUT', '/', JSON.stringify({ items: 'bad' }))).status).toBe(400)

      const put = await callApi('PUT', '/', JSON.stringify({
        schemaVersion: 1,
        items: [{ id: 'scene-1', name: '林间孤树地块' }],
      }))
      expect(put.status).toBe(200)
      expect(JSON.parse(put.body)).toEqual({ ok: true, count: 1 })

      const onDisk = JSON.parse(await readFile(join(dir, 'user-presets', 'scenes.json'), 'utf8'))
      expect(onDisk.items[0].name).toBe('林间孤树地块')
      expect(JSON.parse((await callApi('GET', '/')).body).items[0].id).toBe('scene-1')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
