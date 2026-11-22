// Perceptual HSL texture color analysis & GPU GLSL recoloring helpers.
// Enables direct WYSIWYG recoloring of pre-colored painterly/photo leaf & bark textures
// to any artist-selected target color without RGB-multiply muddiness, while preserving
// hand-painted veins, highlights, crevices, and natural warm/cool hue micro-variation.
import type { Texture } from 'three'

export interface TextureColorStats {
  meanH: number    // 0..1 dominant circular hue in sRGB HSL
  meanS: number    // 0..1 average saturation of opaque texels
  meanL: number    // 0..1 average lightness of opaque texels
  strength: number // 0..1 perceptual recolor blend (0 for neutral white/ivory textures, 1 for colored)
}

interface CachedEntry {
  version: number
  foliage: TextureColorStats
  bark: TextureColorStats
}

const statsCache = new WeakMap<Texture, CachedEntry>()
let sampleCanvas: HTMLCanvasElement | undefined
let sampleCtx: CanvasRenderingContext2D | null | undefined

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) * 0.5
  const d = max - min
  if (d < 1e-5) return [0, 0, l]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h, s, l]
}

function readPixels24(tex: Texture): Uint8ClampedArray | undefined {
  const img = tex.image as
    | { data?: Uint8Array | Uint8ClampedArray; width?: number; height?: number }
    | HTMLCanvasElement
    | HTMLImageElement
    | undefined
  if (!img) return undefined

  // Raw DataTexture / ImageData buffer (works in both browser & headless Node)
  if ('data' in img && img.data && img.width && img.height) {
    const w = img.width, h = img.height, src = img.data
    const N = 24
    const out = new Uint8ClampedArray(N * N * 4)
    for (let y = 0; y < N; y++) {
      const sy = Math.min(h - 1, Math.floor(((y + 0.5) / N) * h))
      for (let x = 0; x < N; x++) {
        const sx = Math.min(w - 1, Math.floor(((x + 0.5) / N) * w))
        const si = (sy * w + sx) * 4
        const di = (y * N + x) * 4
        out[di] = src[si]
        out[di + 1] = src[si + 1]
        out[di + 2] = src[si + 2]
        out[di + 3] = src[si + 3]
      }
    }
    return out
  }

  // Browser HTMLCanvasElement / HTMLImageElement / ImageBitmap
  if (typeof document === 'undefined') return undefined
  if (!sampleCanvas) {
    sampleCanvas = document.createElement('canvas')
    sampleCanvas.width = 24
    sampleCanvas.height = 24
    sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true })
  }
  if (!sampleCtx) return undefined
  try {
    sampleCtx.clearRect(0, 0, 24, 24)
    sampleCtx.drawImage(img as CanvasImageSource, 0, 0, 24, 24)
    return sampleCtx.getImageData(0, 0, 24, 24).data
  } catch {
    return undefined
  }
}

/** Measures dominant hue, saturation, and lightness of a texture once (cached per texture version). */
export function analyzeTextureColor(tex: Texture | undefined, mode: 'foliage' | 'bark'): TextureColorStats {
  const neutral: TextureColorStats = { meanH: 0, meanS: 0, meanL: 0.5, strength: mode === 'bark' ? 1 : 0 }
  if (!tex) return neutral

  const cached = statsCache.get(tex)
  if (cached && cached.version === tex.version) return cached[mode]

  const data = readPixels24(tex)
  if (!data) return neutral

  let sumCos = 0, sumSin = 0
  let sumS = 0, sumL = 0, sumChroma = 0, count = 0, coloredCount = 0
  const alphaThresh = mode === 'bark' ? 16 : 80

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a < alphaThresh) continue
    const r = data[i] / 255
    const g = data[i + 1] / 255
    const b = data[i + 2] / 255
    const chroma = Math.max(r, g, b) - Math.min(r, g, b)
    const [h, s, l] = rgbToHsl(r, g, b)
    const w = Math.max(0.05, a / 255)
    // Weight circular hue mean by perceptual chroma (avoids HSL saturation singularity near white/black!)
    const cw = w * (chroma * chroma + 0.005)
    const rad = h * Math.PI * 2
    sumCos += Math.cos(rad) * cw
    sumSin += Math.sin(rad) * cw
    sumS += s * w
    sumL += l * w
    sumChroma += chroma * w
    if (chroma >= 0.14) coloredCount += w
    count += w
  }

  if (count < 1e-4) return neutral
  const meanH = ((Math.atan2(sumSin, sumCos) / (Math.PI * 2)) % 1 + 1) % 1
  const meanS = sumS / count
  const meanL = Math.min(0.92, Math.max(0.12, sumL / count))
  const meanChroma = sumChroma / count
  const coloredFrac = coloredCount / count

  // Foliage: neutral white/ivory cards (sakura, cloud, white daisy petals with small yellow centers)
  // have near-zero chroma on petals -> keep classic multiply so white petals dye cleanly without washing out;
  // genuinely pre-colored textures (green leaves, painted oak clusters, uploaded photos) engage full HSL recoloring!
  const foliageStats: TextureColorStats = {
    meanH,
    meanS,
    meanL,
    strength: smoothstep(0.11, 0.22, meanChroma) * smoothstep(0.45, 0.70, coloredFrac),
  }
  const barkStats: TextureColorStats = {
    meanH,
    meanS,
    meanL,
    strength: 1.0,
  }
  statsCache.set(tex, { version: tex.version, foliage: foliageStats, bark: barkStats })
  return mode === 'bark' ? barkStats : foliageStats
}

/** Shared GLSL perceptual HSL color-transfer helpers (linear RGB <-> sRGB HSL).
 *  Maps texture average color cleanly onto `targetLin` while keeping texture veins, cracks,
 *  highlights, crevices, and subtle warm/cool relative hue variation intact. */
export const RECOLOR_GLSL_HELPERS = /* glsl */ `
vec3 recLinearToSrgb(vec3 c) {
  return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
}
vec3 recSrgbToLinear(vec3 c) {
  return pow(max(c, vec3(0.0)), vec3(2.2));
}
vec3 recRgbToHsl(vec3 c) {
  float maxC = max(c.r, max(c.g, c.b));
  float minC = min(c.r, min(c.g, c.b));
  float l = (maxC + minC) * 0.5;
  float d = maxC - minC;
  if (d < 1e-5) return vec3(0.0, 0.0, l);
  float s = l > 0.5 ? d / max(1e-5, 2.0 - maxC - minC) : d / max(1e-5, maxC + minC);
  float h;
  if (maxC == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
  else if (maxC == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  return vec3(fract(h / 6.0), clamp(s, 0.0, 1.0), clamp(l, 0.0, 1.0));
}
float recHue2Rgb(float p, float q, float t) {
  t = fract(t);
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}
vec3 recHslToRgb(vec3 hsl) {
  float h = hsl.x, s = hsl.y, l = hsl.z;
  if (s < 1e-4) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(
    recHue2Rgb(p, q, h + 1.0 / 3.0),
    recHue2Rgb(p, q, h),
    recHue2Rgb(p, q, h - 1.0 / 3.0)
  );
}
vec3 recTransferColor(vec3 texLin, vec3 tgtLin, float meanH, float meanS, float meanL, float hueSpread) {
  vec3 texHsl = recRgbToHsl(clamp(recLinearToSrgb(texLin), 0.0, 1.0));
  vec3 tgtHsl = recRgbToHsl(clamp(recLinearToSrgb(tgtLin), 0.0, 1.0));
  // Preserve subtle warm/cool local hue nuance around the new target hue
  float dh = fract(texHsl.x - meanH + 0.5) - 0.5;
  float hOut = fract(tgtHsl.x + clamp(dh, -0.18, 0.18) * hueSpread);
  // Scale saturation directly to target saturation with gentle texture micro-variation
  float relS = meanS > 0.08 ? clamp(texHsl.y / max(0.14, meanS), 0.45, 1.38) : 1.0;
  float sOut = clamp(tgtHsl.y * mix(1.0, relS, 0.55), 0.0, 1.0);
  // Preserve tonal relief (veins, bark fissures, highlights) anchored directly at target lightness
  float dL = texHsl.z - meanL;
  float lOut;
  if (dL >= 0.0) {
    float tUp = clamp(dL / max(0.08, 1.0 - meanL), 0.0, 1.0);
    lOut = mix(tgtHsl.z, min(1.0, tgtHsl.z + (1.0 - tgtHsl.z) * 0.78 + 0.04), tUp);
  } else {
    float tDn = clamp(-dL / max(0.08, meanL), 0.0, 1.0);
    lOut = mix(tgtHsl.z, tgtHsl.z * 0.22, tDn);
  }
  return recSrgbToLinear(recHslToRgb(vec3(hOut, sOut, clamp(lOut, 0.0, 1.0))));
}
`
