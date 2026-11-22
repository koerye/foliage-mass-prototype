// Serialize / deserialize live Three.js Texture slots (including optional PBR Normal /
// Roughness / HeightField channels) for whole-tree default preset persistence.
import type { Texture } from 'three'
import { dataUrlToThreeTexture } from '../texgraph/engine'
import { editableTextureSlots, type EditableTextureSlot, type TextureRegistry } from './texture-slots'

export interface SavedSlotTexture {
  name: string
  dataUrl: string
  normalDataUrl?: string
  roughnessDataUrl?: string
  heightDataUrl?: string
}

export type SavedTextureMap = Partial<Record<EditableTextureSlot, SavedSlotTexture>>

const SAFE_IMAGE_DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/

function isSafeDataUrl(v: unknown): v is string {
  return typeof v === 'string' && SAFE_IMAGE_DATA_URL_RE.test(v)
}

function textureImageToDataUrl(tex: Texture): string | undefined {
  if (typeof document === 'undefined') return undefined
  const img = tex.image as (
    | HTMLCanvasElement
    | HTMLImageElement
    | ImageBitmap
    | { data?: Uint8Array | Uint8ClampedArray; width?: number; height?: number }
    | undefined
  )
  if (!img) return undefined
  if (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) {
    if (!img.width || !img.height) return undefined
    return img.toDataURL('image/png')
  }
  const w = Number(('naturalWidth' in img ? img.naturalWidth : undefined) || img.width || 0)
  const h = Number(('naturalHeight' in img ? img.naturalHeight : undefined) || img.height || 0)
  if (!w || !h) return undefined
  const cw = Math.min(2048, w)
  const ch = Math.min(2048, h)
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const g = canvas.getContext('2d')
  if (!g) return undefined
  if ('data' in img && img.data && (img.data instanceof Uint8Array || img.data instanceof Uint8ClampedArray)) {
    const src = document.createElement('canvas')
    src.width = w
    src.height = h
    const sg = src.getContext('2d')
    if (!sg) return undefined
    const idata = sg.createImageData(w, h)
    idata.data.set(img.data.subarray(0, idata.data.length))
    sg.putImageData(idata, 0, 0)
    g.drawImage(src, 0, 0, cw, ch)
    return canvas.toDataURL('image/png')
  }
  try {
    g.drawImage(img as CanvasImageSource, 0, 0, cw, ch)
    return canvas.toDataURL('image/png')
  } catch {
    return undefined
  }
}

function heightFieldToDataUrl(hf: unknown): string | undefined {
  if (typeof document === 'undefined' || !hf || typeof hf !== 'object') return undefined
  const field = hf as { data?: Float32Array; width?: number; height?: number }
  if (!(field.data instanceof Float32Array) || !field.width || !field.height) return undefined
  const w = Math.min(2048, field.width)
  const h = Math.min(2048, field.height)
  const canvas = document.createElement('canvas')
  canvas.width = field.width
  canvas.height = field.height
  const g = canvas.getContext('2d')
  if (!g) return undefined
  const img = g.createImageData(field.width, field.height)
  const px = img.data
  const src = field.data
  const n = Math.min(src.length, field.width * field.height)
  for (let i = 0; i < n; i++) {
    const v = src[i]
    const b = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255)
    const o = i * 4
    px[o] = b; px[o + 1] = b; px[o + 2] = b; px[o + 3] = 255
  }
  g.putImageData(img, 0, 0)
  if (w === field.width && h === field.height) return canvas.toDataURL('image/png')
  const out = document.createElement('canvas')
  out.width = w; out.height = h
  out.getContext('2d')?.drawImage(canvas, 0, 0, w, h)
  return out.toDataURL('image/png')
}

export function serializeThreeTexture(tex: Texture): SavedSlotTexture | undefined {
  const dataUrl = textureImageToDataUrl(tex)
  if (!dataUrl) return undefined
  const ud = (tex.userData ?? {}) as Record<string, unknown>
  const normalDataUrl = ud.normalMap ? textureImageToDataUrl(ud.normalMap as Texture) : undefined
  const roughnessDataUrl = ud.roughnessMap ? textureImageToDataUrl(ud.roughnessMap as Texture) : undefined
  const heightDataUrl = ud.heightField ? heightFieldToDataUrl(ud.heightField) : undefined
  return {
    name: (tex.name || 'custom_texture').slice(0, 80),
    dataUrl,
    ...(normalDataUrl ? { normalDataUrl } : {}),
    ...(roughnessDataUrl ? { roughnessDataUrl } : {}),
    ...(heightDataUrl ? { heightDataUrl } : {}),
  }
}

export function captureCustomRegistryTextures(registry: TextureRegistry): SavedTextureMap {
  const out: SavedTextureMap = {}
  for (const slot of editableTextureSlots) {
    const custom = registry.getCustom(slot)
    if (!custom) continue
    const serialized = serializeThreeTexture(custom)
    if (serialized) out[slot] = serialized
  }
  return out
}

export function parseSavedTextureMap(raw: unknown): SavedTextureMap | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const rec = raw as Record<string, unknown>
  const out: SavedTextureMap = {}
  let count = 0
  for (const slot of editableTextureSlots) {
    const entry = rec[slot]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const e = entry as Record<string, unknown>
    if (!isSafeDataUrl(e.dataUrl)) continue
    out[slot] = {
      name: typeof e.name === 'string' && e.name.trim() ? e.name.trim().slice(0, 80) : 'custom_texture',
      dataUrl: e.dataUrl,
      ...(isSafeDataUrl(e.normalDataUrl) ? { normalDataUrl: e.normalDataUrl } : {}),
      ...(isSafeDataUrl(e.roughnessDataUrl) ? { roughnessDataUrl: e.roughnessDataUrl } : {}),
      ...(isSafeDataUrl(e.heightDataUrl) ? { heightDataUrl: e.heightDataUrl } : {}),
    }
    count++
  }
  return count > 0 ? out : undefined
}

export async function decodeSavedTextureMap(
  saved: SavedTextureMap | undefined,
): Promise<Partial<Record<EditableTextureSlot, Texture>>> {
  const decoded: Partial<Record<EditableTextureSlot, Texture>> = {}
  if (!saved) return decoded
  const entries = Object.entries(saved) as [EditableTextureSlot, SavedSlotTexture][]
  await Promise.all(entries.map(async ([slot, item]) => {
    try {
      decoded[slot] = await dataUrlToThreeTexture(item.dataUrl, slot, item.name, {
        normalDataUrl: item.normalDataUrl,
        roughnessDataUrl: item.roughnessDataUrl,
        heightDataUrl: item.heightDataUrl,
      })
    } catch {
      // Skip unreadable slot image gracefully
    }
  }))
  return decoded
}
