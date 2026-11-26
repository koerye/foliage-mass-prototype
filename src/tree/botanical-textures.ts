// High-craft hand-painted stylized botanical alpha textures (15 x 512x512 RGBA, zero-halo dilated edges).
// Browser/Electron loads real PNG assets via Vite static imports; headless Node/Vitest falls back to 4x4 DataTexture.
import {
  DataTexture, LinearMipmapLinearFilter, RGBAFormat, SRGBColorSpace,
  Texture, TextureLoader,
} from 'three'
import broadStrapLeafUrl from './assets/broad-strap-leaf.png'
import cloverShamrock2x2Url from './assets/clover-shamrock-2x2.png'
import creepingRosette2x2Url from './assets/creeping-rosette-2x2.png'
import fernFrondAUrl from './assets/fern-frond-a.png'
import fernFrondBUrl from './assets/fern-frond-b.png'
import grassBladeBrightUrl from './assets/grass-blade-bright.png'
import grassBladeDeepUrl from './assets/grass-blade-deep.png'
import heartLeafAUrl from './assets/heart-leaf-a.png'
import heartLeafBUrl from './assets/heart-leaf-b.png'
import hydrangeaFloret2x2Url from './assets/hydrangea-floret-2x2.png'
import hydrangeaLeafUrl from './assets/hydrangea-leaf.png'
import narrowHerbLeafUrl from './assets/narrow-herb-leaf.png'
import pinkCosmos2x2Url from './assets/pink-cosmos-2x2.png'
import smallOvateLeafUrl from './assets/small-ovate-leaf.png'
import violetWildflower2x2Url from './assets/violet-wildflower-2x2.png'

export const botanicalTextureKeys = [
  'fern-frond-a',
  'fern-frond-b',
  'broad-strap-leaf',
  'grass-blade-deep',
  'grass-blade-bright',
  'heart-leaf-a',
  'heart-leaf-b',
  'hydrangea-leaf',
  'hydrangea-floret-2x2',
  'small-ovate-leaf',
  'narrow-herb-leaf',
  'pink-cosmos-2x2',
  'violet-wildflower-2x2',
  'clover-shamrock-2x2',
  'creeping-rosette-2x2',
] as const

export type BotanicalTextureKey = typeof botanicalTextureKeys[number]

const BOTANICAL_URLS: Record<BotanicalTextureKey, { url: string; name: string; fallbackRgba: [number, number, number, number] }> = {
  'fern-frond-a': { url: fernFrondAUrl, name: 'Botanical_FernFrondA', fallbackRgba: [112, 178, 54, 255] },
  'fern-frond-b': { url: fernFrondBUrl, name: 'Botanical_FernFrondB', fallbackRgba: [132, 206, 62, 255] },
  'broad-strap-leaf': { url: broadStrapLeafUrl, name: 'Botanical_BroadStrapLeaf', fallbackRgba: [86, 178, 62, 255] },
  'grass-blade-deep': { url: grassBladeDeepUrl, name: 'Botanical_GrassBladeDeep', fallbackRgba: [42, 136, 78, 255] },
  'grass-blade-bright': { url: grassBladeBrightUrl, name: 'Botanical_GrassBladeBright', fallbackRgba: [116, 198, 58, 255] },
  'heart-leaf-a': { url: heartLeafAUrl, name: 'Botanical_HeartLeafA', fallbackRgba: [88, 178, 52, 255] },
  'heart-leaf-b': { url: heartLeafBUrl, name: 'Botanical_HeartLeafB', fallbackRgba: [122, 196, 60, 255] },
  'hydrangea-leaf': { url: hydrangeaLeafUrl, name: 'Botanical_HydrangeaLeaf', fallbackRgba: [76, 158, 54, 255] },
  'hydrangea-floret-2x2': { url: hydrangeaFloret2x2Url, name: 'Botanical_HydrangeaFloret2x2', fallbackRgba: [164, 178, 242, 255] },
  'small-ovate-leaf': { url: smallOvateLeafUrl, name: 'Botanical_SmallOvateLeaf', fallbackRgba: [96, 182, 62, 255] },
  'narrow-herb-leaf': { url: narrowHerbLeafUrl, name: 'Botanical_NarrowHerbLeaf', fallbackRgba: [104, 184, 62, 255] },
  'pink-cosmos-2x2': { url: pinkCosmos2x2Url, name: 'Botanical_PinkCosmos2x2', fallbackRgba: [228, 134, 192, 255] },
  'violet-wildflower-2x2': { url: violetWildflower2x2Url, name: 'Botanical_VioletWildflower2x2', fallbackRgba: [154, 152, 232, 255] },
  'clover-shamrock-2x2': { url: cloverShamrock2x2Url, name: 'Botanical_CloverShamrock2x2', fallbackRgba: [76, 166, 62, 255] },
  'creeping-rosette-2x2': { url: creepingRosette2x2Url, name: 'Botanical_CreepingRosette2x2', fallbackRgba: [154, 214, 52, 255] },
}

const cache = new Map<BotanicalTextureKey, Texture>()
const loadPromises = new Map<BotanicalTextureKey, Promise<Texture>>()

function makeHeadlessFallback(name: string, rgba: [number, number, number, number]): Texture {
  const data = new Uint8Array(4 * 4 * 4)
  for (let i = 0; i < 16; i++) {
    data[i * 4] = rgba[0]
    data[i * 4 + 1] = rgba[1]
    data[i * 4 + 2] = rgba[2]
    data[i * 4 + 3] = rgba[3]
  }
  const tex = new DataTexture(data, 4, 4, RGBAFormat)
  tex.name = name
  tex.colorSpace = SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

/** Returns a cached Three.js Texture for the requested stylized hand-painted botanical asset. */
export function getBotanicalTexture(key: BotanicalTextureKey): Texture {
  const existing = cache.get(key)
  if (existing) return existing
  const meta = BOTANICAL_URLS[key] ?? BOTANICAL_URLS['heart-leaf-a']
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    const tex = makeHeadlessFallback(meta.name, meta.fallbackRgba)
    cache.set(key, tex)
    loadPromises.set(key, Promise.resolve(tex))
    return tex
  }
  const loader = new TextureLoader()
  let resolveReady: ((t: Texture) => void) | undefined
  const ready = new Promise<Texture>(res => { resolveReady = res })
  loadPromises.set(key, ready)

  const tex = loader.load(
    meta.url,
    loaded => {
      loaded.needsUpdate = true
      resolveReady?.(loaded)
    },
    undefined,
    () => {
      resolveReady?.(tex)
    },
  )
  tex.name = meta.name
  tex.colorSpace = SRGBColorSpace
  tex.flipY = true
  tex.generateMipmaps = true
  tex.minFilter = LinearMipmapLinearFilter
  tex.anisotropy = 4
  cache.set(key, tex)
  return tex
}

/** Resolves once every requested botanical PNG texture has decoded onto its Image object. */
export async function waitBotanicalTextures(keys: readonly BotanicalTextureKey[] = botanicalTextureKeys): Promise<void> {
  for (const k of keys) getBotanicalTexture(k)
  await Promise.all(keys.map(k => loadPromises.get(k) ?? Promise.resolve()))
}
