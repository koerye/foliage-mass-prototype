import { BufferGeometry, Color, Float32BufferAttribute, Vector3 } from 'three'
import { tau } from './shape'

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
