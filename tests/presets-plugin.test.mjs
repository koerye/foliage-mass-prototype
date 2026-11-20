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
})
