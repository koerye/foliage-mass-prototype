import {
  Color, DataTexture, Float32BufferAttribute, LinearFilter, LinearMipmapLinearFilter,
  MathUtils, Mesh, MeshStandardMaterial, RGBAFormat, SRGBColorSpace, type Object3D,
} from 'three'
import { radiusAt, type Branch } from '../tree/skeleton'

const { clamp, lerp, smoothstep } = MathUtils

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

function makeBirchPaint(seed: number): DataTexture {
  const width = 256, height = 512
  const pixels = new Uint8Array(width * height * 4)
  // Store sRGB pigment colors in the texture. Standard lighting supplies the form shading.
  const shadow = new Color('#44594c').convertLinearToSRGB()
  const bark = new Color('#677263').convertLinearToSRGB()
  const lichen = new Color('#75864e').convertLinearToSRGB()
  const moss = new Color('#6c984e').convertLinearToSRGB()
  const chalkGrey = new Color('#9aab9e').convertLinearToSRGB()
  const chalkWhite = new Color('#f4f5e7').convertLinearToSRGB()
  const pigment = new Color(), chalk = new Color()
  for (let row = 0; row < height; row++) {
    const h = row / (height - 1)
    for (let col = 0; col < width; col++) {
      const u = col / (width - 1)
      // Vertical brushstrokes vary the lower white bark as broad islands with torn edges.
      const brush = noise(u * 24, h * 14, seed + 16)
      const fiber = noise(u * 72, h * 22, seed + 37)
      const cloud = noise(u * 12, h * 21, seed + 85)
      const whiteTop = .165 + .077 * brush + .027 * fiber
      const whiteSide = .59 + .13 * cloud - .045 * brush
      const notch = noise(u * 95, h * 45, seed + 51)
      const chipped = smoothstep(brush * .56 + fiber * .29 + notch * .15, .29, .46)
      const whiteMask = (1 - smoothstep(h, whiteTop - .009, whiteTop + .004))
        * smoothstep(u, whiteSide - .07, whiteSide + .045) * (.45 + .55 * chipped)
      const chalkTone = smoothstep(u, whiteSide - .025, whiteSide + .143)

      // Place small uneven moss and lichen marks on the face above the chalk and around the fork.
      const forkHeight = smoothstep(h, .20, .29) * (1 - smoothstep(h, .48, .68))
      const patch = cloud * .62 + brush * .24 + noise(u * 44, h * 87, seed + 51) * .14
      const mossMask = smoothstep(patch, .49, .68) * forkHeight * smoothstep(u, .48, .76)
      const barkTone = smoothstep(brush * .57 + cloud * .43, .24, .73)
      pigment.copy(shadow).lerp(bark, .11 + .63 * barkTone * (.74 + .26 * u))
      pigment.lerp(lichen, smoothstep(patch, .53, .73) * .38 * forkHeight)
      pigment.lerp(moss, mossMask * .94)
      chalk.copy(chalkGrey).lerp(chalkWhite, chalkTone * (.80 + .20 * fiber))
      pigment.lerp(chalk, whiteMask)

      const index = (row * width + col) * 4
      pixels[index] = Math.round(255 * pigment.r)
      pixels[index + 1] = Math.round(255 * pigment.g)
      pixels[index + 2] = Math.round(255 * pigment.b)
      pixels[index + 3] = 255
    }
  }
  const texture = new DataTexture(pixels, width, height, RGBAFormat)
  texture.name = 'White birch • painted bark'
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

/** Bind a painted bark map to the actual wood surface. The UVs follow the trunk spine
 *  and the pigments stay fixed to the wood when the camera or studio lighting moves. */
export function applyPaintedBirchBark(root: Object3D, trunk: Branch, trunkHeight: number, seed: number) {
  const wood: Mesh[] = []
  root.traverse(obj => {
    if (obj instanceof Mesh && obj.userData.role === 'wood' && obj.geometry.hasAttribute('position')) wood.push(obj)
  })
  if (!wood.length) return undefined

  const paint = makeBirchPaint(seed)
  const material = new MeshStandardMaterial({
    name: 'Painted white birch bark', map: paint, vertexColors: true, roughness: .96,
  })
  material.addEventListener('dispose', () => paint.dispose())

  const sampleCount = 48
  const spine = Array.from({ length: sampleCount + 1 }, (_, i) => {
    const t = i / sampleCount
    return { center: trunk.curve.getPoint(t), radius: Math.max(.035, radiusAt(trunk, t)) }
  })
  const height = Math.max(.1, trunkHeight)
  for (const mesh of wood) {
    const geometry = mesh.geometry
    const pos = geometry.getAttribute('position')
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
      // A trunk-local projection has no wrap seam or camera dependency. The broad facing
      // stroke stays on one side of curved rings, while the darker pigment wraps around it.
      const across = clamp((.74 * dx + .67 * dz) / Math.max(radius, Math.hypot(dx, dz)), -1, 1)
      uv[i * 2] = .5 + .45 * across
      uv[i * 2 + 1] = h
      const rootShade = .78 + .22 * smoothstep(h, 0, .07)
      const sideVariation = .92 + .08 * noise(x * 6 + z * 6.8, y * 4.9, seed)
      tint.fill(rootShade * sideVariation, i * 3, i * 3 + 3)
    }
    geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2))
    geometry.setAttribute('color', new Float32BufferAttribute(tint, 3))
    mesh.material = material
  }
  return material
}

