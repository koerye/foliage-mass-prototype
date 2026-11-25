// CPU procedural texture bakers for GLB / glTF+TEX / FBX+TEX export:
// 1. Seamless tileable procedural Bark BaseColor (sRGB) + Tangent-Space Normal (OpenGL/DirectX)
//    matching `bark-material.ts` so default procedural trunks export with real PBR textures.
// 2. Lightweight 64x256 stylized Grass Blade gradient + subtle vein BaseColor map
//    for modeled 3D grass blades (`mode === 'blade'`), plus white-normalized vertex colors
//    so engines both WITH and WITHOUT vertex-color multiplication render vivid grass.
import {
  BufferAttribute, BufferGeometry, CanvasTexture, ClampToEdgeWrapping, Color,
  DataTexture, NoColorSpace, RepeatWrapping, RGBAFormat, SRGBColorSpace, Texture,
} from 'three'
import type { NormalMapConvention } from './wood-weld'

export interface ProceduralBarkUniformLike {
  uBarkScale?: { value: number }
  uBarkDetail?: { value: number }
  uBarkShadowShift?: { value: number }
  uBarkTargetColor?: { value: Color }
  uBarkBaseLum?: { value: number }
  uBarkMoss?: { value: number }
  uBarkMossColor?: { value: Color }
  uBarkRootAO?: { value: number }
  uBarkSculpt?: { value: number }
}

export interface BakedProceduralBarkResult {
  colorMap: Texture
  normalMap: Texture
  width: number
  height: number
  normalConvention: NormalMapConvention
  colorBytes: Uint8Array
  normalBytes: Uint8Array
  dispose(): void
}

export interface BakedGrassGradientResult {
  colorMap: Texture
  normalizedColors: BufferAttribute
  width: number
  height: number
  colorBytes: Uint8Array
  dispose(): void
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6))
  return t * t * (3 - 2 * t)
}

function linearToSrgbByte(lin: number): number {
  const c = clamp01(lin)
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, Math.round(s * 255)))
}

// Periodic 2D value noise (strictly seamless on [0, periodX) x [0, periodY))
function hash2(ix: number, iy: number, seed: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  n = n ^ (n >>> 16)
  return (n >>> 0) / 4294967295
}

function periodicNoise2(u: number, v: number, px: number, py: number, seed: number): number {
  const x = ((u * px) % px + px) % px
  const y = ((v * py) % py + py) % py
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = (x0 + 1) % px
  const y1 = (y0 + 1) % py
  const fx = x - x0
  const fy = y - y0
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const n00 = hash2(x0, y0, seed)
  const n10 = hash2(x1, y0, seed)
  const n01 = hash2(x0, y1, seed)
  const n11 = hash2(x1, y1, seed)
  const a = n00 + (n10 - n00) * sx
  const b = n01 + (n11 - n01) * sx
  return a + (b - a) * sy
}

function periodicFbm2(u: number, v: number, basePx: number, basePy: number, octaves: number, seed: number): number {
  let sum = 0
  let amp = 0.52
  let norm = 0
  let px = basePx
  let py = basePy
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicNoise2(u, v, px, py, seed + o * 97)
    norm += amp
    px *= 2
    py *= 2
    amp *= 0.5
  }
  return sum / Math.max(1e-6, norm)
}

function makeRgbaTexture(
  bytes: Uint8Array,
  width: number,
  height: number,
  name: string,
  srgb: boolean,
  clampT = false,
): Texture {
  const wrapS = clampT ? ClampToEdgeWrapping : RepeatWrapping
  const wrapT = clampT ? ClampToEdgeWrapping : RepeatWrapping
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const img = ctx.createImageData(width, height)
      img.data.set(bytes)
      ctx.putImageData(img, 0, 0)
      const tex = new CanvasTexture(canvas)
      tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace
      tex.wrapS = wrapS
      tex.wrapT = wrapT
      tex.anisotropy = 8
      tex.generateMipmaps = true
      tex.name = name
      tex.userData.rawRgba = { bytes, width, height }
      return tex
    }
  }
  const tex = new DataTexture(bytes, width, height, RGBAFormat)
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace
  tex.flipY = true
  tex.wrapS = wrapS
  tex.wrapT = wrapT
  tex.needsUpdate = true
  tex.name = name
  tex.userData.rawRgba = { bytes, width, height }
  return tex
}

/**
 * Bakes seamless tileable BaseColor (sRGB) + Tangent-Space Normal (OpenGL or DirectX)
 * from the procedural bark uniform parameters so default trunks export with genuine PBR textures.
 */
export function bakeProceduralBarkMaps(
  uniforms: ProceduralBarkUniformLike,
  options: {
    size?: number
    normalConvention?: NormalMapConvention
    includeMoss?: boolean
    baseColorOverride?: Color
    seed?: number
  } = {},
): BakedProceduralBarkResult {
  const size = Math.max(128, Math.min(2048, options.size ?? 512))
  const convention: NormalMapConvention = options.normalConvention === 'directx' ? 'directx' : 'opengl'
  const seed = options.seed ?? 137
  const bScale = Math.max(0.25, Math.min(4, Number(uniforms.uBarkScale?.value ?? 1.0)))
  const detail = Math.max(0, Math.min(1.5, Number(uniforms.uBarkDetail?.value ?? 0.72)))
  const shadowShift = clamp01(Number(uniforms.uBarkShadowShift?.value ?? 0.24))
  const sculptW = clamp01(Number(uniforms.uBarkSculpt?.value ?? 0))
  const mossAmt = options.includeMoss ? clamp01(Number(uniforms.uBarkMoss?.value ?? 0)) : 0

  const baseCol = (options.baseColorOverride ?? uniforms.uBarkTargetColor?.value ?? new Color('#5b4636')).clone()
  const mossCol = (uniforms.uBarkMossColor?.value ?? new Color('#5d9132')).clone()

  // Integer periodic frequencies guarantee 100% seamless wrap across both U and V!
  const freqU = Math.max(4, Math.round(8 * Math.sqrt(bScale)))
  const freqV = Math.max(2, Math.round(2 * Math.sqrt(bScale)))

  const heightGrid = new Float32Array(size * size)
  const colorBytes = new Uint8Array(size * size * 4)
  const normalBytes = new Uint8Array(size * size * 4)

  const grainAmt = Math.min(1.0, Math.max(0.22, detail) * (sculptW > 0.01 ? 0.55 : 0.88))
  const warmR = baseCol.r * (1.05 + 0.02 * sculptW)
  const warmG = baseCol.g * (1.03 + 0.02 * sculptW)
  const warmB = baseCol.b * (1.00 + 0.03 * sculptW)
  const coolR = baseCol.r * (0.80 - 0.08 * shadowShift)
  const coolG = baseCol.g * (0.78 - 0.08 * shadowShift)
  const coolB = baseCol.b * (0.82 - 0.06 * shadowShift)

  for (let py = 0; py < size; py++) {
    // Row 0 = top (v = 1), Row size-1 = bottom (v = 0) matching CanvasTexture flipY=true
    const v = 1 - (py + 0.5) / size
    for (let px = 0; px < size; px++) {
      const u = (px + 0.5) / size

      // Domain-warped fibrous vertical bark fissures
      const warpU = (periodicFbm2(u, v, Math.max(2, Math.round(freqU * 0.5)), Math.max(2, freqV), 3, seed + 11) - 0.5) * 0.14
      const warpV = (periodicFbm2(u, v, Math.max(2, Math.round(freqU * 0.5)), Math.max(2, freqV), 2, seed + 29) - 0.5) * 0.06
      const wu = u + warpU
      const wv = v + warpV

      const ridgeRaw = periodicFbm2(wu, wv, freqU, freqV, 4, seed + 47)
      const ridged = 1 - Math.abs(ridgeRaw * 2 - 1)
      const r1 = ridged * ridged
      const fine = periodicNoise2(wu, wv, freqU * 2, freqV * 4, seed + 83)
      const lenticelRaw = periodicNoise2(wu, wv, freqU, freqV * 12, seed + 131)
      const lenticel = smoothstep(0.76, 0.92, lenticelRaw)

      const ridges = r1 * 0.62 + ridgeRaw * 0.38
      const fissure = smoothstep(0.22, 0.78, ridges)
      let h = ridges * 0.78 + fine * 0.18 - lenticel * 0.03

      const pattern = 1 + grainAmt * ((0.85 + 0.26 * fissure + (fine - 0.5) * 0.09 - lenticel * 0.035) - 1)
      const mixT = 0.5 + (fissure - 0.5) * grainAmt
      let r = (coolR + (warmR - coolR) * mixT) * pattern
      let g = (coolG + (warmG - coolG) * mixT) * pattern
      let b = (coolB + (warmB - coolB) * mixT) * pattern

      // Subtle dappled moss patches inside bark crevices when moss is active
      if (mossAmt > 0.001) {
        const crevBias = 1 - smoothstep(0.24, 0.76, h)
        const macroPatch = periodicFbm2(u, v, 4, 4, 3, seed + 211)
        const tuft = periodicFbm2(u, v, 12, 12, 2, seed + 257)
        const mField = crevBias * 0.42 + (macroPatch - 0.48) * 0.85 + (tuft - 0.5) * 0.32
        const mThresh = 1.02 - mossAmt * 0.76
        const mossMask = smoothstep(mThresh - 0.07, mThresh + 0.08, mField) * 0.82
        if (mossMask > 0.001) {
          const ml = clamp01(0.25 + macroPatch * 0.45 + tuft * 0.30)
          const mr = mossCol.r * (0.45 + ml * 0.78)
          const mg = mossCol.g * (0.58 + ml * 0.62)
          const mb = mossCol.b * (0.48 + ml * 0.42)
          r = r + (mr - r) * mossMask
          g = g + (mg - g) * mossMask
          b = b + (mb - b) * mossMask
          h = h + ((0.56 + tuft * 0.22) - h) * (mossMask * 0.6)
        }
      }

      const idx = py * size + px
      heightGrid[idx] = clamp01(h)
      const o = idx * 4
      colorBytes[o] = linearToSrgbByte(r)
      colorBytes[o + 1] = linearToSrgbByte(g)
      colorBytes[o + 2] = linearToSrgbByte(b)
      colorBytes[o + 3] = 255
    }
  }

  // Tangent-space normal map from periodic height field centered differences
  const bumpScale = (2.6 + detail * 3.8) * (size / 512)
  const ySign = convention === 'directx' ? -1 : 1
  for (let py = 0; py < size; py++) {
    const pyUp = (py - 1 + size) % size
    const pyDn = (py + 1) % size
    for (let px = 0; px < size; px++) {
      const pxL = (px - 1 + size) % size
      const pxR = (px + 1) % size
      const hL = heightGrid[py * size + pxL]
      const hR = heightGrid[py * size + pxR]
      // Note: pyUp is larger v (+Y in UV space), pyDn is smaller v (-Y in UV space)
      const hUp = heightGrid[pyUp * size + px]
      const hDn = heightGrid[pyDn * size + px]
      const dHdU = (hR - hL) * 0.5 * bumpScale
      const dHdV = (hUp - hDn) * 0.5 * bumpScale
      let nx = -dHdU
      let ny = -dHdV * ySign
      let nz = 1.0
      const invLen = 1 / Math.hypot(nx, ny, nz)
      nx *= invLen
      ny *= invLen
      nz *= invLen
      const o = (py * size + px) * 4
      normalBytes[o] = Math.max(0, Math.min(255, Math.round((nx * 0.5 + 0.5) * 255)))
      normalBytes[o + 1] = Math.max(0, Math.min(255, Math.round((ny * 0.5 + 0.5) * 255)))
      normalBytes[o + 2] = Math.max(0, Math.min(255, Math.round((nz * 0.5 + 0.5) * 255)))
      normalBytes[o + 3] = 255
    }
  }

  const colorMap = makeRgbaTexture(colorBytes, size, size, 'ProceduralBark_BaseColor', true, false)
  const normalMap = makeRgbaTexture(normalBytes, size, size, `ProceduralBark_Normal_${convention}`, false, false)

  return {
    colorMap,
    normalMap,
    width: size,
    height: size,
    normalConvention: convention,
    colorBytes,
    normalBytes,
    dispose() {
      colorMap.dispose()
      normalMap.dispose()
    },
  }
}

/**
 * Bakes a lightweight 64x256 stylized Grass Blade gradient + subtle vein BaseColor PNG
 * directly from a modeled 3D grass mesh's vertex colors (`COLOR_0`) and blade UVs (`v: 0=root -> 1=tip`),
 * and returns white-normalized vertex colors so external engines both with and without vertex-color
 * multiplication render vivid, non-crushed grass blades!
 */
export function bakeGrassBladeGradientMap(
  geometry: BufferGeometry,
  options: { width?: number; height?: number } = {},
): BakedGrassGradientResult | undefined {
  const colAttr = geometry.getAttribute('color') as BufferAttribute | undefined
  const uvAttr = geometry.getAttribute('uv') as BufferAttribute | undefined
  if (!colAttr || !uvAttr || colAttr.count === 0) return undefined

  const width = options.width ?? 64
  const height = options.height ?? 256
  const buckets = 16
  const sumR = new Float64Array(buckets)
  const sumG = new Float64Array(buckets)
  const sumB = new Float64Array(buckets)
  const counts = new Uint32Array(buckets)

  for (let i = 0; i < colAttr.count; i++) {
    const v = clamp01(uvAttr.getY(i))
    const bi = Math.min(buckets - 1, Math.floor(v * buckets))
    sumR[bi] += colAttr.getX(i)
    sumG[bi] += colAttr.getY(i)
    sumB[bi] += colAttr.getZ(i)
    counts[bi]++
  }

  const avgR = new Float32Array(buckets)
  const avgG = new Float32Array(buckets)
  const avgB = new Float32Array(buckets)
  let fallbackR = 0.26, fallbackG = 0.48, fallbackB = 0.14
  for (let b = 0; b < buckets; b++) {
    if (counts[b] > 0) {
      avgR[b] = sumR[b] / counts[b]
      avgG[b] = sumG[b] / counts[b]
      avgB[b] = sumB[b] / counts[b]
      fallbackR = avgR[b]; fallbackG = avgG[b]; fallbackB = avgB[b]
    }
  }
  // Fill any empty buckets via nearest populated neighbor
  for (let b = 0; b < buckets; b++) {
    if (counts[b] > 0) continue
    let best = -1
    let bestDist = Infinity
    for (let k = 0; k < buckets; k++) {
      if (counts[k] > 0 && Math.abs(k - b) < bestDist) {
        bestDist = Math.abs(k - b)
        best = k
      }
    }
    if (best >= 0) {
      avgR[b] = avgR[best]; avgG[b] = avgG[best]; avgB[b] = avgB[best]
    } else {
      avgR[b] = fallbackR; avgG[b] = fallbackG; avgB[b] = fallbackB
    }
  }

  const sampleGradient = (v: number): [number, number, number] => {
    const f = clamp01(v) * (buckets - 1)
    const i0 = Math.floor(f)
    const i1 = Math.min(buckets - 1, i0 + 1)
    const t = f - i0
    return [
      avgR[i0] + (avgR[i1] - avgR[i0]) * t,
      avgG[i0] + (avgG[i1] - avgG[i0]) * t,
      avgB[i0] + (avgB[i1] - avgB[i0]) * t,
    ]
  }

  const colorBytes = new Uint8Array(width * height * 4)
  for (let py = 0; py < height; py++) {
    const v = 1 - (py + 0.5) / height
    const [gr, gg, gb] = sampleGradient(v)
    for (let px = 0; px < width; px++) {
      const u = (px + 0.5) / width
      // Stylized longitudinal blade midrib highlight + fine fibrous streaks + subtle edge shading
      const centerDist = Math.abs(u - 0.5) * 2 // 0 at center rib, 1 at blade edges
      const midrib = Math.exp(-centerDist * centerDist * 22) * 0.085
      const edgeShade = 1 - centerDist * centerDist * 0.09
      const fineStreak = (Math.sin(u * Math.PI * 10) * 0.018 + Math.sin(u * Math.PI * 22 + v * 3.1) * 0.012) * (0.4 + 0.6 * v)
      const mod = edgeShade + midrib + fineStreak
      const o = (py * width + px) * 4
      colorBytes[o] = linearToSrgbByte(gr * mod)
      colorBytes[o + 1] = linearToSrgbByte(gg * mod)
      colorBytes[o + 2] = linearToSrgbByte(gb * mod)
      colorBytes[o + 3] = 255
    }
  }

  // Normalize vertex colors around white so per-blade 3-tone variation survives without double-darkening
  const normArr = new Float32Array(colAttr.count * 3)
  for (let i = 0; i < colAttr.count; i++) {
    const [gr, gg, gb] = sampleGradient(uvAttr.getY(i))
    const gLum = Math.max(0.02, gr * 0.2126 + gg * 0.7152 + gb * 0.0722)
    const vLum = Math.max(0.01, colAttr.getX(i) * 0.2126 + colAttr.getY(i) * 0.7152 + colAttr.getZ(i) * 0.0722)
    const ratio = Math.max(0.72, Math.min(1.22, vLum / gLum))
    normArr[i * 3] = Math.min(1, ratio)
    normArr[i * 3 + 1] = Math.min(1, ratio)
    normArr[i * 3 + 2] = Math.min(1, ratio)
  }

  const colorMap = makeRgbaTexture(colorBytes, width, height, 'GrassBlade_Gradient_BaseColor', true, true)
  return {
    colorMap,
    normalizedColors: new BufferAttribute(normArr, 3),
    width,
    height,
    colorBytes,
    dispose() {
      colorMap.dispose()
    },
  }
}
