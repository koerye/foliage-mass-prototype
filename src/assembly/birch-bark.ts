import {
  BufferGeometry, CanvasTexture, Color, DataTexture, Float32BufferAttribute, LinearFilter, LinearMipmapLinearFilter,
  MathUtils, Mesh, MeshStandardMaterial, RGBAFormat, SRGBColorSpace, type Object3D,
} from 'three'
import { radiusAt, type Branch } from '../tree/skeleton'
import type { TreeSpec } from '../tree/spec'

const { clamp, lerp, smoothstep } = MathUtils
const BASE_BIRCH_BARK = new Color('#3f4539')
const BASE_BIRCH_MOSS = new Color('#5ea142')

function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y)
  const sx = smoothstep(x - ix, 0, 1), sy = smoothstep(y - iy, 0, 1)
  const hash = (cx: number, cy: number) => {
    let value = Math.imul(cx, 0x1f123bb5) ^ Math.imul(cy, 0x239b961b) ^ Math.imul(seed, 0x165667b1)
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
    return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff
  }
  return lerp(
    lerp(hash(ix, iy), hash(ix + 1, iy), sx),
    lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), sx),
    sy,
  )
}

export function makeBirchPaint(seed: number, spec?: TreeSpec): DataTexture {
  const width = 256, height = 512
  const pixels = new Uint8Array(width * height * 4)
  // Respond smoothly to trunk.barkColor, barkMoss, barkMossColor, barkScale, and flareHeight!
  const barkTint = spec?.trunk.barkColor ? new Color(spec.trunk.barkColor) : BASE_BIRCH_BARK
  const barkShiftR = barkTint.r / Math.max(0.04, BASE_BIRCH_BARK.r)
  const barkShiftG = barkTint.g / Math.max(0.04, BASE_BIRCH_BARK.g)
  const barkShiftB = barkTint.b / Math.max(0.04, BASE_BIRCH_BARK.b)
  const tintLinear = (hex: string, strength = 1) => {
    const c = new Color(hex)
    c.setRGB(
      clamp(c.r * lerp(1, barkShiftR, strength), 0, 1),
      clamp(c.g * lerp(1, barkShiftG, strength), 0, 1),
      clamp(c.b * lerp(1, barkShiftB, strength), 0, 1),
    )
    return c.convertLinearToSRGB()
  }
  const mossStrength = spec?.trunk.barkMoss !== undefined ? clamp(spec.trunk.barkMoss / 0.34, 0, 2.2) : 1
  const mossTint = spec?.trunk.barkMossColor ? new Color(spec.trunk.barkMossColor) : BASE_BIRCH_MOSS
  const mossSR = mossTint.r / Math.max(0.04, BASE_BIRCH_MOSS.r)
  const mossSG = mossTint.g / Math.max(0.04, BASE_BIRCH_MOSS.g)
  const mossSB = mossTint.b / Math.max(0.04, BASE_BIRCH_MOSS.b)
  const mossColor = new Color('#6c984e')
  mossColor.setRGB(clamp(mossColor.r * mossSR, 0, 1), clamp(mossColor.g * mossSG, 0, 1), clamp(mossColor.b * mossSB, 0, 1))
  mossColor.convertLinearToSRGB()

  const freqScale = spec?.trunk.barkScale !== undefined ? clamp(spec.trunk.barkScale / 1.05, 0.35, 2.8) : 1
  const detailScale = spec?.trunk.barkDetail !== undefined ? clamp(spec.trunk.barkDetail / 0.72, 0, 2.2) : 1
  const rootAoStrength = spec?.trunk.barkRootAO !== undefined ? clamp(spec.trunk.barkRootAO, 0, 1) : 0.06
  const flareShift = spec?.trunk.flareHeight !== undefined ? clamp((spec.trunk.flareHeight - 0.68) * 0.18, -0.10, 0.28) : 0

  // Store sRGB pigment colors in the texture. Standard lighting supplies the form shading.
  const shadow = tintLinear('#44594c', 0.85)
  const bark = tintLinear('#677263', 0.92)
  const lichen = new Color('#75864e').convertLinearToSRGB()
  const moss = mossColor
  const chalkGrey = new Color('#9aab9e').convertLinearToSRGB()
  const chalkWhite = new Color('#fffef2').convertLinearToSRGB()
  const pigment = new Color(), chalk = new Color()
  for (let row = 0; row < height; row++) {
    const h = row / (height - 1)
    for (let col = 0; col < width; col++) {
      const u = col / (width - 1)
      // Vertical brushstrokes vary the lower white bark as broad islands with torn edges.
      const brush = noise(u * 24 * freqScale, h * 14 * freqScale, seed + 16)
      const fiber = noise(u * 72 * freqScale, h * 22 * freqScale, seed + 37)
      const cloud = noise(u * 12 * freqScale, h * 21 * freqScale, seed + 85)
      const whiteTop = clamp(.145 + flareShift + .079 * brush + .027 * fiber, 0.02, 0.65)
      const whiteSide = .59 + .13 * cloud - .045 * brush
      const notch = noise(u * 95 * freqScale, h * 45 * freqScale, seed + 51)
      const chipped = smoothstep(brush * .56 + fiber * .29 + notch * .15, .29, .46)
      const whiteMask = (1 - smoothstep(h, whiteTop - .009, whiteTop + .004))
        * smoothstep(u, whiteSide - .07, whiteSide + .045) * (.45 + .55 * chipped)
      const chalkTone = smoothstep(u, whiteSide - .04, whiteSide + .105)

      // Place small uneven moss and lichen marks on the face above the chalk and around the fork.
      const forkHeight = smoothstep(h, .20, .29) * (1 - smoothstep(h, .48, .68))
      const patch = cloud * .62 + brush * .24 + noise(u * 44 * freqScale, h * 87 * freqScale, seed + 51) * .14
      const mossMask = clamp(smoothstep(patch, .46, .66) * forkHeight * smoothstep(u, .48, .76) * mossStrength, 0, 1)
      const barkTone = clamp(0.5 + (smoothstep(brush * .57 + cloud * .43, .24, .73) - 0.5) * detailScale, 0, 1)
      pigment.copy(shadow).lerp(bark, .11 + .63 * barkTone * (.74 + .26 * u))
      pigment.lerp(lichen, clamp(smoothstep(patch, .53, .73) * .38 * forkHeight * mossStrength, 0, 1))
      pigment.lerp(moss, mossMask * .94)
      chalk.copy(chalkGrey).lerp(chalkWhite, chalkTone * (.80 + .20 * fiber))
      pigment.lerp(chalk, whiteMask)
      if (rootAoStrength > 0.005 && h < 0.18) {
        const aoFade = 1 - smoothstep(h, 0, 0.18)
        pigment.multiplyScalar(1 - aoFade * rootAoStrength * 0.58)
      }

      const index = (row * width + col) * 4
      pixels[index] = Math.round(255 * pigment.r)
      pixels[index + 1] = Math.round(255 * pigment.g)
      pixels[index + 2] = Math.round(255 * pigment.b)
      pixels[index + 3] = 255
    }
  }
  const texture = new DataTexture(pixels, width, height, RGBAFormat)
  texture.name = '白桦浅灰手绘树皮'
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

/** Builds a 2D CanvasTexture preview of the live birch bark paint for Tree Studio's texture slot thumbnail. */
export function makeBirchPreviewTexture(seed: number, spec?: TreeSpec): CanvasTexture | undefined {
  if (typeof document === 'undefined') return undefined
  const dataTex = makeBirchPaint(seed, spec)
  const w = dataTex.image.width, h = dataTex.image.height
  const raw = dataTex.image.data as Uint8Array
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const img = ctx.createImageData(w, h)
    // Flip vertically so root sits at bottom and dark fork at top in UI preview
    for (let y = 0; y < h; y++) {
      const srcRow = (h - 1 - y) * w * 4
      const dstRow = y * w * 4
      img.data.set(raw.subarray(srcRow, srcRow + w * 4), dstRow)
    }
    ctx.putImageData(img, 0, 0)
  }
  dataTex.dispose()
  const out = new CanvasTexture(canvas)
  out.name = '白桦浅灰手绘树皮'
  out.colorSpace = SRGBColorSpace
  return out
}

/** Builds the painted white-birch bark material (with automatic DataTexture cleanup on dispose). */
export function makeBirchBarkMaterial(seed: number, spec?: TreeSpec): MeshStandardMaterial {
  const paint = makeBirchPaint(seed, spec)
  const material = new MeshStandardMaterial({
    name: 'Painted white birch bark',
    map: paint,
    vertexColors: true,
    roughness: .96,
    emissive: '#ecefd7',
    emissiveMap: paint,
    emissiveIntensity: .18,
  })
  material.userData.barkStyle = 'birch'
  material.addEventListener('dispose', () => paint.dispose())
  return material
}

/** Projects spine-following birch UVs & subtle root shade directly onto a wood BufferGeometry.
 *  Used identically by both `buildTree()` and `rebuildWoodOnly()` so birch bark never breaks on sculpt/wood edits! */
export function applyBirchWoodSurface(geometry: BufferGeometry, trunk: Branch, trunkHeight: number, seed: number) {
  const pos = geometry.getAttribute('position')
  if (!pos) return
  const sampleCount = 48
  const spine = Array.from({ length: sampleCount + 1 }, (_, i) => {
    const t = i / sampleCount
    return { center: trunk.curve.getPoint(t), radius: Math.max(.035, radiusAt(trunk, t)) }
  })
  const height = Math.max(.1, trunkHeight)
  const uv = new Float32Array(pos.count * 2)
  const tint = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const h = clamp(y / height, 0, 1)
    let lower = spine[0], upper = spine[0], best = Infinity
    for (let j = 0; j < sampleCount; j++) {
      const a = spine[j], b = spine[j + 1]
      if (y >= Math.min(a.center.y, b.center.y) && y <= Math.max(a.center.y, b.center.y)) {
        lower = a
        upper = b
        break
      }
      const dy = Math.abs(a.center.y - y)
      if (dy < best) {
        lower = upper = a
        best = dy
      }
    }
    const t = lower === upper ? 0 : clamp((y - lower.center.y) / (upper.center.y - lower.center.y || 1), 0, 1)
    const dx = x - lerp(lower.center.x, upper.center.x, t)
    const dz = z - lerp(lower.center.z, upper.center.z, t)
    const radius = lerp(lower.radius, upper.radius, t)
    const across = clamp((.74 * dx + .67 * dz) / Math.max(radius, Math.hypot(dx, dz)), -1, 1)
    uv[i * 2] = .5 + .45 * across
    uv[i * 2 + 1] = h
    const rootShade = .88 + .12 * smoothstep(h, 0, .07)
    const sideVariation = .92 + .08 * noise(x * 6 + z * 6.8, y * 4.9, seed)
    tint.fill(rootShade * sideVariation, i * 3, i * 3 + 3)
  }
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  geometry.setAttribute('color', new Float32BufferAttribute(tint, 3))
}

/** Legacy convenience wrapper: binds painted birch bark onto all wood meshes under `root`. */
export function applyPaintedBirchBark(root: Object3D, trunk: Branch, trunkHeight: number, seed: number, spec?: TreeSpec) {
  const wood: Mesh[] = []
  root.traverse(obj => {
    if (obj instanceof Mesh && obj.userData.role === 'wood' && obj.geometry.hasAttribute('position')) wood.push(obj)
  })
  if (!wood.length) return undefined
  const material = makeBirchBarkMaterial(seed, spec)
  for (const mesh of wood) {
    applyBirchWoodSurface(mesh.geometry, trunk, trunkHeight, seed)
    mesh.material = material
  }
  return material
}

