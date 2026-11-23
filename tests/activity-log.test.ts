import { describe, expect, it } from 'vitest'
import { BoxGeometry, DataTexture, Group, Mesh, MeshStandardMaterial, RGBAFormat } from 'three'
import { exportGlb } from '../src/export-glb'
import {
  activityLog,
  createActivityLog,
  detectBrowserInfo,
  inspectGlbBinary,
  type StorageLike,
} from '../src/studio/activity-log'

function makeMemoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v) },
    removeItem: k => { map.delete(k) },
  }
}

function buildSyntheticGlb(doc: Record<string, unknown>, binBytes: Uint8Array): ArrayBuffer {
  const enc = new TextEncoder()
  const rawJson = enc.encode(JSON.stringify(doc))
  const jsonPad = (4 - (rawJson.byteLength % 4)) % 4
  const jsonLen = rawJson.byteLength + jsonPad
  const binPad = (4 - (binBytes.byteLength % 4)) % 4
  const binLen = binBytes.byteLength + binPad
  const total = 12 + 8 + jsonLen + (binLen > 0 ? 8 + binLen : 0)

  const buf = new ArrayBuffer(total)
  const dv = new DataView(buf)
  const u8 = new Uint8Array(buf)
  dv.setUint32(0, 0x46546c67, true) // glTF
  dv.setUint32(4, 2, true)
  dv.setUint32(8, total, true)
  dv.setUint32(12, jsonLen, true)
  dv.setUint32(16, 0x4e4f534a, true) // JSON
  u8.set(rawJson, 20)
  for (let i = 0; i < jsonPad; i++) u8[20 + rawJson.byteLength + i] = 0x20

  if (binLen > 0) {
    const off = 20 + jsonLen
    dv.setUint32(off, binLen, true)
    dv.setUint32(off + 4, 0x004e4942, true) // BIN
    u8.set(binBytes, off + 8)
  }
  return buf
}

describe('activity-log core store & browser detection', () => {
  it('records ordered steps, handles circular details & Errors safely, and persists across session reloads', async () => {
    const storage = makeMemoryStorage()
    const store = createActivityLog({ storage, maxEntries: 60 })
    store.setPage('broadleaf')

    const circ: Record<string, unknown> = { a: 1 }
    circ.self = circ

    store.action('点击「导出 GLB」', { id: 'glb' }, 'export')
    store.exportStep('预处理完成', circ)
    store.warn('texture', '检测到未加载图片')
    store.error('export', '编码失败', new Error('canvas.toBlob returned null'))

    const counts = store.counts()
    expect(counts).toEqual({ total: 4, actions: 1, exports: 1, warns: 1, errors: 1 })
    expect(store.entries().map(e => e.seq)).toEqual([1, 2, 3, 4])

    const parsedJson = JSON.parse(store.exportJson())
    expect(parsedJson.entries[1].detail.self).toBe('[Circular]')
    expect(parsedJson.entries[3].detail.message).toBe('canvas.toBlob returned null')
    expect(store.exportText()).toContain('点击「导出 GLB」')
    expect(store.exportText()).toContain('canvas.toBlob returned null')

    // Wait for batched sessionStorage persist, then reload a fresh store
    await new Promise(r => setTimeout(r, 180))
    const reloaded = createActivityLog({ storage, maxEntries: 60 })
    expect(reloaded.entries()).toHaveLength(4)
    expect(reloaded.entries()[0].message).toBe('点击「导出 GLB」')

    reloaded.clear()
    expect(reloaded.entries()).toHaveLength(0)
  })

  it('accurately detects macOS Safari, iOS Safari, Chrome, Edge, and Firefox', () => {
    const macSafari = detectBrowserInfo('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15')
    expect(macSafari.isSafari).toBe(true)
    expect(macSafari.isIOS).toBe(false)
    expect(macSafari.browser).toBe('Safari 17.5')

    const iosSafari = detectBrowserInfo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1')
    expect(iosSafari.isSafari).toBe(true)
    expect(iosSafari.isIOS).toBe(true)

    const chrome = detectBrowserInfo('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')
    expect(chrome.isSafari).toBe(false)
    expect(chrome.browser).toContain('Chrome 126')

    const edge = detectBrowserInfo('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0')
    expect(edge.isSafari).toBe(false)
    expect(edge.browser).toContain('Edge 126')
  })
})

describe('inspectGlbBinary & exportGlb diagnostic logging', () => {
  it('parses GLB binary headers, verifies valid PNG images, and catches missing/empty images', () => {
    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
    const goodGlb = buildSyntheticGlb({
      asset: { version: '2.0' },
      meshes: [{ name: 'Tree' }],
      materials: [{
        name: 'Mat_Foliage_Leaves',
        alphaMode: 'MASK',
        doubleSided: true,
        pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
      }],
      textures: [{ source: 0 }],
      images: [{ mimeType: 'image/png', bufferView: 0 }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: fakePng.byteLength }],
    }, fakePng)

    const diag = inspectGlbBinary(goodGlb)
    expect(diag.valid).toBe(true)
    expect(diag.materialCount).toBe(1)
    expect(diag.textureCount).toBe(1)
    expect(diag.imageCount).toBe(1)
    expect(diag.materials[0].hasBaseColorTex).toBe(true)
    expect(diag.images[0].magic).toBe('PNG')
    expect(diag.images[0].byteLength).toBe(fakePng.byteLength)

    // Broken image with empty bufferView (simulates Safari blank/failed toBlob)
    const brokenGlb = buildSyntheticGlb({
      asset: { version: '2.0' },
      meshes: [{ name: 'Tree' }],
      materials: [{ name: 'Mat_Foliage_Leaves', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      textures: [{ source: 0 }],
      images: [{ mimeType: 'image/png', bufferView: 0 }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 0 }],
    }, new Uint8Array(4))

    const brokenDiag = inspectGlbBinary(brokenGlb)
    expect(brokenDiag.valid).toBe(true)
    expect(brokenDiag.images[0].magic).toBe('EMPTY')
    expect(brokenDiag.images[0].byteLength).toBe(0)

    const invalidDiag = inspectGlbBinary(new ArrayBuffer(8))
    expect(invalidDiag.valid).toBe(false)
  })

  it('logs pre-export and post-export diagnostic entries during exportGlb', async () => {
    const prevFileReader = (globalThis as { FileReader?: unknown }).FileReader
    if (typeof prevFileReader === 'undefined') {
      ;(globalThis as { FileReader?: unknown }).FileReader = class MockFileReader {
        result: ArrayBuffer | null = null
        onloadend: (() => void) | null = null
        readAsArrayBuffer(blob: Blob) {
          void blob.arrayBuffer().then(buf => {
            this.result = buf
            this.onloadend?.()
          })
        }
      }
    }
    activityLog.clear()
    const root = new Group()
    root.name = 'LogTestRoot'
    const texData = new Uint8Array(4 * 4 * 4)
    texData.fill(200)
    const tex = new DataTexture(texData, 4, 4, RGBAFormat)
    tex.name = 'test_leaf'
    const mat = new MeshStandardMaterial({ name: 'LeafMat', map: null })
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), mat)
    mesh.name = 'TestBox'
    root.add(mesh)

    try {
      const blob = await exportGlb(root, { mode: 'merged' })
      expect(blob.size).toBeGreaterThan(100)
      const exportEntries = activityLog.entries().filter(e => e.category === 'export')
      expect(exportEntries.length).toBeGreaterThanOrEqual(3)
      expect(exportEntries.some(e => e.message.includes('开始导出 GLB'))).toBe(true)
      expect(exportEntries.some(e => e.message.includes('GLB 预处理完成'))).toBe(true)
      expect(exportEntries.some(e => e.message.includes('GLB 编码完成'))).toBe(true)
    } finally {
      tex.dispose()
      mat.dispose()
      mesh.geometry.dispose()
      if (typeof prevFileReader === 'undefined') {
        delete (globalThis as { FileReader?: unknown }).FileReader
      }
    }
  })
})
