// UE Landscape-style Terrain Material Paint Brush engine for Scene Assembly Studio.
// Paints stylized painterly ground materials (meadow, sunlit grass, deep moss, dirt trail,
// weathered stone, autumn leaf litter, custom color) + base eraser directly onto the diorama's
// live top CanvasTexture. Because foliageRvt.uRvtMap binds that exact CanvasTexture, painting
// terrain updates BOTH the ground AND all RVT-blended 3D grass on the exact same GPU frame!
import { Color, MathUtils, type CanvasTexture } from 'three'

export type TerrainMaterialId = 'meadow' | 'sunlit' | 'moss' | 'dirt' | 'stone' | 'autumn' | 'custom'

export interface TerrainMaterialPreset {
  id: TerrainMaterialId
  label: string
  subtitle: string
  swatch: string
  baseHex: string
  darkHex: string
  lightHex: string
  grainScale: number
  isHardSurface?: boolean
}

export const TERRAIN_MATERIALS: TerrainMaterialPreset[] = [
  { id: 'meadow', label: '翠绿草地', subtitle: '手绘中绿草坪', swatch: '#4aa146', baseHex: '#4aa146', darkHex: '#2f6e38', lightHex: '#7fc252', grainScale: 1.0 },
  { id: 'sunlit', label: '暖阳浅草', subtitle: '受光暖黄嫩草', swatch: '#8bc54d', baseHex: '#8bc54d', darkHex: '#5ca342', lightHex: '#c8df67', grainScale: 1.0 },
  { id: 'moss', label: '林下暗苔', subtitle: '树影深绿苔藓地', swatch: '#285a3a', baseHex: '#285a3a', darkHex: '#1b3e2d', lightHex: '#4b8645', grainScale: 1.2 },
  { id: 'dirt', label: '沙土小径', subtitle: '暖赭手绘泥沙路', swatch: '#cca96a', baseHex: '#cca96a', darkHex: '#9c7844', lightHex: '#e5cc93', grainScale: 1.4, isHardSurface: true },
  { id: 'stone', label: '青灰碎岩', subtitle: '岩石基座与碎石地', swatch: '#848e8b', baseHex: '#848e8b', darkHex: '#586261', lightHex: '#b4bdb8', grainScale: 1.8, isHardSurface: true },
  { id: 'autumn', label: '金秋落叶', subtitle: '暖褐落叶林地', swatch: '#b97539', baseHex: '#b97539', darkHex: '#7d4723', lightHex: '#e3aa58', grainScale: 1.3 },
  { id: 'custom', label: '自定义色', subtitle: '任意自定义手绘地表色', swatch: '#6fa85a', baseHex: '#6fa85a', darkHex: '#46733b', lightHex: '#9fd07e', grainScale: 1.0 },
]

export interface TerrainBrushOptions {
  mode: 'paint' | 'erase'
  material: TerrainMaterialId
  customColor: string
  radius: number
  /** 0.05..1 opacity / paint flow per stamp */
  strength: number
  /** 0.05..0.95 edge hardness (lower = softer blend, higher = crisper painterly path edge) */
  hardness: number
  /** When painting hard surfaces (dirt/stone), optionally clear overlapping brush grass */
  clearGrassOnHardSurface: boolean
}

export function defaultTerrainBrushOptions(): TerrainBrushOptions {
  return {
    mode: 'paint',
    material: 'dirt',
    customColor: '#78b058',
    radius: 0.95,
    strength: 0.72,
    hardness: 0.45,
    clearGrassOnHardSurface: true,
  }
}

function hash2(ix: number, iy: number, seed: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1274126177)
  n = (n ^ (n >>> 13)) | 0
  n = Math.imul(n, 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}

function noise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash2(ix, iy, seed)
  const b = hash2(ix + 1, iy, seed)
  const c = hash2(ix, iy + 1, seed)
  const d = hash2(ix + 1, iy + 1, seed)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

function hexToSrgbBytes(hex: string): [number, number, number] {
  const c = new Color(hex).convertLinearToSRGB()
  return [
    Math.round(MathUtils.clamp(c.r, 0, 1) * 255),
    Math.round(MathUtils.clamp(c.g, 0, 1) * 255),
    Math.round(MathUtils.clamp(c.b, 0, 1) * 255),
  ]
}

function resolveMaterialPalette(opts: TerrainBrushOptions): {
  dark: [number, number, number]
  base: [number, number, number]
  light: [number, number, number]
  grainScale: number
  seed: number
} {
  if (opts.material === 'custom') {
    const baseCol = new Color(opts.customColor || '#6fa85a')
    const darkCol = baseCol.clone().multiplyScalar(0.68)
    const lightCol = baseCol.clone().lerp(new Color('#eef2cf'), 0.28)
    const toBytes = (c: Color): [number, number, number] => {
      const s = c.clone().convertLinearToSRGB()
      return [Math.round(MathUtils.clamp(s.r, 0, 1) * 255), Math.round(MathUtils.clamp(s.g, 0, 1) * 255), Math.round(MathUtils.clamp(s.b, 0, 1) * 255)]
    }
    return { dark: toBytes(darkCol), base: toBytes(baseCol), light: toBytes(lightCol), grainScale: 1.0, seed: 707 }
  }
  const preset = TERRAIN_MATERIALS.find(m => m.id === opts.material) ?? TERRAIN_MATERIALS[0]
  return {
    dark: hexToSrgbBytes(preset.darkHex),
    base: hexToSrgbBytes(preset.baseHex),
    light: hexToSrgbBytes(preset.lightHex),
    grainScale: preset.grainScale,
    seed: preset.id === 'dirt' ? 131 : preset.id === 'stone' ? 269 : preset.id === 'moss' ? 409 : preset.id === 'autumn' ? 521 : 613,
  }
}

export class TerrainPaintLayer {
  readonly width: number
  readonly height: number
  readonly size: number
  private readonly baseRgba: Uint8ClampedArray
  private readonly paintRgba: Uint8ClampedArray
  private readonly displayRgba: Uint8ClampedArray
  private readonly displayCanvas?: HTMLCanvasElement
  private readonly displayCtx?: CanvasRenderingContext2D
  private readonly texture?: CanvasTexture
  private dirty = false

  constructor(
    size: number,
    width: number,
    height: number,
    basePixels: Uint8ClampedArray,
    displayCanvas?: HTMLCanvasElement,
    texture?: CanvasTexture,
  ) {
    this.size = Math.max(0.5, size)
    this.width = width
    this.height = height
    this.baseRgba = new Uint8ClampedArray(basePixels)
    this.paintRgba = new Uint8ClampedArray(width * height * 4)
    this.displayRgba = new Uint8ClampedArray(basePixels)
    this.displayCanvas = displayCanvas
    this.displayCtx = displayCanvas?.getContext('2d') ?? undefined
    this.texture = texture
  }

  hasPaint(): boolean {
    return this.dirty
  }

  /** Composites dirty pixel rect [x0..x1, y0..y1] from baseRgba + paintRgba -> displayRgba & live GPU texture. */
  private commitRect(x0: number, y0: number, x1: number, y1: number) {
    const w = this.width
    const rw = x1 - x0 + 1
    const rh = y1 - y0 + 1
    if (rw <= 0 || rh <= 0) return

    const base = this.baseRgba
    const paint = this.paintRgba
    const disp = this.displayRgba

    for (let y = y0; y <= y1; y++) {
      let o = (y * w + x0) * 4
      for (let x = x0; x <= x1; x++) {
        const a = paint[o + 3] / 255
        if (a <= 0.001) {
          disp[o] = base[o]
          disp[o + 1] = base[o + 1]
          disp[o + 2] = base[o + 2]
          disp[o + 3] = 255
        } else if (a >= 0.996) {
          disp[o] = paint[o]
          disp[o + 1] = paint[o + 1]
          disp[o + 2] = paint[o + 2]
          disp[o + 3] = 255
        } else {
          const inv = 1 - a
          disp[o] = Math.round(base[o] * inv + paint[o] * a)
          disp[o + 1] = Math.round(base[o + 1] * inv + paint[o + 1] * a)
          disp[o + 2] = Math.round(base[o + 2] * inv + paint[o + 2] * a)
          disp[o + 3] = 255
        }
        o += 4
      }
    }

    if (this.displayCtx) {
      const patch = this.displayCtx.createImageData(rw, rh)
      const pd = patch.data
      for (let row = 0; row < rh; row++) {
        const srcStart = ((y0 + row) * w + x0) * 4
        pd.set(disp.subarray(srcStart, srcStart + rw * 4), row * rw * 4)
      }
      this.displayCtx.putImageData(patch, x0, y0)
    }
    if (this.texture) {
      this.texture.needsUpdate = true
    }
  }

  /** Stamps a stylized painterly terrain material (or erases back to base) at world (wx, wz). */
  paintAt(wx: number, wz: number, opts: TerrainBrushOptions, erase = false): boolean {
    const u = wx / this.size + 0.5
    const v = wz / this.size + 0.5
    const rPx = Math.max(2, (Math.max(0.12, opts.radius) / this.size) * this.width)
    const cx = u * (this.width - 1)
    const cy = v * (this.height - 1)

    const pad = Math.ceil(rPx * 1.18)
    const x0 = Math.max(0, Math.floor(cx - pad))
    const x1 = Math.min(this.width - 1, Math.ceil(cx + pad))
    const y0 = Math.max(0, Math.floor(cy - pad))
    const y1 = Math.min(this.height - 1, Math.ceil(cy + pad))
    if (x0 > x1 || y0 > y1) return false

    const strength = MathUtils.clamp(opts.strength, 0.05, 1)
    const hardness = MathUtils.clamp(opts.hardness, 0.05, 0.95)
    const pal = resolveMaterialPalette(opts)
    const paint = this.paintRgba
    const w = this.width
    const invR = 1 / Math.max(1, rPx)
    const gScale = pal.grainScale
    let touched = false

    for (let y = y0; y <= y1; y++) {
      const dy = y - cy
      const ny = y / this.height
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx
        const distNorm = Math.hypot(dx, dy) * invR
        if (distNorm > 1.16) continue

        // Hand-painted organic edge breakup so strokes never look like clinical airbrush circles
        const nx = x / this.width
        const edgeNoise = (noise2(nx * 24, ny * 24, pal.seed + 19) - 0.5) * 0.22
          + (noise2(nx * 56, ny * 56, pal.seed + 73) - 0.5) * 0.09
        const dEff = distNorm + edgeNoise * (1 - hardness * 0.45)
        if (dEff >= 1.0) continue

        const falloff = dEff <= hardness
          ? 1.0
          : (() => {
              const t = 1 - (dEff - hardness) / Math.max(0.05, 1 - hardness)
              return t * t * (3 - 2 * t)
            })()
        const alpha = falloff * strength * 0.55
        if (alpha < 0.004) continue

        const o = (y * w + x) * 4
        if (erase) {
          const prevA = paint[o + 3]
          if (prevA > 0) {
            paint[o + 3] = Math.max(0, Math.round(prevA * (1 - Math.min(1, alpha * 1.45))))
            touched = true
          }
          continue
        }

        // Stylized multi-tone painterly surface pigment (matches diorama aesthetic!)
        const macro = noise2(nx * 14 * gScale, ny * 14 * gScale, pal.seed)
        const stroke = noise2(nx * 36 * gScale + macro * 1.4, ny * 28 * gScale - macro * 1.1, pal.seed + 41)
        const micro = hash2(x, y, pal.seed + 97)
        const toneVal = MathUtils.clamp(macro * 0.55 + stroke * 0.35 + (micro - 0.5) * 0.14, 0, 1)
        // Slight painterly tonal banding
        const banded = Math.floor(toneVal * 5) / 5
        const t = toneVal * 0.55 + banded * 0.45

        let sr: number, sg: number, sb: number
        if (t < 0.5) {
          const k = t * 2
          sr = pal.dark[0] + (pal.base[0] - pal.dark[0]) * k
          sg = pal.dark[1] + (pal.base[1] - pal.dark[1]) * k
          sb = pal.dark[2] + (pal.base[2] - pal.dark[2]) * k
        } else {
          const k = (t - 0.5) * 2
          sr = pal.base[0] + (pal.light[0] - pal.base[0]) * k
          sg = pal.base[1] + (pal.light[1] - pal.base[1]) * k
          sb = pal.base[2] + (pal.light[2] - pal.base[2]) * k
        }

        // Standard Porter-Duff source-over blend into persistent paint layer
        const dstA = paint[o + 3] / 255
        const outA = alpha + dstA * (1 - alpha)
        if (outA > 1e-4) {
          const wSrc = alpha / outA
          const wDst = 1 - wSrc
          paint[o] = Math.round(sr * wSrc + paint[o] * wDst)
          paint[o + 1] = Math.round(sg * wSrc + paint[o + 1] * wDst)
          paint[o + 2] = Math.round(sb * wSrc + paint[o + 2] * wDst)
          paint[o + 3] = Math.round(Math.min(1, outA) * 255)
        }
        touched = true
      }
    }

    if (touched) {
      if (!erase) this.dirty = true
      else {
        // Re-check whether any painted pixel remains
        let any = false
        for (let i = 3; i < paint.length; i += 4) { if (paint[i] > 0) { any = true; break } }
        this.dirty = any
      }
      this.commitRect(x0, y0, x1, y1)
    }
    return touched
  }

  /** Samples the live composited ground color (procedural base + user terrain paint) in linear Color space. */
  sampleLinearColor(wx: number, wz: number, out = new Color()): Color {
    const u = MathUtils.clamp(wx / this.size + 0.5, 0, 1)
    const v = MathUtils.clamp(wz / this.size + 0.5, 0, 1)
    const ix = Math.min(this.width - 1, Math.max(0, Math.round(u * (this.width - 1))))
    const iy = Math.min(this.height - 1, Math.max(0, Math.round(v * (this.height - 1))))
    const o = (iy * this.width + ix) * 4
    return out
      .setRGB(this.displayRgba[o] / 255, this.displayRgba[o + 1] / 255, this.displayRgba[o + 2] / 255)
      .convertSRGBToLinear()
  }

  clear() {
    if (!this.dirty) return
    this.paintRgba.fill(0)
    this.dirty = false
    this.commitRect(0, 0, this.width - 1, this.height - 1)
  }

  /** Serializes ONLY the user's painted overlay as a compact PNG DataURL (returns undefined if clean). */
  exportDataUrl(): string | undefined {
    if (!this.dirty || typeof document === 'undefined') return undefined
    const c = document.createElement('canvas')
    c.width = this.width
    c.height = this.height
    const g = c.getContext('2d')
    if (!g) return undefined
    const img = g.createImageData(this.width, this.height)
    img.data.set(this.paintRgba)
    g.putImageData(img, 0, 0)
    return c.toDataURL('image/png')
  }

  /** Restores a previously exported PNG overlay DataURL onto the terrain paint layer. */
  async importDataUrl(dataUrl: string | undefined): Promise<void> {
    if (!dataUrl || typeof document === 'undefined' || typeof Image === 'undefined') {
      this.clear()
      return
    }
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('无法解码地形绘制贴图'))
      el.src = dataUrl
    })
    const c = document.createElement('canvas')
    c.width = this.width
    c.height = this.height
    const g = c.getContext('2d')
    if (!g) return
    g.clearRect(0, 0, this.width, this.height)
    g.drawImage(img, 0, 0, this.width, this.height)
    const data = g.getImageData(0, 0, this.width, this.height).data
    this.paintRgba.set(data)
    let any = false
    for (let i = 3; i < data.length; i += 4) { if (data[i] > 0) { any = true; break } }
    this.dirty = any
    this.commitRect(0, 0, this.width - 1, this.height - 1)
  }
}
