import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { userTexturesPlugin } from '../scripts/textures-plugin.mjs'

describe('userTexturesPlugin (Vite disk persistence middleware for texture library)', () => {
  it('persists saved textures atomically to user-textures/library.json and rejects malformed payloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'veg-textures-'))
    try {
      const plugin = userTexturesPlugin()
      plugin.configResolved({ root: dir })
      let mountPath = ''
      let mw
      plugin.configureServer({
        middlewares: {
          use: (p, fn) => { mountPath = p; mw = fn },
        },
      })
      expect(mountPath).toBe('/api/textures')
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

      const r0 = await callApi('GET', '/')
      expect(r0.status).toBe(200)
      expect(JSON.parse(r0.body)).toEqual({ schemaVersion: 1, items: [] })

      const bad = await callApi('PUT', '/', '{"items":"nope"}')
      expect(bad.status).toBe(400)

      const payload = { schemaVersion: 1, items: [{ id: 'tex-bark-1', name: '橡木树皮' }] }
      const put = await callApi('PUT', '/', JSON.stringify(payload))
      expect(put.status).toBe(200)
      expect(JSON.parse(put.body)).toEqual({ ok: true, count: 1 })

      const onDisk = JSON.parse(await readFile(join(dir, 'user-textures', 'library.json'), 'utf8'))
      expect(onDisk.items[0].name).toBe('橡木树皮')

      const r1 = await callApi('GET', '/')
      expect(r1.status).toBe(200)
      expect(JSON.parse(r1.body).items[0].id).toBe('tex-bark-1')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
