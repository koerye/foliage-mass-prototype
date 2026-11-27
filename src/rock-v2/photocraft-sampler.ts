// Pure math & data types for PhotoCraft PBR triplanar sampling (zero asset URL imports so Web Workers stay 100% blob:-safe!).

export interface ExternalPbrMapSet {
  size: number
  albedo: Uint8ClampedArray
  normal: Uint8ClampedArray
  roughness: Uint8ClampedArray
  ao: Uint8ClampedArray
  /** Mean RGB (0..255) of albedo for hue/tint preservation when baseColorHex is customized. */
  meanRgb: [number, number, number]
}

export interface ExternalPbrLayers {
  label?: string
  stone: ExternalPbrMapSet
  moss?: ExternalPbrMapSet
}

export interface TriplanarPbrSample {
  r: number
  g: number
  b: number
  roughness: number
  ao: number
  /** Perturbed world-space unit normal. */
  wnx: number
  wny: number
  wnz: number
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function computeMeanRgb(rgba: Uint8ClampedArray): [number, number, number] {
  let sr = 0, sg = 0, sb = 0
  const n = Math.max(1, rgba.length >> 2)
  let count = 0
  for (let i = 0; i < n; i += 4) {
    const o = i * 4
    sr += rgba[o]
    sg += rgba[o + 1]
    sb += rgba[o + 2]
    count++
  }
  const c = Math.max(1, count)
  return [sr / c, sg / c, sb / c]
}

export function makeSolidMapSet(
  rgb: [number, number, number],
  roughness = 0.82,
  size = 4,
): ExternalPbrMapSet {
  const n = size * size
  const albedo = new Uint8ClampedArray(n * 4)
  const normal = new Uint8ClampedArray(n * 4)
  const rough = new Uint8ClampedArray(n * 4)
  const ao = new Uint8ClampedArray(n * 4)
  const rb = Math.round(clamp(roughness, 0, 1) * 255)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    albedo[o] = rgb[0]; albedo[o + 1] = rgb[1]; albedo[o + 2] = rgb[2]; albedo[o + 3] = 255
    normal[o] = 128; normal[o + 1] = 128; normal[o + 2] = 255; normal[o + 3] = 255
    rough[o] = rb; rough[o + 1] = rb; rough[o + 2] = rb; rough[o + 3] = 255
    ao[o] = 255; ao[o + 1] = 255; ao[o + 2] = 255; ao[o + 3] = 255
  }
  return { size, albedo, normal, roughness: rough, ao, meanRgb: rgb }
}

function sampleBilinear(
  buf: Uint8ClampedArray,
  size: number,
  u: number,
  v: number,
): [number, number, number] {
  const fu = ((u % 1) + 1) % 1
  const fv = ((v % 1) + 1) % 1
  const x = fu * size - 0.5
  const y = fv * size - 0.5
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = x - x0
  const ty = y - y0
  const ix0 = ((x0 % size) + size) % size
  const iy0 = ((y0 % size) + size) % size
  const ix1 = (ix0 + 1) % size
  const iy1 = (iy0 + 1) % size

  const i00 = (iy0 * size + ix0) * 4
  const i10 = (iy0 * size + ix1) * 4
  const i01 = (iy1 * size + ix0) * 4
  const i11 = (iy1 * size + ix1) * 4

  const w00 = (1 - tx) * (1 - ty)
  const w10 = tx * (1 - ty)
  const w01 = (1 - tx) * ty
  const w11 = tx * ty

  return [
    buf[i00] * w00 + buf[i10] * w10 + buf[i01] * w01 + buf[i11] * w11,
    buf[i00 + 1] * w00 + buf[i10 + 1] * w10 + buf[i01 + 1] * w01 + buf[i11 + 1] * w11,
    buf[i00 + 2] * w00 + buf[i10 + 2] * w10 + buf[i01 + 2] * w01 + buf[i11 + 2] * w11,
  ]
}

export function sampleTriplanarPbr(
  set: ExternalPbrMapSet,
  px: number,
  py: number,
  pz: number,
  nx: number,
  ny: number,
  nz: number,
  tileScale: number,
  normalGain = 1.0,
  seedOffset = 0,
): TriplanarPbrSample {
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz)
  let wx = ax * ax * ax * ax
  let wy = ay * ay * ay * ay
  let wz = az * az * az * az
  const wSum = wx + wy + wz || 1
  wx /= wSum; wy /= wSum; wz /= wSum

  const sz = set.size
  const off = seedOffset * 0.137

  let r = 0, g = 0, b = 0, rough = 0, ao = 0
  let wnx = 0, wny = 0, wnz = 0

  if (wx > 0.002) {
    const sx = nx >= 0 ? 1 : -1
    const u = (pz * -sx) * tileScale + off
    const v = -py * tileScale + off * 0.31
    const [cr, cg, cb] = sampleBilinear(set.albedo, sz, u, v)
    const [nr, ng, nb] = sampleBilinear(set.normal, sz, u, v)
    const [rg] = sampleBilinear(set.roughness, sz, u, v)
    const [av] = sampleBilinear(set.ao, sz, u, v)
    r += cr * wx; g += cg * wx; b += cb * wx
    rough += (rg / 255) * wx
    ao += (av / 255) * wx
    const tnx = ((nr / 255) * 2 - 1) * normalGain
    const tny = ((ng / 255) * 2 - 1) * normalGain
    const tnz = Math.max(0.1, (nb / 255) * 2 - 1)
    wnx += (tnz * sx) * wx
    wny += tny * wx
    wnz += (tnx * -sx) * wx
  }

  if (wz > 0.002) {
    const szSign = nz >= 0 ? 1 : -1
    const u = (px * szSign) * tileScale + off * 0.73
    const v = -py * tileScale + off * 0.31
    const [cr, cg, cb] = sampleBilinear(set.albedo, sz, u, v)
    const [nr, ng, nb] = sampleBilinear(set.normal, sz, u, v)
    const [rg] = sampleBilinear(set.roughness, sz, u, v)
    const [av] = sampleBilinear(set.ao, sz, u, v)
    r += cr * wz; g += cg * wz; b += cb * wz
    rough += (rg / 255) * wz
    ao += (av / 255) * wz
    const tnx = ((nr / 255) * 2 - 1) * normalGain
    const tny = ((ng / 255) * 2 - 1) * normalGain
    const tnz = Math.max(0.1, (nb / 255) * 2 - 1)
    wnx += (tnx * szSign) * wz
    wny += tny * wz
    wnz += (tnz * szSign) * wz
  }

  if (wy > 0.002) {
    const sy = ny >= 0 ? 1 : -1
    const u = px * tileScale + off * 0.47
    const v = pz * tileScale + off * 0.89
    const [cr, cg, cb] = sampleBilinear(set.albedo, sz, u, v)
    const [nr, ng, nb] = sampleBilinear(set.normal, sz, u, v)
    const [rg] = sampleBilinear(set.roughness, sz, u, v)
    const [av] = sampleBilinear(set.ao, sz, u, v)
    r += cr * wy; g += cg * wy; b += cb * wy
    rough += (rg / 255) * wy
    ao += (av / 255) * wy
    const tnx = ((nr / 255) * 2 - 1) * normalGain
    const tny = ((ng / 255) * 2 - 1) * normalGain
    const tnz = Math.max(0.1, (nb / 255) * 2 - 1)
    wnx += tnx * wy
    wny += (tnz * sy) * wy
    wnz += (tny * -sy) * wy
  }

  const nl = Math.hypot(wnx, wny, wnz) || 1
  return {
    r,
    g,
    b,
    roughness: clamp(rough, 0.04, 0.99),
    ao: clamp(ao, 0.05, 1.0),
    wnx: wnx / nl,
    wny: wny / nl,
    wnz: wnz / nl,
  }
}

export function sampleTopPlanarPbr(
  set: ExternalPbrMapSet,
  px: number,
  pz: number,
  tileScale: number,
  normalGain = 1.0,
  seedOffset = 0,
): TriplanarPbrSample {
  const sz = set.size
  const off = seedOffset * 0.191
  const u = px * tileScale + off
  const v = pz * tileScale + off * 0.61
  const [r, g, b] = sampleBilinear(set.albedo, sz, u, v)
  const [nr, ng, nb] = sampleBilinear(set.normal, sz, u, v)
  const [rg] = sampleBilinear(set.roughness, sz, u, v)
  const [av] = sampleBilinear(set.ao, sz, u, v)
  const tnx = ((nr / 255) * 2 - 1) * normalGain
  const tny = ((ng / 255) * 2 - 1) * normalGain
  const tnz = Math.max(0.12, (nb / 255) * 2 - 1)
  const nl = Math.hypot(tnx, tnz, -tny) || 1
  return {
    r,
    g,
    b,
    roughness: clamp(rg / 255, 0.04, 0.99),
    ao: clamp(av / 255, 0.05, 1.0),
    wnx: tnx / nl,
    wny: tnz / nl,
    wnz: -tny / nl,
  }
}
