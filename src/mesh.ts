import { BufferGeometry, Color, Float32BufferAttribute, Vector3 } from 'three'
import type { TreeMassConfig } from './config'
import { clamp, loftFrame, stemAt, tau, type FoliageMass } from './shape'

export class Batch {
  position: number[] = []
  color: number[] = []
  weights: number[] = []
  indices: number[] = []

  add(p: Vector3, color: Color, weight: number) {
    const index = this.position.length / 3
    this.position.push(p.x, p.y, p.z)
    this.color.push(color.r, color.g, color.b)
    this.weights.push(weight)
    return index
  }

  shell(rings: number, segments: number, vertex: (u: number, angle: number) => [Vector3, Color, number],
    center: (u: number) => Vector3) {
    const start = this.position.length / 3
    for (let i = 0; i < rings; i++) {
      const u = i / (rings - 1)
      for (let j = 0; j < segments; j++) this.add(...vertex(u, j * tau / segments))
    }
    for (let i = 0; i < rings - 1; i++) {
      for (let j = 0; j < segments; j++) {
        const a = start + i * segments + j
        const b = start + i * segments + (j + 1) % segments
        this.indices.push(a, b, b + segments, a, b + segments, a + segments)
      }
    }
    for (const end of [0, 1]) {
      const [, color, weight] = vertex(end, Math.PI * .5)
      const cap = this.add(center(end), color, weight)
      const ring = start + (rings - 1) * end * segments
      for (let j = 0; j < segments; j++) {
        const a = ring + j, b = ring + (j + 1) % segments
        if (end) this.indices.push(cap, a, b)
        else this.indices.push(cap, b, a)
      }
    }
  }

  finish() {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(this.position, 3))
    geometry.setAttribute('color', new Float32BufferAttribute(this.color, 3))
    geometry.setAttribute('shadeWeight', new Float32BufferAttribute(this.weights, 1))
    geometry.setIndex(this.indices)
    geometry.computeVertexNormals()
    geometry.computeBoundingBox()
    return geometry
  }
}

function colorRamp(config: TreeMassConfig) {
  const shade = new Color(config.palette.shade), middle = new Color(config.palette.middle), light = new Color(config.palette.light)
  return (v: number) => v < .54
    ? shade.clone().lerp(middle, clamp(v / .54))
    : middle.clone().lerp(light, clamp((v - .54) / .46))
}

export function buildMassMeshes(masses: FoliageMass[], config: TreeMassConfig, detail: 'macro' | 'meso' | 'micro' = 'macro') {
  const batch = new Batch()
  const ramp = colorRamp(config)
  const rings = detail === 'macro' ? 13 : detail === 'meso' ? 8 : 6
  const segments = detail === 'macro' ? 16 : detail === 'meso' ? 10 : 8
  for (const mass of masses) {
    const frame = loftFrame(mass)
    const exposure = .50 + .50 * Math.cos(mass.azimuth - .91)
    const phase = (mass.seed % 313) / 313 * tau
    batch.shell(rings, segments, (u, angle) => {
      const back = Math.sin(angle)
      const rim = Math.cos(angle)
      const crest = Math.sin(u * 5 + phase * .5) * .035 + Math.cos(rim * 3.9 + u * 2) * .058
      const tip = .072 * Math.sqrt(u)
      const top = back >= 0 ? .34 * back ** .70 : .28 * back
      const contact = Math.exp(-u * 4.6) * .19
      const facing = (.15 * (exposure - .44)) + rim * .073 * Math.sin(mass.azimuth - .91)
      const light = clamp(.465 + top + tip + crest - contact + facing - mass.shadeBand * .033
        + (detail === 'meso' ? .053 : detail === 'micro' ? .15 : 0))
      return [frame.point(u, angle), ramp(light), light]
    }, frame.center)
  }
  return batch.finish()
}

export function buildTrunk(config: TreeMassConfig) {
  const batch = new Batch()
  const height = config.crownStart + config.crownHeight * .93
  const root = config.totalHeight * .030 * (config.maxCrownRadius / 2.08) ** .19
  const wood = new Color(config.palette.wood)
  const dark = wood.clone().multiplyScalar(.57)
  const warm = wood.clone().lerp(new Color('#dca871'), .35)
  batch.shell(31, 18, (u, a) => {
    const radius = root * (.04 + .72 * (1 - u) ** 1.35 + .34 * Math.exp(-23 * u)) *
      (1 + .17 * Math.exp(-10 * u) * Math.sin(a * 5 + .71) + .036 * Math.sin(a * 3 + u * 6))
    const grain = .50 + .23 * Math.cos(a + .40) + .10 * Math.sin(a * 5 + u * 4)
    return [stemAt(height * u, config).add(new Vector3(Math.cos(a) * radius, 0, -Math.sin(a) * radius)),
      dark.clone().lerp(warm, grain), grain]
  }, u => stemAt(height * u, config))
  return batch.finish()
}

export function bandGeometry(source: BufferGeometry, config: TreeMassConfig) {
  const bands = source.toNonIndexed()
  const color = bands.getAttribute('color')
  const weights = bands.getAttribute('shadeWeight')
  const palette = [new Color(config.palette.shade), new Color(config.palette.middle), new Color(config.palette.light)]
  for (let i = 0; i < weights.count; i += 3) {
    const v = (weights.getX(i) + weights.getX(i + 1) + weights.getX(i + 2)) / 3
    const tint = palette[v < .42 ? 0 : v < .70 ? 1 : 2]
    for (let j = 0; j < 3; j++) color.setXYZ(i + j, tint.r, tint.g, tint.b)
  }
  return bands
}

