import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

      const callApi = (method, url, body, headers) => new Promise((resolve) => {
        const reqHeaders = headers !== undefined
          ? headers
          : (method === 'PUT' ? { 'content-type': 'application/json' } : {})
        const req = Object.assign(new EventEmitter(), { method, url, headers: reqHeaders })
        const resHeaders = {}
        const res = {
          statusCode: 200,
          setHeader: (k, v) => { resHeaders[String(k).toLowerCase()] = String(v) },
          end: (chunk) => resolve({ status: res.statusCode, headers: resHeaders, body: chunk ?? '' }),
        }
        mw(req, res, () => resolve({ status: 404, headers: resHeaders, body: 'NEXT' }))
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

      // REQ-C4: POST rejected with 405, missing/non-JSON Content-Type rejected with 415
      const postRes = await callApi('POST', '/', JSON.stringify({ items: [] }), { 'content-type': 'application/json' })
      expect(postRes.status).toBe(405)
      expect(postRes.headers.allow).toBe('GET, PUT')
      expect((await callApi('PUT', '/', JSON.stringify({ items: [] }), {})).status).toBe(415)
      expect((await callApi('PUT', '/', JSON.stringify({ items: [] }), { 'content-type': 'text/plain' })).status).toBe(415)

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

      // Second write creates library.json.bak; corrupting library.json must auto-recover from .bak
      const put2 = await callApi('PUT', '/', JSON.stringify({ items: [{ id: 'tex-bark-2', name: '白桦树皮' }] }))
      expect(put2.status).toBe(200)
      await writeFile(join(dir, 'user-textures', 'library.json'), '{corrupted-library', 'utf8')

      const recovered = await callApi('GET', '/')
      expect(recovered.status).toBe(200)
      expect(JSON.parse(recovered.body).items[0].id).toBe('tex-bark-1')

      const recSummary = await callApi('GET', '/?summary=1')
      expect(recSummary.status).toBe(200)
      expect(JSON.parse(recSummary.body).items[0].id).toBe('tex-bark-1')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
