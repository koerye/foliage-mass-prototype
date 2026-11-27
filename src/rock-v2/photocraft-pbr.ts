// Main-thread PhotoCraft PBR texture asset loader & user-import decoder (NOT imported by inline blob: Workers!).
import sandstoneAlbedoUrl from './assets/photocraft-512/sandstone_base_color.png'
import sandstoneNormalUrl from './assets/photocraft-512/sandstone_normal.png'
import sandstoneRoughnessUrl from './assets/photocraft-512/sandstone_roughness.png'
import sandstoneAoUrl from './assets/photocraft-512/sandstone_ao.png'
import mossAlbedoUrl from './assets/photocraft-512/moss_base_color.png'
import mossNormalUrl from './assets/photocraft-512/moss_normal.png'
import mossRoughnessUrl from './assets/photocraft-512/moss_roughness.png'
import mossAoUrl from './assets/photocraft-512/moss_ao.png'
import {
  computeMeanRgb,
  type ExternalPbrLayers,
  type ExternalPbrMapSet,
} from './photocraft-sampler'

export {
  computeMeanRgb,
  makeSolidMapSet,
  sampleTopPlanarPbr,
  sampleTriplanarPbr,
  type ExternalPbrLayers,
  type ExternalPbrMapSet,
  type TriplanarPbrSample,
} from './photocraft-sampler'

async function decodeUrlToRgba(url: string, targetSize = 512): Promise<{ size: number; data: Uint8ClampedArray }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch PhotoCraft texture: ${url} (${res.status})`)
  const blob = await res.blob()
  return decodeBlobToRgba(blob, targetSize)
}

export async function decodeBlobToRgba(blob: Blob, targetSize = 512): Promise<{ size: number; data: Uint8ClampedArray }> {
  if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {
    const bmp = await createImageBitmap(blob)
    const sz = Math.min(targetSize, Math.max(64, bmp.width))
    const canvas = new OffscreenCanvas(sz, sz)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bmp, 0, 0, sz, sz)
    bmp.close()
    const img = ctx.getImageData(0, 0, sz, sz)
    return { size: sz, data: new Uint8ClampedArray(img.data) }
  }
  if (typeof document !== 'undefined') {
    const objUrl = URL.createObjectURL(blob)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('PNG decode failed'))
        el.src = objUrl
      })
      const sz = Math.min(targetSize, Math.max(64, img.naturalWidth || targetSize))
      const canvas = document.createElement('canvas')
      canvas.width = sz
      canvas.height = sz
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, sz, sz)
      const data = ctx.getImageData(0, 0, sz, sz).data
      return { size: sz, data: new Uint8ClampedArray(data) }
    } finally {
      URL.revokeObjectURL(objUrl)
    }
  }
  throw new Error('No image decoder available in current runtime')
}

let cachedDefaultLayers: Promise<ExternalPbrLayers> | null = null

/** Loads and caches the bundled PhotoCraft Material Studio PBR sets (sandstone cliff + velvet terrace moss). */
export function loadDefaultPhotoCraftPbrLayers(): Promise<ExternalPbrLayers> {
  if (!cachedDefaultLayers) {
    cachedDefaultLayers = (async () => {
      const [sAlb, sNor, sRgh, sAo, mAlb, mNor, mRgh, mAo] = await Promise.all([
        decodeUrlToRgba(sandstoneAlbedoUrl, 512),
        decodeUrlToRgba(sandstoneNormalUrl, 512),
        decodeUrlToRgba(sandstoneRoughnessUrl, 512),
        decodeUrlToRgba(sandstoneAoUrl, 512),
        decodeUrlToRgba(mossAlbedoUrl, 512),
        decodeUrlToRgba(mossNormalUrl, 512),
        decodeUrlToRgba(mossRoughnessUrl, 512),
        decodeUrlToRgba(mossAoUrl, 512),
      ])
      return {
        label: 'PhotoCraft · 层叠砂岩 + 苔藓 PBR',
        stone: {
          size: sAlb.size,
          albedo: sAlb.data,
          normal: sNor.data,
          roughness: sRgh.data,
          ao: sAo.data,
          meanRgb: computeMeanRgb(sAlb.data),
        },
        moss: {
          size: mAlb.size,
          albedo: mAlb.data,
          normal: mNor.data,
          roughness: mRgh.data,
          ao: mAo.data,
          meanRgb: computeMeanRgb(mAlb.data),
        },
      }
    })().catch(err => {
      cachedDefaultLayers = null
      throw err
    })
  }
  return cachedDefaultLayers
}

/**
 * Classifies and decodes user-selected PNG files exported by PhotoCraft (`base_color.png`, `normal.png`,
 * `roughness.png`, `ao.png`) into an `ExternalPbrMapSet`, falling back to `fallback` for omitted channels.
 */
export async function decodePhotoCraftPbrFiles(
  files: FileList | File[],
  fallback: ExternalPbrMapSet,
): Promise<{ set: ExternalPbrMapSet; matched: string[] }> {
  const list = Array.from(files)
  let albFile: File | undefined
  let norFile: File | undefined
  let rghFile: File | undefined
  let aoFile: File | undefined

  for (const f of list) {
    const lower = f.name.toLowerCase()
    if (!/\.(png|jpe?g|webp)$/i.test(lower)) continue
    if (/base[_-]?color|albedo|diffuse|color/.test(lower)) albFile = f
    else if (/normal|nrm/.test(lower)) norFile = f
    else if (/rough/.test(lower)) rghFile = f
    else if (/(^|[_\-.])ao([_\-.]|$)|occlusion/.test(lower)) aoFile = f
  }
  if (!albFile && !norFile && !rghFile && !aoFile && list.length === 1) {
    albFile = list[0]
  }

  const matched: string[] = []
  const size = fallback.size
  const alb = albFile ? (matched.push('BaseColor'), (await decodeBlobToRgba(albFile, size)).data) : new Uint8ClampedArray(fallback.albedo)
  const nor = norFile ? (matched.push('Normal'), (await decodeBlobToRgba(norFile, size)).data) : new Uint8ClampedArray(fallback.normal)
  const rgh = rghFile ? (matched.push('Roughness'), (await decodeBlobToRgba(rghFile, size)).data) : new Uint8ClampedArray(fallback.roughness)
  const ao = aoFile ? (matched.push('AO'), (await decodeBlobToRgba(aoFile, size)).data) : new Uint8ClampedArray(fallback.ao)

  if (matched.length === 0) {
    throw new Error('未识别到 base_color / normal / roughness / ao 贴图文件')
  }
  return {
    matched,
    set: {
      size,
      albedo: alb,
      normal: nor,
      roughness: rgh,
      ao,
      meanRgb: computeMeanRgb(alb),
    },
  }
}
